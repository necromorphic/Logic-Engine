# Memory disclosure/dispatch gate: gated implementation plan

**Status: preparation only; runtime implementation is blocked on cross-owner approval.**  
**Related proposal:** [PR #357](https://github.com/necromorphic/Logic-Engine/pull/357)  
**Scope:** Core-owned preparation and acceptance criteria. This document adds no runtime contract and authorizes no production activation.

## Invariants that cannot be weakened

1. Production Memory→NPC remains `DISABLED / FAIL-CLOSED` until the actual pinned Host route, Provider authority, and Core source checks are connected and tested end-to-end.
2. No protected model request may use a phone-side direct-provider bypass if the chosen design depends on PC-side serialized egress.
3. Revocation/source invalidation ordered before durable dispatch-start means **zero outbound transport calls**. If dispatch-start wins first, the request is explicitly in-flight; already-sent bytes cannot be recalled.
4. A read result, preflight boolean, token, or lease is not itself authority to dispatch.
5. `world_revision + commit_sequence` is a freshness cursor, not a source journal. Rollback may invalidate a source without advancing `commit_sequence`.
6. The only currently approved direct source-version mapping remains the narrow `canonical_entity` mapping: canonical-decimal Provider `source_version` equals the exact current Core entity `updated_revision`, after world/entity/status checks. No other source types are implicitly authorized.
7. Provider `record_version`, Provider `source_version`, Core `updated_revision`, and Core `(world_revision, commit_sequence)` remain distinct.
8. Existing SillyTavern vectorization and remote vector storage are out of scope and must not be changed.

## Gate 0 — collect owner decisions before coding

The following are blocking decisions, not implementation details Core may assume:

- **Product/Security:** approve PC-side egress; decide provider-key placement, phone↔PC authentication, minimum audit metadata, prompt/content retention (off by default), and in-flight/retry semantics.
- **Host/Adapter:** provide the exact pinned SillyTavern commit and outbound route inventory; show every route that can dispatch protected context; confirm how protected requests are routed to the PC gateway and how LAN/bridge authentication, timeout, cancellation, retries, regenerate, edit/delete, and chat switching behave.
- **Memory Provider:** map the existing durable grant/revocation, readiness, source inventory, reconciliation, and restore transitions; identify which exact writers can participate in the dispatch serialization order; state whether existing persistence boundaries can enforce that order without new schema/API.
- **Core:** confirm the authoritative source/status/revision reads and rollback semantics that can be revalidated at the serialization point; identify the existing transaction/locking boundary that actually covers these operations.
- **Joint:** explicitly accept or reject the proposed topology and define the exact serialization point. If any relevant writer cannot join the same ordering mechanism, stop and retain fail-closed behavior.

No runtime PR should begin until these decisions are recorded against concrete existing code paths. Silence or a passing unit test is not approval.

## Gate 1 — implementation design freeze

After Gate 0 approval, create a separate implementation PR with a short, reviewable contract record that names:
- exact owner and source path for each authoritative check;
- exact shared serialization mechanism and its persistence/crash semantics, grounded in existing code or explicitly approved new design;
- the exact Host request identity and the component that owns the only outbound transport;
- behavior for duplicate request identity, timeout, cancellation, process crash, restart, restore, and ambiguous acknowledgement;
- audit fields and proof that raw prompts, protected text, snippets, and secrets are not logged by default;
- migration/rollback procedure and how a restored backup is prevented from reviving revoked grants or stale source versions.

Do not invent endpoint names, payload fields, tables, outboxes, cursors, leases, or APIs before this freeze. If the approved invariant cannot be implemented with current storage ownership, stop and return a narrowly scoped schema/API proposal for approval rather than simulating atomicity with sequential checks.

## Gate 2 — Core implementation slice

Core may implement only the agreed Core-owned parts:
- authoritative current entity existence/status/revision validation;
- fail-closed mapping of source versions for the specifically approved source type;
- rollback/retraction checks that do not rely on `commit_sequence` alone;
- source invalidation participation in the approved serialization mechanism;
- minimal non-content audit evidence needed to correlate decision ordering.

Core must not claim the whole gate is complete until Provider writes and the actual Host transport participate in the same ordering and have passed their tests. Do not wire `MemoryNpcConsumer` into production merely because a Core helper passes.

## Acceptance matrix (required before production enablement)

| Case | Setup/order | Required result |
|---|---|---|
| Valid disclosure | Current active source, exact approved version, current grant, complete reconciliation | Exactly one outbound transport call |
| Field/purpose/actor denied | Policy or binding denies | Zero outbound calls; no existence/content oracle |
| Unknown source type | No approved authoritative validity rule | Zero outbound calls |
| Source missing/destroyed/unknown | Canonical source cannot be proven current | Zero outbound calls |
| Source version mismatch | Provider source version differs from exact Core `updated_revision` | Zero outbound calls |
| Rollback/retraction | R1 → R2 → rollback R2; `commit_sequence` unchanged but source is restored/retracted according to Core state | Stale R2 rejected; no outbound call for R2 |
| Revocation wins | Deterministic barrier places grant revocation before dispatch-start | Zero transport calls |
| Dispatch-start wins | Dispatch-start durably ordered before revocation | At most one transport call; request classified in-flight, never silently replayed as a second disclosure |
| Inventory/reconciliation unknown | Missing, partial, stale, or not ready | Zero outbound calls |
| Authority unavailable | Core, Provider, coordinator, or serialization store unavailable | Zero outbound calls |
| Restart/crash | Crash before/after durable dispatch-start and before/after transport handoff | Fail closed on ambiguity; no automatic duplicate disclosure |
| Restore/stale backup | Restore snapshot predating a revocation or source invalidation | Revocation/stale version not resurrected; otherwise remain disabled |
| Host route bypass | Any protected route can call provider directly outside the gateway | Release blocked |
| Diagnostics | Denied and failed requests | No protected content, snippets, source counts/existence oracle, API keys, or other secrets in responses/logs |
| Vectorization non-regression | Existing ST vectorization/remote-store paths | Unchanged by this work; no edits to the separate vector patch |

## Required test shape

- Unit tests for the Core source predicate and policy failure cases.
- Storage-level regression for rollback/retraction, including the exact entity projection and unchanged-`commit_sequence` case.
- Deterministic concurrency test using barriers/latches (not sleeps) to prove both revoke-before-start and start-before-revoke outcomes.
- Integration tests using the real Provider persistence path and its real grant/reconciliation writers, not fixture-only positive validators.
- Pinned Host integration test that observes the actual outbound transport and proves zero calls for denied/stale/revoked cases and exactly one for an authorized case.
- Process restart and backup/restore tests with durable state.
- Full required Runtime CI on the exact implementation head SHA; record SHA, command, pass/fail counts, and run URL. A result from an earlier SHA is not evidence for the new head.

## Release checklist

- [ ] Gate 0 owner decisions recorded and approved.
- [ ] Gate 1 contract freeze reviewed.
- [ ] Every protected Host route goes through the sole gateway; no bypass.
- [ ] Core rollback/retraction regression passes on the implementation head.
- [ ] Provider grant/revocation/reconciliation writes participate in the same ordering.
- [ ] Revoke-vs-dispatch deterministic race tests pass both orderings.
- [ ] Restart/crash/restore tests pass.
- [ ] Audit/retention/security requirements pass.
- [ ] Exact-head Runtime CI passes.
- [ ] Explicit release approval recorded; until then production remains `DISABLED / FAIL-CLOSED`.


## Deterministic race-test protocol (required after Gate 0)

These are test orderings, not new runtime API names or a proposal for fixture-only authority. The final tests must drive the real Provider persistence/writers, the approved Core source reads/rollback path, and the pinned Host route through the actual sole transport. Test-only barriers may pause execution, but may not replace the production validator, inventory, grant store, or transport.

| ID | Deterministic ordering | Required observable result |
|---|---|---|
| RACE-01 — revoke wins | Prepare an otherwise valid protected request. Pause immediately before the agreed durable dispatch-start serialization point. Commit Provider grant revocation through its real writer. Release the request. | The request is denied before transport; outbound invocation count is exactly zero. |
| RACE-02 — dispatch-start wins | Pause a revocation until the exact request has durably won dispatch-start under the same serialization authority. Then commit the revocation. | The request is marked in-flight before revocation; transport invocation count is at most one. The test does not claim bytes can be recalled. A retry with the same request identity cannot create a second disclosure. |
| RACE-03 — source rollback wins | Capture a valid R2 source snapshot and pause before dispatch-start. Roll back R2 through the real Core rollback writer, restoring R1 while `world_revision` changes and `commit_sequence` may remain unchanged. Release the request. | The R2 request is denied and transport count is zero; the implementation must compare authoritative source revision/currentness, not `commit_sequence` alone. |
| RACE-04 — source destroyed/changed | Pause after candidate identification, then delete/destroy or update the source before dispatch-start. | Missing, destroyed, unknown, or revision-mismatched source yields zero transport calls. |
| RACE-05 — Provider readiness changes | Pause before dispatch-start, then make Provider readiness/reconciliation stale or revoke the applicable query/record grant through its real persistence path. | The pending request cannot use the previous allow/readiness result; zero transport calls if the invalidation wins. |
| RACE-06 — incomplete inventory | Have the real inventory authority report incomplete, unknown, unavailable, or stale inventory during final authorization. | No protected dispatch. A test callback returning unconditional true is not an acceptable substitute. |
| RACE-07 — Core/Provider unavailable | Make either authoritative read/store unavailable before dispatch-start. | Fail closed; zero outbound calls; caller receives no source text, snippets, counts, or existence oracle. |
| RACE-08 — crash before durable start | Terminate the gateway before dispatch-start commits, then restart and retry. | No prior transport call occurred; the request may be reconsidered only after full current-state validation. |
| RACE-09 — crash after durable start, before handoff | Commit dispatch-start, terminate before invoking transport, restart. | Conservatively retain the started/in-flight classification. No automatic second disclosure may occur just because transport acknowledgement is absent. |
| RACE-10 — crash after handoff, before acknowledgement | Allow the actual transport call, then drop/lose the acknowledgement and restart. | The system must not assume “not sent” and resend automatically. Preserve an ambiguous/in-flight result for explicit resolution according to the approved retry policy. |
| RACE-11 — duplicate/replay | Submit the same protected request identity concurrently and again after restart, with identical and conflicting payloads. | Identical retries cannot cause a second outbound disclosure; conflicting reuse is rejected. Exact identity and durable deduplication semantics must be approved before implementation. |
| RACE-12 — route bypass | Exercise every protected outbound path in the pinned Host build, including send, regenerate, continuation, retry, chat switch, cancellation and alternate API settings. | Every protected request reaches the sole gateway; any direct-provider bypass blocks release. |
| RACE-13 — LAN/bridge interruption | Drop phone↔PC connectivity before authorization, after authorization but before dispatch-start, and after dispatch-start acknowledgement. | Before dispatch-start: no transport call. After dispatch-start: follow the durable in-flight/ambiguous rule; never infer non-disclosure from a lost phone acknowledgement. |
| RACE-14 — stale backup restore | Revoke a grant or invalidate a source, then restore a Provider/Core backup predating that change. | Revocation and invalidation cannot be resurrected. If the approved recovery mechanism cannot prove this, protected dispatch remains disabled. |
| RACE-15 — diagnostics | Cause each denial, validator outage, timeout, crash recovery and stale-version case. | No raw prompt, Memory content, snippet, secret, API key, or source existence/count oracle is returned or logged by default. |
| RACE-16 — vectorization non-regression | Run the existing pinned SillyTavern vectorization/remote-store checks before and after the protected-egress work. | Existing vectorization behavior and the separate vector patch remain unchanged. |

### Required evidence captured per race

For each case, record the exact source and Host commits, Provider database mode, test command and run URL, deterministic ordering/barrier, expected and observed outbound-call count, final durable state, and whether a restart was involved. Keep content out of logs. Do not mark a case passed based only on a pure helper or mocked callback; distinguish unit, Provider-local integration, pinned-Host integration, and true end-to-end transport evidence.

### Current boundary decision

At the present code boundaries, RACE-01/02 cannot yet be honestly implemented end-to-end: Provider writes use a separate SQLite connection from Core, while the Host network handoff is external and there is no production egress coordinator wired in `src/index.js`. The purpose of these cases is to make the missing shared ordering testable after the owners approve an enforceable design—not to claim that it exists today.
