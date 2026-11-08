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

# Copy application code only. Never copy profile data, user uploads, live config,
# credentials or local certificates from the supplied SillyTavern installation.
$templateConfig = Join-Path $SourceSt "default/config.yaml"
if (-not (Test-Path -LiteralPath $templateConfig -PathType Leaf)) {
    Stop-WithCode "SILLYTAVERN_DEFAULT_CONFIG_TEMPLATE_NOT_FOUND"
}
$copyArgs = @($SourceSt, $TestSt, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NP")
$copyArgs += @(
    "/XD",
    (Join-Path $SourceSt ".git"),
    (Join-Path $SourceSt "node_modules"),
    (Join-Path $SourceSt "coverage"),
    (Join-Path $SourceSt "logs"),
    (Join-Path $SourceSt "temp"),
    (Join-Path $SourceSt "data"),
    (Join-Path $SourceSt "public/user")
)
$copyArgs += @(
    "/XF",
    "config.yaml",
    ".env",
    ".env.*",
    ".npmrc",
    "cookie-secret.txt",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx"
)
& robocopy @copyArgs
$copyCode = $LASTEXITCODE
if ($copyCode -ge 8) { Stop-WithCode ("SILLYTAVERN_COPY_FAILED_" + $copyCode) }

# Robocopy excludes config.yaml at every depth. Restore only the release template,
# never the user's live config.yaml, and use it for both ST's default and root config.
$testDefaultDirectory = Join-Path $TestSt "default"
New-Item -ItemType Directory -Path $testDefaultDirectory -Force | Out-Null
Copy-Item -LiteralPath $templateConfig -Destination (Join-Path $testDefaultDirectory "config.yaml") -Force
Copy-Item -LiteralPath $templateConfig -Destination (Join-Path $TestSt "config.yaml") -Force
if (Test-Path -LiteralPath (Join-Path $TestSt "data")) {
    Stop-WithCode "ISOLATION_FAILURE_SOURCE_DATA_WAS_COPIED"
}
if (Test-Path -LiteralPath (Join-Path $TestSt "public/user")) {
    Stop-WithCode "ISOLATION_FAILURE_SOURCE_USER_UPLOADS_WERE_COPIED"
}

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

# Prepare a disposable local Core authority for the same Host identity that SillyTavern will use.
# The local acceptance switch remains explicitly non-authoritative for uncovered mutation routes.
$CoreData = Join-Path $TempRoot "core-data"
$dataRoot = Join-Path $TestSt "data"
$userRoot = Join-Path $dataRoot "default-user"
$identityDirectory = Join-Path $TempRoot "host-identity"
$receiptDirectory = Join-Path $TempRoot "host-receipts"
New-Item -ItemType Directory -Path $CoreData, $userRoot, (Join-Path $userRoot "chats"), (Join-Path $userRoot "groups"), (Join-Path $userRoot "group chats"), (Join-Path $userRoot "extensions"), $identityDirectory, $receiptDirectory -Force | Out-Null

function New-TestSecret {
    $bytes = New-Object byte[] 48
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
function Get-FreeLoopbackPort {
    $tcp = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $tcp.Start()
    try { return ([System.Net.IPEndPoint]$tcp.LocalEndpoint).Port } finally { $tcp.Stop() }
}

$adapterId = "sillytavern-local-acceptance"
$apiToken = New-TestSecret
$adapterToken = New-TestSecret
$corePort = Get-FreeLoopbackPort
$stPort = Get-FreeLoopbackPort

$bootstrapScript = Join-Path $LogicRepo "scripts/bootstrap-windows-host-acceptance.mjs"
if (-not (Test-Path -LiteralPath $bootstrapScript -PathType Leaf)) {
    Stop-WithCode "HOST_ACCEPTANCE_BOOTSTRAP_NOT_FOUND"
}
$bootstrapOutput = & node $bootstrapScript $TestSt $dataRoot $identityDirectory "default-user" $adapterId
if ($LASTEXITCODE -ne 0) { Stop-WithCode "HOST_ACCEPTANCE_IDENTITY_BOOTSTRAP_FAILED" }
try {
    $bootstrap = ($bootstrapOutput -join [Environment]::NewLine) | ConvertFrom-Json
} catch {
    Stop-WithCode "HOST_ACCEPTANCE_IDENTITY_BOOTSTRAP_INVALID_JSON"
}
if ($bootstrap.status -ne "LOCAL_HOST_ACCEPTANCE_IDENTITY_PREPARED" -or -not $bootstrap.registry) {
    Stop-WithCode "HOST_ACCEPTANCE_IDENTITY_BOOTSTRAP_NOT_READY"
}
$registryJson = ConvertTo-Json -InputObject @($bootstrap.registry) -Depth 8 -Compress
$adapterTokensJson = ConvertTo-Json -InputObject @{ $adapterId = $adapterToken } -Depth 4 -Compress

$worldPackDirectory = Join-Path $CoreData "world-packs"
New-Item -ItemType Directory -Path $worldPackDirectory -Force | Out-Null
$artifactPath = Join-Path $worldPackDirectory "local-acceptance-pack.json"
$artifactJson = '{"world_pack_id":"local-acceptance-pack","version":"1.0.0"}'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($artifactPath, $artifactJson, $utf8NoBom)
$artifactHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
$catalogPath = Join-Path $worldPackDirectory "catalog.json"
$catalog = @{
    schema_version = 1
    entries = @(@{
        world_pack_id = "local-acceptance-pack"
        version = "1.0.0"
        artifact_path = "local-acceptance-pack.json"
        sha256 = $artifactHash
    })
}
$catalogJson = ConvertTo-Json -InputObject $catalog -Depth 8 -Compress
[System.IO.File]::WriteAllText($catalogPath, $catalogJson, $utf8NoBom)

$coreEnvironmentNames = @(
    "ENGINE_API_TOKEN",
    "ENGINE_ADAPTER_TOKENS",
    "ENGINE_DB_PATH",
    "LOGIC_ENGINE_COORDINATOR_DB_PATH",
    "ENGINE_HOST_VERSION_LEDGER_DB_PATH",
    "ENGINE_HOST_ASSERTION_NONCE_DB_PATH",
    "ENGINE_HOST_LIFECYCLE_DB_PATH",
    "ENGINE_HOST_ROOT_IDENTITIES",
    "ENGINE_HOST_AUTHORITY_ID",
    "ENGINE_HOST_AUTHORITY_GENERATION",
    "LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH",
    "ENGINE_HOST",
    "ENGINE_PORT",
    "ENGINE_ALLOW_REMOTE",
    "ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES",
    "LOGIC_ENGINE_CORE_URL",
    "LOGIC_ENGINE_API_TOKEN",
    "LOGIC_ENGINE_ADAPTER_ID",
    "LOGIC_ENGINE_ADAPTER_TOKEN",
    "LOGIC_ENGINE_HOST_IDENTITY_DIR",
    "LOGIC_ENGINE_HOST_RECEIPT_DIR",
    "LOGIC_ENGINE_HOST_BUILD_SHA",
    "LOGIC_ENGINE_MEMORY_NPC_ENABLED",
    "LOGIC_ENGINE_HOST_ACCEPTANCE_MODE"
)
$previousEnvironment = @{}
foreach ($name in $coreEnvironmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$coreProcess = $null
try {
    $env:ENGINE_API_TOKEN = $apiToken
    $env:ENGINE_ADAPTER_TOKENS = $adapterTokensJson
    $env:ENGINE_DB_PATH = Join-Path $CoreData "logic-engine.sqlite"
    $env:LOGIC_ENGINE_COORDINATOR_DB_PATH = Join-Path $CoreData "coordinator.sqlite"
    $env:ENGINE_HOST_VERSION_LEDGER_DB_PATH = Join-Path $CoreData "host-versions.sqlite"
    $env:ENGINE_HOST_ASSERTION_NONCE_DB_PATH = Join-Path $CoreData "host-assertion-nonces.sqlite"
    $env:ENGINE_HOST_LIFECYCLE_DB_PATH = Join-Path $CoreData "host-lifecycle.sqlite"
    $env:ENGINE_HOST_ROOT_IDENTITIES = $registryJson
    $env:ENGINE_HOST_AUTHORITY_ID = "local-windows-acceptance"
    $env:ENGINE_HOST_AUTHORITY_GENERATION = "1"
    $env:LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH = $catalogPath
    $env:ENGINE_HOST = "127.0.0.1"
    $env:ENGINE_PORT = [string]$corePort
    $env:ENGINE_ALLOW_REMOTE = "false"
    $env:ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES = "[]"

    $coreStdout = Join-Path $TempRoot "core.stdout.log"
    $coreStderr = Join-Path $TempRoot "core.stderr.log"
    $coreProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @("src/index.js") -WorkingDirectory $LogicRepo -NoNewWindow -PassThru -RedirectStandardOutput $coreStdout -RedirectStandardError $coreStderr

    $coreReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($coreProcess.HasExited) {
            $detail = if (Test-Path $coreStderr) { (Get-Content -LiteralPath $coreStderr -Raw) } else { "" }
            throw ("CORE_STARTUP_FAILED: " + $detail)
        }
        try {
            $health = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $corePort + "/health") -TimeoutSec 2
            if ($health.ok -eq $true -and $health.service -eq "logic-engine") {
                $coreReady = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $coreReady) {
        if ($coreProcess -and -not $coreProcess.HasExited) { Stop-Process -Id $coreProcess.Id -Force }
        throw "CORE_READINESS_TIMEOUT"
    }

    $env:LOGIC_ENGINE_CORE_URL = "http://127.0.0.1:" + $corePort
    $env:LOGIC_ENGINE_API_TOKEN = $apiToken
    $env:LOGIC_ENGINE_ADAPTER_ID = $adapterId
    $env:LOGIC_ENGINE_ADAPTER_TOKEN = $adapterToken
    $env:LOGIC_ENGINE_HOST_IDENTITY_DIR = $identityDirectory
    $env:LOGIC_ENGINE_HOST_RECEIPT_DIR = $receiptDirectory
    $env:LOGIC_ENGINE_HOST_BUILD_SHA = $PinnedStCommit
    $env:LOGIC_ENGINE_MEMORY_NPC_ENABLED = "false"
    $env:LOGIC_ENGINE_HOST_ACCEPTANCE_MODE = "LOCAL_LOOPBACK_ONLY"

    $infoLines = @(
        "TEMPORARY WINDOWS HOST/CORE ACCEPTANCE",
        ("Logic-Engine commit: " + $actualCommit),
        ("SillyTavern pinned source commit: " + $PinnedStCommit),
        ("Temporary SillyTavern: " + $TestSt),
        ("Original SillyTavern source: " + $SourceSt),
        ("SillyTavern loopback port: " + $stPort),
        ("Core loopback port: " + $corePort),
        ("Host installation ID: " + $bootstrap.host_installation_id),
        ("Account ID: " + $bootstrap.authenticated_account_id),
        ("Root ID: " + $bootstrap.root_id),
        ("Source manifest SHA-256: " + $bootstrap.source_manifest_sha256),
        "Memory -> NPC: disabled",
        "ST-VectorService: not required and not used",
        "Host acceptance mode: LOCAL_LOOPBACK_ONLY (non-authoritative for uncovered mutation routes)",
        "Core: started with a disposable SQLite database set and deployment-owned local root registry",
        "The original SillyTavern source folder was not modified."
    )
    Set-Content -LiteralPath (Join-Path $TempRoot "TEST-INFO.txt") -Value $infoLines -Encoding UTF8

    Write-Host ""
    Write-Host ("Core ready on 127.0.0.1:" + $corePort) -ForegroundColor Green
    Write-Host ("Starting isolated SillyTavern on 127.0.0.1:" + $stPort) -ForegroundColor Green
    Write-Host ("Candidate: " + $actualCommit)
    Write-Host "Core, Host Gateway, Root Inventory and ordinary generation can now be inspected."
    Write-Host "Memory -> NPC remains disabled. Local mutation acceptance is non-authoritative."
    Write-Host "Do not expose either local service to LAN, VPN or the internet."
    Push-Location $TestSt
    try {
        node "server.js" --port $stPort
        if ($LASTEXITCODE -ne 0) { Stop-WithCode ("TEMP_ST_SERVER_EXITED_" + $LASTEXITCODE) }
    } finally {
        Pop-Location
    }
} finally {
    if ($coreProcess -and -not $coreProcess.HasExited) {
        Stop-Process -Id $coreProcess.Id -Force
        Wait-Process -Id $coreProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    foreach ($name in $coreEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}


Write-Host ""
Write-Host "Smoke test ended. Preserve the temporary directory and TEST-INFO.txt for diagnostics:"
Write-Host $TempRoot
