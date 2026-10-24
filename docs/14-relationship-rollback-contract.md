# Relationship rollback dependency granularity

Status: adopted compatibility contract for the current Core 1.x Relationship Transition slice.

## Current rule

Relationship transition read/write dependencies are scoped to the **directed participant pair** (subject → target), not to individual dimensions within the pair. The persisted reference currently encodes the pair only. The projection comparison used by rollback compares the aggregate pair projection.

Consequently, when transition A changes trust on A→B and a later transition B changes affinity on that same directed pair, rollback of A may invalidate B even though B's patch names a different dimension. This behavior is intentional under the current pair-level dependency contract; dimensions on the same pair are not currently promised to be causally independent.

## Why this is not silently changed

Dimension-level dependency references would change the identity and granularity of persisted read/write dependencies and rollback semantics. Introducing that behavior without an explicit versioned contract could cause old events to replay or roll back differently. It is not a safe local refactor.

## Verification

- Same-dimension test: a later trust transition on the same directed pair is invalidated when its earlier trust transition is rolled back.
- Cross-dimension characterization: a later affinity transition on the same directed pair is also invalidated when the earlier trust transition is rolled back.
- Rebuild verifies the final pair projection reflects only surviving valid events.

## Future change requirements

Dimension-level isolation is a possible future contract, not part of the current one. Before adopting it, specify canonical dimension-reference encoding, legacy persisted-reference handling, multi-dimension patch semantics, and causal acceptance tests. Any migration must preserve replay/rollback compatibility and the audit trail.
