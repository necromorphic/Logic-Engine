[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:8000',
    [ValidateRange(15,600)][int]$TimeoutSeconds = 120,
    [switch]$SkipGeneration
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$started = Get-Date
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    Write-Host '[FAIL] Node.js and npm.cmd are required.' -ForegroundColor Red
    exit 1
}

$parsed = [Uri]$BaseUrl
if ($parsed.Scheme -notin @('http','https')) { throw 'BASE_URL_MUST_BE_HTTP_OR_HTTPS' }
$edgeProcesses = @(Get-Process -Name msedge -ErrorAction SilentlyContinue)
if ($edgeProcesses.Count -gt 0) {
    Write-Host '[BLOCKED] Microsoft Edge is still running.' -ForegroundColor Yellow
    Write-Host 'Save any work and close every Edge window, then run this script again.'
    exit 2
}

$edgeCandidates = @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
if (-not $edgeCandidates) { throw 'MICROSOFT_EDGE_EXECUTABLE_NOT_FOUND' }
$edgeExe = $edgeCandidates[0]
$profileDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) { throw 'EDGE_USER_PROFILE_NOT_FOUND' }
$activePortFile = Join-Path $profileDir 'DevToolsActivePort'
if (Test-Path -LiteralPath $activePortFile) {
    Remove-Item -LiteralPath $activePortFile -Force
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRoot = Join-Path $env:TEMP ('LogicEngine-Browser-Acceptance-' + $runId)
$packageRoot = Join-Path $tempRoot 'playwright-runtime'
$reportRoot = Join-Path $tempRoot 'report'
New-Item -ItemType Directory -Path $packageRoot,$reportRoot -Force | Out-Null

$oldPackageJson = [Environment]::GetEnvironmentVariable('PLAYWRIGHT_PACKAGE_JSON','Process')
$oldBaseUrl = [Environment]::GetEnvironmentVariable('ST_BASE_URL','Process')
$oldReport = [Environment]::GetEnvironmentVariable('ST_ACCEPTANCE_REPORT_DIR','Process')
$oldTimeout = [Environment]::GetEnvironmentVariable('ST_ACCEPTANCE_TIMEOUT_MS','Process')
$oldSkip = [Environment]::GetEnvironmentVariable('ST_ACCEPTANCE_SKIP_GENERATION','Process')
$oldCdp = [Environment]::GetEnvironmentVariable('ST_EDGE_CDP_ENDPOINT','Process')
$exitCode = 1

try {
    $env:PLAYWRIGHT_PACKAGE_JSON = Join-Path $packageRoot 'package.json'
    $env:ST_BASE_URL = $BaseUrl.TrimEnd('/')
    $env:ST_ACCEPTANCE_REPORT_DIR = $reportRoot
    $env:ST_ACCEPTANCE_TIMEOUT_MS = [string]($TimeoutSeconds * 1000)
    $env:ST_ACCEPTANCE_SKIP_GENERATION = if ($SkipGeneration) { '1' } else { '0' }

    Write-Host '=== Logic Engine / SillyTavern Edge Browser Acceptance ===' -ForegroundColor Cyan
    Write-Host ('Target: ' + $BaseUrl)
    Write-Host ('Edge profile: ' + $profileDir)
    Write-Host ('Diagnostics: ' + $tempRoot)
    Write-Host 'Installing isolated Playwright runtime (no project package files are changed)...' -ForegroundColor Yellow

    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $npm.Source install --prefix $packageRoot --no-save --no-package-lock --no-audit --no-fund 'playwright@1.56.1' 2>&1 |
            ForEach-Object { Write-Host ([string]$_) }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }
    if ($code -ne 0) { throw ('PLAYWRIGHT_NPM_INSTALL_FAILED_' + $code) }

    Write-Host ''
    Write-Host 'Starting Microsoft Edge with your normal profile...' -ForegroundColor Cyan
    Start-Process -FilePath $edgeExe -ArgumentList @('--new-window','edge://inspect') | Out-Null
    Start-Sleep -Seconds 3
    Write-Host ''
    Write-Host 'In Edge: select "Remote debugging" on the left, then enable "Allow remote debugging for this browser instance".' -ForegroundColor Yellow
    Write-Host 'This uses Edge built-in remote-debugging permission; it does not copy your profile or expose a network interface.'
    [void](Read-Host 'After enabling remote debugging, press Enter to continue')

    $activePort = $null
    if (Test-Path -LiteralPath $activePortFile -PathType Leaf) {
        $portLines = Get-Content -LiteralPath $activePortFile -TotalCount 2
        if ($portLines.Count -ge 1 -and $portLines[0] -match '^\d+$') {
            $candidatePort = [int]$portLines[0]
            if ($candidatePort -ge 1024 -and $candidatePort -le 65535) { $activePort = $candidatePort }
        }
    }
    if (-not $activePort) {
        throw 'EDGE_REMOTE_DEBUGGING_NOT_ENABLED: enable the checkbox on edge://inspect and rerun'
    }
    $env:ST_EDGE_CDP_ENDPOINT = 'http://127.0.0.1:' + $activePort

    $runner = Join-Path $repoRoot 'scripts/acceptance/sillytavern-browser-acceptance.mjs'
    if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'BROWSER_ACCEPTANCE_RUNNER_MISSING' }
    Write-Host ''
    Write-Host 'Attaching Playwright to the existing Edge profile...' -ForegroundColor Cyan
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $node.Source $runner 2>&1 | ForEach-Object { Write-Host ([string]$_) }
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }

    if ($null -eq $exitCode) { $exitCode = 0 }
    if ($exitCode -eq 0) { Write-Host 'RESULT: BROWSER ACCEPTANCE PASS' -ForegroundColor Green }
    elseif ($exitCode -eq 2) { Write-Host 'RESULT: INCOMPLETE — one or more checks were blocked.' -ForegroundColor Yellow }
    else { Write-Host 'RESULT: BROWSER ACCEPTANCE FAIL' -ForegroundColor Red }
} catch {
    Write-Host ('[FAIL] ' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    [Environment]::SetEnvironmentVariable('PLAYWRIGHT_PACKAGE_JSON',$oldPackageJson,'Process')
    [Environment]::SetEnvironmentVariable('ST_BASE_URL',$oldBaseUrl,'Process')
    [Environment]::SetEnvironmentVariable('ST_ACCEPTANCE_REPORT_DIR',$oldReport,'Process')
    [Environment]::SetEnvironmentVariable('ST_ACCEPTANCE_TIMEOUT_MS',$oldTimeout,'Process')
    [Environment]::SetEnvironmentVariable('ST_ACCEPTANCE_SKIP_GENERATION',$oldSkip,'Process')
    [Environment]::SetEnvironmentVariable('ST_EDGE_CDP_ENDPOINT',$oldCdp,'Process')
    Write-Host ''
    Write-Host ('Edge remains open. Report directory: ' + $reportRoot) -ForegroundColor Cyan
    Write-Host ('Elapsed: {0:N1} minutes' -f ((Get-Date)-$started).TotalMinutes)
}
exit $exitCode
