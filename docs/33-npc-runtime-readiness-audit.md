# NPC Subsystem — Runtime Readiness Audit (Stage 0)

Status: source-level audit performed against `main` as inspected on 2026-10-24. This is a read-only audit report on `feat/npc-subsystem`; it does not claim tests were run. No runtime, API, schema, or storage files were changed.

## 1. Executive finding

The repository already documents the intended NPC/autonomy and knowledge boundaries, and the core has a declarative rule evaluator plus a mechanic contract validator. However, the repository is not yet ready to execute NPC autonomy safely as a runtime subsystem.

The critical gap is not a missing prompt. The runtime needs a reliable way to distinguish a known-false condition from unavailable or inaccessible context, and NPC proposals need a supported canonical effect path. The present rule evaluator returns booleans and maps a missing path to false (except for `exists`). This is not enough to prove that an NPC is not applicable or lacks a fact; the context might simply be incomplete.

No NPC-specific runtime record model or end-to-end autonomous decision cycle was verified in this audit. This agrees with the repository's own Stage 1.3 boundary, which explicitly excludes NPC goals/plans/autonomy/knowledge records.

## 2. Sources inspected

- `docs/00-architecture-baseline.md`: separates intent, simulation, and narration; assigns world state, time, event identity, validation, causality, knowledge, and delivery status to the engine.
- `docs/06-npc-autonomy-and-process-manager.md`: proposed durable autonomy, decision inputs, goals/plans/tasks, off-screen progression, and rollback requirements.
- `docs/07-knowledge-and-narrative-boundaries.md`: separates canonical facts, actor knowledge/beliefs, narrative delivery, and search retrieval; requires provenance and access filtering.
- `docs/30-stage1.3-mechanic-execution-boundary.md`: explicitly excludes NPC autonomy and NPC domain records from the core mechanic execution slice.
- `docs/18-rollback-and-causality.md` and `docs/21-stage1-causality-contract.md`: distinguish the target causal rollback architecture from the currently limited runtime guarantees.
- `src/core/rules.js`: current rule operator set, boolean evaluation, path handling, and effect validation.
- `src/core/mechanics.js`: mechanic contract validation and its declared effect-kind vocabulary.
- `schemas/declarative-rule.schema.json`: declarative rule schema.
- `package.json`: test command is `node --test`; Node engine requirement is `>=22.13.0`.

This audit inspected source files through the GitHub connector. It did not execute the repository test suite or inspect every runtime module.

## 3. Findings and risk

### NPC-AUDIT-001 — Missing path and unknown context are collapsed

**Observed:** `src/core/rules.js` exports `evaluateCondition(rule, context)` with a boolean result. Its internal path reader returns `{ exists: false }` when a path is absent, and non-`exists` operators return `false` for that case. For `exists`, a missing path is treated as a known negative result.

**Risk:** An incomplete context and a genuinely absent field are indistinguishable to the evaluator. In NPC decisions this can turn missing permissions, unknown capabilities, unretrieved facts, or unavailable state into a seemingly proven negative.

**Required before NPC decision integration:** define how the context declares completeness and accessibility. Either preflight every required path against a trusted completeness/access manifest, or introduce a tested tri-state result (`true`, `false`, `unknown`) while preserving compatibility for existing callers. Do not globally change the current evaluator without a separate core change and regression tests.

### NPC-AUDIT-002 — Effect vocabularies are not yet a single safe integration contract

**Observed:** `src/core/mechanics.js` declares a mechanic-level vocabulary such as `create_entity`, `update_attribute`, `assert_fact`, `propose_knowledge`, `create_goal`, and `request_adjudication`. The inspected `validateEffects` in `src/core/rules.js` directly validates a narrower set of concrete effect kinds, including `entity.create`, `entity.update`, `fact.set`, and mechanic-instance lifecycle effects. Unknown kinds are rejected.

**Risk:** A model-facing NPC proposal cannot safely treat every mechanic-level effect name as an already supported core effect. Some names may be higher-level intent or future domain effects, not directly committable operations.

**Required before integration:** create an explicit mapping table of (a) NPC/domain intent, (b) supported core proposal/effect, (c) validation/preconditions, and (d) unsupported/needs-review behavior. Do not add new effect kinds merely to make the NPC contract appear complete.

### NPC-AUDIT-003 — Target rollback guarantees exceed current runtime

**Observed:** `docs/18-rollback-and-causality.md` states that the complete message/generation rollback and NPC knowledge/process recomputation are target architecture. `docs/21-stage1-causality-contract.md` explicitly says the current runtime provides partial rollback and does not prove causal completeness.

**Risk:** If NPC goals, plans, knowledge, relationships, or off-screen processes are added before their causal ownership and rollback semantics are connected, they can survive a rollback incorrectly or be deleted too aggressively.

**Required before persistent NPC runtime state:** every proposed mutable record/effect needs a defined source, dependency, validity, and reconciliation policy using the core's supported causal path. Until then, NPC semantic cases that require rollback are blocked, not passed.

### NPC-AUDIT-004 — No verified NPC runtime contract was found in this audit

**Observed:** the architecture docs specify desired goals, plans, tasks, knowledge, beliefs, reports, and autonomy, while `docs/30-stage1.3-mechanic-execution-boundary.md` explicitly says those domain records and behavior are outside its scope.

**Risk:** Adding only prompt instructions would create apparent autonomy without durable state, validated effects, or off-screen continuity.

**Required before implementation:** choose a minimal NPC semantic slice and identify the existing core services it can use. Do not create a parallel event store, world revision, knowledge permission layer, scheduler, or rollback engine.

### NPC-AUDIT-005 — Search/retrieval cannot serve as a permission or provenance system

**Observed:** `docs/07-knowledge-and-narrative-boundaries.md` explicitly requires access/validity filtering after vector retrieval and says retrieval does not imply permission.

**Risk:** Passing raw retrieved text directly to an NPC decision can leak secrets or create false in-world knowledge, regardless of how accurate the embedding match is.

**Required before integration:** every context item must carry source identity and declared access/visibility metadata, or be withheld. The existing vectorization configuration remains untouched by this branch.

## 4. Readiness matrix

| Capability | Evidence in inspected sources | Readiness |
|---|---|---|
| Stable profile vs mutable NPC state | Contract-level design only | Specified, not verified in runtime |
| Goals/plans/tasks | Proposed architecture docs | Not verified in runtime |
| NPC knowledge/beliefs | Proposed architecture docs; no end-to-end runtime verified | Not ready |
| Access filtering before model context | Required by docs; no complete integration verified | Not ready |
| Unknown vs false for rule context | Current rule evaluator is boolean | Blocking gap |
| Validated NPC action effects | Core effect validator exists but domain mapping is incomplete | Not ready |
| Durable off-screen autonomy | Proposed process-manager contract | Not verified in runtime |
| NPC-aware rollback/reconciliation | Target docs; current rollback explicitly limited | Not ready |
| Player-agency boundary | Specified in architecture contract | Requires host/narration tests |
| Existing vectorization | Out of scope for this branch | Unchanged |

## 5. Recommended implementation sequence

1. **Freeze semantics for the first vertical slice.** Choose one bounded use case that can be validated without inventing a full NPC database. Suggested candidate: prepare an NPC decision context from an explicit, already validated snapshot and return a non-committing action proposal.
2. **Define the context envelope.** Specify snapshot identity, actor identity, allowed facts, omitted/unknown paths, source references, viewpoint, and player-agency constraints. Retrieval results alone cannot populate trusted fields.
3. **Define the proposal boundary.** A proposal must be non-committing, bounded, attributed, and validated by existing core operations. Unsupported domain effects return unknown/review rather than being translated by guesswork.
4. **Write pure semantic tests.** Cover forbidden knowledge, incomplete context, false beliefs, invalid preconditions, and player-agency violations without introducing storage.
5. **Check rollback feasibility.** If the selected slice requires persistent NPC state, stop and design the causal contract before implementation; do not fake rollback through prompt rewriting.
6. **Only then consider API or persistence.** This requires explicit review and authorization; it is not authorized by this audit.

## 6. Explicit non-actions

During this audit, no files on `main` were changed. No public API, SQLite schema, storage, vectorization, prompt, SillyTavern, or card-projection contract was changed. No claim is made that the automated test suite passed.
