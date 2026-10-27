[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][string]$AuthorityServiceName,
    [Parameter(Mandatory = $true)][string]$CoreServiceName,
    [Parameter(Mandatory = $true)][string]$ProviderServiceName,
    [Parameter(Mandatory = $true)][string]$GatewayServiceName,
    [Parameter(Mandatory = $true)][string]$AuthorityDbPath,
    [Parameter(Mandatory = $true)][string]$CoreDbPath,
    [Parameter(Mandatory = $true)][string]$ProviderDbPath,
    [Parameter(Mandatory = $true)][string]$CoordinatorDbPath,
    [Parameter(Mandatory = $true)][string[]]$BackupRoots,
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
    if ($account.StartsWith('.\', [System.StringComparison]::Ordinal)) {
        $account = "$env:COMPUTERNAME\$($account.Substring(2))"
    }
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

function New-AuthorityAcl {
    param([System.Security.AccessControl.FileSystemSecurity]$CurrentAcl, [string]$AuthorityAccount, [switch]$Directory)
    $acl = $CurrentAcl
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $acl.SetOwner((New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')))
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
    if ($Directory) {
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    foreach ($entry in @(
        @{ Account = 'NT AUTHORITY\SYSTEM'; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        @{ Account = 'BUILTIN\Administrators'; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        @{ Account = $AuthorityAccount; Rights = [System.Security.AccessControl.FileSystemRights]::Modify }
    )) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $entry.Account, $entry.Rights, $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    return $acl
}

$authority = Get-ServiceIdentity -Name $AuthorityServiceName
$core = Get-ServiceIdentity -Name $CoreServiceName
$provider = Get-ServiceIdentity -Name $ProviderServiceName
$gateway = Get-ServiceIdentity -Name $GatewayServiceName
$identities = @($authority.sid, $core.sid, $provider.sid, $gateway.sid)
if (@($identities | Select-Object -Unique).Count -ne 4) {
    throw 'Authority, Core, Provider, and gateway must use four distinct service identities. No ACL changes were made.'
}
if ($authority.sid -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) {
    throw 'Accepted-head authority must use a dedicated service identity, not a built-in service account.'
}

$dbPath = [System.IO.Path]::GetFullPath($AuthorityDbPath)
if (-not (Test-Path -LiteralPath $dbPath -PathType Leaf)) { throw 'Accepted-head authority database file does not exist.' }
$dbItem = Get-Item -LiteralPath $dbPath -Force
if (($dbItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Authority database is a reparse point; refusing to modify ACLs.'
}
$directory = [System.IO.Path]::GetDirectoryName($dbPath)
$dirItem = Get-Item -LiteralPath $directory -Force
if (($dirItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Authority database directory is a reparse point; refusing to modify ACLs.'
}

function Test-PathOverlap {
    param([string]$Left, [string]$Right)
    $leftPath = [System.IO.Path]::GetFullPath($Left).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $rightPath = [System.IO.Path]::GetFullPath($Right).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    return $leftPath.Equals($rightPath, $comparison) -or
        $leftPath.StartsWith($rightPath + [System.IO.Path]::DirectorySeparatorChar, $comparison) -or
        $rightPath.StartsWith($leftPath + [System.IO.Path]::DirectorySeparatorChar, $comparison)
}

$authorityDirectory = [System.IO.Path]::GetFullPath($directory)
$protectedStores = @(
    @{ label = 'Core database directory'; path = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($CoreDbPath)) },
    @{ label = 'Provider database directory'; path = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($ProviderDbPath)) },
    @{ label = 'Coordinator database directory'; path = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($CoordinatorDbPath)) }
)
foreach ($store in $protectedStores) {
    $storeFile = switch ($store.label) {
        'Core database directory' { [System.IO.Path]::GetFullPath($CoreDbPath) }
        'Provider database directory' { [System.IO.Path]::GetFullPath($ProviderDbPath) }
        'Coordinator database directory' { [System.IO.Path]::GetFullPath($CoordinatorDbPath) }
    }
    if (-not (Test-Path -LiteralPath $storeFile -PathType Leaf)) {
        throw "$($store.label) file does not exist; refusing to claim restore-domain separation."
    }
    $storeItem = Get-Item -LiteralPath $storeFile -Force
    if (($storeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$($store.label) is a reparse point; refusing to claim restore-domain separation."
    }
    if (-not (Test-Path -LiteralPath $store.path -PathType Container)) {
        throw "$($store.label) parent directory does not exist; refusing to claim restore-domain separation."
    }
    if (Test-PathOverlap -Left $authorityDirectory -Right $store.path) {
        throw "Authority directory overlaps $($store.label); restore-domain separation is not established."
    }
}
if (-not $BackupRoots -or $BackupRoots.Count -eq 0) {
    throw 'At least one explicit Core/Provider/coordinator backup or restore root is required.'
}
foreach ($backupRoot in $BackupRoots) {
    $backupPath = [System.IO.Path]::GetFullPath($backupRoot)
    if (-not (Test-Path -LiteralPath $backupPath -PathType Container)) {
        throw "Backup/restore root does not exist: $backupPath"
    }
    $backupItem = Get-Item -LiteralPath $backupPath -Force
    if (($backupItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Backup/restore root is a reparse point: $backupPath"
    }
    if (Test-PathOverlap -Left $authorityDirectory -Right $backupPath) {
        throw "Authority directory overlaps a supplied backup/restore root: $backupPath"
    }
}
$allowedNames = @(
    [System.IO.Path]::GetFileName($dbPath),
    ([System.IO.Path]::GetFileName($dbPath) + '-wal'),
    ([System.IO.Path]::GetFileName($dbPath) + '-shm'),
    ([System.IO.Path]::GetFileName($dbPath) + '-journal')
)
$unexpected = @(Get-ChildItem -LiteralPath $directory -Force | Where-Object { $_.Name -notin $allowedNames })
if ($unexpected.Count -gt 0) {
    throw 'Authority database directory is not dedicated: unexpected entries exist. No ACL changes were made.'
}
$targets = @($directory) + @(Get-ChildItem -LiteralPath $directory -Force | ForEach-Object { $_.FullName })
$evidenceFullPath = [System.IO.Path]::GetFullPath($EvidencePath)
if ($evidenceFullPath.StartsWith($directory.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'EvidencePath must be outside the protected authority directory.'
}
$before = @(
    foreach ($target in $targets) {
        $acl = Get-Acl -LiteralPath $target
        [pscustomobject]@{ path = $target; owner = [string]$acl.Owner; sddl = [string]$acl.Sddl }
    }
)
$report = [ordered]@{
    reportType = 'Logic Engine accepted-head authority ACL candidate'
    status = if ($Apply) { 'APPLY_REQUESTED' } else { 'PLAN_ONLY' }
    timestampUtc = [datetime]::UtcNow.ToString('o')
    os = [System.Environment]::OSVersion.VersionString
    services = @{ authority = $authority; core = $core; provider = $provider; gateway = $gateway }
    targetDirectory = $directory
    targetPaths = $targets
    priorAcl = $before
    limitations = @(
        'Protects only the dedicated authority DB directory and current SQLite sidecars.',
        'Does not create or validate the authority service, protocol, monotonic semantics, or inventory authority.',
        'Administrators/SYSTEM remain trusted recovery principals; audited recovery controls are separate.',
        'Backup copies and restore paths must be isolated separately; this script does not prove restore resistance.',
        'ACL shape is not proof of effective access, exclusive egress, or production readiness.'
    )
}
if (-not $Apply) {
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidenceFullPath -Encoding UTF8
    Write-Output "PLAN_ONLY: authority identities and target paths recorded at $evidenceFullPath; no ACLs changed."
    exit 0
}
if (-not $PSCmdlet.ShouldProcess($directory, 'Replace ACLs on the dedicated accepted-head authority database directory and SQLite files')) {
    Write-Output 'No ACL changes applied.'
    exit 0
}
if (-not (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)) {
    throw 'Applying the boundary requires an elevated PowerShell session.'
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidenceFullPath -Encoding UTF8
try {
    foreach ($target in $targets) {
        $current = Get-Acl -LiteralPath $target
        $isDirectory = ([System.IO.File]::GetAttributes($target) -band [System.IO.FileAttributes]::Directory) -ne 0
        $replacement = New-AuthorityAcl -CurrentAcl $current -AuthorityAccount $authority.account -Directory:$isDirectory
        Set-Acl -LiteralPath $target -AclObject $replacement
    }
    foreach ($target in $targets) {
        $acl = Get-Acl -LiteralPath $target
        $rules = @($acl.Access | ForEach-Object { [string]$_.IdentityReference })
        if ($rules -notcontains $authority.account -or
            $rules -contains $core.account -or $rules -contains $provider.account -or $rules -contains $gateway.account) {
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
    $rollbackErrors = @()
    foreach ($prior in $before) {
        try {
            $restoreAcl = Get-Acl -LiteralPath $prior.path
            $restoreAcl.SetSecurityDescriptorSddlForm([string]$prior.sddl)
            Set-Acl -LiteralPath $prior.path -AclObject $restoreAcl
        } catch {
            $rollbackErrors += [pscustomobject]@{ path = $prior.path; error = $_.Exception.GetType().Name }
        }
    }
    $report.rollback = if ($rollbackErrors.Count -eq 0) { 'RESTORED_PRIOR_SDDL' } else { 'ROLLBACK_INCOMPLETE' }
    $report.rollbackErrors = $rollbackErrors
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidenceFullPath -Encoding UTF8
    throw
}
