# Core-owned NPC Knowledge Boundary — Runtime Implementation Plan

Status: implementation plan for the Core workstream, 2026-10-24. This document is not an API contract and does not claim the NPC runtime is ready. It turns the reviewed NPC blockers into a bounded, testable implementation sequence.

## 1. Decision

Proceed with a narrow first vertical slice, but do not begin autonomous NPC scheduling, persistent beliefs, communication, rumors, document-reading, or off-screen processes.

The first slice must support only explicitly authorized author-initial/imported knowledge and must produce a safe, actor-specific decision context. An NPC may return a proposal through the existing proposal lifecycle; it may not commit canonical effects directly.

The implementation must remain Core-owned for identity authorization, acquisition/provenance, snapshot consistency, access filtering, and causal validity. The NPC subsystem may select a decision task and interpret the safe result, but may not create a parallel knowledge store, revision cursor, permission engine, event store, or rollback implementation.

## 2. Current executable seams (verified on main)

- `LogicEngine.getSnapshot(worldId, request)` delegates to the bounded snapshot read in the store. It is an internal state read, not an authorization-filtered model context.
- `LogicEngine.registerContextManifest(worldId, value)` stores generation/snapshot cursor metadata and referenced world items. It does not establish actor knowledge or permission.
- `evaluateConditionResult(...)` is an opt-in tri-state primitive. It is not an access-control or completeness proof.
- `ProposalService.create(worldId, body, adapterId)` requires an authenticated adapter ID and creates a pending proposal after event validation. The adapter ID is not an in-world actor identity; validation explicitly does not establish actor authorization or player-agency policy.
- `SQLiteStore` already rebuilds entity/fact projections from valid events and supports partial causal rollback. It does not currently persist actor-specific acquisition records.

Source-level audit: `src/application/engine.js`, `src/application/proposals.js`, `src/storage/sqlite-store.js`, `src/core/rules.js`, and `tests/snapshot-read.test.js`, `tests/tri-state-rules.test.js`, `tests/causality-contract.test.js`.

## 3. Implementation stages

### Stage A — Trusted actor resolution (first code PR)

1. Resolve the calling integration from server-authenticated adapter credentials only.
2. Resolve the requested in-world actor against a Core-owned binding/allowlist for that integration and world. A model-provided actor identifier is untrusted input, never proof of identity.
3. Verify the canonical entity exists in the specified world and is eligible to act. Reject unknown, destroyed, cross-world, unmapped, and unauthorized actors with stable non-sensitive error codes.
4. Do not infer actor identity from a character name, card, cover identity, prompt text, context manifest, or model output.
5. Keep approval credentials and adapter credentials separate. Actor resolution must not grant approval or commit authority.

**Decision required before implementation:** confirm whether the trusted binding is a per-adapter allowlist of canonical entity IDs or a server-side decision-task binding (adapter + task -> actor). Do not expose a client-writable binding endpoint. Any management route must use the existing separate administrative trust boundary or an explicitly approved configuration source.

### Stage B — Core-owned initial acquisition/provenance

1. Represent only the first supported acquisition kinds: `author_initial` and `imported`.
2. Preserve the difference between a canonical world fact and a character's authorized acquisition of information about that fact. A fact, event, retrieval result, manifest reference, or prompt inclusion must not create knowledge automatically.
3. Each acquisition must identify the world, actor/subject, proposition or source reference, acquisition kind, provenance, validity, and any visibility/restriction marker needed for filtering.
4. Keep source/provenance and validity reconstructable under the existing core lifecycle. Do not invent rollback guarantees for records that are not connected to the causal/reconciliation path.
5. Do not add belief/confidence/interpretation fields to this first slice. Persistent beliefs are a separate future mechanism.

**Implementation constraint:** inspect the existing seed/import and event contracts before choosing storage. Prefer an existing canonical, replayable core path where it can express the semantics without overloading ordinary `fact.set`. If that is not possible, propose the smallest explicit storage/effect extension with migration, replay, rollback, and cross-world tests. Do not silently treat arbitrary facts as actor knowledge.

### Stage C — Snapshot-bound read/filter boundary

Implement a Core-owned internal operation that takes a trusted actor resolution, a bounded purpose such as `npc_decision`, and an expected `(world_revision, commit_sequence)` cursor. It must read canonical state and acquisition/provenance under one coherent boundary.

The result must be an explicit safe envelope, not a raw snapshot. It may include only authorized initial acquisitions, their safe provenance references, the cursor, and completeness/status metadata. Reserved secrets and withheld content must be removed **before** serialization or diagnostics that can reach the model adapter.

Minimum distinctions:
- `known`: an authorized, valid initial acquisition is present;
- `unknown`: the available evidence does not establish whether the actor knows;
- `known_absent`: absence was established within the same trusted, complete, authorized scope;
- `withheld`: information exists or may exist but is not authorized for this actor/purpose;
- `incomplete`: the required read could not be completed coherently;
- `unsupported`: the requested source or check is not implemented.

These statuses are not interchangeable. In particular, `unknown`, `withheld`, `incomplete`, and `unsupported` must never be translated into a negative world fact. If actor, source, access policy, or snapshot consistency cannot be proven, return a non-ready result; never fall back to the raw snapshot.

### Stage D — Thin NPC adapter and proposal boundary

1. The NPC adapter receives only the safe envelope produced by Stage C.
2. It cannot choose or rewrite its trusted actor binding, widen the purpose, or ask for raw snapshot fallback.
3. It may return a proposed action through the existing `ProposalService`; proposal creation remains distinct from approval and commit.
4. Existing event validation is necessary but not sufficient for actor authorization, semantic alignment, causal completeness, or player-agency compliance. Where these are not implemented, preserve manual review and do not claim they passed.
5. Proposal creation may write proposal/audit records, but must not change canonical facts/entities/events, acquisition records, beliefs, delivery state, world revision, or commit sequence.

## 4. Required tests at production boundaries

### Actor binding
- actor A cannot read or act as actor B unless the trusted binding explicitly permits it;
- a model-supplied actor ID cannot override trusted resolution;
- unknown, destroyed, cross-world, and unmapped actors fail closed;
- adapter authentication does not imply approval or commit permission.

### Acquisition/provenance
- author-initial acquisition assigned to A is not visible to B;
- imported acquisition retains source/provenance and validity;
- a world fact alone does not imply actor knowledge;
- a retrieval, manifest, or prompt inclusion does not create acquisition;
- invalidating/reconciling a source cannot leave unsupported acquisition records active.

### Safe context
- reserved-secret values are absent from the exact serialized model input and safe diagnostics;
- known/unknown/known-absent/withheld/incomplete/unsupported remain distinct;
- the context cursor matches the canonical and acquisition data used; stale or mixed reads are rejected;
- incomplete authorization or provenance returns non-ready, with no raw-snapshot fallback.

### Proposal non-mutation
- compare state before/after proposal creation: canonical state/events, acquisitions, beliefs, delivery, world revision and commit sequence are unchanged;
- proposal and audit records may change;
- no commit occurs without the existing approval and freshness-checked commit path.

Tests must exercise the real production services and serialization boundary. Mocks may test isolated error handling but cannot count as evidence that a missing production filter exists.

## 5. Explicitly deferred

No persistent beliefs, confidence scores, observations, communication, documents, inference, rumors, delivery/receipt state, relationship state, schedules, autonomous off-screen execution, or NPC-aware rollback extensions in the first slice. No SillyTavern, prompt, vectorization, or character-card changes. No new public endpoint unless a separately reviewed security/API contract requires it.

## 6. Completion gate

The first NPC runtime adapter is not ready until Stages A–C exist in executable Core code, Stage D consumes the exact filtered envelope, and the production-boundary tests above pass on the resulting commit. A green general test suite alone is not sufficient.

The next Core PR should implement Stage A only after the binding source is explicitly selected; the next should implement acquisition/provenance; filtering must follow those real records rather than inventing data shapes in advance.
