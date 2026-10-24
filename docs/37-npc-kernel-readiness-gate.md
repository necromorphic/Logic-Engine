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

This is a time-bounded branch snapshot, not a statement that any listed change is merged or approved. The default branch inspected for this review was `main` at `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`. Always re-check current branch heads and PR dependencies before relying on this inventory.

| Area | Observed development location | Safe interpretation for NPC work |
|---|---|---|
| Universal mechanic execution | `docs/core-stage1.3-mechanics-execution-contract`, including `docs/30-stage1.3-mechanic-execution-boundary.md` | A proposed core execution contract exists on a separate branch. Its stated scope explicitly excludes NPC goals, plans, schedules, and off-screen autonomy. Do not treat it as shipped runtime behavior. |
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

**Snapshot dependency note:** PR #45 (`feat: add consistent internal snapshot read boundary`) proposes a bounded internal snapshot read and reports passing Runtime tests on its current head, but it remains open and unmerged. Do not count `getSnapshot(...)` as available production behavior on `main` or this branch until its review/merge and target-branch presence are verified. That primitive would address only read-view consistency; actor-specific authorization, a trusted secret/access policy source, authorized initial-knowledge representation/provenance, belief/delivery records, and NPC acceptance tests remain separate blockers.

## 15. Refreshed main-branch boundary audit — 2026-10-24

This section supersedes the older time-bounded inventory in §7 where the two differ. The live main ref was re-compared with this branch during the refresh: main is at `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`; `feat/npc-subsystem` has three commits of main not yet incorporated. The branch is therefore not a current source snapshot of core, and no rebase or merge was performed as part of this audit.

The intervening main changes add or revise core contracts and mechanic-effect support documentation. The following distinctions now govern NPC planning:

- `docs/27-proposal-to-commit-boundary.md` describes the current proposal lifecycle more precisely: proposal creation uses rollback-only validation and does not mutate canonical world state; commit requires approval and rechecks staleness. This still does not establish named NPC actor authorization, complete semantic alignment, causal completeness, or player-agency policy.
- `docs/30-stage1.3-mechanic-execution-boundary.md` defines a core-only next-slice contract for deterministic mechanic evaluation on one consistent snapshot. It explicitly excludes NPC goals, knowledge, schedules, decision-making, and off-screen autonomy; the contract is not itself proof that the evaluator is shipped.
- `docs/31-mechanic-effect-intent-support-matrix.md` explicitly lists knowledge operations, generic relationship operations, and goal/task management as unsupported by the current canonical effect validator. Relationship state must not be smuggled through arbitrary attributes or generic `fact.set` as a substitute for a typed contract.
- PR #45 (consistent snapshot read) and PR #32 (character-card projection) were rechecked and remain open, unmerged proposals. PR #45's candidate snapshot would be a read-consistency primitive only; PR #32's current projection remains minimal and does not supply relationship summaries or actor authorization.
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
| 1 | Consistent canonical snapshot — core | Review and integrate the bounded read primitive from PR #45 (or an approved equivalent); verify its exact composite marker and requested-row behavior on the target base. | Do not assemble a decision snapshot from unrelated raw reads. |
| 2 | Trusted actor binding — core + host adapter | A real, trusted mapping from the decision subject to an existing canonical entity, and a declared purpose; neither may be accepted as an untrusted model-supplied identity. | Reject the request as unsupported; do not infer identity from display name/card text. |
| 3 | Initial acquisition representation — core | Executable, audited record for explicitly authorized author-initial/imported knowledge, with canonical source references and explicit ownership; the contract in docs/39 §4.1 must be approved against real code. | Do not treat profile text, retrieval, manifest inclusion, or prompt text as acquired knowledge. |
| 4 | Actor/purpose/snapshot filter — core | A bounded result tied to the same (world_revision, commit_sequence) marker, preserving known, unknown/unset, withheld, and incomplete/unsupported distinctly and excluding restricted content before model input. | Raw snapshot rows must not enter any NPC, narrator, player, or host-visible context. |
| 5 | Condition evaluation semantics — core | The decision path must not convert missing/incomplete/unavailable values into ordinary false. Either a reviewed tri-state result contract is implemented, or the first slice avoids evaluating any condition whose required paths are absent/incomplete. | No NPC decision may depend on a false result produced by missing data. |
| 6 | Proposal-only NPC adapter — NPC/integration | Build a pure adapter over the approved filtered envelope and existing proposal lifecycle. It can propose only supported existing effects and cannot commit, mutate belief/acquisition, or bypass approval. | Keep the output as a non-persistent draft/specification; do not add an NPC-owned proposal store. |
| 7 | Production-path acceptance — shared | Tests invoke the real actor binding, authorized read/filter, context builder, and proposal creation path; assert source references, state-before/state-after, snapshot marker, excluded secrets, and no mutation. | Unit mocks can help design but cannot mark the slice integrated or ready. |

### Implementation rule

Do not treat this queue as a requirement to land all gates in one PR. Core-owned work should stay in the core's reviewed branch/PR; NPC-specific work should consume only merged or explicitly approved stable interfaces. Keep the first NPC slice small enough that every visible claim can be traced to authorized source evidence.

The snapshot primitive is necessary but not sufficient. In particular, it does not by itself solve actor/entity binding, acquisition, belief, delivery, authorization, or safe condition evaluation. The relationship typed-operation design in docs/45-npc-relationship-typed-operation-design.md is a separate later capability and must not be pulled into the first knowledge slice merely because both need snapshots.
