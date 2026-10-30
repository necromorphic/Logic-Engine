# Accepted-head authority ACL candidate

Status: **draft deployment candidate; not deployed and not production approval**.

## Current-main re-port provenance — 30 October 2026

- Branch: `security/priority1-identity-acl-2026-10-30`.
- Base: current `main` HEAD `d4f4a26a9fc68d363308b8889657b06c5859c562`.
- Reapplies the exact BigInt stat precision changes and hard-link regressions from PR #750 directly to current-main source files; it does not transplant the stale #750 file versions.
- Adds the ACL plan/apply script, disposable Windows fixture tests and dedicated workflow from the #756 candidate.
- Previous #756 CI is not reused as acceptance evidence; fresh exact-head Runtime and ACL checks are required.
- The accepted-head authority service and synchronous Core/Provider clients are already present on current main. This candidate does not create or deploy the authority service.
- The candidate remains a Windows deployment-specific partial gate. It does not prove open-handle absence, backup/restore-domain independence, Linux ACL parity, or resistance to restore by a privileged operator.

## Purpose

Provide a plan-first Windows ACL candidate for the dedicated file-backed store of the externally hosted accepted-head authority approved in Core decision #140. The authority database must be outside the joint Core + Provider data/backup restore domain and writable only by the authority's dedicated service identity, with SYSTEM and local Administrators retained as explicit recovery principals.

## Preconditions

- A real accepted-head authority service already exists and its service identity is dedicated.
- Before applying ACLs, Authority, Core, Provider, and Gateway services must all report `State = Stopped` and `ProcessId = 0`; the script rechecks immediately before each ACL write and refuses without ACL changes if the precondition fails. It does not stop services automatically.
- This service-state check does **not** prove that no other process has an already-open database/WAL/SHM handle. Target-PC handle inventory/closure evidence remains a separate gate.
- Core, Provider, gateway, and authority use four distinct Windows service identities.
- The authority database is a dedicated file in a dedicated directory. The script refuses reparse points and unexpected directory entries.
- Actual Core, Provider and coordinator DB paths plus every known backup/restore root must be supplied. The script refuses overlapping authority/store or authority/backup paths; an omitted backup root still remains an evidence gap.
- Evidence output is outside the protected directory. Its parent directory must already exist and contain no reparse points; the target evidence filename must be new. The script refuses to overwrite existing security evidence and refuses evidence output under Core/Provider/coordinator database directories or any supplied backup/restore root. It also rejects backup roots that overlap live Core/Provider/coordinator database directories or overlap other supplied backup roots. Raw database, backup-root, and evidence paths are checked for NTFS alternate data stream syntax before path normalization; ADS-shaped inputs are rejected.
- The operator has reviewed the exact target paths, backup paths, service identities, and rollback plan.

The script does not create the authority service, define the authority protocol, create the accepted-head state machine, or configure backups/firewall/egress.

## Safe use

Plan first (no ACL changes):

```powershell
.\scripts\security\Set-AcceptedHeadAuthorityAcl.ps1 `
  -AuthorityServiceName 'ACTUAL_AUTHORITY_SERVICE' `
  -CoreServiceName 'ACTUAL_CORE_SERVICE' `
  -ProviderServiceName 'ACTUAL_PROVIDER_SERVICE' `
  -GatewayServiceName 'ACTUAL_GATEWAY_SERVICE' `
  -AuthorityDbPath 'D:\ACTUAL_AUTHORITY\accepted-head.sqlite' `
  -EvidencePath 'D:\SecurityEvidence\accepted-head-acl-plan.json'
```

Applying changes requires an elevated PowerShell session, explicit `-Apply`, and confirmation. Do not run against a production path until the authority process and recovery plan exist and have been reviewed.

## What the script enforces in its candidate ACL

- Authority, Core, Provider and gateway service identities must resolve and be distinct.
- For `-Apply`, all four configured services must be stopped with PID 0; service state is rechecked immediately before each `Set-Acl` operation. A refusal before the first ACL write is recorded as `REFUSED_MAINTENANCE_PRECONDITION` with `noAclChanges: true`; services are never stopped automatically.
- Built-in service identities are rejected for the authority.
- ACL inheritance is replaced for the dedicated directory and existing SQLite database/sidecars.
- Authority receives Modify; SYSTEM and local Administrators retain FullControl.
- Core, Provider and gateway receive no explicit allow ACE in the protected ACL.
- Prior SDDL is recorded before mutation; partial apply attempts restoration.

## Evidence limits / remaining gates

The Windows CI smoke workflow uses disposable local users, services, and a temporary fixture. It checks ACL shape only. It does not prove effective access denial on the target PC, inherited group/privilege access, alternate paths, backup/restore isolation, or that the authority's accepted-head semantics are monotonic and correct.

Required before closure:
1. Implement and review the authority service/protocol separately; authority state must not be advanced by caller-controlled IDs or partial inventory.
2. Isolate authority backups and restore paths under a separate principal and recovery procedure.
3. Test positive authority access and negative Core/Provider/gateway read/write/replace/rename/delete access, including WAL/SHM/journal and alternate paths.
4. Test backup A → accepted state B/head advance → restore A, authority outage/corruption/wrong scope, crash/lost response, and audited re-enrollment.
5. Separately prove gateway-only upstream egress and serialized revocation immediately before dispatch-start.

Until all gates pass, production remains **NON_READY** and Memory→NPC remains **DISABLED / FAIL-CLOSED**.


## Dependency

This PR is stacked on PR #750's validated Core file-identity fix. After #750 merges, retarget this PR to `main` and rerun the exact-head Windows ACL and Runtime workflows.

## Current-main BigInt file-identity correction

The associated current-main source changes use bigint stats for:
- trusted import path-before / opened-handle / path-after stat comparisons in Core;
- Core startup database alias checks;
- SQLiteStore database alias checks;
- Host version digest ledger alias checks.

This prevents precision loss when filesystem inode/device values exceed JavaScript's safe integer range. It does **not** bind a path check to the exact object SQLite later opens and does not close TOCTOU #770. The hard-link tests cover alias detection for known links, not replacement races.
