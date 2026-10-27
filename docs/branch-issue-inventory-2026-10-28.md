# Branch and Issue consolidation inventory — 2026-10-28

## Scope and limits

Read-only inventory from GitHub REST API on 2026-10-28. No branch or issue was deleted, closed, merged, or edited by this audit. Default branch: `main`; head SHA: `5bc5f0e4434c7573d2754e6cda94786fcb45fca0`.

- Branch API returned **512 branch refs** (earlier connector search returned 511; REST inventory is authoritative for this run).
- Open PR API returned **86 open pull requests**.
- This report maps open PR heads to branch refs and marks duplicate-looking names as *candidates*, not proven duplicates.
- The connector's branch listing provides names and head SHAs. It does not by itself prove whether each branch's unique commits are already in main. A branch may have an old base but valuable unique commits.
- **Do not delete based on name, age, or behind count alone.** Final safe deletion requires compare/ancestry evidence and review of unique commits.

## Recommended triage

1. **Keep:** `main`, all heads referenced by open PRs, and branches whose purpose is unresolved.
2. **Compare first:** every `DUPLICATE_CANDIDATE` branch below. Compare its diff with sibling variants and `main`; preserve unique tests and docs.
3. **Review separately:** security/test/CI branches. These may hold unique fail-closed evidence.
4. **Archive/close PR only after comparison:** if a newer PR truly supersedes an older one, record which unique changes/tests were carried forward, then close the superseded PR; delete its branch only after verifying it is not a base for another open PR.
5. **Issues:** keep one portfolio issue and one integration register; do not close independent block gates just because their titles overlap.

## Classification counts (heuristic, 512 unique branches and 86 open PRs)

- `WORKSTREAM_UNCLASSIFIED`: 214
- `DUPLICATE_CANDIDATE`: 112
- `OPEN_PR_HEAD`: 86
- `DOC_OR_AUDIT_CANDIDATE`: 60
- `SAFETY_OR_TEST_REQUIRES_REVIEW`: 39
- `CANONICAL_MAIN`: 1

Meanings:
- `CANONICAL_MAIN`: default branch.
- `OPEN_PR_HEAD`: branch is the head of at least one open PR; preserve.
- `DUPLICATE_CANDIDATE`: name suggests a variant/rebase/current-main refresh; compare commits before deciding.
- `DOC_OR_AUDIT_CANDIDATE`: documentation, coordinator, audit, or research branch; check whether the evidence has been superseded.
- `SAFETY_OR_TEST_REQUIRES_REVIEW`: security, tests, CI, performance; do not delete without coverage review.
- `WORKSTREAM_UNCLASSIFIED`: no safe disposition can be inferred from name.

## Open PRs and branch ownership — current REST inventory

GitHub REST API returned **86 open PRs**. All current open PRs are listed below, including the last page omitted by the earlier 80-PR inventory.

| PR | Head branch | Base | State | Title |
|---|---|---|---|---|
| [#50](https://github.com/necromorphic/Logic-Engine/pull/50) | `docs/multiple-independent-supports-contract` | main | Draft | docs: define multiple independent support semantics |
| [#185](https://github.com/necromorphic/Logic-Engine/pull/185) | `review/claude-full-project-audit` | main | Draft | docs: add Claude full-project audit brief |
| [#272](https://github.com/necromorphic/Logic-Engine/pull/272) | `chore/coordinator-event-bridge` | main | Draft | chore(coordinator): add GitHub event bridge |
| [#273](https://github.com/necromorphic/Logic-Engine/pull/273) | `feat/local-coordinator-pc` | main | Draft | feat(coordinator): add local PC portfolio monitor |
| [#297](https://github.com/necromorphic/Logic-Engine/pull/297) | `docs/core-deployment-policy-authority-226` | main | Draft | docs(core): decide deployment-owned mechanic policy authority |
| [#301](https://github.com/necromorphic/Logic-Engine/pull/301) | `feat/core-mechanic-vertical-slice-226` | main | Draft | feat(core): start current-main mechanic execution slice (#226) |
| [#324](https://github.com/necromorphic/Logic-Engine/pull/324) | `docs/issue-73-current-main-test-crosswalk` | main | Ready | docs(personality): refresh Issue #73 executable test crosswalk |
| [#326](https://github.com/necromorphic/Logic-Engine/pull/326) | `work/mechanics-docs-drift-correction-2026-10-25` | main | Draft | docs(mechanics): reconcile executor source presence with deployment wiring |
| [#328](https://github.com/necromorphic/Logic-Engine/pull/328) | `core/proposal-stale-commit-regression` | main | Draft | test(core): cover stale approved proposal commit |
| [#330](https://github.com/necromorphic/Logic-Engine/pull/330) | `core/authorized-read-rollback-race-regression` | main | Draft | test(core): cover rollback race during authorized read |
| [#335](https://github.com/necromorphic/Logic-Engine/pull/335) | `core/time-advance-failure-replay-after-restart-v2` | main | Draft | test(core): cover checkpoint failure replay after restart |
| [#336](https://github.com/necromorphic/Logic-Engine/pull/336) | `docs/core-evaluation-recalculation-publication-boundary-2026-10-25` | main | Draft | docs(core): define evaluation, recalculation, and publication boundaries |
| [#339](https://github.com/necromorphic/Logic-Engine/pull/339) | `core/260-communicative-intent-contract` | main | Draft | docs(core): define communicative intent interpretation boundaries |
| [#340](https://github.com/necromorphic/Logic-Engine/pull/340) | `core/243-successful-commit-response-loss-replay` | main | Draft | test(core): cover committed advance retry after response loss |
| [#341](https://github.com/necromorphic/Logic-Engine/pull/341) | `core/243-checkpoint-recovery-decision-record` | main | Draft | docs(core): record unresolved process checkpoint recovery decision |
| [#345](https://github.com/necromorphic/Logic-Engine/pull/345) | `docs/core-140-memory-npc-gates-2026-10-25` | main | Draft | [Core] Refresh Memory→NPC production gates in integration matrix |
| [#352](https://github.com/necromorphic/Logic-Engine/pull/352) | `core/recovery-proposal-rollback-reopen` | main | Draft | test(core): cover proposal rollback and reopen recovery |
| [#353](https://github.com/necromorphic/Logic-Engine/pull/353) | `docs/npc-autonomy-story-kt-rules` | main | Draft | npc: reconcile autonomy docs with decision-kernel prototype scope |
| [#354](https://github.com/necromorphic/Logic-Engine/pull/354) | `docs/coordinator-memory-dispatch-protocol` | main | Draft | docs: propose bounded Memory-NPC dispatch protocol |
| [#355](https://github.com/necromorphic/Logic-Engine/pull/355) | `core/fix-rollback-entity-projection` | main | Draft | test(core): reproduce entity projection rollback blocker |
| [#368](https://github.com/necromorphic/Logic-Engine/pull/368) | `core/rollback-read-regressions-current-main-2026-10-26` | main | Draft | test(core): carry rollback read regressions onto current main |
| [#371](https://github.com/necromorphic/Logic-Engine/pull/371) | `core/finalize-disclosure-dispatch-contract-2026-10-26` | main | Draft | docs(core): finalize final-disclosure dispatch contract |
| [#377](https://github.com/necromorphic/Logic-Engine/pull/377) | `coord/dispatch-order-cross-process-proof-2026-10-26` | main | Draft | test: prove cross-process dispatch-order lock prototype |
| [#379](https://github.com/necromorphic/Logic-Engine/pull/379) | `core/decision-dispatch-authority-140` | main | Draft | docs(core): record dispatch authority decision for #140 |
| [#382](https://github.com/necromorphic/Logic-Engine/pull/382) | `fix/provider-serialized-writes-clean-2026-10-26` | test/provider-cross-connection-record-retrieval-aba-2026-10-26 | Draft | fix(memory): serialize Provider mutations under one SQLite writer order |
| [#450](https://github.com/necromorphic/Logic-Engine/pull/450) | `core/characterize-host-binding-rollback` | main | Draft | [Core] Characterize Host binding resurrection after Core restore |
| [#451](https://github.com/necromorphic/Logic-Engine/pull/451) | `security/windows-deployment-evidence-collector` | main | Draft | [Security] Add read-only Windows deployment evidence collector |
| [#456](https://github.com/necromorphic/Logic-Engine/pull/456) | `host/lifecycle-mainline-integration-2026-10-27` | main | Draft | host: integrate lifecycle inventory gate on current main |
| [#458](https://github.com/necromorphic/Logic-Engine/pull/458) | `refresh/447-world-pack-version-semantics-2026-10-27` | main | Ready | docs(relationships): refresh World Pack version semantics on current main |
| [#459](https://github.com/necromorphic/Logic-Engine/pull/459) | `refresh/448-relationship-interaction-evidence-2026-10-27` | main | Ready | feat(relationships): refresh interaction evidence helpers on current main |
| [#460](https://github.com/necromorphic/Logic-Engine/pull/460) | `refresh/443-provider-input-snapshot-hardening-2026-10-27` | main | Ready | fix(memory): refresh Provider input hardening on current main |
| [#465](https://github.com/necromorphic/Logic-Engine/pull/465) | `core/source-trust-conflict-acceptance` | main | Ready | Core: add cross-world source trust acceptance test |
| [#466](https://github.com/necromorphic/Logic-Engine/pull/466) | `core/npc-authorized-read-fields` | main | Ready | Core: confirm NPC authorized-read field allowlist |
| [#467](https://github.com/necromorphic/Logic-Engine/pull/467) | `coord/e2e-host-provider-core-npc-fail-closed-2026-10-27` | host/lifecycle-mainline-integration-2026-10-27 | Draft | test: exercise Host → Core → Memory/NPC fail-closed path |
| [#468](https://github.com/necromorphic/Logic-Engine/pull/468) | `security/core-db-acl-boundary-2026-10-27` | main | Draft | [Security] Guarded Core SQLite ACL boundary candidate |
| [#469](https://github.com/necromorphic/Logic-Engine/pull/469) | `security/accepted-head-authority-acl-2026-10-27` | main | Draft | [Security] Accepted-head authority storage ACL candidate |
| [#470](https://github.com/necromorphic/Logic-Engine/pull/470) | `docs/remove-google-branding` | main | Ready | Docs: remove Google/Gemini branding from core audit brief |
| [#471](https://github.com/necromorphic/Logic-Engine/pull/471) | `security/target-pc-acceptance-runbook` | main | Ready | Security: prepare target-PC acceptance runbook |
| [#473](https://github.com/necromorphic/Logic-Engine/pull/473) | `fix/world-scoped-event-identity` | main | Ready | Fix world-scoped event identity in SQLite |
| [#474](https://github.com/necromorphic/Logic-Engine/pull/474) | `docs/plain-language-user-guidance` | main | Draft | docs: define plain-language collaboration requirements |
| [#476](https://github.com/necromorphic/Logic-Engine/pull/476) | `fix/time-policy-reject-lossy-records-2026-10-27` | main | Ready | fix(time): reject lossy TimePolicy records |
| [#477](https://github.com/necromorphic/Logic-Engine/pull/477) | `fix/time-calendar-reject-lossy-definitions-2026-10-27` | main | Ready | fix(time): reject lossy calendar definitions |
| [#478](https://github.com/necromorphic/Logic-Engine/pull/478) | `fix/time-interval-reject-lossy-records-2026-10-27` | main | Ready | fix(time): reject lossy interval records |
| [#479](https://github.com/necromorphic/Logic-Engine/pull/479) | `feat/dispatch-authority-contract-v1` | main | Draft | ADR: Memory disclosure dispatch authority v1 |
| [#480](https://github.com/necromorphic/Logic-Engine/pull/480) | `feat/accepted-head-authority-store` | main | Draft | feat: accepted-head authority store and fail-closed IPC client |
| [#481](https://github.com/necromorphic/Logic-Engine/pull/481) | `fix/time-ignore-inherited-completion-list-2026-10-27` | main | Ready | fix(time): ignore inherited completion identifiers |
| [#483](https://github.com/necromorphic/Logic-Engine/pull/483) | `feat/core-accepted-head-handshake` | feat/accepted-head-authority-store | Draft | feat: serialize Core mutations with accepted-head authority |
| [#484](https://github.com/necromorphic/Logic-Engine/pull/484) | `feat/provider-accepted-head-handshake` | main | Draft | feat: serialize Provider mutations with accepted-head authority |
| [#485](https://github.com/necromorphic/Logic-Engine/pull/485) | `fix/core-accepted-head-durable-digest` | feat/core-accepted-head-handshake | Draft | fix: fail closed on accepted-head authority schema loss |
| [#486](https://github.com/necromorphic/Logic-Engine/pull/486) | `feat/memory-dispatch-gateway` | feat/provider-accepted-head-handshake | Draft | feat: add fail-closed Memory dispatch gate and ledger |
| [#487](https://github.com/necromorphic/Logic-Engine/pull/487) | `coord/stage2-prompt-binding` | feat/memory-dispatch-gateway | Draft | Bind protected dispatch to exact Provider candidate versions |
| [#488](https://github.com/necromorphic/Logic-Engine/pull/488) | `coord/stage2-source-version-binding` | coord/stage2-prompt-binding | Draft | Bind NPC admission to exact canonical source versions |
| [#490](https://github.com/necromorphic/Logic-Engine/pull/490) | `coord/core-source-version-authority` | coord/stage2-source-version-binding | Draft | Use durable Core-issued source-version tokens |
| [#491](https://github.com/necromorphic/Logic-Engine/pull/491) | `coord/core-conversation-bound-scope` | coord/core-source-version-authority | Draft | Bind Memory NPC reads to Core Host conversation scope |
| [#492](https://github.com/necromorphic/Logic-Engine/pull/492) | `work/sillytavern-diagnostic-extension` | main | Draft | feat(host): add fail-closed SillyTavern diagnostic extension |
| [#493](https://github.com/necromorphic/Logic-Engine/pull/493) | `proposal/provider-accepted-head-mutation-protocol` | feat/accepted-head-authority-store | Draft | docs(memory): propose Provider accepted-head mutation protocol |
| [#498](https://github.com/necromorphic/Logic-Engine/pull/498) | `coord/provider-trusted-dispatch-read` | coord/core-conversation-bound-scope | Draft | feat(memory): add trusted Provider dispatch evidence read |
| [#499](https://github.com/necromorphic/Logic-Engine/pull/499) | `coord/provider-read-authority-gate` | feat/provider-accepted-head-handshake | Draft | security(memory): fail closed on Provider reads when accepted-head authority is unavailable |
| [#500](https://github.com/necromorphic/Logic-Engine/pull/500) | `coord/gateway-host-owned-transport-only` | coord/stage2-prompt-binding | Draft | security(gateway): keep dispatch transport Host-owned and provider-neutral |
| [#501](https://github.com/necromorphic/Logic-Engine/pull/501) | `feat/st-extension-ui-bridge-2026-10-27` | main | Draft | feat(host): add SillyTavern Logic-Engine bridge extension |
| [#502](https://github.com/necromorphic/Logic-Engine/pull/502) | `fix/real-evidence-dispatch-fail-closed-2026-10-27` | coord/gateway-host-owned-transport-only | Draft | fix(security): require active Core actors and sources |
| [#503](https://github.com/necromorphic/Logic-Engine/pull/503) | `host/pinned-st-source-audit-2026-10-27` | main | Draft | test(host): audit pinned SillyTavern lifecycle source semantics |
| [#504](https://github.com/necromorphic/Logic-Engine/pull/504) | `test/provider-consumer-real-sqlite-2026-10-27` | coord/core-source-version-consolidated | Draft | feat(memory): preserve canonical source-version binding through Core consumer |
| [#505](https://github.com/necromorphic/Logic-Engine/pull/505) | `test/gateway-provider-revoke-serialization-2026-10-27` | coord/gateway-host-owned-transport-only | Draft | test(security): serialize Provider revoke against dispatch start |
| [#506](https://github.com/necromorphic/Logic-Engine/pull/506) | `feat/local-stage-auto-close-2026-10-27` | feat/local-coordinator-pc | Draft | feat(coordinator): add evidence-gated stage auto-closure |
| [#507](https://github.com/necromorphic/Logic-Engine/pull/507) | `host/save-persistence-receipt-2026-10-27` | host/lifecycle-mainline-integration-2026-10-27 | Draft | fix(host): require persisted receipt for enrolled chat saves |
| [#508](https://github.com/necromorphic/Logic-Engine/pull/508) | `feat/admitted-memory-dispatch-evidence-2026-10-27` | coord/gateway-host-owned-transport-only | Draft | feat(security): derive dispatch evidence from admitted Memory candidates |
| [#509](https://github.com/necromorphic/Logic-Engine/pull/509) | `feat/core-source-version-ledger-2026-10-27` | feat/provider-accepted-head-handshake | Draft | feat(core): add monotonic canonical entity source versions |
| [#510](https://github.com/necromorphic/Logic-Engine/pull/510) | `security/core-host-inventory-readback-2026-10-27` | host/save-persistence-receipt-2026-10-27 | Draft | fix(security): compare Host history with independent Core inventory |
| [#514](https://github.com/necromorphic/Logic-Engine/pull/514) | `core/strict-json-rule-equality-2026-10-27` | main | Ready | Harden Core rule equality against non-JSON values |
| [#515](https://github.com/necromorphic/Logic-Engine/pull/515) | `core/no-accessor-rule-context-reads-2026-10-27` | main | Ready | Prevent rule evaluation from executing context getters |
| [#516](https://github.com/necromorphic/Logic-Engine/pull/516) | `core/strict-json-effect-inputs-2026-10-27` | main | Ready | Reject accessor-backed and malformed mechanic effect inputs |
| [#517](https://github.com/necromorphic/Logic-Engine/pull/517) | `core/strict-rule-definition-data-2026-10-27` | main | Ready | Validate declarative rule objects before evaluation |
| [#520](https://github.com/necromorphic/Logic-Engine/pull/520) | `review/startup-migration-patch-candidate` | main | Draft | [DRAFT] Review-only startup migration patch candidate |
| [#521](https://github.com/necromorphic/Logic-Engine/pull/521) | `coord/core-source-version-consolidated` | feat/core-source-version-ledger-2026-10-27 | Draft | feat(core): consolidate durable source-version readback |
| [#522](https://github.com/necromorphic/Logic-Engine/pull/522) | `core/rule-data-boundaries-2026-10-28` | main | Ready | Reject executable and malformed rule inputs |
| [#523](https://github.com/necromorphic/Logic-Engine/pull/523) | `docs/branch-pr-consolidation-2026-10-28` | main | Draft | docs: reconcile branch and PR dependencies as of 2026-10-28 |
| [#524](https://github.com/necromorphic/Logic-Engine/pull/524) | `coord/host-inventory-reconciliation-entrypoint-2026-10-28` | security/core-host-inventory-readback-2026-10-27 | Draft | Add fail-closed Host inventory reconciliation API seam |
| [#525](https://github.com/necromorphic/Logic-Engine/pull/525) | `core/recalc-oracle-unknown-change-guard` | main | Draft | [DRAFT] Core recalculation oracle rejects unknown change inputs |
| [#527](https://github.com/necromorphic/Logic-Engine/pull/527) | `npc/tz4-denied-empty-contract-20261028` | main | Ready | NPC: distinguish denied Memory results from complete-empty |
| [#528](https://github.com/necromorphic/Logic-Engine/pull/528) | `fix/memory-provider-source-version-output-2026-10-28` | main | Draft | fix(memory): preserve source version in retrieved candidates |
| [#529](https://github.com/necromorphic/Logic-Engine/pull/529) | `research/spatial-temporal-evidence-2026-10-26` | main | Draft | docs(spatial): decision-ready spatial-temporal feasibility proposal |
| [#530](https://github.com/necromorphic/Logic-Engine/pull/530) | `core/source-version-semantics-reconciliation` | main | Draft | docs(core): reconcile canonical source-version semantics |
| [#531](https://github.com/necromorphic/Logic-Engine/pull/531) | `fix/host-inventory-unenrolled-artifacts-2026-10-28` | coord/host-inventory-reconciliation-entrypoint-2026-10-28 | Draft | fix(host): fail closed on unenrolled chat artifacts |
| [#532](https://github.com/necromorphic/Logic-Engine/pull/532) | `npc/isolated-autonomy-planner-20261028` | main | Draft | Add isolated NPC autonomous intention selector |
| [#533](https://github.com/necromorphic/Logic-Engine/pull/533) | `docs/spatial-position-contract-proposal-2026-10-28` | main | Draft | docs(spatial): draft typed position contract for Core review |

## Full branch inventory

Each branch includes its current head SHA, heuristic class, and current open-PR head mapping. A dash means no open PR uses that branch as its head; it does not mean stale.

| Branch | Head SHA | Triage class | Open PR |
|---|---|---|---|
| `audit/api-capability-matrix-194` | `69a8283765cf894a08cf7efe7d2e5aeaef47c528` | DOC_OR_AUDIT_CANDIDATE | — |
| `audit/regression-tests-2026-10-24` | `1f630bc8f045969442e5f77f7524f3305d1f636f` | DOC_OR_AUDIT_CANDIDATE | — |
| `chore/coordinator-event-bridge` | `ddb110b9b96aa496209bccddc48c19fe252ba7bf` | OPEN_PR_HEAD | [#272](https://github.com/necromorphic/Logic-Engine/pull/272) |
| `chore/self-hosted-windows-runner` | `db4a1ff39b067497623a191127e53ddaf8a01d8a` | WORKSTREAM_UNCLASSIFIED | — |
| `ci/harden-runtime-workflow-smoke-test` | `5a8c429477c81b844f9673f959a403deaa4a3a7e` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `ci/host-adapter-pinned-source-audit-2026-10-26` | `893a9135228a8aec2f3cf6b721557a6bf7a51ec7` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `ci/windows-cmd-shell-replay-benchmark` | `c1eb880772dde326ebcea2f3b4bb355b75a44020` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `contract/memory-core-npc-boundary` | `337c3e83fffb496855b6fe8c0864af701db09512` | WORKSTREAM_UNCLASSIFIED | — |
| `coord/bounded-mechanic-executor-2026-10-25` | `be455beb449e2309b341f62bbc476e315f5ba1c7` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/bounded-mechanic-executor-current-main-2026-10-25` | `80a2b8c3b3fe6b671a891bdee76fd56fab8eb37b` | DUPLICATE_CANDIDATE | — |
| `coord/core-conversation-bound-scope` | `59151c9591324a81028b7e172d06acf7779289e6` | OPEN_PR_HEAD | [#491](https://github.com/necromorphic/Logic-Engine/pull/491) |
| `coord/core-source-version-authority` | `1c21de2057b5881b64c9fe15ea5d6b45ec6708fd` | OPEN_PR_HEAD | [#490](https://github.com/necromorphic/Logic-Engine/pull/490) |
| `coord/core-source-version-consolidated` | `cc6eae970c0f5ab5270c1429ff3b99eb7d9a6439` | OPEN_PR_HEAD | [#521](https://github.com/necromorphic/Logic-Engine/pull/521) |
| `coord/dispatch-order-cross-process-proof-2026-10-26` | `d88721fe335547e6a6e167618cccf3bce8855bf1` | OPEN_PR_HEAD | [#377](https://github.com/necromorphic/Logic-Engine/pull/377) |
| `coord/e2e-host-provider-core-npc-fail-closed-2026-10-27` | `8ea2608c86c22b79a29faad981d351e7a133a620` | OPEN_PR_HEAD | [#467](https://github.com/necromorphic/Logic-Engine/pull/467) |
| `coord/fact-identity-doc-current-main-2026-10-25` | `a9da86e845531cc69136832bb95b51758485a7a3` | DUPLICATE_CANDIDATE | — |
| `coord/fact-identity-doc-latest-main-2026-10-25` | `3eb9fefdbc74879a688352f50c4bc8bacd339790` | DUPLICATE_CANDIDATE | — |
| `coord/gateway-host-owned-transport-only` | `34097ef27d9d6963b40fc0f22dc07f3f985284f7` | OPEN_PR_HEAD | [#500](https://github.com/necromorphic/Logic-Engine/pull/500) |
| `coord/host-evidence-final-main-2026-10-25` | `f02a1a7fc76e0b9b4fb6df82d357ae01668d804b` | DUPLICATE_CANDIDATE | — |
| `coord/host-evidence-latest-main-2026-10-25` | `87d772da7cbec0b566451a5eb7d43c47dd7d199b` | DUPLICATE_CANDIDATE | — |
| `coord/host-evidence-rebased-2026-10-25` | `7ab6a9b389036d7bf5cd977946e93300ed9acf9e` | DUPLICATE_CANDIDATE | — |
| `coord/host-inventory-reconciliation-entrypoint-2026-10-28` | `4f7dfdc41fb6e8fdafd2745dc67dd008be2af78a` | OPEN_PR_HEAD | [#524](https://github.com/necromorphic/Logic-Engine/pull/524) |
| `coord/host-lifecycle-evidence-current-main-2026-10-25` | `49f926bff673ab240568eab9e6e72df20b7db5f3` | DUPLICATE_CANDIDATE | — |
| `coord/host-lifecycle-evidence-main-1ecbaea` | `197f52ad780ff86c61bdbb9f6b8b50547f697f16` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/host-startup-migration-guard-2026-10-28` | `9f104694376b61996cc6e3d2dd32068b4f13ce33` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/memory-raw-archive-2026-10-25` | `6bbef8604254052d9ecc9150e75547a36dd89334` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/memory-raw-archive-current-main-2026-10-25` | `f67425015ca9593c02f325bd53981a161e894d91` | DUPLICATE_CANDIDATE | — |
| `coord/npc-admission-regression-coverage-2026-10-25` | `1ecbaea0ffe3604374226c8347a1f70da6ca8337` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/npc-authz-regression-tests-2026-10-25` | `182e79bb696b4de4f3edc9dd60d4e0b1a1d962c6` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/npc-traceability-current-main-2026-10-25` | `4d6be1f4e40424fe21f6f607be73efb3f3101345` | DUPLICATE_CANDIDATE | — |
| `coord/npc-traceability-latest-main-2026-10-25` | `7bc3e3bde854c72465931b8388165aa08cdc9629` | DUPLICATE_CANDIDATE | — |
| `coord/port-regression-evidence-2026-10-25` | `e2f96ff50c4c22a13b755772809b7730d93b92f8` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/portfolio-doc-refresh-current-main-2026-10-27` | `22ba87567d9957a18fbbb2ea5a2703984f5a2280` | DUPLICATE_CANDIDATE | — |
| `coord/provider-docs-current-main-2026-10-25` | `159f71cc3f3458a88208b73c4381a5f1b5b9fb08` | DUPLICATE_CANDIDATE | — |
| `coord/provider-docs-final-status-fix-2026-10-25` | `14a82ff39aa938e73610bf3f0b47a120f06311f9` | DUPLICATE_CANDIDATE | — |
| `coord/provider-lifecycle-201-current-main-2026-10-25` | `7997f2f00586b7e55b2cce807a8b5e2810a987af` | DUPLICATE_CANDIDATE | — |
| `coord/provider-lifecycle-201-reconciled-2026-10-25` | `caa14a607278b8dfe6991c00e2fcf22594dfc45a` | DUPLICATE_CANDIDATE | — |
| `coord/provider-raw-archive-recheck-2026-10-25` | `1535c0448604ce9a8cbe7ac8f6f8229b1e909b6b` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/provider-read-authority-gate` | `a44d2eca41c6e3724caba2d6c55587d66d115919` | OPEN_PR_HEAD | [#499](https://github.com/necromorphic/Logic-Engine/pull/499) |
| `coord/provider-revocation-lineage-tests-2026-10-25` | `915ca3449ba2022e1943b407d86e9fbf7a1acfa5` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/provider-trusted-dispatch-read` | `d026a6f549da035d709446826f8920e27fd67257` | OPEN_PR_HEAD | [#498](https://github.com/necromorphic/Logic-Engine/pull/498) |
| `coord/provider-typed-failures-ci-2026-10-25` | `acf8b292b78d1ee3fa9959fb060066e41c22cbb8` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/reconcile-242-main-2026-10-25` | `31d09ba21795a5f8d985d397a02cb2c07ac930fc` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/reconcile-246-main-2026-10-25` | `30e54290602e9b59eddb83e4b766a78961fd1197` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/reconcile-248-main-2026-10-25` | `9ac2f58e7f0e7ec59a8fd35568bb5f42751e9772` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/reconcile-274-main-2026-10-25` | `ac616e96e529fb97af9b6afef6700abcac513af6` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/reconcile-283-current-main-2026-10-25` | `9df282202f9cf36bd108a1ac209bc606579227b3` | DUPLICATE_CANDIDATE | — |
| `coord/stage2-memory-context-api` | `19d2290d1cead6a7f4091584b8d2749cb7e1915a` | DOC_OR_AUDIT_CANDIDATE | — |
| `coord/stage2-prompt-binding` | `1089eaaf10c63b3a5378e8eccd46f802ef5d2168` | OPEN_PR_HEAD | [#487](https://github.com/necromorphic/Logic-Engine/pull/487) |
| `coord/stage2-source-version-binding` | `19d2290d1cead6a7f4091584b8d2749cb7e1915a` | OPEN_PR_HEAD | [#488](https://github.com/necromorphic/Logic-Engine/pull/488) |
| `coordinator/portfolio-doc-status-2026-10-26` | `c19a64aa06c492d93abf1211ce37ba7387045842` | DOC_OR_AUDIT_CANDIDATE | — |
| `core/140-release-boundary-proposal-2026-10-25` | `ee08d7779310a9a60764a963291932306d48ab4c` | WORKSTREAM_UNCLASSIFIED | — |
| `core/243-checkpoint-recovery-decision-record` | `7b1f4026f96c8873ebe94eb3941e8ed220146986` | OPEN_PR_HEAD | [#341](https://github.com/necromorphic/Logic-Engine/pull/341) |
| `core/243-successful-commit-response-loss-replay` | `adc1f947f4c6e343e3801579fd2b027f6816846a` | OPEN_PR_HEAD | [#340](https://github.com/necromorphic/Logic-Engine/pull/340) |
| `core/260-communicative-intent-contract` | `a0c22703dcff7433d42c87a7f76e4bf7e7b3163b` | OPEN_PR_HEAD | [#339](https://github.com/necromorphic/Logic-Engine/pull/339) |
| `core/api-capability-matrix-proposal` | `a91acd1b8d65e8b77105d21f0ea4a319f05558c2` | WORKSTREAM_UNCLASSIFIED | — |
| `core/atomic-bound-host-capture` | `4f7aac6c9671b0b23cc1aae812ca95786a7b93ab` | WORKSTREAM_UNCLASSIFIED | — |
| `core/atomic-state-snapshot` | `0db54a2e2c2385da06775f6174b457ae9050700d` | WORKSTREAM_UNCLASSIFIED | — |
| `core/atomic-state-snapshot-v2` | `c3faef9b61ec09d5ed16a79ac0de2f836d8d016d` | DUPLICATE_CANDIDATE | — |
| `core/atomic-state-snapshot-v3` | `144460cc4e081f129cdff4a914c5d3e69bc3f329` | DUPLICATE_CANDIDATE | — |
| `core/audit-independent-sqlite-writer-bypass` | `bb05588d17583f7463ba7aae70e23483cf5a8d10` | WORKSTREAM_UNCLASSIFIED | — |
| `core/audit-independent-sqlite-writer-bypass-clean` | `353e1634547d870a43d5af8f5c5c60b5e8ce7dd5` | DUPLICATE_CANDIDATE | — |
| `core/authorized-read-api-boundary-tests` | `2961d53f1852a14f9b4ecdc1718f87f3d61e07b0` | WORKSTREAM_UNCLASSIFIED | — |
| `core/authorized-read-boundary-contract` | `ece1986bd793701751cfd2bec24927083349976c` | WORKSTREAM_UNCLASSIFIED | — |
| `core/authorized-read-default-deny-test` | `585e6288e5c491ad42547766c9749515258a0ba8` | WORKSTREAM_UNCLASSIFIED | — |
| `core/authorized-read-policy-hook` | `4eda3de05b18cf48c6bd642b75546a91ad9d16bc` | WORKSTREAM_UNCLASSIFIED | — |
| `core/authorized-read-rollback-race-regression` | `460587bc3538c8704055f1f2e781d8722874909e` | OPEN_PR_HEAD | [#330](https://github.com/necromorphic/Logic-Engine/pull/330) |
| `core/authorized-read-service-prototype` | `2bc7b00c55074a14f7b7200ecae85cbae5f19162` | WORKSTREAM_UNCLASSIFIED | — |
| `core/canonical-entity-source-version-validator-2026-10-27` | `fe522f259c4f44c89a1f6a9deb161c94b7d7ff61` | WORKSTREAM_UNCLASSIFIED | — |
| `core/capability-matrix-current-runtime` | `99c6d488ff81c80ba7466c94ce7ba345b86ac9a9` | WORKSTREAM_UNCLASSIFIED | — |
| `core/characterize-coordinated-restore-memory` | `f5c3a87c7f53febce605a4a121607ce5c69f84c1` | WORKSTREAM_UNCLASSIFIED | — |
| `core/characterize-host-binding-rollback` | `5f8558d4c3a009e14518533b4f09f58982a409e7` | OPEN_PR_HEAD | [#450](https://github.com/necromorphic/Logic-Engine/pull/450) |
| `core/context-manifest-current-disposition` | `ba40888063d97d9f493973dc9c20226e639577e4` | WORKSTREAM_UNCLASSIFIED | — |
| `core/context-manifest-generation-mismatch-test` | `18df7e96d618c2f016a35d0b05c5d3845d636313` | WORKSTREAM_UNCLASSIFIED | — |
| `core/context-manifest-registration-gate` | `407e523afebf96c85ffa4e156dedb32f4710adcd` | WORKSTREAM_UNCLASSIFIED | — |
| `core/contextual-interpretation-contract` | `936fb30e11671e98c3dcedb2ce8d698a04483acf` | WORKSTREAM_UNCLASSIFIED | — |
| `core/coordinator-lock-participant-prototype` | `c461864b5f8983c9b50673cfb3bfcedf840d4481` | WORKSTREAM_UNCLASSIFIED | — |
| `core/correct-trust-contract-status-wording` | `9394a99db07218bfcd1ea31c584ad92be7387707` | WORKSTREAM_UNCLASSIFIED | — |
| `core/cross-boundary-authorization-regression` | `64504a93c17f776cb8404a4d6c9c8a8a3650622a` | WORKSTREAM_UNCLASSIFIED | — |
| `core/decision-dispatch-authority-140` | `acd89b21c8a77580c970dea0f71f57a0037fa3c1` | OPEN_PR_HEAD | [#379](https://github.com/necromorphic/Logic-Engine/pull/379) |
| `core/decision-host-conversation-world-binding` | `04662985a34eee0f985b9f24586f121faef8e83f` | WORKSTREAM_UNCLASSIFIED | — |
| `core/evaluation-recalculation-boundary` | `08341fe90e5f1e480a6547393ccf27a7e6ee8df9` | WORKSTREAM_UNCLASSIFIED | — |
| `core/finalize-disclosure-dispatch-contract-2026-10-26` | `5493826f3a0bbafbf99f6addeb0ac02478609c9e` | OPEN_PR_HEAD | [#371](https://github.com/necromorphic/Logic-Engine/pull/371) |
| `core/first-slice-replay-boundary` | `3d68db4824f99deb76735d47377219ac55915583` | WORKSTREAM_UNCLASSIFIED | — |
| `core/fix-coordinator-db-alias-2026-10-27` | `fed4d2390b9dfffc6c7e9b9a1cf4f51ceee25456` | WORKSTREAM_UNCLASSIFIED | — |
| `core/fix-rollback-entity-projection` | `54bdcc59d66a110be1f9c77c43efee22cda33c74` | OPEN_PR_HEAD | [#355](https://github.com/necromorphic/Logic-Engine/pull/355) |
| `core/host-conversation-world-binding-implementation` | `4556344fb6a4abd6f667672434d9547655bd7fe9` | WORKSTREAM_UNCLASSIFIED | — |
| `core/host-conversation-world-binding-mainline` | `05cc1795f5adc1e21b90fa7c23a4c6b1c56527e8` | DUPLICATE_CANDIDATE | — |
| `core/host-ledger-ingress-current-main` | `252ca7fd8d1fe192cc99831bff5965c45b12ea82` | DUPLICATE_CANDIDATE | — |
| `core/http-audit-current-disposition` | `ecef04dbe9b53425ee9669a763b0993bb4737a9f` | WORKSTREAM_UNCLASSIFIED | — |
| `core/issue-146-evaluator-contract-proposal` | `a5f52076cda97b6a57d6f374e84fb401cffd296d` | WORKSTREAM_UNCLASSIFIED | — |
| `core/issue-146-historical-relationship-pin-rebuild-test` | `f493f719fddcec2f1a085d7d6a22781f75a5106c` | WORKSTREAM_UNCLASSIFIED | — |
| `core/knowledge-acquisition-contract-proposal` | `ed1c3bfd4d583143ff31d536205e782519f4dfc8` | WORKSTREAM_UNCLASSIFIED | — |
| `core/matrix-concurrent-snapshot-evidence` | `0912b45dbde9d51b751779cf9704765720d60f27` | WORKSTREAM_UNCLASSIFIED | — |
| `core/matrix-snapshot-evidence-v2` | `2e04d8cfaf9ccec425e7fb2bd755191b21a343e6` | DUPLICATE_CANDIDATE | — |
| `core/memory-npc-contract-reconciliation-current` | `7da8cff0dfa5feacbe86aa44a41925cfa22fcdd2` | WORKSTREAM_UNCLASSIFIED | — |
| `core/memory-npc-race-gates-20261025` | `8b343af528e6078e568e29c2c1092e47e90b5877` | WORKSTREAM_UNCLASSIFIED | — |
| `core/no-accessor-rule-context-reads-2026-10-27` | `94637f12899ab9f988d91e70753b19afa7640d10` | OPEN_PR_HEAD | [#515](https://github.com/necromorphic/Logic-Engine/pull/515) |
| `core/npc-authorized-read-fields` | `3401b6939c2aab0d9b0a19dd73c60ebe3e06a56e` | OPEN_PR_HEAD | [#466](https://github.com/necromorphic/Logic-Engine/pull/466) |
| `core/npc-contract-docs-current` | `f572a242ef1d1b949c1dc038e26ee7fbc6aeb20e` | WORKSTREAM_UNCLASSIFIED | — |
| `core/operation-1-6-current-main-refresh` | `328c653c8f7fbe0ae7f1add9fcfc61712eb4e445` | DUPLICATE_CANDIDATE | — |
| `core/operation-1-6-current-main-refresh-v2` | `c52c631636c8c4558c4e7dd0645974ca43e3a7d9` | DUPLICATE_CANDIDATE | — |
| `core/process-checkpoint-failure-replay-2026-10-25` | `6db9d8593358a94aa4e5d61dcef19bd13e69d50d` | WORKSTREAM_UNCLASSIFIED | — |
| `core/proposal-commit-owner-boundary` | `8d0ab66d47ae82a1260d2bdb43ab8862e9847e47` | WORKSTREAM_UNCLASSIFIED | — |
| `core/proposal-serialized-disclosure-dispatch` | `0cce0867241e641e0940eb5e1708e17876a4ebdb` | WORKSTREAM_UNCLASSIFIED | — |
| `core/proposal-stale-commit-regression` | `4c0a9602f1560a34c430b680bbdad3c373bbf641` | OPEN_PR_HEAD | [#328](https://github.com/necromorphic/Logic-Engine/pull/328) |
| `core/propose-db-single-writer-boundary` | `a01c4b4ddb8bfde03fbe15a2cb9fc0eb45aa1c47` | WORKSTREAM_UNCLASSIFIED | — |
| `core/recalc-oracle-unknown-change-guard` | `83249324bc74d39982ba9b4aac46d2e43dcc680a` | OPEN_PR_HEAD | [#525](https://github.com/necromorphic/Logic-Engine/pull/525) |
| `core/recovery-proposal-rollback-reopen` | `4f6976e4173e55360d1f97f1cb0ef097dccf0da3` | OPEN_PR_HEAD | [#352](https://github.com/necromorphic/Logic-Engine/pull/352) |
| `core/refresh-cross-block-matrix-after-132` | `33e5a63ac10d0dbbf65db2a61c01b6a17a561b36` | DUPLICATE_CANDIDATE | — |
| `core/relationship-authorized-read-proposal` | `c54c174513cf7d2d78e2d25640e637e8370689b0` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-domain-handoff-current-main` | `94bf061e53b370683936c4318b792e8b8e83ad20` | DUPLICATE_CANDIDATE | — |
| `core/relationship-effect-extension-point-audit` | `10934b3e6e08256dbc9608dc29810b2c1a5c9bbf` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-final-evidence-refresh` | `ecfd4b546727e917e2fb077ce69c4082b047a0d9` | DUPLICATE_CANDIDATE | — |
| `core/relationship-historical-rule-pin-replay` | `a6ffffbae43b16c26b81f59c04b0a31e5758a961` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-http-provenance-tests` | `bb044ed5de0edbc7364b9f1fc1f968f941acd167` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-neutral-unset-clear-test` | `21dde3c21fd323fecc22f7c187e191ec63815a37` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-partial-patch-atomicity-test` | `0208cf2d8d98ca798aaf181d31a91bc768aaf97c` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-provenance-evidence-refresh` | `c3695c8c9d147caa1ef08431ebb2cd3e32009f1d` | DUPLICATE_CANDIDATE | — |
| `core/relationship-runtime-evidence-refresh` | `0fa1018b9ece89539edd07c24f35df4518bf89d4` | DUPLICATE_CANDIDATE | — |
| `core/relationship-transition-atomicity-tests` | `6b8c4e6fade8d01d15039e8d278d57e4b2c78aa8` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-transition-fail-closed-support` | `79deb588e1f6321826dc3316085aaab6fdb010b7` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-transition-http-boundary-tests` | `939724a673d4480a9529fee36479a510b8b059c1` | WORKSTREAM_UNCLASSIFIED | — |
| `core/relationship-transition-http-boundary-tests-v2` | `bff370b920e32013f17a036eda9450c9eafd1066` | DUPLICATE_CANDIDATE | — |
| `core/relationship-transition-persistent-replay-test` | `3db9c1484fedf4162023b93acc8920269eff6e10` | WORKSTREAM_UNCLASSIFIED | — |
| `core/require-configured-adapter-binding` | `79c357dc2d94a2ed8c6ba583badc4cd88fb5ee0e` | WORKSTREAM_UNCLASSIFIED | — |
| `core/rollback-admin-boundary-current-main` | `24374d043a23f2927730980e358df27714b5378c` | DUPLICATE_CANDIDATE | — |
| `core/rollback-read-regressions-current-main-2026-10-26` | `9fc6d7ca107993b97798406376f79252539ddfcc` | OPEN_PR_HEAD | [#368](https://github.com/necromorphic/Logic-Engine/pull/368) |
| `core/rollback-source-version-regression` | `bf35fb8dd13628718dacc11c27654c0929fba0e2` | WORKSTREAM_UNCLASSIFIED | — |
| `core/rule-data-boundaries-2026-10-28` | `a3a164aa07aced56a6ec0557f5bfffeeb8d0d47e` | OPEN_PR_HEAD | [#522](https://github.com/necromorphic/Logic-Engine/pull/522) |
| `core/serialized-dispatch-gate-mainline-2026-10-26` | `a55f50ceb047208dc2c1d94f14e036206233d9da` | DUPLICATE_CANDIDATE | — |
| `core/shared-coordinator-lock-current-main` | `c2e4122738c18dc1a8fb2833bac560fc190a1fa4` | DUPLICATE_CANDIDATE | — |
| `core/source-trust-conflict-acceptance` | `265a0dc358be7a50269cc23238d53370d5ee17e0` | OPEN_PR_HEAD | [#465](https://github.com/necromorphic/Logic-Engine/pull/465) |
| `core/source-trust-contract-acceptance` | `539682045f719db0a915744419c731abd10646cd` | WORKSTREAM_UNCLASSIFIED | — |
| `core/source-version-semantics-reconciliation` | `c25586c34023ce583dae8deb2026b0fe8615e4f9` | OPEN_PR_HEAD | [#530](https://github.com/necromorphic/Logic-Engine/pull/530) |
| `core/stale-approved-proposal-no-residue-2026-10-25` | `0eb93ffa13a6dc525392c12df2cf7258231ee6ac` | WORKSTREAM_UNCLASSIFIED | — |
| `core/state-snapshot-concurrent-writer-test` | `746bc8add9c4b3360500f95b3601ae9966bf2775` | WORKSTREAM_UNCLASSIFIED | — |
| `core/strict-json-effect-inputs-2026-10-27` | `10eee71df7119d973aa3c225ec16fb0081afc208` | OPEN_PR_HEAD | [#516](https://github.com/necromorphic/Logic-Engine/pull/516) |
| `core/strict-json-rule-equality-2026-10-27` | `bf3a9a56522a1d2f823202e7167f7c3d87807a86` | OPEN_PR_HEAD | [#514](https://github.com/necromorphic/Logic-Engine/pull/514) |
| `core/strict-rule-definition-data-2026-10-27` | `dc89a875d3a1fb00b182a92b07353364626820b6` | OPEN_PR_HEAD | [#517](https://github.com/necromorphic/Logic-Engine/pull/517) |
| `core/test-bound-host-capture-ordering` | `4081cc89781db9b5932851cd94e78cc508ce8351` | WORKSTREAM_UNCLASSIFIED | — |
| `core/time-advance-failure-replay-after-restart` | `b1b87c5baece31248db5a4101e447701fd8023cd` | WORKSTREAM_UNCLASSIFIED | — |
| `core/time-advance-failure-replay-after-restart-v2` | `f75b42c8bf5a2edb7dbe4e45cbde703ee8d17724` | OPEN_PR_HEAD | [#335](https://github.com/necromorphic/Logic-Engine/pull/335) |
| `core/trust-boundary-docs-current` | `c76cf22e31bf5ae6c69cfcacdcb56dbd184a820c` | WORKSTREAM_UNCLASSIFIED | — |
| `core/trust-boundary-docs-current-v2` | `1c9992ab1f1592dc9cb43b67a33a7b0614a9438a` | DUPLICATE_CANDIDATE | — |
| `core/trusted-mutation-origin-contract` | `cf7df864e064b8251254b39e2690314e362f9d9a` | WORKSTREAM_UNCLASSIFIED | — |
| `core/typed-relationship-transition-runtime` | `1aa59e6d4b7921646ed44727de21ba610eb6da39` | WORKSTREAM_UNCLASSIFIED | — |
| `core/update-dispatch-matrix-rollback-evidence-2026-10-26` | `f58ce7b04f89a2f53c1f64e1ffe5a179b921ac9d` | WORKSTREAM_UNCLASSIFIED | — |
| `docs/audit-runtime-status-2026-10-24` | `91063541870e336b6473cd70d7218ebca175a1e7` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/benchmark-workload-description` | `fc125c23310db46e9476f19f463e9ded3022be48` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/branch-pr-consolidation-2026-10-28` | `493d5e57ecf12017f81ecd2d60c7eae191db1a40` | OPEN_PR_HEAD | [#523](https://github.com/necromorphic/Logic-Engine/pull/523) |
| `docs/card-projection-stage1-spec` | `afd03cbe0ac44eb2c2b945395aa90a07d7110558` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/card-snapshot-cursor-followup` | `38afea4f308be4c7958d0d3e289b713fb8b203a7` | DUPLICATE_CANDIDATE | — |
| `docs/causality-semantics-and-character-architecture` | `c499cb27b32c530cba14bf8ad9ab5eda6bffca8d` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/character-card-stage1-clean` | `04e9efb335fc4b4b250e397266cf4ba7915aa3e4` | DUPLICATE_CANDIDATE | — |
| `docs/character-cards-contract-v1.2.1` | `3e0799ddfe47ab4e0183ce0de423ad520324eb7b` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/coordinator-integration-status-2026-10-26` | `b291a14f7d112019b64ed672db2ad173cbcb181f` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/coordinator-integration-status-2026-10-26-current-main` | `b703e1dbebe16607abd17d02e11d22db584b052c` | DUPLICATE_CANDIDATE | — |
| `docs/coordinator-memory-dispatch-protocol` | `c888cec8fc1a0c06b8782f7191a476cf2934976a` | OPEN_PR_HEAD | [#354](https://github.com/necromorphic/Logic-Engine/pull/354) |
| `docs/coordinator-memory-npc-boundaries-2026-10-26` | `2824022eeeade07bfbe60f422bc8e3e90345cbae` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/core-1.5-cross-block-integration-matrix` | `786a69a92a70a0ff76260a7ca6a2fb6ac7c96c5d` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/core-1.7-time-block-start` | `d8429046621ca2314b326ced9645a2db6af80086` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/core-140-memory-npc-gates-2026-10-25` | `4792bca83ff4cf94bfd3ba1974ce1fd6d010b0ba` | OPEN_PR_HEAD | [#345](https://github.com/necromorphic/Logic-Engine/pull/345) |
| `docs/core-deployment-policy-authority-226` | `c36584e3d7471b261c0581d5668396df35cf7ecd` | OPEN_PR_HEAD | [#297](https://github.com/necromorphic/Logic-Engine/pull/297) |
| `docs/core-evaluation-recalculation-publication-boundary-2026-10-25` | `c859b6365e163650017c68c01dc8649b0a67a734` | OPEN_PR_HEAD | [#336](https://github.com/necromorphic/Logic-Engine/pull/336) |
| `docs/core-http-service-boundary-audit` | `03706188f044a4821c5957a0f7aa7199df193eb0` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/core-npc-knowledge-runtime-plan` | `9bce66a1813fd69b6979223406b077b06981bb76` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/core-stage1.3-mechanics-execution-contract` | `b183407cdb4a0ca2db15f4ef305513c50c5f8778` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/current-main-storage-worldpack-status-2026-10-26` | `8e18cf26d644be9d816a441539abca5bf334b0d9` | DUPLICATE_CANDIDATE | — |
| `docs/event-type-open-taxonomy-contract` | `df3275e478d72a1e4863b8405492ec28a76a1b87` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/fact-set-identity-semantics` | `41a7917de1ff6861ae11d51dfc0ff67a78afadbf` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/host-adapter-st-lifecycle-evidence` | `00cbf17497765b6e2058482f3b22b0517e5f36db` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/host-log-redaction-evidence-2026-10-27` | `957f2c0deb282ca2f6e3a10e7fb3946725de7fd5` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/issue-73-current-main-test-crosswalk` | `7c9cfeeed244ab1ab26e22040526eca0ae9c0cbb` | OPEN_PR_HEAD | [#324](https://github.com/necromorphic/Logic-Engine/pull/324) |
| `docs/mechanic-effect-support-matrix` | `d3454a5e4223cb16b4b6e2894138d499e6b903f5` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/mechanic-effect-translator-contract` | `fb9cf14cb260bf8916fc014ce1574b1f3c85b94f` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/mechanic-intent-proposal-boundary` | `0cf145bab662be59edd036be0657e9c5e1c6c33e` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/mechanics-registry-runtime-status` | `749428c71d3754f2df72ba0007181b84e8f0c9da` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/memory-provider-canonical-matrix-181` | `1e9b29c40c607f5f521de60c1b2595cf7b909e9a` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/multiple-independent-supports-contract` | `7f551e4f8ed84a27084fc7e7af51f1631a75eff9` | OPEN_PR_HEAD | [#50](https://github.com/necromorphic/Logic-Engine/pull/50) |
| `docs/npc-admission-evidence-2026-10-24` | `bcb9e1345d17fe0370d005ffc59340c1ba700bfc` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/npc-autonomy-story-kt-rules` | `fc58b3b2b4cf75cef0752dd2f2b9a150f2da174e` | OPEN_PR_HEAD | [#353](https://github.com/necromorphic/Logic-Engine/pull/353) |
| `docs/npc-contract-suite-clean` | `8e3ee5fb3bedbec7bd412d1eaa3e81a503f51517` | DUPLICATE_CANDIDATE | — |
| `docs/npc-core-rollback-test-traceability` | `9ae800d6e20bb2eb628c84e31237f5e482d3b854` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/npc-lifecycle-evidence-traceability` | `d3a72a0911c63a9906e2ab7efe847a0ac344cda6` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/npc-memory-boundary-matrix-2026-10-24` | `c12a3f9b12ef7e2a2f37ee24ec47f77a9f652d48` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/performance-budget-baseline` | `dc7d83074e4dd444408c7769b85ce148cb8a4c12` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/personality-issue-73-blocker-owners` | `99f1d56b9b190b2dadd564b2b41ca8a0f829e322` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/personality-issue-73-current-main-traceability` | `797a8c424bf13647ee911ca26ba7d7f29bae04cb` | DUPLICATE_CANDIDATE | — |
| `docs/plain-language-user-guidance` | `edf7e7cfa6d807b4d647d5bb314fa30c60be0e03` | OPEN_PR_HEAD | [#474](https://github.com/necromorphic/Logic-Engine/pull/474) |
| `docs/process-manager-core-boundary-current-main-2026-10-25` | `290f929128fd345c1015294bfcce280186fa8076` | DUPLICATE_CANDIDATE | — |
| `docs/proposal-commit-boundary` | `2362d7ef82f7150ded3de936bc06cc1c858ef907` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/proposal-commit-boundary-contract` | `9b8ecf7dcbb6f710c9ead3cdd5a90ca04b651a6b` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/readme-progress-update-2026-10-27` | `e712d5d11fccc3dd791c52af8e7f617ee1039d10` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/reconcile-merged-blocks-2026-10-25` | `21c9f86f2d3e5b10caf2dd6ee44f6cbf1eb54394` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/relationships-core-runtime-evidence-refresh` | `eae5cc1fbae911cf737deefee3159228284746d4` | DUPLICATE_CANDIDATE | — |
| `docs/relationships-core-runtime-evidence-refresh-v2` | `f6553cf9d47f55b969fa136db2462542de5f046b` | DUPLICATE_CANDIDATE | — |
| `docs/relationships-current-main-evidence-v2` | `5f5e9a75bce6275feaf073d75514acd0fe0b6e3b` | DUPLICATE_CANDIDATE | — |
| `docs/relationships-current-main-evidence-v3` | `ac49c6b71790be294bf0f369ea214f8bce259f11` | DUPLICATE_CANDIDATE | — |
| `docs/relationships-refresh-after-core-107-108` | `e1d30d8e3a8bbe719abac4a978121c44704c472c` | DUPLICATE_CANDIDATE | — |
| `docs/remove-google-branding` | `4dec965ef9a6eed14684699819d9fd622ea8c290` | OPEN_PR_HEAD | [#470](https://github.com/necromorphic/Logic-Engine/pull/470) |
| `docs/repository-front-page-status` | `8ab0e650a9c2fb033b5c99e6a83108a5bdccd0f1` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/security-single-writer-boundary-current-main` | `69af1ad12c21f726843f9c251961ef29811bbfef` | DUPLICATE_CANDIDATE | — |
| `docs/spatial-position-contract-proposal-2026-10-28` | `19fc2505ce326b2b651c9b39bb529be928f31acd` | OPEN_PR_HEAD | [#533](https://github.com/necromorphic/Logic-Engine/pull/533) |
| `docs/storage-schema-lifecycle-contract` | `bb830aa119280d04655dffdcefac59fcd6720280` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/subject-knowledge-delivery-contract` | `bbb074b6685f85333f2620e7ecf3a0ec11f3efeb` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/sync-proposal-boundary-status` | `76d7bd407c7b0db09bf1686f163766a04259eaad` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/time-advance-core-audit` | `ae76b617d68c612eeb0b125b1222d26a633a0ee0` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/time-advance-operation-contract` | `cfe8a5cca07da736da7b694a88eda3f51e746d80` | DOC_OR_AUDIT_CANDIDATE | — |
| `docs/universal-mechanics-system-contract` | `937feedae58aa48a8acc015430bba2af7ff0dfa2` | DOC_OR_AUDIT_CANDIDATE | — |
| `feat/accepted-head-authority-store` | `e9010e8330791659e91df92f6ea8fe73552b8dcb` | OPEN_PR_HEAD | [#480](https://github.com/necromorphic/Logic-Engine/pull/480) |
| `feat/admitted-memory-dispatch-evidence-2026-10-27` | `43b2f7ca140da51b3363c0d8c67dd0d5cec1bdcb` | OPEN_PR_HEAD | [#508](https://github.com/necromorphic/Logic-Engine/pull/508) |
| `feat/canonical-fact-identity-guards` | `44318056d98106b4eb59fc6f4f9da21582b26bbf` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/canonical-fact-identity-guards-rebased` | `1e08c8dc1d2c4c31462826640e00e12611a9a1bd` | DUPLICATE_CANDIDATE | — |
| `feat/character-card-projection-stage1` | `e8cb8b5fd04af02c104ede6de2dd0abe52c9fbc1` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/character-card-projector-clean` | `6957a3497269939013333b3a0630fc70627225c8` | DUPLICATE_CANDIDATE | — |
| `feat/consistent-internal-snapshot-read` | `09e48c2fd764c8e3f7b1e8f96e485a58ea34c793` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/consumer-dispatch-envelope-2026-10-27` | `92823877aa4d88a72813ad3282f68d48c68a6896` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/core-accepted-head-handshake` | `c413b948586f0b32df0bd40b0d53c2550790b4d2` | OPEN_PR_HEAD | [#483](https://github.com/necromorphic/Logic-Engine/pull/483) |
| `feat/core-mechanic-vertical-slice-226` | `e39e0dfd708453a2090ad1ea1b4f931d36510bc4` | OPEN_PR_HEAD | [#301](https://github.com/necromorphic/Logic-Engine/pull/301) |
| `feat/core-memory-contracts` | `7f18045e9b3848da0c998ffe7877080281654dff` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/core-npc-actor-binding` | `29a97f8a1580673cb4d4a1c88ca9b1e40485f9d3` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/core-npc-actor-binding-clean` | `7c67a831ed2d411ee832f6ed2d080dbc006df831` | DUPLICATE_CANDIDATE | — |
| `feat/core-source-version-ledger-2026-10-27` | `6234deecc7740d0417097df0c827789c76c49061` | OPEN_PR_HEAD | [#509](https://github.com/necromorphic/Logic-Engine/pull/509) |
| `feat/dispatch-authority-contract-v1` | `eb338319dc6e06b9b5c904ec76c2545fbeda8ef5` | OPEN_PR_HEAD | [#479](https://github.com/necromorphic/Logic-Engine/pull/479) |
| `feat/durable-time-trigger-lifecycle-2026-10-24` | `776a536c2ccbf76d22ffd2b5bc7c09f502bd3460` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/explicit-entity-create-update` | `5e10ca2ea73248f6659202a825cd9ec4995d7501` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/generation-bound-context-manifests` | `9c4a299947e05d2c043dae2397612443c855514a` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/historical-absence-predicates` | `8ad2a02ae2ad2a72749e87ba4a7e8cb1a6bd4756` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/historical-requires-predicates` | `92b765ace822aa9f244c31b4848deba2329bba17` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/local-coordinator-pc` | `58847f8f1992d181cd5bc5edc9ce9a6e0dec3124` | OPEN_PR_HEAD | [#273](https://github.com/necromorphic/Logic-Engine/pull/273) |
| `feat/local-stage-auto-close-2026-10-27` | `edfd7970d0a3272a2c86dcd120616789b0c156a6` | OPEN_PR_HEAD | [#506](https://github.com/necromorphic/Logic-Engine/pull/506) |
| `feat/mechanic-effect-translator` | `96133c286643cdbc5cca3b3e0d6e78e122a67b21` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/mechanic-evaluation-snapshot` | `3417a28f8a99663a9834f733bb842558259bc2e4` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/mechanic-evaluation-snapshot-mainline` | `825099772776445a55470e88985356aa727c1422` | DUPLICATE_CANDIDATE | — |
| `feat/mechanic-intent-proposal-integration` | `ac5eba36c8c59af074d83ae4a7829652e2628a88` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/mechanics-contracts` | `d273717024673903fb4aba593410692264e9abe0` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/mechanics-registry` | `14aa857f1ae91f8e78cc808cf6b46adc8de35c46` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-core-runtime-audit-issue129` | `439bc3f59af429eb6924551087371af811b8dc2f` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-dispatch-gateway` | `3cc6a1fd09b5e9fdc09294cf823a57b9d249e003` | OPEN_PR_HEAD | [#486](https://github.com/necromorphic/Logic-Engine/pull/486) |
| `feat/memory-npc-authorized-host-seam` | `867c3f4b4c714f96b686943ead83b8b3c69cf467` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-npc-contract-reconciliation` | `7892ac2bc261d9a01ef41d464a201192ed6722ce` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-npc-contract-reconciliation-clean` | `0ae28d3c655afbc7321bf1af0e2a62dcbcd48083` | DUPLICATE_CANDIDATE | — |
| `feat/memory-npc-contract-reconciliation-final` | `c15b2829173e79037789241d92773b5c291f4b8f` | DUPLICATE_CANDIDATE | — |
| `feat/memory-npc-host-seam-spike` | `1f10aaaeb89f5fdd1905a7f9cf46bb0a286960b0` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-provider-core-adapter-main` | `74cc225f38a4ecc0da1c2c1f6f767541230b3987` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-provider-internal-import-contract` | `177dfb85bde388fdf568a29a315a85421e95ff80` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-provider-on-core-seam` | `177f15bcc6d7f6d2ac42087fae248ddde8b60812` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/memory-provider-sqlite-vertical-slice` | `e6ed0a1322341b44fe6b85833f177cfbf5ef0052` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/npc-memory-docs-clean` | `fab3ddf99f0194b63ddf294b35209d53aaf24607` | DUPLICATE_CANDIDATE | — |
| `feat/npc-memory-docs-final` | `75d499b11be9dbee5c1b32cac74afeb0c172a9b0` | DUPLICATE_CANDIDATE | — |
| `feat/npc-subsystem` | `e3e8fc43e2488227b74ded67434aed522c5ec484` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/per-world-commit-sequence` | `7dd58d185322edd0b3bb427a3083bb7a2aa73cbf` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/personality-subsystem` | `59095fc85efb5251f451299715acb05ddbfdcb74` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/process-manager-first-slice` | `a5cb4dac8d2064b547dca2e2caebda70a97d21ef` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/proposal-commit-api` | `8f7ada1986c20c331f65dafde39c92b3f3e562cd` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/provider-accepted-head-handshake` | `b1cbbe0ad657ca7617ab20a892f9c320a50e4050` | OPEN_PR_HEAD | [#484](https://github.com/necromorphic/Logic-Engine/pull/484) |
| `feat/provider-accepted-head-handshake-ci` | `dd6a9fd87e80c8ff7f99e63ee23377c24ce05aa7` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/provider-accepted-head-handshake-v2` | `4acf822f87206dda265d19e150e9a10fc57ef4d7` | DUPLICATE_CANDIDATE | — |
| `feat/provider-accepted-head-mutation-guard` | `ae375b81c545783e8191e9081db1ba8308037836` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/provider-accepted-head-mutation-guard-ci` | `dcb42a48a1029935d55011146de9b5717b085b23` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/provider-digest-only-host-ledger` | `ec1147fbf128d4b65a44029f70918500de2f707b` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/relationship-domain-module` | `39ede61d1e59c62f62ede3820bbb2b470db8a76d` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/relationship-domain-module-main-sync` | `e8615476eb8a86e6ddff7585bd2b410ef089bd67` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/relationship-issue73-traceability-handoff` | `ed5fdebb9f64764949acc29e69c51183c2d9df4f` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/relationship-issue73-traceability-handoff-v2` | `25be430aeca22d232c02bccc7772b594ef1c2b1d` | DUPLICATE_CANDIDATE | — |
| `feat/relationship-issue73-traceability-handoff-v3` | `99aeafaff33443ea53b358fb077fdf5026e12da7` | DUPLICATE_CANDIDATE | — |
| `feat/relationship-pure-evaluator` | `3946e01728568e590492c99fada5ae145a9eda04` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/st-extension-ui-bridge-2026-10-27` | `72cd292cb9f2db4ed2f6b9ee326639021792c09b` | OPEN_PR_HEAD | [#501](https://github.com/necromorphic/Logic-Engine/pull/501) |
| `feat/stage1.3-deterministic-evaluator` | `405b54394eb3e64ece5f04d27a3ded91e529e48d` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-action-advance-integration-2026-10-24` | `5ec7161172564804f5bb8ca4fda4f0af14f434fd` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-action-proposal-approval-2026-10-24` | `f748603d9b96808406095449f650399207d1e944` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-atomic-segment-core-2026-10-24` | `7457844f1499f7febb01ff9fcb4c0c2012e4e7e8` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-author-duration-approval-2026-10-24` | `fc759ca6143baf45a0783c0324176272e31cd780` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-coordinate-core-integration-2026-10-24` | `45bdc9af14d795e6efff7e870d835897f3f7a625` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-domain-t1` | `01b709e5519c27596d68bc2e07ebaddfabc5051b` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-due-work-planner-2026-10-24` | `37b8ce68e198edafb894d3883558d68dcf8e2c25` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-durable-advance-operations-2026-10-24` | `d6d5b92378b72bd599f8347712f498d3cbba119b` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-persisted-triggers-2026-10-24` | `6de7e07dc61da52e08bf5dad4ae08563b158c5a9` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-policy-calendar-authoring-2026-10-24` | `aef8d5cc95dac90857bdafd8dce6913a09fbf903` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-process-state-contract` | `dfb8bf27f8919b2e94cc55e5ff0642b472f428d4` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/time-trigger-registry-t7-2026-10-24` | `e36e44de1db2072bf8e6b3354d99b0b9cd1e13eb` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/tri-state-condition-results` | `a35f9fd20bff9a21ce5faa3c55f42ae350984651` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/tri-state-historical-fact-predicates` | `82ce8dd1e26103bfd3156cc1773df8aea17ca9a3` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/typed-causal-links` | `29ab8ab7229e6fc806ecf23ffc1a37626ad8689b` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/validate-proposals-before-approval` | `9c8a5eb7c44dafc170ba7371845eac495f97c1ab` | WORKSTREAM_UNCLASSIFIED | — |
| `feat/world-scoped-mechanic-instances` | `b68e418972e174764f37469fca6121473ec054aa` | WORKSTREAM_UNCLASSIFIED | — |
| `feature/time-domain-t1` | `766779a45f95e21927942c1d2255239cf90a8fde` | WORKSTREAM_UNCLASSIFIED | — |
| `feature/time-domain-t2` | `766779a45f95e21927942c1d2255239cf90a8fde` | WORKSTREAM_UNCLASSIFIED | — |
| `feature/time-domain-t2-integrated` | `50e8f9044e8454afa805597a559b0b3393c6a360` | WORKSTREAM_UNCLASSIFIED | — |
| `feature/time-domain-t3` | `4619911a4b4e013e4de0df163807387284b961c1` | WORKSTREAM_UNCLASSIFIED | — |
| `feature/time-domain-t4` | `734515597a09df049f05c67780dcc92fb365eea9` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/accepted-head-return-operation-digest` | `7d0c49a1119da233272a231ad631997a0dac6952` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/api-capability-policy-2026-10-24` | `30b3160515b59301b1dde0dbb12fe48175fe3919` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/audit-confirmed-runtime-defects-2026-10-24` | `01d183e2c3556c69367add0c3622615f64e7ba11` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/core-accepted-head-durable-digest` | `1bf9561574de0c96fed8490a2e17c565a2f7fc84` | OPEN_PR_HEAD | [#485](https://github.com/necromorphic/Logic-Engine/pull/485) |
| `fix/core-rollback-admin-boundary` | `1eb5ee6765202020f356239770866ec927d364cd` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/gateway-exact-provider-candidate-binding` | `5a11c18ccf20dafec7616ab10221ccb3f4fafe88` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/host-inventory-readback-blockers-2026-10-27` | `87952255c3cfeada4f62dc830856f712c7b99000` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/host-inventory-readback-blockers-followup-2026-10-27` | `dd64153979299230b8d606054b7a01b8a9ecfeb8` | DUPLICATE_CANDIDATE | — |
| `fix/host-inventory-unenrolled-artifacts-2026-10-28` | `2678a04e162dc50d5f9df54f1626d94ac6e7a497` | OPEN_PR_HEAD | [#531](https://github.com/necromorphic/Logic-Engine/pull/531) |
| `fix/mechanic-policy-freshness-binding` | `7136c2484d799e8e4fb8383ca8b8a910937dd58a` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/mechanic-rule-operator-matrix` | `8035b98c2939d45d893c4ed73153856681b0ce4d` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/memory-provider-source-version-output-2026-10-28` | `842c3e8e621cc054a316439baa5c3f6f8dd95606` | OPEN_PR_HEAD | [#528](https://github.com/necromorphic/Logic-Engine/pull/528) |
| `fix/npc-summary-lineage-sparse-array` | `5351fb66a42e680d41535effa46729277c015d45` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/personality-issue-73-test-traceability` | `014e9782ca210095650c39d36c0359acc9fd5d75` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/personality-post-merge-doc-refresh` | `43cbdc16d663e6b66418857f9f094946ce89c89a` | DUPLICATE_CANDIDATE | — |
| `fix/personality-relationship-case-crosswalk` | `40bab34b08ac881cedcf9d7143054b4211fda485` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/proposal-audit-rollback-test` | `81ae9d4709ed20e8d2a0bd3c037eac8ad705f1cb` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/proposal-trust-boundaries` | `86e207546919a89248e66d1f5c7f90bf7e2a4dd9` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/provider-query-grant-cycle-race-2026-10-26` | `2dc307c10d6b63b8952f6f14938fef46f8a4e793` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/provider-serialized-access-readiness-2026-10-26` | `59293de5b96655144c5e3e925cb3828338a03783` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/provider-serialized-writes-clean-2026-10-26` | `5ce6c2e200421482150acf766cbb05b8e8adfede` | OPEN_PR_HEAD | [#382](https://github.com/necromorphic/Logic-Engine/pull/382) |
| `fix/provider-shared-coordinator-lock-2026-10-26` | `8ad192a07fb4cfd14c89e25743c627407dde3c61` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/provider-windows-file-identity-2026-10-27` | `1f3112bc6d1c5d6a2e481aae520596948c67da2c` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/reads-claim-historical-support` | `c4147939fcc18eb23ad5253022973365b5404adb` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/real-evidence-dispatch-fail-closed-2026-10-27` | `1dbab36ec78626ee262622829a1cceb1fa4f322d` | OPEN_PR_HEAD | [#502](https://github.com/necromorphic/Logic-Engine/pull/502) |
| `fix/reject-unknown-contract-fields` | `2c17743715598fbd374333426749ff63bb9106ae` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/rollback-review-ambiguity` | `8e49525adf85ea80a67ebc7ba93705d4c82e8ecb` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/runtime-contracts-rollback` | `228403dfe400e2344a0d79ea080fb363fa6da7d6` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/runtime-rule-contract` | `f747d49b126e9b56574b23e95012957835961e4f` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-calendar-reject-lossy-definitions-2026-10-27` | `606cfff5f34d6f650a3594e76b57c9acae591c3b` | OPEN_PR_HEAD | [#477](https://github.com/necromorphic/Logic-Engine/pull/477) |
| `fix/time-completed-prerequisite-causal-order-2026-10-27` | `1e0e31d78e9d8a33f3b2e527f36f11953bdd692c` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-contract-current-main-2026-10-25` | `e19da62b8eeb44ca0283a1e6b47407058dba5998` | DUPLICATE_CANDIDATE | — |
| `fix/time-ignore-inherited-completion-list-2026-10-27` | `bafd8428f42726b4b313ae3dcb1be22bb4278f91` | OPEN_PR_HEAD | [#481](https://github.com/necromorphic/Logic-Engine/pull/481) |
| `fix/time-interval-reject-lossy-records-2026-10-27` | `8f78faae83f67499faf9d32602c5cc12f5daf1b0` | OPEN_PR_HEAD | [#478](https://github.com/necromorphic/Logic-Engine/pull/478) |
| `fix/time-policy-enforce-whole-second-rules` | `f122b1bff357bb94c3865b3c1881cb344841de89` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-policy-operation-ceiling-2026-10-24` | `9145b4dea7bedf614d94519c674ed9e3bfdd839d` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-policy-reject-lossy-records-2026-10-27` | `a33ce8067b62ef67a56203b44344171e74e6675c` | OPEN_PR_HEAD | [#476](https://github.com/necromorphic/Logic-Engine/pull/476) |
| `fix/time-policy-schema-long-skip-ceiling-2026-10-27` | `e0f29c25b1cae5965d52161f62c895bf6d890ea4` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-strict-trigger-record-validation-2026-10-27` | `3bf2090a8f8d7fea88efc3bbe335ded3ef7c9da1` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-trigger-policy-validation-2026-10-24` | `4776801ae184357fa3c444276c6dac3276a418e5` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-trigger-policy-validation-main-2026-10-24` | `42a8d6de1356eccb00640f0cf81f7a111ba60b44` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/time-trigger-policy-validation-v2-2026-10-24` | `f311fb1da5a54e73942c3f08c24586586aa109ed` | DUPLICATE_CANDIDATE | — |
| `fix/time-trigger-resource-bounds-2026-10-24` | `ac9a004886212c7222d8ed0af6181764632bf8fb` | WORKSTREAM_UNCLASSIFIED | — |
| `fix/world-scoped-event-identity` | `1ccd681f3849cc4ea5db1bdf09c712cf678f736e` | OPEN_PR_HEAD | [#473](https://github.com/necromorphic/Logic-Engine/pull/473) |
| `host/digest-proxy-bridge-integration` | `25d10e48192a155dc7c0737af01746987ddb8a8f` | WORKSTREAM_UNCLASSIFIED | — |
| `host/google-ai-studio-egress-gateway-audit-2026-10-26` | `8a3130f4aaef8255ff3eddb0c9332e627dea29f7` | WORKSTREAM_UNCLASSIFIED | — |
| `host/issue-258-lifecycle-matrix-2026-10-25` | `e9576afb29f1205345a542f094385797ef310156` | WORKSTREAM_UNCLASSIFIED | — |
| `host/lifecycle-completeness-followup-2026-10-25` | `4c8d193ca55cf96e46d7371ecfbec6ab7e54eff1` | DUPLICATE_CANDIDATE | — |
| `host/lifecycle-evidence-mainline-2026-10-26` | `41125a42d2267a6732116fca42ccae6d316dd294` | DUPLICATE_CANDIDATE | — |
| `host/lifecycle-journal-current-main-fix` | `4863d057fa65be1f1eb53e1570c1fa7557e330fc` | DUPLICATE_CANDIDATE | — |
| `host/lifecycle-journal-prototype` | `3f7ef3e7c13b94cfa3633948a27a7a96bbf76680` | WORKSTREAM_UNCLASSIFIED | — |
| `host/lifecycle-mainline-integration-2026-10-27` | `dcb4db6f7e31dd6c926958366f5db67c6795743d` | OPEN_PR_HEAD | [#456](https://github.com/necromorphic/Logic-Engine/pull/456) |
| `host/pinned-source-audit-mainline-2026-10-26` | `db2f9ef1134caa6120945683d00108319c6f284c` | DUPLICATE_CANDIDATE | — |
| `host/pinned-st-source-audit-2026-10-27` | `1ad2a1fa42cdde1bfc1ab1aede817c77fdbdbea0` | OPEN_PR_HEAD | [#503](https://github.com/necromorphic/Logic-Engine/pull/503) |
| `host/redact-makersuite-prompt-logging-2026-10-27` | `e6b0f129940f8298d7e598f9f4a74dc588f72e58` | WORKSTREAM_UNCLASSIFIED | — |
| `host/remote-digest-ledger-sync-current-main` | `2b9a1a3fd146ae1dde79f68b4ff8005b412989d6` | DUPLICATE_CANDIDATE | — |
| `host/save-persistence-receipt-2026-10-27` | `966c6d28658eb61825b241cf4da1177545ea60a8` | OPEN_PR_HEAD | [#507](https://github.com/necromorphic/Logic-Engine/pull/507) |
| `host/source-inventory-freshness-gate-2026-10-27` | `337a510a481fa3cf0e381346889569c81b657f21` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/combined-memory-mechanics-current-main` | `01fc99b7dd3cf71f899ec03412fcb3cd7344e951` | DUPLICATE_CANDIDATE | — |
| `integration/core-memory-contracts` | `cb7875125acfabb72ae77af73275a85b30f5f69d` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/mechanics-40-43-candidate` | `5b6d106ba9c1975e52f558dd30555a35187066ca` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/mechanics-current-main` | `6981b14016e8d2bcf002bb90ae1a860195f57b7e` | DUPLICATE_CANDIDATE | — |
| `integration/mechanics-current-main-candidate` | `e0c882b47dfa242902eb9e280f0a51c0ef2948ad` | DUPLICATE_CANDIDATE | — |
| `integration/mechanics-mainline-candidate` | `c87781243fb6c6d52a195698d8fb0677000f6147` | DUPLICATE_CANDIDATE | — |
| `integration/memory-npc-host-seam-tests` | `e5a42c3cce50bc2294fad5353b0213adfa354077` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/memory-provider-core-npc` | `7d9a18b97f98e933c15d08baa5dc1ece1b9883aa` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/memory-provider-current-main` | `eb2a0353661f3a4810f1f118f0f7eb89982ca473` | DUPLICATE_CANDIDATE | — |
| `integration/memory-provider-current-main-v2` | `1c5c99ce83007433d1610b73ea702727447c698e` | DUPLICATE_CANDIDATE | — |
| `integration/memory-raw-archive-main-20261025` | `bfd66a81b3c1910c8829e6829d239e3f30d4370c` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/npc-memory-admission-slice` | `e06cb35b85a399238cea5ad0ac6dcb3043792b05` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/personality-relationship-crosswalk` | `8fcca2d5333f120f6c3565c4daa72820a814b0a7` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/process-manager-time-current-main` | `7f30b8fb0d819a321c7712729f836495ebaab4d5` | DUPLICATE_CANDIDATE | — |
| `integration/relationship-domain-design` | `971f30b3959174471b88e709792e42741dc762fc` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/st-bridge-health-probe` | `34e36c57de9fede212679c289761a4ba0e593482` | WORKSTREAM_UNCLASSIFIED | — |
| `integration/trusted-mutation-origin-contract` | `7bf84ab2c89cca66a2e127100954dccae8f9a7bd` | WORKSTREAM_UNCLASSIFIED | — |
| `main` | `5bc5f0e4434c7573d2754e6cda94786fcb45fca0` | CANONICAL_MAIN | — |
| `memory-provider-input-snapshot-hardening-2026-10-27` | `e571f0a6c7361421910c8da3276f5548c5cd43d4` | WORKSTREAM_UNCLASSIFIED | — |
| `memory-provider-p0-raw-capture-regressions` | `3d2091e658066ea425f952a803cad52f5d54fd16` | WORKSTREAM_UNCLASSIFIED | — |
| `memory-provider-p0-raw-capture-tests-main` | `44ab6654210ccceb0ad87342b1c7ef73a2d44144` | WORKSTREAM_UNCLASSIFIED | — |
| `memory-provider-purge-boundary-tests` | `a14e07ce74e81f61c021d1a8a5717f1967691bfb` | WORKSTREAM_UNCLASSIFIED | — |
| `memory/issue-142-source-boundaries` | `63b3cfdce7532b7aad4a441dc772194ee160ff8f` | WORKSTREAM_UNCLASSIFIED | — |
| `memory/issue-142-source-boundaries-current-main` | `76c562187a98ca15ff19e6b40a3d58179e9b88f3` | DUPLICATE_CANDIDATE | — |
| `memory/issue-142-source-boundaries-current-main-v2` | `d3f9f7dd3b6f15bf9a5be7664635aef74ce5d885` | DUPLICATE_CANDIDATE | — |
| `memory/npc-cross-review-current-main` | `6068c1905e55ab100b42514e85c11c721054cad1` | DUPLICATE_CANDIDATE | — |
| `memory/provider-input-shape-hardening-2026-10-27` | `ba363648841f99046053a5c5117f7699e4056adf` | WORKSTREAM_UNCLASSIFIED | — |
| `memory/provider-input-snapshot-hardening-main-2026-10-27` | `e820fdf20e2bcb5665d5480e42b20b4ff4f0ea56` | WORKSTREAM_UNCLASSIFIED | — |
| `memory/provider-race-mainline-2026-10-26` | `91ad4f262c9572258f40c22d075f1c3b7ef54e88` | DUPLICATE_CANDIDATE | — |
| `memory/provider-shared-coordinator-lock-current-main` | `42c304288779c47b75e328605aac1f03a262229e` | DUPLICATE_CANDIDATE | — |
| `memory/provider-strict-snapshot-shape-2026-10-27` | `2f35b3d4f8b3b5a95eaf774a0fda2bce3198adbb` | WORKSTREAM_UNCLASSIFIED | — |
| `memory/revocation-race-contract` | `1dfb57bc02a407c861f41460e8f46c84e067262c` | WORKSTREAM_UNCLASSIFIED | — |
| `memory/sqlite-provider-core-npc-slice-2026-10-27` | `8e87e792967855c2fd1ca874eca63a93cde2df22` | WORKSTREAM_UNCLASSIFIED | — |
| `memory/sqlite-provider-hardening-current-main-2026-10-27` | `4b3ae743664dece5d330cebce0325ac5394d6f40` | DUPLICATE_CANDIDATE | — |
| `npc/1.4-clean-lineage-tests` | `176c2cb03c6f3273cc20cd98cb6e8e8c0aa6c465` | DUPLICATE_CANDIDATE | — |
| `npc/1.4-clean-lineage-tests-current-main` | `d5d4421823007d2d46e0002c7d037306aa30b64e` | DUPLICATE_CANDIDATE | — |
| `npc/1.4-clean-memory-boundary-matrix` | `d7653da088a6448996ebbada3c00ccda53f589be` | DUPLICATE_CANDIDATE | — |
| `npc/1.4-clean-memory-boundary-matrix-current-main` | `5cfe282e7e231d4c9a44c82203a95847afcb09e5` | DUPLICATE_CANDIDATE | — |
| `npc/1.4-clean-memory-boundary-matrix-current-main-v2` | `61d2cf3b2db034ee4361d4915bc444970abce1f2` | DUPLICATE_CANDIDATE | — |
| `npc/1.4-handoff-evidence-matrix` | `668cfdc35ba68d4de3daf38045744e69054fb00e` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/149-lineage-duplicate-guard-2026-10-26` | `bf35fb8dd13628718dacc11c27654c0929fba0e2` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/317-correct-boundary-matrix-duplicate-semantics` | `800240cbb280c8d07273f66fca8180f05eaeb8a0` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/317-knowledge-state-semantics` | `06b55db73f90470f057f53174549196aadeccae4` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/317-reject-duplicate-memory-identities` | `a5ea3b213b49d5afd716bf8faf0e567df6847c8f` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/317-reject-duplicate-summary-lineage` | `1cded9bd24d189e10b410a78fa83903988fcb1e9` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/admission-hardening-current-main-2026-10-27` | `58afaa9726367c8de8f272dda80378baf9ec1f0e` | DUPLICATE_CANDIDATE | — |
| `npc/duplicate-ambiguity-matrix-2026-10-26` | `8ab98b7bd6cc588f062f4c140f07aa8409dfccc9` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/duplicate-canonical-read-guard-2026-10-27` | `3cada6f12d79f8a771f3c089506379be2318f2e7` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/duplicate-canonical-read-guard-current-main-2026-10-27` | `79bdec2370bf597bf9b39d482be64c210e053e48` | DUPLICATE_CANDIDATE | — |
| `npc/isolated-autonomy-planner-20261028` | `49b890e846546b43332a3080229ece9c39ced1de` | OPEN_PR_HEAD | [#532](https://github.com/necromorphic/Logic-Engine/pull/532) |
| `npc/knowledge-transition-semantics-2026-10-27` | `e5258a6131ed731e11abefada7a45e909506e611` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/lineage-duplicate-guard-current-main-2026-10-27` | `5fb590018c0782b485d36246ec2307824c4d8850` | DUPLICATE_CANDIDATE | — |
| `npc/lineage-duplicate-guard-current-main-2026-10-27b` | `6d6ef5437bb30ea5dc75dea7740bab0758bb2cf5` | DUPLICATE_CANDIDATE | — |
| `npc/lineage-duplicate-guard-current-main-2026-10-27b2` | `dec61be27d160d5c05f75897560b92f7a72b53f5` | DUPLICATE_CANDIDATE | — |
| `npc/lineage-duplicate-guard-main-2026-10-27` | `b5871568f3cdd966a5a3eac4739251fe828993ee` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/nonready-result-lineage-safety-current-main` | `3f92da7764b5e06f7edcb8fc860174f9455b80bb` | DUPLICATE_CANDIDATE | — |
| `npc/rebase-accessor-admission-guard-2026-10-27` | `b0332610bbe7808a69646e06342904d1d824bf6c` | DUPLICATE_CANDIDATE | — |
| `npc/rebase-accessor-admission-guard-2026-10-27b` | `5691f79c4902cccc663b59bbd00df785f9d6338e` | DUPLICATE_CANDIDATE | — |
| `npc/refresh-summary-lineage-guard-2026-10-26` | `932d94dc90216876029396748747c98f3a10b466` | DUPLICATE_CANDIDATE | — |
| `npc/reject-accessor-backed-admission-inputs` | `8497d5841c5daf55f4e56c0d53919411abbd65eb` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/reject-duplicate-memory-identities-current-main-2026-10-27` | `d19580b01866f60ec31bc57d5e8f8e7af64a21bb` | DUPLICATE_CANDIDATE | — |
| `npc/remove-duplicate-oracle-tests-2026-10-27` | `83732f05feefa101105d426fb8c1ed8e2645b228` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/rollback-only-revision-regression` | `e590d002aeac85560363370876c6316d751c5d83` | WORKSTREAM_UNCLASSIFIED | — |
| `npc/summary-lineage-duplicate-guard-current-main-2026-10-27` | `5b38cd39ec697ba9ab8fff01c428d4576c149279` | DUPLICATE_CANDIDATE | — |
| `npc/tz4-denied-empty-contract-20261028` | `4a8e228b2637e5353527c9fc95e19eea379c6fd6` | OPEN_PR_HEAD | [#527](https://github.com/necromorphic/Logic-Engine/pull/527) |
| `perf/benchmark-mixed-projection-workload` | `8cf87c66968fbeb8a4aada231035d856b8d6be3c` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `perf/benchmark-repeat-samples` | `c5c40fc9c27dd8bc7e1d197470b876f1d382d663` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `perf/benchmark-replay-rollback-growth` | `1b9ef8a994d0acdd2427925c1a710bf3228d5926` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `perf/benchmark-rollback-cascade` | `d2164c1a18fc22c5a46413aa17a18f437f31cbf5` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `personality/issue-73-blocker-owners-v2` | `90bd3052362ec671b0e068129e4d3dfedcb0b84b` | DUPLICATE_CANDIDATE | — |
| `personality/issue-73-blocker-owners-v3` | `d6f18b6a780de84f5faa94c9a9f857eaf09b5ab3` | DUPLICATE_CANDIDATE | — |
| `personality/issue-73-main-reconciled-2026-10-24` | `797d981c1499a4dae017da34348ac6ceafb77e15` | DUPLICATE_CANDIDATE | — |
| `proposal/provider-accepted-head-mutation-protocol` | `c2a591bbcf3cde1f18bb1d66d82682bfae4b9e96` | OPEN_PR_HEAD | [#493](https://github.com/necromorphic/Logic-Engine/pull/493) |
| `provider/cross-connection-race-regressions-current-main-2026-10-27` | `e004db40dc29d7265666afadc5566c5266f4f763` | DUPLICATE_CANDIDATE | — |
| `provider/digest-only-host-version-ledger-current-main` | `53d06f42e61e0f27def151a09f94e1894ee01326` | DUPLICATE_CANDIDATE | — |
| `provider/digest-only-source-version-ledger-2026-10-26` | `bfb8ff96323e884dfd9f0690e6937ae396c10d48` | WORKSTREAM_UNCLASSIFIED | — |
| `provider/exact-version-tombstone-isolation-current-main-2026-10-27` | `2ffed2ae977901365404048f166944350b5aa69c` | DUPLICATE_CANDIDATE | — |
| `provider/fix-untrusted-inventory-scope-2026-10-27` | `e79682a7117a2b12c536627b5a36786c1435bae1` | WORKSTREAM_UNCLASSIFIED | — |
| `provider/harden-host-ledger-startup-current-main` | `8038b6feda145bf4578f2fdb207647575149c0f9` | DUPLICATE_CANDIDATE | — |
| `provider/invalidate-ready-on-ledger-mutation-2026-10-26` | `f4da57a7c38ea9e27ab27aedd6d0a4bbb45d0ec0` | WORKSTREAM_UNCLASSIFIED | — |
| `refresh/443-provider-input-snapshot-hardening-2026-10-27` | `577b4e95d88c14178eb4b3c7f4f07f156446b00b` | OPEN_PR_HEAD | [#460](https://github.com/necromorphic/Logic-Engine/pull/460) |
| `refresh/447-world-pack-version-semantics-2026-10-27` | `e1f9710797d3d1eb9f9306b9f48b75086404d27e` | OPEN_PR_HEAD | [#458](https://github.com/necromorphic/Logic-Engine/pull/458) |
| `refresh/448-relationship-interaction-evidence-2026-10-27` | `e9d3b188b79434ba962b76bb99405cdac362c4d9` | OPEN_PR_HEAD | [#459](https://github.com/necromorphic/Logic-Engine/pull/459) |
| `refresh/449-npc-interpretation-boundary-2026-10-27` | `a9f2923a4f0df7a0fd84e8a7a964896428204621` | WORKSTREAM_UNCLASSIFIED | — |
| `relationships/interaction-evidence-adversarial-cases` | `61a99287b09a2058fec976b6678ad7cabdd6ded3` | WORKSTREAM_UNCLASSIFIED | — |
| `relationships/issue-130-typed-transition-handoff` | `85f9305d327ee1dda654798a5629ab2fe9bbf2d2` | WORKSTREAM_UNCLASSIFIED | — |
| `relationships/issue-143-exact-compatibility-default` | `1b43c0eaa037815e45aaf0ee4681864c0744ad05` | WORKSTREAM_UNCLASSIFIED | — |
| `relationships/issue-143-exact-compatibility-default-refresh` | `e9da09f55b6131e0ca4d662582c6c90b6a8bd5fd` | DUPLICATE_CANDIDATE | — |
| `relationships/issue-143-pinned-rule-version-domain-test` | `d1231c42f96323123e91e849acd89213dd4ca98f` | WORKSTREAM_UNCLASSIFIED | — |
| `relationships/issue-143-world-pack-version-semantics` | `9b59a555a4bec0aba870e46733ff4f728b59bd20` | WORKSTREAM_UNCLASSIFIED | — |
| `relationships/npc-interpretation-boundary` | `380c5806b0268b9a69849c6f2966e47410e71a3a` | WORKSTREAM_UNCLASSIFIED | — |
| `relationships/npc-interpretation-boundary-refresh` | `53d3251ba05678721892aede0abd91acc9b37892` | DUPLICATE_CANDIDATE | — |
| `relationships/social-interaction-evidence-assessment-refresh` | `91fe5ed6cb8499fdf0857e11ac8d4ff14d8fddbf` | DUPLICATE_CANDIDATE | — |
| `research/recalculation-oracle-harness-2026-10-24` | `b1986602b47e189ce58514972676db79c21f7e8c` | DOC_OR_AUDIT_CANDIDATE | — |
| `research/spatial-temporal-evidence-2026-10-26` | `cfdf3eda74b14c15de077b48e925f00291c6458e` | OPEN_PR_HEAD | [#529](https://github.com/necromorphic/Logic-Engine/pull/529) |
| `review/claude-full-project-audit` | `180308b0d6af382314d1847504a7b8618efe986d` | OPEN_PR_HEAD | [#185](https://github.com/necromorphic/Logic-Engine/pull/185) |
| `review/host-history-trustworthiness-2026-10-28` | `cac4e2240340010f1d5a00c73893197655b2fbe9` | DOC_OR_AUDIT_CANDIDATE | — |
| `review/host-lifecycle-patch-2026-10-25` | `0210a71e633cc04c740daf53f8c7e035f4218592` | DOC_OR_AUDIT_CANDIDATE | — |
| `review/startup-migration-block-core-conditional-approve` | `57e44623ed416438c9d97b71977e7ebfef4c1389` | DOC_OR_AUDIT_CANDIDATE | — |
| `review/startup-migration-patch-candidate` | `6155d75386d304226d5d1c072c152083f5406717` | OPEN_PR_HEAD | [#520](https://github.com/necromorphic/Logic-Engine/pull/520) |
| `security/accepted-head-authority-acl-2026-10-27` | `1aa7e8ac15e5429cb769791ce55eec28e86417a7` | OPEN_PR_HEAD | [#469](https://github.com/necromorphic/Logic-Engine/pull/469) |
| `security/accepted-head-host-domain-2026-10-27` | `abbccf17c533b780132a876a96b64815eb19df56` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `security/api-least-privilege-194` | `08d91cff2b341d04898609704170d4b4d519afb6` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `security/constant-time-credential-checks` | `bffb7833709ae940fa120baf4241eed02c4d1848` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `security/core-db-acl-boundary-2026-10-27` | `1a477d3c1260015ae748201b8ed3ac002ffd742a` | OPEN_PR_HEAD | [#468](https://github.com/necromorphic/Logic-Engine/pull/468) |
| `security/core-db-acl-path-hardening-2026-10-27` | `8bf7cc7f0c2aa6516d36a31f2e771ed05831dc75` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `security/core-host-inventory-readback-2026-10-27` | `4154ce0c6667e49869f4f5bcb165e1d21dcd62bb` | OPEN_PR_HEAD | [#510](https://github.com/necromorphic/Logic-Engine/pull/510) |
| `security/product-security-policy-2026-10-26` | `1c16609ee32445202ef7741d5779fea470b4d835` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `security/target-pc-acceptance-runbook` | `47719268cbecacf0025c067e90bbc145fbdec4ea` | OPEN_PR_HEAD | [#471](https://github.com/necromorphic/Logic-Engine/pull/471) |
| `security/windows-deployment-evidence-collector` | `31ff72961b15f5fe55257cdb084eb666fafb402c` | OPEN_PR_HEAD | [#451](https://github.com/necromorphic/Logic-Engine/pull/451) |
| `stage1-causality-contract-tests` | `c7757126ff702d965702a6f3a76b467cb76550e4` | WORKSTREAM_UNCLASSIFIED | — |
| `stage1-rollback-graph-tests` | `c402e52b8e25efca36a9363bdb5470ca41b83ea0` | WORKSTREAM_UNCLASSIFIED | — |
| `test/core-context-manifest-snapshot-expansion` | `7b5be03f2fb81549c0bf76b4b40140e056c837a5` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/core-provider-canonical-source-integration-2026-10-27` | `22bc736de28ad0492a629af907fc4c0dcf10c5cd` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/core-provider-coordinated-restore-current-main` | `65a9eceea219e928ddfc2cb1532ac42385ce865c` | DUPLICATE_CANDIDATE | — |
| `test/core-rollback-projection-atomicity` | `aef73b485349bc2b36521a88d268fea60a624589` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/core-rule-pin-failed-lookup-no-write` | `5d64869e0e476ccd491aa678e7296ef8ca04f3f6` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/entity-mutation-atomicity` | `e6571fe2c5fd27ad2fd7ae9eeaefb39d3e825163` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/gateway-provider-revoke-serialization-2026-10-27` | `fa2778debccb4ebc093a9fe48c08a1b1cee19cd7` | OPEN_PR_HEAD | [#505](https://github.com/necromorphic/Logic-Engine/pull/505) |
| `test/memory-provider-concurrency-restart-current-main` | `2945712056244803d5067b98c0cadf748fa10136` | DUPLICATE_CANDIDATE | — |
| `test/memory-provider-lifecycle-regressions-main` | `7683478f6e38c48fa167d3a1a18ea102d255ea54` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/memory-raw-read-revocation-race` | `a64060388b59f7ff82f3f94a1a19e205e1d2ba64` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/migration-and-rollback-atomicity` | `cc6430714b3037711a7a75f830c9d3f90d70c152` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/npc-admission-result-immutability` | `788992e4fe037928be408de087ffef30258d0a6d` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/npc-candidate-identity-pair` | `810addef53be04138ba1e44d1e71cb560cb97160` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/npc-lifecycle-boundary-regression` | `9427b5506c3056d6c720646c5337d5eb1ac9f942` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/npc-lineage-world-scope-negative` | `2d571b6c0d4d4ba89229e207ae50d7125d92d3c5` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/npc-result-status-lineage-safety-2026-10-24` | `6a43c48c0215e15416a6400b4aa4ef8c9548cb2c` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/npc-snapshot-pair-negative-cases` | `976e3d3a893b223ff27995f98799f95cc497d8fa` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/process-knowledge-isolation-20261025` | `478566437f5905791ac081989aec4c63871f551d` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/process-knowledge-isolation-243` | `c5b290d1bd8f9f28433fea74a6422a04c35af6d7` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/process-knowledge-isolation-mainline-2026-10-26` | `d6935a6ec6fc97da39c9c7c41fd7546da47674fe` | DUPLICATE_CANDIDATE | — |
| `test/provider-active-read-revocation-race` | `3a447d9194657544b0014dbe6cdedfa141c86606` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/provider-consumer-real-sqlite-2026-10-27` | `06f464e2c49d8727fd91936e33b0424e062d3b51` | OPEN_PR_HEAD | [#504](https://github.com/necromorphic/Logic-Engine/pull/504) |
| `test/provider-core-source-update-reconciliation-2026-10-27` | `e23b2c03e33c84b537b82ac6b7094f02f4a64b95` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/provider-cross-connection-record-retrieval-aba-2026-10-26` | `af88af0e1cd329ff67019331b47d9919d5db51e5` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/provider-exact-version-tombstone-2026-10-26` | `2433fd8500e6d8972bdbcad86d8ba8a7d24c4fcc` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/relationship-pair-level-rollback-contract` | `68a9d34eaa993d2a8e2ed54c0a6ea6ef2b4d0306` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/remote-binding-gate` | `292be3e799662b560c7c02fa3198120b62801a4f` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/sequential-rollback-claim-support` | `cd97ad1d66cf370b1ae2374c8b4f6094da0555a9` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/storage-migration-compatibility` | `b900fc5cb56bc20ce72cbde4f8cef63966e2dd03` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/time-advance-audit-regressions` | `f75fbbeceab43e6bd11cc0db95fa9968d4d355e4` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/time-segment-atomicity-proof` | `9e4759fc4a4c27960835d27c9527f176ce97fb5d` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `test/time-trigger-failure-atomicity-2026-10-24` | `5f6d23c85eb8a9f27d5a4bb80b7a47d605abc890` | SAFETY_OR_TEST_REQUIRES_REVIEW | — |
| `wire-active-mechanic-policy-owner` | `ec74a1cd17fcdb5e3601b37a9e601c259d6f29e2` | WORKSTREAM_UNCLASSIFIED | — |
| `work/audit-memory-snapshot-gate` | `22b85a803e968b28f9016f532aae6494dc3c8cae` | WORKSTREAM_UNCLASSIFIED | — |
| `work/core-accepted-head-read-gate-2026-10-27` | `e30c550e8e97c432ebeae6b40d234e3d44df5ab0` | WORKSTREAM_UNCLASSIFIED | — |
| `work/core-process-manager-boundary` | `42083721bad480ddcc6492227211e8d719d742bf` | WORKSTREAM_UNCLASSIFIED | — |
| `work/host-patch-disposable-check-2026-10-25` | `59a4c56c8433c1c135bcdce4f66dbebdbbe9a0f6` | WORKSTREAM_UNCLASSIFIED | — |
| `work/mechanics-docs-drift-correction-2026-10-25` | `4af64fb68afd60fa99df03a9d7c7fab08641fe9c` | OPEN_PR_HEAD | [#326](https://github.com/necromorphic/Logic-Engine/pull/326) |
| `work/mechanics-oracle-reconciled` | `2453c809905d0dec01144727accf2953d018ace6` | DUPLICATE_CANDIDATE | — |
| `work/process-contract-runtime-slice` | `a6edf6e75ef503dcf6d82760a1c7faef76db2b70` | WORKSTREAM_UNCLASSIFIED | — |
| `work/process-manager-ci-head` | `9b4f4a27cfdce5bbc8067d9abe7089cd8deadae4` | WORKSTREAM_UNCLASSIFIED | — |
| `work/provider-accepted-head-read-gate-2026-10-27` | `badc356ee6110f45afc1c2c6e84041c91dfcc812` | WORKSTREAM_UNCLASSIFIED | — |
| `work/provider-accepted-head-read-gate-retest-2026-10-27` | `af895f86b2989da794833c391d7d276d891cf990` | DUPLICATE_CANDIDATE | — |
| `work/provider-accepted-head-read-gate-windows-2026-10-27` | `6d2a7cb60f6bc568e2d2d4f1e58c0839ee75e6bc` | WORKSTREAM_UNCLASSIFIED | — |
| `work/provider-accepted-head-read-gate-windows-retest-2026-10-27` | `6d2a7cb60f6bc568e2d2d4f1e58c0839ee75e6bc` | DUPLICATE_CANDIDATE | — |
| `work/provider-focused-validation-2026-10-25` | `95ce0c559c3f39ee920082c90da521f6ec73ea89` | WORKSTREAM_UNCLASSIFIED | — |
| `work/provider-focused-validation-review-2026-10-25` | `9f55264881b10982a4fc1812a8273e4af457ff24` | WORKSTREAM_UNCLASSIFIED | — |
| `work/provider-read-gate-exact-head-2026-10-27` | `5ea35776092d207a7c60dc6311d9872bff57c5f9` | WORKSTREAM_UNCLASSIFIED | — |
| `work/recalculation-oracle-integration` | `cea76df9a037f3e334688838aa39ec72dbf859a5` | WORKSTREAM_UNCLASSIFIED | — |
| `work/sillytavern-diagnostic-extension` | `c494830d85fea7201053ff08da598316e5747937` | OPEN_PR_HEAD | [#492](https://github.com/necromorphic/Logic-Engine/pull/492) |

## Issue disposition — current open state

Direct GitHub REST API check on 2026-10-28 found **15 open Issues** (excluding pull requests). Earlier search output included closed/historical items and must not be treated as the current open list.

### Keep as portfolio / integration controls
| Issue | Purpose | Recommendation |
|---|---|---|
| [#252](https://github.com/necromorphic/Logic-Engine/issues/252) | Portfolio priorities, owners, dependencies, blockers, release gates | Canonical portfolio tracker |
| [#251](https://github.com/necromorphic/Logic-Engine/issues/251) | Cross-block integration register and owner handoffs | Canonical integration register |
| [#264](https://github.com/necromorphic/Logic-Engine/issues/264) | Host → Provider evidence and production-readiness blockers | Keep as global readiness gate; link evidence, avoid duplicate status docs |

### Keep as active workstream Issues
| Issue | Workstream | Recommendation |
|---|---|---|
| [#519](https://github.com/necromorphic/Logic-Engine/issues/519) | Local Windows / SillyTavern lifecycle / SQLite EBUSY | Keep until local follow-up is resolved |
| [#472](https://github.com/necromorphic/Logic-Engine/issues/472) | World-scoped event identity | Keep as distinct Core defect |
| [#356](https://github.com/necromorphic/Logic-Engine/issues/356) | Security/Product in-flight revocation decision | Keep as policy gate |
| [#351](https://github.com/necromorphic/Logic-Engine/issues/351) | Spatial/Temporal feasibility | Keep separate, bounded research scope |
| [#317](https://github.com/necromorphic/Logic-Engine/issues/317) | NPC stop-blockers and module completion | Keep; align acceptance criteria with #149 without merging ownership |
| [#262](https://github.com/necromorphic/Logic-Engine/issues/262) | Core evaluation/recalculation/publication boundary | Keep as Core contract work |
| [#260](https://github.com/necromorphic/Logic-Engine/issues/260) | Communicative-intent interpretation | Keep as distinct Core contract |
| [#258](https://github.com/necromorphic/Logic-Engine/issues/258) | Pinned SillyTavern Host/Adapter lifecycle | Keep; link local evidence from #519 and readiness blockers in #264 |
| [#226](https://github.com/necromorphic/Logic-Engine/issues/226) | Mechanics executor and recalculation seam | Keep as separate mechanics workstream |
| [#181](https://github.com/necromorphic/Logic-Engine/issues/181) | Memory Provider/adapter vertical slice | Keep; subordinate readiness evidence to #264 |
| [#149](https://github.com/necromorphic/Logic-Engine/issues/149) | NPC 1.4 / Memory handoff | Keep; cross-link #317, preserve NPC-owned deliverables |
| [#146](https://github.com/necromorphic/Logic-Engine/issues/146) | Historical Relationship rule-version pins | Keep as a distinct replay/migration gate |

### Related issues no longer open

[#70](https://github.com/necromorphic/Logic-Engine/issues/70), [#73](https://github.com/necromorphic/Logic-Engine/issues/73), [#140](https://github.com/necromorphic/Logic-Engine/issues/140), and [#143](https://github.com/necromorphic/Logic-Engine/issues/143) appeared in the earlier search-derived list but are not in the current REST response for open issues. Treat them as historical/closed references unless their actual state is rechecked; do not list them as active open Issues.

**Issue cleanup decision:** the 15 currently open Issues are not obvious duplicates. Consolidate status reporting into #252/#251/#264 and improve cross-links, but do not close any active Issue merely to reduce the count.

## Known PR consolidation groups

1. **Core source-version stack:** #509 → #521 → #504. Keep dependencies explicit; do not merge #490 unchanged or treat #488 as canonical authority.
2. **Host inventory:** #507 → #510. Preserve enrollment-forward inventory and reconciliation gaps; do not call this complete historical inventory.
3. **Provider dispatch/revocation:** #480, #483–#486, #498–#500, #505, #508. Do not batch-merge. Final serialized request body ↔ authorized candidate/version binding and sole outbound path remain gates.
4. **Rule hardening:** compare #514, #515, #517, #522 for overlap; preserve unique #517 condition-dependency tests. Keep #516 separate because it modifies the mechanic-effect translator.
5. **SillyTavern UI:** compare #492 and #501; do not overwrite local user changes on the overlapping engine files.
6. **Windows deployment:** review #451, #468, #469, #471 together. Do not apply ACL scripts/services without explicit approval and target-path validation.
7. **Coordinator:** validate #273 locally before treating it as operational; keep #506 from bypassing human/Core/security gates.

## Immediate execution order

1. Review the open PR table and mark canonical PR per workstream.
2. Compare duplicate candidate groups with main and sibling branches; document unique commits and tests.
3. For every merged/superseded candidate, verify no open PR uses it as a base.
4. Only then delete confirmed redundant branches in small batches.
5. Consolidate issue links/acceptance criteria; close only after requirements are migrated.
6. Keep Memory → NPC DISABLED / FAIL-CLOSED until transport-level zero-egress, final-body binding, revocation ordering, and Core/Product/Security gates are proven.



## PR lifecycle reconciliation — API cross-check

This section reconciles branch heads with closed PR metadata fetched from GitHub on 2026-10-28.

- Closed PRs examined: **406** — **204 merged**, **202 closed without merge**.
- Matched branch refs to one or more merged PR heads: **198**.
- Matched branch refs to closed-unmerged PR heads: **188**.
- The status below is a cleanup triage, not a deletion command. Merged PRs can use squash/rebase merges; closed PR branches can contain unique commits. Verify ancestry/diff and dependencies before deleting.
- Some open PRs share the same head branch. This is actionable PR duplication even if branch deletion is not yet safe.

### Open PRs sharing one head branch

- No duplicate open heads parsed.

### Branch lifecycle status for all 512 branches
Current lifecycle classification uses the latest open-PR API response. Open PR heads and base branches are protected from cleanup.


| Branch | Head SHA | Status | Related merged PRs | Related closed-unmerged PRs | Notes |
|---|---|---|---|---|---|
| `audit/api-capability-matrix-194` | `69a8283765cf894a08cf7efe7d2e5aeaef47c528` | CLOSED_UNMERGED_REVIEW | — | #255 | Closed without merge: #255; inspect unique commits/tests and whether another open PR depends on it |
| `audit/regression-tests-2026-10-24` | `1f630bc8f045969442e5f77f7524f3305d1f636f` | CLOSED_UNMERGED_REVIEW | — | #188 | Closed without merge: #188; inspect unique commits/tests and whether another open PR depends on it |
| `chore/coordinator-event-bridge` | `ddb110b9b96aa496209bccddc48c19fe252ba7bf` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #272 |
| `chore/self-hosted-windows-runner` | `db4a1ff39b067497623a191127e53ddaf8a01d8a` | MERGED_PR_BRANCH_REVIEW | #394 | — | Merged PR(s): #394; verify ancestry and open-PR base references before deletion |
| `ci/harden-runtime-workflow-smoke-test` | `5a8c429477c81b844f9673f959a403deaa4a3a7e` | MERGED_PR_BRANCH_REVIEW | #202 | — | Merged PR(s): #202; verify ancestry and open-PR base references before deletion |
| `ci/host-adapter-pinned-source-audit-2026-10-26` | `893a9135228a8aec2f3cf6b721557a6bf7a51ec7` | CLOSED_UNMERGED_REVIEW | — | #358 | Closed without merge: #358; inspect unique commits/tests and whether another open PR depends on it |
| `ci/windows-cmd-shell-replay-benchmark` | `c1eb880772dde326ebcea2f3b4bb355b75a44020` | MERGED_PR_BRANCH_REVIEW | #400 | — | Merged PR(s): #400; verify ancestry and open-PR base references before deletion |
| `contract/memory-core-npc-boundary` | `337c3e83fffb496855b6fe8c0864af701db09512` | CLOSED_UNMERGED_REVIEW | — | #256 | Closed without merge: #256; inspect unique commits/tests and whether another open PR depends on it |
| `coord/bounded-mechanic-executor-2026-10-25` | `be455beb449e2309b341f62bbc476e315f5ba1c7` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `coord/bounded-mechanic-executor-current-main-2026-10-25` | `80a2b8c3b3fe6b671a891bdee76fd56fab8eb37b` | MERGED_PR_BRANCH_REVIEW | #298 | — | Merged PR(s): #298; verify ancestry and open-PR base references before deletion |
| `coord/core-conversation-bound-scope` | `59151c9591324a81028b7e172d06acf7779289e6` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #491 |
| `coord/core-source-version-authority` | `1c21de2057b5881b64c9fe15ea5d6b45ec6708fd` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #490 |
| `coord/core-source-version-consolidated` | `cc6eae970c0f5ab5270c1429ff3b99eb7d9a6439` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #521 |
| `coord/dispatch-order-cross-process-proof-2026-10-26` | `d88721fe335547e6a6e167618cccf3bce8855bf1` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #377 |
| `coord/e2e-host-provider-core-npc-fail-closed-2026-10-27` | `8ea2608c86c22b79a29faad981d351e7a133a620` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #467 |
| `coord/fact-identity-doc-current-main-2026-10-25` | `a9da86e845531cc69136832bb95b51758485a7a3` | CLOSED_UNMERGED_REVIEW | — | #296 | Closed without merge: #296; inspect unique commits/tests and whether another open PR depends on it |
| `coord/fact-identity-doc-latest-main-2026-10-25` | `3eb9fefdbc74879a688352f50c4bc8bacd339790` | MERGED_PR_BRANCH_REVIEW | #305 | — | Merged PR(s): #305; verify ancestry and open-PR base references before deletion |
| `coord/gateway-host-owned-transport-only` | `34097ef27d9d6963b40fc0f22dc07f3f985284f7` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #500 |
| `coord/host-evidence-final-main-2026-10-25` | `f02a1a7fc76e0b9b4fb6df82d357ae01668d804b` | CLOSED_UNMERGED_REVIEW | — | #307 | Closed without merge: #307; inspect unique commits/tests and whether another open PR depends on it |
| `coord/host-evidence-latest-main-2026-10-25` | `87d772da7cbec0b566451a5eb7d43c47dd7d199b` | CLOSED_UNMERGED_REVIEW | — | #304 | Closed without merge: #304; inspect unique commits/tests and whether another open PR depends on it |
| `coord/host-evidence-rebased-2026-10-25` | `7ab6a9b389036d7bf5cd977946e93300ed9acf9e` | CLOSED_UNMERGED_REVIEW | — | #306 | Closed without merge: #306; inspect unique commits/tests and whether another open PR depends on it |
| `coord/host-inventory-reconciliation-entrypoint-2026-10-28` | `4f7dfdc41fb6e8fdafd2745dc67dd008be2af78a` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #524 |
| `coord/host-lifecycle-evidence-current-main-2026-10-25` | `49f926bff673ab240568eab9e6e72df20b7db5f3` | MERGED_PR_BRANCH_REVIEW | #295 | — | Merged PR(s): #295; verify ancestry and open-PR base references before deletion |
| `coord/host-lifecycle-evidence-main-1ecbaea` | `197f52ad780ff86c61bdbb9f6b8b50547f697f16` | CLOSED_UNMERGED_REVIEW | — | #310 | Closed without merge: #310; inspect unique commits/tests and whether another open PR depends on it |
| `coord/host-startup-migration-guard-2026-10-28` | `9f104694376b61996cc6e3d2dd32068b4f13ce33` | MERGED_PR_BRANCH_REVIEW | #526 | — | Merged PR(s): #526; verify ancestry and open-PR base references before deletion |
| `coord/memory-raw-archive-2026-10-25` | `6bbef8604254052d9ecc9150e75547a36dd89334` | CLOSED_UNMERGED_REVIEW | — | #291 | Closed without merge: #291; inspect unique commits/tests and whether another open PR depends on it |
| `coord/memory-raw-archive-current-main-2026-10-25` | `f67425015ca9593c02f325bd53981a161e894d91` | MERGED_PR_BRANCH_REVIEW | #292 | — | Merged PR(s): #292; verify ancestry and open-PR base references before deletion |
| `coord/npc-admission-regression-coverage-2026-10-25` | `1ecbaea0ffe3604374226c8347a1f70da6ca8337` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `coord/npc-authz-regression-tests-2026-10-25` | `182e79bb696b4de4f3edc9dd60d4e0b1a1d962c6` | MERGED_PR_BRANCH_REVIEW | #290 | — | Merged PR(s): #290; verify ancestry and open-PR base references before deletion |
| `coord/npc-traceability-current-main-2026-10-25` | `4d6be1f4e40424fe21f6f607be73efb3f3101345` | CLOSED_UNMERGED_REVIEW | — | #294 | Closed without merge: #294; inspect unique commits/tests and whether another open PR depends on it |
| `coord/npc-traceability-latest-main-2026-10-25` | `7bc3e3bde854c72465931b8388165aa08cdc9629` | MERGED_PR_BRANCH_REVIEW | #303 | — | Merged PR(s): #303; verify ancestry and open-PR base references before deletion |
| `coord/port-regression-evidence-2026-10-25` | `e2f96ff50c4c22a13b755772809b7730d93b92f8` | MERGED_PR_BRANCH_REVIEW | #299 | — | Merged PR(s): #299; verify ancestry and open-PR base references before deletion |
| `coord/portfolio-doc-refresh-current-main-2026-10-27` | `22ba87567d9957a18fbbb2ea5a2703984f5a2280` | CLOSED_UNMERGED_REVIEW | — | #462 | Closed without merge: #462; inspect unique commits/tests and whether another open PR depends on it |
| `coord/provider-docs-current-main-2026-10-25` | `159f71cc3f3458a88208b73c4381a5f1b5b9fb08` | MERGED_PR_BRANCH_REVIEW | #314 | — | Merged PR(s): #314; verify ancestry and open-PR base references before deletion |
| `coord/provider-docs-final-status-fix-2026-10-25` | `14a82ff39aa938e73610bf3f0b47a120f06311f9` | MERGED_PR_BRANCH_REVIEW | #315 | — | Merged PR(s): #315; verify ancestry and open-PR base references before deletion |
| `coord/provider-lifecycle-201-current-main-2026-10-25` | `7997f2f00586b7e55b2cce807a8b5e2810a987af` | MERGED_PR_BRANCH_REVIEW | #313 | — | Merged PR(s): #313; verify ancestry and open-PR base references before deletion |
| `coord/provider-lifecycle-201-reconciled-2026-10-25` | `caa14a607278b8dfe6991c00e2fcf22594dfc45a` | CLOSED_UNMERGED_REVIEW | — | #308 | Closed without merge: #308; inspect unique commits/tests and whether another open PR depends on it |
| `coord/provider-raw-archive-recheck-2026-10-25` | `1535c0448604ce9a8cbe7ac8f6f8229b1e909b6b` | CLOSED_UNMERGED_REVIEW | — | #302 | Closed without merge: #302; inspect unique commits/tests and whether another open PR depends on it |
| `coord/provider-read-authority-gate` | `a44d2eca41c6e3724caba2d6c55587d66d115919` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #499 |
| `coord/provider-revocation-lineage-tests-2026-10-25` | `915ca3449ba2022e1943b407d86e9fbf7a1acfa5` | CLOSED_UNMERGED_REVIEW | — | #311 | Closed without merge: #311; inspect unique commits/tests and whether another open PR depends on it |
| `coord/provider-trusted-dispatch-read` | `d026a6f549da035d709446826f8920e27fd67257` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #498 |
| `coord/provider-typed-failures-ci-2026-10-25` | `acf8b292b78d1ee3fa9959fb060066e41c22cbb8` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `coord/reconcile-242-main-2026-10-25` | `31d09ba21795a5f8d985d397a02cb2c07ac930fc` | MERGED_PR_BRANCH_REVIEW | #278 | — | Merged PR(s): #278; verify ancestry and open-PR base references before deletion |
| `coord/reconcile-246-main-2026-10-25` | `30e54290602e9b59eddb83e4b766a78961fd1197` | MERGED_PR_BRANCH_REVIEW | #279 | — | Merged PR(s): #279; verify ancestry and open-PR base references before deletion |
| `coord/reconcile-248-main-2026-10-25` | `9ac2f58e7f0e7ec59a8fd35568bb5f42751e9772` | MERGED_PR_BRANCH_REVIEW | #281 | — | Merged PR(s): #281; verify ancestry and open-PR base references before deletion |
| `coord/reconcile-274-main-2026-10-25` | `ac616e96e529fb97af9b6afef6700abcac513af6` | CLOSED_UNMERGED_REVIEW | — | #283 | Closed without merge: #283; inspect unique commits/tests and whether another open PR depends on it |
| `coord/reconcile-283-current-main-2026-10-25` | `9df282202f9cf36bd108a1ac209bc606579227b3` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `coord/stage2-memory-context-api` | `19d2290d1cead6a7f4091584b8d2749cb7e1915a` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `coord/stage2-prompt-binding` | `1089eaaf10c63b3a5378e8eccd46f802ef5d2168` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #487 |
| `coord/stage2-source-version-binding` | `19d2290d1cead6a7f4091584b8d2749cb7e1915a` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #488 |
| `coordinator/portfolio-doc-status-2026-10-26` | `c19a64aa06c492d93abf1211ce37ba7387045842` | MERGED_PR_BRANCH_REVIEW | #376 | — | Merged PR(s): #376; verify ancestry and open-PR base references before deletion |
| `core/140-release-boundary-proposal-2026-10-25` | `ee08d7779310a9a60764a963291932306d48ab4c` | CLOSED_UNMERGED_REVIEW | — | #346 | Closed without merge: #346; inspect unique commits/tests and whether another open PR depends on it |
| `core/243-checkpoint-recovery-decision-record` | `7b1f4026f96c8873ebe94eb3941e8ed220146986` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #341 |
| `core/243-successful-commit-response-loss-replay` | `adc1f947f4c6e343e3801579fd2b027f6816846a` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #340 |
| `core/260-communicative-intent-contract` | `a0c22703dcff7433d42c87a7f76e4bf7e7b3163b` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #339 |
| `core/api-capability-matrix-proposal` | `a91acd1b8d65e8b77105d21f0ea4a319f05558c2` | MERGED_PR_BRANCH_REVIEW | #115 | — | Merged PR(s): #115; verify ancestry and open-PR base references before deletion |
| `core/atomic-bound-host-capture` | `4f7aac6c9671b0b23cc1aae812ca95786a7b93ab` | MERGED_PR_BRANCH_REVIEW | #407 | — | Merged PR(s): #407; verify ancestry and open-PR base references before deletion |
| `core/atomic-state-snapshot` | `0db54a2e2c2385da06775f6174b457ae9050700d` | CLOSED_UNMERGED_REVIEW | — | #111 | Closed without merge: #111; inspect unique commits/tests and whether another open PR depends on it |
| `core/atomic-state-snapshot-v2` | `c3faef9b61ec09d5ed16a79ac0de2f836d8d016d` | CLOSED_UNMERGED_REVIEW | — | #112 | Closed without merge: #112; inspect unique commits/tests and whether another open PR depends on it |
| `core/atomic-state-snapshot-v3` | `144460cc4e081f129cdff4a914c5d3e69bc3f329` | MERGED_PR_BRANCH_REVIEW | #114 | — | Merged PR(s): #114; verify ancestry and open-PR base references before deletion |
| `core/audit-independent-sqlite-writer-bypass` | `bb05588d17583f7463ba7aae70e23483cf5a8d10` | CLOSED_UNMERGED_REVIEW | — | #385 | Closed without merge: #385; inspect unique commits/tests and whether another open PR depends on it |
| `core/audit-independent-sqlite-writer-bypass-clean` | `353e1634547d870a43d5af8f5c5c60b5e8ce7dd5` | CLOSED_UNMERGED_REVIEW | — | #386 | Closed without merge: #386; inspect unique commits/tests and whether another open PR depends on it |
| `core/authorized-read-api-boundary-tests` | `2961d53f1852a14f9b4ecdc1718f87f3d61e07b0` | CLOSED_UNMERGED_REVIEW | — | #167 | Closed without merge: #167; inspect unique commits/tests and whether another open PR depends on it |
| `core/authorized-read-boundary-contract` | `ece1986bd793701751cfd2bec24927083349976c` | CLOSED_UNMERGED_REVIEW | — | #64 | Closed without merge: #64; inspect unique commits/tests and whether another open PR depends on it |
| `core/authorized-read-default-deny-test` | `585e6288e5c491ad42547766c9749515258a0ba8` | MERGED_PR_BRANCH_REVIEW | #102 | — | Merged PR(s): #102; verify ancestry and open-PR base references before deletion |
| `core/authorized-read-policy-hook` | `4eda3de05b18cf48c6bd642b75546a91ad9d16bc` | MERGED_PR_BRANCH_REVIEW | #101 | — | Merged PR(s): #101; verify ancestry and open-PR base references before deletion |
| `core/authorized-read-rollback-race-regression` | `460587bc3538c8704055f1f2e781d8722874909e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #330 |
| `core/authorized-read-service-prototype` | `2bc7b00c55074a14f7b7200ecae85cbae5f19162` | MERGED_PR_BRANCH_REVIEW | #65 | — | Merged PR(s): #65; verify ancestry and open-PR base references before deletion |
| `core/canonical-entity-source-version-validator-2026-10-27` | `fe522f259c4f44c89a1f6a9deb161c94b7d7ff61` | MERGED_PR_BRANCH_REVIEW | #422 | — | Merged PR(s): #422; verify ancestry and open-PR base references before deletion |
| `core/capability-matrix-current-runtime` | `99c6d488ff81c80ba7466c94ce7ba345b86ac9a9` | MERGED_PR_BRANCH_REVIEW | #128 | — | Merged PR(s): #128; verify ancestry and open-PR base references before deletion |
| `core/characterize-coordinated-restore-memory` | `f5c3a87c7f53febce605a4a121607ce5c69f84c1` | CLOSED_UNMERGED_REVIEW | — | #388 | Closed without merge: #388; inspect unique commits/tests and whether another open PR depends on it |
| `core/characterize-host-binding-rollback` | `5f8558d4c3a009e14518533b4f09f58982a409e7` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #450 |
| `core/context-manifest-current-disposition` | `ba40888063d97d9f493973dc9c20226e639577e4` | MERGED_PR_BRANCH_REVIEW | #121 | — | Merged PR(s): #121; verify ancestry and open-PR base references before deletion |
| `core/context-manifest-generation-mismatch-test` | `18df7e96d618c2f016a35d0b05c5d3845d636313` | MERGED_PR_BRANCH_REVIEW | #131 | — | Merged PR(s): #131; verify ancestry and open-PR base references before deletion |
| `core/context-manifest-registration-gate` | `407e523afebf96c85ffa4e156dedb32f4710adcd` | MERGED_PR_BRANCH_REVIEW | #106 | — | Merged PR(s): #106; verify ancestry and open-PR base references before deletion |
| `core/contextual-interpretation-contract` | `936fb30e11671e98c3dcedb2ce8d698a04483acf` | MERGED_PR_BRANCH_REVIEW | #261 | — | Merged PR(s): #261; verify ancestry and open-PR base references before deletion |
| `core/coordinator-lock-participant-prototype` | `c461864b5f8983c9b50673cfb3bfcedf840d4481` | CLOSED_UNMERGED_REVIEW | — | #380 | Closed without merge: #380; inspect unique commits/tests and whether another open PR depends on it |
| `core/correct-trust-contract-status-wording` | `9394a99db07218bfcd1ea31c584ad92be7387707` | MERGED_PR_BRANCH_REVIEW | #132 | — | Merged PR(s): #132; verify ancestry and open-PR base references before deletion |
| `core/cross-boundary-authorization-regression` | `64504a93c17f776cb8404a4d6c9c8a8a3650622a` | MERGED_PR_BRANCH_REVIEW | #119 | — | Merged PR(s): #119; verify ancestry and open-PR base references before deletion |
| `core/decision-dispatch-authority-140` | `acd89b21c8a77580c970dea0f71f57a0037fa3c1` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #379 |
| `core/decision-host-conversation-world-binding` | `04662985a34eee0f985b9f24586f121faef8e83f` | CLOSED_UNMERGED_REVIEW | — | #393 | Closed without merge: #393; inspect unique commits/tests and whether another open PR depends on it |
| `core/evaluation-recalculation-boundary` | `08341fe90e5f1e480a6547393ccf27a7e6ee8df9` | MERGED_PR_BRANCH_REVIEW | #263 | — | Merged PR(s): #263; verify ancestry and open-PR base references before deletion |
| `core/finalize-disclosure-dispatch-contract-2026-10-26` | `5493826f3a0bbafbf99f6addeb0ac02478609c9e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #371 |
| `core/first-slice-replay-boundary` | `3d68db4824f99deb76735d47377219ac55915583` | MERGED_PR_BRANCH_REVIEW | #61 | — | Merged PR(s): #61; verify ancestry and open-PR base references before deletion |
| `core/fix-coordinator-db-alias-2026-10-27` | `fed4d2390b9dfffc6c7e9b9a1cf4f51ceee25456` | MERGED_PR_BRANCH_REVIEW | #415 | — | Merged PR(s): #415; verify ancestry and open-PR base references before deletion |
| `core/fix-rollback-entity-projection` | `54bdcc59d66a110be1f9c77c43efee22cda33c74` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #355 |
| `core/host-conversation-world-binding-implementation` | `4556344fb6a4abd6f667672434d9547655bd7fe9` | CLOSED_UNMERGED_REVIEW | — | #395 | Closed without merge: #395; inspect unique commits/tests and whether another open PR depends on it |
| `core/host-conversation-world-binding-mainline` | `05cc1795f5adc1e21b90fa7c23a4c6b1c56527e8` | MERGED_PR_BRANCH_REVIEW | #397 | — | Merged PR(s): #397; verify ancestry and open-PR base references before deletion |
| `core/host-ledger-ingress-current-main` | `252ca7fd8d1fe192cc99831bff5965c45b12ea82` | MERGED_PR_BRANCH_REVIEW | #405 | — | Merged PR(s): #405; verify ancestry and open-PR base references before deletion |
| `core/http-audit-current-disposition` | `ecef04dbe9b53425ee9669a763b0993bb4737a9f` | MERGED_PR_BRANCH_REVIEW | #118 | — | Merged PR(s): #118; verify ancestry and open-PR base references before deletion |
| `core/issue-146-evaluator-contract-proposal` | `a5f52076cda97b6a57d6f374e84fb401cffd296d` | MERGED_PR_BRANCH_REVIEW | #153 | — | Merged PR(s): #153; verify ancestry and open-PR base references before deletion |
| `core/issue-146-historical-relationship-pin-rebuild-test` | `f493f719fddcec2f1a085d7d6a22781f75a5106c` | MERGED_PR_BRANCH_REVIEW | #148 | — | Merged PR(s): #148; verify ancestry and open-PR base references before deletion |
| `core/knowledge-acquisition-contract-proposal` | `ed1c3bfd4d583143ff31d536205e782519f4dfc8` | CLOSED_UNMERGED_REVIEW | — | #348 | Closed without merge: #348; inspect unique commits/tests and whether another open PR depends on it |
| `core/matrix-concurrent-snapshot-evidence` | `0912b45dbde9d51b751779cf9704765720d60f27` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `core/matrix-snapshot-evidence-v2` | `2e04d8cfaf9ccec425e7fb2bd755191b21a343e6` | MERGED_PR_BRANCH_REVIEW | #122 | — | Merged PR(s): #122; verify ancestry and open-PR base references before deletion |
| `core/memory-npc-contract-reconciliation-current` | `7da8cff0dfa5feacbe86aa44a41925cfa22fcdd2` | MERGED_PR_BRANCH_REVIEW | #97 | — | Merged PR(s): #97; verify ancestry and open-PR base references before deletion |
| `core/memory-npc-race-gates-20261025` | `8b343af528e6078e568e29c2c1092e47e90b5877` | MERGED_PR_BRANCH_REVIEW | #300 | — | Merged PR(s): #300; verify ancestry and open-PR base references before deletion |
| `core/no-accessor-rule-context-reads-2026-10-27` | `94637f12899ab9f988d91e70753b19afa7640d10` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #515 |
| `core/npc-authorized-read-fields` | `3401b6939c2aab0d9b0a19dd73c60ebe3e06a56e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #466 |
| `core/npc-contract-docs-current` | `f572a242ef1d1b949c1dc038e26ee7fbc6aeb20e` | MERGED_PR_BRANCH_REVIEW | #98 | — | Merged PR(s): #98; verify ancestry and open-PR base references before deletion |
| `core/operation-1-6-current-main-refresh` | `328c653c8f7fbe0ae7f1add9fcfc61712eb4e445` | CLOSED_UNMERGED_REVIEW | — | #133 | Closed without merge: #133; inspect unique commits/tests and whether another open PR depends on it |
| `core/operation-1-6-current-main-refresh-v2` | `c52c631636c8c4558c4e7dd0645974ca43e3a7d9` | MERGED_PR_BRANCH_REVIEW | #154 | — | Merged PR(s): #154; verify ancestry and open-PR base references before deletion |
| `core/process-checkpoint-failure-replay-2026-10-25` | `6db9d8593358a94aa4e5d61dcef19bd13e69d50d` | CLOSED_UNMERGED_REVIEW | — | #333 | Closed without merge: #333; inspect unique commits/tests and whether another open PR depends on it |
| `core/proposal-commit-owner-boundary` | `8d0ab66d47ae82a1260d2bdb43ab8862e9847e47` | MERGED_PR_BRANCH_REVIEW | #103 | — | Merged PR(s): #103; verify ancestry and open-PR base references before deletion |
| `core/proposal-serialized-disclosure-dispatch` | `0cce0867241e641e0940eb5e1708e17876a4ebdb` | CLOSED_UNMERGED_REVIEW | — | #357 | Closed without merge: #357; inspect unique commits/tests and whether another open PR depends on it |
| `core/proposal-stale-commit-regression` | `4c0a9602f1560a34c430b680bbdad3c373bbf641` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #328 |
| `core/propose-db-single-writer-boundary` | `a01c4b4ddb8bfde03fbe15a2cb9fc0eb45aa1c47` | CLOSED_UNMERGED_REVIEW | — | #387 | Closed without merge: #387; inspect unique commits/tests and whether another open PR depends on it |
| `core/recalc-oracle-unknown-change-guard` | `83249324bc74d39982ba9b4aac46d2e43dcc680a` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #525 |
| `core/recovery-proposal-rollback-reopen` | `4f6976e4173e55360d1f97f1cb0ef097dccf0da3` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #352 |
| `core/refresh-cross-block-matrix-after-132` | `33e5a63ac10d0dbbf65db2a61c01b6a17a561b36` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `core/relationship-authorized-read-proposal` | `c54c174513cf7d2d78e2d25640e637e8370689b0` | MERGED_PR_BRANCH_REVIEW | #123 | — | Merged PR(s): #123; verify ancestry and open-PR base references before deletion |
| `core/relationship-domain-handoff-current-main` | `94bf061e53b370683936c4318b792e8b8e83ad20` | MERGED_PR_BRANCH_REVIEW | #91 | — | Merged PR(s): #91; verify ancestry and open-PR base references before deletion |
| `core/relationship-effect-extension-point-audit` | `10934b3e6e08256dbc9608dc29810b2c1a5c9bbf` | MERGED_PR_BRANCH_REVIEW | #84 | — | Merged PR(s): #84; verify ancestry and open-PR base references before deletion |
| `core/relationship-final-evidence-refresh` | `ecfd4b546727e917e2fb077ce69c4082b047a0d9` | MERGED_PR_BRANCH_REVIEW | #125 | — | Merged PR(s): #125; verify ancestry and open-PR base references before deletion |
| `core/relationship-historical-rule-pin-replay` | `a6ffffbae43b16c26b81f59c04b0a31e5758a961` | CLOSED_UNMERGED_REVIEW | — | #152 | Closed without merge: #152; inspect unique commits/tests and whether another open PR depends on it |
| `core/relationship-http-provenance-tests` | `bb044ed5de0edbc7364b9f1fc1f968f941acd167` | MERGED_PR_BRANCH_REVIEW | #126 | — | Merged PR(s): #126; verify ancestry and open-PR base references before deletion |
| `core/relationship-neutral-unset-clear-test` | `21dde3c21fd323fecc22f7c187e191ec63815a37` | MERGED_PR_BRANCH_REVIEW | #117 | — | Merged PR(s): #117; verify ancestry and open-PR base references before deletion |
| `core/relationship-partial-patch-atomicity-test` | `0208cf2d8d98ca798aaf181d31a91bc768aaf97c` | MERGED_PR_BRANCH_REVIEW | #124 | — | Merged PR(s): #124; verify ancestry and open-PR base references before deletion |
| `core/relationship-provenance-evidence-refresh` | `c3695c8c9d147caa1ef08431ebb2cd3e32009f1d` | MERGED_PR_BRANCH_REVIEW | #127 | — | Merged PR(s): #127; verify ancestry and open-PR base references before deletion |
| `core/relationship-runtime-evidence-refresh` | `0fa1018b9ece89539edd07c24f35df4518bf89d4` | MERGED_PR_BRANCH_REVIEW | #109 | — | Merged PR(s): #109; verify ancestry and open-PR base references before deletion |
| `core/relationship-transition-atomicity-tests` | `6b8c4e6fade8d01d15039e8d278d57e4b2c78aa8` | MERGED_PR_BRANCH_REVIEW | #95 | — | Merged PR(s): #95; verify ancestry and open-PR base references before deletion |
| `core/relationship-transition-fail-closed-support` | `79deb588e1f6321826dc3316085aaab6fdb010b7` | MERGED_PR_BRANCH_REVIEW | #96 | — | Merged PR(s): #96; verify ancestry and open-PR base references before deletion |
| `core/relationship-transition-http-boundary-tests` | `939724a673d4480a9529fee36479a510b8b059c1` | CLOSED_UNMERGED_REVIEW | — | #105 | Closed without merge: #105; inspect unique commits/tests and whether another open PR depends on it |
| `core/relationship-transition-http-boundary-tests-v2` | `bff370b920e32013f17a036eda9450c9eafd1066` | MERGED_PR_BRANCH_REVIEW | #107 | — | Merged PR(s): #107; verify ancestry and open-PR base references before deletion |
| `core/relationship-transition-persistent-replay-test` | `3db9c1484fedf4162023b93acc8920269eff6e10` | MERGED_PR_BRANCH_REVIEW | #108 | — | Merged PR(s): #108; verify ancestry and open-PR base references before deletion |
| `core/require-configured-adapter-binding` | `79c357dc2d94a2ed8c6ba583badc4cd88fb5ee0e` | MERGED_PR_BRANCH_REVIEW | #463 | — | Merged PR(s): #463; verify ancestry and open-PR base references before deletion |
| `core/rollback-admin-boundary-current-main` | `24374d043a23f2927730980e358df27714b5378c` | MERGED_PR_BRANCH_REVIEW | #83 | — | Merged PR(s): #83; verify ancestry and open-PR base references before deletion |
| `core/rollback-read-regressions-current-main-2026-10-26` | `9fc6d7ca107993b97798406376f79252539ddfcc` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #368 |
| `core/rollback-source-version-regression` | `bf35fb8dd13628718dacc11c27654c0929fba0e2` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `core/rule-data-boundaries-2026-10-28` | `a3a164aa07aced56a6ec0557f5bfffeeb8d0d47e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #522 |
| `core/serialized-dispatch-gate-mainline-2026-10-26` | `a55f50ceb047208dc2c1d94f14e036206233d9da` | MERGED_PR_BRANCH_REVIEW | #365 | — | Merged PR(s): #365; verify ancestry and open-PR base references before deletion |
| `core/shared-coordinator-lock-current-main` | `c2e4122738c18dc1a8fb2833bac560fc190a1fa4` | MERGED_PR_BRANCH_REVIEW | #398 | — | Merged PR(s): #398; verify ancestry and open-PR base references before deletion |
| `core/source-trust-conflict-acceptance` | `265a0dc358be7a50269cc23238d53370d5ee17e0` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #465 |
| `core/source-trust-contract-acceptance` | `539682045f719db0a915744419c731abd10646cd` | MERGED_PR_BRANCH_REVIEW | #464 | — | Merged PR(s): #464; verify ancestry and open-PR base references before deletion |
| `core/source-version-semantics-reconciliation` | `c25586c34023ce583dae8deb2026b0fe8615e4f9` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #530 |
| `core/stale-approved-proposal-no-residue-2026-10-25` | `0eb93ffa13a6dc525392c12df2cf7258231ee6ac` | CLOSED_UNMERGED_REVIEW | — | #329 | Closed without merge: #329; inspect unique commits/tests and whether another open PR depends on it |
| `core/state-snapshot-concurrent-writer-test` | `746bc8add9c4b3360500f95b3601ae9966bf2775` | MERGED_PR_BRANCH_REVIEW | #120 | — | Merged PR(s): #120; verify ancestry and open-PR base references before deletion |
| `core/strict-json-effect-inputs-2026-10-27` | `10eee71df7119d973aa3c225ec16fb0081afc208` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #516 |
| `core/strict-json-rule-equality-2026-10-27` | `bf3a9a56522a1d2f823202e7167f7c3d87807a86` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #514 |
| `core/strict-rule-definition-data-2026-10-27` | `dc89a875d3a1fb00b182a92b07353364626820b6` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #517 |
| `core/test-bound-host-capture-ordering` | `4081cc89781db9b5932851cd94e78cc508ce8351` | MERGED_PR_BRANCH_REVIEW | #409 | — | Merged PR(s): #409; verify ancestry and open-PR base references before deletion |
| `core/time-advance-failure-replay-after-restart` | `b1b87c5baece31248db5a4101e447701fd8023cd` | CLOSED_UNMERGED_REVIEW | — | #334 | Closed without merge: #334; inspect unique commits/tests and whether another open PR depends on it |
| `core/time-advance-failure-replay-after-restart-v2` | `f75b42c8bf5a2edb7dbe4e45cbde703ee8d17724` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #335 |
| `core/trust-boundary-docs-current` | `c76cf22e31bf5ae6c69cfcacdcb56dbd184a820c` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `core/trust-boundary-docs-current-v2` | `1c9992ab1f1592dc9cb43b67a33a7b0614a9438a` | MERGED_PR_BRANCH_REVIEW | #104 | — | Merged PR(s): #104; verify ancestry and open-PR base references before deletion |
| `core/trusted-mutation-origin-contract` | `cf7df864e064b8251254b39e2690314e362f9d9a` | CLOSED_UNMERGED_REVIEW | — | #63 | Closed without merge: #63; inspect unique commits/tests and whether another open PR depends on it |
| `core/typed-relationship-transition-runtime` | `1aa59e6d4b7921646ed44727de21ba610eb6da39` | MERGED_PR_BRANCH_REVIEW | #94 | — | Merged PR(s): #94; verify ancestry and open-PR base references before deletion |
| `core/update-dispatch-matrix-rollback-evidence-2026-10-26` | `f58ce7b04f89a2f53c1f64e1ffe5a179b921ac9d` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `docs/audit-runtime-status-2026-10-24` | `91063541870e336b6473cd70d7218ebca175a1e7` | MERGED_PR_BRANCH_REVIEW | #193 | — | Merged PR(s): #193; verify ancestry and open-PR base references before deletion |
| `docs/benchmark-workload-description` | `fc125c23310db46e9476f19f463e9ded3022be48` | MERGED_PR_BRANCH_REVIEW | #215 | — | Merged PR(s): #215; verify ancestry and open-PR base references before deletion |
| `docs/branch-pr-consolidation-2026-10-28` | `493d5e57ecf12017f81ecd2d60c7eae191db1a40` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #523 |
| `docs/card-projection-stage1-spec` | `afd03cbe0ac44eb2c2b945395aa90a07d7110558` | CLOSED_UNMERGED_REVIEW | — | #31 | Closed without merge: #31; inspect unique commits/tests and whether another open PR depends on it |
| `docs/card-snapshot-cursor-followup` | `38afea4f308be4c7958d0d3e289b713fb8b203a7` | CLOSED_UNMERGED_REVIEW | — | #35 | Closed without merge: #35; inspect unique commits/tests and whether another open PR depends on it |
| `docs/causality-semantics-and-character-architecture` | `c499cb27b32c530cba14bf8ad9ab5eda6bffca8d` | MERGED_PR_BRANCH_REVIEW | #6 | — | Merged PR(s): #6; verify ancestry and open-PR base references before deletion |
| `docs/character-card-stage1-clean` | `04e9efb335fc4b4b250e397266cf4ba7915aa3e4` | MERGED_PR_BRANCH_REVIEW | #55 | — | Merged PR(s): #55; verify ancestry and open-PR base references before deletion |
| `docs/character-cards-contract-v1.2.1` | `3e0799ddfe47ab4e0183ce0de423ad520324eb7b` | MERGED_PR_BRANCH_REVIEW | #29 | — | Merged PR(s): #29; verify ancestry and open-PR base references before deletion |
| `docs/coordinator-integration-status-2026-10-26` | `b291a14f7d112019b64ed672db2ad173cbcb181f` | CLOSED_UNMERGED_REVIEW | — | #374 | Closed without merge: #374; inspect unique commits/tests and whether another open PR depends on it |
| `docs/coordinator-integration-status-2026-10-26-current-main` | `b703e1dbebe16607abd17d02e11d22db584b052c` | CLOSED_UNMERGED_REVIEW | — | #375 | Closed without merge: #375; inspect unique commits/tests and whether another open PR depends on it |
| `docs/coordinator-memory-dispatch-protocol` | `c888cec8fc1a0c06b8782f7191a476cf2934976a` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #354 |
| `docs/coordinator-memory-npc-boundaries-2026-10-26` | `2824022eeeade07bfbe60f422bc8e3e90345cbae` | MERGED_PR_BRANCH_REVIEW | #347 | — | Merged PR(s): #347; verify ancestry and open-PR base references before deletion |
| `docs/core-1.5-cross-block-integration-matrix` | `786a69a92a70a0ff76260a7ca6a2fb6ac7c96c5d` | MERGED_PR_BRANCH_REVIEW | #71 | — | Merged PR(s): #71; verify ancestry and open-PR base references before deletion |
| `docs/core-1.7-time-block-start` | `d8429046621ca2314b326ced9645a2db6af80086` | CLOSED_UNMERGED_REVIEW | — | #184 | Closed without merge: #184; inspect unique commits/tests and whether another open PR depends on it |
| `docs/core-140-memory-npc-gates-2026-10-25` | `4792bca83ff4cf94bfd3ba1974ce1fd6d010b0ba` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #345 |
| `docs/core-deployment-policy-authority-226` | `c36584e3d7471b261c0581d5668396df35cf7ecd` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #297 |
| `docs/core-evaluation-recalculation-publication-boundary-2026-10-25` | `c859b6365e163650017c68c01dc8649b0a67a734` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #336 |
| `docs/core-http-service-boundary-audit` | `03706188f044a4821c5957a0f7aa7199df193eb0` | CLOSED_UNMERGED_REVIEW | — | #67 | Closed without merge: #67; inspect unique commits/tests and whether another open PR depends on it |
| `docs/core-npc-knowledge-runtime-plan` | `9bce66a1813fd69b6979223406b077b06981bb76` | MERGED_PR_BRANCH_REVIEW | #53 | — | Merged PR(s): #53; verify ancestry and open-PR base references before deletion |
| `docs/core-stage1.3-mechanics-execution-contract` | `b183407cdb4a0ca2db15f4ef305513c50c5f8778` | MERGED_PR_BRANCH_REVIEW | #30 | — | Merged PR(s): #30; verify ancestry and open-PR base references before deletion |
| `docs/current-main-storage-worldpack-status-2026-10-26` | `8e18cf26d644be9d816a441539abca5bf334b0d9` | MERGED_PR_BRANCH_REVIEW | #373 | — | Merged PR(s): #373; verify ancestry and open-PR base references before deletion |
| `docs/event-type-open-taxonomy-contract` | `df3275e478d72a1e4863b8405492ec28a76a1b87` | MERGED_PR_BRANCH_REVIEW | #216 | — | Merged PR(s): #216; verify ancestry and open-PR base references before deletion |
| `docs/fact-set-identity-semantics` | `41a7917de1ff6861ae11d51dfc0ff67a78afadbf` | CLOSED_UNMERGED_REVIEW | — | #41 | Closed without merge: #41; inspect unique commits/tests and whether another open PR depends on it |
| `docs/host-adapter-st-lifecycle-evidence` | `00cbf17497765b6e2058482f3b22b0517e5f36db` | CLOSED_UNMERGED_REVIEW | — | #259 | Closed without merge: #259; inspect unique commits/tests and whether another open PR depends on it |
| `docs/host-log-redaction-evidence-2026-10-27` | `957f2c0deb282ca2f6e3a10e7fb3946725de7fd5` | MERGED_PR_BRANCH_REVIEW | #442 | — | Merged PR(s): #442; verify ancestry and open-PR base references before deletion |
| `docs/issue-73-current-main-test-crosswalk` | `7c9cfeeed244ab1ab26e22040526eca0ae9c0cbb` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #324 |
| `docs/mechanic-effect-support-matrix` | `d3454a5e4223cb16b4b6e2894138d499e6b903f5` | MERGED_PR_BRANCH_REVIEW | #34 | — | Merged PR(s): #34; verify ancestry and open-PR base references before deletion |
| `docs/mechanic-effect-translator-contract` | `fb9cf14cb260bf8916fc014ce1574b1f3c85b94f` | CLOSED_UNMERGED_REVIEW | — | #36 | Closed without merge: #36; inspect unique commits/tests and whether another open PR depends on it |
| `docs/mechanic-intent-proposal-boundary` | `0cf145bab662be59edd036be0657e9c5e1c6c33e` | CLOSED_UNMERGED_REVIEW | — | #39 | Closed without merge: #39; inspect unique commits/tests and whether another open PR depends on it |
| `docs/mechanics-registry-runtime-status` | `749428c71d3754f2df72ba0007181b84e8f0c9da` | MERGED_PR_BRANCH_REVIEW | #17 | — | Merged PR(s): #17; verify ancestry and open-PR base references before deletion |
| `docs/memory-provider-canonical-matrix-181` | `1e9b29c40c607f5f521de60c1b2595cf7b909e9a` | MERGED_PR_BRANCH_REVIEW | #338 | — | Merged PR(s): #338; verify ancestry and open-PR base references before deletion |
| `docs/multiple-independent-supports-contract` | `7f551e4f8ed84a27084fc7e7af51f1631a75eff9` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #50 |
| `docs/npc-admission-evidence-2026-10-24` | `bcb9e1345d17fe0370d005ffc59340c1ba700bfc` | CLOSED_UNMERGED_REVIEW | — | #135 | Closed without merge: #135; inspect unique commits/tests and whether another open PR depends on it |
| `docs/npc-autonomy-story-kt-rules` | `fc58b3b2b4cf75cef0752dd2f2b9a150f2da174e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #353 |
| `docs/npc-contract-suite-clean` | `8e3ee5fb3bedbec7bd412d1eaa3e81a503f51517` | MERGED_PR_BRANCH_REVIEW | #58 | — | Merged PR(s): #58; verify ancestry and open-PR base references before deletion |
| `docs/npc-core-rollback-test-traceability` | `9ae800d6e20bb2eb628c84e31237f5e482d3b854` | CLOSED_UNMERGED_REVIEW | — | #173 | Closed without merge: #173; inspect unique commits/tests and whether another open PR depends on it |
| `docs/npc-lifecycle-evidence-traceability` | `d3a72a0911c63a9906e2ab7efe847a0ac344cda6` | CLOSED_UNMERGED_REVIEW | — | #171 | Closed without merge: #171; inspect unique commits/tests and whether another open PR depends on it |
| `docs/npc-memory-boundary-matrix-2026-10-24` | `c12a3f9b12ef7e2a2f37ee24ec47f77a9f652d48` | CLOSED_UNMERGED_REVIEW | — | #139 | Closed without merge: #139; inspect unique commits/tests and whether another open PR depends on it |
| `docs/performance-budget-baseline` | `dc7d83074e4dd444408c7769b85ce148cb8a4c12` | MERGED_PR_BRANCH_REVIEW | #221 | — | Merged PR(s): #221; verify ancestry and open-PR base references before deletion |
| `docs/personality-issue-73-blocker-owners` | `99f1d56b9b190b2dadd564b2b41ca8a0f829e322` | CLOSED_UNMERGED_REVIEW | — | #141 | Closed without merge: #141; inspect unique commits/tests and whether another open PR depends on it |
| `docs/personality-issue-73-current-main-traceability` | `797a8c424bf13647ee911ca26ba7d7f29bae04cb` | MERGED_PR_BRANCH_REVIEW | #137 | — | Merged PR(s): #137; verify ancestry and open-PR base references before deletion |
| `docs/plain-language-user-guidance` | `edf7e7cfa6d807b4d647d5bb314fa30c60be0e03` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #474 |
| `docs/process-manager-core-boundary-current-main-2026-10-25` | `290f929128fd345c1015294bfcce280186fa8076` | MERGED_PR_BRANCH_REVIEW | #285 | — | Merged PR(s): #285; verify ancestry and open-PR base references before deletion |
| `docs/proposal-commit-boundary` | `2362d7ef82f7150ded3de936bc06cc1c858ef907` | MERGED_PR_BRANCH_REVIEW | #23 | — | Merged PR(s): #23; verify ancestry and open-PR base references before deletion |
| `docs/proposal-commit-boundary-contract` | `9b8ecf7dcbb6f710c9ead3cdd5a90ca04b651a6b` | MERGED_PR_BRANCH_REVIEW | #22 | — | Merged PR(s): #22; verify ancestry and open-PR base references before deletion |
| `docs/readme-progress-update-2026-10-27` | `e712d5d11fccc3dd791c52af8e7f617ee1039d10` | MERGED_PR_BRANCH_REVIEW | #489 | — | Merged PR(s): #489; verify ancestry and open-PR base references before deletion |
| `docs/reconcile-merged-blocks-2026-10-25` | `21c9f86f2d3e5b10caf2dd6ee44f6cbf1eb54394` | MERGED_PR_BRANCH_REVIEW | #288 | — | Merged PR(s): #288; verify ancestry and open-PR base references before deletion |
| `docs/relationships-core-runtime-evidence-refresh` | `eae5cc1fbae911cf737deefee3159228284746d4` | CLOSED_UNMERGED_REVIEW | — | #99 | Closed without merge: #99; inspect unique commits/tests and whether another open PR depends on it |
| `docs/relationships-core-runtime-evidence-refresh-v2` | `f6553cf9d47f55b969fa136db2462542de5f046b` | CLOSED_UNMERGED_REVIEW | — | #100 | Closed without merge: #100; inspect unique commits/tests and whether another open PR depends on it |
| `docs/relationships-current-main-evidence-v2` | `5f5e9a75bce6275feaf073d75514acd0fe0b6e3b` | CLOSED_UNMERGED_REVIEW | — | #113 | Closed without merge: #113; inspect unique commits/tests and whether another open PR depends on it |
| `docs/relationships-current-main-evidence-v3` | `ac49c6b71790be294bf0f369ea214f8bce259f11` | CLOSED_UNMERGED_REVIEW | — | #116 | Closed without merge: #116; inspect unique commits/tests and whether another open PR depends on it |
| `docs/relationships-refresh-after-core-107-108` | `e1d30d8e3a8bbe719abac4a978121c44704c472c` | CLOSED_UNMERGED_REVIEW | — | #110 | Closed without merge: #110; inspect unique commits/tests and whether another open PR depends on it |
| `docs/remove-google-branding` | `4dec965ef9a6eed14684699819d9fd622ea8c290` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #470 |
| `docs/repository-front-page-status` | `8ab0e650a9c2fb033b5c99e6a83108a5bdccd0f1` | CLOSED_UNMERGED_REVIEW | — | #48 | Closed without merge: #48; inspect unique commits/tests and whether another open PR depends on it |
| `docs/security-single-writer-boundary-current-main` | `69af1ad12c21f726843f9c251961ef29811bbfef` | MERGED_PR_BRANCH_REVIEW | #403 | — | Merged PR(s): #403; verify ancestry and open-PR base references before deletion |
| `docs/spatial-position-contract-proposal-2026-10-28` | `19fc2505ce326b2b651c9b39bb529be928f31acd` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #533 |
| `docs/storage-schema-lifecycle-contract` | `bb830aa119280d04655dffdcefac59fcd6720280` | MERGED_PR_BRANCH_REVIEW | #213 | — | Merged PR(s): #213; verify ancestry and open-PR base references before deletion |
| `docs/subject-knowledge-delivery-contract` | `bbb074b6685f85333f2620e7ecf3a0ec11f3efeb` | CLOSED_UNMERGED_REVIEW | — | #44 | Closed without merge: #44; inspect unique commits/tests and whether another open PR depends on it |
| `docs/sync-proposal-boundary-status` | `76d7bd407c7b0db09bf1686f163766a04259eaad` | MERGED_PR_BRANCH_REVIEW | #26 | — | Merged PR(s): #26; verify ancestry and open-PR base references before deletion |
| `docs/time-advance-core-audit` | `ae76b617d68c612eeb0b125b1222d26a633a0ee0` | CLOSED_UNMERGED_REVIEW | — | #206 | Closed without merge: #206; inspect unique commits/tests and whether another open PR depends on it |
| `docs/time-advance-operation-contract` | `cfe8a5cca07da736da7b694a88eda3f51e746d80` | CLOSED_UNMERGED_REVIEW | — | #223 | Closed without merge: #223; inspect unique commits/tests and whether another open PR depends on it |
| `docs/universal-mechanics-system-contract` | `937feedae58aa48a8acc015430bba2af7ff0dfa2` | MERGED_PR_BRANCH_REVIEW | #7 | — | Merged PR(s): #7; verify ancestry and open-PR base references before deletion |
| `feat/accepted-head-authority-store` | `e9010e8330791659e91df92f6ea8fe73552b8dcb` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #480 |
| `feat/admitted-memory-dispatch-evidence-2026-10-27` | `43b2f7ca140da51b3363c0d8c67dd0d5cec1bdcb` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #508 |
| `feat/canonical-fact-identity-guards` | `44318056d98106b4eb59fc6f4f9da21582b26bbf` | CLOSED_UNMERGED_REVIEW | — | #42 | Closed without merge: #42; inspect unique commits/tests and whether another open PR depends on it |
| `feat/canonical-fact-identity-guards-rebased` | `1e08c8dc1d2c4c31462826640e00e12611a9a1bd` | CLOSED_UNMERGED_REVIEW | — | #43 | Closed without merge: #43; inspect unique commits/tests and whether another open PR depends on it |
| `feat/character-card-projection-stage1` | `e8cb8b5fd04af02c104ede6de2dd0abe52c9fbc1` | CLOSED_UNMERGED_REVIEW | — | #32 | Closed without merge: #32; inspect unique commits/tests and whether another open PR depends on it |
| `feat/character-card-projector-clean` | `6957a3497269939013333b3a0630fc70627225c8` | MERGED_PR_BRANCH_REVIEW | #56 | — | Merged PR(s): #56; verify ancestry and open-PR base references before deletion |
| `feat/consistent-internal-snapshot-read` | `09e48c2fd764c8e3f7b1e8f96e485a58ea34c793` | MERGED_PR_BRANCH_REVIEW | #45 | — | Merged PR(s): #45; verify ancestry and open-PR base references before deletion |
| `feat/consumer-dispatch-envelope-2026-10-27` | `92823877aa4d88a72813ad3282f68d48c68a6896` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `feat/core-accepted-head-handshake` | `c413b948586f0b32df0bd40b0d53c2550790b4d2` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #483 |
| `feat/core-mechanic-vertical-slice-226` | `e39e0dfd708453a2090ad1ea1b4f931d36510bc4` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #301 |
| `feat/core-memory-contracts` | `7f18045e9b3848da0c998ffe7877080281654dff` | CLOSED_UNMERGED_REVIEW | — | #68 | Closed without merge: #68; inspect unique commits/tests and whether another open PR depends on it |
| `feat/core-npc-actor-binding` | `29a97f8a1580673cb4d4a1c88ca9b1e40485f9d3` | CLOSED_UNMERGED_REVIEW | — | #54 | Closed without merge: #54; inspect unique commits/tests and whether another open PR depends on it |
| `feat/core-npc-actor-binding-clean` | `7c67a831ed2d411ee832f6ed2d080dbc006df831` | MERGED_PR_BRANCH_REVIEW | #57 | — | Merged PR(s): #57; verify ancestry and open-PR base references before deletion |
| `feat/core-source-version-ledger-2026-10-27` | `6234deecc7740d0417097df0c827789c76c49061` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #509 |
| `feat/dispatch-authority-contract-v1` | `eb338319dc6e06b9b5c904ec76c2545fbeda8ef5` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #479 |
| `feat/durable-time-trigger-lifecycle-2026-10-24` | `776a536c2ccbf76d22ffd2b5bc7c09f502bd3460` | CLOSED_UNMERGED_REVIEW | — | #232 | Closed without merge: #232; inspect unique commits/tests and whether another open PR depends on it |
| `feat/explicit-entity-create-update` | `5e10ca2ea73248f6659202a825cd9ec4995d7501` | MERGED_PR_BRANCH_REVIEW | #19 | — | Merged PR(s): #19; verify ancestry and open-PR base references before deletion |
| `feat/generation-bound-context-manifests` | `9c4a299947e05d2c043dae2397612443c855514a` | MERGED_PR_BRANCH_REVIEW | #12 | — | Merged PR(s): #12; verify ancestry and open-PR base references before deletion |
| `feat/historical-absence-predicates` | `8ad2a02ae2ad2a72749e87ba4a7e8cb1a6bd4756` | MERGED_PR_BRANCH_REVIEW | #13 | — | Merged PR(s): #13; verify ancestry and open-PR base references before deletion |
| `feat/historical-requires-predicates` | `92b765ace822aa9f244c31b4848deba2329bba17` | MERGED_PR_BRANCH_REVIEW | #10 | — | Merged PR(s): #10; verify ancestry and open-PR base references before deletion |
| `feat/local-coordinator-pc` | `58847f8f1992d181cd5bc5edc9ce9a6e0dec3124` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #273 |
| `feat/local-stage-auto-close-2026-10-27` | `edfd7970d0a3272a2c86dcd120616789b0c156a6` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #506 |
| `feat/mechanic-effect-translator` | `96133c286643cdbc5cca3b3e0d6e78e122a67b21` | CLOSED_UNMERGED_REVIEW | — | #37 | Closed without merge: #37; inspect unique commits/tests and whether another open PR depends on it |
| `feat/mechanic-evaluation-snapshot` | `3417a28f8a99663a9834f733bb842558259bc2e4` | CLOSED_UNMERGED_REVIEW | — | #47 | Closed without merge: #47; inspect unique commits/tests and whether another open PR depends on it |
| `feat/mechanic-evaluation-snapshot-mainline` | `825099772776445a55470e88985356aa727c1422` | MERGED_PR_BRANCH_REVIEW | #49 | — | Merged PR(s): #49; verify ancestry and open-PR base references before deletion |
| `feat/mechanic-intent-proposal-integration` | `ac5eba36c8c59af074d83ae4a7829652e2628a88` | CLOSED_UNMERGED_REVIEW | — | #40 | Closed without merge: #40; inspect unique commits/tests and whether another open PR depends on it |
| `feat/mechanics-contracts` | `d273717024673903fb4aba593410692264e9abe0` | MERGED_PR_BRANCH_REVIEW | #15 | — | Merged PR(s): #15; verify ancestry and open-PR base references before deletion |
| `feat/mechanics-registry` | `14aa857f1ae91f8e78cc808cf6b46adc8de35c46` | MERGED_PR_BRANCH_REVIEW | #16 | — | Merged PR(s): #16; verify ancestry and open-PR base references before deletion |
| `feat/memory-core-runtime-audit-issue129` | `439bc3f59af429eb6924551087371af811b8dc2f` | MERGED_PR_BRANCH_REVIEW | #136 | — | Merged PR(s): #136; verify ancestry and open-PR base references before deletion |
| `feat/memory-dispatch-gateway` | `3cc6a1fd09b5e9fdc09294cf823a57b9d249e003` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #486 |
| `feat/memory-npc-authorized-host-seam` | `867c3f4b4c714f96b686943ead83b8b3c69cf467` | CLOSED_UNMERGED_REVIEW | — | #168 | Closed without merge: #168; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-npc-contract-reconciliation` | `7892ac2bc261d9a01ef41d464a201192ed6722ce` | CLOSED_UNMERGED_REVIEW | — | #85 | Closed without merge: #85; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-npc-contract-reconciliation-clean` | `0ae28d3c655afbc7321bf1af0e2a62dcbcd48083` | CLOSED_UNMERGED_REVIEW | — | #88 | Closed without merge: #88; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-npc-contract-reconciliation-final` | `c15b2829173e79037789241d92773b5c291f4b8f` | CLOSED_UNMERGED_REVIEW | — | #90 | Closed without merge: #90; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-npc-host-seam-spike` | `1f10aaaeb89f5fdd1905a7f9cf46bb0a286960b0` | CLOSED_UNMERGED_REVIEW | — | #164 | Closed without merge: #164; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-provider-core-adapter-main` | `74cc225f38a4ecc0da1c2c1f6f767541230b3987` | CLOSED_UNMERGED_REVIEW | — | #343 | Closed without merge: #343; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-provider-internal-import-contract` | `177dfb85bde388fdf568a29a315a85421e95ff80` | CLOSED_UNMERGED_REVIEW | — | #201 | Closed without merge: #201; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-provider-on-core-seam` | `177f15bcc6d7f6d2ac42087fae248ddde8b60812` | CLOSED_UNMERGED_REVIEW | — | #183 | Closed without merge: #183; inspect unique commits/tests and whether another open PR depends on it |
| `feat/memory-provider-sqlite-vertical-slice` | `e6ed0a1322341b44fe6b85833f177cfbf5ef0052` | CLOSED_UNMERGED_REVIEW | — | #182 | Closed without merge: #182; inspect unique commits/tests and whether another open PR depends on it |
| `feat/npc-memory-docs-clean` | `fab3ddf99f0194b63ddf294b35209d53aaf24607` | CLOSED_UNMERGED_REVIEW | — | #86 | Closed without merge: #86; inspect unique commits/tests and whether another open PR depends on it |
| `feat/npc-memory-docs-final` | `75d499b11be9dbee5c1b32cac74afeb0c172a9b0` | CLOSED_UNMERGED_REVIEW | — | #92 | Closed without merge: #92; inspect unique commits/tests and whether another open PR depends on it |
| `feat/npc-subsystem` | `e3e8fc43e2488227b74ded67434aed522c5ec484` | CLOSED_UNMERGED_REVIEW | — | #76, #38 | Closed without merge: #76, #38; inspect unique commits/tests and whether another open PR depends on it |
| `feat/per-world-commit-sequence` | `7dd58d185322edd0b3bb427a3083bb7a2aa73cbf` | MERGED_PR_BRANCH_REVIEW | #9 | — | Merged PR(s): #9; verify ancestry and open-PR base references before deletion |
| `feat/personality-subsystem` | `59095fc85efb5251f451299715acb05ddbfdcb74` | MERGED_PR_BRANCH_REVIEW | #52 | — | Merged PR(s): #52; verify ancestry and open-PR base references before deletion |
| `feat/process-manager-first-slice` | `a5cb4dac8d2064b547dca2e2caebda70a97d21ef` | CLOSED_UNMERGED_REVIEW | — | #245 | Closed without merge: #245; inspect unique commits/tests and whether another open PR depends on it |
| `feat/proposal-commit-api` | `8f7ada1986c20c331f65dafde39c92b3f3e562cd` | MERGED_PR_BRANCH_REVIEW | #24 | — | Merged PR(s): #24; verify ancestry and open-PR base references before deletion |
| `feat/provider-accepted-head-handshake` | `b1cbbe0ad657ca7617ab20a892f9c320a50e4050` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #484 |
| `feat/provider-accepted-head-handshake-ci` | `dd6a9fd87e80c8ff7f99e63ee23377c24ce05aa7` | CLOSED_UNMERGED_REVIEW | — | #497 | Closed without merge: #497; inspect unique commits/tests and whether another open PR depends on it |
| `feat/provider-accepted-head-handshake-v2` | `4acf822f87206dda265d19e150e9a10fc57ef4d7` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `feat/provider-accepted-head-mutation-guard` | `ae375b81c545783e8191e9081db1ba8308037836` | CLOSED_UNMERGED_REVIEW | — | #495 | Closed without merge: #495; inspect unique commits/tests and whether another open PR depends on it |
| `feat/provider-accepted-head-mutation-guard-ci` | `dcb42a48a1029935d55011146de9b5717b085b23` | CLOSED_UNMERGED_REVIEW | — | #496 | Closed without merge: #496; inspect unique commits/tests and whether another open PR depends on it |
| `feat/provider-digest-only-host-ledger` | `ec1147fbf128d4b65a44029f70918500de2f707b` | CLOSED_UNMERGED_REVIEW | — | #389 | Closed without merge: #389; inspect unique commits/tests and whether another open PR depends on it |
| `feat/relationship-domain-module` | `39ede61d1e59c62f62ede3820bbb2b470db8a76d` | CLOSED_UNMERGED_REVIEW | — | #60 | Closed without merge: #60; inspect unique commits/tests and whether another open PR depends on it |
| `feat/relationship-domain-module-main-sync` | `e8615476eb8a86e6ddff7585bd2b410ef089bd67` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `feat/relationship-issue73-traceability-handoff` | `ed5fdebb9f64764949acc29e69c51183c2d9df4f` | CLOSED_UNMERGED_REVIEW | — | #87 | Closed without merge: #87; inspect unique commits/tests and whether another open PR depends on it |
| `feat/relationship-issue73-traceability-handoff-v2` | `25be430aeca22d232c02bccc7772b594ef1c2b1d` | CLOSED_UNMERGED_REVIEW | — | #89 | Closed without merge: #89; inspect unique commits/tests and whether another open PR depends on it |
| `feat/relationship-issue73-traceability-handoff-v3` | `99aeafaff33443ea53b358fb077fdf5026e12da7` | MERGED_PR_BRANCH_REVIEW | #93 | — | Merged PR(s): #93; verify ancestry and open-PR base references before deletion |
| `feat/relationship-pure-evaluator` | `3946e01728568e590492c99fada5ae145a9eda04` | MERGED_PR_BRANCH_REVIEW | #62 | — | Merged PR(s): #62; verify ancestry and open-PR base references before deletion |
| `feat/st-extension-ui-bridge-2026-10-27` | `72cd292cb9f2db4ed2f6b9ee326639021792c09b` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #501 |
| `feat/stage1.3-deterministic-evaluator` | `405b54394eb3e64ece5f04d27a3ded91e529e48d` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `feat/time-action-advance-integration-2026-10-24` | `5ec7161172564804f5bb8ca4fda4f0af14f434fd` | MERGED_PR_BRANCH_REVIEW | #244 | — | Merged PR(s): #244; verify ancestry and open-PR base references before deletion |
| `feat/time-action-proposal-approval-2026-10-24` | `f748603d9b96808406095449f650399207d1e944` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `feat/time-atomic-segment-core-2026-10-24` | `7457844f1499f7febb01ff9fcb4c0c2012e4e7e8` | MERGED_PR_BRANCH_REVIEW | #227 | — | Merged PR(s): #227; verify ancestry and open-PR base references before deletion |
| `feat/time-author-duration-approval-2026-10-24` | `fc759ca6143baf45a0783c0324176272e31cd780` | CLOSED_UNMERGED_REVIEW | — | #242 | Closed without merge: #242; inspect unique commits/tests and whether another open PR depends on it |
| `feat/time-coordinate-core-integration-2026-10-24` | `45bdc9af14d795e6efff7e870d835897f3f7a625` | MERGED_PR_BRANCH_REVIEW | #224 | — | Merged PR(s): #224; verify ancestry and open-PR base references before deletion |
| `feat/time-domain-t1` | `01b709e5519c27596d68bc2e07ebaddfabc5051b` | CLOSED_UNMERGED_REVIEW | — | #219 | Closed without merge: #219; inspect unique commits/tests and whether another open PR depends on it |
| `feat/time-due-work-planner-2026-10-24` | `37b8ce68e198edafb894d3883558d68dcf8e2c25` | MERGED_PR_BRANCH_REVIEW | #228 | — | Merged PR(s): #228; verify ancestry and open-PR base references before deletion |
| `feat/time-durable-advance-operations-2026-10-24` | `d6d5b92378b72bd599f8347712f498d3cbba119b` | MERGED_PR_BRANCH_REVIEW | #229 | — | Merged PR(s): #229; verify ancestry and open-PR base references before deletion |
| `feat/time-persisted-triggers-2026-10-24` | `6de7e07dc61da52e08bf5dad4ae08563b158c5a9` | MERGED_PR_BRANCH_REVIEW | #231 | #235 | Merged PR(s): #231; verify ancestry and open-PR base references before deletion |
| `feat/time-policy-calendar-authoring-2026-10-24` | `aef8d5cc95dac90857bdafd8dce6913a09fbf903` | MERGED_PR_BRANCH_REVIEW | #230 | — | Merged PR(s): #230; verify ancestry and open-PR base references before deletion |
| `feat/time-process-state-contract` | `dfb8bf27f8919b2e94cc55e5ff0642b472f428d4` | CLOSED_UNMERGED_REVIEW | — | #249 | Closed without merge: #249; inspect unique commits/tests and whether another open PR depends on it |
| `feat/time-trigger-registry-t7-2026-10-24` | `e36e44de1db2072bf8e6b3354d99b0b9cd1e13eb` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `feat/tri-state-condition-results` | `a35f9fd20bff9a21ce5faa3c55f42ae350984651` | MERGED_PR_BRANCH_REVIEW | #46 | — | Merged PR(s): #46; verify ancestry and open-PR base references before deletion |
| `feat/tri-state-historical-fact-predicates` | `82ce8dd1e26103bfd3156cc1773df8aea17ca9a3` | MERGED_PR_BRANCH_REVIEW | #11 | — | Merged PR(s): #11; verify ancestry and open-PR base references before deletion |
| `feat/typed-causal-links` | `29ab8ab7229e6fc806ecf23ffc1a37626ad8689b` | MERGED_PR_BRANCH_REVIEW | #8 | — | Merged PR(s): #8; verify ancestry and open-PR base references before deletion |
| `feat/validate-proposals-before-approval` | `9c8a5eb7c44dafc170ba7371845eac495f97c1ab` | MERGED_PR_BRANCH_REVIEW | #25 | — | Merged PR(s): #25; verify ancestry and open-PR base references before deletion |
| `feat/world-scoped-mechanic-instances` | `b68e418972e174764f37469fca6121473ec054aa` | MERGED_PR_BRANCH_REVIEW | #28 | — | Merged PR(s): #28; verify ancestry and open-PR base references before deletion |
| `feature/time-domain-t1` | `766779a45f95e21927942c1d2255239cf90a8fde` | CLOSED_UNMERGED_REVIEW | — | #204 | Closed without merge: #204; inspect unique commits/tests and whether another open PR depends on it |
| `feature/time-domain-t2` | `766779a45f95e21927942c1d2255239cf90a8fde` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `feature/time-domain-t2-integrated` | `50e8f9044e8454afa805597a559b0b3393c6a360` | CLOSED_UNMERGED_REVIEW | — | #209 | Closed without merge: #209; inspect unique commits/tests and whether another open PR depends on it |
| `feature/time-domain-t3` | `4619911a4b4e013e4de0df163807387284b961c1` | CLOSED_UNMERGED_REVIEW | — | #214 | Closed without merge: #214; inspect unique commits/tests and whether another open PR depends on it |
| `feature/time-domain-t4` | `734515597a09df049f05c67780dcc92fb365eea9` | CLOSED_UNMERGED_REVIEW | — | #217 | Closed without merge: #217; inspect unique commits/tests and whether another open PR depends on it |
| `fix/accepted-head-return-operation-digest` | `7d0c49a1119da233272a231ad631997a0dac6952` | CLOSED_UNMERGED_REVIEW | — | #494 | Closed without merge: #494; inspect unique commits/tests and whether another open PR depends on it |
| `fix/api-capability-policy-2026-10-24` | `30b3160515b59301b1dde0dbb12fe48175fe3919` | CLOSED_UNMERGED_REVIEW | — | #220 | Closed without merge: #220; inspect unique commits/tests and whether another open PR depends on it |
| `fix/audit-confirmed-runtime-defects-2026-10-24` | `01d183e2c3556c69367add0c3622615f64e7ba11` | MERGED_PR_BRANCH_REVIEW | #200 | — | Merged PR(s): #200; verify ancestry and open-PR base references before deletion |
| `fix/core-accepted-head-durable-digest` | `1bf9561574de0c96fed8490a2e17c565a2f7fc84` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #485 |
| `fix/core-rollback-admin-boundary` | `1eb5ee6765202020f356239770866ec927d364cd` | CLOSED_UNMERGED_REVIEW | — | #66 | Closed without merge: #66; inspect unique commits/tests and whether another open PR depends on it |
| `fix/gateway-exact-provider-candidate-binding` | `5a11c18ccf20dafec7616ab10221ccb3f4fafe88` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `fix/host-inventory-readback-blockers-2026-10-27` | `87952255c3cfeada4f62dc830856f712c7b99000` | CLOSED_UNMERGED_REVIEW | — | #511 | Closed without merge: #511; inspect unique commits/tests and whether another open PR depends on it |
| `fix/host-inventory-readback-blockers-followup-2026-10-27` | `dd64153979299230b8d606054b7a01b8a9ecfeb8` | CLOSED_UNMERGED_REVIEW | — | #513 | Closed without merge: #513; inspect unique commits/tests and whether another open PR depends on it |
| `fix/host-inventory-unenrolled-artifacts-2026-10-28` | `2678a04e162dc50d5f9df54f1626d94ac6e7a497` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #531 |
| `fix/mechanic-policy-freshness-binding` | `7136c2484d799e8e4fb8383ca8b8a910937dd58a` | MERGED_PR_BRANCH_REVIEW | #268 | — | Merged PR(s): #268; verify ancestry and open-PR base references before deletion |
| `fix/mechanic-rule-operator-matrix` | `8035b98c2939d45d893c4ed73153856681b0ce4d` | MERGED_PR_BRANCH_REVIEW | #33 | — | Merged PR(s): #33; verify ancestry and open-PR base references before deletion |
| `fix/memory-provider-source-version-output-2026-10-28` | `842c3e8e621cc054a316439baa5c3f6f8dd95606` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #528 |
| `fix/npc-summary-lineage-sparse-array` | `5351fb66a42e680d41535effa46729277c015d45` | CLOSED_UNMERGED_REVIEW | — | #177 | Closed without merge: #177; inspect unique commits/tests and whether another open PR depends on it |
| `fix/personality-issue-73-test-traceability` | `014e9782ca210095650c39d36c0359acc9fd5d75` | CLOSED_UNMERGED_REVIEW | — | #75 | Closed without merge: #75; inspect unique commits/tests and whether another open PR depends on it |
| `fix/personality-post-merge-doc-refresh` | `43cbdc16d663e6b66418857f9f094946ce89c89a` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `fix/personality-relationship-case-crosswalk` | `40bab34b08ac881cedcf9d7143054b4211fda485` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `fix/proposal-audit-rollback-test` | `81ae9d4709ed20e8d2a0bd3c037eac8ad705f1cb` | MERGED_PR_BRANCH_REVIEW | #265 | — | Merged PR(s): #265; verify ancestry and open-PR base references before deletion |
| `fix/proposal-trust-boundaries` | `86e207546919a89248e66d1f5c7f90bf7e2a4dd9` | MERGED_PR_BRANCH_REVIEW | #27 | — | Merged PR(s): #27; verify ancestry and open-PR base references before deletion |
| `fix/provider-query-grant-cycle-race-2026-10-26` | `2dc307c10d6b63b8952f6f14938fef46f8a4e793` | CLOSED_UNMERGED_REVIEW | — | #359 | Closed without merge: #359; inspect unique commits/tests and whether another open PR depends on it |
| `fix/provider-serialized-access-readiness-2026-10-26` | `59293de5b96655144c5e3e925cb3828338a03783` | CLOSED_UNMERGED_REVIEW | — | #381 | Closed without merge: #381; inspect unique commits/tests and whether another open PR depends on it |
| `fix/provider-serialized-writes-clean-2026-10-26` | `5ce6c2e200421482150acf766cbb05b8e8adfede` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #382 |
| `fix/provider-shared-coordinator-lock-2026-10-26` | `8ad192a07fb4cfd14c89e25743c627407dde3c61` | CLOSED_UNMERGED_REVIEW | — | #383 | Closed without merge: #383; inspect unique commits/tests and whether another open PR depends on it |
| `fix/provider-windows-file-identity-2026-10-27` | `1f3112bc6d1c5d6a2e481aae520596948c67da2c` | MERGED_PR_BRANCH_REVIEW | #512 | — | Merged PR(s): #512; verify ancestry and open-PR base references before deletion |
| `fix/reads-claim-historical-support` | `c4147939fcc18eb23ad5253022973365b5404adb` | MERGED_PR_BRANCH_REVIEW | #18 | — | Merged PR(s): #18; verify ancestry and open-PR base references before deletion |
| `fix/real-evidence-dispatch-fail-closed-2026-10-27` | `1dbab36ec78626ee262622829a1cceb1fa4f322d` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #502 |
| `fix/reject-unknown-contract-fields` | `2c17743715598fbd374333426749ff63bb9106ae` | MERGED_PR_BRANCH_REVIEW | #21 | — | Merged PR(s): #21; verify ancestry and open-PR base references before deletion |
| `fix/rollback-review-ambiguity` | `8e49525adf85ea80a67ebc7ba93705d4c82e8ecb` | MERGED_PR_BRANCH_REVIEW | #14 | — | Merged PR(s): #14; verify ancestry and open-PR base references before deletion |
| `fix/runtime-contracts-rollback` | `228403dfe400e2344a0d79ea080fb363fa6da7d6` | MERGED_PR_BRANCH_REVIEW | #1 | — | Merged PR(s): #1; verify ancestry and open-PR base references before deletion |
| `fix/runtime-rule-contract` | `f747d49b126e9b56574b23e95012957835961e4f` | MERGED_PR_BRANCH_REVIEW | #2 | — | Merged PR(s): #2; verify ancestry and open-PR base references before deletion |
| `fix/time-calendar-reject-lossy-definitions-2026-10-27` | `606cfff5f34d6f650a3594e76b57c9acae591c3b` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #477 |
| `fix/time-completed-prerequisite-causal-order-2026-10-27` | `1e0e31d78e9d8a33f3b2e527f36f11953bdd692c` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `fix/time-contract-current-main-2026-10-25` | `e19da62b8eeb44ca0283a1e6b47407058dba5998` | MERGED_PR_BRANCH_REVIEW | #284 | — | Merged PR(s): #284; verify ancestry and open-PR base references before deletion |
| `fix/time-ignore-inherited-completion-list-2026-10-27` | `bafd8428f42726b4b313ae3dcb1be22bb4278f91` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #481 |
| `fix/time-interval-reject-lossy-records-2026-10-27` | `8f78faae83f67499faf9d32602c5cc12f5daf1b0` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #478 |
| `fix/time-policy-enforce-whole-second-rules` | `f122b1bff357bb94c3865b3c1881cb344841de89` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `fix/time-policy-operation-ceiling-2026-10-24` | `9145b4dea7bedf614d94519c674ed9e3bfdd839d` | MERGED_PR_BRANCH_REVIEW | #237 | — | Merged PR(s): #237; verify ancestry and open-PR base references before deletion |
| `fix/time-policy-reject-lossy-records-2026-10-27` | `a33ce8067b62ef67a56203b44344171e74e6675c` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #476 |
| `fix/time-policy-schema-long-skip-ceiling-2026-10-27` | `e0f29c25b1cae5965d52161f62c895bf6d890ea4` | CLOSED_UNMERGED_REVIEW | — | #482 | Closed without merge: #482; inspect unique commits/tests and whether another open PR depends on it |
| `fix/time-strict-trigger-record-validation-2026-10-27` | `3bf2090a8f8d7fea88efc3bbe335ded3ef7c9da1` | CLOSED_UNMERGED_REVIEW | — | #475 | Closed without merge: #475; inspect unique commits/tests and whether another open PR depends on it |
| `fix/time-trigger-policy-validation-2026-10-24` | `4776801ae184357fa3c444276c6dac3276a418e5` | CLOSED_UNMERGED_REVIEW | — | #238 | Closed without merge: #238; inspect unique commits/tests and whether another open PR depends on it |
| `fix/time-trigger-policy-validation-main-2026-10-24` | `42a8d6de1356eccb00640f0cf81f7a111ba60b44` | CLOSED_UNMERGED_REVIEW | — | #240 | Closed without merge: #240; inspect unique commits/tests and whether another open PR depends on it |
| `fix/time-trigger-policy-validation-v2-2026-10-24` | `f311fb1da5a54e73942c3f08c24586586aa109ed` | MERGED_PR_BRANCH_REVIEW | #239 | — | Merged PR(s): #239; verify ancestry and open-PR base references before deletion |
| `fix/time-trigger-resource-bounds-2026-10-24` | `ac9a004886212c7222d8ed0af6181764632bf8fb` | MERGED_PR_BRANCH_REVIEW | #236 | #234 | Merged PR(s): #236; verify ancestry and open-PR base references before deletion |
| `fix/world-scoped-event-identity` | `1ccd681f3849cc4ea5db1bdf09c712cf678f736e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #473 |
| `host/digest-proxy-bridge-integration` | `25d10e48192a155dc7c0737af01746987ddb8a8f` | MERGED_PR_BRANCH_REVIEW | #412 | — | Merged PR(s): #412; verify ancestry and open-PR base references before deletion |
| `host/google-ai-studio-egress-gateway-audit-2026-10-26` | `8a3130f4aaef8255ff3eddb0c9332e627dea29f7` | CLOSED_UNMERGED_REVIEW | — | #378 | Closed without merge: #378; inspect unique commits/tests and whether another open PR depends on it |
| `host/issue-258-lifecycle-matrix-2026-10-25` | `e9576afb29f1205345a542f094385797ef310156` | CLOSED_UNMERGED_REVIEW | — | #332 | Closed without merge: #332; inspect unique commits/tests and whether another open PR depends on it |
| `host/lifecycle-completeness-followup-2026-10-25` | `4c8d193ca55cf96e46d7371ecfbec6ab7e54eff1` | MERGED_PR_BRANCH_REVIEW | #323 | — | Merged PR(s): #323; verify ancestry and open-PR base references before deletion |
| `host/lifecycle-evidence-mainline-2026-10-26` | `41125a42d2267a6732116fca42ccae6d316dd294` | MERGED_PR_BRANCH_REVIEW | #363 | — | Merged PR(s): #363; verify ancestry and open-PR base references before deletion |
| `host/lifecycle-journal-current-main-fix` | `4863d057fa65be1f1eb53e1570c1fa7557e330fc` | CLOSED_UNMERGED_REVIEW | — | #322, #321, #320, #316 | Closed without merge: #322, #321, #320, #316; inspect unique commits/tests and whether another open PR depends on it |
| `host/lifecycle-journal-prototype` | `3f7ef3e7c13b94cfa3633948a27a7a96bbf76680` | CLOSED_UNMERGED_REVIEW | — | #282 | Closed without merge: #282; inspect unique commits/tests and whether another open PR depends on it |
| `host/lifecycle-mainline-integration-2026-10-27` | `dcb4db6f7e31dd6c926958366f5db67c6795743d` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #456 |
| `host/pinned-source-audit-mainline-2026-10-26` | `db2f9ef1134caa6120945683d00108319c6f284c` | MERGED_PR_BRANCH_REVIEW | #361 | — | Merged PR(s): #361; verify ancestry and open-PR base references before deletion |
| `host/pinned-st-source-audit-2026-10-27` | `1ad2a1fa42cdde1bfc1ab1aede817c77fdbdbea0` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #503 |
| `host/redact-makersuite-prompt-logging-2026-10-27` | `e6b0f129940f8298d7e598f9f4a74dc588f72e58` | MERGED_PR_BRANCH_REVIEW | #440 | — | Merged PR(s): #440; verify ancestry and open-PR base references before deletion |
| `host/remote-digest-ledger-sync-current-main` | `2b9a1a3fd146ae1dde79f68b4ff8005b412989d6` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `host/save-persistence-receipt-2026-10-27` | `966c6d28658eb61825b241cf4da1177545ea60a8` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #507 |
| `host/source-inventory-freshness-gate-2026-10-27` | `337a510a481fa3cf0e381346889569c81b657f21` | CLOSED_UNMERGED_REVIEW | — | #445 | Closed without merge: #445; inspect unique commits/tests and whether another open PR depends on it |
| `integration/combined-memory-mechanics-current-main` | `01fc99b7dd3cf71f899ec03412fcb3cd7344e951` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `integration/core-memory-contracts` | `cb7875125acfabb72ae77af73275a85b30f5f69d` | MERGED_PR_BRANCH_REVIEW | #81 | — | Merged PR(s): #81; verify ancestry and open-PR base references before deletion |
| `integration/mechanics-40-43-candidate` | `5b6d106ba9c1975e52f558dd30555a35187066ca` | CLOSED_UNMERGED_REVIEW | — | #176 | Closed without merge: #176; inspect unique commits/tests and whether another open PR depends on it |
| `integration/mechanics-current-main` | `6981b14016e8d2bcf002bb90ae1a860195f57b7e` | MERGED_PR_BRANCH_REVIEW | #280 | — | Merged PR(s): #280; verify ancestry and open-PR base references before deletion |
| `integration/mechanics-current-main-candidate` | `e0c882b47dfa242902eb9e280f0a51c0ef2948ad` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `integration/mechanics-mainline-candidate` | `c87781243fb6c6d52a195698d8fb0677000f6147` | CLOSED_UNMERGED_REVIEW | — | #180 | Closed without merge: #180; inspect unique commits/tests and whether another open PR depends on it |
| `integration/memory-npc-host-seam-tests` | `e5a42c3cce50bc2294fad5353b0213adfa354077` | CLOSED_UNMERGED_REVIEW | — | #165 | Closed without merge: #165; inspect unique commits/tests and whether another open PR depends on it |
| `integration/memory-provider-core-npc` | `7d9a18b97f98e933c15d08baa5dc1ece1b9883aa` | CLOSED_UNMERGED_REVIEW | — | #276 | Closed without merge: #276; inspect unique commits/tests and whether another open PR depends on it |
| `integration/memory-provider-current-main` | `eb2a0353661f3a4810f1f118f0f7eb89982ca473` | CLOSED_UNMERGED_REVIEW | — | #286 | Closed without merge: #286; inspect unique commits/tests and whether another open PR depends on it |
| `integration/memory-provider-current-main-v2` | `1c5c99ce83007433d1610b73ea702727447c698e` | MERGED_PR_BRANCH_REVIEW | #287 | — | Merged PR(s): #287; verify ancestry and open-PR base references before deletion |
| `integration/memory-raw-archive-main-20261025` | `bfd66a81b3c1910c8829e6829d239e3f30d4370c` | CLOSED_UNMERGED_REVIEW | — | #293 | Closed without merge: #293; inspect unique commits/tests and whether another open PR depends on it |
| `integration/npc-memory-admission-slice` | `e06cb35b85a399238cea5ad0ac6dcb3043792b05` | MERGED_PR_BRANCH_REVIEW | #78 | — | Merged PR(s): #78; verify ancestry and open-PR base references before deletion |
| `integration/personality-relationship-crosswalk` | `8fcca2d5333f120f6c3565c4daa72820a814b0a7` | MERGED_PR_BRANCH_REVIEW | #79 | — | Merged PR(s): #79; verify ancestry and open-PR base references before deletion |
| `integration/process-manager-time-current-main` | `7f30b8fb0d819a321c7712729f836495ebaab4d5` | CLOSED_UNMERGED_REVIEW | — | #277 | Closed without merge: #277; inspect unique commits/tests and whether another open PR depends on it |
| `integration/relationship-domain-design` | `971f30b3959174471b88e709792e42741dc762fc` | MERGED_PR_BRANCH_REVIEW | #80 | — | Merged PR(s): #80; verify ancestry and open-PR base references before deletion |
| `integration/st-bridge-health-probe` | `34e36c57de9fede212679c289761a4ba0e593482` | CLOSED_UNMERGED_REVIEW | — | #384 | Closed without merge: #384; inspect unique commits/tests and whether another open PR depends on it |
| `integration/trusted-mutation-origin-contract` | `7bf84ab2c89cca66a2e127100954dccae8f9a7bd` | MERGED_PR_BRANCH_REVIEW | #82 | — | Merged PR(s): #82; verify ancestry and open-PR base references before deletion |
| `main` | `5bc5f0e4434c7573d2754e6cda94786fcb45fca0` | KEEP_MAIN | — | — | Default branch |
| `memory-provider-input-snapshot-hardening-2026-10-27` | `e571f0a6c7361421910c8da3276f5548c5cd43d4` | CLOSED_UNMERGED_REVIEW | — | #441 | Closed without merge: #441; inspect unique commits/tests and whether another open PR depends on it |
| `memory-provider-p0-raw-capture-regressions` | `3d2091e658066ea425f952a803cad52f5d54fd16` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `memory-provider-p0-raw-capture-tests-main` | `44ab6654210ccceb0ad87342b1c7ef73a2d44144` | CLOSED_UNMERGED_REVIEW | — | #342 | Closed without merge: #342; inspect unique commits/tests and whether another open PR depends on it |
| `memory-provider-purge-boundary-tests` | `a14e07ce74e81f61c021d1a8a5717f1967691bfb` | CLOSED_UNMERGED_REVIEW | — | #331 | Closed without merge: #331; inspect unique commits/tests and whether another open PR depends on it |
| `memory/issue-142-source-boundaries` | `63b3cfdce7532b7aad4a441dc772194ee160ff8f` | CLOSED_UNMERGED_REVIEW | — | #144 | Closed without merge: #144; inspect unique commits/tests and whether another open PR depends on it |
| `memory/issue-142-source-boundaries-current-main` | `76c562187a98ca15ff19e6b40a3d58179e9b88f3` | CLOSED_UNMERGED_REVIEW | — | #160 | Closed without merge: #160; inspect unique commits/tests and whether another open PR depends on it |
| `memory/issue-142-source-boundaries-current-main-v2` | `d3f9f7dd3b6f15bf9a5be7664635aef74ce5d885` | MERGED_PR_BRANCH_REVIEW | #161 | — | Merged PR(s): #161; verify ancestry and open-PR base references before deletion |
| `memory/npc-cross-review-current-main` | `6068c1905e55ab100b42514e85c11c721054cad1` | CLOSED_UNMERGED_REVIEW | — | #163 | Closed without merge: #163; inspect unique commits/tests and whether another open PR depends on it |
| `memory/provider-input-shape-hardening-2026-10-27` | `ba363648841f99046053a5c5117f7699e4056adf` | MERGED_PR_BRANCH_REVIEW | #433 | — | Merged PR(s): #433; verify ancestry and open-PR base references before deletion |
| `memory/provider-input-snapshot-hardening-main-2026-10-27` | `e820fdf20e2bcb5665d5480e42b20b4ff4f0ea56` | CLOSED_UNMERGED_REVIEW | — | #443 | Closed without merge: #443; inspect unique commits/tests and whether another open PR depends on it |
| `memory/provider-race-mainline-2026-10-26` | `91ad4f262c9572258f40c22d075f1c3b7ef54e88` | MERGED_PR_BRANCH_REVIEW | #362 | — | Merged PR(s): #362; verify ancestry and open-PR base references before deletion |
| `memory/provider-shared-coordinator-lock-current-main` | `42c304288779c47b75e328605aac1f03a262229e` | MERGED_PR_BRANCH_REVIEW | #399 | — | Merged PR(s): #399; verify ancestry and open-PR base references before deletion |
| `memory/provider-strict-snapshot-shape-2026-10-27` | `2f35b3d4f8b3b5a95eaf774a0fda2bce3198adbb` | MERGED_PR_BRANCH_REVIEW | #436 | — | Merged PR(s): #436; verify ancestry and open-PR base references before deletion |
| `memory/revocation-race-contract` | `1dfb57bc02a407c861f41460e8f46c84e067262c` | CLOSED_UNMERGED_REVIEW | — | #179 | Closed without merge: #179; inspect unique commits/tests and whether another open PR depends on it |
| `memory/sqlite-provider-core-npc-slice-2026-10-27` | `8e87e792967855c2fd1ca874eca63a93cde2df22` | CLOSED_UNMERGED_REVIEW | — | #439 | Closed without merge: #439; inspect unique commits/tests and whether another open PR depends on it |
| `memory/sqlite-provider-hardening-current-main-2026-10-27` | `4b3ae743664dece5d330cebce0325ac5394d6f40` | CLOSED_UNMERGED_REVIEW | — | #461 | Closed without merge: #461; inspect unique commits/tests and whether another open PR depends on it |
| `npc/1.4-clean-lineage-tests` | `176c2cb03c6f3273cc20cd98cb6e8e8c0aa6c465` | CLOSED_UNMERGED_REVIEW | — | #150 | Closed without merge: #150; inspect unique commits/tests and whether another open PR depends on it |
| `npc/1.4-clean-lineage-tests-current-main` | `d5d4421823007d2d46e0002c7d037306aa30b64e` | MERGED_PR_BRANCH_REVIEW | #157 | — | Merged PR(s): #157; verify ancestry and open-PR base references before deletion |
| `npc/1.4-clean-memory-boundary-matrix` | `d7653da088a6448996ebbada3c00ccda53f589be` | CLOSED_UNMERGED_REVIEW | — | #151 | Closed without merge: #151; inspect unique commits/tests and whether another open PR depends on it |
| `npc/1.4-clean-memory-boundary-matrix-current-main` | `5cfe282e7e231d4c9a44c82203a95847afcb09e5` | CLOSED_UNMERGED_REVIEW | — | #158 | Closed without merge: #158; inspect unique commits/tests and whether another open PR depends on it |
| `npc/1.4-clean-memory-boundary-matrix-current-main-v2` | `61d2cf3b2db034ee4361d4915bc444970abce1f2` | MERGED_PR_BRANCH_REVIEW | #159 | — | Merged PR(s): #159; verify ancestry and open-PR base references before deletion |
| `npc/1.4-handoff-evidence-matrix` | `668cfdc35ba68d4de3daf38045744e69054fb00e` | CLOSED_UNMERGED_REVIEW | — | #253 | Closed without merge: #253; inspect unique commits/tests and whether another open PR depends on it |
| `npc/149-lineage-duplicate-guard-2026-10-26` | `bf35fb8dd13628718dacc11c27654c0929fba0e2` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `npc/317-correct-boundary-matrix-duplicate-semantics` | `800240cbb280c8d07273f66fca8180f05eaeb8a0` | CLOSED_UNMERGED_REVIEW | — | #318 | Closed without merge: #318; inspect unique commits/tests and whether another open PR depends on it |
| `npc/317-knowledge-state-semantics` | `06b55db73f90470f057f53174549196aadeccae4` | CLOSED_UNMERGED_REVIEW | — | #327 | Closed without merge: #327; inspect unique commits/tests and whether another open PR depends on it |
| `npc/317-reject-duplicate-memory-identities` | `a5ea3b213b49d5afd716bf8faf0e567df6847c8f` | CLOSED_UNMERGED_REVIEW | — | #319 | Closed without merge: #319; inspect unique commits/tests and whether another open PR depends on it |
| `npc/317-reject-duplicate-summary-lineage` | `1cded9bd24d189e10b410a78fa83903988fcb1e9` | CLOSED_UNMERGED_REVIEW | — | #337 | Closed without merge: #337; inspect unique commits/tests and whether another open PR depends on it |
| `npc/admission-hardening-current-main-2026-10-27` | `58afaa9726367c8de8f272dda80378baf9ec1f0e` | CLOSED_UNMERGED_REVIEW | — | #437 | Closed without merge: #437; inspect unique commits/tests and whether another open PR depends on it |
| `npc/duplicate-ambiguity-matrix-2026-10-26` | `8ab98b7bd6cc588f062f4c140f07aa8409dfccc9` | MERGED_PR_BRANCH_REVIEW | #360 | — | Merged PR(s): #360; verify ancestry and open-PR base references before deletion |
| `npc/duplicate-canonical-read-guard-2026-10-27` | `3cada6f12d79f8a771f3c089506379be2318f2e7` | CLOSED_UNMERGED_REVIEW | — | #410 | Closed without merge: #410; inspect unique commits/tests and whether another open PR depends on it |
| `npc/duplicate-canonical-read-guard-current-main-2026-10-27` | `79bdec2370bf597bf9b39d482be64c210e053e48` | CLOSED_UNMERGED_REVIEW | — | #411 | Closed without merge: #411; inspect unique commits/tests and whether another open PR depends on it |
| `npc/isolated-autonomy-planner-20261028` | `49b890e846546b43332a3080229ece9c39ced1de` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #532 |
| `npc/knowledge-transition-semantics-2026-10-27` | `e5258a6131ed731e11abefada7a45e909506e611` | MERGED_PR_BRANCH_REVIEW | #425 | — | Merged PR(s): #425; verify ancestry and open-PR base references before deletion |
| `npc/lineage-duplicate-guard-current-main-2026-10-27` | `5fb590018c0782b485d36246ec2307824c4d8850` | CLOSED_UNMERGED_REVIEW | — | #406 | Closed without merge: #406; inspect unique commits/tests and whether another open PR depends on it |
| `npc/lineage-duplicate-guard-current-main-2026-10-27b` | `6d6ef5437bb30ea5dc75dea7740bab0758bb2cf5` | MERGED_PR_BRANCH_REVIEW | #414 | — | Merged PR(s): #414; verify ancestry and open-PR base references before deletion |
| `npc/lineage-duplicate-guard-current-main-2026-10-27b2` | `dec61be27d160d5c05f75897560b92f7a72b53f5` | MERGED_PR_BRANCH_REVIEW | #416 | — | Merged PR(s): #416; verify ancestry and open-PR base references before deletion |
| `npc/lineage-duplicate-guard-main-2026-10-27` | `b5871568f3cdd966a5a3eac4739251fe828993ee` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `npc/nonready-result-lineage-safety-current-main` | `3f92da7764b5e06f7edcb8fc860174f9455b80bb` | MERGED_PR_BRANCH_REVIEW | #162 | — | Merged PR(s): #162; verify ancestry and open-PR base references before deletion |
| `npc/rebase-accessor-admission-guard-2026-10-27` | `b0332610bbe7808a69646e06342904d1d824bf6c` | CLOSED_UNMERGED_REVIEW | — | #424 | Closed without merge: #424; inspect unique commits/tests and whether another open PR depends on it |
| `npc/rebase-accessor-admission-guard-2026-10-27b` | `5691f79c4902cccc663b59bbd00df785f9d6338e` | MERGED_PR_BRANCH_REVIEW | #438 | — | Merged PR(s): #438; verify ancestry and open-PR base references before deletion |
| `npc/refresh-summary-lineage-guard-2026-10-26` | `932d94dc90216876029396748747c98f3a10b466` | CLOSED_UNMERGED_REVIEW | — | #392 | Closed without merge: #392; inspect unique commits/tests and whether another open PR depends on it |
| `npc/reject-accessor-backed-admission-inputs` | `8497d5841c5daf55f4e56c0d53919411abbd65eb` | CLOSED_UNMERGED_REVIEW | — | #421 | Closed without merge: #421; inspect unique commits/tests and whether another open PR depends on it |
| `npc/reject-duplicate-memory-identities-current-main-2026-10-27` | `d19580b01866f60ec31bc57d5e8f8e7af64a21bb` | MERGED_PR_BRANCH_REVIEW | #418 | — | Merged PR(s): #418; verify ancestry and open-PR base references before deletion |
| `npc/remove-duplicate-oracle-tests-2026-10-27` | `83732f05feefa101105d426fb8c1ed8e2645b228` | MERGED_PR_BRANCH_REVIEW | #417 | — | Merged PR(s): #417; verify ancestry and open-PR base references before deletion |
| `npc/rollback-only-revision-regression` | `e590d002aeac85560363370876c6316d751c5d83` | CLOSED_UNMERGED_REVIEW | — | #166 | Closed without merge: #166; inspect unique commits/tests and whether another open PR depends on it |
| `npc/summary-lineage-duplicate-guard-current-main-2026-10-27` | `5b38cd39ec697ba9ab8fff01c428d4576c149279` | CLOSED_UNMERGED_REVIEW | — | #396 | Closed without merge: #396; inspect unique commits/tests and whether another open PR depends on it |
| `npc/tz4-denied-empty-contract-20261028` | `4a8e228b2637e5353527c9fc95e19eea379c6fd6` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #527 |
| `perf/benchmark-mixed-projection-workload` | `8cf87c66968fbeb8a4aada231035d856b8d6be3c` | MERGED_PR_BRANCH_REVIEW | #207 | — | Merged PR(s): #207; verify ancestry and open-PR base references before deletion |
| `perf/benchmark-repeat-samples` | `c5c40fc9c27dd8bc7e1d197470b876f1d382d663` | MERGED_PR_BRANCH_REVIEW | #212 | — | Merged PR(s): #212; verify ancestry and open-PR base references before deletion |
| `perf/benchmark-replay-rollback-growth` | `1b9ef8a994d0acdd2427925c1a710bf3228d5926` | MERGED_PR_BRANCH_REVIEW | #205 | — | Merged PR(s): #205; verify ancestry and open-PR base references before deletion |
| `perf/benchmark-rollback-cascade` | `d2164c1a18fc22c5a46413aa17a18f437f31cbf5` | MERGED_PR_BRANCH_REVIEW | #210 | — | Merged PR(s): #210; verify ancestry and open-PR base references before deletion |
| `personality/issue-73-blocker-owners-v2` | `90bd3052362ec671b0e068129e4d3dfedcb0b84b` | CLOSED_UNMERGED_REVIEW | — | #155 | Closed without merge: #155; inspect unique commits/tests and whether another open PR depends on it |
| `personality/issue-73-blocker-owners-v3` | `d6f18b6a780de84f5faa94c9a9f857eaf09b5ab3` | MERGED_PR_BRANCH_REVIEW | #156 | — | Merged PR(s): #156; verify ancestry and open-PR base references before deletion |
| `personality/issue-73-main-reconciled-2026-10-24` | `797d981c1499a4dae017da34348ac6ceafb77e15` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `proposal/provider-accepted-head-mutation-protocol` | `c2a591bbcf3cde1f18bb1d66d82682bfae4b9e96` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #493 |
| `provider/cross-connection-race-regressions-current-main-2026-10-27` | `e004db40dc29d7265666afadc5566c5266f4f763` | MERGED_PR_BRANCH_REVIEW | #419 | — | Merged PR(s): #419; verify ancestry and open-PR base references before deletion |
| `provider/digest-only-host-version-ledger-current-main` | `53d06f42e61e0f27def151a09f94e1894ee01326` | MERGED_PR_BRANCH_REVIEW | #402 | — | Merged PR(s): #402; verify ancestry and open-PR base references before deletion |
| `provider/digest-only-source-version-ledger-2026-10-26` | `bfb8ff96323e884dfd9f0690e6937ae396c10d48` | CLOSED_UNMERGED_REVIEW | — | #390 | Closed without merge: #390; inspect unique commits/tests and whether another open PR depends on it |
| `provider/exact-version-tombstone-isolation-current-main-2026-10-27` | `2ffed2ae977901365404048f166944350b5aa69c` | MERGED_PR_BRANCH_REVIEW | #420 | — | Merged PR(s): #420; verify ancestry and open-PR base references before deletion |
| `provider/fix-untrusted-inventory-scope-2026-10-27` | `e79682a7117a2b12c536627b5a36786c1435bae1` | MERGED_PR_BRANCH_REVIEW | #408 | — | Merged PR(s): #408; verify ancestry and open-PR base references before deletion |
| `provider/harden-host-ledger-startup-current-main` | `8038b6feda145bf4578f2fdb207647575149c0f9` | MERGED_PR_BRANCH_REVIEW | #404 | — | Merged PR(s): #404; verify ancestry and open-PR base references before deletion |
| `provider/invalidate-ready-on-ledger-mutation-2026-10-26` | `f4da57a7c38ea9e27ab27aedd6d0a4bbb45d0ec0` | CLOSED_UNMERGED_REVIEW | — | #391 | Closed without merge: #391; inspect unique commits/tests and whether another open PR depends on it |
| `refresh/443-provider-input-snapshot-hardening-2026-10-27` | `577b4e95d88c14178eb4b3c7f4f07f156446b00b` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #460 |
| `refresh/447-world-pack-version-semantics-2026-10-27` | `e1f9710797d3d1eb9f9306b9f48b75086404d27e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #458 |
| `refresh/448-relationship-interaction-evidence-2026-10-27` | `e9d3b188b79434ba962b76bb99405cdac362c4d9` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #459 |
| `refresh/449-npc-interpretation-boundary-2026-10-27` | `a9f2923a4f0df7a0fd84e8a7a964896428204621` | CLOSED_UNMERGED_REVIEW | — | #457 | Closed without merge: #457; inspect unique commits/tests and whether another open PR depends on it |
| `relationships/interaction-evidence-adversarial-cases` | `61a99287b09a2058fec976b6678ad7cabdd6ded3` | CLOSED_UNMERGED_REVIEW | — | #427 | Closed without merge: #427; inspect unique commits/tests and whether another open PR depends on it |
| `relationships/issue-130-typed-transition-handoff` | `85f9305d327ee1dda654798a5629ab2fe9bbf2d2` | MERGED_PR_BRANCH_REVIEW | #134 | — | Merged PR(s): #134; verify ancestry and open-PR base references before deletion |
| `relationships/issue-143-exact-compatibility-default` | `1b43c0eaa037815e45aaf0ee4681864c0744ad05` | CLOSED_UNMERGED_REVIEW | — | #325 | Closed without merge: #325; inspect unique commits/tests and whether another open PR depends on it |
| `relationships/issue-143-exact-compatibility-default-refresh` | `e9da09f55b6131e0ca4d662582c6c90b6a8bd5fd` | CLOSED_UNMERGED_REVIEW | — | #447 | Closed without merge: #447; inspect unique commits/tests and whether another open PR depends on it |
| `relationships/issue-143-pinned-rule-version-domain-test` | `d1231c42f96323123e91e849acd89213dd4ca98f` | MERGED_PR_BRANCH_REVIEW | #170 | — | Merged PR(s): #170; verify ancestry and open-PR base references before deletion |
| `relationships/issue-143-world-pack-version-semantics` | `9b59a555a4bec0aba870e46733ff4f728b59bd20` | MERGED_PR_BRANCH_REVIEW | #145 | — | Merged PR(s): #145; verify ancestry and open-PR base references before deletion |
| `relationships/npc-interpretation-boundary` | `380c5806b0268b9a69849c6f2966e47410e71a3a` | CLOSED_UNMERGED_REVIEW | — | #429 | Closed without merge: #429; inspect unique commits/tests and whether another open PR depends on it |
| `relationships/npc-interpretation-boundary-refresh` | `53d3251ba05678721892aede0abd91acc9b37892` | CLOSED_UNMERGED_REVIEW | — | #449 | Closed without merge: #449; inspect unique commits/tests and whether another open PR depends on it |
| `relationships/social-interaction-evidence-assessment-refresh` | `91fe5ed6cb8499fdf0857e11ac8d4ff14d8fddbf` | CLOSED_UNMERGED_REVIEW | — | #448 | Closed without merge: #448; inspect unique commits/tests and whether another open PR depends on it |
| `research/recalculation-oracle-harness-2026-10-24` | `b1986602b47e189ce58514972676db79c21f7e8c` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `research/spatial-temporal-evidence-2026-10-26` | `cfdf3eda74b14c15de077b48e925f00291c6458e` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #529 |
| `review/claude-full-project-audit` | `180308b0d6af382314d1847504a7b8618efe986d` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #185 |
| `review/host-history-trustworthiness-2026-10-28` | `cac4e2240340010f1d5a00c73893197655b2fbe9` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `review/host-lifecycle-patch-2026-10-25` | `0210a71e633cc04c740daf53f8c7e035f4218592` | CLOSED_UNMERGED_REVIEW | — | #275 | Closed without merge: #275; inspect unique commits/tests and whether another open PR depends on it |
| `review/startup-migration-block-core-conditional-approve` | `57e44623ed416438c9d97b71977e7ebfef4c1389` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `review/startup-migration-patch-candidate` | `6155d75386d304226d5d1c072c152083f5406717` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #520 |
| `security/accepted-head-authority-acl-2026-10-27` | `1aa7e8ac15e5429cb769791ce55eec28e86417a7` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #469 |
| `security/accepted-head-host-domain-2026-10-27` | `abbccf17c533b780132a876a96b64815eb19df56` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `security/api-least-privilege-194` | `08d91cff2b341d04898609704170d4b4d519afb6` | MERGED_PR_BRANCH_REVIEW | #257 | — | Merged PR(s): #257; verify ancestry and open-PR base references before deletion |
| `security/constant-time-credential-checks` | `bffb7833709ae940fa120baf4241eed02c4d1848` | MERGED_PR_BRANCH_REVIEW | #208 | — | Merged PR(s): #208; verify ancestry and open-PR base references before deletion |
| `security/core-db-acl-boundary-2026-10-27` | `1a477d3c1260015ae748201b8ed3ac002ffd742a` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #468 |
| `security/core-db-acl-path-hardening-2026-10-27` | `8bf7cc7f0c2aa6516d36a31f2e771ed05831dc75` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `security/core-host-inventory-readback-2026-10-27` | `4154ce0c6667e49869f4f5bcb165e1d21dcd62bb` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #510 |
| `security/product-security-policy-2026-10-26` | `1c16609ee32445202ef7741d5779fea470b4d835` | MERGED_PR_BRANCH_REVIEW | #367 | — | Merged PR(s): #367; verify ancestry and open-PR base references before deletion |
| `security/target-pc-acceptance-runbook` | `47719268cbecacf0025c067e90bbc145fbdec4ea` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #471 |
| `security/windows-deployment-evidence-collector` | `31ff72961b15f5fe55257cdb084eb666fafb402c` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #451 |
| `stage1-causality-contract-tests` | `c7757126ff702d965702a6f3a76b467cb76550e4` | MERGED_PR_BRANCH_REVIEW | #4 | — | Merged PR(s): #4; verify ancestry and open-PR base references before deletion |
| `stage1-rollback-graph-tests` | `c402e52b8e25efca36a9363bdb5470ca41b83ea0` | MERGED_PR_BRANCH_REVIEW | #5 | — | Merged PR(s): #5; verify ancestry and open-PR base references before deletion |
| `test/core-context-manifest-snapshot-expansion` | `7b5be03f2fb81549c0bf76b4b40140e056c837a5` | MERGED_PR_BRANCH_REVIEW | #74 | — | Merged PR(s): #74; verify ancestry and open-PR base references before deletion |
| `test/core-provider-canonical-source-integration-2026-10-27` | `22bc736de28ad0492a629af907fc4c0dcf10c5cd` | MERGED_PR_BRANCH_REVIEW | #431 | — | Merged PR(s): #431; verify ancestry and open-PR base references before deletion |
| `test/core-provider-coordinated-restore-current-main` | `65a9eceea219e928ddfc2cb1532ac42385ce865c` | MERGED_PR_BRANCH_REVIEW | #401 | — | Merged PR(s): #401; verify ancestry and open-PR base references before deletion |
| `test/core-rollback-projection-atomicity` | `aef73b485349bc2b36521a88d268fea60a624589` | MERGED_PR_BRANCH_REVIEW | #72 | — | Merged PR(s): #72; verify ancestry and open-PR base references before deletion |
| `test/core-rule-pin-failed-lookup-no-write` | `5d64869e0e476ccd491aa678e7296ef8ca04f3f6` | MERGED_PR_BRANCH_REVIEW | #178 | — | Merged PR(s): #178; verify ancestry and open-PR base references before deletion |
| `test/entity-mutation-atomicity` | `e6571fe2c5fd27ad2fd7ae9eeaefb39d3e825163` | MERGED_PR_BRANCH_REVIEW | #20 | — | Merged PR(s): #20; verify ancestry and open-PR base references before deletion |
| `test/gateway-provider-revoke-serialization-2026-10-27` | `fa2778debccb4ebc093a9fe48c08a1b1cee19cd7` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #505 |
| `test/memory-provider-concurrency-restart-current-main` | `2945712056244803d5067b98c0cadf748fa10136` | CLOSED_UNMERGED_REVIEW | — | #289 | Closed without merge: #289; inspect unique commits/tests and whether another open PR depends on it |
| `test/memory-provider-lifecycle-regressions-main` | `7683478f6e38c48fa167d3a1a18ea102d255ea54` | CLOSED_UNMERGED_REVIEW | — | #344 | Closed without merge: #344; inspect unique commits/tests and whether another open PR depends on it |
| `test/memory-raw-read-revocation-race` | `a64060388b59f7ff82f3f94a1a19e205e1d2ba64` | CLOSED_UNMERGED_REVIEW | — | #254 | Closed without merge: #254; inspect unique commits/tests and whether another open PR depends on it |
| `test/migration-and-rollback-atomicity` | `cc6430714b3037711a7a75f830c9d3f90d70c152` | MERGED_PR_BRANCH_REVIEW | #3 | — | Merged PR(s): #3; verify ancestry and open-PR base references before deletion |
| `test/npc-admission-result-immutability` | `788992e4fe037928be408de087ffef30258d0a6d` | CLOSED_UNMERGED_REVIEW | — | #175 | Closed without merge: #175; inspect unique commits/tests and whether another open PR depends on it |
| `test/npc-candidate-identity-pair` | `810addef53be04138ba1e44d1e71cb560cb97160` | CLOSED_UNMERGED_REVIEW | — | #174 | Closed without merge: #174; inspect unique commits/tests and whether another open PR depends on it |
| `test/npc-lifecycle-boundary-regression` | `9427b5506c3056d6c720646c5337d5eb1ac9f942` | CLOSED_UNMERGED_REVIEW | — | #169 | Closed without merge: #169; inspect unique commits/tests and whether another open PR depends on it |
| `test/npc-lineage-world-scope-negative` | `2d571b6c0d4d4ba89229e207ae50d7125d92d3c5` | CLOSED_UNMERGED_REVIEW | — | #138 | Closed without merge: #138; inspect unique commits/tests and whether another open PR depends on it |
| `test/npc-result-status-lineage-safety-2026-10-24` | `6a43c48c0215e15416a6400b4aa4ef8c9548cb2c` | CLOSED_UNMERGED_REVIEW | — | #147 | Closed without merge: #147; inspect unique commits/tests and whether another open PR depends on it |
| `test/npc-snapshot-pair-negative-cases` | `976e3d3a893b223ff27995f98799f95cc497d8fa` | CLOSED_UNMERGED_REVIEW | — | #172 | Closed without merge: #172; inspect unique commits/tests and whether another open PR depends on it |
| `test/process-knowledge-isolation-20261025` | `478566437f5905791ac081989aec4c63871f551d` | CLOSED_UNMERGED_REVIEW | — | #312 | Closed without merge: #312; inspect unique commits/tests and whether another open PR depends on it |
| `test/process-knowledge-isolation-243` | `c5b290d1bd8f9f28433fea74a6422a04c35af6d7` | CLOSED_UNMERGED_REVIEW | — | #309 | Closed without merge: #309; inspect unique commits/tests and whether another open PR depends on it |
| `test/process-knowledge-isolation-mainline-2026-10-26` | `d6935a6ec6fc97da39c9c7c41fd7546da47674fe` | MERGED_PR_BRANCH_REVIEW | #364 | — | Merged PR(s): #364; verify ancestry and open-PR base references before deletion |
| `test/provider-active-read-revocation-race` | `3a447d9194657544b0014dbe6cdedfa141c86606` | CLOSED_UNMERGED_REVIEW | — | #271 | Closed without merge: #271; inspect unique commits/tests and whether another open PR depends on it |
| `test/provider-consumer-real-sqlite-2026-10-27` | `06f464e2c49d8727fd91936e33b0424e062d3b51` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #504 |
| `test/provider-core-source-update-reconciliation-2026-10-27` | `e23b2c03e33c84b537b82ac6b7094f02f4a64b95` | MERGED_PR_BRANCH_REVIEW | #435 | — | Merged PR(s): #435; verify ancestry and open-PR base references before deletion |
| `test/provider-cross-connection-record-retrieval-aba-2026-10-26` | `af88af0e1cd329ff67019331b47d9919d5db51e5` | KEEP_OPEN_PR_BASE | — | #366 | Base of at least one current open PR; do not delete |
| `test/provider-exact-version-tombstone-2026-10-26` | `2433fd8500e6d8972bdbcad86d8ba8a7d24c4fcc` | CLOSED_UNMERGED_REVIEW | — | #370 | Closed without merge: #370; inspect unique commits/tests and whether another open PR depends on it |
| `test/relationship-pair-level-rollback-contract` | `68a9d34eaa993d2a8e2ed54c0a6ea6ef2b4d0306` | MERGED_PR_BRANCH_REVIEW | #218 | — | Merged PR(s): #218; verify ancestry and open-PR base references before deletion |
| `test/remote-binding-gate` | `292be3e799662b560c7c02fa3198120b62801a4f` | MERGED_PR_BRANCH_REVIEW | #211 | — | Merged PR(s): #211; verify ancestry and open-PR base references before deletion |
| `test/sequential-rollback-claim-support` | `cd97ad1d66cf370b1ae2374c8b4f6094da0555a9` | MERGED_PR_BRANCH_REVIEW | #51 | — | Merged PR(s): #51; verify ancestry and open-PR base references before deletion |
| `test/storage-migration-compatibility` | `b900fc5cb56bc20ce72cbde4f8cef63966e2dd03` | MERGED_PR_BRANCH_REVIEW | #203 | — | Merged PR(s): #203; verify ancestry and open-PR base references before deletion |
| `test/time-advance-audit-regressions` | `f75fbbeceab43e6bd11cc0db95fa9968d4d355e4` | MERGED_PR_BRANCH_REVIEW | #241 | — | Merged PR(s): #241; verify ancestry and open-PR base references before deletion |
| `test/time-segment-atomicity-proof` | `9e4759fc4a4c27960835d27c9527f176ce97fb5d` | CLOSED_UNMERGED_REVIEW | — | #222 | Closed without merge: #222; inspect unique commits/tests and whether another open PR depends on it |
| `test/time-trigger-failure-atomicity-2026-10-24` | `5f6d23c85eb8a9f27d5a4bb80b7a47d605abc890` | MERGED_PR_BRANCH_REVIEW | #233 | — | Merged PR(s): #233; verify ancestry and open-PR base references before deletion |
| `wire-active-mechanic-policy-owner` | `ec74a1cd17fcdb5e3601b37a9e601c259d6f29e2` | CLOSED_UNMERGED_REVIEW | — | #270 | Closed without merge: #270; inspect unique commits/tests and whether another open PR depends on it |
| `work/audit-memory-snapshot-gate` | `22b85a803e968b28f9016f532aae6494dc3c8cae` | CLOSED_UNMERGED_REVIEW | — | #246 | Closed without merge: #246; inspect unique commits/tests and whether another open PR depends on it |
| `work/core-accepted-head-read-gate-2026-10-27` | `e30c550e8e97c432ebeae6b40d234e3d44df5ab0` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `work/core-process-manager-boundary` | `42083721bad480ddcc6492227211e8d719d742bf` | CLOSED_UNMERGED_REVIEW | — | #247 | Closed without merge: #247; inspect unique commits/tests and whether another open PR depends on it |
| `work/host-patch-disposable-check-2026-10-25` | `59a4c56c8433c1c135bcdce4f66dbebdbbe9a0f6` | CLOSED_UNMERGED_REVIEW | — | #269 | Closed without merge: #269; inspect unique commits/tests and whether another open PR depends on it |
| `work/mechanics-docs-drift-correction-2026-10-25` | `4af64fb68afd60fa99df03a9d7c7fab08641fe9c` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #326 |
| `work/mechanics-oracle-reconciled` | `2453c809905d0dec01144727accf2953d018ace6` | CLOSED_UNMERGED_REVIEW | — | #274 | Closed without merge: #274; inspect unique commits/tests and whether another open PR depends on it |
| `work/process-contract-runtime-slice` | `a6edf6e75ef503dcf6d82760a1c7faef76db2b70` | CLOSED_UNMERGED_REVIEW | — | #248 | Closed without merge: #248; inspect unique commits/tests and whether another open PR depends on it |
| `work/process-manager-ci-head` | `9b4f4a27cfdce5bbc8067d9abe7089cd8deadae4` | CLOSED_UNMERGED_REVIEW | — | #250 | Closed without merge: #250; inspect unique commits/tests and whether another open PR depends on it |
| `work/provider-accepted-head-read-gate-2026-10-27` | `badc356ee6110f45afc1c2c6e84041c91dfcc812` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `work/provider-accepted-head-read-gate-retest-2026-10-27` | `af895f86b2989da794833c391d7d276d891cf990` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `work/provider-accepted-head-read-gate-windows-2026-10-27` | `6d2a7cb60f6bc568e2d2d4f1e58c0839ee75e6bc` | UNCLASSIFIED_REVIEW | — | — | No PR lifecycle evidence found; inspect before action |
| `work/provider-accepted-head-read-gate-windows-retest-2026-10-27` | `6d2a7cb60f6bc568e2d2d4f1e58c0839ee75e6bc` | UNMAPPED_CANDIDATE | — | — | No mapped PR head; compare against main and sibling branches |
| `work/provider-focused-validation-2026-10-25` | `95ce0c559c3f39ee920082c90da521f6ec73ea89` | CLOSED_UNMERGED_REVIEW | — | #266 | Closed without merge: #266; inspect unique commits/tests and whether another open PR depends on it |
| `work/provider-focused-validation-review-2026-10-25` | `9f55264881b10982a4fc1812a8273e4af457ff24` | CLOSED_UNMERGED_REVIEW | — | #267 | Closed without merge: #267; inspect unique commits/tests and whether another open PR depends on it |
| `work/provider-read-gate-exact-head-2026-10-27` | `5ea35776092d207a7c60dc6311d9872bff57c5f9` | CLOSED_UNMERGED_REVIEW | — | #518 | Closed without merge: #518; inspect unique commits/tests and whether another open PR depends on it |
| `work/recalculation-oracle-integration` | `cea76df9a037f3e334688838aa39ec72dbf859a5` | CLOSED_UNMERGED_REVIEW | — | #225 | Closed without merge: #225; inspect unique commits/tests and whether another open PR depends on it |
| `work/sillytavern-diagnostic-extension` | `c494830d85fea7201053ff08da598316e5747937` | KEEP_OPEN_PR | — | — | Head of current open PR(s): #492 |

### Status counts — corrected for 86 open PRs

- `MERGED_PR_BRANCH_REVIEW`: 198
- `CLOSED_UNMERGED_REVIEW`: 187
- `KEEP_OPEN_PR`: 86
- `UNCLASSIFIED_REVIEW`: 22
- `UNMAPPED_CANDIDATE`: 17
- `KEEP_MAIN`: 1
- `KEEP_OPEN_PR_BASE`: 1

### Safe next actions

1. Close duplicate open PRs only after confirming their diffs are equivalent and one canonical PR retains all unique changes/tests. The same-head group above is the first target.
2. For `MERGED_PR_BRANCH_REVIEW`, compare branch tip to current `main`, check whether the branch is used as a base by an open PR, then delete only confirmed redundant refs.
3. For `CLOSED_UNMERGED_REVIEW`, do not assume the work was discarded: check whether its commits were cherry-picked/squash-merged elsewhere and preserve unique tests.
4. Do not delete `UNMAPPED_CANDIDATE` or `UNCLASSIFIED_REVIEW` branches in bulk.

## Targeted branch ancestry checks

GitHub compare API checks were run against current main for selected duplicate-looking or high-risk branch families. ahead_by is commit ancestry, not proof of unique file content: squash/rebase merges can leave commits unshared even when content landed in main. Therefore none of these results alone authorizes deletion.

| Branch | Compare status | Ahead | Behind | Changed files in branch-side comparison | Disposition |
|---|---|---:|---:|---:|---|
| core/atomic-state-snapshot | diverged | 2 | 465 | 2 | Compare all 3 snapshot variants; keep unique tests until file-level equivalence confirmed |
| core/atomic-state-snapshot-v2 | diverged | 2 | 461 | 2 | Same |
| core/atomic-state-snapshot-v3 | diverged | 2 | 456 | 2 | Same; PR #114 is merged, but ancestry/diff still needs checking |
| core/audit-independent-sqlite-writer-bypass | diverged | 62 | 318 | 13 | Closed PR #385; not safe to delete by name; review unique characterization tests |
| core/audit-independent-sqlite-writer-bypass-clean | diverged | 1 | 318 | 1 | Closed PR #386; compare test coverage with #385 before cleanup |
| core/operation-1-6-current-main-refresh | diverged | 4 | 400 | 2 | Closed PR #133; compare against v2 and current docs |
| core/operation-1-6-current-main-refresh-v2 | diverged | 2 | 398 | 2 | Closed PR #134; candidate for consolidation after file comparison |
| core/time-advance-failure-replay-after-restart | diverged | 1 | 329 | 1 | Closed PR #334; compare with v2 and current replay tests |
| core/time-advance-failure-replay-after-restart-v2 | diverged | 1 | 329 | 1 | Closed PR #335; likely overlapping test purpose, but preserve unique assertions |
| host/lifecycle-journal-current-main-fix | diverged | 32 | 330 | 11 | Four closed PRs (#316, #320, #321, #322) share this head branch; inspect PR diffs and retain only needed branch history/tests |
| fix/time-trigger-resource-bounds-2026-10-24 | diverged | 7 | 366 | 6 | PR #236 merged and #234 closed unmerged on same head; high-confidence cleanup candidate only after checking open-PR dependencies and current-main file equality |
| feat/time-persisted-triggers-2026-10-24 | diverged | 38 | 367 | 12 | PR #231 merged and #235 closed unmerged on same head; do not delete until checking whether unique work is in main |
| feat/npc-subsystem | diverged | 255 | 553 | 26 | PR #38/#76 share a branch lineage; very large historical branch, not a simple duplicate—preserve until unique NPC requirements/tests are reconciled |
| docs/coordinator-integration-status-2026-10-26 | diverged | 3 | 320 | 3 | Closed PR #374; compare with current-main variant |
| docs/coordinator-integration-status-2026-10-26-current-main | diverged | 4 | 319 | 3 | Closed PR #375; likely preferred evidence refresh, but compare exact doc content before deleting the older variant |
| relationships/npc-interpretation-boundary | diverged | 10 | 30 | 7 | Closed PR #429; contains runtime/tests as well as docs; not a docs-only duplicate |
| relationships/npc-interpretation-boundary-refresh | diverged | 2 | 12 | 1 | Closed PR #449; docs-only branch; compare current document content before deletion |

### Duplicate PR groups requiring cleanup review

1. **Host lifecycle journal:** PRs #316, #320, #321, #322 point to the same head branch and are closed without merge. This is redundant PR history, but the branch contains 11 changed files relative to its merge base. Review the exact PR diffs, choose one canonical issue/evidence thread, and delete the branch only after verifying the work is either transferred or intentionally abandoned.
2. **Time trigger resource bounds:** #236 merged, #234 closed without merge, same head. Compare current main content for the six changed files; if fully represented in main and no open PR depends on the branch, mark the branch as a deletion candidate.
3. **Persisted time triggers:** #231 merged, #235 closed without merge, same head. This branch has 12 changed files relative to merge base; check all runtime and test files before deciding.
4. **NPC subsystem:** #38 and #76 reuse feat/npc-subsystem; this is not enough to declare the work duplicated. Reconcile the older contract/docs and admission tests before any deletion.

### What can be acted on now vs. what cannot

- **Actionable without code loss:** update the portfolio issue with the 15 currently open Issues and the 86 open PRs; cross-link the three control Issues #252/#251/#264; stop creating new current-main, clean, v2, or final branches until the canonical branch for that workstream is chosen.
- **Candidates for manual cleanup review:** branches associated with merged PRs (198 refs) and closed-unmerged PRs (187 refs). These are not automatically safe to delete.
- **Not yet proven safe to delete:** any branch whose head is not identical to main, whose unique content has not been compared with current main, or which is a base for an open PR.
- **No destructive cleanup performed:** this audit only updated the documentation branch. It did not delete branches, close Issues/PRs, merge code, or change runtime behavior.
