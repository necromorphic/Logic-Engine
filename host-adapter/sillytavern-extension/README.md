# Logic-Engine Bridge — SillyTavern extension

**Status: development vertical slice; not production-ready.** Target SillyTavern source is pinned to `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (1.19.0-1-g06bde939f).

## Implemented

- Adds a SillyTavern extension settings panel using the pinned ST extension loader contract.
- Checks Logic-Engine `GET /health` with a 2.5-second timeout, no cookies, no redirects and no cached response.
- Offers explicit user actions for chat enrollment and digest sync only when a compatible Host lifecycle bridge exists.
- Does not subscribe to model-generation events, read message text, send prompts, or call any model provider.
- Does not store Core credentials in browser code.
- Keeps Memory → NPC disabled/fail-closed; a healthy `/health` response is not a readiness signal.

## Installation

1. Back up SillyTavern.
2. Copy this directory to `SillyTavern/public/scripts/extensions/third-party/logic-engine/`.
3. Restart/reload SillyTavern and enable **Logic-Engine Bridge** in the Extensions panel.
4. Enter the local engine base URL and click **Проверить связь**.
5. Chat enrollment and digest sync remain disabled unless the separately reviewed Host lifecycle bridge is installed.

The current pinned Host bridge candidate is documented under `host-adapter/prototype/`. It is a review-only source patch, not a production-ready integration. Do not apply it to another SillyTavern revision without rebasing and re-auditing.

## Security and limitations

- No Google API or model-provider route is used or modified.
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

Passing automated tests do not prove real browser persistence, full Host inventory, authorization readiness, or production Memory → NPC disclosure.
