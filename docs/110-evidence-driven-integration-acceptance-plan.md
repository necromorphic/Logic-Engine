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
