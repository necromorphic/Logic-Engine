# POSIX SQLite namespace broker v1

**Status:** implementation contract; not implemented and not production-approved  
**Parent:** Issue #770 / Draft PR #839  
**Target:** Linux first. Other POSIX platforms remain unsupported until separately implemented and reviewed.

## 1. Security objective

Remove directory-entry mutation authority from the application process. A separate broker identity owns every protected database directory and the persistent role manifest. The SQLite application receives already-open file descriptors from the broker and never receives a writable descriptor for a protected parent directory.

This design closes the same-UID pathname replacement gap only when the broker runs under a distinct OS identity and the application identity cannot mutate the protected namespace. It does not protect against root, broker compromise, kernel compromise, or malicious code authorized to invoke every operation exposed by the broker.

The existing in-process `fstatat() → unlinkat()` path is not upgraded by this document. It remains a constrained mitigation and must not be called race-free.

## 2. Process and filesystem boundary

Required deployment identities:

- **Broker identity:** dedicated unprivileged UID; owns protected DB directories, manifest directory, socket directory and broker state. It is not the application UID and has no general root privileges.
- **Application identity:** runs Logic-Engine and SQLite. It can connect to the broker socket but has no write, create, rename or unlink permission on protected DB directories or manifest files.
- **Administrator:** performs explicit enrollment, backup/restore and key/manifest recovery. These are offline or separately authenticated administrative operations, not normal application startup.

Required directory policy:

- Protected DB directories are mode 0700 and owned by the broker UID; no ACL grants the application write/delete rights.
- Manifest and broker configuration directories are mode 0700; files are mode 0600; ownership is broker UID.
- The Unix socket lives in a broker-owned directory, mode 0700. Socket mode alone is not authorization; peer credentials and role policy are checked after accept.
- The broker rejects writable mounts, unsupported filesystems, unexpected mount transitions, symlink/magic-link components and non-directory ancestors.
- The application must not retain any writable directory descriptor, alternate pathname, or backup path that bypasses broker mediation.

A dedicated service UID is mandatory. Running broker and application under the same UID does not satisfy this design.

## 3. IPC transport and peer authentication

Use a local `AF_UNIX` `SOCK_SEQPACKET | SOCK_CLOEXEC` socket. Do not use a stream protocol with ad-hoc framing. Each request and response is one bounded packet. The broker obtains immutable connection credentials with `getsockopt(SOL_SOCKET, SO_PEERCRED)` immediately after accept and checks the exact configured application UID and, where configured, GID. It does not trust UID/GID/PID fields supplied in packet data.

The broker also enables `SO_PASSCRED` and verifies per-message credentials if the chosen platform/kernel behavior requires it. The implementation must document the credential model and test PID/UID changes across fork/exec. Connections are closed on malformed packets, credential mismatch, truncation, unexpected ancillary data, duplicate descriptors or protocol-version mismatch.

Packet constraints:

- Fixed-width integer fields in network byte order.
- Protocol magic, version, operation, request ID, role ID, object kind, flags and basename length.
- Basename is a single component only: no slash, backslash, NUL, empty string, `.`, `..`, or platform-specific alternate separator.
- Maximum packet size is fixed and small (target <= 4 KiB); maximum basename is NAME_MAX and checked against the target filesystem.
- No client-supplied absolute paths, parent paths, manifest paths, device/inode values, or arbitrary mode bits.
- Unknown operations, flags, roles, kinds, lengths and trailing bytes are rejected.
- Exactly one descriptor may be returned for successful OPEN; no descriptor is accepted from a client in v1.

## 4. Version 1 operations

The first implementation exposes only the minimum operations required by the protected SQLite VFS:

| Operation | Purpose | Result |
|---|---|---|
| `OPEN_MAIN` | Open an enrolled main DB role | one verified FD |
| `OPEN_SIDECAR` | Open role-owned WAL, SHM or rollback journal | one verified FD |
| `ACCESS` | Query existence/readability for a role-owned name | structured result, no FD |
| `DELETE` | Delete a role-owned sidecar after identity/lifecycle validation | structured result |
| `SYNC_DIR` | Persist pending namespace/manifest transitions | structured result |
| `PING` | Liveness and protocol version | structured result |

No arbitrary path operation is exposed. V1 rejects temporary DBs, temp journals, subjournals, super-journals, attached databases and unknown file classes. They remain disabled until a separately designed scratch namespace is available.

### OPEN rules

1. Resolve the role from the broker's trusted manifest and the authenticated connection policy.
2. Derive the only allowed basename from role + kind. Never accept a caller-selected basename outside the exact role's enrolled DB basename and the three canonical suffixes (`-wal`, `-shm`, `-journal`).
3. Open relative to the retained broker-owned parent directory FD. Use `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS` where available; otherwise use a reviewed component walk and `openat(O_NOFOLLOW | O_CLOEXEC)`. No path fallback.
4. Validate the opened FD with `fstat`, file type, owner, link count, device and mount identity. Compare main DB identity with manifest. Sidecar identity must not alias any enrolled DB or another live sidecar role/kind.
5. For creation, persist a manifest sidecar transition to `creating` before exposing the FD; after file and parent directory durability, persist `active`. On any uncertain transition, mark the role `recovery-required` and fail closed.
6. Apply requested SQLite access semantics only from a strict allowlist. Do not accept `O_PATH`, `O_TMPFILE`, `O_NOATIME`, `O_DIRECT`, caller-selected ownership, or arbitrary mode/creation flags. Never use `O_TRUNC` before identity validation; truncate the already-validated FD with `ftruncate` if the SQLite open mode explicitly requires it.
7. Send the FD with `SCM_RIGHTS` in the same response packet. The application uses that received FD for all file I/O and locking. It must not reopen the pathname.

### DELETE rules

1. Accept only a sidecar kind and a role ID; never accept a path string.
2. Serialize the operation under the broker's per-role namespace lock.
3. Verify the manifest lifecycle state and the current directory entry's identity.
4. Because the broker exclusively owns the directory and the application has no directory mutation permission, no untrusted application principal can replace the entry between validation and `unlinkat`. This ownership boundary—not `fstatat` itself—is the security property.
5. Perform `unlinkat` relative to the pinned parent FD, then `fsync(parent_fd)`.
6. Persist the sidecar as `retired` only after the namespace mutation is durable. If a crash occurs between unlink and manifest update, recovery reconciles by the state machine in §7.
7. Return success only after the required durable steps complete. On any error, preserve the conservative manifest state and fail closed.

### Descriptor lifetime

The broker closes its copy after successful descriptor transfer unless it needs it for an active broker operation. The application owns the received FD and closes it only when SQLite closes the corresponding `sqlite3_file`. The descriptor must remain the exact object whose identity was checked. Do not pass a pathname back to the parent VFS for a second open.

## 5. Locking, WAL and shared-memory constraints

Passing an FD is not by itself a complete SQLite VFS. The production adapter must implement and test the complete `sqlite3_io_methods` contract around the received descriptor:

- `xRead`, `xWrite`, `xTruncate`, `xSync`, `xFileSize`;
- `xLock`, `xUnlock`, `xCheckReservedLock`, `xFileControl`;
- `xSectorSize`, `xDeviceCharacteristics`;
- WAL shared-memory `xShmMap`, `xShmLock`, `xShmBarrier`, `xShmUnmap`;
- correct close and descriptor ownership.

Do not wrap an FD and then delegate locking or SHM operations to a parent VFS that reopens a pathname. Preserve SQLite's cross-process lock semantics. The exact lock primitive and OFD/POSIX lock choice must be selected against the SQLite version shipped by Node and tested with multiple processes and worker threads. WAL SHM mapping must use the already-verified SHM FD; no path-based `shm_open` or hidden Unix VFS unlink path may bypass the broker.

The broker serializes namespace transitions, not ordinary database reads/writes. SQLite's own locking protocol remains authoritative for database transaction concurrency.

## 6. Manifest durability and anti-rollback

The broker is the sole writer of the role manifest. The current Linux prototype pins two distinct service-owned 0700 directories: one for the manifest and one for the rollback anchor. It performs updates using directory-relative temporary-file creation, complete write, file `fsync`, atomic replacement within the relevant directory, then directory `fsync`. The anchor stores the next generation and SHA-256 digest; advancing the anchor is the commit point. On restart, a staged manifest matching the anchor is promoted, while a manifest that does not match the anchor fails closed.

Every committed update increments the generation by exactly one. The current transition validator freezes the metadata-root identity, filesystem policy, role set, each enrolled parent chain, database basename and database identity after initialization. It enforces sidecar lifecycle transitions (`creating → active/deleting/retired`, `active → deleting`, `deleting → retired`), requires transition generations to match the manifest generation, and permits a retired sidecar kind to be replaced only through a new `creating` generation. Live DB/sidecar identities cannot alias each other or enrolled directory identities; retired sidecar identities are historical and may be reused by the filesystem.

This separate service-owned anchor prevents an application UID that cannot write either root from silently rolling back only the manifest. It is **not** a hardware monotonic counter: an attacker able to execute as the broker UID or restore both roots can roll back both. The prototype must not claim protection against broker-identity compromise or coordinated backup restoration.

## 7. Restart and crash recovery state machine

The broker starts before the application and does not accept OPEN requests until recovery completes.

For each role and sidecar:

- `absent`: no sidecar identity is enrolled and no entry is expected.
- `creating`: creation was authorized but not yet durably committed.
- `active`: manifest identity must match the opened entry.
- `deleting`: deletion was authorized and must be reconciled before service.
- `retired`: no directory entry may be adopted as this old identity.

Recovery rules:

1. Validate broker UID, directory modes/ACLs, pinned parent chain, mount IDs and manifest anchor.
2. Parse and validate the manifest; reject rollback, duplicate roles, duplicate identities and unknown states.
3. Reopen each parent component relative to its already trusted ancestor; compare each opened identity to the manifest.
4. For each `active` sidecar, require the exact identity to exist. Missing or changed identity means `recovery-required`; do not silently enroll.
5. For `creating`, if the entry exists and the journal proves the creation transaction committed, promote it to `active`; otherwise delete only the broker-owned uncommitted object and durably return to `absent`. Ambiguity means fail closed.
6. For `deleting`, if the entry is absent, durably mark `retired`; if the exact identity remains, finish deletion and fsync the parent; if a different identity occupies the name, fail closed and quarantine the role for administrator recovery.
7. For `retired`, reject any attempt to adopt the same old identity. New identity requires explicit administrator re-enrollment and audit record.
8. Only after every role is reconciled does the broker publish readiness and accept application connections.

Crash injection is required after every manifest write, file fsync, rename, directory fsync, unlink and response-send boundary.

## 8. Failure policy

Fail closed on broker absence, stale protocol, peer mismatch, unknown role, unknown file class, unsupported syscall/flag, unsupported filesystem, missing mount identity, identity mismatch, manifest rollback, partial ancillary data, descriptor count mismatch, failed fsync, ambiguous recovery or lock/SHM uncertainty.

The application must not fall back to the default SQLite VFS, path-based `open()`, `unlink()`, `shm_open()`, or a direct writable directory descriptor. Broker loss after startup must fail new opens/deletes; already-open FDs may continue ordinary SQLite I/O only if the VFS can prove that the operation does not require a namespace transition. Shutdown must checkpoint/close SQLite cleanly or leave the role marked for recovery.

## 9. Required adversarial and fault-injection tests

- Same-UID application process attempts create/rename/unlink in the protected directory: OS denial.
- Different UID attempts the same operations: OS denial.
- Application sends forged role, basename, path, flags, lengths, request ID, UID/PID, ancillary data and protocol version: reject.
- Socket replaced, symlinked, inherited, or stale: reject or fail startup.
- Parent/ancestor renamed or replaced after broker enrollment: broker's pinned directory FD remains authoritative; old pathname decoy is never opened.
- Race many concurrent OPEN/DELETE requests against sidecar creation/deletion; assert identity of each returned FD and every deleted object.
- Hardlink aliases across main DBs, roles and sidecar kinds: reject.
- Broker killed at every transition point; restart must reconcile deterministically or refuse service.
- Manifest rollback, truncation, partial write, permission change, owner change and directory replacement: fail closed.
- Multi-process SQLite readers/writers, `BEGIN IMMEDIATE` contention, WAL checkpoint, SHM locks, hot rollback journal, abrupt kill during WAL writes and `PRAGMA integrity_check`.
- Disk full, quota, EIO, fsync failure, EMFILE, ENFILE, socket backpressure, client disconnect after FD send.
- Verify no SQLite callback reaches a parent VFS pathname open/delete/stat/access or hidden unlink/SHM path for a protected role.

Tests must inspect the actual opened/deleted object identity and durable manifest state, not counters showing that a hook ran.

## 10. Implementation sequence and exit gate

1. Implement and unit-test the broker packet parser, peer credential checks, role allowlist and descriptor passing independently of SQLite.
2. Implement broker-owned directory enrollment and persistent manifest journal with crash-injection tests.
3. Implement OPEN/ACCESS/DELETE against pinned parent FDs and adversarial namespace race tests.
4. Implement a custom SQLite VFS file object backed by received FDs; cover every `sqlite3_io_methods` callback and SQLite hidden sidecar path.
5. Integrate broker lifecycle before database constructors and block application startup until broker recovery reports ready.
6. Run Linux CI, sanitizers, multi-process SQLite stress and crash-recovery matrix.
7. Independently review the exact commit and protocol before enabling any production role.
8. Implement Windows as a separate backend with its own handle-relative namespace owner/service design; POSIX broker completion does not satisfy Windows acceptance.

Until steps 1–8 are complete, this document is a design contract only. It does not close POSIX xDelete, authorize production DB opens, or satisfy the independent Security review.
