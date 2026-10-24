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
7. A/B/C recalculation integration, independent oracle coverage, and measured fallback thresholds.

The bounded application executor and guarded proposal handoff now exist on this branch, but the isolated A/B/C harness remains experimental. Production use is still limited to the explicitly supported executor slice; unresolved semantics must continue to fail closed.


### Bounded effect-intent translation primitive

`translateMechanicEffectIntents(template, actionId)` translates only the selected action, and maps only three literal intent kinds to existing Core effects: `create_entity` → `entity.create`, `update_attribute` → `entity.update`, and `assert_fact` → `fact.set`. It rejects unsupported kinds, unknown payload fields, empty patches, duplicate effect IDs, non-empty `source_refs`/`caused_by`, and invalid Core effects. Failure is atomic at the adapter boundary: it returns no partial effects. The result includes an ordered `effect_provenance` mapping from output effect indices to action/intent/effect IDs.

This is an opt-in pure adapter, not a proposal or executor. It does not resolve targets, prove target existence/world ownership, pin a snapshot, bind action inputs, enforce access policy, create a proposal, or preserve provenance in the event pipeline. Callers must not commit its effects unless the proposal path can carry the provenance and all remaining guards.


## 11. Snapshot-bound application executor slice

The branch now contains `src/application/mechanic-executor.js`, a read-only application-layer path that consumes the existing `getSnapshot(worldId, { includeMechanicEvaluationState: true })` seam. It pins world revision, commit sequence, instance ID, exact template ID/version/hash, resolves literal entity-target existence through the existing consistent state projection and requires its revision/cursor to match the mechanic snapshot before using the result.

It also rejects duplicate entity/fact writes within one action before proposal handoff, matching Core event semantics rather than deferring a predictable conflict to commit.

The slice deliberately supports only:
- enabled instances and the exact pinned template;
- `manual` conflict policy, no rule modules, no participant selection, and no declared mechanic interactions;
- `deterministic_only` actions with an empty object input and the exact `input_schema: { type: "object" }`;
- context returned by a trusted injected provider that attests the same world revision and commit sequence and declares a non-empty `policy_version`;
- the three literal effect mappings documented above.

Unsupported semantics return `unknown` or `rejected`, with an empty effect list. The executor recursively freezes the newly materialized evaluation snapshot before exposing it to the trusted context provider. Provider/evaluator exception messages are not returned in result payloads; callers receive stable reason codes and generic diagnostics instead. The executor does not write canonical state. Ready results are recursively frozen and carry an in-process attestation marker that the ordinary proposal handoff requires; cloned or modified result objects are rejected before proposal creation. This marker is an application wiring guard, not a cryptographic signature or a defense against arbitrary code execution inside the trusted process. Results also carry `context_fingerprint` and `evaluation_fingerprint` over snapshot identity, versioned policy/context, condition results, the dependency manifest, translated effects and effect provenance; these fingerprints are audit identities, not signatures. The dependency manifest records `scope: bounded_deterministic_action_v1`: for this slice, each condition path must map to exactly one `entity_attribute` evidence item, the supplied context value must equal that attribute in the same world revision/cursor, and the resulting canonical `read_set`/`causal_links` are included in the evaluation fingerprint and ordinary proposal event. Literal effect targets also add existence/absence guards. This proves dependency completeness only for the bounded supported slice; `global_mechanic_dependencies_complete` remains false.

`ProposalService.createFromMechanicEvaluation` is the internal handoff for a ready result. It rechecks the evaluation's world revision and commit sequence inside the same transaction that creates the ordinary durable proposal, validates effect-index and target provenance, and stores the exact evaluation identity, context fingerprint, evaluation fingerprint, policy version, and effect provenance with the proposal and `proposal.created` audit entry. The existing `LogicEngine.commitEvent`/SQLite event persistence path now stores the same mechanic execution metadata on the committed `world_events` row; `getEvents` returns it with the event, and the `proposal.committed` audit entry also carries that provenance and the committed `event_id`. This preserves the existing commit path while adding a nullable, migrated event metadata column. Exact idempotent retries replay the existing proposal even if the world has since advanced; changed content under the same key conflicts. Proposal approval/commit remain on the existing service; semantic review remains required and the ordinary stale-proposal guard remains in force. This handoff is not exposed as a new HTTP route.

This is a narrow executable vertical slice, not general production readiness. It does not prove that an injected context provider is correctly configured; it requires that provider to be trusted host code. Policy freshness is also unresolved: the evaluation records and fingerprints its policy version/scope, but the proposal lifecycle does not re-resolve that version against an authoritative active policy or re-check revocation at approval/commit. Before production use, Core/host integration must define whether policy versions are immutable and pinned for the whole proposal lifecycle or whether policy changes invalidate pending proposals, then test that contract. It does not support action-input binding, modules, participant selection, interactions, automatic conflict resolution, dependency completeness beyond the bounded slice, or A/B/C production recalculation. Do not widen the allowlist without closure tests and an explicit contract decision.


### Trusted context-provider contract

The current executor expects a trusted host function with this synchronous result shape:

- `context`: JSON object containing only values the configured actor/recipient may read;
- `knownAbsentPaths`: optional array of paths proven absent from the same snapshot under the same visibility policy, never model-supplied;
- `world_revision` and `commit_sequence`: exact markers copied from the supplied immutable snapshot;
- `policy_version`: non-empty stable identifier that changes when the context/visibility policy changes;
- `dependencyEvidence`: exactly one `{ path, kind: "entity_attribute", entity_id, attribute }` item for each condition path, with the value matching the canonical entity attribute in the same snapshot. Unsupported projections fail closed rather than being treated as complete.

The executor deep-freezes the snapshot before calling the provider, checks the two snapshot markers and policy version, verifies every condition path against canonical entity-attribute evidence, derives `read_set` and `causal_links`, fingerprints the evidence and context without returning the context itself, and withholds provider/condition exception details. The provider must not perform writes, must not infer global absence from a filtered view, and must not expose raw canonical state beyond its policy. A missing provider, mismatched marker, malformed absence declaration, thrown exception, or non-fingerprintable context produces `unknown` with no effects.

This contract is structurally enforced where possible, but provider trust/purity and the correctness of its authorization policy remain host integration assumptions. Closure requires host-level tests showing that forbidden fields never enter the context, absent claims are snapshot-scoped, policy version changes invalidate fingerprints, and provider failures have no side effects.


### Canonical dependency evidence and event handoff

For this bounded executor version, every condition path must have exactly one trusted `dependencyEvidence` record of shape `{ path, kind: "entity_attribute", entity_id, attribute }`. The executor verifies that the referenced entity exists in the same-world projection, the canonical attribute value matches the authorized context value, and missing attributes are marked absent only when the same snapshot proves absence. Unknown path kinds or incomplete evidence fail closed. This intentionally limits the first slice to conditions projected from canonical entity attributes; time, facts-as-condition-inputs, arbitrary projections, and module reads are unsupported.

The executor emits a scoped dependency manifest, a normalized canonical `read_set`, and `causal_links` for the supported condition reads and effect target preconditions. The ordinary proposal handoff carries `read_set`/`causal_links` into the event payload and stores the dependency manifest, evaluation/context fingerprints, policy version, authorization scope, and effect provenance in durable proposal metadata, the `proposal.created` and `proposal.committed` audit entries, and the committed `world_events.mechanic_execution_json` metadata linked to the exact event ID.

The manifest marks completeness only for `bounded_deterministic_action_v1`. Global mechanic dependency completeness remains explicitly unproven. This does not establish visibility-policy correctness; the host provider is still a trusted deployment boundary, and its policy must be tested independently.


A reusable implementation now exists in `src/application/entity-attribute-context-provider.js` as `CanonicalEntityAttributeContextProvider`. It requires an explicit safe path-to-entity-attribute binding list, a non-empty opaque `authorizationScope`, and a deployment-owned `canRead` callback; there is no default-allow mode. The scope is included in the context/evaluation fingerprints and proposal audit metadata so different principals or visibility scopes do not silently share an evaluation identity. It reads the same-world projection, verifies revision/cursor, emits only the projected context plus canonical evidence, and fingerprints the sorted bindings with the supplied policy version. Missing bindings, denied reads, missing targets, or a stale snapshot fail closed. Deployments must bump the policy version when the authorization callback's semantics change; the fingerprint cannot prove the callback itself is correct.


## 12. Guarantee and failure matrix

| Guarantee | Evidence type | Violation / unsupported case | Current status |
|---|---|---|---|
| One world snapshot, revision and commit cursor | Runtime identity checks + regression tests | `unknown`; proposal handoff rejects stale revision/cursor | Enforced for the bounded slice |
| Exact enabled instance and pinned template version/hash | Snapshot and immutable registry checks | `unknown` / `rejected` | Enforced for the bounded slice |
| All paths in supported condition AST branches are enumerated | Static AST traversal; branch-union tests | Analysis failure returns `unknown` | Statically covered for the supported DSL |
| Each condition path maps to a canonical entity attribute | Evidence coverage and same-world value/absence checks | Missing/mismatched evidence returns `unknown` | Structural checks enforced; semantic correctness of the trusted binding map remains an assumption |
| Absence-sensitive conditions | Same-snapshot canonical attribute absence + authorized scope | Unproven or out-of-scope absence claim returns `unknown` | Enforced for supported entity-attribute bindings |
| Effect intent semantics | Explicit allowlist and strict payload validation | Unsupported kind/field or binding returns `unknown` with no partial effects | Only three literal effect kinds supported |
| Effect targets and conflicts | Same-world projection, revision/cursor match, duplicate-write detection | Missing/cross-world target or duplicate write returns `unknown` | Enforced for the supported effect subset |
| Read set and causal references | Derived from condition evidence and effect target preconditions; checked on commit | Invalid/stale references rejected by ordinary Core validation | Persisted in the event |
| Evaluation-to-proposal integrity | Frozen in-process attestation + content fingerprint + effect provenance validation | Unattested/tampered evaluation rejected | Enforced as an in-process wiring guard, not a cryptographic trust boundary |
| Event-level provenance | Internal commit option + migrated SQLite column + event-history test | Public event payload cannot set the field | Persisted and tested |
| Global mechanic dependency completeness | Not inferable from the bounded subset | Global completeness remains false; unsupported sources fail closed | Explicitly unproven |
| A/B/C production choice and fallback thresholds | Requires persistent derived-output semantics and representative measurements | No strategy default selected | Open; remains an isolated experiment |

This matrix separates what is statically covered, dynamically checked, assumed at the trusted-host boundary, and deliberately unsupported. Passing CI validates the tests in this matrix; it does not convert the host-policy assumption or global dependency completeness into a proof.
