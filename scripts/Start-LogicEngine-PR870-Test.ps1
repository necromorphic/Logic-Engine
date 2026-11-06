# Isolated Logic-Engine PR 870 smoke-test launcher.
# ASCII-only, Windows PowerShell 5.1 compatible. Original ST and VectorService are not modified.
$ErrorActionPreference = "Stop"

$Commit = "928eb5625ea17c1febb403824bfc622a0065d7b6"
$Repo = "https://github.com/necromorphic/Logic-Engine.git"
$TempRoot = Join-Path $env:TEMP ("LogicEngine-ST-Test-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$TestSt = Join-Path $TempRoot "SillyTavern"
$LogicRepo = Join-Path $TempRoot "Logic-Engine"

Write-Host "=== Logic-Engine PR 870 isolated test ===" -ForegroundColor Cyan

$SourceSt = ""
$nodeProcesses = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
foreach ($processItem in $nodeProcesses) {
    $commandLine = [string]$processItem.CommandLine
    if ($commandLine -match "(?i)([A-Z]:\\.*?SillyTavern)\\server\.js") {
        $candidate = $Matches[1]
        if (Test-Path (Join-Path $candidate "package.json")) {
            $SourceSt = (Resolve-Path $candidate).Path
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($SourceSt)) {
    $SourceSt = Read-Host "Enter the full path to your running SillyTavern 1.19.0 folder"
    if (-not (Test-Path (Join-Path $SourceSt "package.json"))) {
        throw "ST_ROOT_NOT_FOUND"
    }
    $SourceSt = (Resolve-Path $SourceSt).Path
}

$packagePath = Join-Path $SourceSt "package.json"
$packageData = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($packageData.version -ne "1.19.0") {
    throw ("EXPECTED_ST_1_19_0_FOUND_" + $packageData.version)
}
if (-not (Test-Path (Join-Path $SourceSt "src/plugin-loader.js"))) {
    throw "ST_PLUGIN_LOADER_NOT_FOUND"
}
if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
    throw "GIT_REQUIRED"
}
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    throw "NODE_REQUIRED"
}
$nodeVersionText = (node --version).TrimStart("v")
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]"22.13.0") {
    throw ("NODE_VERSION_TOO_OLD_" + $nodeVersionText)
}

New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
Write-Host ("Original ST: " + $SourceSt)
Write-Host ("Temporary test folder: " + $TempRoot)
Read-Host "Close the original SillyTavern window. Keep ST-VectorService running. Press Enter to continue"

git clone --no-checkout $Repo $LogicRepo
if ($LASTEXITCODE -ne 0) { throw "GIT_CLONE_FAILED" }
git -C $LogicRepo checkout --detach $Commit
if ($LASTEXITCODE -ne 0) { throw "CANDIDATE_CHECKOUT_FAILED" }
$actualCommit = (git -C $LogicRepo rev-parse HEAD).Trim()
if ($actualCommit -ne $Commit) { throw ("WRONG_COMMIT_" + $actualCommit) }

$excludePaths = @(
    (Join-Path $SourceSt ".git"),
    (Join-Path $SourceSt "node_modules"),
    (Join-Path $SourceSt "coverage"),
    (Join-Path $SourceSt "logs"),
    (Join-Path $SourceSt "temp")
)
$copyArgs = @($SourceSt, $TestSt, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NP")
foreach ($excludePath in $excludePaths) { $copyArgs += @("/XD", $excludePath) }
& robocopy @copyArgs
$copyCode = $LASTEXITCODE
if ($copyCode -ge 8) { throw ("ST_COPY_FAILED_" + $copyCode) }

Push-Location $TestSt
npm install --no-audit --no-fund
$npmCode = $LASTEXITCODE
Pop-Location
if ($npmCode -ne 0) { throw "TEMP_ST_NPM_INSTALL_FAILED" }

$pluginPath = Join-Path $TestSt "plugins/logic-engine"
$gatewayPath = Join-Path $TestSt "plugins/logic-engine-extension-gateway"
if (Test-Path $pluginPath) { throw "TEMP_PLUGIN_PATH_ALREADY_EXISTS" }
New-Item -ItemType Directory -Path (Split-Path $pluginPath) -Force | Out-Null

$pluginCopyArgs = @(
    $LogicRepo, $pluginPath, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NP",
    "/XD", (Join-Path $LogicRepo ".git"),
    (Join-Path $LogicRepo "node_modules"),
    (Join-Path $LogicRepo "tests"),
    (Join-Path $LogicRepo "coverage")
)
& robocopy @pluginCopyArgs
$pluginCopyCode = $LASTEXITCODE
if ($pluginCopyCode -ge 8) { throw ("PLUGIN_COPY_FAILED_" + $pluginCopyCode) }

if (Test-Path $gatewayPath) {
    Remove-Item -LiteralPath $gatewayPath -Recurse -Force
}
$gatewaySource = Join-Path $LogicRepo "host-adapter/extension-gateway/server-plugin"
if (-not (Test-Path (Join-Path $gatewaySource "index.mjs"))) {
    throw "HOST_GATEWAY_SOURCE_NOT_FOUND"
}
$gatewayCopyArgs = @($gatewaySource, $gatewayPath, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NP")
& robocopy @gatewayCopyArgs
$gatewayCopyCode = $LASTEXITCODE
if ($gatewayCopyCode -ge 8) { throw ("GATEWAY_COPY_FAILED_" + $gatewayCopyCode) }

Push-Location $pluginPath
npm install --omit=dev --no-audit --no-fund
$pluginNpmCode = $LASTEXITCODE
if ($pluginNpmCode -eq 0) {
    node "scripts/sillytavern-patch-manager.mjs" preflight --st-root $TestSt --extension-root $pluginPath
    $preflightCode = $LASTEXITCODE
} else {
    $preflightCode = 1
}
if ($preflightCode -eq 0) {
    node "scripts/sillytavern-patch-manager.mjs" install --st-root $TestSt --extension-root $pluginPath
    $installCode = $LASTEXITCODE
} else {
    $installCode = 1
}
if ($installCode -eq 0) {
    node "scripts/sillytavern-patch-manager.mjs" verify --st-root $TestSt --extension-root $pluginPath
    $verifyCode = $LASTEXITCODE
} else {
    $verifyCode = 1
}
Pop-Location
if ($pluginNpmCode -ne 0) { throw "PLUGIN_DEPENDENCY_INSTALL_FAILED" }
if ($preflightCode -ne 0) { throw "PATCH_PREFLIGHT_FAILED" }
if ($installCode -ne 0) { throw "PATCH_INSTALL_FAILED" }
if ($verifyCode -ne 0) { throw "PATCH_VERIFY_FAILED" }

$configPath = Join-Path $TestSt "config.yaml"
if (-not (Test-Path $configPath)) {
    $templatePath = Join-Path $TestSt "default/config.yaml"
    if (-not (Test-Path $templatePath)) { throw "TEMP_CONFIG_TEMPLATE_NOT_FOUND" }
    Copy-Item -LiteralPath $templatePath -Destination $configPath
}
$configText = Get-Content -LiteralPath $configPath -Raw
$newline = [Environment]::NewLine
if ($configText -match "(?m)^enableServerPlugins\s*:") {
    $configText = [regex]::Replace($configText, "(?m)^enableServerPlugins\s*:.*$", "enableServerPlugins: true")
} else {
    $configText = $configText + $newline + "enableServerPlugins: true" + $newline
}
if ($configText -match "(?m)^enableServerPluginsAutoUpdate\s*:") {
    $configText = [regex]::Replace($configText, "(?m)^enableServerPluginsAutoUpdate\s*:.*$", "enableServerPluginsAutoUpdate: false")
} else {
    $configText = $configText + "enableServerPluginsAutoUpdate: false" + $newline
}
Set-Content -LiteralPath $configPath -Value $configText -Encoding UTF8

$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$env:LOGIC_ENGINE_MEMORY_NPC_ENABLED = "false"
$env:LOGIC_ENGINE_HOST_IDENTITY_DIR = Join-Path $TempRoot "host-identity"
$env:LOGIC_ENGINE_HOST_BUILD_SHA = $Commit
$env:LOGIC_ENGINE_SILLYTAVERN_ROOT = $TestSt

$infoLines = @(
    "TEMPORARY TEST READY"
    ("Candidate commit: " + $actualCommit)
    ("Temporary ST: " + $TestSt)
    ("Original ST: " + $SourceSt)
    ("Temporary port: " + $port)
    "ST-VectorService: not modified"
    "Vectorization patch: unchanged"
    "Memory to NPC: disabled"
    "Gateway: installed as a separate server plugin"
)
Set-Content -LiteralPath (Join-Path $TempRoot "TEST-INFO.txt") -Value $infoLines -Encoding UTF8

Write-Host ""
Write-Host ("Starting TEMPORARY SillyTavern on port " + $port) -ForegroundColor Green
Write-Host "Original SillyTavern and ST-VectorService are not modified."
Push-Location $TestSt
node "server.js" --port $port
$serverCode = $LASTEXITCODE
Pop-Location
if ($serverCode -ne 0) { throw ("TEMP_ST_SERVER_EXITED_" + $serverCode) }

Write-Host ("After stopping the server, the temporary folder can be deleted: " + $TempRoot)
