# Temporary, isolated Logic-Engine PR #870 smoke-test deployment.
# Does NOT modify the original SillyTavern folder or ST-VectorService.
$ErrorActionPreference = 'Stop'
$Commit = '875ce7c3573c71886f61239cfe95ecb73e22bd64'
$Repo = 'https://github.com/necromorphic/Logic-Engine.git'
$TempRoot = Join-Path $env:TEMP ("LogicEngine-ST-Test-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$TestSt = Join-Path $TempRoot 'SillyTavern'
$LogicRepo = Join-Path $TempRoot 'Logic-Engine'

function Find-StRoot {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        if ($proc.CommandLine -match '(?i)([A-Z]:\\[^"]*?SillyTavern[^"]*?)\\server\.js') {
            $candidate = $Matches[1]
            if (Test-Path (Join-Path $candidate 'package.json')) { return (Resolve-Path $candidate).Path }
        }
    }
    $entered = Read-Host 'Не удалось определить путь автоматически. Введи путь к папке работающей SillyTavern 1.19.0'
    if (-not (Test-Path (Join-Path $entered 'package.json'))) { throw 'ST_ROOT_NOT_FOUND' }
    return (Resolve-Path $entered).Path
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    return $port
}

Write-Host '=== Logic-Engine PR #870 isolated smoke-test setup ===' -ForegroundColor Cyan
$SourceSt = Find-StRoot
$pkg = Get-Content (Join-Path $SourceSt 'package.json') -Raw | ConvertFrom-Json
if ($pkg.version -ne '1.19.0') { throw "Expected SillyTavern 1.19.0; found $($pkg.version). Nothing changed." }
if (-not (Test-Path (Join-Path $SourceSt 'src/plugin-loader.js'))) { throw 'ST_PLUGIN_LOADER_NOT_FOUND' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
$nodeVer = [version]((node --version).TrimStart('v'))
if ($nodeVer -lt [version]'22.13.0') { throw "Node >=22.13.0 required; found $nodeVer" }

New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
Write-Host "Source ST: $SourceSt"
Write-Host "Temporary test root: $TempRoot"
Read-Host 'Закрой окно SillyTavern (ST-VectorService не закрывай), затем нажми Enter для создания согласованной копии'

git clone --no-checkout $Repo $LogicRepo
if ($LASTEXITCODE -ne 0) { throw 'GIT_CLONE_FAILED' }
git -C $LogicRepo checkout --detach $Commit
if ($LASTEXITCODE -ne 0) { throw 'CANDIDATE_CHECKOUT_FAILED' }
$actual = (git -C $LogicRepo rev-parse HEAD).Trim()
if ($actual -ne $Commit) { throw "WRONG_COMMIT: $actual" }

$excludeDirs = @('.git', 'node_modules', 'coverage', 'logs', 'temp')
$robocopyArgs = @($SourceSt, $TestSt, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NP')
foreach ($d in $excludeDirs) { $robocopyArgs += @('/XD', (Join-Path $SourceSt $d)) }
& robocopy @robocopyArgs
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "ST_COPY_FAILED_ROBOCOPY_$rc" }

Push-Location $TestSt
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'TEMP_ST_NPM_INSTALL_FAILED' }
} finally { Pop-Location }

$pluginPath = Join-Path $TestSt 'plugins\logic-engine'
if (Test-Path $pluginPath) { throw 'TEMP_PLUGIN_PATH_ALREADY_EXISTS' }
New-Item -ItemType Directory -Path (Split-Path $pluginPath) -Force | Out-Null
$copyArgs = @($LogicRepo, $pluginPath, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',
              '/XD', (Join-Path $LogicRepo '.git'), (Join-Path $LogicRepo 'node_modules'),
              (Join-Path $LogicRepo 'tests'), (Join-Path $LogicRepo 'coverage'))
& robocopy @copyArgs
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "PLUGIN_COPY_FAILED_ROBOCOPY_$rc" }

Push-Location $pluginPath
try {
    npm install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'PLUGIN_DEPENDENCY_INSTALL_FAILED' }
    node 'scripts/sillytavern-patch-manager.mjs' preflight --st-root $TestSt --extension-root $pluginPath
    if ($LASTEXITCODE -ne 0) { throw 'PATCH_PREFLIGHT_FAILED' }
    node 'scripts/sillytavern-patch-manager.mjs' install --st-root $TestSt --extension-root $pluginPath
    if ($LASTEXITCODE -ne 0) { throw 'PATCH_INSTALL_FAILED' }
    node 'scripts/sillytavern-patch-manager.mjs' verify --st-root $TestSt --extension-root $pluginPath
    if ($LASTEXITCODE -ne 0) { throw 'PATCH_VERIFY_FAILED' }
} finally { Pop-Location }

$configPath = Join-Path $TestSt 'config.yaml'
if (-not (Test-Path $configPath)) {
    $templatePath = Join-Path $TestSt 'default\config.yaml'
    if (-not (Test-Path $templatePath)) { throw 'TEMP_CONFIG_TEMPLATE_NOT_FOUND' }
    Copy-Item -LiteralPath $templatePath -Destination $configPath
}
$config = Get-Content $configPath -Raw
$newline = [Environment]::NewLine
if ($config -match '(?m)^enableServerPlugins\s*:') {
    $config = [regex]::Replace($config, '(?m)^enableServerPlugins\s*:.*$', 'enableServerPlugins: true')
} else { $config += $newline + 'enableServerPlugins: true' + $newline }
if ($config -match '(?m)^enableServerPluginsAutoUpdate\s*:') {
    $config = [regex]::Replace($config, '(?m)^enableServerPluginsAutoUpdate\s*:.*$', 'enableServerPluginsAutoUpdate: false')
} else { $config += 'enableServerPluginsAutoUpdate: false' + $newline }
Set-Content -Path $configPath -Value $config -Encoding UTF8

$port = Get-FreePort
$env:LOGIC_ENGINE_MEMORY_NPC_ENABLED = 'false'
$env:LOGIC_ENGINE_HOST_IDENTITY_DIR = Join-Path $TempRoot 'host-identity'
$env:LOGIC_ENGINE_HOST_BUILD_SHA = $Commit
$env:LOGIC_ENGINE_SILLYTAVERN_ROOT = $TestSt

$testInfoLines = @(
    'TEMPORARY TEST READY'
    "Candidate commit: $actual"
    "Test SillyTavern: $TestSt"
    "Original SillyTavern: $SourceSt"
    "Temporary port: $port"
    'ST-VectorService: NOT MODIFIED; existing endpoint/settings copied as-is.'
    'Vectorization patch: NOT ENABLED OR MODIFIED.'
    'Memory -> NPC: DISABLED.'
)
$testInfoPath = Join-Path $TempRoot 'TEST-INFO.txt'
Set-Content -LiteralPath $testInfoPath -Value $testInfoLines -Encoding UTF8

Write-Host ''
Write-Host "Setup complete. Starting the TEMPORARY SillyTavern on port $port." -ForegroundColor Green
Write-Host 'The original SillyTavern process and ST-VectorService are not stopped or modified.'
Write-Host 'Use the browser URL printed by SillyTavern. Test in a NEW chat only.'
Push-Location $TestSt
try {
    & node (Join-Path $TestSt 'server.js') --port $port
} finally { Pop-Location }

Write-Host "To remove the test copy after stopping it, delete only: $TempRoot"
