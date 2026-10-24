# NPC Relationship State — Contract Proposal

Status: documentation-only proposal on `feat/npc-subsystem`. This document narrows the relationship-state contract and its integration boundaries. It does not authorize runtime, API, schema, storage, character-card, prompt, or UI changes. No implementation capability is implied.

Related contracts:
- `docs/00-architecture-baseline.md` — core authority, state, event provenance, rollback, and world-time boundaries.
- `docs/06-npc-autonomy-and-process-manager.md` — NPC decision inputs, including relationships and obligations.
- `docs/07-knowledge-and-narrative-boundaries.md` — separation of truth, subject knowledge, delivery, and retrieval.
- `docs/23-character-and-control-architecture.md` — character cards as views over canonical records.
- `docs/31-npc-subsystem-contract.md` — multidimensional relationship semantics and causal constraints.
- `docs/32-npc-semantic-acceptance-matrix.md` — semantic acceptance scenarios.
- `docs/36-npc-core-integration-seam.md` and `docs/39-npc-core-knowledge-contract-proposal.md` — existing core boundaries and knowledge ownership decisions.
- `docs/43-npc-relationship-core-integration-decision.md` — parallel-work dependency map and provisional integration recommendation.

## 1. Purpose

Define the minimum semantic contract for relationships among NPCs and between NPCs and the player character, including how relationship information is shown in character cards.

The relationship block is a distinct domain capability. It is not a universal numeric score, an emotion detector, a knowledge store, a substitute for event history, or an independent simulation engine.

## 2. Ownership and source of truth

Separate domain meaning from runtime authority:

- **NPC relationship contract:** defines what a relationship means, how participants and relationship dimensions are interpreted, and how relationship state informs NPC decisions. It does not own a parallel canonical store.
- **Core engine:** remains authoritative for canonical simulation state and any persisted authoritative relationship state, entity/event identities, validated commits, world revisions/time, causal provenance, audit, and rollback. Any persistent relationship change must ultimately pass through the core's approved state/event path.
- **World Pack / author configuration:** may define which dimensions matter in a setting, their meanings, permitted transitions, and any setting-specific rules. It must not silently change universal core semantics.
- **Character card:** presents a read-only projection or summary of relationship data. It is not a second writable copy.
- **Narration/model:** may propose an interpretation or a relationship change, but prose alone does not make that change canonical.

The exact production record shape and storage owner are not established by this proposal. Before implementation, inspect the actual core interfaces and select a representation compatible with them. Do not create a parallel event log, revision counter, identity system, causal graph, or rollback path.

## 3. Participants and references

A relationship connects two distinct participant references. Direction matters: A's relationship toward B and B's relationship toward A may differ.

- Reuse an existing canonical `entity_id` when a participant already exists as a world entity.
- Having a relationship with someone does **not** require that person to have a full NPC profile/card.
- A person mentioned in a character's past (for example, a deceased sibling, missing parent, former mentor, or old friend) must not automatically become an autonomous NPC or receive a full NPC card.
- If a person has no canonical entity reference, the authoring/UI layer may need a lightweight unresolved person reference. The exact representation and identity ownership are **open decisions**. Such a reference is not a canonical entity and MUST NOT create a second canonical identity store or an autonomous simulation participant. Resolve the representation against the existing core `Relation` model and the character-card contract before implementation: it may be an approved attribute/reference within that existing model or editor-only descriptive data, but this proposal does not choose between them. Do not silently create a world entity. Until the reference is resolved through an approved contract, it is descriptive context only.
- Do not merge two people or identities merely because their names or descriptions match. Linking them requires explicit authored data or a supported, validated operation.

Self-relationships should be rejected or handled only by an explicitly defined special rule; no general self-relationship semantics are assumed here.

## 4. Relationship state is multidimensional and potentially asymmetric

A relationship is not one universal score. It may contain separate, independently meaningful dimensions, such as:

- trust / distrust;
- affection / dislike;
- attraction;
- fear / intimidation;
- respect / contempt;
- hostility;
- suspicion;
- rivalry;
- cooperation / alliance;
- obligation, debt, or loyalty.

This list is illustrative, not a required universal schema. The World Pack or author-defined configuration may select relevant dimensions and define their semantics. Do not assume every relationship has every dimension, or that all dimensions can be measured numerically.

Requirements:

1. Keep dimensions distinct. Increased trust does not automatically reduce hostility, attraction, suspicion, rivalry, or obligation.
2. Preserve asymmetry. A trusts B does not imply B trusts A.
3. Preserve uncertainty and lack of information. An unfilled dimension is not automatically zero, neutral, absent, or false.
4. Do not infer attraction, consent, affection, loyalty, or reciprocal intent from another dimension.
5. Do not convert descriptive authored text into a precise numeric value unless a declared rule explicitly supports that conversion.
6. A relationship can change gradually or sharply when the event and interpretation justify it; no universal change magnitude is specified here.

The final data model must distinguish at least the existence of a relationship record from which dimensions are known or authored. Whether dimensions are structured values, authored text, or a combination remains an implementation/schema decision.

## 5. Change semantics and evidence

Relationship state changes only through an explicit supported simulation operation or an authorized author edit.

A proposed change must identify, where the supporting system permits:

- the subject whose relationship state changes;
- the other participant;
- the affected dimension(s) and the intended change;
- the supporting event, evidence, or explicit author instruction;
- whether the change is an authored starting condition, an in-world transition, or a correction;
- uncertainty or unresolved interpretation when the evidence does not support a single conclusion.

Rules:

- Co-presence in a scene is not, by itself, evidence of a relationship change.
- A narrated reaction or model explanation is not by itself proof that the change occurred.
- The same event may be interpreted differently by different characters because their knowledge, goals, values, and histories differ.
- An event may support a proposed reaction, but the causal link must be established by the simulation's validated path or explicit adjudication.
- Minor interactions generally should not force large state changes without supporting context; major betrayal, rescue, revelation, or sacrifice may justify a stronger change when character-specific interpretation supports it. These are plausibility principles, not fixed numeric rules.
- The engine must not automatically infer permanent personality traits from observed relationship behavior.
- Missing rationale remains missing; do not fabricate a prior interaction or hidden motive to make a transition look justified.

The precise author-edit policy, model proposal format, and validation operation must be defined against real core interfaces before implementation.

## 6. Relationship state is not knowledge or truth

Keep separate:

- what happened in the world;
- what each participant knows, believes, suspects, or misunderstands about it;
- what relationship state each participant currently holds;
- what a model retrieved or was shown in a prompt;
- what was narrated to the player.

For example, a character's trust in another does not mean they know that person's secret. A character may trust someone for an incorrect reason, distrust them despite true evidence, or retain an outdated view until a supported event changes it.

Relationship information supplied to an NPC decision must be limited to what that NPC's state and role can validly use. A relationship summary must not reveal author-reserved secrets, hidden motives, or the other participant's private relationship stance merely because the relationship record exists.

## 7. Character-card projection

The character card may show a short, read-only relationship summary for quick reference, with a link or navigation path to the full relationship block.

- The core's authoritative records own persisted canonical relationship state; the NPC relationship contract defines its semantics, and any domain projection is derived rather than a second source of truth.
- The card summary is derived from those records and cannot be edited as an independent copy.
- The summary must preserve direction (e.g. “A's trust in B”), avoid presenting one side as mutual, and avoid turning unknown dimensions into neutral values.
- The summary should be concise and selective. It need not list every person or every dimension in the character's full relationship state.
- The full block provides detailed inspection and any permitted management controls.
- Editing from the full block must use validated engine operations; a UI must not write canonical storage directly.
- If a relevant relationship record is unavailable or unresolved, the card should show that limitation rather than invent a value.

This defines the conceptual relationship between the card and the block, not the final UI layout, navigation design, or API.

## 8. NPC decision-context use

Relationships can inform goals, plans, dialogue, risk assessment, cooperation, obligations, and reactions. They are contextual inputs, not deterministic scripts.

The decision context should include only relationship dimensions relevant to the current decision and permitted for the acting NPC. The system must not assume one model call per NPC or require every NPC to inspect every relationship on every turn.

An NPC may lie about a relationship, conceal it, misread another person, or act against its usual pattern when credible circumstances support that behavior. Such behavior must not silently rewrite the canonical relationship record; a state change requires a supported transition.

## 9. Causality, history, and rollback

Relationship changes are simulation consequences and must use the core's existing event identity, provenance, revision, audit, and rollback mechanisms.

- A committed relationship transition must be attributable to a supported source event or explicit authorized author operation.
- If the source event is rolled back, reconcile the relationship transition according to its actual causal dependencies.
- Do not blindly erase all later relationship history. Preserve a transition if another valid independent cause supports it under the declared rules.
- Do not preserve a relationship effect whose only valid prerequisite has been invalidated.
- Preserve audit history according to the core's rollback policy; rollback is not silent deletion.
- Do not create a relationship-specific causal graph or undo system.
- If the current core cannot express the required causal link, the transition remains blocked or requires an explicit core design decision. Do not approximate causality in narrative text.

The exact reconciliation rules for multiple causes, gradual change, and conflicting evidence remain open until mapped to the core's real causality contract.

## 10. Authoring and management boundaries

The author may establish an initial relationship state or correct it through an explicit, attributed operation. The authoring interface must distinguish an initial authored condition from an in-world relationship transition.

The UI may provide read-only inspection and validated edits. It must not:

- automatically create a full NPC card for a referenced person;
- silently create missing history, evidence, documents, or reciprocal feelings;
- infer a relationship transition from mere scene co-presence;
- treat a character-card summary as a writable source of truth;
- bypass core validation, event attribution, or rollback semantics;
- delete relationship data just because a related optional mechanic or UI is disabled.

Whether authored relationship defaults live in the World Pack, character profile configuration, or another existing canonical authored-data structure is not decided here. Avoid duplicate writable defaults and runtime copies.

## 11. Semantic acceptance scenarios

These are proposed acceptance criteria, not executable tests and not evidence of runtime support.

### REL-001 — Asymmetric relationship
Given A trusts B and B distrusts A, when each actor's relationship context is read, each receives only the correctly directed state. Neither side is automatically made reciprocal.

### REL-002 — Unknown is not neutral
Given no authored or committed value for a relationship dimension, when the card or NPC context displays it, the system does not silently interpret it as zero, neutral, absent, or false.

### REL-003 — Multidimensional independence
Given A is attracted to B but also distrusts B, when trust changes, attraction is not automatically rewritten and distrust is not automatically cleared.

### REL-004 — Scene co-presence is insufficient
Given A and B appear in the same scene without a supported meaningful interaction, no relationship transition is committed solely because they shared the scene.

### REL-005 — Knowledge boundary
Given A trusts B but has no valid acquisition path for B's secret, A's relationship context does not grant access to the secret.

### REL-006 — No automatic NPC creation
Given a character card mentions a deceased relative or former mentor without a canonical entity reference, opening or displaying the relationship summary does not create an autonomous NPC or full NPC card.

### REL-007 — Read-only card summary
Given a canonical relationship record, the card summary reflects it as a derived view. Editing the summary cannot independently mutate canonical state.

### REL-008 — Rollback of dependent transition
Given a relationship transition depends only on event E, when E is rolled back, the transition is reconciled according to the core contract and its audit history is retained.

### REL-009 — Independent support survives
**Runtime status: BLOCKED by the core causality extension; see `docs/45-npc-relationship-typed-operation-design.md` §5.** This is a semantic acceptance requirement, not a capability of the current runtime. The current `caused_by`/`depends_on` contract expresses required dependencies, not OR-style alternative support.

Given a relationship state has independent valid support from two causes, when one cause is rolled back, the system does not erase the state blindly if the remaining cause still supports it under the declared semantics. This case must remain a blocked specification until a domain sufficiency rule, core-owned support/reconciliation representation, and executable rollback tests are approved and implemented.

### REL-010 — No invented explanation
Given the evidence does not establish why a relationship changed, the system leaves the rationale unresolved rather than inventing a prior event or hidden motive.

### REL-011 — No reciprocal inference
Given A's attraction, respect, fear, or loyalty toward B, the system does not infer the corresponding state for B.

### REL-012 — Author edit is attributed
Given an author corrects a relationship through an authorized management operation, the operation is distinguishable from an in-world event and follows the core's audit/causality policy.

## 12. Decisions settled by core review vs details still open

The core owner's review in [PR #38 comment 6377468310](https://github.com/necromorphic/Logic-Engine/pull/38#issuecomment-6377468310) settles the following semantic boundaries:

1. **Canonical operation — direction settled, exact contract open.** Use a typed relationship record/effect committed through the canonical event/revision/audit path. Generic entity attributes and `fact.set` are not an adequate mutable relationship-state contract. The precise effect shape, validation rules, and event payload remain to be reconciled with the core's canonical effect architecture.
2. **Participant references — commit rule settled.** A committed canonical relationship participant must resolve to an existing `entity_id`. Unresolved people may remain in authoring/import data; do not create an entity/NPC or parallel identity registry. A future typed unresolved-reference mechanism would require separate approval.
3. **Dimension schema — open.** Universal versus World Pack-defined dimensions, value types, allowed explicit neutral values, partial-update rules, and validation remain to be specified. Unknown/unset must not become zero or neutral.
4. **Starting conditions and author edits — semantic boundary settled, exact interface open.** Author-initial/imported origin and authorship/provenance are metadata separate from dimension values and in-world transitions. The approved authoring operation and audit representation remain to be defined.
5. **Causal reconciliation — requirement settled, mechanism open.** Relationship transitions must reference canonical source/cause identities; rollback must recompute support from remaining valid independent causes. If current core causality cannot express this, relationship commits remain blocked until the core contract and tests are extended. No parallel relationship causal graph/log.
6. **Read/projection — dependency order settled, interface open.** Use a consistent snapshot as a prerequisite, never as authorization. After snapshot integration, a core-owned actor/purpose/snapshot access filter must precede NPC/player context. Card summaries are bounded, derived, read-only projections. Exact trusted policy inputs and internal interface remain unverified.
7. **Management permissions — open.** Which users/roles may inspect or edit private relationship state remains a product/host decision if multi-user operation is in scope.

These decisions define constraints, not implemented capabilities. Do not resolve remaining details by adding an independent relationship database, new ID/revision scheme, or speculative runtime.

## 13. Readiness conclusion

Relationship semantics are partly defined in the NPC contract, but the dedicated record model, participant-reference policy, card projection boundary, and rollback mapping are not established as executable behavior. The next step after review is a source-level integration audit against the target branch and its unmerged dependencies. Runtime/API/schema work should wait until the open decisions above are resolved.

## 14. Source-level integration audit (branch snapshot inspected 2026-10-24)

This audit records source facts observed on `feat/npc-subsystem`; it does not claim that adjacent unmerged PRs are integrated.

### Existing usable primitives

- `src/application/engine.js` exposes the current core path for `commitEvent(...)`, `rollbackEvent(...)`, `getState(...)`, `getEvents(...)`, and `getAudit(...)`. It also registers context manifests. These are general core operations, not relationship-specific operations.
- `src/core/rules.js` validates generic effects including `entity.create`, `entity.update`, `entity.upsert`, `entity.delete`, and `fact.set`. It does not define a relationship effect or validate relationship-specific dimensions, direction, or transition semantics.
- `src/storage/sqlite-store.js` projects generic entity effects and append-only `fact.set` claims; conflicting fact values are represented as a conflicted projection. Generic event/effect provenance and rollback machinery are present, but no relationship-specific record or projection was identified in the inspected source.
- `docs/18-rollback-and-causality.md` describes a broader target contract and explicitly warns that future rollback behavior must not be mistaken for current runtime capability. The implemented event rollback contract must be checked separately before relying on any relationship reconciliation behavior.

### Consequences for relationship design

1. **No dedicated relationship runtime was found.** The current source supports generic entities and facts, but neither primitive by itself establishes the proposed relationship semantics. Encoding relationship dimensions as arbitrary entity attributes or generic facts now would bypass domain-level validation and leave direction, unknown values, allowed transitions, and card projection undefined.
2. **No relationship query/projection boundary was found.** A read-only card summary and actor-specific decision-context view still need a defined internal read contract. They must not be inferred from unrestricted `getState()` or context-manifest references.
3. **Participant references remain unresolved.** The generic entity ID is available for existing entities, but the inspected code does not establish a lightweight reference contract for people who are not canonical entities and must not become autonomous NPCs.
4. **Causal rollback cannot be assumed complete for relationship state.** A future relationship transition must use existing event/effect provenance and rollback, but the current code has no relationship-specific reconciliation policy or tests. If the current core cannot represent a transition and its dependencies without ambiguity, relationship commits must remain unsupported until the core contract is extended.
5. **Snapshot dependency is not silently assumed.** The inspected `feat/npc-subsystem` branch has not incorporated the current `main`-side snapshot dependency. PR #45 merged into `main` at `2bbdbff4e4d4c4c56601ed5ac18e2083aa99c48b`; PR #49 merged the mechanic/context snapshot extension at `8602a9ed41f13f536d87b1103a02e8fd12de3b03`. These are available on `main`, not automatically in this branch. Reconcile the branch with the target core commits deliberately before relying on `getSnapshot(...)` or mechanic snapshot inputs.

### Readiness verdict

The semantic direction is settled, but the relationship block is **not implementation-ready**. The current design target is one typed canonical relationship effect per directed pair and logical transition, with a partial dimension patch; existing canonical participants only; trusted, distinct author-initial/import/correction operations; and a bounded actor/purpose-authorized read result. Exact effect/projector integration and the trusted authoring boundary must still be verified against the target core commit. The first slice must not claim generic alternative-support semantics: use deterministic replay of independently attributable transitions only where the domain semantics support it, and leave OR-style support cases blocked until a reducer is defined and tested. No runtime code was changed in this work.


## Core-owner decision addendum (2026-10-24)

The core owner reviewed the five relationship integration questions in PR #38 discussion comment [6377468310](https://github.com/necromorphic/Logic-Engine/pull/38#issuecomment-6377468310). This confirms the semantic direction only; it does not establish implementation or authorize runtime/schema changes.

- **Canonical write:** design a typed relationship record/effect committed through the existing canonical event, revision, and audit path. Do not use arbitrary entity attributes or append-only `fact.set` claims as mutable relationship state. Exact effect/schema shape remains subject to review against the canonical effect architecture.
- **Participants:** committed canonical relationships require existing canonical `entity_id` references. Unresolved references may remain in authoring/import data, but cannot be committed as canonical participants until resolved, unless a separate typed unresolved-reference contract is approved. Do not auto-create entities/NPCs or add a parallel identity registry.
- **Reads/projection:** a consistent snapshot is a dependency, not authorization. Raw snapshot data must not go directly to NPCs or players. A core-owned actor/purpose/snapshot access boundary must be specified and implemented first. Character-card projection remains read-only and consumes a bounded relationship summary.
- **Rollback:** current `caused_by`/`depends_on` is not an OR-support model. Required dependencies remain distinct from alternative evidence. The first slice may support independently replayable typed transitions only where the World Pack/domain semantics make deterministic replay correct. Generic alternative-support aggregation is out of scope until a sufficiency rule, typed support representation, reducer, and rollback tests are approved. Do not create a separate NPC rollback graph/log.
- **State origins and atomicity:** unknown/unset, explicit neutral (only where the World Pack defines it), and author-initial/imported state are distinct. Caller-controlled origin labels do not grant authority; a trusted authoring/import/correction command and audit boundary is still missing. An accepted transition must atomically commit the event, projection, audit, idempotency result, and revision effects; rejection must not partially mutate canonical state or world-commit audit.
- **Read outcomes:** actor/purpose/snapshot filtering must preserve `known`, `unknown/unset`, `withheld`, and `incomplete/unsupported` as distinct outcomes. A consistent snapshot is not authorization.

These decisions resolve the schema-neutral direction, not implementation readiness. The typed-effect/projector hook, trusted authoring boundary, authorized bounded read/projection contract, and first-slice rollback behavior must be verified and tested against the actual target core branch before implementation. PR #45 is merged into `main` but is not yet incorporated into this NPC branch. PR #32 is closed without merge; its proposed character-card projection must not be treated as an available dependency.
