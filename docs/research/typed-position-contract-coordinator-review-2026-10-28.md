# Typed Position Contract — Coordinator Review Report

**Date:** 2026-10-28  
**Reviewed PR:** [#558](https://github.com/necromorphic/Logic-Engine/pull/558)  
**Reviewed head:** `0ca24d31e55e4efd8ad6b6224e3d2bac9d0048b8`  
**Repository base reviewed:** `main` at `53ba39e6968f80f0e9f5c3b323560cc828b08ea4`  
**Disposition:** **READY FOR CONTRACT REVISION**  
**Authority boundary:** documentation review only. No runtime, schema, API, event, adapter, storage, spatial implementation, Memory, or NPC integration is authorized.

## 1. Decision

The correct next step is to revise the proposed contract based on the blockers below. It is not approved for implementation review yet. This report is the coordinator's source-based assessment of Core and TimeEngine responsibilities; it does not pretend that two separate human owner responses were received.

## 2. Core assessment

### Confirmed properties

| Claim | Evidence | Classification |
|---|---|---|
| Core exposes a snapshot read path | `src/application/engine.js`: `Engine.getSnapshot(id, request)` delegates to `store.readSnapshot`; `src/storage/sqlite-store.js`: `SQLiteStore.readSnapshot` reads its selected data in a SQLite read transaction and carries the world revision and commit cursor. | Code-verified |
| Freshness requires both Core markers | `docs/73-core-1.5-cross-block-integration-matrix.md`: rollback can advance `world_revision` without advancing `commit_sequence`; cursor alone is insufficient. | Docs/source-supported; verify against current implementation before implementation |
| Snapshot consistency is not authorization | `docs/51-npc-acquisition-source-reconciliation.md` and `docs/73-core-1.5-cross-block-integration-matrix.md`: raw snapshot is not an actor-authorized/model-safe projection. | Docs-supported |
| Entity tombstone handling has bounded coverage | PR #554 documented a guard against upserting a currently destroyed entity and tests for selected commit/rebuild/rollback paths. This does not prove immutable incarnation identity or every writer path. | Partial |

### Core blockers

1. **Atomicity:** Do not specify independent `getState → getEvents → getState` calls as inherently atomic. A valid contract must use a single snapshot-bound read or define and prove a marker-check protocol that fails closed on any marker mismatch.
2. **Provenance shape:** The proposed envelope combines event and snapshot source forms. Define separate variants or mark fields conditional; never synthesize unavailable identifiers.
3. **World Pack schema identity:** `world_pack_id` and `world_pack_version` do not prove immutable content, digest verification, or historical schema recovery. Until demonstrated, a position requiring unverified schema interpretation cannot be `CONFIRMED`.
4. **Entity lifecycle:** Removing position, destroying an entity, and reusing an ID are different operations. Current tombstone evidence is not a universal incarnation guarantee.
5. **Status semantics:** `CONFIRMED` requires a valid canonical entity identity, supported schema, source provenance, and one consistent Core boundary. Core alone cannot certify the TimeEngine boundary.

## 3. TimeEngine assessment

### Confirmed properties

| Claim | Evidence | Classification |
|---|---|---|
| Canonical time coordinates are safe-integer milliseconds relative to the configured world epoch | `src/time/model.js`: module contract, `TIME_COORDINATE_UNIT`, `createTimeCoordinate`, `createTimeInterval`. | Code-verified |
| Equal-time trigger planning has a deterministic tie-break | `src/time/scheduler.js`: `compareTriggers` orders by `due_coordinate`, then `trigger_id`. | Code-verified for due-work trigger planning only |
| The trigger tie-break is a global canonical event order | No such guarantee established by the reviewed functions. | Absent in reviewed evidence |
| A durable TimeEngine boundary maps to one Core composite cursor | No such guarantee established by the reviewed functions. | Absent in reviewed evidence |

### TimeEngine blockers

1. Do not conflate game-time coordinate, trigger ID, event order, `world_revision`, and `commit_sequence`.
2. `confirmed_time_boundary_id` is a proposed field, not an established durable identifier in the reviewed source. It cannot be required as though it already exists.
3. The deterministic same-coordinate order proven for the due-work planner must not be generalized to all canonical event commits.
4. Historical temporal reconstruction, rollback/restart restoration, and a temporal-boundary-to-Core-cursor association are not proven by the pure model/planner alone. Cite a durable operation/segment source and current-head tests before claiming these guarantees.

## 4. Unified disposition

### Blocking approval
- No proven association between a confirmed TimeEngine boundary and a matching Core composite marker.
- No demonstrated immutable/historical World Pack schema identity for replay/rebuild.
- No evidence of a global deterministic order for all canonical state changes sharing game time.
- No proof that the proposed status precedence and complete entity lifecycle semantics are existing runtime guarantees.

### Contract clarification
- Distinguish event-backed from snapshot-backed provenance.
- Define coordinate frame identifier, +X/+Y orientation, origin convention, and cross-frame compatibility. These remain domain decisions, not implementation guesses.
- Separate Core consistency/freshness from TimeEngine temporal confirmation.
- Scope equal-time ordering claims to the exact subsystem proven by code.

### Non-blocking
- Finite XYZ validation and the distinction between position, orientation, pose, and movement are reasonable normative proposal requirements if clearly labelled as proposed rather than implemented.
- The six status labels may remain candidate vocabulary; their precedence is not approved.

### Separate architecture decisions
- **Core:** Can the existing loader/storage path provide immutable World Pack schema identity and historical resolution, or is a separately approved extension needed?
- **Core + TimeEngine:** How is a confirmed temporal boundary durably associated with the Core composite cursor, including rollback/restart?
- **Core:** Is a separate entity incarnation identity required beyond current `(world_id, entity_id)` and tombstone rules?

## 5. Evidence and test discipline

Sources reviewed at the base SHA listed above:
- `src/application/engine.js`
- `src/storage/sqlite-store.js`
- `src/time/model.js`
- `src/time/scheduler.js`
- `docs/51-npc-acquisition-source-reconciliation.md`
- `docs/53-core-http-service-boundary-audit.md`
- `docs/73-core-1.5-cross-block-integration-matrix.md`

**Tests were not executed for this review.** No test pass is claimed. Existing test names or prior CI descriptions do not count as current-head successful verification. The original PR #558 marks POS-01–POS-25 as NOT RUN; preserve that status unless exact run evidence is added.

## 6. Next authorized action

Revise documentation only to address the contract blockers and label every unresolved property as unproven. Attach exact source links and test/run evidence where available. Keep PR #558 draft and unmerged until the revised contract is reviewed. No runtime, schema, API, event, adapter, storage, spatial model, Memory, or NPC changes are authorized by this decision.

**Safety status:** Production NO-GO; ST-01–ST-16 NOT TESTED / NOT PASSED; Memory → NPC DISABLED / FAIL-CLOSED.
