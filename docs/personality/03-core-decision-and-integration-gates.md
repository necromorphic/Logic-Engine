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

## 2. Typed relationship operation: required, not implemented

The relationship state must not be implemented through generic entity attributes or repurposed `fact.set` claims. A separate typed canonical operation is required.

The approved semantic direction is:

- both participants resolve to existing canonical `entity_id` values;
- direction is preserved (A → B is not B → A);
- only explicitly supplied dimensions change; omitted keys mean unchanged;
- unknown/unset, explicit neutral, and clearing an established value are distinct;
- dimensions and supported transitions are validated;
- acceptance or rejection is atomic;
- successful changes use the canonical event, audit, and revision lifecycle;
- changing one dimension does not implicitly change trust, attraction, consent, knowledge, reciprocity, or another dimension.

**Current status:** no typed relationship effect/operation is exposed by the inspected runtime. The exact effect payload/name, public API, storage representation, and implementation are not approved. Core structural validation is responsible for participant existence, world scope, operation integrity, safe references, and atomic commit. The active World Pack/domain validator owns allowed dimension keys, types/ranges, neutral values, and domain transition rules.

A rejected operation must not mutate canonical projection, world revision, commit sequence, committed events, or commit audit, except for a separately documented rejection diagnostic. An accepted operation must have a replayable canonical event/effect identity and share the existing atomic commit boundary with projection, audit, and idempotency outcome.

**Remaining Core gates:** finish the first-slice causal representation and the trusted authoring/import/correction command boundary before finalizing the schema-neutral operation contract and production tests.

## 3. Causality: conditional Option A target, not a closed implementation choice

**Approved direction:** deterministic replay of surviving valid typed relationship transitions (Option A) is the first-stage target **only where replay is semantically sufficient** to reconstruct the intended state. This does not settle the representation for every relationship transition, and it is not proof that the current runtime already supports typed relationship replay.

Constraints:

1. Each accepted transition must have its own canonical event and recorded provenance.
2. Where the domain state is reconstructible from transitions, the current projection should be rebuilt by replaying surviving valid history in deterministic order.
3. Distinct source IDs do not automatically establish independent causes or sufficiency.
4. `caused_by` and `depends_on` represent causal/required dependencies; they are not alternative-support lists.
5. The existing rollback implementation must not be described as guaranteeing that every independent basis survives another event's rollback.

**Still unresolved for the first slice:** Core must specify whether the first supported relationship operation is restricted to replayable independent transitions or whether any supported state needs genuinely alternative evidence. The operation/schema proposal must make that boundary explicit. If replay is sufficient, use the narrowest replayable representation consistent with existing typed-effect conventions. If a conclusion depends on multiple independently sufficient sources, that case remains unsupported until a typed support representation, domain sufficiency/conflict rule, and Core-owned reducer/reconciliation behavior are defined and tested. Do not introduce a universal alternative-cause store (Option B) or a subsystem-owned causal engine.

Before implementation, source inspection and real tests must establish whether the existing event replay and rollback path can meet the conditional Option A target. If not, Core must specify the smallest necessary extension.

## 4. Authorized reads remain a blocking dependency

**Current status:** no complete actor-authorized/filtering read interface has been verified as implemented or approved. PR #45 is a proposed bounded internal snapshot primitive, open and unmerged at the reviewed head noted in the handoff; it is snapshot consistency work only.

A consistent snapshot is useful but is not authorization. Before a relationship/personality projection is supplied to an NPC, player, model, or character-card view, Core needs a bounded read boundary that accounts for:

- a consistent world/snapshot and trusted actor binding;
- reading actor and purpose;
- access rules, visibility, and sensitivity;
- current validity and world scope;
- known value versus unset/unknown, withheld/inaccessible, and incomplete/unsupported;
- disputed/conflicted status where supported.

Raw snapshots, unrestricted entity attributes, and full event history are not authorized substitutes. A caller-supplied actor string alone does not establish authority. The current runtime has not been shown to provide a complete query-result distinction among `unknown/unset`, `withheld`, and `incomplete/unsupported` for such an actor-relative query.

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

**Implemented for the existing event/effect model:** the canonical event path records `caused_by`, `depends_on`, `read_set`, causal links, and effects; rollback invalidates dependent events using recorded relationships and rebuilds projections by replaying valid events. This is not a typed relationship implementation and is not a separate NPC-memory rollback system.

**Not implemented/established:** typed relationship effects, relationship-specific rollback behavior, and OR/alternative-support reconciliation.

The first-slice target may use deterministic replay only where it is semantically correct. If a required cause is invalidated, dependent state must be recomputed without unsupported state. If multiple sources are claimed to be independently sufficient, their sufficiency must be explicit rather than inferred from multiple IDs. If remaining support is conflicting or insufficient, use a declared domain rule or expose conflict/unknown rather than guessing.

Required tests before relationship integration is considered ready:

| Area | Required proof |
|---|---|
| Typed write / atomicity | Invalid operation causes no partial state mutation or misleading canonical success/revision/audit effects. |
| Partial update | Supplied dimensions change; omitted dimensions remain unchanged. |
| Identity and direction | Unknown participants and unsupported self-relations are rejected; A → B does not mutate B → A. |
| Value semantics | Unknown/unset, explicit neutral, withheld, and explicit clearing are distinguishable at the appropriate semantic/read boundary. |
| Provenance | Initial/imported state, in-world transition, and author correction are distinguishable and audited. |
| Authorized read | The actor receives only permitted data from a consistent snapshot; withheld does not reveal canonical unset state. |
| Deterministic rebuild | Replaying surviving valid history yields the same projection where replay is the approved model. |
| Dependent rollback | If the only required basis is revoked, dependent state is recomputed. |
| Independent support | A result remains only if remaining support is actually sufficient under declared rules; otherwise the case is unsupported or unresolved. |
| Conflict/insufficiency | The system applies an explicit rule or reports conflict/unknown; it does not invent an outcome. |
| Character card | The view reflects authorized canonical state and cannot mutate it independently. |

These are required future tests, not claims that the current runtime already passes them.

## 7. Work sequence and gates

1. **Personality block:** continue semantic contract, stable-trait lifecycle, World Pack authoring requirements, and acceptance traceability.
2. **Core architecture:** finish the first-slice causal boundary and trusted authoring/import/correction command contract.
3. **Core architecture:** define and test the actor/purpose/snapshot-filtered read boundary against actual engine interfaces.
4. **Core architecture:** specify the typed relationship operation against existing effect conventions and prove atomicity, provenance, and replay/rollback on the real canonical path.
5. **Implementation discussion:** only after the contracts and production tests are agreed, decide runtime changes.

Integration remains blocked until typed write, provenance, authorized read, and the applicable replay/rollback guarantees are specified and tested. This record is a contract/design boundary, not permission to implement.

## 8. Exact remaining questions for Core

The Core response closes the ownership and high-level semantic direction. The following questions remain open; they are not requests for Core to design Personality semantics.

| Gate | Existing approved position | Exact unresolved question | Closure criterion |
|---|---|---|---|
| First-slice causal boundary | Replay surviving valid typed transitions is the target only where semantically sufficient; causal dependency is not OR-support. | Which relationship-transition cases are in the first slice, and which are explicitly unsupported because they require alternative evidence or reconciliation? | A schema-neutral contract names the supported replay model, canonical ordering/rebuild expectation, and excluded cases; real-path replay/rollback tests pass. |
| Trusted write classification | Initial/imported state, in-world transition, and author correction are distinct; a caller-supplied `origin` does not grant authority. | What trusted command/actor context establishes authorization for each classification, and where is classification/audit recorded in the existing commit path? | Contract identifies trusted authority source, accepted operation classes, audit/provenance record, rejection behavior, and tests for spoofed origin plus history-preserving correction. |
| Authorized read boundary | PR #45 is snapshot-only; raw snapshots are not safe for actors or models. | How is the reading actor bound to trusted authority, how are purpose/world/snapshot/visibility enforced, and which explicit result states distinguish known, unset, withheld, and incomplete/unsupported? | An internal contract and implementation are verified against a consistent snapshot; tests cover actor separation, secret exclusion, world scope, non-disclosure of withheld values, and concurrent commit/rollback. |
| Typed relationship operation | A separate typed canonical operation is required; directed participants, partial patch, validation, and atomic commit are the approved semantic direction. | What exact internal typed-effect contract fits the current effect conventions once causal and trusted-write gates are closed? | Contract specifies participants/direction, patch/clear semantics, validator ownership, accepted/rejected commit effects, idempotency, event identity, and production tests without inventing a parallel API/store. |
| Alternative support | Multiple source IDs do not establish independent sufficiency; no universal alternative-support store is approved. | Can all first-slice states be reconstructed by replay, or is any proposed dimension already dependent on independently sufficient evidence? | Either explicitly defer such cases, or define a narrow typed support/reconciliation rule with World Pack semantics and Core-owned tests before accepting them. |

Until these closure criteria are met, the Personality block must not claim end-to-end runtime readiness. These are Core-owned blockers; Personality may continue its semantic acceptance and World Pack authoring work without implementing substitutes.

## 9. Related documents

- `docs/personality/01-personality-and-relationship-semantics.md` — Personality block semantic scope.
- `docs/personality/02-core-integration-review-request.md` — original request and response disposition.
- `docs/personality/04-semantic-acceptance-matrix.md` — semantic acceptance targets, not passing runtime tests.
- `docs/personality/05-world-pack-relationship-dimension-template.md` — per-dimension World Pack semantics and authoring readiness.
- `docs/personality/06-stable-trait-lifecycle.md` — stable trait versus mutable state and inference lifecycle.
- `docs/personality/07-cross-block-readiness-and-handoff.md` — cross-block readiness matrix and current PR #45 boundary.
- `docs/21-stage1-causality-contract.md` — current limited rollback/causality boundary.
- `docs/18-rollback-and-causality.md` — target rollback architecture, not proof of current runtime support.
- `docs/23-character-and-control-architecture.md` — character cards as derived views.
- NPC branch relationship contracts remain relevant as adjacent integration dependencies; they are not duplicated as canonical runtime state here.
