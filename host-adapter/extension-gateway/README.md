# Logic Engine Extension Gateway

**Status: integrated Host context transport / NON_READY. Protected Memory → NPC model dispatch remains disabled.**

The browser extension uses SillyTavern's manifest-declared `generate_interceptor` as the Final-Send interception point. A protected generation is aborted before SillyTavern's native provider send. The extension then obtains an authenticated Host context through the native SillyTavern server-plugin route:

`/api/plugins/logic-engine-extension-gateway/context`

The browser never calls Core and never receives Core credentials. The server plugin route is mounted by SillyTavern's existing plugin loader after `requireLoginMiddleware`; no SillyTavern source patch or `/api/logic-engine/*` route is used.

## Identity and authorization

The server plugin:
- accepts the request only inside SillyTavern's authenticated request pipeline;
- validates the middleware-populated user handle and signed cookie-session identity;
- resolves installation and account IDs from the server-owned persistent identity store;
- verifies the requested conversation UUID against a complete server-side inventory;
- constructs the stable conversation identity as `installation_id:account_id:conversation_uuid`;
- keeps the current signed `session_id` as a separate authenticated context field;
- asks Core to resolve conversation → world and the configured server-owned actor entity → actor binding;
- rejects caller-supplied world, actor, account, installation, adapter and session values.

Core API credentials and the adapter token are read only from the SillyTavern server environment. The server plugin is the only code in the ST process that calls Core.

## Install

Install the complete `host-adapter` directory as one SillyTavern server plugin directory named `logic-engine-extension-gateway`. Its `package.json` selects `server-plugin/index.mjs`; the sibling `prototype` modules are required at runtime. Enable server plugins in SillyTavern configuration.

Install this extension directory using SillyTavern's normal third-party extension mechanism. The manifest declares the generation interceptor; no patch to SillyTavern source files is required.

Required server environment:
- `LOGIC_ENGINE_CORE_URL` — Core API URL; HTTPS except loopback HTTP.
- `LOGIC_ENGINE_API_TOKEN` — Core bearer credential.
- `LOGIC_ENGINE_ADAPTER_ID` and `LOGIC_ENGINE_ADAPTER_TOKEN` — configured adapter identity.
- `LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID` — server-owned actor entity ID.
- `LOGIC_ENGINE_HOST_IDENTITY_DIR` — absolute protected identity-store directory.

## Remaining fail-closed boundary

This transport resolves authenticated Host context and Core bindings. It does **not** yet invoke an approved Core NPC decision/context builder or the Core Memory Dispatch Gateway's transport-start primitive. The callback accepted by `armAuthenticatedHostRequest` is only an integration seam and is not authorization.

Therefore the protected interceptor must not be armed for production Memory → NPC until the Core exposes the approved private dispatch boundary and the actual outbound provider send is proven to start under the dispatch lease. A missing callback, failed context resolution or failed dispatch aborts native generation; there is no provider fallback.
