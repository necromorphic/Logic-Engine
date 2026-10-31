# SQLite VFS: directory anchoring and persistent identity design

**Status:** proposed implementation direction; not production approval  
**Related:** Issue #770; Draft PR #839  
**Scope:** Core, Coordinator, Host version ledger, and any other trusted SQLite database opened through the Node.js `node:sqlite` engine.

## 1. Decision boundary

The current VFS spike proves that the Node.js 22.13.0 / SQLite 3.47.2 process can retain a native VFS registration and inspect the object returned by the native open operation. It does **not** prove that path resolution remains inside the directory that was trusted when a database role was registered.

A pathname-based syscall wrapper is therefore insufficient for production. Rechecking the parent path, calling `stat` before open, or checking the path again after open does not bind the open to the trusted directory entry.

The next implementation must use a pinned directory handle as the authority for resolving every database and sidecar entry. If a platform/filesystem cannot provide the required semantics, startup must fail closed. Do not silently fall back to path-only checks.

## 2. Trusted directory anchor

For each configured database role, registration must establish:

1. A trusted root/anchor from configuration outside the database directory being protected.
2. A directory-handle chain from that root to the database parent directory.
3. A canonical relative basename for the database file.
4. A persistent expected file identity, loaded from a separately protected identity manifest.
5. An open handle/descriptor for the database object whose identity matches the manifest.

The directory chain is retained for the lifetime of the database service. Replacing, renaming, or redirecting a pathname ancestor after registration must not redirect a later database or sidecar open to another directory.

Do not accept a directory chain containing a symbolic link, magic link, mount escape, Windows reparse point, or non-directory component unless a separately reviewed platform policy explicitly allows it.

## 3. POSIX implementation direction

On Linux, evaluate `openat2(2)` for component resolution from a trusted root descriptor, using restrictive resolution flags such as `RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`, and `RESOLVE_NO_MAGICLINKS`. Open the final database and sidecar entries relative to the pinned parent directory descriptor with `openat(2)`, `O_NOFOLLOW`, and appropriate file-type checks. Validate the returned descriptor with `fstat(2)`; the descriptor used by SQLite must be the descriptor whose identity was checked.

On POSIX systems without `openat2`, use a component-by-component `openat` walk from a trusted root descriptor. Every intermediate component must be opened as a directory with no-follow semantics and validated using `fstat`. If the platform cannot guarantee the required no-follow and directory-relative behavior, mark that platform unsupported rather than falling back to pathname `open()`.

The implementation must account for SQLite's descriptor-reuse path: a descriptor accepted from SQLite's pending-FD cache must be tied to the same pinned identity. The existing Linux `stat` interception test is a probe for this specific path, not a substitute for directory-relative opens. The production VFS must also replace or securely constrain path-based `xAccess`, `xDelete`, and any pathname-based temporary-file operations; securing only `xOpen` leaves path-redirection and deletion races in the delegated parent VFS. The POSIX probe now narrows the deletion threat model with an explicit parent-directory policy: role enrollment requires the pinned parent to be owned by the effective UID and have no group/other write bits, and `xDelete` rechecks those properties on the pinned descriptor immediately before deletion. It also compares the current main-DB entry with the enrolled device/inode and sidecar entries with their process-local role/kind identity before `unlinkat`; protected opens defer `O_TRUNC` until after descriptor identity checks and then call `ftruncate` on that same descriptor. Under the parent policy, a different-UID process cannot replace entries through ordinary directory permissions, and static hardlink substitutions are rejected. The `fstatat`→`unlinkat` sequence is still name-based and not atomic; it does not protect against same-UID or privileged actors, nor against a directory owner changing permissions concurrently. It is therefore only a constrained permission-based mitigation, not identity-safe deletion. If same-UID/privileged mutation is in scope, POSIX deletion still requires a protected same-filesystem quarantine/rename protocol with post-move identity validation or an equivalent reviewed primitive; stat-then-unlink remains insufficient.

## 4. Windows implementation direction

The Windows probe now uses `NtCreateFile` with `OBJECT_ATTRIBUTES.RootDirectory` set to the pinned parent-directory handle and a relative basename inside the `CreateFileW` interception for protected DB/sidecar opens, and for `xAccess`/`xDelete`. It queries the returned handle with `GetFileInformationByHandleEx(FileIdInfo)` and compares the volume serial plus full 128-bit file ID. Reparse points and directories are rejected. This remains a process-local identity check, not a trusted-manifest comparison; the supported Windows filesystem matrix and file-ID lifetime assumptions still require independent review.

The directory chain itself must be established from a trusted volume/root handle, opening each component relative to the preceding handle and rejecting reparse points. Do not reopen an absolute ancestor pathname after the chain has been trusted.

The current PR #798 probe partially implements this direction: registered Windows DB and recognized sidecar opens are issued relative to the retained parent HANDLE using `NtCreateFile`, and the returned HANDLE is consumed by the parent VFS. Windows `xAccess` resolves names relative to the retained handle; Windows `xDelete` validates the expected identity and marks the exact opened handle for deletion. This does not yet establish a complete production backend. Exact-head Windows CI, full SQLite file-method/locking/temp-file coverage, persistent identity, filesystem behavior and independent Security review remain required.

### Windows API contract details

The Windows backend should not translate a trusted relative open back into an absolute Win32 path. Microsoft documents `OBJECT_ATTRIBUTES.RootDirectory` as the directory handle relative to which `ObjectName` is resolved; a non-null root handle makes the object name relative. Use `NtCreateFile` (or a verified equivalent native entry point) with a single basename relative to the pinned parent handle. See [Microsoft NtCreateFile documentation](https://learn.microsoft.com/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile).

For every component in the initial directory walk:
- open the next component relative to the already-pinned parent handle;
- request directory-only semantics;
- request open-reparse-point behavior and inspect the returned handle's attributes;
- reject a reparse point rather than following it;
- retain the final directory handle for all DB and sidecar operations.

For file identity, prefer `GetFileInformationByHandleEx(FileIdInfo)` and compare the full `FILE_ID_INFO` tuple: 64-bit volume serial plus 128-bit file ID. Microsoft documents that the tuple identifies the same file across two open handles on one computer. A filesystem that returns an unsupported/zero 128-bit ID must be explicitly classified and rejected or handled by a separately reviewed identity strategy; do not silently fall back to the legacy 64-bit file index on ReFS. See [FILE_ID_INFO](https://learn.microsoft.com/windows/win32/api/winbase/ns-winbase-file_id_info) and [GetFileInformationByHandleEx](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandleex).

The current probe resolves registered file-backed main-DB names through the parent VFS full-path callback before passing them to the parent VFS, and rejects WAL/journal `xOpen` names that do not map back to the exact enrolled role path. Aliases that do not map to the enrolled role fail closed instead of allowing sidecar paths to miss the pinned-role matcher. The current probe routes registered Windows main-database and recognized sidecar opens through `NtCreateFile` relative to the retained parent HANDLE; the returned anchored HANDLE is consumed by the parent VFS. It also implements directory-relative Windows `xAccess` and handle-relative, identity-checked Windows `xDelete`. The Windows VFS-level parent-rename test accepts either decoy isolation after a successful rename or fail-closed OS denial while the trusted DB HANDLE is retained. This is partial VFS integration, not a complete production backend: exact-head CI, full file-method/locking/temp-file coverage, protected persistent trust and independent review remain outstanding. The implementation must preserve SQLite's requested access, share, supported create-disposition, synchronous-I/O and attribute semantics when translating the open to the native relative operation. Destructive dispositions and delete-on-close are currently rejected for protected paths; supporting them later requires applying the mutation to the same handle only after identity validation. Any unhandled flag combination must fail closed, not fall back to `CreateFileW(path)`.

## 5. Sidecar ownership and lifecycle

Treat each main database role as the owner of exactly these SQLite sidecar names:

- `<db>-wal`
- `<db>-shm`
- `<db>-journal`

Resolve each sidecar relative to the same pinned parent directory as its main database. Capture identity from the actual opened handle/descriptor. Reject:

- any sidecar aliasing a registered main database;
- any sidecar aliasing a sidecar owned by another database role;
- one sidecar identity being concurrently claimed by two different sidecar paths or roles;
- symlink/reparse-point substitution;
- missing or unusable identity information.

Sidecar ownership must have an explicit lifecycle. Track the opened object and owning role until the corresponding SQLite file handle closes; coordinate deletion through directory-relative operations and release ownership only when the object is no longer open and the deletion/close transition is confirmed. Do not keep stale inode-only records indefinitely, because inode reuse can create false identity collisions.

The current probe checks sidecars against registered main database identities and injects independent WAL, SHM, and journal replacement races. POSIX protected opens defer `O_TRUNC` until after the opened descriptor passes main/sidecar identity checks, then apply `ftruncate` to that same descriptor. Windows now maintains a process-local sidecar identity registry keyed by role and sidecar kind; it rejects hardlink aliases across roles, validates the expected identity before `xDelete`, and retains a retired identity while `NumberOfLinks` indicates another hardlink may survive. POSIX has the equivalent process-local role/kind registry and retains a retired identity when `st_nlink > 1` after `unlinkat`. Regressions cover cross-role rollback-journal hardlinks and reject adoption of a deleted-but-still-linked sidecar object. Neither registry is persistent, neither has a durable ownership/reconciliation protocol or per-open reference counts, and retired records may remain fail-closed until process restart.

## 6. Persistent identity manifest

A process-local role registry is insufficient: it forgets the expected identity after restart.

The expected role-to-file identity mapping must live outside the attacker-writable database directories, under a separately protected configuration/metadata root. The manifest must bind at least:

- schema/version;
- logical role name;
- trusted directory identity and relative database basename;
- platform-specific file identity (POSIX device/inode; Windows volume identity/file ID);
- the policy/version used to establish the identity.

The manifest must be authenticated or protected by OS access controls so that an attacker who can replace database-directory entries cannot rewrite the expected identity. If the manifest is missing, malformed, unauthenticated, stale, or inconsistent with the opened object, startup fails before schema writes or serving.

Provisioning a new database identity is a separate trusted operation. Normal startup must not silently enroll whichever object currently appears at a configured path. Backup/restore and deliberate database replacement require an explicit re-enrollment procedure and audit record.

File identity persistence is filesystem-dependent. Supported filesystems and identity stability across remount, restore, copy, and upgrade must be enumerated and tested. Unsupported or ambiguous identity behavior is a hard failure, not a path-string fallback.

## 7. Required tests before production consideration

Run the exact same deterministic cases on Windows and Linux:

1. Replace the database parent directory after registration; prove the open remains bound to the pinned directory or fails closed.
2. Replace each ancestor with a symlink/reparse point; reject it.
3. Rename the trusted directory and create a malicious directory at the old pathname; prove no database or sidecar open reaches the replacement.
4. Repeat the parent-directory attacks for Core, Coordinator, and Host ledger roles.
5. Inject hardlink/symlink/reparse substitutions independently for the main DB, WAL, SHM, and rollback journal.
6. Create WAL/SHM/journal aliases to each other and across different database roles; reject cross-role identity collisions.
7. Verify sidecar ownership release on close, checkpoint, journal deletion, WAL deletion, and reopen; include inode/file-ID reuse scenarios.
8. Restart the process and prove the persisted manifest rejects replacement of every role.
9. Exercise unavailable, zero, unstable, unsupported, or unauthenticated identity data; every case must fail closed.
10. Assert all failures occur before schema writes, migration, recovery mutation, or service startup.
11. Verify descriptor/handle reuse, worker threads, locking, shutdown, backup/restore, and crash recovery under the same pinned directory model.

Tests must assert the identity of the object actually opened, not merely a counter proving that a hook ran.

## 8. Integration constraints

- Keep the public `node:sqlite` API unless the native implementation demonstrates that it cannot safely supply the required file operations.
- Do not register or open production databases until trusted role inventory, manifest provisioning, directory anchoring, sidecar ownership, and startup ordering are implemented.
- Keep the VFS probe separate from the production adapter. Probe success is evidence for feasibility, not production authorization.
- Do not expose the parent VFS as an alternate path around the protected operations. Any direct native access to the parent VFS, mutable syscall table, or unwrapped pathname operation must be excluded by the production threat model or blocked by the implementation.
- Define SQLite temporary-file behavior explicitly. Either route every temporary file through a separately trusted scratch directory/handle policy or configure and test that the production connection cannot create pathname-based temporary files; unknown file roles must fail closed.
- Keep Memory→NPC disabled until Issue #770 and the independent Security review are closed.
- The uploaded ST-VectorService uses `better-sqlite3`, a separate SQLite engine; this Node `node:sqlite` proof does not cover it.

## 9. Exit criteria

Issue #770 can be considered resolved only when the implementation and exact-head Windows/Linux CI demonstrate all tests in §7, the supported platform/filesystem matrix is documented, and an independent Security review accepts the exact implementation commit. Until then PR #839 remains Draft and unmerged.


## 10. POSIX deletion decision: no in-process unlink workaround

The current POSIX probe's `xDelete` performs `fstatat(parent_fd, name, ...)`, compares the observed device/inode with the role or process-local sidecar record, and then calls `unlinkat(parent_fd, name, 0)`. The descriptor pins the parent directory, but neither syscall pins the child directory entry. A same-directory rename/replacement between the two syscalls can therefore make `unlinkat` remove a different object. Repeating `fstatat`, checking permissions again, or opening and validating the child before `unlinkat` only narrows the race; it does not close it.

Linux has no general unlink-by-open-file-descriptor operation. `unlinkat` always resolves a directory entry by name. A same-filesystem quarantine rename followed by identity validation is not sufficient when an attacker can concurrently mutate that directory: the rename itself still selects a name, and the attacker can race the namespace operation. Do not describe quarantine as a complete fix unless the directory namespace is exclusively controlled during the move.

**Decision for this probe:** keep the POSIX deletion path explicitly classified as a constrained, name-based mitigation, not identity-safe deletion. It is acceptable only against different-UID actors excluded by the owner-only directory policy; same-UID and privileged mutation remain outside that policy. No stronger guarantee is claimed. The existing test that weakens directory permissions and expects deletion to fail verifies only that policy gate, not atomic object-bound deletion.

**Production direction if same-UID actors are in scope:** move namespace authority out of the application identity. A dedicated broker/service identity must own the protected database directory and be the only principal permitted to mutate its entries. The application must not have direct directory write/delete rights. The broker must mediate every namespace-changing operation required by SQLite (create, rename, delete, sidecar lifecycle and recovery), not only `xDelete`; otherwise direct SQLite opens can bypass the broker's authority. Its protocol must bind requests to an enrolled role, relative basename and persistent expected identity, validate the opened object, serialize namespace mutations, and fail closed on unsupported filesystems. This is a separate backend architecture, not a small `xDelete` patch, and requires its own threat model, protocol review and Windows/Linux implementation tests.

Until that backend exists, production activation must either explicitly exclude same-UID/privileged attackers and accept the reviewed owner-only directory boundary, or remain disabled. The current VFS probe is not authorized for production in either case.
