[CmdletBinding()]
param(
    [string[]]$DataPath = @(),
    [string[]]$BackupPath = @(),
    [int[]]$ProcessId = @(),
    [string[]]$ProcessName = @("node.exe", "python.exe", "pythonw.exe"),
    [string]$OutputPath = ".\security-deployment-audit.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-OwnerForProcess {
    param([uint32]$Id)
    try {
        $result = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter "ProcessId = $Id") -MethodName GetOwner
        if ($result.ReturnValue -eq 0) {
            return ("{0}\{1}" -f $result.Domain, $result.User)
        }
    } catch {}
    return $null
}

function Get-PathAclEvidence {
    param(
        [string]$InputPath,
        [switch]$IncludeDescendants
    )

    $resolved = $null
    try {
        $resolved = [System.IO.Path]::GetFullPath($InputPath)
    } catch {
        return @([pscustomobject]@{ requestedPath = $InputPath; exists = $null; error = "Invalid path" })
    }

    $targets = New-Object System.Collections.Generic.List[string]
    $current = $resolved
    while ($current) {
        if (-not $targets.Contains($current)) { $targets.Add($current) }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }

    $descendantEnumerationError = $null
    if ($IncludeDescendants) {
        try {
            $rootItem = Get-Item -LiteralPath $resolved -Force -ErrorAction Stop
            if (-not $rootItem.PSIsContainer) {
                $descendantEnumerationError = "Backup root is not a directory."
            } else {
                foreach ($child in Get-ChildItem -LiteralPath $resolved -Force -Recurse -ErrorAction Stop) {
                    if (-not $targets.Contains($child.FullName)) { $targets.Add($child.FullName) }
                }
            }
        } catch {
            $category = [string]$_.CategoryInfo.Category
            if ($category -in @("ObjectNotFound", "PathNotFound")) {
                $descendantEnumerationError = "Backup root could not be found: $($_.Exception.GetType().Name)"
            } else {
                $descendantEnumerationError = "Descendant enumeration incomplete: $($_.Exception.GetType().Name)"
            }
        }
    }

    $results = New-Object System.Collections.Generic.List[object]
    foreach ($target in $targets) {
        $item = $null
        try {
            $item = Get-Item -LiteralPath $target -Force -ErrorAction Stop
        } catch {
            $category = [string]$_.CategoryInfo.Category
            $isMissing = $category -in @("ObjectNotFound", "PathNotFound")
            $results.Add([pscustomobject]@{
                requestedPath = $InputPath
                path = $target
                exists = if ($isMissing) { $false } else { $null }
                owner = $null
                sddl = $null
                accessRules = @()
                error = if ($isMissing) { $null } else { "Path lookup failed: $($_.Exception.GetType().Name)" }
            })
            continue
        }

        try {
            $acl = Get-Acl -LiteralPath $target
            $rules = @(
                foreach ($rule in $acl.Access) {
                    [pscustomobject]@{
                        identity = [string]$rule.IdentityReference
                        type = [string]$rule.AccessControlType
                        rights = [string]$rule.FileSystemRights
                        inherited = [bool]$rule.IsInherited
                        inheritanceFlags = [string]$rule.InheritanceFlags
                        propagationFlags = [string]$rule.PropagationFlags
                    }
                }
            )
            $results.Add([pscustomobject]@{
                requestedPath = $InputPath
                path = $target
                exists = $true
                itemType = if ($item.PSIsContainer) { "Directory" } else { "File" }
                owner = [string]$acl.Owner
                sddl = $acl.Sddl
                accessRules = $rules
                error = $null
            })
        } catch {
            $results.Add([pscustomobject]@{
                requestedPath = $InputPath
                path = $target
                exists = $true
                owner = $null
                sddl = $null
                accessRules = @()
                error = "ACL read failed: $($_.Exception.GetType().Name)"
            })
        }
    }

    if ($descendantEnumerationError) {
        $results.Add([pscustomobject]@{
            requestedPath = $InputPath
            path = $resolved
            exists = $null
            itemType = "Descendant enumeration"
            owner = $null
            sddl = $null
            accessRules = @()
            error = $descendantEnumerationError
        })
    }

    # SQLite sidecars are siblings of the database and must be checked independently.
    foreach ($suffix in @("-wal", "-shm", "-journal")) {
        $sidecar = "$resolved$suffix"
        $item = $null
        $sidecarLookupError = $null
        try {
            $item = Get-Item -LiteralPath $sidecar -Force -ErrorAction Stop
        } catch {
            $category = [string]$_.CategoryInfo.Category
            if ($category -notin @("ObjectNotFound", "PathNotFound")) {
                $sidecarLookupError = "Path lookup failed: $($_.Exception.GetType().Name)"
            }
        }
        if ($item) {
            try {
                $acl = Get-Acl -LiteralPath $sidecar
                $results.Add([pscustomobject]@{
                    requestedPath = $InputPath
                    path = $sidecar
                    exists = $true
                    itemType = "SQLite sidecar"
                    owner = [string]$acl.Owner
                    sddl = $acl.Sddl
                    accessRules = @(
                        foreach ($rule in $acl.Access) {
                            [pscustomobject]@{
                                identity = [string]$rule.IdentityReference
                                type = [string]$rule.AccessControlType
                                rights = [string]$rule.FileSystemRights
                                inherited = [bool]$rule.IsInherited
                            }
                        }
                    )
                    error = $null
                })
            } catch {
                $results.Add([pscustomobject]@{
                    requestedPath = $InputPath
                    path = $sidecar
                    exists = $true
                    owner = $null
                    sddl = $null
                    accessRules = @()
                    error = "ACL read failed: $($_.Exception.GetType().Name)"
                })
            }
        } else {
            $results.Add([pscustomobject]@{
                requestedPath = $InputPath
                path = $sidecar
                exists = if ($sidecarLookupError) { $null } else { $false }
                itemType = "SQLite sidecar"
                owner = $null
                sddl = $null
                accessRules = @()
                error = $sidecarLookupError
            })
        }
    }
    return $results.ToArray()
}

$os = Get-CimInstance Win32_OperatingSystem
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$allProcesses = @(Get-CimInstance Win32_Process)
$selectedProcesses = @(
    $allProcesses | Where-Object {
        ($ProcessId -contains [int]$_.ProcessId) -or
        ($ProcessName -contains [string]$_.Name)
    } | ForEach-Object {
        [pscustomobject]@{
            processId = [int]$_.ProcessId
            parentProcessId = [int]$_.ParentProcessId
            name = [string]$_.Name
            executablePath = [string]$_.ExecutablePath
            owner = Get-OwnerForProcess -Id ([uint32]$_.ProcessId)
            creationDate = if ($_.CreationDate) { ([datetime]$_.CreationDate).ToUniversalTime().ToString("o") } else { $null }
            # Command lines are deliberately omitted because they can contain credentials.
        }
    }
)

$selectedProcessIds = @($selectedProcesses | ForEach-Object { [int]$_.processId })
$serviceEvidence = @()
try {
    $serviceEvidence = @(
        Get-CimInstance Win32_Service -ErrorAction Stop |
        Where-Object { $selectedProcessIds -contains [int]$_.ProcessId -and [int]$_.ProcessId -gt 0 } |
        ForEach-Object {
            [pscustomobject]@{
                serviceName = [string]$_.Name
                displayName = [string]$_.DisplayName
                processId = [int]$_.ProcessId
                startName = [string]$_.StartName
                state = [string]$_.State
                startMode = [string]$_.StartMode
            }
        }
    )
} catch {
    $serviceEvidence = @([pscustomobject]@{ unavailable = "Windows service identity query failed or is unavailable" })
}

$pathInputs = @($DataPath) + @($BackupPath) | Where-Object { $_ } | Select-Object -Unique

# Never let the evidence output overwrite an input, SQLite sidecar, or file in a backup tree.
$fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
# Reject NTFS alternate data streams. A stream path can modify the source file while
# appearing to be a distinct output path, bypassing ordinary path-equality checks.
$pathAfterDrive = $fullOutputPath
if ($fullOutputPath.Length -ge 2 -and $fullOutputPath[1] -eq [char]58) {
    $pathAfterDrive = $fullOutputPath.Substring(2)
}
if ($pathAfterDrive.IndexOf([char]58) -ge 0) {
    throw 'OutputPath must not use an NTFS alternate data stream.'
}
# Output ancestors must be real directories, not junctions/symlinks that could redirect the report into a protected tree.
$outputParentDirectory = [System.IO.Path]::GetDirectoryName($fullOutputPath)
if (-not $outputParentDirectory -or -not (Test-Path -LiteralPath $outputParentDirectory -PathType Container)) {
    throw "Output directory does not exist: $outputParentDirectory"
}
$currentOutputParent = $outputParentDirectory
while ($currentOutputParent) {
    $parentItem = Get-Item -LiteralPath $currentOutputParent -Force -ErrorAction Stop
    if (($parentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Output path contains a reparse point; refusing to write evidence: $currentOutputParent"
    }
    $nextOutputParent = [System.IO.Path]::GetDirectoryName($currentOutputParent.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar))
    if (-not $nextOutputParent -or $nextOutputParent -eq $currentOutputParent) { break }
    $currentOutputParent = $nextOutputParent
}
foreach ($dataFile in @($DataPath | Where-Object { $_ })) {
    try {
        $fullDataPath = [System.IO.Path]::GetFullPath($dataFile)
    } catch {
        # Let Get-PathAclEvidence record the invalid input as unknown/incomplete below.
        continue
    }
    if ([string]::Equals($fullOutputPath, $fullDataPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputPath must not overwrite a supplied data path: $fullDataPath"
    }
    foreach ($suffix in @("-wal", "-shm", "-journal")) {
        if ([string]::Equals($fullOutputPath, "$fullDataPath$suffix", [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "OutputPath must not overwrite a SQLite sidecar: $fullDataPath$suffix"
        }
    }
}
foreach ($backupRoot in @($BackupPath | Where-Object { $_ })) {
    try {
        $fullBackupRoot = [System.IO.Path]::GetFullPath($backupRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    } catch {
        # An invalid backup path is reported as incomplete by Get-PathAclEvidence.
        continue
    }
    $backupPrefix = $fullBackupRoot + [System.IO.Path]::DirectorySeparatorChar
    if ($fullOutputPath.StartsWith($backupPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($fullOutputPath, $fullBackupRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputPath must be outside supplied backup roots: $fullBackupRoot"
    }
}
if (Test-Path -LiteralPath $fullOutputPath) {
    throw "OutputPath already exists; choose a new path to preserve prior evidence: $fullOutputPath"
}
$pathEvidence = @(
    foreach ($path in $pathInputs) {
        $isBackupPath = $BackupPath -contains $path
        Get-PathAclEvidence -InputPath $path -IncludeDescendants:$isBackupPath
    }
)

$tcpEvidence = @()
try {
    $tcpEvidence = @(
        Get-NetTCPConnection -State Established -ErrorAction Stop | ForEach-Object {
            $connection = $_
            $ownerProcess = $allProcesses | Where-Object { [int]$_.ProcessId -eq [int]$connection.OwningProcess } | Select-Object -First 1
            [pscustomobject]@{
                localAddress = [string]$connection.LocalAddress
                localPort = [int]$connection.LocalPort
                remoteAddress = [string]$connection.RemoteAddress
                remotePort = [int]$connection.RemotePort
                owningProcessId = [int]$connection.OwningProcess
                owningProcessName = [string]$ownerProcess.Name
            }
        }
    )
} catch {
    $tcpEvidence = @([pscustomobject]@{ unavailable = "Get-NetTCPConnection failed or is unavailable" })
}

$firewallProfiles = @()
try {
    $firewallProfiles = @(
        Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop | ForEach-Object {
            [pscustomobject]@{
                name = [string]$_.Name
                enabled = [bool]$_.Enabled
                defaultInboundAction = [string]$_.DefaultInboundAction
                defaultOutboundAction = [string]$_.DefaultOutboundAction
                allowInboundRules = [string]$_.AllowInboundRules
                allowLocalFirewallRules = [string]$_.AllowLocalFirewallRules
            }
        }
    )
} catch {
    $firewallProfiles = @([pscustomobject]@{ unavailable = "Firewall profile query failed or is unavailable" })
}

$outboundFirewallRules = @()
$outboundFirewallRulesAvailable = $true
try {
    $outboundFirewallRules = @(
        Get-NetFirewallRule -PolicyStore ActiveStore -Direction Outbound -Enabled True -ErrorAction Stop |
        Where-Object { [string]$_.Action -in @("Allow", "Block") } |
        ForEach-Object {
            $rule = $_
            $app = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
            $addr = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
            $port = Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
            $svc = Get-NetFirewallServiceFilter -AssociatedNetFirewallRule $rule -ErrorAction SilentlyContinue
            [pscustomobject]@{
                name = [string]$rule.Name
                displayName = [string]$rule.DisplayName
                profile = [string]$rule.Profile
                program = [string]$app.Program
                service = [string]$svc.Service
                remoteAddress = [string]$addr.RemoteAddress
                protocol = [string]$port.Protocol
                remotePort = [string]$port.RemotePort
                action = [string]$rule.Action
            }
        }
    )
} catch {
    $outboundFirewallRulesAvailable = $false
    $outboundFirewallRules = @([pscustomobject]@{ unavailable = "Outbound firewall rule query failed or is unavailable" })
}
$firewallAllowRules = @($outboundFirewallRules | Where-Object { $_.action -eq "Allow" })
$firewallBlockRules = @($outboundFirewallRules | Where-Object { $_.action -eq "Block" })

$incompleteReasons = New-Object System.Collections.Generic.List[string]
if (@($pathEvidence | Where-Object { $_.error }).Count -gt 0) {
    $incompleteReasons.Add("One or more path, ACL, SQLite-sidecar, or backup-tree queries reported an error.")
}
if (@($pathEvidence | Where-Object { $_.PSObject.Properties.Name -contains "exists" -and $null -eq $_.exists }).Count -gt 0) {
    $incompleteReasons.Add("At least one path existence result is unknown.")
}
if (@($serviceEvidence | Where-Object { $_.PSObject.Properties.Name -contains "unavailable" }).Count -gt 0) {
    $incompleteReasons.Add("Windows service identity evidence is unavailable.")
}
if (@($tcpEvidence | Where-Object { $_.PSObject.Properties.Name -contains "unavailable" }).Count -gt 0) {
    $incompleteReasons.Add("Established TCP connection evidence is unavailable.")
}
if (@($firewallProfiles | Where-Object { $_.PSObject.Properties.Name -contains "unavailable" }).Count -gt 0) {
    $incompleteReasons.Add("Active firewall profile evidence is unavailable.")
}
if (-not $outboundFirewallRulesAvailable) {
    $incompleteReasons.Add("Enabled outbound firewall rule evidence is unavailable.")
}

$report = [ordered]@{
    reportType = "Logic Engine deployment security evidence (read-only)"
    generatedUtc = [datetime]::UtcNow.ToString("o")
    collectionStatus = if ($incompleteReasons.Count -gt 0) { "INCOMPLETE" } else { "COLLECTED_NO_QUERY_ERRORS" }
    incompleteReasons = @($incompleteReasons.ToArray())
    machineName = $env:COMPUTERNAME
    userIdentity = [string]$identity.Name
    elevated = $isAdmin
    os = [ordered]@{
        caption = [string]$os.Caption
        version = [string]$os.Version
        buildNumber = [string]$os.BuildNumber
        architecture = [string]$os.OSArchitecture
        powershellVersion = [string]$PSVersionTable.PSVersion
    }
    processEvidence = $selectedProcesses
    serviceEvidence = $serviceEvidence
    pathAclEvidence = $pathEvidence
    establishedTcpConnections = $tcpEvidence
    firewallProfiles = $firewallProfiles
    outboundFirewallRulesAvailable = $outboundFirewallRulesAvailable
    enabledOutboundAllowRules = $firewallAllowRules
    enabledOutboundBlockRules = $firewallBlockRules
    limitations = @(
        "Read-only inventory only; no settings or files were changed.",
        "An inaccessible path is reported as unknown, not as absent; validate all unknown/error entries manually.",
        "Backup directories are enumerated recursively; any enumeration error means backup ACL evidence is incomplete.",
        "Service identity evidence covers Windows services whose process IDs match the selected processes; it does not discover every wrapper/child-process relationship.",
        "Firewall profile defaults and enabled outbound allow/block rules are inventory evidence only and do not prove exclusive egress or restore resistance.",
        "No connection tests, authorization bypass tests, backup restores or protected requests were executed.",
        "Review and redact machine names, account names, local paths and remote endpoints before sharing."
    )
}

$json = $report | ConvertTo-Json -Depth 10
$parentDir = [System.IO.Path]::GetDirectoryName($fullOutputPath)
if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
    throw "Output directory does not exist: $parentDir"
}
$encoding = New-Object System.Text.UTF8Encoding($false)
$outputBytes = $encoding.GetBytes($json + [Environment]::NewLine)
$outputStream = $null
$outputCreated = $false
try {
    # CreateNew closes the check/write race and never truncates a file created by another process.
    $outputStream = [System.IO.File]::Open(
        $fullOutputPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    $outputCreated = $true
    $outputStream.Write($outputBytes, 0, $outputBytes.Length)
    $outputStream.Flush($true)
} catch {
    if ($outputStream) { $outputStream.Dispose(); $outputStream = $null }
    if ($outputCreated -and (Test-Path -LiteralPath $fullOutputPath -PathType Leaf)) {
        try { Remove-Item -LiteralPath $fullOutputPath -Force -ErrorAction Stop } catch {}
    }
    throw
} finally {
    if ($outputStream) { $outputStream.Dispose() }
}
Write-Output ("Evidence report written to: " + $fullOutputPath)
Write-Output "No system configuration was changed."
