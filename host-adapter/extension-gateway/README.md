# SillyTavern Extension Gateway — prototype

**Status: review-only prototype. Not production-ready. Memory → NPC remains DISABLED / FAIL-CLOSED.**

## Correct integration boundary

This prototype uses SillyTavern's extension `generate_interceptor` mechanism. On the pinned target, `runGenerationInterceptors(chat, contextSize, type)` awaits each registered interceptor before continuing the native generation flow. Calling the supplied `abort(true)` stops the remaining interceptor chain and makes the normal generation path return before the provider request is sent.

The extension gateway is therefore the intended **SillyTavern extension boundary**. It does **not** call a provider API, does not replace provider settings, and does not add a new HTTP endpoint.

## What this prototype does

- Leaves ordinary SillyTavern generation unchanged when no protected request has been explicitly armed.
- For an explicitly armed protected request, aborts native SillyTavern generation before any provider-specific send.
- Hands the captured generation context to an injected dispatch callback.
- If the callback is absent or fails, remains fail-closed: the native provider send stays aborted.
- Does not log chat text or dispatch payloads.
- Registers only the global interceptor name required by SillyTavern's manifest. The arm/cancel/status helpers are module exports, not extra global functions.

## Security limitation of the module seam

The exported helpers are **not an authorization boundary**. Code running in the same SillyTavern page/module environment must be treated as potentially able to call them. A request ID is not proof of authorization. Do not connect or arm protected dispatch until an approved existing Host contract provides authorization and freshness/revocation checks. No new API/schema/store is defined here.

## What it does not prove or implement

- It does not implement the Core/Memory/NPC dispatch callback or define a new Core API.
- It does not render a returned NPC response into the chat; that must be supplied by the approved Host adapter.
- It does not stop unrelated extensions, custom routes, direct fetch calls, or server-side callers from sending requests.
- It does not prove that a request is authorized, current, or free of revoked/stale Memory candidates.
- It is not a substitute for server-side egress control where that is required by the approved security design.

## Installation for review only

Copy this directory into the pinned SillyTavern checkout under:

`public/scripts/extensions/third-party/logic-engine-extension-gateway/`

Then install/load it using SillyTavern's normal extension mechanism. Do not enable protected dispatch in a real chat. This is a review scaffold, not a working Memory → NPC path.

## Pinned-source evidence

Target: SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

Relevant implementation:
- `public/scripts/extensions.js`: `runGenerationInterceptors` invokes manifest-declared interceptors and supports immediate abort.
- `public/script.js`: generation calls `runGenerationInterceptors` before entering backend-specific generation; if aborted, it unblocks and returns before provider dispatch.
- `public/scripts/openai.js`: `CHAT_COMPLETION_SETTINGS_READY` is an event before the native Chat Completions `fetch`, but it is not a veto-capable event. This prototype intentionally uses the extension interceptor instead of that event or a provider API gateway.

The pinned-source flow was inspected in the uploaded SillyTavern release archive. That source audit is not a live-install test and does not prove that every provider, media route, or third-party extension path is covered.
