# Logic-Engine Extension Gateway — SillyTavern browser extension

**Status: transport UI candidate / NON_READY.** Target SillyTavern 1.19.0 is pinned to commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Install

Copy this directory to:

`SillyTavern/public/scripts/extensions/third-party/logic-engine/`

Copy `host-adapter/prototype/server-plugin/` to:

`SillyTavern/plugins/logic-engine-extension-gateway/`

Enable `enableServerPlugins: true` in SillyTavern server configuration and restart SillyTavern. The server plugin must be installed as a complete self-contained package. The browser extension cannot substitute for a missing server plugin.

## Transport

The browser extension makes only same-origin requests inside `/api/plugins/logic-engine-extension-gateway`:

- `GET /session` verifies the signed SillyTavern session.
- `POST /context` sends only the current chat's `conversation_uuid`. The server checks that UUID against the authenticated account's full inventory, signs a short-lived HMAC assertion with server-held credentials, and calls Core server-to-server. Core rechecks the current conversation → World → Actor bindings and durable nonce.

The browser does not accept or send a Core URL, Core credentials, adapter credentials, World ID, or Actor ID. There is no browser-to-Core call and no direct `/api/logic-engine/*` route.

The UI distinguishes signed ST session confirmation from Core context verification. A successful context check proves only that Core authenticated the Host assertion and current World/Actor bindings; it does not retrieve Memory or authorize final-send. Memory retrieval, final-send and Memory → NPC remain disabled.

## Security boundary

- The server plugin is mounted by the pinned SillyTavern plugin loader after authenticated session middleware.
- Default-user and accounts-enabled identity checks are covered by Host regression tests.
- Server-side installation/account identity is stored in the configured protected directory `LOGIC_ENGINE_HOST_IDENTITY_DIR`.
- The Gateway context endpoint remains closed until a signed Host assertion is validated by Core using trusted conversation → world → actor bindings.
- SillyTavern source patches are not part of installation or runtime transport.

## Tests

From the Logic-Engine repository root:

```sh
node --test host-adapter/sillytavern-extension/tests/*.test.mjs
node --test host-adapter/prototype/tests/*.test.mjs
```

Passing these tests does not establish full lifecycle receipt coverage, complete source inventory, production Core retrieval, or final-send readiness.
