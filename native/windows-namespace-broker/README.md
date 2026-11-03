# Windows SQLite namespace broker

This is the Windows SCM transport/authentication host, not an operational broker.

It creates a local named pipe with an explicit DACL for SYSTEM, Administrators,
and one configured application service SID. Each connection is authenticated
by impersonating the pipe client and comparing its TokenUser SID. Remote pipe
clients are rejected. Frames are bounded and contain logical operation data,
never filesystem paths.

Only PING is implemented. OPEN_MAIN, OPEN_SIDECAR, DELETE_SIDECAR,
CREATE_SIDECAR, OPEN_OR_CREATE_SIDECAR and ACCESS_ROLE_FILE return UNSUPPORTED.
This is fail-closed until the durable manifest store, NTFS handle-relative
namespace adapter, recovery coordinator integration, and safe handle transfer
are implemented. Do not connect the SQLite VFS or install this host for
production use yet.

Build from a Visual Studio Developer Command Prompt:
cl /nologo /W4 /WX /guard:cf /DUNICODE /D_UNICODE windows_broker_service.c /link advapi32.lib

The eventual broker must run under a dedicated service identity, distinct from
the application service identity. The --client-sid argument must be the exact
application service SID. Broker manifest and anchor directories must be
exclusively writable by the broker identity.

## Durable metadata-store increment

`windows_manifest_store.c` now supplies the first native storage primitives:
- pins the configured metadata directory by handle and rejects a reparse-point final directory;
- requires the pinned directory to be on NTFS and have a protected DACL containing only the broker identity, SYSTEM and Administrators;
- uses a fixed child-name allowlist for manifest, intent and lock files;
- serializes writers with an exclusive byte-range lock;
- opens children relative to the pinned directory handle with no-follow semantics;
- validates bounded bytes through mandatory trusted manifest/intent callbacks;
- writes a unique temporary file, flushes it, atomically renames it relative to the directory handle, then requires a directory flush;
- removes the pending intent through the opened file handle and requires a directory flush.

This is not yet a complete durable store integration. The caller must provision and verify the directory's dedicated-service ACL and all ancestors, supply strict duplicate-key/schema/generation validators, invoke startup recovery under the exclusive lock, and prove crash semantics on supported Windows/NTFS versions. The service host still answers PING only; no SQLite operation is enabled. The Windows CI job compiles the store with MSVC and runs a filesystem smoke test for lock, atomic writes, reads and intent removal. This is not a crash-injection or ACL-isolation test.
