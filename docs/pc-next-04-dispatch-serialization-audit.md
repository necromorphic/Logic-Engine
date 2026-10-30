# PC-NEXT-04 — dispatch serialization and Host egress audit

**Status:** source audit complete; architecture recommendation only. No production implementation, API/schema change, PR, merge, or deployment is authorized by this document.

**Base:** `main` at `52ad14ddfa6ca23858066e7516b4dbd6a190ab01`  
**Scope:** Core coordinator and dispatch Gateway, Provider writer participation, pinned SillyTavern 1.19.0 outbound routes, and candidate PR #646.  
**Safety:** Memory → NPC remains `DISABLED / FAIL-CLOSED`. Existing vectorization and remote vector-store behavior are out of scope.

## 1. Executive finding

A coordinator lock and a dispatch-ledger implementation exist on current `main`; the previous PC-NEXT-03 statement that there was no implementation at all is too broad. The accurate distinction is:

- Core/Provider have a shared **cooperative writer-ordering primitive** and candidate/merged code paths that participate in it.
- Current `main` has a `MemoryDispatchGateway` implementation with durable `DISPATCH_STARTED` ledger records.
- Current `main` does **not** wire that Gateway as the production SillyTavern egress path.
- The current Gateway releases the coordinator lock before invoking `sendUpstream`; draft PR #646 proposes moving transport-start into the lock-held interval.
- Core/Provider writer coverage and direct-database bypass exclusion are not complete.
- The pinned SillyTavern route has multiple provider-specific outbound branches and a direct-upstream fallback. A single generic sender hook is insufficient.

Therefore, the architecture is partially implemented, but there is no production-safe, end-to-end serialization boundary.

## 2. Current-main Gateway: verified behavior and gap

Source: `src/security/memory-dispatch-gateway.js`; server wrapper: `src/security/memory-dispatch-gateway-server.js`.

Verified in source:

1. `MemoryDispatchGateway` requires file-backed ledger/coordinator stores, accepted-head authority access, synchronous trusted Core and Provider evidence readers, and an injected `sendUpstream` transport.
2. The only allowlisted protected route is `host-selected-chat-generation`. The source comment identifies the currently supported route as Google AI Studio chat; this is not a general provider-neutral gateway.
3. Request signature/digest binds route, model, stream flag, body digest, world, actor, purpose, source set and candidate set.
4. Under `beginCoordinatorLock()`, Gateway checks accepted-head enrollment/pending state, reads Core and Provider evidence synchronously, validates readiness/head/source/candidate agreement, and durably inserts `DISPATCH_STARTED` into its own ledger.
5. A stale `DISPATCH_STARTED` on startup is converted to `UNKNOWN`; ambiguous transport outcomes are not automatically retried.
6. Duplicate request IDs and unresolved duplicate digests are rejected.

**Critical implementation detail:** after committing the ledger row, the current method exits the `try/finally` and releases the coordinator lock. Only after that does it call `await this.sendUpstream(...)`.

This gives a durable dispatch-start ordering point, but it does not make the actual transport-start callback part of the lock-held critical section. A Provider/Core writer may acquire the coordinator in the interval after `DISPATCH_STARTED` commits and before `sendUpstream` is invoked. The ledger has already declared the request in-flight, so the Gateway may still send after that later revocation. This is consistent only with a policy that treats durable dispatch-start itself as irrevocable authorization; it is weaker than the candidate design in PR #646, which explicitly starts transport while holding the coordinator lock.

Do not silently treat the two implementations as equivalent. The cross-owner contract must decide and test the exact linearization semantics. The safer candidate is the PR #646 shape: durably commit dispatch-start, synchronously invoke the sole transport-start callback while still holding the shared lock, then release the lock before awaiting the network response. The callback must synchronously cross the point at which the outbound request is handed to the transport; it must not merely enqueue work for later.

## 3. Coordinator participation: what is covered and what is not

### Core

The current-main decision record maps Core's local `SQLiteStore.tx()` and a guarded DB facade. Draft PR #380 added coordinator participation for the Core transaction path and supported standalone DML/DDL, including proposal/process-store schema paths.

Remaining bypass/coverage issues recorded by the source decision:

- A separate process can open the Core SQLite file directly, bypassing the guarded facade.
- Full maintenance, migration, restore, recovery, and third-party writer exclusion is not proven.
- Actor-binding changes and all source/policy-relevant write paths must be checked against the exact accepted head; do not infer coverage from `SQLiteStore.tx()` alone.
- Cross-store `processStore.invalidateEvents()` requires its own ordering review.
- Target-PC OS identity/ACL isolation is not configured/proven.

### Provider

Draft PR #383 adds coordinator participation for Provider startup DDL/migration, grants/revocations, ingest identity + record/index windows, readiness, tombstone/purge, index rebuild and reconciliation publication. Its exact-head Runtime CI passed on its candidate head.

That evidence does not prove:

- authoritative complete Host inventory or source lineage;
- restore-resistant anti-rollback;
- cross-store atomic commit;
- every maintenance/recovery/direct-DB writer is unable to bypass;
- production Core/Provider evidence readers are wired into Gateway.

Provider-local SQLite transactions and generation counters are not substitutes for shared ordering. Keep Provider raw Host capture/read and derived-copy paths fail-closed; do not enable them as a shortcut.

### Coordinator conclusion

The coordinator is a cooperative ordering primitive, not an OS access-control boundary. It works only for writers that actually acquire it. Any uncoordinated writer or process with direct Core DB access invalidates the global serialization claim.

## 4. SillyTavern 1.19.0 outbound path inventory

The uploaded `SillyTavern-release.zip` is version 1.19.0. The Git blob SHA-1 of its `src/endpoints/backends/chat-completions.js` is `0d98c77f7b64502c5b0f504eaa1f67df0f26041e`, matching the pinned source evidence recorded for ST commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

### Selected browser Chat Completions path

- Browser: `public/scripts/openai.js`, `sendOpenAIRequest()`.
- It builds generation parameters, awaits `CHAT_COMPLETION_SETTINGS_READY`, serializes the generation payload, then calls ST's `/api/backends/chat-completions/generate`.
- That browser event is before the ST server request; it is not the final provider-send boundary.

### Server Chat Completions dispatcher

- `src/endpoints/backends/chat-completions.js`, `POST /generate`.
- The dispatcher branches into provider-specific `send*Request` implementations.
- Multiple branches perform their own `fetch()` calls and some return before a generic sender.
- A hook in one generic sender would miss branches that send earlier or return directly.
- A protected request must be routed to Gateway before any provider-specific direct send, and no branch may fall back to direct transport when Gateway is absent/unavailable.

### Other route families

- `src/endpoints/backends/text-completions.js` is a separate API family with its own request transformation and multiple `fetch()` paths.
- `src/endpoints/openai.js` contains additional outbound calls, including multimodal-related paths.
- Other backend routes/extensions must be inventoried before claiming universal coverage.

The initial supported scope should remain narrow: only the explicitly approved Chat Completions route may carry protected Memory, and only after its exact final transport path is redirected through the PC Gateway. Text Completions, Kobold, multimodal, extensions, and alternate backends must reject protected payloads rather than silently fall back.

## 5. PR #646 — candidate dispatch-start correction

PR #646 is a Draft candidate. Its stated changes include:

- signed request binding to server-owned adapter/conversation identity;
- read-only Core/Provider evidence readers;
- a synchronous Host transport-start callback;
- start transport while the shared coordinator lock is held, then release before awaiting the response;
- `UNKNOWN` for ambiguous outcomes and no automatic replay;
- deterministic revoke-first and dispatch-first tests using real persistence readers;
- inventory uncertainty blocks dispatch with zero transport calls.

The PR description explicitly says it does not wire the actual pinned SillyTavern final-send path, does not prove every provider route lacks a direct fallback, and does not establish production readiness. Its reported exact-head CI is candidate evidence, not deployment evidence.

**Assessment:** #646 is the closest candidate for the missing Gateway critical-section behavior. It is not sufficient by itself: the actual ST server route still has to call it as the sole protected transport, direct fallback must be blocked, and Core/Provider writer coverage and deployment isolation must be accepted.

## 6. Selected serialization design

Do not introduce a second lock, detached session lease, preflight token, or independent Core authorization endpoint.

Retain the existing coordinator as the candidate common order, subject to the following implementation contract:

1. **All relevant writers participate.** Every Core source/status/revision/rollback/policy/binding invalidation and every Provider grant/revoke/record/readiness/reconciliation/tombstone/restore mutation must either acquire the same coordinator before it becomes effective or be technically prevented from changing protected validity.
2. **No bypass.** Direct Core DB writers, maintenance, migration, restore and recovery must be covered or denied by OS/process isolation. A guarded JavaScript facade is not enough if another process can open the DB file.
3. **Final evidence is synchronous under the order.** Gateway must read authoritative Core and Provider state while holding the coordinator. No awaited source/inventory callback may be left between final validation and dispatch-start.
4. **Exact request binding.** The signature/digest must bind the exact immutable body, route, model, stream mode, actor/world/purpose, and exact source/candidate versions. No mutation after validation.
5. **Durable dispatch-start.** Insert the unique ledger record before transport handoff.
6. **Transport-start under lock.** Synchronously invoke the sole upstream transport-start callback before releasing the coordinator. Release before awaiting the response.
7. **Ambiguity is terminal by default.** Crash/timeout/lost acknowledgement after dispatch-start becomes `UNKNOWN`; no automatic retry. Conflicting request identity reuse is rejected.
8. **Single protected route.** Every request containing protected Memory must enter the PC Gateway. If the Gateway is unavailable, authentication fails, route is unsupported, or any evidence is unknown, return a generic fail-closed result and make zero upstream calls.
9. **Deployment enforcement.** Provider/Host cannot access Core DB; ST on the phone must not retain direct provider credentials for protected routes; the Gateway owns provider credentials and outbound transport. Distinct service identities and restore-resistant authority/backup handling must be demonstrated on the target PC.

This design uses the existing coordinator and Gateway rather than inventing a new serialization primitive. It is not yet approved for implementation or production activation.

## 7. Exact next gates

| Gate | Required evidence | Current status |
|---|---|---|
| G1 — Writer coverage | Source-backed call-site matrix for Core and Provider, including API/direct DB, process store, DDL/migration, maintenance, restore/recovery; each writer classified as coordinated or technically blocked | PARTIAL |
| G2 — Coordinator enforcement | Real multi-process test showing every relevant writer blocks/serializes against dispatch; direct Core DB bypass denied by target-PC identity/ACL boundary | NOT PROVEN |
| G3 — Gateway critical section | Exact-head test proves transport-start callback is invoked while coordinator is held; revoke-first gives zero calls; gateway-first gives exactly one invocation | CANDIDATE #646; current-main Gateway releases before `sendUpstream` |
| G4 — ST final-send wiring | Exact pinned 1.19.0 server Chat Completions route sends protected payload only through Gateway; no direct fallback on missing Gateway; every branch covered | NOT WIRED |
| G5 — Route completeness | Protected-payload denial on Text Completions, multimodal, Kobold, extensions and unsupported routes; no bypass | NOT PROVEN |
| G6 — Identity/inventory | Authenticated Host session + actor selection and complete active/history/deleted/import/restore inventory | NON_READY |
| G7 — PC deployment | Distinct service identities, ACL/sidecar protection, backup/restore anti-rollback, phone↔PC authentication and provider-key ownership | BLOCKED |
| G8 — Exact-head acceptance | Runtime/Provider/Host CI on exact combined implementation heads plus deterministic race/crash/restart/ambiguous-send evidence | NOT RUN as integrated system |

## 8. Explicit non-scope

- No production implementation or source changes.
- No merge or PR creation.
- No production ST/Core process restart or configuration change.
- No live Core/Provider DB writes.
- No Memory→NPC activation.
- No Google/provider reintroduction decision; current Gateway route allowlist must be reconciled with the user's current provider direction before any implementation.
- No vectorization, embedding, remote-store, or VectorService tests or modifications.

## 9. PC-NEXT-04 conclusion

**The serialization design can be based on the existing coordinator + Gateway, but the current-main Gateway and the candidate Host integration are not yet one enforceable end-to-end boundary.**

The concrete missing link is not “invent a lock.” It is to:
1. close all Core/Provider writer bypasses;
2. make the transport-start callback part of the coordinator-held dispatch-start section (candidate #646);
3. wire the exact pinned ST server route through that Gateway as the only protected transport;
4. prove zero-egress and at-most-once outcomes on the combined exact heads and target PC.

Until those gates pass, keep Host `NON_READY`, Stage 2 `NO-GO`, and Memory → NPC `DISABLED / FAIL-CLOSED`.
