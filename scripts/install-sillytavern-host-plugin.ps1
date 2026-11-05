param(
    [Parameter(Mandatory = $true)]
    [string]$SillyTavernRoot
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stRoot = (Resolve-Path $SillyTavernRoot).Path
$pluginRoot = Join-Path $stRoot 'plugins'
$pluginPath = Join-Path $pluginRoot 'logic-engine'

function Stop-WithCode([string]$Code) {
    throw $Code
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

$pluginLoader = Join-Path $stRoot 'src/plugin-loader.js'
if (-not (Test-Path -LiteralPath $pluginLoader -PathType Leaf)) {
    Stop-WithCode 'SILLYTAVERN_PLUGIN_LOADER_NOT_FOUND'
}
if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $pluginRoot | Out-Null
}

if (Test-Path -LiteralPath $pluginPath) {
    $item = Get-Item -LiteralPath $pluginPath -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        $target = (Get-Item -LiteralPath $pluginPath).Target
        if ($target -and ((Resolve-Path $target).Path -eq $repoRoot)) {
            Write-Host 'Logic-Engine plugin junction already points to this checkout.'
        } else {
            Stop-WithCode 'PLUGIN_PATH_EXISTS_WITH_DIFFERENT_TARGET'
        }
    } else {
        Stop-WithCode 'PLUGIN_PATH_EXISTS_AS_DIRECTORY; move it aside before installing'
    }
} else {
    New-Item -ItemType Junction -Path $pluginPath -Target $repoRoot | Out-Null
    Write-Host "Created plugin junction: $pluginPath -> $repoRoot"
}

Push-Location $repoRoot
try {
    & node 'scripts/sillytavern-patch-manager.mjs' preflight --st-root $stRoot --extension-root $repoRoot
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_PREFLIGHT_FAILED' }

    & node 'scripts/sillytavern-patch-manager.mjs' install --st-root $stRoot --extension-root $repoRoot
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_INSTALL_FAILED' }

    & node 'scripts/sillytavern-patch-manager.mjs' verify --st-root $stRoot --extension-root $repoRoot
    if ($LASTEXITCODE -ne 0) { Stop-WithCode 'PATCH_VERIFY_FAILED' }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Install candidate prepared. Do not start SillyTavern until server plugins are explicitly enabled.'
Write-Host 'In default/config.yaml set enableServerPlugins: true and enableServerPluginsAutoUpdate: false.'
Write-Host 'Memory -> NPC remains disabled; do not set LOGIC_ENGINE_MEMORY_NPC_ENABLED=true.'
