param(
    [string]$SillyTavernRoot,
    [string]$CandidateRef = "integration/host-core-v1",
    [string]$CandidateCommit
)

# Isolated Windows deployment smoke test.
# Uses the real repository installer; never writes to the supplied SillyTavern source.
$ErrorActionPreference = "Stop"
$Repo = "https://github.com/necromorphic/Logic-Engine.git"
$PinnedStCommit = "06bde939fb1e9c4c8d8641d810f0a916b5bce127"
$TempRoot = Join-Path $env:TEMP ("LogicEngine-ST-Test-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$TestSt = Join-Path $TempRoot "SillyTavern"
$LogicRepo = Join-Path $TempRoot "Logic-Engine"

function Stop-WithCode([string]$Code) { throw $Code }
function Invoke-Native([string]$Command, [string[]]$Arguments, [string]$FailureCode) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { Stop-WithCode ($FailureCode + "_" + $LASTEXITCODE) }
}

Write-Host "=== Logic-Engine isolated Windows deployment smoke test ===" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($SillyTavernRoot)) {
    $SillyTavernRoot = Read-Host "Path to the EXTRACTED, CLEAN SillyTavern 1.19.0 release folder"
}
if (-not (Test-Path -LiteralPath $SillyTavernRoot -PathType Container)) {
    Stop-WithCode "SILLYTAVERN_SOURCE_DIRECTORY_NOT_FOUND"
}
$SourceSt = (Resolve-Path -LiteralPath $SillyTavernRoot).Path
$packagePath = Join-Path $SourceSt "package.json"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    Stop-WithCode "SILLYTAVERN_PACKAGE_JSON_NOT_FOUND"
}
$packageData = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($packageData.version -ne "1.19.0") {
    Stop-WithCode ("SILLYTAVERN_VERSION_UNSUPPORTED_" + $packageData.version)
}
if (-not (Test-Path -LiteralPath (Join-Path $SourceSt "src/plugin-loader.js") -PathType Leaf)) {
    Stop-WithCode "SILLYTAVERN_PLUGIN_LOADER_NOT_FOUND"
}
if (-not (Test-Path -LiteralPath (Join-Path $SourceSt "package-lock.json") -PathType Leaf)) {
    Stop-WithCode "SILLYTAVERN_PACKAGE_LOCK_MISSING"
}

$nodeCommand = Get-Command "node" -ErrorAction SilentlyContinue
$gitCommand = Get-Command "git" -ErrorAction SilentlyContinue
$npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if (-not $nodeCommand) { Stop-WithCode "NODE_NOT_AVAILABLE" }
if (-not $gitCommand) { Stop-WithCode "GIT_NOT_AVAILABLE" }
if (-not $npmCommand) { Stop-WithCode "NPM_CMD_NOT_AVAILABLE" }

$nodeVersionText = (& node --version).Trim().TrimStart("v")
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]"22.13.0") {
    Stop-WithCode ("NODE_VERSION_UNSUPPORTED_" + $nodeVersionText)
}
Invoke-Native $npmCommand.Source @("ping", "--fetch-retries=0", "--fetch-timeout=10000") "NPM_REGISTRY_UNAVAILABLE"
Invoke-Native "git" @("ls-remote", "--exit-code", $Repo, "refs/heads/" + $CandidateRef) "LOGIC_ENGINE_GITHUB_UNAVAILABLE"
Invoke-Native "git" @("ls-remote", "--exit-code", "https://github.com/SillyTavern/SillyTavern.git", "HEAD") "SILLYTAVERN_GITHUB_UNAVAILABLE"

# This runner must start from the clean release archive, not a daily ST profile.
# The production installer deliberately rejects unrelated server/browser extensions.
$pluginRoot = Join-Path $SourceSt "plugins"
if (Test-Path -LiteralPath $pluginRoot -PathType Container) {
    $existingPlugins = @(Get-ChildItem -LiteralPath $pluginRoot -Force)
    if ($existingPlugins.Count -gt 0) {
        Stop-WithCode "SILLYTAVERN_SOURCE_HAS_EXISTING_SERVER_PLUGINS_USE_CLEAN_RELEASE"
    }
}
$thirdPartyRoot = Join-Path $SourceSt "public/scripts/extensions/third-party"
if (Test-Path -LiteralPath $thirdPartyRoot -PathType Container) {
    $existingExtensions = @(Get-ChildItem -LiteralPath $thirdPartyRoot -Force)
    $unexpectedExtensions = @($existingExtensions | Where-Object { $_.Name -notin @(".gitkeep", "package.json") })
    if ($unexpectedExtensions.Count -gt 0) {
        Stop-WithCode "SILLYTAVERN_SOURCE_HAS_EXISTING_THIRD_PARTY_EXTENSIONS_USE_CLEAN_RELEASE"
    }
}

# Refuse a source tree that is currently being modified by a running ST process.
$nodeProcesses = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
foreach ($processItem in $nodeProcesses) {
    $commandLine = [string]$processItem.CommandLine
    if ($commandLine -and $commandLine.IndexOf($SourceSt, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-WithCode "SILLYTAVERN_SOURCE_IS_RUNNING_CLOSE_IT_AND_RETRY"
    }
}

New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
Write-Host ("Source SillyTavern: " + $SourceSt)
Write-Host ("Isolated test directory: " + $TempRoot)

if ([string]::IsNullOrWhiteSpace($CandidateCommit)) {
    Invoke-Native "git" @("clone", "--depth", "1", "--branch", $CandidateRef, "--single-branch", $Repo, $LogicRepo) "LOGIC_ENGINE_CLONE_FAILED"
} else {
    Invoke-Native "git" @("clone", "--no-checkout", $Repo, $LogicRepo) "LOGIC_ENGINE_CLONE_FAILED"
    Invoke-Native "git" @("-C", $LogicRepo, "fetch", "--depth=1", "origin", $CandidateCommit) "CANDIDATE_FETCH_FAILED"
    Invoke-Native "git" @("-C", $LogicRepo, "checkout", "--detach", "FETCH_HEAD") "CANDIDATE_CHECKOUT_FAILED"
}
$actualCommit = (git -C $LogicRepo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -notmatch "^[0-9a-f]{40}$") {
    Stop-WithCode "CANDIDATE_COMMIT_RESOLUTION_FAILED"
}
if (-not [string]::IsNullOrWhiteSpace($CandidateCommit) -and $actualCommit -ne $CandidateCommit) {
    Stop-WithCode ("WRONG_CANDIDATE_COMMIT_" + $actualCommit)
}

# Copy the clean release. The source folder remains untouched.
$copyArgs = @($SourceSt, $TestSt, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NP")
$copyArgs += @("/XD", (Join-Path $SourceSt ".git"), (Join-Path $SourceSt "node_modules"), (Join-Path $SourceSt "coverage"), (Join-Path $SourceSt "logs"), (Join-Path $SourceSt "temp"))
& robocopy @copyArgs
$copyCode = $LASTEXITCODE
if ($copyCode -ge 8) { Stop-WithCode ("SILLYTAVERN_COPY_FAILED_" + $copyCode) }

# SillyTavern's committed lockfile makes its dependency install reproducible.
Push-Location $TestSt
try {
    Invoke-Native $npmCommand.Source @("ci", "--no-audit", "--no-fund") "SILLYTAVERN_DEPENDENCY_INSTALL_FAILED"
} finally {
    Pop-Location
}

# Run the exact installer intended for deployment. This installs the root plugin,
# managed Final-Send patch, Host Gateway plugin, browser extension and Host patches.
$installer = Join-Path $LogicRepo "scripts/install-sillytavern-host-plugin.ps1"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    Stop-WithCode "CANONICAL_HOST_INSTALLER_NOT_FOUND"
}
& $installer -SillyTavernRoot $TestSt
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    Stop-WithCode ("CANONICAL_HOST_INSTALLER_FAILED_" + $LASTEXITCODE)
}

$requiredPaths = @(
    (Join-Path $TestSt "plugins/logic-engine/index.mjs"),
    (Join-Path $TestSt "plugins/logic-engine-extension-gateway/index.mjs"),
    (Join-Path $TestSt "plugins/logic-engine-extension-gateway/pinned-source-manifest.json"),
    (Join-Path $TestSt "public/scripts/extensions/third-party/logic-engine-extension-gateway/index.js")
)
foreach ($requiredPath in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        Stop-WithCode ("INSTALL_OUTPUT_MISSING_" + $requiredPath)
    }
}

$configPath = Join-Path $TestSt "config.yaml"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    $templatePath = Join-Path $TestSt "default/config.yaml"
    if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) { Stop-WithCode "TEMP_CONFIG_TEMPLATE_NOT_FOUND" }
    Copy-Item -LiteralPath $templatePath -Destination $configPath
}
$configText = Get-Content -LiteralPath $configPath -Raw
$newline = [Environment]::NewLine
foreach ($setting in @(
    @{ Name = "enableServerPlugins"; Value = "true" },
    @{ Name = "enableServerPluginsAutoUpdate"; Value = "false" }
)) {
    $pattern = "(?m)^" + [regex]::Escape($setting.Name) + "\s*:.*$"
    if ($configText -match $pattern) {
        $configText = [regex]::Replace($configText, $pattern, ($setting.Name + ": " + $setting.Value))
    } else {
        $configText += $newline + $setting.Name + ": " + $setting.Value
    }
}
Set-Content -LiteralPath $configPath -Value $configText -Encoding UTF8

$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

# This is an installation/native-generation smoke test, not Memory -> NPC acceptance.
# Host inventory/Core authority stays NON_READY until a separately configured Core is started.
$environmentNames = @(
    "LOGIC_ENGINE_MEMORY_NPC_ENABLED",
    "LOGIC_ENGINE_HOST_ACCEPTANCE_MODE",
    "LOGIC_ENGINE_HOST_IDENTITY_DIR",
    "LOGIC_ENGINE_HOST_RECEIPT_DIR",
    "LOGIC_ENGINE_HOST_BUILD_SHA"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$env:LOGIC_ENGINE_MEMORY_NPC_ENABLED = "false"
$env:LOGIC_ENGINE_HOST_ACCEPTANCE_MODE = "LOCAL_LOOPBACK_ONLY"
$env:LOGIC_ENGINE_HOST_IDENTITY_DIR = Join-Path $TempRoot "host-identity"
$env:LOGIC_ENGINE_HOST_RECEIPT_DIR = Join-Path $TempRoot "host-receipts"
$env:LOGIC_ENGINE_HOST_BUILD_SHA = $PinnedStCommit

$infoLines = @(
    "TEMPORARY INSTALLATION SMOKE TEST",
    ("Logic-Engine commit: " + $actualCommit),
    ("SillyTavern pinned source commit: " + $PinnedStCommit),
    ("Temporary SillyTavern: " + $TestSt),
    ("Original SillyTavern source: " + $SourceSt),
    ("Local-only port: " + $port),
    "Memory -> NPC: disabled",
    "ST-VectorService: not required and not used by this test",
    "Host acceptance mode: LOCAL_LOOPBACK_ONLY (non-authoritative)",
    "Core API: not started by this smoke test; Root Inventory authority remains NON_READY",
    "The original SillyTavern source folder was not modified."
)
Set-Content -LiteralPath (Join-Path $TempRoot "TEST-INFO.txt") -Value $infoLines -Encoding UTF8

try {
    Write-Host ""
    Write-Host ("Starting isolated SillyTavern on 127.0.0.1:" + $port) -ForegroundColor Green
    Write-Host ("Candidate: " + $actualCommit)
    Write-Host "This checks plugin loading and ordinary native generation only."
    Write-Host "Do not expose this local acceptance server to LAN, VPN or the internet."
    Push-Location $TestSt
    try {
        node "server.js" --port $port
        if ($LASTEXITCODE -ne 0) { Stop-WithCode ("TEMP_ST_SERVER_EXITED_" + $LASTEXITCODE) }
    } finally {
        Pop-Location
    }
} finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}

Write-Host ""
Write-Host "Smoke test ended. Preserve the temporary directory and TEST-INFO.txt for diagnostics:"
Write-Host $TempRoot
