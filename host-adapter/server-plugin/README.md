# Logic Engine Host Adapter — SillyTavern Server Plugin

**Status: review-only / NON_READY.** This plugin is the server half of the Extension Gateway. It is not a production Memory → NPC enablement.

Install the complete `host-adapter` directory as one SillyTavern server plugin directory, for example `SillyTavern/plugins/logic-engine-extension-gateway`. The package entry point is `server-plugin/index.mjs`; the sibling `prototype` modules are required at runtime. Enable SillyTavern server plugins in the normal server configuration.

The plugin loader mounts this router under `/api/plugins/logic-engine-extension-gateway` after SillyTavern's `requireLoginMiddleware`. The browser Extension Gateway calls only this plugin route. No patch to SillyTavern source files and no `/api/logic-engine/*` route are required.

Required server environment:

- `LOGIC_ENGINE_CORE_URL`: Core API base URL. HTTPS is required except loopback HTTP.
- `LOGIC_ENGINE_API_TOKEN`: Core API bearer token.
- `LOGIC_ENGINE_ADAPTER_ID` and `LOGIC_ENGINE_ADAPTER_TOKEN`: configured Core adapter identity.
- `LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID`: deployment-owned actor entity binding; never accepted from browser input.
- `LOGIC_ENGINE_HOST_IDENTITY_DIR`: absolute protected server-side directory for installation/account identity.

The `GET /session` route creates/returns the signed ST-session identity. `GET /identity` resolves server-persisted installation/account identity. `POST /context` accepts only `conversation_uuid`; it verifies that UUID against a complete server-side inventory, derives the exact `host_session_id:installation_id:conversation_uuid` conversation ID from the signed session and server-persisted installation identity, resolves the opaque account identity separately, resolves the conversation→world binding in Core, then resolves the unique configured actor binding in that world. World, actor, adapter, installation, account and session values are not accepted from the browser.

The Core URL and credentials are read only from server environment. Redirects are rejected. The Core API bearer and adapter credentials never leave the server process. After Core resolves the canonical World/Actor binding, the server plugin signs a short-lived HMAC assertion with the server-only adapter token and sends it to `POST /v1/host-sessions/verify`. Core verifies the exact assertion, enters the shared `runWithAuthenticatedHostSession()` capability boundary, and consumes the nonce in its durable SQLite replay table. Reusing an assertion remains rejected after a Core API restart. The browser receives only the resolved Host context; it never receives the signing key or assertion signature.

The Host request gate binds authorization to the exact Express request object and re-reads the middleware-populated user/session identity across asynchronous Core calls. Session rotation, logout, or account switching permanently invalidates that request capability.

This is a Host context/bootstrap transport only. It does not yet provide a Core NPC dispatch endpoint or prove the final provider send is linearized under the Memory Dispatch Gateway. Until that Core contract and real dispatch callsite exist, protected generation must remain fail-closed.
