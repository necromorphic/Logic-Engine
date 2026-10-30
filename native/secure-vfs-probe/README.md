# SQLite VFS identity probe — NOT a production security implementation

This probe is a bounded feasibility implementation for Issue #770. It keeps the Node.js node:sqlite API and inserts a native VFS/syscall boundary underneath it. It is not approved for production database opens.

## Exact runtime tested

- Node.js 22.13.0
- Bundled SQLite 3.47.2
- Windows x64 and Linux x64
- Original Windows/Linux open-boundary probe: `56ebf8c6246358be363a83ccc6653fd8828523dc`
- POSIX directory-anchor spike: `031a16d2bc8ac73bce840bf4a1728881fa9bb131`
- The POSIX parent-rename + WAL/SHM placement test passed on Linux; the Windows job passed the unchanged Windows open-boundary test. Current-head CI: https://github.com/necromorphic/Logic-Engine/actions/runs/41086269230

## What this probe now demonstrates

1. A temporary in-memory DatabaseSync connection can load the extension.
2. The extension registers a process-default VFS through the SQLite API table supplied by Node.
3. SQLITE_OK_LOAD_PERMANENTLY keeps the extension loaded after the bootstrap connection closes.
4. Ordinary file-backed DatabaseSync connections use that registered VFS.
5. Every file-backed main database must be explicitly registered with a role before SQLite opens it. An unregistered file-backed main database fails closed; in-memory databases are exempt.
6. Role registration performs a native OS open, rejects final-component symlink/reparse-point opens, captures the actual file identity, and pins the native descriptor/HANDLE for the process lifetime.
7. Registering the same physical file identity under two different database roles fails closed.
8. Each later main-database open is checked against the identity captured at role registration. A path replaced after registration but before SQLite's first open is rejected.
9. Main-database replacement races are tested on both platforms. The Linux test injects a hardlink replacement after the VFS stat result and before SQLite can reuse or open the file; Windows tests the CreateFileW boundary. The returned OS object is compared with the pinned identity.
10. WAL, rollback-journal and SHM opens are recognized as sidecars and checked against every registered main-database role.
11. Hardlink replacement races are tested independently for WAL, rollback journal and SHM. Each sidecar must reject an alias to a registered main database.
12. The process-default VFS and role registry are visible to Node worker threads. Two workers concurrently register/open distinct roles.
13. Linux exercises SQLite's pending-descriptor reuse path and accepts reuse only when the wrapped stat identity matches the registered role.
14. The VFS refuses replacement of its protected open/CreateFileW and Unix stat hooks through the registered VFS xSetSystemCall interface.

The probe still delegates SQLite file methods, locking and normal I/O to the parent VFS. On POSIX, registered DB/sidecar open, stat, access and delete operations are routed relative to the pinned final parent-directory descriptor. On Windows, the earlier path-based open-boundary wrapper remains in use. Neither path is a production secure VFS.

## What remains unproven

- **Parent-directory anchoring:** the POSIX spike pins the final parent directory descriptor and uses openat/fstatat/faccessat/unlinkat for registered database and sidecar paths. It passes a test that renames the parent directory, places a decoy at the original path, and verifies that the DB plus WAL/SHM stay in the moved directory. The component walk prevents symlink traversal and pins each directory already opened during acquisition. It does not authenticate the expected identity of each directory component against a separately protected manifest; an attacker who can replace a component before trusted registration may still cause the wrong directory tree to be enrolled. Windows still lacks a RootDirectory-relative open implementation and equivalent parent-rename test.
- **Pre-registration trust:** role registration is the identity acquisition boundary. If an attacker can redirect the parent path before trusted registration runs, the registration may capture the wrong object. There is no persisted trusted identity ledger across process restarts.
- **Sidecar-to-sidecar collisions:** sidecars are compared with registered main-database identities, but there is no complete sidecar identity registry. A WAL/SHM/journal hardlink collision with another sidecar is not comprehensively prevented.
- **Sidecar lifecycle:** there is no persistent sidecar ownership ledger, complete delete/recreate policy, or crash-recovery reconciliation.
- **Complete VFS operation surface:** POSIX xOpen/syscall open, stat, xAccess and xDelete for registered DB/sidecar names are directory-relative in this spike. Temporary-file paths, all other VFS callbacks, parent-VFS bypasses, locking and file-control operations have not been exhaustively reviewed. Windows xAccess/xDelete remain delegated to the parent VFS.
- **Role inventory:** the test registry is fixed at 32 entries. Production must supply a complete trusted inventory for every persistent database role and fail closed on omissions.
- **Filesystem policy:** ownership, ACLs, permissions, mount boundaries, network filesystems and all filesystem-specific behaviors have not been exhaustively validated.
- **Production lifecycle:** startup ordering, migration, backup/restore, corruption recovery and shutdown/restart behavior remain unimplemented.
- **Other SQLite engines:** this probe targets the SQLite engine embedded in Node's node:sqlite. The uploaded ST-VectorService source uses better-sqlite3 13.0.3 and opens vectors.sqlite in WAL mode. That is a separate SQLite engine and is not covered by this node:sqlite registration proof. It needs its own exact-engine registration/identity test or a deliberate driver integration decision.
- **Host inventory:** this probe does not prove that SillyTavern or every extension has been inventoried, nor that all database opens in the installed Host pass through this VFS.

## Decision from the spike

The native VFS/syscall-wrapper route works inside the exact SQLite engine used by Node 22.13.0 on Windows and Linux. A separate native database binding is not required merely to preserve the existing node:sqlite API.

That is a feasibility decision, not a production security approval. Issue #770 remains open. Do not wire production Core, Coordinator, Provider, Host-ledger, dispatch-ledger or accepted-head files to this probe.

## Remaining implementation gates

1. Add a protected expected-identity manifest for the POSIX directory chain, and implement/test Windows handle-relative opens using a pinned directory HANDLE.
2. Extend the directory-relative policy to every required VFS operation, temporary files, and all DB/sidecar lifecycle paths.
3. Define the persisted trusted identity/role ledger and startup reconciliation policy.
4. Add sidecar-to-sidecar identity ownership and complete WAL/SHM/journal lifecycle tests.
5. Prove exclusive ownership of the required syscall hooks against all supported native components.
6. Inventory every production database role, including Memory Provider, dispatch gateway ledger, accepted-head authority, and direct Core/Provider opens.
7. Evaluate the separate better-sqlite3 engine used by ST-VectorService.
8. Test crash recovery, migrations, backup/restore, shutdown and restart on Windows and Linux.
9. Obtain independent Security review before closing Issue #770 or enabling production opens.

A passing probe test is not a substitute for the remaining gates.
