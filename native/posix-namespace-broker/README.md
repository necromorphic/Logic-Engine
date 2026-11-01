# POSIX SQLite namespace broker — transport prototype

**Status: prototype only; not production security approved.**

This directory contains the incremental Linux/POSIX broker implementation required by Issue #770 / PR #839. The C `broker_server` is retained as a PING-only transport smoke test. The Python `broker_daemon.py` verifies the persistent manifest and handles authenticated runtime main/sidecar descriptor opens, sidecar creation/deletion, and identity-checked access. Main-file enrollment, disable, rename, delete, and restart reconciliation are implemented in `ManifestStore` and its broker-identity-only administrative CLI; these offline lifecycle operations are intentionally not exposed to the application socket. The implementation remains a feasibility prototype, not a complete production SQLite VFS.

## Build

From the repository root on Linux:

```sh
make -C native/posix-namespace-broker
```

The build uses the system C compiler and Linux Unix-domain socket APIs.

## Run a local protocol smoke test

For a production deployment, provision the socket directory under a service-owned
path (not inside an application-owned home directory):

```sh
app_group="$(id -g logic-app)"
uid="$(id -u logic-app)"
# The broker service must be root or a member of the application group.
sudo install -d -o logic-broker -g "$app_group" -m 0710 /var/lib/logic-engine-broker
python3 native/posix-namespace-broker/broker_daemon.py \
  --socket /var/lib/logic-engine-broker/broker.sock \
  --manifest-root /var/lib/logic-engine-broker/manifest \
  --anchor-root /var/lib/logic-engine-broker/anchor \
  --app-uid "$uid" --app-gid "$app_group"
```

For a same-UID local smoke test, a private directory under the current home
directory can be used; that does not demonstrate production UID separation.

In a second terminal, as the configured application UID:

```sh
native/posix-namespace-broker/broker_ping \
  "$HOME/.local/state/logic-engine-broker/broker.sock"
```

Expected output: `broker PING: OK`. Stop the broker with Ctrl+C.

The server walks the absolute socket-parent path from `/` using
`openat(O_DIRECTORY|O_NOFOLLOW)`. It rejects symlink components, group/other
writable ancestors, and ancestors owned and writable by the application UID.
For distinct service/application UIDs, the final directory must be service-owned,
group-owned by the application's dedicated group and exactly mode `0710`.
The socket is service-owned, group-owned by that application group and mode
`0620`: the application group can connect but cannot list the directory or
replace the socket. The broker service must be root or belong to that group to
set the socket group. Kernel `SO_PEERCRED` still authenticates the exact
application UID; other group members are rejected. Use a dedicated group with
no unrelated members to limit connection-level denial-of-service exposure.

## Protocol v2 increment

- Transport: `AF_UNIX` + `SOCK_SEQPACKET` + `SOCK_CLOEXEC`.
- Peer authentication: kernel-provided `SO_PEERCRED`; request payload cannot claim an identity.
- Fixed-size network-byte-order request and response headers.
- Unknown operations, flags, malformed payloads and unsupported protocol versions are rejected.
- Client-supplied ancillary descriptors are rejected. `OPEN_MAIN`, `OPEN_SIDECAR`, `CREATE_SIDECAR` and `OPEN_OR_CREATE_SIDECAR` return one broker-opened file descriptor with outbound `SCM_RIGHTS`; `ACCESS_ROLE_FILE` performs a manifest identity check without returning a descriptor; `DELETE_SIDECAR` performs a manifest-backed quarantine deletion. The application-facing protocol does not export role-parent directory descriptors.
- The C `broker_server` implements only `PING`; the Python daemon implements `PING`, `OPEN_MAIN`, `OPEN_SIDECAR`, `CREATE_SIDECAR` and `DELETE_SIDECAR`.


## Manifest-backed descriptor broker increment

`broker_daemon.py` is the first service path that consumes the manifest store.
Before opening the socket, startup first completes a quarantined sidecar
delete only when the quarantined handle identity uniquely matches a manifest
sidecar in `deleting` state. It then reconciles absent sidecars left in
`creating` or `deleting` states to `retired`. If a transitional sidecar is
still present at its live name and its identity matches, the broker durably
marks its role `recovery-required`; it never deletes or promotes that file
automatically. Unknown or mismatched quarantine entries remain retained and
block startup. Startup then verifies every enrolled database role and active
sidecar before exposing the socket. This startup mutation relies on the documented
service-owned role-directory boundary: the application cannot mutate these
directories except through the broker, and the broker socket is not yet exposed.
It then accepts authenticated `AF_UNIX/SOCK_SEQPACKET` requests from the
configured application UID. Requests contain a logical role name and, for sidecars, one of
`wal`, `shm`, or `journal`; arbitrary filesystem paths are never accepted.
`OPEN_MAIN` and `OPEN_SIDECAR` return the exact identity-verified descriptor; `CREATE_SIDECAR` creates a new empty sidecar with `O_EXCL`, fsyncs it, commits `creating` and then `active` manifest generations, and only then returns its descriptor
through outbound `SCM_RIGHTS`. Client-supplied descriptors are rejected. The
server processes one bounded request at a time so the manifest store's
cross-process flock serialization is not weakened by shared in-process lock
descriptors.

Example invocation after trusted roots and the role manifest have been
provisioned:

```sh
python3 native/posix-namespace-broker/broker_daemon.py \
  --socket /var/lib/logic-engine-broker/broker.sock \
  --manifest-root /var/lib/logic-engine-broker/manifest \
  --anchor-root /var/lib/logic-engine-broker/anchor \
  --app-uid "$(id -u logic-app)"
```

The C `broker_server` remains a transport smoke-test server and implements
PING only. The Python daemon implements PING, OPEN_MAIN, OPEN_SIDECAR,
CREATE_SIDECAR, OPEN_OR_CREATE_SIDECAR, ACCESS_ROLE_FILE and
DELETE_SIDECAR. Privileged `manifest_store.py` administration now provides
broker-first main-file enrollment plus offline disable, rename and delete
lifecycle transitions. These administrative operations are not exposed to the
application socket. The application must be fully stopped before disable,
rename or delete: the broker cannot revoke already-transferred SQLite file
descriptors. Startup reconciles an interrupted enrollment, rename or delete
only when opened-object identities prove the recorded transition.

## Broker-first main database lifecycle (incremental prototype)

Provision one dedicated service-owned directory per role on a qualified
`ext4`, `xfs` or `btrfs` filesystem. The final directory must be owned by the
broker service UID with exact mode `0700`; every ancestor is checked for trusted
ownership and non-writability. The application UID must be distinct from the
broker service UID and must not be able to modify the role directory. Run the
broker as a dedicated non-root service account whose primary GID equals the
dedicated application socket group (the same value passed as `--app-gid`);
the daemon refuses to start if that identity does not match. The socket parent
must be service-owned mode `0710`, and the socket itself service-owned mode
`0620`.

Enrollment first commits a durable `pendingEnrollments` intent containing
the role and pinned parent identity, before creating any database file. The
broker then creates the main file with `O_CREAT|O_EXCL|O_NOFOLLOW`, validates
the opened descriptor, fsyncs the file and parent, commits its identity, and
atomically replaces the pending intent with an `enrolling` role record. It then
commits `active` before returning. Existing files are never adopted. Startup
can finish an interrupted intent whether the file has not yet been created,
was created before identity commit, or has a persisted identity; mismatched or
ambiguous objects block startup.

Example (run as the broker service identity after provisioning the directories
and initializing the manifest):

```sh
python3 native/posix-namespace-broker/manifest_store.py \\
  --manifest-root /var/lib/logic-engine-broker/manifest \\
  --anchor-root /var/lib/logic-engine-broker/anchor \\
  --app-uid "$(id -u logic-app)" \\
  enroll --role core --parent /var/lib/logic-engine-broker/roles/core \\
  --basename core.sqlite
```

Main-file rename and deletion are deliberately offline administrative
operations, not SQLite runtime `xDelete` requests. Stop every application
process and close every connection before running them. First disable the role
(to deny new broker opens), then optionally rename or delete it:

```sh
python3 native/posix-namespace-broker/manifest_store.py \\
  --manifest-root /var/lib/logic-engine-broker/manifest \\
  --anchor-root /var/lib/logic-engine-broker/anchor \\
  --app-uid "$(id -u logic-app)" disable --role core --confirm-quiesced

# Optional: rename while the application remains stopped. The role remains disabled.
python3 native/posix-namespace-broker/manifest_store.py \\
  --manifest-root /var/lib/logic-engine-broker/manifest \\
  --anchor-root /var/lib/logic-engine-broker/anchor \\
  --app-uid "$(id -u logic-app)" rename --role core --basename core-archive.sqlite --confirm-quiesced

# After checking the renamed file, explicitly re-enable the role before starting the app.
python3 native/posix-namespace-broker/manifest_store.py \\
  --manifest-root /var/lib/logic-engine-broker/manifest \\
  --anchor-root /var/lib/logic-engine-broker/anchor \\
  --app-uid "$(id -u logic-app)" enable --role core

# Or permanently remove the main file while retaining a deleted manifest tombstone.
python3 native/posix-namespace-broker/manifest_store.py \\
  --manifest-root /var/lib/logic-engine-broker/manifest \\
  --anchor-root /var/lib/logic-engine-broker/anchor \\
  --app-uid "$(id -u logic-app)" delete --role core --confirm-quiesced
```

The manifest records `renaming`/`deleting` before namespace mutation. Rename
uses `renameat2(RENAME_NOREPLACE)`; deletion uses the existing identity-checked
quarantine primitive. Startup completes only an unambiguous identity-matched
transition. A renamed role remains disabled until the operator explicitly runs
`enable`, which re-verifies the opened main-file identity before restoring
broker opens. A deleted role is a terminal manifest tombstone and cannot be
re-enabled or silently re-enrolled under the same role name. This is still a prototype:
operator quiescence is a precondition, not a broker-enforced lease, and runtime
SQLite main-file deletion remains fail-closed.

## Persistent role-manifest storage primitive

`manifest_store.py` provides enrollment/recovery storage and is consumed by
`broker_daemon.py`; the C `broker_server` remains PING-only. It stores a canonical Linux role manifest in one service-owned
0700 directory and a separate generation+SHA-256 anchor in another service-owned
0700 directory. Both directory paths are opened component-by-component with
`O_DIRECTORY|O_NOFOLLOW`; every ancestor must be owned by root or the broker
service UID and must not be writable by group/other. Other local UIDs, including
the application UID, are never accepted as ancestor owners. Root is never
accepted as the application identity. Role-parent verification applies the same
ownership rule to every opened component. The broker service UID and application
UID must be distinct.
Metadata files are opened without following symlinks, must be single-link regular
files owned by the service UID, and are capped at 1 MiB.

The update sequence is:

1. Write and fsync `manifest.next`.
2. Atomically replace and fsync `anchor.json` with the next generation and digest.
3. Rename `manifest.next` to `manifest.json` and fsync the manifest directory.

The store now also exposes `ManifestStore.open_role_file(role, kind)`. It accepts a
logical role name and one of `main`, `wal`, `shm`, or `journal`; it does not
accept caller-supplied paths. It resolves the enrolled parent by its retained
identity chain, opens the file relative to that directory with no-follow and
nonblocking flags, validates the opened descriptor's type, owner, link count,
mount and persistent identity, and returns that exact descriptor to the caller.
The caller owns the descriptor and may transfer it to the authenticated
application process using `SCM_RIGHTS`.

`broker_daemon.py` returns validated descriptors to authenticated clients.
Strict Linux role binding is supplied only by trusted Host process
configuration: `LOGIC_ENGINE_VFS_ROLE_PATH`,
`LOGIC_ENGINE_VFS_ROLE_NAME`, `LOGIC_ENGINE_BROKER_SOCKET`, and the expected
service identity `LOGIC_ENGINE_BROKER_UID`. The Host invokes the no-argument
`logic_engine_vfs_probe_register_broker_role_from_host()` entrypoint before
opening any file-backed database. SQL cannot choose or rebind the role, path,
socket, or expected broker UID. The obsolete
`logic_engine_vfs_probe_bind_broker(role, socketPath)` rebinding entrypoint
has been removed. The caller-parameter broker-role registration entrypoint
exists only in explicitly marked test builds; strict Linux builds expose only
the no-argument Host-configured enrollment callback. The expected broker UID
is copied into the registered role and is not re-read from mutable process
environment for subsequent namespace operations.

Main opens use `OPEN_MAIN`, WAL/SHM/journal opens use
`OPEN_OR_CREATE_SIDECAR`, access/stat checks use authenticated broker
operations, and sidecar deletion uses `DELETE_SIDECAR`. The VFS pins the
expected broker UID and verifies it against both the socket owner and
`SO_PEERCRED`; missing, malformed or mismatched UID configuration fails
closed. The exact archived ST-VectorService Linux x64
`better-sqlite3@13.0.3` prebuild is exercised against the manifest-backed
daemon with distinct application and broker UIDs. Tests cover descriptor-backed
main/WAL byte I/O, rollback journal, SHM mapping and locks, reader/writer
snapshots, sidecar lifecycle, abrupt application exit, broker restart, WAL
recovery and integrity checks. The parent SQLite VFS still supplies platform
lock and SHM methods; this is an integration feasibility probe, not a
production-owned `sqlite3_file` implementation.

The anchor replacement is the commit point. On restart, if the anchor references
the staged manifest, verification completes the rename. A manifest that does not
match the anchor fails closed. Generation must advance by exactly one. Both initialization and every subsequent
commit verify that the candidate manifest's metadata-root device/inode/mount ID
matches the already-opened manifest directory, preventing a commit that would
make the next load unrecoverable.

**Trust boundary:** this prevents an application UID from silently rolling back
only the manifest when the anchor directory remains inaccessible to it. It is
not a hardware monotonic counter. An attacker able to restore or modify both
service-owned roots (or execute as the broker service UID) can roll back both.
Production deployment still needs an independently protected backup/restore
policy or platform monotonic anchor, plus privileged enrollment and broker-side
validation before this store can be treated as authoritative. The current POSIX role-manifest implementation accepts only the explicitly
qualified local filesystems `ext4`, `xfs`, and `btrfs`; verification resolves
the opened role-parent descriptor's mount ID through `/proc/self/mountinfo`
and requires the observed filesystem type to match the manifest policy. Other
filesystems, unavailable mount metadata, and zero device/inode/mount identities
fail closed. This allowlist is intentionally conservative and must be expanded
only after identity semantics are qualified with adversarial tests.

`ManifestStore.verify_roles()` adds a read-only verification pass: it walks
each enrolled parent from the filesystem root with directory FDs and
`O_NOFOLLOW`, compares each opened directory's device/inode/mount ID to the
manifest, then opens the main database and active sidecars relative to the pinned
parent FD and compares their opened-handle identities. It rejects missing,
replaced, symlinked, multiply-linked or non-regular database files. Roles marked
disabled are skipped; roles or sidecars in transitional/recovery states fail
closed. The CLI `verify` command performs this pass.

All store operations now take advisory `flock` locks on both retained metadata
directories in a stable device/inode order. Reads take the exclusive lock too,
because loading may complete an interrupted staged-manifest rename. This
serializes cooperating store processes and prevents two commits from advancing
the same generation concurrently. It does not constrain code that bypasses this
store or runs with the broker service UID.

`reconcile-absent` commits a narrow transition: an absent sidecar in `creating` or `deleting` becomes `retired` in a new manifest generation. Present transitional files remain unchanged. The broker now invokes this reconciliation before exposing its socket, relying on service-owned role directories that the application cannot mutate directly. The standalone CLI operation remains offline maintenance and must only run after quiescing every namespace mutator.

The `recovery-plan` command provides an inspect-only sidecar recovery pass. It verifies database and parent identities, checks declared WAL/SHM/journal entries against opened-file identities, and rejects unmanifested sidecars or duplicate sidecar kinds. For interrupted creating/deleting states it reports presence and a possible manifest transition. It never deletes, renames, checkpoints, or opens a database through SQLite. A still-present deleting sidecar is retained and requires SQLite-aware recovery; the planner does not infer that unlinking a WAL or journal is safe.

The broker operation set remains incomplete. Broker-first main-file enrollment and offline administrative rename/delete are implemented, but main-file `xDelete` intentionally remains fail-closed and those maintenance operations are not exposed to the application socket. The operator must stop every application process before disabling, renaming or deleting a role; the broker does not yet enforce per-open leases or revoke descriptors already transferred to an app process. Production service supervision and cross-UID socket deployment still need independent validation. Temporary DB/journal, subjournal and super-journal namespace classes and complete production-owned SQLite VFS methods remain open. Startup reconciles manifest-authorized interrupted main-file rename/delete and enrollment transitions, and separately handles sidecar recovery; present ambiguous sidecar transitions remain fail-closed. Sidecar deletion is implemented as a role-scoped quarantine operation. A successful verification is a point-in-time integrity check, not a lease preventing later mutation. The OS ownership boundary must keep the application from mutating these directories after verification.

Run the manifest-store tests with:

```sh
python3 native/posix-namespace-broker/test_manifest_store.py

# Manifest CLI operations also require the configured application UID:
python3 native/posix-namespace-broker/manifest_store.py \
  --manifest-root /var/lib/logic-engine-broker/manifest \
  --anchor-root /var/lib/logic-engine-broker/anchor \
  --app-uid "$(id -u logic-app)" verify
```

## POSIX quarantine-delete primitive (standalone prototype)

`quarantine_delete.c` adds a Linux-only deletion primitive for a pinned parent
directory. It opens the expected entry without following symlinks, validates
its opened-object identity and single-link regular-file status, atomically
moves the current directory entry into a broker-private 0700 quarantine
directory with `renameat2(RENAME_NOREPLACE)`, then opens the moved object and
compares its identity to the original descriptor and manifest expectation.
Only an exact match is unlinked. A replacement detected after the move is
retained in quarantine and reported as an identity mismatch.

The quarantine directory must be owned by the broker effective UID, have
exactly mode `0700` (including no special permission bits), be distinct from
the role parent, and reside on the same mount. The caller must obtain its
descriptor from a service-private directory tree whose ancestors cannot be
renamed or replaced by the application UID; checking the final directory's
mode alone cannot establish that provisioning boundary. The parent descriptor
must also be a trusted, already-pinned directory handle. The primitive fsyncs
the quarantine directory and then the parent after the rename, before
unlinking; after unlink it fsyncs quarantine again. If a
pre-unlink sync fails, the object is retained and the API reports
`LEB_QUARANTINE_RETAINED`. If unlink succeeds but the final sync fails, it
reports `LEB_QUARANTINE_DURABILITY_UNCERTAIN`; callers must treat the outcome
as potentially non-durable rather than retrying blindly. Missing `statx`
mount identity or unsupported `renameat2` fails closed. The
test injects a deterministic name replacement precisely between the initial
open and rename, and also covers successful deletion, hard links and symlinks.

This C helper remains a standalone primitive and is not yet called by `broker_server` or a
SQLite VFS. The Python daemon has a separate equivalent quarantine-delete implementation. It does not protect file contents from a process that already has
a writable descriptor, and it is not a complete SQLite `xDelete` integration.
On an identity mismatch, the substituted entry is moved into quarantine but
never unlinked; operators must inspect it. Production use still requires
broker-owned namespace policy, durable quarantine lifecycle, SQLite callback
integration, and Windows parity.

## Explicit limitations

This remains an incomplete broker/VFS increment. Outstanding production work:

- privileged provisioning/enrollment and an independently protected monotonic anti-rollback anchor;
- runtime main-file `xDelete`, broker-enforced app quiescence/per-open leases, and production validation of offline rename/delete durability;
- a Windows broker/service with a durable authenticated manifest and restart lifecycle;
- a production-owned SQLite file object covering every supported file class and all applicable I/O, locking, WAL/SHM and durability methods (the current probe delegates platform lock/SHM methods);
- crash injection across every durable manifest transition, including Windows;
- independent Security review of the exact release candidate and its deployment boundary.

### Separate SQLite-engine inventory

The supplied ST-VectorService source uses `better-sqlite3` and opens
`vector_storage/vectors.sqlite` through its own native binding. It is not
covered automatically by a VFS registered inside Node's built-in
`node:sqlite` engine, nor by this standalone POSIX broker prototype. Its
WAL-backed database requires a separately tested integration path for the
SQLite engine used by `better-sqlite3`; until then it remains outside the
proven identity boundary. No ST-VectorService source or runtime behavior is
changed by this branch.

The Python daemon processes one accepted connection at a time and applies a one-second receive deadline so an idle peer cannot hold the request loop indefinitely. It is still an incremental broker, not a hardened production SQLite namespace service. Do not point Logic-Engine or any production database at it.


## Strict Linux enrollment mode

Linux builds without `-DLOGIC_ENGINE_VFS_PROBE_ALLOW_UNBROKERED_TEST_ROLES` do not register the path-only role enrollment SQL function. Protected Linux roles must use the authenticated broker registration API. The legacy direct-path function is available only in explicitly marked test builds to preserve adversarial tests for the old local probe path.
