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

To avoid maintaining two competing copies, the canonical joint deliverable is Provider's [Sections 9–11 of docs/75-memory-provider-host-identity-lifecycle-mapping.md](https://github.com/necromorphic/Logic-Engine/blob/feat/memory-provider-internal-import-contract/docs/75-memory-provider-host-identity-lifecycle-mapping.md#11-concrete-host--provider-contract-proposal-for-core-review-24-oct-2026), current reviewed documentation commit `74f47947c696d63a9d0c8ff024b6f24215d50e03`. Sections 9–10 preserve the semantic mapping and owner/evidence audit; Section 11 is the concrete Host + Provider contract proposal, with exact pinned-source anchors, owners, fail-closed behavior, executable acceptance plan, and explicit unresolved inventory/disclosure gates.

This Host document remains the supporting source-evidence record for the pinned ST build and observed event limitations; it is not a second contract/approval surface. Core must accept/reject/revise the concrete proposal before any implementation. No runtime/API/schema change is authorized; production Memory→NPC remains **DISABLED / FAIL-CLOSED**.


## Host follow-through after Core decision #140 (24 Oct 2026)

**Status: source-grounded contract proposal only. No ST runtime code, field, event payload, API, schema, journal, cursor, store, or cross-block wiring has been changed.** Core approved the six semantic rules in [decision comment 6388139351](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6388139351) and explicitly requires this exact proposal before implementation.

### A. Candidate durable identity placement (proposed field names; not approved)

Candidate mapping for Core/Provider review:

| Meaning | Candidate placement | Why this location fits pinned ST source | Owner |
|---|---|---|---|
| Logical message identity | `message.logic_engine_message_id` (candidate) | The logical message object is serialized as part of the chat message; a new swipe mutates that same message object rather than creating a new chat-array message. | Host owns generation/persistence; Core approves semantics and migration/collision rules. |
| Immutable version identity | `message.swipe_info[i].logic_engine_version_id` (candidate) | `swipe_info[i]` is already parallel to `swipes[i]`, persisted with the message, and the per-swipe metadata entry survives active-slot changes. Identity must follow the version when array positions shift. | Host owns creation/persistence; Core approves lineage; Provider consumes the approved identity. |
| Parent version / edit lineage | `message.swipe_info[i].logic_engine_parent_version_id` (candidate) | Existing ST swipe metadata has no typed parent relation. This candidate is only for review; it must not be inferred from `gen_started`, `gen_finished`, `extra.gen_id`, or array adjacency. | Core + Host + Provider jointly approve semantics. |
| Active version | No new durable field proposed | Existing `message.swipe_id` remains an ephemeral array-position pointer. Resolve the active version ID from `swipe_info[swipe_id].logic_engine_version_id`; do not treat the numeric pointer as identity. | Host. |
| World/session authority | No ST field proposed | A chat filename, character/group ID, or client-supplied world label cannot independently authorize a world/session. | Core defines authority; deployment/Host supplies verifiable binding. |

The names above are **candidate names only**, included so Core can approve or reject an exact placement. They are not permission to add fields. No source or runtime currently demonstrates these fields.

### B. Exact pinned-source change points to review

1. **Message identity creation:** cover every message constructor, not just the main send path. In the pinned source, inspect normal user/assistant creation in `public/script.js`, group greeting creation/load in `public/scripts/group-chats.js`, and slash-command insertion in `public/scripts/slash-commands.js`. New logical messages need one ID at creation; IDs cannot be generated by a post-render event observer because multiple mutation paths exist.
2. **Version identity creation:** `saveReply()` in `public/script.js` is the point where generated swipes are added and `swipe_info` entries are created. The candidate version ID must be created once per newly created immutable version and stored in the corresponding metadata entry. A selected existing swipe retains its ID.
3. **Legacy load:** `ensureSwipes()` repairs missing `swipes`/`swipe_info` structures but does not prove lineage for historical versions. It must not silently promote legacy rows into trusted production sources. A migration/backfill policy and migration evidence are required before assigning trusted IDs to existing chats.
4. **Edit:** `messageEditDone()` calls `updateMessage(div)` before emitting `MESSAGE_EDITED`; therefore an observer on that event is too late to recover the old content as a reliable prior version. If Core approves edit-as-new-version, the old active version identity/content must be captured before mutation, and the edit must produce a new version with explicit parent lineage. The exact hook needs source/runtime testing.
5. **Swipe deletion:** `deleteSwipe()` in `public/script.js` has the exact target object and `swipe_info[swipeId]` before `message.swipes.splice(swipeId, 1)` and `message.swipe_info.splice(swipeId, 1)`. The deletion target must be captured from the metadata entry before either splice; the emitted `messageId`, `swipeId`, and `newSwipeId` are positions, not durable identity.
6. **Whole-message deletion:** `deleteMessage()` computes `messageIds`, then splices from the end before emitting `MESSAGE_DELETED(chat.length)`. Capture the logical-message ID and every retained version ID for every affected message before the first splice. However, this only enumerates versions still present in the ST object; it cannot prove the set includes previously deleted historical swipes.
7. **Persistence boundary:** ordinary message append, edit, swipe deletion and group-chat save/load use different paths and event orderings. Events such as `MESSAGE_RECEIVED`, `MESSAGE_EDITED` and `MESSAGE_DELETED` are not a uniform durable-commit signal. A future adapter must only report persisted state after the actual save operation succeeds and must handle save failure/overlap without asserting readiness.
8. **Reload/restart:** `getChat()` restores stored message objects; group chat load restores stored objects as well. These paths can preserve fields that were actually persisted, but current source does not assign the proposed IDs or prove that every mutation path saved them. Persistence must be verified on the pinned Android/Termux runtime.

Pinned-source references:
- [saveReply / swipe creation](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6642-L6685)
- [ensureSwipes and swipe metadata synchronization](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6833-L7018)
- [edit mutation and event ordering](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L8397-L8435)
- [exact swipe deletion before/after splice](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L9339-L9408)
- [whole-message deletion and tool-call cascade](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L1639-L1700)
- [single-chat load](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L7634-L7675)
- [group chat load/save path](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js#L260-L322)

### C. Inventory and rollback: Host evidence boundary

The current persisted ST chat file is **not a complete historical source inventory** under the approved Core rule:
- deleting a swipe physically removes an entry from `swipes[]` and the parallel `swipe_info[]`;
- deleting a whole message physically removes message objects from the current chat array;
- reload reconstructs the current stored objects, not a complete journal of all removed versions;
- current event payloads do not constitute a complete change feed, and the supplied runtime samples do not prove that no lifecycle event can be omitted.

Therefore a scan of current chat JSON can at best enumerate the current retained messages and swipes. It cannot attest all historically created/deleted versions, detect every missed event, or establish a consistent snapshot during concurrent mutation. **Host cannot truthfully attest Core's required complete historical inventory using the current ST state alone.** Provider's own row count and a persisted “ready” bit cannot repair this missing source evidence.

No journal/cursor/store is proposed as an automatic solution here; Core explicitly has not authorized one. Before production, the joint contract must either identify an existing authoritative source that provides complete historical identities/change evidence, or remain NON_READY and keep Memory→NPC disabled. This is a concrete blocker, not a documentation-only gap.

### D. Proposed Host lifecycle acceptance tests

These are required tests, not tests claimed as run. Test the exact pinned ST commit and the installed Android/Termux topology; save before/after persisted chat evidence with sensitive content redacted.

| Scenario | Required assertion | Evidence status now |
|---|---|---|
| Create user/assistant/group greeting | Logical ID is present before first successful persisted save; no duplicate on repeated observer delivery. | SOURCE-INSPECTED only; not runtime-tested |
| Generate second/third swipe | Each version has a unique durable ID; selection changes only active pointer; IDs stay paired with the right content after reload. | SOURCE-INSPECTED only; not runtime-tested |
| Delete non-active and active swipe | Capture exact version ID before splice; remaining IDs do not change when indices shift; save/reload preserves them. | SOURCE-INSPECTED only; not runtime-tested |
| Edit message | Previous version identity/content is captured before mutation; new version has a distinct ID and approved parent link. Cancelled edit creates no new version. | SOURCE-INSPECTED only; not runtime-tested |
| Delete message plus tool-call predecessors | Capture all affected logical/version IDs before first splice; no index-derived target; save failure is not reported as committed deletion. | SOURCE-INSPECTED only; not runtime-tested |
| Stop/cancel/regenerate | Partial/cancelled output is distinguishable from completed persisted version; regeneration ancestry is explicit, not inferred. | SOURCE-INSPECTED only; not runtime-tested |
| Single/group chat switch, restart, replay | IDs survive load and do not cross-bind between chat/world scopes; replay is idempotent. | SOURCE-INSPECTED only; not runtime-tested |
| Copy/branch/import/restore | Same-source restore preserves identity; independent copy gets approved remapping/new scope; collision or ambiguous provenance fails closed. | No policy or runtime evidence yet |
| Full inventory and rollback | Host can prove complete historical identity set and detect replacement/rollback/concurrent mutation, or explicitly returns NON_READY. | **BLOCKED: current ST files/events cannot prove this** |
| Disclosure serialization race | A revocation before actual final serialization boundary prevents content/snippet/count disclosure. | **BLOCKED: no approved boundary mechanism or real test** |

### E. Required next decision / handoff

Core has approved the semantics, not these candidate field names or a concrete implementation. Please review:
1. Candidate placement `message.logic_engine_message_id` and `message.swipe_info[i].logic_engine_version_id`, plus candidate parent field `logic_engine_parent_version_id`.
2. Edit-as-new-version behavior and the exact pre-mutation hook.
3. Copy/import/restore identity policy and legacy migration/backfill eligibility.
4. Whether any existing source can meet the required complete historical inventory/currentness proof. If not, the result is NON_READY until a separate exact contract for an approved mechanism is reviewed.
5. The actual final disclosure/serialization boundary and coordinated revocation mechanism; no such mechanism is claimed to exist.

Only after Core approves/revises this exact mapping should Host + Provider submit the implementation-level contract. No runtime integration, field, API, schema, store, cursor, journal, or vectorization change has been made by this follow-up. Production Memory→NPC remains **DISABLED / FAIL-CLOSED**.


## Host implementation-shaped review candidate after Core #140 (24 Oct 2026)

**Purpose:** prepare the Host-owned second-review artifact requested in coordinator comment [#258](https://github.com/necromorphic/Logic-Engine/issues/258#issuecomment-6388224191). This is a code-level change plan against pinned ST source, not an applied SillyTavern patch and not approval to ship the candidate fields. The canonical cross-block contract remains Provider mapping Section 11. Core must review the exact implementation diff before the candidate field placement is implemented or wired. This repository integration has read-only access to `SillyTavern/SillyTavern`; no upstream ST source files were changed.

### 12.1 Exact candidate mutation sites

Target source is exactly SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

| Change | Candidate minimal code delta | Source anchor | Review status |
|---|---|---|---|
| ID generator | Reuse existing imported `uuidv4` in `public/script.js`; no new dependency and no timestamp/index/hash fallback. Helper would allocate IDs only at first creation of a logical message or immutable version. | `public/script.js` already imports `uuidv4` (currently used for chat metadata integrity). | Proposed; Core approval required. |
| New user message | Set `logic_engine_message_id: uuidv4()` in the `message` object created by `sendMessageAsUser()`, before insertion/save; this covers both append and `insertAt` because both use the same object. | [sendMessageAsUser, pinned source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L231900-L232000) | Source-inspected; slash-command paths that call this function inherit the ID, but direct insertion paths still require audit. |
| New assistant/group greeting | Set a logical message ID in `getFirstMessage()`; if alternate greetings create `swipes[]`, assign a distinct version ID to each `swipe_info[]` entry at construction. | [getFirstMessage, pinned source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L301950-L302040) | Proposed; group greeting is constructed here, but group-specific mutation paths still require runtime proof. |
| New generated assistant message | Set a logical message ID when `saveReply()` creates `newMessage`; when it initializes `swipes[0]` and `swipe_info[0]`, assign the first version ID. When adding each additional swipe, assign a fresh version ID to its matching metadata entry. Do not assign a new logical message ID on `type === 'swipe'`. | [saveReply and swipe metadata, pinned source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6642-L6820) | Proposed; exact code diff not yet applied. |
| Swipe metadata alignment | Extend `ensureSwipes()` only to validate the new metadata fields. It may preserve already-valid IDs but must not fabricate trusted lineage for legacy versions. A missing/duplicate ID marks the source non-ready; any eventual migration must be explicit, collision-checked, saved, and reconciled before admission. | [ensureSwipes, pinned source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6833-L6905) | Proposed; silent backfill is rejected. |
| Active version | No new active-ID field. Resolve the selected durable version ID from `message.swipe_info[message.swipe_id].logic_engine_version_id`; existing `swipe_id` remains a transient array position only. | Existing `swipe_id`, `swipes[]`, and `swipe_info[]` handling. | Proposed; requires invariant tests after reindex/deletion. |
| Edit | Before `updateMessage(div)`, snapshot the exact active version ID and synchronize the old visible message into its current swipe slot. After the edit succeeds, append a new immutable version to `swipes[]`/`swipe_info[]`, set its parent to the exact prior active version ID, then set `swipe_id` to the new slot. Save before emitting any event that consumers might interpret as persisted. If any step/save fails, withhold the edited version from capture and mark the scope non-ready. | [messageEditDone mutates before MESSAGE_EDITED, pinned source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L8397-L8435) | **Needs explicit Core review:** this changes native edit behavior into an additional swipe/version and needs compatibility review with ST edit UX. |
| Delete one swipe | Resolve and snapshot `message.logic_engine_message_id` and the exact `swipe_info[swipeId].logic_engine_version_id` before the first splice. Preserve the existing ST deletion behavior; emit/capture a tombstone only from that pre-mutation snapshot and only after approved handoff semantics exist. | [deleteSwipe, pinned source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L9339-L9408) | Source-inspected; no Provider caller is wired. |
| Delete message/tool-call cascade | Before the first splice, snapshot the logical ID and all retained version IDs for every message in `messageIds`. This still cannot enumerate versions physically removed earlier; therefore it cannot satisfy whole-message tombstone completeness alone. | [deleteMessage, pinned source](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L1639-L1700) | **BLOCKED for complete retraction** without authoritative historical inventory. |
| Reload/save | Existing chat serialization should preserve plain object properties if they are included in the saved object, but this is only a source-level hypothesis until verified for single chats, group chats, exports/imports, and Termux restart. | [single chat load](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L7634-L7675); [group chat load/save](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js#L260-L322) | Not runtime-tested. |

### 12.2 Explicit copy/branch/import/restore policy proposal

This is a proposed policy for Core to accept/revise, not implemented behavior:

- Ordinary save, chat rename/move, reload, and restart of the same bound conversation: preserve logical-message IDs, version IDs, and parent links exactly.
- Selecting another swipe: preserve all IDs; change only native `swipe_id`.
- Edit: create a new version ID; retain the previous version and set the new version's parent to the exact previously active version ID. Do not overwrite/rebind the old version.
- Copy/branch/import into a different conversation scope: do not silently treat copied IDs as authoritative for the destination. Either remap all logical/version IDs as a new source lineage under a Core-approved migration rule, or keep that destination NON_READY until a reviewed migration/reconciliation establishes uniqueness and lineage. No source-copy relation field is proposed.
- Restore/rollback: preserve the bytes/IDs in the restored snapshot, but invalidate currentness for the affected scope until a fresh authoritative full reconciliation establishes whether post-snapshot versions/deletions were lost. Never infer currentness from timestamps or maximum IDs.
- Legacy records missing IDs, duplicated IDs, or misaligned `swipes[]`/`swipe_info[]`: no trusted automatic historical lineage. Keep them NON_READY until an approved migration establishes unique identities and documents that pre-existing removed versions cannot be recovered from the current file.
- ID collision with different content or ancestry: hard conflict; do not overwrite or rebind; withhold affected scope.

### 12.3 Inventory/currentness finding — no qualifying existing mechanism identified

The pinned ST chat file stores currently retained messages and retained swipes. `deleteSwipe()` physically splices the selected swipe and its metadata; `deleteMessage()` physically splices messages (including its tool-call deletion cascade). The inspected lifecycle events do not establish a completeness-guaranteed historical change feed. `getChat()`/group load restore the stored object state, not deleted history. Therefore, from the existing source inspected here, Host cannot attest all previously deleted version identities or prove that no lifecycle event was missed, no rollback occurred, and enumeration remained consistent during concurrent mutation.

No existing authoritative inventory mechanism has been found in the pinned ST paths. **Inventory = NON_READY.** This is not fixed by adding the three candidate IDs: those IDs identify retained objects but do not preserve identities after physical deletion. No journal, cursor, tombstone ledger, store, API, or outbox is proposed as an implicit fix; any such mechanism requires a separate explicit contract and Core approval.

### 12.4 Exact acceptance tests for the implementation diff

The implementation diff must add automated tests in the ST repository where its existing test harness can exercise these pure identity operations, or a narrowly scoped test module if that is the only available harness. Do not count a mocked event listener as persistence proof.

1. **Construction:** user, generated assistant, first-message/alternate-greeting and group-message construction each create one logical ID; each distinct retained version gets a unique version ID.
2. **Persistence:** serialize and deserialize a representative chat object; all IDs and parent links survive byte-for-byte; repeated save/load does not regenerate IDs.
3. **Swipe selection:** change `swipe_id` only; active durable version resolves through `swipe_info[swipe_id]`; every other version ID remains unchanged.
4. **Edit:** snapshot old active version; edit creates a new version with a distinct ID and exact parent; old content and ID remain available; save failure does not publish a ready capture.
5. **Delete swipe:** target ID is captured before both splices; deletion of first/middle/last swipe leaves all remaining IDs attached to their original content.
6. **Delete message/cascade:** all currently retained IDs are snapshotted before the first splice; test must separately demonstrate that previously deleted versions cannot be recovered from the current chat object, so complete whole-message retraction remains blocked.
7. **Collision:** duplicate message/version ID within a bound source or same tuple with different payload yields a hard conflict and no silent rebind.
8. **Legacy/import/restore:** missing IDs and ambiguous ancestry are NON_READY; restore invalidates currentness; copied/imported scope does not silently reuse source authority.
9. **Android/Termux:** close chat, restart ST, reopen and compare persisted identities; repeat group chat and a legacy chat. Status stays **NOT TESTED** until performed on the pinned phone installation.
10. **Inventory and final disclosure:** remain blocked tests until an authoritative inventory mechanism and actual serializer/outbound path are identified and approved. A test of Provider-local recheck is not a substitute.

Evidence labels for this artifact:
- **SOURCE-INSPECTED:** the pinned source anchors in §12.1 and physical deletion behavior in §12.3.
- **FIXTURE-TESTED:** no new Host identity tests have been run in this artifact.
- **RUNTIME-OBSERVED:** prior redacted diagnostics in Host issue #258 establish only sampled lifecycle event families.
- **REAL-RUNTIME-TESTED:** no identity persistence test on Android/Termux; no complete inventory test; no final disclosure race test.

### 12.5 Requested second review

Core review is requested on the exact candidate field placement and mutation semantics in §12.1, especially edit-as-new-swipe compatibility; the copy/branch/import/restore policy in §12.2; and the hard NON_READY inventory finding in §12.3. This is a review artifact, not an applied patch. The integration does not have write access to the upstream ST repository, so it cannot submit a SillyTavern code branch from this environment. If Core approves the implementation shape, the actual patch must be applied and tested in the pinned ST checkout before a production caller is considered.

**Release gate unchanged:** no candidate fields or runtime handoff implemented; production Memory→NPC remains **DISABLED / FAIL-CLOSED**; existing vectorization/remote-store code is untouched.
