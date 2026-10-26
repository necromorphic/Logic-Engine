# 06. NPC autonomy and Process Manager

Status: proposed behavioral contract. This document does not assume one model call per NPC or mandate a particular agent framework.

## 1. Durable autonomy

NPC autonomy must survive prompt truncation, application restart and periods when the player does not observe the world. The engine stores goals, plans, tasks, relationships, resources if the pack defines them, known facts, beliefs, private intentions and active processes as structured state.

The model may propose a plan or action. The engine validates access to knowledge, preconditions, available capabilities, timing, and world-pack rules before committing effects.

## 2. Character decision inputs

A decision context may include:
- current valid world state relevant to the actor;
- actor's stable traits and current mutable condition;
- goals and priorities;
- active plans, assumptions and alternatives;
- available resources/capabilities defined by the pack;
- relationships and obligations;
- actor's knowledge, beliefs, suspicions and false beliefs;
- recent relevant events and unresolved tasks;
- risks, deadlines and competing objectives.

Do not provide omniscient state by default. The actor's prompt/context must be filtered by epistemic access.

## 3. Goals, plans and tasks

Goal records define desired conditions and optional priority/deadline. Plan records define a strategy and assumptions. Tasks define concrete next steps, dependencies, owners, progress, outcome and evidence.

A plan can be revised when its assumptions become false, an obstacle appears, a resource is lost, a deadline passes, or the actor learns new information. A plan is not an unconditional script.

An actor can conceal a plan, lie, act on a false belief or behave unexpectedly when a credible in-world reason exists. Character profiles constrain plausibility but do not hard-code an absolute ban on change.

## 4. Process Manager

The core scheduler advances durable processes when game time advances or a defined trigger occurs. Each process type specifies:
- start conditions;
- stage/state machine;
- duration model or discrete milestone model;
- prerequisites and blockers;
- per-stage effects and outputs;
- interruption, cancellation and resumption semantics;
- deadlines and timeout behavior;
- completion/failure postconditions;
- causal metadata and rollback policy.

Do not assume every process is continuous or numerical. A pack may define discrete milestones, probabilistic outcomes, deterministic calculations, or mediated adjudication. The core owns scheduling and validation; the pack supplies semantics.

## 5. Parallel progression

When time advances, all due processes are considered in a deterministic scheduler order. Order must not imply causation. Conflicting events are resolved by declared rules, explicit priority, stable tie-breaks or a ConflictRecord.

Recommended processing phases:
1. validate time-advance request and segment interval;
2. find due triggers/processes;
3. compute deterministic progress;
4. gather ambiguous outcomes for mediated adjudication;
5. validate all resulting effects;
6. commit effects and event ordering atomically per defined batch;
7. update goals/plans/tasks and StoryBeat postconditions;
8. enqueue relevant narration;
9. persist scheduler checkpoint and audit.

The final atomicity boundary (one interval, one batch, or one event) must be selected and tested before implementation.

## 6. Off-screen events and player awareness

An event may happen without immediate narration. The engine still records its state effects and causal provenance. Visibility and delivery are separate. The player learns about off-screen activity only through a valid in-world channel, unless the chosen narration style intentionally exposes an omniscient narrator.

The engine should track when a character has a reportable result, whom they can tell, whether communication is possible, and whether the information was actually delivered. A pending report is not equivalent to player knowledge.

## 7. Rollback

Every process stage and off-screen event must declare causal inputs and outputs. When an initiating event is rolled back, the Process Manager recalculates affected stage history. It must not automatically delete all later activity, nor preserve progress whose only prerequisite is invalid. See docs/05-causal-rollback-algorithm.md.

## 8. Story constraints and adaptive NPC autonomy

This section defines behavioral intent; it does not introduce runtime APIs, schemas, or implementation claims.

### 8.1 Narrative modes

NPCs use one autonomy system in both authored-story and emergent-story play. The engine adapts the narrative constraints to the active story context; switching modes must not reset an NPC's identity, knowledge, beliefs, relationships, goals, or accumulated experience.

- **Authored plot present:** NPCs retain high autonomy in how they act, plan, communicate, cooperate, deceive, and respond. Mandatory control points constrain the story outcome, not a single prescribed NPC decision or route, unless the author explicitly defines that decision/route as mandatory.
- **No authored plot to follow:** NPCs use maximum autonomy within world rules and established state. The story emerges from the player's and NPCs' successive actions and their consequences; the engine must not invent a hidden main plot that pulls the world toward predetermined beats.
- **Author-provided tentative plot:** NPCs may treat it as a possible trajectory, not as an obligation. They may diverge from it when their actions and the world's state support a different development.

The engine, rather than the player, determines when the active narrative constraints should change, based on the presence and status of authored plot constraints and the causal state of the world.

### 8.2 Control-point classes

Distinguish at least these behavioral categories in the authored narrative:

- **Mandatory control point (CT):** must remain an active story obligation by default. NPC activity alone cannot cancel or invalidate it.
- **Optional control point:** may be changed, skipped, or rendered unnecessary by player or NPC actions when the resulting world state supports that outcome.
- **Tentative plot beat:** an author-proposed possibility that can guide planning but does not bind the simulation.

A mandatory CT does not require one predetermined path. The engine and NPCs may find another causally plausible route to it. Do not force an implausible action merely to preserve the original route.

### 8.3 Player-triggered divergence and CT review

Only player-initiated intervention can open the exceptional review path for mandatory CTs. An NPC's autonomous activity, by itself, cannot trigger this exception. The player need not explicitly order an NPC to change sides or abandon a plan: the player's actions may create new circumstances (for example, a concealed identity is revealed after a relationship has developed), and the NPC then independently decides how to respond.

Do not review or cancel a mandatory CT merely because an NPC's internal motives, feelings, beliefs, or intentions have changed. Use the following causal sequence:

1. The player's intervention changes the circumstances available to one or more NPCs.
2. An NPC independently chooses an action in response, based on its character, knowledge, beliefs, obligations, relationships, and goals.
3. The action's actual consequences are resolved and reflected in the world state.
4. Only if those consequences materially affect the reachability or meaning of a mandatory CT does the engine initiate an individual review of that CT.

The NPC's choice is not predetermined by the plot constraint. A relationship, revelation, or change of loyalty does not guarantee that the NPC abandons the original plan; the NPC may continue it, conceal a change of intent, partially sabotage it, or choose another response.

### 8.4 Individual review, not blanket cancellation

When player-triggered consequences justify review, assess each affected mandatory CT separately. Do not cancel all CTs because one part of the story diverged.

For each reviewed CT, determine whether:
- it remains meaningful in the changed world;
- it is still reachable through a causally plausible alternative route;
- only the original route has become unavailable;
- the original event's meaning has changed so substantially that the CT may no longer apply.

A temporary obstacle, an NPC's reluctance, or a currently unknown route is not proof of impossibility. Search for plausible alternatives before concluding that a CT requires revision. Do not silently treat a substitute event as equivalent unless the authored constraints permit that equivalence.

If no plausible route is established and the CT's validity remains unresolved, preserve the unresolved conflict for explicit handling; do not fabricate a guaranteed solution or silently waive the obligation. Preserve already-realized events and their consequences. Reviewing one CT does not automatically alter unrelated CTs.

### 8.5 Autonomy without plot puppeteering

The engine must not secretly rewrite NPC motives, beliefs, or prior actions solely to steer them toward a CT. NPCs choose their responses; the story layer constrains and evaluates outcomes separately. When an NPC's choice conflicts with a mandatory CT, first explore other plausible world-level paths to the CT rather than forcing the NPC to make an out-of-character choice.

A mandatory CT is therefore a constraint on story progression, not a command that every NPC must obey or a license to falsify causal history. The engine must keep the distinction between an NPC's intention, the action they actually take, the action's resolved outcome, and the resulting CT status.

### 8.6 Example: staged death, public grief, and a concealed identity

This is a required capability scenario for design and future acceptance tests, not a claim that the current runtime already implements it.

**Initial state:** The player character stages their own death. Their husband knows privately that they are alive, but publicly performs grief to protect the cover and manage other people's beliefs. Other NPCs do not automatically share his private knowledge. On the following day, the player character appears in his organization as a secretary under a different identity.

The engine should preserve several distinct layers at once:

- **World facts:** the death was staged; the husband privately knows the player character survived; the secretary has appeared under a cover identity.
- **Publicly established events:** the apparent death and the husband's visible grief occurred and remain part of social history even though the grief was performative.
- **Per-NPC epistemic state:** what each NPC witnessed, was told, believes, doubts, suspects, or does not know. The husband's private knowledge must not leak to others without an in-world information path.
- **Social memory and open questions:** the sudden arrival of a secretary, hiring/provenance, timing after the apparent death, the husband's public behavior, and any inconsistencies noticed by observers remain available to influence later decisions.

NPCs should react autonomously according to personality, relationship, role, goals, access to evidence, and risk tolerance. Some may ask the husband who the secretary is, how she was hired so quickly, or how he is coping after his wife's apparent death. Others may notice that his behavior seems inconsistent with his public grief, quietly compare timelines, investigate, discuss suspicions with trusted people, spread rumors, exploit the situation, or dismiss it as ordinary. No single reaction is mandatory for every NPC.

The engine must distinguish **observation → suspicion/hypothesis → corroboration → belief/knowledge**. A resemblance, unusual timing, gesture, voice, or other clue can raise suspicion but must not automatically reveal the cover. NPCs may reach different conclusions from the same evidence; they can be mistaken, deceive others, or revise their beliefs when new evidence arrives. Investigation and rumors must have causal sources and information paths, not omniscient access.

The husband should respond according to his own goals and the public cover, potentially deflecting, lying, providing a plausible explanation, or privately coordinating with the secretary. The engine must not choose or narrate the player character's actions, words, thoughts, or consent on the player's behalf. It may create NPC initiatives and consequences around the player, but must leave the player's response to the player.

Crucially, the prior public grief is not erased by the secretary's arrival, and the new identity is not automatically exposed. The situation should continue to generate social consequences over time: questions can remain unanswered, suspicions can grow or fade, rumors can spread, and NPCs can act on incorrect theories. These outcomes should arise from durable world state, per-character knowledge/beliefs, social memory, autonomous action selection, and persisted consequences—not from relying on the language model to remember the whole sequence from chat history alone.

**Acceptance criteria for a future vertical slice:**

1. Persist the staged-death event, the public grief performance, and the secretary's arrival as distinct events with provenance and chronology.
2. Demonstrate that the husband knows the truth while selected other NPCs do not, unless a valid information path changes their knowledge.
3. Given different NPC profiles and evidence, produce differentiated reactions (for example, a direct question, quiet suspicion, an investigation, or no concern) without forcing all NPCs into the same response.
4. Preserve the difference between fact, observation, suspicion, belief, and confirmed knowledge across a restart/replay.
5. Make investigations, conversations, and rumors create traceable information flow and potentially change later NPC beliefs/actions.
6. Do not identify the player character solely because the story requires drama; do not erase public grief or make NPCs forget it without a causal reason.
7. Keep player-character agency intact: NPCs can initiate and react, but the system does not author the player's side of the interaction.

These criteria are aspirational until implemented and demonstrated in the real runtime. Prompt-only examples or fixture-only callbacks are not proof of production capability.


## 9. Sources of behavioral logic: roles, institutions, and individual NPCs

This is an architectural requirement, not a claim about current runtime capability. The engine must not depend on hard-coded scripts for every profession or social group. It should derive candidate behavior from multiple explicit sources and validate the result against authoritative world state.

### 9.1 Decision inputs

A candidate NPC action should be reasoned about using all relevant layers:

- **World Pack rules:** the world's laws, customs, institutions, permissions, prohibitions, available actions, and consequences.
- **Social/professional role:** typical duties, authority, competencies, limitations, and expectations. A role constrains plausibility but does not dictate one response.
- **Organization and subculture:** hierarchy, internal rules, loyalties, debts, territory, discipline, incentives, and sanctions for the specific institution or group.
- **Individual profile:** stable traits, values, fears, habits, goals, relationships, private motives, and accumulated experience.
- **Epistemic state:** what this NPC observed, was told, inferred, suspects, believes, or falsely believes. Another character's knowledge must not leak automatically.
- **Current situation:** present actors, evidence, risks, resources, obligations, goals, feasible options, and already-committed consequences.

### 9.2 Example: a police officer and a yakuza member

The label “police officer” must not imply “always arrest”; the label “yakuza” must not imply “always threaten or fight.” A police officer may lawfully arrest, question, negotiate, warn, withdraw for lack of evidence, abuse authority, or act corruptly only where the world rules, authority, available knowledge, individual profile, and circumstances make the candidate plausible. A yakuza member may obey a superior, defend territory, negotiate, conceal a breach, avoid unnecessary violence, or betray the organization for a credible personal reason. These are constrained possibilities, not arbitrary model choices.

NPCs may hold multiple or conflicting roles—for example, a police officer who is also a criminal organization's informant. The engine must represent competing duties, incentives, risks, and loyalties rather than reducing the character to a single label. Two NPCs with the same role may act differently because their profiles, knowledge, goals, and circumstances differ.

### 9.3 Authority of sources

- Versioned, author-defined **World Pack rules** are authoritative for the specific world's mechanics and institutions. Do not silently substitute a newer rules version or retroactively change the meaning of committed events.
- **Role and organization profiles** describe the usual permissions, duties, incentives, constraints, and sanctions for roles/groups. Their representation and relationship to World Pack, Personality, and NPC must be agreed architecturally before implementation.
- **NPC history and experience** explain individual skills, relationships, beliefs, errors, and revisions. New experience can change beliefs or plans without erasing the causal history.
- The language model's pretrained knowledge is only a weak interpretive prior. It must not invent canonical powers, laws, organization rules, or mandatory consequences absent from the authoritative world sources.

When sources conflict or required information is missing, the engine must apply an agreed authority/version policy or preserve the uncertainty for explicit handling. It must not silently fill gaps with invented facts.

### 9.4 Proposal is not an event

The model may propose candidate actions and explain their plausibility. A proposal is not a committed action or world event. The engine must validate epistemic access, authority and capability, preconditions, resources, timing, and applicable World Pack rules; resolve conflicts through the approved Core path; and persist only the validated result and its consequences. An NPC's intention, a model proposal, an authorized action, and the actual resolved outcome are distinct states.

### 9.5 Scope and future acceptance checks

This proposes an extensible role-and-social-institution profile mechanism; it does not introduce runtime APIs, schemas, storage contracts, or implementation claims. Core approval is required before defining new contracts. A future vertical slice should test: (1) two different personalities sharing one role and responding differently; (2) one NPC holding conflicting roles; (3) separation of world fact, observation, suspicion, belief, and knowledge; (4) pinned/versioned world rules and no silent retroactive semantic change; and (5) validation and persisted consequences through the canonical Core path. Prompt-only examples or unvalidated model output do not prove production capability.


## 10. NPC decision cycle: from situation to validated consequence

This is a proposed behavioral contract for the NPC block. It does not define a runtime API, storage schema, or new Core transaction path.

### 10.1 Decision cycle

1. **Establish the actor's decision context.** Gather only relevant current world state, the actor's roles and capabilities, stable traits and mutable condition, goals, plans, relationships, obligations, resources, recent events, and unresolved tasks.
2. **Apply epistemic filtering.** Include only information the actor is authorized and causally able to know. Preserve distinctions among observed facts, testimony, inference, suspicion, belief, and unknown information. Do not supply omniscient state by default.
3. **Identify the active pressures.** Determine which goals, duties, loyalties, fears, deadlines, risks, and relationships are relevant. Conflicts between them should remain visible rather than being silently collapsed into one generic personality label.
4. **Generate plausible candidate actions.** The model may propose more than one option, including inaction, delay, inquiry, negotiation, concealment, cooperation, deception, retreat, or escalation where appropriate. Candidate actions must be grounded in this actor's capabilities, knowledge, motives, and circumstances; the role label alone is not enough.
5. **Check feasibility and rules.** The engine must validate preconditions, epistemic access, permissions, capabilities, resources, timing, applicable pinned World Pack rules, and known constraints. A plausible intention is not proof that the action can be performed.
6. **Resolve competing actions and world constraints.** If actors' actions conflict, use the existing approved Core conflict-resolution and commit path. NPC-local reasoning must not bypass Core authorization, validation, idempotency, or persistence.
7. **Resolve the outcome.** Distinguish the intended action from the action actually allowed and the outcome that occurs. Success is not guaranteed: an action may fail, be blocked, be interrupted, or produce a different rule-governed result.
8. **Persist causal consequences through the approved owner path.** Record the accepted event/result and its causal relationship using existing approved contracts. Do not create a parallel NPC-owned world-state/event store.
9. **Reassess affected NPC state.** Update goals, plans, tasks, relationships, beliefs, or current condition only where the resolved outcome and acquired information justify a change. Do not rewrite stable traits or prior history merely to make the next action convenient.
10. **Schedule follow-up and communication.** If consequences create a new task, deadline, report, investigation, or opportunity for another NPC, make it eligible through the approved process/time mechanisms. A pending message or report is not equivalent to information received.
11. **Narrate only what is appropriate to reveal.** Narration represents resolved state and permitted perspective; it must not silently turn a proposal into a fact, grant the player knowledge they have not acquired, or author the player's response.

### 10.2 Separation of responsibilities

- **LLM / decision reasoning:** interpret context and propose candidate actions, motives, dialogue, and uncertainty-aware explanations.
- **NPC domain logic:** determine actor-relative relevance, connect roles/personality/knowledge/goals to candidate behavior, and identify what state may need reconsideration.
- **World Pack:** define world-specific rules, capabilities, preconditions, and outcome semantics.
- **Core and approved domain owners:** validate authority, resolve conflicts, enforce transaction/idempotency rules, and commit durable world effects through the canonical path.
- **Narration:** communicate the resolved outcome according to perspective and information access; it does not own world truth.

This is a responsibility boundary, not a claim that all these mechanisms currently exist in production.

### 10.3 Failure and uncertainty behavior

- If a required rule, permission, capability, source, or precondition is missing or ambiguous, do not silently invent it. Apply an existing approved fallback if one exists; otherwise preserve the unresolved decision for explicit handling.
- If the candidate action is impossible, reject or request a different candidate without pretending it happened.
- If two actions compete for the same exclusive resource or produce incompatible effects, do not let generation order alone decide the winner. Use the approved conflict-resolution policy or leave the conflict unresolved.
- If the action fails, retain the failure and its consequences when the world rules say they occurred; do not silently retry until success.
- If new evidence changes the actor's belief, update the belief only through the approved state path and preserve the evidence/provenance and prior causal history.
- If narration fails after a world effect has committed, do not commit the same effect again merely because narration is retried.

### 10.4 Future acceptance checks

A future vertical slice should demonstrate, against the actual approved integration path:

1. The same situation yields meaningfully different candidate actions for two NPCs with different profiles, without violating shared world rules.
2. An NPC does not act on information it has not acquired through a valid in-world path.
3. A candidate requiring unavailable authority, capability, resources, or prerequisites is not committed as a successful event.
4. Competing actions do not win solely because one was generated first.
5. Intended action, validated action, resolved outcome, and narration remain distinguishable.
6. A failed action is not silently repeated until success; retries remain idempotent.
7. A restart/replay preserves committed consequences and does not duplicate them.
8. A missing or conflicting authoritative rule remains explicitly unresolved rather than being filled with invented world mechanics.

Until the relevant contracts and real runtime tests exist, these are design requirements, not evidence of current implementation.


## 11. Conflict scenario: police officer suspects a yakuza member

This is a design-level trace for reviewing the decision cycle in §10. It is not a runtime test and does not claim that the current engine implements the flow.

### 11.1 Initial conditions and knowledge boundaries

- The police officer observes a meeting and a suspicious exchange, but has no legally sufficient evidence of a specific offense.
- The yakuza member knows their own purpose and the facts they personally observed; they do not automatically know what the officer inferred.
- A third NPC may know a relevant fact, but neither principal receives it unless an in-world information path establishes access.
- The active World Pack version defines applicable law, police powers, evidence requirements, permitted actions, and consequences. If those rules are absent or ambiguous, the engine must not invent jurisdiction-specific law.
- Each NPC has separate goals, role obligations, relationships, risk tolerance, beliefs, and current plans. These may change candidate ranking, not the authoritative rules.

### 11.2 Expected decision trace

1. **Context:** construct a separate actor-relative context for each NPC. The officer gets the observation and their own inference, not the yakuza member's private intent. The yakuza member gets only what they observed or learned.
2. **Candidate generation:** the officer may consider observation, lawful questioning, seeking corroboration, reporting, warning, withdrawal, or an improper action if their profile makes it plausible. The yakuza member may consider leaving, answering, deflecting, negotiating, notifying a superior, or another feasible response. These are examples, not a mandatory fixed list.
3. **Feasibility:** validate every candidate against the pinned World Pack, current authority, available evidence, actor capabilities, timing, resources, and preconditions. Suspicion alone must not be silently upgraded to proof.
4. **Conflict detection:** if the officer attempts to detain the member while the member attempts to leave, do not select the winner by prompt order, generation order, or which model response arrived first.
5. **Resolution:** pass competing effects through the existing approved Core conflict/commit path. If the current contract cannot decide the conflict, preserve it as unresolved or request owner-level adjudication; do not fabricate a new conflict API or commit path.
6. **Outcome:** distinguish proposed intent, validated/authorized action, resolved result, and narration. A rejected or blocked detention is not a committed arrest. An attempted escape is not automatically a successful escape.
7. **Reassessment:** update either NPC's plans or beliefs only when the resolved outcome or newly acquired evidence justifies it. The officer may remain suspicious without becoming certain; the yakuza member may revise their risk assessment only if they learn about the officer's response.
8. **Follow-up:** investigation, a report, a rumor, or notification to a superior is a new process only through an approved existing mechanism. A pending report is not proof that its recipient received it.
9. **Persistence and replay:** committed outcomes and their causal history must survive restart/replay under the guarantees actually supported by Core. Retries or narration regeneration must not duplicate a committed effect.

### 11.3 Negative-case acceptance matrix

| Case | Required result | Boundary / evidence status |
|---|---|---|
| Officer has suspicion but no sufficient evidence | Do not silently treat suspicion as proof or authorize an evidence-dependent action | Requires pinned World Pack semantics and Core validation |
| Yakuza member's private motive is unknown to officer | Keep motive out of officer context unless an information path reveals it | Requires actor-relative context and acquisition boundary |
| Two NPCs propose incompatible actions | No generation-order winner; use approved conflict path or remain unresolved | Core-owned; do not invent a replacement |
| Role label conflicts with individual goal | Consider competing pressures; do not hard-code one inevitable response | NPC/Personality/World Pack boundary needs agreed representation |
| Relevant law or permission is missing/ambiguous | Fail closed or preserve explicit unresolved state | Requires approved ambiguity behavior |
| Action is rejected or blocked | Do not narrate it as a successful committed event | Requires proposal/commit/outcome separation |
| A report is queued but not delivered/received | Recipient does not gain knowledge merely from queueing | Requires real delivery/receipt contract |
| Same committed action is retried after narration failure | Do not duplicate the world effect | Requires actual Core idempotency/replay guarantee |
| Restart occurs after a resolved conflict | Preserve committed outcome; do not invent a new winner | Requires exact-head restart/replay test |

### 11.4 Review conclusion and next executable step

This scenario is an architectural review oracle, not proof of implementation. Before treating it as executable acceptance, the NPC owner must map each row to the exact current code path, tests, pinned SHA, and owning contract. Where no real seam or test exists, record **UNVERIFIED / BLOCKED**, not pass. The smallest useful runtime slice is one actor-relative context check plus one competing-action case on the existing approved Core path; if either seam is absent, the next action is a precise owner decision, not a mock receiver or a new API.

Production Memory→NPC remains **DISABLED / FAIL-CLOSED** until its independent authorization, lineage, acquisition, reconciliation, revocation, and disclosure gates pass.


## 12. Current-code trace: what exists and what remains unproven

Audit basis: default branch `main` at commit `fd904ccadc13129616f9d0855ba26b238eabd709` (2026-10-26). The source files below were inspected at these exact blob SHAs. This is source inspection only; no Runtime CI or local test command was executed as part of this audit.

### 12.1 Evidence matrix

| Decision-cycle seam | Exact source evidence | What the source supports | What it does not prove |
|---|---|---|---|
| Actor identity binding | `src/application/actor-bindings.js`, blob `02e34dd2e26c6b6957ad63bc84ec7124b626c031` | Core-owned binding resolves an authenticated adapter to a canonical actor; source comment explicitly says this authorizes identity resolution only | It does not grant knowledge access, choose NPC actions, or authorize commits |
| Bounded Memory retrieval for an NPC | `src/application/memory-npc-consumer.js`, blob `767adcefa3385e1e7545f7eb921a737ca8f6d7e2` | An internal injectable consumer checks actor binding, Memory query/record authorization, completeness, freshness, source identity, canonical Core reads, snapshot agreement, duplicate identity conflicts and admission metadata; failures return non-ready | The source comment says it is not wired into the public API and has no default provider/policy; this is not a general NPC decision runtime and does not itself establish delivery, receipt, acquisition or belief |
| Candidate admission | `src/npc/memory-candidate-eligibility.js`, blob `ad3c09b34bbde89b977a43c07e91824e28234395` | Pure, schema-neutral eligibility oracle rejects missing scope, snapshot, lifecycle, access and lineage evidence | The module's own header says it is not an authorization service, adapter or production read API |
| Candidate-admission regression coverage | `tests/npc-memory-candidate-eligibility.test.js`, blob `fe9143856af250712909f1b937ab74a61c4ce34c`; `tests/memory-npc-consumer.test.js`, blob `72a01b2695a0ef020479e9502e51e726dba24f61` | Source contains tests for fail-closed admission, duplicate/conflicting identities, stale snapshots, authorization revocation races, source read boundaries and the distinction between admission and later lifecycle states | Presence of tests is not a claim that they were executed in this audit or that the full integration gates passed |
| Process scheduling and persistence | `src/application/engine.js`, blob `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`; `src/time/scheduler.js` | Engine has process/time operations and canonical event commit methods; scheduler header explicitly says it plans due work and does not execute effects or grant NPC knowledge | Due-work scheduling is not autonomous NPC deliberation, action conflict adjudication or knowledge acquisition |
| Knowledge/delivery boundary | `tests/process-knowledge-isolation.test.js`, blob `ecf845a257a12a29afc008345526787f58d4999c` | The test asserts process completion does not create knowledge, delivery or receipt side effects | It does not provide a delivery/receipt mechanism |
| Public HTTP surface | `src/api/server.js`, blob `f97e4ed28a540b89073653dc0a8ec0fc9c0a50bb` | Current API server imports ProposalService, ActorBindingService and AuthorizedReadService | Source inspection found no reference to `MemoryNpcConsumer`, `retrieveForNpc` or an NPC decision route in this file; do not treat the internal consumer as a public production integration |
| NPC decision generation / competing-action resolution | Current `src/` tree at `main` includes `src/npc/memory-candidate-eligibility.js`, but no dedicated NPC decision-cycle executor module was found in the inspected tree; `engine.js` exposes time/process and event operations | Existing primitives can support bounded parts of the architecture | The full sequence “actor-relative decision context → candidate actions → NPC action validation → competing-action resolution → durable NPC state reassessment” is not evidenced as an implemented end-to-end NPC runtime by these files |

### 12.2 Concrete trace for the police/yakuza scenario

1. **Can bind each NPC to an authenticated adapter?** A Core actor-binding mechanism exists, but it is an identity boundary, not the full decision context.
2. **Can the engine retrieve candidate Memory safely for an NPC?** An internal injectable consumer and targeted source tests exist. The consumer is not wired into the public API; its owner-provided Memory callbacks and approved lifecycle contract remain prerequisites.
3. **Can the engine prove that one NPC knows only what they acquired?** The current tests explicitly preserve the boundary between process completion and knowledge/delivery/receipt. The inspected evidence does not show a complete production acquisition/delivery subsystem for this scenario.
4. **Can the engine generate and validate the officer's and yakuza member's competing actions?** No dedicated end-to-end NPC decision executor was found in the inspected current source tree. This remains **UNVERIFIED / BLOCKED**, not a passing capability.
5. **Can Core commit a validated canonical event?** The engine exposes `commitEvent` and `commitSegment`; this alone does not establish an NPC-specific action validator or deterministic conflict policy.
6. **Can a report or conversation change the recipient's knowledge?** The inspected process-boundary test explicitly prevents treating process completion as knowledge, delivery or receipt. A real owner-approved path for those lifecycle transitions is still needed before this scenario can pass.
7. **Can restart/replay preserve the same NPC conflict outcome?** Existing process persistence/replay tests cover process milestones, not the full NPC action/conflict cycle. No end-to-end evidence for the latter was found in this audit.

### 12.3 Result and owner-facing next step

The code evidence supports several useful foundations—actor binding, canonical event operations, process scheduling, an internal fail-closed Memory consumer, and extensive targeted Memory admission tests. It does **not** support claiming that autonomous NPC decisions, NPC-vs-NPC conflict resolution, knowledge acquisition, or the full decision cycle are implemented end to end.

Next step is a narrow owner-reviewed vertical slice, without inventing a contract: first identify the approved existing seam for actor-relative context and action proposal/validation; then require Core to name the canonical conflict/commit path and the domain owner to name how a delivered in-world message becomes acquired knowledge. If those seams do not exist, record the exact blocker and obtain owner approval before any API/schema/runtime addition. Do not wire Memory→NPC into production as part of this NPC-only audit.

Memory→NPC remains **DISABLED / FAIL-CLOSED**. No test pass is claimed from source inspection alone.


## 13. NPC decision logic as a bounded, deterministic pipeline (design work independent of Memory integration)

**Status:** design contract candidate for review, not an implemented runtime, API, schema, or authorization contract. This section advances NPC behavior logic without waiting for the real Memory→NPC path. It does not authorize production Memory reads, event commits, or a new executor.

### 13.1 Keep the inputs semantically separate

A decision pass may reason over these categories only when the corresponding source is actually available and authorized:

- **World rules:** pinned World Pack/rule-module semantics, including action preconditions, consequences, institutional procedures, and conflict policy.
- **Role and institution:** duties, permissions, procedures, loyalties, incentives, and limits attached to an occupation or organization. A role is not a complete personality and does not prove what this individual knows.
- **Stable traits:** enduring personality tendencies and values. They influence preferences; they do not rewrite world rules or grant capabilities.
- **Temporary state:** current emotion, fatigue, injury, urgency, fear, anger, and other time-sensitive conditions, each with its own supported source and duration.
- **Experience and relationships:** established outcomes that may alter future expectations, trust, obligations, and willingness to cooperate. These must not be inferred from a merely proposed or narrated event.
- **Actor-relative knowledge:** propositions and evidence available to this actor, with provenance and epistemic status preserved (observed, received, inferred, suspected, believed, contradicted, or confirmed only where the existing approved semantics support the distinction).
- **Situation:** current world state, time, location, available resources, active commitments, and competing actions, using canonical state rather than free-form narration as authority.

These categories must not be flattened into one prompt-like blob with no provenance. Missing input is unknown, not false; a suspicion is not a confirmed fact; a public event is not automatically known to every NPC.

### 13.2 Decision pass

The conceptual pipeline is:

1. **Establish the actor and decision point.** Resolve the actor through the existing owner-approved identity boundary. If the actor, world/rule version, or decision-time state cannot be established, do not produce a commit-ready action.
2. **Build the actor-relative situation.** Collect only available, authorized facts. Preserve source, time/version, and epistemic status wherever existing contracts provide them. Do not silently fill missing knowledge from model general knowledge.
3. **Derive applicable constraints.** Evaluate the pinned World Pack and role/institution rules for this situation. Separate hard preconditions/prohibitions from soft preferences and incentives.
4. **Generate candidate actions.** Consider only actions supported by the domain's approved action vocabulary and currently available capabilities. Candidate generation is a proposal step; a language model may suggest possibilities but cannot establish their legality, feasibility, or canonical effects.
5. **Validate each candidate.** Check preconditions against canonical state, actor capabilities, permissions, resources, time, and actor-relative knowledge requirements. Reject impossible actions; mark genuinely unresolved preconditions as unresolved rather than assuming success.
6. **Evaluate trade-offs.** For feasible candidates, compare rule-defined objectives, costs, risks, commitments, relationship consequences, and personality/temporary-state influences. Personality may change which legal option is preferred; it cannot make an illegal or impossible option valid.
7. **Choose or defer.** Apply the pinned domain policy. If two candidates remain incomparable and no approved policy resolves the choice, return an explicit unresolved decision for owner/domain handling rather than inventing a universal priority.
8. **Submit for canonical arbitration and commit.** The selected candidate is still a proposal. Existing Core-owned validation, conflict resolution, authorization, idempotency, and commit boundaries remain authoritative. No NPC helper or model output commits canonical state by itself.
9. **Reassess from the actual outcome.** Update plans, temporary state, relationship interpretation, and beliefs only from committed outcomes and separately established information-acquisition transitions. A failed, interrupted, cancelled, or merely narrated action is not a successful world effect.
10. **Schedule follow-up.** If the action takes time or depends on a future condition, use the approved Time/Process mechanisms. Scheduling due work is not execution and does not grant knowledge.

### 13.3 Competing NPC actions

When multiple NPCs act in the same interval, do not resolve conflict by whichever model response arrived first or by arbitrary list order.

- Establish the relevant shared canonical state and the pinned conflict policy before comparing actions.
- Detect conflicts only where supported action semantics show incompatible effects, contention for the same resource/target, mutually exclusive occupancy, or invalidated preconditions.
- Apply explicit World Pack policy for precedence, negotiation, interruption, escalation, or coexistence. A police officer, a yakuza member, a civilian, and an organization may have different legal powers and incentives, but no role label alone guarantees the outcome.
- Revalidate affected preconditions after any earlier action is committed. A candidate that was valid against an old snapshot may become stale.
- If no domain rule can decide a material conflict, preserve it as unresolved. A stable technical tie-break may make iteration reproducible only after semantic precedence is established; it must not masquerade as a world rule.
- Commit each resolved effect through the canonical Core path. A batch of proposed actions is not a batch of canonical events unless an approved transaction contract explicitly says so.

### 13.4 Intent, action, outcome, knowledge, and narration are different facts

Keep these transitions distinct:

- **Intent/plan:** what the NPC is considering or attempting.
- **Validated proposal:** an action candidate whose known preconditions have been checked.
- **Authorized/committed action:** an action accepted through the existing canonical boundary.
- **Outcome:** the effect that actually occurred, including partial failure or interruption where supported.
- **Exposure/delivery/receipt/acquisition/belief:** separate information lifecycle states; none follows merely from an action commit or context construction.
- **Narration:** the human-readable account of established events and actor-visible information. Narration describes state; it does not create canonical state or grant every listener the narrator's knowledge.

This separation is required for deception and mistakes: an NPC may intend to lie, fail to act, act on a false belief, or misunderstand an outcome. The world outcome and each NPC's belief must not be forced to match the narration.

### 13.5 Determinism, replay, and version boundaries

- For deterministic replay, use the same recorded inputs, canonical pre-state, and pinned rule/module versions; do not silently substitute the latest World Pack.
- Replaying a committed outcome is different from recomputing what an NPC would decide under changed rules or newly acquired knowledge.
- Historical semantic re-evaluation and meaning-changing migration require their own approved policies; this section does not authorize either.
- A retry must not duplicate a committed effect. Use only existing approved idempotency and transaction contracts; do not invent an NPC-specific event ID or store here.
- If required versions, canonical state, or prior outcomes are missing or incompatible, stop the decision/replay and report the blocker. Do not guess a replacement rule.

### 13.6 First behavior slice and acceptance criteria

The first logic-only behavior slice should be a deterministic **single decision point with two NPCs and one contested situation**, using explicitly supplied, non-production test state and pinned test rules. It is intentionally independent of the real Memory adapter; any knowledge needed by the scenario must be supplied as a clearly marked test fixture and must not be presented as production Memory authority.

Acceptance for that slice:

1. Two actors with different role/institution constraints and personality tendencies can produce different candidate rankings from the same world situation without changing hard world rules.
2. An actor cannot use a fact absent from its actor-relative test context as if confirmed; unknown, suspected, and confirmed facts lead to distinguishable candidate eligibility where the test rules require it.
3. Impossible or prohibited actions are rejected before arbitration.
4. Competing feasible actions are resolved only by the pinned test conflict policy; missing/incomparable policy yields an explicit unresolved result, not an invented winner.
5. After the first committed effect changes a precondition, stale candidates are revalidated and cannot commit unchanged.
6. Intent, proposal, commit, outcome, knowledge acquisition, and narration remain distinct; no later state is inferred from an earlier one.
7. Same inputs, state, and pinned rules yield the same result; replay does not duplicate effects.
8. Missing rule versions or required state fail closed.
9. Tests are labeled as isolated logic tests, not end-to-end Memory→NPC or production evidence.

**Next implementation gate:** before adding an executor or new data shape, map this pipeline to existing Core/World Pack/Personality/Time contracts and identify which steps have approved callable seams today. Implement only a bounded NPC-owned pure component if that mapping shows a real, testable gap that can be closed without new cross-block authority; otherwise retain this as a reviewable proposal and request the specific owner decision.


## 14. Code-mapped seam review for the decision pipeline (main snapshot inspected 26 Oct 2026)

This is a source inspection, not a test run. The references below are on current `main` at the time of inspection; the documentation branch itself is not runtime evidence.

| Pipeline responsibility | Existing code evidence | What the code supports | What is still missing / must not be inferred |
|---|---|---|---|
| Rule/module version identity | `src/core/mechanics.js`, blob `124d43159a4087cbb4b2582646cc7398ae6edfcc`; `validateMechanicTemplate`, `validateRuleModuleManifest` | Validates existing mechanic template and rule-module manifest structures | Does not provide NPC role/personality profiles or select which institutional rules apply to an individual |
| Action applicability and preconditions | `evaluateMechanicActionConditions(value, actionId, context, options)` in the same file | Returns tri-state `true` / `false` / `unknown` over template applicability, action preconditions, and constraints; reports unknown paths; missing action is rejected | It evaluates one declared mechanic action at a time. It does not generate NPC candidates, compare their utility, infer actor knowledge, or choose a winner between actors |
| Canonical world/event boundary | `src/application/engine.js`, blob `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`; `LogicEngine.validateEvent`, `prepareEvent`, `commitEvent`, `commitSegment` | Existing Core-owned event preparation/validation and commit operations | Their existence alone does not establish an NPC-specific action proposal contract, an NPC action executor, or a policy for competing NPC actions |
| Time and due work | `src/time/scheduler.js`, blob `d935c2c5e2815486f720fb42a8cbb2259a4a371c`; `planDueWork` | Pure due-work planning over canonical coordinates | Explicitly does not execute effects, advance time, access storage, or grant NPC knowledge; it is not the NPC decision loop |
| Memory eligibility | `src/npc/memory-candidate-eligibility.js`, blob `ad3c09b34bbde89b977a43c07e91824e28234395` | Pure candidate eligibility oracle over supplied evidence | Not a decision-context builder, Memory adapter, authorization service, or production receiver |
| Full NPC decision cycle | Inspected `src/` snapshot and exported methods above | Reusable primitives exist for condition evaluation, event validation/commit, process/time operations, and Memory candidate eligibility | No dedicated end-to-end actor-relative NPC decision executor or competing-action resolver was identified in this inspection |

### Consequence for implementation planning

The smallest defensible next code step is **not** to add another scheduler or to call `commitEvent` directly from a model. First, an owner-reviewed mapping must establish how an NPC action candidate maps to an existing mechanic template/action, how the actor-specific context is assembled and authorized, and how Core expects the validated action to become a canonical event. The existing tri-state condition evaluator is a useful validation primitive: `false` can reject a candidate; `unknown` must not be treated as true. But choosing among candidates, personality/role scoring, conflict arbitration, and outcome-based reassessment remain separate responsibilities.

Until those mappings are approved, do not create a new action schema, decision API, NPC executor, conflict queue, or persistence model in this NPC documentation task. A pure NPC-owned function may be considered only after its input contract can be expressed using already-approved structures and its output cannot bypass Core validation/commit. Memory-dependent facts remain unavailable unless supplied by the real approved path; test fixtures must be labeled as test-only.


## 15. First work item — define the minimal NPC decision cycle

**Purpose:** make the first item from §13 implementable and reviewable without depending on Memory integration. This is a behavioral contract proposal, not a new runtime schema or a claim that the cycle already exists.

### 15.1 The cycle has six decision stages

**Stage A — Establish the decision frame**

Before reasoning, identify the acting NPC, world, decision point, canonical pre-state/snapshot, and pinned rule/template versions available through approved mechanisms. The frame must not be reconstructed from narrative text alone.

- If actor identity is unresolved, stop.
- If required world/rule version is missing or incompatible, stop.
- If the canonical state needed to evaluate an action is incomplete, preserve the relevant condition as unknown; do not assume it is false or true.
- A test may provide a synthetic frame, but it must be marked as a fixture and cannot establish production authorization or Memory provenance.

**Stage B — Build the actor-relative situation**

Separate available propositions into: established canonical state; facts this actor has actually observed or received through an approved path; inferences/suspicions; and unknowns. Keep the source and temporal scope wherever the existing input contract supplies them.

The model must not fill gaps by importing general world knowledge as if the NPC had learned it. The same event can therefore be available to one NPC and unavailable to another. This stage describes a future input requirement; the current Memory candidate oracle does not build this context.

**Stage C — Determine applicable rules and constraints**

Select only already-pinned, applicable mechanic/template and domain rules. Separate:
- hard constraints: action unavailable, prohibited, impossible, or missing required capability;
- preconditions: facts that must hold at the point of execution;
- soft preferences: goals, costs, risk tolerance, role priorities, personality and temporary state.

Soft preferences may rank feasible actions; they must never override a hard constraint. The existing `evaluateMechanicActionConditions` helper can evaluate a declared action's applicability, preconditions and constraints. Its `unknown` result must remain unresolved and must not be treated as permission.

**Stage D — Generate and screen candidate actions**

Candidate generation proposes possibilities from the already-supported action vocabulary. Each candidate must be traceable to its actor and decision frame. Screen candidates before ranking:

- reject an action whose required precondition is known false;
- do not mark an action feasible when a required precondition is unknown;
- reject actions outside the actor's established capabilities/permissions;
- do not invent an action kind, effect, rule, or mechanic because it would make a story more dramatic.

The model may help propose candidates in a future approved implementation, but a model-generated statement is not proof that a condition holds and is not a canonical event.

**Stage E — Rank feasible candidates or defer**

Compare only candidates that survive screening. Use the pinned domain policy and explicit priorities. Personality and temporary state can change preferences among feasible choices; they cannot change facts, permissions, or world rules.

A choice is allowed only when the applicable policy supports it. If two choices are incomparable, a required input is unknown, or the policy is missing, return a non-committal unresolved decision with a safe reason category. Do not silently break a semantic tie by array order, model wording, or response timing. Technical deterministic tie-breaking is acceptable only after the world semantics already establish that either outcome is equivalent.

**Stage F — Hand off, then reassess from evidence**

A selected candidate remains a proposal. The approved Core path must validate it, resolve any conflicts, and commit canonical effects. The NPC decision component must not call around that boundary.

Afterward, reassessment uses the actual committed outcome:
- committed success: evaluate the state change and any separately authorized knowledge/relationship transitions;
- rejected or stale proposal: re-evaluate against the current state;
- failed/interrupted/cancelled action: apply only the explicitly recorded outcome semantics;
- no commit/outcome evidence: do not narrate success as canonical fact.

Scheduling a later action is a follow-up, not proof that it executed. Narration reports established outcomes and actor-relative understanding; it does not create the outcome.

### 15.2 Minimal decision result categories (semantic labels, not API values)

For design and test discussion, use these meanings without introducing a new wire contract:

| Semantic result | Meaning | May produce a canonical event? |
|---|---|---|
| **blocked** | Required identity, version, authorization, or canonical input is unavailable | No |
| **no feasible candidate** | Candidates were evaluated, but each is prohibited, impossible, or known to violate a precondition | No |
| **unresolved** | Required condition is unknown, policy is missing, or viable options cannot be compared under approved rules | No |
| **proposal selected** | One feasible candidate is preferred under the applicable pinned policy | Not by itself; must pass Core validation/arbitration/commit |
| **outcome observed** | A separately established canonical result is available for reassessment | This is a post-commit input, not a decision result |

These labels are explanatory only. They are not a proposed JSON schema, enum, API response, database status, or permission grant.

### 15.3 Worked logic example — a guard decides whether to intervene

Use an isolated test fixture, not Memory production data.

- Canonical fixture: a guard is on duty at a public entrance; an NPC approaches; the guard has authority to ask questions but the fixture does not grant authority to detain without a stated precondition.
- Actor-relative fixture: the guard has observed an argument and heard a witness say that a threat was made; the threat is reported, not directly confirmed by the guard.
- Candidate A: ask the approaching NPC a question. Preconditions in the test rules are satisfied.
- Candidate B: detain the NPC. A test rule requires a confirmed immediate threat; the current context contains only a report, so that precondition is unknown or false according to the explicitly declared test semantics.
- Expected result: A may be proposed if no other constraint blocks it. B must not be selected as feasible merely because the model considers detention narratively plausible. If the rule evaluator returns `unknown`, the system must not coerce that to `true`; it either defers or selects another independently feasible action.

The fixture must state whether the witness report satisfies any rule condition. Do not let a test silently equate “reported threat” with “confirmed threat.”

### 15.4 Acceptance matrix for the minimal cycle

| Case | Expected behavior |
|---|---|
| Actor binding absent or ambiguous | Blocked; no proposal eligible for commit |
| Required pinned rule/template version missing | Blocked; never substitute latest version |
| Required state field is missing | Unknown/unresolved; do not assume a favorable value |
| Required precondition is false | Candidate rejected before ranking |
| Required precondition is unknown | Candidate is not commit-ready |
| Actor lacks a required capability/permission | Candidate rejected |
| Personality prefers an otherwise prohibited action | Prohibition wins; personality cannot override it |
| Two feasible candidates have a clear policy-defined preference | Select the preferred candidate as a proposal |
| Two feasible candidates have no approved comparison policy | Unresolved; no invented winner |
| State changes after candidate evaluation | Revalidate against current canonical state before commit |
| Core rejects proposal or reports stale state | No success narration; reassess from current evidence |
| Core commits a different/partial outcome | Reassess only from that actual outcome |
| Decision is retried with identical inputs | Same candidate result; no canonical side effect from evaluation itself |
| Decision inputs or pinned versions differ | Do not claim deterministic equivalence; evaluate under the explicitly supplied version/state |
| Model adds a fact absent from actor context | Treat as unsupported for that actor; do not use it as established knowledge |

### 15.5 Implementation boundary and next concrete task

Before coding, map each stage to an existing approved callable contract:
1. actor/world/snapshot and pinned versions;
2. approved actor-relative context source;
3. existing mechanic/template lookup and condition evaluation;
4. approved action proposal representation;
5. Core's accepted event validation, arbitration and commit route;
6. evidence available for post-commit outcome and reassessment.

Only stages with an existing contract may be wired. If stages 2, 4, or 5 have no approved seam, the implementation task is blocked at that exact seam; do not compensate by creating an NPC-local schema or calling Core commit directly. A safe first implementation, if the mapping permits it, is a pure evaluator over explicitly supplied test context that returns screened candidate references and never writes state. Its tests must not be described as end-to-end NPC runtime or Memory integration tests.
