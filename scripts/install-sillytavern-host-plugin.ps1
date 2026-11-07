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
# Replacing an existing test installation is allowed, but never destructive:
# move both prior plugin directories into a timestamped backup first.
$gatewaySource = Join-Path $repoRoot 'host-adapter/extension-gateway/server-plugin'
if (-not (Test-Path -LiteralPath (Join-Path $gatewaySource 'index.mjs') -PathType Leaf)) {
    Stop-WithCode 'HOST_GATEWAY_SERVER_PLUGIN_SOURCE_NOT_FOUND'
}
# Verify the root plugin's deployment-pinned files before touching the current ST installation.
# This catches stale identity pins in the repository itself, rather than after copying
# plugins and entering Final-Send's patch preflight.
& node (Join-Path $repoRoot 'scripts/verify-host-plugin-pins.mjs') --plugin-root $repoRoot
if ($LASTEXITCODE -ne 0) { Stop-WithCode 'HOST_PLUGIN_PIN_PREFLIGHT_FAILED' }

$backupName = 'logic-engine-plugin-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 8))
$backupRoot = Join-Path $pluginRoot $backupName
$hadPlugin = Test-Path -LiteralPath $pluginPath
$hadGateway = Test-Path -LiteralPath $gatewayPluginPath
if ($hadPlugin -or $hadGateway) {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    if ($hadPlugin) { Move-Item -LiteralPath $pluginPath -Destination (Join-Path $backupRoot 'logic-engine') }
    if ($hadGateway) { Move-Item -LiteralPath $gatewayPluginPath -Destination (Join-Path $backupRoot 'logic-engine-extension-gateway') }
    Write-Host "Previous test plugins backed up to: $backupRoot"
}

try {
    Copy-FilteredTree $repoRoot $pluginPath
    Write-Host "Copied Logic-Engine Final-Send plugin to: $pluginPath"
    Copy-FilteredTree $gatewaySource $gatewayPluginPath
    Write-Host "Copied Logic-Engine Host Gateway plugin to: $gatewayPluginPath"
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
