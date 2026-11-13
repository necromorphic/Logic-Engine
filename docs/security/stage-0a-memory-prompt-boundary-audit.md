# Stage 0A — protected Memory prompt boundary audit

**Audit base:** PR #949 head `4e57147475db805cc538c51b323f1b3eebfc7cb6`

**SillyTavern source:** release archive supplied for this task, version `1.19.0`; the five server generation files below match the repository's pinned `before` SHA-256 values.

**Scope:** prompt serialization and role boundary only. No Core authority/acquisition/belief changes, no Gateway/authentication rewrite, no ST-VectorService changes, and no new Memory→NPC mechanism.

## Findings

### 1. Memory-to-prompt call path

The inspected production-shaped path is:

1. `host-adapter/extension-gateway/index.js` adds only opaque conversation/request/generation locators to SillyTavern generation data. It does not insert Memory text.
2. `host-adapter/extension-gateway/server-plugin/host-adapter.mjs` authenticates the Host request and prepares Host context. It does not serialize Memory into the model prompt.
3. `index.mjs` (the native Final-Send plugin entrypoint) conditionally builds protected Memory from the one-shot NPC handoff. The feature is gated by `process.env.LOGIC_ENGINE_MEMORY_NPC_ENABLED === 'true'`.
4. `host-adapter/sillytavern-final-send-adapter.mjs` resolves the trusted context and delegates the final outbound request to `host-adapter/protected-memory-final-send.mjs`.
5. `serializeProtectedRequestBody()` is the sole prompt insertion point found in the inspected source tree. The managed SillyTavern hook intercepts the provider `fetch` after SillyTavern has built and JSON-serialized the provider request body.

The receiver/projection modules (`host-adapter/npc-context-receiver.mjs`, `host-adapter/npc-generation-content-projection.mjs`, `src/application/npc-generation-context*.js`) prepare and validate data; they do not independently append messages or call a model transport. The Extension Gateway event listeners attach locators only.

### 2. Actual SillyTavern 1.19.0 wire shapes

The supplied archive reports package version `1.19.0`. Its generation source hashes match the pinned repository manifest:

| SillyTavern server file | SHA-256 | Result |
|---|---|---|
| `src/endpoints/backends/chat-completions.js` | `53f429859efcfb29dd8becfebf7ff0ae49256ea795a0c81c320930fab5a407e7` | PASS |
| `src/endpoints/backends/text-completions.js` | `877b2b6279091c70495e561c00ce021592205e1d42ea4fe5f20f23dd67071971` | PASS |
| `src/endpoints/backends/kobold.js` | `ce23d72599580d5822d17fda14c8413882237c1ab984b1be63ee063256286801` | PASS |
| `src/endpoints/novelai.js` | `0b6b41052ae0311ae6e716955b0805a44b1b63e3a58bf403b81becf0ff1b04ce` | PASS |
| `src/endpoints/horde.js` | `9a0280cfa2c5498f540b8593b100e80cbacdefa563038a6cc6c60c9c9923f3f4` | PASS |

Important provider differences observed in the pinned source:

- Claude serializes `system` separately from `messages[]`; the message converter moves leading system messages into that field.
- Google AI Studio and Vertex AI serialize `contents[]` and a separate `systemInstruction`. They do **not** send a `messages[]` field to Google.
- AI21 and Cohere use provider-specific conversions of `messages[]`; AI21 merges adjacent messages with the same role.
- Mistral, Azure OpenAI, and the generic OpenAI-compatible senders use message arrays, with provider-specific transformations.
- Text Completions, Kobold, NovelAI, and Horde use a flat `prompt`/`input` string or a direct JSON request body, not a role-bearing chat message array.

The prior test fixture for Google incorrectly modeled its outbound body as `messages[]`. That fixture did not represent the pinned SillyTavern backend.

## Changes in this stage

- Chat Completions Memory is now appended to the first existing `role: 'user'` message (after its existing content). The provider's message-role sequence is unchanged. If no user message exists, a user message is added after leading system messages. The Memory content is a JSON envelope with `type: logic_engine_untrusted_memory`, `trust_level: untrusted_data`, and a string-valued `data` field.
- Existing system messages and their contents are preserved; Memory content is never interpreted as a message object and cannot provide a message role. Existing user messages remain user messages; no additional role is introduced when a user turn already exists.
- Google AI Studio and Vertex AI receive the envelope as an additional text part in the first existing `contents[]` user turn. If no user turn exists, a user content is inserted before model turns. Their separate `systemInstruction` is left untouched.
- Role-less prompt routes (Text Completions, Kobold, NovelAI and Horde) have no role boundary. Protected Memory is rejected before provider transport on these routes; ordinary unprotected generation continues natively.
- Host-only locators continue to be removed before provider serialization.

## Security boundary and limitation

This change proves a structural property: retrieved Memory is not assigned the provider's `system` role, is not placed in Google's `systemInstruction`, and cannot create additional message objects or roles through embedded text/JSON. When a user turn exists, the original role sequence is preserved and only that user turn's content is extended. Prompt-injection strings and fake `role: system` fields remain inside the serialized data string. Routes with no role-bearing structure reject protected Memory before transport rather than flattening it into a prompt.

No serialization scheme can prove that a language model will never follow malicious text placed in a user message or a flat prompt. This stage removes the privilege escalation to the system channel; it does not claim model-level immunity to all prompt injection. A stronger semantic policy would require separately reviewed trusted system instructions/model-side controls and is outside this stage.

## Runtime state and exclusions

- `index.mjs` enables Memory→NPC only when `LOGIC_ENGINE_MEMORY_NPC_ENABLED` is exactly `true`; otherwise it uses the unavailable Gateway and reports `DISABLED_FAIL_CLOSED`. This stage does not change that gate.
- The deployment's live environment variable value was not accessible during this source-level task: **NOT VERIFIED**.
- No Final-Send hook, Host authentication, Extension Gateway, Core authority/acquisition/belief logic, ST-VectorService, or SillyTavern source file was changed.
- Ordinary generation without protected Memory retains the existing native transport path. SillyTavern chat persistence code is unchanged; a full live chat-save E2E test was not run in this stage.

## Verification target

The focused Node test file `tests/protected-memory-final-send.test.js` exercises every registered chat-completion sender route (26 routes), including the provider-specific Claude, Gemini/Vertex, Cohere and AI21 wire shapes. It asserts that the system channel is unchanged, Memory is appended only inside an existing user turn, fake role claims remain data, and role-less Text Completions/Kobold/NovelAI/Horde routes fail closed with zero transport calls. The Host→Core→Provider→Receiver→Final-Send integration test uses the pinned Gemini `contents[]` body shape. The full repository CI is the final execution check for this branch.
