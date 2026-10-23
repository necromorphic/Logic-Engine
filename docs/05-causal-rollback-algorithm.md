# 05. Causal rollback algorithm and acceptance model

Status: target architecture and acceptance model. The current runtime implements only the bounded event-root rollback subset documented in docs/21; this document is not a claim that message/generation rollback, NPC knowledge, process, task, delivery, or StoryBeat recomputation is implemented.

## 1. Goal

When a user deletes or replaces a message/generation, the current world should behave as though effects rooted solely in that generation are no longer valid. Preserve independent causes and independent events. Keep audit history append-only and world_revision monotonic.

This is stronger than adding an inverse effect while leaving dependent consequences valid.

## 2. Required causal metadata

For each accepted event/effect:
- source `turn_id`, `generation_id`, and host `source_message_id` when available;
- `caused_by[]`: direct causes;
- `depends_on[]`: state/event conditions required for continued validity;
- `read_set[]`: state facts that materially influenced the decision;
- `produces[]`: facts, knowledge, processes, tasks or other effects created;
- `source_refs[]`: evidence supporting claims;
- `validity` and optional `compensated_by[]`.

The graph must distinguish direct cause, logical dependency, evidence, and mere temporal order. A later event is not dependent only because it happened later.

## 3. RollbackPlan

A plan is computed before mutation and includes:
- rollback ID and target generation/message;
- root event IDs;
- causally reachable descendants;
- records whose read-set intersects invalidated facts;
- knowledge records with their source alternatives;
- process/plan/task stages requiring invalidation or recomputation;
- story beats whose current postconditions may no longer hold;
- delivery records to mark rolled_back, superseded or orphaned;
- independent events that must remain;
- unresolved conflicts and why they cannot be auto-resolved.

The plan must be inspectable and deterministic for the same committed state and rollback target.

## 4. Classification of affected records

For each affected item, choose one:
- **invalidate**: no valid cause/source remains;
- **preserve**: independent valid cause remains and invariants still hold;
- **recompute**: outcome depended on changed state and can be safely recalculated;
- **conflict**: automatic resolution would rewrite an independent confirmed event or invent a new fact;
- **review**: required provenance is missing or ambiguous.

Knowledge with three sources and one removed remains if the two other sources are valid and sufficient. If all sources are invalid, retract the knowledge record. If sources conflict, mark disputed instead of inventing certainty.

A process with partial progress is not automatically reset or preserved. Recompute each stage from valid prerequisites and effects. Preserve independently caused progress; invalidate only progress dependent on the removed branch. If exact reconstruction is impossible, create a conflict/review record.

## 5. Apply phase

1. Resolve target identifiers; do not rely on text hash alone.
2. Build and validate the rollback plan against the latest world revision.
3. Compute affected current projections without invalidated effects.
4. Re-evaluate facts with multiple sources, knowledge, process stages, task statuses and StoryBeat postconditions.
5. Detect conflicts with independent confirmed events.
6. In one atomic commit, append rollback operation/audit, mark affected events invalid/retracted, record compensations/recomputations, update current projection/checkpoint, store idempotency result and increment world_revision.
7. Keep game_time unchanged globally. Process time-sensitive consequences against current game_time and valid branch state.
8. Rebuild derived indexes and projections asynchronously or via durable jobs; they must not expose stale facts as authoritative.
9. On a new swipe/re-generation, create a new generation branch and calculate new outcomes from the valid post-rollback state.

## 6. The non-retcon boundary

Rollback must not silently erase a truly independent event merely because it conflicts with the branch being removed. Example: if another NPC independently learned a secret from a separate valid source, that knowledge survives. If an independent event cannot coexist with the new state, create a ConflictRecord for author resolution instead of making up a reconciliation.

This does not weaken the user-facing requirement: consequences that exist only because of the deleted message are not allowed to remain canonically active.

## 7. Acceptance tests

- RB-001: deleting a message before commit leaves no world effect.
- RB-002: deleting a committed event retracts all exclusively dependent direct effects.
- RB-003: an independent later event survives if it remains valid under current state.
- RB-004: knowledge from the only invalidated source is retracted.
- RB-005: knowledge with multiple sufficient sources remains if at least one valid sufficient source survives.
- RB-006: knowledge with conflicting sources becomes disputed where policy requires.
- RB-007: process progress caused only by invalidated prerequisites is recalculated; independent progress survives.
- RB-008: a StoryBeat whose current postcondition is false is no longer currently complete, while audit retains its earlier completion.
- RB-009: repeating a rollback request with the same idempotency key and identical request returns the stored result; reusing that key with a different request is rejected. A new key for an already retracted root is a no-op and does not increment world_revision.
- RB-010: delivery retry does not reapply a world effect.
- RB-011: unavailable host message identity causes explicit review, not guessed rollback.
- RB-012: world_revision increases; game_time does not rewind.
- RB-013: stale projections cannot reveal retracted knowledge after rollback.
- RB-014: unrelated world branch and another world's records remain unchanged.
