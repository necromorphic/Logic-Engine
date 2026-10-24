# NPC Relationship Consumer Compatibility Matrix

Status: **documentation-only consumer-side contract**, authored on `feat/npc-subsystem`, 2026-10-24. This document reviews the optional Relationship module from the NPC consumer boundary. It does not modify or supersede the Relationship branch, define a runtime API/schema, authorize Core changes, or claim runtime integration.

## 1. Purpose and ownership

The NPC subsystem consumes relationship information as one bounded input to a character's decision context. It does not own relationship truth, domain transition rules, subject-specific beliefs, authorization, provenance, or canonical lifecycle.

This matrix is intentionally complementary to:

- `docs/42-npc-relationship-state-contract-proposal.md` — baseline semantics;
- `docs/43-npc-relationship-core-integration-decision.md` and `docs/45-npc-relationship-typed-operation-design.md` — typed Core operation and integration gates;
- `docs/44-npc-relationship-semantic-acceptance.md` — existing NPC relationship acceptance cases;
- `docs/46-npc-authoring-correction-and-card-summary-contract.md` — authoring and bounded card-summary boundary;
- `docs/47-npc-causal-rollback-reconciliation-test-matrix.md` — causal and rollback cases;
- Relationship branch `docs/46-relationship-domain-module-design.md`, `docs/47-relationship-module-test-traceability.md`, and `docs/48-relationship-pure-evaluation-contract.md` — module ownership, domain acceptance, and pure evaluation.

The Relationship documents remain owned by their branch and authors. This document records the requirements NPC places on that module as a consumer; it is not a request to alter their proposal.

## 2. Consumer contract

Before relationship-derived context may influence an NPC decision, the consumer needs a bounded result assembled by the trusted host from a consistent canonical view and filtered for the actual actor and purpose. This is a conceptual semantic contract, not a proposed payload shape.

A usable result must preserve:

1. **Subject and target direction** — the exact directed pair; never infer the reverse direction.
2. **Dimension scope** — only dimensions supported by the active domain rules; omitted dimensions remain omitted.
3. **Value status** — established value, unset/unknown, explicit neutral, explicitly cleared, withheld/inaccessible, conflict/insufficient support, and unsupported/incomplete must remain distinguishable wherever the host contract supports those outcomes.
4. **Access scope** — only information this actor may use for this decision purpose; a consumer must not learn whether a withheld value exists merely from a different status or error detail.
5. **Basis and freshness** — the result comes from one consistent, current-enough canonical read; stale or mixed snapshots cannot silently become a current decision input.
6. **Evidence/knowledge separation** — relationship state does not establish that the actor knows its cause, observed a source, knows a secret, or shares another actor's belief.
7. **Rule/capability status** — disabled, absent, unsupported, or version-incompatible relationship capability is not represented as a neutral relationship.
8. **Read-only use** — decision context, narration, summaries, and cards cannot write relationship state or turn generated rationale into provenance.
9. **Boundedness** — include only decision-relevant information needed for the current actor/purpose; no raw relationship rows, unrestricted history, or another actor's private stance.
10. **No agency transfer** — relationship context can inform an NPC proposal, but cannot author a player-controlled character's voluntary thought, dialogue, decision, or action.

The consumer must not independently fetch raw snapshots, maintain a shadow relationship store, infer canonical IDs from names, create missing participants, or repair absent Core capabilities with `fact.set`, prompt rules, or local causal records.

## 3. Compatibility matrix

| Relationship contract requirement | NPC consumer behavior required | Can be checked without Core runtime integration? | Runtime gate / failure mode |
|---|---|---|---|
| Directed pair A → B | Use only the requested subject-to-target direction | Yes: pure semantic fixture | Real projection must prove reverse direction is not copied |
| Multidimensional partial patch | Use only dimensions explicitly present and supported | Yes: consumer fixture | Typed canonical operation must preserve omitted dimensions |
| Unset vs explicit neutral vs clear | Never substitute one status for another | Yes: status-table tests | Real read/write contract must encode and return distinct outcomes |
| Withheld/inaccessible | Do not treat as unset; do not leak existence or value | Yes: negative consumer tests with synthetic statuses | Core authorization must filter before model-visible context |
| Conflict / insufficient support | Mark unusable or require review; do not pick a side by guess | Yes: pure consumer behavior | Domain resolver and canonical projection must expose a supported outcome |
| Unsupported / incomplete / module disabled | Omit relationship-dependent inference or report unavailable internally; never invent neutral | Yes: lifecycle tests | Host must provide a real capability/read status; no implicit catch-up on re-enable |
| Actor-specific knowledge | Use only evidence the subject acquired through a permitted path | Partly: negative fixtures | Core-owned acquisition, provenance, and actor/purpose read remain blockers |
| Same event, different interpretation | Allow distinct candidates only from explicitly different established knowledge/profile/context | Yes: pure synthetic evaluator/consumer test | No inference that either candidate is canonical until separately validated/committed |
| Presence or scene count alone | Do not change relationship state merely because characters co-occur or turns pass | Yes | Production path must show no hidden auto-transition |
| Repeated evaluation / duplicate event | Do not accumulate changes on repeated evaluation of the same input | Yes: deterministic pure test | Host/Core must enforce commit idempotency for the same logical transition |
| New knowledge about old event | Treat as a distinct acquisition/reevaluation case; do not silently rewrite old transition | Semantic distinction can be tested | Knowledge contract, reevaluation policy, and canonical idempotency required |
| No invented cause or motive | Never turn an evaluator rationale, relationship label, or later event into proof of cause | Yes: adversarial fixtures | Trusted evidence references and Core causal validation required |
| Rollback of required cause | Do not consume stale projection as current after invalidation | Expected behavior can be specified | Real rollback/replay, fresh authorized read, and audit assertions required |
| Alternative independent support | Do not preserve a conclusion merely because multiple source IDs exist | Yes: fail-closed semantic case | Unsupported until domain sufficiency and Core-owned representation/reducer or approved deterministic replay exist |
| Character-card summary | Read-only, bounded, authorized, freshness-aware summary; no new knowledge implied | Yes: projection contract test | Real authorized projection and invalidation/refresh mechanism required |
| Player agency | Never generate voluntary player actions/thoughts/dialogue from relationship context | Yes: semantic acceptance test | Must also be enforced at the actual NPC proposal/response boundary |
| Identity and provenance | Treat canonical participant refs and trusted origin as host-validated inputs | Negative fixtures only | Core identity, authorization, trusted provenance, and atomic commit must be real |
| Rule/version compatibility | Do not reinterpret an old transition under new rules without explicit migration/replay policy | Yes: pure version-pinning test | Host must pin or explicitly migrate rule versions in canonical history |

## 4. Bounded relationship summary — semantic minimum

NPC needs a **read-only projection**, not a new persistence format. A consumer-visible summary should contain only the fields the approved host contract actually supplies. Conceptually, the consumer needs to know:

- which subject and target the projection concerns;
- which supported dimensions are available, with their explicit statuses;
- whether the result is complete, withheld, conflicting, stale, or unsupported, to the extent the trusted read boundary can report this safely;
- which canonical read/version basis establishes freshness, without exposing raw internal records;
- which active domain/rule version governs interpretation, if the host makes it available;
- whether a value is authorized for the current actor and purpose.

This list is a requirement checklist, **not** a JSON schema or API proposal. Do not invent missing fields or encode access denial as a relationship value. If the host cannot provide a required distinction, the consumer must fail closed for the affected inference.

The summary is not evidence that the NPC knows the relationship's cause. It is not a belief record, an observation record, a narrative explanation, or a commitment to act. It must never be written back as canonical relationship state.

## 5. Independent semantic acceptance cases

These cases can be implemented as pure consumer/domain tests using synthetic inputs. Passing them proves only behavior at that isolated boundary, not Core authorization, storage, commit, audit, or rollback.

| ID | Setup | Required result | Must reject |
|---|---|---|---|
| NPC-REL-CONS-001 — Directionality | A → B has a supported value; B → A is unset or different | A's decision context uses only A → B for that requested pair | Copying or mirroring the value to B → A |
| NPC-REL-CONS-002 — Partial dimensions | Only trust is supplied; affection and hostility are omitted | Trust may inform the decision; omitted dimensions stay unknown/absent | Filling omitted dimensions with neutral or inferred values |
| NPC-REL-CONS-003 — Status separation | Inputs separately represent unset, explicit neutral, cleared, withheld, conflict, and unsupported | Each status produces its defined conservative consumer behavior | Collapsing statuses into zero, false, neutral, or one generic absence |
| NPC-REL-CONS-004 — No knowledge from state | A relationship value is visible but its cause is not in the actor's permitted knowledge | The actor may use only the permitted relationship input, not the unobserved cause | Inferring a secret, source, motive, or acquisition from trust/affection/hostility |
| NPC-REL-CONS-005 — Same event, different interpretation | Two NPCs have explicitly different profiles or authorized knowledge about the same event | Their candidate interpretations may differ and remain attributable to their inputs | Copying one NPC's belief to the other or inventing a missing motive |
| NPC-REL-CONS-006 — Co-presence is not a cause | Two characters share a scene repeatedly with no supported consequential trigger | No relationship transition is proposed solely from co-presence, scene length, or turn count | Automatic drift or fabricated accumulation |
| NPC-REL-CONS-007 — Duplicate evaluation | The same event and same rule/input versions are evaluated more than once | Pure evaluation is deterministic and does not itself accumulate state | Treating repeated presentation as a new event or commit |
| NPC-REL-CONS-008 — New acquisition about old event | A subject newly receives authorized evidence about a previously known event | Result is classified as a distinct reevaluation case under explicit policy | Silently replaying or overwriting a prior committed transition |
| NPC-REL-CONS-009 — No invented causal explanation | Candidate contains a narrative rationale but lacks a supported evidence reference | Candidate remains unsupported/insufficient or requires review | Treating rationale text as proof or inventing causal links |
| NPC-REL-CONS-010 — Capability unavailable | Relationship module/rule/read is absent, disabled, or incompatible | Relationship-dependent inference is omitted or marked unsupported | Fabricated neutral values, hidden fallback storage, implicit replay on re-enable |
| NPC-REL-CONS-011 — Player agency | Context includes relationship data for a player-controlled participant | The NPC may respond to established context but leaves player voluntary choices to the player | Authoring the player's thoughts, dialogue, decisions, consent, or actions |
| NPC-REL-CONS-012 — Read-only summary | A card/narrative/decision consumer receives a bounded projection | It can summarize only supplied authorized information and has no mutation effect | Treating generated prose/card edits as canonical state or evidence |
| NPC-REL-CONS-013 — Conduct is not relationship state | A publicly cooperative character has no established affection or loyalty value | The consumer does not infer hidden dimensions from conduct alone; any observer belief needs a valid evidence path | Treating conduct, concealment, or a social performance as proof of an internal dimension |

These tests should reuse the existing REL-MOD and NPC acceptance identifiers where they cover the same invariant; the new IDs are consumer-boundary traceability labels, not replacements for existing identifiers.

## 6. Acceptance-ID crosswalk — reuse before adding tests

The consumer cases above are traceability labels, not a second semantic acceptance system. Where an existing acceptance case already owns the invariant, implementation and reporting should cite that existing ID. Keep a consumer-specific case only where it tests a distinct NPC boundary or adds a negative assertion.

| Consumer case | Existing canonical case(s) to reuse | Additional consumer-specific assertion |
|---|---|---|
| NPC-REL-CONS-001 — Directionality | REL-SEM-001 | The NPC context selects the requested direction only |
| NPC-REL-CONS-002 — Partial dimensions | REL-SEM-002; REL-MOD-003 | Omitted dimensions do not leak into decision rationale |
| NPC-REL-CONS-003 — Status separation | REL-SEM-003; REL-MOD-008 where capability is unavailable | Consumer preserves the distinction and fails closed |
| NPC-REL-CONS-004 — No knowledge from state | REL-SEM-013; REL-MOD-002 | No secret/cause enters the NPC context without a valid acquisition path |
| NPC-REL-CONS-005 — Same event, different interpretation | REL-MOD-001 | Different candidates remain tied to explicit subject-specific inputs |
| NPC-REL-CONS-006 — Co-presence is not a cause | REL-SEM-004; REL-MOD-005 | No consumer-side drift from scene count or turns |
| NPC-REL-CONS-013 — Conduct is not relationship state | REL-MOD-004; REL-SEM-014 where an explanation is attempted | Public cooperation, hostility, or concealment is not proof of an unobserved dimension or its cause |
| Observed conduct is not internal relationship state | REL-MOD-004; REL-SEM-014 where an explanation is attempted | Public cooperation, hostility, or concealment is not proof of an unobserved dimension or its cause |
| NPC-REL-CONS-007 — Duplicate evaluation | REL-MOD-005 for no automatic drift; REL-MOD-001 only where different interpretations are in scope | Same explicit input/version yields the same pure candidate; commit idempotency remains a Core test |
| NPC-REL-CONS-008 — New acquisition about old event | NPC-CAUSE-007; NPC-CAUSE-008; acquisition contract in docs/50–51 | A new acquisition is not silently treated as a new event or an implicit rewrite |
| NPC-REL-CONS-009 — No invented causal explanation | REL-SEM-014; REL-MOD-010 only for the narrower alternative-support rule | Rationale text is not evidence and cannot create a causal link |
| NPC-REL-CONS-010 — Capability unavailable | REL-MOD-008; REL-SEM-003 | No neutral fallback, shadow store, or implicit catch-up |
| NPC-REL-CONS-011 — Player agency | REL-SEM-011 for access; REL-MOD-011 for agency | Relationship context cannot author voluntary player output |
| NPC-REL-CONS-012 — Read-only summary | REL-SEM-012; docs/46 card-summary contract | Summary generation/editing does not mutate canonical state |
| Rollback of required cause | REL-SEM-009; NPC-CAUSE-001 and NPC-CAUSE-006 | NPC context/card must not consume a stale projection after reconciliation |
| Alternative independent support | REL-SEM-010; NPC-CAUSE-002–005 | Fail closed unless sufficiency is explicitly established |
| Identity and self-pair validation | REL-SEM-007–008 | No entity creation or alias-based identity resolution |
| Rule/version compatibility | REL-MOD-012 | No silent reinterpretation of committed transitions |

### Test ownership and reporting

- **Relationship-domain pure tests** own candidate-transition semantics and World Pack rule validation.
- **NPC consumer tests** own bounded context use, status handling, no knowledge leakage, no player agency, and no fabricated rationale.
- **Core integration tests** own canonical identity, authorization, trusted origin, typed write, atomicity, idempotency, revision/audit, and production replay/rollback.
- **End-to-end tests** own consistency across committed state, authorized actor context, and card/narrative projection after reconciliation.

Do not report the same invariant as independently passed in multiple suites without identifying the different boundary each suite proves. A pure test and a production-path test for the same case are complementary, not interchangeable. A missing production interface is **blocked/unsupported**, not a failed mock test and not a pass.

## 7. Tests blocked on real Core interfaces

The following cannot be marked passing using mocks of missing production interfaces:

1. Actor/purpose authorization is applied before relationship data reaches NPC/model context.
2. Canonical participants are validated; unresolved names, missing IDs, cross-world references, and unauthorized self-pairs fail closed without entity creation.
3. Typed relationship writes are atomic across canonical state, event history, projection, revision, idempotency result, and audit.
4. Trusted author-initial/import/correction provenance cannot be spoofed by a caller-controlled label.
5. Read results preserve the approved status distinctions without leaking withheld-value existence.
6. Relationship projections after rollback/replay match deterministic reconstruction from surviving valid canonical transitions.
7. Stale snapshots/candidates cannot be silently committed or consumed as current.
8. Required dependencies and independent alternative support follow distinct approved semantics; the first-slice implementation must not invent OR-support.
9. Knowledge acquisition and relationship state remain separate before and after source invalidation.
10. Card and NPC contexts refresh or reject stale projections after reconciliation using a host-owned mechanism.

For each future production-path test, record the exact Core commit, interfaces actually exercised, canonical state and snapshot basis before/after, audit/revision effects, actor-authorized consumer output, and whether the behavior is passed, failed, or unsupported. A mocked seam is design evidence only.

## 8. Current cross-branch disposition

At the time of this review:

- Relationship PR #60 is a documentation-only module proposal; it is not runtime integration.
- Relationship PR #62 describes a separate isolated pure evaluator. The PR description reports that the prototype-sensitive dimension-key issue has been addressed on head `4814c43` and that GitHub Actions `Runtime tests` run #481 passed on that head, including safe handling of special dimension keys. This is evidence for the isolated evaluator suite only; it does not establish an NPC consumer, Core authorization, canonical writes, provenance, or rollback integration. The earlier `{ status: "unset" }` normalization inconsistency was resolved by consistently rejecting that tagged input shape and using the documented absent-key / `null` representation. The evaluator's internal shape remains neither a Core API nor a storage/wire contract.
- Core's first-slice relationship replay boundary is documented separately; it does not establish that typed relationship writes, actor-authorized reads, trusted provenance, or relationship projection/replay are implemented.
- NPC relationship documents define consumer and rollback gates but do not supply the missing Core-owned capabilities.

Therefore, NPC can proceed with semantic consumer tests and contract traceability. It must not claim full integration readiness, introduce a shadow relationship store, change the Relationship branch, or work around missing Core interfaces with generic facts or prompt-only policy.

## 9. Readiness decision

**Consumer semantics:** ready for independent pure tests and review.

**Relationship runtime consumption:** blocked until a real, authorized, consistent Core projection exists.

**Canonical relationship mutation:** Core's privileged admin-authored typed operation, atomic commit/audit/idempotency, and rollback/replay path are now implemented and tested in PRs #94–#96. NPC/model-initiated mutation remains blocked: no non-admin capability or actor/purpose authorization contract is available. General actor-authorized Relationship reads and safe card projection also remain blocked.

**Independent alternative support:** explicitly unsupported in the first slice unless a separately approved domain sufficiency rule and Core-owned representation/reducer or deterministic replay contract establish it.

No Core question is raised by this document. If a later implementation decision requires Core-owner input, route the precise question through the project owner rather than contacting the Core discussion directly.


## 10. Executable test-seam audit (2026-10-24)

A repository tree inspection was performed on `feat/npc-subsystem` and compared with `main`.

Observed branch contents:

- `src/application/` contains `engine.js` and `proposals.js`.
- `src/core/` contains errors, mechanics, request hashing, and rules modules.
- The branch's `tests/` directory contains API, core, causality-contract, mechanics-registry, and mechanics-schema tests.
- No NPC-specific runtime module, relationship-consumer module, bounded relationship projection, or corresponding NPC consumer test file is present in the inspected tree.
- `main` has additional actor-binding, snapshot-read, tri-state, and mechanic-evaluation tests, but these are Core/runtime tests, not an NPC relationship-consumer implementation.

### Decision

**Do not add NPC-REL-CONS tests as if a production consumer already exists.** There is currently no actual NPC consumer function to exercise. Writing tests around a locally invented interface, a mock of the absent projection, or a new shadow relationship data model would only prove the test author's assumptions and would violate the boundary in this document.

The current executable evidence is limited to existing Core tests and the isolated Relationship evaluator suite cited above (the PR description reports head `4814c43`, run #481 green). Neither is an NPC consumer pass. The earlier prototype-sensitive-key review finding is reported as addressed, but the evaluator still has no Core read/write authority and no NPC production consumer. The 13 NPC-REL-CONS cases remain specified semantic acceptance criteria, not implemented or passing tests.

### What can proceed without a new Core contract

1. Keep the acceptance-ID crosswalk and use it when a real consumer seam is introduced.
2. Review existing Core tests only for directly relevant invariants; do not relabel their results as NPC acceptance.
3. When an actual NPC consumer boundary is added under an approved design, implement pure tests against that real function for directionality, omitted dimensions, status separation, no knowledge leakage, conduct-vs-state, read-only summaries, and player agency.
4. Keep actor/purpose authorization, trusted provenance, canonical writes, stale projection rejection, and rollback/replay marked blocked until production interfaces exist and are exercised.

No runtime code, public API, schema, Core implementation, or Relationship branch was changed by this audit.


## Core runtime status refresh (2026-10-24)

The admin-only typed writer `relationship.transition` and directed projection/rebuild are on main through PRs #94–#96. The operation does not establish that either participant knows the transition, does not expose Relationship state to NPC consumers, and does not implement alternative independent-support semantics. NPC must treat reads and narrative use as blocked until a trusted recipient/purpose/field visibility boundary and currentness/revalidation semantics exist.