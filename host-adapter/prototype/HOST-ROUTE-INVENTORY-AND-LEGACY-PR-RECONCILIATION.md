# Host/Adapter — pinned outbound route inventory and legacy PR reconciliation

**Pinned SillyTavern target:** `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

**Status:** bounded source inventory, not proof of exhaustive model-call coverage. All listed routes remain unsupported for protected Memory→NPC material unless an approved last-boundary gate and route-specific no-egress test exist. Memory→NPC remains DISABLED / FAIL-CLOSED. No runtime authorization gate is added here.

## Reproducible source sweep

The following counts were obtained by fetching each named file at the exact pinned SHA and counting literal `fetch(` occurrences and `router.post(` declarations. Counts are file-level search counts, **not** counts of unique inference calls: a file can contain model discovery/status, polling, abort, media download, or unrelated API traffic. The classification column identifies why the file matters; every branch still needs call-site review.

| Pinned source path | Lines | `fetch(` count | `router.post(` count | Relevance / disposition |
|---|---:|---:|---:|---|
| `src/endpoints/backends/chat-completions.js` | 2996 | 29 | 4 | Chat-completion dispatch and provider-specific send branches; enumerate each selected provider branch, no shared gate proven |
| `src/endpoints/backends/text-completions.js` | 647 | 15 | 3 | Text-completion dispatch and provider/local backends; separate family, no gate proven |
| `src/endpoints/backends/kobold.js` | 282 | 7 | 4 | Additional text-generation backend family; separate path, no gate proven |
| `src/endpoints/openai.js` | 930 | 16 | 16 | Image caption, voice, embedding model lists, image/video generation, transcription; not covered by chat/text completion routes |
| `src/endpoints/azure.js` | 89 | 2 | 2 | Separate text generation endpoint |
| `src/endpoints/novelai.js` | 482 | 5 | 4 | Text, image, voice endpoints; distinct paths |
| `src/endpoints/google.js` | 642 | 8 | 7 | Caption, voice/TTS, image and video endpoints; distinct paths |
| `src/endpoints/horde.js` | 409 | 7 | 11 | Text/image generation, caption and task polling/cancel |
| `src/endpoints/stable-diffusion.js` | 2216 | 68 | 10 | Many provider-specific image/video calls and polling paths; not an LLM-only file |
| `src/endpoints/caption.js` | 30 | 0 | 1 | Local image-to-text route; local inference can still disclose protected input to a model |
| `src/endpoints/speech.js` | 433 | 9 | 2 | Recognition/synthesis and provider calls |
| `src/endpoints/minimax.js` | 228 | 2 | 1 | Voice generation and media retrieval |
| `src/endpoints/volcengine.js` | 137 | 1 | 1 | Voice generation |
| `public/scripts/openai.js` | 7397 | 9 | 0 | Browser Chat Completions caller; includes the generation request and unrelated fetches |
| `public/scripts/textgen-settings.js` | 1850 | 3 | 0 | Text-generation settings/status/props; separate pre-request event is not a send gate |
| `public/scripts/bookmarks.js` | 741 | 3 | 0 | Group/chat creation callers relevant to source lifecycle, not model inference |
| `src/endpoints/chats.js` | 1153 | 0 | 13 | Chat save/get/delete/import/export/group-import/group-delete routes affecting lifecycle inventory |
| `src/endpoints/groups.js` | 235 | 0 | 4 | Group create/edit/delete routes affecting lifecycle inventory |

Search method can be reproduced against the pinned checkout with:
```sh
git -C SillyTavern rev-parse HEAD
rg -n 'fetch\\s*\\(|axios\\s*\\.|router\\.post\\s*\\(' \
  src/endpoints public/scripts/openai.js public/scripts/textgen-settings.js public/scripts/bookmarks.js
```
The exact SHA must equal the pin above. This is a bounded first-pass sweep over the named files, not a declaration that all extension/custom/native callers or every outbound library are covered. Remaining routes/callers not individually inventoried are **UNSUPPORTED / FAIL-CLOSED** for protected candidates.

## Route boundary matrix

| Route family | Last point found / observed | Gate status | Required test before protected use |
|---|---|---|---|
| Browser Chat Completions | `public/scripts/openai.js`, `sendOpenAIRequest()`: after generation parameters, awaits `CHAT_COMPLETION_SETTINGS_READY`, then serializes and POSTs `/api/backends/chat-completions/generate` | No installed authorization check; UI extension event is not provider-send authorization | Deny/error/unknown must prevent UI POST; separately prove server-side gate blocks provider egress |
| Server Chat Completions | `src/endpoints/backends/chat-completions.js`, `POST /generate`, then provider-specific `send*Request` branches | No approved gate; multiple provider branches | Recording transport per enabled branch; deny/error/unknown/revoked/scope mismatch => zero outbound calls |
| Server Text Completions | `src/endpoints/backends/text-completions.js`, `POST /generate`, provider rewrites and separate fetch branches | No approved gate; separate family | Same no-egress test for each enabled branch |
| Kobold and other text-generation backend paths | `src/endpoints/backends/kobold.js` and any other enabled backend/caller | Not covered by a gate established for Chat Completions | Enumerate each enabled branch; unknown/unreviewed branch stays unavailable for protected candidates |
| Caption, image, video, speech/voice, transcription, embedding and local inference | `openai.js`, `azure.js`, `novelai.js`, `google.js`, `horde.js`, `stable-diffusion.js`, `caption.js`, `speech.js`, `minimax.js`, `volcengine.js` | No universal disclosure gate established; not necessarily in the intended Memory→NPC path, so do not inject protected content there | Route-specific scope decision and tests; unknown route remains unsupported |
| Extensions, custom routes, native/server callers, any files not in the bounded sweep | No complete call-site inventory established | Unobservable / unsupported | Search and inventory all enabled call sites before any allowlist can be called complete |

A check at `CHAT_COMPLETION_SETTINGS_READY` cannot close the race after candidate assembly. The required race test is: assemble candidate, pause before the actual final boundary, edit/delete/retract source or revoke access/change scope, resume, and assert zero real outbound provider requests containing protected content or metadata. This test requires Core-approved authorization semantics and Provider-owned currentness/revocation evidence; it is not implemented or claimed.

## Lifecycle matrix (evidence class, not readiness assertion)

| Operation | Status | What evidence actually exists / gap |
|---|---|---|
| Create/insert message | **Implemented in prototype; test coverage simulated** | Bridge hooks and FakeDB tests; native path ordering source-inspected, not all send paths experimentally reproduced |
| User send / `MESSAGE_SENT` | **Source-inspected + existing redacted diagnostic sample; not complete runtime proof** | Event index is mutable; not durable identity or user-visible delivery proof |
| Generation start | **Source-inspected + existing sample; identity incomplete** | `GENERATION_STARTED(type, options, dryRun)`; no durable generation ID proven |
| Streaming update/finalize | **Patch/CI + simulated tests** | Patch proposes checkpoint ordering; no real browser crash/persistence or Android evidence |
| Generation end / `MESSAGE_RECEIVED` | **Source-inspected + patch/CI** | In pinned path `MESSAGE_RECEIVED` precedes native `saveChatConditional()`; event is not persistence, display, delivery, receipt, acquisition or belief |
| Stop/cancel/error/partial output | **Partly guarded in prototype; runtime unverified** | Failure paths are intended not to advance completed checkpoint; partial native mutation/persistence remains unproven |
| Regenerate / create alternate swipe | **Prototype tests simulated** | Version identities and branch semantics are enrollment-forward; no durable native generation/branch identity |
| Select swipe | **Prototype pre-mutation ordering test; simulated** | Hook order tested; no real IndexedDB/device persistence proof |
| Delete alternate swipe | **Prototype test coverage simulated** | Selected patched paths only; not all delete variants, copies or restores |
| Edit/update message | **Prototype test coverage simulated** | Digest/version lineage assertions; external/editor/extension mutations not exhaustively covered |
| Delete message(s) | **Prototype test coverage simulated** | Pre-mutation snapshots only for hooked paths; native deletion event payload is not the deleted identity/set |
| Chat switch / load / clear | **Partly source-inspected; runtime incomplete** | Conversation-bound bridge checks exist; cross-chat persistence and all clear/reset paths not proven |
| Chat/group/recursive deletion | **Unsupported / fail-closed** | Server-side file operations are outside current-message-array bridge; do not infer coverage from UI events |
| Import/export/restore/copy/branch/migration | **Unsupported / not reconciled** | Some endpoints/functions source-inspected, but no complete before/after persisted artifact evidence or identity lineage proof |
| Restart/reload/replay | **FakeDB replay tests only** | No real browser IndexedDB durability test, no Android/Termux process-kill/restart proof |
| Rollback / external file edits / missed events | **Unobservable or fail-closed** | Fingerprint mismatch can detect some divergence only when reconciliation runs; complete inventory not proven |
| Raw content retention | **Not approved; prototype excludes raw text from journal** | Digest-only ledger cannot reconstruct message content; no content transfer contract approved |
| Final authorization / revocation race | **Unsupported** | No callable approved Core decision contract or last-pre-dispatch Host gate; no real outbound no-egress race test |

Evidence categories used here:
- **Source-inspected:** exact pinned source reviewed; not an experiment.
- **Patch/CI:** patch applies and prototype tests run in CI; not a real host runtime.
- **Simulated:** FakeDB/simulated `saveChat`; not browser IndexedDB.
- **Unsupported/unobservable:** no proof; keep disabled/fail-closed.

## Legacy Host PR reconciliation

| Work | Unique material | Canonical disposition |
|---|---|---|
| [#275](https://github.com/necromorphic/Logic-Engine/pull/275) | Separate 536-line review-only patch; includes pre-delete snapshots and import/copy re-keying proposals not present in the current 314-line prototype patch | **Do not apply/merge as-is.** Keep as a source of review items only. Port its import/copy ideas into the canonical audit as **unsupported requirements**, not as implemented hooks; its own body admits the save path swallows persistence errors and inventory remains incomplete |
| [#322](https://github.com/necromorphic/Logic-Engine/pull/322) | Earlier prototype patch/tests plus the distinct `HOST-PROVIDER-HANDOFF-PROPOSAL.md` | Treat its code/tests as superseded by expanded #323; retain the handoff proposal as review-only material in the canonical Host documentation path. Do not represent it as approved API/schema |
| [#323](https://github.com/necromorphic/Logic-Engine/pull/323) | Expanded prototype patch, bridge, lifecycle journal and expanded FakeDB tests; current canonical implementation/evidence candidate | **Canonical Host patch/test candidate for Core review**, not production code. Do not merge/install until Core approves journal semantics and missing persisted-state/runtime gates are addressed |
| [#307](https://github.com/necromorphic/Logic-Engine/pull/307) | Earlier 64-line evidence document | Superseded by expanded [#332](https://github.com/necromorphic/Logic-Engine/pull/332); do not maintain a parallel evidence document. Preserve only facts not already represented in #332 |
| [#332](https://github.com/necromorphic/Logic-Engine/pull/332) | Expanded lifecycle matrix, pinned-source references, persisted-state before/after matrix and source call-site notes | **Canonical evidence-document candidate**. It explicitly says paired persisted-state snapshots are not captured; keep that gap visible |

No PR was merged/closed as part of this reconciliation. This is deliberate: the old patch's import/copy hooks and the handoff proposal are not approved for installation, and closure is not a substitute for preserving their unique content in reviewed documentation.

## Hard blockers / next safe increment

1. Core must ACCEPT/REVISE the lifecycle-journal persistence, identity, retention and failure semantics and the exact final-disclosure contract. Until then no runtime send gate or new API/schema is added.
2. Memory Provider must identify the authoritative currentness/revocation/reconciliation evidence consumed by that decision.
3. Host must test actual browser IndexedDB save/reload/restart and separately Android/Termux; current FakeDB tests do not satisfy these gates.
4. Host must collect paired pre/post native chat-file and journal measurements for import/copy/restore/deletion/migration paths, or explicitly keep each operation unsupported.
5. Only after approval: actual route-handler tests per enabled branch, including post-assembly edit/delete/revocation/scope-change race and zero provider egress on deny/error/unknown.

No active phone installation or Ollama vectorization/remote-store patch is changed by this document. No raw message text is retained.

## Follow-up static discovery increment — 26 Oct 2026

A second source search at the same pinned SHA found additional call-site families outside the initial 18-file table. This is **additional discovery, not exhaustive closure**:

- `src/endpoints/search.js`: external search-provider and YouTube page fetches. Usually not generation by themselves, but may fetch content that later enters a prompt; protect source acquisition/retrieval separately if the product contract includes it.
- `src/endpoints/translate.js`: LibreTranslate/Google/Yandex translation calls; user-provided or scene text may be sent for translation.
- `src/endpoints/openrouter.js`: provider/model and modality discovery plus an image-generation route; do not equate every call with inference, but inventory the actual image dispatch branch.
- `src/endpoints/nanogpt.js`: balance/subscription usage endpoints (account metadata, not necessarily protected content); distinguish from inference.
- `src/vectors/cohere-vectors.js`, `src/vectors/nomicai-vectors.js` and other `src/vectors/**` files: embedding/vectorization transport. These are deliberately **out of Host patch scope** because the existing Ollama/vectorization/remote-store integration must not be changed; list as a separate data-egress family, not as a proposed Host hook.
- `public/scripts/extensions/tts/**` and `public/scripts/extensions/stable-diffusion/**`: direct extension callers for TTS/image generation, including plugin/provider-specific URLs. A server endpoint-only list cannot establish coverage of direct browser/plugin calls.
- Other browser files contain fetches for login, user settings, backups, stats, scrapers, etc. These are not automatically model-inference calls, but a literal `fetch(` search must be classified rather than assumed relevant or irrelevant.

### Reproducible audit script

Added a read-only script at [tools/audit-pinned-st-outbound.sh](tools/audit-pinned-st-outbound.sh), commit `02f1f3b1b07fa887329b01f825f4e7ca700e76a1`. Run from the Logic-Engine checkout while pointing it at a local SillyTavern checkout:

```sh
bash host-adapter/prototype/tools/audit-pinned-st-outbound.sh /path/to/SillyTavern
```

It refuses to emit the inventory unless `git rev-parse HEAD` exactly matches the pinned ST SHA. It prints lexical transport call sites, server route declarations and provider/media/local-inference markers. It does not install hooks, contact providers, capture messages, or modify SillyTavern. Its output still requires manual call-graph classification and is not itself proof of exhaustive coverage or runtime behavior.

### Remaining route-inventory gap

This environment can inspect pinned source snippets and maintain the audit script, but it has not executed the script against a complete local ST checkout. Therefore there is no honest whole-repository hit count or complete route-by-route call graph to report yet. The exact command above is the next reproducible source-level step on a disposable checkout. Until its output is reviewed and all enabled call branches are traced, the route inventory remains **BOUNDED / NON_READY**. No runtime gate or interception patch is authorized before Core approves the final-disclosure contract.


## Exact GitHub diff comparison against current main — 26 Oct 2026

Compared each named PR head against repository `main` using GitHub's commit comparison API. This records repository commit ancestry and changed-file summaries; it is not a claim that the proposed SillyTavern patch is safe to apply.

| PR | Exact head | Comparison to current `main` | Files/change summary | Disposition |
|---|---|---|---|---|
| [#275](https://github.com/necromorphic/Logic-Engine/pull/275) | `0210a71e633cc04c740daf53f8c7e035f4218592` | `diverged`, 11 ahead / 30 behind | `.github/workflows/runtime-tests.yml` (+26); standalone ST patch (+536) | Stale base; review-only ideas, do not apply as-is. Its patch proposes pre-delete intent/snapshots and import/copy identity changes but does not prove a complete authoritative inventory. |
| [#322](https://github.com/necromorphic/Logic-Engine/pull/322) | `4863d057fa65be1f1eb53e1570c1fa7557e330fc` | `diverged`, 32 ahead / 1 behind | 11 added files, including 246-line ST patch, journal, bridge and 20-test suite | Earlier implementation candidate; not the canonical head. Unique handoff proposal is retained as review-only documentation. |
| [#323](https://github.com/necromorphic/Logic-Engine/pull/323) | `301a0c755f03095ecd9bb0f9aa18b38c8321d341` | `ahead`, 92 ahead / 0 behind | 13 added files, including 314-line ST patch, expanded bridge/tests, source evidence and audit script | Canonical review-only Host candidate. The diff adds prototype files but does not install them in the user's ST/Termux runtime; production readiness remains blocked. |
| [#332](https://github.com/necromorphic/Logic-Engine/pull/332) | `e9576afb29f1205345a542f094385797ef310156` | `ahead`, 9 ahead / 0 behind | One modified lifecycle evidence doc (+146/-45) | Canonical expanded evidence-doc candidate; paired persisted-state snapshots still absent. |
| [#307](https://github.com/necromorphic/Logic-Engine/pull/307) | `f02a1a7fc76e0b9b4fb6df82d357ae01668d804b` | `diverged`, 1 ahead / 5 behind | One added 64-line lifecycle evidence doc | Superseded by #332; do not maintain as parallel source. |

Patch-level observation from exact PR diffs: #275's patch adds pre-delete snapshots and a persistence-intent sequence in the ST source; #322's patch wires a journal/bridge and enrollment entry point; #323 expands that bridge and pre-mutation swipe checkpointing. Those are different implementation proposals, not interchangeable guarantees. Because raw-source retention and journal authority/failure semantics are not approved, the #275 content remains a list of requirements to resolve rather than a change to transplant. No PR was merged/closed and no patch was installed into the active host.


## Follow-up — deny-only egress guard placement and proxy bypass closure (28 Oct 2026)

The protected-dispatch candidate was tightened after reviewing the actual pinned `src/server-main.js` order. The earlier middleware mount inside `setupPrivateEndpoints()` occurred **after** the generic `/proxy/:url(*)` handler and therefore could not intercept requests already handled by that earlier route. That mount was removed.

Current candidate patch [`sillytavern-1.19.0-protected-dispatch-deny.patch`](patches/sillytavern-1.19.0-protected-dispatch-deny.patch):
- Browser: calls `assertProtectedDispatchAllowed(...)` at the start of native `Generate(type)`, before generation dispatch. This includes the native normal/regenerate/swipe entry path; enrolled Host conversations fail closed before the native request is made.
- Server: mounts `createProtectedDispatchDenyMiddleware()` in `src/server-main.js` immediately after `requireLoginMiddleware` and before the generic CORS proxy and `setupPrivateEndpoints(app)`.
- With `SILLYTAVERN_REQUIRE_PROTECTED_EGRESS_GATEWAY=true`, the server guard denies the enumerated native model/media route families plus `/proxy`, `/api/extensions`, and `/api/search`. The latter three are blocked because they can carry requests through unreviewed outbound transports or transmit user-supplied text. Denial is HTTP 503, `PROTECTED_EGRESS_GATEWAY_REQUIRED`, `Cache-Control: no-store`; no fallback is attempted through those routes.
- `/api/vector` remains deliberately outside this guard; the existing vectorization/remote-store path was not changed.

### Exact-pin CI evidence

The following CI jobs passed on the candidate code before its squash merge into the protected-dispatch branch:
- [Protected-dispatch guard + route-order contract](https://github.com/necromorphic/Logic-Engine/actions/runs/40670118273) — SUCCESS.
- [Pinned-source audit + real Chat Completions handler / recording fake provider](https://github.com/necromorphic/Logic-Engine/actions/runs/40670125715) — SUCCESS.
- [Pinned patch apply-check and lint](https://github.com/necromorphic/Logic-Engine/actions/runs/40670125682) — SUCCESS.
- [Runtime tests / NPC boundary](https://github.com/necromorphic/Logic-Engine/actions/runs/40670125882) — SUCCESS.
- [Host browser IndexedDB restart test](https://github.com/necromorphic/Logic-Engine/actions/runs/40670125883) — SUCCESS.
- [Host lifecycle patch check](https://github.com/necromorphic/Logic-Engine/actions/runs/40670125996) — SUCCESS.

The runtime harness proves one bounded no-egress property against the actual pinned Chat Completions handler: enforcement on returns 503 and the recording fake provider receives zero calls; a test-only toggle then reaches the fake provider once. Static contract checks prove the candidate server guard is before the proxy and private routers.

### Remaining acceptance boundary

This is still **deny-only candidate behavior**, not a positive Gateway and not a claim of universal egress control. It does not intercept direct browser-side extension fetches to external providers, unknown native/plugin transports outside the server route inventory, or every media/provider branch with its own recording-transport test. The pinned source audit is a bounded lexical inventory, not proof that every enabled outbound call has been traced. No live SillyTavern installation or Android/Termux run is claimed. Stage 2 remains **NO-GO** and Memory→NPC remains **DISABLED / FAIL-CLOSED** until the complete enabled-path inventory, final-send authorization/revocation race, and live deployment gates pass.


## Follow-up — pinned router contract and direct browser egress fence (28 Oct 2026)

### Exact-pin router inventory contract

PR [#591](https://github.com/necromorphic/Logic-Engine/pull/591) added a CI contract that reads `src/server-startup.js` from exact SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, extracts every `setupPrivateEndpoints()` router mount, and compares the ordered `path:router` list against a reviewed list. A new/removed/reordered/renamed router fails CI until classified. The check also requires the enumerated native model/media routes plus proxy/extension/search paths to be denied, and explicitly prevents adding `/api/vector` to the guard. The lifecycle route `/api/logic-engine` is present in the staged pinned build and is included in the contract.

This closes router-mount **inventory drift detection**. It does not inspect every internal handler branch and does not establish that all provider transports are mediated.

### Direct extension transports discovered at the pinned SHA

Source inspection found browser extension TTS code that can call configurable local services directly, without using SillyTavern's server endpoint middleware. Examples include:
- `public/scripts/extensions/tts/alltalk.js`: direct `fetch(`${provider_endpoint}/...`)` calls, including TTS and settings/voice endpoints.
- `public/scripts/extensions/tts/chatterbox.js`: direct configurable `provider_endpoint` fetches, including `/tts`.
- `public/scripts/extensions/tts/cosyvoice.js`, `gpt-sovits-adapter.js`, `gpt-sovits-v2.js`, and `gsvi.js`: direct browser fetches to configurable local service endpoints.
- Standard TTS providers such as OpenAI, Google, Azure, ElevenLabs, NovelAI, MiniMax, and Volcengine generally call same-origin `/api/...` routes; those are covered by the server deny prefixes in protected mode.

The first group is a concrete bypass of a server-only route guard. PR [#593](https://github.com/necromorphic/Logic-Engine/pull/593) adds a browser fence in the exact-pin patch: for an installation with any Host enrollment, cross-origin `fetch` and `XMLHttpRequest.open` are rejected before the native transport call. Same-origin requests still reach the server-side guard. It also denies `/api/plugins` to cover common dynamically registered plugin routes such as `/api/plugins/edge-tts/...`.

### Evidence and remaining limits

- [Exact-pin router/order and browser-fence CI](https://github.com/necromorphic/Logic-Engine/actions/runs/40673113550) — SUCCESS on candidate head `2b7c43a0f43c99131d44699e978aa925e0b89cac`.
- The browser-fence tests prove zero calls to the fake `fetch`/XHR transport for enrolled cross-origin requests; they are unit tests, not a real browser/device run.
- This is still not a complete browser sandbox: arbitrary extension code may use other primitives (for example WebSocket, image/navigation beacons, workers, or custom native bindings), and arbitrary plugin routes may not follow the common `/api/plugins` convention. The route inventory and fence are therefore **stronger fail-closed coverage, not proof of universal egress enforcement**.
- No vectorization files, worker vectorization logic, or `/api/vector` behavior were changed.
- Positive Gateway routing, exact serialized request/candidate binding, durable `DISPATCH_STARTED`, revocation-vs-transport serialization, and the actual live ST runtime remain open gates. Memory→NPC stays **DISABLED / FAIL-CLOSED**.


### Vectorization non-regression exception list

The pinned `public/scripts/extensions/vectors/index.js` uses these same-origin endpoints for existing embedding/model discovery:
- `POST /api/backends/kobold/embed` (KoboldCpp embeddings);
- `POST /api/openrouter/models/embedding`;
- `POST /api/openai/chutes/models/embedding`;
- `POST /api/openai/nanogpt/models/embedding`;
- `POST /api/openai/electronhub/models`;
- `POST /api/openai/siliconflow/models/embedding`;
- `POST /api/openai/workers-ai/models/embedding`.

The server deny guard now exempts **only these exact POST paths** before prefix matching. Wrong methods, extra path segments, native generation, TTS, and other provider paths remain denied. The route-specific regression test passes at the current candidate head [`e48e727`](https://github.com/necromorphic/Logic-Engine/commit/e48e72723e078d97a9b75d580700d8241a77c358) ([CI](https://github.com/necromorphic/Logic-Engine/actions/runs/40673626105)). This exception preserves the existing vectorization behavior; it is not a declaration that the vectorization subsystem is a protected Memory disclosure gate.


### Browser fence extension and exact-head regression result

The browser fence now wraps cross-origin `fetch`, `XMLHttpRequest.open`, `WebSocket`, `EventSource`, and `navigator.sendBeacon`. Same-origin traffic remains allowed to reach the server middleware; same-host `ws:`/page `http:` and `wss:`/page `https:` are treated as the same origin for the WebSocket check. Tests prove enrolled cross-origin calls fail before the fake transport and same-origin calls continue.

Exact-head Host CI passed at `f27f026cd9eb3397dfc5c1649af1d057cfde1dfa`: [run #40673828412](https://github.com/necromorphic/Logic-Engine/actions/runs/40673828412). The earlier exact vectorization route exception test passed at [run #40673626105](https://github.com/necromorphic/Logic-Engine/actions/runs/40673626105); the exceptions are present in the later head as well.

This improves common transport interception but still does not prove a complete browser sandbox. Workers, image/navigation beacons, dynamically injected scripts using alternate primitives, arbitrary plugin routes, native extensions and any transport not classified/tested remain **UNPROVEN**. No production route or positive Gateway is active.
