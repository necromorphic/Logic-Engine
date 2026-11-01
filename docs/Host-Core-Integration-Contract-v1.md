# Host-Core-Integration-Contract-v1

**Contract:** Host ↔ Core authenticated Memory retrieval  
**Version:** 1.0.0  
**Status:** PROPOSED PRIVATE API CONTRACT — coordinator technical review complete; affected API-owner approval under D5 and exact-head implementation validation remain outstanding  
**Review baseline:** Host PR #850 HEAD `dfd1e7140ea058f76ae48c40abda0c54e3598fde`; Core PR #846 HEAD `832abf337530e9421f53eaed85760cb4a7f07313`  
**Scope:** identity hand-off, Core World/Actor resolution, authenticated Memory Provider retrieval, result/error/revoke semantics.  
**Not in scope:** code integration, branch merging, Security Gateway changes, Final-Send, production enablement, Lane A, Provider schema migration.

This document is an interface contract, not evidence that the routes below are already implemented. Memory → NPC remains disabled/fail-closed until implementation and the existing release gates are independently verified.

## 1. Binding decisions and ownership

| Concern | Owner | Contract |
|---|---|---|
| SillyTavern session authentication | Host | Verify the exact server request after native ST authentication middleware. Browser values never establish identity. |
| Installation/account/conversation identity | Host | Resolve from server-owned Host identity storage and persisted chat metadata. |
| Adapter identity | Deployment/Core configuration | Core derives it from authenticated `x-adapter-id` + `x-adapter-token`; request JSON cannot choose it. |
| Conversation → World | Core | Resolve through the existing `HostConversationWorldBindingService`. |
| Adapter → Actor | Core | Resolve through the existing `ActorBindingService`; exactly one active actor is required. |
| Memory query/record authorization | Core + Memory Provider | Core owns orchestration and disclosure; Provider owns exact record/query grants and authorization generations. |
| Canonical source and field visibility | Core | Use existing canonical-source validators and `AuthorizedReadService`; Host cannot supply fields or policy. |
| NPC admission | Existing Core/NPC consumer boundary | Host transports the result; it does not reinterpret Provider metadata or authorize content. |

No second identity store, World/Actor resolver, authorization authority, Provider facade, or public ingress is introduced. The two HTTP routes below are proposed private server-to-server API additions over existing Core services. They are not implemented on the reviewed Core HEAD and require explicit affected-owner approval under §10 of `docs/57-private-host-core-memory-npc-adapter-contract.md` before implementation.

## 2. Identity contract

### 2.1 Canonical fields

| Field | Source | Meaning |
|---|---|---|
| `host_session_id` | Signed, server-owned SillyTavern session | UUID for the currently authenticated ST session. Must be rechecked by Host on every request. |
| `host_installation_id` | Host server identity store | Opaque installation namespace UUID. It is not a hardware identity, cryptographic attestation, or anti-clone/anti-rollback anchor. |
| `authenticated_account_id` | Host server identity store, resolved from the authenticated ST account | Opaque account UUID. Never derive it from a browser field or expose the ST account handle as an authorization identity. |
| `conversation_uuid` | Persisted chat metadata key `logic_engine_conversation_id` | Stable logical conversation UUID across renames and mutable filenames. |
| `host_conversation_key` | Existing Host-local identity | Stable tuple `host_installation_id:authenticated_account_id:conversation_uuid`; retain only for Host-owned stable identity/lifecycle correlation. It is not sent as Core `conversation_id`. |
| `conversation_id` | Host composition for Core | Session-scoped tuple `host_session_id:host_installation_id:conversation_uuid`. This is the only conversation key sent to Core. |

The Core tuple is the approved PC-NEXT-11 shape already enforced by Core `host-session-context.js`: `host_session_id:host_installation_id:conversation_uuid`. `authenticated_account_id` is a separate trusted assertion field and is not a tuple component. All UUID values must be canonical UUID strings. The Core tuple has exactly three components; no whitespace, extra component, alternate separator, filename, chat index, or account handle is accepted.

A new ST session produces a new Core `conversation_id` even when the stable `conversation_uuid` is unchanged. Core World bindings are therefore session-scoped. A missing/revoked binding for the new tuple fails closed and requires the existing explicit audited bind/rebind operation; no implicit rebind is allowed.

The existing Host-local stable key `host_installation_id:authenticated_account_id:conversation_uuid` remains a Host storage/correlation key only. Host must not pass it to Core as `conversation_id`. Host composes the Core-scoped tuple from the already authenticated session ID, server-owned installation ID, and persisted conversation UUID. This is a deterministic scope projection from the same identity sources, not a second identity authority or a new persisted identity.

### 2.2 Required Host derivation

1. The browser may provide the active `conversation_uuid` only as a locator to the Host client adapter.
2. Host verifies the exact Express request against native ST authentication middleware and resolves the account handle from server-populated request state.
3. Host resolves `host_installation_id` and `authenticated_account_id` from its persistent identity store.
4. Host obtains the server session's `host_session_id` and rechecks that it is bound to the authenticated account handle.
5. Host validates/persists `conversation_uuid` in chat metadata. It may retain the existing stable Host-local key, but composes Core `conversation_id = host_session_id:host_installation_id:conversation_uuid` for every Core request.
6. Host repeats session/account/identity checks at dispatch time. Browser/localStorage values are locators or consistency hints only.

Host must not send a browser-selected `world_id`, `actor_id`, `adapter_id`, account UUID, installation UUID, or session UUID as authority. The Host authentication gate must validate the Core tuple's first two components against the live signed ST session and server-owned installation record; it must not validate the existing Host-local key as if it were the Core tuple.

## 3. Authentication and signed assertion

### 3.1 Server-to-server authentication

Both Core endpoints in §§4–5 require:

- `Authorization: Bearer <LOGIC_ENGINE_API_TOKEN>`
- `x-adapter-id: <deployment-configured-adapter-id>`
- `x-adapter-token: <matching deployment-configured adapter secret>`
- `Content-Type: application/json`

The API bearer and adapter token are distinct secrets. They are sent only over the configured server-to-server transport, never by browser code, query strings, prompts, or logs. Core validates the adapter pair against deployment configuration. The adapter ID is not accepted from JSON.

### 3.2 Assertion schema — `host-session-assertion/v1`

Host signs the following exact plain JSON record. No additional or missing keys are allowed.

```json
{
  "protocol_version": 1,
  "host_installation_id": "22222222-2222-4222-8222-222222222222",
  "authenticated_account_id": "33333333-3333-4333-8333-333333333333",
  "host_session_id": "11111111-1111-4111-8111-111111111111",
  "conversation_id": "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444",
  "world_id": "core-bound-world-id",
  "actor_id": "core-bound-actor-id",
  "issued_at": 1793563200,
  "nonce": "55555555-5555-4555-8555-555555555555"
}
```

Rules:

- `protocol_version` is integer `1`.
- `issued_at` is Unix time in whole seconds.
- `nonce` is a fresh UUID for every retrieval request; it is never reused.
- `world_id` and `actor_id` are copied only from the successful Core context-resolution response in §4. They are not selected by the browser or inferred by Host.
- `conversation_id` must equal the exact Core tuple in §2.1; its first component must equal `host_session_id`, its second must equal `host_installation_id`, and its third must equal the persisted `conversation_uuid`.
- `signature` is lowercase 64-character hexadecimal HMAC-SHA256 using the configured adapter token as the key.
- HMAC input is UTF-8 `JSON.stringify([...])` in this exact order: `protocol_version, host_installation_id, authenticated_account_id, host_session_id, conversation_id, world_id, actor_id, issued_at, nonce`. This matches Core's current canonical assertion encoding.
- Core verifies the signature with constant-time comparison, exact own-data shape, UUID/ID constraints, expiry, future skew and one-time nonce consumption.

The current Core assertion runner uses a process-local `Map` bounded by `maxRememberedNonces` (default 10,000), a maximum assertion age of 30 seconds, and a future clock-skew allowance of 5 seconds. It detects replay only within that process lifetime; it does not prevent replay after a process restart. The contract therefore requires one of two Core-owned controls before route enablement: (a) atomic durable nonce consumption unique on `(adapter_id, nonce)` retained through the full acceptance window, or (b) a restart-rotated assertion verification key/epoch that makes all pre-restart assertions unverifiable. The implementation must choose one, test restart/replay, and fail closed if replay protection is unavailable. This does not add a second authentication mechanism.

## 4. Core context-resolution API

### `POST /v1/host-context/resolve`

Purpose: obtain the canonical World and exactly one Actor for the authenticated adapter + session-scoped Core conversation tuple. This endpoint trusts the authenticated Host server-to-server adapter credential as the caller; it is identity resolution only, not Memory authorization or proof of browser/session authentication by itself.

Request body — exact schema `host-context-resolve-request/v1`:

```json
{
  "conversation_id": "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444"
}
```

No other body key is permitted. In particular, `world_id`, `actor_id`, `actor_type`, `account_id`, and `adapter_id` are forbidden.

Success — HTTP 200, exact response data shape `host-context-resolve-response/v1`:

```json
{
  "context": {
    "adapter_id": "deployment-configured-adapter",
    "conversation_id": "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444",
    "world_id": "core-bound-world-id",
    "actor_id": "core-bound-actor-id",
    "actor_type": "character"
  }
}
```

Core implementation rules:

1. Derive `adapter_id` from authenticated headers.
2. Resolve the exact active conversation binding using the existing `HostConversationWorldBindingService.resolve({ adapterId, conversationId })`.
3. Resolve exactly one active actor using the existing `ActorBindingService.resolveForAdapter(worldId, adapterId)`, then verify that exact binding through `ActorBindingService.resolve(worldId, adapterId, actorId)`.
4. Return only the five fields above. Do not return canonical content, Provider data, grant state, or diagnostics.
5. Reject missing, revoked, stale, ambiguous, cross-world, malformed, or destroyed bindings. Never accept caller-selected World/Actor values.
6. Do not create a second binding table or resolver. The endpoint composes the two existing Core services.

This endpoint is distinct from the existing admin bind/rebind and adapter resolve operations under `/v1/host-conversation-bindings`; it does not replace or weaken them.

## 5. Core Memory retrieval API

### `POST /v1/host/memory-npc/retrieve`

Purpose: consume one authenticated Host assertion and return the existing Core `MemoryNpcConsumer.retrieveForNpc()` result. It does not perform model dispatch and does not authorize a later transport.

Request body — exact schema `host-memory-retrieve-request/v1`:

```json
{
  "assertion": {
    "protocol_version": 1,
    "host_installation_id": "22222222-2222-4222-8222-222222222222",
    "authenticated_account_id": "33333333-3333-4333-8333-333333333333",
    "host_session_id": "11111111-1111-4111-8111-111111111111",
    "conversation_id": "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444",
    "world_id": "core-bound-world-id",
    "actor_id": "core-bound-actor-id",
    "issued_at": 1793563200,
    "nonce": "55555555-5555-4555-8555-555555555555"
  },
  "signature": "64-lowercase-hex-characters",
  "request_id": "66666666-6666-4666-8666-666666666666",
  "context_size": 4096,
  "generation_type": "normal"
}
```

Exact top-level keys: `assertion, signature, request_id, context_size, generation_type`. `request_id` and assertion `nonce` are separate UUIDs. `context_size` is a safe integer in [1, 200000]. `generation_type` matches `^[a-z][a-z0-9_-]{0,31}$`. These bounded generation metadata fields do not select authorization scope, Memory purpose, World, Actor, fields, records, or Provider query. They are correlation/input metadata only.

Core processing order:

1. Authenticate API bearer and adapter headers.
2. Validate the exact request envelope and assertion shape.
3. Verify HMAC, timestamp window, and atomically consume the durable nonce.
4. Re-resolve the active conversation → World and unique adapter → Actor bindings; compare them exactly with assertion `world_id` and `actor_id`. Reject any mismatch.
5. Enter the existing authenticated Host-session capability/AsyncLocalStorage boundary using the verified assertion. Caller JSON cannot mint the capability.
6. Call only the existing consumer facade: `consumer.retrieveForNpc({ conversationId: assertion.conversation_id })`.
7. Return the consumer result unchanged. Do not expose the raw Provider interface or create a Host-side Provider client.

Core retrieval scope is fixed by the existing consumer: `recipient: "model"`, Core query purpose `npc_turn_context`, Provider/AuthorizedRead purpose `npc_decision`, subject = the Core-resolved Actor, and World = the Core-resolved World. These purposes are not interchangeable. Host cannot override the field allowlist or either purpose.

### 5.1 Result schema — `memory-npc-result/v1`

The top-level result envelope is exactly the existing consumer envelope. It has no Provider diagnostics or item-level denial metadata.

Ready:

```json
{
  "status": "ready",
  "admitted": [],
  "candidates": [
    {
      "record_ref": "provider-record-ref",
      "record_version": "provider-record-version",
      "authorization_generation": 7,
      "source_entity_id": "core-canonical-entity-id",
      "epistemic_kind": "acquired_report",
      "evidence_assessment": "unassessed",
      "content": {
        "attributes.public_note": "Core-authorized canonical value"
      }
    }
  ],
  "reason": null,
  "snapshot": {
    "world_revision": 12,
    "commit_sequence": 35
  }
}
```

The example candidate is illustrative; actual candidate metadata and content are produced by the existing consumer. Only configured allowlisted fields read from Core's final authorized snapshot may appear in `content`. `admitted` is the consumer's NPC admission output, not a Core acquisition or belief write.

Non-ready:

```json
{
  "status": "non_ready",
  "admitted": [],
  "candidates": [],
  "reason": "memory_snapshot_stale"
}
```

Rules:

- Ready result exact keys: `status, admitted, candidates, reason, snapshot`.
- Non-ready result exact keys: `status, admitted, candidates, reason`; no snapshot is asserted.
- A valid complete-empty retrieval may return `status: "ready"` with empty arrays and a current snapshot.
- Partial, denied, withheld, stale, malformed, ambiguous, unavailable, or incompletely authorized data must return `non_ready`, never ready-empty.
- Provider diagnostics, snippets, candidate/rejected/filtered counts, raw records, hidden field values, and internal error details never cross the envelope.
- Provider identity is pinned to exact `record_ref + record_version + authorization_generation`. Direct `canonical_entity` lineage is the only admitted source kind in this slice. Summaries and initial/imported assignments are not admitted through this consumer.
- Core validates canonical source version and complete inventory, then applies `AuthorizedReadService` visibility. The returned content is from the second/final Core field read after asynchronous authorization checks.
- `world_revision + commit_sequence` is a snapshot cursor, not a source-specific version token.

## 6. Error and refusal contract

HTTP/API errors use the existing Core envelope:

```json
{
  "error": {
    "code": "HOST_CONVERSATION_NOT_AUTHORIZED",
    "message": "Host conversation is not authorized."
  }
}
```

Do not return secrets, raw request data, hidden entity values, Provider snippets, or item-level denial reasons in error messages.

| Condition | HTTP | Stable code / result |
|---|---:|---|
| Invalid JSON, unknown key, malformed UUID/tuple, invalid bounds | 400 | `INVALID_HOST_CONTEXT_REQUEST` or `INVALID_HOST_MEMORY_RETRIEVE_REQUEST` |
| Missing/invalid session-to-conversation tuple | 403 | `HOST_SESSION_AUTHENTICATION_REQUIRED` or `HOST_SESSION_ASSERTION_INVALID` |
| Missing/invalid API bearer | 401 | `UNAUTHORIZED` |
| Missing/invalid adapter credentials | 403 | `ADAPTER_REQUIRED` |
| No active conversation → World binding | 403 | `HOST_CONVERSATION_NOT_AUTHORIZED` |
| World/Actor mismatch with signed assertion | 403 | `HOST_ASSERTION_BINDING_MISMATCH` |
| No active Actor binding | 403 | `ACTOR_NOT_AUTHORIZED` |
| More than one active Actor binding | 403 | `ACTOR_BINDING_AMBIGUOUS` |
| Bound Actor missing or destroyed | 409 | `ACTOR_ENTITY_NOT_ELIGIBLE` |
| Invalid/tampered assertion or signature | 403 | `HOST_SESSION_ASSERTION_INVALID` |
| Expired assertion | 403 | `HOST_SESSION_ASSERTION_EXPIRED` |
| Reused nonce | 403 | `HOST_SESSION_ASSERTION_REPLAYED` |
| In-process nonce cache full | 503 | `HOST_SESSION_ASSERTION_CAPACITY_EXCEEDED` |
| Durable nonce/epoch guard unavailable (target contract) | 503 | `HOST_ASSERTION_REPLAY_GUARD_UNAVAILABLE` |
| Core Memory consumer/Provider not configured | 503 | `MEMORY_RETRIEVAL_UNAVAILABLE` |
| Authenticated retrieval completed but policy/data is not ready | 200 | `status: "non_ready"` with a stable reason |
| Internal unexpected failure | 500 | `INTERNAL_ERROR`, generic message only |

The Host proxy maps a missing retrieval route (404 during rollout) to `503 NON_READY / CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE`; it must not treat route absence as an empty Memory result. Transport timeout/unreachable/invalid JSON also fails closed. No automatic retry may reuse the same assertion nonce; a retry requires a fresh assertion and nonce.

Host-side normalized dispatch outcomes are also fixed: invalid bounded browser metadata → `400 HOST_DISPATCH_REQUEST_INVALID`; missing server identity/session → `403` with no sensitive detail; missing proxy configuration → `503 LOGIC_ENGINE_PROXY_UNCONFIGURED`; context resolver missing, denied, malformed or ambiguous → `503 HOST_WORLD_ACTOR_BINDING_UNAVAILABLE`; retrieval route missing → `503 CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE`; other upstream refusal → `502 CORE_HOST_DISPATCH_REJECTED`; malformed upstream JSON → `502 LOGIC_ENGINE_INVALID_RESPONSE`; transport failure/timeout → `502 LOGIC_ENGINE_UNREACHABLE`. Host never forwards Provider diagnostics or raw Core error details to the browser.

### Stable non-ready reasons

The consumer's existing reason vocabulary remains the source of truth. It includes (non-exhaustively) `trusted_scope_incomplete`, `query_access_unconfirmed`, `actor_binding_unavailable`, `memory_query_denied`, `memory_records_withheld`, `memory_snapshot_stale`, `memory_snapshot_unavailable`, `memory_index_not_ready`, `memory_index_rebuilding`, `memory_index_unavailable`, `memory_index_stale`, `memory_reconciliation_stale`, `memory_lineage_invalid`, `memory_source_validation_unavailable`, `memory_source_version_unverifiable`, `memory_authorization_changed`, `memory_record_access_revoked`, `memory_record_authorization_unconfirmed`, `authorized_source_read_unavailable`, and `memory_result_partial`.

Reason strings are safe state labels, not a promise to reveal which record, field, or grant caused the refusal.

## 7. Revocation and freshness rules

1. **ST logout/session rotation/account switch:** Host must reject the old request before assertion creation. A new session changes the tuple and requires an active Core binding for that tuple.
2. **Host identity unavailable or inconsistent:** refuse before calling Core. Do not repair an enrolled identity silently or trust localStorage.
3. **Conversation binding revoked/reassigned:** Core context resolution and retrieval both re-resolve the active binding. Revoked or changed binding denies; no implicit reassignment.
4. **Actor binding revoked/ambiguous:** Core refuses unless exactly one active adapter → Actor binding remains and matches the signed assertion.
5. **Assertion replay/expiry:** durable nonce uniqueness and timestamp checks reject it; restart must not clear replay history while an assertion can still be accepted.
6. **Provider query or record grant revoked:** Core/Provider rechecks exact query permission, exact record version and authorization generation before returning. Revoke/re-grant changes the generation; a previously captured generation cannot become valid again.
7. **Canonical source/field visibility/snapshot changes:** re-read through the existing Core validators and `AuthorizedReadService`. Any stale, incomplete, hidden, unavailable or mismatched final read returns non-ready.
8. **Revocation wins before a ready result:** no candidate content is returned. No partial candidate set is returned as ready.
9. **No lease claim:** `revalidateForFinalDispatch()` remains a freshness reread only. This retrieval contract does not create a transport lease or alter the separate Security Gateway/Final-Send design.

## 8. Version pins and compatibility

| Surface | Required version |
|---|---|
| This document | `Host-Core-Integration-Contract-v1`, semantic version `1.0.0` |
| Core HTTP route prefix | `/v1` |
| Host assertion | `protocol_version: 1`, schema `host-session-assertion/v1` |
| Context resolve request/response | `host-context-resolve-request/v1` / `host-context-resolve-response/v1` |
| Memory retrieval request | `host-memory-retrieve-request/v1` |
| Memory result | `memory-npc-result/v1`; existing exact five-key ready envelope and four-key non-ready envelope |
| Provider identity | Exact opaque `record_ref`, `record_version`, positive safe-integer `authorization_generation`; no new Provider record schema is introduced here |
| Core snapshot | Non-negative safe-integer `world_revision` + `commit_sequence` |
| Core source lineage | Existing canonical entity source-version/inventory validators; only direct `canonical_entity` is admitted |

Unknown major versions, extra keys, missing required keys, or incompatible field semantics are rejected. A future incompatible change requires a new versioned contract and tests on both sides. Do not add a parallel endpoint or identity format as a compatibility fallback.

## 9. Current HEAD compatibility findings

| Item | Host #850 HEAD | Core #846 HEAD | Disposition |
|---|---|---|---|
| Conversation identity | Host stable key is `installation_id:account_id:conversation_uuid`; the Host auth gate currently forwards this as `conversation_id` and sends `host_session_id` separately | Core requires `host_session_id:host_installation_id:conversation_uuid`; account is separate | **Mismatch. Keep the Host-local stable key local; derive the PC-NEXT-11 Core tuple at the authenticated Host gate. No account-bearing tuple is sent to Core.** |
| Context resolution | Host candidate adds `/v1/host-context/resolve` to `src/api/server.js` and exercises it against the Core server embedded in the same Host branch | Core #846 HEAD and `main` do not register this route; Host branch's route derives adapter from adapter credentials, resolves World/Actor, but is not part of the reviewed Core candidate | **Present only inside Host candidate's Core-file diff; not integrated into Core #846 or main and not D5-approved. Treat as a proposed Core-owned change, not proof of cross-branch compatibility.** |
| Memory retrieval | Calls `POST /v1/host/memory-npc/retrieve` with assertion/signature/request metadata | No such route is registered in `src/api/server.js`; internal consumer/facade exists | **Missing route. Core must compose the existing assertion verifier and consumer facade.** |
| Assertion replay | Host generates a fresh UUID nonce per dispatch | Core runner checks expiry/replay/capacity in a process-local `Map` (`maxAgeSeconds` default 30; capacity default 10,000) | **Replay protection is process-local, not restart-safe. Add durable nonce consumption or restart-invalidated assertion epoch before enablement.** |
| Provider result | Host returns upstream payload | Core consumer returns a narrow ready/non-ready envelope with final authorized content | Compatible once the missing route returns the consumer envelope unchanged. |
| World/Actor authority | Host obtains values from Core resolver and signs them | Core independently resolves durable bindings and compares assertion | Compatible in principle; exact endpoint is missing. |

The Host candidate's context integration test is real against the `createApiServer()` implementation bundled in the Host branch, but it is not an exact-head compatibility test against Core #846 or `main`. The Host PR diff itself modifies Core-owned `src/api/server.js` to add `/v1/host-context/resolve` and adds `src/application/host-session-context.js`; the latter accepts `installation_id:account_id:conversation_uuid` as the signed `conversation_id`. That conflicts with Core #846's PC-NEXT-11 validator, which requires `host_session_id:host_installation_id:conversation_uuid` and keeps account UUID separate. The Host candidate therefore makes its local test pass by carrying a different Core implementation inside the Host branch; it does not prove that the two reviewed branches interoperate. The new route is not present in Core #846 or `main`, and its API-owner approval under D5 is not evidenced. `/v1/host/memory-npc/retrieve` remains absent from both reviewed Core #846 and the Host candidate's bundled Core server; the Host integration test reaches that request and receives `503 CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE`. Core's internal `MemoryNpcConsumer` remains available behind its internal facade, but there is no accepted cross-process HTTP route composing the assertion runner with that consumer.


### Follow-up finding — Host candidate embeds a divergent Core implementation

A re-check of the exact Host #850 tree found `/v1/host-context/resolve` at `src/api/server.js` and a real HTTP test at `host-adapter/extension-gateway/tests/host-core-context-integration.test.mjs`. The test starts the Core server from the **same Host branch**, creates the binding, calls the route, and verifies World/Actor resolution. This is valid evidence for that combined branch only.

The Host PR diff also changes Core-owned `src/application/host-session-context.js`. Its validator binds `conversation_id` to `host_installation_id:authenticated_account_id:conversation_uuid`; Core #846 instead pins PC-NEXT-11 `host_session_id:host_installation_id:conversation_uuid` with account identity separate. Core #846's `src/api/server.js` and current `main` do not contain `/v1/host-context/resolve`. Therefore the Host PR's same-branch test does not validate compatibility with Core #846, and its embedded Core changes cannot be treated as accepted Host-owned implementation. D5 approval from the Core API owner is still required before those Core-owned changes can be adopted.

The same Host test then calls `/v1/host/memory-npc/retrieve` and expects `503 CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE`; no Memory retrieval HTTP route is implemented in either reviewed Core #846 or the Host candidate's embedded server. This remains the blocking cross-process seam.

## 10. Acceptance checklist — no code integration in this task

The contract is **technically reconciled by the coordinator** at the reviewed HEADs, but is not yet D5-approved or implementation-accepted. It becomes jointly accepted for implementation only after the explicit approvals and exact-head tests below.

- [x] Coordinator technical review of Host #850 HEAD `dfd1e7140ea058f76ae48c40abda0c54e3598fde`: Host-local identity, its embedded Core route/validator changes, and the resulting divergence from Core #846 PC-NEXT-11 are recorded. The Host-side test is classified as same-branch integration, not cross-branch compatibility.
- [x] Coordinator technical review of Core #846 HEAD `832abf337530e9421f53eaed85760cb4a7f07313`: existing binding services, assertion runner, Memory consumer, result envelope and missing HTTP routes are recorded.
- [ ] Host API owner explicitly approves the tuple projection and private Host→Core wire contract under D5.
- [ ] Core API owner explicitly approves the two private routes, assertion replay hardening choice, and response/error contract under D5.
- [ ] Exact-head contract tests prove request/response compatibility on both blocks before any code integration.
- [ ] Any objection is recorded against a specific section and resolved in this document before code work starts.

This document records the target private API delta and the coordinator's technical reconciliation of the two reviewed blocks. Under D5 in `docs/57-private-host-core-memory-npc-adapter-contract.md`, the new routes and any change to Host's conversation tuple require explicit approval from the affected API owners before implementation. This task does **not** authorize code integration, merge either PR, alter Security Gateway, enable Memory → NPC, or start Final-Send work.