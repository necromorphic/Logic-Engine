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

