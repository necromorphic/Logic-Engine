# Stage 0A — protected Memory prompt boundary audit

**Audit base:** PR #949 branch head used when Stage 0A was opened: `4e57147475db805cc538c51b323f1b3eebfc7cb6`.

**SillyTavern source:** supplied release archive, version `1.19.0`. The five pinned server generation files match the repository source manifest (hashes below).

**Scope:** prompt serialization and role boundary only. No Core authority/acquisition/belief changes, no Gateway/authentication rewrite, no ST-VectorService changes, and no new Memory→NPC mechanism.

## Memory-to-prompt path inspected

1. `host-adapter/extension-gateway/index.js` attaches opaque conversation/request/generation locators; it does not insert Memory text.
2. `host-adapter/extension-gateway/server-plugin/host-adapter.mjs` authenticates Host requests and prepares Host context; it does not serialize Memory into the prompt.
3. `index.mjs` conditionally constructs protected Memory from the one-shot NPC handoff. The path is gated by `LOGIC_ENGINE_MEMORY_NPC_ENABLED === 'true'`.
4. `host-adapter/sillytavern-final-send-adapter.mjs` resolves trusted Host context and delegates the final outbound request.
5. `host-adapter/protected-memory-final-send.mjs` is the only insertion point found. It runs after the server-side generation handler has produced the serialized outbound request body.

Receiver/projection modules validate and prepare data; they do not independently append prompt messages or initiate model transport. Gateway event listeners attach locators only.

## SillyTavern source verification

| Pinned server file | SHA-256 | Result |
|---|---|---|
| `src/endpoints/backends/chat-completions.js` | `53f429859efcfb29dd8becfebf7ff0ae49256ea795a0c81c320930fab5a407e7` | PASS |
| `src/endpoints/backends/text-completions.js` | `877b2b6279091c70495e561c00ce021592205e1d42ea4fe5f20f23dd67071971` | PASS |
| `src/endpoints/backends/kobold.js` | `ce23d72599580d5822d17fda14c8413882237c1ab984b1be63ee063256286801` | PASS |
| `src/endpoints/novelai.js` | `0b6b41052ae0311ae6e716955b0805a44b1b63e3a58bf403b81becf0ff1b04ce` | PASS |
| `src/endpoints/horde.js` | `9a0280cfa2c5498f540b8593b100e80cbacdefa563038a6cc6c60c9c9923f3f4` | PASS |

The supplied archive's `package.json` reports version `1.19.0`. The hashes were recomputed directly from the supplied archive.

## Stage 0A serialization contract

- Protected Memory is serialized as a JSON data envelope with `type: logic_engine_untrusted_memory` and `trust_level: untrusted_data`.
- The envelope is appended to the first user message; if no user message exists, a user message is inserted after leading system messages. Existing system messages and the existing role sequence are preserved.
- The Memory value is serialized as a string. Embedded text, JSON, fake `role` fields, prompt delimiters, and instruction-like content cannot create new message objects or alter message roles.
- Only a serialized role-bearing `messages[]` body is accepted. A body without that structure is rejected before transport. Flat prompts and non-message formats are never guessed, rewritten, or used as a fallback.
- Ordinary generation without protected Memory retains the native transport path.

This is a structural privilege-boundary guarantee, not a claim that a model can never follow malicious content inside a user message. Prompt injection remains untrusted user-level content. No model/provider-specific behavior is part of this contract.

## Runtime state and exclusions

- Memory→NPC remains disabled unless `LOGIC_ENGINE_MEMORY_NPC_ENABLED` is exactly `true`; otherwise the unavailable Gateway is used and the path fails closed.
- The live deployment value of that environment variable is **NOT VERIFIED**.
- No Core authority/acquisition/belief logic, Host authentication, Extension Gateway, ST-VectorService, or SillyTavern source file is changed.
- A full live SillyTavern chat-save E2E run is **NOT VERIFIED**.

## Verification target

Focused tests must prove:
- user-role-only insertion and preservation of the existing system role and message order;
- prompt-injection, fake-role, JSON and delimiter payloads remain inside the serialized data string;
- non-message/flat serialized bodies are rejected before transport;
- ordinary unprotected generation remains native;
- Memory→NPC remains `DISABLED_FAIL_CLOSED`.

The full Runtime and Gateway Final-Send workflows must pass on the exact updated branch head.
