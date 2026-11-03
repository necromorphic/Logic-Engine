# Gateway / Generation / Final-Send integration decision

**Status:** selected architecture; production composition remains blocked.
**Inputs:** #844, #855, #868, #870.  
**Pinned Host:** SillyTavern 1.19.0, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Decision

Use one in-process Core Memory Dispatch Gateway at the SillyTavern server-side final-send boundary, installed by the explicitly authorized managed local source patch.

- The pinned ST Hook is the only native generation egress seam.
- The Host Adapter resolves authenticated session, installation, account and conversation identity. Browser-supplied Memory markers are rejected.
- The NPC Context Receiver is composed inside Core from the authenticated Host scope and adapter-pinned `MemoryNpcConsumer`; it is not the JSON result of `POST /v1/host/memory-npc/retrieve`, and it is not a second generation ingress. Its builder-issued context must retain in-process object identity.
- The Gateway owns durable `DISPATCH_STARTED`, shared Coordinator ordering, exactly-once transport handoff, ambiguous-outcome recovery, and final response write authorization.
- The root SillyTavern server-plugin entrypoint (`index.mjs`) is the startup owner: it read-only verifies the single multi-route Patch Manager state and registers the Hook adapter. Hook registration now requires `authorizeResponseWrite`; the Hook binds that method and has no native-writer fallback. The current adapter implements an explicit pass-through writer only while protected Memory is disabled or while emitting the preparation 503; when enabled, protected requests fail closed before the native sender. The plugin must not apply a patch after native generation modules have already been imported; install/update happens before restart. Normal shutdown leaves the patch installed; explicit Extension deletion owns uninstall.
- The multi-route Patch Manager incorporates #868's durable-state direction: state, journal and byte-exact backups live under `SillyTavern/data/logic-engine/final-send-patch`, outside the removable Extension directory; restore uses a durable transaction journal and fsync-backed atomic replacement. #868's standalone manager was scoped to the Chat Completions endpoint, so it was not transplanted wholesale because it would drop the four additional native text-generation routes.
- #851's independent Extension Gateway ingress is not inserted into the generation path. It adds a second ingress but does not own the native provider transport or the final Express response write.

The Gateway receives a non-serializable, request-scoped transport capability from the native ST sender. The capability is invoked only after durable dispatch-start while the shared Coordinator is held. The network Promise is awaited after the lease is released. The response Hook guards actual `response.write()` and `response.end()` operations; each protected write revalidates Core/Provider evidence under the same Coordinator before invoking the native writer.

## Pinned generation-route inventory

The local patch wraps these five native ST generation handlers:

| Native route | Gateway sender identities |
|---|---|
| `POST /api/backends/chat-completions/generate` | 26 provider-source identities: Claude, Google AI Studio, Vertex AI, AI21, Mistral, Cohere, CometAPI, DeepSeek, xAI, AIMLAPI, ElectronHub, Chutes, MiniMax, Azure OpenAI, OpenAI, OpenRouter, Custom, Perplexity, Groq, Fireworks, NanoGPT, Pollinations, Moonshot, Z.AI, SiliconFlow, Cloudflare Workers AI |
| `POST /api/backends/text-completions/generate` | `text-completions` |
| `POST /api/backends/kobold/generate` | `kobold` |
| `POST /api/novelai/generate` | `novelai-text` |
| `POST /api/horde/generate-text` | Hooked for fail-closed classification, but deliberately excluded from protected Memory. It creates an asynchronous task; the actual model output is returned later by `POST /api/horde/task-status`. |

The canonical registry currently contains 29 sender identities: all 26 pinned `CHAT_COMPLETION_SOURCES` values plus three synchronous text-generation handlers (`text-completions`, `kobold`, `novelai-text`). CometAPI is an OpenAI-compatible sender branch inside the Chat Completions handler and is explicitly registered as `cometapi`. Horde text is ordinary-only: `/api/horde/generate-text` returns a task ID and `/api/horde/task-status` later returns the model output without the originating request-scoped Final-Send context. `/api/horde/cancel-task` is cancellation control only. Until a durable server-owned task receipt binds the asynchronous task to the originating Gateway dispatch and final response revalidation, protected Memory is denied before Horde task creation. Unknown sender identities are not admitted for protected Memory. Image generation, TTS/audio, embeddings, translation, model-discovery requests and third-party extension routes are not part of this text-generation registry. Protected Memory must not be sent through them.

## Integration contract between #870 and #844

The #870 Host Adapter/Core integration provides the underlying contracts:
- authenticated Host session and persistent installation/account identity;
- conversation-to-World and World-to-Actor binding in Core;
- an authenticated Host assertion with durable nonce replay protection;
- Core-owned NPC Memory retrieval through `MemoryNpcConsumer`;
- authenticated World/Actor/conversation scope and the existing retrieval Result Envelope. These are inputs to the in-process NPC Generation Context Builder, not a serialized Final-Send handoff.

Important limitation: #851's Extension Gateway is not part of the selected generation path. The current candidate removes its direct dispatch call and retains only fail-closed behavior after protected failure. Neither a browser interceptor nor a JSON `/dispatch` route can carry the builder-issued context identity into the in-process Gateway.

The #844 Gateway already provides:
- file-backed durable dispatch ledger with `synchronous=FULL`;
- shared Coordinator lease for dispatch-start and final writes;
- durable `DISPATCH_STARTED` before one synchronous transport handoff;
- `UNKNOWN` recovery after crash/restart and replay suppression;
- Core/Provider/policy/source/candidate revalidation before response release;
- actual response-write authorization for non-streaming and streaming;
- terminal suppression on revoke or failed revalidation.

These pieces are not yet composed into a production bootstrap. In particular, the native generation request must be bound to the exact authenticated Host conversation before the NPC Context Receiver is called. The existing #870 dispatch proxy expects a trusted conversation UUID in its request envelope; the current native ST generation handlers do not yet have a demonstrated server-side mapping from their request to that UUID. Do not copy a browser-provided conversation identifier into the protected context without an independent Host-side identity/inventory check.

The production bootstrap must supply, from trusted server configuration:
1. the live pinned Host Adapter and its authenticated request-context resolver;
2. the Core in-process NPC Generation Context runtime: asynchronous `prepareForDispatch(request)` builds/receives the context and issues a one-shot opaque handoff; the Gateway consumes it synchronously under the shared Coordinator. The context itself is never serialized;
3. a verified correlation from the actual native generation request to the authenticated Host conversation and exact request/response lifecycle; a browser-supplied request ID may only select a server-stored, one-time receipt and cannot itself establish identity;
4. the real `MemoryDispatchGateway` instance with configured Core/Provider read-only evidence readers and the exact shared Coordinator database;
5. one stable request ID and one protected-dispatch decision per Host response;
6. a fail-closed rule that `NON_READY`, missing identity, missing receiver, stale evidence, unknown sender or absent Gateway cannot downgrade to native fetch.

No browser-to-Core call, second generation ingress, relay, extra API port or Base URL substitution is introduced.

## Retry / cancellation / ambiguous outcomes

- Once protected `DISPATCH_STARTED` is committed, a second protected model handoff for the same Express response is terminal. It cannot mint a fresh request ID to retry.
- A sender retry after a completed or ambiguous protected handoff is denied; no automatic resend is allowed.
- The request-scoped `AbortSignal`, when the native sender provides one, is checked before durable dispatch-start and again at final response revalidation / each Host write; it is also passed to the single transport. Abort before start produces zero egress and no ledger row. Abort after `DISPATCH_STARTED` is terminal and becomes `UNKNOWN`; it never authorizes replay. Bytes already written to a streaming response cannot be recalled.
- Revocation ordered before dispatch-start means zero provider calls.
- Revocation ordered after dispatch-start cannot recall the upstream call, but blocks every subsequent Host response write.
- A crash with a stranded `DISPATCH_STARTED` row converts it to `UNKNOWN` on startup and blocks same-digest replay, including a different sender family.

## Current acceptance evidence and blockers

| Requirement | Evidence | State |
|---|---|---|
| Five pinned native generation handlers are wrapped | Exact-pinned-source audit and real-handler fake-provider harness | Source hashes match the uploaded 1.19.0 archive; updated patch exact-head apply/test pending |
| 29 sender identities are explicitly registered (26 Chat Completions + three synchronous routes) | Gateway registry and adapter mapping tests; CometAPI included, Horde excluded | Code and regression tests added; exact-head CI pending |
| Native abort exemption cannot bypass protected dispatch | Only empty-body `POST /abort` controls are exempt; generation POSTs with bodies always enter the Gateway | Patch and regression test updated; exact-head CI pending |\n| Durable dispatch-start / crash recovery | Gateway unit and child-process crash/restart tests | PASS at Gateway level |
| Durable Patch Manager state/backup and interrupted restore recovery | Patch Manager stores state/backups in ST data; new tests cover Extension removal and restart during restore | Exact-head CI pending |
| Revoke before dispatch-start | Real Provider revoke race tests | PASS at Gateway level |
| Revoke during inference suppresses response | Gateway revalidation tests | PASS at Gateway level |
| Revoke between chunks suppresses later stream writes | Gateway stream write tests | PASS at Gateway level |
| Actual non-stream Express end is revalidated | Hook wraps Express `response.end`; Gateway `authorizeResponseWrite` is called from the wrapper; patched real-handler harness now simulates revoke immediately before `response.end` and expects client egress suppression | Implemented; exact-head CI pending; production Core/Provider wiring not proven |
| Horde asynchronous result retrieval is protected | `/generate-text` is ordinary-only; actual output arrives later through `/task-status` without a durable task receipt | Protected dispatch is denied before task creation; exact-head CI pending |\n| Retry cannot send twice per Host response | New adapter WeakSet guard and regression test | Implemented; exact-head CI pending |
| NPC Context Receiver is wired into native generation | #870 now has `prepareForDispatch`, one-shot `consumeDispatchHandoff`, and synchronous Lane A revalidation, but `index.mjs` does not compose that runtime in the same process as the native Hook/Gateway. Gateway has no handoff consumer yet; Lane B candidate/source-version shape also does not match the Gateway's synchronous Provider evidence reader. The HTTP `npc_context` projection is not an authorization capability and cannot replace the opaque handoff. | BLOCKED |
| Production Core/Provider evidence readers and shared Coordinator are supplied to the Gateway | Gateway constructor supports them; plugin bootstrap currently registers a fail-closed adapter instead | BLOCKED |
| Live SillyTavern session/provider/revoke/cancellation acceptance | No live deployment evidence | BLOCKED |

**Safety state:** `NON_READY`; Memory → NPC remains `DISABLED / FAIL-CLOSED`. This decision does not authorize merge, production route enrollment or activation.
