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
