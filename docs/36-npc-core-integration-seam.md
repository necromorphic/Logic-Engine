# NPC/Core Integration Seam — Stage 0.2

Status: source-inspected design note on `feat/npc-subsystem`. Documentation only. This does not authorize runtime, API, schema, storage, or host-adapter changes.

## 1. Finding

The current code has a real, narrow staging path:

1. A caller prepares a context outside the NPC subsystem.
2. `POST /v1/worlds/:worldId/context-manifests` records a context manifest through `LogicEngine.registerContextManifest(...)`.
3. A configured adapter submits a candidate through `POST /v1/worlds/:worldId/proposals`.
4. `ProposalService.create(...)` validates the event payload against supported core effects and references, records a pending proposal, and leaves canonical world revision unchanged.
5. A separate approval credential is required for `POST .../proposals/:proposalId/approve`.
6. The approved proposal is committed through the existing proposal commit path; the core remains the owner of canonical event identity, revision, time, causality, and state.

This is a candidate integration seam, not a complete NPC decision boundary. Context preparation, actor-relative knowledge, and semantic authorization are not implemented by these calls.

## 2. Existing contracts, by owner

| Existing component | What it does | What it does not establish |
|---|---|---|
| `LogicEngine.registerContextManifest(worldId, body)` | Validates generation ID, base commit sequence, base world revision, and manifest item references; normalizes/deduplicates items; hashes the request and delegates persistence to the store. | Does not build the model-visible context, check whether an NPC may access a referenced item, prove knowledge acquisition, or encode known-false vs unknown/withheld. |
| `SQLiteStore.registerContextManifest(...)` | Persists manifest identity, world/generation identity, snapshot cursors, normalized items, hash, and creation time. | Persistence is not authorization or epistemic validation. |
| `ProposalService.create(worldId, body, adapterId)` | Requires a configured adapter identity; rejects unsupported/server-owned proposal fields; validates effects via the engine; captures current revision and commit sequence; stores a pending proposal and validation report. | Does not compare source text to event meaning, prove causal completeness, authorize the actor, or enforce player-agency policy. |
| `ProposalService.approve(...)` | Requires a pending proposal and rejects stale world revision/commit sequence. The HTTP route requires a separate approval credential. | Approval is not proof that the proposal is canonically true or semantically faithful; the approval operator must apply the required review policy. |
| `ProposalService.commit(...)` | Requires approved status and a still-current snapshot, then delegates the event to `LogicEngine.commitEvent(...)`. | Does not provide NPC-specific authorization by itself. |
| `LogicEngine.prepareEvent(...)` / core commit | Enforces event payload shape, supported effects, references, time limits, and core causality/revision rules. | Generic event validity is not proof that an NPC knows, can, or should perform the action. |

Relevant implementation:
- `src/application/engine.js`
- `src/application/proposals.js`
- `src/storage/sqlite-store.js`
- `src/api/server.js`

## 3. Current data flow and trust boundary

```text
Trusted caller/context preparation (not yet defined for NPCs)
        |
        | permitted context + completeness/access decisions
        v
registerContextManifest(world, snapshot cursors, referenced items)
        |
        | audit/reference manifest only
        v
NPC decision step (not implemented here)
        |
        | candidate event + source text
        v
ProposalService.create(adapter identity)
        |
        | supported-payload validation; pending proposal; no canonical commit
        v
Human/separate approval boundary
        |
        | approval only if semantic, actor, causal, and player-agency checks pass
        v
ProposalService.commit -> LogicEngine.commitEvent -> canonical state
```

The diagram intentionally labels context preparation and the NPC decision step as not yet implemented. The context manifest is a reference record, not the context itself and not a permission token.

## 4. Non-negotiable constraints for a future first slice

- Reuse the existing manifest, proposal, revision, commit, and rollback machinery. Do not create parallel cursors, proposal tables, event stores, or commit logic.
- Treat retrieved content as an untrusted candidate until a trusted caller establishes source validity, visibility/access, and actor-specific acquisition.
- Do not equate absence from a manifest with a known-false claim. The current manifest item vocabulary records references and explicit absences, not a full epistemic tri-state or actor-authorization decision.
- Keep actor belief separate from canonical fact. The current generic manifest does not supply an authoritative NPC belief state.
- Keep proposals pending/manual-review whenever semantic alignment, actor authorization, causal completeness, or player-agency checks are not proven.
- Do not allow a model-generated rationale or source text to serve as authorization evidence by itself.
- Unsupported NPC intent-to-effect mappings must be rejected or reviewed, never guessed.
- Chat/model turns do not advance world time unless an explicit supported event requests a permitted time advance.

## 5. Test boundary: what can be tested now vs later

### Existing core regression boundary

The current test suite already covers adjacent behavior, including:
- proposal creation validates supported effects and leaves canonical revision unchanged;
- pending proposals cannot commit before approval;
- approval/commit rejects stale revision or commit-sequence snapshots;
- context-manifest API registration and manifest validation;
- causal preconditions and rollback invalidation/preservation.

These tests protect existing core services. They do not demonstrate a safe NPC knowledge or decision context.

### Required tests before NPC runtime exists

Add tests only after the real preparation boundary is defined. They must exercise real functions/services rather than mocks that restate this document:

1. A retrieved but unauthorized secret never enters model-visible context.
2. Missing context remains unknown/incomplete rather than known false.
3. A supplied false NPC belief remains distinct from canonical truth.
4. A manifest reference does not itself grant access or knowledge.
5. Proposal creation is non-mutating for canonical world state and world time.
6. A failed or unknown required precondition cannot be committed.
7. Unsupported intent mappings cannot be guessed into a core effect.
8. Player agency constraints are checked before narrative/action delivery.
9. A stale snapshot cannot pass through approval/commit.
10. Rollback invalidates causal dependants but preserves independent events, under the core's documented guarantees.

### Tests not to write yet

Do not create a fake NPC runtime, fake authorization service, parallel belief store, or tests that only assert that this document contains certain words. The source audit does not yet identify a trusted actor-specific context builder or authoritative NPC knowledge/belief source.

## 6. Exit gate before implementation

Before adding runtime code, document and agree on all of the following:

- The actual trusted caller that prepares the model-visible context.
- The authoritative source of actor identity, knowledge, beliefs, and access permissions—or an explicit decision to defer those fields and fail closed.
- How context completeness and withheld/inaccessible data are represented to the decision step.
- How a context-manifest ID is bound to the exact model input and the proposal that follows.
- The explicit mapping from NPC action intents to currently supported core effects.
- Which approval checks are automatic and which remain manual.
- Executable tests at the real preparation/proposal boundary and a run under the repository's required Node version.

## 7. Decision

Proceed with documentation and source-boundary discovery only. The existing core can stage and gate generic proposals, but it does not yet provide the actor-specific trusted context required for safe autonomous NPC decisions. No runtime changes are justified until that missing boundary is identified and its semantics are agreed.

## 8. Acquisition ownership: source-evidence decision

This section answers a narrow ownership question from the currently inspected `feat/npc-subsystem` source. It records observed boundaries; it does not create a new subsystem or select unapproved kernel semantics.

### 8.1 What the existing components actually own

| Component / path | Observed responsibility | Acquisition-owner decision |
|---|---|---|
| `LogicEngine.registerContextManifest(...)` in `src/application/engine.js` | Validates generation/snapshot identifiers and typed references, normalizes them, hashes the manifest request, and delegates persistence. | **Not the acquisition owner.** A manifest records which references were associated with a generation; it does not prove an NPC witnessed, read, received, inferred, or was permitted to access them. |
| `SQLiteStore.registerContextManifest(...)` and `context_manifests` in `src/storage/sqlite-store.js` | Persists manifest identity, snapshot cursors, references, hash, and creation time. | **Not the acquisition owner.** Persistence preserves supplied metadata; it does not independently validate the actor's experience or access. |
| Canonical event path: `LogicEngine.prepareEvent/commitEvent` and `SQLiteStore` event/fact projections | Validates and commits world events/effects and builds canonical world projections; existing event history can evidence that something occurred in the world. | **Evidence source, not sufficient owner.** A canonical event can establish a world occurrence, but by itself does not establish which NPC perceived it or when a report reached them. |
| `ProposalService.create/approve/commit` in `src/application/proposals.js` | Stages a non-canonical pending proposal, checks supported payload/references and snapshot freshness, then uses separate approval and normal commit flow. | **Not the acquisition owner.** The service explicitly does not check actor authorization; proposal approval is a commit gate, not a record of how an NPC acquired information. |
| Trusted API adapter / caller | Supplies adapter identity for proposals; context-manifest registration currently accepts the manifest payload. | **Only plausible place to orchestrate acquisition checks today, but no implemented NPC acquisition contract was found.** Adapter identity is not in-world NPC identity and cannot alone prove actor-relative acquisition. |
| Mechanic/intent translation | Maps supported high-level intents to core effects within its narrow contract. | **Not the acquisition owner.** Translating an intent does not prove that the NPC's input facts were legitimately acquired. |

### 8.2 Current decision

**No existing component in the inspected source can currently be named the authoritative NPC information-acquisition owner.** The safest existing seam is a trusted caller/context-preparation boundary *before* the model input is assembled, with the existing context manifest retained as an audit/reference record and the existing proposal lifecycle retained for proposed world changes.

This is an ownership finding, not an instruction to implement a new context service. Until the core owner approves the contract, the trusted caller must not be presumed to exist, and the NPC subsystem must fail closed for acquisition-sensitive information: omit the content from model-visible context or route the case to review when source, actor-relative access, or acquisition evidence is missing.

### 8.3 Minimum duties a future owner would need to demonstrate

For each candidate item, the boundary would need to distinguish and provide evidence for:

1. **Source identity and world occurrence** — which event, document, report, observation, or claim is being considered; canonical occurrence is evidence about the world, not automatically about NPC awareness.
2. **Actor-relative acquisition transition** — who witnessed it, received the report, read the document, or made the observation, with enough provenance to distinguish pending delivery from completed delivery.
3. **Access and scope** — whether that actor could perceive or access this particular information at the relevant time; retrieval success alone is not permission.
4. **Epistemic classification** — acquired information versus rumor, inference, unverified assertion, false belief, unknown/incomplete context, or withheld/inaccessible material. Source reliability must not be silently converted into the actor's belief.
5. **Model-input exclusion** — unauthorized or not-yet-acquired secret content must be excluded before generation, not merely labelled after the model has seen it.
6. **Snapshot/generation linkage** — identify the world snapshot and generation for which the context was prepared, using existing manifest machinery where its current guarantees suffice; do not claim the manifest currently binds the exact model input unless that binding is actually implemented.
7. **Reviewable failure** — missing or contradictory acquisition evidence stays unknown/incomplete or withheld; it must not default to known-false or be repaired by model-generated rationale.

These are requirements for evaluating a future boundary, not a new data model or approved schema.

### 8.4 Status after the core-owner decision

The core owner has since answered the ownership questions above; this section is retained as a historical decision checkpoint, not as a list of unresolved ownership decisions.

Confirmed semantic ownership:
- The core owns acquisition/provenance, delivery-attempt and receipt status, source-validity reconciliation, and persistent subject-relative belief state.
- Canonical truth, acquired information, and current belief remain distinct.
- Existing world/entity/event/fact identifiers and the existing snapshot pair are reused; no parallel identity, revision, event-log, causal-graph, or rollback mechanism is introduced.
- The first supported acquisition path is explicitly authorized author-initial/imported knowledge. Other acquisition paths remain unsupported until their evidence paths are specified and tested.

Still unresolved at the implementation boundary:
- The actual trusted caller and how it is authenticated in production.
- The real actor/entity binding and representation of authorized initial knowledge.
- The exact internal actor/purpose/snapshot-scoped read/filter function and its fail-closed behavior.
- The production test boundary and verified host rendering signal.

These are now code/interface reconciliation questions, not open ownership semantics. Do not answer them by adding a second event store, knowledge store, revision counter, access-control subsystem, or new API/storage schema in this branch. Do not add executable NPC integration tests until a real production boundary exists. The acceptance matrix remains a requirements map, not proof of runtime support.


## 9. Social identity editor integration boundary

`docs/40-npc-social-identities-editor-contract.md` adds an optional authored profile capability for one underlying character to use additional social identities/covers. This is not an NPC acquisition or authorization mechanism.

- The profile/editor may store authored claims and references, but must distinguish them from verified canonical entities, documents, events, and relationships.
- A social identity links to the underlying character explicitly; it must not create another NPC or merge with an impersonated person.
- The character-card projection remains a view over authoritative/authored records, not a second writable canonical store.
- The editor cannot grant another NPC knowledge of the identity, prove that documents exist or were shown, or declare that a cover has been exposed.
- Runtime selection of an identity, observer-relative access, document checks, investigation, and exposure consequences remain unimplemented/unverified until real integration boundaries are identified.
- Any canonical document creation, registration, discovery, or exposure must use the existing approved core event/validation path. The social identity proposal adds no new event, knowledge, permission, or rollback subsystem.

No editor, API, schema, SQLite, runtime, or test implementation is authorized by this documentation addition.


## 10. Core-owner knowledge decision and next integration boundary — 2026-10-24

The core owner has confirmed the semantic ownership split recorded in `docs/39-npc-core-knowledge-contract-proposal.md`:

- The core owns authoritative acquisition/provenance, delivery-attempt/receipt status, source-validity reconciliation, and persistent subject-relative belief state.
- Canonical truth, acquisition history, and current belief are distinct. Context inclusion or retrieval does not prove acquisition, delivery, comprehension, or belief.
- The first vertical slice is limited to explicitly authorized author-initial/imported initial knowledge, marked as authored/imported rather than in-world discovery.
- Reuse existing world/entity/event/fact identifiers and the existing snapshot pair `(world_revision, commit_sequence)`; do not add parallel identity, revision, event-log, causal-graph, or rollback mechanisms.
- Host injection without a verified rendering signal remains `injected_unconfirmed`; `shown` is unsupported until an actual host signal is identified.

The remaining design task is to identify the exact internal core-owned actor/purpose/snapshot-scoped read/filter interface, how authorized initial knowledge is represented at a real production boundary, and which tests can exercise that boundary. The current context-manifest registration remains only a reference manifest; it is not this query interface. No public endpoint or runtime/schema/storage change is authorized by the semantic decision alone.
