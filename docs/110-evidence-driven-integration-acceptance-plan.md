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

## Next execution target

Proceed to Block 2 — NPC Context Receiver. Preserve the fixture limitations above and do not claim production readiness. Continue using disposable local test data and loopback-only services.
