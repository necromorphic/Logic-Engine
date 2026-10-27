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

function Assert-NoReparsePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $current = [System.IO.Path]::GetFullPath($Path)
    while ($current) {
        if (-not (Test-Path -LiteralPath $current)) {
            throw "Path component does not exist; refusing ACL operation: $current"
        }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Path component is a reparse point; refusing ACL operation: $current"
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
    $dangerous = [System.Security.AccessControl.FileSystemRights]::Delete -bor
        [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [System.Security.AccessControl.FileSystemRights]::TakeOwnership
    $current = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($ProtectedDirectory).TrimEnd('\'))
    while ($current) {
        $acl = Get-Acl -LiteralPath $current -ErrorAction Stop
        foreach ($rule in @($acl.Access)) {
            if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
            if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
            try {
                $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
            } catch {
                throw "Cannot resolve ACL principal '$($rule.IdentityReference)' on parent path '$current'; refusing ACL operation."
            }
            if ($sid -in $TrustedSids) { continue }
            if (($rule.FileSystemRights -band $dangerous) -ne 0) {
                throw "Parent path grants directory replacement/ACL-control rights to non-trusted principal '$($rule.IdentityReference)' on '$current'; refusing ACL operation."
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
        throw 'Authority database directory contents changed after validation; refusing further ACL mutations.'
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
$directory = [System.IO.Path]::GetDirectoryName($dbPath)
Assert-NoReparsePath -Path $dbPath
Assert-NoReparsePath -Path $directory

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
    Assert-NoReparsePath -Path $storeFile
    Assert-NoReparsePath -Path $store.path
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
    Assert-NoReparsePath -Path $backupPath
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
$targets = @($directory) + @(Get-ChildItem -LiteralPath $directory -Force | ForEach-Object { [string]$_.FullName })
foreach ($target in $targets) { Assert-NoReparsePath -Path $target }
$targetFingerprints = @{}
foreach ($target in $targets) { $targetFingerprints[$target] = Get-TargetFingerprint -Path $target }
$trustedParentSids = @($authority.sid, 'S-1-5-18', 'S-1-5-32-544')
Assert-SafeParentPathMutationRights -ProtectedDirectory $directory -TrustedSids $trustedParentSids
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
        Assert-TargetSetUnchanged -Directory $directory -Targets $targets -Fingerprints $targetFingerprints -TrustedSids $trustedParentSids
        $current = Get-Acl -LiteralPath $target
        $isDirectory = ([System.IO.File]::GetAttributes($target) -band [System.IO.FileAttributes]::Directory) -ne 0
        $replacement = New-AuthorityAcl -CurrentAcl $current -AuthorityAccount $authority.account -Directory:$isDirectory
        Assert-TargetSetUnchanged -Directory $directory -Targets $targets -Fingerprints $targetFingerprints -TrustedSids $trustedParentSids
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
