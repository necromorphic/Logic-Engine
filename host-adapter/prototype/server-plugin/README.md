# Logic-Engine Extension Gateway — SillyTavern server plugin

**Status: integration candidate / NON_READY.** Target SillyTavern is pinned to `1.19.0` at commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Install

Copy the complete contents of this directory to:

`SillyTavern/plugins/logic-engine-extension-gateway/`

The package must remain self-contained. Do not copy individual files or import runtime modules from outside the plugin directory. Enable `enableServerPlugins: true` in SillyTavern's server configuration and restart SillyTavern. If server plugins are disabled, this Gateway is unavailable and Host transport must remain NON_READY.

The pinned SillyTavern loader mounts this plugin at:

`/api/plugins/logic-engine-extension-gateway`

The loader mounts plugins after `requireLoginMiddleware` and the global CSRF/session middleware. Plugin handlers still perform explicit Host identity checks; the middleware order is not treated as a substitute for Host authorization.

## Routes

- `GET /session` — creates/reuses a server-generated Host session UUID inside the authenticated signed ST session.
- `GET /identity` — returns server-persisted opaque installation/account identities. Requires `LOGIC_ENGINE_HOST_IDENTITY_DIR` to point to a protected server-owned directory.
- `GET /inventory` — reads the pinned Host data-root inventory and remains non-authoritative.
- `POST /context` — deliberately returns `NON_READY` until the authenticated Host assertion handoff to Core is implemented and verified.

All routes are namespaced below the Extension Gateway. The plugin does not expose a separate `/api/logic-engine/*` route, does not accept a caller-selected Core URL, and contains no Core token or adapter secret. No browser-to-Core request path exists in this package.

## Bundled runtime

The scanner, filesystem inventory, VSS snapshot helper, Host inventory handler and identity store are copied into this directory so the plugin loader does not depend on source patches or relative imports outside its package.

After changing a canonical prototype module, update its bundled copy and keep both byte-identical. The test suite checks that the package is self-contained and that its declared entry point is `index.mjs`.

## Current limits

This package replaces the patched SillyTavern Host inventory/identity route with the supported server-plugin loader. It does **not** yet complete the signed Host assertion handoff, Core context verification, full lifecycle mutation receipts, or final-send. `POST /context` is intentionally closed. Do not enable Memory → NPC or claim READY.
