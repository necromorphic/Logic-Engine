# PC-NEXT-09 — Core / Provider / egress writer and callsite matrix

**Status:** SOURCE INVENTORY — PARTIAL, NOT A COMPLETENESS CERTIFICATE.  
**Audit baseline:** `main` `40704c1b6a2b5e6b31379973683f90e4b50eee9c` (2026-10-30).  
**Parent:** PC-NEXT-07 Draft v3; PC-NEXT-08 implementation breakdown.  
**Scope:** source-level inventory of known write/authorization/dispatch boundaries and the participation proof required if the shared-order option is approved. No production code or runtime state is changed.

## 1. Result

Current main has a shared SQLite coordinator primitive used by Core, Memory Provider and the Memory dispatch primitive when configured with the same coordinator database. It is a significant building block, but source review does not prove complete deployment participation.

The important distinction:

- **Primitive exists:** file-backed coordinator lease using SQLite `BEGIN IMMEDIATE`.
- **Core participation exists:** `SQLiteStore.tx()` wraps the Core local write transaction with the configured coordinator.
- **Provider participation exists:** Provider write helpers wrap local Provider transactions with its configured coordinator; async validation is outside the lease and synchronous final local checks re-enter it.
- **Gateway participation exists as a primitive:** Gateway takes the coordinator, checks accepted heads and synchronous evidence readers, commits `DISPATCH_STARTED`, releases the coordinator, then calls the injected transport.
- **End-to-end production participation is NOT PROVEN:** no Gateway runtime wiring in `src/index.js`, no current-main ST protected-route callsite, no proof all deployed processes share the same DB file/ACL/process boundary, and no dispatch-ledger restore protection proof.

No runtime tests were run for this inventory.

## 2. Shared coordinator contract

Source: `src/storage/coordinator-lock.js`.

| Function | Current behavior | Constraint |
|---|---|---|
| `openCoordinatorDatabase(path)` | Requires absolute file-backed path; opens SQLite; configures busy timeout | All participants must use the same actual file and filesystem identity |
| `beginCoordinatorLock(db)` | `BEGIN IMMEDIATE`; returns idempotent release callback using `ROLLBACK` | Lease is lock-only, not business data; caller must release |
| `withCoordinatorLock(db, callback)` | Executes synchronous callback under lease | Rejects async callbacks/thenables; never await while held |

The helper's comments explicitly describe cross-process serialization only when all participants receive the same absolute path. A matching path string is not enough for deployment proof: verify canonical path/inode, process identity, permissions, WAL/SHM access and that no participant can silently open a different file.

## 3. Core writer inventory

Source: `src/storage/sqlite-store.js`.

### 3.1 Common transaction boundary

- `SQLiteStore.tx(fn)` is the outer Core write boundary. It acquires the coordinator lease when configured, opens the Core SQLite write transaction, runs a synchronous callback, advances/validates accepted-head state where configured, commits/rolls back, and releases the coordinator.
- Nested writes use savepoints under the outer transaction.
- Constructor startup acquires the coordinator before migration; migrations call `this.tx(applyMigration)`.
- Public `migrate()` executes each unapplied migration through `tx()`; no separate migration bypass was confirmed in this source inspection.

This is a cooperative boundary. Direct DB handles, separate processes, restore tools, filesystem replacement and unreviewed maintenance paths can bypass it.

### 3.2 Known tx-backed writer methods

| Method | Approx. source line | Disclosure relevance | Required participation review |
|---|---:|---|---|
| `createWorld()` | 901 | World identity/lifecycle | Include create/reset/import/restore transitions if an active dispatch can target the world |
| `registerMechanicTemplate()` | 917 | Rule/behavior authority | Pin version if it affects policy or source interpretation |
| `registerRuleModuleManifest()` | 962 | Rule authority | Pin exact module/version and include policy invalidation if relevant |
| `registerContextManifest()` | 1483 | Context/schema authority | Decide whether manifest version affects protected payload schema or visibility |
| `validateCommit()` | 1677 | Commit validation boundary | Verify it is validation-only or identify any writes; do not infer from method name |
| `commit()` | 1692 | Canonical state/events/entity source versions | Mandatory if entity/status/policy/source facts can change |
| `commitSegment()` | 1967 | Canonical batch mutation | Mandatory; same ordering as single commit |
| `createTimeAdvanceOperation()` | 2050 | Time/process lifecycle | Include if time or due effects can change protected facts/policy |
| `resumeTimeAdvanceOperation()` and operation transitions | 2116 onward | Time/process lifecycle | Verify every transition and recovery path |
| `registerTimeTrigger()` | 2352 | Trigger configuration | Include if trigger config can alter canonical progression relevant to protected facts |
| `cancelTimeTrigger()` | 2404 | Trigger lifecycle | Same condition as trigger registration |
| `registerTimeConfiguration()` | 2439 | World time configuration | Include if protected decision depends on time/rule config |
| `rollback()` | 2532 | Canonical rollback/retraction | Mandatory; invalidates source and possibly acquisition pins |
| `rebuild()` | 2793 | Projection/recovery | Must be classified: read-model rebuild vs authoritative state/accepted-head mutation |

The line/method list is a starting inventory from current `sqlite-store.js`, not an exhaustive inventory of every route, maintenance tool, direct SQL path or external writer. Any method that can alter actor binding, world ownership, canonical entity status/revision, source validity, policy or accepted-head state must be included even if its name is not listed above.

### 3.3 Core gaps still to close

1. Complete API/service call graph for every tx-backed writer and every direct database mutation.
2. Separate actor-binding and Host conversation binding create/revoke writer callsites and verify their participation.
3. Enumerate restore, backup replacement, migration tooling and operational maintenance writers.
4. Prove the configured coordinator path is identical across Core, Provider and Gateway processes.
5. Confirm accepted-head state and rollback/restore semantics under partial restore and stale backups.
6. Determine whether any policy/authority state lives outside this SQLiteStore and needs its own writer participation.

## 4. Memory Provider writer and authorization inventory

Source: `src/application/sqlite-memory-provider.js`.

### 4.1 Shared local write wrappers

- `#withCoordinatorLock(work)` acquires the configured coordinator unless already nested.
- `#withImmediateTransaction(work)` takes the coordinator, starts Provider-local `BEGIN IMMEDIATE`, tracks changes, advances accepted-head state when configured, commits/rolls back and finalizes the accepted-head operation.
- `#withSerializedWrite(work)` routes writes through the immediate transaction unless already nested.
- The Provider maintains process-local state/query/record authorization generations as additional race detectors. Those in-memory counters are not a cross-process authority; SQLite `data_version` and durable grants supplement them.

### 4.2 Known Provider writers

| Method / path | Approx. source line | Current handling | Required participation review |
|---|---:|---|---|
| Constructor schema and accepted-head initialization | 194–390 | Startup initialization under Provider coordinator/transaction path | Include startup recovery/migration and partial initialization |
| `#setState()` | 752 | `#withSerializedWrite` | Readiness/current/stale/unavailable transitions must invalidate pending disclosure |
| `grantQuery()` | 785 | `#withSerializedWrite` | Query grant/revoke must participate |
| `grantRecord()` / `#grantRecord()` | 797–815 | `#withSerializedWrite` | Record grant/revoke must participate |
| `revokeRecord()` | 816 | delegates to grant false | Must be treated as a revocation writer |
| `authorizeCandidate()` final check | 832 onward | async source validation outside lock; final grants/readiness/data-version checks under coordinator + local transaction | Candidate authorization is not a durable dispatch lease; recheck at final egress |
| `putRecord()` / `#putRecordUnderLock()` | 941–1029 | coordinator around record/index phases; each write serialized | Record, lineage, evidence assessment, disposition and index mutation must invalidate pending disclosure |
| `rebuildIndex()` | 1033 | state invalidation and index rebuild under serialized writes | Rebuild start/failure/success must be visible to final egress |
| `reconcile()` | 1057–1215 | async validation outside lock; final record/index comparison and ready/current publication under coordinator | All pre/final transitions must fail closed; complete inventory attestation must be authoritative |
| `retrieveCandidates()` | 1220 onward | final query/grant/readiness/candidate projection rechecked under coordinator | Retrieval is not final model disclosure; no stale result may be reused |

### 4.3 Raw Host source paths

Current raw Host message capture/read/derived-copy/delete/purge paths are explicitly not approved and throw not-approved errors in the inspected Provider source. They are not valid shortcuts for NPC context construction. Keep them closed unless a separate retention and lineage contract is approved.

### 4.4 Provider gaps still to close

1. Verify every Provider public method and every DB write, including startup, reconciliation, rebuild, purge/tombstone and recovery.
2. Prove all Provider instances/processes use the exact same coordinator DB as Core and Gateway.
3. Prove all operational restore/maintenance scripts participate or keep Provider non-ready during recovery.
4. Prove authoritative Host inventory completeness; Provider cannot manufacture completeness from its own record set.
5. Preserve distinction between Provider-local readiness, query/record grants, source lineage and final disclosure authorization.

## 5. Gateway and dispatch-ledger inventory

Source: `src/security/memory-dispatch-gateway.js`.

### 5.1 Current path

1. Validate request shape and normalize source/candidate sets.
2. Build a digest over route/model/stream/body digest/world/actor/purpose/source/candidate binding.
3. Acquire the shared coordinator.
4. Read accepted-head status; reject pending/un-enrolled/mismatched Core or Provider.
5. Call injected synchronous `readCoreEvidence` and `readProviderEvidence`; reject Promise results and mismatched scope/readiness/head/source/candidate sets.
6. Insert and commit a durable `DISPATCH_STARTED` row in the Gateway ledger while the coordinator is held.
7. Release the coordinator.
8. Call injected `sendUpstream`.
9. Record `COMPLETED` or `UNKNOWN`; no automatic resend for ambiguous `STARTED` rows after restart.

The durable dispatch-start is therefore ordered against participating writers only if they share the same coordinator. The actual transport call occurs after coordinator release. Under the current code's stated semantics, a crash after durable start but before or during transport must remain UNKNOWN and must not be retried automatically.

### 5.2 Exact limitations

- `MemoryDispatchGateway` is not constructed in current `src/index.js`; no production ST route wiring is shown.
- `readCoreEvidence`, `readProviderEvidence`, and `sendUpstream` are injected. Their production authority and exclusivity are not proven by this module.
- Current route allowlist contains `host-selected-chat-generation`, while the source comment says the supported route is Google AI Studio chat. The project direction has removed Google; this route/transport must be made provider-neutral before it is an acceptable target.
- The dispatch ledger is separate durable storage. Core/Provider accepted-head enrollment does not automatically prove the dispatch ledger itself cannot be rolled back to an older backup.
- Current request binding does not yet show the full PC-NEXT-07 envelope: Host session/generation, recipient, policy authority generation/fingerprint and lane-specific acquisition pins are not part of the inspected digest shape.
- No current-main evidence proves every alternate ST provider/extension/backend route is blocked for protected payloads.

### 5.3 Dispatch ledger anti-rollback requirements

Before release, prove:
- dispatch ledger has its own accepted-head or equivalent anti-rollback protection;
- restoring an older dispatch DB cannot erase a previously seen request ID or unresolved digest;
- restoring only one of Core, Provider, coordinator or dispatch ledger causes NON_READY until reconciliation;
- accepted-head recovery cannot silently enroll a stale dispatch ledger;
- a durable `DISPATCH_STARTED` cannot be reset to unseen by backup restore;
- all recovery operations are auditable and cannot be invoked by the model/ordinary adapter principal.

No particular table/schema is prescribed here. The storage owner must design the mechanism against the actual backup/restore tooling.

## 6. Cross-process participation proof

If D0 Option B is selected, the minimum deployment proof is:

| Proof | Required evidence |
|---|---|
| Same coordinator object | Canonical resolved path + device/inode identity for Core, Provider and Gateway processes |
| Same permissions | Process identities and DB/WAL/SHM ACLs; no unauthorized write access |
| All writers participate | Enumerated callsites and deterministic cross-process contention tests |
| No alternate coordinator | Startup rejects mismatched coordinator path/identity |
| Restore safety | Controlled stale/partial restore tests for each durable store |
| Gateway exclusivity | Exact Host route call graph + outbound interception showing zero bypass |
| Durable order | Barrier-controlled race with revocation/readiness/source mutation and dispatch-start; assert outbound call count and ledger state |

A local unit test for `beginCoordinatorLock()` proves only the helper. It does not prove that production writers use it or that the Gateway is the only transport.

## 7. Remaining inventory unknowns

The following are intentionally **not marked covered**:
- full Core API/service call graph for all source/policy/actor-binding mutations;
- all maintenance, restore and backup writers;
- all Host routes, extensions and alternate backends that may send protected payloads;
- actual provider-neutral Gateway adapter and credential custody;
- dispatch-ledger anti-rollback;
- exact production process topology and filesystem ACLs;
- final disclosure authority schema and policy generation;
- whether D0 Option A or B is accepted cross-owner.

These are blockers for a completeness claim, not permission to infer that the omitted paths are safe.

## 8. Required next work

1. Map each Core tx-backed writer to its API/service entry point and identify direct DB/restore bypasses.
2. Map each Provider writer to its API/service/maintenance entry point and verify all processes use the same coordinator.
3. Design dispatch-ledger anti-rollback and partial-restore fail-closed behavior.
4. Replace the current provider-specific Gateway route assumption with a provider-neutral Host transport contract, after provider ownership is decided.
5. Run deterministic multi-process barrier tests only after the owners approve the concrete mechanism and isolated test environment.

No production code, database, runtime config, SillyTavern installation or vectorization was changed. No tests were run.

## 9. Change log

- **v1:** source-level Core/Provider/Gateway writer inventory; separates existing cooperative coordinator primitives from unproven deployment completeness and dispatch-ledger anti-rollback.
