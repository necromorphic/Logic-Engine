# Installing the Logic-Engine final-send bridge in SillyTavern 1.19

Target file: `src/endpoints/backends/chat-completions.js`  
Pinned source reviewed: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

This integration note is not a claim that the SillyTavern checkout has already been modified. The Logic-Engine PR contains the bridge modules; the Host file still needs the wiring below.

## 1. Import aliases

Replace the default `node-fetch` import with an alias:

```js
import nativeFetch from 'node-fetch';
```

Replace the existing util import of `forwardFetchResponse` with an alias:

```js
import {
    forwardFetchResponse as nativeForwardFetchResponse,
    // retain the other existing util imports
} from '../../util.js';
```

Import the bridge and final-send adapter from the installed Logic-Engine Host adapter package. The exact relative import path depends on where that package is installed.

## 2. Construct the boundary once

The Host bootstrap must inject the live in-process `MemoryDispatchGateway` instance and a synchronous resolver backed by trusted server-side request state. The resolver contract is strict:

- return an authorization context only when the Host has independently established that the prompt contains protected Memory;
- return explicit `null` only when the request is definitely not carrying protected Memory;
- throw or return `undefined` for unknown/indeterminate state (the helper fails closed);
- never inspect a browser-supplied boolean, endpoint, credential, header, or grant as authorization.

Construct `createProtectedMemoryFinalSend({ gateway, resolveProtectedMemory })`, then pass it to `createSillyTavernGenerationBridge` with `nativeFetch`, `nativeForwardFetchResponse`, and a source-to-route resolver.

The source resolver must map every enabled `CHAT_COMPLETION_SOURCES` value to one of the adapter's registered route IDs. Map both MakerSuite and Vertex AI separately; map the generic OpenAI-compatible sources individually. A missing mapping for protected Memory is a hard denial.

## 3. Replace local fetch and stream forwarding

After constructing the bridge, bind its methods as the local functions used by this module:

```js
const fetch = generationBridge.fetch.bind(generationBridge);
const forwardFetchResponse = generationBridge.forwardFetchResponse.bind(generationBridge);
```

This intercepts all provider fetch calls made inside the generation async context, including the 13 dedicated sender functions and the generic sender. Fetches outside that context (model discovery/status endpoints) continue through `nativeFetch`.

## 4. Wrap the single /generate handler

Wrap the existing handler's complete async body in:

```js
return generationBridge.run(request, response, async () => {
    // existing /generate try/switch/provider dispatch/catch body, unchanged
});
```

Do not wrap the model-list/status routes. Do not add a second send path. Do not allow a protected request to fall back to the original `nativeFetch`.

## 5. Integration acceptance tests

The Host patch is not complete until tests against the pinned SillyTavern module prove:

1. Each of the 13 dedicated sender routes calls the bridge and never calls `nativeFetch` directly for protected Memory.
2. Every generic source family is routed through the same bridge.
3. Every non-generation discovery/status fetch remains outside the bridge.
4. Protected Memory resolver returns explicit denial on missing/ambiguous context.
5. Exact final serialized body, endpoint and headers are preserved.
6. Streaming forwards exactly once; forwarding failure leaves Gateway outcome `UNKNOWN`.
7. Revocation ordered before `DISPATCH_STARTED` produces zero upstream calls for every route.
8. Unknown/unregistered protected sender route produces zero upstream calls.
9. No alternate provider sender, fallback or retry can issue a second request.

The Gateway JSON endpoint intentionally returns `503 IN_PROCESS_TRANSPORT_REQUIRED`; do not restore JSON-based dispatch as a workaround.
