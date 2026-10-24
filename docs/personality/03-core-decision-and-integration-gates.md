# Personality Block — Core Decision Record and Integration Gates

Status: records the architecture decision supplied on 2026-10-24. Documentation only. It does not authorize runtime, public API, schema, storage, prompt, or UI changes.

## 1. Accepted ownership boundaries

The ownership split is approved:

- **Personality block:** semantics of character traits and relationships, origins of state, decision-use constraints, and semantic acceptance criteria.
- **Core engine:** canonical state and identity, operation authorization, event/revision/audit lifecycle, authorized reads, persistence/projection, and rollback/reconciliation.
- **NPC subsystem:** uses authorized data for autonomous decisions and owns decision orchestration, but not a parallel canonical relationship or belief store.
- **World Pack:** declares supported relationship dimensions, values, transitions, and world-specific interpretation. It does not replace universal core guarantees.
- **Character card:** a derived, read-only view over authorized canonical data.

This split has no identified ownership conflict. Relationship semantics remain outside the generic core; the core must enforce their approved contract.

## 2. Typed relationship operation is required

The relationship state must not be implemented through generic entity attributes or repurposed `fact.set` claims. A separate typed canonical operation is required.

The semantic requirements are:

- both participants resolve to existing canonical `entity_id` values;
- direction is preserved (A → B is not B → A);
- only explicitly supplied dimensions change;
- omitted dimensions remain unchanged;
- unknown/unset, explicit neutral, and clearing an established value are distinct;
- dimensions and supported transitions are validated;
- acceptance or rejection is atomic;
- successful changes use the canonical event, audit, and revision lifecycle;
- changing one dimension does not implicitly change trust, attraction, consent, knowledge, reciprocity, or another dimension.

Not yet approved: exact effect payload/name, public API, storage schema, and implementation. These must be designed against the existing typed-effect conventions before code is written.

## 3. Causality decision: limited Option A first

**Decision:** use Option A — deterministic replay of surviving valid typed relationship transitions — as the first design target, but only for relationship state that can actually be reconstructed from those transitions.

Required constraints:

1. Each transition has its own canonical event and recorded provenance.
2. After rollback, the current relationship projection is rebuilt from the surviving valid history in deterministic order.
3. Distinct sources do not automatically imply independent causes.
4. `caused_by` and `depends_on` are not alternative-support lists.
5. The existing rollback implementation must not be described as guaranteeing that every independent basis survives another event's rollback.

Option A is not sufficient where a relationship conclusion is supported by multiple independent pieces of evidence and the conclusion requires a domain-specific sufficiency or conflict rule. Those cases remain a future narrow Option C extension: required dependencies stay separate from typed support/reconciliation semantics. Do not introduce a universal alternative-cause store (Option B) in the first stage.

Before any implementation, source inspection and real tests must establish whether the existing event replay and rollback path can meet the limited Option A requirement. If not, specify the smallest core-owned extension needed. The Personality or NPC subsystem must not build a parallel causal engine.

## 4. Authorized reads remain a blocking dependency

A consistent snapshot is useful but is not authorization. The current work on snapshot consistency does not by itself provide a confirmed safe interface for relationship data.

Before a relationship/personality projection is supplied to an NPC, player, model, or character-card view, the core needs a bounded read boundary that accounts for:

- world and snapshot consistency;
- reading actor and purpose;
- access rules, visibility, and sensitivity;
- current validity;
- known value versus unset/unknown versus inaccessible/withheld;
- disputed/conflicted status where supported.

Raw snapshots, unrestricted entity attributes, and full event history are not authorized substitutes. No existing interface should be declared ready until its implementation and filtering behavior are verified.

## 5. Initial state and author correction

Three origins must remain distinct:

1. author-provided initial/imported state;
2. in-world relationship transition;
3. author correction of existing state.

Origin and attribution are provenance, not values the caller can freely assert. Initialization must not masquerade as an in-world event; correction must not silently rewrite past history. Each operation must use an authorized canonical boundary and auditable lifecycle.

A ready authorization mechanism for these operations has not yet been confirmed. Do not trust an incoming `origin` field without a core-owned authorization rule. Direct SQLite writes, bypassing events, and a separate mutable initial-state store are prohibited.

## 6. Required tests before implementation can be considered ready

| Area | Required proof |
|---|---|
| Typed write / atomicity | Invalid operation is rejected without partial state changes or misleading canonical success/revision/audit effects. |
| Partial update | Supplied dimensions change; omitted dimensions remain unchanged. |
| Identity and direction | Unknown participants and unsupported self-relations are rejected; A → B does not mutate B → A. |
| Value semantics | Unknown/unset, explicit neutral, and clearing a value are distinguishable. |
| Provenance | Initial/imported state, in-world transition, and author correction are distinguishable in audit. |
| Authorized read | The actor receives only permitted data from a consistent snapshot. |
| Deterministic rebuild | Replaying surviving valid history yields the same projection. |
| Dependent rollback | If the only required basis is revoked, dependent state is recomputed. |
| Independent support | A result remains only if remaining support is actually sufficient under declared rules. |
| Conflict/insufficiency | The system reports a declared conflict/unknown or applies an explicit rule; it does not invent an outcome. |
| Character card | The view reflects canonical state and cannot mutate it independently. |

These are required future tests, not claims that the current runtime already passes them.

## 7. Work sequence and gates

1. **Personality block:** finish semantic relationship contract and acceptance criteria. This can proceed now.
2. **Core architecture:** specify the typed operation and authorized forms of initialization/import/correction.
3. **Core architecture:** define a safe actor/purpose-filtered read boundary using actual engine interfaces.
4. **Core architecture:** verify the limited replay/rollback guarantee on the existing path; if it fails, design a narrow core-owned extension.
5. **Implementation discussion:** only after the contracts are agreed, define runtime changes and production tests.

Integration remains blocked until the write, provenance, read, and rollback contracts are specified and their relevant guarantees are tested. This is a contract/design block, not permission to implement.

## 8. Related documents

- `docs/personality/01-personality-and-relationship-semantics.md` — Personality block semantic scope.
- `docs/personality/02-core-integration-review-request.md` — original review request and recorded response.
- `docs/21-stage1-causality-contract.md` — current limited rollback/causality boundary.
- `docs/18-rollback-and-causality.md` — target rollback architecture, not proof of current runtime support.
- `docs/23-character-and-control-architecture.md` — character cards as derived views.
- NPC branch relationship contracts remain relevant as a parallel semantic/integration dependency; they are not duplicated as canonical runtime state here.
