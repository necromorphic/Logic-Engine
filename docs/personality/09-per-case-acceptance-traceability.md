# Personality Block — Per-Case Acceptance Traceability

Status: documentation-only crosswalk. “Specified” means expected behavior is documented; it does not mean an executable test exists or passed. Runtime claims require evidence from the approved production boundary.

Primary references:
- `01-personality-and-relationship-semantics.md`: semantic invariants.
- `03-core-decision-and-integration-gates.md`: Core-owned contracts and blockers.
- `04-semantic-acceptance-matrix.md`: canonical PERS-SEM IDs and scenarios.
- `05-world-pack-relationship-dimension-template.md`: dimension and transition rules.
- `06-stable-trait-lifecycle.md`: PERS-TRAIT criteria.
- `07-cross-block-readiness-and-handoff.md`: integration readiness.
- `08-semantic-traceability-and-review-workflow.md`: status vocabulary and review process.

## PERS-SEM case crosswalk

| ID | Primary reference | Closure owner / boundary | Specification status | Runtime status |
|---|---|---|---|---|
| PERS-SEM-001 | 01 §4 | Personality semantics; Core typed write | Specified | Blocked: typed write unverified |
| PERS-SEM-002 | 01 §4; 05 §2 | Personality patch meaning; Core operation | Specified | Blocked: atomic partial update unverified |
| PERS-SEM-003 | 01 §4; 05 §3 | Personality meaning; Core representation | Specified: unset (sometimes called unknown in this narrow sense) differs from neutral; conflict/insufficient-support unknown is separately defined by PERS-SEM-023 | Blocked: production representation unverified |
| PERS-SEM-004 | 01 §4; 05 §3; 03 integration gates | Personality meaning; Core history/read authorization and representation | Specified: clear removes effective value while authorized history distinguishes explicit removal from never-set; exact representation unresolved | Blocked: typed write/read and disclosure policy unverified |
| PERS-SEM-005 | 05 §4 | Personality / World Pack | Specified as default non-implication | World-specific rule per dimension still required |
| PERS-SEM-006 | 05 §§2, 6 | World Pack validation; Core enforcement | Specified | Blocked: production validation unverified |
| PERS-SEM-007 | 05 §§2, 5 | World Pack transition policy; Core atomic rejection | Specified | Blocked: validation/atomicity unverified |
| PERS-SEM-008 | 01 §4 | Personality semantic rule | Specified | No runtime claim |
| PERS-SEM-009 | 01 §4; 03 identity gate | Core identity and typed write | Specified | Blocked: identity enforcement unverified |
| PERS-SEM-010 | 01 §4; 05 §2 | Core identity; World Pack domain rule | Specified; domain opt-in only | Blocked pending production path |
| PERS-SEM-011 | 01 §4.1; 03 provenance gate | Core trusted provenance operation | Specified | Blocked: trusted boundary unresolved |
| PERS-SEM-012 | 01 §4.1; 06 §6 | Core-authorized correction/audit | Specified | Blocked: authorization/audit unverified |
| PERS-SEM-013 | 03 provenance/authorization gates | Core authorization | Specified | Blocked: caller label alone is not authorization |
| PERS-SEM-014 | 06 §§2–3 | Personality lifecycle semantics | Specified | No runtime trait-mutation claim |
| PERS-SEM-015 | 01 §3; 06 §§5, 7 | Personality semantics; NPC decision use | Specified | Consumer behavior not verified here |
| PERS-SEM-016 | 06 §4 | Personality lifecycle semantics | Specified | No automatic profile rewrite claimed |
| PERS-SEM-017 | 01 §3; 06 §5 | Personality semantics; NPC/narrative boundary | Specified | No runtime inference claim |
| PERS-SEM-018 | 01 §§4–5; 05 §4 | Personality non-implications; knowledge boundary | Specified | Authorized consumer read remains blocked |
| PERS-SEM-019 | 01 §4; 05 §§2, 4 | Personality / World Pack semantics | Specified | Domain rules must keep relationship and consent distinct |
| PERS-SEM-020 | 01 §§4, 6; 05 §2 | Personality semantics; Core provenance/causality | Specified | Production provenance evidence blocked |
| PERS-SEM-021 | 01 §6; 03 rollback gate | Core dependency rollback/rebuild | Target specified | Relationship replay unverified |
| PERS-SEM-022 | 04 §4; 05 §§2–3 | Core causal representation; World Pack sufficiency rule | Conditional; source IDs alone insufficient | Blocked/deferred beyond proven replay-only subset |
| PERS-SEM-023 | 04 §2; 05 §§2–3 | Core reconciliation; World Pack conflict policy | Specified: conflict/unknown is a reconciliation/read result, not a dimension value unless domain-defined | Conflict reconciliation unverified |
| PERS-SEM-024 | 04 §4; 03 rollback gate | Core deterministic projection/replay | Target limited to replay-reconstructible state | Production-boundary test unverified |
| PERS-SEM-025 | 01 §5; 03 authorized-read gate | Core actor/purpose-authorized read | Specified | Blocked: snapshot is not authorization |
| PERS-SEM-026 | 05 §3; 03 authorized-read gate | Core safe read-result semantics | Specified | Blocked: withheld/unset distinction unverified at runtime |
| PERS-SEM-027 | 01 §§2, 4; 07 handoff | Core/card projection; authorized canonical read | Derived/read-only target specified | Safe authorized projection unverified |
| PERS-SEM-028 | 01 §3; 06 §7 | Player-control contract; Personality/NPC must respect it | Specified | No runtime player-control test claimed |
| PERS-SEM-029 | 05 §§2, 5–6; 03 rollback/version integration boundary | World Pack semantic version policy; Core for any version pinning/migration/replay enforcement | Specified: meaning-changing rules require explicit compatibility/migration or incompatibility handling; no Core mechanism is assumed | Blocked: historical rule-version pinning/migration and production replay policy unverified |

## Synthetic boundary regression scenarios (reuse existing IDs)

The scenarios below operationalize existing criteria; they intentionally introduce no new acceptance IDs. They are specifications for test design, not reports of executed tests.

| Existing ID(s) | Input / action | Expected result | Test layer | Not proven by this layer |
|---|---|---|---|---|
| PERS-SEM-006, 007 | Evaluate keys `__proto__`, `constructor`, and `prototype` as separate keys and as members of a mixed patch. | Accept only if each is explicitly declared/supported; otherwise reject without inherited-property acceptance, prototype mutation, or silent normalization. | Pure evaluator/security regression | Core persistence, authorization, or atomic commit |
| PERS-SEM-002, 004, 005 | Clear one established dimension while another is omitted and already has a value. | The requested dimension is cleared under its explicit rule; omitted dimensions remain unchanged. | Pure patch semantics | Canonical clear history/provenance and safe read |
| PERS-SEM-006, 007 | Submit a patch with two valid changes and one unsupported key/value/transition. | Reject the whole candidate/operation; never return a partially accepted patch as if it were the requested operation. | Pure evaluator | Atomicity of a real canonical write |
| PERS-SEM-001, 005; PERS-REL-001 | Change A→B while B→A has a different existing value. | Only A→B changes; the reverse direction remains untouched. | Pure domain plus directed-pair fixture | Correct direction persisted by Core |
| PERS-SEM-003, 004, 023, 026 | Compare absent key, explicit neutral, explicit clear, withheld read, and conflict/insufficient-support result. | Preserve the semantic distinctions; a withheld result does not disclose whether a value exists. | Synthetic contract/read-result test | Actual authorized read and canonical history |
| PERS-SEM-014, 016; PERS-REL-009 | Change a relationship dimension while the character has stable traits. | No stable trait changes unless a separately declared and authorized trait-lifecycle rule applies. | Personality semantic/consumer fixture | Runtime consumer behavior or canonical trait persistence |
| PERS-SEM-017, 020; PERS-REL-010 | Provide behavior that is consistent with multiple motives or contradicts a stable trait. | Behavior is not treated as proof of motive, inner state, or causal relationship fact. | Consumer/NPC interpretation test | Production NPC decision path unless exercised directly |
| PERS-SEM-018, 025, 026; PERS-REL-011, 015 | Give an NPC a relationship value but omit a separate fact from its authorized knowledge context; separately test a withheld value. | The relationship does not grant knowledge; withheld is not interpreted as unset. | NPC consumer test with explicit knowledge/read fixtures | Production authorization/filtering |
| PERS-SEM-019; PERS-SEM-005; PERS-REL-011 | Provide attraction/trust without an explicit consent, obligation, or reciprocity rule. | No consent, obligation, or reciprocal state is inferred. | Pure semantic/consumer test | Any World Pack-specific cross-dimension rule not supplied in the fixture |
| PERS-SEM-008, 020; REL-MOD-005 | Re-evaluate the same inputs/event without new causal evidence. | Repetition or co-presence alone creates no new relationship transition or causal explanation. Deterministic, side-effect-free evaluation is pure-evaluator evidence only. | Pure-domain/evaluator test | Canonical commit idempotency, event identity, or event deduplication |
| REL-MOD-015 (cross-block; no direct PERS-SEM ID) | Acquire new knowledge about an already-existing canonical event, then exercise the approved acquisition/re-evaluation boundary. | Knowledge acquisition alone must not create a duplicate canonical event or silently rewrite a previously committed transition; any re-evaluation follows an explicit acquisition contract. | Required NPC/Core integration test design; not evidenced by the pure evaluator | No production-boundary executable test found; blocked on NPC acquisition and Core event identity/deduplication, correction, versioning, and replay contracts. See `12-relationship-crosswalk-correction.md`.
| PERS-SEM-024, 029; REL-MOD-012 | Replay the same history with identical pinned inputs/version; then test a historical transition after a meaning-changing version update. | Fixed-input replay is deterministic where supported; historical replay does not silently substitute latest semantics. | Fixture/unit test only if version selection is explicit | Actual Core version pinning, migration, replay, and rollback |
| PERS-SEM-029 | Supply either an explicit migration plan or an explicit incompatibility declaration for a meaning-changing update. | No implicit migration; incompatibility blocks automatic reinterpretation. | World Pack authoring/validation test | Correct migration of persisted historical state |

## PERS-TRAIT case crosswalk

These IDs are defined in `06-stable-trait-lifecycle.md`; this crosswalk makes each criterion individually traceable without implying runtime support.

| ID | Primary reference | Closure owner / boundary | Specification status | Runtime status |
|---|---|---|---|---|
| PERS-TRAIT-001 | 06 §2 | Personality lifecycle semantics | Specified | Not runtime-tested |
| PERS-TRAIT-002 | 06 §§2, 5 | Personality semantics; evidence versus canonical trait | Specified | Not runtime-tested |
| PERS-TRAIT-003 | 06 §§3–4 | Personality lifecycle; no undeclared auto-update rule | Specified | Not runtime-tested |
| PERS-TRAIT-004 | 06 §6; 03 §5 | Core-authorized correction, provenance, audit | Specified | Integration blocked |
| PERS-TRAIT-005 | 06 §§4–5 | Personality semantics; inference remains non-canonical | Specified | Not runtime-tested |
| PERS-TRAIT-006 | 06 §§3–4 | Personality semantics; World Pack/runtime capability boundary | Specified | No development operation claimed |
| PERS-TRAIT-007 | 06 §§3, 7 | Personality semantics; context-sensitive manifestation | Specified | Not runtime-tested |
| PERS-TRAIT-008 | 06 §7; 01 §3 | Project player-control contract; Personality/NPC must respect it | Specified | No runtime player-control test claimed |
| PERS-TRAIT-009 | 06 §7; 03 §4 | Core actor/purpose-authorized read | Specified | Integration blocked |
| PERS-TRAIT-010 | 06 §8; 03 §6 | Core rollback/rebuild for supported trait-development event | Conditional target | Integration blocked |
| PERS-TRAIT-011 | 06 §§2, 7 | Personality category semantics; underlying record support where applicable | Specified | Classification boundary not runtime-tested |
| PERS-TRAIT-012 | 06 §§2, 9 | Authoring/review boundary; preserve unresolved ambiguity | Specified | Authoring workflow not runtime-tested |
| PERS-TRAIT-013 | 06 §§5, 9 | Personality semantics; author review for consequential unresolved conflict | Specified | No automatic motive inference claimed |

## Legacy relationship acceptance-ID crosswalk

The semantic contract in `01-personality-and-relationship-semantics.md` also retains the older `PERS-REL-001–016` identifiers. These IDs are not deleted or renumbered; use the following crosswalk when tracing older references to the current `PERS-SEM` matrix.

| Legacy ID | Current semantic acceptance ID(s) | Meaning |
|---|---|---|
| PERS-REL-001 | PERS-SEM-001 | Directionality |
| PERS-REL-002 | PERS-SEM-002 | Partial update |
| PERS-REL-003 | PERS-SEM-003 | Unknown versus neutral |
| PERS-REL-004 | PERS-SEM-008 | Co-presence alone causes no transition |
| PERS-REL-005 | PERS-SEM-011 | Initialization/import provenance |
| PERS-REL-006 | PERS-SEM-012 | Author-correction provenance |
| PERS-REL-007 | PERS-SEM-009 | Canonical participant identity |
| PERS-REL-008 | PERS-SEM-010 | Self-relationship policy |
| PERS-REL-009 | PERS-SEM-014, PERS-SEM-016 | Stable-trait lifecycle and no automatic rewrite |
| PERS-REL-010 | PERS-SEM-015, PERS-SEM-017 | Context-sensitive behavior and non-canonical inference |
| PERS-REL-011 | PERS-SEM-018 | Relationship does not grant knowledge |
| PERS-REL-012 | PERS-SEM-027 | Character card is derived/read-only |
| PERS-REL-013 | PERS-SEM-021 | Required-dependency rollback |
| PERS-REL-014 | PERS-SEM-022, PERS-SEM-023 | Independent support and conflict/insufficiency |
| PERS-REL-015 | PERS-SEM-025, PERS-SEM-026 | Authorized reads and withheld-versus-unset |
| PERS-REL-016 | PERS-SEM-028 | Player agency |

The legacy IDs remain valid aliases for traceability, not additional scenarios that supersede the PERS-SEM matrix. If the semantic outcome changes, update the canonical PERS-SEM case and this mapping together.


## Relationship-module case crosswalk (REL-MOD)

This crosswalk links the Relationship module's proposed `REL-MOD-*` cases to the existing canonical Personality acceptance cases. It is a documentation-only traceability aid: it does not transfer ownership, replace IDs, or imply that runtime tests exist or pass. Relationship case definitions are in `docs/47-relationship-module-test-traceability.md` on the Relationship proposal branch.

| Relationship case | Related Personality acceptance case(s) | Why they are related | Boundary / status note |
|---|---|---|---|
| REL-MOD-001 — Same event, different interpretation | PERS-SEM-014, 015, 017, 020; PERS-SEM-018 where unequal knowledge is involved | Stable traits shape but do not dictate interpretation; inferred motives are not canonical facts; relationship value alone does not prove cause; knowledge is actor-specific | Domain/NPC semantics can be specified independently; production knowledge filtering remains blocked on authorized reads |
| REL-MOD-002 — Unequal knowledge | PERS-SEM-018, 025, 026 | Relationship does not grant knowledge; actor/purpose authorization and withheld-versus-unset behavior must be preserved | Blocked on production authorized-read and knowledge-acquisition contracts |
| REL-MOD-003 — Contradictory dimensions | PERS-SEM-005, 002, 006, 007 | Dimensions remain isolated; partial updates preserve omitted dimensions; unsupported values/transitions must be rejected | Domain semantics specified; typed write/atomic validation not verified |
| REL-MOD-004 — Conduct hides state | PERS-SEM-017, 020, 018 | Conduct or narrative presentation is not relationship state, proof of cause, or automatic knowledge transfer | Domain/consumer boundary; acquisition and authorized-read dependencies remain |
| REL-MOD-005 — No automatic drift | PERS-SEM-008, 020 | Scene count/co-presence alone cannot cause a transition; repeated evaluation is not new causal evidence | Pure-domain target; no runtime claim |
| REL-MOD-006 — Repair is dimension-specific | PERS-SEM-005, 006, 007 | Repair rules may affect only declared dimensions and supported transitions; no universal reset is implied | Requires authored World Pack repair semantics; production enforcement unverified |
| REL-MOD-007 — Irreversibility is explicit | PERS-SEM-012, 021, 022, 024 | Author correction, causal dependencies, independent support, and replay must follow explicit policies | Core causal/correction contracts remain blocked or deferred as stated in the canonical matrix |
| REL-MOD-008 — Disabled capability | No direct one-to-one PERS-SEM case; related to PERS-SEM-006 and 007 only where disabling makes a rule/capability unavailable | Unavailable capability must not be silently replaced with a fabricated neutral value or unsupported transition | Relationship lifecycle/consumer contract; no direct canonical PERS-SEM equivalent should be invented |
| REL-MOD-009 — Unsupported Core write | PERS-SEM-001, 002, 006, 007, 011, 013 | Direction, partial update, domain validation, trusted provenance, and atomic rejection depend on the approved Core write boundary | Blocked on typed operation, provenance, authorization, and atomicity evidence |
| REL-MOD-010 — No invented OR rule | PERS-SEM-021, 022, 023, 024 | Required dependency, independent support, conflict/insufficiency, and replay have distinct semantics | PERS-SEM-022 remains deferred; source IDs alone do not prove independent sufficient support |
| REL-MOD-011 — Player agency | PERS-SEM-028 | Relationship context must not author voluntary player dialogue, thoughts, decisions, or actions | Semantic requirement specified; runtime consumer boundary not verified |
| REL-MOD-012 — Versioned semantics | PERS-SEM-029; PERS-SEM-024 where deterministic replay is relevant; PERS-SEM-006 and 007 where rule/version validation is relevant | PERS-SEM-029 is the direct Personality criterion for meaning-changing World Pack rules; PERS-SEM-024 covers replay determinism only within its stated limits, while PERS-SEM-006/007 cover active-domain validation rather than historical version pinning | Historical version pinning/migration and production replay policy remain blocked |

### Crosswalk maintenance rules

- Keep `REL-MOD-*` and `PERS-SEM-*` identifiers stable; the mapping is many-to-many, not a renumbering scheme.
- A relationship case may have no direct Personality case. Do not manufacture a semantic ID just to force one-to-one coverage.
- A shared case reference does not transfer ownership: Core closes Core contracts, Personality owns personality semantics, the World Pack declares world-specific dimensions/rules, and NPC owns decision orchestration/consumer behavior.
- Update this crosswalk only when the source case or its expected outcome changes. Keep specification status separate from implementation and test evidence.


## Executable-evidence crosswalk (Issue #73; audited 2026-10-24)

This section records concrete repository evidence observed on the named branches. A file path is evidence that a test exists, not evidence that this audit executed it or that CI is green. The Relationship evaluator is a separate pure-domain boundary; it is not a Core write/read implementation.

| Existing semantic case(s) | Concrete test or contract reference | What that evidence covers | Remaining status / blocker |
|---|---|---|---|
| PERS-SEM-002, 004, 005, 006, 007 | `feat/relationship-pure-evaluator:tests/relationship-evaluate-candidate.test.js` — tests “clearing one dimension leaves every other dimension outside the candidate patch”, “uses an explicit clear operation, not omission or a sentinel value”, “rejects clearing where the active dimension rule disallows it” | Pure candidate patch semantics: clear is explicit, omitted dimensions are excluded, invalid clear is rejected | Does not prove a canonical write, persisted clear history, or atomicity of Core state/event/revision/audit |
| PERS-SEM-006, 007 | Same test file — “rejects the whole candidate if any dimension is unsupported” | Whole candidate is rejected when an unsupported dimension is included | Pure evaluator only; no mixed-patch atomicity test through a real Core operation was found in the inspected branch |
| PERS-SEM-001; PERS-REL-001 | Same test file — “keeps direction explicit and does not create a reciprocal patch” | Candidate preserves subject/target direction and does not manufacture a reciprocal patch | No proof of canonical directional persistence or authorized directional read |
| PERS-SEM-003, 004, 023, 026 | Same test file — “does not infer a neutral/default value for an unset dimension”, “distinguishes explicit domain values from unset state”, “distinguishes unset from a previously cleared dimension”, “does not silently treat a withheld current relationship value as unset”, “preserves each non-value relationship state instead of treating it as unset” | Pure evaluator distinguishes absent/unset, explicit domain values, cleared, withheld, conflict, insufficient-support, unsupported and incomplete states | Consumer-visible authorization behavior and withheld-value non-disclosure remain unverified in Core |
| PERS-SEM-006, 007 | Same test file — “preserves special object-property dimension names as own data keys”, “supports all special dimension keys as own data keys for set and clear”, “preserves all special dimension keys together in a mixed set patch”, plus inherited-property rejection tests | Special keys including `__proto__`, `constructor`, and `prototype` are exercised as data keys; inherited properties are not accepted as explicit input | Evidence applies only to the isolated evaluator branch; no Core persistence/security claim |
| PERS-SEM-008, 020; PERS-REL-010 | Same test file — “re-evaluating identical inputs is deterministic and side-effect-free”, “does not evaluate a transition when evidence is insufficient or conflicting”, “does not treat duplicate evidence references as additional support” | Deterministic, side-effect-free candidate evaluation and bounded evidence interpretation | Not commit idempotency, event deduplication, or proof that a repeated candidate is not written twice |
| PERS-SEM-014, 016; PERS-REL-009 | Personality criteria in `docs/personality/06-stable-trait-lifecycle.md`; NPC consumer contract `feat/npc-subsystem:docs/52-npc-relationship-consumer-compatibility.md` | Documents the non-implication: relationship changes do not automatically mutate stable traits | No NPC relationship-consumer runtime module/test was present in the inspected `feat/npc-subsystem` tree; consumer execution remains unimplemented/unverified |
| PERS-SEM-017, 020; PERS-SEM-018, 025, 026; PERS-REL-011, 015 | `feat/npc-subsystem:docs/52-npc-relationship-consumer-compatibility.md`, sections “Consumer contract” and “Compatibility matrix” | Defines consumer-side limits: relationship does not prove cause/knowledge; actor/purpose filtering; withheld must not be treated as unset; no inferred consent/obligation/reciprocity | Contract only. No concrete NPC relationship-consumer test file or production authorized-read seam was found in the inspected tree |
| PERS-SEM-019; PERS-SEM-005; PERS-REL-011 | `docs/personality/01-personality-and-relationship-semantics.md`; NPC consumer contract in `feat/npc-subsystem:docs/52-npc-relationship-consumer-compatibility.md` | Specifies that relationship dimensions do not imply consent, obligation, or reciprocity absent an explicit rule | Semantic requirement only; no executable NPC consumer test was found |
| PERS-SEM-024 | `feat/relationship-pure-evaluator:tests/relationship-evaluate-candidate.test.js` — “requires a pinned rule version”, “re-evaluating identical inputs is deterministic and side-effect-free” | Evaluator requires a non-empty rule-version identifier and deterministic output for identical supplied inputs | Does not prove historical version lookup, persisted per-transition version pinning, historical replay, or rollback/rebuild |
| PERS-SEM-029; REL-MOD-012 | `docs/personality/04-semantic-acceptance-matrix.md`, `05-world-pack-relationship-dimension-template.md`, and `feat/relationship-domain-module:docs/47-relationship-module-test-traceability.md`, `docs/48-relationship-pure-evaluation-contract.md` | Documents the need to distinguish meaning-changing updates, explicit migration/incompatibility, and deterministic replay with pinned inputs | No executable historical migration/version-selection test was found in the inspected evaluator test file; historical Core replay/migration remains blocked |
| PERS-SEM-011, 012, 013, 021, 022, 024, 025, 026, 027 | Core integration gates in `docs/personality/03-core-decision-and-integration-gates.md`; NPC compatibility contract in `feat/npc-subsystem:docs/52-npc-relationship-consumer-compatibility.md` | Documents ownership of trusted provenance, authorized read, atomic canonical mutation, rollback/replay, and safe projections | Integration blockers: the inspected pure evaluator does not perform these operations, and the NPC branch contains no production relationship consumer/test seam |

### Boundary verdict

- **Executable pure-domain evidence exists** in `tests/relationship-evaluate-candidate.test.js` on `feat/relationship-pure-evaluator` for candidate validation, partial patch/clear semantics, directionality, non-value states, special keys, and deterministic side-effect-free evaluation. This audit read the test source; it did not execute the suite.
- **NPC consumer evidence is contract-only** in `docs/52-npc-relationship-consumer-compatibility.md` on `feat/npc-subsystem`. The document was found on that branch (not on the Personality branch); it is treated as an external contract and is not modified here. The inspected NPC branch tree contains no relationship-consumer runtime test file.
- **Core integration remains blocked** for canonical write/read, atomicity, authorization, trusted provenance, audit/revision, commit idempotency, historical version selection/migration, and production rollback/replay. Do not relabel evaluator tests or contract prose as Core integration passes.
- **Test execution status for this change:** not run by this documentation audit. No CI result is inferred from the presence of test source.

## Issue #73 exact test evidence and boundary verdict

The companion [`10-issue-73-executable-evidence-audit.md`](./10-issue-73-executable-evidence-audit.md) supplements this canonical per-ID crosswalk with exact test names found in the isolated Relationship evaluator suite, an individual disposition for each required case family, and explicit Core/NPC blockers. The audit inspected source only; it did not execute tests. Contract prose and pure-evaluator tests are not production integration evidence.


## Verified source links for Issue #73

The following links pin the evidence to the branch/ref inspected during this audit; they are not claims that the branches have been merged into `main`.

- [Pure evaluator test source at audited commit `b2697e77ac0e97b1f7022656c08da5776fa29685`](https://github.com/necromorphic/Logic-Engine/blob/b2697e77ac0e97b1f7022656c08da5776fa29685/tests/relationship-evaluate-candidate.test.js)
- [Successful Runtime tests run #591 for that exact evaluator commit](https://github.com/necromorphic/Logic-Engine/actions/runs/40058497617)

- [Successful Runtime tests run #618 for the current Issue #73 PR head `cfa4ff604f9ade802ecbd83e8a94f49466cb08b7`](https://github.com/necromorphic/Logic-Engine/actions/runs/40059045655) — repository CI evidence for the PR head; does not imply Core/NPC integration is implemented.
- [NPC consumer compatibility contract on `feat/npc-subsystem`](https://github.com/necromorphic/Logic-Engine/blob/feat/npc-subsystem/docs/52-npc-relationship-consumer-compatibility.md) — documentation-only contract, not an executable test.
- [Relationship proposal test traceability on `feat/relationship-domain-module`](https://github.com/necromorphic/Logic-Engine/blob/feat/relationship-domain-module/docs/47-relationship-module-test-traceability.md)
- [Relationship pure evaluation contract on `feat/relationship-domain-module`](https://github.com/necromorphic/Logic-Engine/blob/feat/relationship-domain-module/docs/48-relationship-pure-evaluation-contract.md)
- [Personality Core integration gates in this PR branch](./03-core-decision-and-integration-gates.md)
- [Issue #73 executable-evidence audit](./10-issue-73-executable-evidence-audit.md)

Link scope note: the evaluator test and CI links are pinned to an exact commit; the NPC and Relationship proposal links intentionally identify branch-head documents and may evolve. Recheck these branch-head references when those branches change. The current audit does not claim that CI run #591 validates the current PR head.
