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
if (-not (Test-Path -LiteralPath (Join-Path $InstallDirectory 'src\index.js') -PathType Leaf)) { throw "Logic-Engine entry point not found." }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable not found." }
if (-not (Test-Path -LiteralPath $StateDirectory -PathType Container)) { New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null }
if ($EnvironmentFile -and -not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "EnvironmentFile does not exist." }
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw "Service already exists; refusing to replace it." }
$account = "NT SERVICE\$ServiceName"
$entry = Join-Path $InstallDirectory 'src\index.js'
$binary = '"' + $NodePath + '" "' + $entry + '"'
if ($PSCmdlet.ShouldProcess($ServiceName, "Create isolated virtual-service-account service")) {
  Invoke-Sc @("create", $ServiceName, "binPath=", $binary, "start=", "demand", "obj=", $account, "password=", "")
  try {
    Invoke-Sc @("sidtype", $ServiceName, "unrestricted")
    $sid = (New-Object System.Security.Principal.NTAccount($account)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    & icacls.exe $StateDirectory /inheritance:r /grant:r "*$($sid):(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Failed to protect state directory ACL." }
    if ($EnvironmentFile) {
      & icacls.exe $EnvironmentFile /inheritance:r /grant:r "*$($sid):R" "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Host
      if ($LASTEXITCODE -ne 0) { throw "Failed to protect environment file ACL." }
    }
    Invoke-Sc @("config", $ServiceName, "start=", "auto")
  } catch {
    & sc.exe stop $ServiceName | Out-Null
    & sc.exe delete $ServiceName | Out-Null
    throw
  }
}
Write-Output "Provisioned service: $ServiceName"
Write-Output "Service identity: $account"
Write-Output "State directory: $StateDirectory"
Write-Output "Do not start until all SQLite paths and secure-VFS production gates are configured."
