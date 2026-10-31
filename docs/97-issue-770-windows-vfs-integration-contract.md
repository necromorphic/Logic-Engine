# Issue #770 — Windows anchored SQLite VFS integration contract

**Status:** implementation contract; not a production security approval  
**Related:** Issue #770, current-main Draft PR #839; prior exploratory PR #798  
**Applies to:** the Node.js 22.13.0 / SQLite 3.47.2 engine used by `node:sqlite`  
**Platforms:** Windows x64 first; Linux remains governed by the POSIX manifest work

## 1. Security invariant

For every database-role and sidecar open, the file object used by SQLite must be the same object whose identity was checked after a directory-handle-relative open. A pathname check, a pre-open identity query, a post-open pathname recheck, or a second open whose handle is not the handle used by SQLite does not satisfy this invariant.

No path-based fallback is permitted for a registered protected role. If an operation cannot be resolved under its retained parent directory handle, it fails closed.

## 2. Current probe boundary

The Windows probe now intercepts the parent VFS `CreateFileW` call for registered database and recognized sidecar names. It resolves the basename relative to the retained parent `HANDLE` with `NtCreateFile` and `OBJECT_ATTRIBUTES.RootDirectory`, validates the returned handle identity, and returns that same anchored `HANDLE` to the parent VFS. The parent VFS still owns its `sqlite3_file` wrapper and its I/O methods; the handle inside that wrapper is the handle whose identity was checked.

Windows `xAccess` and `xDelete` no longer delegate protected names to the parent VFS. They open the target relative to the retained parent handle. `xAccess` is observational for sidecars and does not enroll ownership; the actual sidecar identity is claimed only after `xOpen` validates the returned handle. `xDelete` validates the database or process-local sidecar identity and operates on the opened object. The VFS interception and standalone helper now share one reviewed Win32 flag/disposition mapper. `CREATE_ALWAYS`, `TRUNCATE_EXISTING`, and `FILE_FLAG_DELETE_ON_CLOSE` are rejected for protected paths rather than applied before identity validation. The sidecar identity registry is process-local and is not a persistent ownership ledger.

This is still only a probe. The parent VFS continues to implement SQLite file methods, locking, WAL shared memory and other behavior. Those paths have not been exhaustively audited for pathname re-entry or alternate opens. The standalone relative-open helper is now used by the VFS interception, but passing its primitive tests does not prove the complete SQLite VFS contract. The remaining production gates are listed below.

**Filename lifetime invariant:** any canonical filename buffer allocated by the wrapper and passed to the parent VFS `xOpen` must remain valid for the entire lifetime of the returned `sqlite3_file`. Parent VFS implementations may retain `zName` and use it later to construct WAL/SHM paths. Freeing the wrapper-owned `xFullPathname` buffer immediately after parent `xOpen` is a use-after-free. The probe now pins that buffer per file and releases it only after the delegated parent `xClose` returns. The pin registry is bounded and fails closed on exhaustion; its capacity/lifecycle must be reviewed before production.

## 3. Required role state

Each registered role must retain, for the complete database lifetime:

- the pinned parent-directory `HANDLE`;
- the canonical single-component database basename;
- the trusted database identity (`FILE_ID_INFO`: volume serial plus all 128 file-ID bits);
- a role identifier and an explicit supported-filesystem policy;
- a lifecycle state preventing close/replacement while SQLite file objects or sidecars still reference the role.

The role registry must be initialized from a separately protected persistent trust manifest. The current process-local registry and path-derived enrollment are insufficient for production. A role must not become trusted merely because the process successfully opened whatever object currently occupies a configured path.

The parent directory handle and identity manifest must be validated before the role is made available. Unsupported UNC/device paths, filesystems, identity classes, reparse-point layouts, and ambiguous path forms fail closed until separately specified and tested.

## 4. SQLite file-object ownership

The production backend must ensure that the `sqlite3_file` object used by SQLite is backed by the exact anchored handle. A dedicated backend may own the `sqlite3_file` object and implement the required methods itself. Reusing the parent VFS wrapper is acceptable only if a source-level audit proves that it retains and operates on the exact anchored handle and cannot reopen or redirect protected paths through another pathname-based callback. The current probe has not completed that audit.

The backend must implement and test the complete applicable `sqlite3_io_methods` contract, including:

- `xClose`, `xRead`, `xWrite`, `xTruncate`, `xSync`, `xFileSize`;
- `xLock`, `xUnlock`, `xCheckReservedLock`, `xFileControl`, `xSectorSize`, `xDeviceCharacteristics`;
- shared-memory methods `xShmMap`, `xShmLock`, `xShmBarrier`, `xShmUnmap` when WAL is supported;
- correct handling of SQLite open flags, delete-on-close, temporary files, and error translation.

The implementation must explicitly define lock semantics and WAL shared-memory behavior. It must not claim correctness by implementing only byte I/O while delegating locks or shared-memory files to pathname-based parent-VFS methods.

## 5. Handle-relative operations

All protected names are resolved from the retained parent handle using a validated single basename:

- main database;
- `-wal`;
- `-shm`;
- `-journal`.

For every open, the backend must use `NtCreateFile` with `OBJECT_ATTRIBUTES.RootDirectory` set to the retained parent handle, reject path separators and reparse points, query the opened handle, and compare its full identity to the expected role/sidecar ownership record before exposing the handle to SQLite.

For existing database files, the opened identity must equal the trusted role identity. For newly created sidecars, the backend must atomically establish a sidecar ownership record from the returned handle before exposing it. A sidecar may not alias the main DB or another live sidecar, including across different roles.

`xAccess` must inspect only the matching entry relative to the retained parent handle and must not follow reparse points. `xDelete` must open the target relative to the retained parent, validate its identity/ownership, and mark that exact opened object for deletion; it must never delete by absolute pathname. Missing-file behavior must match SQLite's VFS contract.

Temporary files must either be created in a separately pinned and policy-approved directory through the same anchored mechanism, or be rejected for protected operations. No silent use of the parent VFS temporary-file path is allowed.

## 6. Win32-to-NT mapping

The adapter must have a reviewed, table-driven mapping from SQLite open flags and the Windows VFS access/share/disposition/options contract to NT access, share, disposition, and create options.

Unknown flag combinations, unsupported template/security-attribute cases, and unsupported create dispositions must fail closed. The adapter must preserve SQLite's expected sharing behavior and delete semantics. It must translate NTSTATUS values to stable Win32 errors without converting every failure into a misleading generic success or retry condition.

The current helper's generic `ERROR_ACCESS_DENIED` mapping is acceptable only as a conservative prototype behavior; production diagnostics and retry semantics require a reviewed mapping. Destructive create dispositions (`CREATE_ALWAYS`, `TRUNCATE_EXISTING`) are rejected before `NtCreateFile`, because post-open identity validation is too late to prevent truncation. If the parent SQLite VFS requires either disposition for protected files, the adapter must implement a two-phase open/validate/modify operation on the same handle or a dedicated SQLite file backend; it must not restore destructive NT dispositions.

## 7. Required adversarial tests

Tests must exercise the actual registered VFS and SQLite file methods, not only the standalone helper:

1. After role registration, attempt to rename the trusted parent directory. If the filesystem permits it, create a decoy at the old path and verify SQLite continues to use the original DB. If Windows denies the rename because the trusted DB HANDLE remains open, verify the denial is fail-closed and that the original path cannot be replaced.
2. Repeat the rename/decoy attack for WAL, SHM, and rollback journal creation and reopen.
3. Replace each protected child with a file symlink/reparse point and with a directory reparse point; verify rejection.
4. Race replacement between role registration and main DB open; verify rejection.
5. Race replacement between sidecar existence/access checks and sidecar open; verify rejection.
6. Attempt hardlink aliases between DB, WAL, SHM, journal, and sidecars belonging to different roles; verify rejection.
7. Attempt deletion/replacement while handles are open and during close/reopen; verify ownership and lifecycle invariants.
8. Exercise WAL checkpoint, crash/recovery, hot-journal recovery, read-only mode, concurrent connections, worker threads, and process restart.
9. Verify every protected operation remains anchored when the parent path is renamed and a decoy is created; where the OS forbids that rename while a trusted handle is open, verify the OS denial prevents path substitution.
10. Verify that unsupported paths/filesystems and unknown flags fail closed.

The tests must assert file identities from the handles actually used by SQLite. Path-level observations alone are not sufficient.

## 8. Acceptance gates

Windows integration is not complete until:

- the protected role's SQLite file object is backed by the exact anchored handle;
- all applicable DB/sidecar open, access, delete, temporary-file, lock, and WAL shared-memory operations are covered;
- no protected operation reaches the parent VFS through a path-based fallback;
- the persistent trust/ownership ledger and restart reconciliation are implemented;
- Windows CI runs the adversarial VFS-level matrix;
- Linux parity and its protected directory-chain manifest are validated;
- the separate `better-sqlite3` engine in ST-VectorService has its own reviewed integration or is explicitly excluded from the protected-store inventory;
- an independent Security reviewer signs off on the exact code and test evidence.

Until every gate passes, this work remains a non-production probe. Do not open production Core, Coordinator, Provider, Host-ledger, dispatch-ledger, or accepted-head databases through it. Memory→NPC remains disabled.
