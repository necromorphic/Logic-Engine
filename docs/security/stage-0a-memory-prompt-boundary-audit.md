# Stage 0A — protected Memory prompt boundary audit

**Audit base:** PR #949 branch head used when Stage 0A was opened: `4e57147475db805cc538c51b323f1b3eebfc7cb6`.

**SillyTavern source:** upstream repository `SillyTavern/SillyTavern`, pinned commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. The pinned `package.json` reports version `1.19.0`. The five server generation files were inspected from that Git commit through GitHub source access. The locally supplied ZIP archive was not downloaded or inspected in this work block; archive-level SHA-256 verification is **NOT VERIFIED**.

**Scope:** prompt serialization and role boundary only. No Core authority/acquisition/belief changes, no Gateway/authentication rewrite, no ST-VectorService changes, and no new Memory→NPC mechanism.

## Memory-to-prompt path inspected

1. `host-adapter/extension-gateway/index.js` attaches opaque conversation/request/generation locators; it does not insert Memory text.
2. `host-adapter/extension-gateway/server-plugin/host-adapter.mjs` authenticates Host requests and prepares Host context; it does not serialize Memory into the prompt.
3. `index.mjs` conditionally constructs protected Memory from the one-shot NPC handoff. The path is gated by `LOGIC_ENGINE_MEMORY_NPC_ENABLED === 'true'`.
4. `host-adapter/sillytavern-final-send-adapter.mjs` resolves trusted Host context and delegates the final outbound request.
5. `host-adapter/protected-memory-final-send.mjs` is the only insertion point found. It runs after the server-side generation handler has produced the serialized outbound request body.

Receiver/projection modules validate and prepare data; they do not independently append prompt messages or initiate model transport. Gateway event listeners attach locators only.

## Final-Send transport boundary review

The pinned chat-completion generation handler contains an auxiliary OpenRouter model-capability lookup (`GET /models`) that can execute inside the same request-local generation context as the final generation POST. The original Hook routed every `fetch()` call in that context through the protected dispatch Gateway. That incorrectly classified the auxiliary GET as a generation dispatch; the Gateway's POST-only request contract would reject it. The Hook now preserves the composed Host-abort signal but sends non-POST requests through SillyTavern's native fetch. Only POST requests continue into Final-Send. The pinned text-completion, Kobold, NovelAI text, and Horde text generation paths use POST for their final generation handoff.

This is a SillyTavern server transport-boundary correction. It does not call or test any model API, does not change Memory Provider behavior, and does not alter ST-VectorService.

## SillyTavern source inspection

The following files were read from the pinned upstream Git commit, not from a locally installed or extracted SillyTavern checkout:

| File | Git blob SHA | Inspection |
|---|---|---|
| `src/endpoints/backends/chat-completions.js` | `0d98c77f7b64502c5b0f504eaa1f67df0f26041e` | Server generation handler and serialized outbound body |
| `src/endpoints/backends/text-completions.js` | `c92fc3a14fabd0ad120f877874bc16353eed4831` | Flat completion request path |
| `src/endpoints/backends/kobold.js` | `895263199588a2f62d4102523921775e8136739c` | Text generation request path |
| `src/endpoints/novelai.js` | `30f6e70131f30517810a9650f7294efb6fb7467e` | Text generation request path |
| `src/endpoints/horde.js` | `4c256de981e5dc04b38537231f99e738f8940f05` | Text generation request path |

These are Git blob identifiers, not SHA-256 digests. The SHA-256 values previously listed from the local archive are not independently verified here and have been removed from this audit. No model API was called and no installed SillyTavern instance was used.
 
## Stage 0A serialization contract

- Protected Memory is serialized as a JSON data envelope with `type: logic_engine_untrusted_memory` and `trust_level: untrusted_data`.
- The envelope is appended to the first user message; if no user message exists, a user message is inserted after leading system messages. Existing system messages and the existing role sequence are preserved.
- The Memory value is serialized as a string. Embedded text, JSON, fake `role` fields, prompt delimiters, and instruction-like content cannot create new message objects or alter message roles.
- Only a serialized role-bearing `messages[]` body is accepted. A body without that structure is rejected before transport. Flat prompts and non-message formats are never guessed, rewritten, or used as a fallback.
- Ordinary generation without protected Memory retains the native transport path.

This is a structural privilege-boundary guarantee, not a claim that a model can never follow malicious content inside a user message. Prompt injection remains untrusted user-level content. No model API, model-provider integration, or provider-specific behavior is part of this contract.

## Runtime state and exclusions

- Memory→NPC remains disabled unless `LOGIC_ENGINE_MEMORY_NPC_ENABLED` is exactly `true`; otherwise the unavailable Gateway is used and the path fails closed.
- The live deployment value of that environment variable is **NOT VERIFIED**.
- No Core authority/acquisition/belief logic, Host authentication, Extension Gateway, ST-VectorService, or SillyTavern source file is changed.
- A full live SillyTavern chat-save E2E run is **NOT VERIFIED**.

## Verification target

Focused tests must prove:
- user-role-only insertion and preservation of the existing system role and message order;
- prompt-injection, fake-role, JSON and delimiter payloads remain inside the serialized data string without changing the message-role structure;
- non-message/flat serialized bodies are rejected before transport;
- ordinary unprotected generation remains native;
- Memory→NPC remains `DISABLED_FAIL_CLOSED`.

The full Runtime and Gateway Final-Send workflows must pass on the exact updated branch head.
