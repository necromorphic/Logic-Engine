# POSIX SQLite namespace broker — transport prototype

**Status: prototype only; not production security approved.**

This directory begins the Linux/POSIX broker implementation required by Issue #770 / PR #839. The first increment deliberately implements only authenticated local IPC and `PING`. It does not open, create, delete, rename, or otherwise manage SQLite files.

## Build

From the repository root on Linux:

```sh
make -C native/posix-namespace-broker
```

The build uses the system C compiler and Linux Unix-domain socket APIs.

## Run a local protocol smoke test

Create a private directory owned by the account running the broker:

```sh
install -d -m 0700 "$HOME/.local/state/logic-engine-broker"
uid="$(id -u)"
native/posix-namespace-broker/broker_server \
  --socket "$HOME/.local/state/logic-engine-broker/broker.sock" \
  --app-uid "$uid"
```

In a second terminal, as the configured application UID:

```sh
native/posix-namespace-broker/broker_ping \
  "$HOME/.local/state/logic-engine-broker/broker.sock"
```

Expected output: `broker PING: OK`. Stop the broker with Ctrl+C.

The smoke test uses the same UID for convenience. It does **not** demonstrate the required production separation between broker and application identities. Production deployment must run the broker under a dedicated unprivileged UID and configure the exact application UID.

## Protocol v1 increment

- Transport: `AF_UNIX` + `SOCK_SEQPACKET` + `SOCK_CLOEXEC`.
- Peer authentication: kernel-provided `SO_PEERCRED`; request payload cannot claim an identity.
- Fixed-size network-byte-order request and response headers.
- Unknown operation, flags, payload, version, malformed packet and ancillary descriptors are rejected.
- v1 defines only `PING`. No file descriptors are accepted from clients and no descriptors are returned.

## Persistent role-manifest storage primitive

`manifest_store.py` is an enrollment/recovery storage primitive, not yet called by
`broker_server`. It stores a canonical Linux role manifest in one service-owned
0700 directory and a separate generation+SHA-256 anchor in another service-owned
0700 directory. Both directory paths are opened component-by-component with
`O_DIRECTORY|O_NOFOLLOW`; writable-by-group/other ancestors are rejected.
Metadata files are opened without following symlinks, must be single-link regular
files owned by the service UID, and are capped at 1 MiB.

The update sequence is:

1. Write and fsync `manifest.next`.
2. Atomically replace and fsync `anchor.json` with the next generation and digest.
3. Rename `manifest.next` to `manifest.json` and fsync the manifest directory.

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
validation before this store can be treated as authoritative. It currently
validates manifest structure and metadata-root identity; it does not yet walk
and verify every database parent/file identity or reconcile SQLite sidecars.

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

The `recovery-plan` command provides an inspect-only sidecar recovery pass. It verifies database and parent identities, checks declared WAL/SHM/journal entries against opened-file identities, and rejects unmanifested sidecars or duplicate sidecar kinds. For interrupted creating/deleting states it reports presence and a possible manifest transition. It never deletes, renames, checkpoints, or opens a database through SQLite. A still-present deleting sidecar is retained and requires SQLite-aware recovery; the planner does not infer that unlinking a WAL or journal is safe.

This is still not a namespace broker operation: there is no broker IPC integration,
no SQLite VFS or sidecar lifecycle transition implementation. A successful verification is a point-in-time
integrity check, not a lease preventing later mutation. The OS ownership boundary
must keep the application from mutating these directories after verification.

Run the manifest-store tests with:

```sh
python3 native/posix-namespace-broker/test_manifest_store.py
```

## Explicit limitations

This is only the first transport increment. It does not yet implement:

- a dedicated service account, service manager integration or authenticated administrative enrollment;
- a complete race-resistant socket-directory component walk;
- broker-integrated role authorization and a platform-backed monotonic anti-rollback anchor;
- `OPEN_MAIN`, `OPEN_SIDECAR`, `ACCESS`, `DELETE`, `SYNC_DIR`;
- descriptor passing with `SCM_RIGHTS`;
- protected directory ownership and namespace mutation;
- SQLite VFS integration, locking, WAL/SHM or recovery;
- Windows support.

The server processes one accepted connection at a time and applies a one-second receive deadline to each accepted client so an idle peer cannot hold the request loop indefinitely. It is a protocol skeleton, not a hardened production daemon. Do not point Logic-Engine or any production database at it.
