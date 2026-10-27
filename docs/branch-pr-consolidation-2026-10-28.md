# Branch and PR consolidation review — 2026-10-28

## Scope and evidence standard

This is a portfolio/dependency review, not an independent code approval and not a production-readiness decision. Repository metadata and PR descriptions were inspected on 2026-10-28. Where this note cites Windows results, those are user-provided local reports and were not independently executed by this review.

- Default branch: `main`.
- Branch search returned **502 branches** across six pages.
- Open-PR search returned **77 open pull requests**.
- The number of branches is not itself evidence of defects. Branches must not be bulk-deleted by age or name.
- The review API returned no submitted reviews for the sampled source-version and rule-hardening PRs. PRs authored by the same account are not independent review.

## Executive disposition

**Do not merge the Memory → NPC stack as a batch.** There are real code-bearing slices and passing branch-scoped CI, but the current set is a dependency graph, not a single merge-ready feature. Keep production Memory → NPC **DISABLED / FAIL-CLOSED**.

No runtime code, schemas, APIs, storage, Windows ACLs, local user files, or vectorization paths were changed as part of this review. This branch contains documentation only.

## Consolidation decisions by workstream

### A. Core canonical source-version stack

Relevant PRs:

- [#490 — Use durable Core-issued source-version tokens](https://github.com/necromorphic/Logic-Engine/pull/490)
- [#509 — Add monotonic canonical entity source versions](https://github.com/necromorphic/Logic-Engine/pull/509)
- [#521 — Consolidate durable source-version readback](https://github.com/necromorphic/Logic-Engine/pull/521)
- [#504 — Preserve canonical source-version binding through Core consumer](https://github.com/necromorphic/Logic-Engine/pull/504)
- [#484 — Provider accepted-head authority](https://github.com/necromorphic/Logic-Engine/pull/484)
- [#488 — Earlier NPC source-version binding](https://github.com/necromorphic/Logic-Engine/pull/488)

**Decision already recorded by the coordinator in Issue #264:** use #509 as the single Core persistence/mutation ledger; layer #521 readback/validation on #509; layer #504 Provider → Core consumer binding on #521. Do not merge #490 unchanged because it independently defines migration 12 / `entity_source_versions` and different version advancement behavior. Do not merge #488 as a standalone version authority because it predates the Core-owned durable-token contract.

The issue records a combined #521/#504 CI result of 816/816 runtime tests, oracle 8/8, NPC boundary 83/83. This is branch-scoped CI evidence, **not Core approval**. The same issue records that the exact implementation diff still requires explicit second Core approval. #484 is a separate accepted-head dependency and must have exact-current-head evidence; accepted-head ordering is not a substitute for canonical source versions.

**Next action:** review the exact combined diff and migration/backfill semantics for #509 → #521 → #504, verify current-head CI for all dependencies, and obtain the required explicit Core approval. Keep all three drafts until that gate is satisfied.

### B. Host persistence and inventory

Relevant PRs:

- [#507 — Require persisted receipt for enrolled chat saves](https://github.com/necromorphic/Logic-Engine/pull/507)
- [#510 — Compare Host history with independent Core inventory](https://github.com/necromorphic/Logic-Engine/pull/510)
- [#503 — Audit pinned SillyTavern lifecycle source semantics](https://github.com/necromorphic/Logic-Engine/pull/503)
- [#519 — Local lifecycle patch audit](https://github.com/necromorphic/Logic-Engine/pull/519), if still the current candidate for that task

#510 is stacked on #507. The 2026-10-28 Issue #264 update reports five successful workflows for the then-current #510 head and five for #507. Their scope does not establish complete historical/deleted inventory, installed SillyTavern runtime behavior, or final request-body binding. The same update records no installed desktop/Android proof and no independent Core approval.

**Next action:** keep #507/#510 as a stack; close the uncovered mutation routes and prove enrollment-forward inventory plus reconciliation. Browser IndexedDB restart fixtures are not authoritative Host inventory. Do not describe #510 as complete Host inventory.

### C. Provider accepted-head and dispatch chain

Relevant PRs include [#480](https://github.com/necromorphic/Logic-Engine/pull/480), [#483](https://github.com/necromorphic/Logic-Engine/pull/483), [#484](https://github.com/necromorphic/Logic-Engine/pull/484), [#485](https://github.com/necromorphic/Logic-Engine/pull/485), [#486](https://github.com/necromorphic/Logic-Engine/pull/486), [#498](https://github.com/necromorphic/Logic-Engine/pull/498), [#499](https://github.com/necromorphic/Logic-Engine/pull/499), [#500](https://github.com/necromorphic/Logic-Engine/pull/500), [#505](https://github.com/necromorphic/Logic-Engine/pull/505), and [#508](https://github.com/necromorphic/Logic-Engine/pull/508).

These PRs implement different layers: authority persistence, Provider mutation/read gates, a Host-owned transport contract, admission-derived dispatch evidence, and revoke/dispatch ordering tests. They are not interchangeable and must not be merged as a batch.

The Issue #264 evidence states that #500's dispatch evidence reader still returns `inventory_status=NOT_READY`; #505 uses a fake gateway evidence reader for the race test; #508 binds admitted candidate metadata but does not bind the exact final serialized SillyTavern request body. The final prompt/body ↔ authorized candidate/version binding and real sole-egress path remain blockers.

**Next action:** keep production disabled. Do not wire a real route until the exact final serialized body, candidate/version set, current Core scope, revocation and sole outbound transport are proven together on the actual pinned SillyTavern path.

### D. Core rule-input hardening overlap

Relevant PRs:

- [#514 — Harden Core rule equality against non-JSON values](https://github.com/necromorphic/Logic-Engine/pull/514)
- [#515 — Prevent rule evaluation from executing context getters](https://github.com/necromorphic/Logic-Engine/pull/515)
- [#517 — Validate declarative rule objects before evaluation](https://github.com/necromorphic/Logic-Engine/pull/517)
- [#516 — Reject accessor-backed and malformed mechanic effect inputs](https://github.com/necromorphic/Logic-Engine/pull/516)
- [#522 — Reject executable and malformed rule inputs](https://github.com/necromorphic/Logic-Engine/pull/522)

File-level comparison narrows the overlap: #522 and #514/#515 both change `src/core/rules.js` and `tests/tri-state-rules.test.js`; #517 also changes those files but uniquely adds `tests/condition-dependencies.test.js`, which #522 does not include. #516 changes `src/core/mechanic-effect-translator.js` and `tests/mechanic-effect-translator.test.js`; it is a separate module and is **not** subsumed by #522 despite the similarity in PR descriptions. This is the clearest candidate for PR consolidation outside the Memory → NPC stack. However, the sampled PRs had no submitted review records, and this review did not establish exact-head CI for #522.

**Next action:** review #522 against #514/#515 and reconcile their overlapping tests into one canonical rule-hardening diff. Preserve the unique #517 condition-dependency tests, either by adding them to the consolidated branch or keeping #517 as a separate dependent PR. Keep #516 separate because it changes the mechanic-effect translator. No PR should be marked superseded or closed until unique test coverage is accounted for and exact-head Runtime CI passes. Do not merge #522 solely because GitHub reports it mergeable.

### E. SillyTavern diagnostic UI overlap

[#492](https://github.com/necromorphic/Logic-Engine/pull/492) is a diagnostic extension candidate; [#501](https://github.com/necromorphic/Logic-Engine/pull/501) describes a bridge extension with a read-only health check and exact-origin CORS. Their user-facing purpose overlaps, but their code paths differ: #492 adds a diagnostic extension/proxy under `host-adapter/prototype/diagnostic-extension`, while #501 adds `host-adapter/sillytavern-extension` and changes the engine health CORS/server files. Neither health UI nor `GET /health` proves the protected generation path.

**Important local collision:** the user-reported uncommitted Windows working tree contains `src/api/server.js`, `src/index.js`, `tests/api.test.js`, and untracked `src/api/health-cors.js`—the same four engine paths changed by PR #501. This proves path overlap, not identical contents. Before committing or cherry-picking anything, compare the local diff to #501 file by file; do not overwrite or apply both blindly. PR #501's body says current-head extension lifecycle tests did not yet have a pass at the reported point, so earlier API/prototype test counts are not proof of current-head CI.

**Next action:** compare local changes with #501 and review both UI paths. Retain one canonical UI implementation if appropriate, keep the engine patch's authorship/change history intact, and keep protected dispatch separate. Do not merge both by default.

### F. Deployment security artifacts

Relevant PRs: [#451 — read-only Windows deployment evidence collector](https://github.com/necromorphic/Logic-Engine/pull/451), [#468 — guarded Core SQLite ACL boundary candidate](https://github.com/necromorphic/Logic-Engine/pull/468), [#469 — accepted-head authority storage ACL candidate](https://github.com/necromorphic/Logic-Engine/pull/469), and [#471 — target-PC acceptance runbook](https://github.com/necromorphic/Logic-Engine/pull/471).

These are open candidate artifacts, not part of installed `main` unless merged. The user-provided target-PC report says the #471 runbook was not locally available and real identity/ACL, backup/restore, and reconciliation checks remained blocked. Do not apply candidate ACL scripts or install services automatically. Review the exact scripts against actual target paths and identities before any deployment change.

**Next action:** review the candidate scripts/runbook as a single deployment package; validate them against the installed single-process architecture rather than assuming separate Authority/Core/Provider services exist. Keep all changes plan-first and require explicit permission before applying ACL/service changes.

### G. Local coordinator and stage auto-closure

[#273](https://github.com/necromorphic/Logic-Engine/pull/273) is a read-only local Windows portfolio monitor. [#506](https://github.com/necromorphic/Logic-Engine/pull/506) adds evidence-gated stage auto-closure on top of the coordinator branch. The latter must not be treated as a substitute for human/Core approval or be enabled against production gates. The local monitor's Windows execution still needs explicit evidence before claiming it works on the user's PC.

**Next action:** validate #273 on the target PC first. Keep #506 draft until its closure criteria and evidence sources are reviewed; it must never auto-approve Memory → NPC or bypass Core gates.

## Local Windows security report (user-provided evidence)

The local report dated 2026-10-27/28 records:

- Environment and current ACLs captured.
- Real access attempts as a separate unprivileged identity: **BLOCKED**.
- Backup/restore and reconciliation: **BLOCKED / absent in the inspected installed implementation**.
- Full repository test retry: two runs at 802/802 pass; three SQLite-focused stress runs passed; the original six `EBUSY` errors were not reproduced.

These results do not prove the environment was the cause of the original `EBUSY` errors. The accurate status is **not reproduced; cause unproven**. The Windows security task remains **PARTIAL / BLOCKED**, not PASS. The local package path reported by the user is `target-pc-security-evidence-20261027T195451Z`; this review did not independently inspect those files.

## Branch hygiene

The branch inventory has **502 names**, including many dated `current-main`, `clean`, `retest`, and `v2/v3` variants. This is a maintenance risk, but branch names alone do not prove that a branch is stale or redundant.

Do not mass-delete branches. For each branch, classify it as:

1. base/dependency of an open PR;
2. head of an open PR;
3. merged and safely deletable after verifying ancestry;
4. closed/superseded and safely deletable after checking for unique commits;
5. orphaned/unclassified and requiring owner review.

The current review only classified the major overlapping workstreams above; it did not perform a full per-branch ancestry audit.

## Priority order

1. Resolve the exact Core source-version stack (#509 → #521 → #504) and get explicit Core approval.
2. Continue Host inventory and mutation coverage under #264/#258; keep uncovered cases NON_READY.
3. Prove exact final serialized request-body binding and the real sole-egress/revocation boundary.
4. Finish target-PC deployment/ACL/restore evidence; do not infer it from CI.
5. Review the deployment security candidates (#451/#468/#469/#471) together; do not apply them without explicit permission.
6. Consolidate only the overlapping rule-hardening diffs (#514/#515/#517/#522); keep mechanic-effect translator #516 separate unless a real code dependency proves otherwise.
7. Audit branch ancestry and clean up only branches proven merged or superseded.

**Final disposition:** no PR was merged or closed by this review. No runtime changes were made. Memory → NPC remains **DISABLED / FAIL-CLOSED**; raw Host message-text retention remains unauthorized; the existing Ollama/vectorization path remains untouched.
