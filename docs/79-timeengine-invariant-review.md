# TimeEngine — invariant review and next verification steps

**Status:** working review draft, not an approved architecture decision.  
**Repository basis:** current `main` documentation, especially `docs/63-time-advance-operation-runtime-slice.md`, `docs/64-time-policy-calendar-authoring.md`, `docs/78-time-trigger-registry-runtime-slice.md`, and `docs/20-minimal-runtime.md`.  
**Scope:** temporal policy, time advancement, scheduled triggers, interruption/recovery boundaries. This document does not introduce a second scheduler or authorize direct mutation outside Core.

## 1. Existing contracts supported by repository documentation

1. Canonical game time is an integer millisecond coordinate; event-facing execution currently requires whole-second boundaries.
2. Time advances only through accepted Core events / the Core time-advance pipeline. There is no background wall-clock scheduler.
3. TimePolicy is versioned and immutable after registration; duration rules and skip ceilings are enforced by Core.
4. Time-advance operations use an expected revision and idempotency key, persist checkpoints, and resume from durable operation state.
5. Registered triggers are Core-owned scheduling metadata; trigger events are validated at registration/planning and due work is processed deterministically.
6. Trigger intervals use the documented temporal interval semantics; planning and conflicts must not silently skip due registered triggers.
7. A scheduled trigger cannot bypass duration policy by introducing a positive duration when its due-time effect is expected to have zero additional duration.
8. Conflicting event effects must be resolved through declared conflict sets and Core validation, not assumed independent because a declaration was omitted.

These are repository-documented contracts; they are not a claim that every integration path has been independently audited in this review.

## 2. Proposed invariants to validate against implementation

| ID | Proposed invariant | Why it matters | Verification needed |
|---|---|---|---|
| TE-I01 | Only Core commits canonical game-time changes. | Prevents competing authorities. | Search all write paths and test unauthorized/direct paths. |
| TE-I02 | A duration decision is tied to the active immutable TimePolicy version. | Makes outcomes reproducible. | Trace policy resolution through event, operation result, and audit. |
| TE-I03 | Time advancement rejects stale expected revisions. | Prevents committing against outdated world state. | Confirm start and resume behavior under concurrent revision change. |
| TE-I04 | Repeating an idempotent request cannot duplicate committed effects. | Makes retries safe. | Failure injection before/after segment commit and replay tests. |
| TE-I05 | A durable checkpoint describes exactly the committed prefix of an operation. | Prevents lost or double-counted time after recovery. | Crash/reopen/resume tests at each segment boundary. |
| TE-I06 | A pending trigger inside the requested interval cannot be silently crossed. | Preserves event order. | Boundary tests for triggers at start, inside interval, and target. |
| TE-I07 | Same-coordinate conflicts are resolved deterministically or surfaced explicitly. | Prevents order from inventing causality. | Permute input order and compare result/conflict record. |
| TE-I08 | Invalid or unsupported precision is rejected, not silently rounded. | Avoids temporal drift. | Verify all API and internal paths enforce whole-second compatibility. |
| TE-I09 | An interrupted operation records completed work and remaining work separately. | Enables safe continuation. | Inspect operation schema and interruption/resume transitions. |
| TE-I10 | A retry/resume uses the operation's persisted inputs and policy/config versions, not mutable caller replacements. | Prevents changed semantics across retries. | Attempt resume with changed request fields and changed active configuration. |
| TE-I11 | Concurrent actions are not treated as sequential merely because they appear in one request. | Avoids inflated elapsed time. | Confirm the action model explicitly marks sequencing/concurrency. |
| TE-I12 | The engine does not claim an action completed beyond the committed time interval. | Keeps narrative and world state consistent. | Requires a clear action-progress contract; current evidence may be incomplete. |

## 3. Conflict scenarios

| Scenario | Expected safe behavior | Current evidence / gap |
|---|---|---|
| Request uses an old world revision | Reject as stale; do not commit. | Documented for time-advance start; verify resume/concurrency cases. |
| Same request is retried after a timeout | Return/reconcile the same durable operation; no duplicate effects. | Idempotency/checkpoint contract documented; failure-injection coverage needs verification. |
| Trigger is due during requested advance | Plan/commit the due trigger in the correct temporal order or stop safely; never silently jump over it. | Registry and operation docs describe this pipeline; test exact boundaries. |
| Trigger is due at the current coordinate before a new advance | Reject or reconcile explicitly; do not quietly ignore it. | Start contract says this is rejected. |
| Two triggers at one coordinate have conflicting writes | Deterministic conflict resolution or explicit conflict outcome. | Conflict-set union and deterministic planning are documented; broader order-independence should be tested. |
| Process crashes after a segment commits | Resume from the persisted checkpoint without reapplying the committed segment. | Durable checkpoint is documented; all crash points need test coverage. |
| Policy changes while an operation is in progress | Resume must retain the operation's pinned decision/configuration semantics or explicitly reject and reconcile. | Requires code-path verification; do not assume from immutability alone. |
| Requested target has sub-second precision | Reject rather than round silently. | Explicitly documented for current execution path. |
| Action cannot finish before an interruption | Preserve partial progress or leave the action pending; do not mark it complete by implication. | General action-progress contract is not established by the cited time docs. |
| Multiple actions are submitted together | Advance by the declared dependency/sequence model, not by arbitrary array order. | Needs action-composition contract and targeted tests. |
| Time-advance request exceeds configured skip ceiling | Reject before partial mutation, or use the documented bounded segmentation contract where supported. | Policy ceiling and synthetic segmentation are documented; verify atomicity at failure boundaries. |
| Caller attempts to provide an arbitrary duration/event identity to timed action API | Reject/ignore only as defined by the API contract; caller must not bypass TimePolicy. | Minimal runtime docs state these fields are not accepted. |

## 4. Responsibility boundary

**TimeEngine / time policy responsibilities**
- Classify a supported time operation and resolve its duration from the active policy.
- Produce a bounded proposal or plan with the basis for the decision.
- Preserve uncertainty where the policy requires author input instead of fabricating a duration.
- Avoid introducing a second scheduler or writing canonical world state directly.

**Core responsibilities**
- Validate revision, policy/configuration, preconditions, conflicts, and permissions.
- Own canonical time and event commits.
- Atomically persist segment effects, trigger lifecycle changes, operation checkpoint, and idempotency result where the existing transaction contract requires it.
- Decide event ordering/conflict outcomes and reject unsafe transitions.

**Host / adapter responsibilities**
- Request a supported action/time advance through the authorized interface.
- Not provide a caller-controlled duration or event identity where the API contract prohibits it.
- Present only confirmed results; not infer completion from a pending operation.

## 5. Acceptance tests to add or verify

1. **Revision race:** two advances start from the same revision; at most one stale transition commits.
2. **Idempotent retry:** repeat a completed and an interrupted operation using the same idempotency key; no duplicate event or time segment.
3. **Crash matrix:** inject failure before segment commit, during transaction, and after commit but before response; reopen and resume.
4. **Trigger boundaries:** triggers at current coordinate, inside interval, exactly at target, and immediately after target.
5. **Conflict permutation:** reorder independent and conflicting triggers; independent results remain stable, conflicts are surfaced consistently.
6. **Policy pinning:** change active TimePolicy after operation start; resume behavior matches an explicit pinned-version contract.
7. **Precision:** reject non-whole-second execution coordinates without rounding.
8. **Partial action:** interruption leaves explicit progress/status and does not mark unfinished work complete.
9. **No direct writer:** prove canonical time cannot be changed through any public or adapter route outside the authorized Core pipeline.
10. **Composition:** sequential actions accumulate duration; concurrent actions do not automatically accumulate duration unless the contract says so.

## 6. Decision status

- **Documented in repository:** Core-owned time advancement, versioned TimePolicy, deterministic trigger planning, durable operation checkpoints, idempotency/revision checks, whole-second execution compatibility.
- **Proposed invariants:** TE-I01–TE-I12 above. They should become normative only after comparison with the current implementation and existing tests.
- **Not established by this review:** full end-to-end action progress semantics; every crash/retry boundary; every concurrency path; current SillyTavern integration behavior.
- **No code change is claimed by this document.** This is a review artifact intended for a pull request and explicit review before it is treated as approved architecture.

## 7. Next implementation/review sequence

1. Trace duration resolution from TimePolicy through timed-action handling to the committed event and audit.
2. Trace time-advance start → segment commit → checkpoint → resume, including failure injection.
3. Map each invariant to an existing test; mark uncovered invariants and add only targeted tests.
4. Resolve action-progress semantics before designing a generic interrupted/composite action mechanism.
5. Update the project README/Notion registry only after the contract is reviewed, so a draft is not misrepresented as an approved requirement.


## 8. Source-level verification notes (2026-10-28)

The current repository sources provide stronger evidence for several cases than the initial gap table implied:

- `tests/time-advance-operation.test.js` includes coverage for scheduled effects committed at their due coordinates, idempotent replay after world revision changes, rejection of idempotency-key reuse with changed request content, and blocked due work without advancing time.
- `docs/63-time-advance-operation-runtime-slice.md` states that a running operation can resume after restart only when the canonical world still matches its last confirmed coordinate/revision; otherwise it becomes `needs_review`. Reusing the same key/request returns or resumes the existing operation; changing the request under the same key is rejected.
- `docs/17-time-process-state-machine-proposal.md` explicitly warns that the Time-side tests in PR #284 are pure scheduler tests with a fixture adapter, not end-to-end runtime tests of persistence, API routing, lifecycle transitions, or the Core transaction.
- `docs/78-time-trigger-registry-runtime-slice.md` documents that trigger identity is immutable, declared conflict sets are combined with event read/write effects, and dependency-unknown due work is blocked.

### Revised verification status

| Area | Evidence found | Remaining work |
|---|---|---|
| Due-coordinate order and time-advance target | Runtime test exists | Verify edge boundaries and all trigger-source modes |
| Idempotency replay and changed-request rejection | Runtime tests exist | Add failure injection around every commit/response boundary if not already covered elsewhere |
| Blocked due work | Runtime test exists | Verify registered-trigger mode and request-scoped compatibility mode separately |
| Restart/recovery and revision mismatch | Runtime contract documented | Map each documented case to an explicit test name |
| Pure scheduler semantics vs full runtime | Limitation explicitly documented | Do not use pure scheduler tests as evidence of transaction/API correctness |
| Action-level partial progress | No general contract established by these sources | Resolve separately; do not infer it from time-advance segment checkpoints |

**Correction to the earlier gap assessment:** idempotency and some blocked-work behavior are not merely undocumented; targeted runtime tests are present. The remaining question is breadth of coverage, especially crash points and end-to-end recovery—not absence of all tests.
