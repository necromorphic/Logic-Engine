# NPC Subsystem — Stage 0 Contract

Status: working specification on `feat/npc-subsystem`. This document defines semantics and boundaries only. It does not authorize API, storage, schema, prompt, or runtime changes.

## 1. Purpose and scope

The NPC subsystem describes how non-player entities maintain character identity, make decisions, act autonomously, acquire and use information, interact, and continue operating off-screen. It is a consumer of the canonical world simulation, not a second world engine.

The subsystem must remain usable across different settings. Setting-specific facts, capabilities, social rules, resources, and exceptions belong to the World Pack or explicit author configuration; they must not be silently promoted into universal rules.

## 2. Authority and source of truth

The following boundaries are mandatory:

- The core owns canonical world state, game time, event identity, causal provenance, validation, revisions, transactions, rollback, and—per the repository's architecture baseline—the authoritative knowledge records and delivery statuses when those capabilities are implemented.
- An NPC profile supplies relatively stable characterization and author constraints: temperament, values, habits, capabilities, boundaries, and known exceptions.
- NPC-domain state defines changing goals, plans, tasks, relationships, needs, intentions, current condition, beliefs, suspicions, and commitments. Authoritative knowledge/acquisition and delivery records follow the core architecture contract; until those records and interfaces exist, the NPC subsystem must treat unavailable fields as deferred rather than create a competing store.
- The World Pack defines setting-specific rules and available mechanics.
- A model may propose an intention, plan, interpretation, dialogue, or action. A proposal is not a committed event and does not itself change canonical state.
- Narrative text is a presentation of approved results. It is not proof that an event occurred or that an NPC learned something.

No subsystem may create a parallel canonical event log, world-revision counter, causality graph, rollback engine, or permission system.

## 3. Character identity and continuity

1. A character's stable profile constrains plausibility but does not make behaviour mechanically immutable.
2. A character may change their mind, act against a usual habit, lie, conceal intentions, make mistakes, or behave unexpectedly when a credible cause exists.
3. Significant changes should be explainable from available evidence: new information, changed goals, pressure, relationships, resources, prior commitments, or a declared author override.
4. Do not invent hidden motives, secrets, history, relationships, capabilities, or canon facts to fill gaps. Mark the matter unresolved or request an author decision.
5. Distinguish stable traits from temporary state. A temporary emotion or injury must not silently rewrite the stable character profile.
6. Identity and knowledge are subject-specific. Two identities, disguises, aliases, or personas are not assumed to be the same entity unless the world data explicitly links them.

## 4. Decision cycle

The intended conceptual cycle is:

1. Read a bounded, current view of the canonical world and the acting NPC's own state.
2. Apply epistemic and visibility filtering before the model sees any world information.
3. Identify active goals, obligations, risks, deadlines, resources, relationships, and unresolved tasks relevant to this decision.
4. Select or revise a plan; retain meaningful alternatives where uncertainty matters.
5. Propose a bounded next action or request adjudication when the outcome is ambiguous.
6. Validate the proposal against permissions, capabilities, preconditions, timing, World Pack rules, and player-agency constraints.
7. Commit only validated effects through the core's normal event/causality path.
8. Reconcile goals, plans, tasks, knowledge, and reports against the committed result.
9. Narrate only the effects and information permitted for the current viewpoint.

This is a semantic sequence, not a mandated call count, agent framework, or implementation design.

## 5. Goals, plans, tasks, and commitments

- A **goal** describes a desired condition, not a guaranteed future event.
- A **plan** describes a strategy with assumptions, dependencies, and possible alternatives.
- A **task** is a concrete step with an owner, prerequisites, progress, and a completion/failure condition.
- A **commitment** records an obligation or promise and must not be confused with a completed action.
- A **private intention** is not automatically known by other characters or the player.

Plans must be revisable. Reconsider them when a prerequisite fails, an assumption is contradicted, new relevant knowledge arrives, a resource becomes unavailable, a deadline passes, or an action fails. Do not force a plan to continue merely because it was previously generated. Do not erase a goal solely because one attempted plan failed.

Where priorities conflict, use explicit setting/author rules if available. Otherwise preserve the conflict as unresolved instead of fabricating a universal priority order.

## 6. Knowledge, beliefs, and information access

Keep these states distinct:

- canonical world fact;
- information a particular NPC has validly acquired;
- belief, suspicion, hypothesis, or false belief held by that NPC;
- information retrieved for a model call;
- information included in a prompt or narrative;
- information actually delivered and acknowledged through an in-world channel.

Retrieval, prompt inclusion, narration, and objective truth do not by themselves establish NPC knowledge.

A claim used as knowledge must have a plausible, traceable acquisition path, such as observation, communication, a document/recording, a permitted inference, or explicit author-provided initial knowledge. Do not retroactively invent a source to justify a character knowing something.

Before exposing information to an NPC decision, apply the applicable scope, access, secrecy, source-validity, time, and epistemic-status rules. Similarity search is never authorization to reveal information.

A secret explicitly reserved by the author must not be disclosed autonomously, intentionally or accidentally, merely to create drama. This restriction must be applied before model input or narrative generation; do not expose the secret and rely on the model to self-censor. A disclosure is allowed only when an applicable explicit author instruction authorizes it and no higher-priority constraint forbids it. Information spreads to other characters or the player only through plausible, supported channels.

When evidence changes or a source is invalidated, reconcile the affected knowledge. Preserve knowledge if another valid acquisition path still supports it. A character may retain a false belief until they receive and accept sufficient correction; changing canonical truth does not automatically update every mind.

## 7. Relationships and reactions

Relationships are mutable, multi-dimensional state, not a single universal score. Where a setting needs them, represent relevant dimensions separately (for example, trust, fear, affection, attraction, hostility, obligation, respect, suspicion, rivalry, debt, and cooperation) rather than treating them as interchangeable.

Different dimensions may coexist and change independently. Romantic tension may coexist with rivalry or a reluctant alliance; one character's attraction does not establish reciprocal attraction or consent. A change in trust does not automatically remove hostility, attraction, rivalry, obligation, or suspicion. Concrete interactions and their history are the primary evidence for relationship development; a numeric measure cannot replace the reasons behind the state.

A reaction should be based on what the NPC plausibly knows, their characterization, current state, relationship context, and the significance of the event. Minor events usually have limited or gradual effects; major betrayal, rescue, or revelation may cause a sharp change. Different NPCs may interpret the same event differently. Do not infer a relationship change merely because two characters appeared in the same scene.

An event may motivate a reaction, but causation must be supported by the actual simulation history or explicit adjudication; narrative coincidence alone is not proof.

## 8. Autonomy and off-screen continuity

NPCs may pursue valid goals when the player is absent or focused elsewhere. Their progress must be driven by world time, defined triggers, or explicit simulation operations—not by real operating-system time or the mere passage of chat turns.

Off-screen actions follow the same validation and causal rules as on-screen actions. Their effects may become canonical without immediate narration. Player awareness occurs only through an allowed viewpoint or valid information channel.

Keep separate:
- an event having occurred;
- an NPC being aware of the event;
- an NPC having a report to deliver;
- communication being possible;
- a report being sent;
- a recipient actually receiving or acknowledging it;
- the player being told.

A pending report is not delivered knowledge. Lack of narration is not evidence that nothing happened.

## 9. Player agency and narrative boundary

The subsystem must not decide the player's voluntary actions, dialogue, thoughts, feelings, intentions, consent, or unprovided reactions. It may describe externally observable consequences of validated events and NPC actions, subject to the agreed viewpoint.

NPC dialogue and narrative wording may add style and sensory detail but may not introduce consequential canonical events, change world time, grant inaccessible knowledge, or bypass simulation validation.

The NPC subsystem does not require a specific interface such as SillyTavern. Any host adapter is a separate integration concern.

## 10. Conflicts, uncertainty, and author control

When information is missing, rules conflict, or several outcomes remain plausible, distinguish an ordinary NPC-generated choice from an explicit author-mandated outcome.

1. Apply higher-priority system constraints, world rules, and player-agency boundaries.
2. If the author has directly required a specific action or outcome that is compatible with those boundaries, preserve it as a mandatory target. Do not silently cancel it merely because the NPC would ordinarily refuse or prefer another course.
3. First seek a plausible route using established motives, relationships, evidence, goals, pressures, commitments, and circumstances.
4. If established circumstances are insufficient, the system may prepare plausible new future circumstances or actions that could lead to the required outcome. These are prospective proposals until they occur through the approved world/event path.
5. Do not rewrite established history, fabricate past evidence, or present an invented prior motive or event as canon to justify the target. If a credible route cannot yet be grounded, keep the author-mandated outcome explicit and identify the missing rationale instead of silently cancelling it or fabricating a cause.
6. The author specifies only the outcome unless they also specify intermediate actions. NPC autonomy remains in choosing the unspecified path, subject to the required outcome and higher-priority constraints.
7. If no author-mandated outcome exists, preserve material uncertainty and request adjudication rather than silently choosing an unsupported consequential outcome.
8. Record the reason for an author override when the surrounding system supports such records.

A model's confidence or fluent explanation is not evidence. An inference must not be represented as a directly observed fact. An author-mandated target does not authorize inventing the player's voluntary actions, dialogue, thoughts, feelings, intentions, consent, or unprovided reactions.

## 11. Rollback and causal consistency

The NPC subsystem must use the core's causal and rollback contract. It must not implement an independent undo mechanism.

If a source event is rolled back, reconcile dependent NPC actions, knowledge, beliefs, plans, tasks, relationship changes, and reports according to their actual causal dependencies. Do not delete all later activity indiscriminately; do not preserve a dependent effect whose only valid prerequisite has been invalidated. Independent causes and alternative valid knowledge sources must survive where the core's rules say they should.

Audit history remains distinct from current active state. A rollback is a new operation with provenance, not silent erasure.

## 12. Required semantic test scenarios before implementation

The contract is not considered implementation-ready until tests cover at least these cases:

1. An NPC cannot act on a secret that was retrieved by search but for which they have no valid access or acquisition path.
2. A false belief persists until a valid correction reaches the NPC; canonical truth changing alone does not rewrite the belief.
3. Invalidating one knowledge source preserves the knowledge if another valid source remains.
4. A plan is reconsidered after a prerequisite fails, without automatically deleting its underlying goal.
5. An off-screen event changes canonical state without automatically making the player aware of it.
6. A pending report does not count as delivered or acknowledged.
7. Two NPCs with different knowledge or goals can react differently to the same canonical event.
8. A model-proposed action that fails validation does not change canonical state.
9. A rollback reconciles dependent effects but preserves independent later activity and independently supported knowledge.
10. The system does not invent a secret, motive, relationship, or canon fact when the source data leaves it unresolved.
11. The system does not author the player's voluntary action, dialogue, or internal state.
12. Advancing chat turns without advancing game time does not itself progress an NPC's time-dependent process.

These are semantic acceptance scenarios, not a declaration that tests or runtime features already exist. The expanded author-confirmed scenarios NPC-SEM-013–020 in `docs/32-npc-semantic-acceptance-matrix.md` supplement this baseline, especially for mandatory author outcomes, prospective causal preparation, reserved secrets, multidimensional relationships, and report/awareness boundaries.

## 13. Explicitly out of scope for this stage

This stage does not define or change:
- public API, TypeScript interfaces, database tables, SQLite migrations, or storage format;
- core event, revision, causality, transaction, or rollback implementation;
- vectorization, embedding, retrieval infrastructure, or existing vector-memory configuration;
- prompts, SillyTavern configuration, extensions, or host adapters;
- character-card projection contracts already being developed on separate branches;
- a universal numeric relationship model, universal emotion model, or setting-specific NPC facts.

Those decisions require a separate design step after the semantics and test cases have been reviewed.
