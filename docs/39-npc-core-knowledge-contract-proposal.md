# Core Knowledge and Delivery Contract — Proposal for Review

Status: proposed semantic contract on `feat/npc-subsystem`. Documentation only. This document does not authorize runtime, API, schema, SQLite, prompt, vectorization, or host-adapter changes.

## 1. Purpose

Define the smallest semantic contract the core must eventually provide so the NPC subsystem can reason from actor-relative information without becoming a second authority for world truth, knowledge acquisition, provenance, delivery, or rollback.

This proposal is downstream of the ownership decision recorded in `docs/00-architecture-baseline.md`, `docs/06-npc-autonomy-and-process-manager.md`, and `docs/07-knowledge-and-narrative-boundaries.md`. It does not claim that the required contract currently exists in executable code.

## 2. Ownership and non-goals

The core remains authoritative for:
- canonical world facts and events;
- records that a subject acquired a proposition, including acquisition basis and provenance;
- delivery attempts and supported delivery/receipt status;
- validity/reconciliation of knowledge records when supporting sources change;
- causal rollback and any dependent state reconciliation.

A trusted context-preparation caller may request and filter an actor-specific view using core-approved information. It is not the authoritative store and cannot create acquisition or delivery facts merely by preparing a prompt.

This proposal does not define a general-purpose knowledge graph, a second event store, a new revision counter, a separate rollback engine, an independent access-control subsystem, or a mandatory agent framework. It does not choose database tables or public endpoint shapes.

## 3. Distinct concepts

The implementation must preserve the distinctions below; no state may be inferred solely from another.

| Concept | Meaning | Does not imply |
|---|---|---|
| Canonical proposition | A claim accepted by the current world state | Any subject knows it |
| Acquisition record | Evidence that a subject obtained a proposition through a declared path | The subject believes it or that it is objectively true |
| Belief state | A subject's current stance toward a proposition (belief, doubt, rejection, suspicion, etc.) | Canonical truth or a valid acquisition event by itself |
| Source/provenance | The event, observation, communication, document, inference premises, or authorized initial input supporting acquisition | That delivery occurred unless the path requires and proves delivery |
| Context retrieval | A candidate fragment returned by a search or lookup | Permission to expose it or subject knowledge |
| Context inclusion | Information selected for one model request | In-world delivery, comprehension, persistent memory, or belief |
| Delivery record | A tracked attempt to communicate a payload to a target through a channel | Successful visible rendering or understanding unless supported by host evidence |
| Acknowledgement/comprehension | A separate signal or adjudicated state, if the integration supports it | Objective correctness of the received content |

Unknown, unavailable, withheld, invalid, disputed, and false must not be collapsed into a single negative result.

## 4. Minimal semantic records

The following are conceptual record requirements, not approved schemas.

### 4.1 Acquisition record

An acquisition record should identify at least:
- the subject/holder;
- the proposition or referenced world claim;
- the acquisition kind (for example: observation, communication, document/recording, permitted inference, authorized initial knowledge);
- source references and any required inference premises;
- relevant in-world time and observation/channel conditions, where applicable;
- epistemic status and confidence/uncertainty where supported;
- validity/reconciliation status and the reason for any change.

Use existing canonical IDs and provenance references where available. Do not invent a parallel event identity or revision scheme. If a required source reference cannot be represented by an existing core contract, mark that case unsupported and return it for core design rather than inventing a local identifier format.

### 4.2 Belief state

Belief is subject-relative and may change independently of acquisition history. The semantic contract must permit:
- a subject to remember having heard a claim but no longer believe it;
- a false belief to persist after canonical truth changes, until the subject receives and accepts correction;
- conflicting evidence to remain unresolved where no declared reconciliation rule decides it;
- forgetting or loss of detail without falsifying the historical fact that acquisition occurred;
- different subjects to reach different conclusions from the same evidence.

The core owner has confirmed that persistent subject-relative belief state is core-owned simulation state. It remains logically separate from acquisition history and canonical world truth. An NPC-domain projection may be used only if the core explicitly defines its authority/reconciliation boundary; it must never become a second source of truth. This is a semantic ownership decision, not evidence that the required belief persistence/runtime is already implemented.

### 4.3 Delivery record

A delivery record should identify:
- intended target;
- payload or canonical event/message reference;
- channel/host and attempt identity when available;
- delivery state and the evidence supporting that state;
- relevant timestamps or in-world ordering where supported;
- retry/failure information without recommitting the underlying world event.

The status vocabulary must reflect real integration signals, not optimistic assumptions. At minimum, distinguish pending/not attempted, attempted/failed, accepted by host but not confirmed visible, and confirmed shown only when the host supplies such a signal. Receipt, acknowledgement, and comprehension are separate states and must remain unsupported/unconfirmed if no reliable signal exists.

## 5. Acquisition rules by path

| Path | Minimum evidence before recording acquisition | Current integration position |
|---|---|---|
| Direct observation | Subject, event/proposition, time, and world-pack-defined visibility/proximity or sensory conditions | Deferred until observation/access semantics exist |
| Communication/report | Source, target, payload, channel, and supported evidence that the message reached the target | Delivery and acquisition must be separate; currently unconfirmed |
| Document/recording | Identified source item and a supported path showing the subject accessed/read/heard it | Deferred unless an existing source/access contract can prove it |
| Inference | Premises already available to the subject plus a declared inference rule or explicitly adjudicated inference | A model rationale alone is not proof; inference-record contract deferred |
| Rumor/unverified report | Source/channel and explicitly unverified epistemic status | Must not be promoted to canonical truth by repetition alone |
| Author-provided initial knowledge | Explicit authorization and provenance marking it as initial state | Must not be disguised as in-world acquisition |
| Search/vector retrieval | Retrieval reference only | Never sufficient by itself to record acquisition |
| Prompt/narrative inclusion | Generation/context reference only | Never sufficient by itself to record acquisition or delivery |

A generated NPC claim such as “I saw it” cannot retroactively establish the observation record. The source path must be validated from available simulation evidence or sent for adjudication.

## 6. Reconciliation when sources change

When a source event or supporting source is invalidated, the core must evaluate the dependent acquisition records using its existing causal/rollback contract:
1. identify which acquisition records depend on the invalid source;
2. preserve a proposition if another valid acquisition path still supports it under the declared rules;
3. invalidate or mark unsupported only the acquisition consequences that no longer have a valid basis;
4. do not automatically rewrite a subject's belief merely because canonical truth changed;
5. preserve audit history according to the core's existing rollback policy.

This proposal adds no new dependency graph or rollback mechanism. It requires the future knowledge contract to reference the core's existing causal/source identities. If current storage cannot express the required dependency, the case remains blocked pending a core design decision.

## 7. Actor-specific context query

The future integration boundary should support a trusted caller asking for a decision-time view for a named actor and purpose. Semantically, the result should:
- identify the actor and source snapshot/time when the core can provide them;
- distinguish available, absent, unknown/incomplete, invalid, disputed, and withheld information;
- return only records the caller is authorized to use for that actor and purpose;
- preserve the difference between canonical truth, actor acquisition history, current belief, rumor, and inference;
- carry source/provenance references sufficient for validation/audit;
- explicitly state incomplete or unsupported portions rather than silently treating them as false;
- avoid exposing author-reserved secrets before model input.

This is a proposed contract, not a claim that a current endpoint or method already provides it. The existing `registerContextManifest` is a generation/world-reference manifest; it is not an actor-relative knowledge query and does not prove acquisition or permission.

## 8. Boundary with existing core mechanisms

- **Canonical event and projection path:** authority for world-side occurrence/state and supported causal identity; not proof of actor awareness.
- **`LogicEngine.registerContextManifest(...)`:** tracks generation/context references and referenced world items; not proof of actor access, acquisition, comprehension, or belief.
- **`ProposalService`:** stages and validates event proposals through its current lifecycle; not a knowledge-acquisition owner or actor-authorization system.
- **Trusted context-preparation caller:** filters and packages information for the model; not a persistent authority for acquisition, belief history, delivery, or rollback.
- **NPC decision step:** may propose an inference, belief update, message, or action intent; cannot commit these as canonical records without an approved core path.

## 9. Deferred until core contract and tests are approved

Do not implement these in the NPC branch yet:
1. Public API methods/endpoints for acquiring, querying, revising, or invalidating knowledge.
2. New persistent schema/tables for acquisition, belief, or delivery.
3. A new knowledge event log, revision counter, causal graph, rollback mechanism, or permission subsystem.
4. Claims of successful observation, receipt, display, or comprehension without evidence from a supported source/host signal.
5. NPC memory, forgetting, belief revision, and autonomous communication runtime that assumes those persistence contracts.
6. End-to-end tests built on mocks that simulate missing production semantics.

The first executable tests should be written against an agreed real interface. Until then, acceptance scenarios remain semantic tests/specifications, not evidence of runtime capability.

## 10. Core-owner decision record — 2026-10-24

The core owner reviewed all eight questions in this proposal. The following semantic decisions are confirmed; they do not claim that runtime implementation already exists.

1. **Ownership — confirmed.** The core owns authoritative acquisition/provenance records, delivery attempts/receipt status, and reconciliation against canonical source validity. Persistent subject-relative belief state is also core-owned simulation state.
2. **Three separate concepts — confirmed.** Acquisition history, current belief stance, and canonical proposition/world truth remain distinct. Acquisition does not force belief; belief does not prove acquisition or objective truth. Unknown, withheld, and incomplete are query/access results, not falsehood or a belief stance.
3. **Identifiers/snapshots — confirmed.** Reuse existing `world_id`, `entity_id`, `event_id`, `fact_id`, applicable `context_manifest_id`/`generation_id`, and the exact-snapshot pair `(world_revision, commit_sequence)` from one consistent read view. Do not add parallel identity/revision/event-log/causal-graph/rollback systems.
4. **First acquisition path — confirmed with narrow scope.** The initial vertical slice supports only explicitly authorized `author_initial`/imported initial knowledge, marked as authored/imported rather than in-world discovery. Observation, communication, documents, inference, and rumor remain unsupported until evidence paths are specified and testable.
5. **Delivery signals — partially confirmed.** Host injection without a documented rendering signal remains `injected_unconfirmed`; `shown` is unsupported until a real host signal is identified and verified. Delivery, acknowledgement, comprehension, acquisition, and belief remain distinct. No host-rendering capability has been verified.
6. **Actor-specific read/query boundary — still needs design.** `registerContextManifest(...)` records context/generation references; it is not an actor-relative knowledge query and does not establish permission or acquisition. An internal core-owned actor/purpose/snapshot-scoped read/filter contract must be designed before implementation. No public endpoint is approved.
7. **Rollback reconciliation — agreed in principle, implementation not established.** Acquisition records must reference existing source/event identities and reconcile against remaining valid acquisition paths. Preserve independent support; do not blindly erase all related memory or automatically rewrite belief because canonical truth changed. Do not add a separate NPC rollback mechanism.
8. **First vertical slice — direction confirmed, exact interface still open.** The smallest slice should cover authorized initial knowledge with provenance, actor-specific read/filter, truth/acquisition/belief separation, reserved-secret exclusion, and tests for actor separation, provenance, unknown/withheld states, and proposal non-mutation.

### Remaining implementation gate

Before runtime/API/schema/storage work, reconcile the above decisions with inspected production interfaces, define the exact internal read/filter interface and initial-source representation, verify the real host-delivery signal boundary, and identify executable tests against real code. This is a semantic approval record, not an implementation report.

## 11. Acceptance criteria for a future implementation

An implementation is not ready merely because records can be stored. Tests must establish that:
- an event can be canonical without every actor knowing it;
- prompt inclusion/retrieval does not create acquisition or delivery;
- one actor can hold a false belief while canonical truth remains distinct;
- a delivered false report can be acquired as a report without becoming canonical truth;
- a failed or unconfirmed delivery does not mark the target as informed;
- a source invalidation preserves independent valid acquisition paths;
- rollback does not erase unrelated knowledge or blindly preserve knowledge whose only source was invalidated;
- inaccessible and author-reserved secrets are excluded before model input;
- missing acquisition/access evidence is returned as unknown/incomplete or unsupported, not silently accepted;
- proposal creation alone does not mutate world state or knowledge state.

These criteria are design targets. They are not test results and do not claim that the current runtime passes them.

## 12. Evidence and limitations

This proposal was prepared against the current inspected versions of:
- `docs/00-architecture-baseline.md`
- `docs/06-npc-autonomy-and-process-manager.md`
- `docs/07-knowledge-and-narrative-boundaries.md`
- `src/application/engine.js`
- `src/application/proposals.js`
- the existing NPC contract and readiness/audit documents on `feat/npc-subsystem`.

The inspected `engine.js` exposes canonical event preparation/commit/rollback and context-manifest registration; the inspected `ProposalService` handles proposal lifecycle. Neither inspection establishes a complete persistent actor-specific knowledge/acquisition API. No tests were run for this documentation change, and no runtime/API/schema/storage behavior was changed.


## 13. Candidate internal read/filter contract for core review

This is a deliberately narrow design candidate responding to the core owner's open item 6. It is not an API specification and must be reconciled with the actual entity/fact read interfaces before implementation.

### 13.1 Request intent

A trusted internal caller requests a decision-time context for:
- one existing world;
- one actor identified by an existing canonical `entity_id` (only if the current world model can represent that actor as an entity);
- one declared purpose, such as an NPC decision;
- one consistent snapshot identified by the existing `(world_revision, commit_sequence)` pair;
- an optional bounded set of proposition/source references, where the current core can validate them.

The request must not accept a model-supplied assertion that the actor is authorized, knows a proposition, or has received a message. Caller trust and actor identity are separate: adapter identity authenticates the integration caller; it does not automatically establish the in-world actor.

If the existing code cannot resolve the actor, purpose, snapshot, or initial-knowledge source under a real production contract, the operation must return an explicit unsupported/unknown result or fail closed. It must not fall back to dumping the world state.

### 13.2 Result semantics

The result should keep separate, where supported:
- snapshot identity and actor identity actually resolved;
- canonical propositions/references that are valid at that snapshot;
- authorized author-initial/imported knowledge assigned to this actor, explicitly labeled as authored/imported initial state;
- current core-owned belief stance, if the real interface can read it;
- source/provenance references supporting each returned acquisition;
- withheld, unknown/incomplete, invalid, and unsupported portions as explicit status, never as a fabricated negative fact;
- reserved-secret exclusion and any incompleteness that affects safe decision-making.

A record being canonical does not imply it belongs in the actor's returned knowledge. A record being in the actor's initial knowledge does not imply the actor believes it. A belief result must not be fabricated when belief persistence is not available.

### 13.3 Fail-closed rules

1. Do not return arbitrary canonical world state just because a caller names an actor.
2. Do not infer authorization from adapter identity, manifest membership, retrieval, prompt inclusion, or proposal metadata.
3. Do not record acquisition as a side effect of reading/filtering context.
4. Do not report delivery, receipt, acknowledgement, comprehension, or `shown` without a supported signal.
5. Do not silently treat absent source data as false or as proof that the actor lacks the knowledge.
6. Bind the result to one consistent existing snapshot; reject or explicitly report a stale/mismatched snapshot rather than mixing revisions.
7. The first slice supports only explicitly authorized `author_initial`/imported initial knowledge. Other acquisition kinds must return unsupported until their evidence paths are implemented and tested.
8. If the real character/entity representation or initial-knowledge source contract is absent, keep this as a design proposal and do not simulate it with mocks.

### 13.4 First-slice acceptance tests

Before implementation, map each test to the real production boundary and existing test harness:
- two actors receive only their separately authorized initial knowledge;
- one actor's initial knowledge is not exposed to another actor by shared prompt/context inclusion;
- initial knowledge carries authored/imported provenance and is not mislabeled as in-world discovery;
- canonical truth, acquisition history, and belief stance remain distinct;
- reserved secrets are excluded before model input;
- unknown, withheld, and unsupported are not collapsed into false;
- a context read does not create acquisition or delivery records;
- a stale or inconsistent snapshot is rejected or explicitly surfaced;
- proposal creation remains non-mutating for canonical world and knowledge state.

These tests remain proposed until the actor representation, initial-source representation, and internal read/filter boundary exist in real code. No mocks may stand in for absent production semantics.
