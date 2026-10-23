# Character, player-control, and management architecture — planning note

Status: **planning outline only**. This document reserves architectural boundaries for future subsystems. It does not approve a final card schema, management feature set, UI, API, or implementation order beyond the dependency principles below.

## 1. Goals

The engine should eventually support structured character state, a player-controlled character with explicit agency boundaries, and controlled inspection/administration of a running world without bypassing canonical state rules.

These subsystems must use the same authoritative engine and world history. They must not become independent sources of truth.

## 2. Character model and character card

A character card is a structured model/view over canonical records, not necessarily one large mutable record and not merely a prompt string.

Candidate conceptual areas:

- **Identity:** stable character ID, names/aliases, identity scope, world-pack references.
- **Authored profile:** biography, stable traits, capabilities, constraints, authored relationships.
- **Dynamic state:** location, condition, possessions, role/affiliation, current commitments, other world-specific attributes.
- **Motivation:** goals, priorities, plans, active intentions, and their status.
- **Knowledge and beliefs:** what the character knows, believes, suspects, or has been told, with source/provenance and time.
- **History:** events and state transitions associated with the character.
- **Associations:** relationships to claims, events, processes, timers, and StoryBeats.

This list is deliberately provisional. It does not establish final fields or require every World Pack to use every area.

### 2.1 Truth versus belief

Canonical world facts and a character's beliefs must be distinct. A character may believe something false, know only a partial account, or retain an outdated belief after the world changes.

A character card should not expose every canonical fact to that character or automatically turn all engine state into in-world knowledge. Knowledge updates must have explicit evidence/provenance and must respect the character's access boundary.

### 2.2 Stable profile versus changing state

Authored profile data and runtime state should have separate lifecycles. A change to a current location or belief must not silently rewrite biography or stable traits. World Pack defaults and runtime overrides should be distinguishable.

### 2.3 Views, not duplicate truth

The eventual card representation may aggregate data from entities, facts/claims, event history, goals, relationships, and knowledge records. Avoid maintaining duplicate writable copies of the same state in both a card blob and canonical engine projections.

## 3. Player card and agency boundary

The player character may share common identity/profile structures with NPCs, but must have a separate control policy. Common data shape must not imply common action authority.

Candidate policy dimensions:

- actions the engine may execute automatically;
- actions the model may propose but which require player confirmation;
- player-authored speech, thoughts, and voluntary actions that the engine must not invent or overwrite;
- observable consequences the engine may resolve after a player action;
- knowledge visible to the player versus private engine/NPC state;
- rollback and regeneration handling for player-authored actions and their dependent effects.

The exact permission vocabulary and confirmation model remain open. The engine should enforce agency boundaries in structured action validation, not rely only on prompt wording.

## 4. Management subsystem

The term “management system” is intentionally broad and must be split before implementation.

### 4.1 Configuration management

Potential responsibilities:

- load and validate a World Pack;
- select enabled mechanics and configuration;
- record configuration/version identity for reproducibility;
- validate configuration changes before a world uses them.

A running world's rules should not change silently because a source file was edited. The policy for live configuration changes is undecided.

### 4.2 Runtime inspection and operations

Potential responsibilities:

- inspect canonical state, event history, causal links, audit entries, and unresolved conflicts;
- inspect character cards, knowledge boundaries, goals/processes, and StoryBeat state when those systems exist;
- diagnose rollback classifications and incomplete provenance;
- request validated operations through the engine API.

This list is a candidate boundary, not a commitment to build an admin UI now.

### 4.3 Authority and audit

- Management tools must not directly mutate canonical storage or bypass validation.
- Manual correction should be represented as an explicit, attributed, auditable engine operation.
- **Card-view invariant:** a character-card view must not expose a writable canonical field unless that field maps to an authoritative engine record and a validated operation; view-only/derived fields are read-only.
- **Management-write invariant:** the management API must not expose a direct storage `UPDATE` path; all canonical state changes go through validated, attributed engine operations. These are design invariants to turn into API/architecture tests before implementing the character or management subsystems.
- Read-only inspection should be distinguishable from state-changing operations.
- Authorization roles and multi-user security requirements are not yet specified and must be decided before exposing remote management operations.

## 5. Dependency boundaries

Proposed high-level direction:

- **Core engine:** canonical state, validation, event commit, rollback, revision/time semantics.
- **World Pack:** authored content, defaults, rules, and declarative mechanic configuration.
- **Character subsystem:** character identity/profile views, dynamic state, goals, knowledge and relationships backed by canonical records.
- **Player-control policy:** permissions and agency checks applied to proposed actions.
- **Management API:** validated inspection and operational commands; no direct storage writes.
- **Host adapter:** translates host-specific messages/actions/context into engine requests. A SillyTavern adapter must remain replaceable.
- **UI:** optional client of management and simulation APIs, not the authority for game state.

This is a conceptual separation only; current runtime does not yet implement most of these subsystems.

## 6. Causality and rollback requirements for future subsystems

Character knowledge, goals, processes, timers, and StoryBeats will eventually need explicit links to the events and evidence that created or changed them.

Before those subsystems are implemented, specify:

- which records are canonical and which are derived views;
- how updates are attributed to a committed event;
- how rollback recomputes derived state;
- whether a record can be invalidated, superseded, or recomputed;
- how independent evidence preserves a belief/claim after one source is rolled back;
- how the player-control policy treats regeneration and rollback of player-authored input.

Do not implement character cards as an isolated feature before these causality boundaries are defined.

## 7. Open decisions

- Final character-card fields and which are universal versus World Pack-defined.
- Whether goals, relationships, beliefs, and knowledge are first-class records or derived projections.
- Player action permission/confirmation model.
- Management scope: configuration, runtime inspection, repair tools, or all of these.
- Live World Pack/configuration change policy.
- Management roles, authentication, and audit detail.
- Character-card serialization and host-adapter payload format.
- How to represent and recompute private knowledge after rollback.

## 8. Suggested order

1. Finalize Stage 1 causality semantics and tests.
2. Define canonical record/projection boundaries and event attribution.
3. Define character identity/profile versus dynamic state and knowledge provenance.
4. Define player agency policy independently of the shared character data model.
5. Define management API operations and authorization before choosing UI.
6. Implement one vertical slice with rollback tests before expanding World Pack schema or host integration.
