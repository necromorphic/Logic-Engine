# Historical Relationship evaluation — Core v1

## Supported operation

Core exposes a read-only application operation:

```js
engine.reevaluateRelationshipEvent(worldId, eventId, effectIndex = null)
```

It reads a valid committed event and evaluates only Relationship transition effects carrying a persisted `relationship-evaluation-input/v2` snapshot. With no effect index, all qualifying effects are evaluated. With an index, only that event effect is considered. The operation returns `status: evaluated` only when every selected snapshot is eligible and executed; otherwise it returns `status: unavailable` with per-effect reasons.

## Exact historical binding

A snapshot is eligible only when all checks pass:

- snapshot schema and evaluator input contract are supported;
- its originating event ID equals the event from which Core read it;
- its World Pack ID/version are present in the committed snapshot, and its exact declarative `dimensionRules` are part of the digest-protected evaluator input;
- the exact rule module ID/version is present in the executable artifact allowlist;
- all seven v1 evaluator input fields are present;
- the embedded ruleVersion agrees with the module/version pin;
- the canonical input digest matches the persisted input;
- the executable artifact declares the same evaluator contract.

There is no latest-version fallback. Unknown or missing artifacts, malformed/incomplete snapshots, corrupt digests, event-binding mismatches, and World Pack mismatches fail closed.

## Read-only guarantee

The operation performs reads only. It does not commit events, update projections, increment world revision, append audit records, or rewrite the original event. Core compares the re-evaluated candidate with the committed effect and reports whether they match. The result is diagnostic only, not a replacement decision.

## Historical World Pack handling

The current evaluator consumes declarative `dimensionRules`, not executable World Pack code. Those exact rules are persisted inside the committed evaluation-input snapshot and covered by its input digest, alongside the World Pack ID/version provenance. Historical evaluation therefore uses the captured rules even if the world has since moved to a different active World Pack version. The envelope digest detects inconsistent changes to the historical World Pack labels or captured rules. It is a SHA-256 consistency digest, not a signature or authentication guarantee against an actor able to rewrite the canonical database and recompute the digest. It never reads current manifests to reconstruct old rules. If the snapshot lacks the World Pack pin or the captured rules/digest are invalid, evaluation fails closed. A future evaluator that consumes executable World Pack behavior requires a new input/evaluator contract and an immutable artifact mechanism.

## Verification and refusal boundaries

- A committed event without a v2 input snapshot (including legacy events) returns unavailable; Core does not reconstruct missing historical inputs from current projections or manifests.
- A pinned module version without an exact executable artifact returns unavailable even if another/newer artifact is registered.
- The comparison result never mutates or replaces the committed event/effect.
- Meaning-changing migration remains unsupported and refused. No source→target semantic mapping has been approved or registered, so no migration is inferred or executed.

## Explicit non-goals

- Projection rebuild remains separate and replays committed effects only.
- This operation does not rerun authorization, evidence discovery, subject-specific knowledge acquisition, Personality/NPC decisions, or upstream proposal logic.
- Meaning-changing migration is not implemented and must remain refused/unavailable pending a separately approved migration contract and tests.
- This API is an application/Core method; no public HTTP endpoint is introduced by this change.
