# Logic Engine Host Adapter — SillyTavern Server Plugin

**Status: review-only / NON_READY.** This plugin is the server half of the Extension Gateway. It is not a production Memory → NPC enablement.

Install the complete `host-adapter` directory as one SillyTavern server plugin directory, for example `SillyTavern/plugins/logic-engine-extension-gateway`. The package entry point is `server-plugin/index.mjs`; the sibling `prototype` modules are required at runtime. Enable SillyTavern server plugins in the normal server configuration.

The plugin loader mounts this router under `/api/plugins/logic-engine-extension-gateway` after SillyTavern's `requireLoginMiddleware`. This is the only public Host ingress. The pinned SillyTavern lifecycle patch is required for native mutation interception; it adds internal guards to ST routes but does not create a second public Host API. Browser lifecycle, inventory and context calls use only `/api/plugins/logic-engine-extension-gateway/*`. No `/api/logic-engine/*` route is permitted.

Required server environment:

- `LOGIC_ENGINE_CORE_URL`: Core API base URL. HTTPS is required except loopback HTTP.
- `LOGIC_ENGINE_API_TOKEN`: Core API bearer token.
- `LOGIC_ENGINE_ADAPTER_ID` and `LOGIC_ENGINE_ADAPTER_TOKEN`: configured Core adapter identity.
- `LOGIC_ENGINE_HOST_ACTOR_ENTITY_ID`: deployment-owned actor entity binding; never accepted from browser input.
- `LOGIC_ENGINE_HOST_IDENTITY_DIR`: absolute protected server-side directory for installation/account identity.

The `GET /session` route creates/returns the signed ST-session identity. `GET /identity` resolves server-persisted installation/account identity. `GET /inventory` enumerates the pinned ST data roots and persists a root-inventory baseline/observation through the Gateway to Core. `POST /context` accepts only `conversation_uuid`; it requires an independently verified authoritative completeness proof before deriving the exact PC-NEXT-11 `host_session_id:installation_id:conversation_uuid` conversation ID. The authenticated account identity is resolved separately. Core then resolves the conversation→world binding and the unique configured actor binding in that world. The current scanner still reports `DOUBLE_SCAN_CANDIDATE` and Core root inventory is review-only, so the production route deliberately returns `NON_READY` before any Core context request. World, actor, adapter, installation, account and session values are not accepted from the browser.

The `POST /host-version-ledger/capture`, `POST /host-version-ledger/reconcile`, `POST /host-lifecycle/events`, and `GET /host-lifecycle/status` routes are also mounted under this same Gateway. The native ST endpoint guards import the plugin's server-side guard module in-process; those internal guards do not expose a route and require permits issued through the Gateway.

The Core URL and credentials are read only from server environment. Redirects are rejected. The Core API bearer and adapter credentials never leave the server process. After Core resolves the canonical World/Actor binding, the server plugin signs a short-lived HMAC assertion with the server-only adapter token and sends it to `POST /v1/host-sessions/verify`. Core verifies the exact assertion, enters the shared `runWithAuthenticatedHostSession()` capability boundary, and consumes the nonce in its durable SQLite replay table. Reusing an assertion remains rejected after a Core API restart. The browser receives only the resolved Host context; it never receives the signing key or assertion signature.

The Host request gate binds authorization to the exact Express request object and re-reads the middleware-populated user/session identity across asynchronous Core calls. Session rotation, logout, or account switching permanently invalidates that request capability.

This is a Host context/bootstrap transport only. It does not yet provide a Core NPC dispatch endpoint or prove the final provider send is linearized under the Memory Dispatch Gateway. Until that Core contract and real dispatch callsite exist, protected generation must remain fail-closed.


## Pinned SillyTavern lifecycle patch

Apply `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch` to the exact pinned SillyTavern commit before enabling the adapter. The patch adds write-ahead lifecycle hooks for supported message operations, requires a Gateway-issued permit before native chat saves, and fails closed on unsupported bulk mutations (chat/group/character create/edit/delete, imports, backup deletion, and restore through guarded save/import paths). Export is read-only and must pass the reconciliation guard. The patch changes no public route outside the Extension Gateway; all Core calls remain server-to-server from the Gateway plugin.

The patch is reviewed and applied in CI against the pinned source. It is not automatically applied to an already-running SillyTavern installation. Until authoritative full-root inventory/reconciliation and real restart/replay evidence are available, Host context remains `NON_READY` and protected generation remains disabled.
