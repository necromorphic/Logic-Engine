# ADR: Memory disclosure dispatch authority v1

**Status:** coordinator-selected implementation contract; draft for code review. No production activation is authorized by this ADR.
**Decision date:** 2026-10-27
**Scope:** ordering between Core source changes, Provider grant/readiness changes, and the final Memory-bearing upstream model request.

## Decision

Use a PC-side gateway as the only upstream transport for requests containing protected Memory. The gateway does not become the owner of Core or Provider data. Core remains the sole writer of Core state; Provider remains the sole writer of Provider state; a separate accepted-head authority is the sole writer of its monotonic authority state.

A protected request is sent only after the gateway has synchronously verified the exact request against current Core and Provider state and durably recorded dispatch-start. The final check and dispatch-start are serialized against every relevant mutation by the same cross-process coordinator order.

The current repository does not implement this path. Until implementation and deployment tests pass, production Memory→NPC remains DISABLED / FAIL-CLOSED.

## Process and storage boundaries

The target deployment uses distinct Windows service identities for:
- Core: read/write Core DB and its SQLite sidecars; no Provider DB, gateway ledger, or accepted-head authority write access.
- Provider: read/write Provider DB and its SQLite sidecars; no Core DB or gateway ledger/accepted-head authority write access.
- Gateway: read-only current-state access to Core and Provider DBs and their existing WAL/SHM files; read/write access only to its dispatch ledger and the shared coordinator lock; no Core/Provider DB write/replace/rename/delete rights and no accepted-head write access.
- Accepted-head authority: sole writer of its own durable state; no Core/Provider DB access and no ability to dispatch model requests.
- Backup/restore and re-enrollment: separate, named administrative operation. Routine backup identity cannot write or restore accepted-head authority state.

All protected directories must have canonical local paths, no reparse-point aliases, protected parent-directory ACLs, and explicit DB/WAL/SHM/journal rights. Gateway read-only SQLite access is permitted only after an executable Windows test proves the chosen SQLite journal mode works without write permission on DB or sidecars. If it requires write access, this topology fails review and must not be weakened silently.

This is a standard-process threat model. Local Administrators/SYSTEM can override local ACLs; protection against a malicious local administrator or whole-machine snapshot rollback requires an independently administered remote/hardware trust anchor and is not claimed by this ADR.

## Serialization order

The existing file-backed coordinator is the shared ordering primitive for normal Core/Provider mutations and gateway dispatch-start. Its use is mandatory but not sufficient by itself: ACLs must prevent untrusted direct DB writers, and every mutation/restore path must be inventoried and shown to participate.

### Core or Provider mutation

1. Acquire the shared coordinator lease.
2. Ask the accepted-head authority to advance the relevant domain head (core or provider) using a unique operation identity. The authority operation must be idempotent. If the authority is unavailable, abort before committing the local mutation.
3. Commit the local mutation and persist the returned domain head in that domain's local metadata in the same local transaction.
4. Release the coordinator lease only after both the authority advance and local commit succeed.

If the authority advances but the local transaction fails or the process crashes before local commit, the authority head is ahead of local metadata. This is a deliberate fail-closed state: the gateway must deny all protected dispatches for that domain until explicit recovery reconciles the pending operation. Never decrement the authority head, replay an old backup as current, or silently auto-repair from provider-local row counts.

No new mutation path may commit Core/Provider state without this sequence. Existing synchronous mutation methods must not use best-effort asynchronous authority notifications after commit.

### Final gateway dispatch

1. Prepare the exact request and candidate metadata before acquiring the coordinator; preparation does not authorize disclosure.
2. Acquire the shared coordinator lease.
3. Open Core and Provider state read-only. Verify local domain heads equal the accepted-head authority's current domain heads; verify exact source identity/version/status, actor/world/scope/purpose, Provider grant, readiness, reconciliation and inventory evidence; verify the route is explicitly supported.
4. If any read, head comparison, identity, policy, source, grant, readiness or route is missing/unknown/unavailable, release the coordinator and return a generic non-ready/denied result with zero upstream calls.
5. Durably write exactly one dispatch-start ledger entry bound to the request identity, exact source/version set, authority heads, route and a non-content request digest. A duplicate identity is rejected, not replayed.
6. Release the coordinator. Only then invoke the sole upstream transport once.
7. Record the transport outcome without storing raw prompt or Memory content. If the process crashes or times out after dispatch-start and delivery is ambiguous, mark the request outcome unknown/in-flight and never automatically retry it.

Revocation/source invalidation ordered before dispatch-start must produce zero upstream calls. A revocation ordered after durable dispatch-start cannot recall bytes already handed to the transport; the request remains explicitly in flight. The gateway must not hold the coordinator lease during upstream network I/O.

## Accepted-head authority contract

- Separate service identity; only that identity can mutate the authority store.
- Monotonic per-domain heads for Core and Provider. The authority also records operation identity, domain, resulting head, and minimal non-content status needed for crash recovery.
- Repeated submission of the same operation identity returns the same result; conflicting reuse fails closed.
- Authority state is not inside either application DB, their WAL/SHM, or their normal backup/restore domain.
- Missing/corrupt/unavailable authority, local-head mismatch, unresolved operation, wrong installation identity or failed advance means NON_READY.
- Authority restore/re-enrollment is not an ordinary DB restore. It requires a named operator, explicit audit, fresh current-source reconciliation and a procedure that cannot lower the head or resurrect revoked grants.
- The accepted-head service does not authorize content by itself; it supplies monotonic freshness and operation ordering. Core/Provider still own their domain predicates.

The first implementation must choose and test a local authenticated IPC transport that supports bounded request/response and idempotent operation IDs. Do not implement authority writes as direct shared-file writes by Core/Provider, an unprotected sibling SQLite file, or best-effort asynchronous notification. The client must return before the local mutation commits; otherwise the mutation aborts.

## Read-only SQLite acceptance gate

Before wiring runtime, add a Windows integration fixture using three distinct service identities and actual SQLite files in the intended journal mode. Prove:
- Core can read/write only its own DB; Provider and Gateway cannot modify, replace, rename or delete it.
- Provider can read/write only its own DB; Core and Gateway cannot modify, replace, rename or delete it.
- Gateway can read current committed Core/Provider state through read-only SQLite handles, including while WAL/SHM exist, but cannot write DB or sidecar files.
- Core and Provider can acquire the shared coordinator lease; gateway dispatch-start blocks behind a mutation and vice versa.
- A direct writer or restore process under the wrong identity is denied by the OS, not merely by application checks.
- Missing/locked/corrupt sidecars, IPC timeout, authority outage, head mismatch and restart all fail closed.

If SQLite read-only access cannot be proven with the required ACLs, stop and revise the topology before implementation. Do not grant Gateway Modify rights to make tests pass.

## Required implementation order

1. Implement accepted-head authority + authenticated IPC + idempotent monotonic per-domain operations, with crash/restart tests.
2. Add the authority/local-head handshake to every Core and Provider state-changing path, including readiness/reconciliation, grants/revocation, tombstone/purge, migrations, maintenance and restore.
3. Add and test the separate gateway ledger and final-state check.
4. Enumerate every pinned SillyTavern provider-facing generation route. Only explicitly integrated routes may carry protected Memory; every unsupported route must reject protected Memory before any direct provider send. No global-fetch monkey patch and no vectorization configuration changes.
5. Run deterministic barrier tests for both orderings, real recording-upstream integration tests, Windows ACL tests, authority crash/recovery tests and exact-head Runtime CI.
6. Keep production disabled until target-PC acceptance evidence is reviewed.

## Non-goals and prohibited shortcuts

- No raw SillyTavern message text is persisted by this ADR.
- No change to the user's existing vectorization or remote vector-store settings.
- No summaries, inferred sources, or other source kinds are implicitly authorized; current supported source mapping remains direct canonical_entity only.
- No preflight boolean, signed token, process-local generation counter, cooperative lock alone, provider-local row count, or successful component CI is sufficient release evidence.
- No automatic retry after ambiguous post-dispatch-start outcomes.
- No production activation based on this ADR alone.

## Required reviewers

Core, Memory Provider, Host/Adapter, NPC and Security/Deployment must review the concrete implementation diffs against this contract. The coordinator has selected the direction; implementation owners must identify any source-code path that violates it and either fix it or mark that route unsupported and fail-closed.
