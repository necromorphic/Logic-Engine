# SillyTavern Extension Manager integration

**Status:** first installable client extension plus server-side host-context bridge; not the complete protected generation integration.  
**Host target inspected:** SillyTavern 1.19.0.  
**Host source modifications:** none.

## What gets installed

There are two Logic-Engine components because SillyTavern separates browser extensions from server plugins:

1. **Client extension** — installed from SillyTavern's **Extensions → Install extension** panel. It adds the Logic-Engine settings panel and calls only same-origin Host Adapter routes. It contains no Core or adapter credentials.
2. **Server plugin** — runs inside SillyTavern's server plugin loader. It uses the server-resolved `req.user` context supplied after SillyTavern's `requireLoginMiddleware`, then checks the local Logic-Engine Core. It keeps server-side responsibilities out of the browser.

Neither component changes SillyTavern source or replaces the configured model/API provider.

## Installation

### 1. Install the server-side Host Adapter plugin

From the SillyTavern installation directory, create the plugin directory and clone this branch into it:

```powershell
New-Item -ItemType Directory -Force .\\plugins | Out-Null
git clone --branch integration/sillytavern-extension-manager https://github.com/necromorphic/Logic-Engine.git .\\plugins\\logic-engine
```

In SillyTavern's `config.yaml`, enable server plugins:

```yaml
enableServerPlugins: true
```

The repository's package entrypoint points the SillyTavern plugin loader to `server-plugin/index.mjs`. The plugin loader mounts its routes under `/api/plugins/logic-engine`. The plugin uses the local Core URL from `LOGIC_ENGINE_URL`, defaulting to `http://127.0.0.1:8787`.

If server plugins are already enabled, do not change that setting. Restart SillyTavern after installing or updating the server plugin.

### 2. Install the client extension through the Extensions panel

In SillyTavern open **Extensions → Install extension**.

Repository URL:

```text
https://github.com/necromorphic/Logic-Engine
```

Branch:

```text
integration/sillytavern-extension-manager
```

Install and reload SillyTavern. The Logic-Engine panel appears in Extensions settings. Use **Check connection**.

### 3. Start Logic-Engine Core

Core must be running on `http://127.0.0.1:8787`, or set `LOGIC_ENGINE_URL` in the SillyTavern server environment to the Core address. Core runtime still requires its normal database, coordinator, world-pack catalog, and credential configuration.

The extension does not ask for an API key. The model provider remains configured in SillyTavern exactly as before.

## What the first slice proves

- The client extension is loadable through the normal Extension Manager.
- The browser talks only to same-origin `/api/plugins/logic-engine/*` routes.
- SillyTavern's server-side `requireLoginMiddleware` runs before server-plugin routes in the inspected 1.19.0 source. The plugin independently requires `req.user.profile.handle` and fails closed if it is absent.
- The server plugin derives a pseudonymous subject identifier from the server-resolved ST user and data-directory scope; it does not accept identity from browser request fields.
- The server plugin calls only the configured Core `/health` endpoint. The browser cannot supply or override the Core URL.
- Core credentials are not sent to or stored in the browser.
- The model/API provider is not replaced.

## Explicitly not implemented yet

This is a real installation and host-context/Core-connectivity slice, not the complete Sole Gateway. It does not yet:

- bind the authenticated ST installation/session/conversation to a Core world and actor;
- expose protected Memory retrieval to the browser;
- inject Memory into prompts;
- intercept every native provider send or response;
- implement PRE-LLM EGRESS or FINAL RESPONSE REVALIDATION for native generation;
- authorize Core Commit from LLM output.

A client extension cannot be the trusted Host Adapter. The server plugin is the trusted-side starting point, but its current routes are limited to user context and Core health. Do not send protected context to the model through this incomplete path.

Memory → NPC remains `DISABLED / FAIL-CLOSED`. No SillyTavern source patch and no model-provider replacement are part of this integration.


## Final-send boundary audit (SillyTavern 1.19.0)

The native protected-generation sender routes and the server-plugin lifecycle have been audited separately. The result is documented in [104-sillytavern-1.19-final-send-audit.md](./104-sillytavern-1.19-final-send-audit.md).

**Decision:** the current supported SillyTavern server-plugin API cannot install a trusted middleware in front of the native generation routers. Server plugins receive a dedicated Express Router mounted under `/api/plugins/<id>` after the native private endpoint routers have already been mounted. The client extension lifecycle events are not a trusted egress boundary. Therefore this installation slice must not be described as implementing any of the final-send requirements. Do not enable protected Memory/NPC prompt injection through this connector.
