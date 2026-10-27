# Host lifecycle interception matrix (pinned SillyTavern 1.19.0 prototype)

Status: source/patch review only. This matrix records what the current prototype patch visibly wires. It is not a claim that every UI, API, plugin, filesystem, or restore path is intercepted. “Guard present” means the patch calls a Host guard at the listed entry point; it does not mean an end-to-end runtime test has proved that route cannot bypass it.

Pinned source context: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`; patch file: `patches/sillytavern-1.19.0-lifecycle-hooks.patch`.

## Evidence labels

- **Patched guard** — an explicit guard call is present in the reviewed patch at the named entry point.
- **Fail-closed helper only** — bridge/helper rejects the operation if called, but route interception is not established by that fact.
- **Coverage unproven** — no complete route-by-route proof that every relevant mutation reaches the guard.
- **Not implemented as a complete lifecycle** — current behavior rejects selected operations for enrolled chats rather than providing an identity-preserving transactional handler.

## Entry-point matrix

| Lifecycle operation | Observed patch entry point / hook | Current behavior for enrolled chats | Evidence status / remaining gap |
|---|---|---|---|
| Append/send user message | `public/script.js`, message insertion path; `beforeMutation('message-send')`, then `afterMutation` after save | Guard and journal path invoked on this insertion path | **Patched guard.** Other message creation paths and all alternate callers are not proven covered. |
| Generate / regenerate / continue | `public/script.js`, generation processing; operation selected as `create-message`, `create-swipe`, or `edit-message` | The patch now invokes `beforeMutation()` for the selected operation before processing; `create-message` passes an empty affected-index list, while edits/swipes identify the existing final message | **Patched pre-guard at this hook after the latest patch change; validation pending.** Partial generation, stop/error paths, alternate generation routes, and persistence ordering remain unproven. |
| Edit message | `public/script.js`, message editor update path | `beforeMutation('edit-message')` before update; post-hook after save | **Patched guard.** External edits and alternate edit routes remain uncovered/unproven. |
| Delete last / selected message range | `deleteLastMessage` and selected deletion path in `public/script.js` | Pre-hook before in-memory deletion; save/post-hook afterward | **Patched guard.** Need route-level integration evidence for all deletion entry points and failure ordering. |
| Create/select swipe | Generation path and swipe selection path in `public/script.js` | Calls `create-swipe`, `select-swipe`, or `edit-message` bridge operations | **Patched guard at selected paths.** Swipe-back/delete source branches and all alternate mutation paths are not proven covered. |
| Delete swipe | `public/script.js`, swipe deletion function | Pre-hook before splice, save/post-hook afterward | **Patched guard.** End-to-end route coverage and crash/failure behavior are not fully established. |
| Rename current chat | `renameChat` in `public/script.js` | Pre/post hook; attempts to move local locator mapping after rename | **Patched guard.** Identity continuity is still dependent on mutable local locator/metadata; all rename routes are not proven covered. |
| Delete character chat / chat file | `delChat`, `deleteCharacterChatByName`, selected group-chat delete functions | Locator deletion guard rejects enrolled targets unless a tombstone-aware handler exists | **Patched fail-closed guard.** Not a complete deletion/tombstone lifecycle; other server-side routes are not proven covered. |
| Rename group chat locator | `renameGroupChat` in `public/scripts/group-chats.js` | Locator mutation guard rejects enrolled locator changes | **Patched fail-closed guard.** No identity-preserving rename handler is provided. |
| Import character/group chat | `importCharacterChat`, `importGroupChat` | Bulk guard rejects if any Host enrollment exists | **Patched fail-closed guard.** Import is unavailable while any enrollment exists; this does not prove every import API route is intercepted. |
| Restore backup | `restoreBackup` in `public/scripts/chat-backups.js` | Bulk guard rejects if any Host enrollment exists | **Patched fail-closed guard.** Alternate restore tools/routes and direct filesystem restore remain unproven. |
| Create branch | `createBranch` in `public/scripts/bookmarks.js`; calls `guardOperation('create-branch')` | Bridge allowlist rejects unsupported operation before branch body proceeds when enrolled | **Patched guard + helper rejection.** This is not a branch-lineage-preserving implementation; other branch/copy routes are not proven covered. |
| Delete group / bulk delete chats | `deleteGroup`, `deleteCharacter` with `deleteChats` | Bulk guard rejects if any Host enrollment exists | **Patched fail-closed guard.** Does not prove all bulk-deletion routes are intercepted. |
| Clear/reload/switch chat | Native `clearChat` and navigation/reload paths | No complete lifecycle handler shown for the whole navigation/switch lifecycle | **Coverage unproven.** Clearing the in-memory array is not itself evidence of file deletion or a journaled source transition. |
| Copy branch / export | Native branch/export paths beyond the listed guard | No complete supported lifecycle implementation established | **Coverage unproven.** Must not infer protection from the `create-branch` helper test alone. |
| Server-side import/delete/rename API called directly | API routes outside the patched browser call site | No proof every API route is bound to the browser guard | **Coverage unproven.** Direct API invocation may bypass client-side guards unless separately intercepted server-side. |
| External file edit / restore outside application | Filesystem, external tools, unpatched extensions | No Host interception shown | **Not covered by current patch.** Fingerprint mismatch can detect some later differences only relative to an available trusted checkpoint; it does not authenticate source or guarantee detection before mutation. |
| Journal/storage unavailable | Bridge-open fallback | Re-checks enrollment marker; rejects enrolled chat mutation when journal unavailable | **Helper behavior covered by unit-level path.** Does not establish route interception or independent rollback resistance of local storage. |

## What the tests establish

1. Bridge tests can establish that a direct call to `beforeMutation()` rejects unsupported operation names and that selected helper behavior is fail-closed.
2. Patch validation can establish that expected guard patterns exist in the patch.
3. Browser IndexedDB restart tests can establish the scenarios actually exercised by that workflow.
4. None of the above, by itself, proves every actual SillyTavern client/server route capable of changing source state is intercepted before mutation.

## Required evidence before claiming lifecycle completeness

- Enumerate concrete client and server route/function entry points for every supported mutation class from the pinned source.
- For each route, demonstrate a test that invokes the real route/function and asserts the guard executes before source mutation and persistence.
- Cover direct API calls, error/abort paths, debounced saves, partial generation, branch/copy, import, backup restore, chat switching, and external modification behavior; where unsupported, show a deterministic fail-closed rejection at the actual boundary.
- Confirm coverage against the exact pinned source revision and patch digest.
- Keep inventory completeness, source authenticity, rollback resistance, and parent lineage as separate claims. A local fingerprint match cannot prove those properties.

## Disposition

Selected entry points are visibly guarded. Complete lifecycle interception, complete live source inventory, authenticated source lineage, and rollback-resistant checkpointing remain unproven. Keep Host capture/reconciliation `NON_READY`, PR #445 Draft, and production `Memory→NPC` `DISABLED / FAIL-CLOSED` until the required evidence and upstream owner decisions exist.
