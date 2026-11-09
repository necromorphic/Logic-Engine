param(
    [string]$SillyTavernRoot,
    [string]$CandidateRef = "integration/host-core-v1",
    [string]$CandidateCommit,
    [string]$TempRoot,
    [switch]$ResumeExisting
)

# Isolated Windows deployment smoke test.
# Uses the real repository installer and provisions a disposable, pinned SillyTavern checkout.\n# SillyTavernRoot remains as a legacy ignored parameter; no user installation is read or modified.
$ErrorActionPreference = "Stop"
$Repo = "https://github.com/necromorphic/Logic-Engine.git"
$PinnedStCommit = "06bde939fb1e9c4c8d8641d810f0a916b5bce127"
if ($ResumeExisting) {
    if ([string]::IsNullOrWhiteSpace($TempRoot) -or -not (Test-Path -LiteralPath $TempRoot -PathType Container)) {
        throw "RESUME_TEMP_ROOT_REQUIRED"
    }
    $TempRoot = (Resolve-Path -LiteralPath $TempRoot).Path
} else {
    if (-not [string]::IsNullOrWhiteSpace($TempRoot)) {
        throw "TEMP_ROOT_IS_ONLY_VALID_WITH_RESUME_EXISTING"
    }
    $TempRoot = Join-Path $env:TEMP ("LogicEngine-ST-Test-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$TestSt = Join-Path $TempRoot "SillyTavern"
$LogicRepo = Join-Path $TempRoot "Logic-Engine"

function Stop-WithCode([string]$Code) { throw $Code }
function Invoke-Native([string]$Command, [string[]]$Arguments, [string]$FailureCode) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { Stop-WithCode ($FailureCode + "_" + $LASTEXITCODE) }
}

Write-Host "=== Logic-Engine isolated Windows deployment smoke test ===" -ForegroundColor Cyan

# SillyTavern is provisioned from its exact pinned upstream commit below.
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

# Build both applications in a disposable directory. Do not depend on a manually
# prepared SillyTavern folder and never read or modify the user's live ST profile.
New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
Write-Host ("Isolated test directory: " + $TempRoot)
Write-Host ("Provisioning pinned SillyTavern commit: " + $PinnedStCommit)

if ($ResumeExisting) {
    if (-not (Test-Path -LiteralPath $LogicRepo -PathType Container) -or -not (Test-Path -LiteralPath $TestSt -PathType Container)) {
        Stop-WithCode "RESUME_ACCEPTANCE_CHECKOUTS_NOT_FOUND"
    }
    $dirty = @(git -C $LogicRepo status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) {
        Stop-WithCode "RESUME_LOGIC_ENGINE_CHECKOUT_NOT_CLEAN"
    }
    if ([string]::IsNullOrWhiteSpace($CandidateCommit)) {
        Invoke-Native "git" @("-C", $LogicRepo, "fetch", "--depth=1", "origin", $CandidateRef) "CANDIDATE_FETCH_FAILED"
        Invoke-Native "git" @("-C", $LogicRepo, "checkout", "-B", $CandidateRef, "FETCH_HEAD") "CANDIDATE_CHECKOUT_FAILED"
    } else {
        Invoke-Native "git" @("-C", $LogicRepo, "fetch", "--depth=1", "origin", $CandidateCommit) "CANDIDATE_FETCH_FAILED"
        Invoke-Native "git" @("-C", $LogicRepo, "checkout", "--detach", "FETCH_HEAD") "CANDIDATE_CHECKOUT_FAILED"
    }
} elseif ([string]::IsNullOrWhiteSpace($CandidateCommit)) {
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

# Core is launched from this checkout, not from the copied SillyTavern plugin.
# Install its runtime dependencies here as well. The repository intentionally has
# no committed package-lock.json, so use npm install (not npm ci); package.json
# pins the direct runtime dependencies to exact versions.
Write-Host "Installing isolated Logic-Engine Core runtime dependencies..."
Push-Location $LogicRepo
try {
    Invoke-Native $npmCommand.Source @("install", "--omit=dev", "--no-audit", "--no-fund") "CORE_DEPENDENCY_INSTALL_FAILED"
} finally {
    Pop-Location
}

if (-not $ResumeExisting) {
    Invoke-Native "git" @("clone", "--no-checkout", "--filter=blob:none", "https://github.com/SillyTavern/SillyTavern.git", $TestSt) "SILLYTAVERN_CLONE_FAILED"
    Invoke-Native "git" @("-C", $TestSt, "fetch", "--depth=1", "origin", $PinnedStCommit) "SILLYTAVERN_PIN_FETCH_FAILED"
    Invoke-Native "git" @("-C", $TestSt, "checkout", "--detach", "FETCH_HEAD") "SILLYTAVERN_PIN_CHECKOUT_FAILED"
}
$actualStCommit = (git -C $TestSt rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualStCommit -ne $PinnedStCommit) {
    Stop-WithCode "SILLYTAVERN_PINNED_COMMIT_MISMATCH"
}
$packagePath = Join-Path $TestSt "package.json"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    Stop-WithCode "SILLYTAVERN_PACKAGE_JSON_NOT_FOUND"
}
$packageData = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($packageData.version -ne "1.19.0") {
    Stop-WithCode ("SILLYTAVERN_VERSION_UNSUPPORTED_" + $packageData.version)
}
if (-not (Test-Path -LiteralPath (Join-Path $TestSt "src/plugin-loader.js") -PathType Leaf)) {
    Stop-WithCode "SILLYTAVERN_PLUGIN_LOADER_NOT_FOUND"
}
if (-not (Test-Path -LiteralPath (Join-Path $TestSt "package-lock.json") -PathType Leaf)) {
    Stop-WithCode "SILLYTAVERN_PACKAGE_LOCK_MISSING"
}
if ($ResumeExisting) {
    # Update only the three changed server modules and refresh the pinned source
    # manifest. Existing chat data, Core databases, identity and ST patches remain.
    if (-not (Test-Path -LiteralPath (Join-Path $TestSt "node_modules") -PathType Container)) {
        Push-Location $TestSt
        try {
            Invoke-Native $npmCommand.Source @("ci", "--no-audit", "--no-fund") "SILLYTAVERN_DEPENDENCY_INSTALL_FAILED"
        } finally {
            Pop-Location
        }
    }
    $updater = Join-Path $LogicRepo "scripts/Update-LogicEngine-Host-Plugin.ps1"
    if (-not (Test-Path -LiteralPath $updater -PathType Leaf)) {
        Stop-WithCode "HOST_PLUGIN_UPDATER_NOT_FOUND"
    }
    & $updater -SillyTavernRoot $TestSt
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        Stop-WithCode ("HOST_PLUGIN_UPDATE_FAILED_" + $LASTEXITCODE)
    }
} else {
    $templateConfig = Join-Path $TestSt "default/config.yaml"
    if (-not (Test-Path -LiteralPath $templateConfig -PathType Leaf)) {
        Stop-WithCode "SILLYTAVERN_DEFAULT_CONFIG_TEMPLATE_NOT_FOUND"
    }
    Copy-Item -LiteralPath $templateConfig -Destination (Join-Path $TestSt "config.yaml") -Force
    # The official release tracks data/.gitkeep as an empty-directory placeholder.
    # Remove only that known placeholder; reject any real profile data in the pinned source.
    $dataDirectory = Join-Path $TestSt "data"
    if (Test-Path -LiteralPath $dataDirectory -PathType Container) {
        $dataEntries = @(Get-ChildItem -LiteralPath $dataDirectory -Force)
        $unexpectedData = @($dataEntries | Where-Object { $_.Name -ne ".gitkeep" })
        if ($unexpectedData.Count -gt 0) {
            Stop-WithCode "ISOLATION_FAILURE_PINNED_SOURCE_CONTAINS_UNEXPECTED_DATA"
        }
        Remove-Item -LiteralPath $dataDirectory -Recurse -Force
    }
    if (Test-Path -LiteralPath (Join-Path $TestSt "public/user")) {
        Stop-WithCode "ISOLATION_FAILURE_PINNED_SOURCE_CONTAINS_USER_UPLOADS"
    }

    # SillyTavern's committed lockfile makes its dependency install reproducible.
    Push-Location $TestSt
    try {
        Invoke-Native $npmCommand.Source @("ci", "--no-audit", "--no-fund") "SILLYTAVERN_DEPENDENCY_INSTALL_FAILED"
    } finally {
        Pop-Location
    }

    # First installation uses the canonical transactional installer.
    $installer = Join-Path $LogicRepo "scripts/install-sillytavern-host-plugin.ps1"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        Stop-WithCode "CANONICAL_HOST_INSTALLER_NOT_FOUND"
    }
    & $installer -SillyTavernRoot $TestSt
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        Stop-WithCode ("CANONICAL_HOST_INSTALLER_FAILED_" + $LASTEXITCODE)
    }
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
$adminToken = New-TestSecret
$adapterToken = New-TestSecret
$acceptanceWorldId = "local-windows-acceptance-world"
$corePort = Get-FreeLoopbackPort
$stPort = Get-FreeLoopbackPort
$authorityPort = Get-FreeLoopbackPort
$authorityCoreToken = New-TestSecret
$authorityProviderToken = New-TestSecret
$authorityReadToken = New-TestSecret
$authorityDbPath = Join-Path $CoreData "accepted-head-authority.sqlite"

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
    "ENGINE_ADMIN_TOKEN",
    "ENGINE_ADAPTER_TOKENS",
    "ENGINE_DB_PATH",
    "LOGIC_ENGINE_COORDINATOR_DB_PATH",
    "ENGINE_HOST_VERSION_LEDGER_DB_PATH",
    "ENGINE_HOST_ASSERTION_NONCE_DB_PATH",
    "ENGINE_HOST_LIFECYCLE_DB_PATH",
    "ENGINE_HOST_ROOT_IDENTITIES",
    "ENGINE_HOST_AUTHORITY_ID",
    "ENGINE_HOST_AUTHORITY_GENERATION",
    "ENGINE_HOST_DEFAULT_WORLD_ID",
    "LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH",
    "ENGINE_HOST",
    "ENGINE_PORT",
    "ENGINE_ALLOW_REMOTE",
    "ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES",
    "ENGINE_MEMORY_PROVIDER_DB_PATH",
    "ENGINE_MEMORY_NPC_CONTENT_FIELDS",
    "LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH",
    "LOGIC_ENGINE_ACCEPTED_HEAD_INSTALLATION_ID",
    "LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN",
    "LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN",
    "LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN",
    "LOGIC_ENGINE_ACCEPTED_HEAD_PORT",
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
$authorityProcess = $null
try {
    $env:ENGINE_API_TOKEN = $apiToken
    $env:ENGINE_ADMIN_TOKEN = $adminToken
    $env:ENGINE_ADAPTER_TOKENS = $adapterTokensJson
    $env:ENGINE_DB_PATH = Join-Path $CoreData "logic-engine.sqlite"
    $env:LOGIC_ENGINE_COORDINATOR_DB_PATH = Join-Path $CoreData "coordinator.sqlite"
    $env:ENGINE_HOST_VERSION_LEDGER_DB_PATH = Join-Path $CoreData "host-versions.sqlite"
    $env:ENGINE_HOST_ASSERTION_NONCE_DB_PATH = Join-Path $CoreData "host-assertion-nonces.sqlite"
    $env:ENGINE_HOST_LIFECYCLE_DB_PATH = Join-Path $CoreData "host-lifecycle.sqlite"
    $env:ENGINE_HOST_ROOT_IDENTITIES = $registryJson
    $env:ENGINE_HOST_AUTHORITY_ID = "local-windows-acceptance"
    $env:ENGINE_HOST_AUTHORITY_GENERATION = "1"
    $env:ENGINE_HOST_DEFAULT_WORLD_ID = $acceptanceWorldId
    $env:LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH = $catalogPath
    $env:ENGINE_HOST = "127.0.0.1"
    $env:ENGINE_PORT = [string]$corePort
    $env:ENGINE_ALLOW_REMOTE = "false"
    $env:ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES = "[]"
    # Provision a separate, disposable Provider database for diagnostics.
    # Retrieval remains disabled; the allowlist is intentionally narrow.
    $env:ENGINE_MEMORY_PROVIDER_DB_PATH = Join-Path $CoreData "memory-provider.sqlite"
    $env:ENGINE_MEMORY_NPC_CONTENT_FIELDS = '["attributes.public_note"]'

    # Separate loopback authority process. It provisions only the authority schema;
    # both domains remain un-enrolled until a reviewed baseline is explicitly approved.
    $env:LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH = $authorityDbPath
    $env:LOGIC_ENGINE_ACCEPTED_HEAD_INSTALLATION_ID = "local-windows-acceptance-authority"
    $env:LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN = $authorityCoreToken
    $env:LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN = $authorityProviderToken
    $env:LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN = $authorityReadToken
    $env:LOGIC_ENGINE_ACCEPTED_HEAD_PORT = [string]$authorityPort
    $authorityStdout = Join-Path $TempRoot "accepted-head-authority.stdout.log"
    $authorityStderr = Join-Path $TempRoot "accepted-head-authority.stderr.log"
    $authorityScript = Join-Path $LogicRepo "scripts/security/run-accepted-head-authority.js"
    $authorityProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList @($authorityScript) -WorkingDirectory $LogicRepo -NoNewWindow -PassThru -RedirectStandardOutput $authorityStdout -RedirectStandardError $authorityStderr
    $authorityReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($authorityProcess.HasExited) { throw "ACCEPTED_HEAD_AUTHORITY_START_FAILED" }
        try {
            $authorityHeaders = @{ Authorization = "Bearer " + $authorityReadToken }
            $authorityStatus = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $authorityPort + "/v1/heads") -Headers $authorityHeaders -TimeoutSec 2
            if ($authorityStatus.heads.core -eq 0 -and $authorityStatus.heads.provider -eq 0) { $authorityReady = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $authorityReady) { throw "ACCEPTED_HEAD_AUTHORITY_READINESS_TIMEOUT" }
    # Keep authority credentials out of the Core process environment.
    foreach ($name in @("LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH","LOGIC_ENGINE_ACCEPTED_HEAD_INSTALLATION_ID","LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN","LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN","LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN","LOGIC_ENGINE_ACCEPTED_HEAD_PORT")) {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }

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

    # Provision one disposable canonical World before ST starts. The browser never
    # chooses world_id; later conversation binding uses this fixed server-owned ID.
    $worldBody = @{
        world_id = $acceptanceWorldId
        world_pack_id = "local-acceptance-pack"
        world_pack_version = "1.0.0"
        game_time = "2005-12-29T10:00:00Z"
    } | ConvertTo-Json -Depth 5 -Compress
    $worldHeaders = @{
        "Authorization" = "Bearer " + $apiToken
        "x-admin-token" = $adminToken
    }
    try {
        if ($ResumeExisting) {
            $worldResult = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $corePort + "/v1/worlds/" + $acceptanceWorldId + "/state") -Headers $worldHeaders -TimeoutSec 10
            if (-not $worldResult.state) {
                throw "EXISTING_ACCEPTANCE_WORLD_INVALID"
            }
        } else {
            $worldResult = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $corePort + "/v1/worlds") -Method Post -Headers $worldHeaders -ContentType "application/json" -Body $worldBody -TimeoutSec 10
            if (-not $worldResult.world -or $worldResult.world.world_id -ne $acceptanceWorldId) {
                throw "WORLD_PROVISIONING_RESPONSE_INVALID"
            }
        }
    } catch {
        $detail = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $_.Exception.Message }
        throw ("ACCEPTANCE_WORLD_PROVISIONING_FAILED: " + $detail)
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

    $secretPath = Join-Path $TempRoot "host-acceptance-secrets.json"
    $secretRecord = @{
        core_url = "http://127.0.0.1:" + $corePort
        api_token = $apiToken
        admin_token = $adminToken
        adapter_id = $adapterId
        adapter_token = $adapterToken
        world_id = $acceptanceWorldId
        core_data = $CoreData
        accepted_head_authority_port = $authorityPort
        accepted_head_authority_read_token = $authorityReadToken
        data_root = $dataRoot
        host_identity_dir = $identityDirectory
        host_receipt_dir = $receiptDirectory
        sillytavern_root = $TestSt
        logic_engine_root = $LogicRepo
    } | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($secretPath, $secretRecord, [System.Text.UTF8Encoding]::new($false))
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $userGrant = "*${currentSid}:(R)"
    & icacls.exe $secretPath /inheritance:r /grant:r $userGrant "*S-1-5-18:(R)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ACCEPTANCE_SECRET_ACL_HARDENING_FAILED" }
    $infoLines = @(
        "TEMPORARY WINDOWS HOST/CORE ACCEPTANCE",
        ("Logic-Engine commit: " + $actualCommit),
        ("SillyTavern pinned source commit: " + $PinnedStCommit),
        ("Temporary SillyTavern: " + $TestSt),
        ("SillyTavern source commit: " + $actualStCommit),
        ("SillyTavern loopback port: " + $stPort),
        ("Core loopback port: " + $corePort),
        ("Acceptance world: " + $acceptanceWorldId),
        ("Acceptance secrets file: " + $secretPath),
        ("Host installation ID: " + $bootstrap.host_installation_id),
        ("Account ID: " + $bootstrap.authenticated_account_id),
        ("Root ID: " + $bootstrap.root_id),
        ("Source manifest SHA-256: " + $bootstrap.source_manifest_sha256),
        ("Memory Provider DB: " + (Join-Path $CoreData "memory-provider.sqlite")),
        ("Accepted Head Authority DB: " + $authorityDbPath),
        ("Accepted Head Authority: loopback port " + $authorityPort + " (Core/Provider un-enrolled; same Windows user, acceptance-only)"),
        'Memory Provider field allowlist: ["attributes.public_note"]',
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
    if ($authorityProcess -and -not $authorityProcess.HasExited) {
        Stop-Process -Id $authorityProcess.Id -Force
        Wait-Process -Id $authorityProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    foreach ($name in $coreEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}


Write-Host ""
Write-Host "Smoke test ended. Preserve the temporary directory and TEST-INFO.txt for diagnostics:"
Write-Host $TempRoot
