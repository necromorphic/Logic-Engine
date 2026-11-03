# Gateway / Generation / Final-Send integration decision

**Status:** selected architecture; production composition remains blocked.
**Inputs:** #844, #855, #868, #870.  
**Pinned Host:** SillyTavern 1.19.0, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Decision

Use one in-process Core Memory Dispatch Gateway at the SillyTavern server-side final-send boundary, installed by the explicitly authorized managed local source patch.

- The pinned ST Hook is the only native generation egress seam.
- The Host Adapter resolves authenticated session, installation, account and conversation identity. Browser-supplied Memory markers are rejected.
- The NPC Context Receiver is the existing Host-to-Core authenticated retrieval contract from #870 (`POST /v1/host/memory-npc/retrieve`), not a second generation ingress.
- The Gateway owns durable `DISPATCH_STARTED`, shared Coordinator ordering, exactly-once transport handoff, ambiguous-outcome recovery, and final response write authorization.
- The managed Patch Manager from #868 is the only owner of the local ST source patch and its durable backups/journal.
- #851's independent Extension Gateway ingress is not inserted into the generation path. It adds a second ingress but does not own the native provider transport or the final Express response write.

The Gateway receives a non-serializable, request-scoped transport capability from the native ST sender. The capability is invoked only after durable dispatch-start while the shared Coordinator is held. The network Promise is awaited after the lease is released. The response Hook guards actual `response.write()` and `response.end()` operations; each protected write revalidates Core/Provider evidence under the same Coordinator before invoking the native writer.

## Pinned generation-route inventory

The local patch wraps these five native ST generation handlers:

| Native route | Gateway sender identities |
|---|---|
| `POST /api/backends/chat-completions/generate` | 25 provider families: Claude, Google AI Studio, Vertex AI, AI21, Mistral, Cohere, DeepSeek, xAI, AIMLAPI, ElectronHub, Chutes, MiniMax, Azure OpenAI, OpenAI, OpenRouter, Custom, Perplexity, Groq, Fireworks, NanoGPT, Pollinations, Moonshot, Z.AI, SiliconFlow, Cloudflare Workers AI |
| `POST /api/backends/text-completions/generate` | `text-completions` |
| `POST /api/backends/kobold/generate` | `kobold` |
| `POST /api/novelai/generate` | `novelai-text` |
| `POST /api/horde/generate-text` | `horde-text` |

The canonical registry currently contains 29 sender identities. Unknown sender identities are not admitted for protected Memory. Image generation, TTS/audio, embeddings, translation, model-discovery requests and third-party extension routes are not part of this text-generation registry. Protected Memory must not be sent through them.

## Integration contract between #870 and #844

The #870 Host Adapter/Core integration already provides:
- authenticated Host session and persistent installation/account identity;
- conversation-to-World and World-to-Actor binding in Core;
- an authenticated Host assertion with durable nonce replay protection;
- Core-owned NPC Memory retrieval through `MemoryNpcConsumer`;
- a validated Result Envelope returned by `/v1/host/memory-npc/retrieve`.

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
2. the NPC Context Receiver call and strict Result Envelope validation;
3. the real `MemoryDispatchGateway` instance with the configured Core/Provider read-only evidence readers and the exact shared Coordinator database;
4. one stable request ID and one protected-dispatch decision per Host response;
5. a fail-closed rule that `NON_READY`, missing identity, missing receiver, stale evidence, unknown sender or absent Gateway cannot downgrade to native fetch.

No browser-to-Core call, second generation ingress, relay, extra API port or Base URL substitution is introduced.

## Retry / cancellation / ambiguous outcomes

- Once protected `DISPATCH_STARTED` is committed, a second protected model handoff for the same Express response is terminal. It cannot mint a fresh request ID to retry.
- A sender retry after a completed or ambiguous protected handoff is denied; no automatic resend is allowed.
- A cancellation signal is passed to the single transport capability. If transport outcome cannot be established, ledger status remains or becomes `UNKNOWN`; cancellation does not authorize replay.
- Revocation ordered before dispatch-start means zero provider calls.
- Revocation ordered after dispatch-start cannot recall the upstream call, but blocks every subsequent Host response write.
- A crash with a stranded `DISPATCH_STARTED` row converts it to `UNKNOWN` on startup and blocks same-digest replay, including a different sender family.

## Current acceptance evidence and blockers

| Requirement | Evidence | State |
|---|---|---|
| Five pinned native generation handlers are wrapped | Exact-pinned-source audit and real-handler fake-provider harness | PASS for exercised source paths |
| 29 sender identities are explicitly registered | Gateway registry and adapter mapping tests | PASS at registry level |
| Durable dispatch-start / crash recovery | Gateway unit and child-process crash/restart tests | PASS at Gateway level |
| Revoke before dispatch-start | Real Provider revoke race tests | PASS at Gateway level |
| Revoke during inference suppresses response | Gateway revalidation tests | PASS at Gateway level |
| Revoke between chunks suppresses later stream writes | Gateway stream write tests | PASS at Gateway level |
| Actual non-stream Express end is revalidated | Hook wraps Express `response.end`; Gateway `authorizeResponseWrite` is called from the wrapper | Implemented; production wiring not proven |
| Retry cannot send twice per Host response | New adapter WeakSet guard and regression test | Implemented; exact-head CI pending |
| NPC Context Receiver is wired into native generation | #870 receiver exists; no trusted native request-to-conversation mapping or bootstrap composition yet | BLOCKED |
| Production Core/Provider evidence readers and shared Coordinator are supplied to the Gateway | Gateway constructor supports them; plugin bootstrap currently registers a fail-closed adapter instead | BLOCKED |
| Live SillyTavern session/provider/revoke/cancellation acceptance | No live deployment evidence | BLOCKED |

**Safety state:** `NON_READY`; Memory → NPC remains `DISABLED / FAIL-CLOSED`. This decision does not authorize merge, production route enrollment or activation.
