[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:8000',
    [ValidateRange(15,600)][int]$TimeoutSeconds = 120,
    [switch]$SkipGeneration,
    [switch]$ShowBrowser
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

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$tempRoot = Join-Path $env:TEMP ('LogicEngine-Browser-Acceptance-' + $runId)
$packageRoot = Join-Path $tempRoot 'playwright-runtime'
$reportRoot = Join-Path $tempRoot 'report'
$browsersRoot = Join-Path $tempRoot 'browsers'
New-Item -ItemType Directory -Path $packageRoot,$reportRoot,$browsersRoot -Force | Out-Null

$oldBrowserPath = [Environment]::GetEnvironmentVariable('PLAYWRIGHT_BROWSERS_PATH','Process')
$oldPackageJson = [Environment]::GetEnvironmentVariable('PLAYWRIGHT_PACKAGE_JSON','Process')
$oldBaseUrl = [Environment]::GetEnvironmentVariable('ST_BASE_URL','Process')
$oldReport = [Environment]::GetEnvironmentVariable('ST_ACCEPTANCE_REPORT_DIR','Process')
$oldTimeout = [Environment]::GetEnvironmentVariable('ST_ACCEPTANCE_TIMEOUT_MS','Process')
$oldSkip = [Environment]::GetEnvironmentVariable('ST_ACCEPTANCE_SKIP_GENERATION','Process')
$oldHeadless = [Environment]::GetEnvironmentVariable('ST_ACCEPTANCE_HEADLESS','Process')
$exitCode = 1

try {
    $parsed = [Uri]$BaseUrl
    if ($parsed.Scheme -notin @('http','https')) { throw 'BASE_URL_MUST_BE_HTTP_OR_HTTPS' }
    $env:PLAYWRIGHT_BROWSERS_PATH = $browsersRoot
    $env:PLAYWRIGHT_PACKAGE_JSON = Join-Path $packageRoot 'package.json'
    $env:ST_BASE_URL = $BaseUrl.TrimEnd('/')
    $env:ST_ACCEPTANCE_REPORT_DIR = $reportRoot
    $env:ST_ACCEPTANCE_TIMEOUT_MS = [string]($TimeoutSeconds * 1000)
    $env:ST_ACCEPTANCE_SKIP_GENERATION = if ($SkipGeneration) { '1' } else { '0' }
    $env:ST_ACCEPTANCE_HEADLESS = if ($ShowBrowser) { '0' } else { '1' }

    Write-Host '=== Logic Engine / SillyTavern Browser Acceptance ===' -ForegroundColor Cyan
    Write-Host ('Target: ' + $BaseUrl)
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

    $playwrightCli = Join-Path $packageRoot 'node_modules/playwright/cli.js'
    if (-not (Test-Path -LiteralPath $playwrightCli -PathType Leaf)) { throw 'PLAYWRIGHT_CLI_NOT_FOUND' }

    Write-Host 'Installing Chromium into the temporary acceptance directory...' -ForegroundColor Yellow
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $node.Source $playwrightCli install chromium 2>&1 |
            ForEach-Object { Write-Host ([string]$_) }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }
    if ($code -ne 0) { throw ('PLAYWRIGHT_CHROMIUM_INSTALL_FAILED_' + $code) }

    $runner = Join-Path $repoRoot 'scripts/acceptance/sillytavern-browser-acceptance.mjs'
    if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'BROWSER_ACCEPTANCE_RUNNER_MISSING' }
    Write-Host ''
    Write-Host 'Opening SillyTavern in an automated Chromium session...' -ForegroundColor Cyan
    $previousEap = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $node.Source $runner 2>&1 | ForEach-Object { Write-Host ([string]$_) }
        $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousEap }

    if ($null -eq $exitCode) { $exitCode = 0 }
    if ($exitCode -eq 0) {
        Write-Host 'RESULT: BROWSER ACCEPTANCE PASS' -ForegroundColor Green
    } elseif ($exitCode -eq 2) {
        Write-Host 'RESULT: INCOMPLETE — one or more checks were blocked by environment readiness.' -ForegroundColor Yellow
    } else {
        Write-Host 'RESULT: BROWSER ACCEPTANCE FAIL' -ForegroundColor Red
    }
} catch {
    Write-Host ('[FAIL] ' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    [Environment]::SetEnvironmentVariable('PLAYWRIGHT_BROWSERS_PATH',$oldBrowserPath,'Process')
    [Environment]::SetEnvironmentVariable('PLAYWRIGHT_PACKAGE_JSON',$oldPackageJson,'Process')
    [Environment]::SetEnvironmentVariable('ST_BASE_URL',$oldBaseUrl,'Process')
    [Environment]::SetEnvironmentVariable('ST_ACCEPTANCE_REPORT_DIR',$oldReport,'Process')
    [Environment]::SetEnvironmentVariable('ST_ACCEPTANCE_TIMEOUT_MS',$oldTimeout,'Process')
    [Environment]::SetEnvironmentVariable('ST_ACCEPTANCE_SKIP_GENERATION',$oldSkip,'Process')
    [Environment]::SetEnvironmentVariable('ST_ACCEPTANCE_HEADLESS',$oldHeadless,'Process')
    Write-Host ''
    Write-Host ('Report directory: ' + $reportRoot) -ForegroundColor Cyan
    Write-Host ('Elapsed: {0:N1} minutes' -f ((Get-Date)-$started).TotalMinutes)
}
exit $exitCode
