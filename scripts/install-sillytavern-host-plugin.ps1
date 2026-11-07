param(
    [Parameter(Mandatory = $true)]
    [string]$SillyTavernRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stRoot = (Resolve-Path $SillyTavernRoot).Path
$pluginRoot = Join-Path $stRoot 'plugins'
$pluginPath = Join-Path $pluginRoot 'logic-engine'
$gatewayPluginPath = Join-Path $pluginRoot 'logic-engine-extension-gateway'

function Stop-WithCode([string]$Code) { throw $Code }

function Copy-FilteredTree([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $excludedDirectories = @('.git', 'node_modules', 'tests', 'coverage', 'data')
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

$nodeVersionText = (& node --version).Trim()
if ($LASTEXITCODE -ne 0) { Stop-WithCode 'NODE_NOT_AVAILABLE' }
$nodeVersion = [version]($nodeVersionText.TrimStart('v'))
if ($nodeVersion -lt [version]'22.13.0') {
    Stop-WithCode "NODE_VERSION_UNSUPPORTED: $nodeVersionText (requires >=22.13.0)"
}

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
if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $pluginRoot | Out-Null
}
# This installer is intentionally first-install-only. Replacing an existing plugin
# tree here would discard the installed Patch Manager state and can make the
# Host bundle verifier misclassify our own Final-Send patch as a local edit.
# Updates and repairs must use the dedicated Patch Manager commands instead.
if ((Test-Path -LiteralPath $pluginPath) -or (Test-Path -LiteralPath $gatewayPluginPath)) {
    Stop-WithCode 'PLUGIN_PATH_ALREADY_EXISTS'
}

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
    Copy-FilteredTree $gatewaySource $gatewayPluginPath
    Write-Host "Copied Logic-Engine Host Gateway plugin to: $gatewayPluginPath"
    
    # Re-run the idempotent Host Bundle installer after replacing the plugins.
    # It reconstructs the pinned source tree independently, regenerates the
    # deployment manifest, and installs that manifest into the new Gateway folder.
    # This avoids trusting or losing the manifest from the previous plugin copy.
    & node 'scripts/install-sillytavern-host-patch-bundle.mjs' --st-root $stRoot
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'HOST_PATCH_BUNDLE_REFRESH_FAILED' }
} catch {
    if (Test-Path -LiteralPath $pluginPath) { Remove-Item -LiteralPath $pluginPath -Recurse -Force }
    if (Test-Path -LiteralPath $gatewayPluginPath) { Remove-Item -LiteralPath $gatewayPluginPath -Recurse -Force }
    if ($hadPlugin -and (Test-Path -LiteralPath (Join-Path $backupRoot 'logic-engine'))) {
        Move-Item -LiteralPath (Join-Path $backupRoot 'logic-engine') -Destination $pluginPath
    }
    if ($hadGateway -and (Test-Path -LiteralPath (Join-Path $backupRoot 'logic-engine-extension-gateway'))) {
        Move-Item -LiteralPath (Join-Path $backupRoot 'logic-engine-extension-gateway') -Destination $gatewayPluginPath
    }
    throw
}

Push-Location $pluginPath
try {
    # This repository intentionally has no package-lock.json; npm ci cannot run here.
    # Invoke the Windows command shim explicitly. In PowerShell, resolving
    # "npm" can select npm.ps1 and produce malformed command dispatch on some
    # installations (for example, "Unknown command: pm").
    $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
    if (-not $npmCommand) { Stop-WithCode 'NPM_CMD_NOT_FOUND' }
    & $npmCommand.Source install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PLUGIN_DEPENDENCY_INSTALL_FAILED' }

    & node 'scripts/sillytavern-patch-manager.mjs' preflight --st-root $stRoot --extension-root $pluginPath
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_PREFLIGHT_FAILED' }

    & node 'scripts/sillytavern-patch-manager.mjs' install --st-root $stRoot --extension-root $pluginPath
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_INSTALL_FAILED' }

    & node 'scripts/sillytavern-patch-manager.mjs' verify --st-root $stRoot --extension-root $pluginPath
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_VERIFY_FAILED' }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Install candidate prepared. Do not start SillyTavern until server plugins are explicitly enabled.'
Write-Host 'In default/config.yaml set enableServerPlugins: true and enableServerPluginsAutoUpdate: false.'
Write-Host 'Memory -> NPC remains disabled; do not set LOGIC_ENGINE_MEMORY_NPC_ENABLED=true.'
