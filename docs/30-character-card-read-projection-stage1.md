# Character Card Read Projection — Stage 1 Specification

Status: proposed implementation specification for review. This document does not claim that character-card, knowledge, or audience-filtering runtime features already exist.

Related documents:
- `docs/23-character-and-control-architecture.md` — character/control planning boundaries.
- `docs/03-storage-and-persistence-contract.md` — canonical versus derived data.
- `docs/07-knowledge-and-narrative-boundaries.md` — truth, knowledge, delivery, and search separation.
- `docs/21-stage1-causality-contract.md` and `docs/22-causality-semantics.md` — causal guarantees and their current limits.
- Character Cards Contract v1.2.1 in PR #29 — card semantics, provenance, drafts, notes, cache/access policy, and conflict behavior.

## 1. Goal

Add the smallest safe, read-only character-card projection over data already accepted by the engine. The projection is a view, not a new source of truth. It must not create, update, or delete world state, commit events, infer missing canon, grant knowledge, or expand access.

Stage 1 is deliberately narrower than the full card contract. It proves that a deterministic read model can be built and tested before adding authored profile storage, card editing, player notes, or a knowledge subsystem.

## 2. Non-goals

Stage 1 does not implement:
- canonical authored-profile persistence or profile version history;
- character creation or automatic ID allocation;
- knowledge records, belief updates, or evidence acquisition;
- player-facing secret filtering or a general access-control policy;
- edits, drafts, approvals, conflict resolution, or canonical commits;
- relationship, goal, plan, process, StoryBeat, or resource subsystems not already available as authoritative structured data;
- vectorization, embedding changes, SillyTavern integration, prompt assembly, or changes to the existing adapter;
- causal-completeness verification or stronger rollback guarantees than the current core provides;
- player notes or automatic character development.

These features must not be simulated by putting extra fields into a card blob.

## 3. Source-of-truth rules

1. The world store and accepted event/fact/entity state remain authoritative.
2. The projection may read only records exposed by a deliberately chosen internal read interface; it must not write to the store.
3. A field is included only when it can be sourced from an existing authoritative record or an explicitly approved, typed source.
4. Absence of a field means “not supplied by this projection”; it does not mean false, none, empty, impossible, or not applicable.
5. Do not synthesize biography, personality, skills, relationships, motives, habits, knowledge, or secrets.
6. Do not treat narrative text, vector-search results, a model-generated statement, or a player note as a canonical fact.
7. Do not interpret arbitrary entity attributes as verified card fields merely because their names look familiar. Any mapping must be explicit, documented, and tested.
8. Preserve source references and epistemic status wherever the current data model makes them available. If source provenance is unavailable, do not fabricate it; expose the limitation to trusted internal callers or omit the unsupported field.

## 4. Proposed projection boundary

The implementation should expose a pure application-level projector, conceptually:

`projectCharacterCard(worldSnapshot, entityId, projectionOptions) -> CharacterCardProjection`

This is a design signature, not a requirement to add that exact public API. The projector:
- receives a bounded snapshot/read result for one world and one entity;
- performs no network, database, clock, random, or model calls itself;
- does not mutate its inputs;
- returns the same output for the same inputs and projection version;
- never traverses records from another world;
- returns a typed not-found/unsupported result rather than inventing a placeholder character.

The application/service layer is responsible for obtaining a consistent read snapshot, validating world/entity scope, and translating errors. Keep database details out of the pure projector.

### 4.1 Minimum output

The Stage 1 projection should contain only:
- `projection_version`: explicit identifier for the projection mapping, not a database migration version;
- `world_id`;
- `entity_id`: the existing stable entity identifier, not a new card-generated ID;
- `entity_type`;
- `status`;
- `profile`: only explicitly mapped fields that already exist in an approved authoritative source; omit the object if no approved profile source exists;
- `known_state`: only explicitly mapped current-state fields sourced from accepted structured state; omit unknown/unmapped fields;
- `source_refs`: stable references to source records where available;
- `source_revision`: the world revision or consistent snapshot marker used to build the result, if available from the read interface.

The final schema must follow repository naming and validation conventions after code review. This specification intentionally does not prescribe a writable card record.

Do not return the entire raw entity attribute object by default. A generic attributes bag can contain internal or sensitive material and has no reliable field-level access semantics.

## 5. Read consistency and determinism

- Build the projection from one consistent world snapshot/read boundary. Do not combine entity data from one revision with facts or events read later at another revision.
- Include the source revision in the result when available. This is a freshness marker, not a promise that every field has independently verified provenance.
- The same snapshot and projection version must yield structurally identical output. Sort collections and source references deterministically.
- Do not include current wall-clock time, random IDs, unstable database iteration order, or generated prose in the projection.
- If the existing store cannot supply a consistent snapshot through its current interface, document that limitation and add a narrow read method rather than issuing unrelated reads and implying atomicity.
- A projection is disposable and rebuildable. Stage 1 should not add a persistent cache. If a cache is proposed later, its key must include world/entity scope, source revision, projection/schema version, and access-policy context; policy changes must invalidate or revalidate cached output.

## 6. Access and caller boundary

The current general world-state endpoint is not, by itself, a player-safe character-card API. Stage 1 must not expose this projection to an untrusted player or to a model context until a separate server-side audience/access filter exists.

For the first implementation:
- keep the projection internal to the engine/application test boundary, or expose it only through a trusted administrative route whose authorization and intended audience are explicit;
- do not use UI-only hiding as a security control;
- do not assume authenticated means authorized to see every hidden fact;
- do not return secrets, private intentions, raw audit payloads, arbitrary attributes, or all world facts as part of the card;
- do not claim that `profile` or `known_state` represents what the protagonist has learned unless a knowledge/acquisition model explicitly supports that claim.

If the repository lacks a distinct trusted internal authorization boundary for a proposed route, do not add a public route in this stage. A pure projector plus tests is an acceptable Stage 1 deliverable.

## 7. Canonical state and rollback

The projection must be recomputed from the current accepted state after a commit or rollback; it must not maintain its own mutable copy of character state.

- Retracted or invalidated events must not be treated as current support merely because they remain in historical logs.
- If a source fact is conflicted, unknown, or lacks sufficient provenance for a field's declared semantics, the projector must not silently turn it into a confirmed value.
- Do not implement custom rollback logic inside the card subsystem.
- Existing rollback guarantees are bounded. A read projection cannot repair missing causal declarations or claim that causal completeness has been proved.
- If current source data cannot distinguish valid current state from unsupported historical claims, omit the affected field or return a structured unsupported/ambiguous result; do not guess.

## 8. Error behavior

Use the repository's established error/result conventions. At minimum distinguish:
- world not found;
- entity not found within the requested world;
- entity exists but is not a supported character-like type for this projection;
- inconsistent or unavailable source snapshot;
- unsupported/ambiguous source data, where it prevents a safe projection.

Error responses must not include unauthorized values, hidden source payloads, or secrets. Avoid leaking whether a hidden entity exists to untrusted callers; that policy belongs to the future access layer.

## 9. Test plan and acceptance criteria

### Unit tests
1. Projection of a supported entity includes only approved mapped fields.
2. Missing optional data is omitted, not converted to negative assertions or invented defaults.
3. Arbitrary attributes are not copied wholesale.
4. Same input snapshot yields deep-equal output across repeated calls.
5. Collections/source references are sorted deterministically.
6. Projection does not mutate input objects.
7. Unsupported entity type returns the documented result.
8. Conflicted or unsupported facts are omitted or marked according to an explicit typed rule, never silently confirmed.

### Integration tests
1. Entity lookup is scoped to the requested world.
2. Missing world/entity follows the established error convention.
3. Projection reads do not increment world revision or commit sequence.
4. Projection reads create no WorldEvent, audit mutation, or idempotency record.
5. A rollback followed by a new read reflects the current accepted state, while valid independent sources remain represented according to the core's actual projection rules.
6. No player-facing route is introduced without server-side authorization and access filtering.
7. Existing API and runtime tests remain green.

### Acceptance gate
Do not merge Stage 1 implementation unless:
- all tests pass;
- no existing public response shape is changed;
- no writes occur during projection;
- no arbitrary entity attributes or unfiltered raw facts are exposed;
- projection behavior and limitations are documented;
- a reviewer has checked the implementation against the current core and PR #29 contract.

## 10. Suggested implementation sequence

1. Review the current store's state/query semantics and determine which fields have explicit provenance.
2. Agree on the narrow internal read boundary and the exact allowlist of mapped fields.
3. Implement a pure projector with no persistent cache.
4. Add unit and integration tests from Section 9.
5. Run the complete existing test suite and inspect the diff for accidental adapter, vectorization, or unrelated core changes.
6. Request independent review before any merge.

## 11. Open decisions to resolve during implementation review

These are intentionally not guessed here:
- Which current entity types should count as characters in the first supported slice?
- Which exact existing entity attributes, if any, are approved profile fields rather than opaque data?
- Does the current storage interface provide a consistent snapshot suitable for the projection, or is a narrow read method needed?
- Which trusted internal caller can use the projection without creating a new public disclosure path?
- What exact result/error shape matches current repository conventions?

Resolve these against current source and tests before coding. Do not broaden Stage 1 to answer them by assumption.

## 12. Implementation status disclaimer

This is a proposed specification only. It does not claim that the projector, card API, character profile store, knowledge model, or player-safe access filtering has been implemented. The current runtime and its tests remain the source for claims about existing behavior.
