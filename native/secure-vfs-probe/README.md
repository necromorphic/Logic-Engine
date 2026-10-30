# SQLite VFS identity probe — NOT a production security implementation

This probe is a bounded feasibility implementation for Issue #770. It keeps the Node.js node:sqlite API and inserts a native VFS/syscall boundary underneath it. It is not approved for production database opens.

## Exact runtime tested

- Node.js 22.13.0
- Bundled SQLite 3.47.2
- Windows x64 and Linux x64
- Exact code/test head: 56ebf8c6246358be363a83ccc6653fd8828523dc
- Windows/Linux VFS workflow: https://github.com/necromorphic/Logic-Engine/actions/runs/41080923602 — both jobs passed.

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

The probe still delegates SQLite file methods, locking and normal I/O to the parent VFS. Its security wrapper validates the OS object before returning the descriptor/HANDLE to SQLite; it does not replace the SQLite storage engine.

## What remains unproven

- **Parent-directory anchoring:** registration and subsequent opens still use path strings. O_NOFOLLOW / FILE_FLAG_OPEN_REPARSE_POINT protects the final component, not a replaced or redirected parent directory. There is no pinned directory handle plus openat/RootDirectory-relative open contract.
- **Pre-registration trust:** role registration is the identity acquisition boundary. If an attacker can redirect the parent path before trusted registration runs, the registration may capture the wrong object. There is no persisted trusted identity ledger across process restarts.
- **Sidecar-to-sidecar collisions:** sidecars are compared with registered main-database identities, but there is no complete sidecar identity registry. A WAL/SHM/journal hardlink collision with another sidecar is not comprehensively prevented.
- **Sidecar lifecycle:** there is no persistent sidecar ownership ledger, complete delete/recreate policy, or crash-recovery reconciliation.
- **Hook ownership:** replacement is refused through the registered VFS interface. The probe does not prove that unrelated native code cannot obtain and mutate the parent VFS directly.
- **Role inventory:** the test registry is fixed at 32 entries. Production must supply a complete trusted inventory for every persistent database role and fail closed on omissions.
- **Filesystem policy:** ownership, ACLs, permissions, mount boundaries, network filesystems and all filesystem-specific behaviors have not been exhaustively validated.
- **Production lifecycle:** startup ordering, migration, backup/restore, corruption recovery and shutdown/restart behavior remain unimplemented.
- **Other SQLite engines:** this probe targets the SQLite engine embedded in Node's node:sqlite. The uploaded ST-VectorService source uses better-sqlite3 13.0.3 and opens vectors.sqlite in WAL mode. That is a separate SQLite engine and is not covered by this node:sqlite registration proof. It needs its own exact-engine registration/identity test or a deliberate driver integration decision.
- **Host inventory:** this probe does not prove that SillyTavern or every extension has been inventoried, nor that all database opens in the installed Host pass through this VFS.

## Decision from the spike

The native VFS/syscall-wrapper route works inside the exact SQLite engine used by Node 22.13.0 on Windows and Linux. A separate native database binding is not required merely to preserve the existing node:sqlite API.

That is a feasibility decision, not a production security approval. Issue #770 remains open. Do not wire production Core, Coordinator, Provider, Host-ledger, dispatch-ledger or accepted-head files to this probe.

## Remaining implementation gates

1. Anchor trusted acquisition to a pinned parent-directory handle and use a race-safe relative-open mechanism on each supported OS.
2. Define the persisted trusted identity/role ledger and startup reconciliation policy.
3. Add sidecar-to-sidecar identity ownership and complete WAL/SHM/journal lifecycle tests.
4. Prove exclusive ownership of the required syscall hooks against all supported native components.
5. Inventory every production database role, including Memory Provider, dispatch gateway ledger, accepted-head authority, and direct Core/Provider opens.
6. Evaluate the separate better-sqlite3 engine used by ST-VectorService.
7. Test crash recovery, migrations, backup/restore, shutdown and restart on Windows and Linux.
8. Obtain independent Security review before closing Issue #770 or enabling production opens.

A passing probe test is not a substitute for the remaining gates.
