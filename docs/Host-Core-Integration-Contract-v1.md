# Host-Core-Integration-Contract-v1

**Contract:** Host ↔ Core authenticated Memory retrieval  
**Version:** 1.0.0  
**Status:** CONTRACT DEFINED; Host and Core technical-owner ACKs received; latest Host/Core code-candidate CI green; refreshed contract-document CI running; independent maintainer reviews and branch integration remain pending  
**Validated candidate heads (1 Nov 2026):** Host PR #850 `8c51709cbfe85e93ebe04065cf5282c4dd0a8bdc`; Core Lane B PR #846 `832abf337530e9421f53eaed85760cb4a7f07313`; Core HTTP PR #867 `c109dc7c2ad084e1fb236703c8a77c844d634717`  
**Scope:** identity hand-off, Core World/Actor resolution, authenticated Memory Provider retrieval, result/error/revoke semantics.  
**Not in scope:** branch merging, Security Gateway changes, Final-Send, production enablement, Lane A, Provider schema migration.

This document is the interface contract and implementation ledger. The two private routes are present in stacked Core HTTP #867 and Host #850; their two required Memory integration route blocks are byte-identical. Latest exact-head Runtime CI is green for Host #850 (run `41337612948`), Core Lane B #846 (run `41317936997`), Core HTTP #867 (run `41337597644`), and the prior contract PR #866 HEAD (run `41338285214`); the current documentation refresh is running separately. Memory → NPC remains fail-closed until deployment Provider configuration/data authorization and existing release gates are satisfied.

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

No second identity store, World/Actor resolver, authorization authority, Provider facade, or public ingress is introduced. The two private HTTP routes below are implemented as server-to-server API additions over existing Core services. They do not create a second identity, binding, authorization, or Provider authority.

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

Host must not send a browser-selected `world_id`, `actor_id`, `adapter_id`, account UUID, installation UUID, or session UUID as authority. The Host authentication gate validates the Host-local stable tuple against server-owned installation/account identity and independently verifies the live signed ST session ID. The dispatch proxy then constructs the Core tuple `host_session_id:host_installation_id:conversation_uuid` from those already authenticated values; only that Core tuple is sent as Core `conversation_id`.

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

The assertion runner retains the 30-second maximum age and 5-second future-skew limits. The coordinated implementation chooses durable atomic nonce consumption: a dedicated SQLite nonce database stores unique `(adapter_id, nonce)` entries through the acceptance window. It is separate from Core canonical storage, Provider storage, and the shared Coordinator database. Failure to consume durably returns 503 and fails closed. Exact restart/replay tests are part of the Core HTTP suite.

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

Success — HTTP 200, exact response envelope `host-context-resolve-response/v1` (the `context` object has exactly the five fields shown):

```json
{
  "context": {
    "adapter_id": "deployment-configured-adapter",
    "conversation_id": "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444",
    "world_id": "core-bound-world-id",
    "actor_id": "core-bound-actor-id",    "actor_type": "character"  }}
```

Core implementation rules:

1. Derive `adapter_id` from authenticated headers.
2. Resolve the exact active conversation binding using the existing `HostConversationWorldBindingService.resolve({ adapterId, conversationId })`.
3. Resolve exactly one active actor using the existing `ActorBindingService.resolveForAdapter(worldId, adapterId)`. This method itself rejects zero or multiple active bindings and rejects a missing/destroyed actor; the HTTP route does not make a second `resolve()` call.
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

The inner `retrieval` value is exactly the existing consumer envelope. The HTTP route wraps it in `{ "retrieval": <consumer-result> }`; the Host proxy forwards that wrapper unchanged. Neither layer adds Provider diagnostics or item-level denial metadata.

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
| Condition | HTTP | Stable code / result ||---|---:|---|
| Invalid JSON | 400 | `INVALID_JSON` |
| Invalid context body / unknown key / malformed context tuple | 400 | `INVALID_HOST_CONTEXT_RESOLUTION` |
| Invalid retrieval envelope / bounded metadata | 400 | `INVALID_HOST_MEMORY_RETRIEVAL` |
| Invalid, tampered, or malformed signed assertion | 401 | `HOST_SESSION_ASSERTION_INVALID` |
| Missing/invalid API bearer | 401 | `UNAUTHORIZED` |
| Missing/invalid adapter credentials | 403 | `ADAPTER_REQUIRED` |
| No active conversation → World binding | 403 | `HOST_CONVERSATION_NOT_AUTHORIZED` |
| Bound World missing between conversation and Actor resolution | 409 | `HOST_CONVERSATION_WORLD_UNAVAILABLE` |
| Core World disappears during Actor resolution | 404 | `WORLD_NOT_FOUND` |
| Actor resolver returns malformed/ineligible binding data | 409 | `HOST_ACTOR_BINDING_UNAVAILABLE` |
| Unsupported HTTP method on either private route | 405 | `METHOD_NOT_ALLOWED` |
| Consumer returns an invalid result envelope | 503 | `MEMORY_NPC_RESULT_INVALID` |
| Signed assertion World/Actor differs from Core's live binding | 200 | `{ "retrieval": { "status": "non_ready", "reason": "query_access_unconfirmed", ... } }` |
| No active Actor binding | 403 | `ACTOR_NOT_AUTHORIZED` |
| More than one active Actor binding | 403 | `ACTOR_BINDING_AMBIGUOUS` |
| Bound Actor missing or destroyed | 409 | `ACTOR_ENTITY_NOT_ELIGIBLE` |
| Expired assertion | 401 | `HOST_SESSION_ASSERTION_EXPIRED` |
| Reused nonce | 409 | `HOST_SESSION_ASSERTION_REPLAYED` |
| No configured adapter-pinned Memory consumer | 503 | `MEMORY_NPC_CONSUMER_UNAVAILABLE` |
| In-process nonce cache full (legacy runner mode) | 503 | `HOST_SESSION_ASSERTION_CAPACITY_EXCEEDED` |
| Durable nonce store unavailable or write failure | 503 | `HOST_ASSERTION_REPLAY_GUARD_UNAVAILABLE` |
| Core Memory consumer/Provider not configured | 503 | `MEMORY_NPC_CONSUMER_UNAVAILABLE` |
| Authenticated retrieval completed but policy/data is not ready | 200 | `{ "retrieval": { "status": "non_ready", ... } }` with a stable reason |
| Internal unexpected failure | 500 | `INTERNAL_ERROR`, generic message only |

The Core retrieval route returns HTTP 200 as `{ "retrieval": <memory-npc-result/v1> }`. At the Host boundary, a missing retrieval route (404 during rollout) maps to `503 NON_READY / CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE`; HTTP 503 from Core also maps to `503 NON_READY / CORE_HOST_DISPATCH_REJECTED`; all other non-2xx responses except 404 map to `502 NON_READY / CORE_HOST_DISPATCH_REJECTED`. Transport timeout/unreachable and invalid JSON map to `502 NON_READY / LOGIC_ENGINE_UNREACHABLE` and `502 NON_READY / LOGIC_ENGINE_INVALID_RESPONSE` respectively. Host forwards the successful Core wrapper unchanged. No automatic retry may reuse the same assertion nonce; a retry requires a fresh assertion and nonce.

Host-side normalized dispatch outcomes are also fixed: invalid bounded browser metadata → `400 HOST_DISPATCH_REQUEST_INVALID`; missing server identity/session → `403` with no sensitive detail; missing proxy configuration → `503 LOGIC_ENGINE_PROXY_UNCONFIGURED`; context resolver missing, denied, malformed or ambiguous → `503 HOST_WORLD_ACTOR_BINDING_UNAVAILABLE`; retrieval route missing → `503 CORE_HOST_DISPATCH_ROUTE_UNAVAILABLE`; other upstream refusal → `502 CORE_HOST_DISPATCH_REJECTED`; malformed upstream JSON → `502 LOGIC_ENGINE_INVALID_RESPONSE`; transport failure/timeout → `502 LOGIC_ENGINE_UNREACHABLE`. Host never forwards Provider diagnostics or raw Core error details to the browser.

### Stable non-ready reasons

The consumer's existing reason vocabulary remains the source of truth. It includes (non-exhaustively) `trusted_scope_incomplete`, `query_access_unconfirmed`, `actor_binding_unavailable`, `memory_query_denied`, `memory_records_withheld`, `memory_snapshot_stale`, `memory_snapshot_unavailable`, `memory_index_not_ready`, `memory_index_rebuilding`, `memory_index_unavailable`, `memory_index_stale`, `memory_reconciliation_stale`, `memory_lineage_invalid`, `memory_source_validation_unavailable`, `memory_source_version_unverifiable`, `memory_authorization_changed`, `memory_record_access_revoked`, `memory_record_authorization_unconfirmed`, `authorized_source_read_unavailable`, and `memory_result_partial`.

Reason strings are safe state labels, not a promise to reveal which record, field, or grant caused the refusal.

**Resolved implementation discrepancy — Core #867:** the route now distinguishes exceptions thrown inside `consumer.retrieveForNpc()` from assertion-verification failures. Unexpected Consumer/runtime exceptions propagate to the existing generic `500 INTERNAL_ERROR` envelope; only explicit `HOST_SESSION_ASSERTION_INVALID` verification errors map to 401. A regression test verifies the generic response, no detail disclosure, and nonce consumption (replay returns 409). The same route correction and byte-identical HTTP regression test are present in Host #850. Core full Runtime CI passed on the latest #867 HEAD; the regression and generic error mapping are CI-verified.

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

## 9. Coordinated candidate compatibility — 1 Nov 2026

The active candidates have corrected the earlier identity-key and Memory-consumer mismatches. Compatibility below is checked against the exact candidate heads listed in the document header.

### Current shared implementation

| Surface | Host #850 | Core #867 / Lane B #846 | Result |
|---|---|---|---|
| Core conversation tuple | Host-local key remains local; Core tuple is projected as `host_session_id:host_installation_id:conversation_uuid` | PC-NEXT-11 validator uses the same tuple; account UUID remains a separate assertion field | Aligned |
| `POST /v1/host-context/resolve` | Route block present | Implemented in stacked Core HTTP #867; not present in Lane B #846 alone | Aligned at the combined candidate level |
| `POST /v1/host/memory-npc/retrieve` | Route block present | Implemented in stacked Core HTTP #867; not present in Lane B #846 alone | Aligned at the combined candidate level |
| `HostConversationWorldBindingService` | Blob matches Core candidate | Hardened identifier validation | Aligned |
| `MemoryNpcConsumer` | Blob matches Core candidate after sync | Hardened plain-data/proxy/array checks and authenticated-session context | Aligned |
| Memory Provider adapter | Blob matches Core candidate | HTTP/runtime composition and Provider facade | Aligned |
| Unexpected exception from `retrieveForNpc()` | Host mirrors the shared route correction; proxy maps non-2xx Core responses to bounded dispatch failure | Core #867 propagates Consumer callback failures to generic 500 `INTERNAL_ERROR`; regression test added | Corrected; exact-head Core CI passed |
| NPC knowledge authorization + SQLite Memory Provider | Blobs match Lane B/Core candidate after sync | Core-owned authorization and Provider implementation | Aligned |
| Host lifecycle and full-root inventory routes | Host adds four private routes | Not part of Core #867 | Host-owned extension; no collision with Core routes |

The `src/api/server.js` files retain composition differences for Host-owned lifecycle/root-inventory routes and runtime wiring. The shared Core route blocks for context resolution and Memory retrieval are kept identical between Host #850 and Core HTTP #867; Lane B #846 is the lower stacked foundation and does not itself contain those HTTP route registrations.

### Historical baseline — superseded

The original review recorded a mismatch where Host sent `installation_id:account_id:conversation_uuid` as Core `conversation_id`, while Core required PC-NEXT-11. It also recorded the absence of the two private HTTP routes and restart-safe nonce persistence. These were valid findings against the reviewed baseline, but must not be treated as current candidate state. The implementation ledger below supersedes those findings.

## 10. Implementation acceptance checklist

The contract's wire format, identity projection, binding ownership, retrieval facade, and version pins are reconciled. The §6 Consumer exception-mapping correction and regression test are implemented in Core #867 and mirrored in Host #850. Exact-head Runtime CI is green for Host #850, Core Lane B #846, Core HTTP #867, and contract #866. Independent maintainer reviews, branch integration, and deployment readiness remain separate gates.

- [x] Coordinator technical review of the current Host #850 candidate: Host-local identity remains local; Core PC-NEXT-11 projection and private route blocks are present.
- [x] Coordinator technical review of Core #846 and #867 candidates: binding services, assertion runner, Memory consumer, result envelope, context-resolution route, and retrieval route are present.
- [x] Host API technical-owner approval: Host-local stable key remains local; Core requests use PC-NEXT-11 tuple.
- [x] Core API technical-owner approval: two private routes, durable nonce guard, and existing consumer result envelope.
- [x] Core retrieval exception mapping conforms to §6 in #867: unexpected consumer/runtime exceptions return generic HTTP 500 `INTERNAL_ERROR`; regression test verifies response secrecy and nonce replay protection.
- [x] Latest exact-head full Runtime CI passes on Host #850 (`41337612948`), Core Lane B #846 (`41317936997`), Core HTTP #867 (`41337597644`), and contract #866 (`41338285214`). All jobs, including `npm test`, completed successfully.
- [x] Contract PR #866 full Runtime suite passed on retry (run `41331512380`, attempt 2); the first attempt's single failure was the unrelated Windows `remote-binding.test.js` listener/fetch test.
- [x] Identity projection is aligned across Host #850 and Core HTTP #867. Route ownership is split at the PR-stack level: #846 is the Core foundation, #867 supplies Core HTTP routes, and #850 carries the Host candidate plus its coordinated route mirror. Remaining independent review, branch integration, and deployment gates are tracked in §11.


## 11. Coordinated implementation status — 1 Nov 2026

The technical owner has taken responsibility for both blocks and approved the bounded D5 delta. Work is split into stacked Core changes and the Host candidate; neither is merged into `main`.

| Block | Candidate | Implemented |
|---|---|---|
| Core | [PR #867](https://github.com/necromorphic/Logic-Engine/pull/867), stacked on Core #846 | Context resolver, Memory retrieval route, HMAC assertion verification, durable nonce store, optional runtime Provider composition |
| Host | [PR #850](https://github.com/necromorphic/Logic-Engine/pull/850) | Host-local identity retained; Core PC-NEXT-11 tuple projected at authenticated gate; gate validates session + installation tuple; signed assertion and request metadata sent through both routes |

### Current wire behaviour

- `POST /v1/host-context/resolve` is implemented in the Core candidate. It accepts only `conversation_id`, derives adapter identity from authenticated headers, resolves the active World binding and exactly one Actor through existing Core services, and returns the five-field context.
- `POST /v1/host/memory-npc/retrieve` is implemented in the Core candidate. It verifies the exact assertion, atomically consumes its nonce in the dedicated SQLite replay store, establishes the branded AsyncLocalStorage context, and calls only the adapter-pinned `MemoryNpcConsumer.retrieveForNpc()` facade. Its HTTP 200 response is `{ "retrieval": <consumer-result> }`; the Host proxy forwards this wrapper unchanged.
- Host keeps `installation_id:account_id:conversation_uuid` for Host-local lifecycle/storage correlation. For Core it sends `host_session_id:host_installation_id:conversation_uuid`; account UUID remains a separate signed assertion field.
- A rotated ST session receives a new Core conversation tuple and requires an explicit binding for that tuple. There is no automatic rebind.
- Runtime can optionally configure the real file-backed Provider with `ENGINE_MEMORY_PROVIDER_DB_PATH` and `ENGINE_MEMORY_NPC_CONTENT_FIELDS`. The Provider DB is separate from Core and shares the Coordinator. If this configuration is absent, or Provider grants/index/source authorization are not ready, retrieval fails closed. No ready-empty fallback is introduced.

### Replay protection
The implementation uses `HostAssertionNonceStore` in a dedicated file configured by `ENGINE_HOST_ASSERTION_NONCE_DB_PATH` (default: `./data/logic-engine-host-assertion-nonces.sqlite`). It enforces a unique key on `(adapter_id, nonce)`, removes expired entries opportunistically, and persists across API process restarts. It is checked to be a separate file from Core and Coordinator; Host deployment additionally checks it against the Host lifecycle and version-ledger files. A store failure produces `503 HOST_ASSERTION_REPLAY_GUARD_UNAVAILABLE`.

### Validation stateExact candidate heads and latest Runtime validation checked on 1 Nov 2026:

- Core Lane B PR #846 HEAD `832abf337530e9421f53eaed85760cb4a7f07313`: Runtime run `41317936997` — SUCCESS; all eight jobs passed, including `npm test`. This is the Core foundation; HTTP route registrations are supplied by stacked #867.
- Core integration PR #867 HEAD `4b36f9f6763efc4e0ab4356614e10422f82174d5`: Runtime run `41335872509` — SUCCESS; all eight jobs passed, including `npm test` and Windows symlink security.
- Host candidate PR #850 HEAD `40d89e8230f7a893130ce5bc5791c354b13a8422`: Runtime run `41335887577` — SUCCESS; all seven jobs passed, including `npm test`. Its separate candidate, static validation, pinned-source, Provider blocker, and browser restart workflows also passed.
- Contract PR #866 HEAD `c1d5a684a82bafdc0ce8f211be7af8928c355e14`: Runtime run `41336312266` — SUCCESS; all seven jobs passed, including `npm test`.

The Host candidate now carries the same Core-owned Memory consumer, conversation binding validation, NPC knowledge authorization, and SQLite Memory Provider implementation as the Core/Lane B candidates. The shared Core HTTP route blocks are byte-identical; Host-specific lifecycle and root-inventory routes remain additional Host-owned API routes. A combined Host Adapter → real Core HTTP → consumer-facade test now covers default-user, accounts-enabled, and session-restart paths; its test-only Memory consumer does not prove configured production Provider readiness. This is candidate CI evidence, not a merge or production-readiness approval.

### Exact overlap and merge-resolution matrix

The current branch files were fetched and compared byte-for-byte on 1 Nov 2026; this is more specific than treating every shared filename as a merge conflict.

| Pair | Shared paths | Exact same content | Different content | Resolution |
|---|---:|---:|---:|---|
| Host #850 ↔ Core Lane B #846 | 26 | 12 | 14 | 11 differences are Host prototype/workflow artifacts that must remain Host-owned. The other 3 are `host-session-context.js`, `memory-npc-provider-adapter.js`, and its test; the newer Core HTTP #867 versions of all three match Host #850 byte-for-byte. |
| Host #850 ↔ Core HTTP #867 | 8 | 5 | 3 | `host-assertion-nonce-store.js`, `host-session-context.js`, `memory-npc-provider-adapter.js`, and both affected tests are identical. The three intentional composition differences are `src/api/server.js`, `src/index.js`, and `.env.example`. |
| Core Lane B #846 ↔ Core HTTP #867 | 3 | 0 | 3 | #867 deliberately advances `host-session-context.js`, `memory-npc-provider-adapter.js`, and `tests/memory-npc-provider-adapter.test.js`; these are the exact versions already present in Host #850. |

For `src/api/server.js`, the five shared Core route blocks were extracted and compared independently; all five are byte-identical: context resolve, Memory NPC retrieve, version-ledger capture, version-ledger reconcile, and conversation-binding resolve. Host #850 adds exactly four routes absent from Core #867: `/v1/host-lifecycle/events`, `/v1/host-lifecycle/status`, `/v1/host-root-inventory/baseline`, and `/v1/host-root-inventory/observe`. These must be preserved.

For `src/index.js`, retain Host #850's root-identity registry, lifecycle journal, lifecycle authority, and Host-only shutdown wiring while carrying forward the shared Core HTTP/Memory composition. For `.env.example`, retain Core variables and Host deployment variables; neither file should be replaced wholesale by the other branch.

**Result:** no evidence of a semantic conflict in the five shared route blocks. The known reconciliation is bounded to Host-owned route/runtime/config additions plus the three Core files already converged by #867. Still require a real rebase/merge simulation and full CI after each integration step; this static comparison is not a merge test.

### Remaining release blockers

1. **Independent review:** no independent GitHub PR Reviews have been submitted on #846, #850, #866, or #867. Coordinator comments/ACKs are not counted as independent approval.
2. Branch integration is still required. #867 is stacked on #846; #850 is independently based on `main` and overlaps 26 files with #846 and 8 files with #867. The shared Core route blocks are identical, but `src/api/server.js`, `src/index.js`, `.env.example`, and the overlapping adapter composition must be reconciled deliberately; do not merge the three PRs blindly.
   - Current `main` has advanced two commits beyond the base SHA recorded by #846. The delta is limited to `README.md` and `docs/progress-bars-2026-11-01.svg`; neither path is in #846's patch. Refresh/rebase #846 onto current `main` before integration, then re-run its full CI. Host #850 already uses current `main` as its base.
3. Recommended integration order: rebase/refresh Core Lane B #846 against current `main`; integrate Core HTTP #867 on top of it; then rebase Host #850 onto the integrated Core result and resolve Host-owned lifecycle/inventory additions while retaining the identical shared route blocks. Re-run full CI after each rebase.
4. Deployment must provide the durable Provider DB and explicit Core field allowlist; Provider data must have valid query/record grants and canonical source lineage before a ready result is possible.
5. Host authoritative full-root inventory and lifecycle mutation coverage remain independent Host release gates. No Security Gateway modification, Final-Send, or production enablement is included here.

This is implementation progress, not a merge or release approval.

This document records the coordinated implementation and its remaining release gates. The technical owner approves the D5 private API delta for these two blocks; branch merges and production enablement remain separate release decisions.

## Independent review follow-up — 2026-11-01

The independent review identified verification gaps rather than confirmed exploitable defects. The following evidence was added or rechecked against the working branches:

- **Nonce replay atomicity:** `host_assertion_nonces` has a SQLite primary key on `(adapter_id, nonce)`; consumption uses one `INSERT OR IGNORE` statement and accepts only `changes === 1`. This makes the database uniqueness constraint the atomic arbiter across connections. Core HTTP regression coverage now sends two concurrent requests with the same signed nonce and requires exactly one success and one `409 HOST_SESSION_ASSERTION_REPLAYED`.
- **Nonce-store failure:** Core HTTP regression coverage injects a failing durable-store `consume()` operation and requires `503 HOST_ASSERTION_REPLAY_GUARD_UNAVAILABLE`; the Consumer must not run. Existing coverage also verifies replay rejection after HTTP server recreation with the same durable store. A database that cannot be opened during startup prevents Core startup; it does not fall back to an in-memory nonce ledger.
- **Runtime composition:** the production `src/index.js` creates one process-scoped `MechanicPolicyAuthority` and passes that exact instance as `fieldPolicy` to each configured Provider adapter. The adapter constructs one `AuthorizedReadService` and injects that same instance into its `MemoryNpcConsumer`; the HTTP layer receives only the consumer facade, not a second AuthorizedReadService. The real file-backed adapter composition is covered by `tests/memory-npc-provider-adapter.test.js`. A separate full-process startup smoke test with deployment secrets and real SillyTavern remains a deployment acceptance gate.
- **Revocation / final dispatch:** `MemoryNpcConsumer.revalidateForFinalDispatch()` is explicitly a freshness reread, not a transport lease. It returns fresh values and fails closed on changed authorization/source state, but cannot close the race after that reread. Host must serialize revalidation with durable `DISPATCH_STARTED` and the sole outbound Gateway path. Until the separate Final-Send/Gateway implementation proves this ordering and its revoke race test, protected disclosure remains disabled / fail-closed. This contract does not claim linearizable revocation.
- **Identity naming:** assertion `conversation_id` is the serialized PC-NEXT-11 tuple `host_session_id:host_installation_id:conversation_uuid`; `authenticated_account_id` remains a separate signed field. The legacy Host-local key `installation_id:account_id:conversation_uuid` is not a Core conversation identifier.

Regression tests were added to Core HTTP #867 (commit `c109dc7c2ad084e1fb236703c8a77c844d634717`) and mirrored byte-for-byte in Host #850 (commit `8c51709cbfe85e93ebe04065cf5282c4dd0a8bdc`). Core Runtime CI run `41337597644` passed in full. Host Runtime CI run `41337612948` was still running at the time this addendum was prepared. The Host and Core versions of `tests/host-memory-http-api.test.js` are byte-identical, and the five shared HTTP route blocks remain byte-identical.

These checks do not constitute merge approval. Independent maintainer Reviews, final Host CI, branch integration/rebase, deployment configuration, and Final-Send proof remain separate gates.

## 12. Superseding exact-head verification — 1 Nov 2026

This section supersedes earlier candidate SHA and CI snapshots in §§1, 9–11. The contract semantics remain v1.0.0; no schema or route version was changed by this verification update.

### Exact current candidates

| Candidate | Current HEAD | Exact-head validation |
|---|---|---|
| Host #850 `host/unified-extension-gateway-candidate` | `8c51709cbfe85e93ebe04065cf5282c4dd0a8bdc` | Runtime `41337612948` SUCCESS; candidate, static validation, pinned-source audits, browser restart and Provider blocker workflows SUCCESS |
| Core Lane B #846 `lane-b/core-authenticated-host-request-2026-11-01` | `832abf337530e9421f53eaed85760cb4a7f07313` | Runtime `41317936997` SUCCESS; lifecycle patch, Provider blocker, browser restart and pinned-source workflows SUCCESS |
| Core HTTP #867 `integration/core-host-memory-http-v1` | `c109dc7c2ad084e1fb236703c8a77c844d634717` | Runtime `41337597644` SUCCESS |
| Contract #866 `docs/host-core-integration-contract-v1` | `abb19bcf0090db4e987efc0e3a8a1665e06a06fc` | Runtime `41338676552` IN_PROGRESS; prior document HEAD run `41338285214` SUCCESS |

All listed runs are completed with conclusion SUCCESS. These are validation results for the exact PR heads above, not merge or deployment approval.

### Current cross-branch byte comparison

Fetched current files from Host #850 and Core HTTP #867 and compared their complete contents:

| Path | Result |
|---|---|
| `src/application/host-session-context.js` | Byte-identical |
| `src/application/memory-npc-provider-adapter.js` | Byte-identical |
| `src/application/host-assertion-nonce-store.js` | Byte-identical |
| `tests/host-memory-http-api.test.js` | Byte-identical |
| `src/application/memory-npc-consumer.js` | Byte-identical |
| `src/application/host-conversation-world-bindings.js` | Byte-identical |
| `src/application/actor-bindings.js` | Byte-identical |
| `src/application/npc-knowledge-authorization.js` | Byte-identical |
| `src/application/sqlite-memory-provider.js` | Byte-identical |
| `src/api/server.js` | Intentionally different; Host retains additional Host-owned lifecycle/root-inventory routes and composition |

The complete route blocks for `POST /v1/host-context/resolve` and `POST /v1/host/memory-npc/retrieve` were separately extracted from both current `src/api/server.js` files and compared byte-for-byte; both blocks are identical. Do not replace either complete `server.js` file with the other branch's version.

The current Core Actor resolver confirms the documented outcomes: zero active bindings → `403 ACTOR_NOT_AUTHORIZED`; multiple active bindings → `403 ACTOR_BINDING_AMBIGUOUS`; missing/destroyed bound Actor → `409 ACTOR_ENTITY_NOT_ELIGIBLE`. The current World resolver returns `403 HOST_CONVERSATION_NOT_AUTHORIZED` for absent/revoked bindings and `409 HOST_CONVERSATION_WORLD_UNAVAILABLE` if the bound World is unavailable. The error table above now includes the additional route-level outcomes observed in the current API implementation.

### Acceptance disposition

- Wire schemas, identity projection, Core binding ownership, consumer-facade boundary, result wrapper, and error mapping are aligned between the current Host and combined Core (#846 + #867) candidates.
- Both required private route blocks are byte-identical; all nine shared application/test files listed above are byte-identical.
- Exact-head CI is green for Host, Core foundation, and Core HTTP. The contract document's Runtime workflow is triggered on each documentation update and is tracked separately from the Host/Core code compatibility result.
- Coordinated Host and Core technical-owner ACKs are recorded in #850 and #846. They are not independent maintainer reviews.
- Independent GitHub PR Reviews are still outstanding. Branch refresh/rebase and merge simulation are still outstanding. No merge has been performed.
- The Memory Provider remains deployment-configured and fail-closed when unavailable or unauthorized. This contract does not enable production Memory → NPC traffic, claim linearizable revoke through Final-Send, modify Security Gateway, or include Final-Send.

**Current decision: CONTRACT TECHNICALLY ALIGNED; ACCEPTANCE PENDING INDEPENDENT HOST/CORE REVIEWS AND CONTROLLED BRANCH INTEGRATION.**