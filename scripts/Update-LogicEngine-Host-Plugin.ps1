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

$sourceDirectory = Join-Path $repoRoot 'host-adapter/extension-gateway/server-plugin'
$corePluginDirectory = Join-Path $stRoot 'plugins/logic-engine/host-adapter/extension-gateway/server-plugin'
$gatewayPluginDirectory = Join-Path $stRoot 'plugins/logic-engine-extension-gateway'
$manifestPath = Join-Path $gatewayPluginDirectory 'pinned-source-manifest.json'

foreach ($directory in @($sourceDirectory, $corePluginDirectory, $gatewayPluginDirectory)) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw ('HOST_PLUGIN_DIRECTORY_NOT_FOUND: ' + $directory)
    }
    $item = Get-Item -LiteralPath $directory -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw ('HOST_PLUGIN_REPARSE_POINT_DENIED: ' + $directory)
    }
}

$files = @('host-adapter.mjs', 'st-server-digest-proxy.mjs', 'st-source-attestation.mjs')
$destinations = @()
foreach ($file in $files) {
    $source = Join-Path $sourceDirectory $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw ('HOST_PLUGIN_SOURCE_FILE_NOT_FOUND: ' + $file)
    }
    foreach ($directory in @($corePluginDirectory, $gatewayPluginDirectory)) {
        $destination = Join-Path $directory $file
        if (Test-Path -LiteralPath $destination) {
            $item = Get-Item -LiteralPath $destination -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw ('HOST_PLUGIN_DESTINATION_UNSAFE: ' + $destination)
            }
        }
        $destinations += [pscustomobject]@{
            Source = $source
            Destination = $destination
            Existed = Test-Path -LiteralPath $destination -PathType Leaf
        }
    }
}

$backupRoot = Join-Path $env:TEMP ('LogicEngine-Host-Plugin-Backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$completed = $false
$previousSilTavernDir = [Environment]::GetEnvironmentVariable('SILLYTAVERN_DIR', 'Process')
$previousLocation = Get-Location

try {
    foreach ($entry in $destinations) {
        $rootPrefix = $stRoot.TrimEnd([char[]]@('\', '/'))
        $relative = $entry.Destination.Substring($rootPrefix.Length).TrimStart([char[]]@('\', '/'))
        $backupPath = Join-Path $backupRoot $relative
        if ($entry.Existed) {
            New-Item -ItemType Directory -Path (Split-Path $backupPath) -Force | Out-Null
            Copy-Item -LiteralPath $entry.Destination -Destination $backupPath
        }
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Destination -Force
    }

    [Environment]::SetEnvironmentVariable('SILLYTAVERN_DIR', $stRoot, 'Process')
    Set-Location -LiteralPath $repoRoot
    & $nodeCommand.Source 'host-adapter/prototype/generate-pinned-source-manifest.mjs'
    if ($LASTEXITCODE -ne 0) {
        throw ('PINNED_SOURCE_MANIFEST_GENERATION_FAILED: ' + $LASTEXITCODE)
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'PINNED_SOURCE_MANIFEST_NOT_CREATED'
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if (-not ($manifest.manifest_sha256 -match '^[a-f0-9]{64}$')) {
        throw 'PINNED_SOURCE_MANIFEST_INVALID'
    }
    $completed = $true
    [pscustomobject]@{
        status = 'HOST_PLUGIN_UPDATED_AND_SOURCE_MANIFEST_VERIFIED'
        hostVersion = $stPackage.version
        updatedFileCount = $destinations.Count
        sourceManifestSha256 = $manifest.manifest_sha256
        backupDirectory = $backupRoot
        note = 'Core database, Host identity, chat metadata, SQLite files and SillyTavern patches were not modified.'
    } | ConvertTo-Json -Depth 4
} catch {
    foreach ($entry in $destinations) {
        $rootPrefix = $stRoot.TrimEnd([char[]]@('\', '/'))
        $relative = $entry.Destination.Substring($rootPrefix.Length).TrimStart([char[]]@('\', '/'))
        $backupPath = Join-Path $backupRoot $relative
        if ($entry.Existed -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
            Copy-Item -LiteralPath $backupPath -Destination $entry.Destination -Force
        } elseif (-not $entry.Existed -and (Test-Path -LiteralPath $entry.Destination -PathType Leaf)) {
            Remove-Item -LiteralPath $entry.Destination -Force
        }
    }
    throw
} finally {
    Set-Location -LiteralPath $previousLocation
    [Environment]::SetEnvironmentVariable('SILLYTAVERN_DIR', $previousSilTavernDir, 'Process')
    if (-not $completed) {
        Write-Warning ('Host plugin update was rolled back. Backup/evidence directory: ' + $backupRoot)
    }
}
