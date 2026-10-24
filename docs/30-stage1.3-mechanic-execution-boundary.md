# 30. Stage 1.3 — Universal mechanic execution boundary

Status: **implementation contract for the next core vertical slice**. This document is core-only: it defines how registered mechanics participate in action evaluation without defining any particular world's mechanics or NPC behavior.

Related contracts:
- `docs/25-universal-mechanics-system.md` — architecture decision and universal concepts.
- `docs/26-mechanics-contracts.md` — template, instance, module, lifecycle, and conflict contracts.
- `docs/28-proposal-api-stage1.md` — implemented proposal/approval/commit API and limitations.
- `docs/18-rollback-and-causality.md` — target contract for causal history and rollback; current limited event rollback is separately described in `docs/21-stage1-causality-contract.md`.

## 1. Scope and non-goals

Implement a deterministic, auditable path that can evaluate a proposed action against the exact active mechanic set for one world and return either:
- a validated, non-committed evaluation result;
- a structured `needs_review` / `unknown` result with reasons;
- or a validated effect proposal that must still pass the ordinary proposal-to-commit pipeline.

This slice does **not**:
- implement NPC goals, plans, schedules, decision-making, or off-screen autonomy;
- add a CharacterCard, KnowledgeRecord, PlayerNote, access projection, or other NPC-block domain record;
- add genre/game-specific mechanics or a sample World Pack;
- execute arbitrary code supplied by a template, module manifest, model, or World Pack;
- give a language model permission to activate mechanics, resolve conflicts, or commit effects;
- claim full JSON Schema 2020-12 conformance unless the validator is replaced or independently proven conformant.

The parallel NPC-block work may define consumer requirements, but must not create a second event store, knowledge store, permission system, revision counter, or rollback implementation. This contract is the core interface boundary for that work, not an attempt to implement its domain model.

## 2. Inputs and immutable evaluation snapshot

Every evaluation request must be bound to one `world_id` and one consistent snapshot containing at least:
- expected `world_revision` and commit sequence;
- normalized action intent and actor/target references, where supplied;
- the exact read/context manifest available to the evaluator;
- the enabled `MechanicInstance` IDs and their pinned template versions;
- the exact registered module identifiers and versions eligible for the requested operation;
- applicable trusted policy/configuration versions.

All IDs must resolve within the same world unless a specific core-level global immutable definition is being referenced. Cross-world entity, fact, process, instance, or event references are rejected.

The evaluator must not fetch newer state halfway through evaluation. If the world revision, commit sequence, active instance set, template/module registration, or policy version changes before the result is accepted for commit, the result is stale and must be rejected or explicitly re-evaluated as a new proposal. Never silently rebind a result to a different snapshot.

## 3. Evaluation pipeline

The application service must execute these steps in order:

1. **Normalize and validate the request envelope.** Reject unknown fields, malformed IDs, oversized structures, unsupported operations, and invalid world references.
2. **Capture a consistent snapshot.** Record the revision/commit sequence and all relevant immutable template/module versions. Evaluation is read-only.
3. **Select applicable enabled instances.** Only instances whose status is `enabled` are candidates. `disabled` instances are excluded. `needs_review` instances cannot silently participate; return a review/unknown result if their possible relevance cannot be safely ruled out.
4. **Validate instance and template contracts.** Confirm exact template version exists; parameters/state satisfy the bounded supported contract; required module versions and capabilities are registered and host-allowlisted. A registration manifest alone is not executable code.
5. **Evaluate only the bounded declarative rule vocabulary.** Rule evaluation must be deterministic for the same snapshot and normalized input. Unknown operators, unsupported conditions, malformed values, and missing required context never evaluate as true.
6. **Resolve conflicts under the declared policy.** `automatic` is allowed only through a registered exact-version resolver module that declares the required capability and has a validated input/output contract. `manual` produces a durable review requirement. Array order, incidental database order, or a generic numeric priority must not select a winner unless the selected policy explicitly defines that tie-break.
7. **Produce a structured result.** Include outcome, applicable instance/template/module versions, matched rules, failed or unknown conditions, conflict details, proposed effects, validation errors, snapshot revision, and provenance/read references. Do not mix narrative prose into the authoritative result.
8. **Validate proposed effects through the existing core event/effect validator.** The evaluator may not write canonical storage or bypass event attribution, revision checks, audit, idempotency, or rollback metadata.
9. **Hand off without committing.** Convert an accepted result into a proposal for the existing proposal API/application pipeline. A resolver's output is also only a proposal. Approval and commit remain separate operations.

Any failure before step 9 must leave canonical world state, active instance state, process records, audit history, and idempotency state unchanged, except for an explicitly defined non-canonical diagnostic/review record.

## 4. Result contract

The result must use a bounded, versioned structure. The initial outcome vocabulary is:

- `ready`: evaluation completed; a proposed effect set exists and passed supported deterministic checks. This is not a commit and not proof of semantic alignment with free-form source text.
- `no_match`: supported evaluation completed and no enabled mechanic produced applicable effects.
- `needs_review`: a manual conflict or trusted-policy decision is required.
- `unknown`: required mechanic, operator, context, schema, or module behavior is unsupported or cannot be determined safely.
- `rejected`: request is malformed, unauthorized, cross-world, stale at the point of acceptance, or violates a deterministic invariant.

A result must carry stable machine-readable reason codes and bounded human-readable diagnostics. It must not collapse `unknown` into `false`, or `needs_review` into a guessed result. Do not fabricate a winner, effect, condition, or fallback mechanic to make the request succeed.

A `ready` result must include a deterministic evaluation fingerprint over the normalized input, snapshot identity, active instance identities/versions, template/module versions, relevant policy versions, and proposed effects. This fingerprint is an audit/staleness aid, not a digital signature or proof of correctness.

## 5. Module execution boundary

Module manifests are declarative registrations, not proof that implementation code is safe or available.

- A host-owned allowlist maps a registered module identity and exact version to an implementation explicitly enabled by the deployment. Each allowlist entry must also pin an immutable implementation digest or deployment build identity; a module-manifest hash identifies the declaration, not the executable code. Include that implementation identity in the evaluation fingerprint so replacing code without changing the declared module version cannot silently preserve a stale fingerprint.
- Only operations/capabilities named in that module's contract may be invoked.
- Input/output must pass bounded contract validation before results are consumed.
- Unknown implementation IDs, versions, capabilities, incompatible core versions, timeout/failure, or invalid output fail closed to `unknown` or `needs_review` as specified by the module's validated failure policy.
- Module code must not access the canonical database directly, perform arbitrary network/file/shell operations through model-controlled arguments, mutate global state, or bypass normal event validation.
- Resolver output is untrusted proposal data and must pass the same deterministic validation as any other proposed effect set.
- Determinism requirements and any allowed nondeterministic capability must be explicit. A conflict resolver used for `automatic` resolution must be deterministic for the same declared input.

If the current runtime cannot enforce a module's declared resource or execution limits, that module must not be enabled for automatic execution.

## 6. Instance lifecycle interaction

Creation, enable, disable, and any future parameter/state change remain engine-mediated, revision-checked, attributed, audited operations.

- Enabling an instance changes the active rule set only after atomic validation and commit.
- Disabling affects evaluation of new actions; it does not erase facts, events, knowledge, effects, or audit history already created.
- If a disabled instance owns an active process, the engine must apply its explicit `lifecycle_policy.on_disable`. Missing or unsupported policy produces review/unknown; it must not silently terminate, freeze, continue, or reverse the process.
- Template definitions and historical version identities are immutable. A new template version does not silently upgrade existing instances or reinterpret committed events.
- Rollback may invalidate/recompute causally dependent instance or process projections according to the core causal contract; it must not rewrite template definitions or delete append-only audit history.

Mechanic execution itself must not introduce a second process manager. Process creation and progression must use the core process contract when implemented; until then, mechanics may return a structured proposed process effect only if that effect is already supported by the core event contract.

## 7. Causality, audit, and persistence

Every accepted evaluation and committed effect must be traceable to:
- world and snapshot revision/commit sequence;
- action/proposal identity;
- actor/source identity as actually authenticated or supplied by a trusted adapter, distinguishing missing identity from inferred identity;
- exact mechanic instance and template versions;
- exact module implementation/version and operation, if invoked;
- relevant policy/configuration versions;
- read/context manifest and supported causal links;
- deterministic evaluation result and effect proposal;
- eventual canonical event ID and commit outcome.

Do not claim causal completeness solely because every declared read appears in a context manifest. Missing provenance must produce an explicit incomplete/unknown/review result according to policy. A model-provided causal link is untrusted input and must be checked against the supported core contract.

Diagnostics may be retained separately, but failed evaluation must not partially mutate canonical world state. Retrying an evaluation or delivery must not duplicate a world effect. Committed consequences are changed only through the canonical event/rollback path.

## 8. Required acceptance tests

Implement contract tests before connecting a World Pack or SillyTavern adapter:

- **MECH-EVAL-001:** empty template/instance/module registries return a valid no-match/unknown result without inventing mechanics.
- **MECH-EVAL-002:** disabled instances are not applied to new actions.
- **MECH-EVAL-003:** an enabled instance is evaluated against its exact pinned template version; version mismatch fails closed.
- **MECH-EVAL-004:** unknown operator, missing condition context, malformed parameter, or unsupported effect never evaluates as success.
- **MECH-EVAL-005:** two worlds cannot read each other's instances, entities, facts, events, or process references.
- **MECH-EVAL-006:** module manifest registration without an enabled host implementation does not execute code.
- **MECH-EVAL-007:** unregistered module/version/capability and invalid module output produce a non-mutating unknown/review result.
- **MECH-EVAL-008:** automatic conflict resolution is rejected unless an exact-version deterministic resolver is allowlisted and declares the required capability.
- **MECH-EVAL-009:** manual conflict resolution selects no winner and records a review requirement.
- **MECH-EVAL-010:** rule/module/database ordering does not alter results unless a deterministic ordering rule is explicitly part of the contract.
- **MECH-EVAL-011:** stale snapshot, changed active instance set, or changed relevant policy prevents acceptance of the old result.
- **MECH-EVAL-012:** evaluation and validation failures leave canonical state, revision, event history, instance state, and idempotency records unchanged.
- **MECH-EVAL-013:** accepted effects pass through the existing proposal/commit path; evaluation cannot directly commit.
- **MECH-EVAL-014:** resolver output cannot bypass ordinary effect validation, approval, audit, or rollback.
- **MECH-EVAL-015:** disabling a mechanic preserves its prior consequences; active-process behavior requires an explicit lifecycle policy.
- **MECH-EVAL-016:** a repeated request with the same evaluation identity is stable and cannot duplicate canonical effects.
- **MECH-EVAL-017:** missing/incomplete provenance is not upgraded to complete merely because a model supplies a rationale.
- **MECH-EVAL-018:** evaluation fingerprints change when any relevant snapshot, rule, module, or policy version changes.
- **MECH-EVAL-019:** schema, mechanic-contract validator, and runtime evaluator expose the same supported-operator matrix; a schema-valid but unsupported operator cannot be registered as executable.
- **MECH-EVAL-020:** missing or inaccessible context produces `unknown` unless the snapshot proves that the field is genuinely absent; it is not silently coerced to `false`.

Test profiles should include (a) no body/money/faction fields, (b) a fictional-rule profile, and (c) a distributed/digital profile. Use synthetic contract fixtures only; do not add genre-specific mechanics or a demonstration World Pack.

## 9. Current code audit and implementation order

The initial code audit found a concrete contract mismatch that must be resolved before mechanic execution is connected:

- The current `src/core/mechanics.js` imports `SUPPORTED_RULE_OPERATORS` from `src/core/rules.js`; the inspected `tests/mechanics-operator-matrix.test.js` also compares that set against `schemas/declarative-rule.schema.json`. The earlier concern that the validator independently accepts extra operators is stale for this source revision. Re-run the matrix test whenever either declaration changes.
- The legacy `evaluateCondition` API returns a Boolean and treats a missing path as `false` for ordinary comparison operators (with `exists` using its explicit absence behavior). It cannot distinguish an actually absent field from context that was not retrieved, is incomplete, or is withheld.
- The `evaluateConditionResult` API in the current branch preserves the legacy Boolean API and returns `true`, `false`, or `unknown`; the narrow application executor now uses this tri-state result. It propagates unknown through `not`, `all`, and `any`; a path is considered known absent only when the trusted caller explicitly supplies it in `knownAbsentPaths`. The returned `status` is authoritative for the condition result; `unknown_paths` is diagnostic and may list unresolved leaves even when the overall result is decisively `true` or `false` (for example, `all(false, unknown)` returns `false` with a diagnostic path). Consumers must not let a non-empty diagnostic list override a decisive status. `knownAbsentPaths` is a trusted-caller assertion and must be derived from the same consistent, authorized snapshot as the condition context, never directly from model/user input. This is now used by `src/application/mechanic-executor.js` for the bounded supported action slice; it still does not prove full mechanic dependency completeness. Its `unknown_paths` field is diagnostic and can remain non-empty when a decisive `all`/`any` branch determines the final status; consumers must branch on `status`, not infer the result from list emptiness. For a path explicitly declared absent, `exists` resolves to false by default, `eq` and membership/numeric comparisons resolve to false, and `neq` resolves to true. The helper validates that a declared-absent path is not simultaneously present in the supplied context.
- Operator-name alignment does not solve effect-intent mapping, module implementation allowlisting, context completeness, or the remaining limits of the Stage 1.3 executor. A narrow `MechanicExecutor` and guarded proposal handoff now exist, but a schema-valid rule is not by itself proof that the full mechanic execution pipeline exists.
- `schemas/mechanic-instance.schema.json` allows `status: "needs_review"`, but the SQLite `mechanic_instances.status` constraint and event-rebuilt lifecycle projection support only `disabled`/`enabled`; no canonical lifecycle effect sets a durable review status. Treat `needs_review` as a transient evaluation result only until the project either removes it from the persisted instance schema or defines an event-backed transition. Do not silently treat the schema enum as implemented storage behavior.

Implementation order:

1. Keep the schema, mechanic validator, and evaluator on one tested operator support matrix; the current source already shares the operator constant, so preserve that invariant rather than duplicating lists.
2. Approve and test missing-path semantics: distinguish a known absent field from context that was not retrieved or is not authorized. Return `unknown` when the engine cannot prove the predicate either way.
3. Reconcile declarative rule results, mechanic effect intents, canonical effect kinds, and the result contract before connecting evaluation to proposals.
4. The initial pure/read-only executor slice and structured snapshot identity are implemented in `src/application/mechanic-executor.js`; extend only through explicit supported contracts and fail-closed behavior.
5. Continue the acceptance tests above, especially failure injection, cross-world isolation, duplicate delivery, and rollback/recovery.
6. The bounded executor is connected to the existing proposal API through `ProposalService.createFromMechanicEvaluation`; broaden semantics only without introducing a second commit path.
7. Implement explicit lifecycle policy handling for active processes only after the core process contract is executable.
8. Run the full test suite and inspect the exact commit/PR diff. Do not merge if the tests fail or if docs claim guarantees not supported by code.

Exit gate: evaluation is deterministic and read-only; all proposed effects use the canonical event path; unsupported behavior fails closed; cross-world isolation, audit, staleness, idempotency, and rollback interactions have tests. NPC autonomy and the SillyTavern adapter remain later stages.

## 10. Boundary with the parallel NPC block

The NPC block is a consumer of core services, not an alternate authority layer. It may specify how an actor's goals, plans, knowledge, and decisions should call the engine, but the core remains responsible for:
- canonical identity and world scoping;
- event/fact authority, revisions, and idempotency;
- validated mechanic evaluation and effect commit;
- provenance, access filtering contracts, and causal rollback;
- process lifecycle primitives once implemented.

The NPC block must not assume that character cards, private knowledge, player notes, per-actor authorization, or process execution are already implemented merely because their contracts are being drafted. Conversely, core work must not bake NPC-specific fields or behavior into universal entities, mechanics, or event schemas. Integration requirements should be expressed through versioned contracts and tests at the boundary.
