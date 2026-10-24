# Memory ↔ NPC 1.4 cross-review addendum

**Owner:** Memory  
**Related:** Issue #142, NPC Issue #149, NPC PRs #150/#151, Core decision register PR #133, merged Core evaluator-contract proposal PR #153, merged Relationships PR #145.  
**Status:** Documentation-only handoff. This does not approve an API/schema or enable production Memory → NPC.

## Evidence reviewed

The NPC-only replacement PRs are correctly scoped: #150 changes only `tests/npc-memory-candidate-eligibility.test.js`; #151 changes only `docs/56-npc-memory-boundary-acceptance-matrix.md`. Their reported exact-head Runtime CI runs #901 and #902 passed. These establish bounded oracle/matrix coverage, not a real Memory source adapter or production consumer. The mixed-scope PRs #138/#139 are not treated as clean NPC-owned evidence.

The NPC oracle checks supplied candidate metadata. Supplied `current`, `ready`, `allow`, world/version and lineage values are not independently authenticated by the oracle. A passing oracle test does not prove the labels correspond to authoritative source state, a trusted authorization decision, or a complete index scan.

## Remaining contract gaps and closure tests

| Gap | Decision owner | Minimum closure evidence |
|---|---|---|
| Authoritative source version, validity and lineage | Core + Memory + host adapter owner | A real adapter test resolves the source in the requested world, validates the exact version and supporting lineage, and rejects missing/cross-world/stale references. |
| Rollback and source reconciliation | Core + Memory | A real-path test changes `world_revision` without increasing `commit_sequence`, then proves affected records and dependent summaries are invalidated or reconciled. A sequence-only scan is insufficient. |
| Access and revocation propagation | Core + host adapter; Memory owns derived-content behavior | Trusted read-path tests deny unauthorized cross-subject/cross-world access and prove revoked source content is withheld from exact-ID reads, snippets, counts, pagination and dependent summaries. |
| Index health vs source freshness | Memory + host/index owner | Tests distinguish healthy-but-stale, rebuilding, unavailable and failed index states from complete-empty and from authorization denial. Incomplete scans cannot advance a current/completed marker. |
| Restart, checkpoint and persistence/audit ownership | Memory + Core + host/index owner | Interrupt a real reconciliation after partial work, restart and replay twice; prove idempotent recovery and no premature completion marker. Explicitly name the authoritative commit and audit boundaries; do not assume cross-store atomicity. |
| Retrieval, delivery/receipt, acquisition and belief | NPC + Core + host adapter; Memory supplies source evidence | Separate real-path tests for each supported transition. If the host has no observable receipt signal, receipt remains unconfirmed; retrieval/context inclusion is not delivery, acquisition or belief. |

## Result-status semantics

The status mapping in PR #144 remains a semantic proposal, not an approved wire enum. Complete-empty is valid only after the declared scope and required checks finish. Timeout, partial/truncated work, rebuilding, unavailable index, unknown source/version, incomplete lineage and failed reconciliation must not be collapsed into complete-empty. Authorization/non-disclosure takes precedence over candidate details.

## Version-semantics boundary

Merged Core PR #153 specifies prerequisites for a future historical Relationship evaluator but does not implement Memory reconciliation or host/index integration. Merged Relationships PR #145 keeps historical semantic re-evaluation unsupported pending approval of an executable evaluator contract, and migration separate pending an explicit domain-approved path. These version-semantics gates do not close the Memory source-lifecycle gates above.

## Gate

PR #144 remains documentation/test-traceability only until Core, Memory and the host/index owner resolve source identity/version/lineage, authoritative currentness, rollback/restart recovery, and persistence/audit ownership. NPC confirms the consumer contract and real-path tests. Production Memory → NPC remains disabled until those decisions and tests are complete.
