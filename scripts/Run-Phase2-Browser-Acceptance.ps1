[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:60619',
    [ValidateRange(15,600)][int]$TimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$started = Get-Date
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) { throw 'Node.js and npm.cmd are required.' }

try { $parsed = [Uri]$BaseUrl } catch { throw 'BASE_URL_INVALID' }
if ($parsed.Scheme -notin @('http','https')) { throw 'BASE_URL_MUST_BE_HTTP_OR_HTTPS' }

if (@(Get-Process -Name msedge -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Host '[BLOCKED] Close all Edge windows first. The test launches Edge itself with your existing profile.' -ForegroundColor Yellow
    exit 2
}

$edgeCandidates = @()
if ($env:ProgramFiles) { $edgeCandidates += Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
if ($programFilesX86) { $edgeCandidates += Join-Path $programFilesX86 'Microsoft\Edge\Application\msedge.exe' }
if ($env:LOCALAPPDATA) { $edgeCandidates += Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe' }
$edgeCandidates = @($edgeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
if ($edgeCandidates.Count -eq 0) { throw 'MICROSOFT_EDGE_EXECUTABLE_NOT_FOUND' }
$edgeExe = $edgeCandidates[0]

$profileDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data'
if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) { throw 'EDGE_USER_PROFILE_NOT_FOUND' }

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRoot = Join-Path $env:TEMP ('LogicEngine-Browser-Acceptance-' + $runId)
$packageRoot = Join-Path $tempRoot 'playwright-runtime'
$reportRoot = Join-Path $tempRoot 'report'
New-Item -ItemType Directory -Path $packageRoot,$reportRoot -Force | Out-Null

$names = @('PLAYWRIGHT_PACKAGE_JSON','ST_BASE_URL','ST_ACCEPTANCE_REPORT_DIR','ST_ACCEPTANCE_TIMEOUT_MS','ST_EDGE_PROFILE_DIR','ST_EDGE_EXECUTABLE')
$old = @{}
foreach ($name in $names) { $old[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$exitCode = 1

try {
    $env:PLAYWRIGHT_PACKAGE_JSON = Join-Path $packageRoot 'package.json'
    $env:ST_BASE_URL = $BaseUrl.TrimEnd('/')
    $env:ST_ACCEPTANCE_REPORT_DIR = $reportRoot
    $env:ST_ACCEPTANCE_TIMEOUT_MS = [string]($TimeoutSeconds * 1000)
    $env:ST_EDGE_PROFILE_DIR = $profileDir
    $env:ST_EDGE_EXECUTABLE = $edgeExe

    Write-Host '=== Logic Engine / SillyTavern Browser Acceptance ===' -ForegroundColor Cyan
    Write-Host ('Target: ' + $BaseUrl)
    Write-Host 'Browser: Edge with existing profile; no Remote Debugging or CDP.'
    Write-Host ('Diagnostics: ' + $tempRoot)
    Write-Host 'Installing isolated Playwright runtime...' -ForegroundColor Yellow

    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $npm.Source install --prefix $packageRoot --no-save --no-package-lock --no-audit --no-fund 'playwright@1.56.1' 2>&1 |
            ForEach-Object { Write-Host ([string]$_) }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }
    if ($code -ne 0) { throw ('PLAYWRIGHT_NPM_INSTALL_FAILED_' + $code) }

    $runner = Join-Path $repoRoot 'scripts/acceptance/sillytavern-browser-acceptance.mjs'
    if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'BROWSER_ACCEPTANCE_RUNNER_MISSING' }

    Write-Host ''
    Write-Host 'Starting Edge and opening SillyTavern...' -ForegroundColor Cyan
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
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$old[$name],'Process') }
    Write-Host ''
    Write-Host ('Report directory: ' + $reportRoot) -ForegroundColor Cyan
    Write-Host ('Elapsed: {0:N1} minutes' -f ((Get-Date)-$started).TotalMinutes)
}
exit $exitCode
