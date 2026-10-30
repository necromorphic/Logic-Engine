# SQLite VFS registration probe — NOT a security implementation

This probe is a narrow feasibility test for Issue #770.

## What it proves

On the exact Node.js 22.13.0 runtime used by Logic-Engine, it tests whether:

1. A temporary in-memory `DatabaseSync({ allowExtension: true })` can load a SQLite extension.
2. The extension can register a process-default VFS through the SQLite API table supplied by Node.
3. Returning `SQLITE_OK_LOAD_PERMANENTLY` keeps the extension loaded after the bootstrap connection closes.
4. Subsequent ordinary `new DatabaseSync(filePath)` connections route their main-database `xOpen` through that registered VFS.
5. The wrapper can delegate normal SQLite I/O and WAL operations to the parent VFS without replacing the underlying `sqlite3_file` methods.
6. The pinned parent VFS exposes its native open syscall (`open` on Linux, `CreateFileW` on Windows) through `xGetSystemCall`, and a test-only wrapper installed through `xSetSystemCall` observes actual `node:sqlite` file-open calls.

The C probe counts successful parent-VFS opens for the main database, WAL file, and rollback journal. It also temporarily installs a process-wide counting wrapper around the pinned native open syscall and exposes the counters through SQL functions. The wrapper delegates to the original OS call unchanged; it does not inspect or validate the returned descriptor/HANDLE. SHM is created through SQLite's shared-memory methods rather than a separate VFS `xOpen`; this probe checks its on-disk presence but does not wrap `xShmMap`.

## What it explicitly does NOT prove

- It does not validate the opened file's device/inode/file ID or Windows HANDLE identity.
- It does not prevent pathname replacement, symlink/reparse-point substitution, hard-link aliasing, or directory races.
- It delegates `xOpen` to the default VFS and therefore remains vulnerable to the exact TOCTOU issue in #770.
- It does not establish safe sidecar identity, locking, ACLs, backup/restore isolation, or production startup ordering.
- Its WAL/SHM/rollback-journal assertions check that the expected sidecar files exist during live transactions; they do not inspect the physical identity of the objects opened for those sidecars.
- The syscall wrapper only proves that the pinned VFS calls through the exposed hook. It does not validate `fstat()`/Windows file IDs, reject symlink/reparse points, detect hard-link aliases, or close any TOCTOU gap.
- It must never be imported by production code or used to open Core, Coordinator, Provider, Host ledger, dispatch ledger, or accepted-head databases.

## Why this step exists

The repository's Node floor is 22.13.0. The SQLite extension API can register a VFS as the process default and keep its code resident using `SQLITE_OK_LOAD_PERMANENTLY`. This probe verifies that the actual bundled SQLite engine used by `node:sqlite` honors that bootstrap path on both Windows and Linux before a real secure VFS is attempted.

## Next implementation gate

Replace the delegating probe with a real native VFS whose `xOpen` obtains and validates the actual OS object inside the same open operation, retains that handle for the SQLite file lifetime, and correctly handles WAL/SHM/journal/locking/crash recovery. The exact native implementation must then pass deterministic replacement/alias races and three-way-or-greater database-role separation on Windows and Linux. Until then, Issue #770 stays OPEN and all current pathname checks remain defense-in-depth only.

## Platform handle-introspection finding

A review of SQLite's public file-control API exposes an important Windows/POSIX asymmetry:

- Windows provides `SQLITE_FCNTL_WIN32_GET_HANDLE`, which returns the native HANDLE for an already-open SQLite file. A Windows wrapper can use that exact handle with `GetFileInformationByHandle` / `GetFileInformationByHandleEx` to inspect the object SQLite actually opened.
- SQLite's public file-control documentation does not define a corresponding POSIX file-descriptor getter. `SQLITE_FCNTL_FILE_POINTER` returns the `sqlite3_file` object pointer, not the OS descriptor. Reading a private `unixFile` struct layout would depend on non-public SQLite internals and is not an acceptable stable security contract.
- Therefore, a simple cross-platform shim over the default VFS is not enough: Windows may be able to validate the parent VFS handle, while POSIX needs a real VFS/backend that owns the descriptor acquisition or another supported native boundary.

References:
- SQLite file-control API: https://www.sqlite.org/c3ref/file_control.html
- Standard file-control opcodes (including WIN32_GET_HANDLE): https://www.sqlite.org/c3ref/c_fcntl_begin_atomic_write.html
- SQLite VFS/file object contract: https://www.sqlite.org/vfs.html

This is a source/API feasibility finding, not proof that the Windows handle path has been implemented or that a POSIX solution exists.


## Sidecar and native-open-hook probes

The current test also exercises SQLite's on-disk sidecar lifecycle:

- WAL and SHM files are required to exist while a writer and a concurrent reader transaction are open.
- A rollback-journal file is required to exist during an uncommitted DELETE-journal transaction.

These are filesystem-level lifecycle assertions. They do **not** prove that the VFS validated the physical identity of those sidecars; the probe still delegates their opens to the parent VFS.

The test asks the pinned parent VFS whether its native open syscall is exposed through `xGetSystemCall` (`open` on Linux, `CreateFileW` on Windows), then installs a counting wrapper and verifies that actual `node:sqlite` file opens pass through it. SQLite 3.47.2 source confirms that the Unix and Windows VFS implementations maintain overrideable syscall tables and route their native opens through those entries. This is a promising implementation seam for validating the actual descriptor/HANDLE returned by the OS open operation, but it is not yet a security guarantee.

Important constraint: SQLite documents `xSetSystemCall`/`xGetSystemCall`/`xNextSystemCall` as optional, variable interfaces intended to facilitate testing. Their availability and names must be verified against the exact SQLite build; unsupported or changed implementations must fail closed. The probe installs only a counting wrapper for feasibility testing; a production wrapper must validate the actual OS object before returning its descriptor/HANDLE to SQLite, reject unsafe aliases/reparse points, preserve locking and sidecar behavior, and be race-tested.

Pinned-source references:
- Unix VFS 3.47.2: https://github.com/sqlite/sqlite/blob/version-3.47.2/src/os_unix.c
- Windows VFS 3.47.2: https://github.com/sqlite/sqlite/blob/version-3.47.2/src/os_win.c
- SQLite VFS syscall-hook contract: https://www.sqlite.org/c3ref/vfs.html
