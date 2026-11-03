[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][string]$ServiceName,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$StateDirectory,
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$EnvironmentFile = ""
)
$ErrorActionPreference = "Stop"
function Invoke-Sc([string[]]$Arguments) {
  & sc.exe @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "sc.exe failed: $($Arguments -join ' ')" }
}
if ($ServiceName -notmatch '^[A-Za-z][A-Za-z0-9_.-]{2,79}$') { throw "Invalid service name." }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$StateDirectory = [IO.Path]::GetFullPath($StateDirectory)
$NodePath = [IO.Path]::GetFullPath($NodePath)
function Test-PathWithin([string]$Parent, [string]$Candidate) {
  $separator = [string][IO.Path]::DirectorySeparatorChar
  $trimChars = [char[]]@([char]92, [char]47)
  $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd($trimChars)
  $candidatePath = [IO.Path]::GetFullPath($Candidate).TrimEnd($trimChars)
  return $candidatePath.Equals($parentPath, [StringComparison]::OrdinalIgnoreCase) -or
    $candidatePath.StartsWith($parentPath + $separator, [StringComparison]::OrdinalIgnoreCase)
}
if ((Test-PathWithin $InstallDirectory $StateDirectory) -or
    (Test-PathWithin $StateDirectory $InstallDirectory)) {
  throw "InstallDirectory and StateDirectory must be separate, non-overlapping trees."
}
if (-not (Test-Path -LiteralPath (Join-Path $InstallDirectory 'src\index.js') -PathType Leaf)) { throw "Logic-Engine entry point not found." }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable not found." }
if ($EnvironmentFile -and -not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "EnvironmentFile does not exist." }
function Assert-NoReparsePoints([string]$Path) {
  $root = Get-Item -LiteralPath $Path -Force
  if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Security-sensitive tree root must not be a reparse point: $Path"
  }
  foreach ($item in (Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction Stop)) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Security-sensitive tree contains a reparse point: $($item.FullName)"
    }
  }
}
function Assert-NoReparsePointAncestors([string]$Path) {
  # Check the complete existing path chain before creating state directories or
  # installing a service. Checking only the final tree root is too late when
  # an ancestor redirects the path through a junction or symbolic link.
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Security-sensitive path contains a reparse-point ancestor: $current"
      }
    }
    $parent = [IO.Directory]::GetParent($current)
    if (-not $parent) { break }
    $current = $parent.FullName
  }
}
function Set-PrivateFileAcl([string]$Path, [string]$ServiceSid) {
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Environment file must not be a reparse point: $Path"
  }
  & icacls.exe $Path /reset /C | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Failed to reset environment-file ACL: $Path" }
  & icacls.exe $Path /inheritance:r /C | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Failed to remove inherited environment-file ACL: $Path" }
  & icacls.exe $Path /grant:r "*$($ServiceSid):R" "*S-1-5-18:F" "*S-1-5-32-544:F" /C | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Failed to apply environment-file ACL: $Path" }
  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) { throw "Environment-file inherited ACLs remain enabled: $Path" }
  $rules = $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])
  $allowed = @($ServiceSid, "S-1-5-18", "S-1-5-32-544")
  foreach ($rule in $rules) {
    if ($rule.IdentityReference.Value -notin $allowed -or
        $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
      throw "Unexpected environment-file ACL principal or deny rule remains: $Path"
    }
  }
  foreach ($sid in $allowed) {
    $required = if ($sid -eq $ServiceSid) {
      [Security.AccessControl.FileSystemRights]::Read
    } else {
      [Security.AccessControl.FileSystemRights]::FullControl
    }
    $present = $rules | Where-Object {
      $_.IdentityReference.Value -eq $sid -and
      $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
      (([int]$_.FileSystemRights -band [int]$required) -eq [int]$required)
    }
    if (-not $present) { throw "Required environment-file ACL is missing for ${sid}: $Path" }
  }
}
function Set-PrivateTreeAcl([string]$Path, [string]$ServiceSid, [string]$ServiceRights) {
  # Reset every existing child first; root-only ACL edits leave stale explicit
  # grants on pre-existing descendants and do not establish a tree boundary.
  & icacls.exe $Path /reset /T /C | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Failed to reset existing ACLs recursively: $Path" }
  & icacls.exe $Path /inheritance:r /T /C | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Failed to remove inherited ACLs recursively: $Path" }
  & icacls.exe $Path /grant:r "*$($ServiceSid):(OI)(CI)$($ServiceRights)" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /T /C | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Failed to apply recursive private ACLs: $Path" }
  $allowed = @($ServiceSid, "S-1-5-18", "S-1-5-32-544")
  $required = if ($ServiceRights -eq "RX") {
    [Security.AccessControl.FileSystemRights]::ReadAndExecute
  } else {
    [Security.AccessControl.FileSystemRights]::FullControl
  }
  $items = @((Get-Item -LiteralPath $Path -Force)) + @(Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction Stop)
  foreach ($item in $items) {
    $acl = Get-Acl -LiteralPath $item.FullName
    if (-not $acl.AreAccessRulesProtected) {
      throw "Inherited ACLs remain enabled after hardening: $($item.FullName)"
    }
    $rules = $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
      if ($rule.IdentityReference.Value -notin $allowed -or
          $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
        throw "Unexpected ACL principal or deny rule remains: $($item.FullName)"
      }
    }
    foreach ($sid in $allowed) {
      $requiredRights = if ($sid -eq $ServiceSid) { $required } else {
        [Security.AccessControl.FileSystemRights]::FullControl
      }
      $present = $rules | Where-Object {
        $_.IdentityReference.Value -eq $sid -and
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        (([int]$_.FileSystemRights -band [int]$requiredRights) -eq [int]$requiredRights)
      }
      if (-not $present) { throw "Required ACL is missing for $sid on $($item.FullName)" }
    }
  }
}
# Validate all existing path components before creating directories or service state.
Assert-NoReparsePointAncestors $InstallDirectory
Assert-NoReparsePointAncestors $StateDirectory
Assert-NoReparsePointAncestors $NodePath
if ($EnvironmentFile) { Assert-NoReparsePointAncestors $EnvironmentFile }
$nodeVersionOutput = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $nodeVersionOutput -notmatch '^v(\d+)\.(\d+)\.(\d+)# Dry-run must inspect existing descendants too; repeat immediately before ACL
# mutation inside ShouldProcess to narrow the validation-to-use window.
Assert-NoReparsePoints $InstallDirectory
if (Test-Path -LiteralPath $StateDirectory) {
  if (-not (Test-Path -LiteralPath $StateDirectory -PathType Container)) {
    throw "StateDirectory exists but is not a directory: $StateDirectory"
  }
  Assert-NoReparsePoints $StateDirectory
}
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw "Service already exists; refusing to replace it." }
$account = "NT SERVICE\$ServiceName"
$entry = Join-Path $InstallDirectory 'src\index.js'
$binary = '"' + $NodePath + '" "' + $entry + '"'
if ($PSCmdlet.ShouldProcess($ServiceName, "Create isolated virtual-service-account service")) {
  try {
    # Keep -WhatIf side-effect free: create writable state only after approval.
    if (-not (Test-Path -LiteralPath $StateDirectory -PathType Container)) {
      New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    }
    Invoke-Sc @("create", $ServiceName, "binPath=", $binary, "start=", "demand", "obj=", $account, "password=", "")
    Invoke-Sc @("sidtype", $ServiceName, "unrestricted")
    $sid = (New-Object System.Security.Principal.NTAccount($account)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    # Reject reparse points before recursive ACL changes; ancestors still must be admin-controlled.
    Assert-NoReparsePoints $InstallDirectory
    Assert-NoReparsePoints $StateDirectory
    # The service may execute/read application files but cannot replace its own code.
    Set-PrivateTreeAcl $InstallDirectory $sid "RX"
    Set-PrivateTreeAcl $StateDirectory $sid "F"
    if ($EnvironmentFile) {
      Set-PrivateFileAcl $EnvironmentFile $sid
    }
    Invoke-Sc @("config", $ServiceName, "start=", "auto")
  } catch {
    & sc.exe stop $ServiceName | Out-Null
    & sc.exe delete $ServiceName | Out-Null
    throw
  }
  Write-Output "Provisioned service: $ServiceName"
  Write-Output "Service identity: $account"
  Write-Output "State directory: $StateDirectory"
  Write-Output "Do not start until all SQLite paths and secure-VFS production gates are configured."
} else {
  Write-Output "No provisioning changes were made (WhatIf or confirmation declined)."
}
) {
  throw "Unable to determine the configured Node.js runtime version: $NodePath"
}
$nodeVersion = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
if ($nodeVersion -lt [version]'22.14.0') {
  throw "Node.js 22.14.0 or newer is required for the SQLite addon runtime; found $nodeVersion"
}
# Dry-run must inspect existing descendants too; repeat immediately before ACL
# mutation inside ShouldProcess to narrow the validation-to-use window.
Assert-NoReparsePoints $InstallDirectory
if (Test-Path -LiteralPath $StateDirectory) {
  if (-not (Test-Path -LiteralPath $StateDirectory -PathType Container)) {
    throw "StateDirectory exists but is not a directory: $StateDirectory"
  }
  Assert-NoReparsePoints $StateDirectory
}
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw "Service already exists; refusing to replace it." }
$account = "NT SERVICE\$ServiceName"
$entry = Join-Path $InstallDirectory 'src\index.js'
$binary = '"' + $NodePath + '" "' + $entry + '"'
if ($PSCmdlet.ShouldProcess($ServiceName, "Create isolated virtual-service-account service")) {
  try {
    # Keep -WhatIf side-effect free: create writable state only after approval.
    if (-not (Test-Path -LiteralPath $StateDirectory -PathType Container)) {
      New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    }
    Invoke-Sc @("create", $ServiceName, "binPath=", $binary, "start=", "demand", "obj=", $account, "password=", "")
    Invoke-Sc @("sidtype", $ServiceName, "unrestricted")
    $sid = (New-Object System.Security.Principal.NTAccount($account)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    # Reject reparse points before recursive ACL changes; ancestors still must be admin-controlled.
    Assert-NoReparsePoints $InstallDirectory
    Assert-NoReparsePoints $StateDirectory
    # The service may execute/read application files but cannot replace its own code.
    Set-PrivateTreeAcl $InstallDirectory $sid "RX"
    Set-PrivateTreeAcl $StateDirectory $sid "F"
    if ($EnvironmentFile) {
      Set-PrivateFileAcl $EnvironmentFile $sid
    }
    Invoke-Sc @("config", $ServiceName, "start=", "auto")
  } catch {
    & sc.exe stop $ServiceName | Out-Null
    & sc.exe delete $ServiceName | Out-Null
    throw
  }
  Write-Output "Provisioned service: $ServiceName"
  Write-Output "Service identity: $account"
  Write-Output "State directory: $StateDirectory"
  Write-Output "Do not start until all SQLite paths and secure-VFS production gates are configured."
} else {
  Write-Output "No provisioning changes were made (WhatIf or confirmation declined)."
}
