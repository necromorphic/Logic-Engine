[CmdletBinding()]
param(
    [string]$TestRoot = (Join-Path $env:TEMP 'LogicEngine-ST-Test-20261105-220810')
)

$ErrorActionPreference = 'Stop'
$commit = '0e69fdd9e4ea34d283c5e0e7e81fc61a8558306a'
$work = Join-Path $env:TEMP ("logic-engine-phase2-bootstrap-" + [guid]::NewGuid().ToString('N'))

try {
    if (-not (Test-Path -LiteralPath $TestRoot -PathType Container)) {
        throw "TEST_ROOT_NOT_FOUND: $TestRoot"
    }

    Write-Host "Searching isolated test root: $TestRoot"
    $candidates = @(
        Get-ChildItem -LiteralPath $TestRoot -Filter 'package.json' -File -Recurse |
        Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
        ForEach-Object {
            $root = $_.Directory.FullName
            try {
                $pkg = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
                if ($pkg.version -eq '1.19.0' -and
                    (Test-Path -LiteralPath (Join-Path $root 'src/plugin-loader.js')) -and
                    (Test-Path -LiteralPath (Join-Path $root 'plugins/logic-engine')) -and
                    (Test-Path -LiteralPath (Join-Path $root 'plugins/logic-engine/data/final-send-patch/manifest.json'))) {
                    [pscustomobject]@{ Root = $root; Version = $pkg.version }
                }
            } catch { }
        }
    )

    if ($candidates.Count -eq 0) {
        throw 'ISOLATED_ST_1_19_WITH_EXISTING_LOGIC_ENGINE_AND_FINAL_SEND_PATCH_NOT_FOUND. No files were changed.'
    }
    if ($candidates.Count -gt 1) {
        $candidates | ForEach-Object { Write-Host "Candidate: $($_.Root)" }
        throw 'MULTIPLE_TEST_TAVERNS_FOUND. No files were changed.'
    }

    $stRoot = $candidates[0].Root
    Write-Host "Found isolated SillyTavern: $stRoot"
    Write-Host 'Existing root Logic Engine and Final-Send patch detected; they will not be modified.'

    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $zip = Join-Path $work 'source.zip'
    $extract = Join-Path $work 'source'
    Invoke-WebRequest -Uri "https://github.com/necromorphic/Logic-Engine/archive/$commit.zip" -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force

    $sourceRoot = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw 'PINNED_SOURCE_ARCHIVE_EMPTY' }

    $installer = Join-Path $sourceRoot.FullName 'scripts/install-sillytavern-host-components.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'PINNED_HOST_COMPONENT_INSTALLER_MISSING' }

    & $installer -SillyTavernRoot $stRoot
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "INSTALLER_EXIT_CODE_$LASTEXITCODE" }

    Write-Host ''
    Write-Host 'PHASE2_HOST_COMPONENT_INSTALL_COMPLETE'
    Write-Host "SillyTavern: $stRoot"
    Write-Host "Pinned Logic-Engine source: $commit"
    Write-Host 'Restart only the isolated SillyTavern instance on port 61132.'
    Write-Host 'Memory -> NPC remains disabled. Do not set LOGIC_ENGINE_MEMORY_NPC_ENABLED=true.'
}
finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}