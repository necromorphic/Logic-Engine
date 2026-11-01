# Extension Gateway — SillyTavern 1.19.0 compatibility gate

**Status:** BLOCKED — deployment mechanism decision required before runtime implementation.  
**Target:** SillyTavern 1.19.0 (the supplied release archive).  
**Branch:** `feature/extension-gateway`, based on current `main` at `c31a5df7f00bf57d2bf629232b6eea6056f26652`.

## 1. Decision

The approved logical architecture is sound as a separation of responsibilities:

`Logic-Engine Extension (untrusted) → Extension Gateway → Authenticated Host Adapter → Core → Core Security Gateway`

However, the deployment constraint **“connect exclusively through Logic-Engine Extension / SillyTavern Extension Manager”** conflicts with the requirement that the Gateway be a server-side, sole ingress route.

SillyTavern 1.19.0 exposes two different installation/loading mechanisms:

1. **Third-party client extensions** are installed by the Extensions UI into `public/scripts/extensions/third-party/<extension>`. Their manifest loads browser JavaScript/CSS. They can use the host's existing same-origin routes, but cannot register a new Express route on the ST server.
2. **Server plugins** are loaded by the server plugin loader from the separate `plugins/` directory (when server plugins are enabled). A plugin supplies a server entrypoint through its package metadata and receives a dedicated Express Router mounted under `/api/plugins/<plugin-id>`.

The Extension Manager does not install or activate a server plugin from the client extension package. A client extension cannot create a trusted server-side ingress route by itself.

## 2. Why the Gateway cannot be implemented solely as a client extension

- The browser extension is untrusted and cannot host the trusted server-side Gateway/Host Adapter boundary.
- A browser-to-Core route is expressly forbidden by the approved architecture.
- A separate Core/API listener exposed to the browser would be a forbidden alternative ingress and is not an acceptable substitute.
- Replacing or wrapping private ST Express internals would be an unsupported host modification and is prohibited.
- SillyTavern 1.19.0's supported client extension manifest does not expose server route registration.
- The supported server-plugin mechanism does expose a server route, but it requires a separate server-side installation/activation step.

Therefore no implementation can honestly satisfy all of these simultaneously with the stock 1.19.0 interfaces:
- install everything exclusively through Extensions → Install extension;
- leave SillyTavern upstream/source untouched;
- provide a server-side sole ingress route;
- route only through the Authenticated Host Adapter;
- have no direct browser → Core route and no alternate connector.

This is a deployment capability gap, not a reason to weaken Gateway validation or move authentication/authorization into the Gateway.

## 3. Existing prototype disposition

The existing `host-adapter/prototype/st-server-digest-proxy.mjs` is **not** an Extension Gateway implementation:
- it performs Host session-scope checks;
- it holds/configures Core and adapter credentials;
- it forwards directly to Core.

Those are responsibilities that must be reconsidered under the approved separation. It must not be relabelled as the Gateway or exposed as an alternative ingress. Any future refactor must move session authentication and installation/account/conversation identity resolution into the Authenticated Host Adapter, while the Gateway performs only envelope validation, routing, lifecycle diagnostics, and fail-closed error handling.

The existing review-only lifecycle prototype and its routes do not establish that a production Extension Gateway is installed or that all requests pass through one Gateway.

## 4. Smallest deployment option that preserves the logical architecture

**Option A — one Logic-Engine product, two ST installation artifacts (recommended for consideration):**

- Client artifact: installed through Extensions → Install extension; untrusted UI/client.
- Server companion artifact: the same Logic-Engine release, installed by the ST administrator as a server plugin under `plugins/logic-engine`; contains the Extension Gateway and routes to the Authenticated Host Adapter in-process.
- The Gateway exposes exactly one ST-facing route, for example `POST /api/plugins/logic-engine/gateway`.
- All supported extension operations use a versioned envelope on that route. Lifecycle hello/heartbeat/close are envelope operations, not additional HTTP routes.
- Gateway does not authenticate sessions, select world/actor, authorize operations, call Core, call Provider, or implement final-send.
- Gateway forwards the validated envelope plus the original server request context to the Authenticated Host Adapter. The Host Adapter independently authenticates and binds identity. Core Security Gateway remains the authorization authority.
- No extra API port, Provider Base URL replacement, browser → Core path, or second backend connector is introduced.

This preserves the **logical** single-integration architecture and the trust boundaries, but it does **not** satisfy a literal requirement that the server component itself be installed solely through the client Extension Manager. It requires an administrator-side server-plugin installation step.

**Option B — upstream SillyTavern capability:** request an official mechanism for a client extension package to declare/install/activate its paired server plugin. This would require upstream SillyTavern support and conflicts with the current “upstream unchanged” constraint until such support exists.

No option is implemented by this document. Option A requires explicit approval because it changes the deployment interpretation of “exclusively through Logic-Engine Extension”.

## 5. Gateway implementation contract after deployment approval

If Option A is approved, implementation will use a single route and a fixed operation allowlist. Initial candidate operations are limited to existing Host Adapter capabilities:
- `extension.lifecycle.hello`
- `extension.lifecycle.heartbeat`
- `extension.lifecycle.close`
- `host.session.read`
- `host.inventory.read`
- `host.version.capture`
- `host.inventory.reconcile`

The operation list is not permission. It is only a routing allowlist. Every Host operation must be re-authenticated and validated by the Authenticated Host Adapter; every protected read/write remains subject to Core Security Gateway.

Envelope validation will require:
- exact protocol version;
- request ID in canonical UUID form;
- known operation;
- plain-object payload;
- strict maximum body size;
- rejection of unknown top-level fields, malformed JSON, unsupported content type, and invalid operation;
- no caller-provided credentials or authority fields accepted by the Gateway;
- no Gateway-generated world/actor identity;
- no body or secret logging.

Failure behavior:
- unknown operation/route: DENY;
- malformed envelope/content type: DENY;
- oversized body: DENY;
- Host Adapter unavailable: FAIL-CLOSED, no fallback;
- repeated request: forward through the same Host Adapter authentication path; request ID is correlation/idempotency metadata only and never an authorization grant;
- Gateway error: sanitized error response and diagnostic event without payload/secrets;
- no alternate route to Core or Provider.

## 6. Required evidence before calling the block complete

- exact list of all ST-facing routes registered by the plugin: exactly one Gateway route;
- tests proving unknown paths/methods and unknown operations do not reach Host Adapter;
- tests proving malformed/oversized envelopes do not reach Host Adapter;
- tests proving every business operation is dispatched only to the Authenticated Host Adapter;
- tests proving Gateway does not create or trust World/Actor identity and does not authorize;
- tests proving Host Adapter outage has no fallback;
- lifecycle tests for hello/heartbeat/close and repeated requests;
- integration test against the SillyTavern 1.19.0 server-plugin loader;
- evidence that the client Extension Manager artifact calls only the Gateway route;
- evidence that no browser → Core, alternate connector, Provider relay, or second ST-facing route exists.

A mocked router test alone is not proof of compatibility with the real ST plugin loader. A source-inspected plugin contract is not a live ST installation test.

## 7. Required owner decision

Approve or reject **Option A**: one Logic-Engine release consisting of a client extension installed through Extension Manager plus a companion ST server plugin installed by the ST administrator. If rejected, the block remains blocked until upstream SillyTavern provides a supported server-side route registration mechanism compatible with the stated constraints.
