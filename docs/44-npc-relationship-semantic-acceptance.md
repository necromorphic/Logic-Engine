# NPC Relationship — Semantic Acceptance Cases

Status: semantic acceptance specification only. These cases are not executable tests and do not assert that relationship runtime, storage, authorization, or rollback support exists. They operationalize the core decision supplied on 2026-10-24 and the contracts in docs/42 and docs/43.

## 1. Test boundary and conventions

- Use synthetic canonical entities and a synthetic World Pack; no setting-specific data is required.
- A semantic test may validate a pure policy or projection only when that production boundary exists. It must not pretend to validate persistence, authorization, event commit, or rollback.
- Integration tests must invoke the real approved core write/read/rollback path and compare canonical state, revision/event/audit effects, and actor-visible output before and after.
- Rejected operations must be atomic: no partial relationship mutation, revision side effect, or misleading success record.
- Do not use mocks for absent production interfaces and report the result as an integration pass.
- An unset dimension, an explicit neutral value, a withheld result, and an unknown read result are distinct states.

## 2. Semantic acceptance cases

### REL-SEM-001 — Direction is not reciprocal

**Given**
- Canonical entities A and B exist.
- A has a known relationship dimension toward B.
- No corresponding value is authored or established for B toward A.

**When** relationship state is read or projected for both directions.

**Then**
- A→B and B→A remain independently represented.
- The value for A→B is not copied, mirrored, or inferred for B→A.
- Unknown B→A remains unknown, not neutral and not the inverse of A→B.

**Required boundary:** typed directional write and actor/purpose-filtered read. Runtime test blocked until both exist.

### REL-SEM-002 — Omitted dimensions remain unchanged

**Given**
- A→B has multiple dimensions, including a known trust value and a separately known rivalry value.
- A proposed valid transition explicitly targets only trust.

**When** the transition is validated and committed through the approved operation.

**Then**
- Only the named dimension changes.
- Omitted dimensions retain their previous state, including unknown/unset values.
- The operation does not infer automatic changes to attraction, hostility, suspicion, loyalty, or other dimensions.

**Required boundary:** typed dimension-patch operation and validator. Runtime test blocked.

### REL-SEM-003 — Unknown differs from explicit neutral

**Given**
- One relationship dimension is unset for A→B.
- Another dimension is explicitly set to a neutral value allowed by the active World Pack.

**When** state is read, projected, updated, or rolled back.

**Then**
- The unset dimension remains distinguishable from the explicit neutral value.
- No default zero, neutral value, or negative value is introduced for missing data.
- A neutral value is accepted only when the domain defines it.
- A withheld or inaccessible read result is not reinterpreted as a neutral relationship.

**Required boundary:** state representation, World Pack/domain validator, and authorized read result contract. Runtime test blocked.

### REL-SEM-004 — Co-presence alone does not change a relationship

**Given**
- A and B share a scene.
- No meaningful interaction or other supported relationship-relevant event occurs.
- No explicit author instruction changes the relationship.

**When** the NPC decision/transition policy evaluates the scene.

**Then**
- Co-presence alone does not propose or commit a relationship change.
- Existing dimensions remain unchanged and unknown dimensions remain unknown.
- The system does not invent a conversation, prior event, motive, or emotional reaction to justify a change.

**Required boundary:** NPC decision/transition policy. A pure semantic case can be prepared now; production integration remains pending.

### REL-SEM-005 — Author-initial state is not an in-world transition

**Given**
- An author establishes an initial relationship value before in-world simulation.
- The value has explicit authoring/import provenance.
- No in-world event caused that initial value.

**When** the value is committed, audited, read, or rolled back.

**Then**
- The value and its author-initial/imported origin remain distinguishable from an in-world transition.
- Authoring provenance is not fabricated as an in-world cause.
- The value is not automatically attributed to an NPC action or inferred past event.

**Required boundary:** core-approved initialization/import operation and audit provenance. Runtime test blocked.

### REL-SEM-006 — Author correction is distinct from initialization and in-world change

**Given**
- A previously authored or committed relationship value is corrected by an authorized author.
- The correction does not represent an event that occurred inside the simulated world.

**When** the correction is recorded.

**Then**
- The record distinguishes author correction from initial/imported state and ordinary in-world transition.
- The correction uses the approved author/audit identity path.
- It does not fabricate an in-world cause.
- Unauthorized callers cannot use the author-correction path merely by labelling an operation as a correction.

**Required boundary:** authorized authoring operation and core audit contract. Runtime test blocked.

### REL-SEM-007 — Unresolved participant is not canonicalized

**Given**
- An authoring note names a person, but no canonical entity has been resolved.
- A relationship write is proposed using that unresolved reference.

**When** the canonical operation validates the proposal.

**Then**
- The write is rejected without creating an entity, NPC, relationship, or parallel identity record.
- Name, alias, cover identity, biography, or a claimed relationship does not resolve identity by itself.
- The unresolved reference may remain in authoring/import data outside canonical committed relationship state.

**Required boundary:** typed operation and existing canonical identity validation. Runtime test blocked.

### REL-SEM-008 — Self-relationship is rejected unless explicitly supported

**Given**
- A relationship write uses the same canonical entity as both participants.
- No domain rule explicitly permits a self-relation.

**When** the operation is validated.

**Then**
- The operation is rejected atomically by default.
- No automatic entity or alias workaround is introduced.
- If a future domain requires a self-relation, it needs an explicit approved semantic rule rather than accidental acceptance.

**Required boundary:** typed operation validator. Runtime test blocked.

### REL-SEM-009 — Dependent relationship transition is removed or recomputed after rollback

**Given**
- A committed relationship transition depends on a canonical event E.
- E is invalidated.
- The transition has no remaining valid support.

**When** core rollback and reconciliation run.

**Then**
- The unsupported transition is removed or recomputed according to the approved causal contract.
- The resulting projection is rebuilt from valid canonical state.
- Audit history retains the rollback/reconciliation trace rather than pretending the transition never existed.

**Required boundary:** typed relationship effect plus real core rollback/reconciliation path. Runtime test blocked.

### REL-SEM-010 — Independent surviving cause is not erased by rollback

**Given**
- Relationship transition or resulting state has two independent valid supporting causes E1 and E2.
- E1 is invalidated.
- E2 remains valid and sufficient under the approved semantics.

**When** rollback reconciliation runs.

**Then**
- The system invalidates E1's support but preserves the effect only to the extent that E2 still supports it.
- It does not erase the relationship merely because E1 was rolled back.
- It does not preserve the effect merely because E2 exists; the contract must establish that E2 is an independent and sufficient support.
- If the current causal representation cannot prove independent support, the commit/reconciliation path remains blocked rather than guessing.

**Required boundary:** canonical multi-cause representation and executable rollback tests. This is a hard implementation gate.

### REL-SEM-011 — A consistent snapshot is not authorization

**Given**
- A snapshot contains a canonical relationship record.
- The requesting actor or purpose is not authorized to receive that relationship detail.

**When** actor-specific decision context or player-facing output is prepared.

**Then**
- The raw relationship record is excluded before it reaches the unauthorized consumer.
- Snapshot membership, revision consistency, similarity retrieval, or prompt instructions do not grant access.
- Unknown, withheld, and explicitly neutral are not conflated.
- Failure to authorize does not leak the restricted value through an explanation or summary.

**Required boundary:** integrated consistent snapshot plus trusted core-owned actor/purpose filter. Runtime test blocked.

### REL-SEM-012 — Character-card relationship summary is derived and read-only

**Given**
- A canonical relationship state exists.
- A bounded, authorized relationship summary is available to the card projector.

**When** the card is generated or refreshed.

**Then**
- The card shows only the approved bounded summary.
- The card does not expose raw records, arbitrary facts/attributes, private author notes, or unfiltered relationships.
- Projection does not write back or mutate canonical relationship state.
- Editing the card summary does not directly mutate the canonical relationship; any edit must go through the separately authorized operation.

**Required boundary:** bounded authorized summary input and pure card projection. Runtime test blocked.

### REL-SEM-013 — Relationship does not imply knowledge

**Given**
- A has a relationship dimension toward B.
- A has no valid acquisition path for a secret, motive, or private fact concerning B.

**When** A's decision context is prepared.

**Then**
- The relationship value does not grant A knowledge of the secret, motive, or private fact.
- Trust, attraction, hostility, suspicion, or alliance does not bypass the knowledge/access contract.
- The secret is excluded before model-visible context is constructed unless separately authorized and acquired.

**Required boundary:** shared trusted knowledge/access filter. Runtime test blocked.

### REL-SEM-014 — A relationship value does not prove its cause

**Given**
- A relationship dimension has a known value.
- The authorized context does not contain a supported event, source, or author instruction explaining that value.

**When** an NPC or narrator explains the relationship.

**Then**
- It may identify the cause as unknown or provide a clearly marked hypothesis if permitted.
- It must not invent a past interaction, promise, betrayal, motive, or evidence and present it as established history.
- The relationship value itself is not treated as evidence of its own cause.

**Required boundary:** authorized decision context and rationale policy. Semantic requirements can be prepared now; provenance integration remains pending.

## 3. Readiness gates

| Gate | Required production capability | Cases primarily blocked |
|---|---|---|
| A — canonical write | Typed directional operation, dimension patch, validation, atomic commit, audit | REL-SEM-001–008 |
| B — authorized read | Consistent snapshot integrated with actor/purpose filter and bounded summary | REL-SEM-001, 003, 011–013 |
| C — causal rollback | Required dependencies plus deterministic replay of independently attributable typed transitions; OR-style alternative support remains unsupported until its domain sufficiency rule, reducer, and tests are approved | REL-SEM-009–010 |
| D — authoring provenance | Authorized initialization/import/correction path with distinct origin and audit | REL-SEM-005–006 |
| E — NPC semantic boundary | Real decision/rationale boundary; no co-presence inference or invented cause | REL-SEM-004, 014 |

Passing an isolated semantic test does not remove a runtime gate. Each integration case must record the real production interface exercised, canonical state before and after, revision/event/audit effects, and the authorized consumer output.

## 4. Implementation rule

The cases define acceptance semantics, not a schema. They do not choose table layout, JSON shape, public API, storage representation, or a causal algorithm. Those details must be designed against the core's canonical effect, identity, read, audit, and rollback contracts.

Until the relevant gate is approved and implemented, retain the corresponding cases as blocked specifications. In particular, do not claim generic OR-style alternative-support handling in the first relationship slice: `caused_by`/`depends_on` expresses required dependency, not “any one source is enough.” Test deterministic replay of surviving independently attributable transitions only where domain semantics justify it; leave alternative-support cases blocked until a domain sufficiency rule and core-owned reducer are specified and tested. Do not fake missing behavior with prompt text, arbitrary entity attributes, `fact.set`, a parallel NPC store, a separate causal graph, or mocks presented as integration tests.

No runtime code, API, storage schema, or `main` changes are implied by this document.


## 5. Cross-cutting causal reconciliation matrix

The shared multi-step rollback cases are specified in `docs/47-npc-causal-rollback-reconciliation-test-matrix.md`. In addition to REL-SEM-009–010, NPC-CAUSE-001–008 explicitly test required dependencies, independent sufficient support, loss of all support, a new source committed after a completed rollback, duplicate sources, downstream required dependencies, knowledge-source invalidation, and deterministic replay.

These are not extra relationship runtime claims. Relationship-specific survival remains conditional on an approved domain sufficiency rule; a later source cannot implicitly resurrect invalidated history or every downstream consequence. The causal integration gate remains closed until production-path behavior is established.
