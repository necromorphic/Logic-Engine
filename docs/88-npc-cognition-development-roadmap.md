# NPC Cognition Development Roadmap

Status: active roadmap. Stage 1 semantic contract is complete; no runtime capability is enabled by this document.

This roadmap tracks the intended sequence for developing NPC cognition in Logic-Engine. It is deliberately ordered so that later autonomy cannot bypass knowledge authority, Core validation, world-time control, or player agency.

## Governing rules

- Core owns canonical world state, authoritative persisted state, revisions, causality, and commit/rollback.
- An NPC's belief is not canonical truth. Missing information is not false; retrieved text is not knowledge; access-denied information is not evidence of absence.
- NPC reasoning may produce a bounded proposal. It does not itself execute actions, mutate world state, grant knowledge, advance time, or deliver information to another actor.
- Use existing contracts and Core lifecycle; do not create parallel canonical stores or generic interfaces without an approved need.
- Each stage has an explicit exit gate. If a dependency is unverified, mark it blocked and document evidence rather than guessing.
- Memory → NPC remains DISABLED / FAIL-CLOSED until a separately approved end-to-end path proves actor-bound authorization, context construction, final serialization, and delivery controls.
- This roadmap does not authorize production dispatch, PR merging, weakening security checks, or bypassing review.

## Stage register

| Stage | Scope | Exit gate | Status |
|---|---|---|---|
| 0. Baseline and ownership map | Reconcile current NPC helpers, Core knowledge contracts, actor binding, source/provenance, context manifest, proposal/commit, time/process manager, Personality and Relationships ownership. Record implementation versus proposal. | Traceability inventory links each claim to source and tests; blockers named. | Documentation work underway; see docs 86–87 and PR #631. |
| 1. Epistemic model | Define distinct states: canonical truth, actor-relative acquisition and belief, unknown/incomplete, withheld/inaccessible, suspicion, contradiction, and retrieved candidate. Define provenance, uncertainty, invalidation and state transitions. | Semantic contract reconciled with Core and author decisions; transition rules and 12 scenarios recorded. Runtime behavior explicitly not claimed. | COMPLETE — semantic contract only; see docs 89 and PR #635. |
| 2. Information acquisition | Implement the first Core-owned author_initial/imported assignment record, provenance, actor/world/source validation, idempotency, and lifecycle integration. Observation, communication, documents, inference and rumor remain separate future evidence paths. | A trusted authoring/import/seed source must explicitly bind the item to a canonical subject and provide stable provenance; the operation must use Core lifecycle and rollback/replay. | **BLOCKED — no verified production authoring/import/seed entry point exists.** The client-facing endpoint from [PR #644](https://github.com/necromorphic/Logic-Engine/pull/644) was reverted by [PR #651](https://github.com/necromorphic/Logic-Engine/pull/651). [PR #637](https://github.com/necromorphic/Logic-Engine/pull/637) leaves an unset policy seam, not a real source. Await an approved source path/extension; Memory → NPC remains disabled. |
| 3. Belief revision and contradiction handling | Define how new evidence updates or fails to update beliefs; retain provenance and conflicting hypotheses; prevent silent overwrite and automatic correction by canonical truth. | Deterministic transition rules and adversarial tests for false beliefs, stale evidence, conflicting sources, retraction, and uncertainty. | NOT STARTED; depends on Stages 1–2. |
| 4. Decision-context assembly | Build a snapshot-bound, actor-specific context with explicit completeness/access markers and purpose bounds. Omit unauthorized information before model input. | Tests prove actor binding, permitted context, unknown-vs-false distinction, and no hidden-content leakage. | BLOCKED on trusted acquisition/read contract and verified caller seam. |
| 5. Motivation and goal formation | Define goal sources, stable profile constraints, competing goals, priority, urgency, cost/risk, and admissibility. Keep goals separate from intentions/actions. | A goal can be traced to authorized inputs and owner rules; selection stays proposal-only. | PARTIAL helpers exist; goal generation/admissibility source remains unverified. |
| 6. Multi-step planning and replanning | Define plan creation, preconditions, dependencies, blockers, alternatives, interruption, resumption, cancellation, and plan supersession. | Plans react only to authenticated outcomes/current state; no self-certified success; deterministic lifecycle tests. | PARTIAL plan-progress helper exists; persistence/invocation/authoritative outcomes unverified. |
| 7. Social reasoning / models of other minds | Represent an NPC's assumptions about what another actor knows, believes, wants, or intends. These are hypotheses, not access grants or canonical facts. | Tests show false assumptions remain actor-relative and do not reveal hidden state; manipulation/deception does not bypass validation. | NOT STARTED; depends on epistemic model and authorized acquisition. |
| 8. Outcome feedback and learning | Distinguish intended, proposed, accepted, committed, observed, and reported outcomes. Update goals/beliefs/strategy only from appropriately authorized feedback. | No proposal is treated as success; rollback/replay and duplicate delivery preserve consistency. | NOT STARTED; depends on proposal/commit and acquisition lifecycle. |
| 9. Controlled off-screen continuity | Define eligible game-time/event triggers, bounded work, per-NPC limits, deduplication, cancellation, restart recovery, and player-visible reporting. Reuse Process Manager where appropriate; do not infer time from chat turns or wall clock. | Explicit trigger and time contract; integration tests for duplicate/restart/cancel; bounded deterministic advancement. | Generic Process Manager exists; NPC invocation/dispatcher is unverified. |
| 10. End-to-end integration gate | Connect approved context → NPC proposal → Core validation/commit → authoritative outcome → authorized feedback. Verify final serialized context and sole authorized delivery path. | Exact-head integration tests, security tests, traceability, review approval, documented rollback. Only then consider changing any disabled integration flag through a separate approval. | BLOCKED; Memory → NPC stays DISABLED / FAIL-CLOSED. |

## Completed work item: Stage 1 — epistemic model

**Stage 1 is complete at the semantic/design level.** The decision record resolves acquisition vs belief, stale evidence, forgetting/expiry, source revocation, qualitative uncertainty, and Core ownership. The concrete Core representation and production-path tests remain later implementation dependencies; they do not reopen the Stage 1 semantic gate.

An NPC-owned pure reducer is under review in [PR #661](https://github.com/necromorphic/Logic-Engine/pull/661). It separates receipt, admitted evidence, and belief; binds events to world/subject; requires explicit revision/invalidation rules; preserves contradictory evidence; makes repeated identical belief revisions and forgetting operations no-ops; validates historical evidence against the same proposition; preserves the invalidation rule so conflicting invalidation replays fail closed; rejects inconsistent states where forgotten beliefs retain active evidence or invalidated evidence lacks a review marker; and rejects unsupported metadata primitives such as functions, undefined values, and non-finite numbers; validates exact state-object shapes so unknown nested extension fields cannot bypass shallow freezing and mutate a supposedly immutable state. It is not an authorization service, persistent Core representation, Memory adapter, or production dispatch path. Exact-head CI for the current revision is pending.

## Current work item: Stage 2 — information acquisition

Stage 2 remains **BLOCKED / NOT ACCEPTED**, tracked by [Issue #634](https://github.com/necromorphic/Logic-Engine/issues/634). The candidate in [PR #644](https://github.com/necromorphic/Logic-Engine/pull/644) added a client-facing admin-gated assignment endpoint and was reverted by [PR #651](https://github.com/necromorphic/Logic-Engine/pull/651); its CI results do not establish acceptance of the reverted implementation. The earlier internal-only candidate [PR #637](https://github.com/necromorphic/Logic-Engine/pull/637) leaves `initialAcquisitionPolicy` unset by default and does not connect it to a verified authoring/import/seed source. Repository audit found no production World Pack loader or seed/import entry point that binds a source item to a canonical subject with stable provenance through replay/invalidation. The required next step is an explicit owner-approved source path or approval of the smallest Core-owned extension before runtime implementation. Do not recreate a generic client-facing assignment endpoint. Memory → NPC remains DISABLED / FAIL-CLOSED; no reader, prompt injection, or production dispatch is enabled.

The following Stage 1 notes are retained as the design checklist and acceptance basis:

The first detailed specification should cover:

1. **State vocabulary**
   - canonical truth (owned by Core);
   - subject-relative known true / known false;
   - unknown or incomplete;
   - inaccessible / withheld;
   - belief and suspicion, including a belief that conflicts with truth;
   - contradiction between sources;
   - retrieved candidate that has not been admitted as knowledge.

2. **Evidence envelope**
   - subject and world identity from trusted sources;
   - proposition/source reference;
   - acquisition path and provenance;
   - event/snapshot/revision reference where available;
   - validity, visibility, and allowed purpose;
   - confidence/uncertainty only if its semantics and owner are explicitly defined.

3. **Transitions**
   - acquire evidence;
   - reject unauthorized evidence;
   - record a belief without changing canonical truth;
   - encounter supporting or conflicting evidence;
   - lower confidence, preserve multiple hypotheses, or defer judgment;
   - invalidate/retract evidence;
   - forget/expire only under explicit policy;
   - replay/rollback without duplicate or orphaned state.

4. **Non-transitions**
   - prompt inclusion does not create knowledge;
   - retrieval does not create knowledge;
   - canonical truth does not automatically correct a false belief;
   - missing data does not establish falsehood;
   - refusal/withholding does not establish non-existence;
   - model confidence or fluent explanation does not establish provenance;
   - proposed action does not establish success or that another actor was informed.

5. **Acceptance examples**
   - NPC believes P; Core truth is not-P; NPC continues to act from P unless authorized corrective evidence changes the belief.
   - Two sources conflict; NPC records conflict or uncertainty instead of arbitrarily choosing one.
   - A secret exists but is inaccessible; it is absent from model-visible context and no knowledge is created.
   - A source is revoked; derived knowledge becomes invalid only according to an explicit, traceable invalidation rule.
   - A model returns a plausible claim with no admissible source; it remains a hypothesis/proposal, not an authoritative knowledge record.

## Working method and progress reporting

For every stage:
1. Inspect current-main code/contracts before designing new interfaces.
2. Separate source-verified facts, proposals, and unresolved assumptions.
3. Write the contract and traceability map before runtime changes when semantics/ownership are unresolved.
4. Add executable tests at the real trust boundary; do not count test-file existence as a pass.
5. Run the relevant tests on the exact PR head and record the SHA, commands, results, and environment.
6. Keep changes narrow; open a draft PR and do not merge without explicit authorization.
7. Update this roadmap's stage status and next blocker after each meaningful change.

## Related work

- Cross-block authority / NPC integration contract proposal: PR #631; docs 86–87.
- Core-owned initial/imported acquisition record and provenance task: Issue #634.
- NPC decision context and non-committing proposal: docs 34.
- NPC autonomy contract inventory: docs 80.
- Existing isolated helpers: `src/npc/autonomous-intention-selector.js`, `src/npc/goal-lifecycle.js`, `src/npc/plan-progress.js`.

## Current safety state

**Memory → NPC: DISABLED / FAIL-CLOSED.** This roadmap does not enable it.
