# Spatial/Temporal Edge-Case Audit — 2026-10-28

**Status:** Research-only evidence addendum; not an approved implementation contract.  
**Baseline:** `main` reviewed at the file blobs listed below.  
**Execution status:** Source inspected; no tests were executed in this audit.  
**Safety:** Production remains NO-GO. Memory → NPC remains DISABLED / FAIL-CLOSED. No runtime change is authorized.

## Purpose

Narrow the remaining gaps in the spatial roadmap by comparing the current feasibility test with the invariants a future read-only spatial query would need. This is not a request to add a new receipt/table or spatial projection.

## Findings supported by source

### 1. Current cursor test proves a bounded case, not the full cursor contract

`tests/spatial-temporal-cursor-feasibility.test.js` contains two tests:

- It creates a world, advances through two segments, maps each segment's final planned event ID to a canonical `world_events` row, closes/reopens SQLite, and checks the same mapping is reconstructed.
- It rolls back the first segment's boundary event and verifies that event is no longer valid and the stored completed-operation revision differs from the current world revision.

The helper currently selects `event_id, game_time_coordinate, commit_sequence, validity`; it does **not** select or assert `committed_revision`. It verifies that the final segment's `commit_sequence` agrees with `operation.result.last_segment.commit_sequence`, but does not assert the full pair `(world_revision, commit_sequence)` for every segment boundary. Therefore, the current test does not yet establish the full composite cursor mapping claimed by a future spatial query.

Source: `tests/spatial-temporal-cursor-feasibility.test.js` (blob SHA `422b6dbc8dc132c27d285aa883eb9a45ef4727f6`).

### 2. Segment transaction is a reusable seam, but it is not proof of temporal freshness

In `SQLiteStore.commitSegment()`, the segment is processed inside `this.tx(...)`; each event is committed with deferred projection rebuild, followed by one rebuild and a segment result containing start/end revision and commit-sequence markers. The inspected `tx()` uses `BEGIN IMMEDIATE` and commits or rolls back the SQLite transaction around its callback. This supports atomicity for the inspected Core database transaction path.

It does not by itself prove that a completed segment is still the current world state after later writes, rollback, process recovery, or coordinated restoration of old databases. A segment boundary cursor and a current snapshot cursor are different facts and must not be conflated.

Sources: `src/storage/sqlite-store.js` (blob SHA `0c45e73020d69726946a01e5c7e39ea4c4a7fdd4`), `tests/spatial-temporal-cursor-feasibility.test.js`.

### 3. Coordinated Core + Provider restore is explicitly characterized as undetectable by current snapshot markers alone

The characterization test saves matching Core and Provider copies, performs a source change, confirms the Provider record becomes stale, restores both old copies, and then observes that the old record reconciles as current again with the old revision and commit-sequence values.

This is direct test-source evidence that database-local matching markers cannot prove the restored state is the newest accepted state. The test is a characterization of a limitation, not evidence that an anti-rollback authority is deployed or that the test was executed in this audit.

Source: `tests/memory-provider-coordinated-restore.characterization.test.js` (blob SHA `9d8ba4571bfd2b46b81734aeeb5c0838142b1828`).

### 4. World Pack manifest syntax is declared, but the inspected creation seam only pins ID/version

The manifest declares JSON Schema Draft 2020-12. The inspected `LogicEngine.createWorld()` requires and persists `world_pack_id` and `world_pack_version`; this path does not resolve manifest bytes or pin a canonical manifest digest. The manifest's `entity_types[].attributes_schema` is constrained to an object at the outer manifest level; this alone does not validate an entity's full post-state against a spatial type contract.

This is a bounded source finding. It does not rule out an external loader outside the inspected repository path.

Sources: `schemas/world-pack-manifest.schema.json` (blob SHA `73b59694280ebf4e6c5affd98a41c09e4da6031c`), `src/application/engine.js` (blob SHA `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`), `package.json` (blob SHA `c9d6652d87cf90ff3b945cfa32c1957d83428cbd`).

## Required follow-up evidence before spatial implementation

The following are proposed tests/evidence requirements, not claims that they exist or have run:

| ID | Scenario | Required invariant | Failure disposition |
|---|---|---|---|
| C1 | Every segment boundary after restart | Resolve the exact final segment event; validate event validity, coordinate, `committed_revision`, and `commit_sequence`; compare all persisted result fields that purport to describe that boundary | UNKNOWN / NON_READY |
| C2 | Non-TimeEngine canonical write between segments | Distinguish historical segment cursor from current world cursor; never label the former as the latter | STALE or a separately identified historical boundary |
| C3 | Rollback of a boundary or any causal predecessor | Re-evaluate validity and dependencies; no cached boundary remains confirmed solely because operation status is `completed` | UNKNOWN / STALE |
| C4 | Equal game-time coordinate across multiple events | Use stable event identity and commit ordering; do not select a boundary by coordinate alone | CONFLICT / UNKNOWN if the exact boundary cannot be proven |
| C5 | Crash at each operation/segment checkpoint transition | Recovery either reconstructs the same canonical boundary or remains non-ready; no partially advanced checkpoint is accepted | NON_READY |
| C6 | Missing event, invalid event, coordinate mismatch, or cursor mismatch | Do not synthesize a position or cursor from nearby events or the latest world state | UNKNOWN / STALE |
| C7 | Coordinated restore of older Core + Provider databases | Either independently detect rollback through an accepted external head, or require explicit fail-closed/manual recovery | NON_READY |
| W1 | World Pack ID/version reused with changed manifest bytes | Immutable content identity rejects the mismatch; no silent latest-schema fallback | UNSUPPORTED / NON_READY |
| W2 | Any canonical writer changes a typed spatial attribute | Full resulting attribute state is validated at one canonical commit gate, or spatial state is not eligible for confirmed reads | UNSUPPORTED / REJECTED |

## Decision update

- **Do not add a new boundary receipt/table yet.** The current segment transaction and persisted event IDs are a plausible seam. First strengthen the characterization tests to cover the composite cursor and interleavings; only propose additional persistence if those tests expose a gap that cannot be closed by deriving the cursor from canonical events.
- **Do not expose spatial queries yet.** There is no demonstrated typed World Pack loader/digest binding or canonical spatial post-state validation gate on the inspected path.
- **Keep restore protection as a separate blocker.** A DB-local digest is not sufficient against coordinated restoration of matching old copies. The existing accepted-head design must be completed and independently verified end-to-end, or v1 must require fail-closed/manual recovery when newest-state authority cannot be proven.
- **Keep Host, Memory, and NPC outside this scope.** Correct spatial state would not itself prove NPC perception, knowledge, or permission to use it.

## Concrete next work item

After owner review authorizes code changes, the smallest test-first slice is to extend the research-only cursor tests to assert the full per-segment composite cursor and add non-TimeEngine intervening-write and missing/invalid-boundary cases. Do not implement a spatial projection or query API in that slice.

## 3D-thinking scope additions — 2026-10-28

Research requirements only; this section does not authorize runtime changes.

### S1 — Temporal identity and currentness
- Bind each position claim to a stable event identity and composite Core cursor; game-time coordinate alone is not a unique boundary.
- A historical segment boundary is not the current world state. Later writes, rollback, restart, or recovery must revalidate it or mark it stale/unknown.
- Missing or contradictory provenance must fail closed; never guess from a nearby event.
- Coordinated restore of older Core + Provider databases must not silently re-enable a claim. Without independent accepted-head authority, require NON_READY/manual recovery.
- Evidence required: restart, equal-time events, intervening writes, rollback, missing/invalid boundary, crash recovery, coordinated restore.

### S2 — Geometric foundation
- Every spatial value declares coordinate frame and unit; incompatible or unlabelled values are rejected.
- Nested frames (object → room → building → world) need explicit parent identity and deterministic transforms. Parent changes must consistently update children or invalidate dependent results.
- Validate immutable World Pack content identity and full canonical post-state at the canonical commit gate, not only submitted patches.
- Bounds, room/floor membership, allowed zones, and collision rules are explicit policies; they are not inferred defaults.
- Evidence required: unit/frame mismatch, transform round-trip, parent changes, missing parent/cycles, invalid positions, reused ID/version with changed manifest bytes, and all canonical writer paths including import/migration/repair.

### S3 — NPC perception is separate from world truth
- Knowing where an entity is does not mean an NPC sees, hears, recognizes, or knows it.
- Perception separately evaluates observer pose/orientation, distance, line of sight, blockers, lighting, and world-specific sensory rules.
- Results are scoped to observer and world-state cursor; relevant movement, geometry, blocker, or lighting changes make old results stale.
- Perception grants no Memory access or NPC response permission. Host/Memory/NPC integration requires separate review and explicit authorization.
- Evidence required: occlusion, field-of-view boundaries, distance thresholds, lighting policy, invalidation after geometry/observer changes, and no implicit Memory → NPC path.

### Gate order
1. Complete S1 temporal identity/currentness evidence.
2. Define and validate S2 coordinate frames, units, immutable schema identity, and canonical post-state.
3. Design read-only spatial queries only after S1/S2 pass.
4. Design S3 perception as a separate layer after query semantics stabilize.
5. Runtime remains NO-GO until an implementation contract is reviewed and approved.

Do not add a cursor receipt/table pre-emptively. First prove whether canonical events and existing markers can satisfy S1; propose new persistence only if tests demonstrate a gap.
