# NPC Acquisition Contract — Source and Cross-Subsystem Reconciliation

Status: documentation-only reconciliation on `feat/npc-subsystem`, 2026-10-24. Audited against Core `main` at `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672` and the NPC relationship proposals on this branch. This is not runtime approval and does not change Core, API, storage, schema, `main`, or PR state.

Related:
- `docs/50-npc-initial-knowledge-acquisition-contract.md` — acquisition semantics and NKA acceptance matrix.
- `docs/49-npc-core-knowledge-live-audit.md` — observed Core implementation and missing capabilities.
- `docs/39-npc-core-knowledge-contract-proposal.md` — overarching knowledge boundary.
- `docs/21-stage1-causality-contract.md` on Core `main` — current, bounded causality semantics.
- `docs/42-npc-relationship-state-contract-proposal.md` and `docs/45-npc-relationship-typed-operation-design.md` — relationship semantics and proposed typed operation.
- `docs/43-core-npc-knowledge-runtime-implementation-plan.md` on Core `main` — implementation sequencing proposal.

## 1. Executive conclusion

The first acquisition slice is semantically specified, but the existing Core primitives do not yet provide the actual acquisition source or actor-relative safe read. Existing canonical facts, event provenance, context manifests, actor bindings, proposal lifecycle, and partial rollback are useful dependencies only; none can be reinterpreted as a subject's acquisition record.

The most important implementation boundary is not a new NPC-local feature. It is a Core-owned mapping from an explicitly authorized initial assignment to a subject, a resolvable canonical proposition/source, and a validity basis that survives replay and can be reconciled under the existing event lifecycle. The Core owner must select a representation after inspecting seed/import and replay paths.

## 2. Source evidence crosswalk

| Existing Core capability / contract | What can be reused | What it does not establish |
|---|---|---|
| Canonical `entities`, `facts`, `fact_claims`, events and source event IDs | Canonical identity, world truth projection, source-event provenance where present | Subject-specific acquisition, permission to disclose, belief, or completeness of provenance |
| `fact.set` and fact projection | Canonical claims and conflict/duplicate-source behavior | “Actor A knows fact X”; do not overload a world-truth write as an acquisition |
| `context_manifests` | Generation-bound cursor and declared-read inclusion checks | Actor authorization, actual model attention, prompt equivalence unless trusted host derives it, or acquisition |
| `getSnapshot/readSnapshot` with `(world_revision, commit_sequence)` | Consistent canonical read cursor | Model-safe actor-relative projection; raw snapshots must not go to NPC model input |
| `evaluateConditionResult` | Tri-state condition evaluation and carefully established known-absence semantics | Knowledge access control, proof of query completeness, or a complete set of epistemic statuses |
| Core actor-binding service on `main` | Trusted adapter-to-canonical-actor resolution and rejection of unmapped/cross-world/destroyed actors | Permission to every knowledge item, acquisition records, or safe serialization |
| Proposal lifecycle | Pending proposal boundary, separate from direct canonical commit | Actor knowledge, player-agency validation not yet implemented, or mutation authority inferred from adapter identity |
| Current event causality and rollback | Event/source references; bounded historical projection checks and partial invalidation | Proof-complete causal graph, generic acquisition reconciliation, or independent alternative support for arbitrary acquisition records |
| Relationship contract / proposed typed relationship operation | Domain semantics and eventual canonical relationship state through Core | A knowledge record, actor-relative access, acquisition of a relationship fact, or approved runtime operation today |

Source basis: `src/application/engine.js`, `src/storage/sqlite-store.js`, `src/core/rules.js`, `src/application/actor-bindings.js`, `src/application/proposals.js`, `docs/21-stage1-causality-contract.md`, and the contracts linked above, all inspected as available on Core `main` or NPC `feat/npc-subsystem` at the audit time.

No dedicated author-initial/imported acquisition representation was identified in the inspected Core files. No current source/import contract was found that proves a subject assignment can be stored, replayed, queried, and invalidated. This is a source audit result, not proof that no relevant implementation could exist elsewhere; Core must confirm the intended seed/import entry point before implementation.

## 3. Causality: precise limits that affect the acquisition contract

The current causality contract expressly distinguishes referential validity from causal completeness. Caller-supplied `caused_by`, `depends_on`, `read_set`, and `causal_links` are validated within supported shapes, but they do not prove that every materially relevant dependency was declared.

For acquisition records, this means:

1. A source-event ID is useful provenance, but is not by itself a proof that the source caused or authorizes the subject's acquisition.
2. A `READS_SOURCE` or `REQUIRES` link can express supported dependency/precondition semantics for a canonical event. It is not automatically a durable alternative-support relation for a separate acquisition record.
3. `depends_on` entries are dependency references, not an OR-set of independent sufficient sources. Multiple entries must not be treated as “any one source keeps the acquisition alive.”
4. The rollback implementation can preserve some readers when removing one source leaves the same historical entity/fact projection, and the fact projection can retain identical surviving claims. These are bounded current behaviors, not a general acquisition-reconciliation guarantee.
5. The target contract requires independent valid support to survive invalidation of another support. That requirement is **not proven** for acquisition records and must not be advertised as implemented until a Core-owned representation and real tests demonstrate it.
6. If the selected acquisition representation cannot participate in Core's replay/validity lifecycle, source invalidation must remain a blocking decision. NPC must not add a local graph or compensate with prompt text.

## 4. Import and initial-state boundary

The first-slice contract uses `author_initial` and `imported` as semantic kinds. These labels are not a claim that the current importer, world-pack loader, or database seed path supports them.

Before choosing the implementation, Core must answer from the actual source path:

- Where is author-provided initial actor knowledge currently authored or loaded, if anywhere?
- Where is imported content normalized and validated, and can the import identify both world and subject?
- What stable source reference survives normalization and replay?
- How are authored reserved secrets represented, and at what trusted boundary is that restriction enforced?
- How does the source assignment become invalid or change when its authoring/import source is replaced?
- Can the assignment be reconstructed after restart and under rollback/replay without relying on model output or prompt text?

If these cannot be answered from an existing contract, the correct status is “unsupported pending Core design,” not a synthetic record created by NPC. A generic World Pack import that adds a fact to the world is not sufficient to assign that fact to every actor.

## 5. Relationship subsystem boundary

The parallel relationship block can proceed with semantics and acceptance scenarios without waiting for acquisition runtime, but must keep its integration assumptions explicit:

- Relationship state is a canonical domain state under the relationship contract, not a second truth store and not an acquisition store.
- A relationship transition may cite its causal source and audit provenance. That does not automatically mean either participant knows about the transition.
- A relationship summary shown to an NPC must pass the same Core-owned actor/purpose/snapshot access boundary as any other model-bound context. Trust, intimacy, fear, kinship, or a typed relationship edge is not an authorization bypass.
- A character card or relationship summary is a read-only view, not proof of acquisition and not a writable copy.
- Core now has a typed `relationship.transition` effect and rollback dependency handling in PRs #94–#96. That privileged write/replay slice is not a general acquisition source lifecycle, an actor-authorized Relationship read, or proof-complete alternative-support reconciliation. The acquisition contract must not claim those capabilities.
- If a relationship contract requires a participant with no canonical entity identity, that remains a separate unresolved participant-reference decision. It must not be solved by fabricating a canonical actor or acquisition subject.

This permits parallel work: relationship semantics and tests can progress now, while both blocks depend on Core for canonical persistence, identity, access filtering, and the real causality guarantee.

## 6. Core decisions genuinely still required

These are decisions for the Core owner; NPC documentation does not choose their implementation.

### C1. Author/import source representation
Select the existing seed/import path or approve the smallest Core-owned extension that can represent explicit subject assignment and source provenance. Do not reuse `fact.set` or `context_manifests` unless their semantics are deliberately extended and separately reviewed.

### C2. Lifecycle and replay
Define how the source assignment is loaded, versioned, replaced, audited, and reconstructed after restart. Specify how its validity is tied to existing source/event identities and rollback.

### C3. Alternative support
Define whether one acquisition can have multiple independently sufficient provenance paths and how validity is recomputed when one or more paths are invalidated. Do not use a plain dependency list as an implicit alternative-support model.

### C4. Restriction authority
Identify the trusted authoring representation and the exact pre-serialization filter that enforces subject/purpose access. The acquisition source must not be able to self-authorize disclosure by marking itself “known.”

### C5. Query result and completeness
Define how the safe read reports `known`, `known_absent`, `unknown`, `withheld`, `incomplete`, `unsupported`, and invalid source status, without leaking withheld values or treating omission as absence.

### C6. Branch integration
The actor-binding, snapshot, tri-state, and other Core changes observed on `main` are not automatically present in `feat/npc-subsystem`. When code integration is authorized, use an explicit reviewed branch integration/cherry-pick/rebase plan; do not claim the NPC branch consumes these services until source and tests show it.

## 7. Revised implementation sequence

1. **Core confirms source entry point and actor assignment semantics** (C1–C2).
2. **Core defines acquisition validity/reconciliation** against the actual causal/replay boundary (C3).
3. **Core defines secret restriction authority and safe query statuses** (C4–C5).
4. **Core implements a consistent actor/purpose/snapshot safe envelope** and tests exact serialization.
5. **NPC adapter consumes only that envelope** and proposes actions through the existing proposal lifecycle.
6. **Relationship integration composes bounded relationship context with the same safe envelope** only when both the typed relationship read and the access boundary exist.
7. Branch integration is handled separately and only with explicit authorization; no merge or PR action is implied here.

## 8. Acceptance ownership map

| Acceptance group | Owner | What proves completion |
|---|---|---|
| NKA-01–05: subject assignment, isolation, no implicit acquisition, trusted identity | Core | Real service tests against persisted/reconstructed acquisition and actor binding |
| NKA-06, NKA-13: secret exclusion | Core + trusted host adapter | Inspection of exact serialized model input and diagnostics |
| NKA-07–08: status fidelity and snapshot consistency | Core | Production-boundary tests with stale/mixed cursors and withheld/incomplete cases |
| NKA-09, NKA-14: source invalidation, alternative support, replay | Core | Real source lifecycle/replay/rollback tests; mocks are insufficient |
| NKA-10–11: read purity and proposal non-mutation | Core | Compare canonical/acquisition/belief/delivery state and revision markers before/after |
| NKA-12: unsupported evidence paths | Core + NPC adapter | Unsupported paths fail closed with no implicit acquisition |
| Relationship REL-005, REL-007–009 | Core + relationship block | Actor-filtered relationship read, pure projection, typed state and verified rollback boundary |

## 9. Readiness decision

The acquisition contract is now cross-checked against the current causality contract and the parallel relationship design. No contradiction requires changing the semantic target, but the review exposes a specific gap: the existing rollback system's bounded source/projection behavior cannot be promoted into a generic guarantee for acquisition records or relationship state.

**NPC first slice remains blocked.** The useful work that can continue in this branch is semantic contract, boundary documentation, and acceptance-test refinement. No runtime/API/schema/storage implementation, no changes to Core `main`, no PR creation/reopening, and no merge/rebase were performed or authorized.


## Core status refresh (2026-10-24)

Typed Relationship write/replay is implemented in Core for admin-authored transitions only (#94–#96). Memory/NPC acquisition records, general authorized reads, and rollback-aware source reconciliation remain blocked.

## Additional Core boundary status (2026-10-24)

Core PR #101 adds a trusted host field-policy hook but no configured visibility policy; PR #102 verifies default non-self denial. PR #103 secures public proposal commit ownership. PR #106 restricts context-manifest registration to the internal host credential but does not prove generation/context binding. PR #114 now makes the privileged operational state snapshot transaction-bound and exposes both `world_revision` and `commit_sequence`, so a trusted host can observe rollback-only revision changes. This is a freshness marker, not a source-specific invalidation feed and not an authorization policy. These are prerequisites, not acquisition records or source-reconciliation signals. The Memory/NPC source lifecycle remains blocked until a trusted source-validity observation and owner-approved reconciliation path are implemented and tested.