# Coordinator proposal: Memory → NPC final-disclosure and dispatch boundary

**Status:** coordinator proposal for Core, Memory Provider, Host/Adapter, and Product/Security review. Documentation only. This file does not approve a runtime API/schema, authorize production disclosure, or claim the required serialization exists.

**Current disposition:** production Memory → NPC remains **DISABLED / FAIL-CLOSED**.

**Pinned first experiment:** SillyTavern upstream commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127, server-side Chat Completions only. All other routes remain unsupported until separately verified.

## 1. Problem statement

The present block is a cross-owner contract gap, not a failure that Provider-local tests can solve alone:

- **Host/Adapter** observes the real source lifecycle and owns the outbound dispatch path. The pinned SillyTavern source audit identifies mutable message indexes/swipe positions and multiple independent outbound routes; no route is currently proven to enforce a Core-approved disclosure decision.
- **Memory Provider** owns its persisted records, derived index readiness, Provider grants, record lineage checks, tombstones and reconciliation. These are Provider-local guarantees; they do not establish that Host supplied an authentic, complete, current source inventory.
- **Core** owns canonical source authority, canonical revision/rollback truth, trusted actor binding, and the policy decision to disclose. Existing authorized field reads are not automatically a subject-relative model-disclosure decision or a transaction enclosing a later network send.
- **Product/Security** owns the policy choice for in-flight requests when revocation races with dispatch.

A browser hook, prompt assembly event, Provider current flag, successful retrieval, context inclusion, or a best-effort check immediately before fetch is not by itself an end-to-end authorization guarantee.

## 2. Bounded first slice

1. One pinned server-side Chat Completions dispatch path, at the last server-side point where the assembled outbound request is available before provider egress.
2. Direct canonical-entity source records only, and only if Core identifies an existing authoritative operation that can prove source identity, current version, validity/retraction and rollback state.
3. No raw Host chat text, no multi-source derived summaries, and no assumption that a Provider index is a complete source inventory.
4. No claims about Text Completions, Kobold, Azure, NovelAI, Horde, OpenRouter, extensions, browser direct egress, or other routes.
5. The experiment runs on a disposable pinned checkout/profile with a recording fake provider. It must not alter the user's SillyTavern install or the existing Ollama vectorization/remote-store patch.

If Core cannot establish source authority for this source class, exclude the source class and keep the path denied. Do not manufacture a substitute source identity from an array index, timestamp, hash, or caller-provided label unless the relevant contract explicitly approves it.

## 3. Required dispatch/revocation semantics

The project must state what “revoked” means relative to an outbound request. This proposal recommends the following bounded policy for review:

- There is one **dispatch-start linearization point**: the authoritative point at which the system commits to handing an authorized request to the outbound transport.
- If a deny, revocation, source invalidation, scope change, or loss of required readiness linearizes before dispatch-start, the request must not be sent.
- If dispatch-start linearizes first, the request is considered in-flight before the later revocation. A later revocation cannot recall bytes already handed to transport.
- This ordering is a contract, not an implementation claim. It is valid only if one authoritative mechanism actually serializes the decision/dispatch-start against the effective revocation state. Separate checks in Core and Provider followed by an unrelated fetch do not establish the ordering.
- A timestamp, revision comparison without serialization, process-local boolean, browser hook, or second check alone is insufficient evidence of this guarantee.
- Product/Security must explicitly accept this in-flight boundary before production use. If policy requires that no physical network send occur after a revocation commit even when dispatch-start had already won, this proposal does not satisfy that stricter policy; a different mechanism is required.

If the existing architecture has no mechanism that can implement the chosen ordering, Core must say **NO APPROVED SERIALIZED DISPATCH SEAM** and propose the smallest reviewable design. The system stays fail-closed until that design is approved and tested. Do not label an internal field-read service as a final egress gate without proving that it owns or serializes the dispatch-start.

## 4. Source authority and Provider readiness are separate gates

Before dispatch-start, all of the following must be established by their respective owners:

| Question | Owner | Fail-closed condition |
|---|---|---|
| Is the source identity authentic and correctly world-bound? | Host + Core | Missing, mutable, ambiguous, or caller-substitutable identity |
| Which immutable source version is referenced? | Host + Core | Version cannot be proven across edit, swipe, delete, copy/import, restore and restart |
| Is that version still current and valid? | Core | Unknown version, rollback, retraction or stale canonical state |
| Is the Provider record a faithful direct-source record with valid lineage? | Provider | Missing/malformed lineage, identity conflict, unsupported derived/multi-source lineage |
| Is access permitted for this actor, purpose, world and requested disclosure? | Core policy owner | No approved policy/seam, revoked grant, unknown actor/purpose/scope |
| Is retrieval state complete and reconciled? | Provider, based on trusted inventory authority | Incomplete inventory, stale/unavailable reconciliation, index inconsistency, unknown readiness |
| Can the decision be serialized against revocation at dispatch-start? | Core + Host + Provider according to actual state ownership | No approved shared/serialized mechanism |

Provider index readiness is not proof of complete source inventory. Provider grant state is not, by itself, Core's authorization to disclose a source to a model. Core's world revision/commit sequence is not automatically a source-specific change/retraction journal. A complete-empty result must remain distinguishable from denied, withheld, stale, unavailable and incomplete results without leaking protected content or counts.

## 5. Owner deliverables

### Core
- Identify the actual code path and authoritative state/transaction for canonical source identity, source currentness, retraction and rollback.
- Identify whether the existing code can serialize the final decision with dispatch-start. Cite exact symbols and tests.
- If no such seam exists, submit a minimal contract/design diff for review. State the proposed owner, linearization point, ordering semantics, failure behavior and crash/restart behavior. Do not implement an unapproved API/schema.
- State what trusted owner supplies the complete inventory, including deleted/retracted sources and import/restore semantics.
- Keep production disclosure disabled pending Product/Security acceptance and real-path evidence.

### Memory Provider
- Verify current PR head and exact-head Runtime CI before reporting completion.
- Map existing Provider operations and typed outcomes for direct canonical-source records: authorized/current, stale/retracted, revoked, unknown identity/version, incomplete inventory, unavailable/reconciliation-required.
- Separate Provider-persisted evidence from Host-supplied identity and Core-authoritative source state.
- Explicitly state whether any existing Provider-owned operation can serialize effective revocation with dispatch-start. If none, say so; do not invent a contract field or claim a second check solves the race.
- Do not change Core, Host, NPC, schemas/APIs, production wiring, or vectorization.

### Host/Adapter
- Prepare a disposable harness against the exact pinned SillyTavern source. A recording fake provider must observe whether any outbound request arrives and must not persist prompt text.
- Do not add a production interceptor until Core's callable contract is approved.
- Exercise the actual server dispatch path, not only a pure helper or fixture.
- Report harness results separately from real browser/IndexedDB and Android/Termux runtime tests.
- Preserve the user's existing vectorization/remote-store patch and installation.

### Coordinator
- Maintain a route-by-route coverage table; one successful route does not imply universal coverage.
- Map every acceptance test to the owner and exact contract it proves.
- Reject claims based only on source inspection, fixture-only tests, stale CI, or a helper that is not called by the real dispatch path.
- Keep Memory → NPC disabled until all required evidence and policy approval are present.

## 6. Required acceptance matrix

| Scenario | Required observation |
|---|---|
| Approved source, current version, authorized request | Fake provider observes exactly one expected request |
| Explicit deny | Zero outbound requests |
| Authorization/source authority unavailable or unknown | Zero outbound requests |
| Source version changed, retracted, rolled back or stale after prompt assembly | Zero outbound requests if invalidation wins before dispatch-start |
| Inventory incomplete or reconciliation unavailable/stale | Zero outbound requests; never convert this to complete-empty |
| Grant/revocation commits before dispatch-start | Zero outbound requests |
| Dispatch-start wins before later revocation | Behavior matches the explicitly approved in-flight policy; record ordering and do not claim the request can be recalled |
| Concurrent revoke versus dispatch-start | Deterministic test proves the chosen serialization/ordering; a timing-only probabilistic test is insufficient |
| Provider restart/rebuild | Revocation, tombstone and stale/readiness outcomes remain fail-closed |
| Old backup/restore | No anti-rollback guarantee may be claimed unless an independent trusted authority or equivalent evidence proves it |
| Other outbound routes | Explicitly unsupported/unverified until separately tested |

For each row, report source inspection, unit/component test, harness test and real-runtime test as distinct evidence classes. Record exact source SHA, PR head SHA, test command, CI URL and observed request count.

## 7. Exit criteria

This proposal is ready to leave the design stage only when all of the following are present:

1. Core-approved source authority/currentness and disclosure decision contract.
2. Explicit Product/Security decision on the in-flight revocation boundary.
3. A proven dispatch-start serialization mechanism, or an explicit statement that the guarantee is unsupported.
4. Provider exact-head CI and evidence mapping for all Provider-owned states.
5. Host recording-fake-provider evidence on the real pinned server dispatch path, including deny/race/zero-egress cases.
6. Exact unsupported-route list and explicit untested browser/Android/Termux limitations.
7. Coordinator review confirming that the evidence covers the actual route and not merely a helper.

Until then, **Memory → NPC remains DISABLED / FAIL-CLOSED**. Passing Provider tests, merging a semantic document, or approving the bounded experiment does not independently authorize production disclosure.