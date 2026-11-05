param(
    [Parameter(Mandatory = $true)]
    [string]$SillyTavernRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stRoot = (Resolve-Path $SillyTavernRoot).Path
$pluginRoot = Join-Path $stRoot 'plugins'
$pluginPath = Join-Path $pluginRoot 'logic-engine'

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
        if ($entry.Name -eq '.env' -or $entry.Name -like '.env.*') { continue }
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
if (Test-Path -LiteralPath $pluginPath) {
    Stop-WithCode 'PLUGIN_PATH_ALREADY_EXISTS; preserve it and inspect before replacing'
}

Copy-FilteredTree $repoRoot $pluginPath
Write-Host "Copied Logic-Engine plugin to: $pluginPath"

Push-Location $pluginPath
try {
    # This repository intentionally has no package-lock.json; npm ci cannot run here.
    & npm install --omit=dev --no-audit --no-fund
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
