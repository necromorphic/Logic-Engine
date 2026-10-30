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
