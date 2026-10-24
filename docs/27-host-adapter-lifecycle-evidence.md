# Host/Adapter lifecycle evidence — SillyTavern 1.19.0-1-g06bde939f

Status: **runtime integration blocked; no Memory→NPC production path enabled**.

Audit target supplied by the user: SillyTavern tag description `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. This note is based on source inspection at that exact commit and the two redacted runtime diagnostic samples recorded in [Logic-Engine #258](https://github.com/necromorphic/Logic-Engine/issues/258). Runtime samples prove that observed event families fired on the sampled instance; they do not prove persistence order, restart/replay semantics, durable identity, or the phone-host/PC-view topology.

Pinned source:
- [event catalog](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/events.js)
- [main message/generation dispatch](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)
- [group-chat dispatch](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js)
- [slash-command message/edit/delete paths](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/slash-commands.js)

## Lifecycle evidence matrix

Evidence labels: **source-inspected** = exact target source reviewed; **runtime-observed** = present in the supplied redacted diagnostics; **unknown** = not established by the current evidence. No row below is an end-to-end adapter test.

| Lifecycle operation | Concrete ST source / event payload | Save/persistence ordering established | Durable source identity/version | Existing Provider operation usable from current `main` | Safe behavior now |
|---|---|---|---|---|---|
| User message append/send | Main message path in `public/script.js`; `MESSAGE_SENT(index)`. Slash-command insert path in `public/scripts/slash-commands.js` uses save → event(index) → reload → rendered; ordinary append path uses chat-array index. Runtime-observed. | In the ordinary append path, save is awaited before `MESSAGE_SENT`; insert-at-index also saves before emitting. Different paths exist, so event name alone does not guarantee one uniform order. | **No.** Numeric array index is position, not stable identity. No host revision/generation ID in this payload. | **No.** Current `main` exposes no Memory ingest/persist endpoint or Host/Adapter runtime. | Do not ingest or attach causal effects from the index alone. |
| Generation start | `GENERATION_STARTED(type, options, dryRun)`; repeated starts observed. Event catalog in `public/scripts/events.js`; dispatch in main/group generation code. | Start event is not a persistence signal. | **No.** Options can contain transient controls (e.g. AbortSignal); not a durable generation identity. | **No.** | Treat as diagnostic only; do not serialize the options object as source identity. |
| Generation completion | `MESSAGE_RECEIVED(index, type)`; `GENERATION_ENDED(chat.length)` on inspected finalization path. Runtime-observed. In `onFinishStreaming`, `MESSAGE_RECEIVED` is emitted before `saveChatConditional()`; error-streaming can also emit it. | **Not confirmed as persisted at MESSAGE_RECEIVED.** The event precedes conditional save on the inspected streaming completion path. | **No.** Index/type and chat length are not a generation ID or stable revision. | **No.** | Never treat `MESSAGE_RECEIVED` or rendered events as delivery, NPC receipt, acquisition, or belief. |
| Stop/cancel | `GENERATION_STOPPED()` (zero arguments); present in the second supplied runtime sample. | Whether a partial message is saved, and at what point relative to the event, is not established by the available evidence. | **No.** No generation ID or cancellation outcome payload. | **No.** | Keep the partial/aborted generation unresolved; no rollback or source mutation inferred. |
| Regenerate | Generation-start/end events plus message/swipe events; no single authoritative regenerate event/ID established in the audited contract. | No complete ordering/replay proof. | **No.** Cannot reliably link old and new generations or establish whether the host revises one logical message or selects a branch. | **No.** | Do not create a synthetic durable generation ID and pretend it is the host source ID. |
| Select swipe | `MESSAGE_SWIPED(index)`; runtime-observed. | The event by itself does not establish selected branch persistence. | **No.** Index only; no branch ID or parent revision in the event. | **No.** | Mark branch lineage unresolved; do not retract or commit effects automatically. |
| Delete a swipe | `MESSAGE_SWIPE_DELETED({ messageId, swipeId, newSwipeId })`; source-inspected. Values are host-local indices. The supplied runtime sample observed this event family. | Durable storage ordering and identity stability across reload are not established. | **No.** These fields are not durable source IDs. | **No.** | No provider delete/revoke call; quarantine affected source linkage. |
| Edit/update message | `MESSAGE_EDITED(index)` and `MESSAGE_UPDATED(index)`; dispatch in `public/scripts/slash-commands.js`; runtime-observed. | No complete old/new byte snapshot or persistence-order contract established. | **No.** Event carries an index, not before/after revision IDs. | **No.** | Do not overwrite an existing source revision; fail closed until old/new lineage is authoritative. |
| Delete message | `MESSAGE_DELETED(chat.length)` in inspected delete paths, emitted after splice; runtime-observed. | Event is post-mutation in inspected paths; full durable persistence timing/replay is unproven. | **No.** Payload is post-delete length, not the deleted message ID or a complete deletion set. | **No.** | Cannot safely identify which provider record to retract. No guessed delete. |
| Switch chat | `CHAT_CHANGED(chatId)`; `CHAT_LOADED({ detail: { id, ... }, ... })`; event catalog in `public/scripts/events.js`. Runtime-observed for CHAT_CHANGED; CHAT_LOADED absent from samples, not proof it never fires. | Chat load/save ordering across switch has not been reproduced end-to-end. | Chat ID is available as host chat locator, but does not establish host instance/session, world binding, message version, or generation lineage. | **No.** | Stop any pending work bound to the previous chat; require explicit trusted world/chat binding before ingest. |
| Reload/restart/recovery | No durable replay/recovery event contract established. `CHAT_LOADED` is a load signal, not a restart journal. | **Unknown.** No evidence that all changes replay once, in order, or with stable IDs after restart. | **No proven durable mapping** across restart. | **No.** | Do not reconstruct source identity from current array position or timestamp. Require reconciliation before any future consumer. |

## Core / Provider contract check

- Current `main` has an authenticated `/v1/worlds/:worldId/authorized-read` path and related Core authorization code, but this is a read path, **not a Memory persistence API**. The current README explicitly describes the SillyTavern adapter as not implemented.
- The Memory Provider SQLite implementation is in draft [PR #201](https://github.com/necromorphic/Logic-Engine/pull/201), not an approved production default. It requires trusted source-version/snapshot/inventory callbacks and is not wired to a host source. Its proposed provider contract is not authority for an adapter to invent source IDs or claim reconciliation.
- Core selected architecture direction A in [#140](https://github.com/necromorphic/Logic-Engine/issues/140): Host-owned durable logical-message IDs plus per-version/swipe IDs persisted with ST message data. This is not yet an approved concrete field mapping/runtime contract or durable source-change feed; production Memory→NPC remains disabled. Core consumer work in [PR #168](https://github.com/necromorphic/Logic-Engine/pull/168) is a fail-closed injected seam, not host/provider proof.
- Existing docs `docs/13-sillytavern-adapter-contract.md` are requirements, not an executable Host/Adapter. No real listener invoking a Memory Provider persistence entry point is present in the inspected current-main path.

## Exact blockers (not solved by event presence)

1. **Host identity:** ST message events mostly expose chat-array indices; swipe-delete IDs are host-local. No authoritative durable message ID + revision/parent identity is carried through the lifecycle.
2. **Generation/branch lineage:** no durable generation ID, selected branch ID, or authoritative old→new relationship is exposed by the observed event payloads.
3. **Deletion/retraction:** `MESSAGE_DELETED` reports post-delete length, not the deleted logical source. No safe provider target can be derived.
4. **Revision bytes:** no approved contract permits retaining exact source bytes; events do not consistently supply the before/after byte sequence. Do not hash a reconstructed string and label it original host bytes.
5. **Provider target:** current `main` has no Memory persistence entry point. Draft Provider code is not a stable approved adapter contract and needs Memory/Core owner review.
6. **Reconciliation and authority:** no approved source-specific change feed/inventory proof or trusted mapping from host chat to world/session. Host-provided IDs/labels cannot authorize a read or write.
7. **Restart/replay:** no reproduced restart test proves idempotent event replay or stable identities across reload.

## Fail-closed implementation decision

**Do not add a fake production listener or call Core canonical-event routes for raw chat capture.** That would invent an identity/lifecycle contract and bypass Memory's ownership of source records, version, lineage, index and revocation. No runtime code can be safely wired to an existing Provider persistence path on current `main` because that path is not present there; the draft Provider branch is not an approved interface.

The next implementable slice is to propose a concrete mapping from the ST fields described below to the approved architecture direction, for Core + Provider review. Core has not approved field names or runtime schema. After the mapping and Provider entry point are explicitly accepted, add the adapter and test it against the pinned ST source/runtime. Do not enable production retrieval until those tests and owner gates pass.

## Validation record

- Source target: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Source inspection: complete for the event shapes/order summarized above; links point to exact commit.
- Runtime diagnostics: two redacted samples referenced in [#258](https://github.com/necromorphic/Logic-Engine/issues/258); these are event-presence/shape evidence, not full lifecycle or persistence integration tests.
- Automated adapter tests: **not added**, because no safe executable provider handoff exists on current `main`. A fixture-only test would not prove the requested production path.
- No Core, Memory Provider, Personality, vectorization, API, schema, storage, outbox, cursor, or lifecycle implementation changed by this audit.

## Follow-up: persisted identity/version evidence for Core decision A

This follow-up is a **source inspection of the exact pinned commit**, not a claim that the phone runtime was exercised. Exact source references:

- [Swipe storage and active swipe selection](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6642-L6685): `saveReply()` treats a swipe as another slot in the existing message's `swipes` array and mutates the active message fields. This is not a durable per-swipe identity.
- [Swipe synchronization](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6833-L7018): `swipe_id` is a numeric array position; `swipe_info` is parallel metadata indexed by that position. The backfill path creates metadata from message dates/generation times and empty `extra`, not a durable version key.
- [Swipe selection event](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L9954-L10320): `swipe()` resolves a message via current array position and emits `MESSAGE_SWIPED(mesId)`; no logical-message or selected-version ID is in the event payload.
- [Swipe deletion event](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L9339-L9408): `deleteSwipe()` removes an array entry, changes the active numeric `swipe_id`, then emits `MESSAGE_SWIPE_DELETED({ messageId, swipeId, newSwipeId })`. These values are positions before/after array mutation; deleting a slot shifts the identity of later positions.
- [Message edit event](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L8397-L8435): `messageEditDone()` emits `MESSAGE_EDITED(this_edit_mes_id)`, then updates the rendered message, emits `MESSAGE_UPDATED(this_edit_mes_id)`, and calls `saveChatConditional()`. The event arguments are the current array index; there are no before/after revision IDs in the payload.
- [Message deletion](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L1639-L1700): `deleteMessage()` splices the selected index (and possibly preceding tool-call messages) and emits `MESSAGE_DELETED(chat.length)`; it does not identify the deleted message in the event.
- [Reload from stored chat](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L7634-L7675): `getChat()` requests the chat by character and chat filename, removes the header, then restores the returned message objects. This path does not itself assign a stable logical-message ID or per-swipe ID.
- [Group chat load/save](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js#L260-L322) loads the stored array directly into `chat`; fresh greeting messages are created with `send_date` and `extra.gen_id`, but no stable message ID. `saveGroupChat()` persists the message objects as JSON.
- [Event catalog](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/events.js#L1-L24) declares the event names; it defines no durable identity contract.

### Observed source-level before/after shape

| Operation | Before → after, as established by source | Identity / collision result |
|---|---|---|
| New message | Appends a message object with content/role/date/extra metadata to the chat array; persistence serializes the chat objects. | No dedicated logical-message ID in the inspected constructor path. `send_date` is time metadata, not a guaranteed unique ID. |
| New generated swipe | Adds/replaces content in `swipes[]`; current content and `swipe_id` point at a selected array slot; `swipe_info[]` parallels it. | A slot number is not stable under deletion/reordering; no persistent parent/version identifier. |
| Select another swipe | Updates which array slot is active and emits the message index. | Same message object, different active slot; event doesn't convey stable version identity. |
| Delete swipe | Removes a slot and reindexes later slots; active `swipe_id` is adjusted; event carries old/new slot numbers. | Collision/alias risk if an external consumer treats slot numbers as identity; identity cannot be reconstructed after deletion from those numbers. |
| Edit message | `updateMessage()` mutates the selected chat object; edit/update events carry only the index; save follows the events on this path. | No persisted prior-revision link or explicit revision counter in the inspected path. |
| Delete message | Removes one or more array entries; event carries new chat length. | Deleted logical source cannot be identified from event payload after the splice. |
| Reload/restart | Stored message objects are loaded back into the array; legacy swipe metadata may be backfilled. | No code-inspected guarantee that durable IDs exist or survive import/reload because these fields are not established in the current message contract. |

### Execution status (do not overstate)

- **SOURCE-INSPECTED:** exact pinned commit and the paths above.
- **RUNTIME-OBSERVED:** only the event families/payload shapes present in the two existing redacted diagnostic samples linked from #258.
- **NOT TESTED in this session:** real persisted before/after snapshots on the Android/Termux runtime; swipe creation/switch and delete through reload; message edit/delete across reload; branch/duplicate chat collision behavior; import/restore; process restart/replay; executable pinned-host adapter regression. The GitHub source connector permits source reads but does not launch the user's pinned ST runtime or execute commands inside that runtime. No fixture UUIDs or synthetic runtime results are substituted for these missing tests.
- **No executable command result is claimed.** There is no runnable local checkout/runtime in this session; therefore no `npm test` or ST lifecycle test was run. Existing Provider CI is provider-local and cannot prove these Host lifecycle cases.

### Minimal mapping proposal for Core review (not implementation)

1. Persist a stable logical-message ID in the ST message object, and a distinct stable version/swipe ID inside each swipe's metadata, preserving those values through save/load, branch/copy, import/restore, and swipe deletion/reindexing. Do not reuse `swipe_id`, array index, timestamp, or `extra.gen_id` as the durable key.
2. Emit/observe before-and-after lifecycle changes with the stable IDs from the stored objects. For deletion, capture the deleted object's IDs before `splice`; the current `MESSAGE_DELETED(chat.length)` cannot be the source of a retraction target.
3. On duplicate/import/branch collisions, detect duplicate ID + same canonical bytes as duplicate delivery, but treat same ID + different bytes or ambiguous ancestry as conflict/fail-closed. Exact canonical-byte/hash policy and whether raw bytes may be retained remain owner decisions.
4. This proposal is only a mapping for Core/Provider review. **No new field names, event payload, API, schema, storage, outbox, cursor, or reconciliation mechanism is implemented or authorized by this note.**


## Host-side concrete mapping proposal against Provider PR #201 (24 Oct 2026)

**Status: proposed semantic mapping for joint review; not an approved runtime contract.** This section compares the pinned ST source with the actual Provider draft at [PR #201, head `e03e3b608d029ba431d004ef940a32b67ee00e10`](https://github.com/necromorphic/Logic-Engine/pull/201). It does not change Provider/Core or authorize a new ST field/API/schema. Provider code is draft and unmerged; current `main` still has no callable production Host→Provider handoff.

### Candidate identity mapping

| Semantic identity | Existing Host evidence | Existing Provider PR #201 surface | Host proposal / unresolved approval |
|---|---|---|---|
| World scope | ST chat events expose a chat locator; that alone is not a trusted world binding. | Raw capture key requires `world_id`. | Core must authorize the world/session binding. Host must not derive authority from chat name, filename, or client-supplied label. **Unresolved.** |
| Conversation/chat scope | ST has a chat locator/name; group chats have their own load/save path. No durable cross-import/copy identity guarantee was established. | Raw key includes `conversation_id`. | Map only after Core/Provider define whether this means stable source-chat identity or a specific chat instance. A copied chat must not silently inherit an identity that collides with the original. **Unresolved.** |
| Logical message | Current ST message object has no inspected dedicated durable message ID. Array index is mutable. | Raw key includes `message_id`; `captureRawMessage` requires it and treats a conflicting payload at the same key as `MEMORY_RAW_CAPTURE_CONFLICT`. | Host-owned durable logical ID is required, persisted with the message and preserved through ordinary save/load. Creation/backfill and import/copy rules need Core approval before adding fields. |
| Immutable version/swipe | `swipes[]`, `swipe_id` array position and parallel `swipe_info[]`; no durable per-swipe key. | Raw key includes `version_id`; `captureRawMessage` is idempotent only for identical role/content/metadata at the same composite key. | Each separately selectable swipe/revision needs its own durable version ID, stored with that version rather than inferred from its current array slot. The exact persisted field placement requires Core approval. |
| Active version | ST's active `swipe_id` is an array slot. | `selectActiveRawVersion({world_id, conversation_id, message_id, version_id})` changes the active pointer and retains alternatives. | Selection should map to the durable ID of the selected version, never treat selection as creation/deletion. Safe only once Host IDs and trusted scope are approved. |
| Parent/version lineage | No stable parent ID or before/after revision identity is established in the inspected ST paths. | Raw archive table stores version IDs and metadata JSON, but no explicit typed parent/lineage relation in the raw-capture key or method contract. | Do not claim lineage is persisted merely because metadata accepts an object. Parent/version schema and branch ancestry need a Provider/Core decision; ambiguous lineage fails closed. |

### Lifecycle mapping to existing Provider operations (draft PR only)

| ST lifecycle | Candidate Provider operation/key | Expected semantic effect if approved | Gap / guard |
|---|---|---|---|
| New completed message/version | `captureRawMessage` keyed by approved world + conversation + logical message + version IDs | Insert immutable raw capture; identical replay is duplicate; same key with differing captured payload conflicts. | ST events do not currently supply durable IDs, uniform completed/persisted ordering, or trusted world binding. No call may be wired yet. |
| New swipe/edited revision | `captureRawMessage` with same logical message ID and a new immutable version ID | Retain old version; create distinct new version. | Edit-as-new-version and parent relationship require explicit Core/Provider approval. Do not overwrite the old version or invent ancestry. |
| Select existing swipe | `selectActiveRawVersion` for the chosen version ID | Change active pointer only; alternatives remain retained. | Current ST event gives only array index; durable version identity must be read from persisted message data after identity work is approved. |
| Delete one swipe/version | `markRawSourceDeleted` for that exact version ID | Mark only that version deleted, remove it from active selection and invalidate registered dependent copies. | Capture the target before ST splices/reindexes. Provider operation is draft and not callable from current main. |
| Delete whole logical message | Candidate: invoke `markRawSourceDeleted` once per known retained version belonging to that message | Tombstone every known version; preserve provider's reversible deletion semantics. | There is no confirmed Provider operation for atomic whole-message deletion or authoritative enumeration of all historical versions. A Host-side list of currently visible swipes may omit already-removed versions. This is **not safe** until Provider defines the complete target set and replay semantics. |
| Permanent purge | `purgeRawSource` only for an exact approved version target | Permanently removes that raw version and registered dependent copies inside Provider DB. | Not equivalent to normal ST delete; never trigger automatically from a UI delete. External indexes/stores are explicitly outside this method's purge guarantee. Retention/purge authority remains unapproved. |
| Duplicate event/replay | Same immutable composite key through `captureRawMessage` / `markRawSourceDeleted` | Capture is duplicate only when the complete payload matches; deletion of an already-deleted known version remains semantically idempotent. | This provider-local behavior does not prove replay completeness or that the event names the correct source key. |
| Restart/reload reconciliation | Provider `reconcile(worldId)` for canonical-entity records; `validateInventory` callback is required there | The current Provider reconciliation path validates its own `memory_records` and trusts the injected inventory validator for that domain. | It does **not** establish complete inventory for `memory_raw_captures`; no production Host inventory source/operation is confirmed. A fixture callback is not production authority. **Blocking gap.** |

### Rules proposed for Core/Provider decision

1. **Create once; versions immutable.** Create one logical-message identity for a new logical ST message. Every generated swipe and every approved edit revision receives a separate immutable version identity. Active selection is a pointer, not a new version. This is a proposed rule, not yet a code change.
2. **Edit semantics.** Treat an edit as a new version under the same logical-message identity, with a parent reference to the prior active version, unless Core explicitly chooses another semantic. Existing Provider raw archive does not yet define a typed parent relation, so this cannot be considered implemented.
3. **Swipe deletion vs message deletion.** Swipe deletion targets exactly one version; whole-message deletion must cover all versions, not just the currently selected one. Both must capture IDs before host mutation. Permanent purge is separate from reversible deletion.
4. **Copy/branch/import/restore.** Preserve IDs only when restoring the same logical source and its ancestry. For a new independent copy/branch, use a new conversation identity or explicitly approved remapping; never allow same composite key with different content. If import provenance or ancestry is ambiguous, do not auto-ingest. Exact policy requires Core approval.
5. **Legacy messages.** No automatic trusted backfill from array index, timestamp, `extra.gen_id`, or content hash. Legacy records remain ineligible for production Memory ingestion until a migration/backfill and lineage rule is approved.
6. **Incomplete generation.** Do not capture a partial/cancelled generation as a completed source version unless an explicit contract defines it as a separate non-admitted state. Current event evidence does not establish a durable generation identity or final persistence boundary.
7. **Reconciliation.** Provider must identify an existing production-capable source inventory and prove it covers all current versions and tombstones after restart/replay. The current raw archive methods alone do not provide this guarantee.

### Joint acceptance matrix — current evidence

| Case | Current evidence level | Result / next proof needed |
|---|---|---|
| Create message / completed generation | SOURCE-INSPECTED; limited event families RUNTIME-OBSERVED | NOT TESTED: persisted ID/version before/after on pinned Android/Termux |
| Create and switch swipe | SOURCE-INSPECTED; event family RUNTIME-OBSERVED | NOT TESTED: stable version IDs persist and active pointer resolves correctly after reload |
| Edit message | SOURCE-INSPECTED; event family RUNTIME-OBSERVED | NOT TESTED: immutable before/after revisions and parent lineage across reload |
| Delete one swipe | SOURCE-INSPECTED; event family RUNTIME-OBSERVED | NOT TESTED: pre-mutation exact version target, Provider tombstone and restart persistence |
| Delete whole message | SOURCE-INSPECTED; event family RUNTIME-OBSERVED | NOT TESTED: complete set of version tombstones, including versions no longer visible in ST |
| Stop/cancel/regenerate | SOURCE-INSPECTED; limited event family RUNTIME-OBSERVED | NOT TESTED: distinguish partial/cancelled content from completed version and link regeneration lineage |
| Chat switch / reload / restart / replay | SOURCE-INSPECTED in load/save paths; no complete runtime reproduction | NOT TESTED: identity persistence, idempotent replay and current inventory proof |
| Branch/copy/import/restore | Current source inspection does not prove collision policy | NOT TESTED: same-source restore vs independent copy, ID remapping and ancestry conflict |
| Duplicate delivery / same ID different content | Provider PR #201 source-inspected; provider-local tests are draft-branch evidence | Provider-local semantics exist; Host→Provider replay is NOT TESTED |
| Incomplete inventory / source change during reconciliation | Provider PR #201 source-inspected; fixture-based callback tests only | Production raw-capture inventory source is NOT ESTABLISHED; fail closed |

### Host disposition

This is the Host-side half of the requested joint mapping. It maps the proposed durable Host concepts to the actual raw-archive method/key names currently present in draft Provider PR #201, and it identifies where the two sides do **not** currently meet. It does not assert that PR #201 is merged, callable from ST, or production-authoritative.

**Concrete blocker to cross-boundary implementation:** the current Provider draft has per-version raw capture/select/delete operations, but there is no approved production Host caller and no demonstrated complete/current raw-source inventory after restart/replay; lineage and trusted world/conversation binding are also not yet contracted. Core must approve the concrete mapping and owners must close those gaps before implementation. Keep production Memory→NPC **DISABLED / FAIL-CLOSED** and leave vectorization untouched.


## Canonical joint Host ↔ Provider mapping

To avoid maintaining two competing copies of the mapping, the canonical row-by-row joint deliverable is now Provider's **Section 9**, [docs/75-memory-provider-host-identity-lifecycle-mapping.md](https://github.com/necromorphic/Logic-Engine/blob/feat/memory-provider-internal-import-contract/docs/75-memory-provider-host-identity-lifecycle-mapping.md#9-joint-host--provider-mapping-after-core-decision-24-oct-2026), at Provider mapping commit `114cb2f827f9a73b0da90dc8e86451c9cc4bb1b8` (verify the branch head before implementation). It contains the exact status labels **APPROVED SEMANTIC MAPPING / PROPOSED CONTRACT / BLOCKED**, the minimum contract delta, and the shared lifecycle acceptance matrix requested by Core.

This Host document remains the supporting source-evidence record for the pinned ST build and observed event limitations; its earlier candidate table is not a second approval surface. Where summaries differ, use Provider Section 9 as the canonical joint review table and keep all implementation blocked until Core explicitly approves the concrete contract. No runtime/API/schema change is authorized; production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
