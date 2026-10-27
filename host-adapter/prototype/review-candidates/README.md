# Core conditional-approval candidate: startup group-metadata migration guard

This directory contains a **review-only patch candidate**, not an applied SillyTavern change.

Pinned SillyTavern base:
- Repository: https://github.com/SillyTavern/SillyTavern
- Commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`

Core decision: `CONDITIONAL APPROVE`, restricted to continuing review and verification. This candidate does not enable Memory→NPC, declare Host READY, authorize production deployment, or authorize raw-message storage.

## Files
- `startup-migration-block.patch`: proposed source/test diff.
- The patch adds `tests/startup-migration-block.test.js` to the pinned SillyTavern checkout.

## Latest review work

The local-agent report dated 2026-10-28 states that the prior candidate revision:
- applied to the pinned source;
- passed five unit scenarios;
- started SillyTavern against an isolated `--dataRoot` and returned HTTP 200;
- blocked startup for an enrolled affected chat and a corrupt registry;
- preserved legacy migration for unenrolled fixtures;
- observed no file changes in the reported blocked scenarios.

Those observations were made against the earlier patch revision, not the hardened patch in this commit. They are not evidence that the latest patch has passed CI or the same runtime checks.

## Hardening added for this review iteration

- Missing or unreadable chat files referenced by a migration candidate are conservatively treated as potentially affected until the enrollment registry is checked.
- Regression tests snapshot the full fixture tree (paths, directory entries, and file bytes) before and after blocked scenarios, rather than checking only selected files.
- A test covers a registered chat referenced by group metadata but missing from disk.
- The candidate workflow's push trigger is aligned with this review branch.

## Required validation for the current candidate HEAD

1. Confirm the patch applies cleanly to the exact pinned SillyTavern commit.
2. Run `node --test tests/startup-migration-block.test.js` and `npm run lint`.
3. Run applicable Logic-Engine CI on the exact current candidate HEAD.
4. Repeat the isolated real-startup scenarios against the **current patch**, including enrolled, corrupt-registry, multi-user, missing-chat, and unenrolled cases.
5. Preserve complete before/after tree snapshots and SHA-256 manifests for every blocked startup. Confirm that no file, directory, or backup was created, deleted, or modified.
6. Record the exact candidate HEAD, patch SHA-256, workflow run URLs, and runtime logs in the evidence package for Core.

Do not request second approval until the current patch has passed these checks and the evidence package has been independently reviewed. Do not merge this PR as an implementation approval.
