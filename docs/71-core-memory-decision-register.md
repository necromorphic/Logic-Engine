# Core Memory decision register

Status: living register for the proposed Memory subsystem. “Proposed” is not an approval from the Core owner or sibling blocks.

## Decisions proposed

| ID | Proposed decision | Rationale | Status |
|---|---|---|---|
| MEM-D01 | Core remains sole canonical world authority | Prevents memory from becoming a second truth engine | Proposed; consistent with README and current Core contracts |
| MEM-D02 | One versioned record envelope with typed payloads and epistemic kind | Avoids separate stores for every conceptual memory type while preserving different guarantees | Proposed |
| MEM-D03 | Search indexes are derived and rebuildable | Prevents vector/full-text backend from becoming authoritative | Proposed; consistent with repository README |
| MEM-D04 | Provenance authority is host-derived; model assertions are not proof | Prevents self-assigned trust | Proposed; align with trusted mutation-origin contract |
| MEM-D05 | Retrieval authorization is mandatory and independent of ranking | Prevents search from becoming an access-control bypass | Proposed; depends on approved policy |
| MEM-D06 | No generic numeric confidence field | No calibration or cross-domain semantics currently defined | Proposed |
| MEM-D07 | Summaries retain source/version manifests and cannot delete sources by default | Preserves lineage and reversibility | Proposed |
| MEM-D08 | Canonical source rollback triggers stale/review/recompute lifecycle, not silent deletion | Distinguishes audit, validity, and derived state | Proposed; reconcile with Core rollback contract |
| MEM-D09 | Memory remains optional for unrelated Core operations | Preserves plugin/module boundary | Proposed |

## Open decisions and owners

| ID | Question | Options / consequence | Owner |
|---|---|---|---|
| MEM-O01 | Does Core provide a durable outbox/change feed for canonical source changes? | Use it if present; otherwise polling/reconciliation. Do not assume callbacks survive crashes. | Core |
| MEM-O02 | Which trusted authorization/visibility policy can Memory call? | Reuse approved Core service, define a narrow internal policy contract, or deny protected reads until available. | Core + Memory |
| MEM-O03 | Does the initial record store live in the existing SQLite database or a separate optional store? | Shared transaction may simplify atomicity but increases coupling; separate store requires reconciliation. Decide after schema/transaction audit. | Memory + Core |
| MEM-O04 | Are record versions immutable rows or mutable current row plus history? | Both can work only with reconstructable audit/version guarantees. | Memory |
| MEM-O05 | What are trusted source namespaces for SillyTavern messages, generations, external artifacts, and NPC delivery? | Must be bound by host adapters; absent binding means unverified provenance. | Core + NPC + adapter |
| MEM-O06 | Which actor/recipient identifiers and delivery event shape does NPC own? | Memory must not invent a competing actor binding or delivery ledger. | NPC + Memory |
| MEM-O07 | What retention and physical-erasure obligations apply to evidence and summaries? | Logical retraction and physical deletion need separate semantics. | Project owner |
| MEM-O08 | Which search backend exists today, and what does the existing vectorization patch own? | Preserve existing work; adapt via interface, do not duplicate or replace without audit. | Memory + project owner |
| MEM-O09 | What is the maximum payload, source-manifest size, query limit, and retention budget? | Requires repository conventions and deployment constraints. | Memory |
| MEM-O10 | What exact lifecycle state dimensions are required? | Single enum is simpler; orthogonal lifecycle/freshness/access dimensions may be more accurate. Resolve from transition tests. | Memory + NPC |
| MEM-O11 | What consistency level must NPC retrieval guarantee after source rollback? | Strict-current reads may fail closed; eventual reads need explicit stale markers. | NPC + Core + Memory |
| MEM-O12 | Which numbering range/file names are reserved by open PRs and sibling blocks? | Avoid file collisions when parallel branches are integrated. | All block owners |

## Phase 0 repository audit — 2026-10-24

Evidence inspected on `main`: `src/storage/sqlite-store.js`, `src/application/engine.js`, `src/api/server.js`, `docs/21-stage1-causality-contract.md`, and `README.md`. This is a source inspection, not a test-run claim.

| Finding | Evidence and implication |
|---|---|
| SQLite has a reusable local transaction primitive | `SQLiteStore.tx(...)` uses `BEGIN IMMEDIATE` / `COMMIT`, nested savepoints, and rollback-on-error. Canonical event commits and projection rebuilds run inside this transaction. A same-database memory record plus durable pending-index row could be atomic only if writes are integrated into this transaction boundary; no such integration exists now. |
| A consistent canonical read snapshot exists | The store snapshot path uses one read transaction and returns `world_revision` plus `commit_sequence`. These are useful source cursors only when captured from the same snapshot; they do not prove causal completeness. |
| No durable source-change outbox was identified in the inspected store schema | The current event journal and rollback records are available as source material, but no memory-specific outbox/change-feed contract was found. Do not assume callbacks survive crashes. |
| Rollback is not only a new-event append | Rollback changes event validity, records a rollback row, increments world revision, and rebuilds projections. A consumer that only polls for larger `commit_sequence` values can miss source invalidation. Any polling/reconciliation design must detect validity changes and rollback/revision movement, not only newly appended events. |
| Existing causal semantics are explicitly partial | `docs/21-stage1-causality-contract.md` says caller metadata does not prove causal completeness and knowledge records are not implemented. Memory may preserve references, but cannot synthesize missing dependency edges or promise complete invalidation. |
| Memory/NPC runtime is not present on main | README says knowledge acquisition/belief and actor-authorized reads are not implemented. NPC's branch proposal is semantic documentation only; its ownership decision must be honored without pretending an executable contract exists. |
| Actor binding is not memory authorization | `src/application/actor-bindings.js` explicitly says bindings authorize identity resolution only, never knowledge reads. An authenticated adapter-to-actor binding cannot substitute for the missing actor/purpose/visibility policy. |

### Decision updates from this audit

- **MEM-O01 (source changes):** no durable outbox was identified in the inspected main store. A recoverable cursor/reconciliation strategy is the current candidate, but its cursor must cover both event additions and invalidation/correction changes. Mark the question only partially resolved until Core approves the mechanism and exact cursor semantics.
- **MEM-O03 (storage placement):** the existing SQLite transaction primitive makes same-database atomicity technically plausible, not approved. Do not choose placement until Core confirms coupling/migration policy and the implementation hook.
- **MEM-O08 (vectorization):** not resolved by this audit; inspect the actual existing vectorization patch/host integration before recommending any index or storage change.

## Cross-block dependency: NPC knowledge proposal

The NPC branch proposal `feat/npc-subsystem:docs/39-npc-core-knowledge-contract-proposal.md` (section 10) records the Core owner's semantic decision that Core owns authoritative acquisition/provenance records, delivery attempts/status, source reconciliation, and persistent subject-relative belief state. This is not yet a merged runtime contract. Before Memory runtime implementation, reconcile the proposal with Core's current storage/API and decide whether any generic Memory persistence primitive may back these Core-owned record types. Do not implement parallel acquisition, delivery, belief, revision, causal graph, or rollback stores in the Memory block.

## Risks

1. Open PRs may add services/contracts that are not in `main`; this document intentionally treats them as candidates until merged or explicitly rebased for review.
2. The current Core causal contract does not prove complete causal provenance. Memory cannot compensate by inventing missing edges.
3. A summary may be syntactically linked to sources yet semantically omit important contradictions; source lineage is necessary but not sufficient.
4. Search authorization can leak through snippets, counts, ranking, pagination, and derived summaries unless these are included in policy.
5. Concurrent sibling changes can invalidate filenames or assumptions; reconcile before opening or updating a PR.
6. Existing vectorization work must be inspected before proposing replacement or duplicate indexing.

## Change policy

Every resolved open question must record the evidence, selected option, alternatives rejected, compatibility impact, and required tests. Do not mark a decision accepted merely because a draft PR exists.

## Cross-block reconciliation — NPC Memory consumption follow-up, 2026-10-24

The NPC branch now contains `docs/52-npc-memory-consumption-contract-and-failure-matrix.md` on `feat/npc-subsystem`, referenced by Issue #70. Treat it as a sibling proposal/acceptance oracle only: it is not on `main`, does not approve a Memory API, and does not establish a production Memory↔NPC integration. Issue #70 remains the coordination record until its owner closes or updates it.

### What the NPC proposal resolves independently

- NPC candidate admission must fail closed when actor/world/purpose access, lineage, source freshness, or completeness is absent or ambiguous.
- Retrieval, ranking, context inclusion, summary generation, and context manifests do not themselves establish acquisition, delivery/receipt, comprehension, belief, or canonical truth.
- Producer provenance is distinct from source/content lineage; derived content without complete lineage or safely evaluable source permissions is not admitted as current model context.
- Lifecycle concerns are orthogonal: content disposition, source reconciliation, evidence assessment, request-scoped access, index health, lineage completeness, and query-result completeness must not be collapsed into a single status.
- Negative-case and transition matrices distinguish retrieval, delivery attempt, host acceptance, confirmed visibility, receipt, acquisition, and belief; retries preserve unknown outcomes rather than assuming success.
- Rollback/source invalidation must not be inferred solely from a larger maximum `commit_sequence`.

These are consumer-side rules and test oracles. They do not supply the missing Core/Memory authority, persistence, authorization, or source-change signal.

### Remaining Core/Memory gates

1. Approve and implement the actor/world/purpose/snapshot-scoped authorized-read boundary and its safe denial/withheld/partial semantics.
2. Define the real candidate/result contract, including record and source versions, lineage completeness, lifecycle dimensions, and safe error metadata.
3. Select and implement a recoverable source-change/reconciliation signal that detects rollback and validity changes even when `commit_sequence` does not increase.
4. Approve derived-summary source-permission propagation and any explicit declassification path.
5. Establish the actual storage/transaction boundary for generic Memory records and any Core-owned semantic acquisition/delivery/belief records, without parallel ledgers.
6. Reconcile the existing vectorization/host integration before selecting or duplicating an index backend.

### Compatibility note

The NPC candidate shape in `docs/52` uses illustrative labels that are not identical to the Memory candidate example in `docs/66`. Do not freeze either example as the API. Before implementation, normalize the semantics in a single reviewed result contract: at minimum preserve record ref/version, world, trusted request binding, per-request access outcome, producer provenance, source lineage and versions, freshness/reconciliation, orthogonal lifecycle dimensions, result completeness, and typed non-ready/error outcomes. Keep access and index health request/operation scoped where appropriate; do not serialize protected candidate metadata on denied/withheld paths.

### Decision status

The NPC follow-up substantially closes the requested NPC-side documentation deliverables, subject to the NPC owner reviewing/closing Issue #70. It does **not** close Core-owned decisions MEM-O01, MEM-O02, MEM-O05, MEM-O06, MEM-O08, MEM-O10, or MEM-O11, nor authorize runtime implementation. No runtime behavior or test execution is claimed by this reconciliation.

