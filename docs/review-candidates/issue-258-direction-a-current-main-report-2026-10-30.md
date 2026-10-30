# Issue #258 — Direction A candidate re-port on current main

Date: 30 October 2026.

## Base and provenance

- Branch: `host/issue-258-direction-a-main-2026-10-30`
- Base: current repository `main` at branch creation.
- Previous current-main candidate: PR #743, head `4fcbbe877de29e240fb0acd0a01e6b702e86d70e`, which had five successful exact-head workflows but subsequently diverged from current main (6 ahead / 2 behind).
- The embedded base patch `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch` is unchanged between current main and the previous candidate: blob `3ab39d8f1dbaac5e8760af2093dd91dc09bdea0a`.
- SillyTavern target candidate remains `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Re-port contents

This branch carries forward the isolated Direction A delete-safety overlay and source-contract tests from PR #743, now recreated on the current `main` base `dde665cede1efec4e1fe3aff4a16ff9f05798c7a`. It does not modify the base lifecycle patch, Core API/schema, Provider, vectorization, or production dispatch.

The overlay protects stale/mismatched editor selection, exact target identity across async boundaries, delete-last, bulk deletion, swipe deletion, and direct `/delname` mutation. It avoids logging message content.

## Evidence classification

Prior exact candidate head #743 had all five workflows green: Host lifecycle patch check, browser IndexedDB restart, lifecycle patch validation, pinned SillyTavern source audit, and Runtime tests. Those results belong to the prior head, not this re-port. This branch requires fresh exact-head CI; no PASS is claimed until its workflows finish.

The prior pinned-source archive apply/syntax checks are also evidence for the unchanged SillyTavern target and overlay, but must be rerun for this branch's exact patch bytes. No installed ST instance, browser interaction, Android/Termux, or real Host→Provider→Core dispatch has been tested here.

## Approval boundary

- This is a current-main re-port for second Core review under #264, not merge authorization.
- Host remains NON_READY until fresh exact-head CI and isolated runtime acceptance.
- Memory→NPC remains DISABLED / FAIL-CLOSED.
- Raw Host message text remains NOT AUTHORIZED for durable retention under Core #140.
- Main SillyTavern instance / port 8000 remains untouched.
