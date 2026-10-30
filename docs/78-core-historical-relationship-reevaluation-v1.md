# Historical Relationship evaluation — Core v1

## Supported operation

Core exposes a read-only application operation:

```js
engine.reevaluateRelationshipEvent(worldId, eventId, effectIndex = null)
```

It reads a valid committed event and evaluates only Relationship transition effects carrying a persisted `relationship-evaluation-input/v1` snapshot. With no effect index, all qualifying effects are evaluated. With an index, only that event effect is considered. The operation returns `status: evaluated` only when every selected snapshot is eligible and executed; otherwise it returns `status: unavailable` with per-effect reasons.

## Exact historical binding

A snapshot is eligible only when all checks pass:

- snapshot schema and evaluator input contract are supported;
- its originating event ID equals the event from which Core read it;
- its pinned World Pack ID/version equals the currently active World Pack ID/version;
- the exact rule module ID/version is present in the executable artifact allowlist;
- all seven v1 evaluator input fields are present;
- the embedded ruleVersion agrees with the module/version pin;
- the canonical input digest matches the persisted input;
- the executable artifact declares the same evaluator contract.

There is no latest-version fallback. Unknown or missing artifacts, malformed/incomplete snapshots, corrupt digests, event-binding mismatches, and World Pack mismatches fail closed.

## Read-only guarantee

The operation performs reads only. It does not commit events, update projections, increment world revision, append audit records, or rewrite the original event. The result is a new candidate for comparison with the committed effect, not a replacement decision.

## Current World Pack limitation

Core currently has no immutable executable World Pack artifact catalog. Therefore v1 conservatively permits historical evaluation only when the snapshot's exact World Pack pin matches the world's active World Pack pin. If the world has moved to another World Pack version, evaluation is unavailable even if the old declarative rules might still exist elsewhere. This avoids silently reconstructing old rules from mutable manifests.

## Explicit non-goals

- Projection rebuild remains separate and replays committed effects only.
- This operation does not rerun authorization, evidence discovery, subject-specific knowledge acquisition, Personality/NPC decisions, or upstream proposal logic.
- Meaning-changing migration is not implemented and must remain refused/unavailable pending a separately approved migration contract and tests.
- This API is an application/Core method; no public HTTP endpoint is introduced by this change.
