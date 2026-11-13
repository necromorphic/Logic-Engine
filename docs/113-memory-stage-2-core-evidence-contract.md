# Stage 2 — Core Evidence Contract: source audit and implementation boundary

**Status:** Stage 2A persistence direction selected; type-specific source validation design remains in progress. No production Core code changed by this document. No tests or runtime workflows were run for this work block.

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

## 5. Persistence and event-sourcing decision

**Selected direction: Option A — generalize the existing Core acquisition history and its derived projection.** This is the smallest design that preserves one Core-owned acquisition authority. It is not permission to weaken the current fact-backed path.

The current canonical `world_events` log remains the sole source of truth for Core acquisition history. The `knowledge_acquisitions` table remains a derived projection and must be fully reconstructible from canonical events. No second event log, source registry, or acquisition store will be introduced.

The planned schema evolution is:

- retain the existing `knowledge_acquisitions` table and its identity/event/revision fields;
- make `fact_id` nullable only for the two new evidence kinds;
- extend the SQL acquisition-kind constraint to exactly `author_initial`, `imported`, `direct_observation`, and `communication_delivered`;
- add a nullable `source_evidence_json` projection column;
- enforce a type split: `author_initial`/`imported` require a non-null `fact_id` and null `source_evidence_json`; `direct_observation`/`communication_delivered` require null `fact_id` and non-null `source_evidence_json`;
- keep `acquired_value_json` and `acquired_source_event_ids_json` semantics unchanged for the legacy fact-backed kinds; new evidence kinds use the typed source-evidence object and must not pretend a Host message receipt is a Core world-event ID.

A new migration must rebuild the SQLite table transactionally, copy every existing row byte-for-byte at the value level, recreate indexes, and run `PRAGMA foreign_key_check`. Existing databases at schema version 17 must remain readable and upgrade without dropping or rewriting canonical event history. Read-only Core startup must require the new schema version after the migration ships.

### 5.1 Why this direction fits the current event model

The source audit confirms that:

- `SQLiteStore.rebuild()` reads only canonical `world_events` whose validity is `valid`, then reconstructs projections;
- rollback marks the affected canonical events `retracted`/`invalidated` and calls the same `rebuild()` path;
- the current acquisition projection is already derived from `knowledge.acquire` effects and is not a separate authority;
- belief transitions already reference acquisition IDs, so preserving one acquisition identity space avoids a parallel evidence-ID system.

The implementation must extend the existing `knowledge.acquire` effect and projection rebuild with strict discriminated validation. Legacy fact-backed effects retain their existing active-fact checks and exact acquisition-time value/source-event comparison. New evidence effects must pass a type-specific trusted ingress before the internal Core capability can commit them; the generic public event API must remain unable to mint them.

The Host delivery receipt currently has no raw message body by design. The implementation must not invent a Core source event or treat an external receipt ID as a pre-existing World event. The immutable receipt binding (message ID/version and content digest) is stored as typed source evidence. Any later Provider content must be matched to that binding before it can be disclosed. If source validity cannot be checked synchronously at acquisition/read time, the evidence type remains non-ready.

The exact type-specific source-evidence schemas and verification functions are Stage 2B implementation work; they must be finalized before the migration is applied.

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


## 10. Host → Core receipt transport audit

The existing Host receipt producer is present, but the signed delivery evidence is not yet a Core acquisition input:

- `HostLifecycleReceiptStore` creates `communication_delivery` only for the verified one-message append in a one-to-one `character-chat`. It binds the canonical recipient World/Actor, authenticated account, stable message/version IDs, content digest, `delivered` status and Host event/mutation IDs. It carries no raw message text.
- The Host proxy hashes the exact `communication_delivery` object and signs a proof with the configured adapter token. The signature binds adapter ID, Host installation/account/session, conversation, event ID/type, mutation ID, operation, mutation digest, delivery receipt digest and timestamp.
- Core's `POST /v1/host-lifecycle/events` accepts only the digest-only lifecycle envelope. The delivery object itself is not accepted or persisted by that route. Repository source inspection found no Core route that accepts `communication_delivery_receipt`.
- Core's `verifyHostLifecycleReceipt` verifies the lifecycle event signature using the configured adapter secret, but this verifies the lifecycle envelope; it does not make the separate delivery payload available to Core.
- `HostVersionDigestLedger` has capture/reconcile and inventory-state operations, but no public read operation for a specific message/version or active pointer. More importantly, `src/index.js` currently constructs it with `verifyInventorySnapshot: async () => false`. Therefore complete message-version inventory can never reach `READY` in this composition. A point-in-time delivery receipt alone cannot prove that the version remains active at later retrieval time.

### Stage 2B prerequisite and safe sequence

1. Add a bounded Core receipt-ingress contract that accepts only the signed receipt envelope, verifies its HMAC with the configured adapter principal, recomputes the delivery digest, checks the exact event/operation/status and resolves the existing adapter conversation binding to the same canonical World/Actor. No browser-supplied producer identity is trusted.
2. Add a read-only Host version lookup on the existing `HostVersionDigestLedger` that returns the exact tuple and active-pointer state only when that conversation inventory is `READY`. It must not manufacture readiness or infer missing versions.
3. Keep acquisition non-ready until the existing inventory verifier can legitimately establish `READY`. Do not bypass the current deny-only verifier, trust a single capture response, or infer completeness from the lifecycle receipt.
4. Only after those checks can the internal Core evidence-ingestion method create the canonical acquisition event. The source evidence is the signed delivery receipt; the Host message body remains outside Core and must later be retrieved from Provider only by matching the immutable message/version/digest binding.
5. Keep `direct_observation` unsupported until a real trusted World/Simulation producer is implemented.

This identifies a real implementation dependency in the existing Host/Core composition. It is not a Provider or model-backend task, and it does not justify starting installed SillyTavern tests now.
