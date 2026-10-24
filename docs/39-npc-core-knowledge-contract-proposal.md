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

## 14. Reconciliation against merged core primitives — 2026-10-24

This is a source-level follow-up to the merges of PR #45, PR #46, and PR #49. It narrows the remaining implementation gap; it does not authorize runtime or schema changes.

Inspected on current `main` at `8602a9ed41f13f536d87b1103a02e8fd12de3b03`:

- `LogicEngine.getSnapshot(...)` and the SQLite snapshot reader provide a bounded, transaction-consistent view of the requested canonical records, with optional mechanic evaluation inputs and same-snapshot context-manifest expansion. This solves the read-view consistency prerequisite only.
- `src/core/rules.js` now exports `evaluateConditionResult(...)` as an opt-in tri-state API. The legacy `evaluateCondition(...)` contract remains Boolean for existing callers. The tri-state helper accepts `knownAbsentPaths`; the caller must not mark a path known-absent unless trusted evidence from the same decision context establishes that absence.
- The `facts` projection contains `source_event_ids`, which records source-event support for canonical facts. That is not a record that a particular actor acquired or was authorized to know the fact.
- The inspected SQLite schema has canonical `entities`, `facts`, `events`, and `context_manifests`, but no actor-relative acquisition, belief, or delivery/receipt record/table was found in the current main source.
- `ProposalService` stores the authenticated adapter identity as `created_by_adapter_id`; its validation result explicitly says `actor_authorization` and `player_agency_policy` are not checked. An adapter identity is not the in-world NPC identity.
- The presence of `actor_ref` in a proposal schema does not by itself establish a trusted binding or authorize access; only a wired production path that validates the actor reference against a trusted caller and canonical world state could do so.

### Resulting decision

The snapshot and tri-state gates are now satisfied as core primitives on `main`, but the first NPC slice remains blocked on three linked core-owned capabilities:

1. **Trusted actor binding:** resolve the in-world actor to an existing canonical `entity_id` from a trusted caller boundary; never trust a model-supplied actor identity.
2. **Authorized initial knowledge:** represent explicitly authorized `author_initial`/imported knowledge with provenance and subject assignment, without pretending a canonical fact's source event proves actor acquisition.
3. **Actor/purpose/snapshot filter:** select only the actor's authorized initial knowledge, exclude author-reserved secrets before model input, preserve unknown/withheld/incomplete distinctions, and bind the result to the exact snapshot marker.

These must be designed against the actual core storage and trust boundaries before runtime/schema implementation. Do not create NPC-local copies of canonical truth, knowledge acquisition, actor authorization, or proposal persistence. Until these interfaces exist, the only valid NPC work is contract/source reconciliation and tests that target existing production behavior rather than mocks of the missing capabilities.

## 15. Candidate decision-context envelope for interface review

This is a schema-neutral candidate for the next core-owner review. It makes the trust and result boundary testable without pretending that the current runtime already has the required records. It is not approval to add the API, schema, tables, or adapter behavior.

### 15.1 Request boundary

The trusted internal operation should conceptually receive:

- **World and exact snapshot:** `world_id`, `expected_world_revision`, and `expected_commit_sequence`.
- **Actor binding:** a canonical `actor_entity_id` resolved by a trusted host/core boundary. The model may request an action for an actor, but its supplied string is not accepted as proof of actor identity or authority.
- **Purpose:** a declared, bounded purpose such as `npc_decision`. The caller's authenticated adapter identity is established out of band and remains distinct from the in-world actor.
- **Allowed source scope:** only core-recognized, explicitly authorized `author_initial`/imported knowledge records assigned to this actor. A request cannot add arbitrary fact IDs to its own allowlist.
- **Decision scope:** the supported action/purpose boundary and any required source references. Unsupported requested capabilities must not trigger a broader world-state read.

If actor binding, authorization, source representation, or exact snapshot validation cannot be resolved from production code, return a typed non-ready result. Never fall back to raw `getState()`, unrestricted `getSnapshot(...)`, profile text, vector hits, or model-supplied claims.

### 15.2 Result envelope

A successful result should contain only:

- an overall status of `ready`, plus the exact `world_revision` and `commit_sequence` marker;
- the actor entity actually resolved by the trusted boundary and the declared purpose;
- bounded decision items whose canonical proposition/source references and initial-acquisition provenance are independently represented;
- per-item epistemic status sufficient to distinguish authorized initial acquisition from unknown, withheld, incomplete, invalid, or unsupported information;
- explicit completeness diagnostics that do not reveal the content of a withheld secret;
- an explicit statement that belief state is unavailable unless the core can read a real core-owned belief record. The operation must not infer belief from acquisition.

Non-ready outcomes should distinguish at least `invalid_actor`, `stale_snapshot`, `withheld`, `incomplete`, and `unsupported`. A caller may combine multiple blockers into one safe non-ready result, but it must not silently downgrade the result to `ready` or expose restricted details in diagnostics.

The envelope is a read result only. It must not create acquisition, belief, delivery, events, revisions, or proposals as a side effect. Proposal creation remains a separate non-committing operation after context admission and deterministic/tri-state checks.

### 15.3 Required security invariants

1. Adapter authentication proves which integration caller made the request; it does not prove which NPC is acting.
2. Actor identity must resolve to an existing canonical entity in the requested world; display name, card title, and model output are not identity proofs.
3. Authorization is evaluated before restricted values are serialized into any model-bound envelope. A post-generation check is too late.
4. `knownAbsentPaths` is derived only from the same trusted, complete snapshot/filter result; it is never inferred from an omitted, withheld, or unimplemented field.
5. Canonical fact provenance (`source_event_ids`) does not prove actor acquisition. An explicit initial-acquisition record must carry actor assignment, acquisition kind, source/provenance, and validity.
6. The exact snapshot marker must cover every returned canonical source and the actor's authorized initial-knowledge records; mixed markers are rejected as stale/inconsistent.
7. A read, retrieval, context-manifest registration, model-input inclusion, or proposal creation cannot itself create an acquisition or delivery record.
8. The result is not sent to the model if the actor/source authorization or reserved-secret filter cannot be proven.

### 15.4 Production-path acceptance sequence

The smallest executable acceptance path should test these boundaries in order:

1. trusted adapter identity resolves actor A to canonical entity A; untrusted actor substitution is rejected;
2. a core-owned initial-knowledge source explicitly assigned to A is returned with provenance; actor B cannot receive it by requesting the same source;
3. a reserved secret is excluded before serialization and does not appear in diagnostics;
4. unknown, known-absent, withheld, incomplete, and unsupported fields remain distinguishable through the real `evaluateConditionResult(...)` caller;
5. a stale snapshot is rejected without mixing current world facts with older acquisition records;
6. the filtered context is the exact input envelope used by the NPC decision adapter;
7. proposal creation leaves canonical state, knowledge/acquisition state, belief state, delivery state, world revision, and commit sequence unchanged.

Until the core exposes the real actor binding and initial-acquisition representation, these remain design acceptance targets, not executable integration tests. The first implementation PR should begin only after the core owner reviews this interface candidate and confirms that it maps to real source/storage boundaries without duplicating canonical ownership.


## 16. Core-owner review outcome and implementation gates — 2026-10-24

**Review outcome: B — accept this candidate contract after concrete clarifications.** The core review confirms the ownership split and the actor-relative context boundary in §15 are architecturally sound. This is approval of the direction, not approval of an executable API, schema, or runtime implementation.

### 16.1 Confirmed by review

- The core remains the authority for canonical world state and any future canonical acquisition/belief records; the NPC subsystem remains a decision-making consumer.
- LogicEngine.getSnapshot(...) is an available bounded, transaction-consistent read primitive on the reviewed main commit. It is not a model-safe projection.
- evaluateConditionResult(...) is an available opt-in tri-state primitive. knownAbsentPaths must be based on trusted evidence from the same complete, authorized decision context; it is not an access-control mechanism.
- ProposalService.create(...) can stage a pending, non-committing proposal. Proposal creation changes proposal/audit records, but does not itself commit canonical world state or advance the world revision/commit sequence. It does not prove actor authorization or player-agency compliance.
- facts.source_event_ids, context manifests, profile/card text, vector retrieval, and adapter authentication are not proof that a particular NPC acquired or is authorized to know a proposition.

### 16.2 Three required core contracts

The first NPC slice remains blocked until the following are designed against actual core storage and trust boundaries and then implemented/reviewed in the core-owned workstream:

1. **Trusted actor binding.** A trusted integration boundary resolves the authenticated caller/context to a canonical actor entity_id in the requested world. Model-supplied identity, card names, and adapter identity cannot establish or override this binding. Unknown, ambiguous, cross-world, or unauthorized actors fail closed.
2. **Core-owned initial acquisition.** A minimal real representation records explicitly authorized author_initial/imported knowledge assigned to a subject, with canonical proposition/source references, provenance, and validity/reconciliation semantics. Do not invent a second event store or NPC-local knowledge database. The exact storage/event model remains a core design decision; this proposal does not preselect a table or public API.
3. **Snapshot-bound actor/purpose filter.** A core-owned internal read operation selects only the resolved actor's authorized initial knowledge for a declared bounded purpose, ties all canonical and acquisition records to the same (world_revision, commit_sequence) marker, and excludes reserved secrets before any model-bound serialization. It must distinguish unknown, withheld, incomplete, known absent, invalid, and unsupported without exposing withheld content in diagnostics. If completeness or authorization cannot be proven, the result is non-ready; there is no raw-snapshot fallback.

### 16.3 Non-ready semantics and first-slice scope

Use invalid_actor, stale_snapshot, withheld, incomplete, and unsupported as minimum non-ready categories, while preserving unknown as an epistemic condition rather than converting it into a refusal or a negative fact. Known absent is valid only within the exact trusted, complete, authorized scope that established absence.

The first vertical slice supports only explicitly authorized author_initial/imported knowledge. Observation, communication, documents, inference, rumors, persistent belief changes, delivery/receipt, relationships, schedules, and autonomous off-screen effects remain out of scope until their own real core contracts exist.

### 16.4 Proposal boundary

The NPC adapter may submit a proposal only after context admission and safe condition evaluation. Creation must remain separate from approval and commit. The proposal lifecycle may mutate proposal/audit records, but the first-slice acceptance test must prove no mutation to canonical state, acquisition/knowledge state, belief state, delivery state, world_revision, or commit_sequence. Approval/commit authorization and player-agency policy remain separate core/integration gates; ordinary effect validation is not sufficient evidence.

### 16.5 Required evidence before implementation

Before the first NPC runtime PR, the core workstream must identify actual source paths and stable internal interfaces for all three contracts above, then add production-path tests for:

- actor A/B separation and rejection of actor substitution, unknown entities, and cross-world entities;
- subject-assigned author_initial/imported records with provenance and validity;
- proof that canonical facts, retrieval, manifests, and prompt inclusion do not create acquisition;
- reserved-secret exclusion before serialization and safe diagnostics;
- distinct unknown / known-absent / withheld / incomplete / unsupported outcomes;
- exact snapshot matching and stale/mixed snapshot rejection;
- use of the exact filtered envelope by the decision adapter;
- proposal creation with state-before/state-after checks and no canonical/knowledge mutation;
- approval and commit remaining on the existing validated lifecycle.

These are acceptance targets, not tests that can be satisfied by mocks of missing production interfaces. Keep runtime/API/schema/storage work in the core-owned branch or PR. The NPC branch must not implement a workaround that duplicates actor authorization, knowledge persistence, revisions, causality, rollback, or proposal lifecycle.

**Decision for §15:** accepted as a schema-neutral candidate after the clarifications in this section. It is not yet an executable interface, and the NPC runtime remains blocked.


## 17. Multi-step source invalidation and later acquisition test dependency

The cross-cutting causal acceptance matrix is in `docs/47-npc-causal-rollback-reconciliation-test-matrix.md`, especially NPC-CAUSE-004 and NPC-CAUSE-007. For knowledge reconciliation, the critical sequence is not only “invalidate one of two sources”: it is also “complete rollback/reconciliation, then commit a new source, then reconcile again.” Tests must prove that the later source is evaluated against a fresh canonical marker, does not revive the invalid source, is idempotent under retry, and does not automatically restore downstream effects whose own dependencies remain invalid.

This remains a test requirement, not an assertion that source reconciliation or persistent belief updates already exist. The core-owned acquisition/provenance and actor/purpose filter contracts remain prerequisites; the NPC branch must not implement substitute causal or knowledge persistence.


## 18. Delivery/acquisition production-path matrix

`docs/48-npc-delivery-acquisition-boundary-matrix.md` expands the existing delivery and acquisition requirements into NPC-DELIV-001–010 with explicit evidence thresholds and test sequences. It is intentionally stricter than a generic “message sent” flag: context inclusion is not delivery; host acceptance is not proof of visible rendering; visibility is not comprehension; acknowledgement is not belief; and a received report is not canonical truth.

The matrix also requires target isolation, idempotent retry, and a separate source-invalidation sequence. These requirements refine this proposal but do not create new author decisions or assert runtime support. The core-owned delivery/acquisition records, real host signals, trusted actor binding, and pre-model filter remain implementation gates.


## 17. Live Core source reconciliation — 2026-10-24

The source-level capability audit is maintained in `docs/49-npc-core-knowledge-live-audit.md` against Core `main` at `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`.

The earlier statement in §10 that the actor-specific read/query boundary needs design remains accurate. One prerequisite has changed: trusted adapter-to-canonical-actor binding is now implemented on current Core `main` in `src/application/actor-bindings.js`, with routes in `src/api/server.js` and tests in `tests/actor-binding.test.js`. This closes the source-level identity-binding gap, but **does not** provide an actor-relative knowledge read, acquisition records, access filtering, or reserved-secret exclusion.

The Core implementation plan `docs/43-core-npc-knowledge-runtime-implementation-plan.md` specifies the next sequence: Core-owned initial acquisition/provenance, then a snapshot-bound safe filter, then a thin NPC adapter. NPC work must not implement those Core-owned services locally or infer readiness from adjacent primitives. This is a documentation reconciliation, not approval to change Core runtime, API, schema, or storage.


## 18. Initial-acquisition contract decomposition

The first-slice acquisition semantics are now decomposed into a dedicated review specification: `docs/50-npc-initial-knowledge-acquisition-contract.md`.

That document narrows the supported acquisition kinds to `author_initial` and `imported`; defines subject assignment, authorization, provenance, validity, snapshot/status semantics, source reconciliation, and production-boundary acceptance tests; and explicitly leaves physical storage, migration, event/effect representation, API shape, and secret-authoring mechanics as Core implementation decisions. It does not authorize Core changes from this branch.

The relationship subsystem may use the resulting actor-relative knowledge boundary as a dependency, but must not create or own a parallel acquisition record or infer that a relationship fact, canonical fact, prompt inclusion, or context manifest means an NPC knows something.

Current status remains **blocked pending Core implementation and real-boundary tests**. This specification is documentation and does not establish runtime readiness.


## 19. Source and relationship reconciliation

`docs/51-npc-acquisition-source-reconciliation.md` cross-checks the initial-acquisition proposal against current Core source/causality contracts and the parallel relationship proposals. It records which primitives are reusable, why they do not constitute acquisition, and the remaining Core-owner decisions on author/import assignment, replay, alternative support, restrictions, and result completeness.

The same actor/purpose/snapshot access boundary must govern relationship context. A canonical relationship transition, relationship summary, or card projection does not itself prove that a subject acquired or believes the information. Relationship semantics can proceed in parallel, but runtime integration remains dependent on the Core-owned safe read and the relationship-specific canonical operation.

## 20. Memory↔NPC consumption contract and failure matrix

The focused follow-up `docs/52-npc-memory-consumption-contract-and-failure-matrix.md` resolves NPC-side candidate eligibility, access/freshness/lineage fail-closed behavior, the retrieval-to-knowledge lifecycle, orthogonal lifecycle dimensions, negative-case semantics, transition ownership, and the contract test plan requested by Issue #70.

This is a documentation-only companion. It does not supersede the Core-owned implementation gates in §§16–19, approve a Memory API, or establish runtime support. In particular, general authorized reads, source-lineage permission propagation, durable rollback/reconciliation signals, semantic persistence/transaction boundaries, and verified host delivery evidence remain owner-approved prerequisites. Proposed candidate fields and idempotency-key ingredients are not current API contracts.

