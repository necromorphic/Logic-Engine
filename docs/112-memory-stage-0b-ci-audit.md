# Memory Stage 0B — CI and fixture audit

**Status:** PARTIAL — fixture digest checks pass on the pre-change Stage 0A HEAD; route-count assertion corrected and wired into CI, but the updated workflow has not yet run on this branch.

## 1. Scope

This is the CI/docs portion of the Memory ADR Stage 0B. No runtime Memory, Core, Host authentication, Gateway, or SillyTavern behavior is changed here.

## 2. Fixture digest audit

The relevant checked-in digest paths on the Stage 0A base are:

- `tests/sillytavern-final-send-patch-artifact.test.js` recomputes the pinned Final-Send patch SHA-256 and compares it with the patch manifest; it also checks the protected generation source pins.
- `tests/host-host-source-pin-consistency.test.js` recomputes the combined lifecycle patch bundle digest and checks that Host and Core pin the same value.
- `tests/final-send-host-overlay-contract.test.js` checks the pinned Patch Manager Git blob identity against the Host source attestation.
- `tests/verify-legacy-host-bundle.test.js` uses `os.tmpdir()` for its fixture root; the earlier `tmpdir()` import defect is already corrected on the base.

**Evidence:** PR #950 Stage 0A HEAD `df129425ecd5fccba45b4d9b7f6ee7c5d3e28d1f`, Windows Runtime job `131995578531`, `npm test` completed with 2216 PASS, 0 FAIL, 67 SKIPPED / 2283. The log includes passing digest-related subtests:
- `Host and Core pin the same exact lifecycle patch bundle and inventory handler` — PASS.
- `patch manifest pins every protected generation route plus required Host lifecycle source files` — PASS.

No current stale fixture digest was reproduced in these checks. This is a result for the tested HEAD, not a claim that every installed deployment matches the fixture.

## 3. Pinned mutation-route count defect

The route contract in `host-adapter/extension-gateway/server-plugin/st-mutation-route-contract.mjs` computes its total from the union of `PINNED_ST_MUTATION_ROUTES` and `PINNED_ST_UNSUPPORTED_MUTATION_ROUTES`, then includes the separately guarded `/logout` route.

A bounded count of the actual route-map entries gives:
- 89 route declarations covered by route middleware;
- 1 separately guarded `/logout`;
- **90 total routes**.

The old assertion in `host-adapter/prototype/tests/pinned-st-mutation-route-coverage.test.mjs` expected 47. That value counted only a subset and contradicted the authoritative route-map total. The test was also absent from `.github/workflows/host-adapter-pinned-source-audit.yml`, so the incorrect hard-coded assertion was not exercised by that workflow.

## 4. Changes on `memory/development-2026-11-13`

- Changed the expected route count from 47 to 90 and clarified that the coverage includes unsupported routes plus the separately guarded logout.
- Added `host-adapter/prototype/tests/pinned-st-mutation-route-coverage.test.mjs` to the pinned-source audit test command. The workflow already supplies `SILLYTAVERN_SOURCE_ROOT=Sillytavern`, so the test will execute against the checked-out/patched source rather than skip.

Commits:
- `941858e16a488b3c52bacbdfa715105ef07bbc42` — correct route-count assertion.
- `2f00d78f3e6af34f5f28fd55df50f5f2dc801fa0` — wire the test into the source-audit workflow.

## 5. Verification state

- Existing digest checks on Stage 0A HEAD: **PASS** in the cited Runtime job.
- Route-map count derivation: **PASS** by direct inspection/count of the route contract (89 + 1 = 90).
- Updated route-coverage test on the new branch: **NOT VERIFIED** — no workflow has run on the new commit yet.
- Actual pinned SillyTavern route coverage after this change: **NOT VERIFIED** until the updated Windows source-audit job completes.

The updated test must run with `SILLYTAVERN_SOURCE_ROOT` set. A skipped test is not acceptance evidence.
