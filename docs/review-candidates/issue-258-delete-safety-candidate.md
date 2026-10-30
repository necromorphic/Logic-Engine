# Issue #258 — delete-safety candidate review brief

**Status:** Draft review brief only. No production source changes are included in this branch.

## Purpose

Record the proposed delete-safety direction for review against current `main`, without implementing or merging lifecycle changes before the approval gate in [Issue #264](https://github.com/necromorphic/Logic-Engine/issues/264).

## Source basis

- SillyTavern source archive inspected: commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Logic-Engine candidate source archive inspected: commit `de0d8d10faf71c521fc68f246f7322963abd41ab`.
- This review branch is based on current Logic-Engine `main` at `efc02d2b290b2c08d6621fe9eb75570ae4486102`.

The inspected candidate patches were generated against the uploaded source archives, not rebased onto current `main`. They are therefore historical review material and must not be applied to current `main` as-is. This PR does not claim that those patch files have been uploaded or that the candidate has been ported.

## Findings

1. The UI delete handler reads `chat[this_edit_mes_id]` and dereferences it before calling `deleteMessage()`. If the edit index is unset or stale, execution can fail before lifecycle instrumentation in `deleteMessage()` is reached.
2. A DOM `mesid` fallback is not safe as an authoritative replacement for `this_edit_mes_id`. A valid-looking DOM index can be stale or refer to a different message after asynchronous changes.
3. The safer UI behavior is fail-closed: validate the edit index and verify that it identifies the message represented by the active edit/delete control. Do not guess another index.
4. `deleteMessage()` should validate the index before dereferencing `chat[id]`, and revalidate the intended target after asynchronous confirmation/write-ahead boundaries. Range validation alone does not prove message identity.
5. The direct `/delname` array-splice path bypasses `deleteMessage()`; it needs explicit lifecycle treatment or a documented fail-closed restriction.
6. These source-level findings do not establish browser/runtime correctness, persistence durability, or complete lifecycle inventory.

## Candidate direction for Core review

- **UI handler:** reject missing, invalid, or mismatched edit-selection state; no DOM-index substitution.
- **Central deletion paths:** validate the target before dereference and revalidate exact message/object identity after awaited boundaries.
- **Swipe and last-message deletion:** apply equivalent target revalidation.
- **`/delname`:** close or explicitly block its direct mutation bypass.
- **Tests:** cover invalid indices, stale selection, chat switch during awaits, swipe deletion, last-message deletion, and `/delname` lifecycle ordering.

## Approval and implementation gate

Issue #264 explicitly prohibits implementing or merging new lifecycle hooks, APIs, schemas, stores, journals, cursors, outboxes, or production wiring until the exact implementation diff receives a second explicit Core approval.

Accordingly, this PR is **Draft / review-only**. It does not request merge and contains no implementation diff. Before implementation:
1. Reconcile the candidate against current `main` and the pinned SillyTavern 1.19.0-1 checkout.
2. Produce the exact current-base diff, with tests and apply instructions.
3. Obtain the required explicit Core approval for that exact diff.
4. Only then run isolated browser/runtime validation. No claim of runtime validation is made here.

## Validation status

- Source inspection: performed on the pinned archive revisions listed above.
- Candidate patch checks reported in the local candidate README: static apply/syntax and repository tests only.
- Current-main port/rebase: **NOT DONE**.
- Browser/runtime reproduction: **NOT TESTED**.
- Production readiness: **NOT READY / FAIL-CLOSED**.
