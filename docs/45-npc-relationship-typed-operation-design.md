# Relationship Core Operation — Schema-Neutral Design Proposal

Status: proposed design for review by the main architecture chat. Documentation only. This is not an approved schema, API, storage migration, or implementation authorization.

Related:
- `docs/21-stage1-causality-contract.md`
- `docs/18-rollback-and-causality.md`
- `docs/42-npc-relationship-state-contract-proposal.md`
- `docs/43-npc-relationship-core-integration-decision.md`
- `docs/44-npc-relationship-semantic-acceptance.md`

## 1. Recommendation

Introduce a typed canonical relationship operation through the existing event commit, revision, audit, and rollback lifecycle. Keep relationship meaning and domain validation in the NPC/World Pack boundary, while the core owns canonical persistence, identity checks, atomicity, provenance, and causal reconciliation.

Do not store mutable relationship state in arbitrary entity attributes or reinterpret append-only `fact.set` claims as the relationship store. Do not create an NPC-owned event log, identity registry, access filter, or rollback graph.

The operation should be designed as a domain effect that the canonical event projector can replay deterministically. Its exact effect name, payload, and storage representation remain open until reviewed against the core's preferred typed-effect conventions.

## 2. Evidence from the current core

The current implementation provides useful primitives but not a complete relationship contract:

- `src/core/rules.js` validates entity effects, `fact.set`, and mechanic-instance effects. It has no relationship-specific effect or relationship-dimension validation.
- `src/application/engine.js` prepares event requests with `caused_by`, `depends_on`, `read_set`, and typed `causal_links`, then sends them through the canonical store.
- `src/storage/sqlite-store.js` stores event effects and causal metadata, rebuilds projections by replaying valid events, and applies rollback by retracting a root plus invalidating declared dependent events.
- `docs/21-stage1-causality-contract.md` explicitly says causal completeness is not proven by the current runtime. The runtime provides partial causal rollback.
- In the current rollback traversal, an event is invalidated when a referenced `caused_by` event is invalidated. Therefore, a list of multiple `caused_by` references does not mean “any one of these independent sources is enough”; it behaves as dependency metadata, not an OR-support model.
- Existing fact claims can preserve an identical surviving claim or expose conflicting claims after source removal. This is useful precedent for source-aware rebuilding, but facts and mutable multidimensional relationships have different semantics and must not be conflated.

These facts support the design direction only. They do not establish that relationship persistence, authorization, or independent-cause reconciliation already exists.

## 3. Separate four concepts instead of overloading one list

The contract should keep the following concepts distinct:

1. **Effect transition:** what relationship dimension or dimensions are changed by this committed event.
2. **Required causal dependency:** a prior event or observed state that the transition actually depends on. If invalidated, the dependent transition may itself become invalid.
3. **Alternative support/evidence:** independent valid source(s) that can continue to support a relationship conclusion when another source is removed. These are not automatically dependencies and must not be encoded as if every listed source were required.
4. **Audit provenance:** who/what authored, imported, corrected, or produced the record. Provenance is not automatically an in-world cause.

The core must define the canonical representation and validation for these roles. Merely adding an array of source IDs without defining whether its entries are required dependencies or alternative support is insufficient.

## 4. Proposed operation semantics

The typed operation should guarantee the following, regardless of the eventual payload shape:

- **Directed pair:** both participants reference existing canonical `entity_id` values. Direction is explicit; no reciprocal value is inferred.
- **Dimension patch:** only explicitly named dimensions are changed. Omitted dimensions are untouched.
- **Domain validation:** accepted dimension keys, value types, explicit neutral values, and any explicit clearing operation are defined by the active World Pack/domain validator, not by a universal numeric scale.
- **Unset is not neutral:** omission cannot silently create a value. If clearing a known dimension is supported, it must be an explicit operation distinct from omitting the dimension.
- **Origin is explicit:** at minimum, author-initial/imported state, author correction, and in-world transition remain distinguishable.
- **Atomicity:** invalid participants, unsupported dimensions, invalid values, malformed causal references, or unauthorized author operations reject the entire operation without partial mutation.
- **Canonical lifecycle:** accepted effects are committed, revisioned, audited, projected, and rolled back through the core's existing lifecycle.
- **Deterministic rebuild:** the relationship projection is reproducible from the valid canonical event/effect history and approved domain rules.
- **No implied cognition:** a relationship value does not grant an NPC knowledge of a secret, motive, or private fact.

This is a semantic contract, not a proposed JSON schema.

## 5. Multi-cause rollback: recommended boundary

This is the critical unresolved requirement.

### 5.1 Do not treat every source as a required parent

The existing event-level dependency mechanism is appropriate when an event truly requires a prior event or state. It is not sufficient for alternative support: if E1 and E2 are independent reasons for a relationship conclusion, encoding both as ordinary required parents can cause the transition to be invalidated when either parent is removed.

### 5.2 Keep each committed contribution attributable

The relationship-domain representation must make it possible to identify which valid event/effect establishes or supports each resulting dimension state. Two independent events that each legitimately change or support a dimension must remain separately attributable in canonical history.

The core must decide which representation best fits its architecture:

- **Replayable independent typed effects:** each event carries its own typed relationship operation, and the canonical projector recomputes the result from surviving valid events in deterministic order. This is sufficient only where the domain's transition semantics make replay of the surviving operations semantically correct.
- **Explicit alternative-support records:** where a resulting relationship conclusion is supported by several independent sources without each source being a separate state-changing transition, the canonical typed relationship representation must preserve the alternative support set and define how it is recomputed after invalidation.
- **A bounded combination:** use ordinary causal dependencies for genuinely required inputs and typed relationship support metadata for independent alternatives, with one canonical rebuild path.

Do not select among these options merely because one is easiest to store. The choice must be validated against domain semantics and rollback tests. A generic engine must not invent what makes evidence “sufficient”; the relationship/World Pack contract must define the transition or support rule.

### 5.3 Required rollback behavior

Given a relationship conclusion with independent valid supports E1 and E2:

- If E1 is invalidated but E2 remains valid and is sufficient under the approved domain rule, the projection preserves only the conclusion still justified by E2.
- If the invalidated event is a required dependency rather than an alternative support, the dependent transition is invalidated or reviewed under the core causal contract.
- If no valid support remains, the unsupported conclusion is removed or recomputed.
- If the remaining support cannot be evaluated reliably, the engine must fail closed or require review; it must not guess.
- The audit trail records invalidation/reconciliation. Rebuilding current state must not erase historical audit evidence.

A later event is not automatically independent just because it occurred later. Its declared reads, required dependencies, causal metadata, and domain rule determine whether it can survive.

## 6. Initialization and author correction

Initial/imported state and author correction are not in-world transitions.

The approved authoring boundary must distinguish at least:

- author-initial/imported value;
- authorized author correction of an existing value;
- ordinary in-world transition.

All use canonical audit and revision semantics, but their provenance must not be fabricated as an NPC action or an in-world causal event. Labelling an operation as a correction must not itself authorize it; the trusted host/core authoring boundary must establish permission.

The exact operation and audit fields remain open. This proposal does not authorize direct database edits or an out-of-band mutable relationship store.

## 7. Read boundary and projection

Relationship state must be read from a consistent canonical view and then passed through a trusted core-owned actor/purpose access boundary before reaching NPC decision context, a player-facing response, or the character-card projector.

The access boundary must distinguish at least:

- value is known and authorized;
- value is unset/unknown;
- value exists but is withheld/inaccessible;
- the query is incomplete or unsupported.

These outcomes must not collapse into neutral or false. A relationship does not prove that an actor acquired the information needed to know its cause.

The character card receives a bounded, authorized, read-only summary. It must not read raw relationship rows or write its summary back as canonical state. This proposal does not treat the unmerged snapshot or card-projector PRs as integrated dependencies.

## 8. Required validation and acceptance tests

Before runtime integration is approved, the real production path must demonstrate:

1. Valid directional write succeeds for two existing canonical participants.
2. Reverse direction remains unchanged unless separately updated.
3. A partial dimension patch changes only the named dimensions.
4. Unknown/unset remains distinct from explicit neutral and from withheld access.
5. Invalid participant, self-relation without an approved rule, unknown dimension, invalid value, and unauthorized correction are rejected atomically.
6. Author-initial/imported state and author correction remain distinct from in-world transition in canonical audit.
7. A transition with a genuinely required cause is invalidated or reviewed when that cause is rolled back.
8. A conclusion with two independent supports survives rollback of one support only when the remaining support is valid and sufficient under the approved domain rule.
9. A conclusion with no remaining valid support is removed or recomputed.
10. Projection rebuild after rollback matches a fresh deterministic replay of all valid canonical events.
11. Actor/purpose filtering occurs before model-visible context construction; raw canonical records are not leaked.
12. Card projection is bounded, authorized, read-only, and does not imply NPC knowledge.
13. Each test asserts canonical state before/after, revision/event/audit effects, rollback result, and authorized consumer output.

Mocks for absent production interfaces may support unit design but must not be reported as integration passes.

## 9. Decision required before implementation

The main architecture chat should review these design choices:

- preferred typed-effect/domain-record pattern and canonical projector hook;
- whether independent relationship supports can be represented with the current causal model or require a core-owned extension;
- the exact distinction between required dependencies and alternative support in validation and rollback;
- the trusted actor/purpose read-filter boundary and bounded relationship-summary contract;
- the authorized initialization/import/correction boundary and audit representation.

Until those are settled, keep this document as a schema-neutral proposal. No runtime, API, schema, or `main` change is implied or authorized.
