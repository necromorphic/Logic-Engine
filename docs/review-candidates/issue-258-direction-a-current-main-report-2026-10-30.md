# Issue #258 — Direction A candidate re-port on current main

Date: 30 October 2026.

## Base and provenance

- Branch: `host/issue-258-direction-a-after-fileid-fix-v2-2026-10-30`
- Base: stacked on current-main Core file-identity candidate #784; base head `4ebdb8f8897d119c53aa0d505671606b570812f1`.
- Previous current-main candidate: PR #743, head `4fcbbe877de29e240fb0acd0a01e6b702e86d70e`, was 6 ahead / 2 behind. PR #748 re-port passed all four Host-specific workflows but exposed a Windows Core file-identity false positive in Runtime; PR #750 fixes that and passed exact-head Runtime + Provider workflows.
- The embedded base patch `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch` is unchanged between current main and the previous candidate: blob `3ab39d8f1dbaac5e8760af2093dd91dc09bdea0a`.
- SillyTavern target candidate remains `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Re-port contents

This branch carries forward the isolated Direction A delete-safety overlay and source-contract tests from PR #758, stacked on the current-main Core file-identity candidate #784. It does not modify the base lifecycle patch, Core API/schema, Provider, vectorization, or production dispatch. Its apply-order documentation now places the Host inventory route candidate #780 between the base lifecycle patch and the Direction A UI mutation overlay.

The overlay protects stale/mismatched editor selection, exact target identity across async boundaries, delete-last, bulk deletion, swipe deletion, and direct `/delname` mutation. It avoids logging message content.

## Evidence classification

Exact-head CI on this current-Core branch passed: Runtime #41054995208 (Windows npm test 1165/1165, Host lifecycle 75/75, recalculation 20/20, Core trusted acquisition 15/15, NPC boundary 100/100); Host patch check #41054995202; browser IndexedDB restart #41054995183; patch apply/lint #41054995148; pinned source audit #41054995134.

The prior pinned-source archive apply/syntax checks are also evidence for the unchanged SillyTavern target and overlay, but must be rerun for this branch's exact patch bytes. No installed ST instance, browser interaction, Android/Termux, or real Host→Provider→Core dispatch has been tested here.

## Approval boundary

- This is a current-main re-port for second Core review under #264, not merge authorization.
- Host remains NON_READY until fresh exact-head CI and isolated runtime acceptance.
- Memory→NPC remains DISABLED / FAIL-CLOSED.
- Raw Host message text remains NOT AUTHORIZED for durable retention under Core #140.
- Main SillyTavern instance / port 8000 remains untouched.


## Dependency

This PR is stacked on current-main Core PR #784. It remains Draft until Core/Security review and the required target-host validation.