# Relationship Module — Acceptance Traceability and Test Plan

Status: **documentation-only test plan**. These rows define test intent and prerequisites; they are not executable tests and do not claim runtime behavior. This plan supplements `docs/46-relationship-domain-module-design.md` and preserves the existing PERS-SEM identifiers.

## 1. Test layers

| Layer | What it can prove | What it cannot prove |
|---|---|---|
| Domain-rule unit tests | Given a bounded, already-authorized input, the relationship rule selects only justified dimensions and produces deterministic candidate outcomes | Canonical persistence, authorization, provenance, revision/audit, rollback, or real actor knowledge |
| World Pack validation tests | A dimension definition declares its value domain, neutral semantics, transition policy, visibility notes, conflict policy, and acceptance cases | Core enforcement unless the real Core path invokes the validator |
| NPC-consumer contract tests | A consumer treats relationship data as one input, respects direction and actor-specific knowledge, and does not author player agency | Whether the data was correctly filtered or canonically committed |
| Core integration tests | The approved typed operation enforces identity, direction, partial updates, provenance, authorization, atomicity, revision/audit, and replay/rollback on the real path | Unspecified domain meaning or author intent |
| End-to-end tests | A committed event, actor-specific context, and presentation remain consistent through the supported pipeline | Behavior for capabilities that remain unsupported or disabled |

A mock may be used for pure domain tests only when its boundary is explicit. A mock of a missing Core interface must never be reported as proof of integration readiness.

## 2. Minimal synthetic fixture

Use only synthetic entities and facts; do not depend on a game setting or real personal data.

### Participants and context
- Entity A and entity B are existing canonical entities in one test world.
- Entity C is the actor whose action causes event E.
- E is canonical and visible to A and B, but any private motive M is available only to A through a valid acquisition path.
- A's authored profile values loyalty and has a known prior commitment to C.
- B's authored profile values independence and has a previously established boundary against unilateral control.
- No unstated motive, prior event, or relationship value is allowed in the fixture.

### Initial directed relationship state
- A → C: trust is established; affection is unset.
- B → C: hostility is established; trust is unset.
- C → A and C → B are deliberately different and must not be inferred from the reverse directions.
- One unrelated dimension is set to an explicit neutral value by the test World Pack, so tests can distinguish neutral from unset.
- The fixture must identify which values are authored initial conditions and which, if any, were established by in-world events. Do not simulate trusted origin by a caller-supplied string.

This fixture is a test design only. It is not a proposed storage schema or an assertion that these records can currently be committed through production APIs.

## 3. Case-to-test traceability

| Case ID | Test layer | Required assertion | Runtime status |
|---|---|---|---|
| REL-MOD-001 — Same event, different interpretation | Domain + NPC consumer | A and B may produce different candidate transitions from the same E when their established values/knowledge differ; no copied interpretation or invented motive | Domain specification; runtime integration not implemented/verified |
| REL-MOD-002 — Unequal knowledge | NPC consumer + authorized read | A may use M; B cannot use M; no secret appears in B's relationship context | Blocked on actor/purpose-authorized Core read and knowledge contract |
| REL-MOD-003 — Contradictory dimensions | Domain | A trust update leaves attachment, hostility, suspicion, and other omitted dimensions unchanged | Domain specification; typed write not verified |
| REL-MOD-004 — Conduct hides state | Domain + NPC consumer | Public cooperation is not used as proof of affection or loyalty; any observer belief requires a valid information path | Domain/consumer contract; acquisition boundary dependency |
| REL-MOD-005 — No automatic drift | Domain | Scene count and elapsed turns alone produce no candidate transition | Domain specification |
| REL-MOD-006 — Repair is dimension-specific | Domain + World Pack validation | Repair affects only dimensions explicitly permitted by the configured repair rule; prior history is not erased | Domain specification; domain repair policy must be authored |
| REL-MOD-007 — Irreversibility is explicit | World Pack validation + domain | No irreversible lock is created without an explicit rule or author decision | Domain specification; author-correction boundary still open |
| REL-MOD-008 — Disabled capability | Consumer contract + mechanic lifecycle | Unavailable capability is not translated to neutral; disabling does not delete canonical history | Lifecycle exists generally; relationship execution/consumer behavior unverified |
| REL-MOD-009 — Unsupported Core write | Core integration | No canonical state mutation when typed operation or trusted provenance is unavailable; no fallback store | Blocked on typed write/provenance contracts |
| REL-MOD-010 — No invented OR rule | Core rollback + domain | Remaining source is not treated as sufficient without an explicit domain sufficiency rule and Core representation | Blocked/deferred; multi-source reconciliation unimplemented/unspecified |
| REL-MOD-011 — Player agency | NPC consumer | Relationship context never authors player voluntary dialogue, thought, decision, or action | Semantic requirement; runtime boundary must be verified |
| REL-MOD-012 — Versioned semantics | Mechanic/World Pack lifecycle + Core replay | New version does not silently reinterpret previously committed transitions | Blocked on approved historical version/replay policy |

## 4. Current executable pure-evaluator coverage

The standalone evaluator in PR #62 is deliberately narrower than the full module contract. The following map records what its current unit suite actually exercises; it does not upgrade any consumer/Core requirement to implemented status.

| Requirement | Current pure-evaluator coverage | Boundary / remaining work |
|---|---|---|
| Directed relationship and no implicit reciprocity | Covered: output retains subject/target direction and contains no reciprocal patch | Real storage/read/write direction still requires Core integration tests |
| Partial patch and dimension isolation | Covered: omitted dimensions are omitted; a mixed valid/invalid patch is rejected as a whole | Full canonical-state atomicity remains unverified |
| Unset vs explicit value vs cleared | Covered, including explicit transition rules and no-op clear of unset/already-cleared | Authorized reads must preserve these distinctions in production |
| Withheld/conflict/insufficient/unsupported states | Covered at evaluator input/evidence boundary | Does not prove access-control or non-disclosure behavior |
| Explicit domain transition rules and version pin | Covered for the supplied rule object and required version label | World Pack loading/version lifecycle and historical replay are not implemented here |
| Malformed state/rule/input rejection | Covered for tagged-state shapes, out-of-domain values, transition-source declarations, undeclared transition fields, accessor-backed records/arrays, sparse arrays, and non-enumerable patch dimensions | Upstream parser/schema validation remains a separate boundary; Proxy objects are outside the evaluator's in-process input contract |
| Deterministic repeat evaluation | Covered: identical bounded input produces the same non-mutating result | This is **not** duplicate-event/idempotency coverage; the evaluator has no event identity and can return the same candidate again. Host/NPC/Core must prevent duplicate canonical commits |
| Same event, different actor interpretation | Not directly covered by current function signature | Requires subject-specific authorized knowledge/profile inputs and NPC consumer tests |
| Unequal knowledge and hidden information | Not covered by pure evaluator tests | Requires acquisition/delivery and actor/purpose-authorized read tests |
| Conduct vs internal relationship | Not covered by current evaluator API | Must remain separate in NPC/narration consumers |
| Repair, irreversible transitions, disabled lifecycle | Only explicit generic transitions are tested; no dedicated repair/irreversibility/lifecycle policy is implemented | Requires authored World Pack rules and mechanic lifecycle/consumer tests |
| Alternative-source sufficiency and rollback | Not covered | Blocked until the domain sufficiency rule and Core-owned support/replay contracts are approved |
| Player agency | Not covered by evaluator unit tests | Requires NPC consumer boundary tests |
| Version changes across committed history | Only the rule-version label on a candidate is tested | Requires explicit historical version/replay policy and Core tests |

This table is an implementation trace, not a claim that the full acceptance suite has passed. The pure evaluator must remain a candidate producer; missing context or host capability must not be simulated as a successful integration.

## 5. Cross-block semantic crosswalk

The Relationship module cases are distinct from NPC, Personality, and pre-existing relationship acceptance IDs. The links below identify shared acceptance concerns, not proof that one case satisfies another. `NPC-SEM-*` IDs remain owned by the NPC subsystem; `PERS-SEM-*` IDs remain owned by the Personality semantic matrix; `REL-SEM-*` IDs remain in the existing NPC/Relationship contract set. This table supplements, and does not replace, any source matrix.

| Relationship case | Related acceptance IDs | Relationship-specific distinction |
|---|---|---|
| REL-MOD-001 — Same event, different interpretation | NPC-SEM-007; NPC-SEM-017; PERS-SEM-015; PERS-SEM-017 | Actor-specific reactions and traits that influence rather than dictate behavior are shared concerns; REL-MOD-001 additionally requires distinct relationship candidates from the same event without copying an interpretation or inventing motives. |
| REL-MOD-002 — Unequal knowledge | NPC-SEM-001; NPC-SEM-015; PERS-SEM-018; PERS-SEM-026 | Secret exclusion, relationship-does-not-imply-knowledge, and withheld-versus-unset are upstream requirements; relationship output must also avoid exposing or inferring a hidden stance/motive. |
| REL-MOD-003 — Contradictory dimensions | NPC-SEM-016; NPC-SEM-017; PERS-SEM-002; PERS-SEM-005 | Coexisting dimensions and dimension isolation are shared semantics; the Relationship evaluator must leave every omitted dimension untouched. |
| REL-MOD-004 — Conduct hides state | NPC-SEM-002; NPC-SEM-007; PERS-SEM-017; PERS-SEM-020 | Belief and actor-specific reaction are related but do not make outward conduct proof of internal relationship state or proof of its cause. |
| REL-MOD-005 — No automatic drift | NPC: `NPC-SEM-012`; existing relationship contract: `REL-SEM-004`; Personality: `PERS-SEM-008` | Chat turns do not advance world time, and co-presence alone does not justify change; neither permits scene-count or elapsed-turn drift. |
| REL-MOD-006 — Repair is dimension-specific | NPC-SEM-017; PERS-SEM-005; PERS-SEM-007 | Proportionate change, dimension isolation, and explicit transition constraints are shared; repair also needs an authored rule that identifies which dimensions may change and preserves history. |
| REL-MOD-007 — Irreversibility is explicit | No direct equivalent identified | Requires a Relationship/World Pack rule or explicit author decision; do not infer irreversible locks from a general NPC case. |
| REL-MOD-008 — Disabled capability | No direct equivalent identified | Requires optional-mechanic lifecycle and consumer behavior; absence/disabled state must not become neutral and history must remain intact. |
| REL-MOD-009 — Unsupported Core write | NPC: `NPC-SEM-008`, `NPC-SEM-010`; existing relationship contract: `REL-SEM-005`–`REL-SEM-007`; Personality: `PERS-SEM-006`, `PERS-SEM-007`, `PERS-SEM-009`, `PERS-SEM-010`, `PERS-SEM-013` | Rejected operations and missing source data must not create canon; Relationship also depends on typed directional writes, trusted provenance, domain validation, and resolved canonical participants. |
| REL-MOD-010 — No invented OR rule | NPC-SEM-003; NPC-SEM-009; PERS-SEM-021; PERS-SEM-022; PERS-SEM-023; PERS-SEM-024 | Required-dependency rollback, alternative-support sufficiency, conflict/insufficient support, and deterministic replay are related; relationship sufficiency still requires an explicit domain rule plus Core-owned reconciliation. |
| REL-MOD-011 — Player agency | NPC-SEM-011; PERS-SEM-028 | Shared player-agency boundary; relationship context must not author player voluntary dialogue, thought, decisions, or actions. |
| REL-MOD-012 — Versioned semantics | NPC-SEM-009; NPC-SEM-020; PERS-SEM-024; Personality versioning contracts | Causal reconciliation, deterministic replay, and persistence of significant information are adjacent concerns, not a historical relationship-rule migration policy. Old transitions require explicit version pinning or an approved migration/replay rule. |

No NPC acceptance ID is treated as a substitute for a Relationship test. Cross-block coverage is complete only when the relevant real consumer/Core boundary exists and its tests run against that boundary; documentation links alone do not satisfy the acceptance case.

## 6. Required negative tests when the Core interfaces exist

The first real integration suite must include at least:

1. **Direction:** update A → B; verify B → A is unchanged.
2. **Partial update:** update one dimension; verify all omitted dimensions are unchanged.
3. **Identity:** reject missing, cross-world, and unresolved participant IDs without creating entities.
4. **Self-pair:** reject unless the active domain explicitly permits it.
5. **Unset/neutral/clear/withheld:** prove the real read boundary distinguishes each supported outcome and does not reveal existence through a withheld result.
6. **Unknown dimension/value/transition:** reject atomically with no event, revision, projection, or audit partial write.
7. **Provenance spoofing:** caller cannot self-authorize initial/import/correction origin by supplying a label.
8. **Actor separation:** one actor's authorized relationship view cannot expose another actor's private stance or inaccessible dimension.
9. **Knowledge separation:** trust or affection does not grant knowledge of a secret.
10. **Replay/rollback:** compare the current projection with deterministic rebuild from valid canonical history.
11. **Required dependency:** rolling back a required source invalidates/reconciles only the transitions that actually depend on it under the approved contract.
12. **Alternative support:** do not run a passing test until a domain sufficiency rule and Core-owned alternative-support representation/reducer are approved; then test removal of one support, removal of all supports, duplicate source, conflicting sources, and insufficient evidence.
13. **Atomicity:** force a supported failure during commit/projection/audit and verify no partial canonical mutation.
14. **Disabled module:** no new relationship transitions are evaluated while disabled; existing canonical state and audit history remain.
15. **Version pinning:** old committed transitions retain their declared semantic version or follow an explicit, tested migration policy.

Do not replace any of these with a mocked “successful” path when the corresponding production contract is absent.

## 7. Exit criteria

### Domain specification can be reviewed when
- every supported World Pack dimension fills the required template in `docs/personality/05-world-pack-relationship-dimension-template.md`;
- every transition rule states affected dimensions, prerequisites, non-implications, and failure/unknown behavior;
- REL-MOD cases are linked to a concrete pure-domain or consumer boundary;
- the test fixture contains no unstated canonical facts, hidden motives, or fabricated history.

### Runtime integration can be called ready only when
- Core approves the exact typed relationship operation and validates it on the real commit path;
- trusted initialization/import/correction provenance and authorization are verified;
- actor/purpose-scoped authorized reads are implemented and tested before data reaches a model or player-facing projection;
- the supported replay/rollback subset is explicitly bounded and tested;
- any alternative-source case used in production has an approved domain sufficiency rule and Core-owned reconciliation implementation;
- all applicable negative tests above pass against the actual production interfaces.

Until these criteria are met, status remains **specified / integration blocked**, not implemented.
