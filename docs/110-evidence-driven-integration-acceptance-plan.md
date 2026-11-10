# Evidence-Driven Integration Acceptance Plan

**Status:** ACTIVE PLAN  
**Baseline candidate:** `integration/host-core-v1` at `28c49e61ae806e055267bf8e2365cf35a38a4cca`  
**Baseline date:** 2026-11-10

## Purpose

Prove that protected Memory data traverses the actual deployed Logic Engine path and reaches the intended model transport, rather than treating HTTP 200, plugin initialization, a successful ordinary model response, or mocked callbacks as proof.

## Evidence rules

A component is PASS only when:
1. the real component under test executes in the integrated runtime;
2. its output is checked independently at the next boundary;
3. the evidence is correlated to the same run/request and exact record/source version;
4. negative cases prove that protected content does not cross the boundary when authorization or integrity fails.

Use these result states:
- **PASS** — behavior and its independently observed effect are proven.
- **FAIL** — observed behavior violates the contract.
- **BLOCKED** — a required real component or authoritative evidence source is not wired, so the next claim cannot be tested honestly.
- **NOT TESTED** — the check has not been executed.

HTTP status, logs, plugin load messages, function invocation counts, and mocked return values are supporting diagnostics only. None is sufficient alone for PASS.

## Confirmed baseline (2026-11-10)

The isolated Windows deployment smoke test at candidate `28c49e61ae806e055267bf8e2365cf35a38a4cca`:
- installed pinned SillyTavern `06bde939fb1e9c4c8d8641d810f0a916b5bce127`;
- installed and verified the Host patch bundle and Final-Send plugin;
- loaded the Host Gateway server plugin and Final-Send Hook;
- started Core and SillyTavern on loopback-only ports;
- passed SQLite integrity verification with no missing tables and no writes;
- passed ordinary Kobold Horde generation;
- passed eight user-performed browser checks: load UI, open chat, send, generate, save, reload, restore same chat/history, and generate again.

This proves baseline isolated deployment and ordinary SillyTavern chat behavior. It does **not** prove Memory → NPC, authoritative Provider writes, production Gateway transport, or Final-Send enforcement.

## Work sequence

### Block 1 — Real Host → Core HTTP → MemoryNpcConsumer → SQLite Provider retrieval

Start from `tests/host-core-sqlite-e2e.test.js`, but distinguish real runtime components from test fixtures.

Required work:
- retain the real file-backed SQLite Provider, Core HTTP server, MemoryNpcConsumer, Host Adapter middleware/dispatch proxy, and signed assertion path;
- seed one unique canary record, e.g. `LE_ACCEPTANCE_SECRET_<RUN_UUID>`, with an exact `record_ref`, `record_version`, canonical source ID/version, and lineage;
- retrieve through the Host Adapter and Core HTTP route;
- verify the exact canary, record reference/version, source version, authorization scope, and Result Envelope fields;
- independently open the Provider SQLite database read-only through a separate connection and verify the persisted record/index/grants and SQLite integrity; do not use the Provider instance's in-memory return value as the only evidence;
- revoke the query and record grants and prove the canary is absent from the returned envelope;
- prove invalid Host identity and incomplete/non-authoritative inventory result in zero Core retrieval requests;
- prove tampered/expired/replayed assertions are rejected and do not disclose the canary;
- label every Host inventory/root-proof fixture as a fixture; do not call fixture-backed authority a real deployment proof.

PASS requires exact canary content and metadata to be observed after the real retrieval route, independently corroborated against the Provider database, and absent after revocation/invalid authorization.

### Block 2 — NPC Context Receiver

Prove that the actual Receiver consumes the exact Result Envelope from Block 1:
- preserve the same run ID, request ID, record reference/version, source version, and envelope digest;
- reject a modified envelope, mismatched lineage, stale source, duplicate handoff, or replayed one-shot capability;
- independently inspect the immutable context handed to Final-Send;
- prove no protected context is created when Block 1 is blocked or denied.

PASS requires exact identity continuity from the Core Result Envelope into the immutable NPC context and fail-closed behavior for tampering/replay.

### Block 3 — Final-Send and real model transport

Replace the current non-transport Gateway stub with the real production evidence readers and transport composition before claiming production readiness.

Use a local deterministic fake model provider as the egress observer:
- run the actual pinned SillyTavern native sender and managed Final-Send Hook;
- capture the exact outbound request body at the provider boundary;
- prove the unique canary is present only in the authorized protected generation;
- verify body digest, request/dispatch IDs, `DISPATCH_STARTED`, and exactly one upstream call;
- prove zero upstream calls for invalid identity, incomplete inventory, unavailable Provider/Gateway, tampered Receiver envelope, revoked query/record grants, or stale source;
- test retry/ambiguous transport failure and prove no duplicate upstream send;
- test revoke-vs-dispatch races in both orderings and verify the documented terminal state.

PASS requires the actual outbound request body to contain the authorized canary, with matching evidence identifiers and exactly one transport call. An internal prompt-builder value or a successful model response is not sufficient.

### Block 4 — Full Windows Acceptance

Run the composed flow in disposable Windows SillyTavern with:
- real isolated Core and file-backed Provider SQLite databases;
- authoritative Host inventory/evidence readers (not fixture callbacks);
- real NPC Receiver and production Gateway transport;
- local deterministic fake provider;
- all supported registered sender routes, streaming and non-streaming;
- restart, WAL/recovery, cross-process locking, replay, revoke, and crash/ambiguous-send tests.

The test report must record exact Logic Engine and SillyTavern commits, run ID, request ID, record/source versions, envelope/context/body digests, DB integrity, dispatch state, transport call count, and every negative-case outcome.

## Current known blockers

The contract document `Host-Core-Integration-Contract-v1.md` states that:
- the existing Host-Core-SQLite E2E uses explicit test fixtures for inventory enumeration and root proof;
- the current integration branch composes the Host request resolver, NPC Context Receiver and body serializer, but the server plugin uses a non-transport Gateway stub;
- production remains NON_READY until synchronous Core, Provider and Host evidence readers are supplied under the shared Coordinator and exact-head acceptance passes.

These blockers must be resolved by implementation and evidence, not waived by changing expected statuses.

## Progress log

### 2026-11-10 — Block 1 targeted E2E executed successfully

The Host-Core-SQLite E2E test was extended to:
- seed a per-run unique canary in the canonical Core entity;
- retrieve it through the Host Adapter → Core HTTP → MemoryNpcConsumer → file-backed SQLite Provider route;
- open the Core and Provider databases independently in read-only mode;
- verify SQLite integrity, canonical entity content/source version, Provider record metadata/lineage, index entry, and query/record grants;
- revoke the record grant and then the query grant, verifying both durable grant state and absence of the canary from retrieval output;
- reject mismatched Host session identity and incomplete inventory before another Core retrieval request;
- reject tampered, expired, and replayed signed assertions.

The first local run exposed a test assertion that compared the canonical source version token (`core-entity-v1:1`) directly with the raw SQLite integer (`1`). Core intentionally exposes the prefixed token while persisting the integer. The assertion was corrected to verify the exact mapping.

**Execution evidence:** User ran the targeted test on branch `integration/host-core-v1`, commit `33f9dc049c991778418e2b06f2e660504894f06f`, using Node 22.18.0 on Windows:
- 1 test, 1 pass, 0 fail, 0 skipped;
- test: `Host dispatch proxy retrieves a real SQLite Provider record through Core HTTP and MemoryNpcConsumer`;
- duration: 495.57 ms (reported test duration);
- independent Core and Provider SQLite integrity checks and record/lineage/grant assertions completed;
- record and query grant revocation checks completed;
- identity mismatch, incomplete inventory, invalid HMAC, expired assertion, and replay rejection checks completed.

**Disposition:** Block 1 PASS for the targeted fixture-backed integration E2E. Host inventory enumeration, Root Inventory persistence, and authority resolver are explicit test fixtures; this is not proof of production Host authority or production Memory → NPC enablement. Keep Memory → NPC disabled in the normal SillyTavern installation.

### 2026-11-10 — Block 2 production Receiver wiring (implementation added, NOT TESTED)

The production `index.mjs` path now imports and invokes `receiveNpcContext()` after consuming the one-shot Core dispatch handoff and validating Lane B admission/source correspondence.

Implementation changes:
- builds the Receiver input only from the consumed server-side Core context, Lane B candidates, admitted candidate metadata, snapshot, provider evidence cursor, and authenticated Host/Core bindings;
- normalizes candidate fields to the Receiver's exact data-record contract;
- keeps the existing content projection after Receiver validation and immutable copying;
- sources the Final-Send metadata, source list, candidate list, host binding and snapshot from the Receiver output;
- routes complete-empty results through the Receiver before classifying them as explicitly unprotected;
- updates production-composition fixtures to use valid Host identity/conversation bindings and asserts that the handed-off context and nested collections are frozen.

Commits:
- `12d4d28f5054b6dba7718024e4c65f4c3bcaff7d` — wire strict NPC Context Receiver into production Final-Send path;
- `3b8a2beb586908f46c586294308de8b44e112f69` — normalize trusted Core candidates for strict NPC receiver;
- `7bed12237fec6aed35d6c300c8e67fa6869133c6` — align composition fixtures with Host identity contract;
- `7f3ce764c36b68356293aa4b0b7d4bc1db2e0e98` — make Receiver fixtures satisfy immutable context contract;
- `b56cdf68b90b0dcb04bf2f735c9743f85726accf` — assert immutable NPC context at production projection boundary;
- `dce25ee0052762bb1cec0e22b2149e96ebef0d49` — route complete-empty results through Receiver.

**Execution status:** NOT TESTED. No local Node test run has been performed for these commits.

**Remaining Block 2 evidence gaps:** The current Receiver output does not carry an envelope digest or explicit run ID, and the production handoff path still needs a test proving exact request/generation/record/source continuity plus duplicate/replay rejection at the actual Receiver boundary. These are required before Block 2 can pass. Do not enable Memory → NPC in normal SillyTavern.

## Next execution target

Proceed to Block 2 — NPC Context Receiver. Preserve the fixture limitations above and do not claim production readiness. Continue using disposable local test data and loopback-only services.

### 2026-11-10 — Block 2 first local test run and fixture corrections (NOT TESTED after fixes)

User ran `npc-context-receiver.test.mjs` and `gateway-final-send-composition.test.js`: 23 passed, 2 failed. The focused Receiver tests all passed. The two failures were:
- stale source assertion expected the pre-Receiver empty-context expression; updated to assert the post-Receiver expression;
- production composition fixture had `conversation_uuid` set to the installation UUID instead of the conversation UUID, causing the strict Receiver to reject scope with `NPC_CONTEXT_SCOPE_INVALID`; corrected the fixture to use the conversation UUID already embedded in both Host/Core conversation identifiers.

Fix commits: `72e8a5ac91412eac3be66bc114a9d49c09f21a21` and `98e0b563e75259a40b503ad5e704aa847750a89c`.

**Execution status:** fixes are committed but NOT TESTED. Block 2 remains NOT TESTED. No claim of production acceptance is made.


### 2026-11-10 — Block 2 Receiver composition tests pass; generation digest work added (NOT TESTED)

The user executed the focused Receiver and Gateway composition suites after the null-prototype assertion correction:
- 25 tests, 25 passed, 0 failed, 0 skipped;
- this verifies the Receiver's existing strict candidate/scope/content checks and its composition into the prepared Host/Core Final-Send path at that tested commit.

Follow-up implementation adds:
- mandatory UUID `generationId` input to the Receiver;
- deterministic SHA-256 `contextDigest` over the immutable accepted projection, including request/generation IDs, model/purpose, world/actor, source and record metadata, copied content blocks, snapshot, Provider evidence cursor, and Host binding;
- propagation of `generationId` and `contextDigest` from Receiver output into the Final-Send protected-memory projection;
- unit coverage for stable digest on equivalent input, digest change on admitted content change, and rejection of missing/malformed generation identity;
- composition assertions for generation ID and digest.

Commits:
- `20f5f00fbfa27385aaef1095dacd50091c160d6d` — Receiver generation identity and deterministic context digest;
- `82b2b155fa220501079ca12c643a92f7c31a446a` — preserve Receiver generation/digest into Final-Send;
- `28eb7bff0af7e5d355d19c715f1371f892adf626` — Receiver digest and generation identity tests;
- `84ad9e2dfeaafa58c217b1114188533c9a61520e` — composition assertions.

**Important boundary:** `contextDigest` is calculated by the Receiver over the immutable accepted projection. It is not yet proven to be the digest of the original Core Result Envelope from Block 1. Exact original-envelope digest continuity and run-ID continuity remain open. The bridge's one-shot lifecycle slot provides a replay barrier, but duplicate/replay behavior at the integrated production Receiver boundary still requires an explicit test.

**Execution status:** The prior 25/25 run predates these generation/digest changes. New code and tests are NOT TESTED. Block 2 remains NOT TESTED; do not enable Memory → NPC in normal SillyTavern.


The follow-up also adds an explicit test of the production Host bridge's one-shot lifecycle: one prepared request can be consumed once; a second dispatch for the same request is rejected before a second Core handoff consumption. This test is committed but not yet executed.

- `8f915b5f35854a0be784efbae6072537b72c68e5` — one-shot bridge duplicate-dispatch test.


### 2026-11-10 — Block 2 original Core envelope digest wired (NOT TESTED)

User ran the focused Receiver and Gateway composition suites at `f7d60c57f7d925848fc1542efbe66f1aeed1d3db`: 28 tests passed, 0 failed. This confirms the generation identity/context digest and one-shot bridge tests added before that run.

Follow-up implementation now:
- passes the original immutable Core Lane B Result Envelope (`laneBContext.result`) directly into `receiveNpcContext`, instead of rebuilding a lookalike envelope from separately projected candidate arrays;
- calculates `coreEnvelopeDigest` as SHA-256 over canonical JSON of that exact envelope before Receiver projection;
- includes the Core envelope digest in the Receiver's immutable evidence digest and output;
- propagates `coreEnvelopeDigest` into the Final-Send protected-memory projection;
- adds assertions that the original-envelope digest exists, changes when the envelope content changes, and reaches Final-Send.

Commits:
- `a0685a1fa099b56d246fb221d83077a93363988b` — exact Core envelope digest in Receiver;
- `1a01dfd7782b3362e60b1f8c629368ece86df42d` — pass original Core result and propagate digest;
- `55bc9cf16f26fedf8bf718c88bbde55541f5290b` — Receiver envelope digest assertions;
- `ff4e5611a6aa0a8c79fb86f8ed471122ab4a079a` — Final-Send digest assertion.

`runId` is still absent from the current Host/Core request metadata contract; only `request_id` and `generation_id` are currently generated. It remains a separate implementation task and must not be inferred from `generation_id`.

**Execution status:** New original-envelope digest changes and tests are NOT TESTED. Block 2 remains NOT TESTED; Memory → NPC must remain disabled in normal SillyTavern.


### 2026-11-10 — Block 2 failed run triage and corrective changes (NOT TESTED)

User executed the focused suites at `c250a6abd964d9e808aec2192df5426a3ce2f1f2`: 26 passed, 2 failed.

Failures:
- Production composition fixture omitted the exact Core Result Envelope at `context.lanes.lane_b.result`. The production code correctly passes that original envelope to the Receiver; the fixture was stale and produced `NPC_CONTEXT_NON_READY`. Updated the fixture to supply the exact ready envelope shape, including admitted records, candidates, snapshot, reason, and Provider cursor.
- Safe digest canonicalization accessed object properties directly before candidate descriptor validation, allowing an accessor getter to execute. Reworked canonicalization to reject Proxy objects, accessors, unsupported prototypes, cycles, sparse arrays, and invalid values using property descriptors without invoking getters. The test continues to require `NPC_CONTEXT_CANDIDATE_INVALID`.

Commits:
- `a6caceedd839f38fd3869e16251584d5cdd791ab` — safe canonicalization rejects accessor/Proxy objects without executing getters;
- `d939bd888ef3566d7bd4fc60fab37b9e58088d93` — composition fixture supplies the original Core Result Envelope;
- `e2879306fbfaab6be30678427030f95d38df9c21` — preserve valid shared JSON references while canonicalizing.

**Execution status:** corrective changes are committed but NOT TESTED. Re-run both focused suites before further implementation. Block 2 remains NOT TESTED; keep Memory → NPC disabled in normal SillyTavern.


### 2026-11-10 — Block 2 Host run correlation added (NOT TESTED)

The 28/28 focused Receiver/composition test run at commit `4a9d994e` is recorded as successful. Follow-up implementation adds a distinct Host-generated `run_id` without changing Core's existing exact three-field generation request contract:
- Host metadata now generates separate UUIDs for `run_id`, `request_id`, and `generation_id`;
- the Host bridge validates and retains `run_id` beside the opaque one-shot Core handoff, while passing only `request_id`, `generation_id`, and `generation_type` into Core;
- the bridge returns the Host run ID only when the matching request/response handoff is consumed;
- the strict NPC Receiver requires `runId`, includes it in the immutable context digest, and returns it in the accepted context;
- production projection carries `runId` into Final-Send, whose protected-context validator now requires valid run ID, context digest, and original Core envelope digest.

**Contract boundary:** the existing Core Result Envelope schema has no run ID and must remain unchanged. Therefore `run_id` is a Host-owned run correlation bound to the exact one-shot handoff, not a field claimed to originate inside Core's Result Envelope. The original Core envelope is independently bound by `coreEnvelopeDigest`. This preserves the exact Core contract rather than silently extending it.

Commits:
- `e118c68e6ffe35956a77b1479c75710e59c24abc` — distinct Host run ID generation;
- `424376c3f9262e90eb0eecfe880c28936c24e8f4` — retain run ID alongside exact Core handoff;
- `1fa421227fd8bb11bcd384a9587f5be6ce0bafc2` — bind run ID into immutable Receiver digest/output;
- `e2be7f7822620646e95e712d56b099007636cac8` — production projection propagation;
- `f55175d994320c75548b3bbfff9470595172ac56` — composition assertion;
- `ae390faec0ed9f9cae733d9afb4382b36adf119d` — Receiver run-ID digest tests;
- `2aceb8f028f17452382b572bc6750566d1c60a9d` — one-shot bridge run-ID test.

**Execution status:** NOT TESTED. Final-Send protected-context validation and new run-ID tests require a fresh focused run. Block 2 remains NOT TESTED.


### 2026-11-10 — Block 2 run-ID validation coverage expanded (NOT TESTED)

Additional test fixtures now cover the stricter Final-Send boundary and the Host/Core contract split:
- protected Final-Send fixtures include valid Host run ID, context digest, and Core envelope digest;
- Host bridge tests verify Host run IDs are generated uniquely and retained separately, while the object passed into Core has exactly the original three keys (`request_id`, `generation_id`, `generation_type`);
- composition fixture returns the run ID from the consumed Host bridge handoff.

Additional commits:
- `9340eac2d73887c122b275b4738acd3c56391a88` — require run ID and both digests at Final-Send validation;
- `5d4bad8735c2121f604fd57479aafb14b01e3393` — provide Host run ID in composition fixture;
- `7928c103f91fb58d96f002b730db9da9b3932237` — update protected Final-Send fixture;
- `6defeb57a040911d596b4e5d7eef3348fc0ff420` and `1f99a132a4b0b8348334df51d94142843e292916` — cover run-ID generation and exact Core metadata contract;
- `aa659461236843db19ce85079cc948d2868a97ba` — assert the bridge does not forward Host run ID as an extra Core request field.

**Execution status:** NOT TESTED. Run the Receiver, Gateway composition, Host bridge, and protected Final-Send suites together. Block 2 remains NOT TESTED.


### 2026-11-10 — Block 2 focused suites passed after Host run-ID implementation

User executed all four focused suites at commit `dbc8a54b495d83c5c0fcb103cd56cac3a13e049f`:

```
node --import ./tests/configure-test-env.js --test
  ./tests/npc-context-receiver.test.mjs
  ./tests/gateway-final-send-composition.test.js
  ./tests/npc-generation-context-host-bridge.test.js
  ./tests/protected-memory-final-send.test.js
```

**Result: 57 tests, 57 passed, 0 failed, 0 skipped.**

This verifies the current automated contracts for:
- Host-generated distinct `run_id`, `request_id`, and `generation_id`;
- exact unchanged three-field Core generation metadata contract;
- one-shot request/response-bound Host handoff and duplicate/reuse rejection;
- immutable NPC Receiver projection, mandatory generation/run IDs, deterministic context digest, exact original Core envelope digest, safe rejection of accessor/Proxy inputs;
- Final-Send validation requiring run ID and both digests;
- protected NPC content serialization and Host locator stripping;
- protected sender routing, exactly one transport handoff in tested path, and fail-closed unsupported/invalid cases.

**Status remains:** Block 2 automated focused suites PASS; full Block 2 acceptance NOT YET PASS. The tests are unit/composition-level evidence, not a real end-to-end run through live Host → Core HTTP → Provider → NPC Receiver → production Gateway → model transport. Remaining acceptance work includes exercising the real installed production composition with an explicitly enabled disposable acceptance fixture, proving immutable context and digest continuity at runtime, tamper/stale-source/duplicate-handoff rejection at the actual boundary, and verifying no model egress for rejected contexts. Do not enable Memory → NPC in the normal SillyTavern installation.


### 2026-11-10 — Final-Send tamper rejection coverage added (NOT TESTED)

Added a negative-boundary test that supplies six malformed protected contexts: missing or malformed Host `runId`, missing or malformed `contextDigest`, and missing or malformed `coreEnvelopeDigest`. Each must fail with `MEMORY_DISPATCH_NOT_READY` before Gateway dispatch or provider fetch. The test asserts zero Gateway calls and zero provider calls across all cases.

Commit:
- `90375305b9b8710ad041b3abfe1de2ba617e89ad` — reject tampered run/digest metadata before dispatch.

**Execution status:** NOT TESTED. Run the four focused suites plus the protected Final-Send suite containing the new negative-boundary test. Block 2 remains NOT YET PASS.


### 2026-11-10 — Block 2 stale Provider evidence rejection tests added (NOT TESTED)

Added two Gateway-level negative tests using the existing isolated Gateway/SQLite fixture:
1. Provider reports the same record identity with a changed canonical `source_version` after retrieval. Dispatch must fail before `DISPATCH_STARTED`, with zero provider transport calls and no ledger row.
2. Provider reports a changed evidence cursor (`data_version` and candidate digest) after retrieval. Dispatch must fail with `MEMORY_DISPATCH_PROVIDER_EVIDENCE_CHANGED`, before `DISPATCH_STARTED`, with zero provider transport calls and no ledger row.

The fixture now supports controlled Provider candidate and evidence-cursor overrides. These tests exercise the Gateway's actual synchronous evidence-reader boundary, but the readers remain test doubles; this is not yet proof against the live SQLite Provider and live Core/Host composition.

Commit:
- `1380503693f1ebf04675577c50813b0cbc64497c` — test stale Provider source version and evidence cursor before dispatch.

**Execution status:** NOT TESTED. Run `tests/memory-dispatch-gateway.test.js` and the four Block 2 focused suites. Block 2 remains NOT YET PASS.

### 2026-11-10 — Gateway regression suite follow-up

At commit `14daae320`, the expanded focused run reported 109/113 passing. Three failures were stale Final-Send fixtures that no longer supplied the mandatory Host Receiver bindings (`runId`, `contextDigest`, and `coreEnvelopeDigest`). The fourth assertion expected the internal Provider cursor diagnostic as the outward error, while the Gateway intentionally exposes the generic fail-closed `MEMORY_DISPATCH_NOT_READY` and retains `MEMORY_DISPATCH_PROVIDER_EVIDENCE_CHANGED` as its cause.

Test-only correction committed as `662edfe763b607658c0dc27a4dfed85690cc1c56`: shared valid-request fixtures now carry valid immutable-context bindings; the sender-family fixture carries its own bindings; the cursor test checks both the public fail-closed error and its internal cause. No production authorization or validation was weakened.

Status: **NOT TESTED** until the user runs the expanded suite at the new commit.

### 2026-11-10 — Expanded Block 2/Final-Send regression run

User executed the five focused suites at commit `163abd7e1`: **113 tests passed, 0 failed, 0 skipped**. This includes the real Gateway test harness for source-version/cursor changes, revocation before/during dispatch and before response release, streamed-write revalidation, all registered protected sender families with exactly one upstream call each, ambiguous transport recovery to UNKNOWN, and cross-process Core/Provider ordering scenarios.

This is a strong automated integration result, but it does not by itself establish the full Block 2 production acceptance: the test harness still does not substitute for a live Host → Core → NPC receiver run with a real accepted source and independently verified outbound model request.

Next acceptance work remains: perform the production-composition scenario with changed source/context between Receiver preparation and Final-Send, prove rejection before model egress, then complete live Receiver binding and exact outbound body evidence. Status remains **BLOCKED / NOT YET ACCEPTED** for the full Block 2 until that evidence exists.

### 2026-11-10 — Receiver-to-Final-Send stale-context integration test added (NOT TESTED)

Added a combined test to `tests/memory-dispatch-gateway.test.js` that uses the real `receiveNpcContext()` implementation, the real protected Final-Send adapter, and the Gateway's isolated SQLite-backed dispatch fixture.

The test:
- prepares an accepted NPC context from an exact Core Result Envelope and Host binding;
- verifies that the returned content block and digest are immutable, and that mutating the original retrieval object after Receiver preparation does not alter the accepted projection;
- simulates Provider evidence changing after preparation in two independent ways: canonical source version changes and Provider record version changes;
- sends the prepared Receiver output through Final-Send and the Gateway;
- requires both stale variants to fail closed before `DISPATCH_STARTED`, with zero Gateway transport calls and zero upstream model calls.

This closes a specific automated coverage gap by connecting Receiver output to the actual Final-Send/Gateway boundary rather than testing those pieces only in isolation. The Provider evidence reader remains the controlled Gateway test fixture; this does not yet prove the full live Core/SQLite Provider/Host composition.

Commits:
- `12da3bcb24c6c7719f534f09c135cd8810ea6d47` — Receiver-to-Final-Send integration test;
- `03329b50a39a92c6240553bc71515df83aab886d` — include both source-version and record-version stale cases.

**Execution status:** NOT TESTED. Run the expanded five-suite command below before accepting this block.

The combined test also supplies an explicit stable replay identity, because the Receiver projection intentionally does not own the original Host prompt body. Final-Send therefore receives replay identity through its trusted call argument rather than inventing it from NPC context.

Follow-up test fixture commit:
- `4ddec0125286611b5d86d77e79f21527d4fcadfa` — supply the trusted replay identity to the integrated Final-Send test.

### 2026-11-10 — Receiver-to-Final-Send stale-context integration suite passed

User executed the five focused suites on Windows / Node 22.18.0 after fast-forwarding `integration/host-core-v1` to `c4109c001`.

**Result: 114 tests, 114 passed, 0 failed, 0 skipped.**

The successful run includes the new combined test `immutable NPC Receiver context rejects post-prepare mutation and stale Provider evidence before model egress`. It exercised the actual `receiveNpcContext()` implementation, protected Final-Send adapter, and SQLite-backed Gateway test fixture. It confirmed:
- Receiver content and digest remain unchanged after attempts to mutate the accepted context and original Core retrieval object;
- changed canonical `source_version` is rejected;
- changed Provider `record_version` is rejected;
- both stale cases produce zero Gateway transport calls, zero upstream model calls, and no durable `DISPATCH_STARTED` row.

It also reran the Receiver, Host one-shot bridge, Final-Send composition, protected sender routing, revocation, streaming, crash recovery, cross-process ordering, and sender-family regression coverage.

**Disposition:** Block 2 automated regression/integration tests PASS. This is not the full Block 2 production acceptance: Provider evidence is still controlled by the Gateway fixture in the new stale-context test, and there is still no live Host → Core HTTP → real SQLite Provider → Receiver → production Gateway → observed model-boundary request proving the complete chain. The Host inventory/root authority caveat from Block 1 also remains: its targeted E2E uses explicit inventory/root-proof fixtures.

**Next implementation target:** build the disposable acceptance composition using the existing real file-backed Core/Provider E2E fixture, attach the real Receiver and production Final-Send/Gateway, and expose a deterministic local fake provider as the outbound-body observer. Keep Memory → NPC disabled in the normal SillyTavern installation.
