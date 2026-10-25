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
| Swipe selection | The swipe-cycle path clamps/selects a swipe ID and saves debounced when selection changes; event names in code are not a stable version identity. | Current prototype has a post-selection hook, not a write-ahead selection event. A crash between native state change and journal append should result in fingerprint mismatch, not a confirmed capture. | Source-confirmed; durability gap remains |
| Edit | `public/script.js` contains the message editor commit path, which calls `updateMessage(div)`, emits `MESSAGE_UPDATED`, and later saves the chat. | The event payload is an index; previous content must be separately captured before mutation to establish ancestry. Prototype hook is review-only and not real-device tested. | Source-confirmed |
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

The current candidate PR #282 implements an opt-in IndexedDB journal and patch hooks for a subset of mutation paths. It remains **NON_READY** because required paths are not instrumented, IndexedDB tests use a test double, and there is no real Android/Termux restart/replay run or Host→Provider→Core→NPC test. No claim of successful real-device experiment is made.

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
