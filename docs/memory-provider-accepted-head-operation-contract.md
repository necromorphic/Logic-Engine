# Provider accepted-head write, revocation, and recovery contract

Status: implementation candidate on PR #601. Exact-head CI evidence is recorded in that PR; this document does not authorize production activation.

## Purpose

Every durable Provider mutation that can affect Memory authorization, candidates, tombstones, or readiness must be ordered against the same coordinator used by Core and the dispatch Gateway. A process-local generation counter is not sufficient: it cannot prove that a second process, restored database, or pending external operation is current.

## Write protocol

For a file-backed Provider with accepted-head enforcement enabled, each real SQLite write follows this order while holding the shared coordinator lock:

1. Start `BEGIN IMMEDIATE`.
2. Capture the pre-write schema digest and a SQLite Session changeset.
3. Perform the actual Provider mutation.
4. Build an operation digest from domain, expected head, before/after schema digests, and changeset digest.
5. Ask the independently stored accepted-head authority to advance the Provider head to a pending operation.
6. Persist that exact head, operation ID, and operation digest in the same local SQLite transaction.
7. Commit the local transaction.
8. Finalize the authority operation as committed.

The Gateway takes the same coordinator lock when it validates Core/Provider evidence and durably writes `DISPATCH_STARTED`. Therefore, a Provider mutation that wins first is visible to the Gateway before dispatch-start. If the authority is unavailable or the checkpoint cannot be committed, the transaction aborts or leaves a pending authority operation; neither condition authorizes dispatch.

## Covered Provider operations

- Query-grant allow and revoke.
- Exact record-grant allow and revoke.
- Record persistence and derived index insertion.
- Index rebuild and state transitions.
- Reconciliation, including transitions away from `ready/current`.
- Raw-source tombstone and purge for legacy rows.

Raw capture, raw disclosure, active-version selection, and raw-derived-copy registration remain explicitly disabled. This work does not authorize retaining SillyTavern message text.

## Recovery behavior

On startup with accepted-head enforcement enabled, Provider does not create or repair a missing enrolled schema. It checks required schema objects and columns, then compares local and authority state.

- No pending operation and exact matching enrolled heads: startup may proceed.
- Authority has a pending Provider operation and local head, operation ID, and digest match exactly: startup finalizes that operation, then rechecks authority state.
- Pending operation does not exactly match local checkpoint, Core has a pending operation, authority is unavailable, or heads disagree: startup fails closed.
- A failed finalization after a successful local commit leaves the authority pending. Protected reads, further mutations, and Gateway dispatch remain blocked until recovery resolves that exact operation.

The recovery helper is an explicit operator action for a reviewed local checkpoint. It must not guess which backup is correct or advance authority from an arbitrary restored database.

## Dispatch race contract

The integration test uses the real file-backed Provider and Gateway, not a mock revoke callback:

- Source-version validation loss followed by real reconciliation must make Provider non-ready; dispatch is denied with zero upstream calls and no `DISPATCH_STARTED` row.
- Query revoke before dispatch-start: zero upstream calls and no ledger row.
- Exact record revoke before dispatch-start: zero upstream calls and no ledger row.
- Exact-version tombstone and purge advance the accepted Provider head.
- Recovery tests cover matching pending checkpoints and fail-closed mismatches.
- Reverse-order control: if Gateway commits `DISPATCH_STARTED` first, a later revoke cannot recall the already-started request; the barrier-controlled transport is called exactly once, with no automatic retry.

## Boundaries that remain

This contract proves code/test behavior for the candidate chain, not the installed production route. Before enabling Memory → NPC, the repository still needs exact deployment evidence that:

- the pinned SillyTavern request path uses Gateway as the sole upstream egress;
- the accepted-head authority database is independently protected from Core/Provider backups and restore rollback (including its own restore policy);
- service identities and ACLs protect authority, Core, Provider, coordinator, SQLite WAL/SHM, and backups;
- the full Host inventory/reconciliation gate is complete.

Until those deployment and cross-block gates are evidenced, Memory → NPC remains `DISABLED / FAIL-CLOSED`.
