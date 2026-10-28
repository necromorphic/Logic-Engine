# Typed 3D Position Contract — Coordinator Decision

**Date:** 2026-10-28  
**Canonical contract:** [docs/research/world-pack-typed-spatial-attributes-contract-2026-10-28.md](https://github.com/necromorphic/Logic-Engine/blob/main/docs/research/world-pack-typed-spatial-attributes-contract-2026-10-28.md)  
**Related reviews:** [PR #548](https://github.com/necromorphic/Logic-Engine/pull/548), [PR #556](https://github.com/necromorphic/Logic-Engine/pull/556), [PR #558](https://github.com/necromorphic/Logic-Engine/pull/558), replacement history [PR #551](https://github.com/necromorphic/Logic-Engine/pull/551) / [PR #560](https://github.com/necromorphic/Logic-Engine/pull/560)  
**Coordinator disposition:** **BLOCKED** — contract approval criteria are not met.  
**Important distinction:** this is a source-based coordinator decision, not a claim that separate Core and TimeEngine owners submitted independent approvals. No independent owner-authored conclusions or review submissions are present in the inspected PR review records.

## 1. Decision

The contract is **not approved** for implementation or integration. The approved *semantic choices* for position v1 remain fixed and are not reopened:

- three world-relative coordinates X/Y/Z;
- one right-handed coordinate system;
- +Z points upward;
- abstract logical units, not metres;
- position is anchored at the entity origin.

Still unresolved by the user's prior decision: the directions of +X and +Y, and the canonical coordinate-frame identifier. The world origin and entity-origin anchor are different concepts and must remain separately named.

The current contract text is a normative design proposal. It does not prove that runtime validation, durable schema pinning, historical reconstruction, or temporal boundary mapping exists.

## 2. Core conclusion (coordinator's source review)

| Claim | Evidence | Classification / decision |
|---|---|---|
| Core has a snapshot read seam | [engine.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/application/engine.js), `Engine.getSnapshot`; [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js), `SQLiteStore.readSnapshot` | **Code-verified**: selected data is read in a SQLite read transaction with Core freshness markers. This is not actor authorization or proof of a temporal mapping. |
| Generic effect validation checks typed spatial semantics against a pinned World Pack schema | [rules.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/core/rules.js), `validateEffects`; contract §2 | **Absent in reviewed code**: generic attribute-object validation does not establish typed spatial schema validation. |
| Canonical commit resolves and verifies immutable schema identity | [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js), `commit()`; [manifest schema](https://github.com/necromorphic/Logic-Engine/blob/main/schemas/world-pack-manifest.schema.json) | **Absent in reviewed code**: stored pack ID/version alone do not prove canonical digest verification or historical schema availability. |
| Snapshot consistency and freshness | [Core evaluation boundary](https://github.com/necromorphic/Logic-Engine/blob/main/docs/57-core-evaluation-recalculation-boundary.md); [Core/Time boundary](https://github.com/necromorphic/Logic-Engine/blob/main/docs/07-knowledge-and-narrative-boundaries.md) | **Partial**: `world_revision` and `commit_sequence` are distinct markers; both are required where the snapshot contract supplies both. Neither is game time or a universal source-change journal. |
| Entity incarnation continuity through delete/recreate, replay and rebuild | [sqlite-store.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/storage/sqlite-store.js), entity effect/rebuild paths | **Partial / not established**: tombstones exist, but durable incarnation identity and complete lifecycle coverage are not demonstrated. |
| All canonical write paths enforce one spatial gate | `commit()`, `commitSegment()`, `rebuild()` in sqlite-store | **Not implemented / not verified**: the contract itself says the gate is future work. Segment rollback all-or-nothing needs exact-head failure-path tests. |

### Core blockers

1. A non-bypassable spatial validation gate does not yet exist in the reviewed implementation.
2. Immutable schema identity, digest verification, and historical schema resolution are not demonstrated.
3. Lifecycle identity across destruction, ID reuse, replay, and rebuild is not fully guaranteed.
4. The contract must not label a position CONFIRMED without canonical identity, supported historical schema, provenance, and one coherent Core boundary.
5. A snapshot is not automatically a model-safe or actor-authorized projection.

## 3. TimeEngine conclusion (coordinator's source review)

| Claim | Evidence | Classification / decision |
|---|---|---|
| Canonical game-time coordinate representation | [time/model.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/time/model.js), `TIME_COORDINATE_UNIT` and coordinate constructors | **Code-verified**: safe-integer milliseconds relative to the configured world epoch. |
| Deterministic order for equal-time due-work triggers | [time/scheduler.js](https://github.com/necromorphic/Logic-Engine/blob/main/src/time/scheduler.js), `compareTriggers` | **Code-verified, narrow scope only**: due coordinate, then trigger ID. This is not proof of a global order for every canonical event sharing game time. |
| Durable confirmed-time-boundary ID mapped to Core `(world_revision, commit_sequence)` | Reviewed model/planner and current contract evidence | **Absent in reviewed evidence**: `confirmed_time_boundary_id` is a proposed contract field, not an established durable record in the inspected model/planner. |
| Rollback, restart, replay and older-backup restoration preserve historical time-to-state mapping | Reviewed model/planner; contract §6–7 | **Not established** by the pure temporal model or due-work planner. Requires evidence from durable operation/segment paths and tests at the candidate head. |
| Existing tests prove the required guarantees | No exact current-head test run was verified for this review | **Not tested in this review**. No test pass is claimed. |

### TimeEngine blockers

1. Game-time coordinate, trigger ID, event order, `world_revision`, and `commit_sequence` must remain distinct.
2. No proven durable mapping exists from a confirmed TimeEngine boundary to one Core composite cursor.
3. Same-time deterministic ordering is proven only for due-work planning, not all canonical commits.
4. Historical reconstruction through rollback/restart/older backup is unproven.

## 4. Reconciliation matrix

| Topic | Agreement | Remaining gap / resolution |
|---|---|---|
| Ownership | Core owns canonical state/commit/rollback; TimeEngine owns game-time progression and due-work planning. | Do not add a second clock, writer, scheduler, or event-order rule. |
| Core snapshot | A transaction-bound Core snapshot seam exists. | It does not prove temporal boundary mapping or authorize disclosure. |
| Time semantics | Time coordinate and Core cursor/revision are distinct. | Need a proven durable boundary-to-Core-cursor association before historical temporal queries can be CONFIRMED. |
| Equal game-time events | Core `commit_sequence` can order accepted events; TimeEngine planner has a trigger tie-break. | No evidence yet that one global ordering guarantee covers all event producers and commits. |
| World Pack schema | Pack-owned typed attributes remain the selected design direction. | Immutable digest and historical schema resolution are absent/unproven. |
| Entity lifecycle | Tombstones and lifecycle checks exist in bounded paths. | Complete incarnation continuity across every writer/replay/rebuild path is unproven. |
| Coordinate semantics | Position-v1 choices listed in §1 are fixed. | +X/+Y directions and canonical frame ID remain open product/domain decisions; do not infer them. |
| Tests | Prior PR comments mention CI for earlier heads. | Those runs are not evidence for this exact review/head. POS-01–POS-25 remain NOT RUN unless exact run records are attached. |

No owner-authored disagreement is recorded in the inspected review records; this is **not** evidence of consensus. The unresolved items below are blockers, not silent agreement.

## 5. Contract changes required before reconsideration

1. Preserve the fixed v1 semantics and explicitly mark +X, +Y, and canonical frame ID as unresolved domain decisions.
2. Keep world origin separate from entity-origin anchor.
3. Keep event-backed and snapshot-backed provenance distinct; never synthesize unavailable source fields.
4. Define `CONFIRMED` as requiring both coherent Core evidence and a separately verified temporal association when the query is time-bound.
5. Mark schema digest/history, the canonical validation gate, complete lifecycle guarantees, boundary mapping, and rollback/restart recovery as **required but not implemented/proven**.
6. State the narrow scope of equal-time ordering evidence; do not generalize due-work trigger ordering to all canonical commits.
7. Keep all POS-01–POS-25 test statuses NOT RUN until exact-head run URL, SHA, command and result are verified.
8. Do not invent a new API, schema/table, event, cursor, adapter contract, or runtime mechanism in this approval step.

## 6. Blocking approval vs. follow-up decisions

**Blocking approval**
- Core canonical spatial validation gate and full write-path inventory.
- Immutable World Pack schema identity/digest plus historical schema availability.
- Proven TimeEngine-boundary ↔ Core composite cursor mapping.
- Deterministic ordering/reconstruction for same-game-time canonical changes.
- Verified entity lifecycle/replay/rebuild semantics.
- Exact-head failure/recovery test evidence.

**Separate architecture/domain decisions**
- Product/domain decision: directions of +X and +Y.
- Product/domain decision: canonical coordinate-frame identifier and compatibility policy.
- Core decision: whether existing storage can support immutable schema history or an explicitly approved extension is needed.
- Core + TimeEngine decision: durable temporal-boundary-to-Core-cursor mapping and rollback/restart semantics.
- Core decision: whether an explicit incarnation identifier is required beyond current identity/tombstone rules.

## 7. Review process and limitation

PR #548 is closed; PR #556 is also closed with no review submissions; PR #551 was superseded by PR #560, which is closed. PR #558 remains the active supplementary audit. The inspected PR review lists contain no owner-authored Core or TimeEngine reviews. The GitHub integration available for this action does not expose a verified named Core/TimeEngine owner roster, so I cannot truthfully assign a person or claim an independent expert has answered. I have recorded the source-based conclusions and the exact missing evidence rather than fabricate owner sign-off.

**Next coordinator action:** request named Core and TimeEngine owners from repository maintainers on PR #558 / issue #351, with the narrow question sets already recorded there. Once identities are established, request separate reviews; reconcile their answers against this report. Do not change the verdict until those reviews or an explicitly documented owner-delegation decision resolves the blockers.

## 8. Safety and verification status

- Contract approval: **BLOCKED**
- Production: **NO-GO**
- ST-01–ST-16: **NOT TESTED / NOT PASSED**
- POS-01–POS-25: **NOT RUN unless exact current-head evidence is attached**
- Memory → NPC: **DISABLED / FAIL-CLOSED**
- Implementation / integration / merge: **NOT AUTHORIZED**
- Tests executed for this report: **none**
