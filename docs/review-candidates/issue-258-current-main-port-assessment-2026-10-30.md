# Issue #258 — current-main delete-safety port assessment (30 Oct 2026)

## Reviewed base

- Repository: `necromorphic/Logic-Engine`
- Base branch: `main`
- Exact base commit: `efc02d2b290b2c08d6621fe9eb75570ae4486102`
- Review branch: `review/issue-258-delete-safety-current-main-2026-10-30`
- This assessment is documentation only. No implementation file is changed by this commit.

## Current-main source inventory checked

The following current-main files were fetched directly from GitHub at the reviewed base:

- `host-adapter/prototype/README.md`
- `host-adapter/prototype/SOURCE-LIFECYCLE-AUDIT.md`
- `host-adapter/prototype/st-lifecycle-bridge.mjs`
- `host-adapter/prototype/tests/st-lifecycle-bridge.test.mjs`
- `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch`
- `host-adapter/prototype/tests/lifecycle-acceptance-scenarios.test.mjs`

The current-main tree has advanced 128 commits beyond the source snapshot used to build the earlier delete-safety candidate. The older candidate patch therefore cannot be treated as a current-main implementation patch.

## Existing candidate scope (Direction A approved)

The previously approved narrow delete-safety scope remains:

1. Fail closed in the UI when the editor selection is missing, stale, or mismatched; do not substitute the DOM index.
2. Validate the target in `deleteMessage()` before dereferencing it.
3. Revalidate chat locator, array, and exact message-object identity after asynchronous confirmation and write-ahead boundaries.
4. Protect `deleteSwipe()` and `deleteLastMessage()` with equivalent exact-target checks.
5. Instrument the direct `/delname` mutation path.
6. Add regression tests for stale-but-in-range indices, chat switching during await, swipe deletion, last-message deletion, and `/delname`.

This approval authorizes preparation and exact-diff review only. It does not authorize merge or production activation.

## Port decision

**Initial assessment: not ported.** At the time this assessment was written, the earlier candidate was built against an older Logic-Engine source snapshot and could not be applied blindly to current `main`.

A subsequent commit on this review branch adds a separate Direction A overlay at `host-adapter/prototype/patches/issue-258-direction-a-delete-safety.patch`, based on the current-main lifecycle patch and checked against the exact pinned SillyTavern source. The overlay and its source-contract tests are implementation-candidate artifacts, not a runtime-validated integration.

Remaining steps are:
- exact diff review against this base;
- focused tests and the full repository test suite in a real checkout;
- `git apply --check` and syntax checks against the exact pinned SillyTavern tree;
- isolated browser/runtime verification on the issue258 ST instance only.

No claim is made here that these runtime checks have been performed.

## Safety state

- Host readiness: `NON_READY`
- Memory→NPC: `DISABLED / FAIL-CLOSED`
- Main SillyTavern instance on port 8000: untouched
- No production wiring, Core API/schema change, or merge is included.
