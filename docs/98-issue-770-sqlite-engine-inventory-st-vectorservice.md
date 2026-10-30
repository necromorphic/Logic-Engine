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
