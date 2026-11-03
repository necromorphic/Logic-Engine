# SillyTavern Host Adapter and Final-Send integration

**Status: integration candidate. Protected Memory → NPC remains NON_READY / FAIL-CLOSED.**

## One generation ingress and one model egress path

The browser Extension does not intercept, abort, or independently dispatch generation. It listens to SillyTavern's awaited generation-data events and adds only four untrusted correlation fields to the native request:

- `logic_engine_conversation_uuid`
- `logic_engine_request_id`
- `logic_engine_context_size`
- `logic_engine_generation_type`

For Chat Completions it attaches these at `CHAT_COMPLETION_SETTINGS_READY`; for Text Completions, Kobold, NovelAI and Horde it attaches them at `GENERATE_AFTER_DATA`. It sends no chat text, Memory content, World/Actor ID, Core URL, or credentials. If browser-side identity preparation fails, ordinary generation is left untouched; when protected Memory is enabled, the server rejects the missing locator as NON_READY.

The managed pinned SillyTavern Final-Send Hook wraps all five native generation route families. The server-side Final-Send plugin derives the actual route from the Express request path, authenticates the Host session, and calls `createSillyTavernHostAdapter.prepareGenerationContext()` on that same request. The Host Adapter re-resolves the supplied conversation UUID against its complete server-side inventory, obtains Core's World/Actor binding, and retrieves the Core Memory NPC result. The NPC Context Receiver validates the exact ready envelope and source lineage before any content can be serialized into the upstream provider request.

There is no browser-facing `/dispatch` route. The old prototype that aborted native generation and returned Memory context to the browser has been removed from the installed Extension path. The only protected model egress is the native sender call intercepted by the managed Final-Send Hook.

## Public Host plugin routes

Install the server plugin directory under:

`plugins/logic-engine-extension-gateway/`

Install the browser extension directory under:

`public/scripts/extensions/third-party/logic-engine-extension-gateway/`

The Host plugin exposes only the bounded session, identity, inventory, lifecycle and version-ledger routes under:

`/api/plugins/logic-engine-extension-gateway/*`

It does not expose a Memory retrieval or model dispatch route. The Final-Send server plugin uses the Host Adapter directly in-process for the actual generation request.

Enable SillyTavern's native `enableServerPlugins: true` setting. Keep server-plugin auto-update disabled unless the plugin source is pinned and reviewed. All public Host routes remain behind ST login middleware and CSRF protection.

## Identity and inventory contract

- Installation and account IDs are generated and persisted by the server-side `HostIdentityStore`.
- The Host session UUID is read from the signed SillyTavern session and rechecked for each protected generation.
- The Host canonical conversation identity is `installation_id:account_id:conversation_uuid`; the signed ST `session_id` remains a separate context field. For Core binding, Host projects the authenticated scope to `host_session_id:host_installation_id:conversation_uuid`. The browser conversation UUID is only a locator; all other components are server-owned.
- The browser conversation UUID is only a locator. Host validates it against the complete server-side Host inventory before resolving Core context.
- Host carries the verified root ID, inventory sequence and manifest digest into the server-owned generation context. The Gateway must revalidate that inventory snapshot under the shared Coordinator before `DISPATCH_STARTED` and immediately before every actual client response write, including each streamed chunk and final end.
- World and Actor are never accepted from the browser; Host obtains them from Core-owned durable binding resolution.
- Core Security Gateway remains the sole World/Actor and Memory authorization authority.
- `LOGIC_ENGINE_HOST_IDENTITY_DIR` must be an absolute deployment-owned directory outside SillyTavern's global `DATA_ROOT`.
- `LOGIC_ENGINE_HOST_BUILD_SHA` is a deployment claim matched to the pinned commit, not runtime attestation.

The current Host root-inventory authority is review-only. A first baseline, unchanged review-only result, or unverified mutation is not production-authoritative. Consequently, the protected generation path remains NON_READY unless Core returns an authoritative complete inventory result.

## NPC Context Receiver and serialization

The server-side `receiveNpcContext()` accepts only a Core-produced `status: ready` envelope, verifies admitted/candidate identity pairs, requires exact source versions, rejects accessors/Proxy-backed values and bounds content size. It derives World/Actor from Core context and retains the authenticated Host tuple plus root inventory head.

The protected Final-Send serializer injects admitted content into the actual provider body after native provider transformations: a system message for Chat Completions, or the appropriate prompt/input field for Text Completions, Kobold, NovelAI and Horde. Host-only correlation fields are stripped before upstream transport. The Gateway ledger receives source/candidate metadata and the exact serialized body digest; Memory content is not copied into the durable ledger.

## Current production gate

The Host request → Core retrieval → NPC Context Receiver → exact request serialization path is implemented as an integration candidate. The in-process Gateway is still intentionally unavailable: production Core/Provider/Host evidence readers are not yet composed under the shared Coordinator. The server plugin therefore uses a non-transport Gateway stub. A non-empty protected Memory result is denied before native egress; it cannot fall through to an alternative sender. An authorized complete-empty result contains no protected content and may use the ordinary native path.

Do not enable `LOGIC_ENGINE_MEMORY_NPC_ENABLED=true` for production until the real Gateway readers, Host inventory revalidation, accepted-head checks, Coordinator lease, revoke race, crash/restart replay and final response write tests all pass on the same commit.
