[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SillyTavernRoot
)

$ErrorActionPreference = 'Stop'
$commit = '0e69fdd9e4ea34d283c5e0e7e81fc61a8558306a'
$work = Join-Path $env:TEMP ("logic-engine-phase2-" + [guid]::NewGuid().ToString('N'))
$zip = Join-Path $work 'source.zip'
$extract = Join-Path $work 'source'
$archiveUrl = "https://github.com/necromorphic/Logic-Engine/archive/$commit.zip"

try {
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    Write-Host "Downloading pinned Logic-Engine source $commit ..."
    Invoke-WebRequest -Uri $archiveUrl -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force

    $sourceRoot = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw 'PINNED_SOURCE_ARCHIVE_EMPTY' }

    $installer = Join-Path $sourceRoot.FullName 'scripts/install-sillytavern-host-components.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw 'PINNED_HOST_COMPONENT_INSTALLER_MISSING'
    }

    & $installer -SillyTavernRoot $SillyTavernRoot
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "INSTALLER_EXIT_CODE_$LASTEXITCODE" }

    Write-Host ''
    Write-Host 'PHASE2_HOST_COMPONENT_INSTALL_COMPLETE'
    Write-Host "Pinned source: $commit"
    Write-Host 'Next: restart only the isolated SillyTavern instance on port 61132.'
    Write-Host 'Memory -> NPC remains disabled. Do not set LOGIC_ENGINE_MEMORY_NPC_ENABLED=true.'
}
finally {
    if (Test-Path -LiteralPath $work) {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}
