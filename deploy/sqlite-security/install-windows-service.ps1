[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ServiceName,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$StateDirectory,
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$EnvironmentFile = ""
)

$ErrorActionPreference = "Stop"

# Deliberately fail closed. node.exe is a console process, not a Windows
# Service Control Manager service host. Registering it directly with sc.exe
# would create a misleading service that cannot reliably report/handle SCM
# lifecycle events. Merely ACL-protecting EnvironmentFile also does not load
# it into the child process environment.
throw @"
Windows service installation is currently disabled for Issue #770.

The previous prototype registered node.exe directly with the Service Control
Manager and did not inject EnvironmentFile values into the process. That is
not a valid Windows service adapter and must not be used.

A reviewed SCM-aware service host, explicit environment loading, service
recovery policy, and Windows integration tests are required before enabling
installation. No service, directory, or ACL has been changed.
"@
