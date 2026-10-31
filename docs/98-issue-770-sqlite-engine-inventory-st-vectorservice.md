# Issue #770 — SQLite engine inventory: ST-VectorService

**Evidence source:** user-supplied `ST-VectorService.zip` archive inspected on 2026-10-30.  
**Purpose:** identify SQLite engines and files that are outside the Node.js `node:sqlite` VFS probe.  
**Scope:** static archive inspection only. No SQLite database was opened, modified, checkpointed, or migrated.

## Confirmed implementation

- Package: `st-vectorservice` version `1.0.0`.
- Locked dependency: `better-sqlite3` version `13.0.3` (declared range `^13.0.3`).
- Entry point: `server.js`, ES module.
- Database driver: `import Database from 'better-sqlite3'`.
- Storage directory: `path.resolve(process.env.ST_VECTOR_ROOT || process.cwd(), 'vector_storage')`.
- Database path: `path.join(STORAGE_DIR, 'vectors.sqlite')`.
- Database is opened with `new Database(DB_PATH)`.
- Startup PRAGMAs: `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 10000`, `temp_store = MEMORY`.
- Shutdown attempts `wal_checkpoint(TRUNCATE)` and then closes the database.

This is a separate native SQLite binding and SQLite build from Node.js 22.13.0's embedded `node:sqlite` engine used by PR #798. The existing VFS probe does not cover this database.

## Database artifacts present in the supplied archive

| Relative path | Archive size | Archive timestamp |
|---|---:|---|
| `vector_storage/vectors.sqlite` | 232,636,416 bytes | 2026-10-24 15:01:56 |
| `vector_storage/vectors.sqlite-wal` | 198,658,192 bytes | 2026-10-25 00:20:02 |
| `vector_storage/vectors.sqlite-shm` | 32,768 bytes | 2026-10-25 10:12:24 |

The archive contains the main database and both WAL sidecars. These are independent archive-entry timestamps, not proof of a consistent SQLite snapshot or of the database's live state. The database and sidecars were not opened or inspected internally.

## Backup evidence

The archive contains several `vector_storage_backup_*` directories with Vectra `index.json` files and metadata. The inspected archive listing did not show a corresponding `vectors.sqlite` backup in those directories. Therefore these visible backups must not be treated as SQLite database backups or as proof that the WAL database can be restored.

The archive also contains large `index.json.backup` and `index.json.pre-optimization.backup` files under a Vectra index directory. These are not SQLite backups.

## Separate source audit: upstream better-sqlite3 v13.0.3

**Audit basis:** exact upstream tag `WiseLibs/better-sqlite3@v13.0.3`, not an assumption based on the Node.js SQLite version.

Source files inspected:
- `package.json`: package version 13.0.3; Node engine requirement >=22.
- `binding.gyp` and `deps/sqlite3.gyp`: when building from source, `deps/sqlite3/sqlite3.c` is compiled as a static SQLite library and linked into the `better_sqlite3` native addon.
- `deps/sqlite3/sqlite3.h`: exact tag reports SQLite 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`.
- `src/objects/database.cpp`: `Database::JS_new` calls `sqlite3_open_v2(filename, ..., mask, NULL)`; the VFS argument is hard-coded to NULL, selecting that SQLite instance's default VFS.
- The same file's `JS_loadExtension` calls `sqlite3_load_extension(db->db_handle, ...)` on an already-created database handle. Loading an extension through this API is therefore too late to secure the initial `new Database(DB_PATH)` open.
- `lib/binding.js`: runtime loads a platform prebuild when present, otherwise the package's compiled `build/Release/better_sqlite3.node`. The VFS and SQLite build used by the actual installed binary must be verified, not inferred from Node's `node:sqlite` version.

### Audit conclusion

The ST-VectorService `better-sqlite3` connection is **not covered** by the Node 22.13.0 / SQLite 3.47.2 VFS registration. The upstream v13.0.3 source embeds a distinct SQLite 3.53.4 engine in its native addon. SQLite VFS registrations are local to the SQLite library instance; the secure VFS must be compiled/registered inside this addon before its first `sqlite3_open_v2`, and the open call must select the secure VFS explicitly (or the secure VFS must be made the verified default before any connection opens). The current `loadExtension()` route cannot protect the first open.

A valid integration therefore requires a controlled fork/rebuild of `better-sqlite3` v13.0.3 (or a reviewed replacement binding) that:
1. builds the secure backend against the exact SQLite 3.53.4 amalgamation and compile options used by the deployed addon;
2. registers it during addon initialization before any Database object can be constructed;
3. changes the database open path to select the secure VFS explicitly;
4. fails closed if registration or role-manifest validation did not complete;
5. runs the same DB/WAL/SHM/locking/restart/crash adversarial suite on the addon-specific engine.

**Remaining evidence gap:** the uploaded ST-VectorService archive is 487,558,036 bytes and exceeded the available 100 MiB materialization limit. The upstream source tag is audited, and the earlier archive inventory confirms the declared package/driver/startup configuration, but the exact `prebuilds/*.node` or installed `better_sqlite3.node` binary inside that archive has not been extracted and hashed. The actual deployed binary's SQLite version/source ID/compile options must be queried from that binary before calling this audit complete. No database contents were opened or changed.

## Security consequences for Issue #770

1. The deployment inventory must treat ST-VectorService as a separate protected SQLite engine/role, not as a database already covered by the Node `node:sqlite` VFS proof.
2. The `better-sqlite3` native binding needs an independently verified interception/registration strategy. A VFS registered only in the Node `node:sqlite` SQLite engine cannot be assumed to cover the separately compiled SQLite engine embedded in `better-sqlite3`.
3. Its DB, WAL and SHM files must be included in the same trusted directory/identity and sidecar ownership model.
4. The dynamic `ST_VECTOR_ROOT` setting means the final storage path is deployment-configurable; a hard-coded path assumption is invalid.
5. Startup opens the DB before the HTTP listener is started. Any secure registration must therefore happen before `new Database(DB_PATH)`, not after service startup.
6. Shutdown performs a WAL checkpoint before close. The secure backend must cover checkpoint, close, crash recovery and restart; a test of ordinary DB opens alone is insufficient.
7. The archive shows a 198 MB WAL sidecar at capture time. This is a concrete reason to test WAL lifecycle and recovery, not evidence of corruption.

## Required next decision

Do not silently declare ST-VectorService out of scope. Choose one of these explicit integration strategies during implementation:

- build/ship a reviewed native VFS integration against the exact SQLite build used by `better-sqlite3`, and prove it is installed before `new Database(DB_PATH)`; or
- replace/alter the driver architecture so the service uses a single explicitly controlled SQLite engine/VFS boundary, with compatibility and migration tests.

Until one strategy is implemented and independently reviewed, ST-VectorService's SQLite store remains outside the protection proven by PR #798. No production activation is authorized by this inventory.
