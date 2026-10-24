# Core typed Relationship transition runtime slice

Status: merged into `main` through PRs #94–#96; exact-head Runtime tests passed on PR #96 head `79deb588e1f6321826dc3316085aaab6fdb010b7` (run #717). This is the first privileged canonical-write slice; it does not establish NPC/model-facing Relationship read or write authorization.

## Operation and authority

`POST /v1/worlds/:world_id/relationship-transitions` requires both the general API bearer and the separate `x-admin-token` credential. The body accepts only:

- `subject_id`, `target_id`: canonical entity IDs in the target world;
- `rule_module_id`, `rule_module_version`: exact immutable registered rule-module version;
- `patch`: a non-empty partial dimension map; a string sets a declared value, `{"operation":"clear"}` clears that dimension, omitted dimensions remain unchanged;
- `evidence_refs`: unique `event:<event_id>` references to valid earlier events in the same world;
- `expected_revision`, `expected_commit_sequence`: both parts of the snapshot freshness marker;
- `idempotency_key`.

The server constructs `executor_type: "admin_credential"`; the body cannot provide executor/provenance. This route is a privileged authoring operation, not an NPC action capability or a generic import/correction endpoint. The admin credential is the only accepted mutation authority in this slice.

## Versioned domain rules

The exact rule module must declare `validate_transition` in `operations` and include trusted, immutable `metadata.relationship_domain` matching the target world's `world_pack_id` and `world_pack_version`:

```json
{
  "world_pack_id": "example-pack",
  "world_pack_version": "1.0.0",
  "dimensions": {
    "trust": {
      "values": ["guarded", "high"],
      "allowClear": true,
      "transitions": [
        {"operation": "set", "from": null, "to": "guarded"},
        {"operation": "set", "from": "guarded", "to": "high"},
        {"operation": "clear", "from": "guarded", "to": null}
      ]
    }
  }
}
```

This metadata is supplied at rule-module registration through the existing admin-gated, immutable versioned registry. The pure evaluator validates the patch against those exact rules inside the canonical commit transaction. A missing or mismatched module, unsupported result, non-candidate result, stale cursor, invalid participant, or invalid evidence reference rejects the entire operation.

The operation treats evidence references as provenance inputs and validates their canonical event existence, world scope, validity, and ordering. The event also records those source event IDs in `caused_by`, so rollback of a source invalidates the dependent Relationship transition. The admin-authored operation is the authority to assert the transition; caller-supplied evidence status is not accepted. Unknown keys in `relationship_domain` are rejected, so alternative-support metadata cannot be silently ignored or approximated.

## Canonical lifecycle

- The transition is represented as `relationship.transition`, not entity attributes or `fact.set`.
- The relationship projection is event-derived and directed: subject → target never implies target → subject.
- A clear is persisted distinctly from an explicit domain value; unset is represented by no projection row.
- The effect can only be prepared through the dedicated Core method; generic event/proposal preparation rejects it.
- Event, relationship projection, world revision, audit and idempotency result share `SQLiteStore.tx()`.
- The store adds a directed-pair read-set reference so later transitions based on that pair can be invalidated if rollback changes the historical pair projection.
- Rebuild deterministically replays surviving valid transition events in commit order. Rollback invalidates dependent transitions when excluding an earlier transition changes the directed pair projection. The world revision advances on rollback even when commit sequence does not.

## Limits that remain

- This route is admin-only. It does not authorize an NPC/model to mutate relationships and does not add a general Relationship read API.
- The existing `/authorized-read` route remains self-identity-only; Relationship projection state must not be serialized to model/player consumers until a trusted recipient/purpose/field visibility policy exists.
- The first slice has no alternative independently sufficient evidence/support ledger. `relationship_domain` accepts only `world_pack_id`, `world_pack_version`, and `dimensions`; unsupported support-policy metadata is rejected. Conflicting/withheld/insufficient/unsupported candidate outcomes fail closed.
- A generic initial-import/author-correction endpoint is not introduced.
- Runtime readiness depends on exact-head CI and the real-path tests in `tests/relationship-transition-core.test.js`; the pure evaluator tests remain separate evidence.
