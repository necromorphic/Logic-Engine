# PC-NEXT-06 — Core / Provider writer coverage matrix

Date: 2026-10-30  
Repository: `necromorphic/Logic-Engine`  
Audited base: `main` at `8c8b9059ae12af3a63e96eb7cb86851e12a6d925`  
Scope: source inspection only. No runtime writes, database access, tests, vectorization, production changes, PR, or merge.

## Executive result

The current source implements cooperative cross-process serialization for the principal Core and Provider write paths. The mechanism is not a universal SQLite write barrier: any process or code path that writes the business database without participating in the same coordinator can bypass it. This audit therefore distinguishes source-proven protected paths from deployment-level bypasses and from unverified runtime claims.

The source review does **not** establish that all writers in every process participate. It also does not establish OS-level exclusion, restore/rollback exclusion, or cross-database atomicity.

## 1. Shared coordinator primitive

`src/storage/coordinator-lock.js`:

- `openCoordinatorDatabase(path)` requires a file-backed absolute path and opens a separate SQLite database with a busy timeout.
- `beginCoordinatorLock(db)` acquires `BEGIN IMMEDIATE` synchronously and returns a rollback-based release function.
- `withCoordinatorLock(db, callback)` rejects async callbacks / thenables and holds the lease around the synchronous callback.
- The coordinator database is explicitly a lock primitive, not a business-data store.
- It is cooperative. It cannot prevent a separate process from opening Core/Provider SQLite files and issuing DML/DDL directly.

## 2. Core writer matrix

Source: `src/storage/sqlite-store.js` (current main; blob `ff23625d91fc6b713b17826628e94c13e0f0e5de`).

| Writer class | Source path / mechanism | Coverage classification | Notes |
|---|---|---|---|
| Core startup schema DDL | `SQLiteStore.constructor` opens coordinator lease before opening DB, executes `schemaSql`, accepted-head initialization, then `migrate()`; releases lease after successful initialization or in catch | **Source-proven protected** | Includes initial table/index creation and startup migration sequence in this constructor. |
| Schema migrations | `migrate()` called while constructor lease is held | **Source-proven protected during startup** | Migration steps include ALTER/CREATE, backfill UPDATE/INSERT and schema_migrations writes. Public direct invocation of `migrate()` after construction is not shown as independently acquiring coordinator; treat as an exposed bypass candidate unless call sites prove it is constructor-only. |
| Main Core mutation transaction | `SQLiteStore.tx(fn)` acquires coordinator when lease depth is zero, then `BEGIN IMMEDIATE`, runs synchronous callback, performs accepted-head check/advance if configured, commits or rolls back, then releases coordinator | **Source-proven protected** | Nested calls use savepoints inside the outer transaction. Async callbacks/thenables are rejected. |
| World creation, registry writes, event commits, rollbacks, context manifests, time operations, trigger/process recovery | Store methods observed call `this.tx(() => ...)`; internal writes include INSERT/UPDATE/DELETE and rebuilds | **Protected when entered through tx** | The reviewed mutation paths use the shared wrapper. This is not proof that arbitrary direct access to `store.db` is impossible. |
| Read-only queries / snapshots | Direct SELECT and read transactions | **Not a writer** | Some read methods use local read transactions; they do not establish write coverage. |
| ProcessStore operations | `ProcessStore` shares `store.db`; recovery call `processStore.markNeedsReview` occurs inside a surrounding `this.tx()` callback | **Protected for observed nested call** | Full ProcessStore public-method inventory was not exhaustively audited in this pass. Since it shares the same DB handle, its mutation entry points need to remain called under the store transaction. |
| Direct `store.db` use by another module/process | Public/internal handle access or independent DB connection | **Unprotected / bypass possible** | Coordinator is not an SQLite authorizer or OS lock policy. Need call-site and deployment controls to prove absence of bypass. |
| Restore, backup replacement, file copy, maintenance tooling | No complete restore/maintenance writer inventory established in this pass | **Unknown / outside proven coverage** | Must be treated as a separate writer class. Do not infer protection from tx(). |

### Core interpretation

The key guarantee is narrower than “all Core writes are serialized”: writes performed inside the outer `SQLiteStore.tx()` are serialized against other cooperating participants using the same coordinator path. Constructor DDL/migrations are similarly serialized during initialization. A public post-construction migration call, a raw handle write, or an external maintenance process is not covered merely because the store has a coordinator.

Accepted-head enrollment and operation advancement add a second authority protocol inside `tx()`; they do not convert non-participating database writers into participants.

## 3. Provider writer matrix

Source: `src/application/sqlite-memory-provider.js` (current main; blob `7ddcceb6b92a359dfdd4697ff251fba949b053c0`).

| Writer class | Source path / mechanism | Coverage classification | Notes |
|---|---|---|---|
| Provider startup schema DDL | Constructor acquires coordinator before opening Provider DB; executes schema DDL, migration ALTER, accepted-head initialization and readiness invalidation; releases in finally | **Source-proven protected** | Startup readiness UPDATE is inside the startup lease. |
| Provider local transactions | `#withImmediateTransaction(work)` → `#withCoordinatorLock` → `BEGIN IMMEDIATE` → callback → accepted-head advance → COMMIT/ROLLBACK | **Source-proven protected** | Synchronous critical section; nested transaction depth is tracked. |
| Serialized single writes | `#withSerializedWrite(work)` delegates to `#withImmediateTransaction` unless already inside a transaction | **Source-proven protected** | This is the intended wrapper for state/grant/record/index changes. |
| Readiness state | `#setState()` calls `#withSerializedWrite()` before its UPSERT | **Source-proven protected** | The in-memory state-generation increment follows the durable write. |
| Query grants | `grantQuery()` uses `#withSerializedWrite()` for UPSERT | **Source-proven protected** | Process-local generation increment follows durable grant write. |
| Record grants / revocation | `#grantRecord()` uses `#withSerializedWrite()`; `revokeRecord()` delegates with `allowed=false` | **Source-proven protected** | Revocation and grant mutation share coordinator serialization. |
| Raw capture / active-version / derived-copy / tombstone / purge | Public mutation methods use `#withImmediateTransaction()`; raw capture currently throws `MEMORY_RAW_CAPTURE_NOT_APPROVED` before the dormant implementation | **Protected when reachable; raw capture fail-closed** | Do not treat unreachable code after the unconditional throw as an active writer. |
| Ingest / record persistence | Ingest marks readiness stale, persists record through serialized write/transaction path, and separately repairs or updates index | **Source-proven protected for durable writes** | Record and index persistence are intentionally separate recoverable steps, not one atomic business transaction. |
| Index rebuild | `rebuildIndex()` marks stale, deletes/recreates index rows inside `#withImmediateTransaction()`, then publishes readiness state through `#setState()` | **Source-proven protected for DB writes** | Rebuild spans multiple transactions/stages; intermediate non-ready state is intentional. |
| Reconciliation | Async Core snapshot/source validation occurs outside coordinator; final Provider consistency check and readiness publication use `#withImmediateTransaction()` | **Protected final commit; async validation is outside lock** | The source uses generations and final rereads to reject stale attempts. Do not claim the whole async reconciliation is one locked transaction. |
| Retrieval final authorization/readiness checks | Final synchronous grant/readiness/projection checks use `#withImmediateTransaction()` | **Source-proven protected final check** | Earlier reads and awaited source validation are not held under the shared lock; final revalidation is the serialization boundary. |
| Direct Provider DB access by another process | Independent connection or raw handle write | **Unprotected / bypass possible** | Same cooperative-lock limitation as Core. |
| Restore / file replacement / external schema maintenance | No complete external writer inventory established | **Unknown / outside proven coverage** | Requires explicit maintenance protocol and process exclusion. |

## 4. Coverage classes

- **Source-proven protected:** the inspected call path visibly acquires the shared coordinator around the local SQLite mutation.
- **Likely protected / conditional:** a call path delegates to a protected wrapper, but all public callers or all nested methods were not exhaustively traced.
- **Unprotected / bypass possible:** the coordinator is not consulted by the writer, or an independent process can write the DB directly.
- **Unknown:** the source evidence reviewed does not establish the writer's coordination behavior.
- None of these labels is a runtime concurrency test. No exclusion race was executed in this audit.

## 5. Concrete gaps and required follow-up

1. **Core migration entry point:** establish whether `migrate()` is ever called after constructor completion. If it is callable externally, either make the method private/constructor-only or wrap it in the same coordinator protocol without introducing nested-lock deadlocks.
2. **Core/ProcessStore API surface:** enumerate every public mutator and prove it reaches `tx()` (or is only called from a transaction). Audit raw `store.db` consumers across the repository.
3. **Provider write enumeration:** perform a mechanical inventory of every `this.#db.prepare(...).run()`, `this.#db.exec()`, and schema mutation, then map each to constructor lease, `#withImmediateTransaction`, or `#withSerializedWrite`. This pass verified principal paths but was not a full automated exhaustiveness proof.
4. **Maintenance and restore:** define a maintenance mode that excludes Core, Provider, Gateway and external writers while backup/restore/file replacement/schema repair runs. Coordinator participation by normal code is insufficient for a file replacement performed by an independent tool.
5. **Deployment boundary:** OS ACLs/service identities and process ownership must prevent arbitrary processes from opening writable Core/Provider DB files. The prior PC-NEXT-02 report showed one Windows identity runs Core and ST and broad inherited Users permissions; this remains a separate deployment gate.
6. **Gateway integration:** after writer coverage and evidence-assessment correction are resolved, port/reconcile PR #646 against current-main contracts. Do not implement a second lock or detached lease.

## 6. Current PR reconciliation (checked 2026-10-30)

| PR | State | Base → head | Relevance |
|---|---|---|---|
| #398 | CLOSED, merged | main ← shared coordinator branch | Coordinator primitive is already on main. |
| #646 | OPEN, Draft | main ← Gateway dispatch serialization candidate | Not merged; still needs current contract reconciliation and evidence-assessment correction. |
| #709 | CLOSED, merged | main ← source-version ledger | Current canonical source-version contract is on main. |
| #750 | OPEN, Draft | main ← Core SQLite file-identity precision fix | Candidate prerequisite for #756/#760. |
| #756 | OPEN, Draft | #750 branch ← accepted-head ACL candidate | Not merged. |
| #760 | OPEN, Draft | #750 branch ← NPC acquisition reader/belief boundary | Not merged. |

The PR states and branch refs above are point-in-time metadata, not approval or merge recommendations.

## 7. Scope and safety

- Read-only GitHub source inspection only.
- No local worktree modifications, production source changes, tests, database reads/writes, backup/restore, vectorization, provider calls, PR creation or merge.
- No Memory→NPC activation. Host remains NON_READY; Stage 2 remains NO-GO; Memory→NPC remains DISABLED/FAIL-CLOSED.
- No claim is made that source inspection proves runtime exclusion or complete deployment isolation.

## Conclusion

The current implementation has a sound cooperative serialization primitive and the main Core transaction / Provider transaction and serialized-write paths visibly participate. The remaining critical question is coverage completeness, not absence of a coordinator: raw DB access, public mutation entry points, ProcessStore's full API, post-startup migrations, and external maintenance/restore writers must be enumerated and constrained before the coordinator can be treated as a system-wide writer boundary.

Recommended next work: complete the mechanical write-call inventory and public-mutator call graph; then define the maintenance/restore exclusion contract and deployment ACL/process boundary. Only after that should Gateway integration be advanced.
