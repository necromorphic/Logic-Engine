# Spatial/Temporal World Model — evidence report (initial audit)

**Status:** research draft; not a runtime implementation or approved contract.  
**Repository:** `necromorphic/Logic-Engine`  
**Initial audit main HEAD:** `bf35fb8dd13628718dacc11c27654c0929fba0e2`. A later current-main revalidation is recorded in §13; use that section for current source identities.  
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

## 12. Decision-ready seam proposal (follow-up)

**Purpose:** choose the smallest safe boundary for a future spatial projection without promoting an unapproved runtime contract. This section is a research recommendation, not Core approval.

### 12.1 Candidate boundaries

| Candidate | Boundary and data flow | Advantages | Main risks / missing guarantees | Decision |
|---|---|---|---|---|
| A. Ephemeral derived projection over a supported committed-event read | Read valid committed events from an owner-approved Core boundary; deterministically derive a spatial view in memory; label it with the exact source cursor/freshness markers; discard and rebuild when stale | Smallest blast radius; no second durable truth; easy to test replay and world isolation; does not require persistence before semantics are proven | No supported spatial-consumer read contract has been confirmed; current internal store methods are not automatically public APIs; repeated rebuild cost; rollback freshness behavior still needs an explicit rule | **Recommended first experiment**, but only after Core identifies the supported read boundary. Until then, design-only |
| B. Persisted, rebuildable spatial projection | Add a derived projection to Core's projection/rebuild lifecycle; reconstruct from valid events after restart and rollback | Faster repeated reads; can share deterministic rebuild lifecycle if explicitly supported | Requires schema/storage and lifecycle changes; rollback invalidation, atomicity and reader staleness must be specified; higher coupling and migration/recovery cost | Defer until A proves semantics and Core approves a concrete contract |
| C. Event-linked scene/episode records | Build scene records linked to source/event evidence, with spatial relations as one part of the episode | Can preserve scene boundaries, provenance, missing evidence and subject/viewpoint distinctions better than a spatial-only snapshot | Solves a broader episodic-evidence problem, not just spatial queries; source retention and lineage rules are separate; must not become NPC memory or imply perception | Parallel/future scene-integrity work; not the first spatial seam |
| D. Snapshots as checkpoints/accelerators | Use an existing supported snapshot only as a starting point, then replay subsequent committed events | Potentially reduces replay cost | Existing snapshot is a bounded current internal read, not an arbitrary-time spatial history API; snapshot alone misses intervening changes and does not define spatial semantics | Optional optimization only after A is correct; never canonical truth |

### 12.2 Recommended minimal boundary

The least risky target to validate is **A: a disposable, deterministic, in-memory derived view**. The intended flow, contingent on owner approval, is:

1. Core remains the only authority that commits world facts and decides event validity.
2. A spatial derivation consumes only valid, committed source evidence through a supported Core read boundary. A scheduler proposal or uncommitted effect is not an input fact.
3. Replay follows canonical committed event order (including commit sequence); game-time coordinate alone is not a sufficient ordering key when multiple events can share a coordinate.
4. The derived result is scoped to one world and tagged with the exact source freshness/cursor markers that the approved read contract provides. The current source evidence distinguishes `world_revision`, `commit_sequence`, and `game_time_coordinate`; they must not be substituted for one another.
5. The first supported reconstruction point should be the last confirmed committed segment/checkpoint boundary. Arbitrary intra-segment historical queries remain out of scope unless the Time/Core owners approve a definition and tests for them.
6. If input validity, source completeness, freshness, position, or ordering is uncertain or conflicting, preserve that uncertainty. Do not invent a coordinate or silently choose a winner.
7. The derived view does not write canonical facts, advance game time, schedule work, establish NPC perception, or grant Memory→NPC access.
8. If the source cursor becomes stale or rollback/rebuild changes the supported source state, the view must be discarded/rebuilt or marked unavailable according to a Core-approved rule. Until that rule exists, production readers must not consume it.

**Important limit:** this is a proposed research boundary, not an API design. It deliberately names no method, table, event type, field, hook, or adapter.

### 12.3 Acceptance-test matrix for a future isolated spike

These are required test cases, not claims that the tests already exist or have passed.

| ID | Scenario | Required assertion | Existing evidence / gap |
|---|---|---|---|
| STW-01 | Only committed effects | Uncommitted/rejected proposals cannot alter the derived view | Core commit boundary exists; spatial consumer absent |
| STW-02 | Deterministic replay | Same valid event history and same source cursor produce byte-for-byte/equivalent spatial output | Existing store rebuild orders valid events by commit sequence; no spatial projection |
| STW-03 | Same game-time coordinate | Events at equal coordinates retain canonical committed ordering; no coordinate-only sorting | Scheduler has same-coordinate ordering constraints; projection rule still absent |
| STW-04 | Segment atomicity/replay | A failed segment leaves no partial spatial effects; idempotent replay does not duplicate them | Generic segment atomicity/replay tests exist; spatial derivation absent |
| STW-05 | Rollback and rebuild | A rolled-back supporting event no longer contributes; independent valid claims remain; stale derived readers fail closed | Core rollback/rebuild tests exist; spatial lifecycle and reader contract absent |
| STW-06 | Composite freshness | A revision-only change cannot be missed just because commit sequence or game-time coordinate did not advance | Snapshot tests cover composite cursor/rollback-only revision change; spatial reader absent |
| STW-07 | Unknown/conflicting position | Missing or contradictory evidence remains unknown/conflicting; no silent coordinate invention or arbitrary winner | No spatial semantics contract or tests identified |
| STW-08 | Entity lifecycle | Create, update, remove, teleport/space transition are derived only when supported by committed evidence; absence is not inferred as a position | Generic entity effects exist; spatial meanings absent |
| STW-09 | World isolation | Identical entity IDs in two worlds never share spatial state or replay inputs | Existing store is world-scoped; spatial projection isolation untested |
| STW-10 | Restart/reconstruction | Rebuilding from the same authoritative history after restart yields the same result and source cursor | Durable TimeAdvance recovery exists; spatial rebuild absent |
| STW-11 | Segment boundary | Query at a confirmed boundary agrees with committed state at that boundary | Segment/checkpoint primitives exist; no spatial query |
| STW-12 | Intermediate coordinate | Query between committed boundaries is rejected or explicitly unresolved until an approved contract defines semantics | Current evidence does not establish arbitrary intra-segment reconstruction |
| STW-13 | No NPC authority leak | Spatial output alone cannot be treated as source evidence, NPC perception, belief, or acquisition authorization | Existing narrative-boundary document separates these concepts; no spatial-to-NPC path authorized |

### 12.4 Minimum concept checklist (no schema implied)

Before any data model is approved, product/Core owners must settle the meaning of:

- **Identity and isolation:** what entity/object is referenced, and how world/session boundaries are enforced.
- **Spatial frame:** named room/place/region relations versus 2D/3D coordinates; how frames relate and when conversion is valid.
- **Pose/orientation:** whether position alone is sufficient or orientation/body pose is required for the intended scenes.
- **Temporal anchor:** confirmed game-time coordinate plus the exact committed source cursor; how equal-time events are ordered.
- **Change semantics:** movement, teleport, entering/leaving a space, creation/removal, and whether any interpolation is allowed.
- **Evidence quality:** unknown, incomplete, stale, conflicting, inferred, and source-confirmed are distinct states.
- **Provenance:** which committed source evidence supports each derived relation, and what rollback/rebuild does to it.
- **Consumer permissions:** the derived view is not an NPC's sensory record, episodic memory, belief, or permission to disclose information.

This is a semantic checklist only; it does not authorize field names or storage design.

### 12.5 Decisions and ownership

| Decision | Owner | Proposed default for feasibility only | Required approval |
|---|---|---|---|
| Supported committed-event input boundary | Core | No direct dependency on private store internals; use only an explicitly supported boundary | Core must name the exact existing seam or approve a separate contract |
| First reconstruction point | Time owner + Core | Confirmed committed segment/checkpoint boundary | Confirm whether this is sufficient for product needs |
| Rollback/stale-reader behavior | Core | Fail closed; discard/rebuild derived state before serving it | Core must define the invalidation/rebuild guarantee |
| Spatial scope and uncertainty semantics | Product/spatial semantics owner | Preserve unknown/conflict; do not infer missing coordinates | Product decision required |
| Persistence | Core + spatial owner | No persistence in the first experiment | Separate approval before schema/storage change |
| NPC/Memory consumption | NPC + Memory + Host/Core owners under their own gates | No consumption or authority granted | Separate integration approval; this spike grants none |

### 12.6 Effort and exit criteria

Rough effort is expressed as relative scope, not calendar promises:

- **Candidate A design/fixture spike:** small, after Core confirms an input boundary.
- **Candidate A deterministic replay and rollback/freshness tests:** medium, because a real disposable checkout and the actual approved boundary are needed.
- **Candidate B persisted projection:** medium-to-large; includes schema, migration/rebuild, atomicity, invalidation, restart and reader-consistency review.
- **Candidate C scene-linked records:** large and cross-block; source lineage, scene completeness and NPC viewpoint must be separately designed.

The research spike can be marked **architecture-ready** when the evidence matrix, candidate comparison, recommended boundary, acceptance tests, and owner decisions are reviewed and internally consistent. It cannot be marked **production-ready** until the owners approve the seam and consistency contract and the relevant tests actually run against the resulting implementation.

### 12.7 Current conclusion

**GO:** continue documentation and read-only/isolated feasibility work.  
**NO-GO:** production runtime, persistence/schema changes, unapproved Core/TimeEngine integration, and NPC/Memory exposure.

The smallest next action is for Core to identify whether a supported committed-event read boundary already exists for a derived consumer. If it does, the spike can test candidate A without adding a runtime contract. If it does not, this block must provide the evidence and acceptance tests for a separate owner decision; it must not create the seam itself.



## 13. Current-main revalidation after repository advancement

**Revalidation baseline:** `main` at `5bc5f0e4434c7573d2754e6cda94786fcb45fca0` (the base SHA returned when draft PR #529 was opened). This baseline is 329 commits ahead of the original audit SHA `bf35fb8dd13628718dacc11c27654c0929fba0e2`; the original source line references must therefore be treated as historical and rechecked against the current files.

### 13.1 Current source identities and findings

| Source | Current main blob SHA | Revalidation result |
|---|---|---|
| `src/time/model.js` | `10fd5a0488cb4300634433df52983399b36afef0` | Unchanged from the original audit. Still defines safe integer millisecond coordinates and pure temporal primitives. |
| `src/time/scheduler.js` | `d7bf89422fc44491877e0aa6ab10ff1197b04c07` | Changed since the original audit. Current module header still states it is a pure planner that does not read/write storage, advance time, execute effects, or grant NPC knowledge. Current tests include same-coordinate dependency ordering and fail-closed plan cases. |
| `src/storage/sqlite-store.js` | `c528805d40d77ac23c3adae866c97d9b97b606e8` | Changed since the original audit. Current file still contains the canonical event/projection, time-trigger/time-advance, snapshot and rollback/rebuild implementation paths inspected for this study. A spatial projection contract was not identified in the current code search. |
| `tests/time-advance-operation.test.js` | `7684b2fee1c8a808f506343585948ea478885a4b` | Source still covers due-coordinate execution, operation replay and durable checkpoint recovery. It does not test spatial reconstruction. |
| `tests/time-segment.test.js` | `ed8d223f11ec5fa9ff8f9ec97f61a5586f2fe960` | Source still covers atomic segments, replay, rebuild and stale revision rejection. It does not test a spatial projection. |
| `tests/time-scheduler.test.js` | `11d9608175e4f6e86eb68144e5fdbda26483c330` | Changed since the original audit. Current tests explicitly cover `(from,to]`, stable order, same-coordinate dependency ordering, and blocked/invalid plans. They test planning, not spatial history. |
| `tests/snapshot-read.test.js` | `df92d1b88da2a5780f36cbce5358264e2661a9f0` | Changed since the original audit. Snapshot/currentness coverage remains a relevant prerequisite, but no spatial historical-read contract is established. |
| `tests/core.test.js` | `0543b8c6cd3aa45d069e1fc4294486a467bbe557` | Same blob as the original audit; rollback/rebuild coverage remains generic Core behavior, not spatial projection coverage. |
| `docs/63-time-advance-operation-runtime-slice.md` | `eb57ace27c6e1cefa875006a237707a7d016d120` | Current main retains the documented durable TimeAdvance slice, including checkpoint/restart boundaries and explicit non-goals. It does not authorize a spatial consumer to use private internals as a public contract. |
| `docs/13-event-type-contract.md` | `6bd40bd7afa9ecdc8f5e6a55ac1b830237352311` | Adopted Core contract says `event_type` is descriptive metadata, not authority or provenance proof. A spatial consumer must not trust an event solely because of its name. |
| `docs/07-knowledge-and-narrative-boundaries.md` | `9ec34438d14dab245fa3aca8de4ea735c7c9bf17` | Current main contains the scene-integrity semantic proposal: spatial relations/motion, uncertainty, provenance and NPC viewpoint must remain distinct. It explicitly does not approve a runtime schema/API or Memory→NPC enablement. |

### 13.2 Current-main search and status check

- Repository code search for `spatial` and for `position location coordinate frame` returned the knowledge/narrative boundary document, but no typed spatial runtime implementation in the searched default-branch results. This is bounded search evidence, not a proof that no relevant code exists anywhere in every branch.
- The current event trust contract reinforces the fail-closed rule: event names cannot establish source authority, approval, or provenance.
- Issue #351 has no owner decision in the comments retrieved during this pass; the latest retrieved coordinator instruction remains the request to compare candidate boundaries, define tests, and avoid new runtime contracts.
- Draft PR #529 was opened with this proposal. The workflow-run lookup for its head SHA `1f3723ebaf720f5374a2c1410fba859a28ab97ca` returned no PR-triggered runs, and the combined commit-status lookup returned no statuses. Therefore **CI is unverified**, not passed.
- The test files were inspected through GitHub source reads only; no test command was executed. This report does not claim tests passed.

### 13.3 Updated decision

The current-main revalidation does not change the architecture decision:

- **GO:** continue evidence-based design and isolated experiments only when a real approved input boundary exists.
- **NO-GO:** production spatial runtime, new schema/table/event/API/lifecycle hook, direct dependence on unapproved store internals, and Memory→NPC exposure.
- **Immediate external dependency:** Core must identify the supported committed-event read boundary (or explicitly decide that a separate contract is required); Core and Time owners must approve the supported reconstruction boundary and stale/rollback behavior.
- **Next internal task after that decision:** run the disposable candidate-A spike and acceptance tests against the approved seam. Without that decision, a mock interface would test an invented contract and would not satisfy the feasibility requirement.

This revalidation supersedes the original baseline for current-main source identities. It does not retroactively make the original source audit a test run.


## 14. Core decision — permitted read boundary and first experiment (2026-10-28)

**Decision owner:** Core. **Status:** approved for a bounded, internal, read-only feasibility experiment; not a production integration approval.

### 14.1 Is there an existing boundary?

**Yes, at the Core application layer for internal read-only consumption; no spatial-specific public/runtime contract exists.** The existing methods are:

- `src/application/engine.js:487` — `getState(id)`, delegating to `SQLiteStore.state`; returns the current world record, `world_revision`, `commit_sequence`, `game_time_coordinate`, entities, and facts in one read transaction.
- `src/application/engine.js:488` — `getSnapshot(id, request = {})`, delegating to `SQLiteStore.readSnapshot`; returns a bounded selection and its markers. It is not a full-world inventory when called with an empty request.
- `src/application/engine.js:489` — `getEvents(id, includeInvalid = false)`, delegating to `SQLiteStore.events`.
- `src/storage/sqlite-store.js:747` — `readSnapshot(id, request = {})`; reads requested canonical entities/facts/events and returns revision/cursor markers in one read transaction.
- `src/storage/sqlite-store.js:1025` — `events(id, includeInvalid = false)`; by default filters to `valid` events and orders them by `commit_sequence`.

These are existing Core application/store methods, not a new spatial API. They are suitable for a disposable internal experiment that stays inside Core-owned execution. They are **not** a grant to expose raw snapshot/event payloads to an LLM, Host, NPC, Memory Provider, or external consumer. The snapshot source explicitly labels its raw data as not automatically actor-authorized or model-safe.

### 14.2 Accepted read protocol for the experiment

Use only these existing methods (`getState` and `getEvents`); add no API, schema, table, event type, cursor, adapter, or lifecycle hook.

1. Read a baseline state snapshot from `getState(worldId)`. It returns `world_id`, `world_revision`, `commit_sequence`, `game_time_coordinate`, entities, and facts together in one SQLite read transaction.
2. Read the current valid event list from `getEvents(worldId, false)`. Its canonical order is `commit_sequence`; never reorder by game time alone.
3. Read `getState(worldId)` again. Accept the input batch only if all four marker fields equal the baseline and every event returned by the world-scoped `getEvents(worldId, false)` call has `validity === 'valid'`, a `commit_sequence` no greater than the marker, and a unique, strictly increasing `commit_sequence`. Otherwise discard the entire derived result and retry from the beginning or return unresolved.
4. Build a fresh in-memory projection deterministically from the accepted event list. Do not persist the projection and do not write to Core.
5. Before returning any derived result, compare the current marker to the projection's build marker again. A mismatch means stale: rebuild or refuse. Never serve the old result as current.
6. On process restart, discard the projection and reconstruct from Core. A rollback that changes `world_revision` invalidates the previous projection even if `commit_sequence` or game-time coordinate does not advance.
7. Treat `game_time_coordinate` as TimeEngine-owned time, not as a substitute for Core revision or event order. The initial supported query boundary is the latest stable committed snapshot only. Historical or intermediate-coordinate queries are not authorized by this decision.

This double-read marker check is a bounded consistency guard for ordinary Core mutations, not a substitute for a transactionally atomic read API. It assumes relevant Core mutations change the composite marker. It cannot detect restoration of an old database image that reproduces the exact same marker. Full-database restore anti-rollback remains **BLOCKED** and is outside the guarantee of this experiment.

### 14.3 Data and semantics permitted

The experiment may inspect committed event metadata/effects and canonical entities/facts internally, but it may derive a position, movement, orientation, or spatial relation **only when the committed source explicitly contains sufficient, unambiguous evidence under an approved interpretation**. Generic attributes, event names, absent values, and model inference are not spatial proof. If the current source has no agreed spatial semantics for a value, the derived answer must be `unknown` or `conflict`, not an invented coordinate.

No NPC perception, belief, memory, disclosure right, or acquisition authorization may be inferred from a world-side projection. Memory→NPC remains DISABLED / FAIL-CLOSED.

### 14.4 Required acceptance checks

The first isolated spike must exercise the real existing methods, not mocks, and prove:

- only valid committed events are consumed and order is deterministic;
- a marker change between the two reads rejects the whole batch;
- rollback/revision-only change invalidates an existing projection;
- replay and reconstruction after process restart produce equivalent output for the same accepted source;
- equal game-time coordinates preserve commit order;
- different worlds cannot share input or derived state;
- missing/conflicting spatial evidence remains unknown/conflict;
- stale data is refused at result publication;
- no writes are made to Core and no output is routed to Host, Memory, or NPC.

The test-only source-boundary spike at `tests/spatial-temporal-world-model-source-spike.test.js` passed on exact head `bffdd072e4545b40fc97b911673ab320374960c2`: [CI run #40589449385](https://github.com/necromorphic/Logic-Engine/actions/runs/40589449385), Runtime 805/805, recalculation-oracle harness 8/8, NPC-boundary job passed. The five new tests verify world-scoped valid-event reads, stable commit ordering, marker-change rejection, rollback/revision-only invalidation, deterministic in-memory replay without Core writes, and reconstruction after a file-backed process restart. This is source-boundary/replay evidence only, not proof of spatial semantics.

### 14.5 Core decision and remaining boundary

**Core decision:** use existing `engine.getState` + `engine.getEvents` as the source for the bounded internal feasibility spike under the read protocol above. Do not create a separate read API for the spike.

The decision does not approve a typed spatial event vocabulary, arbitrary historical-time queries, persistent spatial storage, a public consumer contract, or production integration. If the spike requires an atomic event-list-plus-marker read, a new event type/schema, or full-restore anti-rollback, stop and submit that narrower requirement for a separate review rather than silently adding a mechanism.

**Next action / owner:** Spatial research owner implements only the disposable test harness against the existing Core methods; Core reviews the observed diff and test output. TimeEngine owner reviews the boundary rule for any future historical/intermediate-time query. No production runtime changes are included in this approval.


### 14.6 Verification result (exact head 2026-10-28)

- **DONE / test-verified:** `tests/spatial-temporal-world-model-source-spike.test.js` passed on `bffdd072e4545b40fc97b911673ab320374960c2`. [Runtime CI #40589449385](https://github.com/necromorphic/Logic-Engine/actions/runs/40589449385) reports 805 tests passed, 0 failed; recalculation-oracle harness 8 passed, 0 failed; NPC-boundary job passed.
- **DONE / test-verified:** the five new tests specifically passed: stable world-scoped source read; mutation between state/event reads rejected; rollback invalidates by `world_revision` even when commit sequence and game-time coordinate do not advance; deterministic replay does not write Core state; file-backed restart reconstructs equivalent source evidence.
- **NOT DONE / not established:** a typed spatial event/attribute contract; derivation of position, movement, orientation, or relative geometry; semantic conflict resolution; historical/intermediate-time queries; full-database restore anti-rollback. The current spike deliberately does not invent spatial meaning from generic attributes.
- **NO runtime integration:** only a test file and research documentation changed. No production code, schema, or new runtime contract was added. Memory→NPC remains DISABLED / FAIL-CLOSED.
