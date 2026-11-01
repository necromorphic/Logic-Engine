# Issue #839 — production secure SQLite VFS closure contract

**Status:** implementation contract; not production approval  
**Related:** Issue #770; Draft PR #839  
**Scope:** all protected SQLite database roles on Linux and Windows, plus the independent ST-VectorService `better-sqlite3` engine.

## 1. Security invariant

For every main database, WAL, SHM, rollback journal, temporary database/journal and other SQLite-created file that can affect a protected role, SQLite must operate on the exact OS file object opened and identity-checked by the secure backend. No protected operation may fall back to a pathname-based parent VFS call.

A process-local registry is not trust. Registration must be based on a separately protected persistent manifest and a pinned parent directory chain. Missing, malformed, stale, unsupported or inconsistent identity data means fail closed before SQLite schema writes or listeners start.

### Internal SQLite sidecar deletion paths found in source audit

SQLite 3.47.2's platform VFSes have internal sidecar-deletion paths that bypass the public VFS `xDelete` callback:
- Windows `winShmPurge() → winDelete() → DeleteFileW`.
- POSIX `unixShmUnmap() → osUnlink() → unlink`.

The probe now intercepts both low-level delete syscalls in addition to its VFS `xDelete` callback. The Windows wrapper opens the exact child relative to the retained parent HANDLE, checks the recorded file identity, and deletes through `SetFileInformationByHandle`. The POSIX wrapper routes the internal `unlink` request through the same registered-role/sidecar checks in `probe_xDelete`. Non-broker deletion uses atomic `renameat2(RENAME_NOREPLACE)` into a protected quarantine, fsyncs the directory transition, validates the moved object's identity through a nonblocking handle, and unlinks only after the identity matches. Broker-bound sidecar deletion uses the service-owned quarantine implementation. A WAL-to-DELETE integration test exercises both internal cleanup paths on Windows and Linux.

This closes the identified **callback bypass** and removes the application-side POSIX check-to-unlink race for supported Linux paths. Broker-bound main-role deletion remains fail-closed until its durable lifecycle transition is implemented.

## 2. POSIX deletion: why a direct VFS fix is not available

Linux/POSIX exposes name-based `unlinkat(dirfd, name)`, not a standard unlink-by-open-file-descriptor primitive. The current `fstatat(dirfd,name) → unlinkat(dirfd,name)` sequence therefore has a replacement window. Repeating the stat, opening the child first, using `openat2`, or moving the name into a quarantine directory does not by itself make the final unlink target object-bound when an attacker can mutate that directory.

The production design for the threat model that includes an untrusted Logic-Engine process identity is a **separate namespace broker**:

1. A dedicated broker OS identity owns the protected database directories and the trusted manifest. The application identity has no create/rename/unlink permission on those directories.
2. The application VFS connects over an authenticated local IPC endpoint. On Linux, the broker verifies peer credentials (`SO_PEERCRED`) and accepts only the configured application identity and role allowlist.
3. The broker serializes namespace mutations and resolves every name from retained directory descriptors. Linux opens use `openat2` with restrictive resolution flags where available, with a reviewed component-by-component `openat` fallback only on explicitly supported filesystems.
4. For `xOpen`, the broker opens/creates the child, validates `fstat` identity against the manifest, persists the ownership transition, and passes the same open file description to the VFS using `SCM_RIGHTS`. The VFS performs SQLite byte I/O and file locks on that received descriptor; it does not reopen the path.
5. For `xDelete`, only the broker can mutate the directory. It serializes the operation, opens the named child without following links, validates the opened identity and role ownership, then unlinks the name while no untrusted principal can replace it. It fsyncs the parent directory before acknowledging success.
6. Create, rename, sidecar, temporary-file, hot-journal and recovery namespace operations must use the same broker. A broker used only for `xDelete` is insufficient if the application can still mutate the directory directly.

A Linux broker prototype now implements authenticated role-based main/sidecar descriptor opens, sidecar create/open-or-create, access checks, and sidecar deletion through service-owned quarantine. Startup validates the persistent manifest and reconciles interrupted sidecar lifecycle states before exposing the socket. The prototype is not yet a complete production namespace owner: broker-first role enrollment, main-file create/delete/rename, complete VFS callback coverage, Windows broker parity, and durable recovery of present transitional sidecars remain open. Do not represent the prototype as full POSIX production closure until those operations are implemented and independently reviewed.

## 3. Windows: required all-file handle-relative backend

The current probe's `CreateFileW` interception covers registered main DB names and recognized `-wal`, `-shm`, and `-journal` names. This is not yet proof for every SQLite-created file or every VFS callback. A source audit of SQLite 3.47.2's Windows VFS found an additional bypass: `winShmPurge()` calls internal `winDelete()` directly for the SHM file, bypassing the registered VFS `xDelete` callback. The probe now also intercepts the Windows VFS `DeleteFileW` system-call hook and routes that internal deletion through the same parent-HANDLE-relative identity check. The Windows test explicitly switches a WAL database back to DELETE mode and asserts that this internal DeleteFileW hook is exercised. This closes that identified Windows sidecar-delete bypass in the probe; it does not establish full production VFS coverage. The exact archived ST-VectorService Windows x64 `better-sqlite3@13.0.3` prebuild now passes CI: the VFS extension is loaded into its own SQLite engine, main/journal/WAL/SHM operations run through the pinned parent HANDLE, WAL reader/writer snapshots remain isolated, and a different valid SQLite file substituted at the registered pathname is rejected by file-identity mismatch. The test also confirms sidecar deletion is routed through the handle-relative hook.

The Windows probe now has a manifest-bound enrollment API: the JS adapter validates the Windows manifest envelope and role/sidecar lifecycle records, while the native registration callback compares the database and final-parent identities from opened handles and seeds active/retired sidecar identities. Active sidecars are checked with handle-relative opens; retired sidecars must be absent. Manifest-bound roles reject unmanifested sidecars and force existing sidecars to open with `FILE_OPEN`, not create-if-missing. This is a fail-closed enrollment slice, not complete lifecycle support: it cannot yet durably create/activate a new sidecar generation, and therefore a role with a missing active sidecar or a new unmanifested sidecar cannot continue until an authorized manifest update path exists. The current parent HANDLE is still acquired by the application process from an absolute path; the probe test does not establish a separate-identity Windows namespace boundary. Production must obtain capabilities from a privileged Windows broker/service (or broker each open/delete operation), which must own the protected directory and persistent manifest. That broker and its restart/recovery protocol are not implemented yet.

The production Windows backend must own the protected `sqlite3_file` object and use a retained parent-directory HANDLE plus `NtCreateFile(OBJECT_ATTRIBUTES.RootDirectory)` for every protected child. It must cover:

- main DB, WAL, SHM and rollback journal;
- master/super-journal and temporary database/journal files, or explicitly reject those modes before they can affect a protected role;
- `xAccess`, `xDelete`, `xFullPathname`, `xOpen` and all file-control paths that can reopen/rename/delete;
- all applicable `sqlite3_io_methods`, including byte I/O, truncation, sync, file size, locking, reserved-lock checks and WAL shared-memory mapping/locking/barriers/unmap.

The backend must not pass protected names to a parent VFS implementation unless a source audit proves that the parent file object uses only the already-validated handle and cannot re-enter path-based open/delete. Unknown flags, unsupported file types, reparse points, unsupported filesystems and unusable FILE_ID_INFO values fail closed.

## 4. Persistent role manifest and enrollment

Schema: `schemas/sqlite-role-manifest.schema.json`.

The manifest is outside the DB directory and protected by the broker identity (preferred) or the explicitly declared dedicated service identity. POSIX device/inode/mount IDs and Windows volume serial/full 128-bit file IDs are serialized as strings to avoid integer precision loss. The JSON Schema enforces the record shape and platform-specific identity encoding; runtime validation must additionally enforce unique role names and physical identities, equal parent-component/parent-identity chain lengths, monotonic generation, sidecar uniqueness, and valid lifecycle transitions. JSON Schema validation alone is not an enrollment or trust decision.

Enrollment is a privileged provisioning operation, not an automatic consequence of opening a configured path. It must:
- open the trusted root and every parent component without following symlinks/reparse points;
- record the identity of each directory component and the database object from the returned handles;
- reject hardlink aliases across roles and unusable/zero/unstable identities;
- persist the role record atomically before the role is enabled;
- make the manifest generation monotonic and reject rollback or stale generations.

Sidecar transitions are durable:
- **creating:** child has been securely created and identified; persist before exposing it to SQLite;
- **active:** SQLite may use it;
- **deleting:** persist intent before unlink;
- **retired:** persist completion after unlink and parent-directory fsync.

If the process crashes between creation and manifest persistence, an unregistered sidecar is detected at restart and the role enters `recovery-required`; it is not silently adopted. If it crashes after `deleting` is persisted, recovery verifies the recorded identity and completes or reconciles deletion. A mismatched object is never auto-deleted or adopted.

Manifest writes use a same-directory temporary file, restrictive permissions/ACL, flush of file contents, atomic replacement, and flush of the metadata directory where supported. The broker/service must serialize writers and validate generation on every update.

The Windows JS enrollment adapter also rejects duplicate physical identities across database files and active sidecars, and rejects any file identity that aliases the metadata root or a parent directory. Shared parent directories across roles (including the metadata root appearing in a parent chain) are allowed, while repeated identities within one parent chain are rejected. Retired sidecar identities remain historical and are excluded because Windows may reuse file IDs after deletion. Sidecar generations newer than the manifest generation are rejected. These checks reduce malformed-manifest ambiguity but do not authenticate the manifest file or provide durable lifecycle writes.

The current Windows probe now refuses `xDelete` for a manifest-bound main database. This is intentional fail-closed behavior: until a durable `deleting`/`retired` main-role transition is implemented in the manifest authority, deleting the file while retaining an active role record would make restart reconciliation unsafe. Sidecar deletion remains identity-checked in the native handle-relative path, but its lifecycle update is not yet durably committed to the Windows manifest.

## 5. Restart, WAL and crash recovery protocol

Startup order:

1. Start the broker/secure backend under its dedicated identity; validate the metadata root and manifest ACL/ownership.
2. Parse and schema-validate the complete manifest; reject duplicate role IDs, duplicate file identities, platform mismatch and generation rollback.
3. Reopen each trusted directory chain handle-relatively and compare every directory identity with the manifest.
4. Open each main DB handle-relatively and compare its identity. Do not open SQLite yet.
5. Reconcile WAL/SHM/journal identities and lifecycle states. Unexpected or mismatched sidecars block that role and require explicit recovery.
6. Register the complete secure VFS before any protected `DatabaseSync` or `better-sqlite3` constructor runs.
7. Open the DB through that VFS. SQLite performs normal hot-journal/WAL recovery through the same secured file and lock methods.
8. Only after successful recovery and integrity checks may the component perform schema writes or start listeners.

The backend must preserve SQLite locking semantics across processes, not just threads. WAL tests must cover shared-memory mapping and locks, concurrent readers/writers, checkpoint/restart, abrupt process termination at each durable sidecar transition, hot-journal rollback, WAL replay, disk-full and I/O-error handling. `synchronous=NORMAL` and checkpoint-on-shutdown do not replace crash tests. The current feasibility tests characterize cross-process `BEGIN IMMEDIATE` contention and kill writers after forcing uncommitted WAL frames to disk, then verify reopen, rollback of uncommitted rows and `PRAGMA integrity_check`. The broker-bound integration now also exercises a separate process crash/reopen through the authenticated descriptor broker. These tests still exercise the parent VFS locking/WAL/SHM implementation; they do not prove independent locking semantics or complete persistent-manifest recovery. The Windows abrupt-process-exit test likewise validates SQLite recovery with process-local re-enrollment, not persistent Windows role-manifest recovery. Startup recovery now finishes a quarantined sidecar deletion only when the quarantined handle identity uniquely matches a manifest record in `deleting` state. It retires absent interrupted sidecars and durably marks live-name transitional sidecars `recovery-required`; unknown or mismatched quarantine entries remain retained and block startup. It does not auto-delete or promote live-name entries.

## 6. ST-VectorService / better-sqlite3 separate audit

The supplied ST-VectorService archive pins `better-sqlite3@13.0.3`, a separate native SQLite engine from Node's `node:sqlite`. The exact archived prebuilds are:

| Platform | SHA-256 | Runtime evidence |
|---|---|---|
| Linux x64 | `6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d` | SQLite 3.53.4; source ID checked in CI |
| Windows x64 | `e21e5efd71fba66578e95b62554d9028064a80dafd7221bf8a8ef155de8d240a` | SQLite 3.53.4; exact prebuild smoke-tested in CI |

The package uses Node-API 10, so the runtime floor for this dependency is Node 22.14.0. Its archived build configuration sets `SQLITE_USE_URI=0`; URI `vfs=` selection is not a valid integration route. The binding's `Database::JS_new` calls `sqlite3_open_v2(..., vfs=NULL)`, selecting that SQLite engine's default VFS. Loading an extension after a file-backed database has opened is too late.

The verified no-fork bootstrap sequence is:

1. Construct `new Database(':memory:')` using the exact better-sqlite3 binding.
2. Load the secure VFS extension into that connection using its explicit entrypoint. The extension registers the VFS as the default in this SQLite engine, installs its auto-extension callback, and remains loaded with `SQLITE_OK_LOAD_PERMANENTLY`.
3. Close the bootstrap connection.
4. Open a separate in-memory registrar connection and enroll/validate the logical database role before any protected file-backed connection is constructed.
5. Construct `new Database(DB_PATH)` normally. Its `vfs=NULL` open now selects the registered default VFS.

This is not the Node `node:sqlite` VFS registration; the extension must be loaded into the exact SQLite instance embedded in better-sqlite3. The C++ constructor patch and named-URI route were removed. CI downloads the exact 13.0.3 package, verifies the archived prebuild fingerprint, builds the VFS extension against the package's bundled SQLite headers, and exercises the stock binding without modifying its native constructor.

Current exact-prebuild CI evidence:
- **Linux x64:** default VFS registration, main DB/rollback-journal/WAL/SHM I/O, broker protocol, distinct broker/app UIDs, broker-returned descriptors, WAL reader/writer snapshots, sidecar deletion, abrupt app exit with uncommitted WAL frames, broker restart/manifest reconciliation, WAL recovery and integrity check all pass.
- **Windows x64:** default VFS registration in the stock archived prebuild; handle-relative main DB, rollback-journal, WAL and SHM operations; WAL reader/writer snapshot isolation; handle-relative sidecar deletion; and fail-closed rejection of a different valid SQLite file substituted at the registered DB pathname all pass.

The Windows result is still a probe-level proof, not production approval. The application process currently obtains the pinned parent HANDLE from a path during enrollment; a production Windows broker/service must own the protected namespace and manifest authority, pass only the required file capabilities or broker each operation, and persist sidecar lifecycle transitions across restart. The exact-prebuild Windows test now also kills a separate writer process with uncommitted WAL frames and verifies a fresh process recovers committed rows, discards uncommitted rows, passes integrity_check, checkpoints WAL and returns to DELETE mode. This proves SQLite-level WAL crash recovery through the handle-relative probe; it does not prove durable manifest recovery, service restart reconciliation, or a distinct-identity Windows broker boundary. The current VFS also rejects unsupported temporary/super-journal file classes rather than silently delegating them; the production backend must support these securely or document and enforce the compatible SQLite operating modes.

The ST-VectorService archive opens `vectors.sqlite` at `server.js:261`, after deriving `STORAGE_DIR` from `ST_VECTOR_ROOT`. The production host integration must load the production extension and validate role enrollment before that constructor. Use a pre-created logical alias path in an app-searchable but app-non-writable directory; do not expose the broker-owned physical database path. The service's existing `STORAGE_DIR` remains unchanged for JSON index files. A minimal app configuration is:

```js
const DB_PATH = process.env.ST_VECTOR_DB_PATH
    ? path.resolve(process.env.ST_VECTOR_DB_PATH)
    : path.join(STORAGE_DIR, 'vectors.sqlite');
```

The alias directory must be provisioned before service startup. The manifest/broker maps the alias to the protected role. Do not ship the current probe extension as a production library. Until the Windows broker, durable manifest lifecycle, all SQLite file classes, restart/recovery, and independent Security review are complete, ST-VectorService production activation remains unauthorized.
 
## 7. Acceptance matrix

| Gate | Required evidence |
|---|---|
| POSIX xDelete | Broker-exclusive namespace mutation; adversarial replacement race test |
| Windows all-file opens | Custom secure VFS file objects; every SQLite file class anchored |
| Persistent manifest | Schema validation, protected storage, atomic update and anti-rollback |
| Restart/recovery | Crash injection at each manifest/sidecar transition; fail-closed reconciliation |
| Locking/WAL | Multi-process lock matrix, WAL SHM, checkpoint, hot-journal and crash replay |
| ST-VectorService | Independent better-sqlite3 binary/VFS audit and integration tests |
| Security review | Independent reviewer signs exact commit after all platform CI is green |

Until every row is evidenced on the exact reviewed HEAD, this PR remains Draft and no production database role may be activated.
