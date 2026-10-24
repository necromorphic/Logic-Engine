# Personality Block — Core Decision Record and Integration Gates

Status: records the Core-owner response supplied on 2026-10-24, including what is approved semantically versus what remains unimplemented or unresolved. Documentation only. It does not authorize runtime, public API, schema, storage, prompt, or UI changes.

## 1. Accepted ownership boundaries

The ownership split is approved:

- **Personality block:** semantics of character traits and relationships, origins of state, decision-use constraints, and semantic acceptance criteria.
- **Core engine:** canonical state and identity, operation authorization, event/revision/audit lifecycle, authorized reads, persistence/projection, and rollback/reconciliation.
- **NPC subsystem:** uses authorized data for autonomous decisions and owns decision orchestration, but not a parallel canonical relationship or belief store.
- **World Pack:** declares supported relationship dimensions, values, transitions, and world-specific interpretation. It does not replace universal core guarantees.
- **Character card:** a derived, read-only view over authorized canonical data.

This split has no identified ownership conflict. Relationship semantics remain outside the generic core; the core must enforce their approved contract.

## 2. Typed relationship operation: privileged first slice implemented; broader access remains blocked

The relationship state must not be implemented through generic entity attributes or repurposed `fact.set` claims. A separate typed canonical operation is required.

The approved semantic direction is:

- both participants resolve to existing canonical `entity_id` values;
- direction is preserved (A → B is not B → A);
- only explicitly supplied dimensions change; omitted keys mean unchanged;
- unset (sometimes called unknown only when no canonical value exists), explicit neutral, and clearing an established value are distinct; conflict/insufficient-support `unknown` is a separate reconciliation/read-result state;
- dimensions and supported transitions are validated;
- acceptance or rejection is atomic;
- successful changes use the canonical event, audit, and revision lifecycle;
- changing one dimension does not implicitly change trust, attraction, consent, knowledge, reciprocity, or another dimension.

**Current status (2026-10-24):** the privileged admin-gated typed `relationship.transition` operation, canonical directed projection, immutable rule-version pinning, atomic commit/audit/revision/idempotency, and first-slice rollback/rebuild are implemented and covered by `tests/relationship-transition-core.test.js` on `main`. The exact public/runtime contract is the shipped Core implementation, not a Personality-owned API. Core validates canonical participant/world scope, trusted executor, evidence/rule availability, freshness, and atomic commit; the active World Pack/domain evaluator owns allowed dimensions, values, and transition semantics. This does not authorize non-admin/NPC writes or general consumer reads.

A rejected operation must not mutate canonical projection, world revision, commit sequence, committed events, or commit audit, except for a separately documented rejection diagnostic. An accepted operation must have a replayable canonical event/effect identity and share the existing atomic commit boundary with projection, audit, and idempotency outcome.

**Remaining Core gates:** finish the first-slice causal representation and the trusted authoring/import/correction command boundary before finalizing the schema-neutral operation contract and production tests.

## 3. Causality: first-slice Core decision — replayable transitions only

**Decision and status for the first supported relationship slice:** deterministic replay of surviving valid typed relationship-transition events is implemented and tested for the privileged path. It does not cover independent alternative support, historical rule-version migration, general actor-authorized reads, or NPC/Personality consumer behavior.

The first slice is limited to state whose intended value can be reconstructed from the ordered set of accepted, valid transition events and the active World Pack's deterministic transition rules. Each accepted transition must have its own canonical event identity and trusted provenance. Rebuilding the projection must be deterministic for the same surviving history and World Pack version/configuration.

### Included in the first slice

- A typed transition that changes one or more explicitly supplied relationship dimensions for an existing directed pair.
- Partial updates where omitted dimensions remain unchanged.
- Explicit clearing only if the relationship domain's approved typed contract defines it.
- Rejection of invalid transitions without partial mutation.
- Replay and rollback of surviving valid transitions, provided the domain evaluator is deterministic and does not depend on unrecorded external state.

### Explicitly excluded from the first slice

- A relationship value whose continued validity depends on alternative evidence sources being independently sufficient.
- Inferring independent support from multiple event IDs, repeated prose, timestamps, or caller-provided labels.
- Treating `caused_by`, `depends_on`, `read_set`, or `causal_links` as an OR-support list.
- Selecting a winning relationship value when surviving evidence conflicts or is insufficient, unless the active World Pack defines an explicit deterministic rule that is part of the accepted transition contract.
- Silent history rewriting, direct projection mutation, or a relationship-owned rollback engine.

These excluded cases must be rejected, deferred, or returned as an explicit unsupported/conflict result at the appropriate boundary. They must not be guessed into a single canonical value.

### Core guarantees required before implementation is considered ready

1. Every accepted transition has a canonical event/effect identity and recorded provenance.
2. The active World Pack/domain validator owns allowed dimensions, values, and transition semantics; Core owns structural validation, world/identity scope, atomic commit, event/revision/audit/idempotency lifecycle, and deterministic replay orchestration.
3. A rejected operation leaves canonical projection, world revision, commit sequence, committed events, and commit audit unchanged, except for a separately documented rejection diagnostic.
4. Replay of the same surviving valid history under the same domain configuration yields the same relationship projection.
5. Rollback removes the effects of invalidated transitions and recomputes from surviving valid history; it does not preserve a value merely because another source ID exists.
6. `caused_by` and `depends_on` retain their existing causal/dependency meaning. They are not alternative-support lists.

This decision does **not** approve a universal alternative-cause store (Option B) or define a public API/schema. The privileged typed-write/replay first slice is implemented and has production-path tests on current `main`; those tests do not establish all guarantees listed here. Additional tests remain required for general actor-authorized reads, trusted initial/import/correction, NPC/Personality consumer behavior, historical World Pack migration, and independent-support reconciliation. If later requirements genuinely need independently sufficient evidence, that capability requires a separate typed support/reconciliation contract and tests; it is not part of this first slice.

## 4. Authorized reads remain a blocking dependency

**Current status (2026-10-24):** PR #45 (bounded consistent snapshot) and PR #46 (opt-in tri-state condition results) are merged into `main`; the snapshot/context extension was merged via PR #49. These provide bounded snapshot consistency and a tri-state condition primitive, but no complete actor-authorized/filtering read interface has been verified. Snapshot consistency and condition tri-state are not actor/purpose authorization, visibility filtering, or secret exclusion.

A consistent snapshot is useful but is not authorization. Before a relationship/personality projection is supplied to an NPC, player, model, or character-card view, Core needs a bounded read boundary that accounts for:

- a consistent world/snapshot and trusted actor binding;
- reading actor and purpose;
- access rules, visibility, and sensitivity;
- current validity and world scope;
- known value versus unset (sometimes called unknown in this narrow sense), withheld/inaccessible, and incomplete/unsupported; conflict/insufficient-support status must remain separately representable where the supported query can produce it;
- disputed/conflicted status where supported.

Raw snapshots, unrestricted entity attributes, and full event history are not authorized substitutes. A caller-supplied actor string alone does not establish authority. The current runtime has not been shown to provide a complete query-result distinction among a known value, unset, withheld, incomplete/unsupported, and (where applicable) conflict/insufficient support for such an actor-relative query. Here, `unknown` must not be used as an ambiguous catch-all for both unset and reconciliation conflict.

**Remaining Core gate:** define and implement the internal actor/purpose/snapshot-scoped read/filter boundary over a consistent snapshot, then test actor separation, secret exclusion, world scope, safe result states, and concurrent commit/rollback consistency. Until then, raw snapshot data must not be passed directly to an NPC, narrator, player, or host adapter.

## 5. Initial state, import, in-world transition, and author correction

These origins must remain distinct:

1. author-provided initial/imported state;
2. in-world relationship transition;
3. author correction of existing state.

**Current status:** generic canonical commits already record event/cause/dependency metadata, effects, audit, and idempotency within the transactional commit path; rollback preserves historical events and rebuilds the current projection from valid events. However, the runtime has not been shown to enforce a trusted author/actor authorization boundary that safely classifies the three origins.

Origin and attribution are provenance, not values the caller can freely assert. A free-form `origin` field does not grant permission. An effect may carry a validated origin reference for replay, but that reference must not itself authorize the operation. Initialization must not masquerade as an in-world event; correction must not silently rewrite past history. Direct database writes, out-of-band mutable initialization stores, and event-log bypasses are not acceptable substitutes.

**Remaining Core gate:** define the trusted command/authorization boundary and audit/provenance representation using the existing canonical commit path, then test unauthorized classification attempts, an accepted author correction, and preservation of history. Exact interface/fields remain unresolved.

## 6. Causality and rollback: implemented baseline versus missing relationship guarantees

**Implemented for the existing event/effect model and privileged Relationship first slice:** the canonical event path records `caused_by`, `depends_on`, `read_set`, causal links, and effects; the typed Relationship path commits through that lifecycle and rollback invalidates dependent transitions and rebuilds the directed projection from surviving valid events. This is not a separate NPC-memory rollback system.

**Not implemented/established:** general actor/recipient/purpose/field-authorized Relationship reads; non-admin/NPC mutation authority; trusted initial/import/author-correction operations; historical World Pack version migration/selection; and OR/alternative-support reconciliation.

The first-slice target may use deterministic replay only where it is semantically correct. If a required cause is invalidated, dependent state must be recomputed without unsupported state. If multiple sources are claimed to be independently sufficient, their sufficiency must be explicit rather than inferred from multiple IDs. If remaining support is conflicting or insufficient, use a declared domain rule or expose conflict/unknown rather than guessing.

Required tests before relationship integration is considered ready:

| Area | Required proof |
|---|---|
| Typed write / atomicity | Invalid operation causes no partial state mutation or misleading canonical success/revision/audit effects. |
| Partial update | Supplied dimensions change; omitted dimensions remain unchanged. |
| Identity and direction | Unknown participants and unsupported self-relations are rejected; A → B does not mutate B → A. |
| Value semantics | Unset (sometimes called unknown only when no canonical value exists), explicit neutral, withheld, and explicit clearing are distinguishable at the appropriate semantic/read boundary; conflict/insufficient-support is a separate reconciliation/read-result state. |
| Provenance | Initial/imported state, in-world transition, and author correction are distinguishable and audited. |
| Authorized read | The actor receives only permitted data from a consistent snapshot; withheld does not reveal canonical unset state. |
| Deterministic rebuild | Replaying surviving valid history yields the same projection where replay is the approved model. |
| Dependent rollback | If the only required basis is revoked, dependent state is recomputed. |
| Independent support | A result remains only if remaining support is actually sufficient under declared rules; otherwise the case is unsupported or unresolved. |
| Conflict/insufficiency | The system applies an explicit rule or reports a conflict/insufficient-support reconciliation result; it does not invent an outcome or conflate that result with unset. |
| Character card | The view reflects authorized canonical state and cannot mutate it independently. |

These are the full integration acceptance areas, not a claim that every area is unimplemented. The privileged admin-gated first slice already has production-path evidence for directed writes, supported validation, mixed-patch atomicity, idempotency, clear/unset/neutral replay, transaction-failure atomicity, restart/rebuild, and required-dependency rollback. General actor/NPC authority, trusted authoring/import/correction, authorized reads, safe projection, historical version migration, and independent-support behavior remain unproven or blocked.

## 7. Work sequence and gates

1. **Personality block:** continue semantic contract, stable-trait lifecycle, World Pack authoring requirements, and acceptance traceability.
2. **Core architecture:** implement the replay-only first-slice boundary as part of the typed-operation contract, and define the trusted authoring/import/correction command contract.
3. **Core architecture:** define and test the actor/purpose/snapshot-filtered read boundary against actual engine interfaces.
4. **Core architecture:** specify the typed relationship operation against existing effect conventions and prove atomicity, provenance, and replay/rollback on the real canonical path.
5. **Implementation discussion:** only after the contracts and production tests are agreed, decide runtime changes.

The privileged typed write/replay first slice is implemented and tested. Full Personality integration remains blocked on authorized reads, trusted initial/import/correction, consumer/card projection, and deferred alternative-support/historical migration requirements. This record is a contract/design boundary, not permission to invent additional runtime interfaces.

## 8. Exact remaining questions for Core

The Core response closes the ownership and high-level semantic direction. The following questions remain open; they are not requests for Core to design Personality semantics.

| Gate | Existing approved position | Exact unresolved question | Closure criterion |
|---|---|---|---|
| First-slice causal boundary | First slice is limited to deterministic replay of surviving valid typed relationship transitions; independently sufficient alternative evidence is excluded. | No open design question for the first-slice boundary; the remaining work is to encode the decision in the typed-operation contract and prove it with runtime tests. | Contract specifies the replay-only scope and excluded cases; real-path typed-write/replay/rollback tests pass. |
| Trusted write classification | Initial/imported state, in-world transition, and author correction are distinct; a caller-supplied `origin` does not grant authority. | What trusted command/actor context establishes authorization for each classification, and where is classification/audit recorded in the existing commit path? | Contract identifies trusted authority source, accepted operation classes, audit/provenance record, rejection behavior, and tests for spoofed origin plus history-preserving correction. |
| Authorized read boundary | Merged snapshot and tri-state primitives are available, but are not actor authorization or filtering; raw snapshots are not safe for actors or models. | How is the reading actor bound to trusted authority, how are purpose/world/snapshot/visibility enforced, and which explicit result states distinguish known, unset, withheld, and incomplete/unsupported? | An internal contract and implementation are verified against a consistent snapshot; tests cover actor separation, secret exclusion, world scope, non-disclosure of withheld values, and concurrent commit/rollback. |
| Typed relationship operation | A separate typed canonical operation is required; directed participants, partial patch, validation, and atomic commit are the approved semantic direction. | What exact internal typed-effect contract fits the current effect conventions once causal and trusted-write gates are closed? | Contract specifies participants/direction, patch/clear semantics, validator ownership, accepted/rejected commit effects, idempotency, event identity, and production tests without inventing a parallel API/store. |
| Alternative support | Multiple source IDs do not establish independent sufficiency; no universal alternative-support store is approved. | Can all first-slice states be reconstructed by replay, or is any proposed dimension already dependent on independently sufficient evidence? | Either explicitly defer such cases, or define a narrow typed support/reconciliation rule with World Pack semantics and Core-owned tests before accepting them. |

Until these closure criteria are met, the Personality block must not claim end-to-end runtime readiness. These are Core-owned blockers; Personality may continue its semantic acceptance and World Pack authoring work without implementing substitutes.

## 9. Related documents

- `docs/personality/01-personality-and-relationship-semantics.md` — Personality block semantic scope.
- `docs/personality/02-core-integration-review-request.md` — original request and response disposition.
- `docs/personality/04-semantic-acceptance-matrix.md` — semantic acceptance targets, not passing runtime tests.
- `docs/personality/05-world-pack-relationship-dimension-template.md` — per-dimension World Pack semantics and authoring readiness.
- `docs/personality/06-stable-trait-lifecycle.md` — stable trait versus mutable state and inference lifecycle.
- `docs/personality/07-cross-block-readiness-and-handoff.md` — cross-block readiness matrix and current snapshot/tri-state boundary.
- `docs/personality/08-semantic-traceability-and-review-workflow.md` — requirement-to-acceptance traceability and specification-versus-implementation status vocabulary.
- `docs/personality/09-per-case-acceptance-traceability.md` — per-ID semantic boundary, closure owner, and runtime evidence status.
- `docs/21-stage1-causality-contract.md` — current limited rollback/causality boundary.
- `docs/18-rollback-and-causality.md` — target rollback architecture, not proof of current runtime support.
- `docs/23-character-and-control-architecture.md` — character cards as derived views.
- NPC branch relationship contracts remain relevant as adjacent integration dependencies; they are not duplicated as canonical runtime state here.


## Current-main evidence reconciliation (2026-10-24)

Issue #77 is closed for the privileged first slice. The current `main:tests/relationship-transition-core.test.js` (blob `9cf9020c554028f89dc8d8f97d6f7422f357fba1`) contains 21 named production-path tests. Exact case mappings and test names are in `docs/personality/09-per-case-acceptance-traceability.md` and `10-issue-73-executable-evidence-audit.md`. Remaining blockers are general actor/recipient/purpose/field-authorized reads and withheld non-disclosure, non-admin/NPC mutation authority, trusted initial/import/correction, safe consumer/card projection, historical World Pack version selection/migration, and independent alternative-support semantics. Relationships owns the domain-side handoff in Issue #130. Do not treat closure of #77 as closure of these separate gates.
