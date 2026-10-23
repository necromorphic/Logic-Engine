# NPC First-Slice Test Boundary Map

Status: repository test mapping and implementation gate; documentation only. Inspected against `main` at the time of writing. No tests were executed and no runtime test file was added.

## 1. Why this document exists

The first NPC slice is a bounded decision-context plus non-committing proposal. The repository already tests several adjacent core guarantees, so the NPC branch must reuse those guarantees and add tests only for genuinely missing semantics. A test that merely mocks the desired behavior or asserts that a design document contains certain words is not an acceptance test for the subsystem.

## 2. Existing tests to reuse as baseline

| Existing test | Verified responsibility | What it does not prove for NPCs |
|---|---|---|
| `tests/core.test.js` — `stale proposal is rejected without partial effects` | A proposal based on stale world history is rejected | Actor-specific knowledge/access or player-agency policy |
| `tests/core.test.js` — `rule evaluator rejects unknown fields and read_set references must exist locally` | Invalid fields and unsupported reads are rejected | Missing input vs known-false distinction for all rule conditions |
| `tests/core.test.js` — `proposal commit rolls back canonical event if proposal finalization fails` | Proposal commit/finalization atomicity in the tested failure case | Whether the proposed action was authorized or semantically appropriate |
| `tests/api.test.js` — `health, auth, proposal approval, and canonical commit boundary` | Proposal requires approval before canonical commit; validation metadata identifies unchecked semantic review | NPC permissions and player-agency checks are enforced (they are explicitly marked unchecked) |
| `tests/api.test.js` — `proposal must be approved and cannot commit against a stale snapshot` | Approval is required and stale snapshots cannot be committed | Actor knowledge and authorization |
| `tests/api.test.js` — `proposal creation performs deterministic validation without mutating canonical state` | Unsupported effects are rejected and proposal creation leaves canonical revision unchanged in the covered case | Full NPC decision cycle or persistent NPC state |
| `tests/api.test.js` — `API registers a generation-bound context manifest and commits against it through the internal route` | A manifest can be registered and referenced by an event | Manifest membership is not proof that an actor was allowed to know each item |
| `tests/causality-contract.test.js` — context-manifest tests | Undeclared reads and stale manifest revisions are rejected in covered cases | Actor-level information access, secret withholding, or belief state |
| `tests/causality-contract.test.js` — `fact_value REQUIRES rejects unknown conflicted claims` | Unknown/conflicted required facts fail closed in this core precondition path | General tri-state rule evaluation for every condition |
| `tests/causality-contract.test.js` — rollback tests for independent branches and required predicates | Core event rollback has tested causal invalidation/preservation behavior in covered cases | NPC knowledge/goals/plans have no verified persistent runtime to reconcile |

These tests are useful regression baselines; they are not substitutes for the NPC-specific acceptance cases below.

## 3. NPC scenarios mapped to current coverage

Legend: **Covered adjacent behavior** means the core tests exercise a related primitive, not the full NPC requirement. **Missing** means no verified end-to-end test was identified in the inspected test files.

| NPC scenario | Existing coverage | Additional test required |
|---|---|---|
| NPC-CTX-001 — Retrieved secret is withheld | Missing | Give the context builder a retrieved-but-unauthorized secret and prove the exact secret never reaches the model input; prove no NPC knowledge or world state is written |
| NPC-CTX-002 — Missing context remains unknown | Partial adjacent coverage: unknown `REQUIRES` predicates; rule evaluator is boolean | Exercise required context field states: known true, known false, unknown/incomplete, and withheld; prove unknown does not silently become false |
| NPC-CTX-003 — False belief remains actor-relative | Missing | Supply canonical fact P and explicit actor belief not-P; prove both remain distinct and decision input does not overwrite canonical state or auto-correct the belief without evidence |
| NPC-CTX-004 — Failed precondition cannot commit | Covered adjacent behavior: core validates supported effects and required predicates | Submit an NPC-originated proposal with a known-false precondition; prove it cannot pass to approval/commit merely because the proposal payload is valid |
| NPC-CTX-005 — Proposal does not mutate state | Covered adjacent behavior: proposal creation is non-committing in existing tests | Add an NPC decision-path test that compares world state, revision, commit sequence, events, time, knowledge, and delivery records before/after proposal generation |
| NPC-CTX-006 — Unsupported effect is not guessed | Covered adjacent behavior: unsupported effect kinds are rejected | Map every allowed NPC intent to an existing core operation; test every unmapped intent returns review/rejection and does not mutate state |
| NPC-CTX-007 — Player agency is preserved | Missing | Validate narrative/output boundary: NPC proposal can be described after authorization, but no player action, dialogue, thought, consent, or decision is generated as a committed fact |
| NPC-CTX-008 — Chat turns do not advance world time | Covered adjacent behavior: core has explicit time-advance rules | Run multiple NPC decision turns without a committed time event and prove game_time, event log, and scheduled progression do not advance |

## 4. Required test layers

The tests should be written in this order, and should use real repository boundaries rather than invented test-only implementations:

### Layer A — Core regression tests (reuse, do not rewrite)

Run the current suite unchanged first. This establishes whether the base revision is healthy before NPC changes. Required environment: Node.js `>=22.13.0` per `package.json`.

### Layer B — Pure semantic contract tests

These tests can be implemented without database or API changes only after a real context-preparation function exists. Test the admission decision independently from the model call:

- permitted item is admitted with source/provenance;
- unauthorized retrieved item is omitted;
- incomplete field is marked unknown rather than converted to false;
- canonical truth and actor belief remain separate;
- proposal generation is a pure/non-mutating operation.

Do not create a mock context builder that pretends to enforce access rules; that would test the mock, not the product.

### Layer C — Integration tests against existing core services

Use the real context-manifest and proposal services to verify:

- the manifest cursor matches the intended world revision and commit sequence;
- a proposal remains pending and does not change canonical world state;
- unsupported effects fail closed;
- approval and commit remain separate;
- a stale proposal is rejected;
- manual semantic review remains required where the core says checks are not performed.

These tests can verify existing primitives today, but the NPC-specific adapter and authorization policy must exist before they can prove end-to-end NPC safety.

### Layer D — Runtime persistence tests (blocked)

Do not implement these until an authoritative NPC state model and causal ownership contract are approved. Required future cases include persistent beliefs, goals/plans, report delivery, off-screen progress, and rollback reconciliation. Do not emulate them in prompt state or add a parallel store.

## 5. Blocking decisions and dependencies

1. **Trusted context source:** identify the existing adapter/caller responsible for actor identity and permitted information. A manifest's item list is not authorization.
2. **Context completeness:** specify how the decision path knows a field is absent, unknown, or withheld. Do not change global `evaluateCondition` behavior in this NPC-only step.
3. **Intent-to-effect mapping:** enumerate the initial NPC action vocabulary and map each item to a supported core effect/event; unknown mappings must require review.
4. **Narrative/player-agency check:** identify the actual host boundary where generated narrative becomes user-visible or a canonical action. No such integration is claimed by this document.
5. **Runtime and test execution:** run the suite locally or in CI using the repository's supported Node version; GitHub source browsing alone cannot report tests as passing.

## 6. Go/no-go rule

**Go** for test authoring only when the relevant production boundary exists and can be called by the test. **No-go** for NPC runtime persistence, scheduler, autonomous background execution, new API, or SQLite changes until the semantic contract, context authorization, action mapping, and causal/rollback requirements are independently reviewed.

This document does not claim any test has passed. It records which existing core guarantees can be reused and exactly what remains unproven for the NPC subsystem.
