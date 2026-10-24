# NPC Subsystem — Runtime Readiness Audit (Stage 0)

Status: source-level audit performed against `main` as inspected on 2026-10-24. This is a read-only audit report on `feat/npc-subsystem`; it does not claim tests were run. No runtime, API, schema, or storage files were changed.

## 1. Executive finding

For the concise cross-topic readiness summary, see [`docs/37-npc-kernel-readiness-gate.md`](docs/37-npc-kernel-readiness-gate.md). This audit is the source of truth for the detailed source-level findings; the readiness gate summarizes rather than supersedes those findings.

The repository documents the intended NPC/autonomy and knowledge boundaries and has a declarative rule evaluator, context manifests, a generic event-proposal service, and a mechanic contract validator. These are useful existing building blocks, but they do not constitute a safe NPC decision pipeline.

The critical gap is not a missing prompt. The legacy `evaluateCondition(...)` path still returns booleans and can collapse missing data into ordinary results; `main` now also provides opt-in `evaluateConditionResult(...)` with tri-state semantics, but that primitive does not establish context completeness or actor access. The context manifest records referenced world items and a snapshot cursor but does not prove that an NPC is authorized to know those items. The generic `ProposalService` can stage and validate an event proposal without immediately committing the canonical event, but its own validation metadata explicitly leaves actor authorization, semantic alignment, causal completeness, and player-agency policy unchecked. Therefore it is candidate infrastructure to reuse—not proof that NPC proposals are safe to commit.

No NPC-specific runtime record model, actor-knowledge/access filter, or end-to-end autonomous decision cycle was verified in this audit. This agrees with the repository's Stage 1.3 boundary, which explicitly excludes NPC goals/plans/autonomy/knowledge records.

## 2. Sources inspected

- `docs/00-architecture-baseline.md`: separates intent, simulation, and narration; assigns world state, time, event identity, validation, causality, knowledge, and delivery status to the engine.
- `docs/06-npc-autonomy-and-process-manager.md`: proposed durable autonomy, decision inputs, goals/plans/tasks, off-screen progression, and rollback requirements.
- `docs/07-knowledge-and-narrative-boundaries.md`: separates canonical facts, actor knowledge/beliefs, narrative delivery, and search retrieval; requires provenance and access filtering.
- [`docs/30-stage1.3-mechanic-execution-boundary.md` on main](https://github.com/necromorphic/Logic-Engine/blob/main/docs/30-stage1.3-mechanic-execution-boundary.md): explicitly excludes NPC autonomy and NPC domain records from the core mechanic execution slice.
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

**Observed:** the legacy `evaluateCondition(rule, context)` path returns a boolean. Its internal path reader returns `{ exists: false }` when a path is absent, and non-`exists` operators return `false` for that case; `exists` also returns an ordinary boolean. Current `main` additionally exports `evaluateConditionResult(...)`, an opt-in tri-state API that preserves `unknown` unless a trusted caller proves known absence.

**Risk:** An incomplete context and a genuinely absent field are indistinguishable to the evaluator. In NPC decisions this can turn missing permissions, unknown capabilities, unretrieved facts, or unavailable state into a seemingly proven negative.

**Required before NPC decision integration:** use the real tri-state API when evaluating conditions that may encounter missing paths, and define how the trusted context proves completeness, known absence, and accessibility. The tri-state API is not an access-control system; do not mark paths known-absent without evidence from the same trusted decision context. Preserve the legacy Boolean contract for existing callers.

### NPC-AUDIT-002 — Effect vocabularies are not yet a single safe integration contract

**Observed:** `src/core/mechanics.js` declares a mechanic-level vocabulary such as `create_entity`, `update_attribute`, `assert_fact`, `propose_knowledge`, `create_goal`, and `request_adjudication`. The inspected `validateEffects` in `src/core/rules.js` directly validates a narrower set of concrete effect kinds, including `entity.create`, `entity.update`, `fact.set`, and mechanic-instance lifecycle effects. Unknown kinds are rejected.

**Risk:** A model-facing NPC proposal cannot safely treat every mechanic-level effect name as an already supported core effect. Some names may be higher-level intent or future domain effects, not directly committable operations.

**Required before integration:** create an explicit mapping table of (a) NPC/domain intent, (b) supported core proposal/effect, (c) validation/preconditions, and (d) unsupported/needs-review behavior. Do not add new effect kinds merely to make the NPC contract appear complete.

### NPC-AUDIT-003 — Target rollback guarantees exceed current runtime

**Observed:** `docs/18-rollback-and-causality.md` states that the complete message/generation rollback and NPC knowledge/process recomputation are target architecture. `docs/21-stage1-causality-contract.md` explicitly says the current runtime provides partial rollback and does not prove causal completeness.

**Risk:** If NPC goals, plans, knowledge, relationships, or off-screen processes are added before their causal ownership and rollback semantics are connected, they can survive a rollback incorrectly or be deleted too aggressively.

**Required before persistent NPC runtime state:** every proposed mutable record/effect needs a defined source, dependency, validity, and reconciliation policy using the core's supported causal path. Until then, NPC semantic cases that require rollback are blocked, not passed.

### NPC-AUDIT-004 — No verified NPC runtime contract was found in this audit

**Observed:** the architecture docs specify desired goals, plans, tasks, knowledge, beliefs, reports, and autonomy, while [`docs/30-stage1.3-mechanic-execution-boundary.md` on main](https://github.com/necromorphic/Logic-Engine/blob/main/docs/30-stage1.3-mechanic-execution-boundary.md) explicitly says those domain records and behavior are outside its scope.

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
| Unknown vs false for rule context | Opt-in `evaluateConditionResult(...)` exists; trusted completeness/absence evidence is still required | Primitive available; NPC-safe context still blocked |
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

This section supersedes the earlier core-PR status captured during the original source audit.

**Current main:** `8602a9ed41f13f536d87b1103a02e8fd12de3b03`; GitHub Actions Runtime tests run #378 passed on that exact commit.

- PR #45 merged at `2bbdbff4e4d4c4c56601ed5ac18e2083aa99c48b` and supplies the bounded, transaction-consistent internal snapshot read.
- PR #46 merged at `e796896fc40fa8e782f574e13298682a4e6fb813` and supplies the opt-in `evaluateConditionResult(...)` tri-state API while preserving the legacy Boolean evaluator.
- The original stacked PR #47 was closed without merge; its delta was rebased onto updated `main` in PR #49, merged at `8602a9ed41f13f536d87b1103a02e8fd12de3b03`. The current snapshot can include mechanic evaluation inputs and same-snapshot context-manifest expansion with explicit bounds.
- PR #38 remains documentation-only. Its latest head before this refresh was `af4136840d221d811dd2f322bbcf0090563d11a6`; Runtime tests #376 passed on that exact head. This update changes only the audit documentation; its CI is tracked on the resulting branch head.
- The NPC branch diverges from current `main` and has 7 main-side commits not yet incorporated; merge base `9e785a050e8b8acde9a3f343275c4213bbe8d72f`. The ahead count changes with documentation-only work and is not a useful readiness measure. Do not rebase or force-update automatically.

These merges remove two previously recorded core blockers: a consistent bounded snapshot read and an opt-in tri-state condition result. They do **not** implement NPC-specific actor authorization, authorized initial-knowledge provenance, belief persistence, reserved-secret filtering, or a model-safe actor/purpose-scoped context query. The snapshot is raw internal data, not a prompt payload. The tri-state API can distinguish missing from explicitly known-absent paths only when the trusted caller supplies valid absence evidence; it does not decide whether an NPC is permitted to see a value.

The remaining implementation gate is therefore narrower and more concrete: define and verify the trusted actor-to-canonical-entity binding, a real core-owned `author_initial`/imported knowledge source and provenance, the actor/purpose/snapshot filter, and production-path tests proving secret exclusion and proposal non-mutation. Do not create an NPC-local knowledge store or authorization substitute. See `docs/37-npc-kernel-readiness-gate.md` §19 for the full gate sequence and current evidence.


## 8. Core-owner review outcome — 2026-10-24

The core owner returned preliminary decision B: the schema-neutral actor-relative decision-context contract in docs/39 §15 is accepted as an architectural candidate after clarification. This approves the direction only; it does not establish an executable interface or authorize NPC runtime implementation.

The next core-owned work is to define and verify (1) trusted actor-to-canonical-entity binding, (2) a real subject-assigned author_initial/imported acquisition record with provenance and validity, and (3) a snapshot-bound actor/purpose filter that excludes reserved secrets before model input. The NPC branch must not substitute local persistence or authorization. Production-path tests must prove actor separation, provenance, secret exclusion, distinct epistemic/completeness states, stale-snapshot rejection, actual use of the filtered envelope, and proposal non-mutation. See docs/39 §16 and docs/37 §20 for the recorded gate. This audit remains source-level documentation; no runtime tests are claimed by this section.


## Live Core-head reconciliation — 2026-10-24

The current `main` ref is `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`, ten commits beyond the Core head cited in the earlier audit. Source inspection on that head found a Core-owned adapter-to-canonical-actor binding service and API routes, with production-path tests in `tests/actor-binding.test.js`. Therefore actor binding exists on current Core `main`; it is not yet incorporated into `feat/npc-subsystem` and does not itself grant knowledge access.

The acquisition/provenance representation and snapshot-bound pre-model filter remain the critical unimplemented stages in the inspected Core implementation plan. No actor-relative knowledge-read, reserved-secret exclusion, acquisition reconciliation, or NPC decision-context adapter was established by the actor-binding delta. The latest available commit-workflow query did not return PR-triggered runs for the current `main` head, so this note makes no green-CI claim for it.
