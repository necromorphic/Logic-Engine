param(
    [Parameter(Mandatory = $true)]
    [string]$SillyTavernRoot
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stRoot = (Resolve-Path $SillyTavernRoot).Path

$stPackagePath = Join-Path $stRoot 'package.json'
if (-not (Test-Path -LiteralPath $stPackagePath -PathType Leaf)) {
    throw 'SILLYTAVERN_PACKAGE_JSON_NOT_FOUND'
}
$stPackage = Get-Content -LiteralPath $stPackagePath -Raw | ConvertFrom-Json
if ($stPackage.version -ne '1.19.0') {
    throw "SILLYTAVERN_VERSION_UNSUPPORTED: $($stPackage.version)"
}

$pluginParent = Join-Path $stRoot 'plugins'
$extensionParent = Join-Path $stRoot 'public/scripts/extensions/third-party'
$serverTarget = Join-Path $pluginParent 'logic-engine-extension-gateway'
$browserTarget = Join-Path $extensionParent 'logic-engine-extension-gateway'

if (Test-Path -LiteralPath $serverTarget) {
    throw 'HOST_SERVER_PLUGIN_ALREADY_EXISTS; inspect and preserve it before installing'
}
if (Test-Path -LiteralPath $browserTarget) {
    throw 'HOST_BROWSER_EXTENSION_ALREADY_EXISTS; inspect and preserve it before installing'
}

$serverSource = Join-Path $repoRoot 'host-adapter/extension-gateway/server-plugin'
$browserSource = Join-Path $repoRoot 'host-adapter/extension-gateway'
foreach ($source in @($serverSource, $browserSource)) {
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "SOURCE_COMPONENT_NOT_FOUND: $source"
    }
}

New-Item -ItemType Directory -Path $pluginParent -Force | Out-Null
New-Item -ItemType Directory -Path $extensionParent -Force | Out-Null

$suffix = [guid]::NewGuid().ToString('N')
$serverStage = Join-Path $pluginParent ".logic-engine-extension-gateway-stage-$suffix"
$browserStage = Join-Path $extensionParent ".logic-engine-extension-gateway-stage-$suffix"
$serverInstalled = $false
$browserInstalled = $false

try {
    New-Item -ItemType Directory -Path $serverStage | Out-Null
    Copy-Item -Path (Join-Path $serverSource '*') -Destination $serverStage -Recurse

    New-Item -ItemType Directory -Path $browserStage | Out-Null
    foreach ($file in @('manifest.json', 'index.js', 'conversation-identity.mjs', 'gateway-policy.mjs', 'host-context.mjs')) {
        $sourceFile = Join-Path $browserSource $file
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
            throw "BROWSER_EXTENSION_FILE_MISSING: $file"
        }
        Copy-Item -LiteralPath $sourceFile -Destination $browserStage
    }

    Move-Item -LiteralPath $serverStage -Destination $serverTarget
    $serverInstalled = $true
    Move-Item -LiteralPath $browserStage -Destination $browserTarget
    $browserInstalled = $true
} catch {
    if ($browserInstalled -and (Test-Path -LiteralPath $browserTarget)) {
        Remove-Item -LiteralPath $browserTarget -Recurse -Force
    }
    if ($serverInstalled -and (Test-Path -LiteralPath $serverTarget)) {
        Remove-Item -LiteralPath $serverTarget -Recurse -Force
    }
    throw
} finally {
    foreach ($stage in @($serverStage, $browserStage)) {
        if (Test-Path -LiteralPath $stage) {
            Remove-Item -LiteralPath $stage -Recurse -Force
        }
    }
}

Write-Host 'HOST_COMPONENTS_INSTALLED'
Write-Host "Server plugin: $serverTarget"
Write-Host "Browser extension: $browserTarget"
Write-Host 'The existing plugins/logic-engine installation and managed Final-Send patch were not changed.'
Write-Host 'Restart this isolated SillyTavern copy to load the components.'
Write-Host 'Memory -> NPC remains disabled. Do not set LOGIC_ENGINE_MEMORY_NPC_ENABLED=true yet.'
