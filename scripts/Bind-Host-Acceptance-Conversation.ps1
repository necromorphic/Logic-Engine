[CmdletBinding()]
param(
    [string]$TempRoot,
    [Parameter(Mandatory = $true)]
    [string]$ConversationId
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($TempRoot)) {
    $latest = Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter "LogicEngine-ST-Test-*" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw "ACCEPTANCE_TEMP_ROOT_NOT_FOUND" }
    $TempRoot = $latest.FullName
}

$secretPath = Join-Path $TempRoot "host-acceptance-secrets.json"
if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    throw "ACCEPTANCE_SECRETS_NOT_FOUND: restart the updated isolated acceptance script first"
}
$secrets = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json
if ($secrets.core_url -notmatch '^http://127\.0\.0\.1:\d+$'
    -or [string]::IsNullOrWhiteSpace($secrets.admin_token)
    -or [string]::IsNullOrWhiteSpace($secrets.adapter_id)
    -or [string]::IsNullOrWhiteSpace($secrets.world_id)) {
    throw "ACCEPTANCE_SECRETS_INVALID"
}
if ([string]::IsNullOrWhiteSpace($ConversationId)
    -or $ConversationId.Length -gt 200
    -or $ConversationId -ne $ConversationId.Trim()
    -or $ConversationId -match '[\x00-\x1f\x7f]') {
    throw "INVALID_HOST_CONVERSATION_ID"
}

$body = @{
    adapter_id = $secrets.adapter_id
    conversation_id = $ConversationId
    world_id = $secrets.world_id
} | ConvertTo-Json -Compress

try {
    $result = Invoke-RestMethod -Uri ($secrets.core_url + "/v1/host-conversation-bindings") `
        -Method Post -Headers @{ "x-admin-token" = $secrets.admin_token } `
        -ContentType "application/json" -Body $body -TimeoutSec 10
} catch {
    $detail = $_.ErrorDetails.Message
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $_.Exception.Message }
    throw ("HOST_CONVERSATION_BINDING_FAILED: " + $detail)
}

if (-not $result.binding -or $result.binding.conversation_id -ne $ConversationId
    -or $result.binding.world_id -ne $secrets.world_id
    -or $result.binding.adapter_id -ne $secrets.adapter_id
    -or $result.binding.active -ne $true) {
    throw "HOST_CONVERSATION_BINDING_RESPONSE_INVALID"
}

[pscustomobject]@{
    status = if ($result.binding.already_bound) { "ALREADY_BOUND" } else { "BOUND" }
    adapter_id = $result.binding.adapter_id
    conversation_id = $result.binding.conversation_id
    world_id = $result.binding.world_id
    active = $result.binding.active
} | ConvertTo-Json -Depth 4
