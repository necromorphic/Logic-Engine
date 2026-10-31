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

The probe now intercepts both low-level delete syscalls in addition to its VFS `xDelete` callback. The Windows wrapper opens the exact child relative to the retained parent HANDLE, checks the recorded file identity, and deletes through `SetFileInformationByHandle`. The POSIX wrapper routes the internal `unlink` request through the same registered-role/sidecar checks in `probe_xDelete`, which uses the pinned parent dirfd and `fstatat`/ `unlinkat`. A WAL-to-DELETE integration test exercises both internal cleanup paths on Windows and Linux.

This closes the identified **callback bypass**; it does not make POSIX `fstatat→unlinkat` atomic against a same-directory writer. The separate namespace broker described below is still required for that threat model.

## 2. POSIX deletion: why a direct VFS fix is not available

Linux/POSIX exposes name-based `unlinkat(dirfd, name)`, not a standard unlink-by-open-file-descriptor primitive. The current `fstatat(dirfd,name) → unlinkat(dirfd,name)` sequence therefore has a replacement window. Repeating the stat, opening the child first, using `openat2`, or moving the name into a quarantine directory does not by itself make the final unlink target object-bound when an attacker can mutate that directory.

The production design for the threat model that includes an untrusted Logic-Engine process identity is a **separate namespace broker**:

1. A dedicated broker OS identity owns the protected database directories and the trusted manifest. The application identity has no create/rename/unlink permission on those directories.
2. The application VFS connects over an authenticated local IPC endpoint. On Linux, the broker verifies peer credentials (`SO_PEERCRED`) and accepts only the configured application identity and role allowlist.
3. The broker serializes namespace mutations and resolves every name from retained directory descriptors. Linux opens use `openat2` with restrictive resolution flags where available, with a reviewed component-by-component `openat` fallback only on explicitly supported filesystems.
4. For `xOpen`, the broker opens/creates the child, validates `fstat` identity against the manifest, persists the ownership transition, and passes the same open file description to the VFS using `SCM_RIGHTS`. The VFS performs SQLite byte I/O and file locks on that received descriptor; it does not reopen the path.
5. For `xDelete`, only the broker can mutate the directory. It serializes the operation, opens the named child without following links, validates the opened identity and role ownership, then unlinks the name while no untrusted principal can replace it. It fsyncs the parent directory before acknowledging success.
6. Create, rename, sidecar, temporary-file, hot-journal and recovery namespace operations must use the same broker. A broker used only for `xDelete` is insufficient if the application can still mutate the directory directly.

The broker process and its IPC protocol are not implemented yet. Until the broker owns the namespace and all relevant VFS operations are routed through it, POSIX registered-role deletion must not be represented as race-free. A dedicated service identity with owner-only directories is a weaker, explicitly scoped boundary: it excludes other UIDs but trusts all code running as that service identity. If that is the chosen deployment threat model, record it in the manifest and do not claim protection against same-UID code.

## 3. Windows: required all-file handle-relative backend

The current probe's `CreateFileW` interception covers registered main DB names and recognized `-wal`, `-shm`, and `-journal` names. This is not yet proof for every SQLite-created file or every VFS callback. A source audit of SQLite 3.47.2's Windows VFS found an additional bypass: `winShmPurge()` calls internal `winDelete()` directly for the SHM file, bypassing the registered VFS `xDelete` callback. The probe now also intercepts the Windows VFS `DeleteFileW` system-call hook and routes that internal deletion through the same parent-HANDLE-relative identity check. The Windows test explicitly switches a WAL database back to DELETE mode and asserts that this internal DeleteFileW hook is exercised. This closes that identified Windows sidecar-delete bypass in the probe; it does not establish full production VFS coverage.

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

The backend must preserve SQLite locking semantics across processes, not just threads. WAL tests must cover shared-memory mapping and locks, concurrent readers/writers, checkpoint/restart, abrupt process termination at each durable sidecar transition, hot-journal rollback, WAL replay, disk-full and I/O-error handling. `synchronous=NORMAL` and checkpoint-on-shutdown do not replace crash tests. The current feasibility test now characterizes cross-process `BEGIN IMMEDIATE` contention and kills a writer after forcing uncommitted WAL frames to disk, then verifies reopen, rollback of uncommitted rows and `PRAGMA integrity_check`. These tests exercise the parent VFS locking/WAL implementation; they do not prove a future custom secure file backend or persistent-manifest recovery.

## 6. ST-VectorService / better-sqlite3 separate audit

The supplied archive inventory identifies `better-sqlite3@13.0.3`, a separate native SQLite binding from Node's `node:sqlite`. Therefore the VFS registered in Node's bundled SQLite cannot be assumed to protect `vectors.sqlite`.

The separate audit must verify the exact `better-sqlite3` binary's SQLite version/build options, whether its SQLite VFS is statically or dynamically linked, whether it exposes a supported way to register a custom VFS before `new Database(DB_PATH)`, and whether any global/default-VFS registration is isolated from or shared with other SQLite copies in the process. It must trace the service's main DB, WAL, SHM, temp files, checkpoint, close and crash/restart paths. A matching version string alone is not proof of matching ABI or VFS registration.

The archive-level inventory records the service's dynamic `ST_VECTOR_ROOT`, startup open order, WAL configuration and shutdown checkpoint. A source audit of the exact upstream `better-sqlite3@13.0.3` tag confirms a separate statically linked SQLite 3.53.4 engine, `sqlite3_open_v2(..., NULL)` in the constructor, and extension loading only after the database handle is open. The 487 MB archive exceeds the available direct materialization limit, so the exact deployed prebuild/native addon binary still needs to be extracted and fingerprinted. No database file should be opened or modified as part of this static audit.

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
