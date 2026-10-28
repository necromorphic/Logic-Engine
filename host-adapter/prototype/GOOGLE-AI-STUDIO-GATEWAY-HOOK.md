# Google AI Studio protected-dispatch hook — review candidate

Status: **in-process seam implemented; pinned SillyTavern sender not wired yet**.

Target source: SillyTavern 1.19.0-1-g06bde939f, commit
`06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Exact Host insertion point

In `src/endpoints/backends/chat-completions.js`, the Gemini sender first finishes
`getGeminiBody()`, resolves `apiVersion`, `responseType`, URL and headers, and
then currently performs the final outbound `fetch(url, { body: JSON.stringify(body), ... })`.

The future hook belongs after all transformations and endpoint/credential resolution,
but before that `fetch`. The body must be serialized once and the exact resulting
string passed to Gateway. If the request is protected, the normal `fetch` path must
never run after Gateway denies, errors, or is unavailable.

## Implemented in this candidate

`google-ai-studio-dispatch-hook.mjs` provides a fail-closed in-process seam:

- unprotected requests return `false` so the existing sender can continue;
- once trusted server policy marks a request protected, every outcome is handled
  as protected and the hook returns `true`, preventing fallback;
- only the official `https://generativelanguage.googleapis.com` origin is accepted;
- the exact already-serialized request body and server-resolved API key are bound
  into the request-scoped transport capability;
- trusted Core/Provider context is required for request ID, world, actor, purpose,
  source versions and candidates;
- if policy evaluation fails, context is missing, the endpoint is unsupported, or
  Gateway fails, the hook returns a generic 503 or closes an already-started response.

Gateway now supports a request-scoped `prepareUpstream` function for this in-process
call and validates the prepared target before authorization. The synchronous
`start()` capability must initiate the exact transport only after the durable
`DISPATCH_STARTED` row has been committed.

## Critical deployment constraint

A JavaScript closure cannot be sent through the existing loopback HTTP Gateway API.
Therefore this hook is only valid when the trusted Host callback and Gateway execute
in the same Node process. The existing HTTP server endpoint is **not** wired to accept
a function or arbitrary transport data.

If SillyTavern and Gateway run in different processes or on different devices, do not
attempt to serialize the capability or send credentials as an untrusted payload.
A separately reviewed protocol is required that preserves server-owned credential
handling, exact request binding, and the single-egress property.

## Still required before integration

1. Provide a trusted server-side source for `isProtectedRequest(request)`; browser
   request fields must not determine whether Memory context is protected.
2. Provide `getTrustedDispatchContext(request)` from Core/Provider policy and prove
   that its source/candidate versions are current and tied to the exact request.
3. Confirm the deployment topology supports in-process capability handoff.
4. Wire the hook into the pinned sender, with the ordinary `fetch` reachable only
   for explicitly unprotected requests.
5. Add pinned-source tests that assert zero ordinary fetches on every protected
   denial/failure, exact serialized body at the final egress, and no alternate sender.
6. Inventory and explicitly deny unsupported model routes, custom extensions, proxy
   transports and other provider branches.
7. Obtain exact-diff Core review and run the actual installed Host runtime.

This document and PR #615 do not establish Host integration or authorize activation.
Memory→NPC must remain `DISABLED / FAIL-CLOSED` until all gates pass.
