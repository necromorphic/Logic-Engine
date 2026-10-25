# Recalculation strategies and independent oracle (experimental)

**Status: isolated experiment; not production Core integration.** This harness does not read or mutate canonical world state, does not persist events, and does not replace the existing proposal/commit pipeline. It is intentionally placed under `experiments/` until its semantics and tests are reviewed and an application-layer integration point is implemented.

## Purpose

Exercise three strategies against a small dependency model:

- **A — full recomputation:** evaluate every node in dependency order. This is a control strategy, not an oracle.
- **B — incremental recomputation:** recompute the transitive closure of nodes whose *declared* dependencies intersect the changed input set.
- **C — guarded incremental:** run B, check caller-supplied domain invariants, and fall back to full recomputation when an invariant cannot be proven or an executed node reads an undeclared dependency.

The independent oracle is a separately authored literal expected projection in tests. Comparing B or C only to A is insufficient because A may share a semantic bug with the incremental strategies.

## Guarantees and limits

1. The harness rejects unknown declared dependencies and dependency cycles. It does not guess an evaluation order for cycles.
2. Reads made by an executed node are recorded through `ctx.read`. A read not listed in `dependsOn` is a contract violation.
3. Dynamic read tracking cannot detect a dependency in a node that incremental strategy B skipped. An independently authored invariant or oracle is needed to catch that stale result. This limitation is demonstrated by a negative test.
4. A failed invariant triggers C's full recomputation, but full recomputation does not repair an invalid dependency contract. The result is marked `needs_review` if the full run still observes an undeclared read or an invariant remains unproven.
5. An invariant is only as strong as its domain definition. Core must not invent world-specific semantic invariants or interpret an absent edge as proof of no dependency.
6. This harness does not model concurrency, revision leases, storage transactions, event rollback, side effects, or production performance. It must not be described as proving any of those properties.

## Run

Requires Node.js 22.13+ (same runtime floor as the repository):

```sh
node --test experiments/recalculation-oracle/harness.test.mjs
```

## Promotion gates

Before any production use, the Core integration must separately establish:
- immutable snapshot identity and a revision check at acceptance/commit;
- a constrained read API and enforced write/effect boundary;
- exact version identities for mechanics, modules, policies, and executable implementations;
- explicit handling for dynamic/conditional reads and negative dependencies;
- domain-owned invariants independent from the strategy under test;
- idempotent failure/retry and crash-recovery semantics;
- measured A/B/C costs and a documented, evidence-based fallback policy.

Until those gates are implemented and tested in Core, this experiment is evidence about the harness only.
