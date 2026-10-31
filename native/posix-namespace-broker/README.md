# POSIX SQLite namespace broker — transport prototype

**Status: prototype only; not production security approved.**

This directory contains the incremental Linux/POSIX broker implementation required by Issue #770 / PR #839. The C `broker_server` is retained as a PING-only transport smoke test. The Python `broker_daemon.py` now verifies the persistent manifest and supports role-based main/sidecar descriptor opens, durable sidecar open-or-create, identity-checked access, and quarantine-backed deletion. It does not yet delete main databases, rename entries, or fully manage SQLite files.

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
- Client-supplied ancillary descriptors are rejected. `OPEN_MAIN`, `OPEN_SIDECAR`, `CREATE_SIDECAR`, `OPEN_ROLE_PARENT` and `OPEN_OR_CREATE_SIDECAR` return one broker-opened descriptor with outbound `SCM_RIGHTS`; `ACCESS_ROLE_FILE` performs a manifest identity check without returning a descriptor; `DELETE_SIDECAR` performs a manifest-backed quarantine deletion.
- The C `broker_server` implements only `PING`; the Python daemon implements `PING`, `OPEN_MAIN`, `OPEN_SIDECAR`, `CREATE_SIDECAR` and `DELETE_SIDECAR`.


## Manifest-backed descriptor broker increment

`broker_daemon.py` is the first service path that consumes the manifest store.
At startup it verifies every enrolled database role and active sidecar, then
accepts authenticated `AF_UNIX/SOCK_SEQPACKET` requests from the configured
application UID. Requests contain a logical role name and, for sidecars, one of
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
CREATE_SIDECAR, OPEN_ROLE_PARENT, OPEN_OR_CREATE_SIDECAR, ACCESS_ROLE_FILE and
DELETE_SIDECAR. RENAME, main-file deletion, broker-first role enrollment,
production cross-UID socket permissions and full recovery remain open.

## Persistent role-manifest storage primitive

`manifest_store.py` provides enrollment/recovery storage and is consumed by
`broker_daemon.py`; the C `broker_server` remains PING-only. It stores a canonical Linux role manifest in one service-owned
0700 directory and a separate generation+SHA-256 anchor in another service-owned
0700 directory. Both directory paths are opened component-by-component with
`O_DIRECTORY|O_NOFOLLOW`; writable-by-group/other ancestors and ancestors
owned and writable by the configured application UID are rejected. The Linux
manifest records that application UID, and role-parent verification applies
the same check to every opened path component. The broker service UID and
application UID must be distinct.
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
The Linux VFS now has an opt-in client binding via
`logic_engine_vfs_probe_bind_broker(role, socketPath)`: main opens use
`OPEN_MAIN`, WAL/SHM/journal opens use `OPEN_OR_CREATE_SIDECAR`, access/stat
checks use `ACCESS_ROLE_FILE` and broker-opened descriptors, and sidecar
deletion uses `DELETE_SIDECAR`. The parent SQLite VFS still supplies its native
`sqlite3_io_methods`, including I/O, locks, WAL and SHM. The end-to-end VFS
test currently uses a same-UID fake broker; the production manifest store and
daemon operations are tested separately. Cross-UID service deployment and
broker-first enrollment are not yet integrated.

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

`reconcile-absent` commits a narrow transition: an absent sidecar in `creating` or `deleting` becomes `retired` in a new manifest generation. Present transitional files remain unchanged. Run it only after stopping the application and quiescing every process that can mutate the role directory; manifest locks do not lock SQLite namespace operations. Until the broker owns those operations, this is offline maintenance only.

The `recovery-plan` command provides an inspect-only sidecar recovery pass. It verifies database and parent identities, checks declared WAL/SHM/journal entries against opened-file identities, and rejects unmanifested sidecars or duplicate sidecar kinds. For interrupted creating/deleting states it reports presence and a possible manifest transition. It never deletes, renames, checkpoints, or opens a database through SQLite. A still-present deleting sidecar is retained and requires SQLite-aware recovery; the planner does not infer that unlinking a WAL or journal is safe.

The broker operation set remains incomplete: main-file creation/deletion, RENAME, broker-first role enrollment, production cross-UID socket policy, complete SQLite VFS coverage and automatic crash-time namespace mutation recovery are not implemented. Sidecar deletion is implemented as a role-scoped quarantine operation. A successful verification is a point-in-time integrity check, not a lease preventing later mutation. The OS ownership boundary must keep the application from mutating these directories after verification.

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

This remains an incomplete broker/VFS increment. It does not yet implement:

- a dedicated service account, service manager integration or authenticated administrative enrollment;
- a platform-backed monotonic anti-rollback anchor;
- main-file creation/deletion, `RENAME`, `SYNC_DIR` and complete crash/restart sidecar reconciliation;
- full SQLite VFS integration on Windows and production cross-UID Linux deployment; Linux main/sidecar open/access/delete is now an opt-in partial path;
- complete protected directory ownership and namespace mutation policy;
- complete VFS callback coverage, production locking/WAL/SHM verification, and crash/restart recovery;
- Windows support.

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
