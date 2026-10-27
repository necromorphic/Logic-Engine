# Core conditional-approval candidate: startup group-metadata migration guard

This directory contains a **review-only patch candidate**, not an applied SillyTavern change.

Pinned SillyTavern base:
- Repository: https://github.com/SillyTavern/SillyTavern
- Commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`

Core decision: CONDITIONAL APPROVE, restricted to blocking startup migration and required tests. This candidate does not enable Memory→NPC, declare Host READY, or authorize production deployment.

## Files
- `startup-migration-block.patch`: proposed source/test diff.
- `startup-migration-block.test.js`: proposed Node test file to be added as `tests/startup-migration-block.test.js` in the pinned SillyTavern checkout.

## Required validation still outstanding
1. Apply the patch in a clean checkout of the exact pinned commit and inspect the resulting diff.
2. Run `node --test tests/startup-migration-block.test.js` in the SillyTavern checkout.
3. Run `npm run lint` and any applicable existing test commands.
4. Launch SillyTavern against disposable fixtures and capture startup output proving `HOST_STARTUP_MIGRATION_BLOCKED` occurs before any write.
5. Compare SHA-256 hashes and bytes of every planned group/chat file and backup directory contents before/after a blocked startup.
6. The candidate workflow runs against the exact candidate HEAD and pinned SillyTavern commit; record the commit SHA and workflow results.

Do not treat this candidate as second-approved or production-ready. If review finds any mismatch with the pinned source, revise the patch and repeat the exact-HEAD checks.
