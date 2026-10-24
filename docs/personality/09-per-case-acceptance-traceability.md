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
| PERS-SEM-003 | 01 §4; 05 §3 | Personality meaning; Core representation | Specified | Blocked: production representation unverified |
| PERS-SEM-004 | 05 §3; 03 integration gates | Personality meaning; Core representation | Specified; exact representation unresolved | Blocked |
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
| PERS-SEM-023 | 05 §§2–3 | Core reconciliation; World Pack conflict policy | No-guess rule specified | Conflict reconciliation unverified |
| PERS-SEM-024 | 04 §4; 03 rollback gate | Core deterministic projection/replay | Target limited to replay-reconstructible state | Production-boundary test unverified |
| PERS-SEM-025 | 01 §5; 03 authorized-read gate | Core actor/purpose-authorized read | Specified | Blocked: snapshot is not authorization |
| PERS-SEM-026 | 05 §3; 03 authorized-read gate | Core safe read-result semantics | Specified | Blocked: withheld/unset distinction unverified at runtime |
| PERS-SEM-027 | 01 §§2, 4; 07 handoff | Core/card projection; authorized canonical read | Derived/read-only target specified | Safe authorized projection unverified |
| PERS-SEM-028 | 01 §3; 06 §7 | Player-control contract; Personality/NPC must respect it | Specified | No runtime player-control test claimed |

## PERS-TRAIT case crosswalk

IDs are defined in `06-stable-trait-lifecycle.md`; this summary does not replace that document.

| ID(s) | Owner / boundary | Specification status | Runtime status |
|---|---|---|---|
| PERS-TRAIT-001–003 | Personality lifecycle semantics | Specified | Not runtime-tested |
| PERS-TRAIT-004 | Core-authorized correction, provenance, audit | Specified | Integration blocked |
| PERS-TRAIT-005–008 | Personality lifecycle; player-control boundary where relevant | Specified | Not runtime-tested |
| PERS-TRAIT-009 | Core authorized read | Specified | Integration blocked |
| PERS-TRAIT-010 | Core rollback/rebuild for supported trait-development event | Conditional target | Integration blocked |

## Maintenance rules

1. Do not renumber or reuse acceptance IDs.
2. If a case is split, renamed, or retired, retain a redirect to its successor and update the primary matrix and this crosswalk.
3. “Specified” is not “implemented”; “implemented” is not “tested on production boundary.”
4. Do not close a Core-owned row without explicit contract/implementation evidence from Core.
5. Do not invent universal relationship dimensions or infer runtime behavior from narrative examples.
6. This is documentation only; no runtime code or executable tests were added.

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
