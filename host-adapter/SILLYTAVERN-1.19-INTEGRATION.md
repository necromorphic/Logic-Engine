# SillyTavern 1.19 integration experiment — SUPERSEDED

**Status:** historical experiment; not the current deployment procedure. The former rejection of local source patching was superseded on 2026-11-01 when the owner explicitly authorized Patch Manager to maintain a pinned local source-level patch of the installed SillyTavern tree. SillyTavern upstream and its official repository remain unchanged.  
**Current implementation:** [Final-Send Patch Manager](./PATCH-MANAGER.md) and [PR #844](https://github.com/necromorphic/Logic-Engine/pull/844).

The earlier experiment proposed changing:

`src/endpoints/backends/chat-completions.js`

by aliasing the native fetch/stream functions, installing an AsyncLocalStorage bridge, and wrapping the `/generate` handler. That would put the bridge inside SillyTavern's server implementation, but it is a Host source patch. It is therefore rejected and must not be used as an installation or deployment instruction.

The bridge files retained in this workstream are experimental Logic-Engine-side code only. Their existence and unit tests do not establish that the SillyTavern Extension Manager can install or activate them as an unbypassable final-send boundary.

## Findings from the supplied SillyTavern 1.19.0 release

- Client extensions are loaded in the browser and can subscribe to prompt/generation lifecycle events.
- `CHAT_COMPLETION_SETTINGS_READY` is emitted before the browser posts generation data to the native chat-completions endpoint.
- The separate server-plugin loader is disabled by default and mounts plugin routers under `/api/plugins/{plugin-id}`.
- The server-plugin loader does not expose the Express middleware chain or a supported interception hook for the native `/api/backends/chat-completions/generate` route.
- Neither mechanism, as inspected, proves coverage of all native provider senders plus the final response path.

## Required disposition

1. Do not modify SillyTavern source.
2. Do not replace the user's configured model/API provider with Logic-Engine.
3. Do not claim a client extension hook is a trusted egress gate.
4. Do not enable protected Memory insertion into native ST generation.
5. Keep Memory → NPC `DISABLED / FAIL-CLOSED` until a supported non-invasive Host hook and complete zero-egress proof exist.

This document records a rejected integration experiment so it is not accidentally followed later.
