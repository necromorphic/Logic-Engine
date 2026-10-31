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

## Explicit limitations

This is only the first transport increment. It does not yet implement:

- a dedicated service account, service manager integration or authenticated administrative enrollment;
- a complete race-resistant socket-directory component walk;
- role manifest, anti-rollback anchor or persistent state;
- `OPEN_MAIN`, `OPEN_SIDECAR`, `ACCESS`, `DELETE`, `SYNC_DIR`;
- descriptor passing with `SCM_RIGHTS`;
- protected directory ownership and namespace mutation;
- SQLite VFS integration, locking, WAL/SHM or recovery;
- Windows support.

The server processes one accepted connection at a time and applies a one-second receive deadline to each accepted client so an idle peer cannot hold the request loop indefinitely. It is a protocol skeleton, not a hardened production daemon. Do not point Logic-Engine or any production database at it.
