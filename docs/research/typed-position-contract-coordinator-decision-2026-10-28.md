# Typed 3D Position Contract — Coordinator Decision and Evidence Reconciliation

**Date:** 2026-10-28  
**Canonical contract candidate:** [World Pack Typed Spatial Attributes Contract](https://github.com/necromorphic/Logic-Engine/blob/docs/position-v1-coordinator-decision-2026-10-28/docs/research/world-pack-typed-spatial-attributes-contract-2026-10-28.md)  
**Related work:** [PR #548](https://github.com/necromorphic/Logic-Engine/pull/548), [PR #556](https://github.com/necromorphic/Logic-Engine/pull/556), [PR #558](https://github.com/necromorphic/Logic-Engine/pull/558), [spatial feasibility issue #351](https://github.com/necromorphic/Logic-Engine/issues/351), [portfolio issue #252](https://github.com/necromorphic/Logic-Engine/issues/252)  
**Coordinator disposition:** **BLOCKED FOR CONTRACT APPROVAL**  
**Scope:** documentation only. No runtime/schema/API/event/adapter/storage changes and no implementation authorization.

## 1. Coordinator decision

I have resolved the remaining v1 axis/frame convention as a coordinator domain decision:

- +X = logical eastward;
- +Y = logical northward;
- +Z = upward;
- right-handed ENU convention;
- abstract logical units, not metres;
- position anchor = entity origin, distinct from world origin;
- canonical frame convention = `world-enu-logical-v1`, scoped to a world as the conceptual identity `(world_id, "world-enu-logical-v1")`. Matching frame convention names do not make coordinates from different worlds comparable.

East/north are logical axis labels, not a claim that coordinates are geodetic or physical. This decision adds no runtime field, API, schema, or storage mechanism. The contract document on this branch records it.

This closes the **domain naming choice**, not the contract approval gate. Core/TimeEngine runtime guarantees and independent owner conclusions remain missing. I will not turn an absent implementation seam into a normative claim.

## 2. Core conclusion

| Question | Evidence | Classification and result |
|---|---|---|
| Is there a consistent read boundary? | [engine.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/application/engine.js), `getSnapshot`; [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js), `readSnapshot` | **Code-verified:** snapshot reads selected world/projection data inside a SQLite read transaction and include `world_revision` plus `commit_sequence`. This is consistency, not actor authorization. |
| Is typed spatial validation enforced at canonical commit? | [rules.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/core/rules.js), `validateEffects`; [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js), `commit` | **Absent in reviewed code:** generic effect validation checks the shape of attribute data but does not resolve a pinned World Pack entity schema and enforce typed spatial semantics in the canonical commit transaction. |
| Are schema identity and historical schema content immutable and recoverable? | [manifest schema](https://github.com/necromorphic/Logic-Engine/blob/main/schemas/world-pack-manifest.schema.json); world-row and commit paths in `sqlite-store.js) | **Absent/unproven:** pack ID/version are not a verified content digest or proof that the exact historical schema remains available for replay/rebuild. |
| Are lifecycle and incarnation guarantees complete? | `commit`, `commitSegment`, and `rebuild` in [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js); [time-segment.test.js](https://github.com/necromorphic/Logic-Engine/blob/main/tests/time-segment.test.js) | **Partial:** current tests cover tombstone reuse rejection and segment rollback. They do not prove a durable incarnation ID or exhaustively cover every writer/import/repair/replay path. |
| Does a snapshot cursor detect rollback-only changes? | [Core cross-block matrix](https://github.com/necromorphic/Logic-Engine/blob/main/docs/73-core-1.5-cross-block-integration-matrix.md); `rollback()` in `sqlite-store.js) | **Source-supported:** rollback may advance `world_revision` without advancing `commit_sequence`; use both as a composite freshness marker. This does not by itself prove a historical temporal mapping. |

### Core blockers

1. The single non-bypassable spatial validation gate is a **future normative requirement**, not current behavior.
2. The exact World Pack schema digest and historical-resolution path are not established.
3. Entity tombstone protection is not equivalent to complete incarnation continuity across all writers and rebuilds.
4. A coherent snapshot must bind both Core markers; independent state/events reads are not an atomic contract.
5. `CONFIRMED` must remain unavailable if identity, schema, provenance, lifecycle, or snapshot consistency cannot be established.

## 3. TimeEngine conclusion

| Question | Evidence | Classification and result |
|---|---|---|
| What is canonical game time? | [time/model.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/time/model.js), `TIME_COORDINATE_UNIT`, `createTimeCoordinate`, `createTimeInterval` | **Code-verified:** safe-integer millisecond coordinates relative to the world's configured epoch; the pure model does not read wall clock or persist state. |
| Is there a durable time-advance operation? | [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js), time-advance operation row/methods; [engine.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/application/engine.js), `startTimeAdvance` / `resumeTimeAdvance`; [runtime contract](https://github.com/necromorphic/Logic-Engine/blob/main/docs/63-time-advance-operation-runtime-slice.md) | **Code/docs-supported:** the operation persists target and confirmed coordinate, starting/current world revision, status, and segment checkpoint. It can resume after restart and fails closed to `needs_review` if current world coordinate/revision no longer matches the last confirmation. |
| Is restart recovery covered by a test source? | [time-advance-operation.test.js](https://github.com/necromorphic/Logic-Engine/blob/main/tests/time-advance-operation.test.js), test “recovery resumes after the last persisted segment checkpoint without replaying it” | **Test-source verified; not run in this review:** the test closes/reopens SQLite, resumes the operation, and checks that the prior segment is not replayed. Test presence is not a passing run. |
| Are segment rollback and equal-time planner order covered by test sources? | [time-segment.test.js](https://github.com/necromorphic/Logic-Engine/blob/main/tests/time-segment.test.js); [time-scheduler.test.js](https://github.com/necromorphic/Logic-Engine/blob/main/tests/time-scheduler.test.js) | **Test-source verified; not run in this review:** segment failure rollback and deterministic planner order are covered. Planner tie-break is scoped to due-work triggers; it does not prove a universal global order for every canonical event producer. |
| Does a confirmed time boundary map durably to the exact Core composite cursor? | Time-advance operation fields and recovery test above; snapshot marker in `readSnapshot` | **Not established:** operation state records confirmed coordinate and world revision, but reviewed evidence does not establish a durable one-to-one association to the full `(world_revision, commit_sequence)` marker for every historical query, including intervening writes and rollback. |
| Are old-backup restoration and every temporal rollback/replay path proven? | Reviewed model, scheduler, operation path and available test sources | **Partial / not tested here:** restart checkpoint recovery is covered at source level; full historical reconstruction across old backups, rollback invalidation and all writers is not proven by the pure model/planner or the inspected recovery test alone. |

### TimeEngine blockers

1. Do not conflate game-time coordinate, trigger ID, event order, `world_revision`, or `commit_sequence`.
2. Preserve the real durable operation and checkpoint behavior in the contract; do not inaccurately describe TimeEngine as only a pure planner.
3. No proven durable mapping connects every confirmed TimeEngine boundary to a unique Core composite cursor.
4. Equal-time order is proven for the due-work planner and accepted event sequence within tested segment paths, not as a universal order for every event producer.
5. Historical reconstruction through rollback, restart and older-backup restoration remains incompletely evidenced.

## 4. Reconciliation

| Topic | Agreed conclusion | Remaining resolution |
|---|---|---|
| Ownership | Core owns canonical state and commits; TimeEngine owns game-time progression and due-work planning/operations. | No second clock, writer, scheduler, or independent event order. |
| Position semantics | v1 axes/frame convention is now decided in this report and contract branch. | Exact schema serialization must be supported by the pinned validator; no implementation is authorized. |
| Snapshot freshness | `(world_revision, commit_sequence)` is the composite Core freshness marker. | It is not a universal event journal and does not itself map game time to a historical snapshot. |
| Time confirmation | Durable operation records coordinate/revision and checkpoint; restart recovery has test-source coverage. | Exact durable boundary-to-composite-cursor association is still unproven. |
| Same-time changes | Planner ordering and segment event order have bounded implementation/test evidence. | No universal order claim across all canonical event producers. |
| World Pack identity | Exact entity-type matching and immutable schema digest are normative requirements. | Current runtime does not demonstrate digest verification and historical schema resolution. |
| Entity lifecycle | Tombstone reuse is rejected in covered paths; segment rollback has test-source coverage. | Complete incarnation continuity and exhaustive writer inventory remain unproven. |

No independent owner-authored disagreement is visible in the reviewed PR records. That absence is **not consensus**. This report resolves the coordinator-owned domain convention but explicitly preserves the remaining technical disagreements/evidence gaps as blockers.

## 5. Contract edits required before approval

The candidate contract branch now:
1. names +X/+Y/+Z and the right-handed ENU convention;
2. sets `world-enu-logical-v1` as the frame convention and scopes a frame instance by `world_id`;
3. keeps entity origin distinct from world origin;
4. records the durable time-advance operation/restart evidence accurately while retaining the missing composite-cursor mapping as a blocker.

Before approval, the contract/review record must also:
- separate event-backed and snapshot-backed provenance;
- keep `CONFIRMED` dependent on both coherent Core evidence and a verified temporal association for time-bound queries;
- mark schema digest/history, the commit gate, full lifecycle semantics and global ordering claims as unimplemented/unproven;
- preserve exact-head test statuses as NOT RUN until actual run URL, SHA, command and results are verified;
- avoid inventing an API, schema/table, event, cursor, adapter contract or runtime mechanism.

## 6. What is needed to close the approval gate

- **Core:** independent review of the canonical commit gate, schema digest/history, complete write-path inventory, snapshot markers, tombstone/incarnation and rebuild/rollback semantics.
- **TimeEngine:** independent review of the durable operation/checkpoint, exact boundary-to-Core composite cursor mapping, equal-time ordering scope, rollback/restart and old-backup behavior.
- **Both:** state what is code-verified, test-verified, docs-only, partial, absent or not tested; attach exact-head test run evidence where a test has actually run.

The current GitHub access does not expose a verified named Core/TimeEngine owner roster, and the inspected PR review records do not contain independent owner reviews. I cannot honestly assign named reviewers or fabricate their conclusions. I have documented the exact review requests in [PR #558](https://github.com/necromorphic/Logic-Engine/pull/558) and [issue #351](https://github.com/necromorphic/Logic-Engine/issues/351); the remaining administrative limitation is obtaining the authorized reviewer identities from repository maintainers.

## 7. Final status and safety gates

- Contract approval: **BLOCKED FOR CONTRACT APPROVAL**
- v1 coordinate-axis/frame naming: **DECIDED BY COORDINATOR; recorded on the candidate branch**
- Production: **NO-GO**
- ST-01–ST-16: **NOT TESTED / NOT PASSED**
- POS-01–POS-25: **NOT RUN in this review**
- Memory → NPC: **DISABLED / FAIL-CLOSED**
- Runtime implementation, integration and merge: **NOT AUTHORIZED**
- Tests executed for this review: **none**

**Next coordinator action:** publish this candidate contract/report as a documentation-only draft PR, request the separate scoped Core and TimeEngine reviews once named owners can be verified, then reconcile their findings without reopening the now-decided v1 axis convention absent new evidence.


## 8. Exact-head refresh — 2026-10-28 09:05 UTC

This refresh records new evidence without upgrading any unverified claim.

- Current `main` at refresh: `09a1a696fd7c5591f537b13df50793fab4ba36db` (commit message: `test(time): cover high fan-in dependency planning`). The earlier `da7fe72...` baseline is stale.
- Current spatial contract candidate remains documentation-only; no spatial runtime gate, immutable World Pack schema digest/history, or durable TimeEngine-boundary-to-Core-cursor mapping was added by this refresh.
- A separate Core transaction regression test was added in [PR #573](https://github.com/necromorphic/Logic-Engine/pull/573), head `ddc256fa8e85767d77d44463582e42bbd25e2baf`. It injects a failure after `rebuild()` has run during `commitSegment()` and asserts rollback of the segment's events, entity projection, revision, commit sequence, game-time coordinate, and idempotency rows.
- Actions run [#40661437871](https://github.com/necromorphic/Logic-Engine/actions/runs/40661437871) completed successfully on the exact test head `ddc256fa8e85767d77d44463582e42bbd25e2baf`.
- The Windows self-hosted `test` job passed: `npm test` reported **930 passed, 0 failed, 0 skipped**; `node --test experiments/recalculation-oracle/harness.test.mjs` reported **8 passed, 0 failed**.
- The new regression is present in the log as subtest **891**: `segment rolls back all canonical writes when projection rebuild fails` — **PASS**.
- The separate hosted `npc-boundary` job also passed, but it is not counted as evidence for the spatial contract itself.
- Combined status for current `main` SHA `09a1a696fd7c5591f537b13df50793fab4ba36db` returned no status checks in the inspected response. The successful run above applies to PR #573's exact head, not to `main`.

### Updated gate

The segment rollback-on-rebuild-failure test is now **TEST-VERIFIED on PR #573 head**. This closes only that narrow test-evidence gap; it does not prove every canonical writer path or any spatial-specific behavior. The spatial contract remains **BLOCKED** independently by: (1) no runtime spatial validation gate, (2) no proven immutable/historical schema identity, (3) no proven complete entity incarnation guarantee across every path, (4) no confirmed TimeEngine-boundary ↔ Core composite cursor mapping, and (5) no independent owner-authored Core and TimeEngine reviews.

**Remaining external blocker:** separate authorized Core and TimeEngine owner conclusions are still absent. Do not merge the spatial contract or authorize production spatial runtime work based only on this passing transaction regression test.


## 9. Delegated decision authority — 2026-10-28

The project coordinator has explicitly delegated authority to this reviewer to make the pending coordinator-level process decision without waiting for a named human owner roster. I therefore decide:

1. **No invented named owners and no fabricated approvals.** Core and TimeEngine remain separate technical scopes; conclusions must identify the evidence for each.
2. **The missing reviewer roster is no longer treated as an administrative blocker.** The coordinator can maintain and update the scoped evidence disposition under this delegated authority.
3. **This does not convert one review into two independent owner reviews.** The present conclusions are coordinator-level source/evidence reviews, not independent sign-offs. That distinction remains explicit in the record.
4. **Technical approval remains blocked only by unproven runtime guarantees**, not by the absence of names: canonical spatial commit validation; immutable schema digest and historical schema resolution; complete entity-incarnation/write-path coverage; and a durable TimeEngine boundary to Core composite-cursor association, plus tests for the claimed guarantees.
5. **No production implementation or enablement is authorized by this delegation.** The correct next action is to close those technical evidence gaps in narrow, testable changes, then reassess the gate against exact-head CI. Until then, spatial results must fail closed where provenance cannot be established and Memory → NPC remains DISABLED / FAIL-CLOSED.

This is the coordinator's process decision, not a claim that the technical blockers have been solved.
