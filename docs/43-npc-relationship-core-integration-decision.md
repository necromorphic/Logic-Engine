# NPC Relationship Integration Decision — Parallel-Work Boundary

Status: documentation-only architecture decision proposal on `feat/npc-subsystem`. This is not an implementation authorization and does not assume that any open PR has merged.

## 1. Purpose

Define the next safe design step for relationship state while the core, NPC subsystem, character-card projection, and mechanic integration work proceed in parallel. This document maps dependencies and recommends a narrow integration boundary without claiming that proposed interfaces already exist.

Related documents:
- `docs/42-npc-relationship-state-contract-proposal.md` — relationship semantics and acceptance scenarios.
- `docs/36-npc-core-integration-seam.md` — existing core proposal/context-manifest seam and limits.
- `docs/21-stage1-causality-contract.md` — current rollback/causality guarantees and their limits.
- `docs/39-npc-core-knowledge-contract-proposal.md` — core-owned knowledge/acquisition boundary.
- `docs/23-character-and-control-architecture.md` — character cards as views over canonical records.

## 2. Source facts at this branch snapshot

The current `feat/npc-subsystem` source snapshot has:
- generic canonical effects for entity create/update/upsert/delete, `fact.set`, and mechanic-instance lifecycle;
- canonical events, world revisions, commit sequence, audit, and a limited event-root rollback path;
- a generic fact projection that preserves multiple claims and can represent conflicting values;
- no relationship-specific effect, relationship record validator, direction/dimension schema, or relationship read/projection API found in the inspected code.

Consequently, the current core primitives do not yet guarantee relationship-specific invariants. Storing relationship data as arbitrary entity attributes or unstructured facts would not by itself enforce participant direction, dimension independence, unknown-vs-neutral semantics, authorized transitions, or safe projections.

The current causal contract validates declared references and supported predicates, but does not prove causal completeness. Rollback support for future relationship state must use the core's real event/projection mechanism; NPC must not create its own relationship event log or undo mechanism.

## 3. Parallel work that must not be mistaken for integrated capability

Open PRs inspected for this boundary:
- PR #38 — NPC contracts and relationship proposal; draft documentation work on `feat/npc-subsystem`.
- PR #45 — internal bounded canonical snapshot read; open and not merged at inspection. Its `getSnapshot` method is on a separate branch. The proposed snapshot returns raw canonical records and explicitly does not authorize actor access or produce model-safe context.
- PR #41 — proposed canonical `fact.set` identity semantics; draft, not merged.
- PR #43 — canonical fact-identity guards; draft and based on the mechanic-intent integration branch, not merged.
- PR #32 — minimal read-only character-card projector; draft on a separate branch.

Branch existence and tests in a PR do not prove that the code is present in `main` or in `feat/npc-subsystem`. Re-check the target branch and dependency order before any implementation uses these capabilities.

## 4. Candidate representations

### A. Arbitrary attributes on a generic entity

**Not recommended as the final contract.** It reuses existing storage but gives the core no relationship-specific way to validate two distinct participants, directional ownership, dimension semantics, or allowed changes. It also makes read/projection and migration behavior implicit.

It may be suitable only as a private prototype with no claim of canonical relationship semantics; do not present it as production-ready.

### B. Generic `fact.set` claims

**Not recommended as the mutable relationship-state contract without a separate decision.** The current fact model is append-only and conflict-aware: different values for one fact identity can create a conflict rather than replace current state. That is useful for claims/evidence but does not automatically provide a current multidimensional relationship record. PRs #41/#43 propose stronger fact identity guards, but neither makes `fact.set` a relationship state machine.

Fact claims may later support relationship evidence/history if the core and NPC contracts explicitly define that use; they must not be repurposed silently.

### C. Typed relationship domain record/effect through the canonical core path

**Recommended direction for design, not yet a finalized schema.** NPC defines relationship meaning and decision relevance; the core validates and commits any canonical state transition through its existing event/revision/audit/rollback path. A typed operation should make participant direction and affected dimensions explicit and reject unsupported fields/operations. The read side should return a bounded canonical projection, with character-card rendering remaining read-only.

This direction does not prescribe a table layout, JSON shape, numeric scale, universal dimensions, or endpoint. Those details require review against the core's canonical record/effect architecture and any active core branch before code is written.

## 5. Ownership boundary

| Concern | Owner | Boundary |
|---|---|---|
| Meaning of relationship dimensions, asymmetry, unknown values, interpretation for NPC decisions | NPC subsystem / World Pack configuration | No universal dimension list or forced numeric scale |
| Canonical identity, event commit, revision, provenance, audit, rollback | Core | No parallel NPC event store or revision cursor |
| Starting relationship conditions and explicit corrections | Authoring contract, validated through core-approved write path | Must distinguish authored initialization/correction from in-world change |
| Evidence that supports a change | Canonical event/source references and validated causal metadata | Prose/rationale alone is not proof; causal completeness is not currently guaranteed |
| Character-card summary | Character-card projector | Read-only derived view; not another source of truth |
| Knowledge, belief, suspicion about events/secrets | Core-owned knowledge contract when implemented; NPC consumes it | Relationship/trust does not grant knowledge |
| Setting-specific dimensions and rules | World Pack / author configuration | Cannot silently redefine universal core semantics |

## 6. Required cross-block interfaces before runtime work

Do not begin relationship runtime implementation until the following are either confirmed by the core owner or explicitly deferred with fail-closed behavior:

1. **Canonical write:** Which approved core effect/operation can create or transition a relationship record? If none exists, agree on the typed effect contract before implementation.
2. **Identity:** How are the two participants referenced, and how are unresolved past-person references handled without creating a second identity system or auto-creating NPCs?
3. **State semantics:** How are unknown/unset dimensions represented separately from neutral/zero? Are dimensions typed values, authored text, or both? Which rules are universal versus World Pack-defined?
4. **Transitions and authorship:** How are authored initial conditions, corrections, and in-world transitions distinguished and audited?
5. **Causality/rollback:** Which event/read references support reconstruction after rollback, and what happens if existing core guarantees cannot determine whether a transition remains valid?
6. **Read boundary:** Which real core read operation supplies a coherent snapshot? A raw snapshot is not an actor-authorized context and must not be exposed directly to a model.
7. **Projection:** What minimal read contract lets a card projector display a summary without writing duplicate relationship data or leaking private notes?
8. **Executable tests:** Exercise real core and NPC functions for asymmetry, unknown-vs-neutral, no reciprocal inference, conflicting/unsupported transitions, and rollback of a relationship change while preserving independent changes.

## 7. Safe parallel-work plan

- NPC work may continue on semantic scenarios, authoring expectations, decision-context needs, and the relationship projection requirements.
- Core work may continue on canonical record/effect boundaries, fact identity, snapshot reads, and rollback guarantees without waiting for the NPC implementation.
- Character-card work may define a read-only projection contract, but must not hard-code an assumed relationship storage shape from this proposal.
- Mechanic/World Pack work may describe configurable dimensions/rules, but must not assume relationship effects are already supported by the translator or core.
- Integration work should be a narrow vertical slice only after the write/read/rollback contracts above are reconciled. Do not merge or rebase parallel PRs as a substitute for architecture review.

## 8. Decision status

Provisional recommendation: design toward a typed relationship operation backed by the canonical core event path; do not encode production relationship state as arbitrary attributes or generic fact claims merely because those primitives already exist.

Open for cross-block review:
- exact typed effect/record shape and whether the core's current architecture has an existing suitable abstraction;
- representation of unresolved participants;
- dimension value types and configuration ownership;
- initial-state/author-edit permissions;
- projection contract and rollback behavior.

No runtime code or schema changed by this document. No implementation readiness is claimed.


## 9. Refined read/projection boundary after inspecting parallel PRs

The current proposals narrow the design options:

- PR #45's `getSnapshot/readSnapshot` candidate reads selected entities, facts, and events in one SQLite read transaction and returns a composite world revision/commit-sequence cursor. It explicitly returns raw internal source data and is not actor-authorized or model-safe context. It also has no relationship-specific selector or projection. If this PR is integrated, NPC may use it only behind an approved access/knowledge filter; it must not hand the raw snapshot directly to a model or player.
- PR #32's `projectCharacterCard` candidate is a pure read-only projector over a snapshot. Its current output is deliberately limited to projection version, world/entity identity, entity type/status, optional source event reference, and source revision. It intentionally omits arbitrary entity attributes, facts, event payloads, and inferred profile data. It currently does not render relationship summaries.
- Therefore the relationship summary belongs in a later explicit projector extension or a composed projection with a documented input contract. It must not be implemented by casually copying `facts` or `attributes` into the card. A projector needs a bounded, already-authorized relationship summary input; full relationship records and private notes should remain outside the card result.
- PR #41 is documentation-only and PR #43 proposes commit-time fact identity guards on a different integration branch. Neither should be treated as a relationship-specific record contract, and PR #43's dependency on mechanic-intent integration means it must be reviewed in that branch chain before any rebase/cherry-pick decision.

### Read-side dependency sequence

1. Core finalizes or explicitly defers the consistent snapshot read boundary.
2. The access/knowledge boundary defines which entities, facts, and events may enter an actor-specific context. The snapshot API alone does not decide this.
3. NPC defines the minimal relationship summary semantics and what may be exposed for a given viewer.
4. Character-card projection consumes that bounded result without storage access or mutation.
5. Tests prove that private/unknown relationship information is not exposed and that the projection does not mutate canonical state.

This is a dependency order, not a claim that the teams must stop parallel work. Core and NPC can develop their respective contracts concurrently as long as neither assumes the other's proposed interface is already integrated.
