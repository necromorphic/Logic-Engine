# Personality Block — Semantic Acceptance Matrix

Status: semantic specification, not an executable runtime test suite. These cases define what the Personality block considers correct; they do not claim that the core write/read/rollback path currently implements them.

## 1. Test boundary

- Pure semantic rules may be tested independently once a production rule boundary exists.
- Persistence, authorization, event/revision/audit effects, snapshot consistency, and rollback must be tested through the real core interfaces after those interfaces are approved and implemented.
- A mock of a missing interface is not evidence that an integration requirement passes.
- Every rejected canonical operation must be atomic.
- World Pack rules define which relationship dimensions, values, and transitions are meaningful for a particular world. Universal identity, authorization, event, audit, revision, and rollback guarantees belong to the core.
- Relationship state is not character knowledge, consent, reciprocity, or proof of cause.

## 2. Semantic acceptance cases

| ID | Scenario | Required result | Boundary |
|---|---|---|---|
| PERS-SEM-001 | Directed relationship A → B | Only A's relation toward B changes; B → A is untouched unless separately changed. | Personality semantics + typed write |
| PERS-SEM-002 | Partial dimension update | Explicitly supplied dimensions change; omitted dimensions remain unchanged. | Personality semantics + typed write |
| PERS-SEM-003 | Unknown versus neutral | Unset/unknown and an explicit neutral value remain distinguishable. | Personality semantics + typed write/read |
| PERS-SEM-004 | Explicit clearing | An authorized clear removes the current effective value and remains distinguishable in authorized canonical history/provenance from a dimension never established; it is not equivalent to neutral or a withheld read. Caller-facing disclosure of clear history remains authorization- and purpose-scoped. | Contract decision + typed write/read |
| PERS-SEM-005 | Dimension isolation | Changing trust does not automatically change attraction, consent, knowledge, obligation, reciprocity, or another dimension. | Personality/World Pack semantics |
| PERS-SEM-006 | Unsupported dimension/value | A dimension or value not supported by the active domain/World Pack is rejected rather than silently normalized. | World Pack validation + typed write |
| PERS-SEM-007 | Unsupported transition | A transition disallowed by the active domain rules is rejected atomically. | World Pack validation + typed write |
| PERS-SEM-008 | Co-presence only | Sharing a scene or being mentioned together does not itself change canonical relationship state. | Personality semantics |
| PERS-SEM-009 | Existing canonical participants | Both participants must resolve to existing canonical entity IDs before a relationship can be committed. A name/mention does not create an entity. | Core identity + typed write |
| PERS-SEM-010 | Self-relationship | A self-relation is rejected unless the active domain explicitly supports it. | Core identity + domain rule |
| PERS-SEM-011 | Initial/imported state | Authored initial/imported state is distinguishable from a transition caused inside the simulation. | Provenance contract |
| PERS-SEM-012 | Author correction | A correction is explicitly attributed and audited; it does not silently rewrite historical events. | Core-authorized correction |
| PERS-SEM-013 | Origin cannot be self-asserted | A caller-supplied origin label alone cannot authorize initialization or correction. | Core authorization |
| PERS-SEM-014 | Stable trait versus temporary condition | A temporary emotion, injury, pressure, or goal does not silently rewrite a stable personality trait. | Personality semantics |
| PERS-SEM-015 | Trait influences, not dictates | A trait shapes plausibility but does not force one fixed action regardless of context. | Personality/NPC decision boundary |
| PERS-SEM-016 | Behavior does not auto-rewrite profile | One observed action does not automatically become a new stable trait without an explicit rule or author operation. | Personality semantics |
| PERS-SEM-017 | Contradictory behavior | A character may act against a trait; the system does not invent an unestablished explanation as canonical fact. | Personality/NPC narrative boundary |
| PERS-SEM-018 | Relationship does not imply knowledge | Knowing a relationship value does not reveal facts, secrets, or another actor's beliefs. | Knowledge access boundary |
| PERS-SEM-019 | Relationship does not imply consent | Relationship dimensions do not establish consent or permission unless a specific rule separately governs it. | Personality/World Pack semantics |
| PERS-SEM-020 | Relationship does not prove cause | A current value alone does not establish the event or evidence that caused it. | Provenance boundary |
| PERS-SEM-021 | Required dependency rollback | If a transition is invalidated because its only required basis is revoked, the current projection is recomputed without unsupported state. | Core rollback integration |
| PERS-SEM-022 | Surviving independent support | A result is preserved after rollback only when surviving support is actually sufficient under declared rules. Different source IDs alone do not prove independence or sufficiency. | Core rollback + domain rule |
| PERS-SEM-023 | Conflicting/insufficient support | The system applies an explicit domain rule or exposes conflict/unknown as a reconciliation or read-result state; it must not silently turn that result into a relationship-dimension value unless the active domain explicitly models it as one. It does not guess. | Core reconciliation + World Pack policy |
| PERS-SEM-024 | Deterministic replay | Replaying the same surviving valid transition history produces the same relationship projection. | Core projection/replay |
| PERS-SEM-025 | Authorized actor read | A decision context receives only data permitted for that actor and purpose. A snapshot alone does not authorize access. | Core authorized read |
| PERS-SEM-026 | Withheld versus unset | A caller cannot infer that a dimension is canonically unset merely because the read boundary withheld it. | Core authorized read |
| PERS-SEM-027 | Character card is derived | A card summary reflects authorized canonical state and cannot independently mutate or become a duplicate source of truth. | Projection/card contract |
| PERS-SEM-028 | Player agency | Personality rules do not authorize the model or engine to invent the player's voluntary actions, dialogue, or thoughts. | Player-control contract |

## 3. Readiness classification

### Can be completed in the Personality block now

- Define dimension meanings and allowed/forbidden semantic implications.
- Specify stable traits versus mutable condition and behavior.
- Define the difference between unknown, neutral, withheld, and cleared values.
- Define the meaning of initial/imported state, in-world transition, and author correction.
- Maintain semantic examples and pure acceptance rules without claiming runtime integration.

### Blocked on core contracts and production tests

- Atomic canonical typed writes and dimension patch semantics.
- Canonical participant identity enforcement.
- Authorized actor/purpose-filtered reads.
- Authorization and audit for initialization/import/correction.
- Deterministic projection rebuild after rollback.
- Required-dependency versus independent-support reconciliation.
- Any end-to-end claim about character-card data being safe or current.

## 4. First-stage causal limit

The agreed first target is deterministic replay of surviving valid typed transitions, and only for states that can be reconstructed from that replay. It does not establish universal independent-cause preservation. `caused_by` and `depends_on` remain dependency metadata, not alternative-support semantics. Multi-evidence sufficiency and conflict cases stay blocked until a narrow domain-specific rule and core-owned implementation are defined and tested.

## 5. Exit criteria for the semantic contract

The Personality block's semantic design is ready for core implementation review when:

1. every supported relationship dimension has a defined meaning, value domain, and permitted transition policy in the applicable World Pack;
2. omitted, unknown/unset, explicit neutral, inaccessible/withheld, and cleared states are not conflated;
3. initialization/import, in-world transitions, and author correction have distinct semantic meanings;
4. the acceptance cases above have an identified owner/boundary and are not misreported as passing integration tests;
5. the core's exact write/read/provenance/rollback contracts are linked as dependencies rather than guessed or duplicated here.

Passing this exit criterion means the semantic specification is ready for review, not that runtime integration is unblocked.


## 6. Detailed semantic templates

The acceptance cases are supported by two authoring contracts:

- [World Pack relationship dimension template](./05-world-pack-relationship-dimension-template.md) defines the required semantics for every supported relationship dimension without inventing universal dimensions or values.
- [Stable trait lifecycle](./06-stable-trait-lifecycle.md) defines the default non-mutation rule for stable traits, separates observed behavior from canonical profile, and identifies the conditions for any future trait-development rule.
- [Semantic traceability and review workflow](./08-semantic-traceability-and-review-workflow.md) maps requirement families to acceptance IDs and defines how to label specification versus implementation evidence.
- [Per-case acceptance traceability](./09-per-case-acceptance-traceability.md) maps each PERS-SEM case and PERS-TRAIT criterion to its primary reference, closure owner, and evidence status.

These templates improve semantic readiness only. They do not remove the core integration blockers listed above or claim that the production runtime implements the required operations.
