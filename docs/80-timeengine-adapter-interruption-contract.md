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


## Source-audited API authority mismatch

A follow-up read of `src/api/server.js`, `docs/28-proposal-api-stage1.md`, and `docs/63-time-advance-operation-runtime-slice.md` identifies a concrete unresolved boundary:

- `POST /v1/worlds/:id/time-actions` and `POST /v1/worlds/:id/time-advances`, including their read/resume routes, require both the normal API bearer and `x-engine-internal-token`.
- The documented Host/Adapter contract says the adapter submits actions/time advances, but the adapter credential is distinct from the internal credential. The security contract explicitly separates credential classes.
- The adapter-authenticated proposal API can create and commit approved event proposals under adapter identity. It is not documented as a wrapper for the durable timed-action/time-advance operation APIs; these operations must not be assumed interchangeable.
- Therefore, the existing documents do **not** establish which trusted component is allowed to create/resubmit a timed action after interruption. Giving the SillyTavern adapter the internal token would cross the current trust boundary and is not proposed here.

### Required decision before implementation

Choose and document one authorized orchestration path:
1. A trusted orchestration service, separate from the SillyTavern adapter, owns the internal credential and submits timed-action/time-advance operations; the adapter sends bounded intent to that service; or
2. A deliberately designed adapter-facing API is added with narrowly scoped authorization and server-side orchestration, without exposing the internal credential. This would require a separate security review and API proposal.

Neither option is approved by this review. Do not implement a direct credential-sharing workaround. Until the owner and API path are decided, the adapter re-evaluation sequence above is a desired behavior, not an implementable end-to-end contract.

Source locations:
- `src/api/server.js`: internal-token checks on `time-actions` and `time-advances`; adapter-token checks on proposal routes.
- `docs/28-proposal-api-stage1.md`: proposal lifecycle and credential separation.
- `docs/63-time-advance-operation-runtime-slice.md`: time-advance API routes and internal-token requirement.
- `docs/13-sillytavern-adapter-contract.md`: adapter responsibilities and request/response envelope.


### Repository inventory result

The repository inventory currently exposes a review-only `host-adapter/prototype` and explicitly marks the pinned SillyTavern lifecycle integration as **NOT READY**. The inspected source tree did not reveal a production trusted orchestration service that can currently serve as option 1 above. This is a bounded repository finding, not proof that no external service exists.

Consequently, the repository itself does not yet provide an evidenced end-to-end path from a SillyTavern adapter intent through authorized timed-action execution and post-interruption re-evaluation. This is an integration readiness gap, not a reason to bypass the internal-token boundary.

Evidence: `docs/27-host-adapter-lifecycle-evidence.md`, `docs/13-sillytavern-adapter-contract.md`, `src/api/server.js`, and the current `host-adapter/prototype` tree.


The proposal route is not a drop-in substitute for timed-action execution for a second reason: the current Stage 1 proposal contract places every new proposal in `pending` and requires a separate approval step before commit. Its purpose is durable event-proposal review, while the timed-action operation owns duration resolution, due-trigger processing, interruption state, and resumable operation checkpoints. Routing a retried action through proposals would therefore change the workflow semantics rather than solve the authorization mismatch.


### Clarification from adjacent execution-authority contracts

`docs/54-core-proposal-execution-authority-contract.md` documents a trusted internal path specifically for committing an **already-approved proposal** through the internal `/events` route. It does not establish that this same orchestrator exists as a deployed service, nor that it is authorized or implemented to create, resume, or resubmit `time-actions` / `time-advances` operations. `docs/11-operations-and-recovery.md` also classifies the internal credential as a trusted host-only capability and keeps it distinct from adapter credentials.

This narrows the evidence: the repository documents a trusted execution path for one proposal workflow, but the reviewed sources do not demonstrate a reusable timed-action orchestration path. Do not infer one from the phrase “trusted orchestration” in proposal documentation. The open integration decision above therefore remains valid.
