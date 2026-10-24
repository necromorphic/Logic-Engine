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

## Acceptance-criterion disposition

- **Covered by source-level pure-evaluator tests:** candidate purity; omitted-dimension behavior; explicit clear; whole-candidate rejection; directedness; unset/neutral/cleared/withheld/conflict/unsupported distinctions; special property keys; pinned version input and deterministic repeat evaluation.
- **Specified but not executable in inspected consumer path:** stable-trait non-mutation; knowledge partition; no inferred motive/cause/consent/obligation/reciprocity; player agency in the production NPC path.
- **Blocked on Core production contracts/tests:** canonical write/read; true commit atomicity; trusted provenance and author correction; actor/purpose authorization; audit/revision; commit idempotency/event deduplication; canonical clear history; historical version selection/migration; rollback/rebuild and safe projections.

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
