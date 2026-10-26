# SillyTavern Logic-Engine Bridge extension (prototype)

This folder is the source for a third-party SillyTavern extension. It is intentionally a **diagnostic-only first slice**: it saves an Engine API base URL and checks `GET /health`. It does not send chat messages, submit proposals, commit events, read canonical state, or alter the existing vectorization patch.

## Target topology

- SillyTavern remains on Android/Termux.
- Logic-Engine runs on the PC.
- Existing VectorService / Ollama remote-store remains separate and unchanged on port `8787`.
- Configure Logic-Engine explicitly on a different port, for example `ENGINE_PORT=8789`, `ENGINE_HOST=192.168.0.84`, `ENGINE_ALLOW_REMOTE=true`. Remote binding is disabled unless the explicit opt-in is set.
- The old Google API proxy on port `8788` is not part of this extension. It can remain separate; it does not become the engine bridge by changing its purpose.

## Install for local development

Copy the contents of this folder into the pinned SillyTavern installation at:

`public/scripts/extensions/third-party/logic-engine/`

Keep `manifest.json`, `index.js`, `settings.html`, and `style.css` together. Restart/reload SillyTavern and open Extensions settings. The extension should show **Logic-Engine Bridge**.

Set the API URL to the PC address, e.g. `http://192.168.0.84:8789`, save it, then run **Check connection**.

## Important current limitation

The extension runs in the browser origin of SillyTavern on the phone. A browser request to the PC is cross-origin. The current engine API response does not yet implement a configurable CORS allowlist, so the health probe may be blocked by the browser even when the PC API is reachable from PowerShell. Do not disable browser security as a workaround. The next integration change must add a strict, explicit origin allowlist (including OPTIONS preflight handling) or introduce a dedicated authenticated PC-side bridge with an allowlist.

## Next implementation gate

Before wiring chat lifecycle or world mutations, verify the exact pinned SillyTavern build `1.19.0-1-g06bde939f` (commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`) and record evidence for the actual lifecycle hooks and stable message/generation identity. Follow `docs/13-sillytavern-adapter-contract.md`.

Do not invent event names or payloads, do not store admin/internal/approval secrets in browser settings, do not commit canonical state directly, and keep Memory → NPC production disabled/fail-closed until the existing inventory, lineage, authorization and revocation gates are proven.
