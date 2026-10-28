# Memory Provider — real-environment acceptance report

**Date:** 2026-10-28  
**Verdict:** **B — confirmation incomplete**  
**Production Memory → NPC:** **DISABLED / FAIL-CLOSED**  
**Scope:** evidence inventory against the P0 acceptance specification. This report does not enable production traffic and does not introduce APIs, schemas, stores, journals, authorization mechanisms, or runtime wiring.

## 1. Version and scope (Stage A)

- Repository: [necromorphic/Logic-Engine](https://github.com/necromorphic/Logic-Engine)
- Main snapshot inspected: `9f653e3669c3bf042cc3ab36f91d615e784e69ff` ([commit](https://github.com/necromorphic/Logic-Engine/commit/9f653e3669c3bf042cc3ab36f91d615e784e69ff)).
- Provider integration merged into main: PR [#618](https://github.com/necromorphic/Logic-Engine/pull/618), merge commit `1ad46f96161778d8cf6f1bc66e8db31d56593f65`.
- Current package requirement: Node.js `>=22.13.0`; tests use Node's built-in `node:sqlite`. The repository `package.json` declares no external dependencies and no package lockfile was found at the inspected path.
- Confirmed Windows self-hosted execution on runner `DESKTOP-77V96AV`: Node.js `v22.18.0`, Git `2.50.1.windows.1`, Windows platform. The original run did not print the exact Windows build or `process.versions.sqlite`, so those remain **NOT RECORDED** for that run. This report branch adds an environment-recording step; its new run is pending and is not counted as evidence yet.
- Agreed Host target: SillyTavern `1.19.0-1-g06bde939f`, source SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Reproduction entry point from a checkout with a supported Node.js:
  - Full repository suite: `npm test`
  - Focused Provider suite:
    `node --import ./tests/configure-test-env.js --test tests/sqlite-memory-provider.test.js tests/memory-provider-typed-failures.test.js tests/memory-provider-reconcile-interruption.test.js tests/memory-provider-raw-archive.test.js`
- Confirmed execution after the initial report: GitHub Actions run [40728771597](https://github.com/necromorphic/Logic-Engine/actions/runs/40728771597) ran on self-hosted Windows runner `DESKTOP-77V96AV`, checked out merge commit `8efd61e5f1e89386b46a5a529ce928b63e0aa8f6`, and passed `npm test` **1022/1022** plus recalculation oracle **20/20**. This is the repository test suite on the user's Windows runner, not a separately launched Provider service or live SillyTavern integration. The focused Provider command and environment recording were added to this report branch's workflow; run [40730496450](https://github.com/necromorphic/Logic-Engine/actions/runs/40730496450) is pending and is not counted as a pass.

## 2. Evidence already present on main (separate from open PRs)

PR #618 is merged. Its Provider-owned slice includes file-backed Core/Provider accepted-head enforcement, record/query grant and revoke, index/reconciliation readiness transitions, exact-version tombstone/purge, pending-operation recovery, and rejection of an older restored Provider database against a newer independent accepted head. The Gateway uses the generic `host-selected-chat-generation` route and delegates to an injected Host-selected transport; it does not choose a model backend or contain provider credentials.

Reported exact-head evidence for the merged Provider slice:
- Focused real-writer/Gateway acceptance: **23/23 PASS**.
- Linux Runtime suite: **1022/1022 PASS**.
- Recalculation oracle: **20/20 PASS**.
- NPC-boundary: **PASS**.
- Windows Runtime execution on the self-hosted runner: **1022/1022 PASS**, recalculation oracle **20/20 PASS**; [run 40728771597](https://github.com/necromorphic/Logic-Engine/actions/runs/40728771597), merge commit `8efd61e5f1e89386b46a5a529ce928b63e0aa8f6`. This confirms automated tests on the Windows runner only; it does not establish a live Provider process or SillyTavern→Provider path.
- Evidence discussion: [Provider blocker #181](https://github.com/necromorphic/Logic-Engine/issues/181), [global gate #264](https://github.com/necromorphic/Logic-Engine/issues/264), [Core gate #140](https://github.com/necromorphic/Logic-Engine/issues/140).

These are automated repository/acceptance tests, including file-backed SQLite and an injected transport. They are not proof of a live installed SillyTavern → Host → Provider → Core → NPC path or target-PC deployment isolation.

Open candidates are not counted as mainline implementation:
- [Host lifecycle PR #456](https://github.com/necromorphic/Logic-Engine/pull/456): candidate only; not merged.
- [Core source-version ledger PR #599](https://github.com/necromorphic/Logic-Engine/pull/599): draft, not merged.
- [Protected-dispatch deny-only PR #561](https://github.com/necromorphic/Logic-Engine/pull/561): draft, not merged; denial is not proof of a positive sole-egress route.

## 3. Stage B — Provider behavior

| Required behavior | Evidence currently available | Classification | Status |
|---|---|---|---|
| Persist a new message version and read that exact version | Provider file-backed tests and acceptance slice | Automated integration/test harness | PASS within tested Provider boundary |
| Duplicate delivery is idempotent | Raw archive/provider lifecycle tests cover idempotent retry vs identity conflict | Automated integration/test harness | PASS within tested Provider boundary |
| Same version identity with different content fails closed | Raw archive lifecycle regression | Automated integration/test harness | PASS within tested Provider boundary |
| Switching active version preserves prior version | Raw archive lifecycle regression | Automated integration/test harness | PASS within tested Provider boundary |
| Deletion/revocation excludes version from active reads | Provider lifecycle and revoke tests | Automated integration/test harness | PASS within tested Provider boundary |
| Restart/replay does not revive revoked data | Provider restart/deletion tests and accepted-head recovery tests | Automated integration/test harness | PASS within tested Provider boundary |
| Interrupted reconciliation cannot report ready | Interruption test closes/reopens the same SQLite database and requires successful full reconciliation before retrieval resumes | Automated integration/test harness | PASS within tested Provider boundary |
| Independent operator repeats all scenarios in a real standalone Provider process and preserves before/after DB snapshots plus logs | No complete reproducible evidence bundle from a separately launched real Provider process was found | Real-process execution | **NOT TESTED** |

Relevant current-main tests include `tests/sqlite-memory-provider.test.js`, `tests/memory-provider-typed-failures.test.js`, `tests/memory-provider-reconcile-interruption.test.js`, and `tests/memory-provider-raw-archive.test.js`. The existing tests use temporary file-backed SQLite databases, but still run as test harnesses rather than an independently deployed Provider service.

## 4. Stage C — real Host → Provider lifecycle

Pinned Host source is specified in issue #258 and the global gate #264. PR #456 contains a Host lifecycle candidate and reported passing patch/Chromium restart/source-audit checks on candidate heads, but it remains unmerged. Its latest reported candidate also identifies the lack of an independent authoritative all-time inventory and the lack of a live installed SillyTavern/device run.

| Scenario | What is proven | Status for required real Host → Provider path |
|---|---|---|
| Create/save, edit, swipe create/switch/delete, message delete | Candidate source audit and automated Host patch tests; not integrated into main | **BLOCKED** |
| Cancelled generation, single/group chat, import/branch/restore, restart/replay | Some candidate test coverage; no complete live runtime evidence | **NOT TESTED** end-to-end |
| Stable identity/version and complete inventory of active, historical, deleted versions | No independent rollback-resistant Host inventory mechanism proven | **BLOCKED — Host/Core** |
| Installed pinned SillyTavern and real Provider process | No live installed-browser/Android-Termux run reported | **NOT TESTED** |
| Restore from backup then reconcile | Provider-local old-DB-vs-independent-head test exists; Host inventory and target deployment restore are not proven | **PARTIAL / BLOCKED** |

Do not treat PR #456 test results as mainline behavior or as real-device evidence.

## 5. Stage D — dispatch boundary and races

| Race / invariant | Evidence | Status |
|---|---|---|
| Revoke before durable `DISPATCH_STARTED` | Barrier-controlled real Provider-writer/Gateway test asserts zero upstream calls and zero dispatch-ledger rows | PASS within tested Gateway/Provider harness |
| Readiness loss before dispatch-start | Acceptance test asserts zero upstream calls and zero ledger rows | PASS within tested Gateway/Provider harness |
| Dispatch-start wins first | Test permits exactly one in-flight call; ambiguous outcome is not retried | PASS for tested bounded ordering |
| Tombstone/purge and accepted-head advance | Provider acceptance test | PASS within tested boundary |
| Restore older Provider DB against newer independent accepted head | Explicit test rejects stale Provider snapshot | PASS for that test configuration |
| Actual installed Host routes all use Gateway as sole outbound egress | No proof for every route/plugin/proxy/external tool or live installation | **BLOCKED — Host/Core/deployment** |
| Independent accepted-head authority remains rollback-resistant across coordinated authority+database restore on target deployment | Target deployment and joint-restore evidence absent | **NOT TESTED / BLOCKED** |

The race tests prove the tested ordering and harness behavior. They do not prove atomicity between a real installed Host's final serialized model request and every possible outbound transport.

## 6. Stage E — persistence, restore, and access controls

- **PASS within automated test boundary:** Provider restart/recovery, pending operation recovery, stale Provider database rejection against an independently newer accepted head, and file-backed SQLite lifecycle tests.
- **NOT TESTED:** process kill/crash matrix on a separately launched deployment with retained logs and before/after DB snapshots.
- **NOT TESTED:** corruption and partial restore matrix against the target deployment.
- **NOT TESTED:** actual target-PC ACL matrix for Core, Provider, Gateway, and SQLite `-wal`/`-shm` files under distinct service identities.
- **BLOCKED:** independent remote anti-rollback authority deployment and proof that coordinated restore cannot roll back the authority itself.
- **NOT TESTED:** backup/restore on the target PC proving revoked data cannot be revived across the complete Host/Core/Provider inventory.
- A disposable fixture showing read-only database access is not equivalent to target-PC ACL or service-identity isolation. Follow the [target-PC security acceptance runbook](https://github.com/necromorphic/Logic-Engine/blob/main/docs/security/target-pc-security-acceptance-runbook.md); do not apply ACL changes to a live database before verifying backup and rollback.

## 7. Overall decision

**Verdict B — confirmation incomplete.**

The Provider-owned implementation/test slice is present in main and has strong automated file-backed acceptance coverage for version lifecycle, revocation/readiness, bounded dispatch ordering, restart recovery, and stale Provider DB rejection. That is not enough to certify real deployment operation under the acceptance specification.

### Remaining blockers and minimum next steps

1. **Host (#258 / #264):** complete the current-main Host integration review; run the exact pinned SillyTavern checkout with a real Provider process; capture before/after state and redacted logs for every required lifecycle scenario. Prove complete active + historical/deleted inventory or mark the missing inventory authority as a blocker.
2. **Core (#140 / #264):** finish review/approval of the exact Core source-authority diff and prove rollback/retraction invalidation is ordered against the actual durable dispatch-start. Do not implement an unapproved schema/API.
3. **Deployment/security (#264):** run the target-PC service-identity ACL and backup/restore matrix on a disposable deployment first; prove independent authority survives a coordinated old-backup restore.
4. **Evidence owner:** publish the exact execution environment versions, commands, redacted logs, before/after state digests, and CI/run links for the exact tested HEAD. Label every result as unit, test-harness integration, live process, or target deployment.

**Production remains disabled.** This report does not approve Memory → NPC, change the existing vectorization/Ollama remote-store patch, or authorize new runtime mechanisms.


## 8. Supplemental Windows execution record (2026-10-28)

- Self-hosted runner: `DESKTOP-77V96AV` (Windows, X64).
- Tested checkout: merge commit `8efd61e5f1e89386b46a5a529ce928b63e0aa8f6`, combining the inspected main snapshot with the documentation-only PR.
- Runtime: Node.js `v22.18.0`; Git `2.50.1.windows.1`.
- Results: `npm test` 1022/1022 passed, 0 failed; recalculation oracle 20/20 passed, 0 failed.
- Evidence: [GitHub Actions run 40728771597](https://github.com/necromorphic/Logic-Engine/actions/runs/40728771597).
- Exact Windows OS build and embedded SQLite version were not printed in that run. A focused Provider acceptance suite plus environment-version capture has been added to the workflow in this PR. Run [40730496450](https://github.com/necromorphic/Logic-Engine/actions/runs/40730496450) was queued when this addendum was written; it is not counted as a pass until its Windows job completes.
- **Still NOT TESTED:** separately launched Provider process with retained DB snapshots/logs; installed pinned SillyTavern lifecycle; target-PC ACL/restore/anti-rollback; complete sole-egress proof. The new workflow does not close these gaps.
