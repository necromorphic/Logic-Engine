# Extension Gateway contract — implementation slice

**Status:** Gateway core/client transport and a pinned ST 1.19.0 startup patch are implemented. Isolated contract tests pass; CI now applies the patch to a disposable official 1.19.0 checkout and verifies rollback. Production Host Adapter implementation/registration and Extension → Gateway → Host Adapter → Core end-to-end execution remain pending. Protected operations remain disabled / fail-closed.

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

Gateway does not authorize operation names, select a World/Actor, access Provider/Memory/NPC/Mechanics, or perform generation dispatch. Unknown operation semantics are Host Adapter/Core responsibility; unknown HTTP path/method is rejected by Gateway. Repeated request IDs are forwarded to Host Adapter again; Host Adapter/Core must reauthenticate every attempt and apply operation-specific idempotency/replay policy. Gateway does not cache an earlier authorization decision.

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

The mounted lifecycle handle exposes `close({ drain })`. ST shutdown integration must invoke it and await draining before tearing down Host Adapter dependencies. A synchronous metadata-only `onDiagnostic` sink receives ingress accepted/rejected and Host Adapter result/error events. If the sink fails before dispatch, Gateway returns 503 and does not call Host Adapter. Production wiring must provide a durable audit sink; raw payloads and credentials are never included.

## Client Extension transport

The packaged Client Extension registers through the SillyTavern Extension manifest and sends requests only to the same-origin `/api/logic-engine/extension` route. It uses SillyTavern's request headers (including its CSRF token), same-origin credentials, no-store caching, and redirect rejection. The browser component is untrusted and carries no Core credentials or authoritative identity fields. Its source-level inventory test requires exactly one `fetch()` call and rejects direct Core/Provider URL configuration.

## Current test evidence

The tests cover positive ingress, exact single-route registration, duplicate mount refusal, unknown path/method, malformed and forged identity envelopes, declared and chunked body-size limits, content type, Host Adapter outage, graceful drain/closed behavior, singleton Host Adapter registration, refusal to unregister while requests are in flight, repeated request forwarding, metadata-only diagnostics and audit-sink fail-closed behavior, and the Client Extension's single same-origin transport. A separate acceptance test clones the official `1.19.0` tag into a disposable directory, runs the actual Patch Manager install, verifies body-parser bypass/authenticated route placement/shutdown drain/one route/five exact changed files, then rolls the patch back and verifies a clean worktree.

These tests prove the Gateway module's local contract only. They do not yet prove:
- the route is mounted in the target ST 1.19.0 process;
- no other ST-facing route can reach Host Adapter/Core;
- the Host Adapter implements the required session/account/conversation binding;
- integration tests cross Extension → Gateway → Host Adapter → Core;
- route inventory is complete for the installed ST build.

Until those items pass, the Gateway block is **PARTIAL / NOT PRODUCTION READY** and protected operations remain **DENY / FAIL-CLOSED**.

## Route and operation matrix

| Request class | Gateway decision | Host Adapter called | Authorization owner |
|---|---|---:|---|
| POST /api/logic-engine/extension with valid v1 JSON envelope | Accept and route once | Yes | Core Security Gateway, via Host Adapter |
| Same route with malformed/extra top-level fields, forged identity keys, invalid JSON, or invalid schema | 400 DENY | No | Not reached |
| Same route with non-JSON content type | 415 DENY | No | Not reached |
| Same route above configured 256 KiB maximum, including chunked bodies | 413 DENY | No | Not reached |
| Unknown path or wrong method | 404 DENY | No | Not reached |
| Valid envelope with unknown/unsupported operation name | Route as untrusted intent; no semantic approval | Yes | Host Adapter/Core must DENY |
| Repeated request ID | Route each attempt independently | Yes | Host Adapter/Core reauthenticate and apply replay/idempotency policy |
| Host Adapter missing, throws, or returns malformed result | 503 FAIL-CLOSED | Attempted at most once | No fallback |
| Gateway draining/closed or diagnostic sink unavailable | 503 FAIL-CLOSED | No new dispatch | Not reached |
| Direct browser/ST to Core, direct Provider, Memory Provider, NPC, Mechanics, or alternate connector | No route/transport exists | No | Unsupported |

The Gateway's syntactic operation grammar is not an allow-list and is not an authorization decision. The Host Adapter must map only explicitly supported operations and pass every protected action through Core Security Gateway. An operation string supplied by the extension never grants capability.

## Route inventory ownership

The route inventory is generated from the exact managed patch package and pinned ST source. It contains one registration: POST /api/logic-engine/extension. The CI acceptance test checks that:
- the installed server module contains one app.post(EXTENSION_GATEWAY_PATH, ...) registration;
- the route is registered inside setupPrivateEndpoints, after requireLoginMiddleware has been installed and before native private routers;
- the exact route is excluded from global body parsing so the Gateway can enforce its own raw-byte cap;
- shutdown awaits Gateway drain before other server cleanup;
- only the exact five manifest-declared paths are changed, and rollback restores a clean checkout.

This proves the source-level route topology for the pinned tag. It is not a claim that arbitrary ST extensions cannot create their own unrelated HTTP endpoints; it proves only that Logic-Engine exposes one Gateway ingress and does not register an alternate Logic-Engine route.

## SillyTavern Extension Manager discovery

The pinned ST 1.19.0 source defines PUBLIC_DIRECTORIES.globalExtensions as public/scripts/extensions/third-party. Its /api/extensions/discover handler enumerates immediate subdirectories there and includes folders with manifest.json as third-party/<folder>. The managed package installs the Client Extension at exactly that location with its manifest, so the native Extension Manager discovery flow can find it; no direct Core route, custom extension registry, or manual settings mutation is introduced.

Patch Manager post-apply verification accounts for this directory being Git-ignored by ST. It accepts only exact manifest-declared paths that were absent before installation and now exist as regular files; it does not broadly trust ignored files or widen the transaction journal. Rollback removes those exact new files and returns the disposable worktree to clean state.
