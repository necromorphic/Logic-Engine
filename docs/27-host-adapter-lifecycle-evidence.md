# Host/Adapter lifecycle evidence — SillyTavern 1.19.0-1-g06bde939f

**Target:** SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
**Status:** source-inspected lifecycle plus a review-only Host prototype. **NOT READY** for complete source inventory or production Host→Provider integration. Memory→NPC remains **DISABLED / FAIL-CLOSED**.

## Evidence classes

- **SOURCE-INSPECTED:** behavior visible in the exact pinned source.
- **EXISTING RUNTIME SAMPLE:** event family/payload appeared in the already-redacted diagnostics attached to [#258](https://github.com/necromorphic/Logic-Engine/issues/258). This is not a new reproduction and does not prove ordering.
- **PATCH/TEST-CI:** patch applies to the pinned source and prototype tests pass in GitHub CI. This is not an Android/Termux runtime test.
- **UNKNOWN / NOT PROVEN:** no evidence establishes the claim.

Pinned source: [main message/generation paths](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js), [event catalog](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/events.js), [group chat](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js), [slash commands](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/slash-commands.js).

## Lifecycle matrix

| Operation | Native ST behavior / event | Host prototype coverage | Evidence and remaining limitation |
|---|---|---|---|
| User create/send | `MESSAGE_SENT(index)`; inspected append/insert paths save before emitting, but are separate code paths. | Pre/post mutation hooks in patch artifact. | SOURCE-INSPECTED; existing runtime sample shows event. Index is mutable and is not a durable identity. Uniform ordering for all send paths is not proven. |
| Generation start | `GENERATION_STARTED(type, options, dryRun)`. | No durable generation ID is created by native event. | SOURCE-INSPECTED; existing runtime sample. Event does not prove persistence or identify a generation branch durably. |
| Streaming generation | `saveReply`/intermediary message path mutates the message during token streaming. | Candidate patch journals before mutation and defers the final checkpoint until successful finalization. | PATCH/TEST-CI only. CI tests the patch/prototype; no real browser/Android run has proven crash timing, every streaming path, or durable browser storage. |
| Generation complete | `MESSAGE_RECEIVED(index, type)`; `GENERATION_ENDED(chat.length)` on inspected finalization path. In the inspected native path, `MESSAGE_RECEIVED` is emitted before `saveChatConditional()`. | Candidate patch checkpoints successful finalization before the `MESSAGE_RECEIVED` listeners. | SOURCE-INSPECTED + PATCH/TEST-CI. Native event alone is not persistence acknowledgement, UI delivery, NPC receipt, acquisition, or belief. |
| Stop/cancel/error | `GENERATION_STOPPED()` has no arguments. Partial generation may have mutated the message before termination. | Failed/cancelled paths are intended not to advance the completed checkpoint; next operation should detect source/journal mismatch. | PATCH/TEST-CI for prototype guards; real cancel/error paths and partial-content persistence remain NOT PROVEN. |
| Regenerate / create alternate | Native generation/swipe paths operate on a message and its swipe collection; array positions are mutable. | New/changed versions receive distinct prototype version identity; current swipe selection is instrumented before native mutation. | PATCH/TEST-CI. A native swipe index is not a durable generation ID. Runtime branch lineage across restart remains unproven. |
| Select existing swipe | `MESSAGE_SWIPED(index)`; native `standardSwipe` calls `loadFromSwipeId`, which changes the active swipe before later completion work. | `beforeMutation('select-swipe')` precedes `loadFromSwipeId()`; post-mutation checkpoint follows. | SOURCE-INSPECTED + PATCH/TEST-CI. This proves instrumentation order in patched source, not real-device persistence or a complete historical version inventory. |
| Delete alternate swipe | `MESSAGE_SWIPE_DELETED({ messageId, swipeId, newSwipeId })`; native fields are message/swipe positions and swipe arrays mutate. | Prototype records affected version before mutation where patched. | SOURCE-INSPECTED + PATCH/TEST-CI. Native fields are not durable IDs; all delete variants and restored copies are not proven. |
| Edit/update message | `MESSAGE_EDITED(index)` / `MESSAGE_UPDATED(index)`; edit path saves native chat. | Prototype captures affected pre-edit content and post-save changed content as linked immutable versions. | PATCH/TEST-CI. No native durable revision IDs or parent linkage; actual editor/extension/external-edit paths are not all proven covered. |
| Delete message(s) | Inspected path splices entries and emits `MESSAGE_DELETED(chat.length)`; payload is post-delete length, not deleted identity/set. | Prototype captures affected version content before deletion and checkpoints after mutation/save for instrumented paths. | PATCH/TEST-CI. Complete deletion set cannot be reconstructed from event payload alone; uninstrumented deletion routes remain a completeness risk. |
| Chat switch/load | `CHAT_CHANGED(chatId)`; `CHAT_LOADED` exists in the event catalog. | Conversation-bound bridge checks enrolled conversation and journal/source snapshot. | SOURCE-INSPECTED; existing sample shows CHAT_CHANGED. Native chat locator is not Core-authorized world binding. Cross-chat journal lifecycle has not been proven on device. |
| Reload/restart/replay | Native stored chat is loaded into the chat array; native ST has no established contract for replaying a durable Host journal. | Prototype checks journal chain/head and compares native fingerprint plus message/version identity snapshot; divergence should fail closed. | PATCH/TEST-CI only. Actual browser IndexedDB durability, Android process kill/restart, reload, backup restore and replay were not run here. |
| Import/export, copy/branch, restore, migration | No single authoritative complete source inventory/change feed has been established for these paths. | Capture ledger is explicitly enrollment-forward-only; it cannot recover unknown pre-enrollment versions. | UNKNOWN / NOT PROVEN. These paths remain NON_READY; do not claim complete inventory or infer identities from content/index/timestamp. |

## What the current prototype establishes—and does not

The review-only prototype in [Draft PR #323](https://github.com/necromorphic/Logic-Engine/pull/323) adds an opt-in journal, integrity-chain/head checks, a source snapshot comparison, pre-mutation checkpoints, and capture-ledger export bounded to forward-only enrollment. The PR describes tests for swipe checkpoint ordering and old/new content around edit/delete.

CI evidence recorded on #258 for head `a4e8cf3c1f4f54e9d1947634e0ff2204d56ecbe7`:
- [Pinned-source patch check](https://github.com/necromorphic/Logic-Engine/actions/runs/40211783880): PASS, patch applied to the exact pinned ST commit and 30/30 Host prototype tests passed.
- [Pinned-source validation](https://github.com/necromorphic/Logic-Engine/actions/runs/40211783954): PASS, patched entry-point ESLint and module syntax checks.
- [Repository runtime tests](https://github.com/necromorphic/Logic-Engine/actions/runs/40211783900): PASS.

**CI-head caveat:** PR #323 currently reports head `32a2ea3c158c904fa63d259ebd16f723e4508e74`, which differs from the head named in the recorded CI milestone. The connector returned no combined status checks for `32a2ea3c158c904fa63d259ebd16f723e4508e74`. Therefore those PASS results must not be represented as verification of the PR's current head until exact-head CI is rerun and recorded.

The prototype is not installed on the user's Android/Termux instance. It does not prove the real host's current complete inventory, pre-enrollment/deleted history, all import/copy/restore paths, or end-to-end Provider/Core authorization/revocation. No production Host→Provider listener is enabled.

## Provider comparison: actual operations and mismatch

The current Provider mapping documents these Provider-local operations (not an approved Host API/schema):

| Host evidence/output | Existing Provider operation | What is still missing / cannot be inferred |
|---|---|---|
| Immutable captured message version | `captureRawMessage()` | Host must supply the authoritative tuple `(world_id, conversation_id, message_id, version_id)`, exact content/digest and lineage under an approved contract. Prototype IDs alone do not authorize the source. |
| Repeated identical capture | `captureRawMessage()` idempotency | Requires same stable tuple and canonical payload. Host replay across actual restart has not been reproduced on device. |
| Same tuple with different content | Provider rejects raw-capture conflict | Host must retain conflict evidence and fail closed; must not overwrite or remint an ID to hide a collision. |
| Select active swipe | `selectActiveRawVersion()` | Provider can move its active pointer, but host must identify a durable version ID and prove current selection after reload. |
| Delete a version | `markRawSourceDeleted()` | Provider can tombstone only the exact known version. Host must provide pre-mutation identity and prove the affected set is complete. |
| Physical erasure | `purgeRawSource()` | Separate from tombstoning; neither native delete event nor journal proves external copies/caches/vector entries were erased. |
| Read active non-deleted records | `readActiveRawMessages()` / `readRawMessageVersion()` | Provider inventory covers only records it knows. It cannot certify complete SillyTavern active + historical/deleted inventory. |
| Register known derived copy | `registerRawDerivedCopy()` | Provider can track supplied lineage only; it cannot discover unregistered copies or prove Host ancestry. |

The Provider's own SQLite persistence, tombstone, reconciliation and revocation tests establish Provider-local behavior only. They do not certify Host IDs, world binding, completeness, source currentness or production authorization. No approved production Host→Provider listener is present.

## Binary inventory verdict

**NON_READY / NO SUCH MECHANISM FOUND** for a verified complete SillyTavern source inventory spanning active plus historical/deleted versions and covering import/export, copy/branch/restore, migration, external edits, restart/replay and rollback. The prototype's bounded statement is **enrollment-forward-only**, and even that remains conditional on every source mutation path being instrumented and both native save and journal append succeeding. Pre-enrollment deleted history is `UNKNOWN_UNRECOVERABLE`.

## Decision / safety boundary

- Do not treat `MESSAGE_RECEIVED` as user-visible delivery, NPC receipt, acquisition or belief.
- Do not use array index, timestamp, swipe position or caller-provided ID as durable authority.
- Do not add a production listener, new API/schema, or cross-block wiring on the basis of this evidence alone.
- Keep untested or ambiguous paths NON_READY; do not return a false complete-empty result.
- Existing Ollama/vectorization files remain untouched.
- Memory→NPC remains **DISABLED / FAIL-CLOSED**.

## Validation record

- Pinned source inspected: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Existing redacted runtime samples: issue #258; not re-requested and not reinterpreted as proof of ordering.
- Prototype CI: links above, with the explicit current-head caveat.
- Real Android/Termux restart/replay and end-to-end Provider/Core integration: **not run / not proven**.
