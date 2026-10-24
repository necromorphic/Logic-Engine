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
- The Memory Provider SQLite implementation is in draft [PR #182](https://github.com/necromorphic/Logic-Engine/pull/182), not an approved production default. It requires trusted source-version/snapshot/inventory callbacks and is not wired to a host source. Its proposed provider contract is not authority for an adapter to invent source IDs or claim reconciliation.
- Core integration gates in [#140](https://github.com/necromorphic/Logic-Engine/issues/140) say no universal Memory source identity/version contract or durable source-change feed is approved, and production Memory→NPC remains disabled. Core consumer work in [PR #168](https://github.com/necromorphic/Logic-Engine/pull/168) is a fail-closed injected seam, not host/provider proof.
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

The next implementable slice requires the Memory owner to nominate the exact persistence entry point from the Provider branch and approve a narrow adapter handoff, and Core to approve host-source identity/version, world/session binding, deletion/revision semantics, and reconciliation evidence. Once those contracts exist, add the adapter on top of the actual provider entry point and test it against the pinned ST source/runtime. Do not enable production retrieval until those tests and owner gates pass.

## Validation record

- Source target: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Source inspection: complete for the event shapes/order summarized above; links point to exact commit.
- Runtime diagnostics: two redacted samples referenced in [#258](https://github.com/necromorphic/Logic-Engine/issues/258); these are event-presence/shape evidence, not full lifecycle or persistence integration tests.
- Automated adapter tests: **not added**, because no safe executable provider handoff exists on current `main`. A fixture-only test would not prove the requested production path.
- No Core, Memory Provider, Personality, vectorization, API, schema, storage, outbox, cursor, or lifecycle implementation changed by this audit.
