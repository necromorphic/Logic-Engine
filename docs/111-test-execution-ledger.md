# Test Execution Ledger — Host/Core Integration

**Repository:** `necromorphic/Logic-Engine`  
**Target branch:** `integration/host-core-v1`  
**Last recorded candidate:** `a67ec46f09099499ba46e8e1be5d5f4abee63b06`  
**Record date:** 2026-11-11  
**Purpose:** Durable record of user-executed test results and the environment in which they were run. This ledger distinguishes automated suite PASS from full production acceptance.

## 1. Execution environment

| Field | Recorded value |
|---|---|
| Workstation OS | Windows (exact Windows release/build not captured) |
| Shell | Windows PowerShell |
| Local worktree | `C:\LogicEngine\Phase2-Acceptance\Logic-Engine` |
| Runtime | Node.js 22.18.0 |
| Test runner | Node built-in test runner: `node --import ./tests/configure-test-env.js --test ...` |
| Repository | `necromorphic/Logic-Engine` |
| Branch | `integration/host-core-v1` |
| Browser used for separate ST smoke checks | Microsoft Edge (exact version not captured) |
| CI constraint | GitHub-hosted Actions minutes exhausted; user has a self-hosted runner on their PC. Do not treat queued CI jobs as passed. |
| Test data | Isolated/disposable test fixtures and local SQLite databases where specified by each suite. Normal SillyTavern installation must keep Memory → NPC disabled. |

Exact Windows build, Node executable path, Edge version, runner labels/configuration, and machine details have not been captured. Do not infer them.

## 2. Successful user-executed test runs

All results below were reported from actual local test output in the project conversation. Unless explicitly stated otherwise, they are local Node test-runner results, not GitHub Actions results.

| Date / candidate | Scope | Result | Evidence / limits |
|---|---|---:|---|
| 2026-11-10, `801bd29a` | Host Gateway, lifecycle, identity baseline | **164/164 PASS** | Earlier Host candidate check; separate from the later Block 1/2 focused runs. |
| 2026-11-10, `dbc8a54b495d83c5c0fcb103cd56cac3a13e049f` | Receiver, Gateway composition, Host bridge, protected Final-Send | **57/57 PASS** | Run-ID separation, exact Core metadata contract, one-shot handoff, Receiver digest/envelope binding, Final-Send validation and tested sender routing. Not full live production chain. |
| 2026-11-10, `90375305b9b8710ad041b3abfe1de2ba617e89ad` and subsequent test run | Protected Final-Send negative-boundary coverage | **58/58 PASS** | Added malformed/missing run ID and digest denials; zero Gateway/provider calls for rejected cases. |
| 2026-11-10, `163abd7e1` | Five expanded Gateway/Final-Send regression suites | **113/113 PASS** | Revocation timing, source-version/cursor changes, streaming revalidation, sender families, ambiguous transport recovery, cross-process ordering. Uses controlled test harness/readers; not live production acceptance. |
| 2026-11-10, `c4109c0018db300a3edb3a246c10f078a3a59309` | Five suites including Receiver → Final-Send stale-context integration | **114/114 PASS** | Real Receiver and protected Final-Send adapter with SQLite-backed Gateway test fixture; stale source/record version rejected before DISPATCH_STARTED; zero Gateway/upstream calls. Provider evidence reader remains fixture-controlled. |
| 2026-11-10, `4a9d994e` | Focused Receiver/Gateway composition run | **28/28 PASS** | Historical milestone before later run-ID/public-envelope changes; superseded by later runs. |
| 2026-11-10, `33f9dc049c991778418e2b06f2e660504894f06f` | Host → Core HTTP → MemoryNpcConsumer → file-backed SQLite Provider E2E | **1/1 PASS** | Real retrieval route, independent SQLite checks, lineage/grant checks, revocation, invalid identity/inventory, HMAC/expiry/replay cases. Host inventory/root proof callbacks were explicit fixtures; not production Host authority proof. |
| 2026-11-11, `a67ec46f09099499ba46e8e1be5d5f4abee63b06` | `npc-context-receiver.test.mjs`, `npc-generation-context-runtime.test.js`, `host-core-sqlite-e2e.test.js` | **36/36 PASS** | Latest user-provided output. Includes live Host dispatch proxy → Core HTTP → MemoryNpcConsumer → real file-backed SQLite Provider retrieval and production Receiver consumption. Public five-field Core envelope and separately supplied trusted source lineage validated. |

### Latest run — exact command

Executed after fast-forward pull to `a67ec46f09099499ba46e8e1be5d5f4abee63b06`:

```powershell
node --import ./tests/configure-test-env.js --test ./tests/npc-context-receiver.test.mjs ./tests/npc-generation-context-runtime.test.js ./tests/host-core-sqlite-e2e.test.js
```

Output summary:
- tests: 36
- pass: 36
- fail: 0
- cancelled: 0
- skipped: 0
- todo: 0
- duration: 571.7362 ms
- Node emitted an ExperimentalWarning for SQLite; it did not fail the run.

The E2E test reported:
`Host dispatch proxy retrieves a real SQLite Provider record through Core HTTP and MemoryNpcConsumer` — PASS.

## 3. Failed or superseded runs — do not count as PASS

These are retained to explain the development history and must not be included in successful test totals:
- At `14daae320`, expanded suite initially reported 109/113; four failures were test fixture/expectation mismatches. Test-only fixture corrections followed.
- At `c250a6abd964d9e808aec2192df5426a3ce2f1f2`, focused suites reported 26 pass / 2 fail; fixture envelope and safe canonicalization were corrected.
- The first run after the public Core envelope change failed because the E2E passed the public HTTP response directly to Receiver without the Runtime-owned canonical source lineage. This led to the split public envelope + separately validated sourceLineage design. The corrected run is the 36/36 result above.
- Other earlier failures are described in the acceptance plan and commit history. They are not current PASS evidence.

## 4. What these results prove

At the latest recorded candidate, automated tests prove:
- Host dispatch proxy can retrieve a real record through Core HTTP, MemoryNpcConsumer, and file-backed SQLite Provider.
- The Core public Result Envelope remains exactly five fields: `status`, `admitted`, `candidates`, `reason`, `snapshot`.
- Private Provider cursor and canonical source lineage are not leaked into that public envelope.
- Runtime supplies canonical source lineage separately; Receiver joins it to admitted candidates by exact record reference/version and validates the relationship.
- Receiver/runtime validation, immutability, digest and malformed-input protections covered by the three latest suites pass.

## 5. Remaining gaps — automated PASS is not full acceptance

The following are **not** established by the recorded 36/36 run:
1. Production-authoritative Host inventory/root proof. Current E2E inventory enumeration and root-proof inputs remain explicit fixtures.
2. Full production Host authority resolver and independent proof that invalid/incomplete production inventory causes zero Core retrieval requests.
3. Production end-to-end composition through NPC Receiver → production Gateway → observed model transport/body.
4. Full Windows acceptance with real installed SillyTavern, production evidence readers, local outbound fake provider, restart/WAL/recovery and cross-process proof in the same composed run.

Block 1 is therefore **PARTIAL / NOT FULLY ACCEPTED** despite the targeted real SQLite retrieval E2E passing. Block 2 automated suites have passed, but full production Block 2 acceptance remains open. Do not enable Memory → NPC in the normal SillyTavern installation.

## 6. Rules for future ledger updates

For every new run, record:
- exact branch and full commit SHA;
- exact command and test file list;
- raw summary (tests/pass/fail/skipped/duration);
- environment changes (Node, OS, shell, database/runtime);
- whether each component is real, fixture-backed, or mocked;
- what the run proves and what it does not prove.

Never combine test counts from different commits into one synthetic run. Never call queued CI checks PASS. Preserve failed runs as failed/superseded history; append new entries rather than rewriting old evidence.


## 7. Windows Host Source Inventory run — 2026-11-11

**Branch:** `integration/host-core-v1`  
**Code candidate:** `540bdf05d174e451c2c4d399c125715cbcee137` (documentation-only ledger commit; inventory code unchanged from its parent candidate)  
**Environment:** Windows PowerShell, Node.js 22.18.0, local worktree `C:\LogicEngine\Phase2-Acceptance\Logic-Engine`.  
**Exact command:**

```powershell
node --test ./tests/host-source-inventory.test.js
```

**Raw summary:** 18 tests, 17 passed, 0 failed, 1 skipped, duration 39045.5727 ms.

The skipped test was:
`rejects symbolic links in enumerated roots` — skipped with the explicit reason that the VSS integration test separately verifies rejection of Windows reparse points.

Passed coverage reported:
- root, character and group chat file enumeration as a non-authoritative double-scan candidate;
- extraction of current conversation/message/swipe IDs and digests without raw message text;
- legacy records remain incomplete; no synthesized identity;
- persisted swipe and active edit revision digest mismatch rejection;
- edit revisions not represented as native swipe alternatives;
- duplicate conversation UUID rejection;
- pinned SillyTavern build enforcement;
- orphan/missing group chat rejection;
- hard-link alias, unknown entry, aliased root and bounded append-during-read rejection;
- current swipe identity and active selection verification;
- Windows pinned-source inventory uses an audited VSS point-in-time snapshot.

**Interpretation:** test suite PASS (17/17 executed, 0 failures; 1 intentional skip). The test confirms the tested Windows VSS snapshot path and inventory scanner behavior. It does not establish an authoritative production inventory, deployment-owned accepted-root authority, complete lifecycle history, or production Host→Core readiness. The scanner's documented state remains `DOUBLE_SCAN_CANDIDATE` / `NON_AUTHORITATIVE`. The skipped symlink test is not counted as a pass.


## 8. Ledger metadata correction

The 2026-11-11 Host Source Inventory run was executed after the user fast-forwarded the local worktree to documentation commit `540bdf05d174e451c2c4d399c125715cbcee137`. The inventory implementation under test was unchanged by that documentation-only commit. The ledger update itself is committed separately; do not attribute the test run to the ledger-update commit.
