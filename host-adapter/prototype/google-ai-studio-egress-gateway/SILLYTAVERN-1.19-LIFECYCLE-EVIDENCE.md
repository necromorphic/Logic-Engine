# SillyTavern 1.19.0 lifecycle evidence — source audit

**Evidence class:** source-inspected only. No live browser/runtime experiment was performed. This document records what the pinned source proves and what it does not prove.

## Pinned source identity

- SillyTavern commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`
- `public/script.js` blob: `777a2d5983a6283ef9b26726e75192da1e3f3cea`
- `public/scripts/events.js` blob: `852eaa7fc9e725f7646eb00f8d5f41c39307ef02`

## Lifecycle evidence matrix

| Lifecycle | Event / arguments | Source evidence | What is established | What is NOT established |
|---|---|---|---|---|
| User message send | `MESSAGE_SENT(messageIndex)` | `public/script.js:5907-5919` | User message is inserted into in-memory chat; `saveChatConditional()` is awaited before MESSAGE_SENT; render event follows. | Index is not durable identity. Other send paths (slash commands/extensions) also emit this event. No stable message UUID is proven. |
| User-visible render | `USER_MESSAGE_RENDERED(messageIndex)` | `public/script.js:5910-5919` | Render notification occurs after send persistence call and DOM insertion/reload in this path. | Does not prove that an NPC received or consumed the message. |
| Assistant receive (streaming) | `MESSAGE_RECEIVED(messageId, type)` | `public/script.js:3798-3817` | Finalization emits after message mutation and before `saveChatConditional()` in `onFinishStreaming`. | Not a persistence-complete signal. It may fire from `onErrorStreaming` for non-swipe/non-continue types (`3820-3829`), so it is not proof of successful completion or delivery. |
| Assistant receive (non-streaming) | `MESSAGE_RECEIVED(chatIndex, type)` | `public/script.js:6690-6738` | Event emitted after in-memory message data is populated; some branches suppress it when `fromStreaming` is true. | The event has multiple generation types and may not fire for every mutation path. Index is a mutable array position. |
| Edit | `MESSAGE_EDITED(index)`, then `MESSAGE_UPDATED(index)` | `public/scripts/slash-commands.js:5850-5858`, `5916-5924` | The edited chat object is updated before these events; MESSAGE_UPDATED follows DOM refresh; save is awaited after both. | Neither event is a post-persistence acknowledgement. Event payload is only the array index. Other edit paths need inventory. |
| Delete message | `MESSAGE_DELETED(chat.length)` | `public/script.js:1678-1699`, `1607-1612` | In-memory splice/deletion precedes event. In `deleteMessage`, save is debounced and not awaited before event. | Not a durable-delete acknowledgement. Payload is new chat length, not deleted message identity. `deleteLastMessage` emits without a save in the shown function. |
| Swipe / alternate generation | `MESSAGE_SWIPED(messageIndex)` | `public/script.js:9954-9971`, `10307-10318` | Swipe targets an existing chat array element; event fires after visible swipe transition/state update. A swipe can launch `Generate('swipe')` after event. | Does not create a new chat message identity in this path. Swipe variants are stored in `message.swipes`, selected by `swipe_id`; this is one logical host message with alternate content, not evidence of a new durable message. |
| Swipe deletion | `MESSAGE_SWIPE_DELETED({messageId, swipeId, newSwipeId})` | `public/script.js:9339-9403` | Removes an element from `message.swipes` and corresponding `swipe_info`; event identifies only array positions. | No durable swipe UUID or immutable revision identifier. |
| Generation start | `GENERATION_STARTED(type, options, dryRun)` | `public/script.js:4292-4300` | Emitted for every Generate invocation; options include flags and AbortSignal. | Source comment explicitly says it occurs even if generation is aborted due to slash-command execution. Not proof a provider request was dispatched. |
| Generation stop | `GENERATION_STOPPED()` | `public/script.js:5607-5619` | Emitted by `stopGeneration()` after abort/stream-stop handling. | No generation ID; no proof provider cancellation was acknowledged. |
| Generation ended | `GENERATION_ENDED(chat.length)` | `public/script.js:3532-3537` | Emitted when stop button transitions from visible to hidden. | It is UI-state-driven and carries chat length, not a generation identity or provider completion result. Do not equate with successful generation. |
| Chat switch/load | `CHAT_CHANGED(getCurrentChatId())` | `public/script.js:541-547`, `7693-7705` | Chat id is derived from selected character's `chat` field or selected group's `chat_id`; after chat loading, itemized prompt load and rendering, CHAT_CHANGED is emitted. | This value is a host chat locator/name, not authenticated identity and not proven immutable. Event has one string-like locator, no session ID. |
| Chat create | `CHAT_CREATED()` | `public/script.js:7700-7702` | Emitted after CHAT_CHANGED for fresh chat path. | No chat ID in payload; creation lifecycle elsewhere needs inventory. |
| Reload/recovery | `CHAT_CHANGED` emitted by chat load path | `public/script.js:7634+`, `7693-7705` | The normal load path emits after load/render. | This source inspection does not establish restart/recovery identity continuity or replay semantics across process restarts. |

## Important source-derived conclusions

1. `MESSAGE_RECEIVED` is not a safe acquisition/delivery boundary: streaming finalization emits before the awaited chat save, and error handling can emit it as well.
2. `MESSAGE_SENT` is stronger for the ordinary user-send path because save is awaited first, but its numeric index is still only a position and alternate send paths exist.
3. `MESSAGE_EDITED` and `MESSAGE_UPDATED` are pre-save notifications in the inspected edit path.
4. `MESSAGE_DELETED` is pre-durable-delete in the inspected path: save is debounced or absent in the shown function.
5. Swipe is an alternate content/version on the same message object (`swipes[]` + `swipe_id`); the event only provides the message array index.
6. Generation lifecycle events are not correlated by a stable generation ID. STARTED can occur for dry runs and before abort; STOPPED has no arguments; ENDED is coupled to stop-button visibility.
7. `getCurrentChatId()` returns a character chat locator or group chat_id. It is not a server-authenticated session identifier.
8. No event inspected here establishes user-visible receipt by an NPC, actual provider dispatch, or a durable immutable source identity.

## Issue #258 gate status

| Acceptance item | Status |
|---|---|
| Exact source commit pinned | PASS (candidate baseline; owner approval still required by #258) |
| Message send event signature/order | SOURCE-INSPECTED |
| Message receive event signature/order | SOURCE-INSPECTED; unsafe as delivery/acquisition boundary |
| Edit/delete/swipe semantics | SOURCE-INSPECTED; durable identity/revision absent |
| Generation start/stop/end semantics | SOURCE-INSPECTED; no stable generation ID |
| Chat switch/create semantics | SOURCE-INSPECTED; chat ID is locator only |
| Runtime event payload capture | NOT RUN |
| Reload/restart/replay experiment | NOT RUN |
| Real host stable message identity | NOT PROVEN |
| Approved raw-byte retention contract | NOT PROVIDED |
| Production adapter/handoff implementation | NOT IMPLEMENTED |

## Required adapter behavior pending owner-approved contract

- Do not use message array index or timestamp as durable message identity.
- Do not treat MESSAGE_RECEIVED, MESSAGE_RENDERED, GENERATION_ENDED, or a UI callback as proof of NPC receipt or provider dispatch.
- Treat swipe as a version/branch candidate of an existing message until a runtime experiment and owner-approved schema establish otherwise.
- Do not claim original raw bytes are retained: the approved retention/encoding contract is not present in this source evidence.
- Ambiguous identity, uncorrelated generation, delete/edit persistence uncertainty, or chat-locator collision must fail closed for Memory→NPC.
- Next proof step is a live pinned-host harness capturing the exact callback payloads and persistence/reload sequence; it must not be replaced by fixture-only emitter tests.
