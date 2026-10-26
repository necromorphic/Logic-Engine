# SillyTavern lifecycle capability audit

Status: preliminary source inspection only; **not yet verified against the exact pinned commit**.

## Evidence boundary

The supplied `SillyTavern-release.zip` contains `package.json` version `1.19.0`, but does not provide Git metadata proving it is commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. The findings below describe that archive, not an assertion about the exact pinned build. Re-run this audit against the actual pinned checkout before enabling lifecycle capture.

Files inspected:
- `public/scripts/events.js`: event type declarations.
- `public/script.js`: send, generation, edit, swipe, deletion and chat lifecycle emit sites.
- `public/scripts/chats.js`: additional chat/media operations.

## Observed event payloads in the supplied archive

| Capability | Observed event and payload | What this proves | Remaining limitation |
| --- | --- | --- | --- |
| User message sent | `MESSAGE_SENT`, numeric `insertAt` or last chat-array index; `USER_MESSAGE_RENDERED` gets the same numeric index (`public/script.js`, around lines 5907–5919) | A send/render signal exists | Index is positional, not a durable message identity |
| Character message received/rendered | `MESSAGE_RECEIVED` and `CHARACTER_MESSAGE_RENDERED` receive `this.messageId` and generation `type` (`public/script.js`, around lines 3799–3800 and 3828–3829) | Completion/render signals exist | Source does not establish that messageId is stable across edit, delete, swipe, reload or branch changes |
| Generation start | `GENERATION_STARTED` receives generation type, an options object and `dryRun` (`public/script.js`, around line 4299) | Start signal and generation mode are observable | No durable generation/request ID is established by this payload |
| Generation ended | `GENERATION_ENDED` receives `chat.length` (`public/script.js`, around line 3536) | End signal exists | Length is not a target message ID and the event is emitted from stop-button visibility handling |
| Generation stopped | `GENERATION_STOPPED` has no payload at the observed call site (`public/script.js`, around line 5618) | Stop signal exists | No generation correlation ID in payload |
| Swipe selected | `MESSAGE_SWIPED` receives numeric `mesId` (`public/script.js`, around line 10315) | Swipe signal exists | Positional ID only; branch linkage needs separate verification |
| Swipe deleted | `MESSAGE_SWIPE_DELETED` receives `{ messageId, swipeId, newSwipeId }` (`public/script.js`, around line 9388) | A specific message index and swipe indices are exposed | These are indices, not demonstrated immutable identities; semantics need exact-build testing |
| Message edited/updated | `MESSAGE_EDITED` and `MESSAGE_UPDATED` receive numeric `this_edit_mes_id` (`public/script.js`, around lines 8405 and 8431) | Edit/update signals exist | No before/after durable version identity is supplied by the event payload |
| Message deleted | `MESSAGE_DELETED` receives `chat.length` after deletion in observed call sites (`public/script.js`, around lines 1611, 1699, 4411 and 11734) | A deletion-related signal exists | Payload does not identify the deleted target; cannot safely infer rollback target |
| Chat changed | `CHAT_CHANGED` receives `getCurrentChatId()` (`public/script.js`, around lines 7700 and 10760) | Chat-switch signal exists | Exact ID persistence/rename behavior must be confirmed |
| Chat created | `CHAT_CREATED` emitted without a payload after chat selection (`public/script.js`, around line 7701) | A creation signal exists | Does not carry an explicit durable chat ID at this call site |
| Chat deleted | `CHAT_DELETED` receives a name/file-name-derived value (`public/script.js`, around lines 1354, 1401 and 10884) | A deletion signal exists | Exact identity and rename/delete semantics need verification |
| Chat loaded/restart recovery | `CHAT_LOADED` receives `{ detail: { id: this_chid, character: characters[this_chid] } }` (`public/script.js`, around line 7669) | A load signal exists | Does not by itself prove a durable mapping to Engine world/session or generation replay |

Event names are declared in `public/scripts/events.js`; the names above are not inferred from external documentation.

## Safe conclusion

The archive exposes enough signals for a diagnostic capability probe, but the inspected payloads do **not** establish a durable message/generation identity suitable for authoritative Memory capture or rollback. In particular, `MESSAGE_DELETED` reports the post-operation chat length, and swipe/edit/delete signals are index-based.

Do not wire automatic canonical mutation, deletion rollback, or Memory → NPC admission from these signals alone. The next required evidence is:
1. Repeat the payload audit against the exact pinned commit.
2. Verify message/swipe object identity and behavior across edit, regenerate, delete, reload and restart using the pinned build.
3. Persist an adapter-owned generation identity only at a verified lifecycle boundary, with explicit mapping to host IDs where available.
4. Keep ambiguous or unmappable changes as review-required; never infer the target from text hash or current array index.
