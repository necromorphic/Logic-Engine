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


## 9. Production Final-Send egress composition added — NOT TESTED

**Implementation commit:** `389583dcfd667b240420850ebfc755f3f3b99de7`  
**Test:** `tests/memory-dispatch-gateway.test.js` — `production SillyTavern Final-Send adapter carries the immutable Receiver canary to one observed model egress`.

The new test composes:
- the actual `receiveNpcContext()` implementation and its immutable accepted projection;
- the actual `createSillyTavernFinalSendAdapter()` used by the SillyTavern Final-Send integration;
- the actual `createProtectedMemoryFinalSend()` and `MemoryDispatchGateway`;
- a deterministic in-process fake model transport that captures the exact serialized outbound HTTP body;
- the Gateway dispatch ledger and Host response-release authorization.

Assertions require the unique Receiver canary and original user prompt in the captured outbound body, exactly one model transport invocation, a durable `DISPATCH_STARTED` before Host response release, and `COMPLETED` only after the authorized response write.

**Evidence limitation:** this is a production-adapter/transport composition test, but its Core, Provider, and Host evidence readers are controlled by the existing Gateway test fixture. It does not prove production accepted-head authority, production Host root inventory, or full installed SillyTavern composition. It does not replace Blocks 1 or 4.

**Execution status:** NOT TESTED. No result is claimed until the user runs the focused command on Windows and supplies the raw output. Keep Memory → NPC disabled in the normal SillyTavern installation.


## 10. Windows production Final-Send adapter egress test — 2026-11-11

**Branch:** `integration/host-core-v1`  
**Execution commit:** `2f991c681ec2dc5ac7bd9b07669b43c58b9e987b`  
**Environment:** Windows PowerShell, Node.js 22.18.0, local worktree `C:\\LogicEngine\\Phase2-Acceptance\\Logic-Engine`.  
**Exact command:**

```powershell
node --import ./tests/configure-test-env.js --test --test-reporter=tap --test-name-pattern="production SillyTavern Final-Send adapter carries" ./tests/memory-dispatch-gateway.test.js
```

**Raw summary:** 1 test, 1 passed, 0 failed, 0 cancelled, 0 skipped, duration 654.7485 ms.

**Result:** PASS for this focused automated composition test. The actual Receiver accepted the supplied Host scope and canonical source lineage; the production SillyTavern Final-Send adapter carried the immutable Receiver canary and original Host prompt into the captured outbound body; exactly one fake model transport call occurred; the durable dispatch ledger was `DISPATCH_STARTED` before response release and `COMPLETED` after authorized response write.

**Correction preceding the passing run:** the first run at `91dea2eb87fba777a1f951943bb0ec9f3d9cf61b` failed with `NPC_CONTEXT_SCOPE_INVALID` at the Receiver call. The test fixture omitted the required Host binding scope fields (`adapter_id`, `world_id`, `actor_id`, `actor_type`) and used a source version outside the canonical `core-entity-v1:<n>` format. Commit `2f991c681ec2dc5ac7bd9b07669b43c58b9e987b` corrected those fixture inputs. The failure is retained as superseded history, not counted as a pass.

**Evidence limitation:** Core, Provider, and Host evidence readers remain fixture-backed. The model transport is a deterministic in-process fake, not an installed SillyTavern outbound provider. This run does not establish production root authority, production Host inventory, live model API connectivity, or full Windows acceptance. It is not a full Block 3 or Block 4 PASS. Memory → NPC remains disabled in the normal SillyTavern installation.


## 11. Final-Send duplicate-dispatch guard extension — NOT TESTED

**Implementation commit:** `30efb64a244b7edde334be1c9c7f3bc6e6444f91`

The previously passing production-adapter egress test was extended to attempt a second dispatch using the same Host request/response after the first dispatch completed. It now requires:
- second dispatch rejected with `MEMORY_DISPATCH_DUPLICATE_HOST_SEND`;
- no second model transport invocation;
- response release after duplicate denial rejected with `MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED`;
- no second Host response write.

The 1/1 PASS in section 10 applies to the earlier test version at `2f991c681ec2dc5ac7bd9b07669b43c58b9e987b`; it does not cover these newly added duplicate-dispatch assertions. The extended test is **NOT TESTED** until rerun on Windows. Fixture-backed evidence limitations from section 10 remain unchanged.


**Failure analysis and correction — 2026-11-11:** the first extended run at `24937d4e12f3cd7e0f6cfb54dd7b904d2f691e52` failed because `dispatch()` replaced the response's existing `COMPLETED` release state with a new `pending` entry before checking the duplicate-response WeakSet. The test correctly detected that the duplicate attempt was not synchronously rejected. Commit `3628593a737fd1607535e1e25b154e07709dea7a` moves the duplicate check to the beginning of dispatch, before context resolution or response-capability replacement, and marks the existing release state denied. The corrected implementation and extended test are **NOT TESTED** pending a new Windows run.


## Duplicate Final-Send regression — Windows PASS

- **Date:** 2026-11-11
- **Branch:** `integration/host-core-v1`
- **Tested HEAD:** `0aa7e2ebcf6e61f3413a700aa5a81b98290d038a`
- **Environment:** Windows PowerShell, Node.js 22.18.0
- **Command:**
  `node --import ./tests/configure-test-env.js --test --test-reporter=tap --test-name-pattern="production SillyTavern Final-Send adapter carries" ./tests/memory-dispatch-gateway.test.js`
- **Result:** 1 test, 1 pass, 0 fail, 0 cancelled, 0 skipped; duration 661.7026 ms.
- **Verified:** immutable Receiver canary reaches one observed model egress; a second dispatch using the same Host response is synchronously denied; no second model transport call occurs; response release after duplicate denial is rejected.
- **Scope limitation:** fixture-backed Core/Provider/Host evidence readers and deterministic in-process fake model transport. This does not prove live installed SillyTavern composition, independent production Root Authority/Host Inventory, or full acceptance Blocks 1–4.
- **SQLite ExperimentalWarning:** informational; test passed.


### 2026-11-11 — OpenAI-compatible SillyTavern streaming adapter composition added (NOT TESTED)

Added an adapter-level streaming composition test using the actual Receiver, SillyTavern Final-Send adapter, protected serializer, and SQLite-backed Gateway fixture. The Host request follows the chat-completions route shape (chat_completion_source, messages, stream); the provider request uses an OpenAI-compatible chat-completions body (model, messages, stream, stream_options). A deterministic fake transport captures the exact serialized outbound body. A simulated Host streaming writer sends two chunks and the terminal event, with each write passed through the adapter's response-release authorization.

The test asserts one provider handoff, exact prompt preservation, Receiver canary insertion, streaming flags/options preservation, per-chunk authorization, and COMPLETED only after the final authorized write.

**Evidence boundary:** this is an OpenAI-compatible protocol fixture, not a live installed SillyTavern process or a captured request from the supplied ST release archive. Gateway evidence readers remain fixture-backed. It is NOT TESTED until executed on Windows.


### 2026-11-11 — SillyTavern source-backed OpenAI streaming contract correction (NOT TESTED)

Corrected the streaming Final-Send adapter test to match the supplied SillyTavern release source instead of a hand-invented provider payload.

Source contract inspected:
- `public/scripts/openai.js`: `createGenerationParameters()` builds the Host `generate_data` object posted to `/api/backends/chat-completions/generate`. It includes ST-specific fields such as `type`, `chat_completion_source`, user/character metadata, generation settings, and `stream`.
- `src/endpoints/backends/chat-completions.js`: the OpenAI branch separately constructs the outbound `requestBody` from `messages`, `model`, `temperature`, `max_tokens`, `stream`, penalties, `top_p`, `seed`, and supported optional parameters. ST routing fields are not forwarded. The pinned backend does not add or forward `stream_options` in this path.

The revised test now supplies a source-shaped Host `generate_data` body and a distinct source-derived OpenAI provider body. It asserts that the adapter injects Receiver context into the provider `messages`, preserves the original user prompt and supported generation fields, does not leak ST-only routing fields, and does not assume `stream_options` is forwarded. The SSE write/release assertions remain.

Commit:
- `94544adf6a307c589943a63fe245d77b7800c389` — align streaming adapter contract with SillyTavern source.

**Execution status:** NOT TESTED. This remains an adapter composition test using fixture-backed Host/Core/Provider evidence readers and a deterministic fake transport. It is source-backed at the request-shape boundary, not a live installed SillyTavern test and not proof of full production composition. Run the focused command recorded in the current task handoff before accepting this correction.


### 2026-11-11 — Source-backed SillyTavern OpenAI streaming adapter test (PASS)

Environment: Windows PowerShell, Node.js (project runtime).

Command:
```powershell
node --import ./tests/configure-test-env.js --test --test-reporter=tap --test-name-pattern="SillyTavern OpenAI-compatible streaming request carries" ./tests/memory-dispatch-gateway.test.js
```

Result: **1 test passed, 0 failed, 0 cancelled, 0 skipped** (873.62 ms total; subtest 790.1515 ms). SQLite emitted Node's ExperimentalWarning; it did not affect the result.

The source-backed test verifies the distinct ST Host `generate_data` and OpenAI provider request-body shapes, Receiver context insertion, preservation of prompt and supported generation fields, exclusion of ST-only routing fields, and per-chunk Host release through final SSE completion.

Scope limitation: this is still an adapter-level composition test with fixture-backed evidence readers and deterministic fake provider transport. It is not a live installed SillyTavern / real provider integration test, and it does not establish full production acceptance.

Tested commit: `afe9bdcdf7e0b98a2b527db6ce2185194568742d`.
