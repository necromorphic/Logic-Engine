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
