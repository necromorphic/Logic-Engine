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


## Authorized-read dependency checkpoint — 2026-10-24

Reviewed open Draft PR #65, `core/authorized-read-service-prototype`, head `971fe4c7a4eeb3b49a688f87e2b73f3e080f196a`, against Memory's request requirements. This is a branch review, not a merged-main capability claim.

What the PR proposes:
- an internal `AuthorizedReadService` requiring canonical actor binding plus an explicit trusted field-policy callback;
- a bounded HTTP route that, until a trusted visibility schema exists, exposes only the bound actor's own identity/type/status fields and denies arbitrary attributes;
- distinct protection for raw canonical state/events/audit HTTP reads and adapter-scoped proposal payload reads;
- fail-closed policy handling and a consistent snapshot marker.

What this does **not** close for Memory/NPC:
- it is not a general authorization policy for a subject to read arbitrary Memory records, source evidence, or multi-entity facts;
- actor binding is still identity resolution, not the access decision for a declared recipient/subject and purpose;
- direct in-process snapshot/state interfaces remain trusted internal surfaces and every serializing caller still needs auditing;
- the PR body says its latest head needs CI revalidation; earlier-head success is not final-head validation.

Decision impact:
- MEM-O02 remains open. Reuse the service boundary only after the PR is reviewed/merged or explicitly adopted, and only where its actual scope matches the requested read. Do not treat the self-only route or a generic policy callback signature as the complete Memory visibility contract.
- The Memory candidate contract must bind the authorization result to the exact request scope and revalidate before serialization; NPC's pure admission helper is downstream defense-in-depth, not a replacement for this boundary.
- No dependency on PR #65 is assumed by PR #68, and no runtime integration is claimed.

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

### NPC first-slice implementation review — consumer oracle boundary

The NPC branch now also includes a pure candidate-admission helper and Node test file, separate from the documented future integration. Their own comments correctly state that this helper does not authenticate scope, perform the authorized read, revalidate current source state, or persist acquisition/delivery/belief.

A cross-block review comment was posted to Issue #70 identifying two items for the NPC owner to verify on the exact branch head:
- the last unsafe-summary fixture in `tests/npc-memory-candidate-eligibility.test.js` appears to have an unmatched/missing closing brace and may prevent the test file from parsing;
- the helper checks `content_kind === "summary"` to trigger lineage checks but does not reject missing/unknown `content_kind`, which could bypass those checks; the NPC contract says unknown content/source kind is not admissible for knowledge-asserting context.

No NPC files were edited from the Memory branch, and the test file was not executed here. Memory's own acceptance matrix now includes **MEM-034** for unknown/missing content kind and **MEM-035** for stale, provenance-incomplete, or unavailable archive/vector results so that a future integrated boundary cannot bypass derived-content safety through an unrecognized type. This is a contract test requirement, not a claim that either block's tests currently pass.


## Direct response to NPC Memory↔NPC integration report — 2026-10-24

This section answers the six questions in the NPC report. It distinguishes inspected current-main behavior from the proposed contracts in this branch. It does not approve an API or claim runtime implementation.

### 1. Implemented guarantees versus proposals

**Observed on current `main`:**
- Core has a SQLite transaction primitive and a consistent read-snapshot path exposing `world_revision` and `commit_sequence`.
- Canonical rollback changes event validity, records rollback information, advances world revision, and rebuilds projections.
- Actor binding resolves identity; it does not authorize Memory/knowledge reads.
- The inspected current-main schema does not provide a Memory-specific durable change outbox, and current `main` does not implement the proposed general Memory record/retrieval subsystem.

**Proposed only in this branch (docs/64–72):**
- versioned Memory records and source lineage;
- per-request authorization before disclosure plus a final access/lifecycle recheck;
- typed distinction between empty, partial, denied/withheld, stale, invalid-cursor, and unavailable outcomes;
- derived-summary lineage/access propagation;
- rollback-aware recoverable reconciliation;
- explicit error, completeness, and lifecycle semantics.

Open PR #65 is also an unmerged proposal and its self-only read path does not establish general Memory/NPC visibility policy. NPC's branch helper is a consumer-side candidate-admission oracle, not the missing trusted read boundary.

### 2. Retrieval contract NPC should treat as normative

There is **no approved runtime Memory API/result schema yet**. For design and acceptance tests, the current proposed normative safety requirements are in docs/65–70, especially docs/66:
- request scope binds world, authenticated requester, recipient/actor, purpose, query bounds, and retrieval mode;
- access is decided by a trusted host/Core policy, not by request fields or NPC-supplied claims;
- inaccessible content and metadata are not disclosed, including snippets, counts, ranking details, cursors, and diagnostics;
- a returned candidate has stable record identity/version, world scope, typed kind, source version/lineage, source freshness/reconciliation state, orthogonal lifecycle metadata where applicable, and a request-scoped access decision;
- search status/completeness is separate from the candidate list;
- retrieval has no acquisition, delivery, receipt, belief, or canonical-state side effects.

The candidate JSON in docs/66 is illustrative, not a frozen wire format. NPC should fail closed when any safety-critical field or trusted decision required by its contract is absent or ambiguous; it must not guess an omitted field's meaning.

### 3. Versions, freshness, summary lineage, and permissions

These semantics are **specified as design targets, not implemented guarantees**:
- Memory record identity is world-scoped; each logical record needs a stable ID plus a version strategy (immutable versions or a durable history/current pointer; MEM-O04 remains open).
- Source references in derived records must bind source identity and expected version. `record_version` and source version are distinct.
- Source reconciliation/currentness is distinct from content disposition, evidence assessment, per-request access, and index health.
- A summary must retain a complete versioned lineage manifest for every material contributing source. The summary producer is not the author/verifier of all claims.
- Recheck source permissions for the current reader at retrieval/serialization time. If lineage, source versions, or permissions cannot be evaluated, withhold protected derived content by default. Exact policy and any declassification exception require approval.
- A final authorization check is the proposed safety boundary, but no race-free revocation/serialization guarantee has been implemented or approved. The implementation must define its consistency/atomicity boundary rather than claiming that a pre-search check alone closes the race.

### 4. Empty result versus denial, unavailable index, and partial result

The proposed contract requires distinct typed outcomes; an empty candidate array alone is insufficient. The semantic distinctions are:
- **complete + no matches:** the authorized query completed and found no eligible candidate;
- **complete + results:** eligible candidates were returned;
- **partial:** candidates may be returned only with an explicit limitation and only if caller policy permits partial use;
- **unavailable:** requested retrieval mode/index or required reconciliation dependency cannot serve the request;
- **denied/withheld:** the access decision forbids disclosure; do not disclose protected candidate details or confirm protected existence;
- **stale/reconciliation-pending:** source currency is not established; current-only consumers must withhold/fail closed;
- **invalid/stale cursor or request:** reject rather than silently broadening or restarting under different scope.

These are proposed semantic classes, not current API status strings. Exact enum names and safe error envelope remain open under MEM-O02/MEM-O09 and the docs/66 approval gates.

### 5. Revocation during read and post-rollback changes

**Revocation:** docs/66 proposes authorization before retrieval and a final recheck of every candidate before content serialization, including derived-source permissions. No current-main Memory endpoint provides this guarantee. The implementation must bind the decision to the exact world/requester/recipient/purpose/source snapshot and define what happens if the policy changes during the read. If the required current decision cannot be obtained, protected content is withheld. The exact linearization point and whether policy versioning or a transaction/snapshot can close the race remain unapproved.

**Rollback:** do not watch only for a higher `commit_sequence`. Current Core rollback can change validity and `world_revision` without a higher maximum commit sequence. docs/67 proposes a recoverable reconciliation mechanism that observes revision/rollback/validity changes and is idempotent after interruption. No approved durable Memory outbox/cursor currently exists; MEM-O01 and MEM-O11 remain open until Core selects the signal and consistency guarantee.

### 6. Joint integration tests and blockers

Memory can accept the NPC negative cases as **contract-level acceptance requirements**, including cross-world source, missing/ambiguous access, stale/retracted source, summary with one revoked source, unavailable/partial index, conflicting evidence, empty authorized result, delivery failure/unknown receipt, rollback without a higher commit sequence, and idempotent retry after partial failure. Memory's own matrix MEM-001–MEM-036 is a proposed test plan, not an executed suite.

**Blocked from being honest runtime integration tests until dependencies are approved/implemented:**
- general trusted authorized-read policy and exact failure semantics (MEM-O02; PR #65 is not sufficient as-is);
- durable rollback/source-change signal and currentness guarantee (MEM-O01/MEM-O11);
- trusted source namespaces and host binding (MEM-O05);
- NPC actor/recipient and delivery/acquisition identifiers plus Core-owned persistence path (MEM-O06);
- storage/transaction ownership and existing vectorization/host integration (MEM-O03/MEM-O08);
- approved summary access propagation/declassification and lifecycle/retention transitions (MEM-O07/MEM-O10).

Until then, tests can validate pure helpers and static contract fixtures, but cannot prove authorization, revocation races, durable reconciliation, real index completeness, or persisted delivery/acquisition/belief semantics. No tests are claimed as executed by this report. The NPC test syntax and unknown/missing `content_kind` review notes remain for the NPC owner to verify on the exact branch head; Memory has not modified NPC files.

## Vectorization boundary audit — MEM-O08, 2026-10-24

This pass narrows the evidence available for MEM-O08 without pretending the existing vectorization patch has been fully inspected.

### Repository evidence

- `docs/13-sillytavern-adapter-contract.md` on `main` is explicitly a requirements document; it says the vectorization patch is a separately owned archive/retrieval system, requires read-only discovery first, prohibits engine schema migrations/writes during initial integration, and says a vector result is not authoritative truth.
- The same contract requires source message/document IDs where available, and filtering by world, branch validity, source validity, subject access, and privacy before use. Canonical structured state wins over stale archive text; provenance-free fragments may be unverified context only.
- Searches of the repository's indexed default-branch code for `vectorization`, `vector`, `embedding`, and `Ollama` did not surface an implementation file. This is not proof that no patch exists in another branch, extension, local deployment, or unindexed path; it means this pass cannot honestly identify its concrete storage schema, update hooks, embedding model, or freshness guarantees.
- No vectorization implementation was modified, migrated, or replaced by this Memory branch. No duplicate index was introduced.

### Recommendation (not yet an implementation decision)

1. Keep the existing archive/index owned by its current component. Memory should depend on a narrow read-only retrieval adapter rather than own a second embedding pipeline or write into the archive.
2. Require the adapter to return source identity and whatever source-version/branch-validity metadata the host can actually prove. Missing metadata must be represented as unknown/unverified, not synthesized from text or similarity score.
3. Treat vector hits as candidate discovery only. Resolve each candidate against authoritative source/currentness and the approved request-scoped authorization boundary before returning content; stale or unverifiable candidates cannot be represented as current canonical facts.
4. Keep exact/structured lookup against the authoritative Memory record store conceptually separate from semantic archive search. If the existing backend is unavailable or stale, return the agreed typed partial/unavailable outcome; never translate backend failure into a successful empty result.
5. Before coding the adapter, inspect the actual patch/extension and record its repository/location, owner, stable source identifiers, write/update lifecycle, deletion/rollback behavior, and test command. This requires the patch location or source to be visible to the repository audit; until then, MEM-O08 stays open.

### Decision status

MEM-O08 is **partially evidenced, unresolved**. The safe integration boundary is clear at the documentation level, but the concrete existing backend and its lifecycle are not established by the inspected `main` source. This section does not claim the vectorization patch is absent, broken, or tested.

## Current-main storage and rollback evidence — MEM-O01, MEM-O03, MEM-O08, 2026-10-24

This is a source-level audit of the current `main` branch, not a runtime test report.

### Files and observed guarantees

- `src/storage/sqlite-store.js`: the inspected schema includes canonical `worlds`, `world_events`, `entities`, `fact_claims`/`facts`, `audit_entries`, `idempotency_keys`, `rollbacks`, and `context_manifests`, plus mechanic/rule registries. No Memory record table, embedding/vector index, or durable Memory source-change outbox table was identified in this schema.
- The same store's `tx(fn)` uses `BEGIN IMMEDIATE`/commit/rollback for outer writes and savepoints for nested writes. This is a local SQLite transaction primitive; it does not establish a cross-subsystem transaction with a separately owned archive or an atomic outbox that does not exist.
- The `rollback(...)` path is transactional. It reads canonical events, determines invalidated descendants, persists rollback metadata, changes event validity and rebuilds affected projections/revision state. Consumers must not assume rollback always creates a larger maximum `commit_sequence`.
- `src/application/actor-bindings.js`: actor binding is explicitly identity resolution only, not authorization for knowledge reads, action semantics, approval, or commit. It must not be reused as a Memory visibility policy.
- `docs/13-sillytavern-adapter-contract.md` on `main`: the vectorization patch is separately owned; initial integration is read-only; no engine schema migrations/writes; vector hits are not canonical truth; source identity, branch validity, source validity, subject access and privacy must be checked where available.
- `docs/39-npc-core-knowledge-contract-proposal.md` on `feat/npc-subsystem` is a proposal, not merged runtime. It assigns authoritative acquisition records, delivery attempts/receipts, source reconciliation and persistent subject-relative belief state to Core, and forbids parallel NPC-owned stores for these concepts.

### Consequences for implementation gates

1. **MEM-O01:** no durable Memory outbox is present in the inspected schema. Do not add one until Core chooses the canonical source-change contract and transaction ownership.
2. **MEM-O03:** Memory persistence placement remains open. The existing transaction helper alone does not justify coupling new Memory tables to canonical writes.
3. **MEM-O05/MEM-O06:** trusted source binding and NPC actor/recipient/delivery identifiers remain prerequisites for an honest persistent acquisition/delivery contract.
4. **MEM-O08:** do not implement vector storage or assume the extension is absent. The concrete vectorization patch/repository, API, owner and lifecycle are still not discoverable from this source audit; a read-only adapter remains the only safe candidate after that code is located.
5. **MEM-O11:** reconciliation must detect rollback/revision/validity changes, not only newly increasing event sequences. A recoverable poll/reconciliation strategy can be designed, but its cursor and freshness guarantee are not approved yet.

No runtime files were changed. No test suite was executed by this documentation pass. These findings should be rechecked against the exact `main` head before runtime implementation.

## Cross-block review note — NPC candidate lineage world scope, 2026-10-24

Reviewed NPC's updated pure candidate-admission helper on `feat/npc-subsystem` / draft PR #76 after the owner reported the missing/unknown `content_kind` gate had been added. The helper now explicitly rejects missing/unknown content kinds and requires summary lineage to be complete, current, and access-allowed. The owner also clarified that producer/lifecycle dimensions are future-boundary metadata; the helper does not authenticate their origin or validate owner-defined enums.

One further boundary gap was reported to Issue #70: `lineageIsSafe()` checks source ref/version/access/freshness but does not prove each summary source belongs to the requested world. Without a world-scope check or a documented trusted upstream guarantee, cross-world source lineage could be admitted by the pure helper. This is a review finding from source inspection, not an executed test failure.

Memory acceptance matrix case **MEM-036** now requires rejection of foreign or unproven source world scope before prompt serialization. The approved source-reference schema is still open; this test does not prescribe an invented field/API. NPC owner was asked either to add fail-closed oracle coverage using the eventual approved scope contract or explicitly document and later test the trusted-boundary precondition.

PR #76 remains a proposal pending exact-head CI/test evidence. Memory did not edit NPC files and does not claim its tests passed.
