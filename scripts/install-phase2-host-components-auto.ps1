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

    # Test bootstrap creates <TestRoot>\SillyTavern. Final-Send state belongs
    # to the ST root under data\logic-engine, not plugins\logic-engine.
    $candidates = @(
        Get-ChildItem -LiteralPath $TestRoot -Filter 'package.json' -File -Recurse |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git)[\\/]' } |
        ForEach-Object {
            $root = $_.Directory.FullName
            try {
                $pkg = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
                $pluginRoot = Join-Path $root 'plugins\logic-engine'
                $patchState = Join-Path $root 'data\logic-engine\final-send-patch\state.json'
                if ($pkg.version -eq '1.19.0' -and
                    (Test-Path -LiteralPath (Join-Path $root 'src\plugin-loader.js') -PathType Leaf) -and
                    (Test-Path -LiteralPath $pluginRoot -PathType Container) -and
                    (Test-Path -LiteralPath (Join-Path $pluginRoot 'scripts\sillytavern-patch-manager.mjs') -PathType Leaf) -and
                    (Test-Path -LiteralPath $patchState -PathType Leaf)) {
                    [pscustomobject]@{ Root = $root; PluginRoot = $pluginRoot; Version = $pkg.version }
                }
            } catch { }
        }
    )

    if ($candidates.Count -eq 0) {
        throw 'ISOLATED_ST_1_19_WITH_LOGIC_ENGINE_AND_FINAL_SEND_STATE_NOT_FOUND. No files were changed.'
    }
    if ($candidates.Count -gt 1) {
        $candidates | ForEach-Object { Write-Host "Candidate: $($_.Root)" }
        throw 'MULTIPLE_TEST_TAVERNS_FOUND. No files were changed.'
    }

    $stRoot = (Resolve-Path -LiteralPath $candidates[0].Root).Path
    $pluginRoot = (Resolve-Path -LiteralPath $candidates[0].PluginRoot).Path
    Write-Host "Found isolated SillyTavern: $stRoot"

    # Read-only verification through the installed Final-Send patch manager.
    $statusOutput = & node (Join-Path $pluginRoot 'scripts\sillytavern-patch-manager.mjs') status --st-root $stRoot --extension-root $pluginRoot
    if ($LASTEXITCODE -ne 0) {
        throw "FINAL_SEND_STATUS_CHECK_FAILED: $($statusOutput -join ' ')"
    }
    $status = ($statusOutput -join [Environment]::NewLine) | ConvertFrom-Json
    if ($status.status -ne 'INSTALLED_AND_VERIFIED') {
        throw "FINAL_SEND_NOT_VERIFIED: $($status.status). No files were changed."
    }
    Write-Host 'Logic Engine and Final-Send verified. Existing files will not be modified.'

    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $zip = Join-Path $work 'source.zip'
    $extract = Join-Path $work 'source'
    Invoke-WebRequest -Uri "https://github.com/necromorphic/Logic-Engine/archive/$commit.zip" -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force

    $sourceRoot = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
    if (-not $sourceRoot) { throw 'PINNED_SOURCE_ARCHIVE_EMPTY' }

    $installer = Join-Path $sourceRoot.FullName 'scripts\install-sillytavern-host-components.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'PINNED_HOST_COMPONENT_INSTALLER_MISSING' }

    & $installer -SillyTavernRoot $stRoot
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "INSTALLER_EXIT_CODE_$LASTEXITCODE" }

    Write-Host ''
    Write-Host 'PHASE2_HOST_COMPONENT_INSTALL_COMPLETE'
    Write-Host "SillyTavern: $stRoot"
    Write-Host "Pinned Logic-Engine source: $commit"
    Write-Host 'Existing Logic Engine and Final-Send were preserved.'
    Write-Host 'Restart only the isolated SillyTavern instance. Memory -> NPC remains disabled.'
}
finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
