# Issue #73 — Per-criterion executable evidence audit

Status: repository-source audit; not a test-run report. Audited 2026-10-24 against the named refs below. Test names are quoted as found in source. A source-level test mapping does not establish that the suite passes or that another subsystem implements the same behavior.

## Current-main supersession notice (2026-10-24)

**This notice is authoritative for current implementation status.** Earlier evaluator-only inventory rows below describe the pure evaluator and/or the older audited ref. They must not be read as claiming that current `main` lacks the privileged Core first-slice tests.

`main:tests/relationship-transition-core.test.js` (blob `9cf9020c554028f89dc8d8f97d6f7422f357fba1`) contains 21 production-path tests for the privileged admin-gated Relationship operation: directed projection; participant/world/rule/evidence validation; partial and mixed-patch atomicity; idempotent retry; clear/unset/neutral replay; transaction-failure atomicity; restart/rebuild; and required-dependency rollback. The pure evaluator is separately tested in `main:tests/relationship-evaluate-candidate.test.js` (blob `06b1f94fa26a70726b9d2d39739b05c321793971`).

**Still blocked or unproven:** general actor/recipient/purpose/field-authorized reads and withheld-value non-disclosure; trusted initial/import and author-correction operations; non-admin/NPC mutation authority; production Personality/NPC consumer behavior for stable traits, knowledge, motive, consent, obligation, reciprocity, and player agency; safe authorized character-card projection; historical World Pack version selection/migration; independent alternative-support semantics; and old-event knowledge-acquisition/event-deduplication/correction contracts outside the tested first slice.

`PERS-SEM-024` remains deterministic evaluation/replay under identical pinned inputs/version within the supported subset. `PERS-SEM-029` remains meaning-changing World Pack version selection/migration or explicit incompatibility. Deterministic replay does not prove historical version pinning. Exact-head CI must be checked independently; prior successful runs are not evidence for later commits.

## Scope and evidence rules

- Personality acceptance source: `docs/personality/04-semantic-acceptance-matrix.md`, `05-world-pack-relationship-dimension-template.md`, `08-semantic-traceability-and-review-workflow.md`, and `09-per-case-acceptance-traceability.md`.
- Pure evaluator source of truth: `main:tests/relationship-evaluate-candidate.test.js` at blob `06b1f94fa26a70726b9d2d39739b05c321793971`. Earlier branch-local references are historical only.
- NPC consumer contract: `feat/npc-subsystem:docs/52-npc-relationship-consumer-compatibility.md`. This is a document on another branch, not an executable test and not modified by this audit.
- Relationship references on current `main`: [`docs/47-relationship-module-test-traceability.md`](../47-relationship-module-test-traceability.md) and [`docs/48-relationship-pure-evaluation-contract.md`](../48-relationship-pure-evaluation-contract.md). The original source PR #60 was closed unmerged; these documents were ported to `main` through PR #80. These are documentation references, not runtime integration evidence.
- Core integration: the pure evaluator is not a Core write/read/authorization/replay implementation. Where a production Core seam or contract is absent, the case remains an integration blocker; no mock or prose is promoted to a passing integration test.
- Source audit execution status: this documentation audit inspected source text only; it did not itself execute tests.

## Required case-by-case evidence

| Required case | Concrete evidence found | Evidence boundary / result |
|---|---|---|
| Partial update: omitted dimensions preserved | Pure evaluator test: `omitted dimensions remain omitted from the candidate patch`; `clearing one dimension leaves every other dimension outside the candidate patch` | Pure candidate semantics only. A canonical persisted partial update remains blocked on the Core typed-write boundary. |
| Clear one dimension without affecting others | `uses an explicit clear operation, not omission or a sentinel value`; `clearing one dimension leaves every other dimension outside the candidate patch`; `clearing an already cleared or unset dimension is a no-change` | Pure candidate semantics. Persistence of clear history, provenance, authorization and safe readback remain Core integration blockers. |
| Mixed patch with an invalid/unsupported dimension rejected as a whole | `rejects the whole candidate if any dimension is unsupported`; `rejects a mixed valid/invalid patch without exposing partial output or mutating inputs` | The evaluator's returned candidate is all-or-nothing. Atomicity of canonical state/event/revision/audit on a real Core commit is not established. |
| No automatic reverse/reciprocal relationship | `keeps direction explicit and does not create a reciprocal patch` | Pure directionality. Correct directional persistence and authorized directional reads require Core tests. |
| Unset versus explicit neutral | `does not infer a neutral/default value for an unset dimension`; `distinguishes explicit domain values from unset state`; `keeps explicit neutral distinct from unset and treats an existing neutral value as a no-op` | Pure evaluator evidence exists. Production read representation remains unverified. |
| Explicit clear versus never-set | `uses an explicit clear operation, not omission or a sentinel value`; `distinguishes unset from a previously cleared dimension` | Candidate/state distinction is tested in the evaluator. Authorized canonical history and read disclosure are not proven. |
| Withheld versus unset | `does not silently treat a withheld current relationship value as unset`; `preserves withheld evidence as an access outcome distinct from unsupported and insufficient` | Evaluator semantics only. Core actor/purpose authorization and non-disclosure remain blocked. |
| Conflict / insufficient support | `does not evaluate a transition when evidence is insufficient or conflicting`; `preserves each non-value relationship state instead of treating it as unset`; `does not treat unsupported evidence as an empty or neutral relationship` | Pure evaluator candidate behavior. Production reconciliation and authorized result projection remain unverified. |
| Unsupported / incomplete rules or inputs | `returns a non-mutating unsupported result when dimension rules are incomplete`; `treats missing transition rules as incomplete configuration, not a denied transition`; `rejects malformed transition declarations as incomplete rules` | Pure validation evidence. No Core commit or host-capability test implied. |
| Special keys `__proto__`, `constructor`, `prototype` | `preserves special object-property dimension names as own data keys`; `supports all special dimension keys as own data keys for set and clear`; `preserves all special dimension keys together in a mixed set patch` | Explicit evaluator hardening tests exist. This does not prove Core storage or downstream consumer safety. |
| Stable traits are not mutated by relationship changes | Personality contract `docs/personality/06-stable-trait-lifecycle.md`; NPC contract on `feat/npc-subsystem` | Specification/consumer contract only. No executable NPC relationship-consumer runtime test was found in the inspected NPC branch tree. |
| Relationship does not grant knowledge or reveal private beliefs | NPC contract `docs/52-npc-relationship-consumer-compatibility.md`, consumer contract and compatibility matrix; Personality criteria PERS-SEM-018/025/026 | Contract-only for consumer behavior; authorized Core read boundary and an executable consumer test remain blockers. |
| Relationship does not imply motive, cause, consent, obligation or reciprocity | Personality semantic source `01-personality-and-relationship-semantics.md`; NPC contract on `feat/npc-subsystem` | Semantic/contract evidence only. No executable NPC consumer test was found for these non-implications. |
| Re-evaluating identical inputs is deterministic and side-effect-free | `re-evaluating identical inputs is deterministic and side-effect-free`; `returns a candidate without mutating the supplied state or patch` | Pure evaluator only. It does not prove idempotent canonical commit, event deduplication, or one-write-only behavior. |
| Duplicate evidence does not create additional support | `does not treat duplicate evidence references as additional support` | Pure evaluator rule. It does not establish Core alternative-support sufficiency or reconciliation. |
| PERS-SEM-024 deterministic replay with pinned inputs/version | `requires a pinned rule version`; `re-evaluating identical inputs is deterministic and side-effect-free` | This establishes a supplied version requirement and deterministic evaluation, not historical version lookup, persistence of per-transition version, or rollback/replay. |
| PERS-SEM-029 meaning-changing World Pack update, migration or incompatibility | Personality acceptance matrix §2/§2A and World Pack template define explicit compatibility/migration/incompatibility expectations; Relationship proposal docs describe the boundary | Specification only. No executable historical migration/version-selection test was found in the inspected evaluator suite. Core version pinning, migration and replay remain blocked. |
| Canonical write atomicity, authorization, trusted provenance, audit/revision, rollback/replay | Core PRs #94–#96 and `tests/relationship-transition-core.test.js` | **Partial / scoped pass:** admin-authored typed writes, atomicity, audit/revision/idempotency, pinned rule version, directed projection, and rollback/replay are implemented and tested. General actor/purpose/field-authorized reads, non-admin/NPC writes, trusted initial import/author correction, and safe consumer projection remain blocked. |

## Complete PERS-SEM ID disposition

This table closes the per-ID pass over the canonical matrix. “No executable test found” is an explicit disposition, not a claim that the behavior passed. Test names refer to `main:tests/relationship-evaluate-candidate.test.js` (blob `06b1f94fa26a70726b9d2d39739b05c321793971`) at the audited evaluator ref unless otherwise stated.

| ID | Executable evidence / explicit disposition | Boundary |
|---|---|---|
| PERS-SEM-001 | Evaluator: `keeps direction explicit and does not create a reciprocal patch`; Core: `admin-gated typed transition commits directed state, event, revision and audit atomically` in `main:tests/relationship-transition-core.test.js` | Directed state is production-path tested for the privileged first slice; general authorized directional reads remain blocked |
| PERS-SEM-002 | Evaluator: `omitted dimensions remain omitted from the candidate patch`; Core: `partial dimension patch preserves other dimensions and mixed invalid patch is atomic` in `main:tests/relationship-transition-core.test.js` | Candidate semantics and privileged canonical partial/mixed-patch atomicity are tested; broader authority and domain/consumer integration remain blocked |
| PERS-SEM-003 | Evaluator tests distinguish unset/neutral/cleared/withheld and non-value states; Core test `explicit neutral, cleared and unset remain distinct across replay` in `main:tests/relationship-transition-core.test.js` | Unset/neutral/cleared are production-path tested for the privileged subset; authorized withheld disclosure and conflict reconciliation remain unverified |
| PERS-SEM-004 | Evaluator clear tests; Core tests `explicit neutral, cleared and unset remain distinct across replay` and `clear remains distinct from unset and rollback restores the previous surviving value` in `main:tests/relationship-transition-core.test.js` | Clear/replay distinction is production-path tested for the privileged subset; authorized historical disclosure remains blocked |
| PERS-SEM-005 | Partial/clear tests establish candidate isolation; **no dedicated executable test found** for every cross-dimension non-implication (consent, knowledge, obligation, reciprocity) | World Pack/NPC semantic consumer test remains unimplemented |
| PERS-SEM-006 | Evaluator unsupported/incomplete and special-key tests; Core test `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` plus mixed-patch test in `main:tests/relationship-transition-core.test.js` | Supported rule/value validation is production-path tested for the privileged subset; broader rule/version policy remains unverified |
| PERS-SEM-007 | Evaluator rejection tests; Core test `partial dimension patch preserves other dimensions and mixed invalid patch is atomic` in `main:tests/relationship-transition-core.test.js` | Mixed-invalid patch rejection is production-path tested for the privileged first slice; full domain policy remains per active rules |
| PERS-SEM-008 | **No dedicated executable test found** for scene co-presence alone causing no transition | Future domain/consumer regression test; do not infer from deterministic evaluation |
| PERS-SEM-009 | Core tests `admin-gated typed transition commits directed state, event, revision and audit atomically` and `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` in `main:tests/relationship-transition-core.test.js` | Participant/world validation is production-path tested for the privileged first slice |
| PERS-SEM-010 | Evaluator test `self-relations are rejected unless each affected dimension explicitly allows them`; Core tests exercise supported typed operation validation | Self-relation policy is tested within the supported typed operation; domain opt-in remains explicit |
| PERS-SEM-011 | **No executable test found** for trusted initial/import provenance | Core trusted initialization/import boundary blocker |
| PERS-SEM-012 | **No executable test found** for authorized author correction with audit and no historical rewrite | Core authorization/audit blocker |
| PERS-SEM-013 | Tests reject inherited/undeclared input fields, but **no test found** proving caller-supplied origin cannot self-authorize a canonical operation | Core trusted authorization boundary blocker |
| PERS-SEM-014 | **No executable NPC consumer test found** proving relationship/temporary-state changes do not mutate stable traits | Personality/NPC consumer test remains unimplemented |
| PERS-SEM-015 | **No executable NPC decision test found** proving traits influence rather than dictate action across context | NPC decision orchestration test remains unimplemented |
| PERS-SEM-016 | **No executable test found** for preventing a single observed behavior from automatically rewriting a stable profile | Personality/NPC consumer test remains unimplemented |
| PERS-SEM-017 | **No executable NPC interpretation test found** for contradictory behavior without invented canonical motive | NPC consumer contract only |
| PERS-SEM-018 | **No executable NPC consumer test found** proving relationship values do not grant facts/private beliefs; NPC contract only | Core authorized read and NPC knowledge-partition tests blocked |
| PERS-SEM-019 | **No executable consumer test found** proving relationship values do not imply consent absent an explicit rule | Semantic/NPC contract only |
| PERS-SEM-020 | Tests: `does not evaluate a transition when evidence is insufficient or conflicting`; `does not treat duplicate evidence references as additional support` | Pure evidence interpretation; production causal provenance blocked |
| PERS-SEM-021 | Core test `source rollback invalidates a Relationship transition that cites the source` in `main:tests/relationship-transition-core.test.js` | Required-dependency invalidation is production-path tested for the privileged first slice; independent support remains separately deferred |
| PERS-SEM-022 | Explicitly deferred by the canonical matrix; **no executable test or accepted independent-support contract found** | Deferred pending Core representation and World Pack sufficiency rules |
| PERS-SEM-023 | Tests: `does not evaluate a transition when evidence is insufficient or conflicting`; `preserves each non-value relationship state instead of treating it as unset` | Pure evaluator states only; production reconciliation blocked |
| PERS-SEM-024 | Evaluator tests `requires a pinned rule version`, `re-evaluating identical inputs is deterministic and side-effect-free`; Core test `Relationship projection survives store restart and deterministic rebuild from valid events` | Deterministic evaluation and supported-subset replay/rebuild are separate evidence; historical version selection/migration remains under PERS-SEM-029 |
| PERS-SEM-025 | **No executable actor/purpose-authorized read test found** | Core authorized-read integration blocker |
| PERS-SEM-026 | Tests distinguish withheld/current state from unset within evaluator inputs; **no executable authorized-read non-disclosure test found** | Core disclosure/filtering blocker |
| PERS-SEM-027 | **No executable safe, read-only character-card projection test found** | Core authorized projection integration blocker |
| PERS-SEM-028 | **No executable production player-agency test found** for preserving player dialogue, thoughts, decisions, and actions | NPC/player-control consumer test remains unimplemented |
| PERS-SEM-029 | **No executable historical version-selection/migration test found**; template and matrix specify explicit migration or incompatibility for meaning-changing updates | Core historical versioning/migration blocker; keep distinct from PERS-SEM-024 |

### Legacy ID and auxiliary acceptance families

- `PERS-REL-001–003`, `PERS-REL-009`, `PERS-REL-010`, `PERS-REL-014–015` map to the PERS-SEM rows above; the exact evaluator tests are listed there where present. Legacy IDs do not create additional runtime evidence.
- `PERS-REL-004` (co-presence only), `PERS-REL-005–006` (initial/correction provenance), `PERS-REL-007–008` (canonical identity/self-relation), `PERS-REL-011–013` (knowledge, card projection, rollback), and `PERS-REL-016` (player agency) have no complete production-boundary test evidence in the inspected branches. They remain mapped to the corresponding PERS-SEM criteria and the Core/NPC blockers above.
- `PERS-TRAIT-001–013`: the Personality lifecycle document specifies these criteria, but the inspected NPC branch exposes only a consumer compatibility contract and no executable relationship-consumer runtime test. Therefore no PERS-TRAIT runtime pass is claimed; Core-owned authorization, audit, and rollback items remain integration blockers.

## PERS-SEM-001–029 — individual executable-evidence disposition

This table completes the per-ID evidence pass over the canonical semantic matrix. A named pure evaluator test is credited only for the candidate-level property it actually asserts. “No direct executable test found” means the inspected current-main evaluator/test tree does not exercise the required boundary; the stated integration test is future work, not a pass.

| ID | Exact executable evidence or explicit absence | Boundary / required follow-up |
|---|---|---|
| PERS-SEM-001 | Evaluator `keeps direction explicit and does not create a reciprocal patch`; Core `admin-gated typed transition commits directed state, event, revision and audit atomically` | Directed write is tested for the privileged first slice; authorized directional reads remain blocked. |
| PERS-SEM-002 | Evaluator partial-patch tests; Core `partial dimension patch preserves other dimensions and mixed invalid patch is atomic` | Canonical partial/mixed-patch atomicity is tested for the privileged first slice; broader authority/consumer integration remains blocked. |
| PERS-SEM-003 | Evaluator unset/neutral/withheld-state tests; Core `explicit neutral, cleared and unset remain distinct across replay` | Unset/neutral/cleared are production-path tested for the privileged subset; withheld disclosure and conflict reconciliation remain blocked. |
| PERS-SEM-004 | Evaluator clear tests; Core `explicit neutral, cleared and unset remain distinct across replay`; `clear remains distinct from unset and rollback restores the previous surviving value` | Clear/replay behavior is production-path tested for the privileged subset; authorized historical disclosure remains blocked. |
| PERS-SEM-005 | No direct executable test found proving cross-dimension isolation or that relationship state never implies consent, knowledge, obligation, or reciprocity. | Future World Pack semantic and NPC consumer tests; partial-patch tests do not prove non-implication. |
| PERS-SEM-006 | Evaluator unsupported/incomplete and special-key tests; Core supported rule/value/evidence validation tests | Supported validation is production-path tested for the privileged subset; special-key persistence/downstream consumer safety and broader rule/version policy remain unproven. |
| PERS-SEM-007 | Evaluator rejection tests; Core `partial dimension patch preserves other dimensions and mixed invalid patch is atomic` | Mixed-invalid patch rejection is production-path tested for the privileged first slice; full domain policy remains per active rules. |
| PERS-SEM-008 | No dedicated executable test found for scene co-presence/mention alone causing no transition. | Future domain/consumer regression test; deterministic re-evaluation is not a substitute. |
| PERS-SEM-009 | Core tests `admin-gated typed transition commits directed state, event, revision and audit atomically` and `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` in `main:tests/relationship-transition-core.test.js`. | Participant/world validation is production-path tested for the privileged first slice; broader actor authority remains blocked. |
| PERS-SEM-010 | Evaluator `self-relations are rejected unless each affected dimension explicitly allows them`; Core supported typed-operation validation tests. | Self-relation policy is tested within the supported typed operation; domain opt-in remains explicit. |
| PERS-SEM-011 | No executable test found for trusted initial/imported relationship provenance. | Core trusted initialization/import path and audit remain blocked. |
| PERS-SEM-012 | No executable production-path test found for authorized author correction, audit, and preserving historical events. | Core correction-authority and audit contract remains blocked. |
| PERS-SEM-013 | No executable test found proving caller-supplied origin/provenance cannot self-authorize a canonical mutation. | Core trusted server-derived authority/provenance blocker; input-shape hardening is not authorization. |
| PERS-SEM-014 | No executable Personality/NPC consumer test found proving a relationship/temporary condition cannot mutate stable traits. | Future consumer integration test against the actual trait mutation path. |
| PERS-SEM-015 | No executable NPC decision test found proving traits influence but do not dictate action across contexts. | Future NPC decision-path test; no runtime behavior claim. |
| PERS-SEM-016 | No executable test found proving one observed behavior cannot automatically rewrite a stable profile. | Future Personality/NPC consumer test; lifecycle prose is specification only. |
| PERS-SEM-017 | No executable NPC interpretation test found for contradictory behavior without an invented canonical motive/explanation. | Future NPC consumer test; evaluator does not implement interpretation. |
| PERS-SEM-018 | No executable NPC knowledge-partition test found proving a relationship value does not grant facts/private beliefs. | Core authorized-read and NPC knowledge-partition integration blocker. |
| PERS-SEM-019 | No executable consumer test found proving relationship dimensions do not imply consent absent an explicit domain rule. | Future World Pack/NPC consumer test; consent must remain independently governed. |
| PERS-SEM-020 | `does not evaluate a transition when evidence is insufficient or conflicting`; `does not treat duplicate evidence references as additional support` | These cover bounded evaluator evidence handling only; no executable test proves relationship state records its true cause or has authorized canonical provenance. |
| PERS-SEM-021 | Core tests `source rollback invalidates a Relationship transition that cites the source` and `Relationship projection survives store restart and deterministic rebuild from valid events`. | Required-dependency invalidation/rebuild is production-path tested for the privileged first slice; independent alternative support remains deferred. |
| PERS-SEM-022 | No executable test or approved independent-support contract found; independent sufficient support is explicitly deferred. | Keep blocked/deferred until Core representation and World Pack sufficiency rules are approved; source IDs alone do not prove independence. |
| PERS-SEM-023 | `preserves each non-value relationship state instead of treating it as unset`; `does not evaluate a transition when evidence is insufficient or conflicting`; `does not treat unsupported evidence as an empty or neutral relationship` | Pure result-state distinctions only; production reconciliation/read projection remains blocked. |
| PERS-SEM-024 | Evaluator tests `requires a pinned rule version`, `re-evaluating identical inputs is deterministic and side-effect-free`; Core `Relationship projection survives store restart and deterministic rebuild from valid events`. | Deterministic evaluation and supported-subset replay/rebuild are separate evidence; historical version selection/migration remains under PERS-SEM-029. |
| PERS-SEM-025 | No executable actor/purpose-authorized Relationship read test found. | Core authorized-read integration blocker; a consistent snapshot alone is not authorization. |
| PERS-SEM-026 | `does not silently treat a withheld current relationship value as unset`; `preserves withheld evidence as an access outcome distinct from unsupported and insufficient` | Pure status semantics only; no production non-disclosure/authorized-read test found. |
| PERS-SEM-027 | No executable safe, read-only character-card projection test found. | Core/card projection integration blocker. |
| PERS-SEM-028 | No executable production player-agency test found for preserving player-controlled dialogue, thoughts, decisions, and actions. | Future NPC/player-control integration test; semantic rule is specified, runtime boundary unverified. |
| PERS-SEM-029 | No executable historical World Pack version-selection/migration test found. `requires a pinned rule version` tests only that an identifier is supplied. | World Pack must declare explicit compatibility/migration or incompatibility; Core historical pinning/migration/replay remains blocked and must not be conflated with PERS-SEM-024. |

## PERS-REL-001–016 — individual executable-evidence disposition

The legacy identifiers remain stable aliases, but each is audited separately below. “No test found” means no matching executable production-boundary test was found in the inspected repository paths; it is not a claim that a future test is impossible. Evaluator tests are cited only for the behavior they actually exercise.

| Legacy ID | Required behavior | Exact executable evidence found | Disposition and missing evidence |
|---|---|---|---|
| PERS-REL-001 | A→B is directed; no automatic B→A transition | Evaluator test `keeps direction explicit and does not create a reciprocal patch`; Core test `admin-gated typed transition commits directed state, event, revision and audit atomically` | Directed canonical write is production-path tested for the privileged first slice; general authorized readback remains blocked. |
| PERS-REL-002 | Partial update preserves omitted dimensions; clear is explicit | Evaluator partial/clear tests; Core `partial dimension patch preserves other dimensions and mixed invalid patch is atomic`; `explicit neutral, cleared and unset remain distinct across replay` | Canonical partial/mixed-patch atomicity and clear/replay are production-path tested for the privileged first slice; general authority and authorized historical disclosure remain blocked. |
| PERS-REL-003 | Unset differs from explicit neutral and cleared | Evaluator distinctions plus Core `explicit neutral, cleared and unset remain distinct across replay` | Unset/neutral/cleared are production-path tested for the privileged first slice; authorized history disclosure and withheld/conflict read behavior remain blocked. |
| PERS-REL-004 | Scene co-presence or mention alone causes no transition | No dedicated executable test found for co-presence/mention-only input | Future domain/consumer regression test. Deterministic repeat evaluation is not a substitute for proving that scene co-presence cannot produce a transition; production trigger boundary remains unverified. |
| PERS-REL-005 | Initial/imported state has distinct, trustworthy provenance | No executable trusted initial/import test found | Core blocker: approved trusted import/initialization path, authority derivation, canonical event/provenance and audit are not verified. |
| PERS-REL-006 | Author correction is explicit, authorized, audited, and does not silently rewrite history | No executable production-path correction test found | Core blocker: approved correction authority, audit and historical-event semantics are unresolved/unverified. |
| PERS-REL-007 | Both participants resolve to existing canonical identities in the same world | Core tests for the privileged typed operation include `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` and directed commit validation | Participant/world validation is production-path tested for the privileged first slice; broader identity/authorization guarantees remain limited to that operation and are not a general actor-read contract. |
| PERS-REL-008 | Self-relations are rejected unless explicitly allowed by domain rules | Pure evaluator test: `self-relations are rejected unless each affected dimension explicitly allows them` | Domain candidate behavior covered. Core must still enforce canonical participant resolution and the same rule at commit. |
| PERS-REL-009 | Relationship/temporary condition does not silently mutate stable traits | No executable NPC relationship-consumer test found; Personality source `docs/personality/06-stable-trait-lifecycle.md` is a semantic contract | Future Personality/NPC consumer integration test. Contract text is not execution evidence; stable-trait non-mutation on the real consumer path remains unverified. |
| PERS-REL-010 | Trait/action interpretation remains contextual; behavior does not become a canonical motive or forced action | No executable NPC decision/interpretation test found | Future NPC consumer test. Need the actual decision path to prove context-sensitive behavior and no invented canonical motive; prose and evaluator purity do not establish it. |
| PERS-REL-011 | Relationship value does not itself grant the character knowledge of facts or private beliefs | No executable NPC knowledge-partition/relationship-consumer test found | Future NPC + authorized-read integration test. Keep actor-specific knowledge separate from relationship state; consent, obligation, and reciprocity remain separate non-implication criteria in PERS-SEM-005/019 and the broader semantic contract, not additional meaning assigned to this legacy ID. |
| PERS-REL-012 | Character card is a derived, read-only view of authorized canonical state | No executable safe character-card projection test found | Core/card integration blocker: authorized source, projection freshness and non-mutation are not verified. |
| PERS-REL-013 | Revoking the only required dependency removes unsupported projected state on rollback/rebuild | `tests/relationship-transition-core.test.js`: `source rollback invalidates a Relationship transition that cites the source`; `rollback invalidates later transition dependent on the same directed pair and rebuilds surviving state` | Core's first-slice typed transition/source-dependency rollback is tested. This does not implement alternative independent-support accounting or a general support ledger; those semantics remain unsupported and fail closed. |
| PERS-REL-014 | Required dependency, independent support, conflict and insufficient support remain distinct | Pure evaluator tests: `does not evaluate a transition when evidence is insufficient or conflicting`; `preserves each non-value relationship state instead of treating it as unset`; `does not treat duplicate evidence references as additional support` | Candidate-level status handling exists. Independent-support semantics are explicitly deferred; source IDs alone do not prove independence/sufficiency. Core causal representation, reconciliation and rollback remain blocked. |
| PERS-REL-015 | Reads are actor/purpose-authorized; withheld is not interpreted as unset | Pure evaluator tests: `does not silently treat a withheld current relationship value as unset`; `preserves withheld evidence as an access outcome distinct from unsupported and insufficient` | Evaluator status distinction only. No executable production authorized-read/non-disclosure test found; Core read policy remains blocked. |
| PERS-REL-016 | Relationship context cannot author voluntary player actions, thoughts, decisions, or dialogue | No executable production player-agency consumer test found | Future NPC/player-control integration test. The semantic contract is specified; the runtime consumer boundary is not verified. |

## Acceptance-criterion disposition

- **Covered by source-level pure-evaluator tests:** candidate purity; omitted-dimension behavior; explicit clear; whole-candidate rejection; directedness; unset/neutral/cleared/withheld/conflict/unsupported distinctions; special property keys; pinned version input and deterministic repeat evaluation.
- **Specified but not executable in inspected consumer path:** stable-trait non-mutation; knowledge partition; no inferred motive/cause/consent/obligation/reciprocity; player agency in the production NPC path.
- **Implemented in the privileged first slice:** admin-gated canonical typed write, transaction atomicity, audit/revision/idempotency, explicit clear history, immutable rule-version pinning, directed projection, and Relationship-specific rollback/rebuild. **Still blocked:** actor/recipient/purpose/field-authorized read, non-admin/NPC mutation authority, trusted initial import/author correction, alternative independent-support semantics, historical migration policy, and safe production consumer/card projection.

## CI evidence (separate from this documentation audit)

Historical GitHub Actions workflow **Runtime tests**, run [#591](https://github.com/necromorphic/Logic-Engine/actions/runs/40058497617), completed successfully on the then-isolated evaluator branch at commit `b2697e77ac0e97b1f7022656c08da5776fa29685`. Its `npm test` step concluded `success`. This is evidence for that historical evaluator commit only; it is not the current source-of-truth ref and does not demonstrate Core/NPC integration. Current source-of-truth is `main:tests/relationship-evaluate-candidate.test.js` at blob `06b1f94fa26a70726b9d2d39739b05c321793971`. The documentation audit itself did not execute the suite.

## CI evidence for prior PR heads (not the latest documentation commit)

Historical GitHub Actions workflow **Runtime tests**, run [#618](https://github.com/necromorphic/Logic-Engine/actions/runs/40059045655), completed successfully for commit `cfa4ff604f9ade802ecbd83e8a94f49466cb08b7` on the earlier `fix/personality-issue-73-test-traceability` branch. This is historical CI evidence only; it is not evidence for the current PR head and does not close Core/NPC integration blockers. Historical exact-head CI for PR #137 head `95f42ab8369c04fbb4acb1b6360f375ef83d02e8` passed on Runtime tests run #854. That run does not validate the reconciled current PR head. Check Runtime CI against the exact current SHA; any subsequent documentation commit requires a fresh exact-head check.

## Cross-document consistency checks

- Keep `PERS-SEM-024` limited to deterministic replay under the same explicit/pinned inputs and version, within the stated replayable subset.
- Keep `PERS-SEM-029` responsible for meaning-changing World Pack updates, explicit migration, or explicit incompatibility. Deterministic evaluation does not establish historical version pinning.
- Do not describe NPC's compatibility document as a test. Do not modify the NPC branch from this Personality task.
- Do not label evaluator candidate rejection as proof of atomic canonical persistence.
- The case table in `09-per-case-acceptance-traceability.md` remains the canonical per-ID map; this file supplements it with exact test names and an explicit evidence disposition for Issue #73.


## Addendum — canonical crosswalk correction and latest CI (2026-10-24)

The canonical synthetic scenario table in `09-per-case-acceptance-traceability.md` was directly corrected at commit `cd7b88d652e393e9f089e4ae408001c6af2cb05f`:

- `PERS-SEM-008, PERS-SEM-020; REL-MOD-005` now covers only repeated evaluation without new causal evidence.
- `REL-MOD-015` is a separate cross-block test-design row for acquiring knowledge about an existing canonical event. It has no direct existing `PERS-SEM-*` criterion and remains blocked on the NPC acquisition contract and Core event identity/deduplication, correction, versioning, and replay boundaries.

Runtime tests run [#645](https://github.com/necromorphic/Logic-Engine/actions/runs/40059799538) completed successfully on that exact commit; job `test` and step `Run npm test` both concluded `success`. This confirms the configured repository test workflow for that commit only. It does not establish production NPC/Core integration, event deduplication, or any other integration gate listed in this audit.

The correction is verified in the canonical table and the accompanying `12-relationship-crosswalk-correction.md`. No new Personality acceptance ID was introduced. Status as of 2026-10-24: source PR #75 is closed unmerged; its cross-block documentation was ported to `main` by merged PR #79. This audit document is included in the Relationships-owned traceability/handoff proposal; the port does not imply runtime/API/schema/Core/Relationship/NPC implementation. Core/NPC integration blockers remain open.


## Core status refresh (2026-10-24)

This audit's pure-evaluator mappings remain distinct from production-path evidence. Core PRs #94–#96 and test follow-ups #107–#108/#117 are merged; exact-head Runtime CI passed on PR #117 head `21dde3c21fd323fecc22f7c187e191ec63815a37` (run #795) for explicit neutral/cleared/unset replay, in addition to PR #96 head `79deb588e1f6321826dc3316085aaab6fdb010b7` (run #717), PR #107 head `bff370b920e32013f17a036eda9450c9eafd1066` (run #754), and PR #108 head `3db9c1484fedf4162023b93acc8920269eff6e10` (run #761). Real-path Relationship write/rollback tests now exist, but no general actor-authorized Relationship read or NPC-facing mutation path is established.

### Exact Core test inventory (current main)

Source: `tests/relationship-transition-core.test.js` at blob `1d4e41be224419d79d3179542504f5ba1e95eecc` contains these 17 tests after PRs #107, #108, and #117:

1. `admin-gated typed transition commits directed state, event, revision and audit atomically`
2. `API rejects ordinary bearer without the separate admin credential and does not mutate state`
3. `Relationship transition route rejects missing, wrong, or standalone admin credentials without mutation`
4. `HTTP idempotent retry returns the established transition without a second event`
5. `admin route commits through the canonical event lifecycle and returns the current directed projection`
6. `generic event preparation cannot smuggle a Relationship effect`
7. `stale composite cursor and spoofed executor are rejected without mutation`
8. `invalid mixed patch commits nothing and idempotent retry does not duplicate a transition`
9. `source rollback invalidates a Relationship transition that cites the source`
10. `explicit neutral, cleared and unset remain distinct across replay`
11. `clear remains distinct from unset and rollback restores the previous surviving value`
12. `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`
13. `event insert and audit failures roll back the entire Relationship transition`
14. `projection and idempotency persistence failures roll back Relationship event, state, revision and audit`
15. `Relationship projection survives store restart and deterministic rebuild from valid events`
16. `trusted state read returns one composite freshness marker across rollback`
17. `rollback invalidates later transition dependent on the same directed pair and rebuilds surviving state`

These prove only the privileged first slice. General actor/purpose-authorized reads, NPC/model-facing writes, generic initial import/author correction, historical World Pack migration, alternative independent-support accounting, and downstream Personality/NPC consumer behavior remain separate blockers. The existing authorized-read route remains self-identity-only by default; PR #101 adds an opt-in trusted host policy seam but no default visibility policy.


## Current-main evidence reconciliation (2026-10-24; supersedes stale dispositions above)

The previous per-criterion rows were written before the current Core typed Relationship slice and should not be read as saying that all canonical write/replay behavior is absent. The exact current-main Core source is `tests/relationship-transition-core.test.js` at blob `9cf9020c554028f89dc8d8f97d6f7422f357fba1`; it contains 21 named real-path tests. The pure evaluator source remains `tests/relationship-evaluate-candidate.test.js` at blob `06b1f94fa26a70726b9d2d39739b05c321793971`.

### Updated acceptance dispositions

| Acceptance IDs | Exact current-main test evidence | Current disposition |
|---|---|---|
| PERS-SEM-001 / PERS-REL-001 — direction | `admin-gated typed transition commits directed state, event, revision and audit atomically`; `admin route commits through the canonical event lifecycle and returns the current directed projection`; evaluator: `keeps direction explicit and does not create a reciprocal patch` | Privileged canonical directed write/projection and candidate no-reciprocity are tested. General authorized consumer read is not. |
| PERS-SEM-002 / PERS-REL-002 — partial patch and atomic rejection | `partial dimension patch preserves other dimensions and mixed invalid patch is atomic`; `invalid mixed patch commits nothing and idempotent retry does not duplicate a transition` | Real Core partial patch and mixed-patch rejection are tested on privileged path; no non-admin/NPC write authority implied. |
| PERS-SEM-003–004 / PERS-REL-003 — unset, neutral, clear | `explicit neutral, cleared and unset remain distinct across replay`; `clear remains distinct from unset and rollback restores the previous surviving value` | Canonical replay/history semantics are tested for the first slice; authorized disclosure remains separate. |
| PERS-SEM-006–007 — domain validation | `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`; evaluator tests for unsupported dimensions/transitions and prototype-sensitive keys | Core checks world/rule/evidence validity and evaluator checks candidate dimension/rule validity; exact special-key protection remains evaluator-level, not an assertion about Core storage. |
| PERS-SEM-009–010 — participants/self-pair | Core `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`; evaluator `self-relations are rejected unless each affected dimension explicitly allows them` | Cross-world participant rejection and domain self-relation policy are evidenced at different boundaries. Do not claim canonical alias resolution beyond the test. |
| PERS-SEM-011–013 — trusted initial/import/correction | `HTTP Relationship route rejects caller-supplied executor and provenance labels`; `stale composite cursor and spoofed executor are rejected without mutation` | Spoofing is rejected on the existing transition path; no trusted initial/import/correction operation is established. |
| PERS-SEM-021 / PERS-REL-013 — required dependency rollback | `source rollback invalidates a Relationship transition that cites the source`; `rollback invalidates later transition dependent on the same directed pair and rebuilds surviving state`; `Relationship projection survives store restart and deterministic rebuild from valid events` | First-slice required-dependency rollback/rebuild is tested; alternative independent support is not. |
| PERS-SEM-024 — deterministic replay | `explicit neutral, cleared and unset remain distinct across replay`; `Relationship projection survives store restart and deterministic rebuild from valid events`; evaluator `re-evaluating identical inputs is deterministic and side-effect-free` | Two distinct meanings: Core replay/rebuild for stored pinned transition history; pure evaluator deterministic repeat. Neither proves historical version lookup/migration. |
| PERS-SEM-029 — meaning-changing versions/migration | No direct historical version-selection/migration test found | World Pack compatibility/migration or incompatibility must be declared; Core historical migration/version selection remains blocked. |
| PERS-SEM-025–026 / PERS-REL-015 — authorized read/withheld | `trusted state read pins world, entities and composite cursor across a concurrent writer`; `trusted state read returns one composite freshness marker across rollback` | These establish trusted consistent snapshot/cursor, not general actor/purpose/field visibility filtering or withheld-value non-disclosure. |
| PERS-SEM-014–020, 027–028 / PERS-REL-009–012, 016 — Personality/NPC consumer boundaries | No direct Personality/NPC consumer test found | Stable-trait non-mutation, knowledge partition, no inferred motive/consent/obligation/reciprocity, safe card projection and player agency remain specification/blocked integration. |
| REL-MOD-015 — acquisition of knowledge about an old event | No production acquisition/event-identity/deduplication test found | Remains a separate cross-block contract gap; do not map it to PERS-SEM-024 or PERS-SEM-029. |

### Exact current-main Core test inventory

1. `admin-gated typed transition commits directed state, event, revision and audit atomically`
2. `API rejects ordinary bearer without the separate admin credential and does not mutate state`
3. `Relationship transition route rejects missing, wrong, or standalone admin credentials without mutation`
4. `HTTP idempotent retry returns the established transition without a second event`
5. `HTTP Relationship route rejects caller-supplied executor and provenance labels`
6. `admin route commits through the canonical event lifecycle and returns the current directed projection`
7. `generic event preparation cannot smuggle a Relationship effect`
8. `stale composite cursor and spoofed executor are rejected without mutation`
9. `reusing a Relationship idempotency key with a different payload is rejected`
10. `partial dimension patch preserves other dimensions and mixed invalid patch is atomic`
11. `invalid mixed patch commits nothing and idempotent retry does not duplicate a transition`
12. `source rollback invalidates a Relationship transition that cites the source`
13. `explicit neutral, cleared and unset remain distinct across replay`
14. `clear remains distinct from unset and rollback restores the previous surviving value`
15. `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`
16. `event insert and audit failures roll back the entire Relationship transition`
17. `projection and idempotency persistence failures roll back Relationship event, state, revision and audit`
18. `Relationship projection survives store restart and deterministic rebuild from valid events`
19. `trusted state read pins world, entities and composite cursor across a concurrent writer`
20. `trusted state read returns one composite freshness marker across rollback`
21. `rollback invalidates later transition dependent on the same directed pair and rebuilds surviving state`

### Current ownership and stale-link correction

- Core first-slice implementation issue [#77](https://github.com/necromorphic/Logic-Engine/issues/77) is closed; its privileged typed write/replay path is present and tested on current `main`.
- Relationships domain-to-Core handoff is tracked separately in [#130](https://github.com/necromorphic/Logic-Engine/issues/130), and its proposal document is `../49-relationship-to-core-typed-transition-handoff.md`. This does not substitute for Personality traceability.
- Source PR #75 was closed unmerged; selected Personality cross-block docs were ported to `main` by #79. Relationship docs from source PR #60 were ported to `main` by #80. Do not describe those source PRs as currently open or imply the port is runtime evidence.
- Historical CI runs #591, #618, #645, #795, etc. are not CI evidence for this new documentation PR. Exact-head Actions status must be checked separately.


## Current-main source refresh — 2026-10-25 (Issue #73)

This addendum supersedes earlier file-blob/test-count references where they differ from the current-main source. Audit base commit: `bf35fb8dd13628718dacc11c27654c0929fba0e2`. This is a **source inspection**, not a test execution. Current-main workflow lookup for this exact commit returned no PR-triggered workflow runs; do not infer a passing CI result for this commit.

### Exact current-main source identities

- Pure evaluator: [`tests/relationship-evaluate-candidate.test.js`](https://github.com/necromorphic/Logic-Engine/blob/main/tests/relationship-evaluate-candidate.test.js), blob `f2ac6a157aba255fbf402c57bd5a6a24ce2a29de`.
- Core runtime: [`tests/relationship-transition-core.test.js`](https://github.com/necromorphic/Logic-Engine/blob/main/tests/relationship-transition-core.test.js), blob `f10b209910af5bd14aa970542f4500b15699ceff`.
- The exact current-main Core test inventory contains 25 named tests; the evaluator source inventory contains 59 named tests. These counts come from parsing test declarations in the source, not from executing the suites.

### Current-main test-level crosswalk

| Requirement / existing IDs | Exact executable test(s) | Evidence class and remaining gap |
|---|---|---|
| Directed relation / no automatic reciprocity — PERS-SEM-001; PERS-REL-001–003 | Evaluator: `keeps direction explicit and does not create a reciprocal patch`; Core: `admin-gated typed transition commits directed state, event, revision and audit atomically`; `admin route commits through the canonical event lifecycle and returns the current directed projection` | Evaluator + privileged Core runtime. Does not establish general NPC-authorized writes or actor-authorized reverse-direction reads. |
| Partial update and omitted dimensions — PERS-SEM-002; PERS-REL-002 | Evaluator: `omitted dimensions remain omitted from the candidate patch`; `clearing one dimension leaves every other dimension outside the candidate patch`. Core: `partial dimension patch preserves other dimensions and mixed invalid patch is atomic` | Candidate semantics and privileged canonical write are executable. General actor/consumer path remains blocked. |
| Mixed valid/invalid patch is all-or-nothing — PERS-SEM-006/007 | Evaluator: `rejects the whole candidate if any dimension is unsupported`; `rejects a mixed valid/invalid patch without exposing partial output or mutating inputs`. Core: `partial dimension patch preserves other dimensions and mixed invalid patch is atomic`; `invalid mixed patch commits nothing and idempotent retry does not duplicate a transition` | Both pure and privileged Core boundaries covered; broader rule families are not implied. |
| Unset vs explicit neutral vs cleared — PERS-SEM-003/004; PERS-REL-003 | Evaluator: `does not infer a neutral/default value for an unset dimension`; `distinguishes explicit domain values from unset state`; `uses an explicit clear operation, not omission or a sentinel value`; `distinguishes unset from a previously cleared dimension`; `keeps explicit neutral distinct from unset and treats an existing neutral value as a no-op`. Core: `explicit neutral, cleared and unset remain distinct across replay`; `clear remains distinct from unset and rollback restores the previous surviving value` | Production-path evidence is scoped to the privileged Core operation. Safe actor-specific disclosure of clear history remains blocked. |
| Withheld vs unset — PERS-SEM-026; PERS-REL-015 | Evaluator: `does not silently treat a withheld current relationship value as unset`; `preserves withheld evidence as an access outcome distinct from unsupported and insufficient` | Evaluator-only. No actual authorized consumer read/non-disclosure test exists in the current Core test file. Owner: Core authorized-read contract; Personality consumer traceability. |
| Conflict vs insufficient support — PERS-SEM-023 | Evaluator: `does not evaluate a transition when evidence is insufficient or conflicting`; `preserves each non-value relationship state instead of treating it as unset` | Evaluator-only. Core reconciliation/read-result contract and real consumer-path test are missing. Owner: Relationships reconciliation semantics + Core read/projection. |
| Unsupported evidence vs empty/neutral — PERS-SEM-006/007/023 | Evaluator: `does not treat unsupported evidence as an empty or neutral relationship`; `preserves withheld evidence as an access outcome distinct from unsupported and insufficient` | Evaluator-only; no production result mapping test. Owner: Relationships evidence contract + Core result mapping. |
| Unsupported/incomplete rule configuration — PERS-SEM-006/007 | Evaluator: `returns a non-mutating unsupported result when dimension rules are incomplete`; `treats missing transition rules as incomplete configuration, not a denied transition`; `rejects malformed transition declarations as incomplete rules`. Core: `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` | Evaluator semantics and Core refusal for unavailable module/version are covered separately. There is no consumer integration test proving incomplete evaluator configuration survives Core mapping as a distinct result. |
| Prototype-sensitive keys — PERS-SEM-006/007 | Evaluator: `preserves special object-property dimension names as own data keys`; `supports all special dimension keys as own data keys for set and clear`; `preserves all special dimension keys together in a mixed set patch`; `requires own input fields even when Object.prototype provides a fallback`; inherited-property rejection tests | Executable pure evaluator/security tests only; no claim about downstream consumer or persistence safety. |
| Repeated evaluation vs canonical idempotency — PERS-SEM-024 (limited) | Evaluator: `re-evaluating identical inputs is deterministic and side-effect-free`. Core: `HTTP idempotent retry returns the established transition without a second event`; `reusing a Relationship idempotency key with a different payload is rejected` | Both layers tested separately: evaluator determinism is not write idempotency; Core retry covers the privileged write contract only. |
| Missing/unknown rule version and no mutation — PERS-SEM-024/029 | Evaluator: `requires a pinned rule version`; `rejects a missing ruleVersion field instead of treating it as a pinned version`; Core: `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`; `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` | Core covers exact module lookup refusal and projection pin preservation. Does not prove World Pack mapping remains recoverable, historical semantic re-evaluation, or migration. |
| Stable traits remain separate — PERS-SEM-014/016; PERS-REL-009 | No executable test in the two current-main test files directly exercises a Relationship→Personality/NPC consumer. | Specified only; blocked on approved Personality/NPC consumer seam. Required test: change a relationship dimension and assert stable trait/profile storage and NPC context are not silently rewritten. |
| Relationship does not imply knowledge/motive/cause/consent/obligation/reciprocity — PERS-SEM-018–020; PERS-REL-010/011/016 | No direct executable Personality/NPC consumer test in the two current-main test files. | Specified/contract-only; blocked on actor/purpose-authorized read and consumer contract. Required tests must vary relationship value while withholding independent fact/motive/consent/obligation and assert no inference or leakage. |
| Player agency — PERS-SEM-028; PERS-REL-016 | No direct executable test in the two current-main test files. | Specified only; required NPC consumer test must show relationship context does not author player voluntary dialogue, thoughts, decisions, or actions. |
| Deterministic projection replay — PERS-SEM-024 | Core: `Relationship projection survives store restart and deterministic rebuild from valid events`; `projection rebuild preserves the exact historical rule-version pin when its module is unavailable`; `source rollback invalidates a Relationship transition that cites the source` | Executable Core tests, limited to the implemented privileged typed transition. Determinism is not evidence of historical semantic re-evaluation or meaning-changing migration. |
| Meaning-changing World Pack migration/incompatibility — PERS-SEM-029 | No executable migration or historical semantic re-evaluation test in the two current-main test files. | Blocked on Core-approved source/target version and migration contract. Never use latest as historical fallback. |

### Consumer-test blockers to carry forward

1. **Core authorized read/disclosure:** implement/approve the actor/purpose/field-authorized read boundary before writing tests that claim withheld non-disclosure. Required cases: authorized vs unauthorized, withheld distinct from unset, no value leakage, consistent freshness snapshot.
2. **Relationships reconciliation:** approve how conflict and insufficient-support outcomes are represented at the Core/consumer boundary. Test both through that real path and assert distinct outcomes with no candidate/canonical mutation.
3. **Personality/NPC consumer:** exercise relationship context against stable traits, separately acquired knowledge, motive, consent, obligation, reciprocity, and player agency. Do not substitute fixtures or prose for a real consumer integration test.
4. **Version semantics:** Core must decide direct World Pack pin vs proven immutable historical mapping. Historical semantic re-evaluation and meaning-changing migration remain separate, unimplemented operations. Existing deterministic replay tests must not be used as evidence for either.

No runtime API/schema or cross-block implementation is introduced by this audit update. Keep Issue #73 open until each requirement has either exact executable evidence at the required boundary or an explicit owner/contract blocker.
