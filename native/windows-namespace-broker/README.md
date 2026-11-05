# Windows SQLite namespace broker

This is the Windows SCM transport/authentication host, not an operational broker.

It creates a local named pipe with an explicit DACL for SYSTEM, Administrators,
and one configured application service SID. Each connection is authenticated
by impersonating the pipe client and comparing its TokenUser SID. Remote pipe
clients are rejected. Frames are bounded and contain logical operation data,
never filesystem paths.

PING, read-only ACCESS_ROLE_FILE and identity-bound DELETE_SIDECAR are implemented.
Both role operations accept an ASCII `role\\0kind` payload and take the
metadata-store lock. ACCESS_ROLE_FILE validates and reconciles the complete
manifest against physical NTFS identities, then returns OK or NOT_FOUND without
exposing a path or handle. DELETE_SIDECAR uses the durable intent/manifest
transaction and deletes only the sidecar matching its recorded File ID.
OPEN_MAIN, OPEN_SIDECAR, CREATE_SIDECAR and OPEN_OR_CREATE_SIDECAR still return
UNSUPPORTED. The SCM startup path validates and reconciles the durable
manifest and can recover create- and delete-sidecar crash windows described below.
The native metadata layer also exposes locked `le_win_open_role_file`,
`le_win_create_role_sidecar` and `le_win_delete_role_sidecar` operations. Open
resolves only a registered main DB or active sidecar by File ID. Create and
delete write a validated lifecycle intent before changing the namespace, flush
the file and parent, commit the next manifest generation, reconcile the result,
and only then retire the intent. DELETE_SIDECAR calls the delete transaction over
IPC. The open and create primitives are smoke-tested but are not yet exposed over
IPC. The Windows VFS now routes manifest-bound sidecar deletion through the
service; main/sidecar byte opens still use the existing process-side path and
must not be treated as production-ready.

Build from a Visual Studio Developer Command Prompt:
cl /nologo /W4 /WX /guard:cf /DUNICODE /D_UNICODE windows_broker_service.c windows_manifest_store.c windows_namespace_adapter.c windows_manifest_validator.c /link advapi32.lib bcrypt.lib

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

The SCM host opens this store with the native strict validators and invokes locked startup recovery before reporting ready. The configured namespace root is separately opened only after every ancestor passes the parent ACL policy and the root itself passes the exact protected broker/SYSTEM/Administrators ACL check on NTFS. Deployment must still provision the dedicated broker service identity, exact protected ACLs and trusted namespace root. The Windows CI job compiles the store with MSVC and runs native recovery/namespace smoke tests; it is not a full crash-injection matrix or cross-identity ACL-isolation test.

## NTFS sidecar adapter increment

`windows_namespace_adapter.c` adds a narrow handle-relative API for SQLite sidecars:
- CREATE_NEW-only creation and OPEN_EXISTING-only reopen relative to a retained parent HANDLE;
- sidecar suffix allowlist (`-wal`, `-shm`, `-journal`) and basename validation;
- opened-handle identity capture and optional expected-identity enforcement;
- rejection of directories and reparse points;
- file flush and parent-directory flush primitives;
- deletion only after comparing the opened handle's identity with the expected manifest identity; the delete call consumes/closes that handle before flushing the parent.

The low-level adapter is not directly connected to the SQLite VFS. The VFS delegates manifest-bound sidecar deletion to DELETE_SIDECAR over the named pipe. ACCESS_ROLE_FILE is also available; main/sidecar open and sidecar-create IPC remain UNSUPPORTED. The Windows smoke test now exercises create, flush, reopen, identity mismatch rejection, and delete. NTFS crash consistency and actual directory-flush support remain gated by the Windows job.

## Strict Windows manifest byte validation

`native/secure-vfs-probe/windows-manifest-json.js` adds a Node-side strict byte parser for the existing Windows role-manifest and lifecycle-intent validators:
- fatal UTF-8 decoding; BOMs and malformed byte sequences are rejected;
- duplicate object keys are rejected at every nesting level, including keys that become equal after JSON escape decoding;
- malformed escapes, unpaired surrogates, trailing commas/content and excessive nesting/token/byte counts are rejected;
- parsed manifests and intents are passed through the exact-key and generation/state validators already used by the lifecycle coordinator;
- bounded encoders validate before serialization.

This parser is covered by the VFS CI manifest-schema job and remains the Node-side validator used by the lifecycle coordinator. The native SCM broker independently enforces the same intent envelope with windows_manifest_validator.c before metadata is accepted.


## Native Windows CI gate

The `.github/workflows/better-sqlite3-vfs-integration.yml` workflow now compiles the
SCM host together with the manifest-store and namespace-adapter translation
units using MSVC `/W4 /WX`, then compiles and runs the native metadata/sidecar
smoke test. It also runs the source-contract and Windows handle-relative VFS
tests. This catches C compiler/linker regressions and exercises the implemented
startup trust gate, create/delete recovery, ACCESS_ROLE_FILE and DELETE_SIDECAR IPC.
It does **not** make the SCM host fully operational or authorize SQLite byte I/O.
OPEN_MAIN, OPEN_SIDECAR, CREATE_SIDECAR and OPEN_OR_CREATE_SIDECAR remain
UNSUPPORTED until safe client HANDLE transfer and end-to-end VFS tests are implemented.


## Locked startup-recovery primitive

`le_win_store_startup_recover` is the first recovery coordinator boundary for
the native store. It acquires the exclusive store lock, requires a valid
manifest, reads and validates the optional intent, and invokes the caller's
reconciliation callback while the lock remains held. The callback may commit a
validated next manifest through the same store. The store removes the intent
only after the callback reports durable reconciliation; callback failure,
invalid metadata, or ambiguous reads leave the intent in place and return
failure. A missing manifest is always fatal.

The native smoke test verifies that a rejected callback leaves the intent
readable, while a successful callback causes the intent to be retired. The SCM
host supplies the callback: clean startup reconciles every registered DB and
sidecar; create recovery rolls back an absent file or enrolls its captured
identity into the next manifest generation; delete recovery verifies the
expected identity, deletes only that opened file, and retires the matching
manifest entry.


## Native strict manifest and intent validator

`windows_manifest_validator.c` is a bounded native validator for the Windows
manifest and lifecycle-intent formats. It rejects invalid UTF-8, BOMs,
duplicate object keys, escaped string representations, excessive input/depth/
token counts, unknown or missing fields, non-Windows identities, malformed
file identities, invalid role/component names, invalid sidecar states and
non-consecutive intent generations. The native smoke test includes valid
manifest/intent fixtures and negative duplicate-key and generation fixtures.

The validator is compiled by the Windows CI gate and is wired into the SCM
metadata-store open and startup path. The startup callback reconciles physical
file identities before SCM readiness. This does not authorize filesystem IPC
operations.


## SCM startup trust gate

The SCM host now requires `--client-sid`, `--metadata-dir` and
`--namespace-root` in the service executable's configured ImagePath command line. Before it reports SERVICE_RUNNING or creates the named
pipe, it opens the broker metadata store with the native strict validators and
runs the locked startup coordinator. With no pending intent, the validator
opens the configured namespace root only after checking every ancestor's
mutation ACL and requiring the root's protected three-principal broker ACL on
NTFS. It then checks the manifest's root, every parent-directory, database and
active-sidecar identity using handle-relative opens. Retired sidecars must be absent unless a newer active generation of
the same kind occupies that basename.

Pending create-sidecar intents are recovered in the two supported crash
windows. If the manifest is still at baseGeneration, the role and sidecar basename
are derived from the validated manifest and intent, the parent chain is reopened
by recorded directory identities, and the sidecar is opened without following
reparse points. If the file exists, its identity is captured, the file and
parent are flushed, and a new manifest generation enrolling that exact identity
is durably committed. If CREATE_NEW never produced a file, recovery clears the
intent without advancing the manifest. If the manifest is already at
targetGeneration, recovery requires the corresponding sidecar kind to be active
at that exact generation and verifies its physical identity against the manifest. Other generations, mismatched names, active
conflicts, reparse points and ambiguous filesystem errors fail closed.

Delete-sidecar intents require the identity-match precondition and an exact
match between the intent's expected File ID and the active manifest record.
Recovery deletes only a no-follow opened handle with that identity, flushes the
parent, then durably changes the manifest record to retired and advances the
generation. If the manifest already reached targetGeneration, recovery requires
the matching retired record and an absent pathname. A replacement file or
ambiguous filesystem result fails closed.

Read-only ACCESS_ROLE_FILE and durable DELETE_SIDECAR are enabled in addition to PING. The startup gate proves
that the configured namespace matches the trusted manifest and recovers validated
create- and delete-sidecar intents before PING becomes available. OPEN_MAIN,
sidecar lifecycle IPC and client HANDLE transfer are not implemented.

## Sidecar lifecycle startup recovery

le_win_recover_lifecycle_intent is called by the SCM startup coordinator while
the metadata-store exclusive lock is held. It accepts only strictly validated
create-sidecar and delete-sidecar intents whose role and basename match the
registered database role and expected -wal, -shm or -journal suffix. The intent must carry
the operation-specific precondition absent, which the lifecycle writer may
record only after it has verified the target basename is absent while holding
the same exclusive metadata lock and namespace mutation boundary. Delete
intents use the distinct identity-match precondition.

The native smoke test exercises the create and delete durable-ordering
boundaries:
- crash after CREATE_NEW but before manifest commit: enroll the opened file's
  identity in the next manifest generation after flushing file and parent;
- crash after manifest commit but before intent retirement: require the active
  sidecar at targetGeneration and reconcile its recorded physical identity;
- crash after delete intent: delete only the opened handle matching the expected
  identity, flush the parent, and commit the sidecar record as retired;
- crash after delete manifest commit: require the matching retired record and
  an absent pathname before retiring the intent.

The native implementation covers startup recovery and durable runtime create/delete transactions. ACCESS_ROLE_FILE and DELETE_SIDECAR are enabled over IPC; main/sidecar open and sidecar create IPC remain disabled.