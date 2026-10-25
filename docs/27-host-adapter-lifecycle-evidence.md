# Host/Adapter lifecycle evidence — SillyTavern 1.19.0-1-g06bde939f

**Status:** source/event evidence only. No production Host→Provider integration or Memory→NPC disclosure path is proven.

## Scope and evidence labels

Pinned SillyTavern commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

This note records only facts supported by source inspection at that commit and the two redacted runtime diagnostic samples already attached to [Logic-Engine #258](https://github.com/necromorphic/Logic-Engine/issues/258). It does not claim a new runtime test was run.

- **SOURCE-INSPECTED:** event dispatch/payload or persistence ordering visible in the pinned source.
- **RUNTIME-OBSERVED:** event family/payload appeared in the existing redacted samples.
- **UNKNOWN / NOT PROVEN:** no available evidence establishes the behavior.

Pinned source references:
- [Event catalog](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/events.js)
- [Main message/generation dispatch](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)
- [Group-chat dispatch](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js)
- [Slash-command message/edit/delete paths](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/slash-commands.js)

## Confirmed lifecycle facts

| Operation | Confirmed event/payload or source behavior | Evidence | What it does not prove |
|---|---|---|---|
| User message send/append | `MESSAGE_SENT(index)`; inspected append/insert paths save before emitting, but these are distinct code paths. | SOURCE-INSPECTED; RUNTIME-OBSERVED | Index is not durable message identity; uniform ordering across all paths is not established. |
| Generation start | `GENERATION_STARTED(type, options, dryRun)`. | SOURCE-INSPECTED; RUNTIME-OBSERVED | Not a persistence signal or durable generation identifier. |
| Generation completion | `MESSAGE_RECEIVED(index, type)`; `GENERATION_ENDED(chat.length)` on inspected finalization path. In inspected streaming completion, `MESSAGE_RECEIVED` occurs before `saveChatConditional()`. | SOURCE-INSPECTED; RUNTIME-OBSERVED | Does not prove durable persistence at event time, rendered delivery, NPC receipt, acquisition, or belief. |
| Stop/cancel | `GENERATION_STOPPED()` has no arguments. | SOURCE-INSPECTED; RUNTIME-OBSERVED | Partial-message persistence and cancellation outcome/order are unknown. |
| Swipe selection | `MESSAGE_SWIPED(index)`. | SOURCE-INSPECTED; RUNTIME-OBSERVED | Index is not a stable branch/version ID; selected branch persistence is not proven by the event. |
| Swipe deletion | `MESSAGE_SWIPE_DELETED({ messageId, swipeId, newSwipeId })`; the inspected implementation uses message/swipe array positions and mutates the swipe arrays. | SOURCE-INSPECTED; RUNTIME-OBSERVED | These fields are not proven durable IDs; deletion/reindexing lineage across reload is not established. |
| Message edit/update | `MESSAGE_EDITED(index)`, `MESSAGE_UPDATED(index)`; inspected edit path emits events with the current array index and calls `saveChatConditional()`. | SOURCE-INSPECTED; RUNTIME-OBSERVED | No before/after revision IDs or full old/new byte snapshot in the event payload. |
| Message deletion | Inspected delete path splices message(s) then emits `MESSAGE_DELETED(chat.length)`. | SOURCE-INSPECTED; RUNTIME-OBSERVED | Payload is post-delete chat length, not the deleted message identity or complete deletion set. |
| Chat switch/load | `CHAT_CHANGED(chatId)`; `CHAT_LOADED` is declared in the event catalog. | SOURCE-INSPECTED; CHAT_CHANGED RUNTIME-OBSERVED | Chat locator is not a trusted world/session binding; load/save/replay ordering across restart is not proven. |
| Reload/restart | Stored chat objects are loaded back into the chat array; no durable replay journal or stable-ID restoration contract was established in the inspected paths. | SOURCE-INSPECTED | Exactly-once replay, no-loss capture, durable identity, and restart reconciliation are untested. |

## Current Logic-Engine handoff facts

- Current `main` has an authenticated Core authorized-read path; it is not a Memory ingest/persistence endpoint.
- The SillyTavern adapter is not implemented in current `main`. Draft Provider work is not an approved production Host→Provider interface.
- Existing Provider/Core integration tests use fixture callbacks for positive source-version/inventory claims; they do not establish authority from a real SillyTavern source.
- The current event payloads inspected above do not establish durable logical-message IDs, durable per-swipe/version IDs, a stable generation ID, authoritative edit ancestry, or a deletion target suitable for provider retraction.
- The two existing runtime samples establish event presence/shape only. They do not prove persistence ordering, Android/Termux restart/replay, or phone-host/PC-processing topology.

## Unresolved gates

1. **Stable source identity/version:** no approved and runtime-verified mapping for logical message, revision/swipe, generation, and ancestry.
2. **Deletion/reconciliation:** no verified authoritative source-change/retraction feed or complete inventory boundary.
3. **Trusted world/session scope:** chat name/locator alone does not establish authorization to bind a source to a Logic-Engine world.
4. **Provider handoff:** no production persistence operation in current `main` is approved for this adapter.
5. **Restart/replay:** no real-host test proves durable identity, idempotent replay, no-loss capture, or reconciliation after interruption.
6. **Disclosure/revocation:** no real end-to-end test proves revocation at the final serialization/output boundary.

## Decision

**Do not add or enable a production listener from this evidence alone.** Do not infer source IDs from array indices, timestamps, content hashes, or caller labels. Do not route raw chat capture through Core canonical-event endpoints as a substitute for the missing Memory source contract.

Production Memory→NPC remains **DISABLED / FAIL-CLOSED**. The next implementation step requires explicit Core/Provider approval of the source identity/version and handoff contract, followed by a real pinned-host lifecycle/restart test. This document does not propose field names, APIs, schemas, or runtime changes.

## Validation record

- Source inspection target: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Runtime evidence: only the two existing redacted diagnostic samples linked from #258.
- New runtime tests executed in this task: **none**.
- No claim is made that a candidate identity patch was applied or tested.
