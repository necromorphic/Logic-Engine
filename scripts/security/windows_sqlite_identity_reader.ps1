param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$ProbeScript,
  [Parameter(Mandatory = $true)][string]$DatabasePath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$exitCode = 1
try {
  $identity = & (Join-Path $env:SystemRoot 'System32\\whoami.exe')
  if ($LASTEXITCODE -ne 0) { throw "whoami failed with exit code $LASTEXITCODE" }
  $probeOutput = & $NodePath $ProbeScript reader $DatabasePath 2>&1
  $exitCode = $LASTEXITCODE
  @("Windows identity: $identity") + @($probeOutput | ForEach-Object { "$_" }) |
    Set-Content -LiteralPath $OutputPath -Encoding UTF8
} catch {
  @("Windows identity reader failed: $_") |
    Set-Content -LiteralPath $OutputPath -Encoding UTF8
  $exitCode = 1
} finally {
  Set-Content -LiteralPath $ResultPath -Value $exitCode -Encoding ASCII
}
exit $exitCode
