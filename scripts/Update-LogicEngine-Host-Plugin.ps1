[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SillyTavernRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path -LiteralPath $SillyTavernRoot -PathType Container)) {
    throw 'SILLYTAVERN_ROOT_NOT_FOUND'
}
$stRoot = (Resolve-Path -LiteralPath $SillyTavernRoot).Path
$stPackagePath = Join-Path $stRoot 'package.json'
if (-not (Test-Path -LiteralPath $stPackagePath -PathType Leaf)) {
    throw 'SILLYTAVERN_PACKAGE_JSON_NOT_FOUND'
}
$stPackage = Get-Content -LiteralPath $stPackagePath -Raw | ConvertFrom-Json
if ($stPackage.version -ne '1.19.0') {
    throw ('SILLYTAVERN_VERSION_UNSUPPORTED: ' + $stPackage.version)
}

$nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'NODE_NOT_AVAILABLE' }

$serverSource = Join-Path $repoRoot 'host-adapter/extension-gateway/server-plugin'
$corePluginRoot = Join-Path $stRoot 'plugins/logic-engine'
$coreServerDirectory = Join-Path $corePluginRoot 'host-adapter/extension-gateway/server-plugin'
$gatewayPluginRoot = Join-Path $stRoot 'plugins/logic-engine-extension-gateway'
$browserSource = Join-Path $repoRoot 'host-adapter/extension-gateway'
$browserPluginRoot = Join-Path $stRoot 'public/scripts/extensions/third-party/logic-engine-extension-gateway'
$manifestPath = Join-Path $gatewayPluginRoot 'pinned-source-manifest.json'

foreach ($directory in @($serverSource, $corePluginRoot, $gatewayPluginRoot)) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw ('HOST_PLUGIN_DIRECTORY_NOT_FOUND: ' + $directory)
    }
    $item = Get-Item -LiteralPath $directory -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw ('HOST_PLUGIN_REPARSE_POINT_DENIED: ' + $directory)
    }
}

# Older first-install candidates omitted the browser extension entirely. Allow
# that one managed directory to be absent so this updater can repair the install.
$browserParent = Split-Path -Parent $browserPluginRoot
if (-not (Test-Path -LiteralPath $browserParent -PathType Container)) {
    throw 'HOST_PLUGIN_BROWSER_EXTENSION_PARENT_NOT_FOUND'
}
$browserParentInfo = Get-Item -LiteralPath $browserParent -Force
if ($browserParentInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'HOST_PLUGIN_BROWSER_EXTENSION_PARENT_UNSAFE'
}
$browserPluginRootExisted = Test-Path -LiteralPath $browserPluginRoot
if ($browserPluginRootExisted) {
    $browserRootInfo = Get-Item -LiteralPath $browserPluginRoot -Force
    if (-not $browserRootInfo.PSIsContainer -or ($browserRootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'HOST_PLUGIN_BROWSER_EXTENSION_ROOT_UNSAFE'
    }
}

function Add-UpdateFile {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$RelativePath
    )
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw ('HOST_PLUGIN_SOURCE_FILE_NOT_FOUND: ' + $Source)
    }
    $sourceInfo = Get-Item -LiteralPath $Source -Force
    if ($sourceInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw ('HOST_PLUGIN_SOURCE_REPARSE_POINT_DENIED: ' + $Source)
    }
    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $parentInfo = Get-Item -LiteralPath $parent -Force
    if ($parentInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw ('HOST_PLUGIN_DESTINATION_PARENT_REPARSE_POINT_DENIED: ' + $parent)
    }
    $existed = Test-Path -LiteralPath $Destination
    if ($existed) {
        $destinationInfo = Get-Item -LiteralPath $Destination -Force
        if ($destinationInfo.PSIsContainer -or ($destinationInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw ('HOST_PLUGIN_DESTINATION_UNSAFE: ' + $Destination)
        }
    }
    $script:Destinations.Add([pscustomobject]@{
        Source = $Source
        Destination = $Destination
        RelativePath = $RelativePath
        Existed = $existed
    }) | Out-Null
}

$backupRoot = Join-Path $env:TEMP ('LogicEngine-Host-Bundle-Upgrade-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$script:Destinations = New-Object System.Collections.Generic.List[object]
$manifestExisted = Test-Path -LiteralPath $manifestPath -PathType Leaf
$manifestBackupPath = Join-Path $backupRoot 'plugins/logic-engine-extension-gateway/pinned-source-manifest.json'
if ($manifestExisted) {
    $manifestInfo = Get-Item -LiteralPath $manifestPath -Force
    if ($manifestInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'HOST_SOURCE_MANIFEST_REPARSE_POINT_DENIED'
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $manifestBackupPath) -Force | Out-Null
    Copy-Item -LiteralPath $manifestPath -Destination $manifestBackupPath
}

$patchManagerUpdateStarted = $false
$patchManagerUpdateSucceeded = $false
$completed = $false

try {
    # Refresh every Gateway server module in both the deployed Gateway and the
    # Core-owned source mirror. Updating only these modules while leaving the
    # SillyTavern lifecycle patch old creates a mixed, falsely attested install.
    $serverFiles = @(Get-ChildItem -LiteralPath $serverSource -File |
        Where-Object { $_.Extension -in @('.mjs', '.js') -or $_.Name -eq 'package.json' } |
        Sort-Object Name)
    if (-not $serverFiles.Count) { throw 'HOST_PLUGIN_SERVER_SOURCE_EMPTY' }

    foreach ($file in $serverFiles) {
        Add-UpdateFile $file.FullName (Join-Path $coreServerDirectory $file.Name) ('plugins/logic-engine/host-adapter/extension-gateway/server-plugin/' + $file.Name)
        Add-UpdateFile $file.FullName (Join-Path $gatewayPluginRoot $file.Name) ('plugins/logic-engine-extension-gateway/' + $file.Name)
    }

    # Patch Manager, its complete pinned artifact set and its manifest must move
    # together. The update command rolls back the old managed patch using its
    # durable backups, then installs the new exact bundle.
    $coreFiles = @(
        @{ Source = (Join-Path $repoRoot 'scripts/sillytavern-patch-manager.mjs'); Relative = 'scripts/sillytavern-patch-manager.mjs' },
        @{ Source = (Join-Path $repoRoot 'host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json'); Relative = 'host-adapter/patches/sillytavern-1.19.0-final-send.manifest.json' },
        @{ Source = (Join-Path $repoRoot 'host-adapter/patches/sillytavern-1.19.0-final-send.patch'); Relative = 'host-adapter/patches/sillytavern-1.19.0-final-send.patch' },
        @{ Source = (Join-Path $repoRoot 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch'); Relative = 'host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch' },
        @{ Source = (Join-Path $repoRoot 'host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch'); Relative = 'host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch' },
        @{ Source = (Join-Path $repoRoot 'host-adapter/prototype/generate-pinned-source-manifest.mjs'); Relative = 'host-adapter/prototype/generate-pinned-source-manifest.mjs' }
        @{ Source = (Join-Path $repoRoot 'tests/fixtures/sillytavern-final-send-v1.manifest.json'); Relative = 'tests/fixtures/sillytavern-final-send-v1.manifest.json' }
    )
    # The manifest generator runs from the installed Core plugin and reads these
    # browser sources relative to its own repository root. Refresh that source
    # mirror as part of the same transaction; updating only the deployed public/
    # extension leaves the generator attesting against stale code.
    foreach ($name in @('index.js', 'gateway-policy.mjs', 'host-context.mjs', 'conversation-identity.mjs', 'manifest.json')) {
        $coreFiles += @{ Source = (Join-Path $browserSource $name); Relative = ('host-adapter/extension-gateway/' + $name) }
    }

    foreach ($entry in $coreFiles) {
        Add-UpdateFile $entry.Source (Join-Path $corePluginRoot $entry.Relative) ('plugins/logic-engine/' + $entry.Relative)
    }

    # The manifest generator runs during Patch Manager update. It must see the
    # current browser extension as well as the current server plugin before it
    # emits a new source manifest.
    foreach ($name in @('index.js', 'gateway-policy.mjs', 'host-context.mjs', 'conversation-identity.mjs', 'manifest.json')) {
        Add-UpdateFile (Join-Path $browserSource $name) (Join-Path $browserPluginRoot $name) ('public/scripts/extensions/third-party/logic-engine-extension-gateway/' + $name)
    }

    foreach ($entry in $script:Destinations) {
        if ($entry.Existed) {
            $backupPath = Join-Path $backupRoot $entry.RelativePath
            New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
            Copy-Item -LiteralPath $entry.Destination -Destination $backupPath
        }
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Destination -Force
    }

    $patchManager = Join-Path $corePluginRoot 'scripts/sillytavern-patch-manager.mjs'
    $patchManagerUpdateStarted = $true
    $patchUpdateOutput = & $nodeCommand.Source $patchManager 'update' '--st-root' $stRoot '--extension-root' $corePluginRoot 2>&1
    $patchUpdateExitCode = $LASTEXITCODE
    $patchUpdateText = ($patchUpdateOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    if ($patchUpdateExitCode -ne 0) {
        Write-Host $patchUpdateText
        throw ('HOST_PATCH_MANAGER_UPDATE_FAILED_' + $patchUpdateExitCode)
    }
    try { $patchUpdateResult = $patchUpdateText | ConvertFrom-Json } catch {
        throw 'HOST_PATCH_MANAGER_UPDATE_RESPONSE_INVALID'
    }
    if ($patchUpdateResult.status -notin @('INSTALLED', 'UP_TO_DATE')) {
        throw ('HOST_PATCH_MANAGER_UPDATE_UNEXPECTED_STATUS: ' + [string]$patchUpdateResult.status)
    }
    # This installer independently reconstructs the exact Host overlay from the
    # pinned ST commit, updates Gateway/browser files and generates the final
    # source manifest only after the full patch bundle has been verified.
    $bundleInstaller = Join-Path $repoRoot 'scripts/install-sillytavern-host-patch-bundle.mjs'
    & $nodeCommand.Source $bundleInstaller '--st-root' $stRoot
    $bundleExitCode = $LASTEXITCODE
    if ($bundleExitCode -ne 0) {
        throw ('HOST_PATCH_BUNDLE_UPDATE_FAILED_' + $bundleExitCode)
    }

    $verifyOutput = & $nodeCommand.Source $patchManager 'verify' '--st-root' $stRoot '--extension-root' $corePluginRoot 2>&1
    $verifyExitCode = $LASTEXITCODE
    $verifyText = ($verifyOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    if ($verifyExitCode -ne 0) {
        Write-Host $verifyText
        throw ('HOST_PATCH_MANAGER_VERIFY_FAILED_' + $verifyExitCode)
    }
    try { $verifyResult = $verifyText | ConvertFrom-Json } catch {
        throw 'HOST_PATCH_MANAGER_VERIFY_RESPONSE_INVALID'
    }
    if ($verifyResult.status -ne 'INSTALLED_AND_VERIFIED') {
        throw ('HOST_PATCH_MANAGER_VERIFY_UNEXPECTED_STATUS: ' + [string]$verifyResult.status)
    }

    $attestationSource = Get-Content -LiteralPath (Join-Path $serverSource 'st-source-attestation.mjs') -Raw
    $patchHashMatch = [regex]::Match($attestationSource, "PINNED_PATCH_BUNDLE_SHA256\s*=\s*'([a-f0-9]{64})'")
    if (-not $patchHashMatch.Success) { throw 'HOST_PATCH_BUNDLE_PIN_NOT_FOUND' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifestPinnedHostCommitValid = $manifest.pinned_host_commit -eq '06bde939fb1e9c4c8d8641d810f0a916b5bce127'
    $manifestPatchHashValid = $manifest.patch_blob_sha -eq $patchHashMatch.Groups[1].Value
    $manifestDigestValid = $manifest.manifest_sha256 -match '^[a-f0-9]{64}$'
    if (-not $manifestPinnedHostCommitValid -or -not $manifestPatchHashValid -or -not $manifestDigestValid) {
        throw 'HOST_SOURCE_MANIFEST_DOES_NOT_MATCH_CURRENT_PATCH_BUNDLE'
    }
    foreach ($name in @('index.js', 'gateway-policy.mjs', 'host-context.mjs', 'conversation-identity.mjs', 'manifest.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $browserPluginRoot $name) -PathType Leaf)) {
            throw ('HOST_PLUGIN_BROWSER_EXTENSION_INCOMPLETE: ' + $name)
        }
    }
    $browserManifest = Get-Content -LiteralPath (Join-Path $browserPluginRoot 'manifest.json') -Raw | ConvertFrom-Json
    if ($browserManifest.js -ne 'index.js') { throw 'HOST_PLUGIN_BROWSER_EXTENSION_MANIFEST_INVALID' }
    $browserEntry = Get-Content -LiteralPath (Join-Path $browserPluginRoot 'index.js') -Raw
    if (-not $browserEntry.Contains('registerHostGenerationIdentityOnce')) {
        throw 'HOST_PLUGIN_BROWSER_GENERATION_IDENTITY_MISSING'
    }
    $hostScript = Get-Content -LiteralPath (Join-Path $stRoot 'public/script.js') -Raw
    if (-not $hostScript.Contains('captureLogicEngineHostChatOnLoad') -or
        -not $hostScript.Contains('event_types.CHAT_CHANGED')) {
        throw 'HOST_PLUGIN_CHAT_LOAD_AUTO_CAPTURE_MISSING'
    }

    $completed = $true
    [pscustomobject]@{
        status = 'HOST_PLUGIN_AND_PATCH_BUNDLE_UPDATED_AND_VERIFIED'
        hostVersion = $stPackage.version
        serverModuleCount = $serverFiles.Count
        updatedFileCount = $script:Destinations.Count
        patchVersion = $patchUpdateResult.patchVersion
        patchBundleSha256 = $manifest.patch_blob_sha
        sourceManifestSha256 = $manifest.manifest_sha256
        backupDirectory = $backupRoot
        note = 'Host lifecycle patch, Gateway, browser extension and Patch Manager were updated transactionally. Chat data, Core databases, Host identity and SQLite files were not modified.'
    } | ConvertTo-Json -Depth 5
} catch {
    if (-not $patchManagerUpdateStarted) {
        for ($index = $script:Destinations.Count - 1; $index -ge 0; $index--) {
            $entry = $script:Destinations[$index]
            $backupPath = Join-Path $backupRoot $entry.RelativePath
            if ($entry.Existed -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
                Copy-Item -LiteralPath $backupPath -Destination $entry.Destination -Force
            } elseif (-not $entry.Existed -and (Test-Path -LiteralPath $entry.Destination -PathType Leaf)) {
                Remove-Item -LiteralPath $entry.Destination -Force
            }
        }
        if ($manifestExisted -and (Test-Path -LiteralPath $manifestBackupPath -PathType Leaf)) {
            Copy-Item -LiteralPath $manifestBackupPath -Destination $manifestPath -Force
        } elseif (-not $manifestExisted -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            Remove-Item -LiteralPath $manifestPath -Force
        }
        if (-not $browserPluginRootExisted -and (Test-Path -LiteralPath $browserPluginRoot -PathType Container)) {
            Remove-Item -LiteralPath $browserPluginRoot -Recurse -Force
        }
        Write-Warning ('Host plugin preflight/copy failed; previous files were restored. Backup: ' + $backupRoot)
    } else {
        Write-Warning ('Patch Manager update was started. Do not delete plugin files, transaction journals or backups. Preserve this directory for recovery: ' + $backupRoot)
    }
    throw
} finally {
    if (-not $completed) {
        Write-Warning ('Host plugin/patch update did not complete. Evidence and backups retained at: ' + $backupRoot)
    }
}
