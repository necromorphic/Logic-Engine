# Core — historical Relationship evaluator contract proposal

**Issue:** [#146](https://github.com/necromorphic/Logic-Engine/issues/146)  
**Status:** Core-owned design proposal for review; not an approved runtime API or executable implementation.  
**Scope:** Historical semantic re-evaluation only. Projection rebuild and meaning-changing migration remain separate operations.

## 1. Current evidence and non-goals

The typed Relationship transition stores `rule_module_id` and `rule_module_version` on the committed effect. The projection rebuild path can reconstruct the materialized Relationship state from already-committed effects and preserve their historical pins. PR #148 tests that behavior when the exact manifest has been removed and a newer version exists.

That is **projection reconstruction**, not semantic re-evaluation. The current `RuleModuleManifest` is metadata/compatibility declaration, not executable evaluator logic. Registering a manifest or finding a version does not prove that the historical transition can be re-evaluated under that version.

This proposal adds no runtime API, storage schema, evaluator registry, migration path, or authorization rule. It does not authorize a change to canonical event semantics.

## 2. Operation classes must stay distinct

| Operation | Purpose | Required behavior |
|---|---|---|
| Projection rebuild | Reconstruct projections from already-committed canonical effects | Consume the committed effect under existing projection rules; preserve the originating event and exact rule pin. Do not resolve a newer module to reinterpret the effect. |
| Historical semantic re-evaluation | Re-run the original domain decision under the original pinned semantics | Unsupported until an executable evaluator contract is approved and implemented. Must select the exact module ID and version. |
| Explicit migration | Deliberately change the meaning/version of historical state | Unsupported until a separate domain-approved migration contract, API, audit semantics, and tests exist. Never run implicitly during replay or rebuild. |

## 3. Proposed evaluator contract — decisions required before implementation

The implementation must provide a deterministic evaluator capability bound to an immutable pair `(rule_module_id, rule_module_version)`. The existing manifest may describe compatibility and identify the module, but it must not be treated as the evaluator itself.

Before code is written, Core and Relationships must agree on these contract points:

1. **Input:** the exact canonical transition request/effect, pinned rule-module identity/version, and the minimum prior-state/domain inputs required by the domain evaluator. Inputs must be explicit and immutable for the evaluation; do not read current mutable state implicitly.
2. **Version resolution:** exact ID plus exact version only. No latest-version fallback, semver guessing, compatibility substitution, or silently selecting a World Pack version.
3. **Output:** a typed decision distinguishing a valid evaluation from a rejected/incompatible/unavailable evaluation. The output must be sufficient for Core to compare the re-evaluated decision with the committed effect without conflating evaluation with persistence.
4. **Determinism:** same evaluator version and same canonical inputs produce the same normalized result. Nondeterministic inputs must be captured explicitly or excluded.
5. **Failure behavior:** missing, unknown, incompatible, malformed, or non-executable pinned modules fail closed. Failure must not mutate canonical events, world revision, projections, or audit state.
6. **Compatibility:** the evaluator must declare the Core contract version it supports. Compatibility checks must be explicit; a manifest's presence alone is not proof that its evaluator can execute.
7. **Provenance:** diagnostics must identify the exact pinned module/version and failure class without leaking protected source content. The original event remains the authority for what was committed.
8. **Persistence boundary:** evaluation is pure/read-only. Any future write or repair is a separate canonical operation with its own authorization, event, audit, idempotency, and transaction tests.

These are proposed acceptance requirements, not an assertion that the named interface or fields currently exist.

## 4. Fail-closed matrix

| Condition | Historical semantic re-evaluation | Projection rebuild | Migration |
|---|---|---|---|
| Exact pinned executable evaluator available and compatible | May evaluate once the contract and implementation are approved | Rebuild from committed effects; preserve pin | Not implied |
| Pinned version missing; newer version registered | Reject as unavailable; never substitute newer version | Preserve event's pin; rebuild only from committed effect if supported by the existing projection path | Refuse |
| Pinned version unknown or incompatible with Core contract | Reject before any mutation | Do not reinterpret committed semantics; preserve stored pin | Refuse |
| Manifest exists but evaluator implementation is absent | Reject as non-executable | Manifest lookup is not required to reinterpret the committed effect; no semantic reevaluation claim | Refuse |
| Inputs required for deterministic evaluation are incomplete | Reject as insufficient input | Rebuild only from the already-committed canonical effect | Refuse |
| Meaning-changing version change requested | Not an implicit re-evaluation | No silent upgrade | Require a separate explicit, approved migration contract |

## 5. Required tests for a future executable implementation

- Exact historical evaluator selected when both pinned and newer versions are registered.
- Missing pinned evaluator fails even if a newer version is available.
- Unknown and Core-incompatible pinned versions fail closed.
- Manifest-only registration does not masquerade as executable evaluator availability.
- Identical pinned inputs yield identical normalized decisions.
- Missing deterministic inputs are rejected.
- Every evaluation failure leaves canonical event history, world revision, projection, and audit unchanged.
- Projection rebuild is tested independently and preserves the committed effect's original pin.
- Migration requests are refused while migration remains unsupported; no implicit upgrade occurs.

A pure evaluator unit test or a projection rebuild test alone does not satisfy the historical semantic re-evaluation acceptance criteria.

## 6. Relationship to Personality acceptance

- **PERS-SEM-024:** deterministic behavior for identical pinned inputs/version. This proposal describes the prerequisites; it does not claim implementation.
- **PERS-SEM-029:** meaning-changing compatibility/migration. This remains a separate, unsupported operation until an explicit migration contract and executable path are approved.

## 7. Closure boundary

This proposal can be reviewed and refined without implementing a speculative API. After Core and Relationships agree on the evaluator input/output and executable-module ownership, a separate implementation change can add the runtime capability and real-path tests. Until then, document historical semantic re-evaluation and migration as unsupported; keep the already-tested projection-only rebuild claim narrow.
