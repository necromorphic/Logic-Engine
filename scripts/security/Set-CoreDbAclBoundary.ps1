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

function Assert-NoReparsePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $current = [System.IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Path component is a reparse point; refusing ACL operation: $current"
            }
        } else {
            throw "Path component does not exist; refusing ACL operation: $current"
        }
        $parent = [System.IO.Path]::GetDirectoryName($current.TrimEnd('\'))
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
}

function Assert-SafeParentPathMutationRights {
    param(
        [Parameter(Mandatory = $true)][string]$ProtectedDirectory,
        [Parameter(Mandatory = $true)][string[]]$TrustedSids
    )

    # The child DACL cannot protect the child directory if an untrusted principal
    # can delete/rename that directory through its parent. Be conservative: any
    # explicit or inherited ALLOW ACE granting a dangerous right to a non-trusted
    # principal blocks this candidate. This is not a substitute for target-PC
    # effective-access testing (nested groups/privileges still matter).
    # FullControl is a composite mask; its bits overlap ordinary read/write rights.
    # Testing it with -band would therefore falsely classify benign ACEs as dangerous.
    # A FullControl ACE necessarily contains each of the specific rights listed below.
    $dangerous = [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership

    $current = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($ProtectedDirectory).TrimEnd('\'))
    while ($current) {
        $acl = Get-Acl -LiteralPath $current -ErrorAction Stop
        foreach ($rule in @($acl.Access)) {
            if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
            # InheritOnly ACEs are not effective on this ancestor itself; they may
            # still be evaluated when that descendant is checked in the loop.
            if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
            $sid = $null
            try {
                $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
            } catch {
                throw "Cannot resolve ACL principal '$($rule.IdentityReference)' on parent path '$current'; refusing ACL operation."
            }
            if ($sid -in $TrustedSids) { continue }
            if (($rule.FileSystemRights -band $dangerous) -ne 0) {
                throw "Parent-path ACL grants delete/rename/ACL-control rights ($($rule.FileSystemRights); inheritance=$($rule.InheritanceFlags); propagation=$($rule.PropagationFlags)) to non-trusted principal '$($rule.IdentityReference)' on '$current'; refusing ACL operation."
            }
        }

        $parent = [System.IO.Path]::GetDirectoryName($current.TrimEnd('\'))
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
}

function Get-TargetFingerprint {
    param([Parameter(Mandatory = $true)][string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    [pscustomobject]@{
        fullName = [string]$item.FullName
        attributes = [int]$item.Attributes
        creationTimeUtcTicks = [long]$item.CreationTimeUtc.Ticks
        lastWriteTimeUtcTicks = [long]$item.LastWriteTimeUtc.Ticks
        length = if ($item -is [System.IO.FileInfo]) { [long]$item.Length } else { $null }
    }
}

function Assert-TargetSetUnchanged {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string[]]$Targets,
        [Parameter(Mandatory = $true)][hashtable]$Fingerprints,
        [Parameter(Mandatory = $true)][string[]]$TrustedSids
    )
    Assert-SafeParentPathMutationRights -ProtectedDirectory $Directory -TrustedSids $TrustedSids
    Assert-NoReparsePath -Path $Directory
    $actual = @(Get-ChildItem -LiteralPath $Directory -Force | ForEach-Object { [string]$_.FullName } | Sort-Object)
    $expected = @($Targets | Where-Object { $_ -ne $Directory } | Sort-Object)
    if (($actual -join "`n") -cne ($expected -join "`n")) {
        throw 'Core DB directory contents changed after validation; refusing further ACL mutations.'
    }
    foreach ($path in $Targets) {
        Assert-NoReparsePath -Path $path
        $current = Get-TargetFingerprint -Path $path
        $prior = $Fingerprints[$path]
        if (-not $prior -or
            $current.fullName -cne $prior.fullName -or
            $current.attributes -ne $prior.attributes -or
            $current.creationTimeUtcTicks -ne $prior.creationTimeUtcTicks -or
            $current.lastWriteTimeUtcTicks -ne $prior.lastWriteTimeUtcTicks -or
            $current.length -ne $prior.length) {
            throw "Target identity fingerprint changed after validation; refusing further ACL mutations: $path"
        }
    }
}

function New-BoundaryAcl {
    param([System.Security.AccessControl.FileSystemSecurity]$CurrentAcl, [string]$CoreAccount, [switch]$Directory)
    $acl = $CurrentAcl
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $acl.SetOwner((New-Object System.Security.Principal.NTAccount('BUILTIN\Administrators')))
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
    if ($Directory) {
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
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
if (@(@($core.sid, $provider.sid, $gateway.sid) | Select-Object -Unique).Count -ne 3) {
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
$directory = [System.IO.Path]::GetDirectoryName($dbPath)
# Reject reparse points in every existing component, not only the leaf and immediate parent.
Assert-NoReparsePath -Path $dbPath
Assert-NoReparsePath -Path $directory
Assert-SafeParentPathMutationRights -ProtectedDirectory $directory -TrustedSids @($core.sid, 'S-1-5-18', 'S-1-5-32-544')

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

$targets = @($directory) + @(Get-ChildItem -LiteralPath $directory -Force | ForEach-Object { [string]$_.FullName })
# Allowed names do not make a sidecar trustworthy: inspect every existing target and ancestor.
foreach ($target in $targets) { Assert-NoReparsePath -Path $target }
$targetFingerprints = @{}
foreach ($target in $targets) { $targetFingerprints[$target] = Get-TargetFingerprint -Path $target }
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
        'Path-chain, reparse-point, directory-content, and observable fingerprint checks narrow TOCTOU exposure but do not eliminate hostile concurrent replacement.',
        'Before applying, stop/quiesce all untrusted processes that can write the DB directory or its ancestors; this script cannot enforce that operational precondition.',
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
        # Revalidate the full path chain, exact directory contents, and observable target fingerprint
        # immediately before each mutation. This narrows but cannot eliminate a hostile local TOCTOU race.
        Assert-TargetSetUnchanged -Directory $directory -Targets $targets -Fingerprints $targetFingerprints -TrustedSids @($core.sid, 'S-1-5-18', 'S-1-5-32-544')
        $current = Get-Acl -LiteralPath $target
        $isDirectory = ([System.IO.File]::GetAttributes($target) -band [System.IO.FileAttributes]::Directory) -ne 0
        $replacement = New-BoundaryAcl -CurrentAcl $current -CoreAccount $core.account -Directory:$isDirectory
        Assert-TargetSetUnchanged -Directory $directory -Targets $targets -Fingerprints $targetFingerprints -TrustedSids @($core.sid, 'S-1-5-18', 'S-1-5-32-544')
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
