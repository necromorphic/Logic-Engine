# SillyTavern Extension Manager integration

**Status:** first installable client-extension slice; not the complete trusted Host Adapter.  
**Host target inspected:** SillyTavern 1.19.0.  
**Host source modifications:** none.

## User-facing installation path

The Logic-Engine client extension is packaged at the repository root with the SillyTavern-required `manifest.json`, `index.js`, and `style.css`.

Install it through SillyTavern's normal third-party extension installer (Extensions → Install extension), using this repository and the `integration/sillytavern-extension-manager` branch. This is an Extension Manager installation, not a model/API-provider configuration.

After installation, the Logic-Engine panel appears in Extensions settings. Set the Core URL (default `http://127.0.0.1:8788`) and use **Check connection**. The extension checks only the unauthenticated Core `GET /health` endpoint. It does not store Core bearer, adapter, admin, approval, or internal credentials in browser settings.

## What this slice does

- Loads through the standard SillyTavern client Extension Manager.
- Uses SillyTavern's extension lifecycle and generation-settings event APIs.
- Provides a Core URL setting and a health check.
- Does not replace or configure the selected model/API provider.
- Does not modify SillyTavern source files.
- Does not send browser-supplied world, actor, conversation, installation, or authorization claims to Core.
- Does not inject protected Memory into generation. That path remains disabled.

## Important boundary

A client extension is browser-side and untrusted. It cannot be the authenticated server-side Host Adapter and cannot enforce a final-send/response gate against every native provider route. The generation hook in this first slice is observational only.

The full trusted integration still requires a server-side Host Adapter that authenticates the ST session, resolves installation/conversation/world/actor bindings, holds adapter credentials server-side, and mediates authorized Core operations. SillyTavern 1.19.0's separate server-plugin mechanism can host routes under `/api/plugins/{id}`, but it is installed from the server `plugins/` directory and is not installed by the client Extension Manager. Do not misrepresent it as part of the client extension installation.

Until a supported server-side bridge is installed and verified, this client extension is an installable UI/lifecycle connector only. Memory → NPC remains `DISABLED / FAIL-CLOSED`; no protected context is sent to the model.

## Why there is no provider/API setup

The user installs Logic-Engine from the Extensions panel. The model provider remains configured in SillyTavern exactly as before. The Core URL in this extension points to Logic-Engine Core, not to Gemini/OpenAI/another model provider.
