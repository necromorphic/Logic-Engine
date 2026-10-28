# Protected Memory dispatch adapter — stage 1

This is the Host-side handoff contract for the protected Memory dispatch Gateway.

## Implemented in this draft

- Requires a Gateway, a server-owned trusted-context reader, a server-owned transport factory, and a response forwarder.
- Rejects malformed requests and incomplete admission context before Gateway invocation.
- Fixes the route label to `host-managed-chat-completions`.
- Passes the exact final serialized body to the Gateway without parsing or reserializing it.
- Prepares a dormant in-process transport capability and passes it to the Gateway; the factory must not initiate network I/O.
- Has no direct-provider fallback and does not retry a failed Gateway dispatch.
- Contract tests cover exact-body binding, transport-capability presence, malformed/incomplete context, invalid transport factory output, and Gateway denial without transport invocation.

## Cross-PR dependency

The Gateway-side forwarding change is in draft PR [#586](https://github.com/necromorphic/Logic-Engine/pull/586). The trusted Gateway `sendUpstream` implementation must invoke the supplied capability exactly once, synchronously initiate the already-serialized request, and return `{ started: true, response: Promise }`. This adapter contract alone cannot prove that behavior.

## Not yet implemented / proven

This module is **not yet wired into SillyTavern's actual provider send functions**. It does not prove coverage of provider-specific handlers, streaming routes, extensions, vectorization calls, or custom endpoints. It also does not create trusted admission evidence; the integration must obtain identity, source versions, and candidates from the approved server-side Core/Provider path.

The pinned SillyTavern integration must replace the real outbound send at the final transport boundary, not merely call this adapter beside the existing `fetch`. Provider-specific transformations must finish before the final serialized body is produced. Any route not explicitly wired and tested through the Gateway must remain blocked for protected Memory.

Production Memory → NPC remains **DISABLED / FAIL-CLOSED** until end-to-end route coverage, race tests, exact-head CI, and deployment evidence are accepted.
