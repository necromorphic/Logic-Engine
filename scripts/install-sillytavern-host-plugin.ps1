param(
    [Parameter(Mandatory = $true)]
    [string]$SillyTavernRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path -LiteralPath $SillyTavernRoot -PathType Container)) {
    throw 'SILLYTAVERN_ROOT_NOT_FOUND'
}
$stRoot = (Resolve-Path -LiteralPath $SillyTavernRoot).Path
$pluginRoot = Join-Path $stRoot 'plugins'
$pluginPath = Join-Path $pluginRoot 'logic-engine'
$gatewayPluginPath = Join-Path $pluginRoot 'logic-engine-extension-gateway'
$browserPluginPath = Join-Path $stRoot 'public/scripts/extensions/third-party/logic-engine-extension-gateway'

function Stop-WithCode([string]$Code) { throw $Code }

function Copy-BrowserExtension([string]$Source, [string]$Destination) {
    $files = @('index.js', 'gateway-policy.mjs', 'host-context.mjs', 'conversation-identity.mjs', 'manifest.json')
    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $parentInfo = Get-Item -LiteralPath $parent -Force
    if (-not $parentInfo.PSIsContainer -or ($parentInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Stop-WithCode 'BROWSER_EXTENSION_PARENT_UNSAFE'
    }
    if (Test-Path -LiteralPath $Destination) {
        Stop-WithCode 'BROWSER_EXTENSION_PATH_ALREADY_EXISTS'
    }
    New-Item -ItemType Directory -Path $Destination | Out-Null
    foreach ($name in $files) {
        $sourceFile = Join-Path $Source $name
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            Stop-WithCode ('BROWSER_EXTENSION_SOURCE_FILE_NOT_FOUND: ' + $name)
        }
        $sourceInfo = Get-Item -LiteralPath $sourceFile -Force
        if ($sourceInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Stop-WithCode ('BROWSER_EXTENSION_SOURCE_REPARSE_POINT_DENIED: ' + $name)
        }
        Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $Destination $name)
    }
}

function Copy-FilteredTree([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $excludedDirectories = @('.git', 'node_modules', 'tests', 'coverage', 'data', 'fireemblem8u_repo')
    foreach ($entry in Get-ChildItem -LiteralPath $Source -Force) {
        if ($entry.PSIsContainer) {
            if (($entry.Name -in $excludedDirectories) -or ($entry.Name -like 'worktree-backup-*')) {
                continue
            }
            Copy-FilteredTree $entry.FullName (Join-Path $Destination $entry.Name)
            continue
        }
        if ($entry.Name -eq '.env' -or $entry.Name -like '.env.*' -or $entry.Name -eq 'package-lock.json') { continue }
        Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $Destination $entry.Name)
    }
}

# Complete all external-tool and network preflight checks before creating plugin directories.
$nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
$gitCommand = Get-Command 'git' -ErrorAction SilentlyContinue
$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $nodeCommand) { Stop-WithCode 'NODE_NOT_AVAILABLE' }
if (-not $gitCommand) { Stop-WithCode 'GIT_NOT_AVAILABLE' }
if (-not $npmCommand) { Stop-WithCode 'NPM_CMD_NOT_FOUND' }

$nodeVersionText = (& $nodeCommand.Source --version).Trim()
if ($LASTEXITCODE -ne 0) { Stop-WithCode 'NODE_NOT_AVAILABLE' }
$nodeVersion = [version]($nodeVersionText.TrimStart('v'))
if ($nodeVersion -lt [version]'22.13.0') {
    Stop-WithCode "NODE_VERSION_UNSUPPORTED: $nodeVersionText (requires >=22.13.0)"
}
& $npmCommand.Source ping --fetch-retries=0 --fetch-timeout=10000 | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-WithCode 'NPM_REGISTRY_UNAVAILABLE' }
& $gitCommand.Source ls-remote --exit-code https://github.com/SillyTavern/SillyTavern.git HEAD | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-WithCode 'SILLYTAVERN_GITHUB_UNAVAILABLE' }

$stPackagePath = Join-Path $stRoot 'package.json'
if (-not (Test-Path -LiteralPath $stPackagePath -PathType Leaf)) {
    Stop-WithCode 'SILLYTAVERN_PACKAGE_JSON_NOT_FOUND'
}
$stPackage = Get-Content -LiteralPath $stPackagePath -Raw | ConvertFrom-Json
if ($stPackage.version -ne '1.19.0') {
    Stop-WithCode "SILLYTAVERN_VERSION_UNSUPPORTED: $($stPackage.version)"
}
if (-not (Test-Path -LiteralPath (Join-Path $stRoot 'src/plugin-loader.js') -PathType Leaf)) {
    Stop-WithCode 'SILLYTAVERN_PLUGIN_LOADER_NOT_FOUND'
}
# Refuse an existing installation before changing any directory or backup state.
if ((Test-Path -LiteralPath $pluginPath) -or (Test-Path -LiteralPath $gatewayPluginPath)) {
    Stop-WithCode 'PLUGIN_PATH_ALREADY_EXISTS'
}
if (Test-Path -LiteralPath $browserPluginPath) {
    Stop-WithCode 'BROWSER_EXTENSION_PATH_ALREADY_EXISTS'
}
if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $pluginRoot | Out-Null
}
# This installer is intentionally first-install-only. Updates and repairs use the
# dedicated Patch Manager commands instead.
$gatewaySource = Join-Path $repoRoot 'host-adapter/extension-gateway/server-plugin'
if (-not (Test-Path -LiteralPath (Join-Path $gatewaySource 'index.mjs') -PathType Leaf)) {
    Stop-WithCode 'HOST_GATEWAY_SERVER_PLUGIN_SOURCE_NOT_FOUND'
}

# Backups from older installer versions may still be nested in plugins.
# Migrate them outside the plugin inventory before any new installation.
$backupStorageRoot = Join-Path $stRoot '.logic-engine-plugin-backups'
if (Test-Path -LiteralPath $backupStorageRoot) {
    $backupStorageInfo = Get-Item -LiteralPath $backupStorageRoot -Force
    if (-not $backupStorageInfo.PSIsContainer -or ($backupStorageInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Stop-WithCode 'PLUGIN_BACKUP_STORAGE_UNSAFE'
    }
}
$legacyBackupDirs = @(Get-ChildItem -LiteralPath $pluginRoot -Directory -Filter 'logic-engine-plugin-backup-*' -ErrorAction SilentlyContinue)
if ($legacyBackupDirs.Count -gt 0) {
    New-Item -ItemType Directory -Path $backupStorageRoot -Force | Out-Null
    foreach ($legacyBackup in $legacyBackupDirs) {
        if ($legacyBackup.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            Stop-WithCode 'LEGACY_PLUGIN_BACKUP_REPARSE_POINT_DENIED'
        }
        $legacyDestination = Join-Path $backupStorageRoot ($legacyBackup.Name + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        Move-Item -LiteralPath $legacyBackup.FullName -Destination $legacyDestination
    }
}

try {
    Copy-FilteredTree $repoRoot $pluginPath
    Write-Host "Copied Logic-Engine Final-Send plugin to: $pluginPath"
} catch {
    if (Test-Path -LiteralPath $pluginPath) { Remove-Item -LiteralPath $pluginPath -Recurse -Force }
    if (Test-Path -LiteralPath $gatewayPluginPath) { Remove-Item -LiteralPath $gatewayPluginPath -Recurse -Force }
    throw
}

$patchInstallAttempted = $false
try {
    Push-Location $pluginPath
    try {
        # This repository intentionally has no committed package-lock.json yet.
        # Invoke npm.cmd explicitly: npm can resolve to npm.ps1 in PowerShell.
        & $npmCommand.Source install --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PLUGIN_DEPENDENCY_INSTALL_FAILED' }

        & $nodeCommand.Source 'scripts/sillytavern-patch-manager.mjs' preflight --st-root $stRoot --extension-root $pluginPath
        if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_PREFLIGHT_FAILED' }

        $patchInstallAttempted = $true
        & $nodeCommand.Source 'scripts/sillytavern-patch-manager.mjs' install --st-root $stRoot --extension-root $pluginPath
        if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_INSTALL_FAILED' }
    } finally {
        Pop-Location
    }
} catch {
    # npm/preflight failures happen before SillyTavern is patched. If Patch Manager
    # was invoked, remove the copied plugin only after its own recovery/status check
    # proves that no managed patch remains installed. Otherwise preserve evidence.
    $safeToRemovePlugin = -not $patchInstallAttempted
    if ($patchInstallAttempted -and (Test-Path -LiteralPath (Join-Path $pluginPath 'scripts/sillytavern-patch-manager.mjs'))) {
        $statusOutput = & $nodeCommand.Source (Join-Path $pluginPath 'scripts/sillytavern-patch-manager.mjs') status --st-root $stRoot --extension-root $pluginPath 2>$null
        $statusExitCode = $LASTEXITCODE
        if ($statusExitCode -eq 0) {
            try {
                $patchStatus = ($statusOutput -join [Environment]::NewLine) | ConvertFrom-Json
                $safeToRemovePlugin = $patchStatus.status -eq 'NOT_INSTALLED'
            } catch {
                $safeToRemovePlugin = $false
            }
        }
    }
    if ($safeToRemovePlugin -and (Test-Path -LiteralPath $pluginPath)) {
        Remove-Item -LiteralPath $pluginPath -Recurse -Force
        Write-Warning 'Failed first install was cleaned up; retry is safe after correcting the reported cause.'
    } else {
        Write-Warning 'Install state could not be proven clean. Plugin files were preserved for recovery; do not delete them manually.'
    }
    throw
}

# Install Final-Send before Host Bundle. The Host bundle generator explicitly
# reconstructs the combined Final-Send + Host tree; applying Final-Send after
# Host would make its rollback mistake the legitimate combined plugin-loader.js
# for an unrelated user edit.
try {
    Copy-FilteredTree $gatewaySource $gatewayPluginPath
    Write-Host "Copied Logic-Engine Host Gateway plugin to: $gatewayPluginPath"
    $browserSource = Join-Path $repoRoot 'host-adapter/extension-gateway'
    Copy-BrowserExtension $browserSource $browserPluginPath
    Write-Host "Copied Logic Engine browser extension to: $browserPluginPath"
    & node (Join-Path $repoRoot 'scripts/install-sillytavern-host-patch-bundle.mjs') --st-root $stRoot
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'HOST_PATCH_BUNDLE_INSTALL_FAILED' }
} catch {
    # The bundle installer rolls back its own files. Remove the separately
    # installed Final-Send patch only if its own transaction can verify rollback.
    & node (Join-Path $pluginPath 'scripts/sillytavern-patch-manager.mjs') uninstall --st-root $stRoot --extension-root $pluginPath
    if ($LASTEXITCODE -eq 0) {
        if (Test-Path -LiteralPath $pluginPath) { Remove-Item -LiteralPath $pluginPath -Recurse -Force }
        if (Test-Path -LiteralPath $gatewayPluginPath) { Remove-Item -LiteralPath $gatewayPluginPath -Recurse -Force }
        if (Test-Path -LiteralPath $browserPluginPath) { Remove-Item -LiteralPath $browserPluginPath -Recurse -Force }
    } else {
        Write-Warning 'Final-Send rollback was not confirmed; plugin files were preserved for recovery.'
    }
    throw
}

& node (Join-Path $pluginPath 'scripts/sillytavern-patch-manager.mjs') verify --st-root $stRoot --extension-root $pluginPath
if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_VERIFY_FAILED_AFTER_HOST_BUNDLE' }
foreach ($name in @('index.js', 'gateway-policy.mjs', 'host-context.mjs', 'conversation-identity.mjs', 'manifest.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $browserPluginPath $name) -PathType Leaf)) {
        Stop-WithCode ('BROWSER_EXTENSION_INSTALL_INCOMPLETE: ' + $name)
    }
}
$browserManifest = Get-Content -LiteralPath (Join-Path $browserPluginPath 'manifest.json') -Raw | ConvertFrom-Json
if ($browserManifest.js -ne 'index.js') { Stop-WithCode 'BROWSER_EXTENSION_MANIFEST_INVALID' }

Write-Host ''
Write-Host 'Install candidate prepared. Do not start SillyTavern until server plugins are explicitly enabled.'
Write-Host 'In default/config.yaml set enableServerPlugins: true and enableServerPluginsAutoUpdate: false.'
Write-Host 'Memory -> NPC remains disabled; do not set LOGIC_ENGINE_MEMORY_NPC_ENABLED=true.'
