[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][string]$CoreServiceName,
    [Parameter(Mandatory = $true)][string]$ProviderServiceName,
    [Parameter(Mandatory = $true)][string]$GatewayServiceName,
    [Parameter(Mandatory = $true)][string]$CoreDbPath,
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ServiceIdentity {
    param([Parameter(Mandatory = $true)][string]$Name)
    $service = Get-CimInstance Win32_Service -ErrorAction Stop |
        Where-Object { $_.Name -eq $Name } |
        Select-Object -First 1
    if (-not $service) { throw "Required Windows service not found: $Name" }
    $account = [string]$service.StartName
    try {
        $sid = (New-Object System.Security.Principal.NTAccount($account)).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
    } catch {
        throw "Cannot resolve service identity for '$Name' ($account); refusing to change ACLs."
    }
    [pscustomobject]@{
        serviceName = [string]$service.Name
        state = [string]$service.State
        account = $account
        sid = $sid
        processId = [int]$service.ProcessId
    }
}

function New-BoundaryAcl {
    param([System.Security.AccessControl.FileSystemSecurity]$CurrentAcl, [string]$CoreAccount)
    $acl = $CurrentAcl
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $acl.SetOwner((New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')))
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    foreach ($entry in @(
        @{ Account = 'NT AUTHORITY\SYSTEM'; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        @{ Account = 'BUILTIN\Administrators'; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        @{ Account = $CoreAccount; Rights = [System.Security.AccessControl.FileSystemRights]::Modify }
    )) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $entry.Account, $entry.Rights, $inheritance, $propagation,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    return $acl
}

$core = Get-ServiceIdentity -Name $CoreServiceName
$provider = Get-ServiceIdentity -Name $ProviderServiceName
$gateway = Get-ServiceIdentity -Name $GatewayServiceName
if (@($core.sid, $provider.sid, $gateway.sid | Select-Object -Unique).Count -ne 3) {
    throw 'Core, Provider, and gateway must run under three distinct Windows service identities. No ACL changes were made.'
}
if ($core.sid -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) {
    throw 'Core uses a shared built-in service identity; use a dedicated service account before applying isolation.'
}
if ($provider.sid -eq $core.sid -or $gateway.sid -eq $core.sid) {
    throw 'Provider/gateway identity overlaps Core identity. No ACL changes were made.'
}

$dbPath = [System.IO.Path]::GetFullPath($CoreDbPath)
if (-not (Test-Path -LiteralPath $dbPath -PathType Leaf)) { throw 'Core database file does not exist.' }
$dbItem = Get-Item -LiteralPath $dbPath -Force
if (($dbItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Core database is a reparse point; refusing to modify ACLs.'
}
$directory = [System.IO.Path]::GetDirectoryName($dbPath)
$dirItem = Get-Item -LiteralPath $directory -Force
if (($dirItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Core database directory is a reparse point; refusing to modify ACLs.'
}

$allowedNames = @(
    [System.IO.Path]::GetFileName($dbPath),
    ([System.IO.Path]::GetFileName($dbPath) + '-wal'),
    ([System.IO.Path]::GetFileName($dbPath) + '-shm'),
    ([System.IO.Path]::GetFileName($dbPath) + '-journal')
)
$unexpected = @(Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -notin $allowedNames })
if ($unexpected.Count -gt 0) {
    throw 'Core database directory is not dedicated: unexpected entries exist. No ACL changes were made.'
}

$targets = @($directory) + @(Get-ChildItem -LiteralPath $directory -Force | ForEach-Object { $_.FullName })
$evidenceFullPath = [System.IO.Path]::GetFullPath($EvidencePath)
if ($evidenceFullPath.StartsWith($directory.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'EvidencePath must be outside the protected Core database directory.'
}
$before = @(
    foreach ($target in $targets) {
        $acl = Get-Acl -LiteralPath $target
        [pscustomobject]@{
            path = $target
            owner = [string]$acl.Owner
            sddl = [string]$acl.Sddl
        }
    }
)
$report = [ordered]@{
    reportType = 'Logic Engine Core DB ACL boundary candidate'
    status = if ($Apply) { 'APPLY_REQUESTED' } else { 'PLAN_ONLY' }
    timestampUtc = [datetime]::UtcNow.ToString('o')
    os = [System.Environment]::OSVersion.VersionString
    services = @{ core = $core; provider = $provider; gateway = $gateway }
    targetDirectory = $directory
    targetPaths = $targets
    priorAcl = $before
    limitations = @(
        'This protects only the dedicated Core DB directory and current SQLite sidecars.',
        'Backup, restore, authority service, firewall, and outbound dispatch boundaries are not changed.',
        'Service account group membership, privileges, service configuration, and target-machine behavior require separate review.',
        'This candidate is not production approval; keep protected Memory-to-NPC disabled until all gates pass.'
    )
}

if (-not $Apply) {
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidenceFullPath -Encoding UTF8
    Write-Output "PLAN_ONLY: identities and target paths recorded at $evidenceFullPath; no ACLs changed."
    exit 0
}

if (-not $PSCmdlet.ShouldProcess($directory, 'Replace ACLs on the dedicated Core database directory and SQLite files')) {
    Write-Output 'No ACL changes applied.'
    exit 0
}
if (-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
    throw 'Applying the boundary requires an elevated PowerShell session.'
}

# Save evidence before the first mutation. A failure to save it aborts the change.
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidenceFullPath -Encoding UTF8
try {
    foreach ($target in $targets) {
        $current = Get-Acl -LiteralPath $target
        $replacement = New-BoundaryAcl -CurrentAcl $current -CoreAccount $core.account
        Set-Acl -LiteralPath $target -AclObject $replacement
    }
    foreach ($target in $targets) {
        $acl = Get-Acl -LiteralPath $target
        $rules = @($acl.Access | ForEach-Object { [string]$_.IdentityReference })
        if ($rules -notcontains $core.account -or $rules -contains $provider.account -or $rules -contains $gateway.account) {
            throw "Post-apply ACL verification failed for $target."
        }
    }
    $report.status = 'APPLIED_AND_ACL_SHAPE_VERIFIED'
    $report.appliedAcl = @(
        foreach ($target in $targets) {
            $acl = Get-Acl -LiteralPath $target
            [pscustomobject]@{ path = $target; owner = [string]$acl.Owner; sddl = [string]$acl.Sddl }
        }
    )
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidenceFullPath -Encoding UTF8
    Write-Output "APPLIED_AND_ACL_SHAPE_VERIFIED: evidence written to $evidenceFullPath."
} catch {
    $report.status = 'PARTIAL_OR_FAILED_APPLY'
    $report.error = $_.Exception.GetType().Name
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidenceFullPath -Encoding UTF8
    throw
}
