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

The Windows x64 binary was fingerprinted and then executed on a Windows GitHub Actions runner from the exact archived package. Its smoke test returned SQLite `3.53.4`; a follow-up CI step now records and asserts the exact source ID and compile options. Its PE import table references `KERNEL32.dll` only; it has no external SQLite DLL dependency. The Linux x64 ELF has no `libsqlite3` dependency in `ldd`/DT_NEEDED; its only non-system allocator dependency is `libjemalloc.so.2`. Together with the packaged amalgamation and runtime queries, this confirms both tested prebuilds carry their own SQLite engine rather than dynamically using Node's SQLite library. The archive contains several platform prebuilds; the exact binary selected by the user's deployed host still depends on that host's OS/architecture and installed package layout.

### Audit conclusion

The ST-VectorService `better-sqlite3` connection is **not covered** by the Node 22.13.0 / SQLite 3.47.2 VFS registration. The supplied Linux x64 prebuild was runtime-confirmed to embed SQLite 3.53.4 with the source ID above; the packaged Windows x64 binary contains the same version string. SQLite VFS registrations are local to the SQLite library instance. The no-fork integration sequence is: open an in-memory bootstrap connection in this exact better-sqlite3 engine; load the secure VFS extension into that connection; the extension registers its VFS as the default with `sqlite3_vfs_register(..., 1)`, registers per-connection diagnostics via `sqlite3_auto_extension`, and returns `SQLITE_OK_LOAD_PERMANENTLY`; close the bootstrap connection; then open the protected DB using the ordinary filename. `Database::JS_new` passes `vfs=NULL`, so subsequent opens select the newly registered default VFS. The bootstrap open is in-memory and does not access a protected role. The Linux and Windows integration tests verify main DB, rollback-journal, WAL and WAL shared-memory opens against the exact better-sqlite3 engine. The Windows test additionally verifies WAL reader/writer snapshot isolation, handle-relative sidecar deletion, and fail-closed rejection when the main DB pathname is replaced with a different valid SQLite file. The Linux exact-prebuild test additionally proves the separate-UID broker boundary and broker restart/recovery. Windows still lacks a separate-identity namespace broker, durable manifest lifecycle and crash/restart recovery. The Linux suite now also runs the exact archived prebuild against the real Python broker daemon under distinct broker/app UIDs. A privileged harness provisions a persistent role manifest and broker-owned DB directory, runs the app as an unprivileged UID, proves direct alias-file creation/open is denied, and exercises broker-returned main/journal/WAL/SHM descriptors, WAL byte I/O, concurrent reader/writer snapshots, SHM mapping/locks, broker-mediated sidecar deletion, abrupt app-process exit with uncommitted WAL frames, broker restart/manifest reconciliation, SQLite WAL recovery and integrity check. A separate protocol test-server run remains as a faster integration test. This avoids modifying the better-sqlite3 native constructor. URI selection is explicitly not used because the package build sets `SQLITE_USE_URI=0`.

Primary integration uses the unmodified binding and default VFS registration. A controlled fork/rebuild is a fallback only if a target platform binary cannot load the extension or cannot retain the registered default VFS for later connections. Any fallback must build the secure backend against the exact SQLite amalgamation and compile options, register it before the first protected DB is opened, fail closed on registration/manifest errors, and run the DB/WAL/SHM/locking/restart/crash suite on that addon-specific engine.

**Remaining evidence gap:** the packaged Linux and Windows x64 prebuilds have been extracted and fingerprinted; the Linux source ID and compile options were queried at runtime, and Windows CI now queries the exact archived binary on Windows. The installed service's actual loaded module path has not been captured from the user's running deployment. The archive's production `vectors.sqlite` and sidecars were not opened or changed.

## Security consequences for Issue #770

1. The deployment inventory must treat ST-VectorService as a separate protected SQLite engine/role, not as a database already covered by the Node `node:sqlite` VFS proof.
2. The `better-sqlite3` engine needs its own VFS registration. A VFS registered only in the Node `node:sqlite` engine cannot cover the separately compiled SQLite engine embedded in `better-sqlite3`; the no-fork default-VFS bootstrap has now been exercised against the exact archived Linux and Windows x64 prebuilds. Production backend and manifest closure remain separate requirements.
3. Its DB, WAL and SHM files must be included in the same trusted directory/identity and sidecar ownership model.
4. The dynamic `ST_VECTOR_ROOT` setting means the final storage path is deployment-configurable; a hard-coded path assumption is invalid.
5. Startup opens the DB before the HTTP listener is started. Any secure registration must therefore happen before `new Database(DB_PATH)`, not after service startup.
6. Shutdown performs a WAL checkpoint before close. The secure backend must cover checkpoint, close, crash recovery and restart; a test of ordinary DB opens alone is insufficient.
7. The archive shows a 198 MB WAL sidecar at capture time. This is a concrete reason to test WAL lifecycle and recovery, not evidence of corruption.

## Integration decision and remaining gate

Chosen integration strategy: use an in-memory bootstrap connection to load the secure extension into the exact `better-sqlite3` SQLite engine, register the VFS as that engine's default, enroll the logical role, and only then construct `new Database(DB_PATH)`. This avoids modifying the native constructor and is now covered by exact-prebuild CI on Linux and Windows.

This is integration evidence for the current probe, not production approval. Linux has the distinct-UID broker and restart/recovery integration. Windows still requires a service-owned namespace/manifest authority, durable sidecar lifecycle, and crash/restart recovery. Unsupported temporary/super-journal file classes must be securely supported or explicitly constrained. Until those gaps and an independent Security review are closed, ST-VectorService's SQLite store is not approved for production activation.


## Required ST-VectorService host integration (pending production VFS)

The supplied ST-VectorService archive has no root `engines` declaration, while its installed `better-sqlite3@13.0.3` addon requires Node-API 10. Before shipping that dependency, the service package must declare `"engines": { "node": ">=22.14.0" }` and fail fast before the first database constructor when `Number(process.versions.napi) < 10`. The SillyTavern archive itself advertises a broader Node floor, so this constraint belongs to the separate ST-VectorService process/package and must be documented in its install instructions.

The current service opens its database at `server.js:261`, after creating `vector_storage` and before WAL/schema setup. Once the production secure VFS library exists for the service's exact platform and SQLite 3.53.4 build, change that sequence to: (1) validate Node-API 10; (2) create a temporary `new Database(':memory:')`; (3) load the production VFS extension using its fixed trusted path and explicit entrypoint; (4) close the bootstrap connection; (5) construct `new Database(DB_PATH)` normally; (6) immediately perform role-manifest enrollment/validation before schema or WAL work. Do not load the current identity-probe library in production: its source explicitly states it is not a production secure VFS.


### ST-VectorService application-path integration

The supplied ST-VectorService archive pins `better-sqlite3@13.0.3` in `package-lock.json`. Its `server.js` currently derives `DB_PATH` as `STORAGE_DIR/vectors.sqlite`, calls `fs.mkdirSync(STORAGE_DIR, { recursive: true })`, opens the DB once with `new Database(DB_PATH)`, and later uses `STORAGE_DIR` for JSON-index traversal. The audited server does not otherwise perform direct filesystem operations on `DB_PATH`.

The better-sqlite3 JavaScript constructor checks that `path.dirname(DB_PATH)` exists before SQLite VFS dispatch. Therefore the app-facing DB path must be a logical alias in a pre-created, app-searchable but app-non-writable directory; it must not be the private broker-owned database path. The VFS maps that alias to the manifest role and broker/handle-relative file. The alias file itself need not exist. The Linux broker integration CI asserts that the alias parent is visible, the app cannot create the alias file, SQLite can open the DB through the VFS, and no plaintext alias file is created. The current Windows test uses a local pinned-handle probe and does not yet prove a separate-identity alias/broker boundary.

Recommended minimal ST-VectorService configuration change:

```js
const DB_PATH = process.env.ST_VECTOR_DB_PATH
    ? path.resolve(process.env.ST_VECTOR_DB_PATH)
    : path.join(STORAGE_DIR, 'vectors.sqlite');
```

Keep `STORAGE_DIR` unchanged for JSON index files and its existing recursive directory creation/traversal. Deployment must provision the alias directory before starting ST-VectorService and deny the app UID write permission to it. The broker manifest points to the actual protected DB path; `ST_VECTOR_DB_PATH` contains only the logical alias. The same alias contract applies on Windows, where the backend must map it to a pinned root HANDLE and relative database name.

The archive's package metadata does not declare the runtime floor. The exact 13.0.3 prebuilds require Node-API 10, so deployment must use Node >=22.14.0 (or add an explicit startup guard/engine constraint).
