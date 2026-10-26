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


## 9. Existing-test coverage map (source inspection; not execution)

The following test files were read at main HEAD `bf35fb8dd13628718dacc11c27654c0929fba0e2`. This section records assertions present in source, not a claim that they passed in this run.

| Test file / source blob | Existing guarantee asserted in test source | What it does not prove for the Spatial/Temporal World Model |
|---|---|---|
| `tests/time-advance-operation.test.js` — `7684b2fee1c8a808f506343585948ea478885a4b` | Exact due-coordinate execution; interval target reached; idempotent operation replay; changed request under same key rejected; blocked plan leaves time unchanged; sub-second execution rejected; persisted checkpoint recovery resumes without replaying the already-confirmed segment | No spatial state reconstruction, no spatial effects, no historical query at an arbitrary coordinate |
| `tests/time-segment.test.js` — `ed8d223f11ec5fa9ff8f9ec97f61a5586f2fe960` | Segment is atomic; projection rebuild once; replay does not repeat effects/rebuild; failure rolls back prior segment mutations; stale revision rejected; unsupported intra-segment dependencies/read-write conflicts rejected | Generic entity projection only; no spatial derivation and no query contract for state between event/segment boundaries |
| `tests/time-scheduler.test.js` — `7b33974179f752a9abfa3fd4ff6f6d29d9a50b8a` | Deterministic `(from,to]` boundaries; stable ordering; same-coordinate dependency ordering; missing dependency blocks without partial prefix; read/write conflict requires review; interruption stops at a coordinate; cycles and world mismatch fail closed | Scheduler orders due work, not historical world facts or spatial events; it does not prove a spatial consumer can safely use the plan |
| `tests/snapshot-read.test.js` — `63827c03bbb7b028a4218410c70f0a3bfb53c757` | World-scoped bounded snapshots; composite cursor `(world_revision, commit_sequence)`; coherent SQLite reads; missing targets fail closed; rollback-only revision changes invalidate context-manifest expansion even when event cursor does not advance | Snapshot is a current internal read, not an arbitrary-time spatial reconstruction API or a durable spatial checkpoint |
| `tests/core.test.js` — `0543b8c6cd3aa45d069e1fc4294486a467bbe557` | Rollback invalidates dependent events and rebuilds existing projections; independent branch remains; game time is not rewound; conflicting independent facts remain conflicted until rollback removes one claim | No spatial projection participates in rollback/rebuild, and no rule says how spatial conflicts should be represented |
| `docs/63-time-advance-operation-runtime-slice.md` — `eb57ace27c6e1cefa875006a237707a7d016d120` | Documents T5 merged status, persisted trigger lifecycle, checkpoint/restart semantics, and explicit non-goals (no background wall-clock advancement, no automatic NPC knowledge) | Does not authorize the spatial model to modify TimeEngine or reuse its internal tables as a public contract |

### Derived conclusions

1. **Supported checkpoint boundary:** the strongest existing seam evidenced by tests is the committed segment boundary, with canonical world coordinate plus revision and commit-sequence markers. The report does not claim this is already an approved spatial read API.
2. **Equal-time events:** scheduler tests prove deterministic planning/order constraints for due work. Store replay orders committed events by commit sequence; a spatial projection would need to consume the canonical committed/valid event order, not sort by coordinate alone. This is an inference from two distinct source contracts, not a currently implemented spatial rule.
3. **Rollback:** the Core test asserts rollback changes revision while game time remains at its advanced value. Snapshot tests separately assert a rollback-only revision change invalidates a prior manifest even if commit sequence stays the same. Therefore a spatial read must not treat game time alone, or commit sequence alone, as sufficient freshness/identity.
4. **Historical coordinate ambiguity:** the inspected suite covers segment checkpoints and due coordinates, but not arbitrary interpolation/reconstruction within a segment. Intermediate-coordinate queries remain unsupported until a contract says how to resolve several committed events sharing a coordinate and how to represent unobserved movement between events.
5. **Test execution status:** no test command was run by this connector-only audit. The GitHub Actions query showed a successful Runtime tests run for PR #347 at SHA `da6373706762290de201b145753fc48b0938e185`, against base `bf35fb8dd13628718dacc11c27654c0929fba0e2`; that is not evidence that the spatial branch or these tests were executed by this work. The combined commit status query for the main SHA returned no statuses.

## 10. Updated decision

The current source supports a **candidate read/rebuild seam only at canonical committed event/projection boundaries**, but does not yet establish a spatial projection contract. Thus the next decision is narrow:

- **Core:** confirm whether a new derived projection may consume valid committed events and rebuild/rollback lifecycle using the existing store internals, or specify the supported application-level boundary. Until confirmed, no production spatial consumer is added.
- **Time owner:** confirm that the supported query point is the last confirmed segment boundary, not arbitrary in-segment game time, unless a separate contract and tests define the latter.
- **Spatial block:** continue documentation/test-matrix work only; do not add tables, event kinds, entity attributes, APIs, or lifecycle hooks.

Result remains **BLOCKED / NO APPROVED SPATIAL SEAM** for production integration. This is a specific blocker, not a claim that Core has no useful primitives.


## 11. Owner decision matrix and spike closure criteria

This matrix was also posted to issues #350 and #351 so the feasibility spike and parent task carry the same explicit gate. These are questions for owners, not decisions made by this research block.

1. **Core — projection boundary:** May a spatial projection consume only valid committed events and participate in the existing rebuild/rollback machinery, or must it be accessed through a separate supported application-level boundary? The owner should identify the authoritative code path.
2. **Time owner — temporal reconstruction point:** Is reconstruction supported only at a confirmed segment/checkpoint boundary, or must arbitrary intra-segment historical positions be supported? Existing tests establish segmented execution and recovery, not arbitrary spatial history reconstruction.
3. **Core — rollback and readers:** What must happen to spatial-derived state and readers after rollback/rebuild or a stale snapshot? Point to an existing invalidation/rebuild invariant or mark it as a gap requiring design review.
4. **Spatial semantics owner/product decision:** What is the minimum model: named spaces only, 2D, or 3D; is orientation/pose in scope; and how are unknown, contradictory, or stale locations represented? Generic entity attributes do not answer this.
5. **Consumer boundary:** This research does not authorize NPC/context exposure. Any later Memory→NPC use remains independently gated by source authority, lineage, inventory/reconciliation, revocation, and admission checks.

### Closure criteria

- Each decision is answered by the responsible owner or linked to an already approved contract.
- Every claim of existing behavior cites exact source/test evidence; unsupported behavior is recorded as a gap.
- The agreed scope identifies what state can be reconstructed, at which temporal boundary, and how rollback/staleness are handled.
- Until these conditions are met, status remains **BLOCKED / NO APPROVED SPATIAL SEAM**. No production integration, new API/schema, or NPC admission is implied.

**Execution caveat:** test files were inspected as source but not executed during this research pass. The previously located successful CI run was for a different SHA and is not evidence that this branch/current HEAD passed CI.
