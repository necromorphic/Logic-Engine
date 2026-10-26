# Host/Adapter lifecycle audit — pinned SillyTavern source

Status: source audit only; **not** an experiment report and not a production-readiness claim.

Pinned target: SillyTavern `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
Source links below are pinned to that SHA. The patch in this PR is a separate review-only candidate; no claim is made that it is installed on the user's Android/Termux instance.

## Findings by lifecycle path

| Path | Source evidence and observed source semantics | Durability / repeatability | Status |
|---|---|---|---|
| User message send | `public/script.js`: `sendTextareaMessage()` calls `Generate(generateType)`; message insertion and send event are in `Generate` / message update path. `event_types.MESSAGE_SENT` is emitted after `saveChatConditional()` in the normal insert branches. Event payload is a chat array index, not a durable message ID. | Persistence is awaited on the shown send path; event can be emitted again if caller repeats. Index can shift after deletion/reload. | Source-confirmed |
| Generation start | `public/scripts/events.js` defines `GENERATION_STARTED: 'generation_started'`; source search shows consumers receive `(type, params, isDryRun)`. | This event describes a generation operation, not a persisted final message. The Host prototype does not currently intercept it. | Source-confirmed event; Host capture missing |
| Generation end / stop | `public/scripts/events.js` defines separate `GENERATION_ENDED` and `GENERATION_STOPPED`. These are distinct event names. | Their names alone do not establish whether a final partial response was persisted. The Host prototype does not yet capture or reconcile these paths. | Source-confirmed event names; persistence semantics not proven |
| Assistant message receive/render | In `public/script.js`'s message update routine, `MESSAGE_RECEIVED` is emitted before `addOneMessage`; `CHARACTER_MESSAGE_RENDERED` follows rendering. Payload includes chat index and generation type. | A received event is not proof of final delivery to an external consumer. In streaming, emission is conditional on `!fromStreaming`. | Source-confirmed |
| Regenerate | Generation is dispatched through `Generate`; final assistant message construction is in the message update routine. The same final path distinguishes `type === 'swipe'`, append/continue, appendFinal, and new-message branches. | Regenerate is not guaranteed to create a new logical message; swipe/append can mutate an existing entry. Host currently lacks a dedicated regenerate event path. | Source-confirmed structure; full UI path not experimentally verified |
| Swipe alternatives | Existing assistant message has `swipes`, `swipe_id`, and `swipe_info`. The generation update routine appends/replaces swipe content; `syncSwipeToMes` and `syncMesToSwipe` move state between the active message fields and selected swipe. | A swipe is an alternative version under one message object, not necessarily a separate history entry. Selection is mutable and must not be confused with edit/delete. | Source-confirmed |
| Swipe selection | The swipe-cycle path selects a swipe ID and schedules persistence through `saveChatDebounced()` when the selection changes; event names are not a stable version identity. | The candidate's pre-mutation checkpoint runs before `loadFromSwipeId()`. Although `endSwipe()` schedules the native save, the candidate then calls `afterMutation()`, whose bridge explicitly awaits `saveChat()` before appending the journal checkpoint. Therefore the prior claim that the journal necessarily advances before the awaited save was too strong. The remaining evidence gap is that CI/prototype tests do not prove `saveChatConditional()` durability or crash/restart ordering on the pinned browser/device runtime. | Source-reviewed ordering; device durability unverified |
| Edit | `public/script.js` contains the message editor commit path, which calls `updateMessage(div)`, emits `MESSAGE_UPDATED`, and later saves the chat. | The event payload is an index; the candidate records prior version identity/digest metadata before mutation to establish version ancestry without retaining raw message text. Prototype hook is review-only and not real-device tested. | Source-confirmed |
| Delete message | `deleteMessage(id, swipeDeletionIndex, askConfirmation, deleteToolCalls)` supports whole-message deletion and delegates swipe deletion to `deleteSwipe`; whole-message deletion splices the in-memory array and calls `saveChatDebounced()`. `deleteLastMessage()` truncates the array and emits `MESSAGE_DELETED`. | Whole-message deletion uses a debounced save in one path; event/index does not preserve the deleted content or prove durable deletion. Pre-delete capture is required. | Source-confirmed |
| Delete swipe | `deleteMessage` can delegate to `deleteSwipe`; `deleteSwipe` removes from `message.swipes` and updates swipe selection/info. | Swipe deletion changes version inventory but not necessarily logical message identity. | Source-confirmed |
| Chat switch / reload | `reloadCurrentChatUnsafe()` calls `clearChat({ clearData: true })`, then loads group/chat or resets neutral chat and emits `CHAT_CHANGED`. | The clear operation is part of navigation/reload, not always a user-requested deletion. Conversation identity must be captured before switching; current prototype's complete chat-switch semantics remain unproven. | Source-confirmed |
| Clear chat | `clearChat({ clearData = false })` clears UI, and only when `clearData` is true sets `chat.length = 0`. | This function is also used by reload. Treating every call as a user deletion would be wrong; capture must distinguish clear-data lifecycle and subsequent reload. | Source-confirmed |
| Persistence | `saveChatConditional()`, `saveChatDebounced()`, and `saveChat()` are distinct call paths. Some mutation paths await save, others schedule debounced save. | A hook after an awaited save cannot retroactively provide write-ahead protection; a hook before a debounced save cannot prove durable persistence. | Source-confirmed |
| Restart / replay | Source history is reconstructed by loading the chat; this pinned-source review did not run a browser/device restart. | Native history can be re-read, but no built-in durable logical message/version IDs are established by the cited fields. Reconciliation must compare a full inventory/fingerprint and fail closed on mismatch. | Experiment not run |
| Import/export/copy/restore/migration | Server routes include `/api/chats/export`, `/api/chats/import`, and group import routes in `src/server-startup.js`; separate source paths handle historical chats. | These paths can replace or duplicate histories outside the currently hooked in-memory mutation points. No authoritative all-time inventory is available from the current Host prototype. | Source-confirmed routes; Host instrumentation missing |
| External edits / rollback | No universal mutation event in the reviewed Host paths establishes that external file edits, backup restore, or rollback have been observed. | A current-history fingerprint mismatch can detect some divergence only when the conversation is revisited; it cannot reconstruct missing deleted versions. | Not guaranteed |

## Identity conclusion

The pinned Host data shown in these paths primarily uses chat indexes and mutable `swipe_id` / `swipes` arrays. Those are not sufficient as durable identity by themselves. The prototype adds enrollment-forward random logical message/version IDs and content digests, but that identity is locally introduced, only exists after explicit enrollment, and is not evidence of pre-enrollment history completeness. Copy/import/restore can duplicate embedded IDs unless conflict/reconciliation rules detect that condition.

## Prototype implementation status

The current candidate PR #323 implements an opt-in IndexedDB journal and patch hooks for a subset of mutation paths. It remains **NON_READY** because required paths are not instrumented, IndexedDB tests use a test double, and there is no real Android/Termux restart/replay run or Host→Provider→Core→NPC test. No claim of successful real-device experiment is made.

## Exact next implementation gates

1. Add/verify tests against the exact pinned-source patch, not only bridge mocks.
2. Wire and test generation lifecycle/cancel/partial-finalization semantics without treating event names as persistence proof.
3. Make creation, edit, swipe selection/deletion, whole-message deletion, clear/reload, and persistence ordering fail closed on any post-mutation mismatch.
4. Add explicit import/export/copy/restore/restart reconciliation, or leave those capabilities unavailable and readiness NON_READY.
5. Run the patch in a disposable browser/runtime; Android/Termux validation remains a separate uncompleted gate.
6. Keep production Memory→NPC disabled until Provider/Core separately accept and verify the complete handoff.


## Follow-up implementation decision (25 Oct 2026)

The Host-owned patch now instruments the selection of an existing swipe with a before-mutation journal event. The corresponding regression test asserts event ordering and preservation of the pre-existing immutable version IDs. This closes the specific missing pre-hook found during review of the previous candidate.

It does **not** close the source-inventory gap. History removed before explicit enrollment is `UNKNOWN_UNRECOVERABLE`; a current chat snapshot cannot reconstruct deleted bytes or prove the absence of previously missed mutations. The journal can establish a bounded, opt-in history from enrollment onward only to the extent every relevant native mutation is hooked and its native save succeeds. Missing hooks, failed saves, copied/restored identity metadata, or fingerprint/identity divergence must remain NON_READY.

No real Android/Termux persistence or restart/replay test is claimed here. The patch must be applied and tested on the exact pinned source in CI, and then separately on a disposable copy of the user's actual ST install. Production Memory→NPC remains DISABLED / FAIL-CLOSED.


## Append-only content evidence decision (25 Oct 2026)

The Host prototype records identity, version lineage, active-version selection, and content digests for covered source versions in pre-/post-mutation journal events. The journal's `exportCaptureLedger()` requires a valid hash-chain/integrity check and returns a review-only, enrollment-forward-only ledger. **It does not retain exact message bytes and cannot recover old text after a native ST message/swipe is edited or deleted.** The digest-only policy is intentional and matches the Core decision; a digest is an integrity signal, not a content archive.

This is not proof of completeness outside the instrumented lifecycle paths. The ledger does not claim recovery of deleted history predating enrollment, authority to bind a chat to a Logic-Engine world, or a production Provider handoff. Content export must remain withheld if integrity verification fails.


## Chat unload versus source deletion (25 Oct 2026)

A second source review found that pinned ST `clearChat({ clearData: true })` is called by chat switch, reload, close-chat, and new-chat flows. It is a UI-state unload/reset path, not authoritative evidence that the underlying chat source was deleted. The earlier candidate hook incorrectly treated it as `clear-chat` deletion. The current patch removes that hook; `clear-chat` remains uncovered until the actual chat-file deletion path can identify and capture the exact source inventory before deletion. Non-current chats cannot be reconstructed from the currently loaded `chat` array. This correction prevents false tombstones / false empty inventory during normal chat navigation.


## Latest exact-head CI evidence (25 Oct 2026)

The three successful workflows below ran on code/documentation HEAD `e7a33a17874be7e4fd591cf2c79cf932a0e21d5e`, immediately before this audit-only documentation addition. This audit update is commit `2e1a4e8235975c953206d4088df4c4903d2ab4fc`; no workflow result for this new commit is claimed here:

- [Host lifecycle patch check #40222869285](https://github.com/necromorphic/Logic-Engine/actions/runs/40222869285) — SUCCESS.
- [Runtime tests #40222869212](https://github.com/necromorphic/Logic-Engine/actions/runs/40222869212) — SUCCESS.
- [Host lifecycle patch validation #40222869210](https://github.com/necromorphic/Logic-Engine/actions/runs/40222869210) — SUCCESS.

These results establish repository CI only. They do not establish native-browser IndexedDB crash durability, real SillyTavern persistence/restart/replay, Android/Termux behavior, complete source inventory, trusted world/session binding, or a production Host→Provider release boundary. PR #323 remains Draft/unmerged and is not approved for installation or production handoff. Required Host inventory answer remains `NO SUCH MECHANISM FOUND / NON_READY`; Memory→NPC remains `DISABLED / FAIL-CLOSED`.


## Final provider-send boundary audit — 26 Oct 2026

This section is a source inspection of the pinned upstream revision, not a runtime experiment. Pinned source links:

- Browser Chat Completions: [`public/scripts/openai.js` at pinned SHA](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js#L135953-L136600). In `sendOpenAIRequest()`, `createGenerationParameters(...)` is followed by awaited `CHAT_COMPLETION_SETTINGS_READY`; then the browser calls `fetch('/api/backends/chat-completions/generate', ... body: JSON.stringify(generate_data) ...)`. This is the last obvious browser-owned hook before request serialization and the ST server request. It is **not** the final provider-send boundary.
- Chat Completions server dispatcher: [`src/endpoints/backends/chat-completions.js` at pinned SHA](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/backends/chat-completions.js#L94830-L95080). `POST /generate` post-processes the received request and dispatches across multiple provider-specific `send*Request` functions; several branches return before the generic sender. A hook placed only in one generic sender would miss those branches.
- Text Completions server dispatcher: [`src/endpoints/backends/text-completions.js` at pinned SHA](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/backends/text-completions.js#L9316-L9430). It builds `args.body = JSON.stringify(request.body)`, applies provider-specific filtering/rewrites, and then performs multiple `fetch(url, args)` paths. This is a separate API family.
- The server also has other independent outbound request paths (for example multimodal captioning in `src/endpoints/openai.js`); this audit does not claim an exhaustive inventory of every model-capable endpoint.

### Boundary conclusion

1. **Browser-side candidate gate (source-inspected):** the awaited `CHAT_COMPLETION_SETTINGS_READY` event occurs before `JSON.stringify(generate_data)` and the browser's ST `fetch`. It is a pre-serialization hook for that browser Chat Completions path only. It does not by itself cover Text Completions, native/server calls, alternate endpoints, or callers that bypass that UI function.
2. **Actual outbound-provider boundary (source-inspected):** no single shared final-send function was established across the reviewed Chat Completions provider branches and Text Completions API. Provider-specific serializers/senders mean a hook at the browser event or at one generic sender cannot be represented as universal enforcement.
3. **Revocation/edit/delete race (not demonstrated):** the current Host journal captures local lifecycle metadata; it is not an authority source for whether a candidate is still permitted to disclose. A check before candidate assembly or at `CHAT_COMPLETION_SETTINGS_READY` does not prove that a revocation/change occurring after assembly and before the provider request will be observed. No approved Core authorization contract or atomic/short-lived authorization token is present in this Host task, so no safe final-send gate can be implemented here without inventing semantics.
4. **No raw text:** the audit does not add or retain message text. It records only source paths and boundary conclusions.
5. **Disposition:** do not add a fake universal callback or claim final-send enforcement. Keep all uncovered endpoints unsupported / NON_READY and Memory→NPC DISABLED / FAIL-CLOSED until Core defines the authorization contract and a complete endpoint inventory is reviewed.

### Evidence classes

- **Source-inspected:** the pinned file paths and ordering above.
- **Fixture-tested:** existing Host prototype tests and exact-head CI only; they do not exercise the real provider network path.
- **Real browser / real IndexedDB:** not run in this environment.
- **Android / Termux:** not run in this environment.
- **Provider-send revocation race:** not proven; requires a Core-approved contract plus a test that revokes/edits/deletes after candidate assembly and asserts no provider request is emitted.


## Exact interception matrix — what the current patch does and does not intercept

This matrix describes the current candidate patch at commit `f47e376f2a3fe7832900d298f77698a689b2e090`; it does not infer coverage from the existence of source events.

| Path / boundary | Current candidate actually intercepts it? | Classification |
|---|---:|---|
| User message insertion in `public/script.js` send/update path | Yes, the patch invokes `beforeMutation('message-send')` before the insertion and `afterMutation` after the save call in the shown branches | Partial lifecycle instrumentation only; not provider-send authorization |
| Assistant create/swipe/append/update path | The patch invokes a lifecycle checkpoint in the message-update routine; the exact pre-mutation coverage varies by operation and is not a universal send guard | Partial lifecycle instrumentation; not proof of complete persistence |
| Edit / delete message / delete swipe / select swipe | The patch adds hooks at the named UI mutation points | Partial lifecycle instrumentation; not a universal record of all callers or external file operations |
| Browser Chat Completions pre-serialization event `CHAT_COMPLETION_SETTINGS_READY` | **No**; current patch does not register an authorization gate on this event | Unsupported for disclosure control |
| Browser `POST /api/backends/chat-completions/generate` | **No**; current patch does not wrap/intercept this fetch as a final authorization check | Unsupported for disclosure control |
| Server `POST /api/backends/chat-completions/generate` dispatcher | **No**; current patch does not add a server-side gate before provider dispatch | Unsupported for disclosure control |
| Chat Completions provider-specific senders (including Claude, AI21, MakerSuite/Vertex, Mistral, Cohere, DeepSeek, AIMLAPI, xAI, Chutes, MiniMax, ElectronHub, Azure OpenAI, plus other source-specific branches) | **No**; no provider sender is instrumented by this Host patch | Unsupported |
| Generic Chat Completions outbound sender after provider-specific branching | **No**; not established as a universal boundary because earlier branches return through their own senders | Unsupported as universal gate |
| Text Completions `POST /api/backends/text-completions/generate` and its provider-specific `fetch(url, args)` paths | **No** | Unsupported |
| Native/server callers, other generation families, direct provider calls, extension/custom routes, alternate endpoints | **No**; no exhaustive inventory or shared final-send interceptor has been established | Unsupported / bypassable |
| Import, restore, recursive deletion, group deletion and branch operations | Some patch locations call the bridge, but their operation names are deliberately not in the currently supported operation allowlist, so enrolled mutations reject before proceeding rather than being admitted as captured | Fail-closed blocker, not supported lifecycle coverage |

### Consequence for the requested revocation/edit/delete race

The current patch does **not** intercept the actual provider send boundary. Therefore there is no valid Host test result yet for “candidate assembled → source edited/deleted/revoked → provider serialization/send attempted → request prevented.” A test around `CHAT_COMPLETION_SETTINGS_READY` alone would test a browser hook, not the server-side final provider send across all paths. A fixture callback or fake provider sender would not repair this evidence gap.

A correct end-to-end test requires: (a) Core-approved authorization semantics and the authoritative revocation/version source, (b) a reviewed inventory of every allowed generation route and its last controllable serialization/send point, (c) a test that pauses after candidate assembly, performs edit/delete/revocation, resumes the request, and proves **no outbound provider request** occurred, and (d) separate real-browser and Android/Termux evidence. Until those exist, Host disclosure readiness is `NON_READY`; this patch must not be described as a final-send gate.


## Implementation-shaped send-boundary proposal — review only (26 Oct 2026)

This is a proposed change map, **not an installed hook and not an authorization implementation**. It deliberately defines no callback name, API, payload schema, or authorization semantics. The current candidate patch still does not intercept outbound provider requests.

### Exact candidate interception points on pinned ST SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`

1. **Browser Chat Completions route:** `public/scripts/openai.js`, inside `sendOpenAIRequest()`, immediately before `JSON.stringify(generate_data)` and `fetch('/api/backends/chat-completions/generate', ...)`, after `CHAT_COMPLETION_SETTINGS_READY`. This can stop the browser request for this UI route only. It is not the final provider boundary and cannot cover server callers or alternate routes.
2. **Server Chat Completions route:** `src/endpoints/backends/chat-completions.js`, `POST /generate` dispatcher. The request branches to provider-specific senders; a gate at one generic sender is insufficient. A future patch must enumerate each enabled branch and place the final revalidation immediately before that branch serializes/sends its provider request, or keep that branch unsupported. Exact sender inventory must be refreshed against the pinned checkout before editing.
3. **Server Text Completions route:** `src/endpoints/backends/text-completions.js`, `POST /generate`. This is a separate route with provider-specific body rewrites and multiple `fetch(url, args)` calls. It needs its own pre-serialization/send enforcement per outbound branch, or remains unsupported.
4. **Other model-capable routes and non-UI callers:** this audit has not established an exhaustive list. Do not infer coverage from the three locations above. Any extension, native/server caller, alternate generation family, or independent outbound endpoint not enumerated and tested remains unsupported and must not receive protected Memory→NPC content.

### Required contract at each proposed boundary (decision required; not implemented)

The Core-approved contract must identify the trusted world/session scope, source/currentness and subject-relative knowledge authority, the exact disclosure decision/result, and how revocation/edit/delete/scope changes are revalidated at the last controllable boundary. The final decision must be evaluated against the assembled candidate immediately before protected content can enter the serialized outbound request. Host may enforce a returned decision only after the owner-defined callable contract and its failure behavior are approved; Host must not invent its signature or treat journal metadata as authority. Unknown, stale, revoked, conflicting, unavailable, or unvalidated results must prevent protected content from being sent.

### Minimal proposed tests and evidence classes

- **Patch mechanics / repository test:** verify each enumerated supported branch invokes the approved boundary check before serialization/send; assert no provider request is emitted when the check denies, errors, or returns an unknown state. These tests must use the actual route functions, not a fake universal sender.
- **Race test:** pause after candidate assembly; edit/delete/revoke the source or change scope; resume at the final boundary; assert zero protected content, snippets, counts, candidate IDs, or diagnostic leakage in every outbound request.
- **Bypass test:** exercise every enabled provider branch and alternate generation route; unenumerated paths must be explicitly disabled/unsupported.
- **Evidence labels:** source-inspected; patch/apply/lint CI; focused route test; real browser; real IndexedDB; Android/Termux; provider-network race. Passing one class does not imply another.

### Current Host decision

No runtime send hook is added by this proposal. The exact Core authorization contract and required second Core review of the implementation diff are still absent; the exhaustive outbound-route inventory and revoke/edit/delete-after-assembly-before-send test are also absent. Therefore this proposal is **REVIEW-ONLY / NON_READY**. Keep Memory→NPC **DISABLED / FAIL-CLOSED** and do not persist raw message text or touch the separate Ollama/vectorization remote-store patch.


### Changed-file list and reproducible commands

**Files changed by this proposal commit:** only `host-adapter/prototype/SOURCE-LIFECYCLE-AUDIT.md`. No SillyTavern runtime source or runtime patch was changed because the Core decision and second review are not yet available.

From the Logic-Engine repository root, the existing review-only Host bridge tests are run with:

```sh
node --test host-adapter/prototype/tests/*.test.mjs
```

To check the existing lifecycle patch against a disposable checkout of the exact pinned SillyTavern source (this checks the existing lifecycle patch only; it does **not** test a future send gate):

```sh
git -C /path/to/SillyTavern checkout 06bde939fb1e9c4c8d8641d810f0a916b5bce127
git -C /path/to/SillyTavern apply --check /path/to/Logic-Engine/host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch
```

The second command has **not** been run in this environment. No exact-head workflow was returned for documentation commit `715f129a28eee1ff08ea0dfc8af37ba35a222db8`; no new test pass is claimed. A future runtime diff must be reviewed separately by Core before application, and then must add route-level denial/error/bypass tests plus the real post-assembly revocation race test described above.
