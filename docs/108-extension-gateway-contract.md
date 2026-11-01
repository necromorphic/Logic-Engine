# Extension Gateway contract — implementation slice

**Status:** Gateway core and isolated ingress tests implemented in Logic-Engine; SillyTavern startup mount, authenticated Host Adapter binding, and end-to-end ST runtime integration remain pending. Protected operations remain disabled / fail-closed.

## Approved topology

`SillyTavern Client Extension (untrusted) → Extension Gateway → Authenticated Host Adapter → Core → Core Security Gateway`

The Gateway is a same-process route handler. It does not create a listener, API port, Provider relay, or Core/Provider client. The only registered route is:

- `POST /api/logic-engine/extension`

The managed ST startup integration must exclude this exact path from the global JSON body parser, then mount the route after ST's authenticated-session middleware and before native private/generation routers. The Gateway consumes the untouched request stream itself, with a hard maximum of 256 KiB. The official ST source remains read-only; any local integration patch belongs to the Logic-Engine Patch Manager package and must be pinned to the exact ST commit.

## Envelope v1

Exact top-level keys only:

```json
{
  "schema_version": 1,
  "request_id": "opaque-request-id",
  "operation": "conversation.read",
  "payload": {}
}
```

- `schema_version`: exactly integer 1.
- `request_id`: 1–128 ASCII characters from `A-Z a-z 0-9 . _ : -`.
- `operation`: 1–64 lowercase identifier characters; operation semantics and authorization belong to Host Adapter/Core, not Gateway.
- `payload`: JSON object; maximum 10,000 nodes, nesting depth 32, individual string length 64 KiB.
- Maximum raw body: 256 KiB; only `application/json` accepted.
- Caller-supplied World, Actor, Installation, Account, Session, or Conversation identity keys are rejected recursively. Gateway does not infer identity from payload, headers, or browser state.

Gateway forwards the original server request object to Host Adapter so it can inspect SillyTavern-owned session/account state. Gateway itself does not authenticate or trust that state.

## Gateway → Host Adapter contract

`handleExtensionRequest({ envelope, hostRequest, receivedAt })`

Host Adapter must:
1. Authenticate the actual ST session using server-owned state on `hostRequest`.
2. Derive installation/account identity from that authenticated state.
3. Resolve the active conversation and trusted World/Actor bindings independently of extension claims.
4. Revalidate session and bindings on every request, including duplicate/replayed request IDs.
5. Call Core through its approved boundary; Core Security Gateway remains the sole authorization authority.
6. Return `{ status: 200..599, body }`; unavailable/invalid adapter results are converted by Gateway to HTTP 503.

Gateway does not authorize operation names, select a World/Actor, access Provider/Memory/NPC/Mechanics, or perform generation dispatch. Unknown operation semantics are Host Adapter/Core responsibility; unknown HTTP path/method is rejected by Gateway.

## Lifecycle and failure contract

| Condition | Gateway behavior |
|---|---|
| Unknown path or method | 404; no Host Adapter call |
| Non-JSON content type | 415; no Host Adapter call |
| Malformed/extra-field/oversized envelope | 400/413; no Host Adapter call |
| Forged identity fields | 400; no Host Adapter call |
| Host Adapter throws, unavailable, or returns malformed result | 503; no fallback route |
| Gateway draining/closed | 503; new requests rejected |
| Duplicate mount on same ST app | startup error; no second route |

The mounted lifecycle handle exposes `close({ drain })`. ST shutdown integration must invoke it and await draining before tearing down Host Adapter dependencies.

## Client Extension transport

The packaged Client Extension registers through the SillyTavern Extension manifest and sends requests only to the same-origin `/api/logic-engine/extension` route. It uses SillyTavern's request headers (including its CSRF token), same-origin credentials, no-store caching, and redirect rejection. The browser component is untrusted and carries no Core credentials or authoritative identity fields. Its source-level inventory test requires exactly one `fetch()` call and rejects direct Core/Provider URL configuration.

## Current test evidence

The isolated tests cover positive ingress, exact single-route registration, duplicate mount refusal, unknown path/method, malformed and forged identity envelopes, declared and chunked body-size limits, content type, Host Adapter outage, graceful drain/closed behavior, repeated request forwarding, and the Client Extension's single same-origin transport.

These tests prove the Gateway module's local contract only. They do not yet prove:
- the route is mounted in the target ST 1.19.0 process;
- no other ST-facing route can reach Host Adapter/Core;
- the Host Adapter implements the required session/account/conversation binding;
- integration tests cross Extension → Gateway → Host Adapter → Core;
- route inventory is complete for the installed ST build.

Until those items pass, the Gateway block is **PARTIAL / NOT PRODUCTION READY** and protected operations remain **DENY / FAIL-CLOSED**.
