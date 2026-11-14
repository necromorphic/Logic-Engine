[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TempRoot
)

$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path -LiteralPath $TempRoot -ErrorAction Stop).Path
$secretPath = Join-Path $resolvedRoot "host-acceptance-secrets.json"
if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    throw "ACCEPTANCE_SECRETS_NOT_FOUND"
}

$secrets = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$secrets.core_data)) {
    throw "ACCEPTANCE_SECRET_FIELD_MISSING_CORE_DATA"
}

# Prefer the repository containing this wrapper. This makes the command work
# from a normal checkout without copying scripts into the disposable runtime.
$scriptCandidates = @(
    (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..") -ErrorAction Stop).Path
)
if (-not [string]::IsNullOrWhiteSpace([string]$secrets.logic_engine_root)) {
    $configuredRoot = [string]$secrets.logic_engine_root
    if (Test-Path -LiteralPath $configuredRoot -PathType Container) {
        $configuredRoot = (Resolve-Path -LiteralPath $configuredRoot).Path
        if ($scriptCandidates -notcontains $configuredRoot) {
            $scriptCandidates += $configuredRoot
        }
    }
}

$repoRoot = $null
$scriptPath = $null
foreach ($candidate in $scriptCandidates) {
    $candidateScript = Join-Path $candidate "scripts/acceptance/protected-memory-preflight.mjs"
    $candidateImport = Join-Path $candidate "src/security/accepted-head-client-sync.js"
    if ((Test-Path -LiteralPath $candidateScript -PathType Leaf) -and
        (Test-Path -LiteralPath $candidateImport -PathType Leaf)) {
        $repoRoot = $candidate
        $scriptPath = $candidateScript
        break
    }
}
if (-not $scriptPath) {
    throw ("PROTECTED_MEMORY_PREFLIGHT_FILES_NOT_FOUND. Checked: " + ($scriptCandidates -join "; "))
}

$coreData = [string]$secrets.core_data
$env:ENGINE_DB_PATH = Join-Path $coreData "logic-engine.sqlite"
$env:LOGIC_ENGINE_COORDINATOR_DB_PATH = Join-Path $coreData "coordinator.sqlite"
$env:ENGINE_MEMORY_PROVIDER_DB_PATH = Join-Path $coreData "memory-provider.sqlite"
$env:ENGINE_HOST_ASSERTION_NONCE_DB_PATH = Join-Path $coreData "host-assertion-nonces.sqlite"
$env:ENGINE_HOST_LIFECYCLE_DB_PATH = Join-Path $coreData "host-lifecycle.sqlite"
$env:ENGINE_HOST_VERSION_LEDGER_DB_PATH = Join-Path $coreData "host-versions.sqlite"
$env:LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH = Join-Path $coreData "accepted-head-authority.sqlite"
$env:ENGINE_MEMORY_NPC_CONTENT_FIELDS = '["attributes.public_note"]'
if ($null -eq $secrets.accepted_head_authority_port -or [string]::IsNullOrWhiteSpace([string]$secrets.accepted_head_authority_read_token)) {
    throw "ACCEPTED_HEAD_AUTHORITY_READ_CONFIGURATION_MISSING"
}
$env:LOGIC_ENGINE_ACCEPTED_HEAD_PORT = [string]$secrets.accepted_head_authority_port
$env:LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN = [string]$secrets.accepted_head_authority_read_token

Push-Location $repoRoot
try {
    & node $scriptPath
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $exitCode
