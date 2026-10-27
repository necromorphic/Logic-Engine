# Logic-Engine Bridge — SillyTavern extension

**Status: development vertical slice; not production-ready.** Target SillyTavern source is pinned to `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (1.19.0-1-g06bde939f).

## Implemented

- Adds a SillyTavern extension settings panel using the pinned ST extension loader contract.
- Checks Logic-Engine `GET /health` with a 2.5-second timeout, no cookies, no redirects and no cached response.
- Offers explicit user actions for chat enrollment and digest sync only when a compatible Host lifecycle bridge exists.
- Does not subscribe to model-generation events, read message text, send prompts, or call any model provider.
- Does not store Core credentials in browser code.
- Keeps Memory → NPC disabled/fail-closed; a healthy `/health` response is not a readiness signal.
- Uses SillyTavern's supported extension `activate`/`disable` hooks; disable removes the UI, unregisters click handlers, and aborts pending health checks without disabling Host-side safety guards.

## Installation

1. Back up SillyTavern.
2. Copy this directory to `SillyTavern/public/scripts/extensions/third-party/logic-engine/`.
3. Restart/reload SillyTavern and enable **Logic-Engine Bridge** in the Extensions panel.
4. Set `ENGINE_HEALTH_ALLOWED_ORIGINS` on the Logic-Engine process to the exact browser origin of SillyTavern, for example `http://127.0.0.1:8000`, then restart Logic-Engine. Do not use `*`.
5. Enter the local engine base URL and click **Проверить связь**.
6. Chat enrollment and digest sync remain disabled unless the separately reviewed Host lifecycle bridge is installed.

### Optional pinned Host bridge patch

The Host bridge is separate from the browser extension because SillyTavern's browser code must not receive Core or adapter credentials. The patch modifies SillyTavern's host lifecycle and adds a same-origin server-side proxy. It is not production-ready and must not be applied to a different ST revision.

From the Logic-Engine repository root, generate the provider-neutral patch:

```sh
node host-adapter/sillytavern-extension/prepare-pinned-st-patch.mjs
```

This generates `host-adapter/sillytavern-extension/patches/sillytavern-1.19.0-logic-engine-bridge.patch`. The generator explicitly removes the model-provider logging hunk from the older candidate patch and adds the server-side proxy implementation. In the exact pinned SillyTavern checkout, run `git apply --check <patch-path>` and inspect the diff for review only. **Do not apply this patch to any SillyTavern installation until the exact diff receives the required second explicit Core approval under issue #264.** Passing `git apply --check` proves patch applicability, not trust or production readiness.

Configure the SillyTavern server process with `LOGIC_ENGINE_CORE_URL`, `LOGIC_ENGINE_API_TOKEN`, `LOGIC_ENGINE_ADAPTER_ID`, and `LOGIC_ENGINE_ADAPTER_TOKEN`. Configure the matching adapter secret in Logic-Engine. Do not expose the engine port publicly.

## Security and limitations

- No Google API or model-provider route is used or modified by this extension or generated patch.
- The browser extension never receives Core or adapter credentials.
- Host journal data is identifiers, lineage and SHA-256 digests, not raw message text.
- Existing Host lifecycle coverage is incomplete: import/restore/branch and several deletion/migration paths are unsupported; pre-enrollment history is unknown.
- The current Core inventory verifier is deny-only, so digest capture cannot make reconciliation READY.
- This is not a semantic Memory record store and does not send Memory to NPC or into a model prompt.
- Browser/device persistence and full lifecycle acceptance on Android/Termux have not been demonstrated.

## Tests

From the Logic-Engine repository root:

```sh
node --test host-adapter/sillytavern-extension/tests/*.test.mjs
node --test host-adapter/prototype/tests/*.test.mjs
npm test
```

The Runtime workflow also runs the extension and Host prototype tests and checks that the generated patch applies to the exact pinned SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

Passing automated tests do not prove real browser persistence, full Host inventory, authorization readiness, or production Memory → NPC disclosure.
