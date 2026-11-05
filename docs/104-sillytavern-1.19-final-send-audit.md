# SillyTavern 1.19.0: native generation final-send boundary audit

**Target:** supplied SillyTavern 1.19.0 source archive.  
**Question:** can a third-party client extension and supported server-plugin API enforce one trusted final-send boundary across all built-in protected text-generation routes without changing SillyTavern source or replacing its configured model/provider?  
**Result:** no, not through the supported extension/plugin surfaces audited here.

## Built-in text-generation sender inventory

| Sender | Client call site | Server route | Notes |
|---|---|---|---|
| Chat-completions backend | `public/scripts/openai.js`, `public/scripts/custom-request.js` | `POST /api/backends/chat-completions/generate` | Multi-provider; streaming and non-streaming. |
| Text-completions backend | `public/scripts/textgen-settings.js`, `public/scripts/custom-request.js` | `POST /api/backends/text-completions/generate` | Multi-provider; streaming. |
| Kobold backend | `public/scripts/kai-settings.js` | `POST /api/backends/kobold/generate` | Abort tied to request socket. |
| AI Horde text | `public/scripts/horde.js` | `POST /api/horde/generate-text` | Async task followed by polling. |
| NovelAI text | `public/scripts/nai-settings.js` | `POST /api/novelai/generate` | Dedicated text route. |

Azure generate and voice routes are TTS, while image/video routes are outside this text-generation inventory. Third-party extensions may add additional routes or direct external calls; this inventory covers built-in ST 1.19.0 only.

## Supported server-plugin lifecycle

The audited startup order is authentication middleware, then `setupPrivateEndpoints(app)`, then `loadPlugins(app, pluginsDirectory)`. The plugin loader creates a separate Express Router, passes that Router to `init`, and mounts it under `/api/plugins/<plugin-id>`. The supported plugin API therefore does not provide middleware before native generation routers or a callback around their outbound provider dispatch.

Reaching into private Express internals or monkey-patching runtime objects would be unsupported and version-fragile, not an accepted security boundary.

## Client extension lifecycle

Browser generation hooks are not authoritative egress controls. They can be bypassed by direct requests or other extensions; a chat-completions hook does not cover all native sender families; post-generation events cannot prevent bytes already transmitted. Client hooks remain suitable for UI coordination and non-authoritative signals only.

## Acceptance consequences

| Requirement | Supported extension/plugin API alone |
|---|---|
| Unified final-send boundary | Not achievable: no supported pre-route/pre-dispatch hook across native routers. |
| All protected sender routes | Not achievable: separate native route families are outside the plugin namespace. |
| Durable dispatch start and revoke synchronization | Core can persist/co-ordinate its own state but cannot atomically couple it to independent native dispatch. |
| Retry and ambiguous transport outcome | Core cannot own native retries or transport outcomes while native handlers dispatch independently. |
| Streaming and crash recovery | Core cannot control native streaming writers and their reconnect/crash lifecycle through the plugin namespace. |
| Zero-egress regression | Cannot be proven while any native sender bypasses the trusted gateway. |

## Architecture decision and status

The Extension Manager package can remain a user-facing installation surface for configuration, status and non-authoritative operations. It cannot, by itself, satisfy all three constraints simultaneously: Extension Manager installation, no SillyTavern source modification or unsupported internals, and protection of every built-in native sender without replacing/rerouting the provider.

Until a supported server-side generation-dispatch hook exists or one of those constraints changes, protected prompt egress must remain disabled and Memory → NPC must remain `DISABLED / FAIL-CLOSED`. This document is historical compatibility evidence, not authorization to enable production dispatch.

## Evidence locations in the supplied ST 1.19.0 source

- `src/server-main.js`: `setupPrivateEndpoints(app)` precedes `loadPlugins(app, pluginsDirectory)`.
- `src/server-startup.js`: private routers for NovelAI, Horde, text-completions, Kobold and chat-completions.
- `src/plugin-loader.js`: plugin receives a dedicated Router mounted under `/api/plugins/<id>`.
- `public/scripts/openai.js`, `textgen-settings.js`, `kai-settings.js`, `horde.js`, `nai-settings.js`: native sender call sites.
- `public/script.js`: client generation lifecycle events.

**Provenance:** selectively preserved from closed PR #847 (`68568eb062a6a64ee0d3a4fe63d5c6810b068741`). The installation guide and executable connector were not copied: the connector's `/api/plugins/logic-engine/*` route is a parallel ingress and conflicts with the later sole Extension Gateway architecture.