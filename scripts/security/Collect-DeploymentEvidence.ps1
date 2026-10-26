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
    param([string]$InputPath)

    $resolved = $null
    try {
        $resolved = [System.IO.Path]::GetFullPath($InputPath)
    } catch {
        return @([pscustomobject]@{ requestedPath = $InputPath; exists = $false; error = "Invalid path" })
    }

    $targets = New-Object System.Collections.Generic.List[string]
    $current = $resolved
    while ($current) {
        if (-not $targets.Contains($current)) { $targets.Add($current) }
        $parent = Split-Path -LiteralPath $current -Parent
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }

    $results = New-Object System.Collections.Generic.List[object]
    foreach ($target in $targets) {
        $item = Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        if (-not $item) {
            $results.Add([pscustomobject]@{
                requestedPath = $InputPath
                path = $target
                exists = $false
                owner = $null
                sddl = $null
                accessRules = @()
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

    # SQLite sidecars are siblings of the database and must be checked independently.
    foreach ($suffix in @("-wal", "-shm", "-journal")) {
        $sidecar = "$resolved$suffix"
        $item = Get-Item -LiteralPath $sidecar -Force -ErrorAction SilentlyContinue
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
                exists = $false
                itemType = "SQLite sidecar"
                owner = $null
                sddl = $null
                accessRules = @()
                error = $null
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

$pathInputs = @($DataPath) + @($BackupPath) | Where-Object { $_ } | Select-Object -Unique
$pathEvidence = @(
    foreach ($path in $pathInputs) {
        Get-PathAclEvidence -InputPath $path
    }
)

$tcpEvidence = @()
try {
    $tcpEvidence = @(
        Get-NetTCPConnection -State Established -ErrorAction Stop | ForEach-Object {
            [pscustomobject]@{
                localAddress = [string]$_.LocalAddress
                localPort = [int]$_.LocalPort
                remoteAddress = [string]$_.RemoteAddress
                remotePort = [int]$_.RemotePort
                owningProcessId = [int]$_.OwningProcess
                owningProcessName = [string](($allProcesses | Where-Object ProcessId -eq $_.OwningProcess | Select-Object -First 1).Name)
            }
        }
    )
} catch {
    $tcpEvidence = @([pscustomobject]@{ unavailable = "Get-NetTCPConnection failed or is unavailable" })
}

$firewallEvidence = @()
try {
    $firewallEvidence = @(
        Get-NetFirewallRule -PolicyStore ActiveStore -Direction Outbound -Enabled True -Action Allow -ErrorAction Stop |
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
    $firewallEvidence = @([pscustomobject]@{ unavailable = "Firewall cmdlets failed or are unavailable" })
}

$report = [ordered]@{
    reportType = "Logic Engine deployment security evidence (read-only)"
    generatedUtc = [datetime]::UtcNow.ToString("o")
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
    pathAclEvidence = $pathEvidence
    establishedTcpConnections = $tcpEvidence
    enabledOutboundAllowRules = $firewallEvidence
    limitations = @(
        "Read-only inventory only; no settings or files were changed.",
        "Process lists, ACLs and firewall rules do not by themselves prove exclusive egress or restore resistance.",
        "No connection tests, authorization bypass tests, backup restores or protected requests were executed.",
        "Review and redact machine names, account names, local paths and remote endpoints before sharing."
    )
}

$json = $report | ConvertTo-Json -Depth 10
$fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$parentDir = Split-Path -LiteralPath $fullOutputPath -Parent
if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
    throw "Output directory does not exist: $parentDir"
}
Set-Content -LiteralPath $fullOutputPath -Value $json -Encoding UTF8
Write-Output ("Evidence report written to: " + $fullOutputPath)
Write-Output "No system configuration was changed."
