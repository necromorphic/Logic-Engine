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

Historical checkpoint before Core PR #65 was merged (superseded by the current-main audit in docs/73): this review examined the then-open Draft branch `core/authorized-read-service-prototype`, head `971fe4c7a4eeb3b49a688f87e2b73f3e080f196a`. Do not read its former PR state as current.

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
- MEM-O02 remains open as a **production policy/integration decision**, not because PR #65 is unmerged. PR #65/#101 are now on main; the route remains self-only unless a trusted host policy is explicitly configured. Do not treat the seam or callback signature as the complete Memory visibility contract. See docs/73.
- The Memory candidate contract must bind the authorization result to the exact request scope and revalidate before serialization; NPC's pure admission helper is downstream defense-in-depth, not a replacement for this boundary.
- At that historical checkpoint, PR #68 did not depend on PR #65 and claimed no runtime integration. Current Core/Memory integration limits are summarized in docs/73.

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

Historical checkpoint before PR #65/#101 merged: the then-open PR #65 self-only read path did not establish general Memory/NPC visibility policy. Current state is recorded in docs/73. NPC's branch helper is a consumer-side candidate-admission oracle, not the missing trusted read boundary.

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

Memory can accept the NPC negative cases as **contract-level acceptance requirements**, including cross-world source, missing/ambiguous access, stale/retracted source, summary with one revoked source, unavailable/partial index, conflicting evidence, empty authorized result, delivery failure/unknown receipt, rollback without a higher commit sequence, and idempotent retry after partial failure. Memory's own matrix MEM-001–MEM-037 is a proposed test plan, not an executed suite.

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

## Reconciliation fallback decision gate — MEM-O01/MEM-O11, 2026-10-24

The consistency contract now records a **candidate only**, not approved, full-inventory reconciliation fallback for the case where Core does not provide a durable outbox. It captures a consistent world revision/commit-sequence marker, compares a complete source inventory after relevant marker changes, reconciles source additions/corrections/validity changes idempotently, and advances the durable marker only after a successful complete scan. Periodic full comparison is included as a recovery path.

This strategy is not ready to implement until Core confirms (a) all relevant source-validity mutations advance an observed marker, (b) a complete authoritative source inventory is available, and (c) stable source identities/versions can be compared. A failed or partial scan must retain the last completed marker and remain stale/pending. **MEM-037** records this acceptance condition. No runtime behavior is claimed.

## Cross-block review note — NPC candidate lineage world scope, 2026-10-24

Reviewed NPC's updated pure candidate-admission helper on `feat/npc-subsystem` / draft PR #76 after the owner reported the missing/unknown `content_kind` gate had been added. The helper now explicitly rejects missing/unknown content kinds and requires summary lineage to be complete, current, and access-allowed. The owner also clarified that producer/lifecycle dimensions are future-boundary metadata; the helper does not authenticate their origin or validate owner-defined enums.

One further boundary gap was reported to Issue #70: `lineageIsSafe()` checks source ref/version/access/freshness but does not prove each summary source belongs to the requested world. Without a world-scope check or a documented trusted upstream guarantee, cross-world source lineage could be admitted by the pure helper. This is a review finding from source inspection, not an executed test failure.

Memory acceptance matrix case **MEM-036** now requires rejection of foreign or unproven source world scope before prompt serialization. The approved source-reference schema is still open; this test does not prescribe an invented field/API. NPC owner was asked either to add fail-closed oracle coverage using the eventual approved scope contract or explicitly document and later test the trusted-boundary precondition.

PR #76 remains a proposal pending exact-head CI/test evidence. Memory did not edit NPC files and does not claim its tests passed.


## Follow-up checkpoint — NPC PR #76, 2026-10-24

After the previous review note, NPC's latest reported head (d7961d660363418277a0ecbdc6e6fc9013879414) added explicit rejection for missing/unknown epistemic_kind, missing producer metadata, missing lifecycle dimensions, and non-admissible lifecycle states. The current helper source confirms these presence/value gates exist. They validate supplied metadata shape and positive values; they do **not** authenticate the producer, prove that a caller's access outcome is genuine, or create the missing Core authorization boundary.

The remaining concrete cross-block finding is summary source world membership: lineageIsSafe() still checks each source's reference/version/access/freshness but does not compare or require a source world scope. A current-looking source from another world, or one with unproven world membership, can therefore pass this helper's lineage predicate. This remains a source-inspection finding, not an executed failing test.

NPC follow-up acceptance is now narrowed to:
1. Add a fail-closed pure-oracle case for foreign and missing/unproven lineage world scope using the eventual owner-approved source-reference contract; **or** explicitly state the trusted upstream same-world guarantee as a precondition and add boundary coverage when that boundary exists.
2. Keep producer/access/lifecycle checks described as consumer-side defense-in-depth, not authentication or an approved Memory API.
3. Report exact-head CI/test evidence for PR #76. The current reported state has no workflow run for that head; no pass/fail result is established here.

Related acceptance case: **MEM-036**. PR #76 remains draft/unmerged; Memory has not edited NPC files or run the NPC test suite.


## Exact-head refresh — NPC PR #76, 2026-10-24

A fresh PR metadata read reports current head `60ea6287e57cfd10164735761951dff32abf627c` (open Draft, unmerged). The GitHub workflow-run query for this exact SHA returned no PR-triggered workflow runs. This is an absence of available run evidence, not a test failure or success. Keep the exact-head CI gate open.

The helper's current source still has no world-scope requirement in summary `lineageIsSafe()`: each source is checked for non-empty ref/version, access allow, and current freshness only. The source-world gap remains unresolved until the owner adds the contract-backed negative case or documents a trusted upstream same-world precondition with boundary coverage. No runtime schema should be invented to close it.


## NPC cross-review refresh — 2026-10-24 (world scope resolved; access binding next)

The current NPC branch source has now closed the previously reported **lineage world-scope** gap: `lineageIsSafe()` requires each summary source's `world_id` to equal the request world and binds source access metadata to the request subject and purpose. The current tests include a foreign-world source and mismatched subject/purpose fixtures. This resolves the source-inspection finding at the pure-oracle layer; runtime availability of those fields and upstream authorization remain unapproved. The older paragraphs above describe the earlier head and should be read as historical checkpoints.

A new adjacent gap is visible in the current helper: candidate-level `candidate.access` and result-level `result.access` are accepted based on `outcome === allow` alone. Unlike lineage source access, those decisions are not required to carry subject/purpose binding matching the trusted request. Candidate scope fields and result scope do not by themselves prove that an allow decision was made for this subject and purpose. A stale/replayed or misbound allow marker could therefore be admitted by the pure helper if all other fields match. This is a source-review finding, not an executed test failure.

NPC follow-up Issue #70 now asks for fail-closed negative oracle cases for missing/mismatched subject and purpose on both candidate-level and result-level access decisions, or a precise documented trusted-boundary guarantee plus tests at that boundary. This remains defense-in-depth only: NPC cannot authenticate the decision; Core/Memory must supply a genuine request-scoped authorization result. Memory acceptance case **MEM-038** records the requirement. PR #76 current head `80bc5d8fca34f655a67ca85f7c8f3ba6b99ef09b` is open Draft/unmerged; the workflow-run query for this exact SHA returned no runs, so exact-head test evidence remains unavailable.


## NPC cross-review refresh — 2026-10-24 (access-decision binding resolved; evidence assessment next)

Re-fetched the live PR #76 head: `52f9ad8f9945c6e2e203298f53247d42c734c3ee`. The current helper now requires both candidate-level and request-level access decisions to match the trusted request's `subject_id` and `purpose`, in addition to `outcome === "allow"`. The test file includes focused negative cases for mismatched actor and purpose at both levels. This resolves the earlier access-binding source-inspection finding at the NPC pure-oracle layer; it does not authenticate the decision or establish an approved runtime Memory API. The earlier section's claim that access decisions are outcome-only is historical and superseded.

Exact-head workflow query for `52f9ad8f9945c6e2e203298f53247d42c734c3ee` returned no PR-triggered workflow runs. No pass/fail conclusion can be drawn; PR #76 remains Draft/open/unmerged.

**Next review question:** `lifecycleIsPresent()` requires a non-empty `evidence_assessment`, but `lifecycleIsAdmissible()` does not evaluate that dimension and the admitted projection omits it. Core Memory proposal `docs/65` identifies `unassessed`, `supported`, `disputed`, and `insufficient` assessments where a typed policy defines their semantics. Ask NPC to preserve the assessment for downstream handling or fail closed for states whose admission semantics are not approved, with negative tests. This is a source-review finding/question, not an executed failing test. Do not prescribe a new enum policy in the NPC block.


## Exact-head refresh — NPC PR #76, 2026-10-24 (MEM-039)

After recording the access-binding resolution, PR metadata advanced again to `6cf3b704d625e7098fa3ca98beb6323bf21d28a3` (open Draft/unmerged). The helper and tests were re-fetched after that update. Candidate-level and request-level access decisions now require subject/purpose binding, and the corresponding negative fixtures are present. The lineage source world/subject/purpose checks also remain present. These are pure-oracle protections, not proof of authentic authorization or an approved Memory runtime interface.

A new source-level concern was sent to NPC Issue #70: `evidence_assessment` is required to be non-empty but is not considered by `lifecycleIsAdmissible()`, and it is omitted from the admitted reference projection. Core Memory's proposal lists `unassessed`, `supported`, `disputed`, and `insufficient` where a typed policy defines their semantics. Memory acceptance case **MEM-039** now requires the admission boundary to preserve this distinction for downstream handling or fail closed where semantics are not approved. This is a contract review finding, not an executed test failure.

The exact-head workflow query for `6cf3b704d625e7098fa3ca98beb6323bf21d28a3` returned no PR-triggered runs. No pass/fail conclusion is established. PR #76 must remain Draft until exact-head test evidence and contract review are available.


## Exact-head refresh — NPC PR #76, 2026-10-24 (MEM-039 still open after side-channel fix)

The newest observed PR #76 head is `382311db34a8e0662cfd47f773756dcad6684b9a`, open Draft/unmerged. Current source confirms the request/candidate access-decision binding and summary-lineage scope gates. The NPC owner also removed candidate-level rejection diagnostics and status differences that could reveal whether filtered candidates existed; this closes that particular consumer-side side-channel at the helper output boundary.

**MEM-039 remains a review gate.** At this exact head, `evidence_assessment` is required to be non-empty, but `lifecycleIsAdmissible()` does not interpret it and the admitted metadata omits it. The test file has no dedicated supported/disputed/insufficient/unassessed cases. NPC has been asked to preserve the assessment in safe admitted metadata for downstream policy handling, or fail closed where semantics are not approved, with tests for those states. This does not prescribe a universal policy and is a source-review finding, not an executed test failure.

Exact-head workflow query for `382311db34a8e0662cfd47f773756dcad6684b9a` returned zero PR-triggered runs. Current-head test status remains unverified. Keep PR #76 Draft until this contract question and reproducible test validation are resolved.


## NPC cross-review refresh — MEM-039 resolved at pure-oracle layer, exact-head CI still absent — 2026-10-24

Re-fetched PR #76 and its helper/test files after the NPC branch advanced. Current PR head is `c8f41407a064d88d0c6f54f13c9e640b0177ca20` (open Draft, unmerged). The current helper now rejects evidence assessments outside the explicit set and includes `evidence_assessment` in each admitted safe reference projection. The test file contains a focused case that admits each of `unassessed`, `supported`, `disputed`, and `insufficient` without collapsing them, and rejects empty/unknown values. A separate conflicting-evidence fixture verifies that admission preserves distinct claims and epistemic kinds rather than adjudicating them. This closes the prior MEM-039 source-inspection gap at the pure-oracle boundary.

This is not approval of a universal evidence policy: downstream policy still decides what each assessment means for a particular operation. The helper validates supplied metadata; it does not authenticate the source of that metadata or prove an approved Memory API exists.

The exact-head workflow query for `c8f41407a064d88d0c6f54f13c9e640b0177ca20` returned zero PR-triggered workflow runs. Therefore test execution for this exact head remains unverified; this is neither a test failure nor a pass. PR #76 must remain Draft pending reproducible test evidence and contract review. No NPC runtime files were edited by Memory, no tests were claimed as executed, and no PR was merged.


## NPC regression-test assertion review — MEM-036 — 2026-10-24

A focused review of the current NPC test file found that the test named `summary lineage sources must match the requested world, subject, and purpose` creates foreign-world, mismatched-subject, and mismatched-purpose lineage fixtures but asserts only `result.status === "ready"`. Because safe candidate filtering intentionally keeps operation status `ready`, these assertions do not establish that the unsafe summary was excluded. The helper source appears to implement the checks, but the regression assertions are insufficient to prove it.

Memory asked NPC Issue #70 to assert `result.admitted` is empty for each unsafe fixture, optionally alongside a valid same-scope positive control. This is a test-quality finding from source review, not an executed failing test. MEM-036 remains an acceptance requirement until the regression assertions verify exclusion and exact-head test execution is available.


## Exact-head refresh — NPC owner-reported harness result and MEM-036 assertion gap — 2026-10-24

PR #76 advanced to `c3e859473538afe3edba473c86900cd4232109d8` (open Draft, unmerged). The NPC owner reports executing all 26 current test bodies against the current source/test blobs in an isolated in-memory harness with 26 passed and 0 failed. The owner explicitly states this was **not** `npm test`, native `node:test`, or GitHub Actions. Treat this as owner-reported harness evidence, not independently reproduced CI or a verified repository test command. The workflow-run query for exact head `c3e859473538afe3edba473c86900cd4232109d8` returned zero PR-triggered runs.

Re-fetching the live test file shows the source/test blob SHAs remain `c3b540588d64b653d448d4af62c7f255e2d11245` and `85682f4fafbd51522855c696be4584b0e1775555`, respectively. The MEM-036 lineage-scope test still asserts only that the operation status is `ready` for foreign-world and misbound lineage sources; because filtering is designed to keep that status, the test does not prove `admitted` is empty. Memory asked NPC to strengthen those assertions. Thus MEM-039 is resolved at the pure-oracle layer, but MEM-036 regression assertion quality and exact-head reproducible test validation remain open. No merge recommendation yet.


## Exact-head refresh — MEM-036 assertions strengthened; harness rerun reported — 2026-10-24

The NPC owner has addressed the specific MEM-036 regression assertion gap on PR #76. The current test now asserts a valid same-scope summary is admitted and that foreign-world, mismatched-subject, and mismatched-purpose lineage variants produce an empty `admitted` list while preserving operation status `ready`. This makes the test consistent with the no-candidate-exclusion-side-channel requirement.

Current PR #76 head is `dba4bd9c101fdc2c37ce0fd33846ab5f285782f3` (open Draft, unmerged). Current source blob remains `c3b540588d64b653d448d4af62c7f255e2d11245`; test blob is `08fd5785f72e7bca39d62aea6b7b8bcf8480a0fe`. NPC reports rerunning all 26 test bodies against these current blobs in an isolated in-memory harness: 26 passed, 0 failed. This remains owner-reported harness evidence, not native `node:test`, `npm test`, or GitHub Actions. Exact-head workflow query returned zero PR-triggered runs, so standard repository test/CI validation remains outstanding.

MEM-039 and the identified MEM-036 assertion gap are resolved at source/test-review level. Do not claim full integration readiness: producer metadata and authorization inputs are not authenticated by this helper, Memory runtime contracts remain unapproved, and native/CI plus Core/Memory boundary validation remain gates. No PR was merged.


## NPC exact-head CI checkpoint — 2026-10-24

The earlier statement that exact-head workflow evidence was absent is superseded by a direct Actions API lookup. Runtime-tests run **40052652503** (https://github.com/necromorphic/Logic-Engine/actions/runs/40052652503) is a completed `pull_request` run for PR #76 whose `head_sha` is exactly `dba4bd9c101fdc2c37ce0fd33846ab5f285782f3`. Job `test` completed successfully; its `Run npm test` step is `success`. This is repository-native CI evidence for the exact PR head, not merely the NPC owner's isolated harness. The helper `fetch_commit_workflow_runs` returned an empty list for the same SHA, but a direct `/actions/runs?branch=feat/npc-subsystem` query returned this matching run; the empty wrapper result was therefore not sufficient evidence that no run existed.

This closes the NPC exact-head CI gate for the current SHA only. It does **not** approve the proposed Memory API, authenticate producer/access metadata, or close runtime integration and Core/Memory policy decisions. PR #76 remains Draft/open/unmerged. Next required step is cross-owner review of the proposal boundary and a concrete list of integration acceptance tests; do not invent runtime contracts or merge on CI success alone.


## Cross-block vocabulary mismatch found during NPC CI follow-up — 2026-10-24

Exact-head CI for NPC PR #76 is green (run 40052652503; see the checkpoint above), but source review finds that the current pure-oracle vocabulary is **not yet directly interoperable** with the proposed Core Memory record vocabulary. These are both proposals, not approved enums; do not silently rename either side or treat this as a runtime defect.

| Dimension | NPC admission oracle (`docs/52`, current helper) | Core Memory record proposal (`docs/65`) | Required next step |
|---|---|---|---|
| Content disposition | accepts `usable` | proposes `active`, `superseded`, `retracted`, `deleted` | Define an explicit semantic mapping; do not assume `active` and `usable` are identical without transition semantics. |
| Request access outcome | requires `allow` (plus matching subject/purpose) | describes `allowed`, `withheld`, `denied`, `not_found` | Approve a boundary-level mapping and preserve safe non-disclosure semantics for withheld/not-found. |
| Index health/state | accepts `ready` | proposes `current`, `lagging`, `unavailable`, `rebuilding` | Define whether/how `current` maps to NPC's `ready`; never map missing/lagging state to ready. |
| Epistemic kind | accepts `canonical`, `acquired_report`, `rumor`, `inference`, `authored_initial`, `imported` | proposes `canonical_reference`, `observed`, `asserted`, `reported`, `hypothesis`, `derived_summary` | Build a typed crosswalk with no lossy promotion (e.g. `reported` must not become `canonical`). |
| Content kind / record type | oracle uses `claim`, `report`, `summary`, `author_initial`, `imported`, `inference` | Core Memory proposes `record_type` values such as `source_reference`, `evidence`, `episode`, `summary` | Define separate dimensions and a mapping only where semantics actually correspond; do not conflate content kind with record type. |

The existing docs intentionally state that the values are illustrative/owner-defined and the oracle validates supplied metadata rather than authenticating it. Therefore this is an **integration-contract decision gate**, not authorization to implement a schema. The NPC owner should provide a concise crosswalk proposal with: source vocabulary, target vocabulary, semantic rationale, lossy/ambiguous cases that must fail closed, and the owner who must approve each mapping. Memory/Core owners then decide the canonical terms before any adapter/runtime code is written. Related open decisions: MEM-O02 (trusted access policy), MEM-O04 (record versioning), MEM-O05 (trusted source namespaces), MEM-O10 (lifecycle dimensions), MEM-O11 (rollback consistency).

## NPC lifecycle/type crosswalk review — 2026-10-24

Reviewed the NPC-owned proposal `docs/53-npc-memory-lifecycle-vocabulary-crosswalk.md` at the current `feat/npc-subsystem` head `0106f6da30034ce414e1ab2ee377b6707a0ca48a`. The document is a useful semantic crosswalk and explicitly does not claim to be an approved enum registry, adapter, schema, or runtime API. Memory's prior mismatch table above is now a preliminary inventory, not the complete mapping.

### Review disposition

- **Accepted as a review artifact, not as a runtime contract.** It correctly separates record/content type, epistemic kind, content disposition, source reconciliation/freshness, per-request access, index health, and result completeness.
- **No direct `usable` ↔ `active` mapping.** `usable` is an NPC admission conclusion; `active` is only one Memory disposition dimension. Eligibility must be derived from disposition plus trusted access, current source lineage, version/snapshot constraints, and the approved use policy.
- **Access vocabulary remains blocked.** NPC's oracle expects `allow`; Memory's proposal uses `allowed` / `withheld` / `denied` / `not_found`. Even `allowed` → `allow` is conditional on trusted binding to the exact world, subject/recipient, purpose, source versions, and request. A caller-supplied string is not authorization.
- **Readiness and index health remain separate.** NPC result `status=ready` means the helper accepted the envelope and can coexist with zero admitted candidates; it must not be equated with Memory index `current`. Completeness and per-candidate admission are independent checks.
- **Epistemic mappings must not promote authority.** Memory `reported` does not establish actor-relative `acquired_report` without a Core-owned acquisition record; `canonical_reference` is not canonical truth/subject knowledge; import route is provenance, not epistemic kind; summary derivation does not establish truth.
- **Lineage/access propagation is still a production boundary.** The NPC crosswalk correctly requires source identity/version, world, access, freshness, and materially contributing source lineage. Current pure-oracle tests only validate supplied fields; they do not authenticate them or demonstrate race-free revalidation during serialization.
- **No integration test exists yet.** The crosswalk's boundary tests are explicitly future requirements. The current NPC `npm test` CI result on SHA `dba4bd9c101fdc2c37ce0fd33846ab5f285782f3` does not validate this newer head or a Memory-to-NPC runtime path.

### Merge-readiness inventory

| Gate | Current evidence | Status |
|---|---|---|
| NPC pure admission behavior | Source/tests reviewed; exact-head native CI previously passed on `dba4bd9c101fdc2c37ce0fd33846ab5f285782f3` | Partial; revalidate current head `0106f6da30034ce414e1ab2ee377b6707a0ca48a` |
| Memory↔NPC semantic vocabulary | NPC crosswalk exists and documents fail-closed cases/owners | Reviewable proposal; owner approval outstanding |
| Authorized Memory read | No approved general subject/purpose/source-visibility contract established on `main` | Blocked by Core + Memory |
| Trusted provenance and actor-relative acquisition | NPC oracle consumes metadata; no production authentication/acquisition boundary demonstrated | Blocked by Core/host + NPC |
| Source versioning, rollback and reconciliation | Main has rollback/revision behavior; no approved Memory source-change/outbox contract established | Blocked by Core + Memory |
| Real Memory→NPC transfer, final authorization revalidation, partial failure/idempotency | No runtime integration path established in these PRs | Not implemented / not tested |
| Branch synchronization and collision review | PR #68 branch is 2 commits behind current `main`; PR #76 branch is 19 commits behind and contains overlapping numbered documentation paths | Must reconcile before merge; do not blindly rebase or rename |
| Merge approval | Both PRs remain Draft/open/unmerged | Explicit owner approval required |

### Required next actions by owner

1. **NPC:** obtain a fresh native CI run for exact head `0106f6da30034ce414e1ab2ee377b6707a0ca48a`; keep the pure oracle clearly described as candidate filtering, not the Memory adapter or integration path. Add no invented Memory/Core APIs.
2. **Memory + NPC + Core:** approve one canonical semantic contract for access, lifecycle/freshness, completeness, source/version lineage, and safe failure. Keep the proposed crosswalk non-executable until that decision is recorded.
3. **Core:** identify and approve the actual authorized-read/source-validity and rollback-aware reconciliation hooks; actor identity binding alone is insufficient.
4. **Memory:** audit the actual vectorization/host integration before choosing storage or index implementation; no duplicate store/index is justified by current evidence.
5. **All owners:** synchronize each branch with the current `main`, resolve numbered-file and semantic conflicts explicitly, then run the full relevant CI on the resulting exact SHAs.

**Disposition:** not ready to merge. The crosswalk improves documentation alignment, but it does not close the production integration, trusted authorization/provenance, rollback reconciliation, exact-head CI, or branch-synchronization gates. No runtime code or schema is approved by this review. No PR was merged.
## Merge-readiness refresh — exact Core dependency and branch evidence — 2026-10-24

### Current authorized-read and rollback PR status

- Historical checkpoint before PR #65 merged: Core PR #65 (`core/authorized-read-service-prototype`) was then open Draft at head `2bc7b00c55074a14f7b7200ecae85cbae5f19162`. Runtime-tests run [40059975239](https://github.com/necromorphic/Logic-Engine/actions/runs/40059975239) is completed successfully for that SHA. This corrects the older PR body statement that no run had yet been reported. It validates the current PR's test suite only; it does not make the service part of `main` or expand its intentionally self-only HTTP route into general NPC/Memory visibility authorization.
- PR #65's internal service uses a trusted injected field policy and a snapshot marker, but the HTTP route deliberately exposes only the bound actor's own `entity_id`, `entity_type`, and `status`. Arbitrary attributes and multi-entity knowledge reads remain disabled. The direct in-process snapshot APIs remain trusted surfaces requiring host-caller review. Therefore PR #65 is a possible building block, not the complete Memory/NPC authorization dependency.
- Historical checkpoint: Core PR #66 (`fix(core): require admin authority for canonical rollback`) was then open Draft and unmerged; consult current main before relying on that status. Even when its HTTP rollback authorization is correct, it does not by itself provide a durable source-change outbox or an NPC-facing invalidation feed. Memory still needs a Core-approved recovery cursor/reconciliation guarantee that observes rollback/revision/validity changes.

### Current exact-head validation

- Memory PR #68 current head `2857c50780d01bdcbeebf926442d1c5fc3205249`: Runtime-tests run [40061589516](https://github.com/necromorphic/Logic-Engine/actions/runs/40061589516) completed successfully. PR #68 remains documentation-only and Draft; this run does not validate a Memory runtime implementation.
- NPC PR #76 current head `0106f6da30034ce414e1ab2ee377b6707a0ca48a`: the exact-SHA workflow query returned no PR-triggered run. The earlier successful run 40052652503 belongs to `dba4bd9c101fdc2c37ce0fd33846ab5f285782f3`, not the current head. The crosswalk at the current branch is documentation-only; its proposed boundary tests have not been executed as integration tests.

### Branch synchronization and sequence

At the initial comparison for this checkpoint, `main` reported Memory `feat/core-memory-contracts` as 100 commits ahead / 2 behind, and NPC `feat/npc-subsystem` as 251 ahead / 19 behind. Branch counts are time-sensitive; re-run the comparison immediately before synchronization. These branches have diverged histories; do not equate commit counts with the number of feature changes or attempt a blind merge. `main` already contains merged PR #72 (merge commit `506d3a6376a3b0209afb8622db61cbbb4ef98c0a`) and PR #74 (merge commit `683cbc3866468585173da8ad3e717d87be9e570a`); do not port their changes a second time.

Recommended integration order, conditional on explicit review/approval:

1. Core owner resolves and merges (or rejects) the narrow Core PRs #65 and #66 after current-head CI/review. If #65 merges, re-audit its actual merged contract; do not assume it grants general Memory reads. If #66 merges, record exactly what rollback authorization changed and what source-change signaling remains absent.
2. Memory owner reconciles PR #68 against the then-current `main`, preserving docs 64–72 and the already-merged #72/#74 changes. Re-run full repository CI on the resulting exact SHA.
3. NPC owner synchronizes PR #76 with the same current `main`, resolves the duplicate document-number namespace (`docs/52-npc-memory-consumption-contract-and-failure-matrix.md` versus `docs/52-npc-relationship-consumer-compatibility.md`) as a naming/maintainability issue, and runs native `npm test` / CI on the exact resulting SHA.
4. Core + Memory + NPC approve a single boundary contract and implement the real retrieval-to-candidate path plus boundary tests. This step cannot be replaced by merging documentation or by passing the current pure oracle.
5. Only after these gates are independently green should the owner choose a sequential merge order. No PR should be merged merely because another prerequisite PR merged or its CI passed.

### Disposition

Memory docs PR #68 has current-head CI success; Core PR #65 also has current-head CI success. Those are positive test results for their own heads, not integration readiness. NPC PR #76 has no confirmed CI for its current head. The production Memory→NPC path, approved general authorized-read policy, rollback-aware source reconciliation contract, and cross-owner transition/persistence boundary remain unresolved. No merge is recommended at this checkpoint, and no PR was merged by this work.
### Post-update CI and moving-main correction — 2026-10-24

After this audit commit, PR #68 advanced to `fb4c8b5d88981becd99f44cd9c21fc8beac2da45`. Runtime-tests run [40061844383](https://github.com/necromorphic/Logic-Engine/actions/runs/40061844383) was queued at the time of recheck; therefore the new head's CI is **pending**, while the previous head `2857c507...` remains CI-successful. The latest comparison against the moving `main` now reports this Memory branch 101 commits ahead / 5 behind, so the earlier 2-behind figure is historical only. Reconcile against the then-current `main` immediately before any integration. No PR was merged.

## Current-main runtime checkpoint — Issue #129, 2026-10-24

The authoritative post-Core-change audit is [docs/73-memory-current-main-core-boundary-handoff.md](73-memory-current-main-core-boundary-handoff.md), based on `main` SHA `908d9b8a157d374f8a72491d9f57878693f01452`. It supersedes older statements in this document about whether Core PRs #65, #101, #102, #103, #106, or #114 are open, merged, or absent from main.

Current state: PRs #65/#101/#102/#103/#106/#114 are merged runtime changes, but #101's trusted `authorizedReadFieldPolicy` is opt-in and no production Memory policy is configured. The default HTTP read remains self-identity-only. PR #114 makes a trusted operational state snapshot revision-bound and exposes `world_revision` with `commit_sequence`; it does not supply Memory with a durable source-change feed or general authorized retrieval. The Memory record/retrieval/index/summary runtime remains unimplemented. Rollback-aware reconciliation, complete retrieval status, source/version lineage, summary permission propagation, and Memory persistence/transaction ownership remain blocked or proposal-only. See the handoff for exact owners, fail-closed rules, and acceptance tests.

This checkpoint does not approve a new runtime API/schema/store/outbox/cursor/permission enum and does not close NPC Issue #70 or Core Issue #77.