$ErrorActionPreference = 'Stop'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 5)
$roles = @('Authority', 'Core', 'Provider', 'Gateway')
$testAccounts = @()
$testServices = @()
$password = ([guid]::NewGuid().ToString('N') + 'Aa1!')
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$root = $null
$evidence = $null

# Unit-test the production maintenance gate without touching ACLs or services.
$productionScript = Join-Path $PSScriptRoot 'Set-AcceptedHeadAuthorityAcl.ps1'
$tokens = $null
$parseErrors = $null
$productionAst = [System.Management.Automation.Language.Parser]::ParseFile($productionScript, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Production ACL script has PowerShell parse errors.' }
$gateFunctionAst = $productionAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-ServicesStopped'
}, $true)
if (-not $gateFunctionAst) { throw 'Production maintenance precondition function is missing.' }
. ([scriptblock]::Create($gateFunctionAst.Extent.Text))
$adminGateFunctionAst = $productionAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-ServiceIdentitiesNotLocalAdministrators'
}, $true)
if (-not $adminGateFunctionAst) { throw 'Production local-Administrators precondition function is missing.' }
. ([scriptblock]::Create($adminGateFunctionAst.Extent.Text))

# Mock the live service lookup so tests prove that the gate re-queries state rather than
# trusting the stale preflight snapshot passed to it.
$script:gateServiceFixtures = @{}
function Get-ServiceIdentity {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not $script:gateServiceFixtures.ContainsKey($Name)) {
    throw "Fixture service not found: $Name"
  }
  return $script:gateServiceFixtures[$Name]
}
function Assert-GateRejects {
  param(
    [Parameter(Mandatory = $true)]$Snapshot,
    [Parameter(Mandatory = $true)]$Current,
    [Parameter(Mandatory = $true)][string]$ExpectedMessage
  )
  $script:gateServiceFixtures[$Snapshot.serviceName] = $Current
  $rejected = $false
  try { Assert-ServicesStopped -Services @($Snapshot) } catch {
    $rejected = $_.Exception.Message -match $ExpectedMessage
  }
  if (-not $rejected) { throw "Maintenance gate failed to reject fixture state for $($Snapshot.serviceName)." }
}
$fixtureSid = 'S-1-5-21-100-200-300-1001'
$stoppedSnapshot = [pscustomobject]@{
  serviceName = 'FixtureService'; state = 'Stopped'; processId = 0; sid = $fixtureSid
}
Assert-GateRejects -Snapshot $stoppedSnapshot -Current ([pscustomobject]@{
  serviceName = 'FixtureService'; state = 'Running'; processId = 123; sid = $fixtureSid
}) -ExpectedMessage 'Maintenance precondition failed'
Assert-GateRejects -Snapshot $stoppedSnapshot -Current ([pscustomobject]@{
  serviceName = 'FixtureService'; state = 'Stopped'; processId = 42; sid = $fixtureSid
}) -ExpectedMessage 'Maintenance precondition failed'
Assert-GateRejects -Snapshot $stoppedSnapshot -Current ([pscustomobject]@{
  serviceName = 'FixtureService'; state = 'Stopped'; processId = 0; sid = 'S-1-5-21-100-200-300-1002'
}) -ExpectedMessage 'service identity changed'
$script:gateServiceFixtures['FixtureService'] = [pscustomobject]@{
  serviceName = 'FixtureService'; state = 'Stopped'; processId = 0; sid = $fixtureSid
}
Assert-ServicesStopped -Services @($stoppedSnapshot)

$gateCalls = @($productionAst.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Assert-ServicesStopped'
}, $true))
$aclWrites = @($productionAst.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Set-Acl'
}, $true))
if ($gateCalls.Count -lt 2 -or $aclWrites.Count -lt 1) {
  throw 'Expected repeated maintenance checks and ACL writes were not found in the production script.'
}
$adminGateCalls = @($productionAst.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Assert-ServiceIdentitiesNotLocalAdministrators'
}, $true))
if ($adminGateCalls.Count -lt 1 -or $adminGateCalls[0].Extent.StartOffset -ge $aclWrites[0].Extent.StartOffset) {
  throw 'Local-Administrators gate must run before the first ACL write.'
}
if ($gateCalls[0].Extent.StartOffset -ge $aclWrites[0].Extent.StartOffset -or
    $gateCalls[1].Extent.StartOffset -ge $aclWrites[0].Extent.StartOffset) {
  throw 'Maintenance gate must be invoked before the first ACL write and again near each write.'
}

try {
  foreach ($role in $roles) {
    $account = "leHead$role$suffix"
    $service = "LEHead$role$suffix"
    New-LocalUser -Name $account -Password $securePassword -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    $testAccounts += $account
    $accountName = "$env:COMPUTERNAME\$account"
    & sc.exe create $service binPath= "$env:WINDIR\System32\cmd.exe /c exit" obj= $accountName password= $password start= demand | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to create disposable service identity fixture for $role." }
    $testServices += $service
  }
  # Regression: a service identity that is a direct local Administrator must be refused.
  $administratorsGroupName = (Get-LocalGroup -SID 'S-1-5-32-544' -ErrorAction Stop).Name
  $testProviderSid = (New-Object System.Security.Principal.NTAccount("$env:COMPUTERNAME\$($testAccounts[2])")).Translate([System.Security.Principal.SecurityIdentifier]).Value
  Add-LocalGroupMember -Group $administratorsGroupName -Member "$env:COMPUTERNAME\$($testAccounts[2])"
  try {
    $serviceObjects = @(
      [pscustomobject]@{ serviceName = 'Authority'; sid = (New-Object System.Security.Principal.NTAccount("$env:COMPUTERNAME\$($testAccounts[0])")).Translate([System.Security.Principal.SecurityIdentifier]).Value },
      [pscustomobject]@{ serviceName = 'Core'; sid = (New-Object System.Security.Principal.NTAccount("$env:COMPUTERNAME\$($testAccounts[1])")).Translate([System.Security.Principal.SecurityIdentifier]).Value },
      [pscustomobject]@{ serviceName = 'Provider'; sid = $testProviderSid },
      [pscustomobject]@{ serviceName = 'Gateway'; sid = (New-Object System.Security.Principal.NTAccount("$env:COMPUTERNAME\$($testAccounts[3])")).Translate([System.Security.Principal.SecurityIdentifier]).Value }
    )
    $adminRejected = $false
    try { Assert-ServiceIdentitiesNotLocalAdministrators -Services $serviceObjects } catch {
      $adminRejected = $_.Exception.Message -match 'direct member of local Administrators'
    }
    if (-not $adminRejected) { throw 'Local Administrators service identity was not rejected.' }
  } finally {
    Remove-LocalGroupMember -Group $administratorsGroupName -Member "$env:COMPUTERNAME\$($testAccounts[2])" -ErrorAction SilentlyContinue
  }

  $root = Join-Path $env:RUNNER_TEMP ('accepted-head-acl-smoke-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root | Out-Null
  $authorityDir = Join-Path $root 'authority'
  $coreDir = Join-Path $root 'core'
  $providerDir = Join-Path $root 'provider'
  $coordinatorDir = Join-Path $root 'coordinator'
  $backupRoot = Join-Path $root 'backups'
  foreach ($dir in @($authorityDir, $coreDir, $providerDir, $coordinatorDir, $backupRoot)) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
  $db = Join-Path $authorityDir 'accepted-head.sqlite'
  $coreDb = Join-Path $coreDir 'core.sqlite'
  $providerDb = Join-Path $providerDir 'provider.sqlite'
  $coordinatorDb = Join-Path $coordinatorDir 'coordinator.sqlite'
  $evidence = Join-Path $env:RUNNER_TEMP ('accepted-head-acl-evidence-' + [guid]::NewGuid().ToString('N') + '.json')
  Set-Content -LiteralPath $db -Value 'temporary non-sensitive ACL fixture'
  Set-Content -LiteralPath $coreDb -Value 'temporary Core fixture'
  Set-Content -LiteralPath $providerDb -Value 'temporary Provider fixture'
  Set-Content -LiteralPath $coordinatorDb -Value 'temporary coordinator fixture'
# Regression: reject an SQLite sidecar symlink before any ACL mutation.
  $outsideTarget = Join-Path $env:RUNNER_TEMP ('accepted-head-sidecar-target-' + [guid]::NewGuid().ToString('N') + '.txt')
  $sidecar = $db + '-wal'
  $sidecarEvidence = $evidence + '.sidecar'
  Set-Content -LiteralPath $outsideTarget -Value 'external target'
  try {
    New-Item -ItemType SymbolicLink -Path $sidecar -Target $outsideTarget | Out-Null
    $rejected = $false
    try {
      & .\scripts\security\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $sidecarEvidence -Apply -Confirm:$false
    } catch { $rejected = $_.Exception.Message -match 'reparse point' }
    if (-not $rejected) { throw 'An accepted-head SQLite sidecar symlink was not rejected specifically as a reparse point.' }
  } finally {
    if (Test-Path -LiteralPath $sidecar) { Remove-Item -LiteralPath $sidecar -Force }
    if (Test-Path -LiteralPath $outsideTarget) { Remove-Item -LiteralPath $outsideTarget -Force }
    if (Test-Path -LiteralPath $sidecarEvidence) { Remove-Item -LiteralPath $sidecarEvidence -Force }
  }

  # Regression: reject an untrusted Provider ACE on the authority directory's parent.
  $unsafeParent = Join-Path $env:ProgramData ('accepted-head-unsafe-parent-' + [guid]::NewGuid().ToString('N'))
  $unsafeDir = Join-Path $unsafeParent 'authority'
  $unsafeDb = Join-Path $unsafeDir 'accepted-head.sqlite'
  $unsafeEvidence = $evidence + '.parent'
  New-Item -ItemType Directory -Path $unsafeDir -Force | Out-Null
  Set-Content -LiteralPath $unsafeDb -Value 'temporary non-sensitive authority fixture'
  $originalParentAcl = Get-Acl -LiteralPath $unsafeParent
  $unsafeParentAcl = Get-Acl -LiteralPath $unsafeParent
  $providerRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "$env:COMPUTERNAME\$($testAccounts[2])",
    ([System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles),
    ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [System.Security.AccessControl.PropagationFlags]::InheritOnly,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $unsafeParentAcl.AddAccessRule($providerRule)
  Set-Acl -LiteralPath $unsafeParent -AclObject $unsafeParentAcl
  try {
    $rejected = $false
    try {
      & .\scripts\security\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $unsafeDb -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $unsafeEvidence -Apply -Confirm:$false
    } catch { $rejected = $_.Exception.Message -match 'Parent path grants directory replacement/ACL-control rights' }
    if (-not $rejected) { throw 'A replaceable accepted-head authority parent path was not rejected specifically by parent ACL screening.' }
  } finally {
    Set-Acl -LiteralPath $unsafeParent -AclObject $originalParentAcl
    if (Test-Path -LiteralPath $unsafeEvidence) { Remove-Item -LiteralPath $unsafeEvidence -Force }
    if (Test-Path -LiteralPath $unsafeParent) { Remove-Item -LiteralPath $unsafeParent -Recurse -Force }
  }

  # Regression: Authority itself is not trusted to replace/control an ancestor.
  $authorityUnsafeParent = Join-Path $env:ProgramData ('accepted-head-authority-parent-' + [guid]::NewGuid().ToString('N'))
  $authorityUnsafeDir = Join-Path $authorityUnsafeParent 'authority'
  $authorityUnsafeDb = Join-Path $authorityUnsafeDir 'accepted-head.sqlite'
  $authorityUnsafeEvidence = $evidence + '.authority-parent'
  New-Item -ItemType Directory -Path $authorityUnsafeDir -Force | Out-Null
  Set-Content -LiteralPath $authorityUnsafeDb -Value 'temporary non-sensitive authority fixture'
  $originalAuthorityParentAcl = Get-Acl -LiteralPath $authorityUnsafeParent
  try {
    $authorityParentAcl = Get-Acl -LiteralPath $authorityUnsafeParent
    $authorityRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      "$env:COMPUTERNAME\\$($testAccounts[0])",
      ([System.Security.AccessControl.FileSystemRights]::Delete -bor [System.Security.AccessControl.FileSystemRights]::ChangePermissions),
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $authorityParentAcl.AddAccessRule($authorityRule)
    Set-Acl -LiteralPath $authorityUnsafeParent -AclObject $authorityParentAcl
    $rejected = $false
    try {
      & .\\scripts\\security\\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $authorityUnsafeDb -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $authorityUnsafeEvidence -Apply -Confirm:$false
    } catch { $rejected = $_.Exception.Message -match 'Parent path grants directory replacement/ACL-control rights' }
    if (-not $rejected) { throw 'Authority identity was incorrectly trusted for dangerous ancestor ACL rights.' }
  } finally {
    Set-Acl -LiteralPath $authorityUnsafeParent -AclObject $originalAuthorityParentAcl
    if (Test-Path -LiteralPath $authorityUnsafeEvidence) { Remove-Item -LiteralPath $authorityUnsafeEvidence -Force }
    if (Test-Path -LiteralPath $authorityUnsafeParent) { Remove-Item -LiteralPath $authorityUnsafeParent -Recurse -Force }
  }

# Regression: reject NTFS alternate data stream syntax before path normalization or ACL mutation.
  $adsEvidencePath = $evidence + [char]58 + 'stream'
  $adsEvidenceRefused = $false
  try {
    & .\\scripts\\security\\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $adsEvidencePath
  } catch { $adsEvidenceRefused = $_.Exception.Message -match 'NTFS alternate data stream' }
  if (-not $adsEvidenceRefused) { throw 'An ADS-shaped evidence output path was not rejected before normalization.' }

  $adsDatabasePath = $db + [char]58 + 'stream'
  $adsDatabaseRefused = $false
  try {
    & .\\scripts\\security\\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $adsDatabasePath -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath ($evidence + '.ads-db')
  } catch { $adsDatabaseRefused = $_.Exception.Message -match 'NTFS alternate data stream' }
  if (-not $adsDatabaseRefused) { throw 'An ADS-shaped authority database path was not rejected before normalization.' }

# Regression: a backup root overlapping a live Core store is not an isolated restore domain.
  $overlapBackupRefused = $false
  try {
    & .\\scripts\\security\\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @((Split-Path -Parent $coreDb)) -EvidencePath ($evidence + '.overlap')
  } catch { $overlapBackupRefused = $_.Exception.Message -match 'Backup/restore root overlaps live' }
  if (-not $overlapBackupRefused) {
    throw 'A backup root overlapping the live Core database directory was not refused.'
  }

# Regression: nested backup roots do not establish independent restore domains.
  $nestedBackupRoot = Join-Path $backupRoot 'nested'
  New-Item -ItemType Directory -Path $nestedBackupRoot -Force | Out-Null
  $nestedBackupRefused = $false
  try {
    & .\\scripts\\security\\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot, $nestedBackupRoot) -EvidencePath ($evidence + '.nested')
  } catch { $nestedBackupRefused = $_.Exception.Message -match 'Backup/restore roots overlap each other' }
  if (-not $nestedBackupRefused) {
    throw 'Nested backup roots were incorrectly accepted as independent restore domains.'
  }

# Regression: evidence output must not contaminate a supplied backup/restore root.
  $backupEvidencePath = Join-Path $backupRoot 'acl-evidence-must-not-be-written.json'
  $backupEvidenceRefused = $false
  try {
    & .\\scripts\\security\\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $backupEvidencePath
  } catch { $backupEvidenceRefused = $_.Exception.Message -match 'outside protected database and backup roots' }
  if (-not $backupEvidenceRefused -or (Test-Path -LiteralPath $backupEvidencePath)) {
    throw 'Evidence output inside a backup root was not refused before any ACL mutation.'
  }

# Regression: evidence output must not be placed beside a protected Core database.
  $coreEvidencePath = Join-Path (Split-Path -Parent $coreDb) 'acl-evidence-must-not-be-written.json'
  $coreEvidenceRefused = $false
  try {
    & .\\scripts\\security\\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $coreEvidencePath
  } catch { $coreEvidenceRefused = $_.Exception.Message -match 'outside protected database and backup roots' }
  if (-not $coreEvidenceRefused -or (Test-Path -LiteralPath $coreEvidencePath)) {
    throw 'Evidence output inside the Core database directory was not refused before any ACL mutation.'
  }

# Regression: an existing evidence file must not be overwritten.
  $existingEvidence = $evidence + '.existing'
  $evidenceMarker = 'preserve-prior-security-evidence'
  Set-Content -LiteralPath $existingEvidence -Value $evidenceMarker
  try {
    $rejected = $false
    try {
      & .\scripts\security\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $existingEvidence
    } catch { $rejected = $_.Exception.Message -match 'EvidencePath already exists' }
    if (-not $rejected) { throw 'Existing accepted-head security evidence was not protected against overwrite.' }
    if ((Get-Content -LiteralPath $existingEvidence -Raw).Trim() -ne $evidenceMarker) {
      throw 'Existing accepted-head security evidence changed after the refused overwrite.'
    }
  } finally {
    if (Test-Path -LiteralPath $existingEvidence) { Remove-Item -LiteralPath $existingEvidence -Force }
  }

  & .\scripts\security\Set-AcceptedHeadAuthorityAcl.ps1 -AuthorityServiceName $testServices[0] -CoreServiceName $testServices[1] -ProviderServiceName $testServices[2] -GatewayServiceName $testServices[3] -AuthorityDbPath $db -CoreDbPath $coreDb -ProviderDbPath $providerDb -CoordinatorDbPath $coordinatorDb -BackupRoots @($backupRoot) -EvidencePath $evidence -Apply -Confirm:$false
  $report = Get-Content -LiteralPath $evidence -Raw | ConvertFrom-Json
  if ($report.status -ne 'APPLIED_AND_ACL_SHAPE_VERIFIED') {
    throw "Unexpected ACL smoke status: $($report.status)"
  }
  $ids = @($report.services.authority.sid, $report.services.core.sid, $report.services.provider.sid, $report.services.gateway.sid)
  if (@($ids | Select-Object -Unique).Count -ne 4) { throw 'Fixture service identities were not distinct.' }
  $acl = Get-Acl -LiteralPath $authorityDir
  $identities = @($acl.Access | ForEach-Object { [string]$_.IdentityReference })
  if ($identities -notcontains [string]$report.services.authority.account) { throw 'Authority identity is missing from fixture ACL.' }
  foreach ($role in @('core', 'provider', 'gateway')) {
    if ($identities -contains [string]$report.services.$role.account) { throw "$role identity has an explicit fixture directory ACE." }
  }

  function Invoke-AsLocalUser {
    param([Parameter(Mandatory = $true)][string]$Account, [Parameter(Mandatory = $true)][string]$Command)
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Command))
    $credential = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\$Account", $securePassword)
    $process = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Credential $credential -ArgumentList @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
    ) -Wait -PassThru -ErrorAction Stop
    return [int]$process.ExitCode
  }

  $authorityAccount = $testAccounts[0]
  $authorityWrite = "try { Add-Content -LiteralPath '$db' -Value 'authority-write-probe' -ErrorAction Stop; exit 0 } catch { exit 10 }"
  if ((Invoke-AsLocalUser -Account $authorityAccount -Command $authorityWrite) -ne 0) {
    throw 'Authority service identity could not write its own authority DB fixture.'
  }
  $authorityCreate = "try { Set-Content -LiteralPath '$authorityDir\sidecar-probe.tmp' -Value 'probe' -ErrorAction Stop; exit 0 } catch { exit 11 }"
  if ((Invoke-AsLocalUser -Account $authorityAccount -Command $authorityCreate) -ne 0) {
    throw 'Authority service identity could not create a sidecar in its own directory.'
  }
  Remove-Item -LiteralPath (Join-Path $authorityDir 'sidecar-probe.tmp') -Force

  $denyRead = "try { Get-Content -LiteralPath '$db' -ErrorAction Stop | Out-Null; exit 20 } catch { exit 0 }"
  $denyWrite = "try { Add-Content -LiteralPath '$db' -Value 'unauthorized-write-probe' -ErrorAction Stop; exit 21 } catch { exit 0 }"
  $denyCreate = "try { Set-Content -LiteralPath '$authorityDir\unauthorized-sidecar.tmp' -Value 'probe' -ErrorAction Stop; exit 22 } catch { exit 0 }"
  foreach ($index in @(1, 2, 3)) {
    $account = $testAccounts[$index]
    if ((Invoke-AsLocalUser -Account $account -Command $denyRead) -ne 0) {
      throw "Non-authority identity $account could read the authority DB."
    }
    if ((Invoke-AsLocalUser -Account $account -Command $denyWrite) -ne 0) {
      throw "Non-authority identity $account could write the authority DB."
    }
    if ((Invoke-AsLocalUser -Account $account -Command $denyCreate) -ne 0) {
      throw "Non-authority identity $account could create a file in the authority directory."
    }
  }
  Write-Output 'Accepted-head authority ACL shape and effective disposable-user read/write denial checks passed; target-machine access is still unverified.'
} finally {
  if ($evidence -and (Test-Path -LiteralPath $evidence)) { Remove-Item -LiteralPath $evidence -Force }
  if ($root -and (Test-Path -LiteralPath $root)) {
    $acl = Get-Acl -LiteralPath $root
    $acl.SetAccessRuleProtection($false, $true)
    Set-Acl -LiteralPath $root -AclObject $acl
    Remove-Item -LiteralPath $root -Recurse -Force
  }
  foreach ($service in $testServices) { & sc.exe delete $service | Out-Null }
  foreach ($account in $testAccounts) {
    if (Get-LocalUser -Name $account -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $account }
  }
}
