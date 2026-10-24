# NPC Initial Knowledge Acquisition Contract — Core Review Specification

Status: NPC-side semantic specification, documentation only, 2026-10-24. Target branch: `feat/npc-subsystem`. This document does not authorize changes to Core runtime, API, storage/schema, migrations, prompts, vectorization, or `main`.

Related:
- `docs/39-npc-core-knowledge-contract-proposal.md` — overarching knowledge/delivery semantics and owner decisions.
- `docs/43-npc-relationship-core-integration-decision.md` — relationship-state boundary; relationships may later use knowledge constraints but must not duplicate acquisition ownership.
- `docs/49-npc-core-knowledge-live-audit.md` — observed current Core capabilities and blockers.
- Core `main` plan: `docs/43-core-npc-knowledge-runtime-implementation-plan.md`.

## 1. Purpose and scope

Specify the smallest meaning of an initial-knowledge acquisition record so the Core owner can implement it without the NPC subsystem inventing storage, identifiers, or lifecycle semantics.

The first executable slice supports exactly two acquisition kinds:
- `author_initial`: information explicitly authorized by the world author as part of a subject's initial knowledge at a defined starting boundary;
- `imported`: information imported from an identified source/package under an explicit rule that assigns it to a subject as initial knowledge.

These kinds describe how knowledge enters the simulation. They do **not** mean that the subject discovered the information in-world, observed an event, received a message, read a document during play, believes the proposition, or that the proposition is objectively true.

Observation, communication, documents, inference, rumors, delivery/receipt, comprehension, and persistent belief remain outside this first slice. If a caller asks for one of those unsupported kinds, Core must return an explicit unsupported/non-ready result; it must not silently reinterpret it as initial knowledge.

## 2. Ownership and coordination boundary

Core remains the sole authority for:
- canonical propositions and world state;
- actor identity resolution and authorization;
- acquisition records and their provenance/validity;
- snapshot-consistent knowledge reads and restricted-value filtering;
- source invalidation and causal reconciliation;
- any future belief and delivery records.

The NPC subsystem may specify semantics, provide scenario-based acceptance cases, and later consume a safe Core-produced envelope. It must not maintain a second acquisition table, source graph, revision cursor, access-control policy, or rollback path.

The relationship subsystem being developed in parallel may declare that a relationship fact is relevant to a character's decision, but that does not authorize it to create or own acquisition records. Relationship state, canonical truth, a subject's acquisition history, current belief, and information serialized into a prompt remain distinct.

## 3. Semantic record requirements (not a storage schema)

Each accepted acquisition must be semantically reconstructable with the following information. The physical representation may reuse existing structures or require a separately reviewed Core change; this document does not choose tables, JSON layout, API methods, or public endpoints.

| Required semantic field | Meaning / invariant |
|---|---|
| World scope | The existing canonical `world_id`; no cross-world acquisition. |
| Subject | Existing canonical actor/entity identity resolved by trusted Core rules. A display name, card, model-provided ID, or adapter ID alone is not sufficient. |
| Acquired item | A canonical proposition/fact reference, or a Core-recognized source reference whose meaning can be resolved at the requested snapshot. Do not invent an NPC-local identifier format. |
| Acquisition kind | Exactly `author_initial` or `imported` in this slice. |
| Authorization basis | The explicit author/import rule that permits assigning this information to this subject. Being present in world state or a context manifest is not sufficient. |
| Provenance | A stable reference to the authoring/import source and, where available, existing canonical event/source IDs. Provenance must not be fabricated when unavailable. |
| Validity | Whether the acquisition is currently usable, invalidated, or unresolved under Core's reconciliation rules. Exact enum/storage representation is a Core decision. |
| Initial boundary | The declared world-start/import boundary at which the information is assigned. Use existing time/revision concepts where meaningful; do not add a parallel revision counter. |
| Restrictions | Any existing Core-recognized reservation/classification needed to prevent a restricted item from reaching a model. If the Core cannot enforce the restriction before serialization, the item is not safe to return. |

Fields such as belief stance, confidence, trust, suspicion, emotional response, memory strength, delivery status, comprehension, and in-world observation time are **not** part of this first-slice acquisition record. Do not add them as convenient placeholders.

A source reference that cannot be represented or validated through an existing Core contract is a blocker to implementation for that source type, not permission to invent a local reference system.

## 4. Meaning of `author_initial` and `imported`

### 4.1 `author_initial`

Accept only when an explicit trusted authoring/configuration boundary assigns a specific item to a specific subject for the initial state of a specific world.

Required meaning:
- the assignment is intentional and subject-specific;
- the source can be audited;
- the acquisition is labeled as author-provided initial knowledge;
- it is not represented as an in-world event;
- it does not automatically assert that the canonical proposition is true;
- it does not imply that the subject believes, trusts, remembers indefinitely, or understands it.

An author-reserved secret is not made safe merely because it appears in an initial-knowledge source. The access/reservation policy must still allow this subject and purpose to receive it. Otherwise it is withheld and must be omitted from the model-bound payload.

### 4.2 `imported`

Accept only when the import path identifies the imported source/package and a trusted rule maps its content to the subject and world. The import's provenance must survive normalization/replay/reconciliation to the extent supported by Core.

A general world-pack import or a fact imported into canonical world state does **not** by itself mean every actor knows it. The import must explicitly make the subject assignment. If the existing import contract cannot express that assignment, this path remains unsupported until Core defines it.

### 4.3 No implicit acquisition

None of the following creates acquisition by itself:
- creating or updating a canonical entity or fact;
- a fact's `source_event_ids` or any other world-truth provenance;
- a context manifest or generation reference;
- a search/vector retrieval hit;
- text included in a prompt or model context;
- an NPC generated statement that it knows, saw, heard, or remembers something;
- a relationship edge/state, a proposal, or an uncommitted event;
- a successful model response or an adapter injection without a supported host signal.

Reading/filtering the knowledge context is read-only and must not create or update acquisition records.

## 5. Assignment, isolation, and authorization

1. Subject assignment is explicit. No global/world fact is copied to every actor by default.
2. A trusted adapter-to-actor binding authenticates the in-world actor only when Core resolves it through the actual trusted boundary. It does not grant access to every item assigned to that actor and does not grant approval/commit authority.
3. A model-supplied actor ID, character name, alias, card title, prompt instruction, or request-provided allowlist cannot override trusted identity or authorization.
4. An acquisition assigned to actor A must not appear in actor B's result unless a separate explicit Core-supported acquisition/authorization path assigns it to B.
5. Cross-world references, missing subjects, destroyed/ineligible actors, unrecognized source kinds, unresolved provenance, and authorization ambiguity fail closed.
6. The returned envelope must be filtered before serialization to the model. Post-generation checking is too late. Restricted content must not leak through diagnostics, error details, debug context, or a raw-snapshot fallback.
7. The request's purpose is bounded and Core-validated. The NPC caller cannot widen its purpose or nominate arbitrary source IDs to self-authorize access.

## 6. Snapshot consistency and result semantics

The actor's authorized initial-acquisition records and any canonical facts used to resolve them must be read under the same consistent existing snapshot marker `(world_revision, commit_sequence)`. The contract must not combine current canonical facts with acquisition data from a different cursor.

At the query boundary, preserve these meanings:

| Result status | Meaning | Forbidden interpretation |
|---|---|---|
| `known` | A valid, authorized initial-acquisition record supports that the subject was assigned this information. | Does not mean believed or objectively true. |
| `known_absent` | Absence is established only within a complete, trusted, authorized scope at the same snapshot. | Must not be inferred from omitted, withheld, incomplete, or unsupported data. |
| `unknown` | Available evidence does not establish whether the subject has this information. | Not “false,” “does not know,” or permission to disclose. |
| `withheld` | Information is restricted or authorization to expose it is not established. | Do not disclose the value or sensitive reason in model-visible diagnostics. |
| `incomplete` | The read/filter cannot establish a complete coherent result. | Not a successful partial result unless explicitly marked non-ready and safe by Core. |
| `unsupported` | The source kind, representation, or required check is not implemented. | Must not be silently downgraded to `unknown`, `false`, or an initial acquisition. |
| `invalid` | The acquisition/source is no longer valid under the applicable Core lifecycle. | Must not be returned as active knowledge without an explicit supported historical-use rule. |

These statuses are conceptual semantics, not an approved enum or wire format. Core may choose a different internal representation only if the distinctions remain observable and tests prove no unsafe collapse.

If snapshot consistency, actor authorization, source resolution, or secret filtering cannot be proven, the overall context must be non-ready and must not be sent to the model. Never fall back to raw `getState()`, unrestricted `getSnapshot()`, character-card prose, vector results, or caller-supplied data.

## 7. Validity, source changes, and reconciliation

Initial assignment is not an eternal guarantee that the source remains usable. Core must apply its existing event/source validity and reconciliation model. The NPC subsystem must not implement this reconciliation independently.

Required semantics:
1. Every acquisition points to a source/provenance basis that can be checked by Core.
2. If a supporting source is invalidated, Core re-evaluates the affected acquisition against the existing causal/source identities.
3. An acquisition is retained as usable only if its basis remains valid under the declared rules.
4. If independent valid support exists, invalidating one path must not erase the other path.
5. If no valid support remains, mark the acquisition invalid/unsupported according to Core's agreed semantics; do not leave it active by default.
6. Preserve auditability of the change according to the existing Core policy.
7. Canonical truth changing does not automatically rewrite belief, because persistent belief is not part of this slice.
8. The first slice must not promise full causal reconciliation if the selected initial-source representation cannot participate in the existing validity/replay/rollback lifecycle. That limitation must be recorded as a blocking implementation decision.

No new NPC-local causal graph, revision counter, event log, or rollback engine may be introduced to satisfy these requirements.

## 8. Relationship to other subsystems

- **Canonical facts/events:** may provide source references, but do not prove subject acquisition.
- **Character cards/profiles:** may describe identity or author intent, but are not a secure acquisition store and must not bypass actor/purpose filtering.
- **Relationship state:** describes a relationship according to its own contract. A character can be assigned a relationship fact initially without believing it, and knowing a relationship-related proposition does not itself mutate the relationship state.
- **Belief state:** future Core-owned state; not inferred from acquisition.
- **Delivery:** future Core-owned records. Initial knowledge is not a delivery attempt; delivery is not acquisition without a supported acquisition path.
- **Context manifest / vector retrieval / prompt inclusion:** references or candidate context only; no acquisition authority.
- **Proposal lifecycle:** a proposal is not an acquisition and cannot mutate canonical or knowledge state merely by being created.

## 9. Minimum acceptance matrix for the first production slice

These are required tests, not claims that tests currently exist or pass. Each must eventually run against the real Core service and the exact model serialization boundary.

| ID | Setup / action | Required result |
|---|---|---|
| NKA-01 Subject isolation | Assign item X to actor A only; query A and B at same snapshot. | A receives X if otherwise authorized; B does not. |
| NKA-02 No implicit world-to-knowledge copy | Create canonical fact X without assigning acquisition. | No actor is reported as knowing X solely because X is canonical. |
| NKA-03 Explicit author assignment | Assign X using `author_initial` to A. | Returned item retains kind, subject, source/provenance and validity. |
| NKA-04 Explicit import assignment | Import source S and explicitly assign X to A. | Source/package provenance is retained; generic import without assignment does not grant knowledge. |
| NKA-05 Trusted actor | Attempt to replace A with a model-supplied B or untrusted alias. | Trusted resolution wins or request fails closed; no cross-actor disclosure. |
| NKA-06 Reserved secret | Mark X restricted for the requested actor/purpose and inspect exact serialized input plus diagnostics. | X's value is absent everywhere model-accessible; result is safely withheld/non-ready as appropriate. |
| NKA-07 Status fidelity | Exercise unknown, known-absent, withheld, incomplete, unsupported and invalid cases. | Distinctions survive the actual query/adapter boundary; none becomes a negative canonical fact. |
| NKA-08 Snapshot consistency | Change canonical state between cursor acquisition and query, or supply stale/mixed cursor. | Read is rejected/non-ready; no mixed-revision envelope. |
| NKA-09 Source invalidation | Give X two independent valid supports; invalidate one, then both. | First invalidation preserves remaining support; second removes active status. |
| NKA-10 Read is pure | Query/filter context repeatedly. | No acquisition, delivery, belief, canonical event, world revision or commit sequence is created/changed by the read. |
| NKA-11 Proposal non-mutation | Create a pending proposal after reading context. | Proposal/audit may change; canonical state and acquisition state do not. |
| NKA-12 Unsupported path | Request observation, communication, document, inference or rumor before evidence path exists. | Explicit `unsupported`; no conversion to initial knowledge. |
| NKA-13 No secret-bearing error | Trigger actor/source/scope denial. | Error and diagnostics do not reveal the withheld value or sensitive classification details. |
| NKA-14 Replay/restart | Rebuild/reload world using the supported Core lifecycle. | Acquisition remains reconstructable with same subject, source, kind and validity, or implementation is explicitly blocked pending a replay contract. |

A test using only a mock acquisition repository does not prove that Core owns the records, that source validity is reconciled, or that secrets are removed from actual model input.

## 10. Decisions that remain Core implementation choices

This specification intentionally does **not** decide:
- physical storage/table or event/effect representation;
- whether author-initial assignment is represented through a seed/import contract, a dedicated Core-owned record, or a reviewed minimal extension;
- exact method names, request/response JSON, endpoint shape, error-code strings, or public API exposure;
- the canonical representation of a proposition if existing `fact_id` is insufficient;
- migration, replay, and rollback implementation details;
- how a restricted/secret marker is authored and inherited, provided it is enforced before serialization;
- how to map source invalidation to acquisition validity if existing causal identities cannot express it.

Core must inspect actual seed/import, fact, entity, event, causal, and snapshot contracts before selecting an implementation. Prefer reuse only where semantics match; do not overload `fact.set` or context manifests to mean acquisition. If no current representation satisfies a requirement, document the smallest Core-owned extension and its migration/replay/rollback tests before coding it.

## 11. Readiness gate and handoff

The NPC first slice remains **blocked** until all of the following are true:
- a Core-owned initial-source representation is approved and implemented for `author_initial` and `imported`;
- subject assignment and trusted actor resolution are enforced by production code;
- source/provenance and validity can be reconstructed under the Core lifecycle;
- an actor + purpose + exact-snapshot read/filter returns a safe envelope;
- restricted values are absent from the exact serialized model input and diagnostics;
- the status distinctions above are preserved;
- production-boundary acceptance tests NKA-01 through NKA-14 are implemented or any deliberately deferred case is explicitly justified by the Core owner;
- the thin NPC adapter consumes only the safe envelope and cannot fall back to raw world state.

Until then, NPC work remains contract, audit, and test-boundary documentation. This is not a request to start Core implementation from the NPC branch and does not authorize a PR, merge, rebase, or changes outside `feat/npc-subsystem`.
