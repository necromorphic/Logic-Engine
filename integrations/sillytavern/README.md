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

## Configure browser access (strict CORS)

The API now supports an explicit `ENGINE_ALLOWED_ORIGINS` allowlist and handles CORS preflight requests. Leave the setting empty unless browser access is required. Never use `*`.

Set `ENGINE_ALLOWED_ORIGINS` to the exact origin shown in the browser address bar when SillyTavern is open on the phone. An origin is scheme + host + port only, with no path or trailing slash. For example, if ST is opened as `http://127.0.0.1:8000`, configure exactly that value. The browser sends this origin even though the API host is the PC.

Example PowerShell session environment for the Engine API (adapt the ST origin to the actual address used on the phone):

```powershell
$env:ENGINE_PORT='8789'
$env:ENGINE_HOST='192.168.0.84'
$env:ENGINE_ALLOW_REMOTE='true'
$env:ENGINE_ALLOWED_ORIGINS='http://127.0.0.1:8000'
npm start
```

Use a PC firewall rule restricted to the intended private network. Do not bind publicly, disable browser security, or put `ENGINE_API_TOKEN`, adapter secrets, admin/internal/approval tokens in the extension settings. The CORS allowlist is not authentication; API credentials and route-level authorization remain required for protected endpoints.


## Next implementation gate

Before wiring chat lifecycle or world mutations, verify the exact pinned SillyTavern build `1.19.0-1-g06bde939f` (commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`) and record evidence for the actual lifecycle hooks and stable message/generation identity. Follow `docs/13-sillytavern-adapter-contract.md`.

Do not invent event names or payloads, do not store admin/internal/approval secrets in browser settings, do not commit canonical state directly, and keep Memory → NPC production disabled/fail-closed until the existing inventory, lineage, authorization and revocation gates are proven.
