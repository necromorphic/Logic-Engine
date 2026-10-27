# NPC Dispatcher and Off-Screen Invocation — Architecture Proposal

**Status:** design proposal only; coordinator decision C = CONDITIONAL, E = APPROVED for a separate architecture proposal without implementation.
**Scope:** establish the existing route inventory, define design decisions and acceptance gates for a future NPC-specific dispatcher. No runtime, API, schema, storage, worker, scheduler, or execution changes are proposed.
**Related work:** PR #535 inventory; `docs/20-minimal-runtime.md`; `docs/22-process-manager-runtime.md`; `docs/34-npc-decision-context-and-proposal.md`; PR #532 (open/draft).

## 1. Executive decision

The repository documents several real Core capabilities, but the reviewed evidence does **not** establish an NPC-specific dispatcher or a complete autonomous NPC loop.

- Actor bindings and actor-bound, policy-filtered reads exist as bounded Core capabilities.
- Core has a proposal lifecycle and validation/commit boundary.
- Core has a game-time trigger scheduler driven by explicit time-advance operations.
- A durable generic Process Manager exists for authored process/milestone lifecycles.
- None of these, alone or in combination, proves that a trigger invokes NPC reasoning, constructs an actor-specific decision context, discovers action candidates, validates an NPC proposal, records the authoritative result, and reconciles NPC plan progress.
- No wall-clock worker or automatic downtime catch-up is established. Do not infer either from process persistence or time triggers.

**Recommendation for the next review:** keep the dispatcher blocked at implementation level; approve only the architecture and evidence checklist in this document. First confirm the exact source-level call path and tests. If no NPC-specific path exists, a future implementation request must be separately approved after the design's owners and contracts are resolved.

## 2. Existing routes and their actual limits

The inventory below was checked against current `main` source and docs, including `src/api/server.js`, `src/application/proposals.js`, `src/application/authorized-read-service.js`, `src/core/rules.js`, `src/core/mechanic-effect-translator.js`, `docs/27-proposal-to-commit-boundary.md`, `docs/28-proposal-api-stage1.md`, `docs/33-npc-runtime-readiness-audit.md`, and `docs/22-process-manager-runtime.md`. It is not an assertion that the end-to-end NPC path has been exercised.

| Existing capability | What it can establish | What it does not establish |
|---|---|---|
| Actor binding and `POST /v1/worlds/:id/authorized-read` | A configured adapter can be bound to an entity; a bounded policy-filtered read can return allowed fields or fail closed. | A general NPC dispatcher, complete Personality/Relationships context, actor knowledge history, or permission to perform arbitrary actions. |
| Context manifests | A generation may be associated with a world revision/commit cursor and normalized references, according to the existing Core contract. | That the exact model input is immutably bound, that the actor knows every referenced fact, or that actor-specific access/completeness has been proven. |
| Generic proposal API: `POST /v1/worlds/:world_id/proposals`, `/proposals/:proposal_id/approve`, `/commit`, `/cancel` | `ProposalService.create` validates the event envelope and supported effects/causal references/REQUIRES preconditions in a rollback-only preview and stores a pending proposal with `base_world_revision` and `base_commit_sequence`. Approval requires the separate approval credential and a current snapshot; commit rechecks staleness and commits only an approved proposal. Cancel is limited to the creating adapter. | This is a generic event-proposal lifecycle, not an NPC dispatcher. Every event requires explicit approval. The service explicitly does not check actor authorization, player-agency policy, semantic alignment with source text, or causal completeness. Adapter identity is not in-world NPC authorization. |
| Rule evaluation: `evaluateCondition(...)` and `evaluateConditionResult(...)` | Existing rule evaluator supports Boolean conditions; the opt-in result API preserves `unknown` for missing paths unless a trusted caller supplies same-snapshot known-absence evidence. | Neither API discovers NPC action candidates, establishes access/completeness, or grants authority. The legacy Boolean path can collapse missing paths into ordinary Boolean results. |\n| Bounded mechanic action evaluation: `src/application/mechanic-executor.js::MechanicExecutor.evaluate(...)` | Evaluates a caller-supplied `actionId` from an enabled instance's exact pinned template; checks a trusted same-snapshot context and declared applicability/preconditions/constraints; translates supported effects; returns a structured non-committing result. | This is a concrete generic candidate seam, not NPC action discovery or an NPC dispatcher. The caller must already select `instanceId` and `actionId`; several mechanic features are deliberately rejected. NPC actor/purpose policy and autonomous selection remain unconfirmed. |\n| Mechanic-intent translation: `translateMechanicEffectIntents` in `src/core/mechanic-effect-translator.js` | A bounded declared mechanic-intent vocabulary can be translated to existing supported effect kinds before proposal validation. | Translation does not make unsupported intents executable and does not itself prove NPC authority. |\n| Core time-trigger scheduler and explicit time advance | Registered triggers can be planned/processed through canonical game-time advancement. | OS wall-clock invocation, automatic time advancement, NPC model dispatch, or NPC reasoning between player messages. |
| Generic Process Manager | Durable world-scoped process/milestone lifecycle, explicit due coordinates, pause/resume/cancel and checkpoints through the existing time-advance pipeline. | An NPC goal/plan store, goal generation, action discovery, model invocation, NPC-specific cancellation/supersession, or an off-screen NPC loop. |
| PR #532 pure NPC helpers | If supplied with caller-owned data, helpers can select an intention and reduce explicit goal/plan outcomes. | A trusted caller, persistence, scheduling, verification of supplied outcomes, action execution, or real autonomy. |

The current runtime has real generic routes for actor-bound authorized reads, proposals, time triggers and processes, each with different trust requirements. Proposal routes require the API bearer token and configured adapter identity; approval additionally requires the separate approval credential. Process/time management routes require the internal credential. These credentials must remain in trusted code and must never be placed in model context. The existence of these routes does not supply the missing NPC-specific dispatcher, actor-relative goal admissibility, action-candidate source, or result-to-plan reconciliation.

### Source-level route trace — observed boundary, missing NPC connection

1. **Authenticated adapter → actor binding:** `src/api/server.js` authenticates `x-adapter-id`/`x-adapter-token`; `POST /v1/worlds/:world_id/actor-bindings/resolve` resolves a configured binding. The identity resolution proves adapter-to-entity binding only; it does not prove all NPC-specific authorization or knowledge.
2. **Bounded read:** `POST /v1/worlds/:world_id/authorized-read` calls `AuthorizedReadService.readEntityFields(...)` with a trusted field policy and actor/snapshot checks. No verified caller composes this into a complete NPC decision context with Personality, Relationships, goal state and completeness semantics.
3. **Decision:** no source-level NPC-specific dispatcher was verified that receives a trigger, assembles that context, invokes an NPC decision step and returns a bounded intention. PR #532 helpers consume supplied data only and are on an open draft branch, not the default runtime.
4. **Proposal:** `POST /v1/worlds/:world_id/proposals` calls `ProposalService.create(...)`, which stores a pending proposal and validation metadata. This is a generic event proposal; its own `not_checked` list includes semantic alignment, causal completeness, actor authorization and player-agency policy.
5. **Approval/commit:** `/approve` requires the separate approval credential; `/commit` requires approved status and a current captured revision/commit sequence before calling the canonical commit path. This is an explicit approval route, not an automatic NPC executor.
6. **Plan reconciliation:** no verified path was found that consumes the authoritative committed/cancelled/failed result and updates an NPC-owned goal/plan state. The PR #532 reducer accepts caller-supplied outcomes; it does not verify their source or persist them.
7. **Off-screen trigger:** Core time triggers and the generic Process Manager advance only through explicit game-time operations. No NPC model-call callback or wall-clock worker was verified.

**Trace conclusion:** the Core has a usable generic proposal lifecycle, bounded actor reads, tri-state rule evaluation, and a narrow mechanic action evaluator. The full chain `trigger → trusted NPC context → NPC action selection → proposal → approved commit → authoritative result → NPC plan reconciliation` is **NOT PRESENT / UNCONFIRMED** in the inspected evidence. The mechanic executor is a candidate for the first action-evaluation seam, but the first NPC action family is still **BLOCKED** pending coordinator confirmation of the action family and the trusted NPC caller/policy. The missing link is not simply an API route; it includes NPC-specific orchestration and semantic/authorization gates.

## 3. Required end-to-end stages (conceptual, not a proposed API)

Any future dispatcher design must account for every stage below. The owner and actual existing interface for each stage must be identified before implementation.

1. **Trigger acceptance** — receive an explicitly approved trigger type and a stable correlation/idempotency reference.
2. **Eligibility gate** — establish that this world/NPC is eligible to be considered now; reject stale, cancelled, duplicate, or unsupported triggers.
3. **Actor and snapshot binding** — resolve the acting NPC through a trusted path and obtain the authoritative world revision/time needed for the decision.
4. **Bounded context preparation** — gather only authorized information; distinguish known true, known false, unknown/incomplete, and withheld/inaccessible. Retrieval or prompt inclusion is not knowledge acquisition.
5. **Decision step** — invoke the approved NPC decision boundary with bounded goals/candidates. Return a non-committing proposal, no-action, or review result.
6. **Validation and proposal handling** — route the result through the existing Core validation/approval boundary. Unsupported effect mappings or unverified permissions fail closed.
7. **Authoritative result** — receive the Core-confirmed outcome; never accept model text or a caller assertion as proof of success.
8. **NPC-local reconciliation** — update goal/plan progress only from a verified result. Do not create a competing canonical world/event log or authoritative knowledge store.
9. **Durable checkpoint and recovery** — make retries, cancellation, restart, and stale work deterministic, with no duplicate side effects.
10. **Narrative visibility** — separately decide what, if anything, may be delivered to the player or another NPC. Process completion alone must not create NPC knowledge or player delivery.

These stages are responsibilities for design review. They are not instructions to create ten services, new interfaces, or a new pipeline.

## 4. Trigger semantics that must be decided

No trigger type is approved for autonomous execution by this proposal. Reviewers must decide which existing event or invocation source is valid for a first slice:

- **Explicit caller invocation:** a trusted caller requests one bounded NPC decision. This is the smallest conceptual path, but the exact production caller and its identity are unconfirmed.
- **Canonical game-time trigger:** a registered Core trigger becomes due during explicit time advancement. The current trigger path processes registered work; an NPC model-dispatch callback is not established.
- **Committed event trigger:** an accepted canonical event may make an NPC eligible for reconsideration. The event-to-NPC subscription/dispatch path is unconfirmed.
- **Wall-clock/background trigger:** not established in the reviewed runtime. Do not implement or assume it under this decision.

The first architecture iteration should select at most one trigger type after confirming a real existing source and its owner. Chat turns must not silently advance world time or imply that off-screen time passed.

## 5. Process Manager: reuse boundary

The generic Process Manager may be evaluated as a lifecycle primitive, but it must not be reinterpreted as an NPC dispatcher.

Existing documented behavior includes:
- durable process and milestone records;
- explicit future due coordinates and prerequisite relationships;
- pause, resume and cancel with expected-version/idempotency checks;
- progress during explicit Core time advancement;
- durable checkpoints and restart readback;
- fail-closed handling for overdue resume that requires replan.

Not established by that behavior:
- per-NPC goal/plan ownership or goal admissibility;
- model invocation, context assembly, or action-candidate discovery;
- automatic replanning or NPC-specific recovery;
- NPC actor authorization or action execution;
- a wall-clock worker or downtime catch-up;
- NPC knowledge/report/player-delivery side effects.

Do not store NPC goals as generic process milestones unless a separate contract establishes ownership and semantics. Do not encode model reasoning as an arbitrary process script. Do not use process completion as a proxy for NPC knowledge or action success.

## 6. Required lifecycle guarantees for any future dispatcher

Before implementation is considered, the design must answer and test:

### Identity and idempotency
- What is the stable identity of one NPC decision attempt?
- What scope prevents duplicates: world, actor, trigger, snapshot, or a defined combination?
- How is a retry distinguished from a genuinely new decision?
- What happens if the same idempotency key is reused with different content?

### Cancellation and supersession
- Who can cancel an invocation, and through which trusted path?
- What happens if the NPC, world, goal, or trigger becomes ineligible during a model call?
- How are concurrent or newer decisions prevented from overwriting a newer result?
- Does cancellation stop only uncommitted work, or can it also affect already committed canonical events? The latter must use Core's existing rollback/compensation contract, never an NPC-local workaround.

### Snapshot and stale work
- Which world revision, commit sequence, and game-time coordinate does the decision use?
- What exact check rejects or reviews a proposal based on a stale snapshot?
- Which checks must be repeated immediately before proposal approval/commit?
- What is the safe outcome if exact model-input-to-snapshot binding cannot be proven?

### Recovery and observability
- Which durable checkpoint is authoritative at each stage?
- After restart, can the system distinguish not-started, in-progress, proposed, committed, cancelled, and needs-review outcomes without guessing?
- Can failure injection demonstrate no duplicate canonical side effect?
- Which audit references are recorded without leaking withheld information?

### Work limits
- What caps invocations per trigger, NPC, world and time-advance operation?
- How are loops, repeated no-op decisions, and mutually triggering NPCs bounded?
- How does the system avoid starving unrelated world work?
- Who owns fairness and prioritization policy?

All answers remain **UNCONFIRMED / BLOCKED** until backed by an existing contract or a separately approved design.

## 7. Required acceptance evidence before any implementation request

- [ ] A source-level trace names the exact trigger/caller and the tested call path into an NPC decision step.
- [ ] Trusted actor binding is carried through context preparation and proposal handling.
- [ ] Snapshot/time references and stale-result rejection use existing authoritative Core mechanisms.
- [ ] Access filtering happens before model input; unknown and withheld data are not exposed.
- [ ] Goal and action contracts have an approved owner, and one first action family has a verified candidate source, precondition evaluator, supported effect mapping, and result route.
- [ ] NPC decision output is non-committing; only the existing Core path can validate and commit supported effects.
- [ ] Retry, duplicate trigger, cancellation, supersession, restart and stale snapshot tests exercise real boundaries.
- [ ] Failure injection proves no duplicate or partial canonical side effect.
- [ ] Process completion does not create NPC knowledge or player delivery; existing isolation tests remain valid.
- [ ] No wall-clock scheduler, background worker, new queue, shared interface, schema or storage is introduced without separate approval.
- [ ] Memory → NPC remains **DISABLED / FAIL-CLOSED**.
- [ ] End-to-end tests are not described as passed until they run against the real integrated route.

## 8. Decisions requested from reviewers

1. Does a source-level search identify any NPC-specific dispatcher/caller not covered by PR #535? If yes, provide exact file, symbol, and test evidence.
2. Which single trigger type should be the first design target, and who owns it?
3. Should the existing Process Manager be excluded from the first NPC dispatch slice, or is there a narrow reuse contract that can be evidenced without treating process milestones as NPC goals?
4. Which component owns invocation idempotency, cancellation/supersession, and durable recovery?
5. Which existing Core operation receives a non-committing NPC proposal and returns the authoritative result for plan reconciliation?
6. Which exact integration tests are required before implementation is reconsidered?

If no existing NPC-specific path is found, record that fact as **UNCONFIRMED / BLOCKED** and request separate coordinator approval for implementation after this design is reviewed.

## 9. Guardrails

- This is architecture-only. No implementation, runtime edits, API changes, schema/storage changes, or background process.
- No changes to Host/Adapter, Core, Memory Provider, shared contracts, Personality or Relationships.
- No automatic action execution, direct NPC mutation of canonical world state, or bypass of Core validation/approval.
- No wall-clock scheduler or assumption that time passes between player messages.
- Memory → NPC remains **DISABLED / FAIL-CLOSED**.
- PR #532, #535 and #536 remain open/draft unless separately reviewed; no merge is requested or implied.
