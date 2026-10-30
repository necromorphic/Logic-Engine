# SQLite VFS registration probe — NOT a security implementation

This probe is a narrow feasibility test for Issue #770.

## What it proves

On the exact Node.js 22.13.0 runtime used by Logic-Engine, it tests whether:

1. A temporary in-memory `DatabaseSync({ allowExtension: true })` can load a SQLite extension.
2. The extension can register a process-default VFS through the SQLite API table supplied by Node.
3. Returning `SQLITE_OK_LOAD_PERMANENTLY` keeps the extension loaded after the bootstrap connection closes.
4. Subsequent ordinary `new DatabaseSync(filePath)` connections route their main-database `xOpen` through that registered VFS.
5. The wrapper can delegate normal SQLite I/O and WAL operations to the parent VFS without replacing the underlying `sqlite3_file` methods.

The C probe increments a process-local counter after the parent VFS successfully opens a main database. A SQL function exposes that counter to later connections.

## What it explicitly does NOT prove

- It does not validate the opened file's device/inode/file ID or Windows HANDLE identity.
- It does not prevent pathname replacement, symlink/reparse-point substitution, hard-link aliasing, or directory races.
- It delegates `xOpen` to the default VFS and therefore remains vulnerable to the exact TOCTOU issue in #770.
- It does not establish safe sidecar identity, locking, ACLs, backup/restore isolation, or production startup ordering.
- It must never be imported by production code or used to open Core, Coordinator, Provider, Host ledger, dispatch ledger, or accepted-head databases.

## Why this step exists

The repository's Node floor is 22.13.0. The SQLite extension API can register a VFS as the process default and keep its code resident using `SQLITE_OK_LOAD_PERMANENTLY`. This probe verifies that the actual bundled SQLite engine used by `node:sqlite` honors that bootstrap path on both Windows and Linux before a real secure VFS is attempted.

## Next implementation gate

Replace the delegating probe with a real native VFS whose `xOpen` obtains and validates the actual OS object inside the same open operation, retains that handle for the SQLite file lifetime, and correctly handles WAL/SHM/journal/locking/crash recovery. The exact native implementation must then pass deterministic replacement/alias races and three-way-or-greater database-role separation on Windows and Linux. Until then, Issue #770 stays OPEN and all current pathname checks remain defense-in-depth only.
