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
| Import/export/copy/restore/migration | Server routes include `/api/chats/export`, `/api/chats/import`, and group import routes in `src/server-startup.js`; separate source paths handle historical chats. | These paths can replace or duplicate histories outside the currently hooked in-memory mutation points. The current candidate now fails closed on UI chat imports and backup restore when any enrolled Host history exists, guards target-aware single-chat deletion/rename, and blocks bulk character/group deletion when enrollment markers exist. Direct server API calls, external edits, export/copy lineage, and a complete authoritative all-time inventory remain unproven. | Source-confirmed routes; Host instrumentation missing |
| External edits / rollback | No universal mutation event in the reviewed Host paths establishes that external file edits, backup restore, or rollback have been observed. | A current-history fingerprint mismatch can detect some divergence only when the conversation is revisited; it cannot reconstruct missing deleted versions. | Not guaranteed |

## Identity conclusion

The pinned Host data shown in these paths primarily uses chat indexes and mutable `swipe_id` / `swipes` arrays. Those are not sufficient as durable identity by themselves. The prototype adds enrollment-forward random logical message/version IDs and content digests, but that identity is locally introduced, only exists after explicit enrollment, and is not evidence of pre-enrollment history completeness. Copy/import/restore can duplicate embedded IDs unless conflict/reconciliation rules detect that condition.

## Prototype implementation status

The current candidate PR #323 implements an opt-in IndexedDB journal and patch hooks for a subset of mutation paths. It remains **NON_READY** because required paths are not fully instrumented, tests use both a test double and a real desktop Chromium IndexedDB process-restart harness, and there is no Android/Termux restart/replay run or Host→Provider→Core→NPC test. No claim of successful real-device experiment is made.

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

### Raw prompt-body logging finding — 27 Oct 2026

Upstream source at pinned SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, blob `0d98c77f7b64502c5b0f504eaa1f67df0f26041e`, line 670 of `src/endpoints/backends/chat-completions.js` contains a debug statement that logs the full transformed request body. That body can contain system instructions and conversation content, so this is a potential server-log disclosure. The candidate patch replaces the raw body with metadata-only logging (`model`, `stream`, and message count). The patch-check workflow asserts the raw-body form is absent and the metadata form is present; validation also lints and syntax-checks the patched endpoint.

Evidence boundary: the upstream pinned source was fetched and inspected directly. The uploaded ZIP root names the same SHA, but its `src/endpoints/backends/chat-completions.js` blob is `451c3cdeb861128f14cc7b02585357bfa9546dd2`, not the upstream blob above; `package.json` and `src/server-startup.js` do match. The isolated hunk passed local `git apply --check` and `node --check` against the uploaded modified checkout. The combined patch and endpoint lint passed exact-head workflows [#40407917716](https://github.com/necromorphic/Logic-Engine/actions/runs/40407917716) and [#40407917665](https://github.com/necromorphic/Logic-Engine/actions/runs/40407917665). This mitigation is only in the patch artifact until installed; it does not route the provider request through a final authorization gateway and does not close the disclosure/revocation race.

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
| Chat Completions provider-specific senders across the pinned dispatcher | **No**; no provider sender is instrumented by this Host patch | Unsupported |
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

The equivalent pinned-source apply-check, syntax/lint checks, Host prototype tests, and Chromium IndexedDB process-restart test have run in CI on the current PR head. This does **not** test a future send gate or establish Android/Termux runtime behavior. A future runtime diff must be reviewed separately by Core before application, and then must add route-level denial/error/bypass tests plus the real post-assembly revocation race test described above.

## Provider-neutral final-send call-site matrix (pinned source, 28 Oct 2026)

Source inspected: `src/endpoints/backends/chat-completions.js` at pinned SillyTavern SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. The line numbers below are 1-based in that exact file. They identify direct outbound calls, not an exhaustive inventory of every model-capable endpoint.

| Call-site ID | Source line(s) | Role evidenced by the call site | Request materialization before transport | Disposition |
|---|---:|---|---|---|
| C01 | 410 | Chat-generation POST | Body serialized inline as `JSON.stringify(requestBody)`; target and server-owned headers are already resolved | Separate outbound branch; no shared gate proven |
| C02 | 733 | Chat-generation POST | Body serialized inline as `JSON.stringify(body)`; URL and headers are already resolved | Separate outbound branch; no shared gate proven |
| C03 | 852 | Chat-generation POST | Serialized body is stored in an options object before `fetch` | Separate outbound branch; exact options must be bound |
| C04 | 942 | Chat-generation POST | Prepared request config passed directly to `fetch` | Separate outbound branch; exact config must be bound |
| C05 | 1042, 1045 | Streaming and non-streaming chat-generation POST | Same prepared config reaches two conditional `fetch` call sites | Both branches require equivalent enforcement |
| C06 | 1153 | Chat-generation POST | Prepared config passed directly to `fetch` | Separate outbound branch; no shared gate proven |
| C07 | 1259 | Chat-generation POST | Prepared config passed directly to `fetch` | Separate outbound branch; no shared gate proven |
| C08 | 1364 | Chat-generation POST | Prepared config passed directly to `fetch` | Separate outbound branch; no shared gate proven |
| C09 | 1476 | Chat-generation POST | Prepared config passed directly to `fetch` | Separate outbound branch; no shared gate proven |
| C10 | 1577 | Chat-generation POST | Prepared config passed directly to `fetch` | Separate outbound branch; no shared gate proven |
| C11 | 1658 | Chat-generation POST | Prepared config passed directly to `fetch` | Separate outbound branch; no shared gate proven |
| C12 | 1752 | Chat-generation POST | Body is serialized into config before `fetch`; target and headers are already resolved | Separate outbound branch; no shared gate proven |
| C13 | 2689 | Generic/custom chat-generation POST | Body is serialized into config before `fetch`; custom headers and endpoint are resolved | Separate outbound branch; no shared gate proven |
| AUX-01 | 1984 | Diagnostic deployment/model probe | Sends a small fixed test prompt during a status/configuration check | Not the ordinary user-turn send path, but still outbound model traffic; scope must be decided separately |

### What this establishes

- The pinned Chat Completions file contains multiple independent final transport call sites; a hook at one generic sender cannot be assumed to cover all branches.
- The dedicated handler entry points map to these call sites in source order: C01 starts at line 230; C02 at 454; C03 at 800; C04 at 881; C05 at 971; C06 at 1071; C07 at 1183; C08 at 1289; C09 at 1394; C10 at 1506; C11 at 1607; C12 at 1687. The dispatcher's switch routes through early-return handlers at lines 2260–2272. C13 is the shared send path reached after additional source-selection branches spanning lines 2301–2576. Those predicates must be traced individually; C13 does not make the earlier handlers share one final boundary.
- For branches that prebuild a config object, the final gate must bind the exact target, headers and already-serialized `config.body` immediately before the corresponding `fetch`. Re-serializing or rebuilding the request after authorization would break exact-request binding.
- The diagnostic probe is a separate outbound path and must not be silently counted as ordinary generation or ignored if protected content can reach it.
- The file also contains model-list/discovery calls. They are not interchangeable with generation calls and must be classified separately rather than counted as protected inference sends.
- This matrix is source-inspected only. It does not prove that any gate exists, that all other endpoint files/extensions are covered, or that a revocation race is blocked.

### Next source-first action

Trace the dispatcher to each C01–C13 call site and record the branch predicate, final target/header/body construction, response/streaming behavior, and any early return. Then extend the same inventory to the separate Text Completions and other enabled model-capable routes. No runtime hook, route allowlist, new API/schema, or production wiring is introduced by this audit. Each unreviewed path remains unsupported for protected Memory→NPC content pending exact-diff Core approval and a real no-egress/revocation-race test.

## Provider-neutral Text Completions and adjacent model-call inventory (pinned source, 28 Oct 2026)

Source inspected: `src/endpoints/backends/text-completions.js` at pinned SillyTavern SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. Line numbers are 1-based in that exact file. This file combines user-turn generation with model discovery, diagnostics, captioning, and model-management operations; these must not be treated as one policy class.

### User-turn generation

| Call-site ID | Source line(s) | Route/function | Final request construction | Disposition |
|---|---:|---|---|---|
| T01 | 402 | `POST /generate`, streaming Ollama | `url` selected by `api_type`; `args.body` is rebuilt into the local-model request shape at lines 391–399 | Independent final-send branch |
| T02 | 405 | `POST /generate`, streaming non-Ollama | Uses `url` and the fully transformed `args`; filtering/rewrites occur at lines 336–399 | Independent final-send branch |
| T03 | 409 | `POST /generate`, non-streaming | Same transformation family as T02, but separate fetch branch and response handling | Independent final-send branch |

The outbound target is derived from the request's `api_server` and `api_type` at lines 276–324. The serialized body is initially formed at lines 326–332 and then rewritten for multiple API types through line 399. Therefore, any future enforcement point must see the final `url`, final headers and exact final `args.body` after all rewrites. An earlier check would authorize a different request than the one sent. T01, T02 and T03 must all be covered; a streaming/non-streaming branch split is a bypass risk if only one is gated.

### Other outbound calls in the same file

| Call-site ID | Source line(s) | Purpose | Classification |
|---|---:|---|---|
| T-AUX01 | 89 | Abort an in-flight generation request | Cancellation control path; not a new generation request |
| T-AUX02 | 153 | Fetch model list | Discovery traffic |
| T-AUX03 | 191, 208 | Fetch model metadata/info | Discovery/configuration traffic |
| T-AUX04 | 251 | Fetch backend properties | Configuration/diagnostic traffic |
| T-AUX05 | 453 | Pull/download a model | Model-management operation |
| T-AUX06 | 484 | Caption an image through a model | Separate inference path; request includes prompt and image data |
| T-AUX07 | 530 | Fetch local backend properties | Configuration/diagnostic traffic |
| T-AUX08 | 563, 574 | Query or mutate local backend slots | State-management path; some operations are destructive |
| T-AUX09 | 614, 630 | Check permissions and download a model | Model-management path with two outbound calls |

This list is based on direct `fetch` call sites in the pinned file. It does not imply every listed route should be subject to the same protected Memory→NPC policy. The image-caption path is model inference but is not the ordinary text-generation route; it needs an explicit scope decision. Model downloads and slot mutations need separate authorization/safety rules, not accidental inclusion in an inference gate.

### Source-level disclosure finding

At line 282, `POST /generate` logs the full inbound `request.body`. That body can contain prompts and generation input. At line 481, the image-caption route logs its full request body, which can contain the caption prompt and image data. These are potential sensitive-data disclosures in server logs. This audit records the findings only; no logging code is changed here.

### Coverage limit and next step

Together with the Chat Completions matrix above, this establishes that the pinned backend files have multiple distinct generation send boundaries plus auxiliary model-capable routes. It does not establish a universal interception point or complete coverage of every model-capable endpoint, extension, native caller, or custom route.

Next: trace how the pinned server mounts these routers, inventory other model-capable endpoint files and extension routes, and classify each path as (a) protected user-turn inference, (b) other inference such as captioning, (c) discovery/diagnostic, or (d) management/control. Every unreviewed path remains unsupported for protected Memory→NPC content. No runtime hook, API/schema, or production wiring is introduced by this source audit.

## Additional model-capable endpoint families (pinned source, 28 Oct 2026)

This is a route-family inventory, not an assertion that every direct `fetch` below is a protected user-turn send. Sources inspected at pinned SillyTavern SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

| Source file | Relevant mounted route family observed in source | Outbound call-site evidence | Initial classification |
|---|---|---|---|
| `src/endpoints/openai.js` | `/caption-image`, `/generate-voice`, image/video generation, embeddings, transcription, and model-list helpers | Direct fetches at lines 241, 296, 361, 396, 436, 470, 506, 547, 591, 630, 670, 708, 731, 766, 830, 897 | Mixed multimodal inference, media generation, embeddings, discovery, and follow-up/poll/download requests; each route needs separate classification |
| `src/endpoints/anthropic.js` | `/caption-image` | Direct fetch at line 36 | Separate image-caption inference route |
| `src/endpoints/novelai.js` | `/generate`, `/generate-image`, `/generate-voice`, status and upscale paths | Direct fetches at lines 143, 269, 315, 403, 459 | Mixed generation, status, upscale, and auxiliary paths; do not treat as one boundary |
| `src/endpoints/minimax.js` | `/generate-voice` | Direct fetches at lines 73 and 200 | Voice generation plus a subsequent media fetch |
| `src/endpoints/volcengine.js` | `/generate-voice` | Direct fetch at line 34 | Separate voice-generation path |
| `src/endpoints/nanogpt.js` | credits and model-provider discovery | Direct fetches at lines 52, 53, 113 | Account/model discovery traffic; not ordinary user-turn generation based on the inspected route names |
| `src/endpoints/translate.js` | Translation endpoints | Direct fetches at lines 47, 133, 186, 238, 301, 348 | Separate translation calls; whether protected Memory→NPC content may enter these paths must be explicitly decided |
| `src/endpoints/caption.js` | Caption route wrapper | No direct fetch found; calls local image-to-text transformer pipeline | Local inference; no remote egress shown in this call path |
| `src/endpoints/classify.js` | Classification route wrapper | No direct fetch found; calls local text-classification transformer pipeline | Local inference; input is logged, so privacy/logging controls still apply |
| `src/endpoints/vectors.js` | Vector operations | No direct fetch in wrapper; delegates to local and remote vector implementations | Source-dependent: inspect selected adapter; remote adapters have separate final-send boundaries |

### Implications for the boundary design

- A final-send gate scoped only to Chat Completions and Text Completions would not establish coverage of captioning, translation, speech/media generation, embedding, or delegated classification/vector paths.
- Some of these routes are likely unrelated to the normal RP turn, but that is not enough to mark them safe: the contract must say whether protected Memory-derived material is allowed to reach each route.
- Some routes perform more than one outbound call (for example, create/poll/fetch media workflows). Each network step needs a classification; gating only the initial request does not prove later calls cannot disclose protected material.
- This is an inventory of selected pinned files, not a complete repository-wide route graph. Extension-defined routes, native callers, dynamically registered endpoints, and delegated callees remain to be traced.

### Required route disposition ledger

Before runtime integration, maintain a per-route ledger with: mounted path; source file/function; caller class; whether protected memory can reach input; final URL/headers/body materialization; all outbound call sites; streaming/cancellation behavior; denial response; no-fallback proof; post-assembly revocation-race test; and explicit disposition (`SUPPORTED`, `UNSUPPORTED`, or `OUT OF SCOPE`) approved by Core. Until a row is reviewed and tested, it is `UNSUPPORTED` for protected Memory→NPC content.

## Server-mounted route map and delegated inference paths (pinned source, 28 Oct 2026)

The pinned `src/server-startup.js` mounts the following relevant route families:

| Mounted path | Router/source | What the source inspection establishes |
|---|---|---|
| `/api/backends/chat-completions` | `src/endpoints/backends/chat-completions.js` | Main Chat Completions dispatcher; many provider-specific and shared send branches |
| `/api/backends/text-completions` | `src/endpoints/backends/text-completions.js` | Text generation dispatcher; final request is transformed after initial body serialization |
| `/api/backends/kobold` | `src/endpoints/backends/kobold.js` | Separate generation route plus status, transcription and embedding paths |
| `/api/extra/caption` | `src/endpoints/caption.js` | Delegated caption wrapper; does not itself reveal final transport |
| `/api/extra/classify` | `src/endpoints/classify.js` | Delegated classification wrapper; calls a separate classification service |
| `/api/vector` | `src/endpoints/vectors.js` | Vector API delegates to provider-specific/local vector implementations |
| `/api/openai` | `src/endpoints/openai.js` | Multiple audio, image, video, embedding and transcription operations |
| `/api/anthropic` | `src/endpoints/anthropic.js` | Separate caption inference path |
| `/api/novelai` | `src/endpoints/novelai.js` | Separate generation, image and voice paths |
| `/api/translate` | `src/endpoints/translate.js` | Translation routes, separate from normal generation |
| `/api/speech` | `src/endpoints/speech.js` | Speech route family; requires its own transport trace |
| `/api/minimax`, `/api/volcengine`, `/api/nanogpt` | Corresponding endpoint modules | Additional model/media/discovery operations |

The list is bounded to route mounts directly evidenced in the inspected startup source. It is not a complete audit of dynamically registered extension endpoints or all callees.

### Delegation findings

- `src/endpoints/caption.js` uses `getPipeline('image-to-text')` from `src/transformers.js` and runs the pipeline locally; this wrapper has no direct outbound `fetch` in the inspected path. It is a separate local inference route, not evidence of a remote egress boundary.
- `src/endpoints/classify.js` uses `getPipeline('text-classification')` from `src/transformers.js` and runs the pipeline locally. It logs the input text at line 46, so local log disclosure still matters even though this path is not an external model send in the inspected implementation.
- `src/endpoints/vectors.js` dispatches to multiple vector implementations. Some are local (`src/vectors/embedding.js` uses a local transformer pipeline); others call remote endpoints, including `src/vectors/openai-vectors.js` line 113, `src/vectors/nomicai-vectors.js` line 36, `src/vectors/extras-vectors.js` line 54, and `src/vectors/cohere-vectors.js` line 20. The final boundary therefore depends on the selected vector source.
- `src/endpoints/backends/kobold.js` has separate `/generate`, `/transcribe-audio`, and `/embed` routes, with direct send calls at lines 98, 215 and 256 respectively, plus an abort call at line 26 and status probes at lines 163, 169 and 175. The generation boundary cannot be assumed to cover the other routes.
- `src/endpoints/anthropic.js` logs the captioning request body at line 34. Combined with the text-generation and image-caption logging findings above, prompt/input logging must be included in the privacy review separately from outbound authorization.

### Kobold and vector adapter call-site notes

| Call-site ID | Source line(s) | Route/adapter | Classification |
|---|---:|---|---|
| K01 | 98 | Kobold generation | User-turn generation send; body/config is prepared before fetch |
| K02 | 215 | Kobold transcription | Separate audio inference path |
| K03 | 256 | Kobold embedding | Separate embedding path |
| K-AUX01 | 26 | Kobold abort | Cancellation/control request |
| K-AUX02 | 163, 169, 175 | Kobold status | Status/version/model probes |
| V01 | `src/vectors/openai-vectors.js:113` | Remote embedding adapter | Remote vector send |
| V02 | `src/vectors/nomicai-vectors.js:36` | Remote embedding adapter | Remote vector send |
| V03 | `src/vectors/extras-vectors.js:54` | Remote embedding adapter | Remote vector send |
| V04 | `src/vectors/cohere-vectors.js:20` | Remote embedding adapter | Remote vector send |
| V05 | `src/vectors/ollama-vectors.js:21` | Configured local/service embedding adapter | Network send to configured endpoint |
| V06 | `src/vectors/embedding.js:9–25` | Transformer embedding adapter | Local pipeline; no outbound fetch in this adapter |

### Coverage decision

A future protected-content boundary must be defined from the actual call graph and mounted route map, not just the two main generation routers. Every route whose input can include protected Memory-derived content must either be included in the approved enforcement scope or explicitly denied/marked unsupported. A delegated wrapper with no direct `fetch` is not evidence that it is covered by another hook.

## Target-aware destructive/import guard follow-up (26 Oct 2026)

The pinned candidate now checks the affected chat locator before direct single-chat delete paths and direct group-chat rename. Bulk group/character deletion, chat import, and chat-backup restore fail closed whenever any Host enrollment marker exists, because the current prototype cannot prove a complete inventory for every affected non-current chat. These guards prevent known UI entry points from silently mutating an enrolled history; they do not make those operations supported or provide tombstone-complete deletion.

A desktop Chromium harness now writes the Host journal to real IndexedDB, closes the browser process, reopens Chromium with the same profile, and verifies the hash-chain integrity, sequence, and absence of raw message text. This is stronger than the previous fake-IndexedDB-only test, but Android/Termux persistence, profile restore/rollback, and device-specific storage behavior remain untested.

Exact current candidate head at this audit update: `5bdbfe2dc75811a6f8857c23d3917e560885ce1d`. The corresponding exact-head workflow results are pending re-check after the latest target-aware guard changes. Production Memory→NPC remains DISABLED / FAIL-CLOSED.



## Host coordinator decision — enrolled native saves (28 Oct 2026)

**Interim decision: Option B — keep regular-chat and group-chat native save routes fail-closed until a request-bound pre-write transition mechanism has received the required independent Core review.** This is a safety decision, not a claim that the Host lifecycle blocker is closed. An enrolled conversation currently cannot complete normal edits/saves through the guarded native save routes.

Why this is the selected interim state:
- The existing post-save scan runs after the native JSONL write and cannot undo an overwrite or recover deleted message bytes.
- A digest-only journal records integrity evidence, not message content; it cannot reconstruct a replaced history.
- Silently introducing a new request header, capability API, schema field, or lifecycle protocol would bypass the project's required second Core review of the exact contract/diff.
- Therefore, a failed or missing pre-write authorization must not fall back to the native save handler.

**Conditions to reconsider Option B:** an exact implementation diff must bind the authenticated session, conversation/source path, expected pre-state digest, allowed transition, and submitted post-state digest; consume authorization atomically before the native write; and reject stale/replayed requests, malformed identities, version loss, and path mismatch. Acceptance must prove both regular and group save routes preserve source bytes on rejection and that normal create/edit/swipe/select/delete transitions persist on the exact pinned SillyTavern commit. A failed native save must not advance the accepted checkpoint.

**Separate closure gates remain open:** full pinned-source audit on Windows, live installed SillyTavern/Android-Termux validation, complete route coverage including plugins/external filesystem tools, authoritative historical inventory, and independent anti-rollback/restore evidence. This decision does not authorize Gateway positive integration or Memory→NPC enablement.