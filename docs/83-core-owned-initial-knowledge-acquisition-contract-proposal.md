# Core-Owned Initial Knowledge Acquisition — Minimal Contract Proposal

**Status:** coordinator-approved design scope only; proposal awaiting contract and acceptance-criteria review. No implementation is authorized by this document.

**Decision basis:** coordinator decision A — establish `author_initial` / `imported` acquisition first. The bounded audit did not identify an authoritative production loader that assigns either kind to a canonical NPC. This is a bounded finding, not proof that no deployment-specific source exists.

**Governing references**
- `docs/50-npc-initial-knowledge-acquisition-contract.md` — semantic requirements and negative cases.
- `docs/43-core-npc-knowledge-runtime-implementation-plan.md` — Core workstream sequence and gates.
- `docs/81-npc-goal-action-contracts-proposal.md`, §13 — bounded source audit.

## 1. Purpose

Define the smallest Core-owned semantic contract that can represent an explicit initial-knowledge assignment to one canonical subject in one world, while preserving trusted provenance, authorization, validity, and deterministic lifecycle behavior.

This is a semantic contract, not a storage schema, API, endpoint, event format, or implementation plan. It intentionally leaves physical representation and exact identifiers to a later Core design review.

## 2. Supported acquisition kinds

The first slice supports exactly:

- `author_initial`: a trusted authoring boundary explicitly assigns an item to a subject as initial knowledge at a declared world-start boundary.
- `imported`: a trusted import source and rule explicitly assign an imported item to a subject in a world as initial knowledge.

Neither kind implies that the proposition is objectively true, believed, understood, observed in-world, delivered, remembered indefinitely, or emotionally accepted.

All other acquisition paths—including observation, communication, reading a document during play, inference, rumor, and model-generated claims—remain unsupported by this slice. Core must not reinterpret them as `author_initial` or `imported`.

## 3. Minimum semantic record

Every active or historical assignment must be reconstructable with the following information. These are required meanings, not prescribed physical fields.

| Required element | Minimum meaning |
|---|---|
| World | Existing canonical world identity. The assignment cannot cross worlds. |
| Subject | Canonical subject identity resolved by trusted Core rules; display name, card title, model-provided ID, or adapter ID alone is insufficient. |
| Assigned item | Existing canonical proposition/fact reference or a Core-recognized source reference whose meaning can be resolved. Do not invent an NPC-local reference format. |
| Acquisition kind | Exactly `author_initial` or `imported`. |
| Trusted source | Stable reference to the authoring source or imported package/source. The source must be independently identifiable; do not fabricate provenance. |
| Assignment authorization | The trusted rule or authoring/import decision that explicitly permits this item to be assigned to this subject in this world. World-level presence is not authorization. |
| Initial boundary | The declared world-start/import boundary, using existing Core time/revision/commit concepts where applicable; no parallel revision counter. |
| Validity | Whether this assignment is active, invalidated, or unresolved under Core-owned lifecycle rules. Exact representation is deferred. |
| Lifecycle identity | Enough stable identity and source identity to distinguish a retry/replay of the same assignment from a distinct assignment or replacement. Reuse existing Core identity/idempotency concepts where their semantics fit. |
| Restrictions | Existing Core-recognized restrictions needed to decide whether the value may be exposed to a particular actor and purpose. If enforcement cannot be proven before model serialization, the value is not safe to return. |

The record must not add belief stance, confidence, trust, suspicion, emotional response, memory strength, delivery status, comprehension, or in-world observation time as placeholders. Those are distinct semantics.

## 4. Required invariants

1. **Explicit subject assignment.** No actor acquires an item merely because the item exists in canonical world state, a World Pack, a channel manifest, a context manifest, a vector result, or a prompt.
2. **Core ownership.** Core owns assignment records, source provenance, authorization validation, validity and reconciliation, snapshot consistency, and actor-/purpose-scoped safe filtering. No NPC-local duplicate store, source graph, permission system, revision cursor, or rollback mechanism is permitted.
3. **Trusted identity.** Subject identity comes from a trusted canonical resolution path. Model output, untrusted aliases, card text, and caller-supplied allowlists cannot select or authorize the subject.
4. **Source-backed assignment.** The source and assignment rule must be resolvable and auditable. Canonical fact provenance alone does not prove subject acquisition.
5. **World and snapshot binding.** Assignment, source resolution, and any canonical item used to construct a response must be evaluated against one consistent existing Core snapshot marker. Mixed or unverifiable snapshots fail closed.
6. **Authorization before serialization.** Core validates subject, requested purpose, source/item restrictions, and exposure policy before returning any model-bound value. Restricted values must not leak through error messages, logs exposed to the model, diagnostics, or fallback paths.
7. **Read purity.** Reading or filtering assignments does not create or update acquisition, belief, delivery, canonical facts/events, world revision, or commit sequence.
8. **No semantic promotion.** Acquisition means the subject was assigned the information under this contract. It does not assert truth or belief and does not turn a pending proposal into a committed fact.
9. **Unsupported means blocked.** Missing source semantics, unknown acquisition kind, ambiguous authorization, unresolved subject, or unsupported lifecycle behavior must produce a non-ready/unsupported outcome; never silently downgrade it to success or to a negative fact.

## 5. Minimum lifecycle semantics

The contract must define behavior for creation, retries/replay, replacement, invalidation, and recovery without choosing physical storage.

### Create

Accept an assignment only when the trusted author/import boundary supplies the world, canonical subject, item/source, acquisition kind, source provenance, assignment authorization, and initial boundary required by §3. Missing or unverifiable required evidence rejects the assignment or leaves the operation explicitly non-ready; it must not create a partially trusted active record.

### Replay and duplicate delivery

Replaying the same source assignment must not create duplicate active assignments or broaden access. Core must use an existing stable identity/idempotency mechanism if one fits. If no existing mechanism can provide deterministic replay behavior, that is a blocking Core design gap; do not invent an NPC-local idempotency ledger.

Reusing an identity with materially different subject, item, kind, source, or authorization must be rejected or handled as an explicitly defined replacement—not silently treated as the original assignment.

### Replacement

A changed assignment must be distinguishable from replay. Core must preserve the source and authorization basis for the replacement and determine whether the prior assignment remains active, is superseded, or is invalidated. Exact transition labels are deferred to Core, but ambiguous “last write wins” behavior is not acceptable without an authoritative rule and audit trail.

### Invalidation and validity re-evaluation

When the source, import, authoring rule, authorization basis, subject eligibility, or referenced item becomes invalid under existing Core rules, Core must re-evaluate affected assignments. An assignment may remain active only if its basis remains valid under the declared rules. If no valid support remains, it must no longer be returned as active.

If independent valid assignments support the same item, invalidating one source must not erase the independent assignment. Conversely, a source change must not leave a stale assignment active by default.

The contract does not assume existing `caused_by`, `depends_on`, `read_set`, or `causal_links` fields prove complete alternative support. Core must establish that the chosen source representation participates in its real validity/replay/rollback lifecycle. If it cannot, implementation remains blocked pending a minimal reviewed extension.

### Restart and reconstruction

After restart/reload/replay, Core must reconstruct the same effective assignment set, subject isolation, provenance, and validity from authoritative sources. If the current world seed/import lifecycle cannot reconstruct assignments deterministically, this is an implementation blocker—not permission for a parallel NPC store.

## 6. Safe read result

A future Core read/filter boundary must bind the request to:
- trusted canonical subject;
- validated, bounded purpose;
- exact existing world snapshot marker;
- the Core-owned assignment/source state resolved at that same snapshot;
- restrictions evaluated before model serialization.

The result must preserve the distinctions needed by `docs/50-npc-initial-knowledge-acquisition-contract.md`: known assignment, known absence only within a complete authorized scope, unknown, withheld, incomplete, unsupported, and invalid. These are semantic distinctions, not approved enum names or wire values.

If completeness, identity, authorization, provenance, validity, or snapshot consistency cannot be established, the result is non-ready and must not be sent to the model. No fallback to raw world state, unfiltered snapshots, character-card prose, vector candidates, prompt text, or model-generated claims is permitted.

## 7. Minimum acceptance criteria for contract review

The following criteria define what the contract must make unambiguous before implementation is separately requested.

| ID | Review question | Acceptance criterion |
|---|---|---|
| KAC-01 | Identity and scope | World and canonical subject are explicit; cross-world and unresolved-subject assignments fail closed. |
| KAC-02 | Item/source meaning | The assigned item resolves through an existing Core-recognized reference; unsupported source types are explicitly blocked. |
| KAC-03 | Kind fidelity | Only `author_initial` and `imported` are accepted in this slice; no implicit conversion from other mechanisms. |
| KAC-04 | Authorization | The source rule explicitly assigns the item to this subject and is validated by Core; mere canonical existence or adapter identity is insufficient. |
| KAC-05 | Provenance | Author/import source and assignment basis remain auditable after normalization and replay; missing provenance cannot be fabricated. |
| KAC-06 | Validity | The contract defines active versus invalid/unresolved semantics and identifies which existing Core lifecycle determines transitions. |
| KAC-07 | Replay/idempotency | Same assignment replay is deterministic and non-duplicating; conflicting reuse of identity has explicit behavior. |
| KAC-08 | Replacement | Reassignment is distinguishable from replay and has a defined effect on the previous assignment and audit trail. |
| KAC-09 | Invalidation | Source invalidation cannot leave an unsupported assignment active; independent valid support is preserved without assuming incomplete causal fields prove it. |
| KAC-10 | Snapshot | Assignment and item/source resolution use one consistent existing snapshot; stale/mixed reads are non-ready. |
| KAC-11 | Isolation and filtering | Actor-, purpose-, and restriction-scoped filtering occurs before serialization; denied values are absent from payloads and model-accessible diagnostics. |
| KAC-12 | Read purity | Querying does not mutate acquisition, belief, delivery, canonical state, revision, or commit sequence. |
| KAC-13 | Reconstruction | Restart/replay produces deterministic effective assignments or documents a specific blocking lifecycle gap. |
| KAC-14 | No false claims | Acquisition does not imply objective truth, belief, observation, delivery, or comprehension. |
| KAC-15 | Production-boundary proof | A future implementation test plan covers the actual Core source/assignment path and exact model serialization boundary; mocks alone are insufficient. |

## 8. Acceptance scenarios inherited from the governing contract

The future production test suite must also preserve the applicable cases from `docs/50-npc-initial-knowledge-acquisition-contract.md`, especially:
- actor A receives an explicitly assigned item while actor B does not;
- a canonical fact without an assignment grants knowledge to no actor;
- generic package import without explicit subject assignment grants no knowledge;
- a reserved secret never appears in model input or model-accessible diagnostics;
- unknown, known-absent, withheld, incomplete, unsupported, and invalid remain distinct;
- stale snapshots are rejected/non-ready;
- invalidating one of multiple independent valid supports preserves the remaining support;
- read/filter operations have no state-changing side effects;
- observation, communication, document reading, inference, and rumor remain unsupported by this first slice;
- restart/replay preserves assignment identity, provenance, and validity or remains blocked until lifecycle support is specified.

These are requirements, not claims that tests currently exist or pass.

## 9. Explicitly deferred decisions

This proposal does not choose:
- physical tables, JSON fields, event/effect representation, migrations, or storage provider;
- API endpoint, method name, wire format, or public exposure;
- whether a supported assignment should be represented through an existing seed/import contract or a minimal Core-owned extension;
- exact canonical proposition identifier if existing references are insufficient;
- exact status enum strings;
- source invalidation implementation details where current causal/source identities are insufficient;
- individual implementation assignee.

Core must inspect the actual seed/import, fact, entity, event, causal, authorization, and snapshot contracts before selecting a representation. Reuse is preferred only when the existing semantics actually match.

## 10. Gate and non-authorization

**Current status:** design proposal only; contract and acceptance criteria require review.

After this proposal is reviewed, a separate explicit authorization is required before implementation. Any later implementation request must name the approved representation/source path, owner or assignee, exact files/boundaries in scope, migration/replay strategy, and production-boundary tests.

Not authorized by this proposal:
- runtime code, API, schema, storage, migration, or prompt changes;
- dispatcher, scheduler, worker, or plan reconciliation;
- an NPC-local acquisition store or separate permission system;
- enabling observation or any other unsupported acquisition path;
- enabling `Memory → NPC`.

`Memory → NPC` remains **DISABLED / FAIL-CLOSED**. Host remains **NON_READY**. No runtime readiness is claimed.
