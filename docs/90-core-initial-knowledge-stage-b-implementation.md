# Core Initial Knowledge Acquisition — Stage B Implementation Report

Status: implementation candidate in draft PR #641; Memory → NPC remains DISABLED / FAIL-CLOSED.

## Scope delivered

The narrow Stage B operation records an explicit initial assignment of a canonical fact to one existing subject in one world. Supported kinds are exactly `author_initial` and `imported`. The assignment is not an in-world observation, communication, document read, inference, rumor, belief, comprehension, or proof that the fact is objectively true.

## Implementation

- `src/core/rules.js`: adds the closed `knowledge.acquire` effect shape and rejects it from generic event/proposal paths unless a trusted Core caller explicitly enables the validation option.
- `src/application/engine.js`: adds `assignInitialKnowledge`, validates the subject/fact in a same-world snapshot, binds the operation to the snapshot revision and commit sequence, and records source/subject reads.
- `src/storage/sqlite-store.js`: validates that the subject is still eligible and the source fact exists in the same world; rejects duplicate active assignments; records the effect in the existing `world_events` journal rather than creating a parallel knowledge table.
- `src/api/server.js`: adds `POST /v1/worlds/:worldId/initial-knowledge`, gated by the separate administrative credential. The ordinary bearer token alone cannot assign knowledge.
- `tests/initial-knowledge-acquisition.test.js`: covers authorization, both kinds, provenance fields, idempotent replay, duplicate rejection, generic-path forgery, unknown subject, cross-world source, malformed digest, source rollback, and assignment rollback.

## Provenance semantics and limit

`source_ref` and UTF-8 `source_content` are supplied under the separately authenticated administrative trust boundary. Core computes `source_sha256` from the supplied bytes; if the caller also supplies a digest, Core verifies that it matches and rejects mismatches. Raw source content is not persisted in the acquisition effect. Core does **not** independently fetch arbitrary external packages or prove that the supplied bytes genuinely came from the path named by `source_ref`; the administrator is the trust root for that source attribution. An external importer that needs stronger origin guarantees must later bind its actual package identity to a trusted import adapter before making assignments.

The Core-generated `authority: "admin_credential"` field is not accepted as a user-selected field by the route; the Core operation sets it. Generic event and proposal paths cannot use it to mint acquisitions.

## Lifecycle

The acquisition is part of the existing canonical event journal and references both the subject entity and source fact. The regression test confirms that rolling back the source event invalidates the dependent acquisition under the existing Core lifecycle, and rolling back the assignment leaves historical event/audit material rather than deleting history. No new schema migration, parallel event log, revision counter, permission engine, belief store, or rollback implementation was added.

## Explicitly out of scope

- Actor-relative knowledge reads and model-safe context projection (Stage C).
- Persistent beliefs, confidence scores, belief revision, delivery, acknowledgement, comprehension, and NPC autonomy.
- Automatic import discovery or external source fetching.
- Memory Provider or Host integration and production dispatch.

Memory → NPC remains **DISABLED / FAIL-CLOSED**. This PR does not authorize a consumer, prompt injection, or production delivery.

## Traceability

- Stage B requirements: [Issue #634](https://github.com/necromorphic/Logic-Engine/issues/634).
- Semantic acquisition contract: `docs/50-npc-initial-knowledge-acquisition-contract.md`.
- Source/cross-subsystem reconciliation: `docs/51-npc-acquisition-source-reconciliation.md`.
- Core implementation sequence: `docs/43-core-npc-knowledge-runtime-implementation-plan.md`.
- Related epistemic model: [PR #635](https://github.com/necromorphic/Logic-Engine/pull/635), `docs/89-npc-epistemic-model-stage-1-proposal.md`.

## Test evidence

The final status must be updated only from CI for the exact final PR head. Do not infer success from test-file existence or from an earlier commit.
