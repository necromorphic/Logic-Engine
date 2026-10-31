# Issue #770 — SQLite database-role inventory

**Status:** static source inventory; not a trusted runtime registration manifest.  
**Repository evidence:** current `main` source inspected on 2026-10-30.  
**Host evidence:** user-supplied `SillyTavern-release.zip` and `ST-VectorService.zip` inspected on 2026-10-30.  
**Purpose:** enumerate distinct SQLite files, their owners, and every additional access path that must be included before production VFS activation.

## 1. Logic-Engine `node:sqlite` files

| Logical role | Path source | Owning component | Access patterns and notes |
|---|---|---|---|
| Core world store | `SQLiteStore(path)`; file-backed path is resolved by the constructor | `src/storage/sqlite-store.js` | Opens the Core DB after opening the coordinator. The Core DB also contains local accepted-head state and enrollment audit tables; these are not a separate SQLite file. `:memory:` is used by isolated tests and has no file-backed role. |
| Shared coordinator | `LOGIC_ENGINE_COORDINATOR_DB_PATH`; if unset for a file-backed Core store, defaults to `<corePath>.coordinator.sqlite` | `src/storage/coordinator-lock.js`, called by Core, Provider, Host ledger, Dispatch Gateway, enrollment and recovery | One shared lock database used by multiple components/processes. It must be enrolled once as one logical role, not assigned a different identity per caller. |
| Memory Provider store | Constructor `path` supplied to the Provider | `src/application/sqlite-memory-provider.js` | Opens the shared coordinator first, acquires its lock, then opens the Provider DB. Must be a distinct file from the coordinator and Core DB. |
| NPC goal/plan repository (planned) | Dedicated NPC-owned SQLite file required by docs/99; production path is not selected | `createNpcGoalPlanRepository({ database })` prototype in PR #806 accepts an injected connection and uses `:memory:` in tests | Not a current production open or runtime role. Before production callers are wired, this must become an explicit file-backed role with a trusted path/identity, startup registration, backup/recovery policy, and exact-scope ownership. It remains separate from Core's canonical world-state DB. |
| Host version digest ledger | Constructor `path` supplied to `HostVersionDigestLedger` | `src/application/host-version-digest-ledger.js` | Own SQLite file; opens coordinator first, then the ledger under the coordinator lock. The adjacent `<coordinatorPath>.monotonic-anchor.log` is a separate append-only file, not SQLite. The ledger stores digests and lifecycle metadata, not raw message text. |
| Memory dispatch ledger | `ledgerPath` supplied to `MemoryDispatchGateway` | `src/security/memory-dispatch-gateway.js` | Own SQLite file; opens coordinator first, then the ledger. Its read-only evidence helper can also open the existing Core and Provider files; those are additional handles to existing roles, not new database roles. |
| Accepted-head authority | `path` supplied to `AcceptedHeadAuthority` | `src/security/accepted-head-authority.js` | Separate durable authority database. The class contract requires the file to be writable only by the authority service identity; the class itself does not provision OS ACLs or install the service. |
| Core/Provider enrollment and recovery handles | `databasePath` plus shared `coordinatorPath` | `src/security/enroll-accepted-head-domain.js`, `src/security/recover-accepted-head-domain.js` | These helpers temporarily open an existing Core or Provider DB while holding the shared coordinator. They are not additional database files or independent roles. |

### Current constructor-level startup order

- Core: coordinator DB opens before the Core DB.
- Memory Provider: coordinator DB opens before the Provider DB.
- Host version digest ledger: coordinator DB opens before the ledger DB.
- Dispatch Gateway: coordinator DB opens before the dispatch ledger.
- Accepted-head enrollment/recovery: coordinator opens and is locked before the existing Core/Provider DB is opened.
- Accepted-head authority: opens its own authority DB in its constructor.

These are component-local orders. This inventory does **not** establish one global process startup orchestrator or prove that all role registrations happen before the first file-backed open.

## 2. SillyTavern host and vector storage

Static inspection of the supplied SillyTavern release archive found:

- No first-party server-side `node:sqlite`, `DatabaseSync`, `sqlite3`, or `better-sqlite3` usage in the inspected source.
- Chat histories are handled as `.jsonl` files by the chat endpoints.
- The first-party vector endpoint creates `vectra.LocalIndex` instances under the per-user `directories.vectors` hierarchy. This is a filesystem-backed vector index, not evidence of a SQLite database.
- Therefore the Node `node:sqlite` VFS inventory does not imply control over SillyTavern's JSONL chat files or Vectra index files. Those require separate Host filesystem trust/inventory rules.

This is a static archive inspection, not a runtime inventory of third-party extensions or the user's installed SillyTavern directory. The supplied archive did not establish a Git commit SHA.

## 3. ST-VectorService — separate SQLite engine

The separately supplied `ST-VectorService.zip` contains a different SQLite path:

- Package `st-vectorservice@1.0.0`; locked driver `better-sqlite3@13.0.3`.
- `server.js` opens `vectors.sqlite` with `new Database(DB_PATH)`.
- The path is `path.join(path.resolve(ST_VECTOR_ROOT || process.cwd(), 'vector_storage'), 'vectors.sqlite')`.
- Startup enables WAL, `synchronous=NORMAL`, a 10-second busy timeout and `temp_store=MEMORY`.
- Shutdown attempts `wal_checkpoint(TRUNCATE)` before closing the database.
- The supplied archive includes `vectors.sqlite`, `vectors.sqlite-wal` and `vectors.sqlite-shm`; their archive timestamps do not prove a consistent snapshot.

This driver embeds a separate SQLite engine. A VFS registered only in Node's `node:sqlite` engine does not cover it. It needs a separately proven VFS integration against the exact `better-sqlite3` SQLite build, or an explicit driver consolidation/migration.

## 4. Required registration model

The eventual trusted inventory must distinguish:

1. **Unique physical database roles:** Core, shared Coordinator, Provider, Host digest ledger, Dispatch ledger, Accepted-head authority, and ST-VectorService.
2. **Additional handles to existing roles:** Core/Provider read-only evidence readers and enrollment/recovery helpers. They must resolve to the same trusted role identity rather than enrolling aliases as new roles.
3. **Non-SQLite Host stores:** SillyTavern JSONL chats and Vectra index files. They are outside the SQLite VFS and need a separate Host-side trust boundary.
4. **Test-only in-memory stores and fixtures:** excluded from production role enrollment.
5. **Planned NPC goal/plan store:** a future additional role. PR #806's adapter is injected-connection-only and does not open a path; its in-memory tests do not satisfy the secure-open requirement.

For every file-backed role, deployment must supply a stable absolute path, an explicit role ID, a separately protected expected identity, a pinned parent-directory policy, and a sidecar ownership lifecycle. Startup must fail before schema creation, migration, recovery mutation, or serving if any required role is missing, aliased, ambiguous, or registered against an untrusted identity.

## 5. Remaining evidence gaps

- Runtime path values for Core, Provider, Host ledger, Dispatch ledger and Accepted-head authority are deployment supplied; this source inventory cannot resolve them into a concrete deployment manifest.
- The shared coordinator is opened by several components and needs one consistent registration/lifetime owner.
- The authority service's own process identity and OS ACLs are not provisioned by `AcceptedHeadAuthority`.
- The current VFS probe targets only Node's embedded SQLite engine; ST-VectorService's `better-sqlite3` engine remains separate.
- SillyTavern third-party extensions and the installed Host directory have not been runtime-inventoried.
- No production database may be opened through the probe until persistent trust, complete role registration, sidecar lifecycle, recovery/backup tests and independent Security review are complete.

Issue #770 remains open. Memory→NPC remains DISABLED / FAIL-CLOSED.
