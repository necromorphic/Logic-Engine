# Host complete-history inventory implementation contract

Status: implementation work item; fail-closed. This document defines Host-owned scope only. It does not create a Core contract or claim runtime coverage.

## Goal

Build an inventory of all Host-persisted chat artifacts and their observed versions, not just the currently loaded browser chat. Keep observed current state distinct from historical completeness.

## Required inventory domains

| Domain | Required evidence | Current disposition |
|---|---|---|
| Character chat files | Enumerated server-side files, stable Host-local artifact key, byte/content digest, observed locator, scan generation | Current server-side snapshot scanner implemented; non-authoritative and not historical |
| Group chat files | Enumerated group chat files and group metadata, digest and locator | Current server-side snapshot scanner implemented; non-authoritative and not historical |
| Message versions/swipes | Per-message and per-version identity, active selection, digest, parent/version ancestry where evidenced | Enrollment-forward only |
| Branches | Parent artifact identity, child artifact identity, parent snapshot/version digest, branch metadata digest | Mutable native references only; lineage unauthenticated |
| Imports | Source artifact digest, destination artifact identity, import operation ID, resulting persisted digest | Candidate server middleware maps listed import routes when a local enrollment registry exists; lineage and bypass resistance unproven |
| Deletes | Pre-delete inventory plus durable tombstone tied to artifact identity and operation | Candidate middleware records pre/post snapshots for mapped routes; per-artifact tombstone semantics and registry tamper resistance unproven |
| Backups/restores | Backup artifact digest, pre/post inventory, restore operation ID and lineage | Backup-delete route mapped in candidate middleware; restore and filesystem paths remain uncovered; lineage unproven |
| External changes | Full rescan and difference against prior trusted inventory | Detectable only relative to an available checkpoint; no independent trust anchor |
| Pre-enrollment/deleted history | External archival evidence, if any | UNKNOWN_UNRECOVERABLE absent such evidence |

## Non-negotiable invariants

1. A scan of currently present files is a CURRENT inventory snapshot, not proof of all-time history.
2. A missing file is not automatically a deletion event. It may mean rename, move, inaccessible storage, partial scan, or actual deletion. Emit a tombstone only when the operation and affected artifact identity are observed and persisted.
3. Never mark a scan complete if enumeration failed, a directory was skipped, a file could not be read, or the source changed during the scan.
4. Never treat a local hash chain and local head stored in the same rollback domain as an independent trust anchor.
5. Never synthesize parent-child branch lineage from mutable branch labels alone.
6. Preserve raw-message retention policy: inventory records contain identities, digests, locators, operation metadata and lineage evidence only, not message text.
7. Any unsupported route, unknown artifact, digest mismatch, duplicated identity, incomplete scan or failed durable write yields NON_READY.
8. Do not upgrade Host capture/reconciliation or enable production Memory→NPC from an inventory scan alone.

## Implementation sequence

### H1 — Route and artifact enumeration
- Enumerate the actual pinned SillyTavern server storage roots for character chats, group chats, metadata and backup artifacts.
- Add a server-side scanner over persisted artifacts; do not depend on the browser's currently loaded getChat() array.
- Record scan start/end, enumerated roots, counts, per-artifact digest and all scan errors.
- Treat scan output as CURRENT_SNAPSHOT_NON_AUTHORITATIVE until complete route and storage coverage is verified.

### H2 — Lifecycle journal integration
- Route every supported create/edit/swipe/select/delete/rename/import/export/copy/branch/restore/migration path through a server-side pre/post operation boundary.
- Capture affected artifact identities before mutation and persisted digests after successful persistence.
- Use durable idempotency keys; repeated operation IDs with different payloads fail closed.
- If a path cannot be safely wrapped, reject that operation for enrolled/managed artifacts rather than relying on browser-only guards.

### H3 — Reconciliation and tombstones
- Compare each complete server-side scan with the prior inventory.
- A disappeared artifact becomes MISSING_UNRESOLVED, not a deletion tombstone, unless an observed deletion operation supplies evidence.
- Reconcile renames/moves only where stable identity evidence exists; otherwise report ambiguous identity and remain NON_READY.
- Record restored/copy/import artifacts as new observed instances until approved lineage evidence exists.

### H4 — Proof and acceptance
- Exact pinned-source route matrix and tests for direct API calls, not only helper invocation.
- Failure injection for unreadable files, partial enumeration, interrupted scans, failed writes, concurrent mutation, restart/replay, duplicate operation IDs, import/restore, branch/copy and deletes.
- Verify every route against the exact pinned source revision.
- Test desktop browser persistence and Android/Termux separately.
- Require external anti-rollback authority before treating the inventory as authoritative.


## Pinned SillyTavern mutation coverage audit and server journal

Audited against SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

The Host patch now adds explicit server-side enrollment at `POST /api/logic-engine/host-lifecycle/enroll` and mounts a mutation middleware before the private endpoint routers. Once at least one conversation is explicitly enrolled for a user, the middleware covers the following direct API mutation routes:

| Source | Routes intercepted | Important side effects |
|---|---|---|
| `src/endpoints/chats.js` | `POST /api/chats/save`, `/rename`, `/delete`, `/group/import`, `/import`, `/group/delete`, `/group/save` | Chat writes, rename copy/unlink, imports, group-chat changes, and save-triggered backup creation/pruning |
| `src/endpoints/characters.js` | `POST /api/characters/rename`, `/delete`, `/import`, `/duplicate` | Character rename may copy/remove an entire chat directory; character deletion may cascade-delete chats |
| `src/endpoints/groups.js` | `POST /api/groups/create`, `/edit`, `/delete` | Group metadata writes and cascaded group-chat deletion |
| `src/endpoints/backups.js` | `POST /api/backups/chat/delete` | Backup deletion |
| `src/endpoints/data-maid.js` | `POST /api/data-maid/delete` | Deletion of files selected by the Data Maid cleanup report |

The middleware operates at the Express app layer before these routers, so direct API calls do not bypass it. It is account-scoped after the first explicit enrollment: all allowlisted mutation routes for that user are journaled, not only the currently selected chat. This deliberately over-captures account changes rather than trying to infer affected files from client-supplied names.

For each intercepted operation it requires a complete persisted-state scan and a durable `intent` record before calling the route handler. It holds the response while it scans the resulting state and durably appends an `outcome` record containing changed artifact IDs and before/after SHA-256 values, without message text. The local JSONL ledger has a hash chain and fsyncs each append. A pending intent, malformed chain, incomplete pre/post scan, or failed durable append prevents subsequent managed mutations and returns a sanitized failure where possible. The tests exercise direct middleware invocation, persisted before/after changes, idempotent identity registration, and fail-closed recovery.

The snapshot endpoint enumerates four server-supplied roots: `directories.chats`, `directories.groups`, `directories.groupChats`, and `directories.backups`. Group metadata and group-chat JSONL are separate roots and both are required.

This closes the known browser-only bypass for the listed routes in the pinned patch, but it does **not** establish an authoritative all-time history:
- The journal is local to the same user storage/rollback domain; the hash chain is not an external anti-rollback trust anchor.
- A process or storage failure after the underlying mutation but before durable outcome leaves an unresolved intent and blocks later managed mutations; it cannot roll back the underlying filesystem mutation.
- Character/group renames, imports, copies, restores, and Data Maid deletion are recorded as observed artifact changes; this patch does not claim authenticated parent-child lineage or infer semantic identity across those changes.
- Existing history and versions deleted before enrollment cannot be reconstructed.
- Coverage is limited to the explicit allowlist above; every newly introduced or discovered route that can mutate these roots must be added to the allowlist or explicitly rejected for managed users.
- CI proves pinned patch application, syntax, and repository tests only. It is not live deployment evidence and does not prove Android/Termux durability.

## Acceptance states

- CURRENT_SNAPSHOT_NON_AUTHORITATIVE: a successful present-state scan only.
- INVENTORY_INCOMPLETE: enumeration or reconciliation has unresolved gaps.
- NON_READY: default for any incomplete, ambiguous, unauthenticated or unsupported condition.
- No READY state is defined by this Host-only work item.

## Explicit unknowns / blockers

- The candidate server middleware maps the listed chat/group/backup/Data Maid mutation routes, but complete coverage of indirect filesystem effects, restore/migration paths, and every server entry point is not proven.
- No external anti-rollback trust anchor is currently established.
- Current files cannot reconstruct versions deleted before enrollment or before inventory capture.
- No approved contract presently establishes authenticated lineage for branch/import/restore.
- No live Android/Termux deployment evidence is claimed.

This work item is Host-only. It must not invent Core API/schema/source-authority semantics or modify Core, Memory Provider, NPC, or production wiring.
