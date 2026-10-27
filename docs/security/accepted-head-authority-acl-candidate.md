# Accepted-head authority ACL candidate

Status: **draft deployment candidate; not deployed and not production approval**.

## Purpose

Provide a plan-first Windows ACL candidate for the dedicated file-backed store of the externally hosted accepted-head authority approved in Core decision #140. The authority database must be outside the joint Core + Provider data/backup restore domain and writable only by the authority's dedicated service identity, with SYSTEM and local Administrators retained as explicit recovery principals.

## Preconditions

- A real accepted-head authority service already exists and its service identity is dedicated.
- Core, Provider, gateway, and authority use four distinct Windows service identities.
- The authority database is a dedicated file in a dedicated directory. The script refuses reparse points and unexpected directory entries.
- Evidence output is outside the protected directory.
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
