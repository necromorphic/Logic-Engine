# Personality Block — Scope and Relationship Semantics

Status: documentation-only proposal on `feat/personality-subsystem`. This document defines the Personality block's own scope and its integration boundaries. It does not authorize runtime, API, schema, storage, prompt, or UI changes.

## 1. Why this block is separate

The Personality block is not the NPC runtime and does not own the canonical world engine. It defines the authored character-personality model and the semantic rules by which personality and relationships inform plausible decisions. The NPC subsystem consumes these semantics when building decision context and evaluating candidate actions; it must not silently redefine them.

The character card is a view over authoritative records, not a parallel source of truth.

Related documents:
- [Core decision and integration gates](./03-core-decision-and-integration-gates.md) — accepted architecture decisions and remaining blockers.
- [Core integration review request](./02-core-integration-review-request.md) — original request with the architecture response recorded.
- [Semantic acceptance matrix](./04-semantic-acceptance-matrix.md) — semantic cases, ownership boundaries, and readiness criteria.
- [World Pack relationship dimension template](./05-world-pack-relationship-dimension-template.md) — required per-dimension semantics, transitions, non-implications, and acceptance checks.
- [Stable trait lifecycle](./06-stable-trait-lifecycle.md) — separation of stable traits, temporary conditions, goals, beliefs, behavior, and inference.
- [Cross-block readiness and core handoff](./07-cross-block-readiness-and-handoff.md) — ownership matrix, current integration evidence, and remaining blockers.
- [Semantic traceability and review workflow](./08-semantic-traceability-and-review-workflow.md) — requirement-to-acceptance mapping, status vocabulary, and documentation review checklist.
- [Per-case acceptance traceability](./09-per-case-acceptance-traceability.md) — individual ownership and runtime-status mapping for every PERS-SEM case and PERS-TRAIT criterion.

## 2. Responsibility boundary

### Personality block owns

- the meaning and lifecycle of authored, relatively stable personality traits;
- the distinction between stable traits, temporary condition, current goals, beliefs, and observed behavior;
- semantic relationship dimensions and their interpretation by character decision-making;
- directional/asymmetric relationships: A's relation to B does not imply B's relation to A;
- the difference between an unset/unknown dimension and an explicitly authored neutral value;
- semantics for authored initial state, imported state, in-world transition, and author correction;
- requirements for how relationship/personality information may influence decisions without deterministically scripting them;
- semantic acceptance scenarios for these rules and for derived card summaries.

### Owned by the core engine, not this block

- canonical entity IDs and identity validation;
- canonical persistence, event commit, revisions, audit, and rollback;
- causal dependency and independent-support representation;
- authorization and actor/purpose-filtered reads;
- deterministic projection/rebuild and atomicity.

### Owned by the NPC subsystem, not this block

- autonomous scheduling, goals/plans/tasks, action proposals, off-screen progression, and NPC decision orchestration;
- the runtime mechanism that assembles a bounded actor-specific decision context;
- execution of validated actions and lifecycle of NPC processes.

The NPC subsystem may request personality and relationship inputs, but it may not create a second personality/relationship store or treat its own interpretation as canonical state.

## 3. Personality model: semantic invariants

1. **Stable profile is not current state.** A temporary emotion, injury, stressor, or current objective must not silently rewrite a stable trait or biography.
2. **Traits constrain plausibility; they do not dictate a single action.** The same character may act differently under different knowledge, stakes, obligations, pressure, or development.
3. **Behavior is evidence, not automatic re-authoring.** One action does not rewrite a stable trait unless an explicit rule or author operation says so.
4. **Contradiction is allowed and must be interpretable.** A character can act against a trait due to conflict, coercion, deception, growth, or an exception; the system must not invent a motive when none is established.
5. **Authored canon and runtime inference remain distinguishable.** Inferred personality descriptions are not silently promoted into authored facts.
6. **The player character's agency remains separate.** Personality may inform interpretation of player-authored actions but cannot authorize the engine or model to invent the player's voluntary dialogue, thoughts, or actions.

## 4. Relationship semantics

A relationship is a directed, multidimensional relation between two existing canonical entities. It is not a single generic score and does not imply reciprocal state.

- Each dimension is independently meaningful. The World Pack declares supported dimensions, values, transitions, and world-specific interpretation; the core enforces the approved operation contract without absorbing all relationship semantics.
- A partial update changes only explicitly supplied dimensions; omitted dimensions remain unchanged.
- A dimension with no established canonical value (unset; sometimes described as unknown in this specific sense), an explicit neutral value, an inaccessible/withheld result, and an explicit clearing of a previously established value are distinct semantic cases. Here, “unknown” means only that no canonical value is established; it does not mean a conflict/insufficient-support reconciliation result such as the one described in PERS-SEM-023. A clear removes the current effective value; it must still be distinguishable in the authorized canonical history/provenance from a dimension that was never established. This does not require every caller-facing projection to expose the clear history: disclosure remains subject to Core authorization and purpose. The exact wire/storage representation for clearing is not yet approved.
- Mere co-presence, shared scene participation, or narrative tone does not by itself change a canonical relationship.
- A relationship does not imply knowledge, trustworthiness of a claim, consent, obligation, or any other dimension unless an explicit rule establishes that implication.
- A relationship value does not prove why it has that value. Its origin and causal support are separate from its current meaning.
- Both participants must already resolve to canonical `entity_id` values before a committed relationship transition. Mentioning or describing a person does not create an entity. Self-relations are rejected unless a domain explicitly supports them.
- Character-card summaries are derived, read-only views over authorized canonical data; they must not become writable duplicates.

### 4.1 State origins

The semantic model must distinguish at least:

- **author-initial/imported:** state supplied as part of the initial authored world;
- **in-world transition:** state changed by a validated event in the simulated world;
- **author correction:** an explicit correction of authored/canonical state, with attribution and audit;
- **unset:** no canonical value has been established, not equivalent to neutral. “Unknown” in this narrow sense means unset; a conflict/insufficient-support `unknown` is a separate reconciliation/read-result state.

These origins cannot be inferred from the value alone. A value such as “neutral” is not enough to tell whether it was authored, imported, or produced by an in-world event.

## 5. Decision-use contract

Personality and relationship data may shape an NPC's candidate actions, priorities, tone, risk tolerance, interpretation, and likely response. They do not bypass:

- what the actor is permitted to know;
- current world-state preconditions;
- player-agency rules;
- World Pack constraints and explicit commitments;
- core validation and commit rules.

A relationship is an input, not a guaranteed action. The NPC subsystem should receive only a bounded, actor-authorized projection and should preserve uncertainty when dimensions are unset, inaccessible, disputed, or unsupported.

## 6. Causality and rollback boundary

The Personality block defines expected semantics, not a causal engine.

- If an in-world relationship transition depends on a rolled-back event, the current relationship projection must be recomputed under the core's approved rollback contract.
- An independent valid cause must not be erased merely because another cause is rolled back.
- A list of event IDs must not be treated as alternative support unless the core contract explicitly defines it that way.
- Personality-side tests may state these requirements but cannot claim that the production runtime passes them until the real core path and tests exist.
- No Personality-owned causal graph, event log, identity registry, or rollback mechanism is permitted.

The current core contract explicitly distinguishes the limited implemented rollback path from the fuller target architecture. Multi-cause preservation remains a blocked integration requirement until the core represents and tests it.

## 7. Semantic acceptance cases

These are specifications, not executable integration tests.

| ID | Case | Expected invariant |
|---|---|---|
| PERS-REL-001 | Directionality | A→B does not create or update B→A. |
| PERS-REL-002 | Partial update | Omitted dimensions remain unchanged. |
| PERS-REL-003 | Unknown vs neutral | Unset/unknown and explicit neutral remain distinguishable. |
| PERS-REL-004 | Co-presence | Sharing a scene alone causes no relationship transition. |
| PERS-REL-005 | Initialization provenance | Author-initial/imported state is not misreported as an in-world event. |
| PERS-REL-006 | Correction provenance | An author correction is distinct from initialization and in-world change. |
| PERS-REL-007 | Identity boundary | An unresolved name/mention cannot become a canonical participant by inference. |
| PERS-REL-008 | Self-relation | Self-relationship is rejected unless explicitly supported by a domain rule. |
| PERS-REL-009 | Personality stability | One action does not automatically rewrite a stable trait. |
| PERS-REL-010 | Context-sensitive behavior | A trait influences plausibility but does not force one fixed action. |
| PERS-REL-011 | Knowledge boundary | Relationship state does not grant knowledge of facts or secrets. |
| PERS-REL-012 | Derived card | A card summary is read-only and cannot become a duplicate canonical store. |
| PERS-REL-013 | Rollback dependency | A transition supported only by an invalidated cause is removed/recomputed. |
| PERS-REL-014 | Independent support | Rolling back one cause preserves a result only when the remaining support is sufficient under explicit domain rules. |
| PERS-REL-015 | Authorized read | A snapshot is not authorization; actor/purpose filtering precedes decision use. |
| PERS-REL-016 | Agency | Personality rules never authorize invented voluntary player actions, thoughts, or dialogue. |

A semantic test can validate a pure rule only where that production boundary exists. An integration test must exercise the real approved core write/read/rollback path and inspect canonical state, revision/audit effects, and actor-visible output. Mocks of absent interfaces must not be reported as integration passes.

## 8. Integration gates

Runtime implementation remains blocked until the main architecture chat approves and the core provides tested contracts for:

1. a typed canonical relationship write operation on the existing event/revision/audit lifecycle;
2. existing canonical participant IDs and atomic validation;
3. actor- and purpose-filtered reads with a bounded projection;
4. explicit provenance for initialization, in-world transitions, and author correction;
5. rollback/reconciliation semantics for required dependencies versus independent support;
6. tests proving these behaviors on the actual core path.

Until then, work in this block remains semantic design and acceptance criteria. No runtime/API/schema/storage changes are made by this proposal.

## 9. Source alignment

This proposal follows the existing core boundaries described in:

- `docs/00-architecture-baseline.md` — simulation authority, provenance, rollback, and World Pack boundaries;
- `docs/06-npc-autonomy-and-process-manager.md` — personality and relationships as decision inputs, with the NPC runtime validating candidate actions;
- `docs/07-knowledge-and-narrative-boundaries.md` — separation of canonical truth, subject knowledge, narrative delivery, and retrieval;
- `docs/18-rollback-and-causality.md` and `docs/21-stage1-causality-contract.md` — target versus currently implemented rollback guarantees;
- `docs/23-character-and-control-architecture.md` — character cards as views over canonical records, with player agency kept separate.

No source listed above grants this block permission to implement a parallel canonical store or to claim that a future core interface already exists.
