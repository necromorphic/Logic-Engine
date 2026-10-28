# NPC Autonomy — Existing Contract Inventory and Review Proposal

**Status:** proposal for separate review, following coordinator decision to approve direction only.  
**Scope:** documentation-only inventory for autonomy questions A/B/C.  
**Branch:** `docs/npc-autonomy-contract-inventory-20261028`.  
**No runtime/API/schema/storage changes are proposed here.** This document does not authorize production integration.

## 1. Executive finding

The repository contains useful Core primitives, a proposed NPC decision boundary, and pure NPC helpers on open draft PR #532. It does **not** currently demonstrate a complete autonomous NPC loop.

The most important distinctions are:

- A bounded, durable **generic Process Manager runtime does exist** (`src/process/contract.js`, `src/storage/process-store.js`, `LogicEngine.createProcess(...)`, and internal `/processes` routes). It is built over Core time triggers and segment transactions; it is **not** an NPC decision scheduler and does not generate goals, invoke model reasoning, or deliver NPC knowledge.
- A Core time-trigger scheduler exists for registered time triggers; it is **not** a wall-clock worker or proof of an autonomous NPC background loop.
- Actor-bound, policy-filtered Core reads exist for a bounded set of entity fields; this does **not** establish a general Personality/Relationships-to-NPC decision-context contract.
- Core proposal lifecycle and validation exist; they do **not** mean an NPC can execute arbitrary candidate actions or commit world effects.
- PR #532 provides local pure helpers for choosing from supplied goals/actions and advancing supplied goal/plan state; it does not generate goals from world/personality data, discover world actions, persist NPC state, schedule NPCs, or execute actions.

Anything not proven by the source paths below is marked **UNCONFIRMED / BLOCKED** rather than inferred.

## 2. Existing contract inventory

| Area | Existing file / symbol | Owner and observed contract | Inputs → outputs | Trust / status | Test evidence and limits |
|---|---|---|---|---|---|
| Personality semantics | `docs/personality/01-personality-and-relationship-semantics.md` | Personality owns authored traits and relationship semantics; NPC owns decision orchestration. Personality data is not a second canonical store. | Authored profile / relationship semantics → documented meaning and constraints; no verified NPC-facing runtime feed identified here. | Documentation-only proposal; **runtime handoff UNCONFIRMED**. | Document points to Personality acceptance and cross-block handoff documents. This inventory did not execute their tests or establish a live consumer. |
| Actor identity binding | `src/application/actor-bindings.js`; endpoint documented in `docs/20-minimal-runtime.md` | Core resolves an authenticated adapter binding to an entity. A binding identifies an actor; it does not grant universal field access. | Adapter identity and credentials → bound actor/entity reference or refusal. | Existing Core boundary; not an NPC autonomy interface. | Existing source/tests are part of the repository test suite, but not re-run as part of this documentation audit. Binding alone is not authorization for all decision inputs. |
| Authorized entity-field reads | `src/application/authorized-read-service.js`; `POST /v1/worlds/:id/authorized-read` | Core supplies a narrow actor-bound, policy-filtered read. | Actor-bound request / requested entity fields → authorized fields or fail-closed result. | Existing bounded read contract. **Not a complete NPC knowledge/belief system.** | `docs/34-npc-decision-context-and-proposal.md` requires access and completeness distinctions. No general Personality/Relationships composite context is established by this read alone. |
| Decision context and non-committing proposal | `docs/34-npc-decision-context-and-proposal.md` | Proposed contract: trusted caller assembles bounded actor-specific context; NPC may return a proposal, no-action, or needs-review result; Core remains responsible for validation/commit. | Conceptual actor/snapshot/profile/permitted-facts/bounds → bounded proposal. | Design contract only; exact schema/API is expressly deferred. Initial knowledge path remains blocked on trusted actor binding, source record, snapshot-bound filters, and production-path tests. | Source document explicitly says no runtime/API/schema/persistence/prompt/Host changes are authorized by that document. Do not treat conceptual fields as implemented wire fields. |
| Core evaluation and canonical commit | `src/application/engine.js`; `src/application/proposals.js`; `src/core/rules.js`; `src/core/mechanics.js` | Core validates supported requests/effects and owns proposal lifecycle and canonical state transitions. Unknown effect kinds are rejected; a proposal is not itself a commit. | Supported request/proposal and available evidence → validation/lifecycle result; canonical effects only through the supported Core path. | Existing bounded mechanisms; not a universal NPC action executor. | `docs/57-core-evaluation-recalculation-boundary.md` documents these boundaries and warns against assuming general dependency closure. Specific supported effect vocabulary must be checked per operation. |
| Time-trigger scheduling | `src/time/scheduler.js`; `planDueWork(...)`; time-advance routes | Core plans due work over canonical game-time coordinates and processes it only through explicit time-advance operations. The pure planner itself does not advance time, execute effects, commit state, or grant NPC knowledge. | Registered trigger records + `[from, to]` coordinates → due-work plan; explicit Core operation drives the commit path. | Existing bounded scheduler; no wall-clock worker. | `docs/57-core-evaluation-recalculation-boundary.md` distinguishes scheduling from evaluation. `docs/22-process-manager-runtime.md` confirms no wall-clock scheduler or downtime catch-up. |
| Generic durable Process Manager | `src/process/contract.js`; `src/storage/process-store.js`; `src/application/engine.js::createProcess`, `getProcess`, `listProcesses`, `transitionProcess`; `src/api/server.js`; `docs/22-process-manager-runtime.md` | Core owns a bounded world-scoped process/milestone lifecycle layered on time triggers and segment transactions. It supports create/read/list/pause/resume/cancel and durable milestone checkpoints. | Authored process definition with due coordinates, prerequisites, read/write sets and event proposals → stored process state and milestone events after explicit time advance. | Implemented generic runtime; internal routes require bearer and `x-engine-internal-token`. Not an NPC goal/plan store or autonomous reasoning caller. | `tests/process-manager.integration.test.js` covers persistence/restart, milestone progress and lifecycle; `tests/process-knowledge-isolation.test.js` verifies process completion does not create NPC knowledge/delivery records. `docs/22` states no wall-clock scheduling and bounded rollback/reconciliation. |
| NPC intention selection | PR #532: `src/npc/autonomous-intention-selector.js` | Pure helper chooses among caller-supplied eligible goals/actions, retains a still-eligible intention unless a higher-priority eligible goal supersedes it, and fails closed on malformed references. | Supplied goals, action candidates and previous intention → selected intention/action or no eligible choice. | Isolated helper on **open draft PR #532**, not mainline production integration. | Exact-head PR CI run #40593500991 reported `npm test`, recalculation-oracle harness and NPC boundary suite passing. This does not test a real caller, world-state action discovery, persistence or model dispatch. |
| Goal lifecycle | PR #532: `src/npc/goal-lifecycle.js` | Pure validator permits only documented goal-state transitions; completed/abandoned are terminal. It does not determine whether an event actually occurred or persist state. | Caller-supplied current/proposed status → accepted transition or fail-closed refusal. | Isolated helper on open draft PR #532. | Same exact-head PR CI run; no persistence or trusted event source established. |
| Plan progress | PR #532: `src/npc/plan-progress.js` | Pure reducer applies explicit step success/block/unblock/abandon outcomes to a supplied ordered plan. | Supplied plan and explicit progress event → updated plan state or refusal. | Isolated helper on open draft PR #532. | Same exact-head PR CI run; it does not execute actions or verify the truth of caller-supplied outcomes. |
| Autonomous NPC invocation between player messages | Generic process runtime exists, but no NPC-specific caller is verified. | `docs/22-process-manager-runtime.md` and `src/application/engine.js` establish a generic durable process lifecycle. They do not establish an NPC model-call dispatcher, NPC-owned goals/plans, or autonomous decisions between player messages. | **UNCONFIRMED**: trigger-to-NPC decision dispatch, actor/context assembly, candidate generation, action-result routing and off-screen knowledge/report delivery are not demonstrated as one working path. | **BLOCKED** for NPC autonomy integration; generic process lifecycle may be a candidate seam only after an explicit contract review. | `tests/process-manager.integration.test.js` proves generic process persistence/progress, not NPC invocation. `tests/process-knowledge-isolation.test.js` explicitly protects the boundary between process completion and NPC knowledge/delivery. `docs/22` says there is no wall-clock scheduler or downtime catch-up. |
| Memory → NPC | `src/application/memory-npc-consumer.js`; `docs/07-knowledge-and-narrative-boundaries.md` | Consumer is an injected retrieval/admission seam using Core-authorized field reads; retrieval alone is not actor knowledge and it is not a production receiver/dispatch route. | Request → admitted retrieval/context candidates or fail-closed result. | Production integration remains **DISABLED / FAIL-CLOSED**. | Existing docs state no verified final model-dispatch gate and incomplete Host lifecycle/egress coverage. Do not broaden this work to enable Memory → NPC. |

## 3. Question A — goal generation dependencies

### Confirmed direction

NPC may own the formation and lifecycle of its own goals, while Personality/Relationships remain owners of their semantics and Core remains owner of canonical world state, access checks, revisions, and causal commit boundaries.

### Proposed dependency map (not an API)

1. **Personality / Relationships** — supply only explicitly authorized, decision-relevant traits, motives and relationship information through an existing verified read path or a separately approved contract.
2. **Core / relevant mechanics** — supply the current state and rule facts required to assess a goal, within existing authorization and snapshot guarantees.
3. **NPC** — proposes or updates a goal from supplied inputs; it must preserve uncertainty and must not convert missing context into a negative fact.
4. **Trusted caller** — binds the acting NPC and prepares the bounded input. The exact caller is **UNCONFIRMED**.

### Unresolved / blocked

- No verified single interface currently joins authorized personality, relationship, world-state and NPC-local goal inputs.
- No agreed policy contract defines which goal categories are permitted, how conflicts with world rules are classified, or which checks are authoritative.
- The existing PR #532 helpers consume goals; they do not generate them.

**Request for review:** identify the existing approved source/read path for each input category and the authoritative owner of goal admissibility. If no such contract exists, return a separate proposal rather than creating shared interfaces in this workstream.

## 4. Question B — action-candidate dependencies

### Confirmed direction

NPC may choose only from caller-supplied candidates that are explicitly marked eligible. Selection is not execution. Candidate metadata or model text cannot establish authorization, current world truth, or successful effects.

### Proposed dependency map (not an API)

1. **Core / world mechanics** — authoritative current state, supported rules, capability/resource constraints, and any applicable precondition evaluation, where existing contracts support them.
2. **Relevant mechanic / domain owner** — declares the meaning of domain-specific actions and their prerequisites using its existing approved contract.
3. **NPC** — selects an eligible supplied candidate and produces intent/proposal only.
4. **Core proposal/commit path or separately approved executor** — validates and applies supported effects; reports the authoritative result.
5. **Trusted caller** — binds candidates to the same actor and relevant current snapshot used for evaluation.

### Unresolved / blocked

- No general action-candidate discovery contract for NPC autonomy was verified.
- The exact ownership split between candidate generation and precondition evaluation must be checked against the specific existing mechanic contracts; it must not be invented here.
- No universal mapping from NPC action intent to supported Core effect exists. Unsupported effects must remain rejected or needs-review.
- A candidate marked `preconditions_met: true` is only as trustworthy as its caller. The pure selector is not a verifier.

**Request for review:** identify existing candidate sources, precondition evaluators and supported effect mappings for the first intended action family. Keep other action families unsupported until their owners and tests are identified.

## 5. Question C — off-screen invocation and execution

### Confirmed direction

Core already has a bounded generic Process Manager runtime that persists world-scoped processes and milestones over the existing time-trigger/segment pipeline. This is useful infrastructure, but the process is authored as scheduled event proposals and advances during explicit time-advance operations. It does not itself invoke NPC decision-making or generate NPC goals/actions. It is not evidence that NPCs are autonomously invoked between player messages.

### Inventory outcome

- **Generic Process Manager:** **OBSERVED / IMPLEMENTED**, bounded by `docs/22-process-manager-runtime.md`.
- **NPC-specific scheduler / decision dispatcher:** **UNCONFIRMED / BLOCKED**.
- **Wall-clock-driven autonomous loop:** not found in the documented minimal runtime; the documented runtime says time is not advanced from system-clock ticks.
- **NPC trigger contract:** **UNCONFIRMED**.
- **Generic persistent process/milestone checkpoint:** **OBSERVED / IMPLEMENTED**; NPC-specific work queue/checkpoint semantics remain **UNCONFIRMED**.
- **Execution/result route for NPC-generated action proposals:** generic Core proposal infrastructure exists, but a connected NPC-to-authoritative-executor path was not verified.
- **Cancellation/supersession and duplicate-run behavior for autonomous NPC jobs:** **UNCONFIRMED**.

### Required separate design decision if no existing path is found

Before implementation, define and approve the owner and contract for:
- eligible trigger types (game-time trigger, accepted event, explicit host invocation; no implicit wall-clock assumptions);
- per-world/per-NPC invocation limits and bounded work per invocation;
- deduplication, cancellation, supersession and restart recovery;
- the actor-specific context/snapshot assembled for a run;
- how a proposed result enters the existing validation/approval/commit path;
- how authoritative success/failure is returned to update plan progress;
- what is logged and what is visible to the player.

This is a list of questions for the separate proposal, not an authorization to create a scheduler, worker, queue, storage schema or execution API now.

## 6. Required review decisions

Reviewers are asked to answer the following explicitly:

1. **A — Goal inputs:** Which existing contracts may provide personality, relationship, world-state and rule inputs? Who owns goal admissibility?
2. **B — Candidate actions:** Which action family should be the first supported vertical slice? Which existing component supplies candidates, evaluates preconditions, and maps intent to supported Core effects?
3. **C — Invocation:** Is there an existing NPC-specific caller/process manager beyond Core's time-trigger scheduler? If yes, cite its exact file/symbol and tests. If no, approve preparation of a separate scheduler/orchestration design request.
4. **Trust and evidence:** Which actor binding, snapshot/revision and provenance markers must travel through the first slice? Which missing values require fail-closed behavior?
5. **Acceptance evidence:** Which exact tests must demonstrate the path end-to-end before any production integration is proposed?

## 7. Guardrails

- No runtime, API, schema, storage, Host/Adapter, Memory Provider, or shared-contract changes in this proposal.
- No automatic access to all Personality/Relationships or Core data.
- No new generic interface merely to make the design appear connected.
- No NPC self-certification of action success and no direct world mutation by NPC helpers.
- Memory → NPC remains **DISABLED / FAIL-CLOSED**.
- PR #532 remains open and draft; no merge is requested or performed.
- Any unverified dependency remains labelled **UNCONFIRMED / BLOCKED**.

## 8. Source basis

- `docs/06-npc-autonomy-and-process-manager.md` — proposed durable autonomy/process-manager behavior.
- `docs/20-minimal-runtime.md` — runtime endpoints and gaps; its statement that process lifecycle behavior is unimplemented conflicts with the implemented runtime documented in `docs/22` and source/test files. Treat that specific sentence as stale pending a separate documentation correction.
- `docs/22-process-manager-runtime.md` — implemented bounded generic process lifecycle, internal API, checkpointing and explicit no-wall-clock-scheduler limit.
- `src/process/contract.js`, `src/storage/process-store.js`, `src/application/engine.js`, `src/api/server.js` — current process runtime anchors.
- `tests/process-manager.integration.test.js`, `tests/process-knowledge-isolation.test.js` — process lifecycle and NPC-knowledge-isolation evidence.
- `docs/33-npc-runtime-readiness-audit.md` — source-level audit limitations and missing end-to-end NPC runtime.
- `docs/34-npc-decision-context-and-proposal.md` — proposed bounded decision context and non-committing proposal.
- `docs/57-core-evaluation-recalculation-boundary.md` — Core ownership and existing boundaries.
- `docs/personality/01-personality-and-relationship-semantics.md` — Personality ownership boundaries.
- PR #532 — isolated intention-selection, goal-lifecycle and plan-progress helpers; exact-head CI run #40593500991.

This inventory is based on repository documentation and source references; this documentation change does not claim that tests were re-run locally or that an end-to-end NPC autonomy path was exercised.
