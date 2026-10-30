# SQLite VFS identity probe — NOT a production security implementation

This probe is a bounded feasibility implementation for Issue #770. It keeps the Node.js node:sqlite API and inserts a native VFS/syscall boundary underneath it. It is not approved for production database opens.

## Exact runtime tested

- Node.js 22.13.0
- Bundled SQLite 3.47.2
- Windows x64 and Linux x64
- Original Windows/Linux open-boundary probe: `56ebf8c6246358be363a83ccc6653fd8828523dc`
- POSIX directory-anchor spike with root-relative component walk and symlink rejection test: `6b0b854fe4659c8e43d6ac5b78bedd0043b395bc`
- Windows relative-open primitives are exercised by `windows_relative_open_test.c`: the test acquires a directory HANDLE chain, opens a child through `NtCreateFile` + `OBJECT_ATTRIBUTES.RootDirectory`, records the full `FILE_ID_INFO`, renames the trusted parent and creates a decoy at the old path, then verifies that the anchored open still reads the trusted object. It also rejects directory and child reparse-point substitutions.
- The helper requests `SYNCHRONIZE` whenever it uses `FILE_SYNCHRONOUS_IO_NONALERT`, and directory handles request `FILE_TRAVERSE`.
- The current Windows VFS test exercises the registered Node `node:sqlite` VFS. It accepts either successful parent rename followed by decoy isolation, or an OS-denied rename while the trusted DB HANDLE remains open (a fail-closed outcome). The standalone relative-open test separately exercises `NtCreateFile` against a renamed parent. Exact-head CI for the latest integration changes is still pending.

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

The probe still delegates SQLite file methods, locking and normal I/O to the parent VFS. On POSIX, registered DB/sidecar opens and stat/access checks are routed relative to the pinned final parent-directory descriptor. Role enrollment now rejects a parent directory unless it is owned by the effective UID and has no group/other write bits; `xDelete` rechecks that policy on the pinned descriptor immediately before `unlinkat`. This prevents a different-UID process from replacing entries under the accepted directory-permission policy. It does not protect against same-UID or privileged attackers, directory-owner policy changes racing with deletion, or a substituted directory tree enrolled before a persistent trust manifest is checked. Therefore it is a constrained permission-based mitigation, not identity-bound deletion or production approval. A protected same-filesystem quarantine protocol or an independently reviewed equivalent is still required if same-UID mutation is in scope. POSIX sidecar-to-sidecar ownership is also absent.

On Windows, the VFS uses the retained parent HANDLE in its `CreateFileW` interception for registered main DB and recognized sidecar opens, so the handle returned to the parent VFS is the anchored handle. Windows `xAccess` is directory-relative and validates the enrolled identity for the main DB; it records and checks process-local sidecar identities. Windows `xDelete` opens the exact child relative to the anchor, validates the enrolled main-DB or process-local sidecar identity, and marks that opened object for deletion by handle. Sidecar identities are checked against enrolled main DBs and other tracked sidecars, but the registry is not persistent across process restarts. The standalone `windows_relative_open.h` tests cover parent rename/decoy isolation, full `FILE_ID_INFO` comparison, directory/child reparse-point rejection, and Win32-shaped relative open/access/delete primitives. The Win32 adapter rejects unmapped flags, overlapped and directory modes, template handles, and unsupported dispositions rather than falling back to a pathname. It also rejects `CREATE_ALWAYS` and `TRUNCATE_EXISTING`: NT destructive dispositions can truncate a substituted child before the post-open identity check, so protected opens currently permit only non-destructive create/open dispositions. The latest VFS integration changes have not yet passed exact-head CI and are not production-safe. Neither platform path is a production secure VFS.

## What remains unproven

- **Parent-directory anchoring:** the POSIX spike pins the final parent directory descriptor and uses openat/fstatat/faccessat/unlinkat for registered database and sidecar paths. It passes a test that renames the parent directory, places a decoy at the original path, and verifies that the DB plus WAL/SHM stay in the moved directory. The component walk prevents symlink traversal and pins each directory already opened during acquisition. It does not authenticate the expected identity of each directory component against a separately protected manifest; an attacker who can replace a component before trusted registration may still cause the wrong directory tree to be enrolled. On Windows, the RootDirectory-relative helper is now used by the VFS `CreateFileW` interception and by `xAccess`/`xDelete`. The VFS-level test accepts either anchored operation after a successful parent rename or fail-closed OS denial while the trusted DB HANDLE remains open. Exact-head CI is still required.
- **Pre-registration trust:** role registration is the identity acquisition boundary. If an attacker can redirect the parent path before trusted registration runs, the registration may capture the wrong object. There is no persisted trusted identity ledger across process restarts.
- **Sidecar-to-sidecar collisions:** Windows now has a process-local registry for WAL/SHM/journal identities and rejects aliases across roles and sidecar kinds. It is not persistent and has not passed exact-head CI. POSIX still lacks equivalent complete sidecar-to-sidecar ownership.
- **Sidecar lifecycle:** there is no persistent sidecar ownership ledger, complete delete/recreate policy, or crash-recovery reconciliation.
- **Complete VFS operation surface:** POSIX xOpen/syscall open, stat and xAccess for registered DB/sidecar names are directory-relative. POSIX role enrollment and xDelete now enforce an owner-only parent-directory permission policy (effective-UID ownership; no group/other write bits), which blocks replacement by a different UID under that policy. This is not identity-bound deletion and does not protect against same-UID/privileged attackers; a protected quarantine/equivalent remains required if those actors are in scope. Temporary-file paths, all other VFS callbacks, parent-VFS bypasses, locking and file-control operations have not been exhaustively reviewed. Windows xAccess is directory-relative and records/validates process-local sidecar identities; Windows xDelete validates the enrolled main-DB identity or the matching process-local sidecar identity before deleting the exact opened object.
- **Role inventory:** the test registry is fixed at 32 entries. Production must supply a complete trusted inventory for every persistent database role and fail closed on omissions.
- **Filesystem policy:** ownership, ACLs, permissions, mount boundaries, network filesystems and all filesystem-specific behaviors have not been exhaustively validated.
- **Production lifecycle:** startup ordering, migration, backup/restore, corruption recovery and shutdown/restart behavior remain unimplemented.
- **Other SQLite engines:** this probe targets the SQLite engine embedded in Node's node:sqlite. The uploaded ST-VectorService source uses better-sqlite3 13.0.3 and opens vectors.sqlite in WAL mode. That is a separate SQLite engine and is not covered by this node:sqlite registration proof. It needs its own exact-engine registration/identity test or a deliberate driver integration decision.
- **Host inventory:** this probe does not prove that SillyTavern or every extension has been inventoried, nor that all database opens in the installed Host pass through this VFS.

## Decision from the spike

The native VFS/syscall-wrapper route works inside the exact SQLite engine used by Node 22.13.0 on Windows and Linux. A separate native database binding is not required merely to preserve the existing node:sqlite API.

That is a feasibility decision, not a production security approval. Issue #770 remains open. Do not wire production Core, Coordinator, Provider, Host-ledger, dispatch-ledger or accepted-head files to this probe.

## Remaining implementation gates

1. Add a protected expected-identity manifest for the POSIX directory chain; decide and implement the production deletion primitive (protected same-filesystem quarantine/equivalent, or an explicitly accepted and reviewed owner-only directory threat model); independently test the Windows VFS integration, including sidecar ownership/deletion, role-registration trust, main/sidecar opens, xAccess and xDelete, and VFS-level parent-rename/reparse-point attacks.
2. Extend the directory-relative policy to every required VFS operation, temporary files, and all DB/sidecar lifecycle paths.
3. Define the persisted trusted identity/role ledger and startup reconciliation policy.
4. Extend the process-local Windows sidecar identity registry into a protected persistent ownership lifecycle and complete WAL/SHM/journal crash/restart tests; implement equivalent sidecar-to-sidecar ownership on POSIX.
5. Prove exclusive ownership of the required syscall hooks against all supported native components.
6. Inventory every production database role, including Memory Provider, dispatch gateway ledger, accepted-head authority, and direct Core/Provider opens.
7. Evaluate the separate better-sqlite3 engine used by ST-VectorService.
8. Test crash recovery, migrations, backup/restore, shutdown and restart on Windows and Linux.
9. Obtain independent Security review before closing Issue #770 or enabling production opens.

A passing probe test is not a substitute for the remaining gates.
