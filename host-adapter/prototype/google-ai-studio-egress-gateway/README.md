# SillyTavern Google AI Studio Egress Gateway — integration checkpoint

Status: **prototype prepared; target-PC deployment and live Google request NOT verified**.

This component is the PC-side Google egress proxy. It is separate from the Logic-Engine Memory Dispatch Gateway and does not satisfy Memory→NPC dispatch authorization, identity binding, or durable dispatch-start requirements.

## Pinned Host baseline

- SillyTavern commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
- `src/endpoints/backends/chat-completions.js` blob: `0d98c77f7b64502c5b0f504eaa1f67df0f26041e`
- `src/endpoints/backends/google-models.js` blob: `ccd8cacbf0a74765859419675b4ec48dcd8bcd84`
- `src/endpoints/google.js` blob: `ea7e31994ae5e2b1bf1c0cf9a726662152f7747`
- `src/endpoints/vectors.js` blob: `f999b76a33aa940b7e65b26da03e9c03dd0e2d69`

The client patch was tested against a clean copy of that pinned source:
- `git apply --check`: PASS
- patch application without Git metadata: PASS
- targeted Node tests: 10/10 PASS
- syntax checks for five changed JavaScript modules: PASS
- `git diff --check`: PASS

## Gateway contract

The Node.js 22+ PC service:
- binds only to `127.0.0.1`;
- requires a 32+ character shared Bearer secret and compares it with `timingSafeEqual`;
- keeps the Google AI Studio API key in process memory and injects it upstream as `x-goog-api-key`;
- strips client-supplied authorization/API-key headers and rejects API-key query parameters;
- fixes the upstream host to `generativelanguage.googleapis.com`;
- allows only the documented model-list, generate, streaming-generate, embedding, and predict routes;
- streams request and response bodies without logging prompts;
- enforces request-size and timeout limits;
- exposes unauthenticated local `/health` and authenticated `/ready`.

Gateway tests: 9/9 PASS against a local mock upstream. Process smoke: `/health` and authenticated `/ready` PASS. No real Google API key or Google request was used. `/ready` proves only local process/password readiness; it does not validate Google credentials or upstream availability.

## Deployment constraints

- No installed SillyTavern instance was modified.
- Windows PowerShell launch scripts have not been executed on the target PC.
- Real upstream compatibility, Google quotas, and streaming behavior require a target-PC smoke test.
- This loopback proxy does not prevent other processes from connecting directly to Google. OS-level firewall/egress isolation is not implemented or verified.
- Vertex AI, Google Translate TTS, and Google video generation are blocked by the client patch in mandatory mode because they are outside this gateway contract.
- Do not enable mandatory mode until the gateway is deployed and a real model-list or minimal Gemini request succeeds.

## Security note

The uploaded ST-VectorService `start.bat` contained a literal service Bearer secret. Treat it as exposed. Rotate it and move the replacement into protected runtime configuration before reusing that service. The secret itself is intentionally not recorded here.

## Relationship to Logic-Engine integration

This package does **not** implement the Logic-Engine Memory Dispatch Gateway. Memory→NPC remains DISABLED / FAIL-CLOSED. Outstanding integration gates include trusted Host-session identity, canonical actor/world resolution, pre-serialization NPC context preparation, exact outbound request binding, a single protected dispatch egress, and durable ordering against Core/Provider revocation and readiness changes.

See the current integration portfolio register in Notion and Logic-Engine issues #258, #264, #356, and Core PR #721 for the separate Memory→NPC release gates.
