# NPC/Core Boundary — Provisional Assumptions and Kernel Readiness Gate

Status: planning note for `feat/npc-subsystem`. The core is still under active development. This document is deliberately provisional and must not be read as a claim that the kernel already implements every principle below.

## 1. Purpose

Prevent the NPC subsystem from freezing assumptions about unfinished core behavior. The NPC work can identify requirements and candidate seams, but it must not force the kernel to adopt unapproved semantics or duplicate mechanisms that the kernel is still developing.

This document is a coordination checklist, not a runtime contract, implementation plan, or acceptance verdict on the core.

## 2. Evidence labels

Use these labels in NPC design notes and reviews:

- **Observed** — directly confirmed in the currently inspected source or tests. State the exact function, route, schema, or test that supports it.
- **Documented target** — described in a core design/contract document, but not necessarily implemented or complete.
- **Candidate seam** — an existing mechanism that might be reused after its contract is confirmed.
- **Open core decision** — semantics are still being designed or have not been confirmed against current core implementation.
- **NPC requirement** — behavior the NPC subsystem needs, without implying the core already supports it.
- **Deferred** — do not implement or test as a kernel guarantee until the owner of the core approves the semantics and implementation exists.

Never silently upgrade a documented target, candidate seam, or NPC requirement into an observed core guarantee.

**Source-of-truth note:** this table is a concise readiness summary, not a substitute for the detailed runtime findings and limitations in `docs/33-npc-runtime-readiness-audit.md`, which is the source of truth for detailed source-level findings. When the summary and source-level audit appear to differ, re-inspect the exact target commit and update both documents; do not treat this summary as independent source evidence. The audit links back here for the concise readiness disposition.

## 3. Current provisional inventory

| Topic | Current label | Safe statement | Do not assume yet |
|---|---|---|---|
| Context manifest | Observed / candidate seam | Existing code registers and persists a manifest with snapshot-related identifiers and references. | That it is a model-ready context, actor-specific access proof, complete knowledge ledger, or immutable binding to the exact model input. |
| Proposal lifecycle | Observed / candidate seam | Existing service can create pending proposals and has approval/commit paths with validation and stale-snapshot checks. | That a valid proposal is semantically faithful, actor-authorized, safe for player agency, or fully causally justified. |
| Canonical state and revisions | Observed, within current APIs | Existing engine owns current canonical event/state operations and revision-related checks. | That every future NPC state category is already represented or that all revision semantics are final. |
| Rollback and causality | Documented target plus partial implementation | Existing code/tests cover some causal invalidation and preservation cases; design docs describe broader goals. | That every causal edge, derived fact, external effect, or future NPC action has complete rollback semantics. |
| Condition evaluation | Observed limitation | Current evaluator returns boolean for the inspected condition path; missing paths can collapse to false for several operators. | That false, unknown, incomplete, inaccessible, and conflicted are already distinct kernel values. Do not change this globally from NPC code. |
| Actor identity and authorization | Open core decision | NPC integration will need a trusted actor identity and a defined authorization boundary. | That adapter identity is the same as in-world actor identity, or that proposal approval is actor authorization. |
| NPC belief and knowledge | NPC requirement / deferred core dependency | NPC behavior must not confuse canonical truth with what a character believes or has learned. | That a canonical NPC belief store, provenance model, or actor-specific knowledge API already exists. |
| Intent-to-effect mapping | Open core/NPC coordination decision | NPC proposals need an explicit mapping to effects the core supports. | That high-level mechanics intents can be sent directly wherever the lower-level validator expects core effects. |
| Player agency | NPC requirement / deferred integration policy | The NPC layer must not invent or commit player-controlled dialogue, thoughts, or decisions. | That a universal player-agency policy already exists in core services. |
| Time progression | Observed only for explicit current paths; wider semantics open | NPC generation must not independently mutate the world clock. | That all chat-turn, event-time, and scheduled-event semantics are complete and final. |

This table is intentionally conservative. Reclassify items only after inspecting the relevant current branch and identifying evidence.

## 4. Test policy while the core is being written

Tests must follow implementation and approved semantics—not the other way around.

### Tier 0 — source facts

May be recorded now: what a named function currently accepts/returns, what a route calls, what a schema validates, and which existing tests exercise it. Mark the inspected commit or branch when practical. These are audit facts, not permanent architectural guarantees.

### Tier 1 — existing-core regression tests

May be run unchanged against the core's current supported Node version. Their purpose is to detect regressions in behavior the core already claims to implement. Do not broaden them to enforce new NPC semantics.

### Tier 2 — proposed semantic tests

Keep as scenarios/specifications only while the relevant kernel principle or owner decision is unsettled. Examples include tri-state knowledge, actor-specific access, causal ownership for NPC actions, and complete player-agency enforcement. Do not implement fake services just to make these tests pass.

### Tier 3 — integration acceptance tests

Write only after:
1. the kernel owner has agreed on the relevant semantics;
2. a real implementation boundary exists;
3. its inputs, outputs, errors, and ownership are documented;
4. the test can exercise real code rather than a mock that assumes the desired result.

### Tier 4 — persistence/API tests

Do not add or change these from the NPC branch unless the core owner explicitly approves API, schema, or storage changes.

## 5. Review protocol for every proposed NPC test

Before converting a scenario into an executable test, answer:

1. Is the expected behavior already implemented, merely documented, or still proposed?
2. Which exact source function or existing test proves that status?
3. Is the behavior owned by core, NPC subsystem, or their integration adapter?
4. Would this test require a new core principle or change existing global semantics?
5. Could the same behavior be tested at a narrower layer without mocking an unimplemented system?
6. Has the relevant design decision been approved by the core owner?
7. If the answer is uncertain, can the scenario remain a documented requirement rather than an executable test for now?

A test must not fail the kernel for not implementing a future principle that has not been agreed or delivered. Conversely, a passing mock-based test must not be presented as proof that the real boundary is safe.

## 6. Current next step

Do not add runtime code or new executable NPC tests at this stage. Maintain the semantic scenarios as requirements, continue source-level discovery, and classify each proposed test using the evidence labels above.

The next implementation step should be chosen only after the kernel's current work and decisions are checked again. If the core changes, update this inventory rather than treating this note as authority over the core.


## 7. Active core work discovered during source-level review

This subsection began as a time-bounded branch snapshot and is retained as historical context; its original `main` SHA and branch locations below are not current-status claims. The universal mechanic contract has since appeared in `main`, as reflected in the corrected row below. Re-check current branch heads and PR dependencies before relying on any other branch-status detail.

| Area | Observed development location | Safe interpretation for NPC work |
|---|---|---|
| Universal mechanic execution | `main` contains [`docs/30-stage1.3-mechanic-execution-boundary.md` on main](https://github.com/necromorphic/Logic-Engine/blob/main/docs/30-stage1.3-mechanic-execution-boundary.md) | The contract is now present in the inspected main line as a documented target for a future core vertical slice. It is not evidence that the full execution pipeline is implemented. Its scope explicitly excludes NPC goals, plans, schedules, and off-screen autonomy. |
| Mechanic intent translation and proposal integration | `feat/mechanic-effect-translator`, `docs/mechanic-intent-proposal-boundary`, and `feat/mechanic-intent-proposal-integration`; PRs #36–#40 form a stacked sequence | Translation and proposal integration are being developed with tests and explicit fail-closed limits. Keep the stack's dependencies and unresolved decisions intact; do not create a second translator in the NPC subsystem or assume these changes are already in `main`. |
| Typed causal links | `feat/typed-causal-links` | A separate implementation/test line exists. Because it diverges from `main`, its exact semantics must be reviewed against current core decisions before NPC work depends on them. |
| Historical tri-state predicates | `feat/tri-state-historical-fact-predicates` | Work exists around historical predicate uncertainty. This does not prove that general rule evaluation has a universal tri-state result; keep the observed boolean behavior of the inspected `main` path distinct from branch-specific behavior. |
| Generation-bound context manifests | `feat/generation-bound-context-manifests` | A separate line develops manifest binding and persistence behavior. Do not assume that the `main` manifest is already immutably bound to the exact model input or that it proves actor-specific access. |
| Proposal validation before approval | `feat/validate-proposals-before-approval` | A separate proposal-lifecycle change exists. Re-check its current diff and dependencies before asserting where validation occurs in the final lifecycle. |

### Consequences for NPC planning

1. Use `main` to state what is currently shipped; use a feature branch only as evidence that work is in progress.
2. Do not copy code, tests, or assumptions from a diverged branch into the NPC branch without first checking its current PR, base, dependency stack, and approved contract.
3. Treat mechanic intent translation as a potential shared core capability, not an NPC-owned implementation. The NPC subsystem should express its needs and wait for the agreed boundary rather than fork the translator.
4. Keep open questions—especially provenance mapping, canonical fact identity/replacement semantics, actor authorization, and the general meaning of unknown/incomplete context—open until the relevant core owner resolves them.
5. This branch inventory is evidence for coordination only. It does not authorize merges, rebases, API/storage changes, or runtime implementation.


## 8. NPC dependency decision: mechanic-intent PR stack

This section classifies the current mechanic-intent stack by whether it is a prerequisite for the NPC subsystem. It does not approve or request merging those PRs.

| PR / work | What it contributes | NPC dependency decision |
|---|---|---|
| #36 — translator contract | Proposed narrow, pure mapping from a small set of mechanic intents to canonical effects; explicit unsupported-intent and provenance behavior | Relevant contract if NPC/mechanics will submit high-level intents. Not a prerequisite for defining NPC context, goals, knowledge, or behavior semantics. Review the mapping contract before any consumer depends on it. |
| #37 — translator implementation | Pure bounded translator with batch validation; current candidate kinds are `create_entity`, `update_attribute`, and `assert_fact` | Shared core candidate, not NPC-owned code. Its support set does not cover NPC goals, plans, knowledge, beliefs, relations, or player-agency policy. Do not expand the translator from the NPC branch. |
| #39 — integration boundary | Proposed `effects` versus `effect_intents` request boundary and non-mutation requirements | Relevant if the NPC adapter submits intent batches through the existing proposal service. Preserve the existing proposal/approval/commit lifecycle; no separate NPC commit route. |
| #40 — proposal lifecycle integration | Integrates translation into `ProposalService.create`; described tests cover translation failures, lifecycle, idempotency, and non-mutation | Potential integration dependency for an NPC action-proposal path, but not proof of actor-specific authorization or semantic validity. Re-check the PR's current head, base, dependency status, and checks before relying on it. |

### Specific unresolved boundary found in source review

The candidate translator maps `assert_fact` to canonical `fact.set` using the intent's `target_ref` as `fact_id`. The contract explicitly leaves canonical fact identity/replacement semantics unresolved. Therefore NPC work must not assume that an asserted fact creates a new fact, replaces an old one, retracts a previous value, or establishes provenance. Non-empty intent-level `source_refs` and `caused_by` are rejected until an approved mapping exists. Keep both limitations visible to any future NPC adapter.

The proposed integration still does not provide the first NPC vertical slice's missing trusted actor-relative context builder. It does not establish which information a specific NPC knows or may access, distinguish canonical truth from an NPC's false belief, or enforce player-agency rules. A valid translated proposal is only a candidate for the ordinary proposal lifecycle, not authorization to commit a narrative action.

### Recommended order of work

1. Continue the NPC semantic contract and context requirements without waiting for the translator stack to settle.
2. Track #36–#40 as a shared-core dependency only for the future intent-to-proposal handoff; do not duplicate their code or add NPC-only effect kinds.
3. Before integrating, confirm the stack's actual merge order and latest CI/review state, then verify the final API contract against the approved core implementation.
4. Separately define the actor-relative context preparation boundary and its failure behavior. Keep executable NPC integration tests deferred until that real boundary and its semantics exist.
5. Revisit fact identity/provenance only through the core decision process, not by silently filling the gaps in NPC code.

## 9. Non-authority statement

This document does not amend the kernel contract, freeze its architecture, require a new knowledge/access-control subsystem, or authorize changes to runtime code, API, schemas, storage, event semantics, rollback, prompts, or SillyTavern. It exists to keep the NPC branch aligned with the evolving core.


## 10. Author-directed outcomes do not override kernel safety

The author-confirmed NPC decision record and acceptance matrix now distinguish three separate things:

1. **Required story outcome** — an explicit author instruction that must not be silently cancelled merely because an NPC would ordinarily choose differently, provided it does not conflict with higher-priority constraints or player agency.
2. **Prospective causal path** — plausible future circumstances/actions that may be proposed when existing circumstances do not yet justify the outcome. These remain prospective, not canonical history.
3. **Committed world event** — an effect accepted through the core's existing validation, approval, and commit path.

A missing rationale must remain visible; it must not be replaced by fabricated past evidence or used as a silent reason to discard the required outcome. If a credible path cannot yet be grounded, preserve the required target and mark the causal gap for review. None of this authorizes bypassing core validation or inventing player-controlled actions.

This is an NPC semantic requirement, not a new kernel guarantee. It does not resolve the open core questions around actor-relative context, intent/effect mapping, causal completeness, or rollback ownership. See `docs/31-npc-subsystem-contract.md` section 10, `docs/34-npc-decision-context-and-proposal.md` section 10.6, and NPC-SEM-013–014 in `docs/32-npc-semantic-acceptance-matrix.md`.


## 11. Knowledge ownership: architecture target versus current runtime

The core owner has now **confirmed the semantic ownership** stated in the architecture documents: the core owns authoritative acquisition/provenance, delivery-attempt/receipt status, source-validity reconciliation, and persistent subject-relative belief state. This is an approved ownership decision, not an observed runtime capability: the current source audit did not find a complete NPC knowledge/acquisition API or persistent belief model.

The responsibilities must remain separate:
- The core is the confirmed semantic authority for acquisition/provenance, delivery/receipt, source reconciliation, and persistent belief; the corresponding complete production interfaces are not yet verified.
- A trusted context-preparation caller selects and filters a decision-time subset for a particular actor using approved access and acquisition evidence.
- The NPC decision step may reason over that supplied context but cannot create authoritative knowledge by retrieval, prompt inclusion, or generated prose.

Do not describe the trusted caller as the canonical knowledge owner, and do not create an NPC-side substitute store. The core owner has confirmed the semantic ownership target in `docs/39`. Before implementation, reconcile that target with current or planned core interfaces and record which capabilities remain deferred; do not treat semantic approval as proof of an implemented API or runtime.


## 12. Knowledge and delivery contract proposal — 2026-10-24

`docs/39-npc-core-knowledge-contract-proposal.md` records the core owner's approved semantic contract for core-owned acquisition/provenance, belief-state boundaries, delivery evidence, actor-specific context queries, and reconciliation after source invalidation.

The ownership semantics are confirmed; this is not an implementation or an approved public API. The document explicitly:
- reuses existing core identities and causal/rollback mechanisms rather than adding parallel ones;
- treats canonical events, context manifests, and proposal records as useful but insufficient infrastructure;
- records core ownership of persistent subject-relative belief state as semantically confirmed, while noting that the runtime/API boundary and persistence are not verified;
- defers API, schema, SQLite, runtime, host-delivery, and end-to-end test work until the approved semantics are mapped to real production interfaces and separately authorized where required.

The current evidence status is unchanged: no complete actor-specific acquisition/query contract has been verified in the inspected runtime. The proposal's acceptance criteria are future test targets, not test results.


## 13. Optional social identities — readiness gate

`docs/40-npc-social-identities-editor-contract.md` defines an author-requested optional character-editor capability for social identities and cover biographies. The feature is one underlying character using multiple social representations, not multiple psychological personalities and not multiple NPCs by default.

The proposed editor fields include claimed identity/biography, appearance differences, references to documents/evidence, rationale, vulnerabilities/contradictions, and free notes. They are optional and must distinguish author declarations from canonical facts and verified world references.

Readiness status:
- **Architecture alignment:** consistent with `docs/23-character-and-control-architecture.md`, which treats a character card as a structured view over canonical records and leaves final fields/UI open.
- **Current implementation:** no social-identity editor or runtime model has been verified by this audit.
- **Canonical boundaries:** author profile entries must not silently create entities, documents, relationships, events, or disclosure/knowledge records.
- **Knowledge boundary:** creating a cover does not make other characters aware; actor-specific filtering remains dependent on the future core-owned knowledge/context contract.
- **Deferred:** editor UI, profile serialization, entity references, document status, activation rules, runtime identity selection, investigation consequences, and integration tests until actual interfaces are identified and approved.

This proposal does not authorize runtime, API, schema, SQLite, prompt, vectorization, or host-adapter changes. No parallel identity-truth, knowledge, event, revision, access-control, or rollback mechanism may be created.


## 14. Core-owner response received: knowledge contract

On 2026-10-24, the core owner reviewed all eight questions in `docs/39-npc-core-knowledge-contract-proposal.md`. The decision is recorded there. Current readiness classification:

- **Semantics confirmed:** core owns acquisition/provenance, delivery-attempt/receipt status, source-validity reconciliation, and persistent subject-relative belief state. Acquisition, belief, and canonical truth are separate.
- **Existing identifiers confirmed for reuse:** `world_id`, `entity_id`, `event_id`, `fact_id`, `context_manifest_id`, `generation_id`, and the consistent snapshot pair `(world_revision, commit_sequence)`.
- **First slice direction confirmed:** only explicitly authorized author-initial/imported initial knowledge; an internal actor/purpose/snapshot-scoped read/filter contract; reserved-secret exclusion; separation tests and proposal non-mutation.
- **Still unimplemented/unverified:** the actor-specific read/filter interface, initial-source representation at a real production boundary, persistent acquisition/belief integration, supported host rendering signal, and end-to-end tests. Direct observation, communication, documents, inference, and rumor remain out of scope for the first slice.
- **No authorization implied:** no public endpoint, schema, SQLite, vectorization, prompt, host adapter, or runtime change is authorized by the semantic decision alone.

The next engineering action is to reconcile the confirmed contract with actual source/test boundaries, then propose the narrow internal interface and acceptance tests before any implementation.

**Snapshot dependency note (historical status superseded by §19):** PR #45 was subsequently merged into `main`; `LogicEngine.getSnapshot(...)` is now a real internal bounded snapshot primitive. The snapshot still does not provide actor-specific authorization, a trusted secret/access policy source, authorized initial-knowledge representation/provenance, persistent belief/delivery records, or NPC acceptance tests.

## 15. Refreshed main-branch boundary audit — 2026-10-24

This section supersedes the older time-bounded inventory in §7 where the two differ. The live main ref was re-compared with this branch during the original refresh: main was at `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`; see §19 for the later current main SHA and divergence count. No rebase or merge was performed as part of this audit.

The intervening main changes add or revise core contracts and mechanic-effect support documentation. The following distinctions now govern NPC planning:

- `docs/27-proposal-to-commit-boundary.md` describes the current proposal lifecycle more precisely: proposal creation uses rollback-only validation and does not mutate canonical world state; commit requires approval and rechecks staleness. This still does not establish named NPC actor authorization, complete semantic alignment, causal completeness, or player-agency policy.
- [`docs/30-stage1.3-mechanic-execution-boundary.md` on main](https://github.com/necromorphic/Logic-Engine/blob/main/docs/30-stage1.3-mechanic-execution-boundary.md) defines a core-only next-slice contract for deterministic mechanic evaluation on one consistent snapshot. It explicitly excludes NPC goals, knowledge, schedules, decision-making, and off-screen autonomy; the contract is not itself proof that the evaluator is shipped.
- [`docs/31-mechanic-effect-intent-support-matrix.md` on main](https://github.com/necromorphic/Logic-Engine/blob/main/docs/31-mechanic-effect-intent-support-matrix.md) explicitly lists knowledge operations, generic relationship operations, and goal/task management as unsupported by the current canonical effect validator. Relationship state must not be smuggled through arbitrary attributes or generic `fact.set` as a substitute for a typed contract.
- PR #45 (consistent snapshot read) has since merged; PR #32 (character-card projection) remains an open Draft. The snapshot is now available on `main` but remains only a read-consistency primitive, not actor authorization. PR #32's current projection remains minimal and does not supply relationship summaries or actor authorization.
- PRs #40 and #43 remain open Drafts in a stacked mechanic-intent integration chain. Do not treat the translator/proposal integration or canonical fact-identity guard as available on `main` solely because the PRs exist.
- `docs/44-npc-relationship-semantic-acceptance.md` now specifies fourteen relationship cases, and `docs/45-npc-relationship-typed-operation-design.md` provides a schema-neutral proposal distinguishing required causal dependencies from alternative support. Neither document constitutes runtime or schema approval.

**Implementation gate unchanged:** semantic knowledge ownership is agreed, but the real authorized initial-knowledge representation, persistent acquisition/belief records, trusted actor/purpose/snapshot read filter, and observable delivery evidence are not verified as available. Typed relationship mutation, participant resolution, bounded authorized reads/projection, and multi-cause rollback reconciliation are also not available as an integrated NPC capability. Continue documentation/test-boundary work only; do not make NPC runtime or storage changes based on the newer core documents alone.


## 16. Next execution queue — first NPC vertical slice (2026-10-24)

This queue is deliberately ordered by dependency. It is not permission to implement core-owned runtime, API, or storage changes from the NPC branch. Update the queue only when a real core contract or implementation changes the evidence.

### Slice target

The first useful vertical slice is **one named canonical NPC receiving a bounded, authorized decision context built from explicitly authorized author-initial/imported knowledge, then returning a non-committing proposal**. It must not yet persist general observation, communication, inference, rumor, belief changes, relationships, goals, schedules, or off-screen world effects.

### Ordered gates

| Order | Gate / owner | Required evidence before proceeding | If absent |
|---|---|---|---|
| 1 | Consistent canonical snapshot — core | `main` now includes the bounded `getSnapshot(...)` read plus the mechanic/context snapshot extension from merged PR #49; verify the composite marker and bounded fail-closed behavior on the exact target commit before consuming it. | Do not assemble a decision snapshot from unrelated raw reads; raw snapshot output is not model-safe. |
| 2 | Trusted actor binding — core + host adapter | A real, trusted mapping from the decision subject to an existing canonical entity, and a declared purpose; neither may be accepted as an untrusted model-supplied identity. | Reject the request as unsupported; do not infer identity from display name/card text. |
| 3 | Initial acquisition representation — core | Executable, audited record for explicitly authorized author-initial/imported knowledge, with canonical source references and explicit ownership; the contract in docs/39 §4.1 must be approved against real code. | Do not treat profile text, retrieval, manifest inclusion, or prompt text as acquired knowledge. |
| 4 | Actor/purpose/snapshot filter — core | A bounded result tied to the same (world_revision, commit_sequence) marker, preserving known, unknown/unset, withheld, and incomplete/unsupported distinctly and excluding restricted content before model input. | Raw snapshot rows must not enter any NPC, narrator, player, or host-visible context. |
| 5 | Condition evaluation semantics — core | `evaluateConditionResult(...)` is now available on `main` as an opt-in tri-state API; callers must provide `knownAbsentPaths` only when absence is proven by the same trusted context and must not use legacy Boolean evaluation for incomplete actor context. | No NPC decision may depend on a false result produced by missing data; the tri-state API does not itself authorize context. |
| 6 | Proposal-only NPC adapter — NPC/integration | Build a pure adapter over the approved filtered envelope and existing proposal lifecycle. It can propose only supported existing effects and cannot commit, mutate belief/acquisition, or bypass approval. | Keep the output as a non-persistent draft/specification; do not add an NPC-owned proposal store. |
| 7 | Production-path acceptance — shared | Tests invoke the real actor binding, authorized read/filter, context builder, and proposal creation path; assert source references, state-before/state-after, snapshot marker, excluded secrets, and no mutation. | Unit mocks can help design but cannot mark the slice integrated or ready. |

### Implementation rule

Do not treat this queue as a requirement to land all gates in one PR. Core-owned work should stay in the core's reviewed branch/PR; NPC-specific work should consume only merged or explicitly approved stable interfaces. Keep the first NPC slice small enough that every visible claim can be traced to authorized source evidence.

The snapshot primitive is necessary but not sufficient. In particular, it does not by itself solve actor/entity binding, acquisition, belief, delivery, authorization, or safe condition evaluation. The relationship typed-operation design in docs/45-npc-relationship-typed-operation-design.md is a separate later capability and must not be pulled into the first knowledge slice merely because both need snapshots.


## 17. Concrete condition-evaluator blocker — source evidence (2026-10-24)

This section records the exact limitation observed in `main` at `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`, file `src/core/rules.js`. Re-inspect before using this as evidence for a later commit.

### Observed behavior

- `readPath(...)` returns `{ exists: false }` when any path segment is absent.
- For `exists`, `evaluateCondition(...)` returns `found.exists === (rule.value ?? true)`. Therefore a missing path evaluates to ordinary `false` for `exists: true` and ordinary `true` for `exists: false`, regardless of whether the caller knows that the field is absent or merely lacks the relevant context.
- For `eq`, `neq`, comparisons, and `in`, a missing path returns ordinary `false` before comparing the requested value. Thus `neq` does not return true for a missing path, but the result still loses the distinction between unknown and a known non-match.
- `all` and `any` reduce nested results with JavaScript boolean aggregation; `not` negates the nested boolean. A missing-path false can therefore turn into true under `not`, and affect parent `all`/`any` as an ordinary Boolean.
- The evaluator's return type is Boolean on this path; no `unknown`, `withheld`, or `incomplete` result is propagated by these functions.

### Consequence for the first NPC slice

Do not use the current generic evaluator to decide an NPC action when any required path might be absent because the actor-relative context is incomplete, withheld, or not yet represented. In particular, wrapping a missing-path predicate in `not` is unsafe as a substitute for evidence that the predicate is false.

Until the core owner approves and implements a compatible result contract, a first-slice caller must either (a) prove that every evaluated path is present and authorized in the supplied decision envelope before evaluation, or (b) return `needs_review`/no executable proposal without evaluating the incomplete condition. The caller must not patch global semantics in NPC code, monkey-patch the evaluator, or invent a second condition engine.

### Core-owned acceptance criteria for a future change

1. Specify how a known-absent field differs from a field unavailable because context is incomplete, withheld, stale, or unsupported.
2. Define propagation rules for `eq`, `neq`, `exists`, numeric comparisons, `in`, `all`, `any`, and `not`; document whether compatibility requires a separate tri-state API rather than changing existing Boolean callers.
3. Test missing-path behavior both directly and under `not`, `all`, and `any`, including nested conditions.
4. Prove that existing non-NPC rule callers preserve their current intended behavior or are explicitly migrated under core review.
5. Keep the source-level observation, the proposed semantics, and test evidence labelled separately; a design note or mocked test is not implementation proof.

### Cross-check against the current core execution contract

The current `main` also contains [`docs/30-stage1.3-mechanic-execution-boundary.md` on main](https://github.com/necromorphic/Logic-Engine/blob/main/docs/30-stage1.3-mechanic-execution-boundary.md) (reviewed at `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`). Its target contract requires missing/inaccessible context to produce `unknown` rather than silently treating it as false, and requires rule support to be reconciled across schema, validator, and evaluator. This aligns with the NPC gate above, but it is a design/implementation contract for a future mechanic-evaluation slice—not evidence that the generic `evaluateCondition(...)` function already returns tri-state results. The inspected `src/core/rules.js` still returns booleans for the operators and nested combinators described above. Keep the NPC first slice blocked unless the actual production path used by that slice can prove complete, authorized inputs or return a safe unknown/review result.

This is a source-backed integration blocker, not an authorization to change `src/core/rules.js` from the NPC branch.

**Unmerged core candidates as of this review:** PR #46 proposes an opt-in `evaluateConditionResult(...)` API that returns tri-state results while preserving the legacy Boolean evaluator; PR #47 extends the bounded snapshot in PR #45 to include the mechanic instance set, exact pinned definitions, and explicitly requested context manifests in one read transaction; current manifests expand their referenced entity/fact/event rows, while stale manifests do not. These are candidate core primitives, not capabilities on `main`, and neither supplies the actor/purpose authorization or model-safe filtering required by the NPC slice. Re-check exact heads and CI before depending on them.


### Additional source cross-check: mechanic contract versus runtime

The contract/runtime distinction applies to the execution pipeline as a whole, not only to tri-state conditions:

- The inspected `src/core/mechanics.js` exports mechanic-template and rule-module-manifest validators. These validate declared shapes and supported operator names; they do not execute an active mechanic set, select applicable instances, resolve conflicts, produce the structured Stage 1.3 result, or hand a result to the proposal lifecycle.
- The inspected `src/core/rules.js` evaluates an individual declarative condition to a Boolean. It is not by itself the Stage 1.3 application service described by `docs/30`.
- The schema/operator matrix tests verify that schema, validator, and evaluator agree on the currently supported operator vocabulary. They do not prove that the broader mechanic execution pipeline exists. The source audit also found that `mechanic-instance.schema.json` permits `needs_review`, while the current SQLite status constraint and event-backed lifecycle only support `disabled`/`enabled`; do not treat a durable review-state transition as available.

Therefore `docs/30` is a core implementation contract, while the current source exposes lower-level validation and condition-evaluation pieces. Do not report Stage 1.3 execution as implemented or begin NPC runtime integration on the assumption that the documented pipeline exists. This is a source-level finding and should be rechecked against the exact target commit before implementation.

## 18. Live dependency refresh — exact PR heads (2026-10-24)

This refresh supersedes any older PR-status wording above, but does not change the readiness decision. Repository status and CI were queried during this review.

| Dependency | Current state | Evidence | NPC consequence |
|---|---|---|---|
| PR #45 — consistent internal snapshot | Open, ready for review, unmerged; head `09e48c2fd764c8e3f7b1e8f96e485a58ea34c793`; Runtime tests run #310 passed on that exact head | The API remains internal and read-only; it does not filter by actor or authorize knowledge | Required read primitive is still not on `main` |
| PR #47 — mechanic/context snapshot extension | Open, ready for review, unmerged; based on PR #45 at `09e48c2fd764c8e3f7b1e8f96e485a58ea34c793`; head `3417a28f8a99663a9834f733bb842558259bc2e4`; Runtime tests run #370 passed on test head `ba701653b4fa629bde26c1188173039c08de993f` | Same-transaction mechanic state and requested context-manifest expansion, bounded fail-closed read | Must follow #45; still not actor authorization or model-safe projection |
| PR #46 — tri-state condition result | Open, ready for review, unmerged; head `a35f9fd20bff9a21ce5faa3c55f42ae350984651`; Runtime tests run #341 passed on code/test head `f5ff93a79d9f9a84bb3bf602d36bd47360c3aa09` | Opt-in `evaluateConditionResult(...)`; later commits are contract/audit-only | Candidate primitive only; not available on `main` until integrated |
| PR #38 — NPC contract/audit | Open, ready for review, unmerged; head `9d7a2eaa22188b74f839fa0c7762d38547752cdf`; Runtime tests run #365 passed on that exact documentation-only head | Docs and source-level audit only; no NPC runtime code | Passing CI does not mean the NPC vertical slice is implemented |

The NPC branch is three commits behind `main` at `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`. Do not rebase, merge, or force-update the branch as routine cleanup. Reconcile the intervening core commits deliberately before any integration claim.

**Current blocker remains unchanged:** even if #45, #47, and #46 are accepted, the first NPC slice still needs trusted actor-to-canonical-entity binding, a real authorized initial-knowledge/source representation, actor/purpose-scoped filtering that excludes reserved secrets before model input, and production-path acceptance tests. No implementation branch should invent those as NPC-local persistence or authorization.

## 19. Core dependency recheck after merges — 2026-10-24

This section supersedes the older live-status statements in §§15, 16, 17, and 18 where they describe current `main` or open PR state. Historical source observations remain tied to their stated commit and should not be read as current status.

**Current main:** `8602a9ed41f13f536d87b1103a02e8fd12de3b03`. GitHub Actions Runtime tests run #378 passed on this exact main commit.

- PR #45 (consistent internal snapshot) merged at `2bbdbff4e4d4c4c56601ed5ac18e2083aa99c48b`.
- PR #46 (opt-in tri-state condition result API) merged at `e796896fc40fa8e782f574e13298682a4e6fb813`.
- The original stacked PR #47 was closed without merge. Its reviewed delta was rebased onto the updated main line in PR #49, which merged at `8602a9ed41f13f536d87b1103a02e8fd12de3b03`. The current snapshot implementation includes bounded context-manifest expansion and optional mechanic-evaluation inputs in the same read transaction.
- The NPC branch diverges from `main` and has 7 main-side commits not yet incorporated; merge base `9e785a050e8b8acde9a3f343275c4213bbe8d72f`. The ahead count changes with documentation-only work and is not a useful readiness measure. Do not auto-rebase or force-update; reconcile the seven main-side commits deliberately before integration.

### What these merges unblock

1. **Consistent read primitive:** available on `main` via `LogicEngine.getSnapshot(...)`; it is internal, bounded, read-only, and transactionally consistent. It does not produce a model-safe projection.
2. **Tri-state condition primitive:** `evaluateConditionResult(...)` is available without changing legacy `evaluateCondition(...)` callers. Missing paths remain unknown unless the trusted caller explicitly establishes known absence. This does not solve whether an NPC is allowed to see a value.
3. **Mechanic/context snapshot inputs:** the current snapshot can optionally include pinned mechanic definitions and explicitly requested context manifests, with same-snapshot expansion and fail-closed bounds. This is not an NPC knowledge store, actor filter, or authorization mechanism.

### Remaining hard blockers for the NPC first slice

- A trusted binding from the in-world actor to a canonical `entity_id`, distinct from the adapter's authenticated identity.
- A real, reviewed representation of explicitly authorized `author_initial`/imported knowledge and its provenance.
- A core-owned actor/purpose/snapshot-scoped filter that excludes reserved secrets before any model-visible context is assembled, and returns unknown/withheld/incomplete distinctly.
- A production-path NPC adapter that uses the actual filtered envelope, invokes only supported effects, and produces a non-committing proposal.
- End-to-end tests against those real interfaces, including actor separation, provenance, reserved-secret exclusion, stale snapshot handling, and proof that proposal creation does not mutate canonical or knowledge state.

**Next work:** continue NPC contract-to-source reconciliation against the current main commit and keep implementation blocked only on the actual missing actor/knowledge/filter boundary—not on the now-merged snapshot or tri-state primitives. Do not create NPC-local persistence or authorization as a workaround.


## 20. Core review outcome — contract accepted with implementation gates (2026-10-24)

The core owner returned preliminary decision **B**: the candidate decision-context contract in docs/39 §15 is architecturally acceptable after concrete clarification. This does not mean the interface is implemented or that NPC runtime work may begin.

The review confirms three linked core-owned prerequisites:

1. **Trusted actor binding:** resolve the authenticated integration call to a canonical actor entity through a trusted boundary; adapter ID and model output are not actor identity.
2. **Initial acquisition representation:** add a minimal core-owned representation for explicitly authorized author_initial/imported knowledge, including subject assignment, canonical source/provenance, and validity. The exact event/projection/storage model remains for core design; do not create NPC-local persistence.
3. **Snapshot-bound context filtering:** select authorized information for the resolved actor and bounded purpose against one exact snapshot marker; exclude reserved secrets before serialization; preserve unknown, known absent, withheld, incomplete, and unsupported distinctions; fail closed without a raw snapshot fallback.

### Current work decision

- Keep PR #38 documentation-only and unmerged; do not present its green CI as NPC runtime readiness.
- Do not start the NPC adapter/runtime until the three core interfaces are mapped to actual implementation and the production-path tests below exist.
- Core-owned runtime/API/schema/storage changes belong in a core-reviewed branch/PR. The NPC branch may continue contract/source reconciliation but must not supply substitute authorization or knowledge storage.
- getSnapshot(...), evaluateConditionResult(...), context manifests, and ProposalService.create(...) remain useful primitives, not substitutes for the three missing contracts.
- Proposal creation is non-committing for canonical world state/revision/commit sequence, but writes proposal/audit state. Tests must separately prove no acquisition, belief, or delivery mutation once those real records exist.

### Acceptance evidence required

Production-path tests must demonstrate actor separation and anti-substitution; subject-specific initial acquisition with provenance; secret exclusion before model input; distinct epistemic/completeness outcomes; one-snapshot consistency and stale rejection; actual adapter use of the filtered envelope; and proposal creation that leaves canonical and knowledge-related state unchanged. No mocks may stand in for missing production semantics.

The detailed decision and the schema-neutral clarification are recorded in docs/39 §16. Historical dependency/status notes above remain historical; use §19 for the last recorded main-branch dependency check and re-verify live refs before any future integration.


## 21. Authoring, correction, and card-summary work — 2026-10-24

The NPC branch has a schema-neutral semantic contract in `docs/46-npc-authoring-correction-and-card-summary-contract.md`, cross-referenced from the normative contract, semantic matrix, and test-boundary map.

It closes authoring-level specification gaps without claiming implementation:
- author profile/configuration corrections are distinct from canonical world corrections and in-world events;
- canonical correction does not automatically teach an NPC or rewrite subject belief;
- unknown/unset, explicit neutral, known absent, withheld, incomplete, unsupported, and conflicted remain distinct;
- character cards are lossy views, not authority; omission is not evidence of absence; stale summaries must not outrank current source records;
- reserved editorial secrets require a verified pre-model filter;
- an author-requested future outcome remains distinct from a committed event.

The ten cases NPC-AUTH-001–010 are mapped in `docs/35-npc-test-boundary-map.md`. Cases needing an editor, actor-relative filter, core acquisition/belief records, approved card projection, or author-intent arbitration remain blocked until those real production boundaries exist. No mocks, runtime code, API/schema/storage changes, or core changes were added.


## 22. Multi-step causal rollback/reconciliation gate — 2026-10-24

`docs/47-npc-causal-rollback-reconciliation-test-matrix.md` defines NPC-CAUSE-001–008, including the important sequence where a new source is committed only after an earlier rollback and reconciliation have completed. This sequence must be tested as separate production operations with state and snapshot markers recorded between steps; a single batch test can conceal stale-state and resurrection defects.

The test-boundary map in `docs/35-npc-test-boundary-map.md` marks these cases blocked. This is intentional: current `caused_by` / `depends_on` must not be assumed to express alternative-support sufficiency. Independent support, source deduplication, knowledge-source reconciliation, deterministic replay, and actual authorized consumer refresh need core-owned semantics and real production-path evidence. No NPC-local causal graph, rollback journal, or knowledge store may be introduced to bypass these gates.


## 23. Cross-document status correction and dependency consistency — 2026-10-24

This section is the current status reference for older dependency tables elsewhere in this document and in the NPC design notes. Historical tables above preserve what was known at the time; do not use their old PR-state labels as current facts.

- **PR #45** (consistent internal snapshot) merged into `main` at `2bbdbff4e4d4c4c56601ed5ac18e2083aa99c48b`.
- **PR #46** (opt-in tri-state condition results) merged into `main` at `e796896fc40fa8e782f574e13298682a4e6fb813`.
- **PR #47** closed without merge; its reviewed delta was rebased and merged through **PR #49** at `8602a9ed41f13f536d87b1103a02e8fd12de3b03`, adding the mechanic/context snapshot extension.
- The last verified core `main` commit recorded in this audit is `8602a9ed41f13f536d87b1103a02e8fd12de3b03`, with Runtime tests run #378 passing on that exact commit. Recheck current GitHub state before any later integration.
- **PR #32** (minimal character-card projector) is closed without merge. Its proposed projection is not an available dependency by virtue of its former PR existing.
- **PR #38** was closed without merge at `2026-10-24T02:05:19Z`. The `feat/npc-subsystem` branch and its documentation commits remain separate from `main`; this status update does not reopen the PR or authorize a replacement PR. The NPC branch has not incorporated the seven main-side commits recorded at this audit; no automatic rebase, force-update, or merge has been performed.

The merged snapshot and tri-state primitives reduce specific core gaps, but they do not supply trusted actor binding, authorized per-NPC initial acquisition/provenance, an actor/purpose/snapshot-bound pre-model secret filter, persistent belief/delivery semantics, typed relationship operations, or alternative-support reconciliation. Those remain implementation gates. Passing general core CI is not proof of NPC readiness.

Cross-document corrections made in this pass: `docs/35` no longer describes PR #45 as open/unmerged; `docs/42` now distinguishes the merged core dependency from its absence in the unreconciled NPC branch and correctly records PR #32 as closed without merge. Continue to treat `docs/33` as the source-level audit, `docs/35` as the test-boundary map, and this document as the concise readiness/status reference.


## 24. Delivery/acquisition evidence gate — 2026-10-24

`docs/48-npc-delivery-acquisition-boundary-matrix.md` defines NPC-DELIV-001–010 and `docs/35-npc-test-boundary-map.md` maps them to implementation boundaries. The key invariant is that payload preparation, delivery attempt, host acceptance, visible rendering, acknowledgement, comprehension, acquisition, belief, and canonical truth are separate states with separate evidence thresholds.

Core review already confirmed that host injection without a documented rendering signal remains `injected_unconfirmed`; `shown` remains unsupported until a real host signal is identified and verified. The first NPC slice therefore cannot claim communication-based acquisition. No local delivery store, inferred receipt, or mock-host success path may be added on the NPC branch.


## 25. Live branch and verification status — 2026-10-24

This is the latest repository-state check for the NPC documentation branch. It supersedes earlier branch-divergence counts and must be refreshed before integration work.

- **NPC branch head at the latest verification:** `0e364347563a1f4bd1dbf6bae80118c5824135b6`.
- **PR #38:** closed without merge; no replacement PR has been opened by this work.
- **Comparison against current `main`:** GitHub reports the refs as diverged, with merge base `9e785a050e8b8acde9a3f343275c4213bbe8d72f`, 17 commits behind `main`, and 175 commits ahead on the NPC branch. The compare response lists the NPC-specific difference as documentation files `docs/31` through `docs/48` (17 files); the high ahead count reflects the branch's documentation history and is not evidence of runtime implementation.
- **Workflow evidence:** the available commit-workflow query returned no PR-triggered workflow runs associated with `0e364347563a1f4bd1dbf6bae80118c5824135b6`. This query is limited to PR-triggered runs, so the result is **not** proof that no workflow ran; it is also not green-CI evidence for this exact head.
- **Change boundary:** this branch work remains NPC documentation/contracts/test-boundary design only. No core source, public API, schema, storage, or NPC runtime implementation was added by this status audit.

**Decision:** do not rebase, merge, force-update, reopen PR #38, or create a replacement PR as part of this pass. Continue only with NPC-owned contract reconciliation and evidence mapping. Before any integration, compare the exact current core and NPC refs, reconcile the 17 core-side commits deliberately, and verify CI on the exact proposed integration head.


## 26. Reconciliation against the newer Core head — 2026-10-24

A fresh comparison found that `main` has advanced ten commits beyond the previously audited `8602a9ed41f13f536d87b1103a02e8fd12de3b03`, to `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`. The NPC branch has not incorporated these changes. This section records only the relevant inspected deltas; it does not authorize merging Core work into this branch.

### Newly observed Core capability: actor binding

The current Core source adds `src/application/actor-bindings.js`, routes in `src/api/server.js`, and `tests/actor-binding.test.js`. The implementation provides a Core-owned adapter-to-canonical-actor allowlist with administrative bind/revoke operations and adapter-authenticated resolution. The inspected tests cover adapter separation, rejection of unbound/unknown/destroyed/cross-world actors, rejection of model-supplied extra identity fields, and revocation.

**Readiness correction:** trusted actor-to-`entity_id` binding is no longer accurately described as wholly absent from current `main`. It is now an observed Core capability on `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`, subject to verification of its exact deployment/configuration and CI on any proposed integration head. It grants identity resolution only; it does not authorize knowledge access, select a purpose, prove acquisition, filter reserved secrets, or grant approval/commit authority.

### Still blocked

The inspected Core implementation plan, `docs/43-core-npc-knowledge-runtime-implementation-plan.md`, explicitly keeps acquisition/provenance and snapshot-bound safe filtering as subsequent stages. The NPC first slice therefore remains blocked on:

- Core-owned `author_initial`/imported acquisition records with source/provenance, subject assignment, validity, and causal reconciliation;
- an actor/purpose/snapshot-bound filter that consumes those records and the canonical snapshot, excludes reserved secrets before model-visible serialization, and preserves `known`, `unknown`, `known_absent`, `withheld`, `incomplete`, and `unsupported`;
- production-path tests for acquisition isolation, invalidation/reconciliation, exact serialized input, snapshot freshness, and proposal non-mutation;
- an NPC adapter consuming only that safe envelope and producing a non-committing proposal.

The new minimal character-card projection is also not a substitute for an actor-relative knowledge filter: it intentionally exposes only stable entity identity/type/status and optional source metadata, omitting arbitrary attributes and facts.

**CI caveat:** the available commit-workflow query returned no PR-triggered workflow runs for the current `main` head. That query does not enumerate all workflow triggers; this audit therefore records source/test presence, not a green-CI claim for the current head.
