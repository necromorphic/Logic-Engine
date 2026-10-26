# Proposed Core database single-writer deployment boundary

**Status:** Proposal for Core / Provider / deployment review. Not an approved runtime contract, implementation, or production-readiness claim.

**Related:** Core #140, Core coordinator PR #380, direct-writer characterization PR #385, Provider PR #383, protected-disclosure policy #356 / PR #367.

## 1. Problem demonstrated

The shared coordinator SQLite lock serializes participants that explicitly acquire the same coordinator database. It does not prevent an unrelated process with filesystem access from opening the Core SQLite database directly.

The characterization test in PR #385 reproduced this on Core coordinator head `c461864b5f8983c9b50673cfb3bfcedf840d4481`: while process A held the coordinator lease, process B independently opened the Core DB and updated a canonical `worlds` row. Exact-head Runtime CI passed (633/633 npm tests; 8/8 recalculation-oracle tests), including the test that records this bypass.

Therefore, the coordinator is an ordering primitive for cooperating writers, not an access-control boundary.

## 2. Proposed deployment invariant

For the protected Memory → NPC integration, adopt the following invariant for review:

> The Core runtime is the only process identity with permission to open and mutate the Core database and its SQLite sidecar files. Other blocks must not receive the Core DB path or filesystem permissions to open it. Core state changes enter through the existing Core-owned application/write path.

This is a deployment constraint proposal, not an implemented permission boundary.

### Process / data ownership

| Component | Owns | Must not do |
| --- | --- | --- |
| Core runtime on PC | Core SQLite DB, migrations, recovery, canonical Core writes | Expose the DB file to Host/Provider or unrelated processes |
| Memory Provider on PC | Provider's own persistence/index data | Open or mutate the Core DB directly; infer Host completeness from Provider rows |
| Protected egress gateway on PC | Final disclosure authorization and upstream transport for covered Memory-bearing requests | Accept requests that bypass the final gate or fall back to direct provider transport |
| SillyTavern / Host on phone | Host-side capture and UI integration | Hold upstream provider credentials for protected routes or access the Core DB file |

The shared coordinator may remain a protocol for explicitly participating Core/Provider mutation windows. It does not replace data ownership, source authority, cross-store consistency, or final dispatch-start authorization.

## 3. Filesystem isolation requirements

1. Run Core under a dedicated OS identity/service account where supported. Only that identity may read/write the Core database, its parent directory as required, and SQLite sidecar files (`-wal`, `-shm`, rollback journals).
2. Provider and gateway identities must not have direct Core DB access. If all processes run under the same unrestricted OS identity, filesystem permissions do not provide this isolation; use a separate service identity/container boundary or keep Core DB access inside the Core process.
3. Do not place the Core DB on the phone, a shared writable folder, or a network filesystem as a substitute for an authenticated Core-owned interface.
4. Migrations, backup, restore, and maintenance must execute under the authorized Core identity. A restore or copied DB must not silently bypass source/version anti-rollback checks.
5. Do not log prompts, Memory text/snippets, raw Host messages, derived copies, secrets, or provider credentials while implementing diagnostics for this boundary.

Exact OS-specific ACL/service configuration is intentionally left to the deployment owner; do not claim it is enforced until tested on the target PC.

## 4. Required negative and positive tests

The deployment acceptance test must use distinct OS identities or an equivalent enforced isolation boundary, not only two processes running as the same user.

- **Positive:** Core identity can open the configured Core DB, run migrations, commit a canonical event, restart, and recover.
- **Negative:** Provider identity cannot open, read, update, rename, replace, or create SQLite sidecar files beside the Core DB.
- **Negative:** Host/phone and gateway identities cannot access the Core DB path or write to it.
- **Negative:** Symlink, hard-link, alternate-path, backup/restore, and sidecar-file tricks do not grant an unauthorized identity access.
- **Positive:** Provider can mutate its own DB and join the shared coordinator without needing Core DB filesystem access.
- **Positive:** a protected request still fails closed when Core, Provider, coordinator, gateway, or an authenticated phone-to-PC route is unavailable.
- **Evidence:** record OS/platform, process identity, effective ACL/permissions, exact commit/configuration, test command, exit code, and logs containing no protected payload.

A test using only a cooperative lock participant does not satisfy these requirements.

## 5. Non-goals / unresolved contracts

This proposal does not implement or prove:

- authoritative Host inventory of active, historical, edited, deleted, copied, imported, or restored message versions;
- Host identity/version binding to Provider `(world_id, record_ref, record_version)`;
- source authority, revocation, freshness, lineage, or anti-rollback validation;
- atomic commits across Core DB and Provider DB;
- a final PC-side dispatch-start linearization point tied to the actual upstream invocation;
- Android/Termux → PC gateway enforcement or elimination of direct upstream fallback in every covered ST route.

Those remain separate gates under #140, #181, #252, #258, #264, #356, and #383. Production Memory → NPC remains **DISABLED / FAIL-CLOSED**.

## 6. Review / acceptance ownership

- **Core:** confirm no production Core write path requires another process to open the Core DB directly; identify any exceptions and their existing contracts.
- **Memory Provider:** confirm Provider persistence and reconciliation operate without direct Core DB access; keep its coordinator participation explicit.
- **Host/Adapter:** confirm the phone only uses the PC gateway for protected routes and that unsupported routes fail closed.
- **Deployment owner:** provide target-PC OS identity/ACL configuration and pass the distinct-identity negative tests.
- **Coordinator:** reconcile owner evidence into #140/#264. No new API/schema or production activation follows from this proposal alone.

Approval should be recorded against this exact document revision before treating the deployment invariant as binding.
