# Target-PC Security Evidence Runbook

Status: **collection procedure only**. Running this procedure does not make the deployment ready and does not change system configuration.

Purpose: collect evidence from the actual Windows PC where Logic Engine, SillyTavern, and Memory Provider run. Hosted CI fixtures are not substitutes for this evidence.

## Safety rules

- Run from the repository checkout that contains `scripts/security/Collect-DeploymentEvidence.ps1`.
- This collector is read-only with respect to services, ACLs, firewall rules, databases, and network settings. It writes one new JSON report file.
- Do not paste passwords, bearer tokens, API keys, environment variables, chat content, or raw prompts into the report or issue.
- Do not guess data or backup paths. Supply the actual paths used by the running installation.
- If the actual paths are not known, stop and identify them first; an empty or guessed path list is not acceptable evidence.
- Do not change ACLs or service configuration as part of evidence collection.

## 1. Open PowerShell at the repository root

Example only; adjust to the real checkout location:

```powershell
Set-Location 'C:\LogicEngine\Logic-Engine'
Test-Path '.\scripts\security\Collect-DeploymentEvidence.ps1'
```

The last command must return `True`.

## 2. Identify candidate process and service identities

Read-only inventory:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -in @('node.exe','python.exe','pythonw.exe') } |
  Select-Object ProcessId, ParentProcessId, Name, ExecutablePath
```

For each relevant PID, inspect only its owner (do not collect command lines or environment variables):

```powershell
$pidToCheck = 1234 # replace with a verified PID
$p = Get-CimInstance Win32_Process -Filter "ProcessId = $pidToCheck"
Invoke-CimMethod -InputObject $p -MethodName GetOwner
Get-CimInstance Win32_Service |
  Where-Object { $_.ProcessId -eq $pidToCheck } |
  Select-Object Name, State, StartMode, StartName, ProcessId
```

Replace the example PID. If a service wrapper launches child processes, record that relationship separately; the collector does not prove every parent/child or wrapper relationship.

## 3. Run the collector with real paths

Use a new output filename outside all data and backup roots. Example paths below are placeholders and must be replaced:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\security\Collect-DeploymentEvidence.ps1 `
  -DataPath @(
    'C:\\REAL\\PATH\\core.sqlite',
    'C:\\REAL\\PATH\\provider.sqlite',
    'C:\\REAL\\PATH\\coordinator.sqlite'
  ) `
  -BackupPath @(
    'D:\\REAL\\BACKUP\\CORE',
    'D:\\REAL\\BACKUP\\PROVIDER'
  ) `
  -ProcessId @(1234, 5678) `
  -OutputPath '.\\security-deployment-audit-2026-10-28.json'
```

Include the actual Core, Provider, and coordinator database files, all actual backup roots, and verified process IDs. If a database does not exist in this installation, do not invent a path to make the report look complete; record the missing mechanism as unresolved.

The report is written only if the output filename does not already exist. Choose a different name for a repeat run.

## 4. Check the collection result

```powershell
$r = Get-Content '.\\security-deployment-audit-2026-10-28.json' -Raw | ConvertFrom-Json
$r.collectionStatus
$r.incompleteReasons
$r.pathAclEvidence | Where-Object { $_.error -or $null -eq $_.exists } |
  Select-Object requestedPath, path, exists, error
```

Interpretation:
- `INCOMPLETE`: collection evidence has gaps. Do not treat missing/unknown results as safe.
- `COLLECTED_NO_QUERY_ERRORS`: queries returned without detected errors. This is **not** a security pass and does not prove effective access denial, anti-rollback, or exclusive outbound egress.

## 5. Review and share safely

Before sharing, inspect the JSON locally and redact machine name, user/account names, local paths, IP addresses/remote endpoints, and any other identifying infrastructure details. Preserve the structural facts needed for review: which identity owns each process/service, which principal has which ACL rights, whether SQLite sidecars exist, and which firewall rules permit/block outbound traffic. Never share secrets or message/prompt contents.

Share the redacted report and state:
- the exact Git commit used for collection;
- whether PowerShell was elevated;
- whether the collector returned `INCOMPLETE` or `COLLECTED_NO_QUERY_ERRORS`;
- any redactions or omitted paths.

## What this does not prove

This report does not prove:
- effective token privileges or that a service cannot obtain elevated rights indirectly;
- the Gateway is the sole outbound path or that direct provider egress is blocked;
- resistance to coordinated Core/Provider backup restore;
- authenticated remote-anchor operation;
- all mutation, restore, recovery and dispatch-start operations share one serialization order;
- the real Host-to-Gateway send path has zero-egress race behavior.

Those remain separate acceptance gates. Until the actual integrated tests and target-PC evidence pass, production remains **NON_READY** and Memory→NPC remains **DISABLED / FAIL-CLOSED**.
