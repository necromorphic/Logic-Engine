# Core Memory consistency and reconciliation contract

Status: proposed. This contract does not assert that Core currently emits a durable outbox or a complete source-change stream.

## 1. Authority and cursors

Core remains authoritative for canonical state and event validity. Memory records and indexes are projections. Where available, capture `world_id`, source event/fact IDs, `world_revision`, and `commit_sequence` from the same consistent Core snapshot. These cursors are distinct: game time is not a unique history cursor, revision is not necessarily a commit sequence, and neither alone proves causal completeness.

A record without a verifiable source cursor may still be stored as external evidence, but must not be represented as a verified snapshot-derived record.

## 2. Source-change classes

Reconciliation must distinguish:
- new canonical event or fact;
- source event rollback/retraction/invalidation;
- source record corrected or replaced;
- world revision advanced without a relevant source change;
- duplicate/replayed source notification;
- index update failed after authoritative record commit;
- source no longer resolvable or access to source no longer permitted.

A source disappearing from a projection does not by itself prove the historical event never existed. Preserve the difference between canonical validity, historical audit, and current projection membership.

## 3. Delivery and atomicity

The implementation audit must establish whether Core exposes a transactionally reliable outbox/change log. If it does, consume it idempotently using stable source event identity and delivery cursor. If it does not, choose and document a recoverable reconciliation strategy (for example, polling a canonical cursor plus periodic full comparison); do not pretend that an in-memory callback guarantees delivery across crashes.

Do not update canonical state and memory in one cross-subsystem transaction unless the existing architecture provides a justified transaction boundary. Prefer:
1. commit authoritative memory record/version and its audit atomically;
2. enqueue or mark index work durably in the same local transaction;
3. update external search indexes asynchronously and idempotently;
4. mark index generation/cursor only after successful application;
5. rebuild from authoritative records after gaps or corruption.

Whether the current SQLite store can support the required transaction/outbox pattern must be proven from the implementation before adding schema.

## 4. Rollback handling

On canonical source rollback, locate records derived from or dependent on that source. Mark them stale/quarantined pending re-evaluation; do not silently delete them or keep them presented as active evidence. If a record has independent sources, retain the record only when the typed source policy can show that sufficient valid support remains. Otherwise preserve the conflict/uncertainty and require recomputation or review.

Memory must not execute Core rollback. It reacts to Core's authoritative result and maintains its own record/index lifecycle.

## 5. Revisions and stale reads

Retrieval must expose or internally enforce a freshness boundary. If source reconciliation lags, either return an explicit stale/partial status or fail a caller that requires current canonical evidence. Never label a record current solely because its embedding exists.

For snapshot-derived records, store the snapshot cursor used during derivation. When deriving a new summary, capture one consistent source set/cursor and commit the summary with its complete source manifest. If the sources change before commit, retry or mark the result stale; do not mix revisions invisibly.

## 6. Recovery and invariants

Required invariants:
- authoritative records survive index loss;
- index rebuild does not change source content, lifecycle, provenance, or canonical state;
- replaying a source-change notification has no duplicate effect;
- a failed index update remains discoverable as pending work;
- source invalidation is auditable and propagates to derived records;
- a missing notification can be repaired by reconciliation;
- no recovery operation increases epistemic status or silently resolves conflicts.