# Spatial/Temporal World Model — evidence report (initial audit)

**Status:** research draft; not a runtime implementation or approved contract.  
**Repository:** `necromorphic/Logic-Engine`  
**Audited main HEAD:** `bf35fb8dd13628718dacc11c27654c0929fba0e2` (verified from GitHub `commits/main` during this audit).  
**Scope:** read-only inspection of the canonical SQLite store, temporal primitives, due-work planner, and the knowledge/narrative boundary document. No code or runtime contracts changed. Tests were not run in this connector-only audit.

## 1. Evidence matrix

| Claim | Evidence at audited HEAD | Class | Finding / consequence |
|---|---|---|---|
| Time coordinates are integer milliseconds | `src/time/model.js`, lines 1–6, exports `TIME_COORDINATE_UNIT = 'millisecond'`; `createTimeCoordinate` and interval helpers around lines 35–75 | code-verified | Candidate temporal coordinate is integer milliseconds relative to a world-configured epoch. Do not replace it with wall clock or invent another clock. |
| Due-work planner is not a world-state executor | `src/time/scheduler.js`, module header and `planDueWork`; plans `(from_coordinate, to_coordinate]`, returns segments/proposals | code-verified | Planner output is not a committed event or proof of spatial change. |
| Canonical commit returns both revision and commit sequence | `src/storage/sqlite-store.js`, `commit` around line 1176; result construction around lines 1385–1400 | code-verified | `world_revision` and `commit_sequence` are distinct values and must not be treated as interchangeable. Commit also returns `game_time_coordinate`. |
| Segment commit pins and checks both revision and sequence | `src/storage/sqlite-store.js`, `commitSegment` around lines 1400–1482 | code-verified | Existing primitive may be relevant to atomic temporal segments, but does not itself establish a spatial projection contract. |
| Snapshot reads expose a freshness marker | `src/storage/sqlite-store.js`, `readSnapshot` around line 641; reads world revision and current commit sequence and checks context-manifest anchors | code-verified | Snapshot markers are usable evidence for snapshot freshness only in their documented scope; they are not a new spatial cursor API or authorization proof. |
| Canonical entity projection can be rebuilt from valid events | `src/storage/sqlite-store.js`, `rebuild` around line 2108; selects valid world events ordered by `commit_sequence`, rebuilds entities/facts/relationships/mechanics | code-verified | There is a real rebuild path for existing projections. No spatial projection is present in this method. |
| Rollback exists and reasons over dependencies/projections | `src/storage/sqlite-store.js`, `rollback` around line 1875 onward | code-verified (partial inspection) | Derived spatial effects would need invalidation/rebuild semantics; current inspected implementation only knows its existing reference/projection kinds. Spatial-specific rollback behavior is not established. |
| Existing entity effects are generic attributes, not a typed spatial model | `rebuild` around line 2108 handles `entity.create`, `entity.upsert`, `entity.update`, `entity.delete` and generic `attributes_json` | code-verified | Arbitrary attributes do not prove stable coordinate systems, pose/movement semantics, uncertainty, provenance, or spatial query guarantees. Reusing them as a spatial contract is not approved. |
| Existing scene/narrative contract keeps world-side representation distinct from NPC knowledge | `docs/07-knowledge-and-narrative-boundaries.md`, §11 (starting line 264), §12 (starting line 352), §13 (starting line 420) on branch `docs/coordinator-memory-npc-boundaries-2026-10-26` | docs-only | A spatial snapshot cannot prove what an NPC perceived/acquired and cannot replace original source evidence or subject-specific episodic memory. |
| Production spatial integration is approved | No such approval identified in issue #351/#350 or inspected source | absent | Production implementation remains NO-GO until exact seam and owner decisions are approved. |

**Source file identities:** `src/storage/sqlite-store.js` blob SHA `bf713de7bb6caedecf9d5e8026055d9147f94185`; `src/time/scheduler.js` blob SHA `d935c2c5e2815486f720fb42a8cbb2259a4a371c`; `src/time/model.js` blob SHA `10fd5a0488cb4300634433df52983399b36afef0`; boundary document blob SHA `d018d990583904035b4d86b5c3b3fb3d4c784aaf` on its named docs branch.

## 2. Current paths (observed, not proposed)

1. A proposal reaches `sqlite-store.js:commit`; the store checks expected revision / optional expected commit sequence and records a canonical event.
2. `commitSegment` validates the expected starting revision and optional commit sequence, commits a bounded event segment transactionally, then rebuilds the existing projections.
3. `rebuild` replays valid events in commit-sequence order into existing entity, fact, relationship and mechanic projections.
4. `readSnapshot` reads requested canonical entities/facts/events and returns snapshot freshness markers; it explicitly documents raw internal data as not automatically actor-authorized or model-safe.
5. The Time planner consumes canonical millisecond coordinates and proposes due-work segments; its own header states it does not read/write storage, advance time, execute effects, or grant NPC knowledge.

This establishes real primitives, but **does not establish a supported read interface for a spatial projection**, a typed representation of spatial effects, or a documented mapping from arbitrary historical game-time coordinate to an exact committed world state. A revision/commit sequence can identify an event-state boundary; it is not itself a game-time coordinate.

## 3. Representation options — initial comparison

| Option | Determinism / rollback | Provenance and conflicts | Fit with current evidence | Initial position |
|---|---|---|---|---|
| In-memory derived projection | Rebuildable only if a deterministic authoritative input stream is available; process restart loses projection | Must retain derivation lineage externally or recompute it | No typed spatial event contract found | Lowest persistence cost, but cannot yet demonstrate durable recovery |
| Persisted, fully rebuildable projection | Potentially deterministic if rebuilt only from valid canonical events and exact rule version | Must invalidate/rebuild after rollback and keep source links | Existing store rebuild pattern is precedent, not an approved spatial persistence seam | Plausible candidate; requires Core-approved lifecycle and read boundary |
| Scene/episode records | Can preserve ordered source-grounded occurrence evidence if sources are complete | Best candidate for source lineage, gaps, viewpoint and contradiction marking; not NPC memory by itself | Boundary document defines semantics, but runtime capture/completeness is not proven here | Complementary evidence representation, not substitute for canonical event history |
| Snapshots/checkpoints | Faster reads/recovery; correctness depends on exact anchor and replay after it | Need source lineage and invalidation on rollback/stale anchor | Existing `readSnapshot` freshness markers are not spatial checkpoints | Optimization only after deterministic replay is established |
| Hybrid source + derived episode + optional spatial snapshots | Broadest coverage but highest lifecycle/reconciliation burden | Can preserve source evidence and explicit derivation paths | Semantically strongest candidate in docs, not selected implementation | Evaluate against tests; do not approve by preference alone |

## 4. Feasibility blockers and failure matrix

| Required behavior | Current evidence | Status |
|---|---|---|
| Ignore rejected/uncommitted proposals | Canonical store has commit boundary; no spatial consumer exists | NOT TESTED for spatial projection |
| Deterministic reconstruction at supported time + commit cursor | Integer game-time coordinate and commit sequence exist separately; exact spatial read seam absent | BLOCKED / NO APPROVED SEAM |
| Idempotent duplicate replay | Canonical commit/segment has idempotency mechanisms; spatial derivation consumer absent | NOT TESTED for spatial projection |
| Out-of-order event handling | Canonical replay orders by commit sequence; no spatial effect semantics established | NOT TESTED |
| Unknown/conflicting position remains unknown/conflict | Existing facts have conflict representation; no typed spatial state | NOT IMPLEMENTED / no contract |
| Create/remove/move/teleport semantics | Generic entity effects exist; spatial semantics are not typed or proven | NOT IMPLEMENTED / no contract |
| Rollback removes unsupported spatial derivations | Store rollback and rebuild exist for current projections; no spatial projection is registered | BLOCKED pending approved integration point |
| Same entity ID isolated by world | Existing projections and queries are world-scoped | code-verified for existing projections; spatial behavior NOT TESTED |
| Restart/replay determinism | Existing projections rebuild from valid events; no spatial projection | NOT TESTED for spatial model |
| NPC perception/acquisition inferred from world state | Explicitly forbidden by boundary contract | REJECT |

No tests or experiments were executed for this report. No mocks or fixture-only callbacks were introduced.

## 5. Decisions required before implementation

1. **Core owner:** What existing committed-event/read boundary may a derived spatial projection consume, and what exact cursor/revision pair proves freshness? If none exists, authorize a separate contract task; do not create an adapter in this spike.
2. **Core owner:** Which existing committed effect/event semantics, if any, are sufficient to represent location, orientation, pose, movement, creation/removal and teleportation? If none, define a separate owner-reviewed proposal; do not smuggle spatial fields into generic attributes.
3. **Time owner:** Confirm the supported mapping between game-time coordinate and committed event/segment state, including multiple events at one coordinate, interval boundaries, interruption and replay. Coordinate and commit sequence must remain distinct.
4. **Core owner:** Define expected invalidation/rebuild behavior for a derived spatial projection under rollback/rebuild, including stale readers.
5. **Product/architecture:** Decide minimum spatial semantics (2D, named/local spaces, 3D, orientation/pose) and what remains unknown rather than guessed.
6. **Memory/NPC owners:** No dependency is needed for world-side spatial state. Any later use as NPC knowledge must independently pass Memory→NPC authorization/acquisition gates.

## 6. Recommendation

**GO** for continued read-only evidence gathering and isolated, non-production experiments only if they can use real approved seams.  
**NO-GO** for production spatial runtime, new schema/table/event/API, or integration into Memory/NPC at this stage.

Immediate next action: inspect the exact tests around `commitSegment`, `readSnapshot`, `rollback`, and `rebuild`; then map the real TimeEngine advance/recovery path from `src/time/model.js`, `src/time/scheduler.js`, and the time-advance operation methods. Record actual test commands and outputs only after running them in a repository checkout. If no compatible spatial seam is found, report **BLOCKED / NO APPROVED SEAM** and request a decision from Core/Time owners rather than implementing a speculative interface.

## 7. Limits of this report

This is a first source audit using GitHub file reads. It did not run the repository, test suite, or CI; it did not inspect every test, all time-advance orchestration, PR merge state, or Notion. Therefore claims above are explicitly classified and this report is not the final acceptance report required by issues #350/#351.


## 8. Follow-up trace: durable time-advance operation

Further source inspection confirms the store has a concrete durable operation path, beyond the pure scheduler:

- `createTimeAdvanceOperation` (in `src/storage/sqlite-store.js`, approximately lines 1483–1533) verifies the world exists and that current `game_time_coordinate` and `world_revision` match the operation's starting checkpoint. It records the operation and claims existing world-scoped triggers in the same transaction.
- `resumeTimeAdvanceOperation` (approximately lines 1547–1675) reads persisted segments, checks the current world coordinate/revision against the last confirmed checkpoint, marks stale checkpoints `needs_review`, and commits each segment through `commitSegment`. It updates the confirmed coordinate and revision only as part of the segment transaction. Trigger completion is also recorded with operation metadata.
- Relevant existing test files are present at the audited tree: `tests/time-advance-operation.test.js`, `tests/time-segment.test.js`, `tests/time-scheduler.test.js`, `tests/time-trigger-registry.test.js`, `tests/snapshot-read.test.js`, and `tests/core.test.js`. Their presence is code-tree evidence only; **none was executed in this audit**.

This makes the temporal operation checkpoint concrete for future analysis, but it still does not supply an approved spatial event vocabulary or spatial projection consumer. For a spatial reconstruction, the team must define whether it reconstructs state at a confirmed segment boundary only or supports intermediate coordinates within a segment. The inspected code alone does not authorize the latter. No change to TimeEngine is proposed here.
