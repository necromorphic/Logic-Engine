# NPC Subsystem — Author Decisions and Semantic Delta

Status: consolidated record of author decisions collected in the project conversation. Documentation only. This file records agreed semantics and identifies where the existing Stage 0 contract needs clarification; it does not claim runtime support and does not authorize API, schema, storage, prompt, vectorization, or runtime changes.

## 1. Authority and status

The choices below were explicitly confirmed by the project author. They are requirements for the NPC subsystem and its eventual integration, not claims about what the current kernel implements.

Evidence labels:
- **Author-confirmed** — directly chosen or clarified by the author.
- **Aligned with existing contract** — already substantially expressed in `docs/31-npc-subsystem-contract.md`.
- **Clarification needed** — the existing contract needs a precise amendment or acceptance scenario.
- **Deferred** — implementation must wait for a real boundary and the relevant core semantics.

## 2. Author-confirmed semantic decisions

### 2.1 Information, sources, and reasoning — Author-confirmed

NPCs may acquire information from sources and draw logical conclusions. They must distinguish:
- information acquired through a plausible source or channel;
- inference or hypothesis drawn from available information;
- rumor or unverified assertion;
- an NPC's belief, including a false belief;
- canonical truth in the world.

A true fact in the world is not automatically known by every NPC. Search/retrieval or inclusion in a model prompt does not by itself mean an NPC acquired the information.

### 2.2 Responsibility boundary — Author-confirmed

The canonical core is responsible for canonical world state and for the validation/evidence mechanisms it actually implements. A trusted context-preparation caller/mediator is responsible for determining which information is available to a particular NPC and what may be included in that NPC's model input.

This is a target ownership boundary, not an assertion that such a trusted mediator already exists. Adapter identity is not automatically in-world NPC identity. The current context manifest and proposal lifecycle must not be treated as proof of NPC knowledge or access.

### 2.3 Memory and beliefs — Author-confirmed

Significant acquired information should persist over time. The trusted mediator selects the subset relevant to the current scene/decision. The intended semantics must allow forgetting or loss of detail, doubt, and changing beliefs.

A correction to canonical truth does not automatically erase an NPC's earlier acquisition or correct the NPC's belief. If a false rumor is later disproved, the NPC may still remember having heard it while no longer believing it.

The exact persistence owner and representation are deferred. Do not create a second event log, knowledge store, revision counter, or access-control subsystem in this branch.

### 2.4 Contradictory evidence and individual beliefs — Author-confirmed

NPCs assess sources and evidence, but source reliability must not mechanically dictate belief. NPCs may remain mistaken, trust the wrong person, or revise a belief after new evidence. Character traits and prior experience affect how evidence is interpreted.

Keep objective world truth separate from actor-relative belief and uncertainty. Do not force all NPCs to reach the same conclusion from the same evidence.

### 2.5 Beliefs can motivate action — Author-confirmed

An NPC may act on an incorrect belief. This may cause real consequences if the resulting action passes the existing core's validation and commit path. The system must not block every risky or mistaken action merely because the NPC's belief is not canonical truth.

This does not authorize bypassing validation, capabilities, preconditions, causality, world rules, or player-agency boundaries.

### 2.6 Character, motivation, and development — Author-confirmed

Use the combination of:
- a relatively stable character profile defining traits, values, habits, capabilities, boundaries, and author constraints;
- situational goals, motives, emotions, pressures, and plans that can change with circumstances;
- longer-term character development grounded in experiences and events.

A temporary emotion is not automatically a permanent character change. Long-term change must have a credible basis in the story. NPCs may act unexpectedly or against a usual habit when a credible cause exists.

### 2.7 Author-directed mandatory events — Author-confirmed, contract clarification needed

When the author directly requests a specific action or event, the engine must not silently cancel it merely because an NPC would ordinarily choose otherwise. The requested outcome is mandatory, subject to higher-priority system constraints and preservation of player agency.

The engine must preserve plausibility while reaching the requested outcome:
1. First use motives, relationships, evidence, goals, pressures, and circumstances already established in the world.
2. If these provide a reasonably plausible explanation, use that route without adding unnecessary new circumstances.
3. If existing circumstances are insufficient, prepare a plausible causal path using new developments or actions that occur from this point onward.
4. Do not silently rewrite established history, fabricate past evidence, or change the NPC's stable character solely to force the outcome.
5. If a convincing explanation cannot yet be grounded, preserve the author's required outcome as a requirement and make the missing rationale explicit rather than presenting an invented cause as an established fact.

An author-directed outcome does not mean every intermediate action is prescribed. The engine should retain NPC autonomy in choosing the path, except where the author specified those intermediate actions too. It must never invent the player's voluntary actions, dialogue, thoughts, feelings, intentions, consent, or unprovided reactions.

This rule clarifies the current contract's author-override clause and must be reflected in semantic acceptance scenarios before implementation.

### 2.8 Off-screen autonomy — Author-confirmed

NPCs continue pursuing goals and handling responsibilities when the player is elsewhere. Routine activity may be abstracted; important developments and consequential actions must be represented through the world's existing event/time mechanisms when those mechanisms support them.

The player normally learns of off-screen events later through natural channels: visible consequences, a message, a report, a conversation, or an NPC independently asking for help. A private event does not automatically become player knowledge.

Distinguish occurrence, NPC awareness, a pending report, a report sent, receipt/acknowledgment, and player awareness. Chat turns alone must not advance in-world time.

### 2.9 Relationships are multi-dimensional — Author-confirmed

Do not reduce relationships to one universal status or score. Different dimensions may coexist, such as trust, affection, attraction, hostility, respect, obligation, rivalry, suspicion, debt, and cooperation.

For example, two characters may have romantic tension while also being rivals or reluctant allies. One character's attraction does not establish reciprocal attraction or consent. Relationship dimensions may change independently; increased trust need not remove attraction, rivalry, or disagreement.

Concrete interactions and their history are the primary evidence for relationship development. Numeric measures may be used where useful, but they cannot replace the reasons and history behind a relationship.

### 2.10 Relationship change — Author-confirmed

The magnitude and direction of change depend on the importance of the action, context, previous relationship, and individual character. Minor events usually have limited or gradual effects; major betrayal, rescue, or revelation may produce a sharp change.

Different NPCs may react differently to the same act. A single event does not have to update every relationship dimension in the same direction.

### 2.11 Secrets and disclosure — Author-confirmed

NPCs may intentionally reveal, conceal, misuse, or accidentally leak information when a credible motivation and channel exist. Intentional disclosure and accidental leakage must be distinguished and grounded in character, situation, source, trust, pressure, and likely consequences.

Information does not become universally known after one disclosure; it spreads only through plausible channels. Retrieval or model-context inclusion does not count as disclosure or acquisition.

Secrets the author has explicitly reserved for their own control must not be disclosed autonomously for dramatic effect. NPC autonomy is not permission to decide the fate of author-controlled secrets.

### 2.12 NPCs may act against the player's interests — Author-confirmed

NPCs are not automatically obedient allies. They may disagree, refuse, conceal information, make independent deals, or act against the player's interests when their character, goals, relationships, and circumstances support it.

Trust, affection, commitments, loyalty, and shared history influence how far an NPC is willing to go; they do not guarantee obedience. Conflict must have a cause and its consequences must persist. The player is not automatically informed about hidden actions.

### 2.13 Uncertainty and action selection — Author-confirmed by prior decisions; no new decision required

When information is incomplete, NPC strategy depends on personality, urgency, possible harm, cost of delay, and the value of further evidence. One NPC may investigate, another may act on a suspicion, and another may wait or ask for help.

This is already substantially covered by the decisions in sections 2.4–2.6. It is not a separate unresolved question and must not be re-asked as though no decision has been made.

## 3. Relationship to the existing Stage 0 contract

The following areas in `docs/31-npc-subsystem-contract.md` already align substantially with the author decisions:
- sections 2 and 6: canonical truth, actor-specific acquisition, belief, rumor, retrieval, and information boundaries;
- sections 3 and 7: stable character identity and multi-dimensional relationships;
- sections 8 and 9: off-screen continuity and player agency;
- sections 10 and 11: uncertainty, author overrides, and causal rollback.

The author decisions clarify or strengthen the following points:
1. A direct author request for a specific outcome is mandatory; the engine should find a plausible path rather than silently cancel it. Section 10 of `docs/31-npc-subsystem-contract.md` has now been amended to distinguish an author-mandated outcome from an unresolved NPC-generated choice.
2. When established circumstances are not enough, the engine may prepare new future circumstances to motivate the required outcome, but must not rewrite established history or present invented prior causes as facts.
3. Relationship state must support simultaneous, partly independent dimensions and ambiguity; one score or one label cannot settle the relationship.
4. Author-reserved secrets are an explicit boundary on NPC autonomy.
5. Off-screen developments are usually surfaced to the player through later in-world channels, including an NPC independently asking for help, not through automatic omniscient exposition.

These are semantic deltas for documentation and future tests. Do not modify runtime semantics merely by editing a contract.

## 4. Current implementation reality and integration boundary

The source inspection for this work confirms the following limitations in the current `main` source inspected:
- `LogicEngine.registerContextManifest(...)` records generation/snapshot references and world-item references; it does not establish which NPC acquired the information or had access to it.
- The current `ProposalService` stages and validates a pending proposal, but its own validation metadata explicitly leaves semantic alignment, causal completeness, actor authorization, and player-agency policy unchecked.
- Canonical events and causal metadata establish world-side occurrences and dependencies, not that a specific NPC or the player became aware of them.
- The inspected API identifies a trusted adapter, but adapter identity is not the in-world NPC identity and does not by itself prove actor-relative authorization.
- The current first slice does not implement persistent NPC memory, beliefs, long-running goals/plans, or an off-screen simulation loop.

Relevant source references on `main` at the time of inspection:
- `src/application/engine.js`: https://github.com/necromorphic/Logic-Engine/blob/main/src/application/engine.js
- `src/application/proposals.js`: https://github.com/necromorphic/Logic-Engine/blob/main/src/application/proposals.js
- `src/storage/sqlite-store.js`: https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js
- `src/api/server.js`: https://github.com/necromorphic/Logic-Engine/blob/main/src/api/server.js

The NPC branch and core PR stack remain separate, unmerged development work. Do not assume their behavior is available on `main`. Re-check current heads and dependency status before integration.

## 5. Recommended next work

1. Treat this file as the consolidated author decision record.
2. The semantic acceptance matrix now includes NPC-SEM-013–020 for mandatory author outcomes, prospective causal preparation without rewriting history, multi-dimensional relationship tension, author-reserved secrets, off-screen channels, report lifecycle, and acquisition memory versus changing belief. The test-boundary map now records which real production boundaries remain missing.
3. Keep those cases as documented requirements while the real trusted context boundary and relevant core semantics are absent.
4. Define the first vertical slice around trusted actor-relative context preparation plus a bounded non-committing proposal, reusing the existing manifest/proposal path only where its verified guarantees suffice.
5. Resolve ownership and evidence for actor identity, acquisition, access, epistemic status, exact generation/input binding, and rollback reconciliation before runtime/API/storage changes.
6. Review the mechanic-intent PR stack as a possible future action-to-proposal dependency only. It does not solve NPC knowledge, beliefs, relationship state, player agency, or off-screen autonomy.
7. Do not implement a parallel event log, knowledge store, revision counter, causal graph, rollback engine, or access-control subsystem. Do not change runtime, API, SQLite/storage, schemas, vectorization, prompts, or SillyTavern from this record.

No tests were run as part of this consolidation. This document is a requirements record, not proof of implementation.


## 6. Cross-document consistency pass — 2026-10-24

The following documentation-only alignment was made on `feat/npc-subsystem`:

- `docs/31-npc-subsystem-contract.md`: expanded relationship dimensions, codified the pre-model-input protection for author-reserved secrets, and updated uncertainty/author-control rules so an explicit compatible author-mandated outcome is preserved while causal gaps remain explicit and future causes remain prospective until committed.
- `docs/32-npc-semantic-acceptance-matrix.md`: added NPC-SEM-013–020 covering those author decisions and their blocked runtime status.
- `docs/34-npc-decision-context-and-proposal.md`: clarified that fail-closed execution does not silently erase a mandatory author target; it may return `needs_review` while preserving the target and missing rationale. Added the explicit distinction between required outcome, prospective causal path, and committed event.
- `docs/35-npc-test-boundary-map.md`: mapped NPC-SEM-013–020 to the production boundaries and required test evidence.
- `docs/37-npc-kernel-readiness-gate.md`: recorded that author-directed outcomes do not override core safety, player agency, or the unresolved core readiness gates.

The key semantic distinction is now explicit across the contract and first-slice design: **a required story outcome is not the same as an already-justified action or a committed world event**. The target remains mandatory within higher-priority constraints; unsupported causal steps remain prospective or under review; only the existing core path can commit world effects.

This is a source/document consistency pass, not a full independent review by DeepSeek and not an execution of tests. The first-slice blockers remain: trusted actor-relative context preparation, authoritative acquisition/belief source, exact input/snapshot binding, supported action mapping, and real tests at those boundaries. No runtime, API, schema, storage, vectorization, prompt, or SillyTavern changes were made.
