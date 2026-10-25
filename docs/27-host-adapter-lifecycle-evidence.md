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

Earlier CI on head `a4e8cf3c1f4f54e9d1947634e0ff2204d56ecbe7` passed the pinned-source patch check (30/30 Host prototype tests), patched entry-point validation, and repository runtime tests; those historical runs are not used as proof for the current head.

**Current exact-head CI:** PR #323 head `504057e4103452442dd3cb1256ba06ff5afbeeaa` has three successful workflows:
- [Pinned-source patch check](https://github.com/necromorphic/Logic-Engine/actions/runs/40217059019): SUCCESS — patch applies to the exact pinned source; all 31 Host prototype tests pass.
- [Pinned-source patch validation](https://github.com/necromorphic/Logic-Engine/actions/runs/40217058981): SUCCESS — patched entry-point ESLint and module syntax checks.
- [Repository runtime tests](https://github.com/necromorphic/Logic-Engine/actions/runs/40217059353): SUCCESS.

During this follow-up, exact-head patch validation exposed a hunk-order/count defect; the candidate was corrected and re-run. The patch now checkpoints edit, swipe deletion, and enrolled whole-message deletion after the relevant awaited native save where that path supports one, and regression assertions enforce this ordering. The successful runs above apply to the corrected exact HEAD. They do **not** establish real Android/Termux execution, complete inventory, restore/import/copy coverage, or production integration.

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

## Additional pinned-source audit: server-side delete and restore/import paths

The pinned source contains deletion paths outside the currently loaded message array. These are source-inspected, but are not covered by the Host journal patch:

- Character chat deletion: `public/script.js` `delChat(chatfile)` calls `POST /api/chats/delete`; if the deleted chat is current, it calls `replaceCurrentChat()` before emitting `CHAT_DELETED(name)`. The event payload is a chat name, not a message/version set. [Pinned client source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L1338-L1355); [server endpoint](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/chats.js#L654-L677).
- Non-current character chat deletion: `deleteCharacterChatByName(characterId, fileName)` calls the same endpoint without loading the target chat's messages into the current in-memory `chat` array. Its `CHAT_DELETED` event also carries only the name. [Pinned client source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L1364-L1402).
- Group chat deletion: `deleteGroupChatByName` and `deleteGroupChat` call `POST /api/chats/group/delete`; the server deletes the group chat file directly. These paths likewise do not supply a complete message/version inventory to the current Host bridge. [Pinned client source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js#L2242-L2310); [server endpoint](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/chats.js#L900-L920).
- Character deletion with `delete_chats=true` removes the character's chat directory recursively server-side. The client emits per-chat `CHAT_DELETED` names from its past-chat list, not per-message/version tombstones. [Pinned client source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L10828-L10890); [server endpoint](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/characters.js#L1416-L1450).
- Backup restore is an import path, not an in-place message mutation hook: `BackupsBrowser.restoreBackup()` downloads a backup then calls `importCharacterChat` or `importGroupChat`. The backup file deletion endpoint deletes the backup artifact only. [Pinned backup UI](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/chat-backups.js#L69-L142); [backup endpoint](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/backups.js#L32-L66).

**Acceptance implication:** a hook on `clearChat()` or the current chat array cannot establish complete deletion/restoration coverage. Non-current chat deletion, group-file deletion, recursive character-chat deletion, and backup restore/import remain explicit uncovered paths; do not infer their affected version set from `CHAT_DELETED`, `GROUP_CHAT_DELETED`, file names, or the current chat snapshot. The binary inventory verdict therefore remains `NON_READY / NO SUCH MECHANISM FOUND`.

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
- Prototype CI: current-head checks for PR #323 HEAD `504057e4103452442dd3cb1256ba06ff5afbeeaa` pass (links above); scope remains CI patch/prototype only.
- Real Android/Termux restart/replay and end-to-end Provider/Core integration: **not run / not proven**.


## Persisted-state transitions for uncovered paths (source audit; no device experiment)

This section distinguishes **native source state** from **Host journal state**. The before/after descriptions below are the states implied by the inspected source operations, not captured disk snapshots or Android/Termux runtime observations. No exact chat-file bytes, journal bytes, or before/after hashes were collected in this pass. Therefore source inspection can prove that a path bypasses the current message-array hooks; it cannot prove the full persisted state or reconcile every affected version.

| Path | Persisted/source state before | Native persisted/source state after | Host prototype visibility and journal consequence | Verdict |
|---|---|---|---|---|
| Delete a non-current character chat | A separate chat file exists on the server; its messages are not loaded in the current in-memory `chat` array. The complete Host-ledger set for that file is not established. | `deleteCharacterChatByName(characterId, fileName)` requests server-side deletion; the client emits `CHAT_DELETED(name)`, not message/version tombstones. Exact post-delete disk snapshot was not captured. | Current-array hooks cannot enumerate the deleted chat's messages. A chat-name event cannot safely map to every active, alternate, historical, or derived version. Journal cannot prove a complete before/after inventory or issue exact per-version retractions. | **BLOCKED** — source path found; persisted before/after snapshot and full affected set not tested. |
| Delete a current character chat | Current chat is loaded; native chat file is the persisted source. The exact version inventory known to the Host journal is not proven complete. | `delChat(chatfile)` calls `replaceCurrentChat()` when current, sends `POST /api/chats/delete`, then emits `CHAT_DELETED(name)`. Server endpoint deletes the chat file. The event is not a per-message inventory. | The current-array deletion instrumentation does not establish that every message/swipe/version was captured before the chat is cleared or that the journal is atomically reconciled with server deletion. | **BLOCKED** — delete path is source-inspected; atomic pre-delete inventory and post-delete reconciliation not proven. |
| Delete a group chat | Group chat file exists; its full message/swipe/version inventory is not proven to be present in the current Host journal. | `deleteGroupChatByName` / `deleteGroupChat` call `POST /api/chats/group/delete`; server removes the group-chat file. Exact disk state before/after was not captured. | The current message-array hook does not enumerate a deleted group's complete source history. Group/chat-level event data cannot be treated as a per-version tombstone set. | **BLOCKED** — source path found; no complete per-version deletion proof. |
| Delete a character and recursively delete its chats | Character directory and potentially multiple chat files exist. A complete Host inventory across all chats and historical swipes is not established. | With `delete_chats=true`, the server recursively removes the character's chat directory; client notifications are chat names, not message/version records. Exact file-set diff was not captured. | A sequence of chat-name notifications does not prove the inventory of each file before deletion, the version count, or that all ledger entries/derived copies were retracted. | **BLOCKED** — recursive deletion is outside the message-array accounting boundary. |
| Restore a backup / import a chat | Backup artifact contains a saved chat snapshot; destination may already contain a chat or may be absent. Exact source and destination bytes/identities were not captured. | `BackupsBrowser.restoreBackup()` downloads the backup and dispatches to `importCharacterChat` or `importGroupChat`. Exact overwrite/merge semantics, destination identity mapping, and resulting persisted bytes were not established by the cited inspection. | Current hooks may see a subsequent load/current snapshot but cannot, by themselves, prove backup ancestry, distinguish reintroduced old versions from new revisions, or reconcile every prior tombstone. | **BLOCKED** — import route source-inspected; before/after file diff, lineage and runtime outcome not tested. |
| Copy / branch / duplicate chat | Source chat has some persisted state; whether every swipe and deleted/alternate version is in the Host ledger is unknown. | No complete pinned-source copy/branch operation plus persisted before/after snapshot has been demonstrated in this evidence set. A copy may preserve content while changing file/chat identity; that alone does not establish ancestry. | No verified Host observation links the copied chat to the source chat with durable parent/branch identity. Equal content, filename, index, or timestamp is insufficient to infer lineage. | **NOT TESTED / UNKNOWN** — do not claim copy/branch coverage. |
| Migration / format conversion | Source format/version and complete message/swipe inventory are unknown for this scenario. | No exact migration operation with captured source and destination state was exercised in this pass; whether it rewrites in place, imports to a new file, or changes identity is not established here. | The Host journal has no proven migration mapping/reconciliation record. Hash equality alone would not prove source lineage; hash change alone would not prove a semantic revision. | **NOT TESTED / UNKNOWN** — migration coverage remains open. |
| Browser reload / PC or Android process restart / replay | Native chat file and candidate journal may each contain persisted state, but their exact pre-restart heads and durability relationship have not been captured together. | ST reloads stored chat data into memory; the prototype has a journal integrity/head check and source snapshot comparison in CI. No actual process-kill/restart/replay was run against the user's Android/Termux installation. | CI proves prototype behavior on its harness only. It does not prove IndexedDB durability, recovery ordering, exactly-once replay, crash-window behavior, or no-loss reconciliation on the phone. | **NOT TESTED** — actual Android/Termux restart/replay required. |

### Required evidence capture to turn a blocked row into a pass

For each runtime scenario, capture a redacted, paired record with the exact pinned build and test identifier:

1. **Before operation:** source locator/type; exact persisted file/artifact existence; byte length and cryptographic digest of the exact stored bytes where permitted; number of logical messages and alternate swipes; selected swipe per message; Host journal head/chain verification; ledger entries grouped by source/chat/version; known derived-copy references. Do not expose message text or secrets by default.
2. **Operation record:** exact UI/API action, timestamp as diagnostic metadata only, source event names/argument shapes, save completion/failure, journal append completion/failure, and any crash/interruption point.
3. **After operation:** repeat the same source and journal measurements; compare exact persisted artifacts; list additions, removals, changed bytes, selected-version changes, and unresolved identities. If the native source is gone, preserve the pre-operation inventory evidence rather than infer it from the deletion event.
4. **Restart/replay:** terminate the relevant process, restart from the pinned checkout, record loaded source identity and journal head, replay/reconcile, then repeat the after-state inventory. Test duplicate replay and interrupted native-save/journal-append windows.
5. **Decision:** mark `PASS` only if the affected set is complete, durable identity/lineage survives, before/after state reconciles without silent overwrite, and unknown/conflicting state fails closed. Otherwise keep `BLOCKED` or `NOT TESTED`.

These measurements must not be represented as already performed: this document currently contains source-inspected paths and CI prototype evidence, not paired persisted-state captures. Do not add a production listener, new API/schema, or Provider/Core wiring to collect them without owner approval.
