# NPC Pure Semantic Test Specification (Design Only)

Status: **test specification only; not implementation authorization**  
Scope: deterministic NPC semantic decisions that can be tested from explicit inputs without model calls, persistence, scheduler, or production integration.  
Parent proposal: `docs/82-npc-dispatcher-architecture-proposal.md` §7.2  
Source contracts: `docs/31-npc-subsystem-contract.md`, `docs/32-npc-semantic-acceptance-matrix.md`, `docs/35-npc-test-boundary-map.md`, and `docs/81-npc-goal-action-contracts-proposal.md` §14.

## 1. Rules for every test in this document

- Test a pure function/reducer/validator only if an existing or separately approved test seam can be identified. This document does not assume that such a function already exists.
- Supply all facts, statuses, policy and time coordinates as explicit input. Do not call a model or read ambient process state.
- Assert the semantic decision and relevant output fields; avoid brittle assertions about prose, ordering, or implementation-specific enum names not yet approved.
- A missing field must not silently be filled from a fixture default unless the test explicitly supplies that default.
- Keep test fixtures synthetic and clearly labelled. No fixture is evidence of production authorization, persistence, delivery, serialization or canonical commit.
- If the existing implementation has no suitable pure seam, record the case as **spec-ready / implementation seam not identified**; do not create a new runtime interface under this document.

## 2. Initial test cases

### NPC-PURE-001 — A failed plan does not erase its goal

**Given**
- Goal G is active.
- Plan P is linked to G.
- A trusted input states that P's prerequisite failed.
- No input states that G itself is complete, invalid, or abandoned.

**When** the semantic decision is evaluated.

**Then**
- P is not treated as successfully completed.
- G is not erased or marked complete solely because P failed.
- The result permits reconsideration/replanning, or remains unresolved if the current contract cannot choose a next plan.
- The test does not require a particular replacement plan.

**Negative assertion:** generated text saying “goal completed” is not a trusted outcome input.

### NPC-PURE-002 — Missing evidence stays unresolved

**Given**
- A decision requires evidence E.
- E is absent, incomplete, or explicitly withheld.
- No trusted rule defines absence as success, failure, false, or permission.

**When** the decision is evaluated.

**Then**
- The result remains unresolved/unknown/blocked according to the existing contract vocabulary.
- No fact, cause, permission, or explanation is invented.
- Withheld content is not copied into a user-facing diagnostic.

**Variants:** absent evidence; incomplete evidence; withheld evidence. Keep the inputs distinct and do not assume the outputs must share one status if the governing contract differentiates them.

### NPC-PURE-003 — Report lifecycle states are not interchangeable

**Given** a synthetic report with an explicit lifecycle state.

**When** the report is evaluated for what a recipient knows.

**Then**
- `pending` does not imply sent, received, understood, or believed.
- `sent` does not imply received.
- `received` does not imply understood or believed.
- `understood` does not imply believed unless an explicit contract says so.
- A player's awareness requires its own supported input; NPC receipt does not imply player awareness.

**Test data:** create one case per supplied state and assert only implications authorized by the source contract. Do not invent a canonical state enum in the test.

### NPC-PURE-004 — An off-screen event does not imply awareness

**Given**
- Canonical event E occurred.
- No witness, authorized report, observation, or other valid acquisition evidence is supplied for actor A.
- No separate evidence of player visibility/awareness is supplied.

**When** actor-relative knowledge and player awareness are evaluated independently.

**Then**
- E's occurrence alone does not establish A's knowledge.
- E's occurrence alone does not establish player awareness.
- Canonical truth remains distinct from actor-relative knowledge.

**Control case:** if a fixture explicitly supplies a valid authorized report/observation, assert only the consequence that the applicable source contract supports; do not test a production delivery path here.

### NPC-PURE-005 — NPC output cannot decide a player's voluntary action

**Given**
- An explicit policy fixture marks character C as player-controlled.
- A candidate NPC output claims as already decided/committed that C voluntarily acted, spoke, consented, thought, or chose.
- No trusted player input or canonical event supports that claim.

**When** the pure output/intent validator evaluates the candidate.

**Then**
- The unsupported player-authored claim is rejected or marked unresolved according to the supplied policy.
- The validator does not convert the claim into a canonical event.
- Other parts of the output may only be retained if the validator contract defines safe partial acceptance; otherwise reject the whole candidate.

**Important:** this is a policy-fixture test, not proof the real Host/narration/commit boundary enforces player agency.

### NPC-PURE-006 — A chat turn does not advance game time

**Given**
- Previous and current canonical game-time coordinates are identical.
- The chat-turn identifier changes.
- A task/deadline is eligible only after a canonical game-time threshold.

**When** trigger eligibility is evaluated.

**Then**
- The changed chat-turn identifier alone does not make the time threshold pass.
- No time-based task is advanced solely because a new chat turn exists.
- If explicit canonical game time advances in a separate control case, eligibility is determined by that supplied time and the existing rule, not by turn count.

**Important:** this tests a pure eligibility decision only; it does not test or authorize a scheduler/worker.

### NPC-PURE-007 — Model assertion or pending proposal is not a committed outcome

**Given** one of these inputs:
1. model text claims success but no trusted result exists;
2. a proposal exists with status `pending`;
3. a trusted result is present but references a different attempt/action;
4. no result-to-attempt correlation is supplied.

**When** the candidate outcome is evaluated.

**Then**
- Cases 1–4 do not become confirmed success merely from the supplied text/proposal/unmatched result.
- Missing or mismatched correlation remains unresolved.
- Only a trusted, correctly correlated authoritative result can satisfy this semantic predicate, if the relevant contract defines such a predicate.

**Boundary:** use synthetic labelled records only. Do not claim that the production correlation path exists.

## 3. Execution and reporting checklist

For each case, record:

- [ ] Existing pure function/test seam identified (path and symbol).
- [ ] Expected behavior is supported by a cited source contract.
- [ ] Inputs explicitly represent all statuses and policies used.
- [ ] Positive and negative assertion included.
- [ ] No model call, storage, network, clock, scheduler, or hidden side effect.
- [ ] Test name identifies the semantic claim, not “NPC integration”.
- [ ] Result report states whether this is a pure semantic test, a generic Core regression, or a production-boundary integration test.

Do not mark a case implemented until an actual test file and runnable test command are identified. Do not mark a case passed until it has been run and the result observed.

## 4. Explicitly excluded from this specification

The following require real production boundaries and remain blocked as integration/security claims:

- secret omission at the exact model-input serialization boundary;
- Core-owned initial-knowledge acquisition, provenance, actor isolation, replay/restart and invalidation;
- actual report sending/receipt/acknowledgement;
- trusted NPC identity-to-purpose/action authorization;
- authoritative NPC-attempt-to-Core-result correlation;
- persistent goal/plan updates and causal reconciliation;
- identity/document persistence and observer-specific disclosure;
- NPC-state rollback and recovery after restart.

This specification does not select an `observe` evidence source, decide the trusted NPC caller/purpose owner, resolve the Core acquisition contract review, or authorize runtime/API/schema/storage/dispatcher/scheduler/worker changes. `Memory → NPC` remains **DISABLED / FAIL-CLOSED**; Host remains **NON_READY**.


## 5. Current seam audit

The initial seven cases are **specified**, not all currently executable as pure tests. See `docs/87-npc-semantic-test-seam-audit.md` for the source-checked mapping to existing functions and tests. In particular, the goal/plan reducer, report lifecycle, actor-relative awareness, player-agency output gate, and NPC action-result correlation seams were not identified. Adjacent Core tests must not be relabelled as passing those NPC cases.

Implementation rule: only add an executable test when it calls a real existing, owner-approved function or production boundary. For a blocked case, retain the specification and request the missing owner/boundary decision; do not add a mock implementation or a new runtime seam to make the test pass.
