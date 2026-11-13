# SillyTavern Host Adapter and Final-Send integration

**Status: production-composition candidate; exact-head acceptance remains pending. Protected Memory remains FAIL-CLOSED until all deployment authorities and CI gates are ready.**

## One generation ingress and one model egress path

The browser Extension does not intercept, abort, or independently dispatch generation. It listens to SillyTavern's awaited generation-data events and adds only five untrusted correlation fields to the native request:

- `logic_engine_conversation_uuid`
- `logic_engine_request_id`
- `logic_engine_generation_id`
- `logic_engine_context_size`
- `logic_engine_generation_type`

For Chat Completions it attaches these at `CHAT_COMPLETION_SETTINGS_READY`; for Text Completions, Kobold, NovelAI and Horde it attaches them at `GENERATE_AFTER_DATA`. It sends no chat text, Memory content, World/Actor ID, Core URL, or credentials. If browser-side identity preparation fails, ordinary generation is left untouched; when protected Memory is enabled, the server rejects the missing locator as NON_READY.

The managed pinned SillyTavern Final-Send Hook wraps all five native generation route families. The server-side Final-Send plugin derives the actual route from the Express request path, authenticates the Host session, and calls `createSillyTavernHostAdapter.prepareGenerationContext()` on that same request. Host preparation performs only the authoritative Host inventory/session check and returns its branded in-process binding. It does not call `/v1/host-context/resolve` or `/v1/host/memory-npc/retrieve`; Core World/Actor resolution, both NPC evidence lanes, and the one-shot handoff are performed by the embedded Core runtime under the Host AsyncLocalStorage capability. The NPC Context Receiver validates the exact ready envelope and source lineage before any content can be serialized into the upstream provider request.

**Current wiring state:** this directory's `server-plugin/index.mjs` is the separate public Host-ingress plugin; it registers only bounded Host Adapter routes. The native Final-Send Hook is owned by the repository-root `index.mjs`, installed as `plugins/logic-engine/index.mjs`. That entrypoint now constructs `createEmbeddedGatewayRuntime()`, registers its real `MemoryDispatchGateway`, and connects `createNpcGenerationContextHostBridge()` to the authenticated Host request/response lifecycle. The opaque one-shot handoff is consumed synchronously at dispatch; the Host AsyncLocalStorage capability remains active through model execution and final response revalidation. The embedded Gateway composes synchronous Core, Provider and Host evidence readers under the shared Coordinator. Host session revocation is re-read from the separate `ENGINE_HOST_ASSERTION_NONCE_DB_PATH` ledger at dispatch-start and final release; the Core revocation writer acquires the same Coordinator lease before committing. `unavailableGateway` is retained only when Memory integration is explicitly disabled.

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



### Chat lifecycle ownership

The pinned SillyTavern lifecycle patch is the sole owner of `CHAT_CHANGED` enrollment. Its listener starts the idempotent baseline/recovery operation in the background and returns immediately, so SillyTavern's awaited event bus does not wait for Host recovery. The Gateway browser extension registers only generation-identity hooks; it must not add another `CHAT_CHANGED` listener, call `syncCurrentDigestInventory()` on chat load, or trigger a full-root inventory scan during chat switching.

A new or reopened chat is enrolled through `ensureCurrentConversationEnrolled()`. The first instrumented mutation remains a fallback if chat-load capture was unavailable. Full-root inventory verification is a separate authority check performed by the Host Adapter when required for protected generation or explicit reconciliation. Review-only or incomplete inventory remains NON_READY and does not authorize Memory retrieval or model disclosure.

## Identity and inventory contract

- Installation and account IDs are generated and persisted by the server-side `HostIdentityStore`.
- The Host session UUID is read from the signed SillyTavern session and rechecked for each protected generation.
- The Host canonical conversation identity is `installation_id:account_id:conversation_uuid`; the signed ST `session_id` remains a separate context field. For Core binding, Host projects the authenticated scope to `host_session_id:host_installation_id:conversation_uuid`. The browser conversation UUID is only a locator; all other components are server-owned.
- The browser conversation UUID is only a locator. Host validates it against the complete server-side Host inventory before resolving Core context.
- Host carries the verified root ID, inventory sequence and manifest digest into the server-owned generation context. The Gateway must revalidate that inventory snapshot under the shared Coordinator before `DISPATCH_STARTED` and immediately before every actual client response write, including each streamed chunk and final end.
- World and Actor are never accepted from the browser; Host obtains them from Core-owned durable binding resolution.

### Automatic first-time World binding

For a single-World deployment, set `ENGINE_HOST_DEFAULT_WORLD_ID` in the **Core API process** to the ID of an already-created canonical World. After updating the Logic-Engine checkout, stop SillyTavern and run `scripts/Update-LogicEngine-Host-Plugin.ps1 -SillyTavernRoot <path>`; it backs up and upgrades the complete managed patch bundle, Patch Manager artifacts, Gateway server plugin and browser extension, then verifies the installed patch state and pinned source manifest. It preserves chat data, Core databases, Host identity and SQLite application data. On the first protected generation for each session-scoped Host conversation, the Host Adapter sends only its authenticated session/installation/conversation identity to Core. Core creates and audits the missing binding to that deployment-owned default World; the browser cannot submit or select a World. The embedded Gateway opens the Core database read-only, so this binding is persisted through the authenticated Core API before the embedded reader resolves it. Existing bindings are reused; revoked bindings are never silently restored. Multi-World deployments must use an explicit audited assignment workflow.

The first lifecycle preflight can occur before the first generation has created a Root Inventory snapshot. If Core returns exactly `HOST_LIFECYCLE_NOT_AUTHORIZED`, the Host lifecycle proxy invokes the same authenticated Host inventory gate used by generation and retries the status read once. It does not retry other authorization failures, perform enrollment, or rebind revoked identities.

- Core Security Gateway remains the sole World/Actor and Memory authorization authority.
- `LOGIC_ENGINE_HOST_IDENTITY_DIR` must be an absolute deployment-owned directory outside SillyTavern's global `DATA_ROOT`.
- `LOGIC_ENGINE_HOST_BUILD_SHA` is a deployment claim matched to the pinned commit, not runtime attestation.

Host root-inventory authority is accepted only when the persisted lifecycle chain is complete and the latest signed Root Inventory Attestation verifies against the deployment-owned root identity registry and exact pinned source-manifest digest. The embedded Gateway rechecks this read-only authority under its shared Coordinator lease at dispatch-start and final response release. First baselines, review-only inventory, unverified mutations, missing registry entries or invalid signatures remain NON_READY. Fresh-account lifecycle genesis is implemented in this candidate: lifecycle sequence zero is accepted only with the all-zero genesis digest, and the first real event advances the journal to sequence one. The Core API regression covers valid genesis, nonzero-genesis rejection and first append; live Windows acceptance is still required.

## NPC Context Receiver and serialization

The Core NPC Generation Context Builder produces an immutable context with separate Lane A (Core-authorized knowledge acquisitions) and Lane B (Provider-backed Memory evidence). The Host bridge binds its opaque handoff to the exact SillyTavern request and response objects; it never serializes context across HTTP or browser boundaries. The Gateway consumes that handoff once and obtains the Lane-B evidence cursor and Lane-A revalidation closure.

The protected Final-Send serializer projects Lane A and Lane B into separate labelled sections after native provider transformations: a system message for Chat Completions, or the appropriate prompt/input field for Text Completions, Kobold, NovelAI and Horde. Lane A retains acquisition/fact/subject/predicate/value and provenance; internal authorization references stay in the Gateway evidence envelope and are not copied into the model prompt. Lane B retains epistemic kind and evidence assessment. Host-only correlation fields, including request and generation IDs, are stripped before upstream transport. The Gateway ledger receives source/candidate metadata and the exact serialized body digest; Memory content is not copied into the durable ledger.

## Current production gate

The Host request → Core scope resolution → NPC Builder/Receiver → one-shot Host bridge → Gateway → model transport → Final-Send response release path is now composed in the root plugin. The Gateway performs durable dispatch-start, accepted-head/Core/Provider/Host evidence reads and final response revalidation. Non-empty Lane A and Lane B are projected separately; a complete-empty result may use native generation only after both lanes are independently revalidated and empty. Any missing handoff, non-ready lane, unknown sender, revoke race, stale Host inventory, missing authority or ambiguous dispatch is terminal and cannot fall through to an alternative sender.

This is still an integration candidate, not P0 acceptance: exact-head CI, pinned installed-source attestation, and the full sender/stream/revoke/retry/cancel/crash matrix remain outstanding.

Do not enable `LOGIC_ENGINE_MEMORY_NPC_ENABLED=true` for production until the real Gateway readers, Host inventory revalidation, accepted-head checks, Coordinator lease, revoke race, crash/restart replay and final response write tests all pass on the same commit.
