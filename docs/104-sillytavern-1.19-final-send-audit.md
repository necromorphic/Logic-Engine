# SillyTavern 1.19.0: native generation final-send boundary audit

**Target:** the supplied SillyTavern 1.19.0 source archive.  
**Question:** can Logic-Engine enforce one trusted final-send boundary for all built-in protected text-generation routes using only a third-party client extension installed through Extensions → Install extension and the supported server-plugin API, without changing SillyTavern source or replacing its configured model/provider?  
**Result:** no, not through the supported extension/plugin surfaces audited here.

## 1. Built-in text-generation sender inventory

The following client call sites and server route registrations were found in the supplied 1.19.0 source:

| Sender | Client request | Server route | Transport notes |
|---|---|---|---|
| Chat-completions backend | `public/scripts/openai.js`; also `public/scripts/custom-request.js` | `src/endpoints/backends/chat-completions.js`: `POST /api/backends/chat-completions/generate` | Shared backend entry for multiple chat-completion providers; supports streaming and non-streaming responses. |
| Text-completions backend | `public/scripts/textgen-settings.js`; also `public/scripts/custom-request.js` | `src/endpoints/backends/text-completions.js`: `POST /api/backends/text-completions/generate` | Routes to multiple configured completion backends; supports streaming. |
| Kobold backend | `public/scripts/kai-settings.js` | `src/endpoints/backends/kobold.js`: `POST /api/backends/kobold/generate` | Dedicated backend route; abort behavior is tied to the request socket. |
| AI Horde text | `public/scripts/horde.js` | `src/endpoints/horde.js`: `POST /api/horde/generate-text` | Starts an asynchronous remote generation task; status is subsequently polled through `/api/horde/task-status`. |
| NovelAI text | `public/scripts/nai-settings.js` | `src/endpoints/novelai.js`: `POST /api/novelai/generate` | Dedicated text-generation route. |

The chat-completions and text-completions routes are themselves multi-provider dispatchers. Protecting only one concrete upstream provider or only the chat-completions route would leave other built-in senders uncovered.

### Exclusions from the protected text-generation inventory

The following similarly named routes are not additional text-chat sender routes in this audit:
- `/api/azure/generate` is Azure TTS (audio synthesis).
- `/api/google/*generate-voice*`, `/api/openai/*generate-voice*`, and other voice routes are TTS.
- `/api/openai/generate-image`, `/api/openai/generate-video`, `/api/novelai/generate-image`, `/api/horde/generate-image`, and `/api/sd/*` are image/video generation.

Third-party SillyTavern extensions can add their own routes or send directly to external services. This inventory describes built-in ST 1.19.0 code, not arbitrary third-party extension behavior.

## 2. Supported server-plugin lifecycle

Observed startup order in `src/server-main.js`:
1. Authentication middleware is registered.
2. `setupPrivateEndpoints(app)` mounts the built-in private endpoint routers.
3. `loadPlugins(app, pluginsDirectory)` runs later.

Observed behavior in `src/plugin-loader.js`:
- `initPlugin(app, ...)` creates a new, separate `express.Router()`.
- It calls the plugin's `init(router)`; the app object is not passed to plugin code.
- The router is mounted afterward at `/api/plugins/<plugin-id>`.

Consequently, the documented server-plugin contract provides routes under the plugin's own namespace. It does not provide a supported hook for inserting trusted middleware before the already-mounted native generation routers, nor a supported callback around their outbound provider dispatch.

A plugin could attempt to reach into private Express internals or monkey-patch runtime objects. That would be an unsupported, version-fragile modification of host internals, not a supported extension integration contract. It is not accepted as proof of a durable security boundary.

## 3. Client extension lifecycle is not a security boundary

The client exposes generation lifecycle events, including `GENERATION_STARTED`, `GENERATION_AFTER_COMMANDS`, `CHAT_COMPLETION_SETTINGS_READY`, and `GENERATION_ENDED`.

These execute in the browser:
- a browser extension is controlled by the client and cannot be the authority that decides whether protected data may leave the host;
- a client hook on `CHAT_COMPLETION_SETTINGS_READY` covers the chat-completions path, not every native sender listed above;
- a client-side `fetch` wrapper can be bypassed by direct requests or another extension;
- post-generation events cannot establish a pre-egress decision or prevent already transmitted bytes from leaving.

Therefore client hooks may be useful for UI coordination and non-authoritative signals, but cannot implement a trusted unified final-send boundary or prove zero-egress.

## 4. Requirement-by-requirement result

| Requirement | Supported extension/plugin API alone |
|---|---|
| Unified final-send boundary | **Not achievable**: no supported pre-route/pre-dispatch hook across native routers. |
| All protected sender routes | **Not achievable**: separate native route families; plugin namespace does not wrap them. |
| Durable `DISPATCH_STARTED` | Core can persist a dispatch record, but cannot atomically couple it to native ST dispatch through the current plugin API. |
| Revoke synchronization | Core can coordinate its own state, but cannot serialize revoke against all native sender dispatches without controlling the actual dispatch boundary. |
| Retry and ambiguous transport outcome | Core can model these states, but cannot own native ST retries/transport outcomes while native handlers dispatch independently. |
| Streaming and crash recovery | Core can persist its own stream/dispatch state, but cannot control native streaming writers and their crash/reconnect lifecycle through the plugin namespace. |
| Zero-egress regression | **Cannot be proven** while any native sender route can dispatch without passing the trusted gateway. |

## 5. Architecture decision

The Extension Manager client package remains valid as the user-facing installation surface. It can configure and communicate with a server-side adapter, display status, and initiate non-authoritative operations.

However, the complete final-send requirements cannot be honestly marked complete under all three simultaneous constraints:
1. install the client through SillyTavern's Extension Manager;
2. do not modify SillyTavern source or depend on unsupported Express internals;
3. protect every built-in native sender without replacing/rerouting the configured provider.

At least one constraint must change, or SillyTavern must expose a supported server-side generation-dispatch hook that does not exist in the inspected 1.19.0 source. This is a technical compatibility blocker, not a reason to weaken the seven acceptance criteria.

Until then:
- keep protected prompt egress disabled;
- keep Memory → NPC `DISABLED / FAIL-CLOSED`;
- do not claim PRE-LLM EGRESS, FINAL RESPONSE REVALIDATION, or zero-egress coverage;
- do not merge the connector as a completed security integration.

## 6. Evidence locations in the supplied ST 1.19.0 source

- `src/server-main.js`: `setupPrivateEndpoints(app)` precedes `loadPlugins(app, pluginsDirectory)`.
- `src/server-startup.js`: `setupPrivateEndpoints(app)` mounts `/api/novelai`, `/api/horde`, `/api/backends/text-completions`, `/api/backends/kobold`, and `/api/backends/chat-completions`.
- `src/plugin-loader.js`: plugin receives a dedicated Router and that Router is mounted under `/api/plugins/<id>`.
- `public/scripts/openai.js`: chat-completions sender.
- `public/scripts/textgen-settings.js`: text-completions sender.
- `public/scripts/kai-settings.js`: Kobold sender.
- `public/scripts/horde.js`: AI Horde text sender.
- `public/scripts/nai-settings.js`: NovelAI text sender.
- `public/script.js`: client generation lifecycle events.
