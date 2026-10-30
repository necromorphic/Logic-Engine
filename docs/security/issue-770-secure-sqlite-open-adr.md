# ADR: secure SQLite open boundary for Issue #770

**Status:** proposed spike direction; NOT approved for production.
**Date:** 2026-10-30
**Baseline:** `main` `8c8b9059ae12af3a63e96eb7cb86851e12a6d925`
**Related:** [Issue #770](https://github.com/necromorphic/Logic-Engine/issues/770), [Issue #264](https://github.com/necromorphic/Logic-Engine/issues/264), [PR #750](https://github.com/necromorphic/Logic-Engine/pull/750).

## Decision summary

Do not treat pathname metadata checks (`stat`/`lstat`/`realpath`, including BigInt stats) as proof that the SQLite database subsequently opened is the same OS file object.

The current public `node:sqlite` `DatabaseSync` API accepts a database location, not an already-open OS file descriptor/handle. Consequently, the application cannot implement an atomic `open → fstat(handle) → DatabaseSync(handle)` sequence with the current API.

**The first implementation spike must test a dedicated SQLite native binding/VFS boundary that owns the SQLite connection and performs secure OS-handle acquisition inside SQLite's VFS `xOpen` path.** The native component must validate the actual opened handle before returning it to SQLite. It must not hand a checked pathname back to `node:sqlite` for a second open.

This is a direction for a bounded feasibility spike, not a claim that a VFS implementation already exists or is automatically secure. The spike must establish how the native component obtains and builds the SQLite engine on every supported platform, and whether the API surface can replace the repository's current `DatabaseSync` usage without changing transaction semantics.

If the spike cannot prove this end-to-end, keep Issue #770 open and keep protected startup/dispatch fail-closed. Do not silently fall back to path checks.

## Why a pathname wrapper is insufficient

A check such as:

1. inspect path A;
2. compare its device/inode/file ID with path B;
3. call `new DatabaseSync(pathA)`;

contains a race between steps 2 and 3. A writer with permission to mutate the containing directory can replace the directory entry after validation. Repeating the check immediately before or after the constructor only narrows the race; it does not bind the SQLite open to the checked object.

BigInt filesystem metadata prevents JavaScript number precision loss. It does not close the check/open race. This is the distinction between PR #750's valid precision fix and Issue #770's still-open security property.

## Native boundary requirements

The prototype must expose a deliberately small API. Suggested shape (names are illustrative, not an approved public API):

- open a database in a named security role;
- execute the repository-required SQL operations and prepared statements;
- begin/commit/rollback transactions;
- close the connection;
- report the validated file identity from the handle actually held by SQLite.

The native SQLite connection must be the same connection whose VFS performed secure open. No path-based reopen is permitted after validation.

The VFS implementation must:

- POSIX: open with no-follow semantics where supported, validate the opened descriptor with `fstat`, and retain that descriptor for the lifetime of the SQLite file object.
- Windows: open with reparse-point-safe flags, validate the opened HANDLE using handle-based file information, and retain that HANDLE. Path-based prechecks are not accepted as the identity proof.
- Reject unsupported filesystem semantics, missing identity fields, unstable identity, unexpected object type, aliases, and validation errors.
- Define and test WAL, SHM, rollback journal, temporary files, directory sync, locking, delete, rename, and crash-recovery behavior. Securely opening only the main DB file is not sufficient if SQLite sidecar files can be redirected or replaced.
- Avoid following symlinks/reparse points for every protected database and sidecar open unless an explicitly reviewed safe policy requires otherwise.
- Fail before schema writes, migrations, service listen, or dispatch if the secure-open guarantee cannot be established.

A custom VFS registered into a different SQLite library instance does not protect connections created by Node's built-in `node:sqlite`. The spike must demonstrate that the VFS is used by the exact SQLite engine executing the SQL. A separate native SQLite library/binding may be required; if so, document the compatibility and migration cost instead of claiming that registering a VFS in an unrelated addon is sufficient.

## Complete production database-role inventory

The implementation must inventory every production SQLite open and classify it. Initial current-main inventory:

| Role | Current owner / entry point | Required treatment |
|---|---|---|
| Core world DB | `src/storage/sqlite-store.js` | Secure VFS open; unique role identity |
| Coordinator DB | `src/storage/coordinator-lock.js` and Core bootstrap | Secure VFS open; reject alias with Core |
| Host version ledger | `src/application/host-version-digest-ledger.js` | Secure VFS open; reject alias with Core/Coordinator |
| Memory Provider DB | `src/application/sqlite-memory-provider.js` | Secure VFS open; separate role and ACL |
| Memory dispatch ledger | `src/security/memory-dispatch-gateway.js` | Secure VFS open; separate role |
| Accepted-head authority | `src/security/accepted-head-authority.js` | Secure VFS open; rollback-sensitive authority |
| Enrollment/recovery opens | `src/security/enroll-accepted-head-domain.js`, `src/security/recover-accepted-head-domain.js` | Must use the same verified open boundary; no direct path bypass |

The automated source guard `tests/security-sqlite-open-inventory.test.js` enumerates all JavaScript files under `src/` and fails if the set of production modules importing `node:sqlite` and constructing `DatabaseSync` differs from this inventory. Test-only and migration-only opens are excluded from the production set; they remain separately visible through the repository-wide search and must not be mistaken for production role owners.

## Required prototype and acceptance matrix

The spike is not complete until it runs against the exact native binary and SQLite engine used by the application.

### Identity and race cases

- Deterministically pause between path resolution and native `xOpen`, replace the directory entry, then resume. The connection must either bind to the original verified object or fail; it must never open the replacement under the original identity decision.
- Replace with a different regular file.
- Replace with a hard link to another protected role's DB.
- Symlink/reparse-point substitution.
- Parent directory rename/replacement.
- Missing file, directory, FIFO/device where supported, permission denial.
- Missing/zero/unavailable identity metadata.
- Concurrent opens of Core, Coordinator, Provider, Host ledger, dispatch ledger and accepted-head authority.
- Confirm no schema mutation and no listener/dispatch after every failed open.

### SQLite behavior

- Main DB reads/writes and transactions.
- WAL creation/open/write/checkpoint.
- SHM creation/open/locking.
- Rollback journal creation/open/delete.
- Process crash and restart recovery.
- Busy/locking behavior under concurrent processes.
- Close/reopen and backup/restore flows.
- Windows and Linux exact-head Runtime CI.

### Role isolation

For every role, prove that its open identity is not equal to any forbidden role identity. Include all roles listed above, including enrollment/recovery paths. A test that only compares path strings is insufficient.

### Independent review

Security review must inspect the native code, VFS registration, actual SQLite library linkage, OS handle lifetime, sidecar handling, race tests, and packaged binary provenance. Exact-head Windows and Linux CI must pass after review findings are resolved.

## Rollback and deployment boundary

A secure-open VFS does not by itself solve accepted-head rollback, service ACLs, backup restore, or dispatch ordering. Keep these as separate gates:

- accepted-head authority must be protected from replacement/rollback by Provider and Gateway identities;
- restore of stale state must be detected before protected disclosure;
- one shared serialization boundary must order revocation/source invalidation against the actual final transport handoff;
- ambiguous post-dispatch-start delivery must not be automatically retried.

Do not combine those independent guarantees into a single claim that “VFS solved Security”.

## Explicit non-goals

This ADR does not authorize:

- production Memory→NPC activation;
- raw Host message-text retention;
- new public Core/Provider APIs or schemas;
- changes to canonical state ownership;
- replacing the Core proposal → approval → commit path;
- deployment ACL changes on the user's machine;
- merging PR #750 or any stacked PR.

## Exit criteria for the spike

1. Native binding/VFS can be built and loaded on supported Windows and Linux targets.
2. Evidence proves that the VFS is used by the same SQLite engine executing SQL.
3. Secure open validates and retains the actual OS file object.
4. Main DB and all SQLite sidecars are covered.
5. Race/alias/identity-failure matrix passes for every role.
6. The minimal native API preserves all repository-required SQLite behavior.
7. Independent Security review accepts the exact implementation HEAD.

Until all seven are satisfied, Issue #770 remains OPEN; Core and Security remain BLOCKED; Memory→NPC remains DISABLED / FAIL-CLOSED.
