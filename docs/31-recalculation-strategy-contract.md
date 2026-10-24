# Recalculation strategy contract — proposal for Core review

**Status: proposed, not yet an accepted architecture decision.** This document records the smallest safe integration contract suggested by the current Core boundaries and the independent experiment in `experiments/recalculation-oracle/`. It does not claim that a production executor exists.

Related contracts:
- `docs/21-stage1-causality-contract.md` — declared causality is not proof of causal completeness.
- `docs/30-stage1.3-mechanic-execution-boundary.md` — snapshot-bound, read-only mechanic evaluation and proposal handoff.
- `docs/25-universal-mechanics-system.md` and `docs/26-mechanics-contracts.md` — mechanic registry and lifecycle boundary.
- Issue #226 — production executor and strategy seam.

## 1. Proposed invariant

An evaluation result is valid only for the exact immutable snapshot, active mechanic set, pinned definitions, and trusted policies used to compute it. Evaluation is read-only. A successful result is a validated proposal, never a canonical commit.

Minimum snapshot identity:
- `world_id`;
- `world_revision`;
- `commit_sequence`;
- exact enabled `MechanicInstance` identities and pinned template versions;
- exact module contract versions and host-allowlisted implementation identities;
- context-manifest identity and hashes, when a generation manifest is used;
- trusted policy versions.

If any relevant identity changes before proposal acceptance/commit, reject the result as stale or explicitly evaluate a new proposal. Never silently rebind it to the current snapshot.

## 2. Proposed result states

| State | Meaning |
|---|---|
| `ready` | Deterministic supported evaluation produced a validated effect proposal. Not a commit and not proof that free-form source text was interpreted correctly. |
| `no_match` | Supported evaluation completed and no enabled mechanic matched. |
| `unknown` | Required context, operation, module, or semantics are unsupported or cannot be determined safely. |
| `needs_review` | An explicit trusted policy requires a human/author decision, or an invariant cannot be established. |
| `rejected` | Malformed, unauthorized, cross-world, or stale request, or deterministic contract violation. |

Unknown is not false. A review state is not an implicit choice. No narrative explanation may replace the machine-readable outcome and reason codes.

## 3. Dependency contract

The contract must distinguish **declared potential dependencies** from **reads observed during one execution**.

1. The supported declarative rule vocabulary should expose static paths and bounded branch constructs so the evaluator can compute a conservative union of potential reads before execution.
2. A conditional branch selector is itself a dependency. Changing it must invalidate the dependent result even when the newly selected branch reads different fields.
3. Negative reads (for example, "no claim exists") must be explicit typed dependencies bound to the same snapshot. An absent record is not globally absent unless the relevant scope and snapshot are established.
4. Runtime instrumentation records actual reads and rejects an executed undeclared read. This is a useful defect detector, not a proof that skipped nodes have no missing dependencies.
5. A dependency graph is eligible for incremental strategy B only when its dependency contract is accepted as complete for the supported DSL. For arbitrary code or unsupported conditional access, completeness is unknown; do not infer it from observed reads.
6. The contract may conservatively over-approximate dependencies. An unnecessary edge costs performance; a missing edge can produce stale state.

The initial production slice should not support arbitrary executable code or model-supplied callbacks. Any future escape hatch requires a separate effect/resource boundary and must not silently participate in incremental execution.


### Implemented prerequisite on the work branch

`src/core/rules.js` exports `collectConditionDependencies(rule)`, which validates the bounded rule structure and returns a sorted, deduplicated union of every path in every branch, including `not`, legacy nested-rule aliases, and paths absent from the current context. `src/core/mechanics.js` exports `collectMechanicConditionDependencies(template)`, which aggregates paths from applicability, participant constraints, action preconditions/constraints, and interaction conditions. `tests/condition-dependencies.test.js` covers branch-union behavior, absence dependencies, deterministic output, malformed ASTs, unsupported operators, unsafe paths, and template-wide aggregation.



`src/core/mechanics.js` also exports `evaluateMechanicActionConditions(template, actionId, context, options)`. This read-only preflight evaluates the template applicability rules and the selected action's preconditions/constraints using the existing three-valued condition result API. It returns `true`, `false`, `unknown`, or `rejected` with scoped condition results and unresolved paths; missing context is not silently treated as false. The context and `knownAbsentPaths` remain trusted-caller inputs. This function does not authorize reads, select participants, resolve conflicts, bind action inputs, interpret effect intents, invoke modules, pin a world snapshot, create proposals, or mutate state. It is a tested primitive, not the production executor.

**Boundary:** these helpers are not yet wired into mechanic execution or proposal creation. They establish completeness only for condition-bearing sections of the supported declarative AST. The aggregate result explicitly reports `mechanic_dependencies_complete: false` because effect-intent payload binding and registered module inputs/reads are not yet specified. Neither helper provides authorization, assembles a trusted context, infers dependencies from template prose/modules, or proves that other computation stages have no additional dependencies. Production incremental strategy B must remain disabled until the executor uses this analysis and covers every other input-bearing stage under the same snapshot.

## 4. Strategies

The three strategies are independent test choices. None is declared the production default by this proposal.

- **A — full recomputation:** evaluate every node in deterministic dependency order. Use as a control strategy and for fallback where supported semantics are acyclic and fully defined. A is not the independent oracle.
- **B — incremental recomputation:** recompute the transitive dependent closure of changed inputs/nodes. Permit only where the dependency contract is known complete for the supported evaluation language.
- **C — guarded incremental recomputation:** run the eligible B plan, check independently defined domain invariants and freshness, then fall back to A when the graph contract or checks require it. If A still cannot establish a valid result, return `unknown` or `needs_review`; do not manufacture a value.

The independent oracle must be authored from expected semantics and fixtures separately from A/B/C. Comparing B or C only with A can preserve a shared defect.

## 5. Invariants and ownership

Core may enforce universal structural invariants (snapshot identity, reference scope, version pinning, deterministic serialization, no canonical writes during evaluation). Core must not invent world-specific semantic truths.

Domain invariants must be explicitly supplied and versioned by the responsible world/mechanic contract. Each invariant should identify:
- owner and version;
- exact scope of the state it checks;
- expected behavior when required facts are absent, conflicted, or unknown;
- whether failure triggers review, rejection, or a safe full recomputation;
- independent tests with counterexamples.

An invariant that merely repeats the same evaluator implementation is not an independent oracle.

## 6. Cycles

A graph cycle establishes a cyclic dependency, not its semantics. The initial executor should reject unsupported cycles with a structured `unknown` / `needs_review` result. Do not choose a magic iteration count or assume every cycle converges.

A later fixed-point evaluator would need an explicit semantic contract: permitted node types, monotonicity or another convergence condition, ordering, convergence/equality definition, resource limits, failure behavior, and independent tests. Strongly connected components may identify the region, but do not define how it should evaluate.

## 7. Concurrency, commit, and recovery

- Evaluation must not run against a mixture of revisions.
- The proposal must carry snapshot identity and a deterministic fingerprint over normalized input, relevant state/version identities, policy versions, and proposed effects.
- The ordinary Core acceptance/commit path must re-check expected revision and commit sequence atomically with the write. A preflight check without a commit-time guard is insufficient.
- A stale result is rejected or re-evaluated; it is never silently refreshed.
- Repeated delivery of the same accepted request must retain the existing idempotency semantics.
- Failed evaluation must leave canonical world state, event history, and idempotency state unchanged, except for an explicitly specified non-canonical diagnostic/review record.
- Recovery tests must cover interruption before proposal, after proposal, and during commit. No evaluator-local cache may be authoritative.

## 8. Performance and fallback policy

Measure, separately:
- nodes and edges considered;
- nodes evaluated;
- actual reads recorded;
- invariant checks and time spent;
- snapshot size and dependency fan-out;
- fallback frequency and cost;
- stale-result rejection and retries.

Do not select C as default or choose a fixed fallback threshold without representative benchmark evidence. Keep A/B/C selectable in test and benchmark runs. Any production default requires a recorded decision based on correctness gates and measured workloads.

## 9. Minimum acceptance matrix

| ID | Scenario | Required result |
|---|---|---|
| RC-001 | Deterministic acyclic fixture | A matches independent expected projection |
| RC-002 | Declared input changes | B recomputes every declared transitive dependent |
| RC-003 | Branch selector changes | Selector and downstream closure are recomputed |
| RC-004 | Omitted conditional dependency | B demonstrates the stale-result counterexample; C detects it only with an independent guard or rejects unsupported completeness |
| RC-005 | Negative/absence dependency changes | Affected result is invalidated within the declared scope |
| RC-006 | Executed undeclared read | Contract violation; no silent ready result |
| RC-007 | Cycle | Structured fail-closed result; no arbitrary iteration |
| RC-008 | Unknown module/version/capability | Unknown/review; no execution |
| RC-009 | Snapshot changes before acceptance | Stale result rejected atomically |
| RC-010 | Concurrent writes | No mixed-snapshot result is committed |
| RC-011 | Duplicate delivery | Idempotent result; no duplicate effects |
| RC-012 | Rollback/rebuild | Projections match independent expected state |
| RC-013 | Crash/retry | No partial canonical mutation or duplicate commit |
| RC-014 | Domain invariant fails | C falls back only where safe; otherwise returns review/unknown |
| RC-015 | Benchmark | Costs reported for A/B/C without selecting a default by assumption |

## 10. Open decisions before production integration

1. Final declarative action-input binding and effect-intent semantics.
2. How trusted context is assembled and filtered by actor/knowledge policy before evaluation.
3. The exact supported negative-dependency vocabulary.
4. Which invariant owners and versions are authoritative for each world/mechanic.
5. Whether any cyclic evaluation is in scope for the first production slice.
6. Exact module sandbox/resource enforcement and implementation digest source.
7. Commit-time stale-result rejection behavior and the existing proposal API seam to use.

Until these are resolved and tested, the isolated harness remains experimental and must not be exposed as a production mechanic executor.


### Bounded effect-intent translation primitive

`translateMechanicEffectIntents(template, actionId)` translates only the selected action, and maps only three literal intent kinds to existing Core effects: `create_entity` → `entity.create`, `update_attribute` → `entity.update`, and `assert_fact` → `fact.set`. It rejects unsupported kinds, unknown payload fields, empty patches, duplicate effect IDs, non-empty `source_refs`/`caused_by`, and invalid Core effects. Failure is atomic at the adapter boundary: it returns no partial effects. The result includes an ordered `effect_provenance` mapping from output effect indices to action/intent/effect IDs.

This is an opt-in pure adapter, not a proposal or executor. It does not resolve targets, prove target existence/world ownership, pin a snapshot, bind action inputs, enforce access policy, create a proposal, or preserve provenance in the event pipeline. Callers must not commit its effects unless the proposal path can carry the provenance and all remaining guards.


### Snapshot-bound bounded evaluation primitive

`evaluateMechanicActionAgainstSnapshot({ snapshot, instanceId, actionId, authorizedContext, knownAbsentPaths })` now combines the condition preflight and literal effect-intent translator for a narrow no-input declarative action. It requires the enabled instance and its exact pinned template/hash to exist in the same supplied `mechanic_evaluation_snapshot`, records `world_revision` and `commit_sequence`, and emits a deterministic evaluation fingerprint over the selected instance/template identity, condition results, translated effects, and provenance. It returns no effects unless all conditions are decisively true and the supported literal effect subset validates.

It fails closed for registered module execution, automatic conflict resolution, participant binding, interaction semantics, and non-trivial action input schemas. It is synchronous, read-only, does not access storage, does not create a proposal, and has no commit authority. `authorizedContext` and `knownAbsentPaths` must already be assembled by a trusted caller from the same authorized immutable snapshot; this primitive does not prove that caller obligation. The fingerprint is not a signature and does not itself reject stale results. Production integration remains blocked until the trusted context boundary and proposal handoff can carry/check the exact snapshot identity and effect provenance.
