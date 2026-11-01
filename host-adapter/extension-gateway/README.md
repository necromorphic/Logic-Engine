# SillyTavern Extension Gateway

**Status: review-only candidate. Protected Memory → NPC dispatch remains NON_READY / FAIL-CLOSED until the Core endpoint and durable assertion replay protection pass exact-head integration tests.**

## Single integration boundary

The browser extension uses SillyTavern's native `generate_interceptor` to stop native generation for an explicitly armed protected request. It then sends only a bounded request envelope to the single authenticated server-plugin namespace:

`/api/plugins/logic-engine-extension-gateway/*`

The server plugin is loaded by SillyTavern after `requireLoginMiddleware`. It owns the only public Host ingress and performs bounded envelope routing only. It delegates to an internal Authenticated Host Adapter; that component verifies the ST session, resolves installation/account/session/conversation from server-controlled identity and inventory, and calls Core using server-held credentials plus a short-lived signed Host assertion. The Gateway does not authenticate sessions, assign World/Actor, authorize, access Memory/NPC/Mechanics, handle AI sending, or implement the Final-Send Hook. Adapter helpers do not register separate Express routes.

No `/api/logic-engine/*` route is mounted. No SillyTavern source file is patched or overwritten.

## Installation layout

Install the browser extension directory under:

`public/scripts/extensions/third-party/logic-engine-extension-gateway/`

Install the contents of `server-plugin/` under:

`plugins/logic-engine-extension-gateway/`

Enable SillyTavern's native `enableServerPlugins: true` setting. Keep server-plugin auto-update disabled unless the plugin source is pinned and reviewed. The plugin routes remain behind ST's login middleware and CSRF protection.

## Identity contract

- Installation and account IDs are generated and persisted by the server-side `HostIdentityStore`.
- The Host session UUID is generated in SillyTavern's signed session and rotates when the authenticated account changes. Core validates this session separately from the stable conversation tuple.
- Stable conversation identity is `installation_id:account_id:conversation_uuid`; session identity is carried separately in the signed assertion.
- The browser's localStorage and chat metadata are consistency/enrollment inputs, not authentication authorities.
- The Authenticated Host Adapter resolves the conversation UUID against server-side inventory before signing any assertion.
- The Gateway does not assign World or Actor. World and Actor are never accepted from the browser; Core resolves them from its own durable bindings.
- Core Security Gateway remains the sole authorization authority.

## Dispatch boundary

The browser sends only `request_id`, `conversation_uuid`, `context_size`, and `generation_type`. It does not send chat text, world ID, actor ID, Core URL, or credentials.

The server Gateway signs the exact installation/account/session/conversation tuple with the configured adapter secret and sends it to Core at `/v1/host/memory-npc/retrieve`. If Core's matching authenticated endpoint is unavailable, the Gateway returns NON_READY and never falls through to native SillyTavern generation.

The endpoint is deliberately fail-closed until Core-side assertion verification, durable replay prevention, Provider retrieval and final response revalidation are integrated and tested on the same HEAD.

## Pinned-source evidence

Target SillyTavern commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

The integration uses the native server-plugin loader and extension generation interceptor. CI must verify that the plugin mounts after `requireLoginMiddleware`, that `generate_interceptor` is invoked before provider dispatch, and that installing both artifacts leaves all pinned SillyTavern source files unchanged.
