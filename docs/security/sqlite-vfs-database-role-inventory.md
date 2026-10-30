# Issue #770 — protected SQLite database-role inventory

**Status:** evidence-based implementation inventory; not a production authorization.  
**Evidence baseline:** main at a982ccaf7dbd4db730821616b7b110c2cc8441bd, plus the user-supplied ST-VectorService archive inventory in [98](../98-issue-770-sqlite-engine-inventory-st-vectorservice.md).  
**Purpose:** identify every known persistent SQLite role and every production open path that must be covered before the VFS can be considered for integration.

## 1. Runtime boundary

PR #798 proves a feasibility path only for Node.js 22.13.0's bundled SQLite 3.47.2 through node:sqlite. A role registration in one process does not protect another process. Each process must load and verify the native VFS before its first protected file-backed DatabaseSync open, and every file-backed open must resolve to an explicitly enrolled role.

The current runtime does not yet install or register the VFS. This document does not authorize wiring production stores to the probe.

## 2. Known SQLite roles

| Proposed stable role ID | Database / path source | Current open sites | Notes |
|---|---|---|---|
| core | ENGINE_DB_PATH (default ./data/logic-engine.sqlite) | SQLiteStore in src/storage/sqlite-store.js; accepted-head enrollment/recovery scripts; read-only evidence readers supplied to the dispatch gateway | Canonical Core world state and local accepted-head state. One physical DB, one role identity, regardless of read/write connection. |
| coordinator | LOGIC_ENGINE_COORDINATOR_DB_PATH | openCoordinatorDatabase() in src/storage/coordinator-lock.js; used by Core, Provider, Host version ledger, dispatch gateway, and accepted-head enrollment/recovery | Shared lock primitive, not business data. All participants must resolve to the same protected file and role identity. Do not register each connection as a different role. |
| provider | SQLiteMemoryProvider({ path, coordinatorPath }) | SQLiteMemoryProvider in src/application/sqlite-memory-provider.js; accepted-head enrollment/recovery scripts; read-only evidence readers supplied to the dispatch gateway | File-backed Provider store is supported by the class but is not constructed by the current src/index.js entry point. Its deployment path/owner must be made explicit before enrollment. |
| host-version-ledger | ENGINE_HOST_VERSION_LEDGER_DB_PATH (default ./data/logic-engine-host-versions.sqlite) | HostVersionDigestLedger in src/application/host-version-digest-ledger.js | Digest/identity metadata ledger. It also opens the shared coordinator DB. |
| dispatch-ledger | MemoryDispatchGateway({ ledgerPath, coordinatorPath, ... }) | MemoryDispatchGateway in src/security/memory-dispatch-gateway.js | Durable dispatch-start/outcome ledger. The gateway opens this DB directly and opens Core/Provider evidence through caller-supplied readers. Its current constructor checks aliasing against the coordinator, but does not itself receive canonical Core/Provider paths for a complete cross-role alias check. |
| accepted-head-authority | LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH | AcceptedHeadAuthority in src/security/accepted-head-authority.js, launched by scripts/security/run-accepted-head-authority.js | Separate authority process and restore domain. The authority DB must be protected by its own OS service identity and backup policy. It cannot rely on the Core process's process-local VFS registry. |
| st-vectorservice | ST_VECTOR_ROOT + vector_storage/vectors.sqlite | ST-VectorService/server.js in the supplied archive | Uses better-sqlite3 13.0.3, not Node's node:sqlite. Its main DB/WAL/SHM are outside the current VFS proof; see [98](../98-issue-770-sqlite-engine-inventory-st-vectorservice.md). |

The core and provider accepted-head state tables are part of their respective existing DB roles; they are not separate database files. The Host version ledger, dispatch ledger, coordinator, and accepted-head authority are separate files when deployed as designed.

## 3. Direct open paths that must be covered

The production source currently contains these direct DatabaseSync open boundaries:

- src/storage/sqlite-store.js — Core database.
- src/storage/coordinator-lock.js — shared coordinator database.
- src/application/sqlite-memory-provider.js — Provider database.
- src/application/host-version-digest-ledger.js — Host version digest ledger.
- src/security/memory-dispatch-gateway.js — dispatch ledger and read-only Core/Provider reader helper.
- src/security/accepted-head-authority.js — independent authority database.
- src/security/enroll-accepted-head-domain.js and src/security/recover-accepted-head-domain.js — administrative direct opens of an existing Core or Provider database after acquiring the coordinator lock.

The enrollment/recovery scripts must use the same role identity as the target Core/Provider DB; they must not create a second role for the same physical file. The read-only dispatch evidence readers likewise use the existing Core/Provider role identities with read-only access, not new database identities.

Test-only direct opens, fixture databases, and observation connections are not production roles. They must remain isolated from production data and must not be treated as evidence that runtime startup has enrolled a production role.

## 4. Non-SQLite persistent files and Host stores

- HostVersionDigestLedger creates a MonotonicSourceAnchor at coordinatorPath + '.monotonic-anchor.log'. This is a separate persistent file and is not covered by a SQLite VFS. Its identity, permissions, atomic update, rollback resistance, backup, and recovery policy require a separate file-security contract.
- The World Pack catalog and its artifacts are deployment-controlled files, not SQLite databases.
- SillyTavern's native persistence and every installed extension still require a complete Host inventory. The current VFS work does not prove that all Host data paths or extension stores are SQLite, or that all Host opens are intercepted.
- ST-VectorService is a separate SQLite engine. A VFS registered only inside Node's node:sqlite engine cannot be assumed to intercept better-sqlite3.

## 5. Required startup ordering

For each process that opens one or more protected databases:

1. Resolve the deployment-owned role manifest and verify its integrity using a trust anchor outside the ordinary DB restore domain.
2. Load the native VFS into the exact SQLite engine used by that process.
3. Verify the expected SQLite engine/ABI and that protected native hooks are installed and cannot be replaced.
4. Acquire and validate all required role identities before opening any protected database. A role cannot become trusted merely because the current path can be opened.
5. Open the coordinator first where the existing contract requires it, then Core/Provider/ledger stores in their existing dependency order. Registration must precede every one of those opens.
6. On any missing role, duplicate physical identity, manifest mismatch, unsupported path/filesystem, failed native hook, or incomplete inventory, fail startup closed. Do not fall back to ordinary DatabaseSync(path).

The same ordering must be implemented separately in the accepted-head authority process, dispatch gateway process, Provider process, and any maintenance/recovery process that opens protected files.

## 6. Open security decisions

1. **Manifest bootstrap:** define the independently protected manifest format, signing/verification key custody, enrollment approval, rotation, and recovery. A manifest stored beside the DBs and restored with them is not an independent trust anchor.
2. **Directory identity:** authenticate the expected parent-directory chain, not only the final DB file. The current POSIX walk pins components but has no protected expected-identity manifest for them.
3. **Role alias policy:** reject one physical file enrolled under different roles, including hardlinks and aliases. Define intentional same-role multi-connection behavior and process-specific role enrollment.
4. **Sidecar ownership:** the current probe has bounded process-local identity registries and retired-identity retention for surviving hardlinks. It has no persistent WAL/SHM/journal ownership ledger, per-open reference count, or restart reconciliation.
5. **Complete VFS surface:** implement/review temporary files, locking, shared memory, delete semantics, parent-VFS bypasses, error mapping, checkpoint/recovery, and every callback that can reach a protected file.
6. **Accepted-head authority bootstrap:** decide how the authority DB itself is protected and enrolled without assuming the Core service's VFS or authority process is already trusted.
7. **ST-VectorService:** choose and prove a separate better-sqlite3 VFS strategy or move the service to one explicitly controlled SQLite engine. Do not mark it covered by PR #798.
8. **Host inventory:** inspect the supplied SillyTavern release and installed extensions, including non-SQLite persistence and direct native filesystem access. The current archive inventory is not yet a complete Host acceptance.
9. **Operational lifecycle:** migrations, backup/restore, corruption recovery, process restart, shutdown, sidecar cleanup, and authorized re-enrollment must be tested on Windows and Linux.

## 7. Acceptance rule

No production Core, Coordinator, Provider, Host-version-ledger, dispatch-ledger, accepted-head-authority, or ST-VectorService database may be opened through the feasibility probe until the applicable role manifest, engine-specific interception, startup ordering, full file-operation surface, adversarial tests, operational recovery, and independent Security review are complete.

Memory→NPC remains DISABLED / FAIL-CLOSED.
