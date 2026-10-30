# Issue #258 — Direction A candidate re-port on current main

Date: 30 October 2026.

## Base and provenance

- Branch: `host/issue-258-direction-a-main-after-core-fs-identity-2026-10-30`
- Base: PR #750 head `5ca6be62ad31bdd763f35287bd67a10d4fe972e6` (BigInt filesystem identity correction). PR #750 itself is based on current `main` at `c9f94eeb712c856321aca9ef333863b880628174`; this Host candidate depends on that Core fix until #750 is merged.
- Previous current-main candidate: PR #743, head `4fcbbe877de29e240fb0acd0a01e6b702e86d70e`, which had five successful exact-head workflows but subsequently diverged from current main (6 ahead / 2 behind).
- The embedded base patch `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch` is unchanged between current main and the previous candidate: blob `3ab39d8f1dbaac5e8760af2093dd91dc09bdea0a`.
- SillyTavern target candidate remains `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

## Re-port contents

This branch carries forward the isolated Direction A delete-safety overlay and source-contract tests from PR #743, now recreated on top of the Core filesystem identity correction in PR #750. The lifecycle patch blob remains unchanged. It does not modify the base lifecycle patch, Core API/schema, Provider, vectorization, or production dispatch.

The overlay protects stale/mismatched editor selection, exact target identity across async boundaries, delete-last, bulk deletion, swipe deletion, and direct `/delname` mutation. It avoids logging message content.

## Evidence classification

Prior exact candidate PR #743 and current-main re-port PR #748 both passed all five Host/Runtime workflows on their respective exact heads. PR #748's first Runtime attempt had one Windows false-positive; rerunning the failed job passed all 1158 tests. Those results do not transfer to this dependent re-port. Fresh exact-head CI is required.

The pinned-source archive apply/syntax checks and source-contract tests are unchanged from PR #748; this branch still requires fresh exact-head workflow validation. No installed ST instance, browser interaction, Android/Termux, or real Host→Provider→Core dispatch has been tested here.

## Approval boundary

- This is a current-main dependent re-port for second Core review under #264. Merge is blocked until PR #750 is reviewed/merged and this branch is retargeted to `main` with fresh exact-head CI.
- Host remains NON_READY until fresh exact-head CI and isolated runtime acceptance.
- Memory→NPC remains DISABLED / FAIL-CLOSED.
- Raw Host message text remains NOT AUTHORIZED for durable retention under Core #140.
- Main SillyTavern instance / port 8000 remains untouched.
