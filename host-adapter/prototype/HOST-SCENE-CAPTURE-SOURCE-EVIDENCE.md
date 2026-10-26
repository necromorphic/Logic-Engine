# Host/Adapter — exact source evidence for scene/message capture

**Target:** SillyTavern `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

**Evidence class:** source-inspected at pinned SHA. This document does **not** claim a browser, desktop, Android/Termux, or provider-dispatch experiment. The existing prototype's FakeDB/CI tests are simulated tests and are not promoted to host-runtime evidence. No raw user message text was captured or persisted for this audit.

## Reproduction

Run from a checkout of SillyTavern:

```sh
git rev-parse HEAD
# must print 06bde939fb1e9c4c8d8641d810f0a916b5bce127

rg -n 'MESSAGE_SENT|MESSAGE_RECEIVED|MESSAGE_EDITED|MESSAGE_UPDATED|MESSAGE_DELETED|MESSAGE_SWIPED|MESSAGE_SWIPE_DELETED|GENERATION_STARTED|GENERATION_STOPPED|GENERATION_ENDED|USER_MESSAGE_RENDERED|CHARACTER_MESSAGE_RENDERED' public/script.js public/scripts/events.js public/scripts/openai.js public/scripts/chats.js public/scripts/group-chats.js
rg -n 'saveChatConditional|chat\\.splice|chat\\.push|swipes\\.splice|swipe_id|router\\.post\\(.*/(save|get|delete|import|export|group/delete)' public/script.js public/scripts/chats.js src/endpoints/chats.js
```

Pinned source links:
- [event names](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/events.js)
- [message/generation lifecycle](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)
- [chat UI/edit helpers](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/chats.js)
- [browser Chat Completions request](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js)
- [chat file routes](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/chats.js)

## Exact source observations

Line numbers below refer to the pinned files above; reproduce with `nl -ba <path> | sed -n '<start>,<end>p'`.

| Operation / evidence | Exact observation | What it proves — and does not prove |
|---|---|---|
| Event catalog, `public/scripts/events.js:4-25` | Includes `MESSAGE_SWIPED`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_UPDATED`, `MESSAGE_SWIPE_DELETED`, `GENERATION_STARTED/STOPPED/ENDED`, `USER_MESSAGE_RENDERED`, `CHARACTER_MESSAGE_RENDERED`, `CHAT_CHANGED`, `CHAT_LOADED`. | Event names exist in this build. The catalog alone proves no listener ran, no payload was persisted, and no recipient acquired/believed the content. |
| User message create, `public/script.js:5908-5919` | In the insert-at branch: `chat.splice(insertAt, 0, message)`; `await saveChatConditional()`; emits `MESSAGE_SENT(insertAt)`; reloads; emits `USER_MESSAGE_RENDERED(insertAt)`. In append branch: pushes and saves, then emits `MESSAGE_SENT(chat_id)`, renders, then emits `USER_MESSAGE_RENDERED(chat_id)`. | Event argument is a mutable array index, not a durable message ID. Save-before-event is visible in these branches, but other paths and actual durable write success require separate proof. The event does not carry the message bytes. |
| Message object shape, same creation path | Constructed object includes fields such as `name`, `is_user`, `is_system`, `send_date`, `mes`, `extra`; additional fields are set by path/options. | A current message object may contain original text and metadata at runtime. This is not a stable/versioned handoff contract, and the event itself only supplies an index. No raw bytes are retained by this audit. |
| Generation completion, `public/script.js:3779-3815` | Finalization updates message/swipe data, calls `MESSAGE_RECEIVED(this.messageId, this.type)` and `CHARACTER_MESSAGE_RENDERED(this.messageId, this.type)`; `onFinishStreaming` later awaits `saveChatConditional()`. Error path can emit the same received/rendered event names. | `MESSAGE_RECEIVED` is not proof of successful persistence, visible display, delivery, NPC receipt, acquisition, or belief. Error path may emit these event names too. |
| Generation start, `public/script.js:4299` | `GENERATION_STARTED(type, options, dryRun)`; options contain control flags and an abort signal, but this source line does not establish a durable generation/branch identifier. | Start type/options are observable to listeners. Do not promote them to durable generation identity or assume exactly-once delivery. |
| Generation stop, `public/script.js:5618` | Emits `GENERATION_STOPPED` without arguments in this call site. | The event has no message identity in this call. Cancellation/partial-output semantics must be determined per generation path. |
| Message edit, `public/script.js:8405-8433` | Calls `updateMessage(div)`, emits `MESSAGE_EDITED(this_edit_mes_id)`, emits `MESSAGE_UPDATED(this_edit_mes_id)`, then awaits `saveChatConditional()`. | Hooks identify the current array slot, not the prior bytes or a durable revision/parent. The editor may mutate the current message before the event. No historical version is guaranteed. |
| Swipe selection / generation, `public/script.js:10315` and `public/script.js:3770-3778` | Emits `MESSAGE_SWIPED(messageId)`; generation finalization can append generated strings to `message.swipes` and parallel `swipe_info`, then synchronizes the active message with `syncMesToSwipe(messageId)`. | A swipe is an alternative stored within one message object in these paths, not proven to be a separate logical message. The event supplies only the mutable index. A selected swipe can change current `mes` while alternatives remain in the array. |
| Swipe deletion, `public/script.js:9360-9403` | Removes one entry from `message.swipes` and corresponding `swipe_info`; changes `message.swipe_id`; emits `MESSAGE_SWIPE_DELETED({ messageId, swipeId, newSwipeId })`; saves. | The event does identify indexes within the current message and the new selected index, but those indexes are mutable and not durable branch IDs. Deletion removes the prior alternative from the current state; this does not itself preserve its contents historically. |
| Message deletion, `public/script.js:11710-11735` | Tail deletion truncates `chat.length`, awaits `saveChatConditional()`, then emits `MESSAGE_DELETED(chat.length)`. | The event argument is the new length/cutoff, not the set of deleted message objects or their prior contents. Deleted messages are not recoverable from this event. |
| Chat reload, `public/script.js:7658-7665` | Loaded array replaces current in-memory chat with `chat.splice(0, chat.length, ...data)`; empty/corrupt input clears it. Header metadata is loaded separately. | Reload recovers the currently persisted representation, not historical overwritten/deleted versions. A chat integrity UUID is not a per-message revision/branch identity. |
| Native save, `src/endpoints/chats.js:532-570` | `trySaveChat` serializes current array to JSONL and calls `tryWriteFileSync`; route returns `{ ok: true }` only after the save call completes, or returns an error response. | Native persisted chat is the current serialized state, not an append-only event history. A paired before/after file snapshot is needed to prove the actual persisted delta for each operation. |
| Import/copy/rename/delete, `src/endpoints/chats.js:621-670, 751-870, 900+` | Rename copies then unlinks the source file; import writes a new named file or copies uploaded JSONL; delete removes the file. Group import copies uploaded file. | These are file-level operations outside a message-array-only bridge. They do not carry a complete message-level before/after lineage ledger. Current source alone does not prove all UI/extension copy/restore flows. |
| Chat request dispatch, `public/scripts/openai.js:3138-3150` | After preparing request data, awaits `CHAT_COMPLETION_SETTINGS_READY`, then POSTs `/api/backends/chat-completions/generate`. | This is a pre-request extension event, not a final authorization gate; no approved gate or zero-egress denial test is established here. |

## Real data available vs unavailable

**Available from source/runtime paths (subject to observing the relevant path):**
- Current in-memory message object and its text/metadata before the object is discarded, if an approved capture hook has access.
- Lifecycle event name and event arguments listed above.
- Current selected swipe and alternative text arrays where present.
- Current chat JSONL as loaded/saved, plus current header/chat metadata.
- Save/delete/import/export route outcomes and local logs when instrumented.

**Not proven available as complete history:**
- The old bytes of a message after in-place edit, unless separately captured before mutation.
- Deleted message contents/identity set from `MESSAGE_DELETED`; its argument is a cutoff length.
- Durable identity for a message or generation across index changes, reload, import/copy, or restoration.
- A complete append-only history of swipe branches after a swipe is removed or overwritten.
- Persistence success merely from a lifecycle event; error and event-order variants exist.
- User-visible delivery, other-NPC receipt, acquisition, or belief from host events.
- All native, extension, group, import/export, copy/restore, external-file-edit, and restart/replay paths from the current message array alone.
- Real Android/Termux restart/replay or browser IndexedDB durability from FakeDB CI.

## Required executable tests and current result

The following are acceptance tests to run on a disposable checkout/profile. They are **not claimed as passed** by this source audit:

1. Record pinned HEAD and a baseline hash of the current native chat file; create a message; capture the event name/argument and the post-save file; compare exact object/file delta without logging raw content by default.
2. Replay the same captured callback and assert idempotency under the proposed identity rules; because native event IDs are indexes, mark the result **blocked** until a durable identity source is approved/proven.
3. Edit a message; capture before/after object hashes and native JSONL; prove whether prior content exists anywhere after save. Do not assume `MESSAGE_EDITED` is a prior-version snapshot.
4. Generate two swipes, select each, delete one; compare `swipes`, `swipe_info`, `swipe_id`, active `mes`, and persisted JSONL before/after. Prove which identity remains stable across reorder/delete; if none, keep branch lineage unsupported.
5. Delete one message and a tail range; record exact event arguments and before/after file. Assert the deletion event cannot reconstruct deleted content on its own.
6. Restart the real browser and reload the same chat; compare current chat/journal inventories. Separately kill/restart SillyTavern under Android/Termux. These must be reported as separate environments.
7. Exercise import, export, rename/copy, restore and group deletion; capture paired file/journal inventories and lineage. Uninstrumented or mismatched inventories fail closed.
8. For any future protected prompt path, pause after final prompt assembly, then edit/delete/revoke/change scope before dispatch; resume and assert zero provider egress for deny/error/unknown. This is blocked pending Core's final-disclosure contract and Provider's authoritative currentness/revocation evidence.

## Disposition

- Evidence from this document is **SOURCE-INSPECTED**, not experimentally reproduced.
- Existing Host bridge/FakeDB tests remain **SIMULATED / CI** evidence only; they do not satisfy real-browser or Android/Termux acceptance.
- No raw message text was persisted or transmitted by this audit.
- Do not declare scene-complete memory, complete history, or historical inventory.
- Memory→NPC remains **DISABLED / FAIL-CLOSED**. No Core/Provider/NPC APIs, schemas, authorization semantics, phone installation, or Ollama vectorization patch are changed.
