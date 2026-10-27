# Host complete-history inventory implementation contract

Status: implementation work item; fail-closed. This document defines Host-owned scope only. It does not create a Core contract or claim runtime coverage.

## Goal

Build an inventory of all Host-persisted chat artifacts and their observed versions, not just the currently loaded browser chat. Keep observed current state distinct from historical completeness.

## Required inventory domains

| Domain | Required evidence | Current disposition |
|---|---|---|
| Character chat files | Enumerated server-side files, stable Host-local artifact key, byte/content digest, observed locator, scan generation | Not implemented as a global inventory |
| Group chat files | Enumerated group chat files and group metadata, digest and locator | Not implemented as a global inventory |
| Message versions/swipes | Per-message and per-version identity, active selection, digest, parent/version ancestry where evidenced | Enrollment-forward only |
| Branches | Parent artifact identity, child artifact identity, parent snapshot/version digest, branch metadata digest | Mutable native references only; lineage unauthenticated |
| Imports | Source artifact digest, destination artifact identity, import operation ID, resulting persisted digest | Current selected UI routes reject while enrolled; direct server routes not proven covered |
| Deletes | Pre-delete inventory plus durable tombstone tied to artifact identity and operation | Selected paths guard/reject; all routes not covered |
| Backups/restores | Backup artifact digest, pre/post inventory, restore operation ID and lineage | Selected UI restore path rejects; direct restore/filesystem paths not covered |
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

## Acceptance states

- CURRENT_SNAPSHOT_NON_AUTHORITATIVE: a successful present-state scan only.
- INVENTORY_INCOMPLETE: enumeration or reconciliation has unresolved gaps.
- NON_READY: default for any incomplete, ambiguous, unauthenticated or unsupported condition.
- No READY state is defined by this Host-only work item.

## Explicit unknowns / blockers

- The pinned SillyTavern implementation has multiple client and server mutation paths; the current browser lifecycle bridge does not intercept all direct server API calls.
- No external anti-rollback trust anchor is currently established.
- Current files cannot reconstruct versions deleted before enrollment or before inventory capture.
- No approved contract presently establishes authenticated lineage for branch/import/restore.
- No live Android/Termux deployment evidence is claimed.

This work item is Host-only. It must not invent Core API/schema/source-authority semantics or modify Core, Memory Provider, NPC, or production wiring.
