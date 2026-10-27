# Core database ACL boundary candidate

**Status: draft implementation candidate; not deployment approval.** This script is Security-owned preparation for the single-writer invariant in `core-db-single-writer-deployment-boundary.md`. It does not implement accepted-head authority or the outbound dispatch gate.

## Safety model

- Default mode is **PLAN_ONLY**. It records service identities and existing SDDL; it changes no ACL.
- Applying changes requires `-Apply`, elevated PowerShell, and the normal `ShouldProcess` confirmation (use `-WhatIf` for a dry run).
- Core, Provider, and gateway must be three distinct Windows service SIDs. Built-in shared service identities are rejected for Core.
- The Core database must already exist in a **dedicated directory** containing only the database and SQLite sidecars (`-wal`, `-shm`, `-journal`). The script refuses unrelated entries, reparse points anywhere in the existing path chain, and reparse-point sidecars.
- The proposed ACL allows SYSTEM and local Administrators full control, and the Core service identity Modify. Provider/gateway identities receive no direct ACE. New sidecars inherit the directory DACL; existing database/sidecars receive explicit protected DACLs.
- A pre-change SDDL evidence report is written before mutation. Keep it outside the protected directory.
- Before each ACL mutation, the script rechecks the path chain, exact directory contents, and observable target fingerprints. These checks narrow but do not eliminate TOCTOU exposure: metadata can be preserved by a sufficiently capable concurrent replacer.

## Example

First inventory identities and save evidence without changes:

```powershell
.\scripts\security\Set-CoreDbAclBoundary.ps1 `
  -CoreServiceName 'LogicEngineCore' `
  -ProviderServiceName 'LogicEngineProvider' `
  -GatewayServiceName 'LogicEngineGateway' `
  -CoreDbPath 'C:\LogicEngine\core-data\logic-engine.sqlite' `
  -EvidencePath 'C:\LogicEngine\security\core-db-acl-before.json'
```

Review service accounts and the evidence file. Only after confirming the target directory is dedicated and service-account/group membership is appropriate, apply explicitly:

```powershell
.\scripts\security\Set-CoreDbAclBoundary.ps1 `
  -CoreServiceName 'LogicEngineCore' `
  -ProviderServiceName 'LogicEngineProvider' `
  -GatewayServiceName 'LogicEngineGateway' `
  -CoreDbPath 'C:\LogicEngine\core-data\logic-engine.sqlite' `
  -EvidencePath 'C:\LogicEngine\security\core-db-acl-before.json' `
  -Apply
```

The service names, paths, and accounts above are examples only. Do not copy them without verifying the actual deployment. Stop if Core, Provider, or gateway run under the same account or if any unreviewed process has administrative privileges.

## Limits / acceptance

This candidate changes only the dedicated Core database directory and its current SQLite sidecars. It does **not** isolate backup/restore paths, create a restore-resistant accepted-head authority, configure firewall rules, stop direct upstream egress, or serialize revocation with dispatch-start. SDDL shape verification is not proof of effective access after group membership, privileges, service configuration, and alternate-path checks. Path-chain and fingerprint checks do not eliminate hostile concurrent replacement.

Before applying, stop/quiesce all untrusted processes that can write the database directory or any ancestor; the script cannot enforce this operational precondition. CI includes disposable regression cases for an ancestor junction and a sidecar symlink. Before treating the deployment gate as closed, run positive/negative access tests under the actual distinct service identities on the target PC, including read/write/create/replace/rename/delete and SQLite sidecar attempts, plus backup/restore and alternate-path cases. Record exact OS, service SIDs, ACL evidence, test commands/results, and rollback evidence. Until then the target deployment remains **NOT TESTED / NON_READY** and Memory→NPC remains **DISABLED / FAIL-CLOSED**.
