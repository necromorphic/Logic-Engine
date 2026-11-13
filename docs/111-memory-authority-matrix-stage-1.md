# Memory Authority Matrix — Stage 1 producer contract

**Status:** IN PROGRESS — semantic producer contract drafted from the accepted Memory → NPC ADR (13 November 2026). Runtime producer bindings are NOT VERIFIED; this document does not authorize activation.

**Governing decision:** Notion page “Memory → NPC — Architecture Decision Record и план реализации”, §2.3 and §4, accepted 13 November 2026.

## 1. Scope

The first Authority Matrix wave contains exactly two evidence types and one trusted principal per type:

| Evidence type | Sole trusted principal | What it may attest |
|---|---|---|
| `direct_observation` | One deployment-configured World/Simulation producer | A canonical event occurred and was available for perception by one specifically identified NPC under the supplied scene/perception conditions. |
| `communication_delivered` | One deployment-configured Host delivery-receipt producer | A specific communication was delivered to one specifically identified NPC through a supported Host delivery boundary. |

No additional evidence type, principal, delegation, fallback producer, or model authority is included in this wave.

This is distinct from the existing Core initial-assignment path (`author_initial` / `imported`). Those kinds remain governed by their own trusted-source contract. They MUST NOT be relabelled as observation or communication, and MUST NOT be used as a substitute when either producer above is unavailable. The older “Stage 1” semantic-model documents describe a different stage numbering and do not expand this Authority Matrix.

## 2. Shared trust requirements

For either evidence type:

1. Producer identity is injected/resolved by trusted deployment configuration. A request field, model output, Memory record, prompt, display name, or caller-supplied `producer` label cannot establish producer authority.
2. Core resolves the canonical World and subject/Actor binding. Caller-supplied actor or world identifiers are selectors to validate, not authority.
3. Evidence is bound to its canonical source/event identity and applicable source version or Core snapshot. A digest proves byte integrity only against a trusted digest; it does not prove origin, truth, perception, or delivery.
4. Core owns acquisition history and any resulting subject-relative state. Provider retrieval, indexing, context inclusion, prompt serialization, and NPC interpretation do not create acquisition.
5. Authorization is checked before protected content is returned. Missing, ambiguous, stale, revoked, incomplete, or unverifiable evidence produces a non-ready result and no acquisition.
6. Each logical evidence operation has a stable idempotency identity. Identical replay is acknowledged without duplicate acquisition; reuse with different semantics is rejected.
7. The producer may attest only the fact represented by its type. It cannot assert canonical truth of the communicated claim, NPC belief, comprehension, or downstream action success.

The exact wire schema, event/effect names, persistence projection, and public API are deliberately deferred to Stage 2 Core Evidence Contract review.

## 3. Type-specific contract

### 3.1 `direct_observation`

**Owner:** the single trusted World/Simulation producer.

**Required semantic input:**
- canonical World and canonical event/source reference;
- exactly one canonical observing NPC/Actor;
- the bounded proposition or event aspects made available to that observer;
- observation time and the scene/perception conditions needed to justify availability;
- applicable Core snapshot/source-validity reference;
- stable operation/idempotency identity.

**Permitted assertion:** the named NPC had an opportunity to perceive the specified bounded event/aspect under the producer-attested conditions.

**Not implied:** universal visibility; perception of unrelated event details; attention, language comprehension, memory retention, belief, or objective truth of a statement made during the event.

**Reject/non-ready when:** producer is not the configured principal; observer cannot be resolved to the canonical Actor in the World; event/source is missing, invalid, revoked, or outside the snapshot; scene/perception conditions are absent or insufficient; scope is ambiguous; or replay identity conflicts.

### 3.2 `communication_delivered`

**Owner:** the single trusted Host delivery-receipt producer.

**Required semantic input:**
- authenticated Host session and its trusted conversation/World binding;
- canonical sender and exactly identified canonical recipient NPC/Actor;
- stable message/source reference and version (not a mutable chat-array index);
- logical delivery operation and attempt identity;
- supported Host receipt/status evidence and its timestamp;
- applicable Core snapshot/source-validity reference;
- stable operation/idempotency identity.

**Permitted assertion:** the specified message was delivered to the specified recipient according to the exact semantics guaranteed by the supported Host receipt signal.

**Status boundary:** the first wave supports `delivered` only. Attempted, queued, injected-but-unconfirmed, rendered, acknowledged/read, and understood are distinct states. A successful HTTP response or prompt/context inclusion is not a delivery receipt unless the approved Host contract explicitly guarantees that exact stage. Delivered MUST NOT be upgraded to read, understood, believed, or accepted as true.

**Reject/non-ready when:** producer is not the configured principal; Host session/account/conversation binding is missing or mismatched; recipient or message version is ambiguous; no supported delivery receipt exists; receipt is only an attempt/acceptance signal; source is stale/revoked; or replay identity conflicts.

## 4. Required failure behavior

The following are semantic rejection categories, not final wire-code names:

- producer absent, unknown, ambiguous, or not the single configured principal;
- unsupported evidence type or unsupported status;
- invalid/missing canonical World, Actor, source, or message binding;
- wrong World/Actor/recipient scope;
- source invalidated/revoked or snapshot stale;
- incomplete or unverifiable perception/delivery evidence;
- malformed input or unsupported fields;
- idempotency-key conflict.

All such cases MUST fail closed: no acquisition event, no candidate promoted to acquired, no partial protected content, and no fallback to another evidence type. Stage 2 may assign stable reason-code strings after reviewing existing Core error conventions.

## 5. Acceptance test matrix

| ID | Scenario | Required result |
|---|---|---|
| AM-01 | Unconfigured or forged producer | Reject; no acquisition |
| AM-02 | Second principal attempts same evidence type | Reject; no multi-principal fallback |
| AM-03 | Observation event exists but NPC is not an eligible observer | Reject; another NPC's observation is not inherited |
| AM-04 | Observation conditions are incomplete/ambiguous | Non-ready; no inferred perception |
| AM-05 | Observation source is rolled back or snapshot is stale | Reject using current source validity and snapshot |
| AM-06 | Same valid observation is replayed | Idempotent acknowledgement; one acquisition |
| AM-07 | Host delivery attempt fails or outcome is unknown | No delivered status and no acquisition |
| AM-08 | Host accepts injection but has no supported receipt signal | Remain unconfirmed; no acquisition |
| AM-09 | Message is delivered to NPC A, not NPC B | A-only evidence; B receives no acquisition |
| AM-10 | Delivered message contains a false claim | Record the delivered report/claim; do not change canonical truth |
| AM-11 | Delivered is presented as read/understood | Reject unsupported status promotion |
| AM-12 | Message version/source is revoked or changed before use | Reject stale/revoked evidence |
| AM-13 | Same delivery receipt is replayed | Idempotent acknowledgement; no duplicate acquisition |
| AM-14 | Same idempotency key is reused with changed recipient/source | Conflict; no second acquisition |
| AM-15 | Provider retrieval or prompt inclusion is offered as acquisition proof | Reject; retrieval/inclusion is not a trusted producer |

Tests that only call a pure helper or mock the producer cannot prove the production producer boundary. Stage 2 acceptance must exercise the real producer-to-Core path and inspect the Core-owned acquisition state.

## 6. Repository source audit — bounded findings on branch `memory/development-2026-11-13`

Inspected at base HEAD `df129425ecd5fccba45b4d9b7f6ee7c5d3e28d1f`:

- `src/application/engine.js` contains `recordTrustedInitialKnowledgeSource()`, which validates deployment-approved `author_initial` / `imported` source bytes and commits `knowledge.acquisition.initial`. It does not implement either new producer contract.
- `src/application/engine.js` contains `recordNpcBeliefTransition()`; its proposal is validated against existing Core acquisition reads. It does not create acquisition evidence and cannot be reused as a producer.
- `src/application/trusted-initial-knowledge-source.js` validates the existing initial/import source registry; it is not an observation or Host delivery-receipt verifier.
- `src/application/npc-knowledge-read.js` validates the actor/purpose/snapshot-bound read request; it does not establish acquisition provenance.
- `src/application/memory-npc-consumer.js` consumes provider candidates through Core authorization seams; retrieval is not an acquisition writer.
- `host-adapter/extension-gateway/server-plugin/host-adapter.mjs` has lifecycle and account-mutation receipt stores, but these receipts attest Host filesystem/account mutations, not NPC message delivery.
- `host-adapter/extension-gateway/host-context.mjs`, `host-adapter/extension-gateway/index.js`, `host-adapter/npc-context-receiver.mjs`, and `host-adapter/npc-generation-content-projection.mjs` contain no delivery/receipt producer path in the inspected versions.
- `docs/48-npc-delivery-acquisition-boundary-matrix.md` explicitly describes itself as semantic acceptance design and states that it does not claim a delivery, acquisition, or belief runtime exists. It specifies important distinctions but is not a trusted Host receipt producer.
- Repository search found `direct_observation` in an example World Pack declaration, not evidence of a trusted runtime producer. No `communication_delivered` runtime producer was located in the inspected source/search results.

**Audit limitation:** this is a bounded repository source audit, not a live deployment inspection. It does not prove that no deployment-specific producer exists outside this repository.

## 7. Core implementation readiness audit for Stage 2

The existing Core path supplies reusable lifecycle primitives, but it is not a drop-in implementation of the two new evidence types:

- `src/core/rules.js` accepts `knowledge.acquire` only through the internal Core capability and currently restricts `acquisition_kind` to `author_initial` / `imported`.
- SQLite migration 13 defines `knowledge_acquisitions.acquisition_kind` with the same two-value CHECK constraint. Adding the two new kinds therefore requires a reviewed schema migration; changing only the JavaScript validator would fail at persistence.
- The current acquisition effect requires `fact_id`, pins `acquired_value` and canonical fact source-event IDs, and the commit path requires an existing non-destroyed subject plus an active canonical fact. A direct observation or delivery receipt is not automatically a canonical fact. Stage 2 must decide how each producer's source is represented in Core without turning a report into world truth or inventing a fact solely to satisfy the current schema.
- The event/effect path already provides Core-owned commit, idempotency, causal dependencies, replay, rollback, and derived acquisition projection. Those primitives are candidates for reuse only after the new source semantics fit them.
- `LogicEngine.readNpcKnowledge()` already binds the read to authenticated adapter/actor request data, purpose, World snapshot, active fact value and source-event set, and rechecks the snapshot before returning. It currently reads the fact-backed acquisition projection.
- `prepareNpcBeliefContext()` performs per-acquisition visibility checks, rejects incomplete reads, and rechecks snapshot freshness. `recordNpcBeliefTransition()` revalidates before canonical commit and enforces idempotency. The belief path cannot compensate for missing or untrusted acquisition evidence.

**Stage 2 design constraint:** do not simply add `direct_observation` and `communication_delivered` to the existing enum or SQL CHECK. First specify the canonical source representation and source-validity rule for each type. Then decide whether the current fact-backed `knowledge.acquire` effect can represent it without semantic distortion, or whether the smallest Core-owned effect extension is required. Keep source-specific producer validation outside caller-controlled event fields.

## 8. Stage 1 disposition and Stage 2 entry gate

- Semantic ownership and the two evidence meanings: **DEFINED** by the accepted ADR and this contract draft.
- Exact trusted producer implementation identities/configuration: **NOT VERIFIED**.
- Production observation producer: **NOT FOUND in inspected repository paths**.
- Production Host delivery-receipt producer: **NOT FOUND in inspected repository paths**.
- Runtime schemas, Core event/effect representation, and end-to-end tests: **NOT STARTED**.

Stage 1 cannot be marked PASS until each type has exactly one concrete trusted producer identity, an owner-approved input/output contract, rejection semantics, and a testable real producer boundary. If either producer cannot be identified, keep that type unsupported and fail-closed; do not invent a producer or infer a signal.

Stage 2 must first map these contracts onto existing Core event validation, source validity, actor binding, snapshot, idempotency, and acquisition lifecycle. Reuse existing Core mechanisms where their semantics fit. Do not create a parallel event log, revision cursor, authorization system, acquisition store, or dispatch gate.

**Activation remains DISABLED / FAIL-CLOSED.** This document makes no production-readiness claim.
