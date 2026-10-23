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

- A host-owned allowlist maps a registered module identity and exact version to an implementation explicitly enabled by the deployment.
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

- `src/core/mechanics.js` validates a rule-operator set that includes `contains`, `status_is`, `ref_exists`, `time_before`, `time_after`, and `needs_review` in addition to the basic comparisons and boolean combinators.
- `src/core/rules.js` currently evaluates only `eq`, `neq`, `exists`, `gt`, `gte`, `lt`, `lte`, `in`, `all`, `any`, and `not`. The wider validator allowlist is therefore not equivalent to executable evaluator support.
- `evaluateCondition` returns a boolean and treats a missing path as `false` (except for `exists`). It does not currently express a tri-state `true` / `false` / `unknown` result. Mechanic evaluation must not interpret missing required context as a proven false predicate or as proof that a rule is inapplicable. Add context-completeness preflight or a tri-state evaluation contract before using this evaluator for mechanics.
- The declarative schema, runtime contract validator, and evaluator must share a tested support matrix. A schema-valid rule is not necessarily executable by the current runtime.

Implementation order:

1. Reconcile `src/core/mechanics.js`, `src/core/rules.js`, `schemas/declarative-rule.schema.json`, effect kinds, and existing tests into one explicit operator/effect support matrix.
2. Decide and test missing-path semantics: distinguish a known absent field from context that was not retrieved or is not authorized. Return `unknown` when the engine cannot prove the predicate either way.
3. Resolve discrepancies between supported declarative operators, effect kinds, and the result contract before writing execution code.
4. Implement pure/read-only evaluation and result validation.
5. Add the acceptance tests above, including failure injection and cross-world isolation.
6. Connect validated results to the existing proposal API without introducing a second commit path.
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
