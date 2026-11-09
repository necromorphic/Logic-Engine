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
foreach ($name in @("core_data", "logic_engine_root")) {
    if ([string]::IsNullOrWhiteSpace([string]$secrets.$name)) {
        throw ("ACCEPTANCE_SECRET_FIELD_MISSING_" + $name.ToUpperInvariant())
    }
}
$repoRoot = (Resolve-Path -LiteralPath ([string]$secrets.logic_engine_root) -ErrorAction Stop).Path
$scriptPath = Join-Path $repoRoot "scripts/acceptance/protected-memory-preflight.mjs"
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "PROTECTED_MEMORY_PREFLIGHT_SCRIPT_NOT_FOUND"
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

Push-Location $repoRoot
try {
    & node $scriptPath
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $exitCode
