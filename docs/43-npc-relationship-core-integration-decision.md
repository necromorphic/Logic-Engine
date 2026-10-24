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

The core owner has confirmed the semantic direction in PR #38 comment [6377468310](https://github.com/necromorphic/Logic-Engine/pull/38#issuecomment-6377468310). The following list distinguishes decisions already settled from production interfaces that remain to be specified and tested.

1. **Canonical write — direction confirmed, effect contract open.** Use a typed relationship record/effect through the canonical event/revision/audit path. Define its exact shape, dimension-level update semantics, validation, and provenance against the core effect architecture before implementation.
2. **Identity — commit rule confirmed.** Committed participants must resolve to existing canonical `entity_id` values. Unresolved authoring/import references must not auto-create entities/NPCs or form a parallel identity registry.
3. **State semantics — key distinctions confirmed, schema open.** Unknown/unset, explicit World Pack-defined neutral, and author-initial/imported origin must remain distinct. Specify universal versus World Pack-defined dimensions, value types, optionality, and invalid-transition behavior.
4. **Transitions and authorship — boundary confirmed, operation open.** Authored initial conditions/corrections need explicit provenance separate from dimension values and in-world transitions. The authorized edit/initialization operation and audit representation remain to be designed.
5. **Causality/rollback — requirement confirmed, mechanism open.** Transitions need canonical source/cause references; rollback must recompute support from remaining valid independent causes. If current core causality cannot express this, block commits until extended and tested; do not add a parallel NPC causal system.
6. **Read boundary — dependency order confirmed, authorized interface open.** Integrate a consistent snapshot first, then define the core-owned actor/purpose/snapshot filter. Raw snapshot rows are not model/player context and must not be exposed directly.
7. **Projection — behavior confirmed, input contract open.** Character cards consume a bounded, derived, read-only relationship summary; they must not write duplicate state or expose raw records/private notes. The precise internal projection input depends on the typed record and trusted read boundary.
8. **Executable tests — blocked on real interfaces.** Tests must exercise the production write/read/rollback path for asymmetry, unknown-vs-neutral, partial updates, unresolved participants, access separation, author provenance, and multi-cause rollback. Do not use mocks to simulate absent production semantics.

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


## 10. Acceptance-test dependency map

The REL scenarios in document 42 are semantic requirements, not current executable coverage. Their implementation dependencies are:

| Scenario | Required boundary | Current disposition |
|---|---|---|
| REL-001 asymmetric state | Typed directional write plus actor-specific read | Blocked on relationship record/effect and read contract |
| REL-002 unknown vs neutral | Explicit unset/unknown representation and projection rule | Blocked on state schema |
| REL-003 independent dimensions | Validated partial transition that changes only named dimensions | Blocked on transition semantics |
| REL-004 scene presence alone | NPC decision/transition policy distinguishes co-presence from supported cause | NPC semantic tests can be specified now; runtime proof awaits decision pipeline |
| REL-005 knowledge boundary | Actor-specific knowledge/access filter separate from relationship context | Blocked on knowledge/read integration; trust alone must never bypass it |
| REL-006 no automatic NPC creation | Participant-reference policy plus projector purity | Projection purity can be tested independently; unresolved references need a decision |
| REL-007 read-only summary | Bounded relationship summary input and pure card projector | Existing projector proposal is read-only but has no relationship summary input yet |
| REL-008 dependent rollback | Relationship transition committed through canonical event/effect path | Blocked on typed state operation and explicit mapping to current rollback guarantees |
| REL-009 independent support survives | Defined support/conflict/reconciliation semantics for multiple causes | Blocked; current generic rollback does not define relationship-specific support reconciliation |
| REL-010 no invented explanation | NPC generation/context contract excludes unsupported causal rationales | Can be covered as a semantic NPC output test; it is not a substitute for runtime provenance |
| REL-011 no reciprocal inference | Direction-preserving write/read and projection | Blocked on relationship state/read contract |
| REL-012 attributed author edit | Authorized authoring operation with distinct audit attribution | Blocked on authoring permission and audit-source contract |

This matrix suggests a parallelizable path: NPC can write semantic tests for REL-004 and REL-010 and refine prompt/context acceptance rules; core can independently settle typed state mutation and rollback/read guarantees; card projection can keep its current minimal contract while specifying an optional relationship-summary input. Do not mark any scenario fully passed until executable tests exercise the integrated implementation, not only isolated pure helpers or documentation examples.


## 11. Adjacent core decision already recorded: knowledge and belief

The core owner has separately reviewed the knowledge contract in the PR #38 discussion. Treat these as confirmed semantic boundaries, not implemented capabilities:

- The core owns authoritative acquisition/provenance records, delivery attempt/receipt status, and persistent subject-relative belief state. NPC must not duplicate them as a parallel source of truth.
- Keep canonical world truth, acquisition history, and current subject belief as three distinct concepts. Acquisition does not force belief; belief does not prove acquisition or objective truth.
- Prompt inclusion, vector retrieval, context manifests, or narrator mention alone do not prove acquisition or delivery. Unsupported acquisition paths must fail closed rather than be fabricated.
- Use existing identities and the composite `(world_revision, commit_sequence)` from one consistent read view; do not create another revision cursor, event log, causal graph, or rollback system.
- The first knowledge vertical slice is intended to be internal-only and narrowly limited to explicitly authorized author-initial/imported knowledge until real evidence paths exist. It remains blocked on a trusted initial-knowledge representation, actor assignment/provenance, and authoritative secret/access policy.
- PR #45 proposes the bounded consistent snapshot primitive and has a reported passing Runtime CI run in the PR discussion, but it remains open/unmerged at the inspected state. It provides raw internal data, not actor authorization, knowledge filtering, or secret exclusion.

This adjacent decision strongly constrains relationship reads: relationship state may inform a decision, but must not be treated as acquired knowledge; an actor-specific relationship context must still pass through the same trusted access boundary. Do not implement a second relationship-specific knowledge/access filter.


## 12. Core-owner response to relationship integration review

The core owner answered the five questions in [PR #38 comment 6377468310](https://github.com/necromorphic/Logic-Engine/pull/38#issuecomment-6377468310). Treat this as a confirmed semantic/integration boundary, **not** as evidence that the capability is implemented or authorization to change runtime/schema/storage.

1. **Typed relationship operation — confirmed as the design direction.** No suitable relationship-specific operation exists in the inspected primitives. Design a typed relationship record/effect through the canonical event/revision/audit path. Do not store production relationship state as arbitrary entity attributes or mutable reinterpretations of append-only `fact.set` claims. Exact schema/effect shape still requires review against canonical effect architecture.
2. **Canonical participants only.** Use existing `entity_id` for committed canonical relationship participants. Unresolved references can remain in authoring/import data but cannot be committed as canonical participants until explicitly resolved, unless a separately approved typed unresolved-reference contract is introduced. No automatic entity/NPC creation and no parallel identity registry.
3. **Snapshot is not authorization.** PR #45's consistent snapshot is a dependency, not an actor-access filter; it remains a separate, unmerged proposal at the reviewed state. Raw canonical rows must not be passed directly to NPCs or players. After snapshot integration, define and implement a core-owned actor/purpose/snapshot access boundary. Card projection stays read-only and consumes a bounded relationship summary rather than raw records, arbitrary attributes, or facts.
4. **Multi-cause rollback is a blocker.** The generic rollback contract alone cannot promise correct relationship reconciliation. Transitions need canonical event/effect and source/cause references; rollback must recompute support from remaining valid independent causes. Do not add a second NPC causal graph/log. If current causal representation cannot distinguish independent causes, keep relationship commits blocked until the contract is extended and tested.
5. **Unknown, neutral, and author-initial are distinct.** Unset/unknown must not be normalized to neutral/zero. Neutral is an explicit domain value only when defined by the World Pack. Author-initial/imported state carries explicit origin/authorship/provenance separately from the value and from in-world transitions. Unknown/withheld read results remain access/query outcomes, not false, neutral, or beliefs.

### Updated readiness gate

The relationship semantics can now be refined against these confirmed boundaries, but implementation remains blocked on all of the following:

- canonical typed relationship effect/record and transition semantics reconciled with the actual target core effect architecture;
- canonical participant resolution and rejection of unresolved references at commit time;
- integrated consistent snapshot plus trusted actor/purpose/snapshot filtering and bounded relationship projection;
- explicit source/cause representation and executable multi-cause rollback/reconciliation tests;
- preservation and tests for unknown/unset versus explicit neutral versus author-initial/imported origin.

PR #45 (snapshot) and PR #32 (character-card projection) remain separate proposals, not integrated dependencies merely because they exist. Keep this document and the relationship work documentation-only until those gates are met. No runtime/schema/storage changes were made or authorized by the core response.


## 13. Status after core decision (2026-10-24)

The main architecture chat has returned a decision covering the five integration points. Treat it as the controlling cross-block decision for this proposal. It confirms semantic requirements and boundaries, but it does **not** approve a concrete runtime schema or establish that the capabilities already exist.

### Confirmed decisions

1. **Typed canonical relationship operation:** design direction accepted. Relationship state must use a typed operation through the canonical event/revision/audit path. Do not use arbitrary entity attributes or repurpose append-only `fact.set` claims as mutable relationship state.
2. **Participant identity:** committed relationships require existing canonical `entity_id` values. Unresolved authoring/import references do not create entities and cannot be committed as participants. Self-relations are rejected unless a specific rule is explicitly approved.
3. **Relationship semantics:** direction is asymmetric; dimensions are independent; partial updates affect only named dimensions; unknown/unset differs from explicit World Pack-defined neutral; author-initial/imported state and author correction differ from in-world transitions.
4. **Causality:** independent valid causes must survive rollback to the extent that they remain sufficient. The current generic rollback contract does not prove this guarantee. If core causality cannot represent independent support, relationship commits remain blocked until the core contract is extended and tested.
5. **Read and projection:** a consistent snapshot is not authorization. A core-owned actor/purpose filter must gate model/player-visible context. Character-card relationship data is a bounded, authorized, read-only derived summary.
6. **Knowledge separation:** relationship values do not grant knowledge of secrets, motives, or private facts. Reuse the shared trusted knowledge/access boundary; do not build a relationship-specific parallel filter.
7. **Authoring provenance:** initial/imported values and author corrections require explicit origin/authorship/audit information distinct from the relationship value and from in-world causes.

### Technical details that remain open

The architecture decision does not specify or approve:

- exact typed effect/record shape, value schema, storage representation, or public API;
- exact validator and World Pack configuration boundary for dimension keys, value types, neutral values, and explicit clearing;
- how multiple independent causal supports are represented and reconciled in the existing core causal model;
- the integrated snapshot and actor/purpose authorization interface;
- the approved author-initial/import and correction operations and their audit representation;
- the bounded relationship-summary input contract for the character-card projector.

These are design dependencies, not questions that require the NPC block to invent a separate mechanism. The next step is to prepare a schema-neutral design against the core's existing effect, event, audit, read, and rollback contracts and identify any required core extension before runtime work.

### Semantic acceptance cases

The test requirements are now organized in [docs/44-npc-relationship-semantic-acceptance.md](https://github.com/necromorphic/Logic-Engine/blob/feat/npc-subsystem/docs/44-npc-relationship-semantic-acceptance.md). They cover asymmetry, independent dimensions, unknown versus neutral, author provenance, unresolved participants, rollback, authorization, projection purity, knowledge separation, and unsupported causal explanations.

All cases remain specifications, not executable coverage. Do not mark a gate passed until a test invokes the real production boundary and verifies canonical state, revision/event/audit effects, rollback behavior, and authorized output.

### Readiness decision

Semantic design and test planning may continue. Runtime relationship commits remain blocked until the typed write contract, authorized read boundary, authoring provenance, and multi-cause rollback guarantees are specified and tested. PR #45 (snapshot) and PR #32 (character-card projection) remain unmerged proposals and must not be treated as integrated dependencies.

No runtime code, API, storage schema, or `main` changes are authorized or implied by this status update.

## 14. Refreshed core-main dependency check — 2026-10-24

The current core main is `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`, three commits ahead of the merge base shared with this NPC branch. This relationship proposal was not rebased onto those commits. For the refreshed core readiness inventory, see `docs/37-npc-kernel-readiness-gate.md` §15.

The newly available core documentation sharpens—but does not remove—the relationship blocker:

- `docs/27-proposal-to-commit-boundary.md` documents a non-mutating proposal-creation preview and explicit approval/stale-snapshot checks. It does not provide typed relationship state or actor-specific authorization.
- `docs/30-stage1.3-mechanic-execution-boundary.md` describes a proposed deterministic mechanic-evaluation slice, explicitly outside NPC relationship persistence and behavior.
- `docs/31-mechanic-effect-intent-support-matrix.md` states that generic relationship operations are unsupported by the current canonical effect validator. Do not map relationship changes to generic attributes or `fact.set` as a workaround.

PR #45 remains open/unmerged and provides, at most, a candidate consistent raw snapshot read. PR #32 remains open/unmerged and its candidate card projector does not yet consume a bounded relationship summary. The relationship implementation gate therefore remains closed until the core defines and verifies the typed canonical write/effect, participant resolution, authorized actor/purpose/snapshot read boundary, bounded read-only projection input, and rollback behavior under the actual causal guarantees. This addendum is documentation-only and does not authorize runtime, API, schema, storage, or card-projection changes.


## 14. Typed-operation design proposal and core-owner resolution (2026-10-24)

The schema-neutral design proposal is documented in [docs/45-npc-relationship-typed-operation-design.md](https://github.com/necromorphic/Logic-Engine/blob/feat/npc-subsystem/docs/45-npc-relationship-typed-operation-design.md). It separates effect transitions, required causal dependencies, alternative support/evidence, and audit provenance.

The core-owner review in PR #38 comment 6377634483 resolves the previously open schema-neutral questions as follows:

- One typed relationship effect represents one directed pair and one logical transition. Its patch contains only changed dimensions; omission means unchanged, while clearing to unknown must be explicit.
- Structural safety and canonical participant checks belong to the core effect validator. Dimension vocabulary, types/ranges, explicit neutral values, and domain transition rules belong to the active World Pack/domain validator. Missing rules fail closed.
- Trusted authoring/import/correction authority cannot be represented by a caller-controlled origin string. A trusted command/authorization boundary and distinct audited operation classifications are required; that boundary is not yet present in the inspected runtime.
- The existing `caused_by`/`depends_on` mechanism is not an OR-support model. The first slice may use independently replayable typed transitions only where domain semantics make replay correct. Generic alternative-support aggregation remains unsupported until its sufficiency rule, typed representation, reducer, and reconciliation tests are explicitly defined.
- Commit, projection update, audit, idempotency result, and revision changes must share the canonical atomic boundary. Rejected transitions must not partially mutate canonical state or world-commit audit. Rollback must rebuild deterministically from surviving valid events.

This resolves the direction of the contract, not implementation readiness. The remaining gates are a verified typed-effect/projector hook on the target core branch, a trusted authoring command/audit boundary, a real actor/purpose/snapshot filter that returns distinct `known`, `unknown/unset`, `withheld`, and `incomplete/unsupported` outcomes, and executable tests against canonical commit, idempotency, audit, projection, rollback, and authorized consumer output.

PR #45 (snapshot) and PR #32 (character-card projection) remain separate, unmerged dependencies; neither provides actor authorization. Keep runtime relationship commits blocked until the required boundaries are integrated and tested. No runtime, API, schema, storage, character-card, prompt, or `main` changes are authorized by this documentation update.


## Current Core implementation status — 2026-10-24

This status supersedes earlier statements in this document that treated all typed Relationship writes/replay as unimplemented. Core PRs #94–#96 now implement and test the privileged admin-authored `relationship.transition` operation, directed projection/rebuild, immutable rule/World Pack version pinning, composite freshness, atomic event/audit/idempotency, and rollback dependency handling. The operation is not an NPC capability and does not provide a general Relationship read. PRs #101–#102 add only a trusted host policy seam with self-identity-only default; PR #103 secures public proposal commit ownership; PR #106 restricts context-manifest registration to the internal host. NPC Relationship consumption remains blocked on a configured actor/purpose visibility policy, safe card projection, and direct consumer tests for knowledge, stable traits, motive, consent, obligation, reciprocity, and player agency. See `docs/55-core-relationship-transition-runtime-slice.md` and `docs/73-core-1.5-cross-block-integration-matrix.md` for Core source/test evidence.