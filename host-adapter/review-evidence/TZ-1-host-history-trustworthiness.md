# TЗ-1 — Host / Adapter: SillyTavern history trustworthiness

Date: 2026-10-28  
Target repository: [SillyTavern/SillyTavern](https://github.com/SillyTavern/SillyTavern)  
Pinned commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`  
Review classification: **SOURCE-INSPECTED; runtime operation matrix incomplete**  
Current safety conclusion: **NO SUCH MECHANISM FOUND / NON_READY** for a complete, tamper-evident history ledger.

## 1. Scope and evidence classes

This is a source inspection of the exact pinned commit, not a claim that every operation was exercised in a live UI. Prior project evidence on Issue #258 includes a shape-only runtime event sample, but it did not prove durable identity, persistence/replay semantics, or complete operation coverage.

Evidence labels used here:
- **SOURCE-INSPECTED** — code path exists at the pinned commit.
- **PRIOR RUNTIME SAMPLE** — a previously supplied diagnostic log saw an event family; not a complete reproducible operation test.
- **NOT TESTED** — this review did not run the operation in the pinned live host.
- **UNKNOWN** — source inspection alone does not settle the behavior across all paths.

Primary pinned sources:
- [Message operations, save/edit/swipe/delete — public/script.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js)
- [Group chat behavior — public/scripts/group-chats.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js)
- [Event catalog — public/scripts/events.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/events.js)
- [Chat file API, save/get/rename/delete/export/import — src/endpoints/chats.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/chats.js)
- [Group metadata migration — src/endpoints/groups.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/groups.js)
- [Startup order — src/server-main.js](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/server-main.js)

## 2. Preliminary operation matrix

The table distinguishes source inspection from runtime tests. “Not tested” is not a pass.

| Operation | Source-inspected evidence | What it establishes | Runtime test in this review |
|---|---|---|---|
| Create/send user message | `public/script.js`: `sendMessageAsUser` around lines 5900–5920 saves chat before emitting `MESSAGE_SENT` in ordinary append/insert paths | Event carries a chat-array index, not a durable message ID; this path's event follows save | NOT TESTED |
| Generate assistant response | `public/script.js`: `onFinishStreaming` / generation completion paths emit `MESSAGE_RECEIVED`; other paths can emit it too | `MESSAGE_RECEIVED` is not a universal commit receipt; some paths emit before save, and an error path can emit | NOT TESTED |
| Edit message | `public/script.js`: edit handlers emit `MESSAGE_EDITED` / `MESSAGE_UPDATED`; save timing differs by handler (around lines 8330–8440) | Event names/indexes do not constitute a durable revision ledger; inspect each edit path separately | NOT TESTED |
| Delete message | `public/script.js`: deletion splices/truncates the in-memory chat and emits `MESSAGE_DELETED`; server also exposes `POST /api/chats/delete` | Delete event payload does not identify the deleted logical message set; server endpoint deletes the chat file | NOT TESTED |
| Swipe alternate response | `public/script.js`: swipe handling emits `MESSAGE_SWIPED` with a numeric index; swipe deletion emits `MESSAGE_SWIPE_DELETED` with host-local numeric fields | These are UI-local indexes, not proven durable generation/branch/revision IDs | NOT TESTED |
| Continue / regenerate / stop | Generation paths share save/emit machinery; event catalog includes generation lifecycle events | No durable generation ID or replay-proof revision chain was established in this audit | NOT TESTED |
| Group chat send/generate | `public/scripts/group-chats.js` includes separate group generation paths; group chat files are saved through chat save logic | Group behavior is not proven equivalent to one-to-one chat for every event/order path | NOT TESTED |
| Chat switch / reload / restart | `CHAT_CHANGED` / `CHAT_LOADED` exist; client loads persisted chat files | No proof that event/session identity survives restart or that replay can be distinguished from a new source change | NOT TESTED in this iteration |
| Copy / rename | `src/endpoints/chats.js` `POST /rename` copies the source file then unlinks the old path | A rename is not an append-only lineage event; source/destination ancestry is not recorded in the chat file | NOT TESTED |
| Import | `POST /import` and `POST /group/import` write imported content into chat paths; format converters may construct new serialized messages | Imported history may be reconstructed/normalized; original source bytes and provenance are not inherently guaranteed by the resulting JSONL | NOT TESTED |
| Branch / truncate | Client code has continuation/truncation paths that mutate the in-memory chat and save it | No complete branch-parent/version ledger was found in the inspected paths | NOT TESTED |
| Startup group-metadata migration | `src/server-main.js` calls `migrateGroupChatsMetadataFormat` before listening; `src/endpoints/groups.js` rewrites group JSON/chat JSONL and creates backups | Migration can alter history files outside HTTP middleware; the separate review candidate guard is scoped to this startup migration path | Earlier isolated test report exists for an earlier candidate; current candidate runtime matrix not repeated here |
| Backup / restore | `src/endpoints/chats.js` saves backups during `trySaveChat`; backup is throttled and retention can remove old files | Backups are recovery aids, not a guaranteed complete immutable audit log; throttling/retention make them unsuitable as sole proof of every revision | NOT TESTED |

## 3. Findings relevant to completeness and authenticity

### 3.1 Current chat JSONL is a current-state file, not a complete history ledger

**SOURCE-INSPECTED.** `POST /api/chats/save` serializes the supplied chat array and writes it to the target JSONL path. The operation does not append a separately authenticated revision record for each message operation. Edits, deletions, truncations and swipes can therefore be reflected in a later current-state save without preserving every previous state in the primary file.

### 3.2 Existing integrity check is not a revision history

**SOURCE-INSPECTED.** `trySaveChat` conditionally checks an integrity slug from the first chat entry when integrity checking is enabled and the slug is present, then writes the current serialized chat. This is not evidence of an append-only per-operation ledger, durable revision ancestry, replay detection, or a protected monotonic sequence. Its presence must not be described as proving full history.

### 3.3 Backups are not sufficient evidence of completeness

**SOURCE-INSPECTED.** Backup writes are throttled per user/chat; configuration controls whether backups are enabled and how many are retained. The save path also overwrites the current chat file. Therefore the existence of backups does not prove every intermediate edit/swipe/delete was retained, and missing backups cannot prove that no earlier version existed.

### 3.4 Event names do not establish durable identity or delivery

**SOURCE-INSPECTED + PRIOR RUNTIME SAMPLE.** The reviewed event payloads use array indexes for several message events. Array indexes can shift after insert/delete/truncate. The prior runtime sample observed event families but did not establish stable IDs, exact persistence ordering for every operation, exactly-once delivery, restart replay semantics, or user/NPC receipt. In particular, render events are not proof that a human saw a message or that an NPC acquired/believed it.

### 3.5 Import and rename do not prove source lineage

**SOURCE-INSPECTED.** Import routes create target chat files from uploaded data; rename copies then deletes the old path. The inspected paths do not by themselves establish an immutable parent pointer to the exact source bytes or a verified chain of transformations.

## 4. Startup migration guard scope

The separate startup migration candidate is a narrow guard around `migrateGroupChatsMetadataFormat`, invoked during startup before the server listens. Its purpose is to block that particular legacy group-metadata rewrite when the enrollment registry indicates a protected affected group-chat history, and to fail closed for invalid/ambiguous registry state.

It does **not** intercept or audit these other mutation paths:
- client `/api/chats/save` current-state overwrite;
- message edit, delete, swipe deletion, continuation/regeneration and truncation paths;
- chat-file rename and delete endpoints;
- import endpoints;
- group chat save/generation paths outside that startup migration;
- backup rotation/retention;
- manual filesystem edits or other external writers;
- any migration/import/restore path not routed through the guarded startup function.

This is a scope statement from source inspection, not a claim that every listed path was experimentally triggered.

## 5. Required live tests still outstanding

The acceptance requirement “every checked operation has a test and result” is **not yet met** by this report. The next isolated test run must use the exact pinned checkout and a disposable data root, with content redacted by default:

1. Create/send, wait for save, reload; compare exact persisted file bytes and emitted event sequence.
2. Generate response, cancel/stop, regenerate and continue; compare file state and event ordering on success and error paths.
3. Edit message and close editor by each supported action; verify save timing and whether old bytes survive anywhere.
4. Delete a middle message, last message, and one swipe variant; inspect current file, backups, and all emitted IDs.
5. Swipe across alternatives, create another alternative, delete a swipe; test whether identities survive reload.
6. Repeat relevant operations in group chat, including auto-mode if enabled, and compare with one-to-one behavior.
7. Switch chats, reload browser, restart server, then compare file hashes, event sequence and available backups.
8. Import each supported chat format and group JSONL; record whether the result is byte-preserving or reconstructed.
9. Rename/copy, delete and restore a chat; verify source/destination relationship and what recovery data remains.
10. Run startup migration guard cases: enrolled, corrupt/ambiguous registry, missing referenced chat, multi-user, and unenrolled legacy migration.
11. For every scenario, save exact commit, commands, redacted event shape, before/after SHA-256 manifests, full path listing, logs and explicit PASS/FAIL/BLOCKED. No fixture-only callback may be labelled as live-host evidence.

No raw message text should be retained in test logs unless the separately approved retention contract explicitly permits it.

## 6. Current acceptance status

- Exact source commit pinned: **PASS**.
- Source paths for core save/edit/delete/swipe/import/migration operations inspected: **PASS — source inspection only**.
- Test for every operation with exact-head result: **NOT COMPLETE**.
- Durable message identity and revision/parent lineage: **NOT PROVEN**.
- Detection of omitted edits, deleted versions, replay of old state or rollback: **NO SUCH MECHANISM FOUND in the inspected paths**; broader repository/runtime audit still required.
- Full current-state JSONL inventory as complete historical evidence: **NOT ACCEPTABLE**.
- Startup migration guard covers all mutation paths: **NO — it covers only the specified startup migration**.
- Host / Adapter: **NON_READY**.
- Memory → NPC: **DISABLED / FAIL-CLOSED**.
- Raw-message retention in Memory: **NOT AUTHORIZED**.

## 7. Reproduction / source links

Use a clean checkout:
```powershell
git clone https://github.com/SillyTavern/SillyTavern st-history-audit
cd st-history-audit
git fetch --depth 1 origin 06bde939fb1e9c4c8d8641d810f0a916b5bce127
git checkout FETCH_HEAD
git rev-parse HEAD
npm ci
node server.js --dataRoot "$env:TEMP\st-history-audit-data" --port 8010
```

The commands above pin and launch a clean target but do **not** by themselves execute the operation matrix. Perform UI operations only against the disposable data root and retain separate logs/manifests for each scenario.

Source files:
- `public/script.js`
- `public/scripts/group-chats.js`
- `public/scripts/events.js`
- `src/endpoints/chats.js`
- `src/endpoints/groups.js`
- `src/server-main.js`

No production implementation, Core API/schema, new store, or Memory→NPC activation is proposed by this audit.
