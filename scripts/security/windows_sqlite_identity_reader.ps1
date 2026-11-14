param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$ProbeScript,
  [Parameter(Mandatory = $true)][string]$DatabasePath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$exitCode = 1
$previousNoWarnings = $env:NODE_NO_WARNINGS
$previousPreference = $ErrorActionPreference
try {
  $identity = & (Join-Path $env:SystemRoot 'System32\\whoami.exe')
  if ($LASTEXITCODE -ne 0) { throw "whoami failed with exit code $LASTEXITCODE" }

  # PowerShell 5.1 promotes native stderr to ErrorRecord objects under Stop.
  # The SQLite experimental notice is not a probe failure; suppress it and
  # preserve the actual Node process exit code.
  $env:NODE_NO_WARNINGS = '1'
  $ErrorActionPreference = 'Continue'
  $probeOutput = & $NodePath $ProbeScript reader $DatabasePath 2>&1
  $exitCode = $LASTEXITCODE
  @("Windows identity: $identity") + @($probeOutput | ForEach-Object { "$_" }) |
    Set-Content -LiteralPath $OutputPath -Encoding UTF8
} catch {
  $ErrorActionPreference = 'Continue'
  @("Windows identity reader failed: $_") |
    Set-Content -LiteralPath $OutputPath -Encoding UTF8
  $exitCode = 1
} finally {
  $env:NODE_NO_WARNINGS = $previousNoWarnings
  $ErrorActionPreference = $previousPreference
  Set-Content -LiteralPath $ResultPath -Value $exitCode -Encoding ASCII
}
exit $exitCode
