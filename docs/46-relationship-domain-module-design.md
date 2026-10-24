# Relationship Domain Module — Design and Integration Boundary

Status: **documentation-only domain design proposal** on `feat/relationship-domain-module`. This document does not authorize changes to Core, NPC runtime, API, storage, schemas, prompts, or UI. It does not claim executable integration.

## 1. Purpose

Define the Relationship module as an independently attachable domain capability for directed, multidimensional relationships between canonical participants. It consolidates the module boundary and transition semantics without replacing the existing NPC/Personality contracts.

This document is complementary to, not a replacement for:
- `docs/42-npc-relationship-state-contract-proposal.md` — relationship semantics and baseline acceptance scenarios;
- `docs/43-npc-relationship-core-integration-decision.md` and `docs/45-npc-relationship-typed-operation-design.md` — Core integration and causal blockers;
- `docs/personality/01-personality-and-relationship-semantics.md` — shared semantic invariants;
- `docs/personality/05-world-pack-relationship-dimension-template.md` — per-dimension authoring requirements;
- `docs/personality/04-semantic-acceptance-matrix.md` — existing PERS-SEM acceptance IDs;
- `docs/25-universal-mechanics-system.md` and `docs/26-mechanics-contracts.md` — optional mechanic lifecycle and module boundaries;
- `docs/47-relationship-module-test-traceability.md` — case-to-test mapping, synthetic fixtures, negative tests, and readiness criteria.

Where this document summarizes an existing rule, the referenced contract remains the canonical detailed source. Where it proposes additional behavior, that behavior remains a proposal until reviewed by the relevant owner.

## 2. Module ownership and composition

The Relationship module owns the **domain interpretation of directed relationships** and the rules for proposing relationship transitions. It does not own canonical persistence or the general simulation lifecycle.

| Concern | Owner | Relationship-module rule |
|---|---|---|
| Meaning of relationship dimensions and domain transitions | Relationship module + active World Pack | Define semantics; do not impose a universal numeric scale |
| Stable personality, values, habits, and enduring character constraints | Personality/profile domain | Consume as interpretation inputs; do not rewrite traits |
| Canonical entities, event truth, world time/revision, commit, audit, rollback | Core | Use only approved Core paths |
| Subject-specific beliefs, knowledge acquisition, and information delivery | Core knowledge contract / NPC consumer | Do not create a parallel belief or knowledge store |
| Goals, plans, decisions, and action execution | NPC subsystem | Relationship state is one contextual input, not a scripted decision |
| Narrative presentation and character-card summary | Narration/card projection | Read-only, bounded, authorized presentation |
| Dimension choices, value domains, setting-specific rules | World Pack / author configuration | Configuration cannot override universal Core guarantees |

**Key separation:** an internal relationship state, A's belief about B, and A's outward conduct toward B are three different things. The module may consume a permitted belief or observation as evidence for a proposed transition, but it must not merge belief, truth, and relationship state into one record.

## 3. Domain model

### 3.1 Directed pair

A relationship state is interpreted as **subject A's relation toward target B**. The reverse direction is a distinct state and is never inferred from it. A committed pair must use existing canonical participant identities under the Core contract. Unresolved people may remain authoring-only descriptive references until an approved identity contract resolves them; they must not trigger automatic entity/NPC creation.

Self-relations are unsupported by default unless the active domain explicitly defines them.

### 3.2 Independent dimensions

A relationship consists of zero or more configured dimensions, each with its own semantics and lifecycle. Illustrative dimensions include trust, affection, respect, attraction, fear, hostility, suspicion, rivalry, cooperation, loyalty, and obligation. These labels are not a universal required schema.

Each configured dimension must define:
- meaning and non-implications;
- value domain and whether an explicit neutral value exists;
- supported initial values and transition rules;
- whether partial update and explicit clearing are supported;
- evidence/provenance requirements;
- conflict or insufficient-support behavior;
- visibility constraints and permitted decision use;
- rollback/replay expectations and acceptance cases.

An omitted dimension is not an implicit neutral value. Updating one dimension must not silently mutate another. A change may be categorical, ordinal, numeric, or authored/structured according to the active World Pack; the module must not invent a numeric conversion.

### 3.3 Three separate layers

1. **Relationship state:** the current effective directed relationship dimensions that are justified under the domain's approved rules.
2. **Actor-specific representation:** what A believes, suspects, expects, or misunderstands about B, based on A's permitted knowledge and observations. This belongs to the knowledge/belief contract, not the relationship store.
3. **Observed conduct:** what A actually says or does toward B in a particular context. Conduct may express, conceal, exaggerate, or contradict the relationship state. Conduct is not itself a canonical relationship mutation.

A fourth distinction is **narrative presentation**: generated prose is neither state nor evidence of a state transition.

### 3.4 State and read-result distinctions

The domain and its consumers must not conflate:
- unset: no effective value has been established;
- explicit neutral: the World Pack intentionally assigns its defined neutral value;
- cleared: an authorized supported operation explicitly removed an effective value;
- withheld/inaccessible: the caller may not see whether or what a value exists;
- conflict/insufficient support: current valid evidence does not justify a single effective value;
- unsupported/incomplete: the capability or requested result cannot be supplied.

The precise representation of these outcomes is a Core read/write contract decision, not a module-defined API.

## 4. Relationship transition lifecycle

A transition is a **candidate domain change**, not a direct mutation. The intended conceptual sequence is:

1. **Identify a supported trigger.** Examples include a consequential action, a revealed fact, a conflict, a promise kept/broken, or a meaningful pattern of repeated interaction. Mere co-presence, scene length, or generated narration is insufficient.
2. **Establish the actor's access to evidence.** Determine what the subject actually observed or validly learned. Canonical truth alone does not mean A knows it.
3. **Interpret the trigger for this subject.** Apply relevant character values, prior relationship history, prior experience, goals, stakes, context, and known exceptions. Do not fabricate a motive or memory to force an interpretation.
4. **Select affected dimensions.** Name only dimensions for which the interpretation supplies a defensible reason. Omitted dimensions remain unchanged.
5. **Evaluate magnitude and persistence.** A small interaction normally should not force a major durable change without supporting context. A major betrayal, rescue, sacrifice, or revelation may justify a sharp change, but no universal numeric magnitude is assumed. Temporary emotional arousal is not automatically a persistent relationship transition.
6. **Check domain constraints.** Apply the active World Pack's value, transition, conflict, and provenance requirements. Unsupported or ambiguous transitions remain unknown/review rather than being guessed.
7. **Submit through the approved Core path.** If a typed relationship operation, trusted origin, causal references, or required read authorization is unavailable, the transition cannot be committed as canonical state.
8. **Consume the committed result.** NPC decisions and projections read only the authorized committed state. A rejected proposal or narrative-only interpretation must not appear as a canonical change.

This lifecycle is a domain sequence, not a new event pipeline, transaction manager, authorization service, or rollback implementation.

## 5. Interpretation factors

A transition may be influenced by:
- stable traits, values, and boundaries supplied by the personality/profile domain;
- relevant past interactions and already-established relationship history;
- the subject's actual knowledge, beliefs, suspicions, and confidence;
- current goals, dependencies, obligations, and perceived stakes;
- setting, audience, public/private context, danger, and social status;
- individual exceptions and the history specific to this pair.

These factors guide interpretation; they do not supply missing evidence. Stable traits are not automatically rewritten because a relationship changes. Past events must not be counted repeatedly as new evidence on every evaluation. Repeated interactions should contribute only under an explicit domain rule that defines what repetition means and avoids unbounded drift.

The same event can therefore produce different transitions for different subjects. This is expected, not a consistency failure, provided each transition uses that subject's own valid knowledge and interpretation and each canonical effect has its own justified attribution.

## 6. Contradiction, concealment, repair, and lasting consequences

- **Contradictory feelings:** multiple dimensions may coexist (for example, affection with distrust, respect with hostility, or loyalty with fear). No global relationship score should erase this distinction.
- **Concealment:** the subject may hide or misrepresent a relationship. Concealment changes outward conduct or what others believe only through supported events; it does not automatically rewrite internal relationship state.
- **False impressions:** a subject can misread another's action or hold an outdated belief. New canonical truth does not silently correct the subject's belief without a valid acquisition path.
- **Repair:** trust, cooperation, affection, respect, and other dimensions recover independently. Apology alone is not a universal reset; the World Pack may require demonstrated repair, restitution, time, or repeated reliable conduct.
- **Forgiveness versus restoration:** a subject may accept an apology without restoring trust, or resume cooperation while remaining resentful.
- **Lasting consequences:** an event may cause a durable or domain-defined irreversible change only when the active setting/author rules establish that consequence. Irreversibility is not inferred from an event label alone and must not bypass explicit author correction policy.
- **No forced reconciliation:** the module must not converge relationships toward friendship, neutrality, symmetry, or narrative closure merely because time passes.

## 7. Optional attachment and lifecycle

The Relationship capability must be optional at the world/module level.

- If absent or disabled, the Core remains usable and other subsystems must not assume relationship reads or transitions are available.
- A consumer encountering an unavailable capability receives an explicit unsupported/unavailable result through whatever approved interface exists; it must not fabricate neutral relationship values.
- Disabling the module prevents its rules from evaluating new transitions. It does not erase historical events, canonical state, audit records, or consequences already committed.
- Re-enabling must not silently re-run old scenes or apply missed transitions. A catch-up operation, if ever needed, requires an explicit separate domain rule and Core-approved execution.
- Module version changes must not silently reinterpret committed history. Historical interpretation/replay must use the approved versioning and migration policy.
- The module must not register its own event store, identity registry, revision counter, authorization system, process manager, or rollback graph.

This proposal is intended to compose with the existing MechanicTemplate/MechanicInstance lifecycle. It does not assume that the current mechanic runtime can execute relationship transitions: mechanic execution and the relationship write/read contracts must be independently verified before enabling runtime use.

## 8. Causality and rollback boundary

Every committed in-world transition must be attributable through the Core's approved causal/provenance path. Author-initial/imported state and authorized correction are distinct from in-world transitions and must not be represented as fabricated NPC actions.

The module must not create its own causal graph or infer that a list of source IDs means alternative support. The current Core design notes distinguish required causal dependencies from independent supporting evidence; ordinary dependency links cannot express “either source is sufficient.”

First-slice transitions may be supported only where replaying surviving valid typed transitions is semantically correct and the Core has verified the real commit/replay/rollback path. Cases requiring alternative-source sufficiency, domain-specific conflict reconciliation, or a non-replayable aggregate remain blocked until both the domain rule and Core representation/reducer are approved and tested.

## 9. Acceptance scenarios

These scenarios extend the existing PERS-SEM cases; they do not replace or renumber them. They are **specification tests**, not evidence of runtime support.

### REL-MOD-001 — Same event, different interpretation

**Given**
- Canonical event E is visible to both A and B.
- A values loyalty and knows that the act protected a shared commitment.
- B values independence and interprets the same act as controlling.
- These values and knowledge differences are explicitly authored/established.

**When** the domain evaluates possible relationship transitions for A toward the actor and B toward the actor.

**Then**
- A and B may propose different affected dimensions or different outcomes.
- Neither character inherits the other's interpretation.
- No new hidden motive is invented.
- Each committed transition must have its own supported actor-specific interpretation and Core attribution.

### REL-MOD-002 — Same event, unequal knowledge

**Given** E has a public outcome and a private motive M; A has valid access to M and B does not.

**When** both interpret E.

**Then** A may consider M; B cannot use M as known evidence. The module does not leak M through relationship context or make B's reaction match A's.

### REL-MOD-003 — Contradictory dimensions

**Given** A is attached to B but distrusts B after a supported betrayal.

**When** A receives a later credible positive interaction.

**Then** the active rules may improve trust without automatically clearing attachment, hostility, suspicion, or the betrayal's history.

### REL-MOD-004 — Outward conduct hides state

**Given** A privately fears B but publicly cooperates to protect a third party.

**When** the conduct is narrated or observed.

**Then** public cooperation does not overwrite fear or prove affection/loyalty. Any change to what an observer believes requires its own valid information path.

### REL-MOD-005 — Repeated interaction does not cause automatic drift

**Given** A and B share multiple scenes but have no supported meaningful interaction under the active domain rules.

**When** the relationship module evaluates the history.

**Then** no relationship change occurs solely due to scene count or elapsed turns.

### REL-MOD-006 — Repair does not reset every dimension

**Given** A distrusts B after a broken promise but still respects B's competence.

**When** B makes restitution that satisfies the World Pack's repair rule.

**Then** trust may recover to the extent justified by the rule; respect is not automatically changed and the prior breach is not silently erased.

### REL-MOD-007 — Irreversible consequence is explicit

**Given** an event is severe but the World Pack has not declared a relevant irreversible consequence.

**When** the relationship transition is proposed.

**Then** the module does not mark the dimension permanently locked merely because the event is emotionally intense. An explicit supported rule or author decision is required.

### REL-MOD-008 — Disabled capability does not fabricate defaults

**Given** the Relationship module is absent or disabled and a consumer requests a relationship dimension.

**When** the consumer prepares context.

**Then** it receives the approved unavailable/unsupported result, not neutral, reciprocal, or inferred values. No historical state or event is deleted.

### REL-MOD-009 — Unsupported Core write blocks canonical transition

**Given** the domain interpretation is plausible but the approved typed Core operation or trusted provenance path is unavailable.

**When** the module proposes the transition.

**Then** no canonical mutation occurs. The proposal is recorded only through an explicitly supported non-canonical diagnostic/review channel, if one exists; otherwise it remains an uncommitted result.

### REL-MOD-010 — Rollback does not use an invented OR rule

**Given** two events appear relevant to a relationship conclusion but the active domain has no approved sufficiency rule.

**When** one source is invalidated.

**Then** the module does not assume the other source is sufficient merely because it remains. The case is blocked/reviewed until the domain rule and Core reconciliation contract are available.

### REL-MOD-011 — Player agency remains outside the module

**Given** the relationship module predicts that a player character is likely to forgive, confess affection, or retaliate.

**When** the next action is evaluated.

**Then** the module may supply authorized relationship context but cannot author the player's voluntary dialogue, thoughts, decisions, or actions.

### REL-MOD-012 — Version change does not rewrite history silently

**Given** a World Pack updates a dimension rule after events have been committed under an earlier version.

**When** the updated module is enabled.

**Then** historical events are not silently reinterpreted under the new rules. A version/migration/replay policy must explicitly define any supported reconciliation.

**Acceptance crosswalk:** this case directly reuses Personality criterion `PERS-SEM-029` for meaning-changing World Pack updates. `PERS-SEM-024` covers deterministic replay only within the same explicitly pinned inputs and rule versions; it is not a substitute for historical version pinning or migration policy.

## 10. Integration dependencies and readiness

| Dependency | Owner | Current status | What closes it |
|---|---|---|---|
| Typed canonical relationship write and atomic partial update | Core | **Blocking; not verified as implemented** | Approved operation/effect contract and real-path tests for direction, dimension isolation, identity, rejection atomicity, revision/audit |
| Trusted initialization/import/correction provenance | Core | **Blocking; trusted boundary not verified** | Approved authorized operation, audit/provenance semantics, spoofed-origin rejection tests |
| Actor/purpose/snapshot-scoped authorized read | Core | **Blocking; snapshot alone is not authorization** | Approved filtered read contract and tests for actor separation, withheld/unset distinction, secret exclusion |
| Replay and rollback for typed relationship transitions | Core | **Blocking; generic rollback is not proof of relationship replay correctness** | Defined first-slice subset and production-boundary replay/rollback tests |
| Alternative-source sufficiency/conflict reconciliation | Core + World Pack | **Deferred/unsupported unless explicitly designed** | Domain sufficiency policy plus Core-owned representation/reducer and tests |
| Subject-specific knowledge and beliefs | Core knowledge contract / NPC | **Integration dependency** | Approved knowledge/acquisition boundary; no parallel belief store |
| Personality interpretation inputs | Personality | **Semantic composition only** | Stable, bounded consumer contract; relationship changes must not rewrite stable traits |
| Optional module lifecycle | Core mechanic runtime | **Lifecycle exists; relationship execution is not thereby implemented** | Verified host-allowlisted execution path and approved input/output contract |
| Character-card projection | Card/Core owner | **Dependent on authorized read and canonical state** | Bounded read-only projection using approved filtered data |

### Confirmed Core implementation inventory (current review)

Core's latest review confirms the dependency statuses above against the inspected implementation:

- `src/core/rules.js` / `validateEffects` currently accepts generic entity effects, `fact.set`, and mechanic-lifecycle effects; it has no typed relationship effect or relationship-dimension validator.
- `src/application/engine.js` / `prepareEvent` and `commitEvent` provide the existing event preparation and canonical commit path. This is an extension point, not an already-approved relationship hook.
- `src/storage/sqlite-store.js` / `commit`, `rebuild`, and `rollback` provide transactional event persistence, projection updates, audit/idempotency handling, rebuild, and rollback. SQLite transaction atomicity for generic commits does not establish atomic partial relationship updates until a typed operation and relationship-aware projection exist.
- Generic effects must not be repurposed as a substitute: `entity.update` does not enforce directed-pair/dimension invariants, and `fact.set` does not define mutable multidimensional relationship-state semantics.
- The existing adapter proposal/approval/commit path is not an approved trusted path for `initial_import` or `author_correction`. The open Trusted Mutation Origin proposal (PR #63) is documentation/proposal work, not an implemented authority boundary.
- The open Authorized Read proposal (PR #65) is a narrow draft for actor metadata, not an authorized relationship read. `getSnapshot` is a consistent-snapshot primitive, not actor/purpose authorization or a model-safe relationship projection.
- Existing tests for stale proposals, idempotency, failed-audit rollback, generic entity patches, rollback, fact claims, and character-card projection prove only those generic guarantees. They do not count as relationship integration tests.

Consequently, no end-to-end relationship transition is currently verified across direction, dimension isolation, authorized read, trusted provenance, revision, idempotency, projection, and replay/rollback. Keep this inventory as a status snapshot; re-check the relevant Core branch and tests before changing any blocker to resolved.

### Safe work that can proceed without Core changes

- Domain meaning and per-World-Pack dimension definitions.
- Pure semantic scenario design.
- Consumer requirements for NPC and character-card context.
- Compatibility review against the existing personality and NPC contracts.
- Documentation and test fixtures that clearly remain specification-only.

### Work that must not proceed as if integrated

- Writing canonical relationship rows or arbitrary entity attributes.
- Treating `fact.set` as a mutable relationship state machine.
- Exposing raw snapshots to a model/player.
- Claiming runtime authorization, trusted authorship, independent-support reconciliation, or relationship-specific rollback.
- Adding an alternate event store, revision counter, identity registry, authorization layer, or undo mechanism.

## 11. Readiness statement

This document defines a proposed, optional Relationship domain module and its semantic lifecycle. It is **not runtime-ready**. Core integration remains blocked by the typed write, trusted provenance, authorized read, and verified relationship replay/rollback gates listed above. The domain module can continue to mature independently, without requiring Core to stop its own implementation work.
