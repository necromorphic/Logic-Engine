# SillyTavern 1.19.0 — protected generation integration gate

**Status: PARTIAL / FAIL-CLOSED.**
**Read-only upstream source:** `SillyTavern/SillyTavern`, official tag `1.19.0`.
**Pinned commit:** `7e8663cd9c184a550b37238218bdd32c6efc68e9`.
**Implementation owner:** Logic-Engine only. No upstream changes, commits, PRs or Issues.

## 1. Approved architecture

`SillyTavern → untrusted Logic-Engine Client Extension → Extension Gateway → Authenticated Host Adapter → Core Security Gateway`

A managed local source-level patch of the installed ST distribution through the existing Logic-Engine Patch Manager is authorized. This does not permit a standalone Server Companion, additional API port, Provider URL substitution/relay, direct browser/ST → Core path, or bypass of Core Security Gateway.

**Patch Manager update:** the Logic-Engine branch now has a fixed allowlist for exact native integration files plus manifest-declared target paths, with the declared path set recorded in the transaction journal. Focused Patch Manager CI passed. Focused Patch Manager transaction CI passes, including positive native-source apply/rollback/recovery tests. This validates the manager, not an actual ST Final-Send patch or runtime integration.

## 2. Verified upstream source identity

The official tag `1.19.0` resolves to commit `7e8663cd9c184a550b37238218bdd32c6efc68e9`. The previous pin `06bde939fb1e9c4c8d8641d810f0a916b5bce127` is not the commit resolved by this official tag and must not be used as the 1.19.0 fingerprint.

| Source file | Blob SHA |
|---|---|
| `src/server-main.js` | `bcf5bed8d6248af1db5ed0d59796e2c284bde95b` |
| `src/server-startup.js` | `4bfc843b86ef76102889a4d931204f8ed04e3b61` |
| `src/endpoints/backends/chat-completions.js` | `0d98c77f7b64502c5b0f504eaa1f67df0f26041e` |
| `src/endpoints/backends/text-completions.js` | `c92fc3a14fabd0ad120f877874bc16353eed4831` |
| `src/endpoints/backends/kobold.js` | `895263199588a2f62d4102523921775e8136739c` |
| `src/endpoints/horde.js` | `4c256de981e5dc04b38537231f99e738f8940f05` |
| `src/endpoints/novelai.js` | `30f6e70131f30517810a9650f7294efb6fb7467e` |

## 3. Native server topology

`src/server-startup.js` mounts the native private routers, including:

- `/api/backends/text-completions`
- `/api/backends/kobold`
- `/api/backends/chat-completions`
- `/api/horde`
- `/api/novelai`

The server-plugin loader is separate from the client Extension Manager. It does not provide a supported pre-native-route middleware hook. Client extension hooks are untrusted and cannot establish the trusted final-send boundary.

## 4. Generation route inventory

### Chat Completions

`POST /api/backends/chat-completions/generate` in `src/endpoints/backends/chat-completions.js` has 13 provider-specific early-return sender branches:

1. Claude
2. AI21
3. MakerSuite
4. Vertex AI
5. Mistral
6. Cohere
7. DeepSeek
8. AIMLAPI
9. xAI
10. Chutes
11. MiniMax
12. ElectronHub
13. Azure OpenAI

The generic OpenAI-compatible path separately builds endpoint, headers, serialized body, stream and abort signal, then calls `fetch(endpointUrl, config)`. Specialized senders contain their own fetch call sites. A wrapper around only the generic fetch is incomplete. The file also contains model/status fetches; these are not generation egress and must not be caught by a global fetch monkey-patch.

### Other generation families

- Text Completions: `POST /api/backends/text-completions/generate`; provider-specific outbound transport paths.
- Kobold: `POST /api/backends/kobold/generate`; generation and a separate abort transport.
- Horde: `POST /api/horde/generate-text`; asynchronous task submission with separate status/cancel polling.
- NovelAI: `POST /api/novelai/generate`; text generation. Image and voice generation routes in the same file are distinct scopes and must be explicitly classified.

This is a route-family inventory, not yet a complete call-site proof. Exact sender-to-transport mapping, streaming, non-streaming, retries, cancellation and secondary requests remain to be enumerated. Static inventory CI must fail when a new protected sender/transport appears without a gate mapping.

## 5. Required Final-Send implementation

The managed patch must add one in-process final-dispatch boundary for protected generation while preserving original provider URL, headers, body, stream semantics, abort behavior and native response handling.

1. Authenticate the real ST session from server-owned state.
2. Resolve trusted installation/world/actor/purpose bindings; ignore caller-supplied authority fields.
3. Bind model, stream mode and exact serialized outbound body to the authorized request and accepted source/candidate set.
4. Enter Core Security Gateway / shared Coordinator dispatch-start contract.
5. Invoke the original provider transport synchronously under the dispatch-start lease; do not relay generation through Core.
6. Preserve revoke ordering and never automatically retry ambiguous transport start.
7. Revalidate the final response against the same trusted generation context before exposing it to the conversation.
8. Fail closed for any protected route/branch not explicitly covered by the installed patch manifest.

Route-entry middleware, browser generation events, prompt hooks, or wrapping only the generic fetch are insufficient. Global fetch monkey-patching is prohibited because it captures unrelated discovery, tokenization, metadata and extension traffic without trusted request context.

## 6. Runtime compatibility

ST 1.19.0 declares Node `>=20`; Logic-Engine requires Node `>=22.13.0` for `node:sqlite`. Patch Manager must verify the actual runtime used by the ST process before installing/activating the protected-generation package. If below the required version, activation remains disabled/fail-closed; do not introduce a separate relay.

## 7. Current status

| Area | Status |
|---|---|
| Official ST 1.19.0 source pin | VERIFIED: `7e8663cd9c184a550b37238218bdd32c6efc68e9` |
| Approved architecture | PRESERVED |
| Managed local source-level patch authorization | GRANTED |
| Patch Manager native-source support | IMPLEMENTED; focused CI PASSING |
| Real ST session authentication / Host Adapter | NOT WIRED |
| Single Extension Gateway ingress | IMPLEMENTED; official-tag patch/install/rollback CI PASS; live runtime and Host Adapter wiring pending |
| Core dispatch-start bound to ST senders | NOT WIRED |
| Complete sender/transport inventory test | NOT IMPLEMENTED |
| Final-Send interception | NOT IMPLEMENTED |
| Pre-LLM deny / zero upstream calls | NOT PROVEN |
| Final-response revalidation | NOT IMPLEMENTED |
| Production protected sending | DENY / FAIL-CLOSED |

## 8. Acceptance criteria

- Exact official ST commit and touched-file digests verified by Patch Manager.
- Source patch limited to explicitly approved, version-pinned ST files and Logic-Engine-owned runtime files.
- Transactional backup, durable journal, recovery, idempotency, update and safe rollback; never silently overwrite user edits.
- Actual ST process runtime version verified.
- Every protected route, sender branch and outbound transport mapped; CI rejects unclassified additions.
- Deny/stale/revoked/unknown/unavailable evidence produces zero provider calls.
- Allow path persists dispatch-start before exactly one original provider transport invocation under shared Coordinator lease.
- Streaming, non-streaming, cancellation, errors, retries, crash/restart and ambiguous-start behavior pass.
- Revocation/change during generation is detected before final response commit/delivery.
- Disposable ST 1.19.0 integration and installed-instance acceptance pass.
- No upstream changes, standalone Companion, extra port, Provider URL substitution/relay, direct browser/ST → Core, or vectorization changes.

Until all evidence passes, protected Memory dispatch remains `DISABLED / FAIL-CLOSED`.
