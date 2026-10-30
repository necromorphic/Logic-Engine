# Pinned SillyTavern operation inventory for Host #258

**Audit date:** 2026-10-30  
**Target:** SillyTavern `1.19.0-1-g06bde939f`  
**Source archive root SHA label:** `06bde939fb1e9c4c8d8641d810f0a916b5bce127`  
**Disposition:** source audit only; Host remains `NON_READY`.

This inventory is deliberately split into (a) operations that can mutate conversation history or its identity, (b) adjacent destructive/restore operations that can remove or replace those files, and (c) unproven paths. A route/event is not a persistence receipt. The audit does not claim that all extensions or external filesystem actors are covered.

## 1. Conversation and group-chat operations

| Operation | Pinned source location | Native mutation / persistence behavior | Required Host observation |
|---|---|---|---|
| Regular save | `src/endpoints/chats.js:532-570` (`trySaveChat`, `/save`); client `public/script.js:7361-7448` | JSONL written via `tryWriteFileSync`; client save is debounced | Pre-state, completed write receipt, post-write re-read digest and stable file identity |
| Group save | `src/endpoints/chats.js:922-945`; client `public/scripts/group-chats.js:623-642` | Group JSONL written through the same helper; group header may be synthesized | Same as regular save plus group membership/header identity |
| Regular chat rename | `src/endpoints/chats.js:621-652` | `copyFileSync` then `unlinkSync`; not an atomic rename | Capture both source and destination; detect crash between copy/unlink; preserve logical conversation identity |
| Regular chat delete | `src/endpoints/chats.js:654-677` | Removes the selected chat file | Tombstone before deletion, post-delete directory scan, retained identity |
| Group chat import | `src/endpoints/chats.js:751-769` | Copies upload into groupChats, then removes temp upload | Treat as import/new lineage unless a trusted source lineage is supplied |
| Regular chat import | `src/endpoints/chats.js:771-870` | JSON formats converted and atomically written; JSONL may be copied; temp upload removed | Import receipt, content digest, explicit lineage decision; never infer identity from filename |
| Group chat delete | `src/endpoints/chats.js:900-920` | Removes one group-chat file | Tombstone exact group-chat identity and verify post-delete inventory |
| Group chat save | `src/endpoints/chats.js:922-945` | Persists current group conversation | Same as regular save, separate group namespace |
| Group create/edit | `src/endpoints/groups.js:156-201` | Writes group metadata JSON | Record membership/metadata changes that alter chat ownership or locators |
| Group delete cascade | `src/endpoints/groups.js:203-233` | Iterates group.chats, deletes chat files, then deletes group metadata | One transaction-like lifecycle operation with per-file tombstones and interrupted-cascade recovery |
| Startup group migration | `src/endpoints/groups.js:1-110` | Copies backups, rewrites group chat JSONL headers, rewrites group metadata | Migration generation and before/after inventory; fail closed on partial migration |
| Character delete with chats | `src/endpoints/characters.js:1416-1449` | Deletes avatar, optionally recursively removes its chat directory | Record recursive target set before deletion; tombstone every affected conversation |
| Data Maid delete | `src/endpoints/data-maid.js:770-816` | Deletes files selected by a prior report/token | Bind report to exact file identity+digest; verify exact post-delete set |
| Chat backup creation | `src/endpoints/chats.js:40-95,532-543` | Throttled backup write and retention cleanup | Backup creation and retention deletion are separate lifecycle events |
| Chat backup delete | `src/endpoints/backups.js:32-51` | Removes backup file | Record backup lineage/tombstone; backup is not silently treated as current source |
| Settings snapshot restore | `src/endpoints/settings.js:298-370` | Snapshot load/restore replaces settings files; exact impact on chat roots must be checked against configured paths | Treat restore as a possible root replacement; full scan before READY |
| User reset/delete | `src/endpoints/users-private.js:184-201,261-300`; `src/endpoints/users-admin.js:219-246` | Removes files or recursively removes user root | Invalidate all user-scoped accepted inventory; no READY until fresh authorized enrollment/reconciliation |

## 2. Client-side message mutations

| Operation | Pinned source location | Native behavior | Required Host observation |
|---|---|---|---|
| Debounced save | `public/script.js:7361-7448` | Mutation and persistence are separated in time | Await actual persistence; event emission alone is insufficient |
| Delete message | `public/script.js:1639-1691` | Splices in-memory array; delete event carries post-delete length | Capture exact affected durable logical IDs before splice |
| Delete last message | `public/script.js:1607-1612` | Truncates in-memory chat; persistence depends on caller/save path | Test every caller and verify disk after debounce |
| Swipe/regeneration | `public/script.js:9339-9404` | Mutates swipes/swipe_info and active swipe pointer | Stable ID per alternative; never use array position as identity |
| Edit/update message | Event paths `MESSAGE_EDITED` / `MESSAGE_UPDATED` | Event payloads are index-oriented | Capture immutable pre-version and post-save version with parent relation |
| Select active swipe | `MESSAGE_SWIPED` path | Changes active pointer while alternate versions may remain | Record active-pointer transition independently of version creation/deletion |
| Chat switch/load | `CHAT_CHANGED`, `CHAT_LOADED` event paths | Loads native chat into in-memory state | Bind snapshot to authorized conversation identity; scan on load |
| External edit / extension mutation | Not centrally intercepted by native ST | Files or in-memory state may change outside audited routes | Full reconciliation must detect out-of-band changes; unknown writer => NON_READY |


## 2a. Additional client-side mutation paths confirmed in source

The initial table above is supplemented by these concrete paths:

| Operation | Pinned source location | Native behavior | Required Host observation |
|---|---|---|---|
| Clear current chat | `public/script.js:1586-1605` | Cancels pending debounced save; clears rendered elements; optionally empties `chat` only when `clearData` is true; saves itemized prompts separately | Distinguish UI clear from data clear; do not infer deletion from DOM removal; capture chat array and disk state after caller completes |
| Delete last message | `public/script.js:1607-1612` | Truncates in-memory array and emits `MESSAGE_DELETED(chat.length)`; this function itself does not call `saveChatDebounced()` | Trace every caller; await subsequent save if any; otherwise report operation as non-persisted/unsupported |
| Delete message plus tool-call prefix | `public/script.js:1614-1699` | May delete a contiguous range of preceding system tool-invocation messages, not only the selected row; calls debounced save after splicing | Capture exact pre-mutation set, including tool-call prefix; test range boundaries and save completion |
| Generate new assistant message | `public/script.js:6642-6784` | Mutates current chat in memory; creates message or appends/continues/replaces an existing message; emits `MESSAGE_RECEIVED` and render events before any save in this function | Treat event as pre-persistence; only a later disk re-read/receipt can confirm persistence |
| Add generated swipe alternatives | `public/script.js:6671-6696,6786-6825` | Appends/updates `swipes` and `swipe_info`, and may change active text | Record immutable version identity and active pointer; array index is not a durable ID |
| Switch active swipe | `public/script.js:6973-7015` | Changes `swipe_id`, then projects selected swipe text and metadata into the message | Record pointer transition separately from message edit/version creation |
| Backfill swipe metadata | `public/script.js:6837-6877,6990-6998` | May synthesize `swipes`, `swipe_id`, and `swipe_info` when missing | Treat migration/backfill as mutation; preserve pre-backfill fingerprint and version lineage |

**Correction to event semantics:** `saveReply()` emits `MESSAGE_RECEIVED` while modifying the in-memory chat; the function itself contains no disk persistence call. It must not be used as a save receipt. `deleteLastMessage()` emits `MESSAGE_DELETED` but does not itself schedule a save. These event paths are separate from the later server-side JSONL write.

## 3. Other user-data mutations discovered in the pinned server source

These are not all conversation mutations, but they can invalidate assumptions about a stable data root, restore boundary, or identity store:

- Character create/rename/edit/import/duplicate: `src/endpoints/characters.js:1024-1646`.
- Group metadata create/edit/delete: `src/endpoints/groups.js:156-233`.
- Settings save/snapshot/restore: `src/endpoints/settings.js:206-370`.
- User backup/reset/delete: `src/endpoints/users-private.js:156-300` and `src/endpoints/users-admin.js:219-246`.
- Data Maid file deletion: `src/endpoints/data-maid.js:673-816`.
- Startup user/group migrations: `src/users.js:390-530`, `src/endpoints/groups.js:1-110`.
- Other endpoint files contain filesystem writes/deletes for avatars, assets, files, themes, presets, world info, sprites, vectors, extensions and thumbnails. These should only enter the Host source scope if they can touch a registered conversation root or accepted identity store; path containment must be proven, not assumed.

## 4. Acceptance test matrix still required

For every supported operation above, the real-file harness must capture and compare:

1. Before operation: root identity, relative path, file type, stable file identity where supported, size, content digest, chat logical ID, message/version IDs, active pointer, parent lineage and tombstones.
2. Operation: requested action, operation correlation ID, caller/route, start/end, native result, failure/exception. Do not store message text.
3. After persistence: independently re-read from disk (not the in-memory object), compute canonical inventory and compare expected delta.
4. Restart: stop the ST process, restart the same pinned build and data root, enumerate again, and compare stable IDs/generation/head.
5. Delete/restore: test normal delete, recursive/cascade delete, backup restore, settings/user restore where applicable, interrupted rename/copy, and external file replacement using disposable real data roots.
6. Missed-change detection: perform uninstrumented add/edit/delete/restore between scans; detector must produce a mismatch and invalidate READY.

The harness must include fault injection at each multi-step filesystem boundary (for example rename copy-before-unlink and group cascade between child deletion and metadata deletion). Tests must assert disk bytes and directory membership, not only mocked callbacks or emitted events.


## 6. Draft filesystem inventory primitive added after source audit

The branch now includes `host-adapter/prototype/fs-inventory.js`, a standalone fail-closed primitive that:

- accepts one absolute, explicitly configured root;
- rejects a symlinked root and symlink entries;
- traverses regular directories and files only;
- opens each file without following symlinks where the platform exposes `O_NOFOLLOW`;
- compares path identity with the opened file identity and checks metadata before/after reading;
- performs two complete scans and requires identical deterministic SHA-256 inventory fingerprints;
- rejects duplicate device/inode identities (hard-link aliases);
- returns relative paths, file identity metadata and content digests only; it never returns file bytes or raw message text.

Tests in `host-adapter/prototype/tests/fs-inventory.test.mjs` cover deterministic enumeration, invalid/missing roots, symlink rejection, out-of-band edits, delete/restore distinction and duplicate file identities.

**Important limitations:** this is a generic single-root filesystem primitive, not a complete SillyTavern enumerator. It does not yet know ST's canonical current/historical/group/backup roots, map files to logical conversation/message/swipe IDs, or reconcile a journal. On Windows it deliberately returns `HOST_INVENTORY_PLATFORM_REPARSE_UNVERIFIED` because this implementation does not independently verify every Windows reparse-point type. It is not wired to Core or used as a READY verifier. A stable double scan is not a substitute for an OS-enforced snapshot/lock against a hostile concurrent writer. No runtime test against a real ST data root has been performed by CI.

## 5. READY invariant

Host cannot report `READY` unless all of the following hold simultaneously:

- The installed ST build and supported storage layout are pinned and verified.
- Every operation that can mutate a registered source is either instrumented with a durable before/after receipt or explicitly unsupported and causes NON_READY when encountered.
- A trusted full filesystem inventory is complete, stable across the scan, and bound to the accepted generation.
- The lifecycle journal and independent inventory reconcile with no unexplained additions, modifications, deletions, restores, or identity changes.
- Restart recovery reproduces the same accepted identities and monotonic generation.
- The accepted-head witness is outside the restore/ACL domain of Host, Core and Provider; missing, corrupt, stale or rolled-back witness means NON_READY.
- Historical coverage starts at explicit enrollment/baseline. No claim is made for pre-enrollment history without an independently retained source.

**Current implementation gate:** Core still supplies `verifyInventorySnapshot: async () => false` in `src/index.js`. This fail-closed behavior must remain. This document is source-inspection evidence, not runtime proof and not authorization to enable capture, READY, or Memory → NPC.
