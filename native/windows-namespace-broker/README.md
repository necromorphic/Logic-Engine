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
