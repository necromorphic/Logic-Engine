# NPC Semantic Test-Seam Audit

Status: **source audit / documentation only**. This document identifies existing nearby code and tests for the seven cases in `docs/86-npc-pure-semantic-test-specification.md`. It does not add or run tests and does not authorize runtime changes.

## Evidence rules

- Main-branch source and tests were inspected through GitHub file views for this audit. The NPC proposal branch is diverged from main; before implementation, re-check each path at the exact proposed test commit.
- “Adjacent coverage” means a real existing primitive tests a narrower property. It is not acceptance evidence for the full NPC semantic claim.
- Do not implement a test by creating a mock function that simply returns the desired answer.
- The repo’s own `docs/35-npc-test-boundary-map.md` says NPC goal/plan state, report delivery, actor-relative awareness, and the player narration boundary remain unverified or blocked.

## Case-by-case seam map

| Specification case | Existing source/test seam found | What may be reused | Decision for an NPC-specific executable test |
|---|---|---|---|
| `NPC-PURE-001` goal survives failed plan | `src/process/contract.js`; `tests/process-contract.test.js` tests prerequisite ordering and milestone progress | Process definitions and milestone readiness are real pure contracts. They are not an NPC goal store. | **BLOCKED for the stated claim.** No verified goal/plan state representation or pure reducer was identified. Do not relabel process milestones as NPC goals. |
| `NPC-PURE-002` missing evidence remains unresolved | `src/core/rules.js` exports `evaluateConditionResult(...)`; `tests/tri-state-rules.test.js` includes “result API preserves legacy Boolean behavior while exposing missing context as unknown” and “explicitly proven absence is distinct from unavailable context”. `src/npc/memory-candidate-eligibility.js` has `tests/npc-memory-candidate-eligibility.test.js` coverage for missing/denied/withheld/ambiguous admission metadata. | Existing tests may be reused for those exact tri-state rule and candidate-admission guarantees. | **PARTIAL / adjacent only.** These APIs do not establish general NPC decision-context completeness, actor authorization, or a universal “unknown” output contract. Do not widen their claim. |
| `NPC-PURE-003` report states are not interchangeable | `src/process/contract.js`; `tests/process-contract.test.js` includes “progress projection exposes only prerequisite-ready milestones and never infers knowledge or delivery” | Reuse only the tested process-status and non-inference behavior. | **BLOCKED.** No authoritative NPC report lifecycle state machine or send/receipt evidence boundary was identified. Process milestone statuses are not report states. |
| `NPC-PURE-004` off-screen event does not imply awareness | `docs/32-npc-semantic-acceptance-matrix.md` and `docs/35-npc-test-boundary-map.md` define the requirement; generic event/proposal code can represent occurrences. | Existing event tests can prove event occurrence/commit behavior only. | **BLOCKED.** No verified actor-relative awareness or valid communication/viewpoint boundary was identified. |
| `NPC-PURE-005` NPC output cannot decide a player's voluntary action | `tests/communicative-intent-acceptance.test.js` validates a semantic corpus around uncertain intent, consent and unsupported promotions. `docs/35` marks the actual narration/Host boundary missing. | Corpus integrity and its specific semantic invariants can be reused as such. | **BLOCKED for player-agency enforcement.** No real output/intent validator or production narration/commit boundary was identified. Do not treat communicative-intent classification as a player-action gate. |
| `NPC-PURE-006` chat turn does not advance game time | `tests/time-advance-operation.test.js` covers explicit time advancement, idempotency and blocked work without advancing time. `tests/process-contract.test.js` covers process lifecycle/progress. | Reuse explicit time-operation and process-trigger behavior exactly as tested. | **PARTIAL / adjacent only.** These tests do not exercise an NPC chat-turn path. No NPC turn dispatcher was verified that can be tested for absence of an implicit time mutation. |
| `NPC-PURE-007` model/pending proposal is not committed outcome | `tests/core.test.js`, `tests/api.test.js`, and `tests/causality-contract.test.js` cover generic proposal non-commit, approval, stale snapshots, and rollback cases. | Reuse existing generic proposal regression tests; do not duplicate them as NPC tests. | **BLOCKED for attempt/result correlation.** No verified NPC attempt identifier and authoritative result-correlation function was identified. Generic proposal lifecycle is not an NPC outcome correlation service. |

## Verified NPC-owned pure seam: narrow and unrelated to most cases

The source audit found `evaluateMemoryCandidateAdmission(request, result)` in `src/npc/memory-candidate-eligibility.js`, with tests in `tests/npc-memory-candidate-eligibility.test.js`. `docs/56-npc-memory-boundary-acceptance-matrix.md` explicitly limits it to a pure candidate-admission oracle over supplied metadata: it is not a runtime Memory retrieval entry point, authorization service, Core adapter, or proof that a result came from Core. Its reference-only/fail-closed behavior must not be repurposed to claim goal, report, awareness, agency, time-trigger, or action-result semantics.

## Current disposition

- **No new test file should be added for NPC-PURE-001, 003, 004, 005, or 007 yet.** The necessary semantic function or production boundary has not been identified.
- **NPC-PURE-002 and 006 have adjacent testable primitives only.** Keep tests scoped to the existing functions and their documented contracts; do not claim the broader NPC case passed.
- **The next safe action is review/decision, not code:** identify the owner-approved function/boundary for each blocked case. For goals/plans and report lifecycle in particular, the current evidence does not identify a pure seam that can be tested without inventing a new subsystem.
- No test was executed during this audit. `Memory → NPC` remains **DISABLED / FAIL-CLOSED**; Host remains **NON_READY**.


## Minimum evidence required to unblock each case

These are evidence requirements, not proposed implementations or inferred assignments.

| Blocked case | Minimum prerequisite before test implementation can be reconsidered |
|---|---|
| Goal survives failed plan | Coordinator-approved goal/plan contract plus an identified real pure transition/reducer seam and an explicit authoritative plan-failure input. |
| Report lifecycle | Coordinator-approved lifecycle vocabulary/transition ownership plus a trusted source for each send/receipt/acknowledgement/understanding/player-awareness transition. |
| Off-screen awareness | Identified actor-relative knowledge and player-awareness boundary, including the valid communication/viewpoint evidence used by each. |
| Player agency | Identified real output/narration/Host boundary where generated claims are validated before becoming visible or canonical, with the approved policy available to that boundary. |
| Chat turn versus game time | Identified actual NPC turn/dispatch entry path plus a way to assert canonical time, event log and scheduled progress are unchanged absent an explicit time-advance operation. |
| Action-result truth | Approved NPC attempt identity and correlation rule connecting the attempt to an authoritative Core result; pending proposal/model output must remain non-authoritative. |
| Missing evidence beyond existing helpers | Explicit context-completeness and actor/purpose authorization contract identifying when absence is known, unknown, withheld, incomplete or unsupported. |

The initial knowledge path remains sequenced behind the coordinator's existing decision: `author_initial` / `imported` acquisition with Core-owned provenance/validity and actor-/purpose-scoped safe filtering must be established first. Nothing in this table authorizes `observe` to bypass that foundation, selects an `observe` evidence source, assigns an individual implementation owner, or permits runtime/API/schema/storage/dispatcher/scheduler/worker changes.
