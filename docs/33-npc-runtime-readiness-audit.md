# NPC Subsystem — Runtime Readiness Audit (Stage 0)

Status: source-level audit performed against `main` as inspected on 2026-10-24. This is a read-only audit report on `feat/npc-subsystem`; it does not claim tests were run. No runtime, API, schema, or storage files were changed.

## 1. Executive finding

For the concise cross-topic readiness summary, see [`docs/37-npc-kernel-readiness-gate.md`](docs/37-npc-kernel-readiness-gate.md). This audit is the source of truth for the detailed source-level findings; the readiness gate summarizes rather than supersedes those findings.

The repository documents the intended NPC/autonomy and knowledge boundaries and has a declarative rule evaluator, context manifests, a generic event-proposal service, and a mechanic contract validator. These are useful existing building blocks, but they do not constitute a safe NPC decision pipeline.

The critical gap is not a missing prompt. The rule evaluator returns booleans and maps a missing path to false (except for `exists`), while the context manifest records referenced world items and a snapshot cursor but does not itself prove that an NPC is authorized to know those items. The generic `ProposalService` can stage and validate an event proposal without immediately committing the canonical event, but its own validation metadata explicitly leaves actor authorization, semantic alignment, causal completeness, and player-agency policy unchecked. Therefore it is a candidate core boundary to reuse—not proof that NPC proposals are safe to commit.

No NPC-specific runtime record model, actor-knowledge/access filter, or end-to-end autonomous decision cycle was verified in this audit. This agrees with the repository's Stage 1.3 boundary, which explicitly excludes NPC goals/plans/autonomy/knowledge records.

## 2. Sources inspected

- `docs/00-architecture-baseline.md`: separates intent, simulation, and narration; assigns world state, time, event identity, validation, causality, knowledge, and delivery status to the engine.
- `docs/06-npc-autonomy-and-process-manager.md`: proposed durable autonomy, decision inputs, goals/plans/tasks, off-screen progression, and rollback requirements.
- `docs/07-knowledge-and-narrative-boundaries.md`: separates canonical facts, actor knowledge/beliefs, narrative delivery, and search retrieval; requires provenance and access filtering.
- `docs/30-stage1.3-mechanic-execution-boundary.md`: explicitly excludes NPC autonomy and NPC domain records from the core mechanic execution slice.
- `docs/18-rollback-and-causality.md` and `docs/21-stage1-causality-contract.md`: distinguish the target causal rollback architecture from the currently limited runtime guarantees.
- `src/core/rules.js`: current rule operator set, boolean evaluation, path handling, and effect validation.
- `src/core/mechanics.js`: mechanic contract validation and its declared effect-kind vocabulary.
- `src/application/engine.js`: context-manifest registration and event preparation/validation.
- `src/application/proposals.js`: generic persisted proposal lifecycle and the validation checks explicitly not performed.
- `schemas/declarative-rule.schema.json`: declarative rule schema.
- `package.json`: test command is `node --test`; Node engine requirement is `>=22.13.0`.

This audit inspected source files through the GitHub connector, including the application proposal service and core tests. It did not execute the repository test suite or inspect every runtime module.

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

**Current position:** the first semantic slice is now agreed in `docs/39`: explicitly authorized author-initial/imported knowledge with provenance, actor-specific read/filter, separation of canonical truth/acquisition/belief, reserved-secret exclusion, and non-mutating proposal behavior. The remaining gate is to map this scope to real production interfaces and verify actor binding, initial-source representation, and observable test boundaries. Do not create a parallel event store, world revision, knowledge permission layer, scheduler, or rollback engine.

### NPC-AUDIT-005 — Search/retrieval cannot serve as a permission or provenance system

**Observed:** `docs/07-knowledge-and-narrative-boundaries.md` explicitly requires access/validity filtering after vector retrieval and says retrieval does not imply permission.

**Risk:** Passing raw retrieved text directly to an NPC decision can leak secrets or create false in-world knowledge, regardless of how accurate the embedding match is.

**Required before integration:** every context item must carry source identity and declared access/visibility metadata, or be withheld. The existing vectorization configuration remains untouched by this branch.

### NPC-AUDIT-006 — Existing generic proposal service is not an NPC authorization boundary

**Observed:** `src/application/proposals.js` persists a pending proposal and audit entry, validates its event payload, and requires approval before commit. Its validation result explicitly lists `actor_authorization` and `player_agency_policy` as not checked, alongside semantic alignment with source text and causal completeness. `src/application/engine.js` supports registering context manifests with world revision and commit-sequence cursors plus references to entities, facts, events, and explicit absences.

**Risk:** Reusing the generic proposal service as if it had already checked what an NPC is permitted to know or do would overstate its guarantees. A context manifest is a reference/cursor contract, not a complete NPC knowledge ledger or access-control decision.

**Required before integration:** treat the existing proposal lifecycle and context manifest as candidate infrastructure. Define and test the NPC-specific preflight around them, and preserve manual review where semantic alignment, actor authorization, player agency, or causal completeness is not verified. Do not duplicate proposal persistence or snapshot cursors in the NPC subsystem.

## 4. Readiness matrix

| Capability | Evidence in inspected sources | Readiness |
|---|---|---|
| Stable profile vs mutable NPC state | Contract-level design only | Specified, not verified in runtime |
| Goals/plans/tasks | Proposed architecture docs | Not verified in runtime |
| NPC knowledge/beliefs | Proposed architecture docs; no end-to-end runtime verified | Not ready |
| Access filtering before model context | Required by docs; no complete integration verified | Not ready |
| Unknown vs false for rule context | Current rule evaluator is boolean | Blocking gap |
| Generic proposal lifecycle | `ProposalService` stages/validates/approves/commits events; several semantic checks are explicitly not performed | Candidate infrastructure, not NPC-safe by itself |
| Context manifest | Snapshot cursor and world-item references exist; actor access is not proven by the manifest | Partial primitive, access filtering missing |
| Validated NPC action effects | Core effect validator exists but domain mapping is incomplete | Not ready |
| Durable off-screen autonomy | Proposed process-manager contract | Not verified in runtime |
| NPC-aware rollback/reconciliation | Target docs; current rollback explicitly limited | Not ready |
| Player-agency boundary | Specified in architecture contract | Requires host/narration tests |
| Existing vectorization | Out of scope for this branch | Unchanged |

## 5. Recommended implementation sequence

1. **Reconcile the approved first slice with actual code.** Inspect the exact target branch and identify the real actor/entity binding, the existing representation for explicitly authorized author-initial/imported knowledge, and the current snapshot read boundary. If any part cannot be represented without inventing a new store or schema, record it as blocked and send the specific interface question to the core owner.
2. **Define the internal read/filter contract against those real types.** It must be actor-, purpose-, and snapshot-scoped; preserve canonical truth, acquisition history, and belief as separate concepts; exclude author-reserved secrets before model input; and fail closed for unresolved actor/source/snapshot. `registerContextManifest(...)` is not by itself this query.
3. **Keep the proposal path non-committing.** Reuse existing proposal services only for their documented lifecycle. Do not treat proposal validation as proof of actor authorization, semantic alignment, causal completeness, or player-agency compliance.
4. **Add tests only at real boundaries.** The agreed targets include actor separation, provenance, unknown/withheld handling, secret exclusion, and proposal non-mutation. Do not create a mock context builder that pretends missing production behavior exists.
5. **Keep acquisition paths narrow.** The first slice supports only explicitly authorized `author_initial`/imported knowledge. Observation, communication, documents, inference, and rumor remain unsupported until their evidence paths are specified and tested.
6. **Defer broader persistence/runtime work.** Goals/plans, report delivery, autonomous off-screen execution, social-identity persistence, and NPC-aware rollback remain blocked until their own production state and causal boundaries are established. API/schema/SQLite work requires separate authorization.

## 6. Explicit non-actions

During this audit, no files on `main` were changed. No public API, SQLite schema, storage, vectorization, prompt, SillyTavern, or card-projection contract was changed. No claim is made that the automated test suite passed.

## 7. Dependency status refresh — 2026-10-24

A live check confirms the NPC implementation gate is still blocked, not because the semantic direction is undecided, but because the core candidates remain unmerged. The current documentation-only PR #38 head is `7ddfe47d49bd3dd136e22a0c0cf63f789326fe1a`; GitHub Actions Runtime tests run #375 passed on that exact head. This is CI confirmation of repository regression tests only, not NPC runtime integration.

- PR #45 (`09e48c2fd764c8e3f7b1e8f96e485a58ea34c793`) is open and its Runtime tests passed on that exact head. It provides a consistent internal read view only.
- PR #47 (`3417a28f8a99663a9834f733bb842558259bc2e4`) is open and stacked on #45; Runtime tests passed on code/test head `ba701653b4fa629bde26c1188173039c08de993f`. It extends the read view to mechanic configuration and explicitly requested context manifests, but does not authorize actor access.
- PR #46 (`a35f9fd20bff9a21ce5faa3c55f42ae350984651`) is open; Runtime tests passed on code/test head `f5ff93a79d9f9a84bb3bf602d36bd47360c3aa09`. It adds an opt-in tri-state condition API without implementing the NPC context pipeline.
- PR #38 remains documentation-only; Runtime tests #375 passed on its current head `7ddfe47d49bd3dd136e22a0c0cf63f789326fe1a`.

These test results are accurately scoped to their reported commits; they do not establish that the unmerged code is on `main`, and they do not establish NPC runtime readiness. The NPC branch is three commits behind current `main`; no rebase, merge, or force-update was performed. Continue source/contract reconciliation only until the real actor binding, authorized initial-source representation, and model-safe actor/purpose filter exist at reviewed core boundaries. See `docs/37-npc-kernel-readiness-gate.md` §18 for the exact dependency table and decision.

