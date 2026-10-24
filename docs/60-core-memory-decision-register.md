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

## Risks

1. Open PRs may add services/contracts that are not in `main`; this document intentionally treats them as candidates until merged or explicitly rebased for review.
2. The current Core causal contract does not prove complete causal provenance. Memory cannot compensate by inventing missing edges.
3. A summary may be syntactically linked to sources yet semantically omit important contradictions; source lineage is necessary but not sufficient.
4. Search authorization can leak through snippets, counts, ranking, pagination, and derived summaries unless these are included in policy.
5. Concurrent sibling changes can invalidate filenames or assumptions; reconcile before opening or updating a PR.
6. Existing vectorization work must be inspected before proposing replacement or duplicate indexing.

## Change policy

Every resolved open question must record the evidence, selected option, alternatives rejected, compatibility impact, and required tests. Do not mark a decision accepted merely because a draft PR exists.