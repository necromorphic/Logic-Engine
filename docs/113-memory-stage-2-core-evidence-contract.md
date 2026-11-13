# Stage 2 — Core Evidence Contract: source audit and implementation boundary

**Status:** DESIGN IN PROGRESS. No production Core code changed by this document. No tests or runtime workflows were run for this work block.

**Working branch:** `memory/development-2026-11-13`  
**Inspected HEAD:** `f7584e820cd7bba02b7b7590cb34b72447651eaf`  
**Governing ADR:** Notion “Memory → NPC — Architecture Decision Record и план реализации”, §§2.2–2.5, 4, 6–7.  
**Authority contract:** `docs/111-memory-authority-matrix-stage-1.md`.

## 1. Purpose

Stage 2 must let Core record subject-relative evidence acquisition from exactly the two first-wave producer contracts:

- `direct_observation`: one trusted World/Simulation producer;
- `communication_delivered`: one trusted Host delivery-receipt producer.

This is not a change to World truth. A delivered message may contain a false claim; an observation receipt attests only the bounded event/aspects available to one observer. Neither receipt proves belief, comprehension, attention, or truth of communicated content.

Provider retrieval, indexing, embedding, prompt inclusion, and model output remain non-authoritative. Core alone commits acquisition history.

## 2. Verified current Core constraints

The following facts were read from the current branch source at the inspected HEAD:

1. `src/core/rules.js`
   - `knowledge.acquire` is accepted only when the internal `allowKnowledgeAcquisition` capability is supplied.
   - Its accepted `acquisition_kind` values are exactly `author_initial` and `imported`.
   - Its current required shape includes `fact_id`, provenance and authorization references, plus acquisition-time value/source-event snapshots.
   - Public/general event callers cannot directly mint acquisition effects.

2. `src/storage/sqlite-store.js`
   - Schema migration 13 creates the canonical-derived `knowledge_acquisitions` projection.
   - `fact_id` is currently NOT NULL.
   - SQL CHECK permits only `author_initial` and `imported`.
   - Migration 17 added `acquired_value_json` and `acquired_source_event_ids_json`.
   - Projection rebuild is derived from canonical `world_events`; it filters out acquisitions whose subject or active fact is not eligible.
   - The projection is not an independent authority and must remain rebuildable from canonical events.

3. `src/application/engine.js`
   - `recordTrustedInitialKnowledgeSource()` accepts only deployment-approved `author_initial` and capability-gated `imported` sources.
   - It resolves an existing non-destroyed subject and an active canonical fact, then snapshots the exact fact value and canonical source event IDs into the acquisition effect.
   - `readNpcKnowledge()` currently uses an INNER JOIN to active `facts`, compares the acquisition-time value/source-event set against the current fact, and rejects version mismatch.
   - `recordNpcBeliefTransition()` consumes Core-owned acquisition IDs; it does not create acquisition evidence.

4. `src/application/memory-npc-consumer.js`
   - Provider candidates are re-read through Core authorization seams.
   - Retrieval candidates and their metadata are not acquisition evidence and cannot be promoted to acquired knowledge by this consumer.

## 3. Why an enum-only change is incorrect

Adding two strings to the JavaScript enum and SQLite CHECK would be insufficient and unsafe:

- The current schema requires every acquisition to point to a canonical fact.
- Current commit validation rejects missing/inactive facts.
- Projection rebuild requires an active fact.
- Knowledge reads require the fact row and compare its current value/source-event set.
- A communication receipt is a source report, not a canonical fact. Treating its content as `fact.set` would turn a report into World truth.
- A Host receipt's message digest and stable message/version identity are not the same thing as a Core World event ID.
- A direct-observation receipt must identify bounded observed aspects and observer conditions; it must not imply the entire event was perceived.

Do not weaken these constraints globally or make existing initial/import acquisitions less strict.

## 4. Required Core contract shape

The Core contract must be discriminated by evidence type and must have a trusted ingress per type. The producer identity must be selected from deployment configuration/internal composition, never from request JSON, model output, Provider metadata, or a caller-supplied `producer` label.

### 4.1 Shared committed acquisition identity

Every committed acquisition must bind:

- canonical World and canonical subject Actor resolved by Core;
- stable acquisition ID and idempotency key;
- exact evidence type;
- trusted producer identity resolved by Core composition;
- immutable source reference and source version/identity;
- source digest where the source contract provides one;
- Core authorization reference and snapshot identity;
- acquisition event ID and committed revision;
- source-specific evidence payload, stored as bounded JSON data.

A retry with the same idempotency key and identical semantic payload must return the original acknowledgement. Reuse with changed subject, World, source, recipient, version, evidence type, or payload must conflict. A stale snapshot must be rejected before a new acquisition is committed.

### 4.2 `communication_delivered`

The existing Host producer is deliberately bounded to one configured character-chat path and already emits a signed receipt without raw message text. Core must verify the trusted Host receipt through the existing Host/Core trust boundary and bind at least:

- authenticated Host installation/account/session and conversation binding;
- canonical World and recipient Actor resolved by Core;
- stable message ID and message-version ID;
- content SHA-256 digest;
- exact delivery operation/receipt identity and timestamp;
- pinned Host source and mutation-route attestation identity required by the receipt contract.

The receipt means only **delivered**. It does not mean read, understood, believed, or true.

The raw message body must not be copied into a canonical World fact. The receipt binds the immutable message source/version and digest. Later Provider content retrieval must be checked against that binding before protected content is returned; Provider content itself never proves delivery.

### 4.3 `direct_observation`

This type remains unsupported until a real World/Simulation producer exists. Its trusted contract must bind:

- canonical World event/source;
- exactly one canonical observer Actor;
- bounded event aspects available to that observer;
- observation time;
- producer-attested scene/perception conditions;
- applicable snapshot and source validity;
- stable operation/idempotency identity.

The existing `npc.observe-target` helper is read-only and is not this producer. No fallback to a Host hook, model assertion, example World Pack declaration, or Provider record is allowed.

## 5. Persistence and event-sourcing constraints

The current canonical `world_events` log remains the sole source of truth for Core acquisition history. The `knowledge_acquisitions` table remains a derived projection and must be fully reconstructible from canonical events.

The next implementation design must compare two options before choosing:

- **Option A — generalize the existing acquisition projection:** retain one acquisition history and add a discriminated source-evidence payload while preserving strict fact-backed validation for `author_initial`/`imported`. This requires a migration strategy for nullable/non-fact `fact_id`, source evidence fields, and rebuild/read behavior.
- **Option B — represent producer receipts as typed canonical Core source events and link the existing acquisition effect to those events:** this must reuse the existing event log, rollback, replay, snapshot, and idempotency machinery; it must not introduce a second event log or a second acquisition store.

Do not implement either option until it is proven that it preserves:
- event replay and projection rebuild;
- rollback/invalidation semantics;
- source revocation and version freshness;
- actor/World isolation;
- belief-transition evidence references;
- backward compatibility for existing `author_initial`/`imported` rows and old databases.

The Host delivery receipt currently has no raw message body by design. The implementation must not invent a Core source event or treat an external receipt ID as a pre-existing World event. If the source validity contract cannot be verified synchronously at acquisition/read time, the evidence type remains non-ready.

## 6. Read-path requirements

A future Core knowledge read must return a discriminated evidence item without flattening source semantics:

- fact-backed initial/import item: current active-fact version comparison remains mandatory;
- communication-delivered item: verify the Host receipt binding, recipient/World scope, message version and digest; never infer read/understood;
- direct-observation item: verify canonical source-event validity and the observer/aspect scope.

All items remain subject to the existing Core read authorizer, actor binding, snapshot freshness, authorization, and revocation checks. A missing validator, unavailable source, stale version, invalid signature, mismatched digest, or ambiguous scope returns non-ready; no partial protected content is returned.

Belief transitions continue to reference Core acquisition IDs only. They must not accept Provider record IDs, Host message IDs, raw model claims, or unverified source handles as acquisition IDs.

## 7. Implementation order

1. **Stage 2A — persistence design:** settle Option A vs Option B by tracing event validation, projection rebuild, rollback, replay, and current acquisition reads. Document the chosen canonical representation and migration compatibility.
2. **Stage 2B — trusted communication ingress:** implement the smallest Core-owned verifier/ingress for the existing Host `communication_delivered` receipt. No public endpoint or caller-selected producer identity. Keep direct observation unsupported.
3. **Stage 2C — typed acquisition read:** expose the new item discriminant through Core's existing authorized knowledge read without weakening fact-backed records.
4. **Stage 2D — direct-observation gate:** implement only after a real configured World/Simulation producer is identified; otherwise keep it explicitly unsupported/fail-closed.
5. Only after implementation is complete, define and run the Stage 2-specific test matrix and then the broader integration acceptance. No installed SillyTavern/provider/runtime testing is part of this design-only block.

## 8. Explicit non-goals

- No Provider implementation or Provider version change.
- No ST-VectorService changes.
- No model-provider/API-specific serialization.
- No Host authentication or Gateway rewrite.
- No new Memory→NPC activation or change to `LOGIC_ENGINE_MEMORY_NPC_ENABLED`.
- No Core authority, acquisition, or belief semantics bypass.
- No parallel event log, acquisition store, identity mechanism, authorization system, or dispatch gate.
- No live SillyTavern testing at this stage.

## 9. Current status

- Core source constraints: **INSPECTED**.
- Stage 2 canonical evidence representation: **DESIGN IN PROGRESS**.
- Core production implementation: **NOT STARTED**.
- Stage 2 tests: **NOT RUN / NOT DUE**.
- Installed SillyTavern/provider/runtime tests: **NOT DUE**.
- Memory→NPC activation: **DISABLED / FAIL-CLOSED**.
