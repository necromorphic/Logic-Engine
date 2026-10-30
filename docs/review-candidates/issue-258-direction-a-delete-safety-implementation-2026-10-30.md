# Issue #258 — Direction A delete-safety overlay

Target SillyTavern source: `1.19.0-1-g06bde939f` (`06bde939fb1e9c4c8d8641d810f0a916b5bce127`).

## Apply order

1. Start from the pinned SillyTavern source.
2. Apply `sillytavern-1.19.0-lifecycle-hooks.patch` from the current Logic-Engine `main` tree.
3. Apply `issue-258-direction-a-delete-safety.patch`.

The Direction A patch is deliberately a separate overlay. It must not be applied to an unpatched SillyTavern tree.

## Changes

- Reject missing, invalid, stale, or mismatched message-editor selections. The DOM message index is only cross-checked; it is never substituted as the deletion target.
- Validate `deleteMessage()` indices before dereferencing and bind the operation to the exact message object and chat locator.
- Revalidate the selected target after confirmation and after the asynchronous write-ahead lifecycle call.
- Snapshot and revalidate the full message range when deleting a message together with preceding tool-call messages.
- Protect `deleteLastMessage()` and `deleteSwipe()` against chat switches and target changes during asynchronous lifecycle work.
- Route the direct `/delname` mutation through the existing Host lifecycle guard, validate every selected object, delete by descending original indexes, and complete the lifecycle checkpoint after native save.

## Validation performed

Against the exact pinned source archive:

- `git apply --check` for the current-main lifecycle patch: PASS.
- Apply current-main lifecycle patch: PASS.
- `git apply --check` for this Direction A overlay: PASS.
- Apply Direction A overlay: PASS.
- `node --check public/script.js`: PASS.
- `node --check public/scripts/slash-commands.js`: PASS.
- `git diff --check`: PASS.

Direction A source-contract tests: 3/3 PASS.

The historical uploaded Logic-Engine archive is 128 commits behind current `main`; its lifecycle acceptance suite is therefore not counted as current-main validation. The full current-main Logic-Engine test suite has not been run in this work.

These are patch-application, syntax, and source-contract checks. They are not browser/PC runtime evidence. No local SillyTavern instance was installed or modified by this work.

## Approval and safety boundary

- This is an implementation candidate for the second Core review required by Issue #264.
- No merge authorization is implied.
- Host readiness remains `NON_READY`.
- Memory→NPC remains `DISABLED / FAIL-CLOSED`; enrollment remains `REVIEW_ONLY`.
- The primary SillyTavern instance and port 8000 remain untouched.
