# Issue #770 — SQLite engine inventory: ST-VectorService

**Evidence source:** user-supplied `ST-VectorService.zip` archive inspected on 2026-10-30.  
**Purpose:** identify SQLite engines and files that are outside the Node.js `node:sqlite` VFS probe.  
**Scope:** static archive inspection only. No SQLite database was opened, modified, checkpointed, or migrated.

## SillyTavern host boundary

The separately supplied `SillyTavern-release.zip` identifies the host release as **SillyTavern 1.19.0** (Node engine requirement `>=20`). A static search of its packaged JavaScript/JSON files found no `node:sqlite`, `better-sqlite3`, or `sqlite3` imports/references, and its root `package.json` has no SQLite driver dependency. The SQLite database under review therefore belongs to the separately packaged `ST-VectorService` process, not the SillyTavern core process. This does not make it out of scope: the service's own `better-sqlite3` VFS must be secured before its database constructor runs.

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
- [`package.json`](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/package.json): package version 13.0.3; declared Node engine requirement `>=22`. However, its `binding.gyp` requests `NAPI_VERSION=10`, which is only supported starting with Node 22.14.0. Node 22.13.0 exposes Node-API 9 and crashes during native addon registration; rebuilding from source does not change this compile-time requirement. Upstream evidence: [better-sqlite3 issue #1514](https://github.com/WiseLibs/better-sqlite3/issues/1514). The ST-VectorService runtime floor must therefore be `>=22.14.0` when using v13.0.3.
- [`binding.gyp`](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/binding.gyp) and [`deps/sqlite3.gyp`](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/deps/sqlite3.gyp): when building from source, `deps/sqlite3/sqlite3.c` is compiled as a static SQLite library and linked into the `better_sqlite3` native addon.
- [`deps/sqlite3/sqlite3.h`](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/deps/sqlite3/sqlite3.h): exact tag reports SQLite 3.53.4, source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`.
- [`src/objects/database.cpp`](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/src/objects/database.cpp): `Database::JS_new` calls `sqlite3_open_v2(filename, ..., mask, NULL)`; the VFS argument is hard-coded to NULL, selecting that SQLite instance's default VFS.
- The same file's `JS_loadExtension` calls `sqlite3_load_extension(db->db_handle, ...)` on an already-created database handle. This cannot secure that connection's own initial open, but an in-memory bootstrap connection can load a persistent VFS extension before any protected DB connection is constructed.
- [`lib/binding.js`](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/lib/binding.js): runtime loads a platform prebuild when present, otherwise the package's compiled `build/Release/better_sqlite3.node`. The VFS and SQLite build used by the actual installed binary must be verified, not inferred from Node's `node:sqlite` version.

### Exact archive prebuild audit

The supplied archive's native prebuilds were extracted individually (the full 487 MB archive did not need to be materialized). These are the exact SHA-256 fingerprints of the packaged platform binaries:

| Prebuild | Size | SHA-256 | Evidence |
|---|---:|---|---|
| `prebuilds/win32-x64.node` | 1,989,632 bytes | `e21e5efd71fba66578e95b62554d9028064a80dafd7221bf8a8ef155de8d240a` | PE32+ x64; embedded SQLite version string `3.53.4` |
| `prebuilds/linux-x64.node` | 2,226,168 bytes | `6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d` | ELF x64; loaded and queried at runtime |

The Linux x64 prebuild was loaded directly by Node.js v22.16.0 from the extracted archive package. Runtime queries returned:

- `sqlite_version()`: `3.53.4`
- `sqlite_source_id()`: `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`
- The packaged `deps/defines.gypi` sets `SQLITE_USE_URI=0`, so URI filename interpretation is disabled by default. SQLite's compile-options pragma may still list `USE_URI` because the macro is defined; that name alone does not prove the value is `1`. The binding calls `sqlite3_open_v2(..., vfs=NULL)` without `SQLITE_OPEN_URI`, so URI `vfs=` selection is not a valid integration strategy for this package build.

The Windows x64 binary was fingerprinted and its embedded version string inspected, but it could not be executed on the Linux audit host. Its PE import table references `KERNEL32.dll` only; it has no external SQLite DLL dependency. The Linux x64 ELF has no `libsqlite3` dependency in `ldd`/DT_NEEDED; its only non-system allocator dependency is `libjemalloc.so.2`. Together with the packaged amalgamation and runtime source ID, this confirms the Linux prebuild carries its own SQLite engine rather than dynamically using Node's SQLite library. The archive contains several platform prebuilds; the exact binary selected by the user's deployed host still depends on that host's OS/architecture and installed package layout. Therefore the packaged Windows x64 artifact is identified, while runtime source-ID/compile-option confirmation for Windows remains open.

### Audit conclusion

The ST-VectorService `better-sqlite3` connection is **not covered** by the Node 22.13.0 / SQLite 3.47.2 VFS registration. The supplied Linux x64 prebuild was runtime-confirmed to embed SQLite 3.53.4 with the source ID above; the packaged Windows x64 binary contains the same version string. SQLite VFS registrations are local to the SQLite library instance. The no-fork integration sequence is: open an in-memory bootstrap connection in this exact better-sqlite3 engine; load the secure VFS extension into that connection; the extension registers its VFS as the default with `sqlite3_vfs_register(..., 1)`, registers per-connection diagnostics via `sqlite3_auto_extension`, and returns `SQLITE_OK_LOAD_PERMANENTLY`; close the bootstrap connection; then open the protected DB using the ordinary filename. `Database::JS_new` passes `vfs=NULL`, so subsequent opens select the newly registered default VFS. The bootstrap open is in-memory and does not access a protected role. The integration test verifies main DB and WAL opens, close/reopen and integrity. This avoids modifying the better-sqlite3 native constructor. URI selection is explicitly not used because the package build sets `SQLITE_USE_URI=0`.

Primary integration uses the unmodified binding and default VFS registration. A controlled fork/rebuild is a fallback only if a target platform binary cannot load the extension or cannot retain the registered default VFS for later connections. Any fallback must build the secure backend against the exact SQLite amalgamation and compile options, register it before the first protected DB is opened, fail closed on registration/manifest errors, and run the DB/WAL/SHM/locking/restart/crash suite on that addon-specific engine.

**Remaining evidence gap:** the packaged Linux and Windows x64 prebuilds have now been extracted and fingerprinted; the Linux binary's SQLite source ID and compile options were queried at runtime. The exact binary selected by the deployed Windows host has not been runtime-queried on Windows, and the installed service's actual loaded module path has not been captured from a running process. No SQLite database contents were opened or changed.

## Security consequences for Issue #770

1. The deployment inventory must treat ST-VectorService as a separate protected SQLite engine/role, not as a database already covered by the Node `node:sqlite` VFS proof.
2. The `better-sqlite3` engine needs independent VFS registration and selection evidence. A VFS registered only in the Node `node:sqlite` engine cannot cover the separately compiled SQLite engine embedded in `better-sqlite3`; the stock-binding default-VFS route must be validated against each deployed platform binary.
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


## Required ST-VectorService host integration (pending production VFS)

The supplied ST-VectorService archive has no root `engines` declaration, while its installed `better-sqlite3@13.0.3` addon requires Node-API 10. Before shipping that dependency, the service package must declare `"engines": { "node": ">=22.14.0" }` and fail fast before the first database constructor when `Number(process.versions.napi) < 10`. The SillyTavern archive itself advertises a broader Node floor, so this constraint belongs to the separate ST-VectorService process/package and must be documented in its install instructions.

The current service opens its database at `server.js:261`, after creating `vector_storage` and before WAL/schema setup. Once the production secure VFS library exists for the service's exact platform and SQLite 3.53.4 build, change that sequence to: (1) validate Node-API 10; (2) create a temporary `new Database(':memory:')`; (3) load the production VFS extension using its fixed trusted path and explicit entrypoint; (4) close the bootstrap connection; (5) construct `new Database(DB_PATH)` normally; (6) immediately perform role-manifest enrollment/validation before schema or WAL work. Do not load the current identity-probe library in production: its source explicitly states it is not a production secure VFS.
