# TimeEngine adapter contract after timed-action interruption

Status: **review proposal only**. This document does not approve a new runtime contract or change current behavior.

## Source-grounded facts

- The SillyTavern adapter requirements say the adapter submits actions/time advances, renders approved output, and must not decide canonical world truth.
- The adapter response envelope is expected to distinguish accepted/rejected/needs_review, committed revision/game_time, effects, conflicts, retryability, and idempotency result.
- The existing timed-action runtime can terminate with `status: interrupted` and `final_action_status: not_executed_interrupted`. In this case the final action event was not committed.
- The existing operation resume path and replay under the original idempotency key do not execute that interrupted action. They return the same terminal interrupted result.
- A re-evaluated action can be submitted as a new request with a new idempotency key and current world revision.

Sources: `docs/13-sillytavern-adapter-contract.md`, `docs/79-timeengine-invariant-review.md`, `src/application/engine.js`, and the timed-action regression test in `tests/time-trigger-registry.test.js`.

## Proposed adapter handling

When a timed-action response reports `final_action_status: not_executed_interrupted`:

1. Treat the requested action as **not performed**. Do not render or record it as a completed world event.
2. Read the latest authorized world state and revision.
3. Re-evaluate the original intent and all relevant preconditions against that state. Do not assume the interrupted action remains valid.
4. If the intent is still valid, submit a new timed-action request with a **new idempotency key** and the current expected revision.
5. If the state is unavailable, preconditions are unclear, or the action is no longer valid, stop and return a review/conflict outcome. Do not auto-retry.
6. Do not use operation resume or same-key replay as a mechanism for continuing the interrupted action.

## Responsibility boundary

- **Time policy / TimeEngine:** resolve supported duration and identify the interruption boundary.
- **Core:** validate current revision/preconditions and commit canonical time/events.
- **Host/Adapter:** interpret the response correctly, refresh state, and decide whether the original intent should be proposed again; it cannot declare the action complete.
- **Process Manager:** owns durable multi-milestone progression where a workflow is actually modeled as a process. Do not add a second scheduler or progress ledger to TimeEngine.

## Open review questions

- Should the adapter response expose a dedicated stable outcome code for this case, or is the existing pair of `status` and `final_action_status` sufficient?
- Does the public/internal API documentation clearly distinguish “resume time advancement” from “resume the requested action”?
- Which adapter layer is authorized to read the current revision and resubmit an action, given that the management routes require an internal credential?

## Non-goals

This proposal does not add automatic continuation, retry loops, a generic action DSL, or runtime code. It does not make the TimeEngine invariants normative. Keep the PR in Draft until the response contract and credential boundary are reviewed.
