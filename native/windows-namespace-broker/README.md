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
cl /nologo /W4 /WX /guard:cf /DUNICODE /D_UNICODE windows_broker_service.c windows_manifest_store.c windows_namespace_adapter.c /link advapi32.lib bcrypt.lib

The eventual broker must run under a dedicated service identity, distinct from
the application service identity. The --client-sid argument must be the exact
application service SID. Broker manifest and anchor directories must be
exclusively writable by the broker identity.

## Durable metadata-store increment

`windows_manifest_store.c` now supplies the first native storage primitives:
- resolves the configured metadata directory through a handle-relative drive-root walk, rejecting reparse points in every traversed ancestor and the final directory;
- requires the pinned directory to be on NTFS and have a protected DACL containing only the broker identity, SYSTEM and Administrators;
- uses a fixed child-name allowlist for manifest, intent and lock files;
- serializes writers with an exclusive byte-range lock;
- opens children relative to the pinned directory handle with no-follow semantics;
- validates bounded bytes through mandatory trusted manifest/intent callbacks;
- writes a unique temporary file, flushes it, atomically renames it relative to the directory handle, then requires a directory flush;
- removes the pending intent through the opened file handle and requires a directory flush.

This is not yet a complete durable store integration. The caller must provision and verify the directory's dedicated-service ACL and all ancestors, supply strict duplicate-key/schema/generation validators, invoke startup recovery under the exclusive lock, and prove crash semantics on supported Windows/NTFS versions. The service host still answers PING only; no SQLite operation is enabled. The Windows CI job compiles the store with MSVC and runs a filesystem smoke test for lock, atomic writes, reads and intent removal. This is not a crash-injection or ACL-isolation test.

## NTFS sidecar adapter increment

`windows_namespace_adapter.c` adds a narrow handle-relative API for SQLite sidecars:
- CREATE_NEW-only creation and OPEN_EXISTING-only reopen relative to a retained parent HANDLE;
- sidecar suffix allowlist (`-wal`, `-shm`, `-journal`) and basename validation;
- opened-handle identity capture and optional expected-identity enforcement;
- rejection of directories and reparse points;
- file flush and parent-directory flush primitives;
- deletion only after comparing the opened handle's identity with the expected manifest identity; the delete call consumes/closes that handle before flushing the parent.

The adapter is not yet connected to the named-pipe protocol or SQLite VFS. The service still reports filesystem operations as UNSUPPORTED. The Windows smoke test now exercises create, flush, reopen, identity mismatch rejection, and delete. NTFS crash consistency and actual directory-flush support remain gated by the Windows job.

## Strict Windows manifest byte validation

`native/secure-vfs-probe/windows-manifest-json.js` adds a Node-side strict byte parser for the existing Windows role-manifest and lifecycle-intent validators:
- fatal UTF-8 decoding; BOMs and malformed byte sequences are rejected;
- duplicate object keys are rejected at every nesting level, including keys that become equal after JSON escape decoding;
- malformed escapes, unpaired surrogates, trailing commas/content and excessive nesting/token/byte counts are rejected;
- parsed manifests and intents are passed through the exact-key and generation/state validators already used by the lifecycle coordinator;
- bounded encoders validate before serialization.

This parser is covered by the VFS CI manifest-schema job. It is not yet wired into the native SCM broker's validation callbacks; the broker continues to reject every state-changing request until that bridge and startup recovery are implemented.


## Native Windows CI gate

The `.github/workflows/better-sqlite3-vfs-integration.yml` workflow now compiles the
SCM host together with the manifest-store and namespace-adapter translation
units using MSVC `/W4 /WX`, then compiles and runs the native metadata/sidecar
smoke test. It also runs the source-contract and Windows handle-relative VFS
tests. This catches C compiler/linker regressions in the broker components;
it does **not** make the SCM host operational or authorize SQLite operations.
The service continues to return UNSUPPORTED for all filesystem operations
until trusted native manifest/intent validation, startup recovery, namespace
lifecycle coordination and safe client-handle transfer are implemented and
tested end-to-end.


## Locked startup-recovery primitive

`le_win_store_startup_recover` is the first recovery coordinator boundary for
the native store. It acquires the exclusive store lock, requires a valid
manifest, reads and validates the optional intent, and invokes the caller's
reconciliation callback while the lock remains held. The callback may commit a
validated next manifest through the same store. The store removes the intent
only after the callback reports durable reconciliation; callback failure,
invalid metadata, or ambiguous reads leave the intent in place and return
failure. A missing manifest is always fatal.

The native smoke test verifies both branches: a rejected callback leaves the
intent readable, while a successful callback causes the intent to be retired.
The callback is deliberately not implemented by the SCM host yet. Production
use still requires a native strict-schema validator and an identity-bound
reconciliation callback that checks every registered DB and sidecar against
the manifest before the service can report ready.
