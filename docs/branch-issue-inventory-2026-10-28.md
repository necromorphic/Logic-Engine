# Branch and Issue consolidation inventory — 2026-10-28

## Scope and limits

Read-only inventory from GitHub REST API on 2026-10-28. No branch or issue was deleted, closed, merged, or edited by this audit. Default branch: `main`; head SHA: `5bc5f0e4434c7573d2754e6cda94786fcb45fca0`.

- Branch API returned **512 branch refs** (earlier connector search returned 511; REST inventory is authoritative for this run).
- Open PR API returned **80 open pull requests**.
- This report maps open PR heads to branch refs and marks duplicate-looking names as *candidates*, not proven duplicates.
- The connector's branch listing provides names and head SHAs. It does not by itself prove whether each branch's unique commits are already in main. A branch may have an old base but valuable unique commits.
- **Do not delete based on name, age, or behind count alone.** Final safe deletion requires compare/ancestry evidence and review of unique commits.

## Recommended triage

1. **Keep:** `main`, all heads referenced by open PRs, and branches whose purpose is unresolved.
2. **Compare first:** every `DUPLICATE_CANDIDATE` branch below. Compare its diff with sibling variants and `main`; preserve unique tests and docs.
3. **Review separately:** security/test/CI branches. These may hold unique fail-closed evidence.
4. **Archive/close PR only after comparison:** if a newer PR truly supersedes an older one, record which unique changes/tests were carried forward, then close the superseded PR; delete its branch only after verifying it is not a base for another open PR.
5. **Issues:** keep one portfolio issue and one integration register; do not close independent block gates just because their titles overlap.

## Classification counts (heuristic)

- `WORKSTREAM_UNCLASSIFIED`: 217
- `DUPLICATE_CANDIDATE`: 112
- `OPEN_PR_HEAD`: 80
- `DOC_OR_AUDIT_CANDIDATE`: 63
- `SAFETY_OR_TEST_REQUIRES_REVIEW`: 39
- `CANONICAL_MAIN`: 1

Meanings:
- `CANONICAL_MAIN`: default branch.
- `OPEN_PR_HEAD`: branch is the head of at least one open PR; preserve.
- `DUPLICATE_CANDIDATE`: name suggests a variant/rebase/current-main refresh; compare commits before deciding.
- `DOC_OR_AUDIT_CANDIDATE`: documentation, coordinator, audit, or research branch; check whether the evidence has been superseded.
- `SAFETY_OR_TEST_REQUIRES_REVIEW`: security, tests, CI, performance; do not delete without coverage review.
- `WORKSTREAM_UNCLASSIFIED`: no safe disposition can be inferred from name.

## Open PRs and branch ownership

| PR | Head branch | Base | State | Title |
|---|---|---|---|---|
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

Each branch includes its current head SHA, heuristic class, and open-PR mapping. `—` means no open PR head match was found in the current API pages; it does not mean the branch is stale.

| Branch | Head SHA | Triage class | Open PR |
|---|---|---|---|
| `audit/api-capability-matrix-194` | `69a8283765cf894a08cf7efe7d2e5aeaef47c528` | DOC_OR_AUDIT_CANDIDATE | — |
| `audit/regression-tests-2026-10-24` | `1f630bc8f045969442e5f77f7524f3305d1f636f` | DOC_OR_AUDIT_CANDIDATE | — |
| `chore/coordinator-event-bridge` | `ddb110b9b96aa496209bccddc48c19fe252ba7bf` | WORKSTREAM_UNCLASSIFIED | — |
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
| `docs/core-deployment-policy-authority-226` | `c36584e3d7471b261c0581d5668396df35cf7ecd` | DOC_OR_AUDIT_CANDIDATE | — |
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
| `docs/multiple-independent-supports-contract` | `7f551e4f8ed84a27084fc7e7af51f1631a75eff9` | DOC_OR_AUDIT_CANDIDATE | — |
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
| `feat/core-mechanic-vertical-slice-226` | `e39e0dfd708453a2090ad1ea1b4f931d36510bc4` | WORKSTREAM_UNCLASSIFIED | — |
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
| `feat/local-coordinator-pc` | `58847f8f1992d181cd5bc5edc9ce9a6e0dec3124` | WORKSTREAM_UNCLASSIFIED | — |
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
| `review/claude-full-project-audit` | `180308b0d6af382314d1847504a7b8618efe986d` | DOC_OR_AUDIT_CANDIDATE | — |
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

## Issue disposition

### Keep as portfolio / integration controls
- [#252](https://github.com/necromorphic/Logic-Engine/issues/252) — central priorities, owners, dependencies, blockers, release gates.
- [#251](https://github.com/necromorphic/Logic-Engine/issues/251) — cross-block integration register and handoffs.
- [#264](https://github.com/necromorphic/Logic-Engine/issues/264) — Host → Provider evidence and production-readiness blockers.

### Keep as independent gates or block tasks
- [#140](https://github.com/necromorphic/Logic-Engine/issues/140) — Core gate for Memory → NPC; production remains disabled/fail-closed.
- [#181](https://github.com/necromorphic/Logic-Engine/issues/181) — real Memory Provider/adapter slice.
- [#258](https://github.com/necromorphic/Logic-Engine/issues/258) — pinned SillyTavern Host/Adapter lifecycle.
- [#356](https://github.com/necromorphic/Logic-Engine/issues/356) — product/security decision for in-flight revocation.
- [#519](https://github.com/necromorphic/Logic-Engine/issues/519) — local Windows/SillyTavern/SQLite follow-up.
- [#70](https://github.com/necromorphic/Logic-Engine/issues/70), [#149](https://github.com/necromorphic/Logic-Engine/issues/149), [#317](https://github.com/necromorphic/Logic-Engine/issues/317) — NPC/Memory handoff and completion. Cross-reference and unify acceptance criteria, but do not close without verifying owner-specific deliverables.
- [#143](https://github.com/necromorphic/Logic-Engine/issues/143), [#146](https://github.com/necromorphic/Logic-Engine/issues/146), [#73](https://github.com/necromorphic/Logic-Engine/issues/73) — related Relationships/Personality compatibility and traceability; preserve distinct responsibilities.
- [#226](https://github.com/necromorphic/Logic-Engine/issues/226) — mechanics executor/recalculation seam.
- [#260](https://github.com/necromorphic/Logic-Engine/issues/260), [#262](https://github.com/necromorphic/Logic-Engine/issues/262) — Core interpretation and evaluation/recalculation boundaries.
- [#351](https://github.com/necromorphic/Logic-Engine/issues/351) — bounded Spatial/Temporal research.
- [#472](https://github.com/necromorphic/Logic-Engine/issues/472) — world-scoped event identity isolation.

**Issue cleanup recommendation:** no issue should be closed merely to reduce the count. First normalize cross-links, define one canonical acceptance checklist per workstream, and close only demonstrably superseded issues after their unique requirements have been transferred.

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

