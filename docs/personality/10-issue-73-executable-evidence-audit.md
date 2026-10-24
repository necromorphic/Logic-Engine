# Issue #73 — Per-criterion executable evidence audit

Status: repository-source audit; not a test-run report. Audited 2026-10-24 against the named refs below. Test names are quoted as found in source. A source-level test mapping does not establish that the suite passes or that another subsystem implements the same behavior.

## Scope and evidence rules

- Personality acceptance source: `docs/personality/04-semantic-acceptance-matrix.md`, `05-world-pack-relationship-dimension-template.md`, `08-semantic-traceability-and-review-workflow.md`, and `09-per-case-acceptance-traceability.md`.
- Pure evaluator source: `feat/relationship-pure-evaluator:tests/relationship-evaluate-candidate.test.js`.
- NPC consumer contract: `feat/npc-subsystem:docs/52-npc-relationship-consumer-compatibility.md`. This is a document on another branch, not an executable test and not modified by this audit.
- Relationship proposal references: `feat/relationship-domain-module:docs/47-relationship-module-test-traceability.md` and `docs/48-relationship-pure-evaluation-contract.md`.
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
| Canonical write atomicity, authorization, trusted provenance, audit/revision, rollback/replay | Personality Core integration gates and Relationship proposal contract identify these as Core-owned | **Core integration blocker**: evaluator tests do not execute these operations. No evidence here supports a pass claim. |

## Complete PERS-SEM ID disposition

This table closes the per-ID pass over the canonical matrix. “No executable test found” is an explicit disposition, not a claim that the behavior passed. Test names refer to `feat/relationship-pure-evaluator:tests/relationship-evaluate-candidate.test.js` at the audited evaluator ref unless otherwise stated.

| ID | Executable evidence / explicit disposition | Boundary |
|---|---|---|
| PERS-SEM-001 | Test: `keeps direction explicit and does not create a reciprocal patch` | Pure candidate only; Core directional persistence blocked |
| PERS-SEM-002 | Tests: `omitted dimensions remain omitted from the candidate patch`; `clearing one dimension leaves every other dimension outside the candidate patch` | Pure patch semantics; canonical partial-write atomicity blocked |
| PERS-SEM-003 | Tests: `does not infer a neutral/default value for an unset dimension`; `distinguishes explicit domain values from unset state`; `keeps explicit neutral distinct from unset and treats an existing neutral value as a no-op` | Pure evaluator; production read representation unverified |
| PERS-SEM-004 | Tests: `uses an explicit clear operation, not omission or a sentinel value`; `distinguishes unset from a previously cleared dimension` | Candidate/state distinction only; canonical clear history and authorized read blocked |
| PERS-SEM-005 | Partial/clear tests establish candidate isolation; **no dedicated executable test found** for every cross-dimension non-implication (consent, knowledge, obligation, reciprocity) | World Pack/NPC semantic consumer test remains unimplemented |
| PERS-SEM-006 | Tests: `rejects the whole candidate if any dimension is unsupported`; `returns a non-mutating unsupported result when dimension rules are incomplete`; special-key tests listed above | Evaluator validation only; Core enforcement blocked |
| PERS-SEM-007 | Tests: `rejects clearing where the active dimension rule disallows it`; `does not silently apply a transition absent from the World Pack rules`; `rejects malformed transition declarations as incomplete rules`; `rejects a mixed valid/invalid patch without exposing partial output or mutating inputs` | Pure candidate rejection; canonical commit atomicity blocked |
| PERS-SEM-008 | **No dedicated executable test found** for scene co-presence alone causing no transition | Future domain/consumer regression test; do not infer from deterministic evaluation |
| PERS-SEM-009 | **No executable test found** for canonical participant-ID existence through the production write boundary | Core identity/typed-write integration blocker |
| PERS-SEM-010 | Test: `self-relations are rejected unless each affected dimension explicitly allows them` | Pure evaluator; Core identity/write enforcement unverified |
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
| PERS-SEM-021 | **No executable Core rollback/rebuild test found** for revoking the only required dependency | Core causal rollback integration blocker |
| PERS-SEM-022 | Explicitly deferred by the canonical matrix; **no executable test or accepted independent-support contract found** | Deferred pending Core representation and World Pack sufficiency rules |
| PERS-SEM-023 | Tests: `does not evaluate a transition when evidence is insufficient or conflicting`; `preserves each non-value relationship state instead of treating it as unset` | Pure evaluator states only; production reconciliation blocked |
| PERS-SEM-024 | Tests: `requires a pinned rule version`; `re-evaluating identical inputs is deterministic and side-effect-free` | Fixed-input deterministic evaluation only; historical version lookup/replay/rollback not proven |
| PERS-SEM-025 | **No executable actor/purpose-authorized read test found** | Core authorized-read integration blocker |
| PERS-SEM-026 | Tests distinguish withheld/current state from unset within evaluator inputs; **no executable authorized-read non-disclosure test found** | Core disclosure/filtering blocker |
| PERS-SEM-027 | **No executable safe, read-only character-card projection test found** | Core authorized projection integration blocker |
| PERS-SEM-028 | **No executable production player-agency test found** for preserving player dialogue, thoughts, decisions, and actions | NPC/player-control consumer test remains unimplemented |
| PERS-SEM-029 | **No executable historical version-selection/migration test found**; template and matrix specify explicit migration or incompatibility for meaning-changing updates | Core historical versioning/migration blocker; keep distinct from PERS-SEM-024 |

### Legacy ID and auxiliary acceptance families

- `PERS-REL-001–003`, `PERS-REL-009`, `PERS-REL-010`, `PERS-REL-014–015` map to the PERS-SEM rows above; the exact evaluator tests are listed there where present. Legacy IDs do not create additional runtime evidence.
- `PERS-REL-004` (co-presence only), `PERS-REL-005–006` (initial/correction provenance), `PERS-REL-007–008` (canonical identity/self-relation), `PERS-REL-011–013` (knowledge, card projection, rollback), and `PERS-REL-016` (player agency) have no complete production-boundary test evidence in the inspected branches. They remain mapped to the corresponding PERS-SEM criteria and the Core/NPC blockers above.
- `PERS-TRAIT-001–013`: the Personality lifecycle document specifies these criteria, but the inspected NPC branch exposes only a consumer compatibility contract and no executable relationship-consumer runtime test. Therefore no PERS-TRAIT runtime pass is claimed; Core-owned authorization, audit, and rollback items remain integration blockers.

## Acceptance-criterion disposition

- **Covered by source-level pure-evaluator tests:** candidate purity; omitted-dimension behavior; explicit clear; whole-candidate rejection; directedness; unset/neutral/cleared/withheld/conflict/unsupported distinctions; special property keys; pinned version input and deterministic repeat evaluation.
- **Specified but not executable in inspected consumer path:** stable-trait non-mutation; knowledge partition; no inferred motive/cause/consent/obligation/reciprocity; player agency in the production NPC path.
- **Core first-slice write path now implemented/tested:** privileged canonical write; transaction atomicity; event/projection/revision/audit/idempotency; directed rebuild and tested rollback dependencies. **Still blocked:** general authorized reads, NPC/model-facing writes, generic import/correction, historical World Pack migration, and downstream consumer non-implication tests. See the superseding current-main addendum below.

## CI evidence (separate from this documentation audit)

GitHub Actions workflow **Runtime tests**, run [#591](https://github.com/necromorphic/Logic-Engine/actions/runs/40058497617), completed successfully on `feat/relationship-pure-evaluator` at commit `b2697e77ac0e97b1f7022656c08da5776fa29685`. Its `npm test` step concluded `success` (run created 2026-10-24 03:29:21 UTC). This is positive CI evidence for that exact evaluator commit only. It is not a test run for this Personality PR, does not certify a newer evaluator commit, and does not demonstrate Core/NPC integration. The source/documentation audit in this PR did not execute the suite itself.

## CI evidence for this PR head

GitHub Actions workflow **Runtime tests**, run [#618](https://github.com/necromorphic/Logic-Engine/actions/runs/40059045655), completed successfully for this PR head, commit `cfa4ff604f9ade802ecbd83e8a94f49466cb08b7` on `fix/personality-issue-73-test-traceability`. The run was triggered by the PR and reports conclusion `success`. This is current CI evidence for the repository's configured Runtime tests workflow at that commit; it is not evidence that the documentation audit independently executed the suite, nor does it close Core/NPC integration blockers identified below.

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

The correction is verified in the canonical table and the accompanying `12-relationship-crosswalk-correction.md`. No new Personality acceptance ID was introduced; no runtime/API/schema/Core/Relationship/NPC implementation was changed; the PR remains open and unmerged.


## Superseding addendum — current Core Relationship production-path evidence (2026-10-24)

Core PRs #94–96 are merged to `main`. The older status rows above remain useful as a record of the earlier audit, but any statement that *all* canonical write/atomicity/idempotency/rollback behavior is still unimplemented is superseded by this addendum.

### Executable Core tests now present

`tests/relationship-transition-core.test.js` at current-main blob `086cfb0db38c3398979d9609a368c8642f19b680` contains 12 named tests:

1. `admin-gated typed transition commits directed state, event, revision and audit atomically`
2. `API rejects ordinary bearer without the separate admin credential and does not mutate state`
3. `admin route commits through the canonical event lifecycle and returns the current directed projection`
4. `generic event preparation cannot smuggle a Relationship effect`
5. `stale composite cursor and spoofed executor are rejected without mutation`
6. `invalid mixed patch commits nothing and idempotent retry does not duplicate a transition`
7. `source rollback invalidates a Relationship transition that cites the source`
8. `clear remains distinct from unset and rollback restores the previous surviving value`
9. `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`
10. `event insert and audit failures roll back the entire Relationship transition`
11. `projection and idempotency persistence failures roll back Relationship event, state, revision and audit`
12. `rollback invalidates later transition dependent on the same directed pair and rebuilds surviving state`

PR #96 adds fail-closed regression coverage for unsupported alternative-support metadata and caller-supplied evidence status. Exact-head Runtime test runs for #94/#95/#96 succeeded at [#705](https://github.com/necromorphic/Logic-Engine/actions/runs/40063961970), [#707](https://github.com/necromorphic/Logic-Engine/actions/runs/40064048816), and [#717](https://github.com/necromorphic/Logic-Engine/actions/runs/40064276520), respectively.

### Criterion-level disposition after the Core merge

- **Now has production-path evidence:** privileged canonical directed transition; event-backed projection/rebuild; separate admin credential; generic effect-smuggling rejection; mixed invalid patch leaves no mutation; composite `(world_revision, commit_sequence)` freshness; event/source/world/version validation; transaction rollback on event/audit/projection/idempotency persistence failures; idempotent retry; clear vs unset; rollback of evidence and directed-pair dependencies.
- **Still not proven by these tests:** general actor/purpose-authorized read; NPC/model-facing write authority; trusted initial import/author correction; historical World Pack migration; alternative independently sufficient support; NPC/Personality consumer behavior for stable traits, knowledge, motive, consent, obligation, reciprocity, and player agency. Each requires its own approved boundary and direct test.
- The Core endpoint is admin-credential-only and is not an NPC capability. The existing authorized-read route remains self-identity-only. Do not describe the runtime slice as general Relationship integration.
- Keep `PERS-SEM-024` (deterministic repeat/replay with pinned inputs in the supported slice) separate from `PERS-SEM-029` (meaning-changing World Pack version, migration, or incompatibility).

### Evidence scope

The exact test names above are source-verified from current `main`. The cited Actions runs are exact-head CI evidence for the listed Core PRs. This addendum is a documentation crosswalk; it does not claim that the Relationships documentation change itself has run CI or that every Personality/NPC acceptance criterion is now passed.
