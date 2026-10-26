# Core final-disclosure authorization contract — proposal for Host integration

**Status:** Core contract proposal for cross-owner review; not a production callable endpoint and not permission to enable Memory→NPC.
**Owner:** Core. **Audience:** Host/Adapter, Memory Provider, Product/Security.
**Decision:** Host is correct that no approved callable Core contract currently authorizes Memory disclosure at the final model-send boundary. The existing `AuthorizedReadService` is an in-process field-read seam, not that contract.

## 1. Purpose and non-goals

Define the minimum behavior that Host can call for a protected model request, while keeping production fail-closed. The contract must eventually answer whether the exact Memory-derived content attached to the exact outgoing model request may be dispatched now.

It does **not**:
- treat a Provider candidate or a successful retrieval as authorization to disclose;
- return a boolean that Host may cache or reuse for a later request;
- promise atomicity when Host receives an allow result and then sends directly to a model provider;
- establish complete Host message inventory, Provider grant authority, NPC acquisition, or model receipt;
- define a new public API/schema before joint review.

## 2. Existing Core seam and why it is insufficient

`src/application/authorized-read-service.js` exposes internal callable methods `readEntityFields` and `readEntityAttributeForMechanic`. They require trusted field policy, actor binding, recipient/purpose, and current Core snapshot checks. They revalidate actor binding and the Core `(world_revision, commit_sequence)` cursor after policy evaluation.

However:
- the service is not the production Memory→NPC final-disclosure contract and is not wired by `src/index.js` as the sole model-send gate;
- it does not validate Provider grants/reconciliation/inventory;
- it does not bind its result to the exact final outbound request;
- its final Core recheck and a subsequent Host network call are separate operations;
- a phone-side direct provider fetch can occur after an intervening revocation or source mutation.

Therefore Host must not treat either method or a copied read result as final send authorization.

## 3. Required callable contract semantics

The eventual approved contract must be invoked for every outgoing model request that contains protected Memory-derived material, at the final dispatch boundary, and must be fail-closed.

It must bind the decision to all of the following, using the existing owner-approved identities/contracts rather than inferred IDs:
1. the authenticated Host/adapter and actor binding;
2. world, recipient/model route, and explicit purpose;
3. the exact source records and source versions used to produce the protected material;
4. the exact protected fields/content manifest or a verifiable request binding, so authorization for one payload cannot be replayed for another;
5. current Core source state and the narrow approved `canonical_entity` version rule where applicable;
6. current Provider record/query grants and current reconciliation/inventory readiness;
7. a unique request identity sufficient to reject conflicting reuse and prevent retries from causing a second disclosure.

The result must distinguish only what the caller needs to proceed or fail closed; denial/unavailability must not disclose source text, snippets, record counts, or source-existence oracles. Diagnostics must not log prompts, Memory contents, keys, or secrets.

The contract must not return a reusable stand-alone “allow” that is detached from dispatch. Its successful path must either:
- **preferred:** accept the protected request at a PC-side egress gateway and itself own the durable dispatch-start plus the sole outbound transport; or
- **alternative requiring explicit joint proof:** participate in a shared serialization authority that orders every relevant Core invalidation and Provider grant/reconciliation invalidation against durable dispatch-start, with Host unable to bypass it.

A Core preflight call followed by an independent phone-side provider fetch is **not** an acceptable implementation of this contract.

## 4. Ordering invariant

The accepted design must define one serialization point shared by all relevant invalidation writers and dispatch-start.

- If source invalidation, grant revocation, or readiness loss wins before dispatch-start: deny and make **zero** outbound calls.
- If durable dispatch-start wins first: classify the request as in-flight; bytes cannot be recalled. Retries must not silently produce a second disclosure.
- If the serialization authority, source validator, Provider grant store, inventory authority, or current snapshot is unavailable/unknown: fail closed.
- Restoring an older backup must not resurrect revoked grants or invalidated sources; otherwise protected dispatch remains disabled.

These are required semantics, not claims about existing implementation.

## 5. Owner split

- **Core:** authoritative source-currentness and actor/field/purpose policy; expose only the approved callable seam after the request binding and ordering design are agreed.
- **Memory Provider:** authoritative record/query grants, lineage, reconciliation and inventory state; no fixture-positive authority.
- **Host/Adapter:** exact pinned routes and source/version identity; all protected requests must use the sole approved dispatch path, with no direct-provider bypass.
- **Product/Security:** approve visibility policy, purpose/recipient policy, retention/key handling, safe diagnostics, request identity and in-flight/retry behavior.
- **Joint:** choose the serialization authority and prove the revoke-before-dispatch zero-egress invariant.

## 6. Acceptance criteria before Host can mark the contract available

1. Contract and payload binding reviewed by Core, Provider, Host, and Product/Security.
2. Exact pinned Host commit and every protected outbound route enumerated; unsupported routes fail closed.
3. Real Provider writer/revocation/reconciliation/inventory paths participate in the same ordering or are synchronously checked within the approved gateway serialization boundary.
4. Deterministic tests prove revoke-wins → zero transport calls, dispatch-start-wins → at-most-one disclosure, rollback/source-version mismatch → zero calls, restart/retry safety, and no direct-route bypass.
5. Exact-head CI and real outbound-call counts are recorded. Pure helpers, fixture callbacks, and a baseline fake-provider success are not sufficient evidence.

## Current response to Host

**There is not yet an approved callable final-disclosure contract to invoke.** Host should not invent or stub one and should keep deny/stale/revocation-race cases marked BLOCKED. This document proposes the semantics for owner review; it does not authorize a new runtime endpoint or production wiring. Memory→NPC remains `DISABLED / FAIL-CLOSED`; existing vectorization is outside scope and untouched.
