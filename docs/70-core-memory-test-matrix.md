# Core Memory test and threat matrix

Status: acceptance specification; cases are not yet implemented tests. Each test must be attached to a concrete runtime test file when implementation begins.

## Test conventions

Use isolated test worlds and deterministic fixtures. Assert both the returned result and the absence of forbidden side effects. Test the exact head under review; CI from an earlier SHA is not evidence for later changes.

| ID | Setup and action | Expected result / guarantee |
|---|---|---|
| MEM-001 | Create records in worlds A and B; query A using IDs and filters from B | No B record, snippet, count, or existence signal is returned |
| MEM-002 | Request protected record without valid requester/recipient binding | Fail closed; no payload or metadata leak |
| MEM-003 | Submit caller-supplied trusted producer/source label without host binding | Rejected or retained only as explicitly untrusted claim; never trusted provenance |
| MEM-004 | Repeat same write with same idempotency key and normalized payload | Same logical result, no duplicate version/audit side effects beyond declared replay semantics |
| MEM-005 | Reuse idempotency key with changed payload | Stable conflict; no partial mutation |
| MEM-006 | Create summary with known source set | Manifest preserves exact source IDs/versions and world scope |
| MEM-007 | Feed contradictory source claims into summary generation | Conflict remains explicit; no unsupported winner |
| MEM-008 | Search for a nonexistent record | Result means no eligible match; API does not assert that the event did not happen |
| MEM-009 | Retract/rollback a canonical source referenced by memory | Derived records become stale/quarantined or are recomputed under policy; source history/audit remains |
| MEM-010 | Delete search index and rebuild from authoritative store | Same authoritative records/lifecycle/provenance; no Core mutation |
| MEM-011 | Repeat retrieval with same snapshot, policy, and request | Same ordered results under declared deterministic mode |
| MEM-012 | Insert inaccessible high-ranked vector hit | It is not returned, counted, summarized, or exposed through snippets/cursor |
| MEM-013 | Force index outage while authoritative store is healthy | Exact/structured path behaves as specified; semantic search reports unavailable/partial, not empty |
| MEM-014 | Fail after record transaction but before index update | Durable pending work remains recoverable; no false index-current marker |
| MEM-015 | Attempt to mutate Core via read, summary, or reindex path | Canonical revision/state/audit unchanged |
| MEM-016 | Correct or supersede record | Previous version and audit lineage remain reconstructable |
| MEM-017 | Physically erase under explicit retention policy | Required tombstone/audit semantics are met without claiming the source still exists |
| MEM-018 | Feed stale source revision into a new summary | Reject, retry against one snapshot, or mark stale; never silently mix revisions |
| MEM-019 | Cross-world source reference inside a record or summary | Reject before durable write |
| MEM-020 | Inject malformed schema, oversized payload, unsafe nested structures, or excessive result limit | Bounded stable failure; no partial write |
| MEM-021 | Source change notification delivered twice or out of order | Idempotent reconciliation; cursor does not move backwards or skip unresolved work |
| MEM-022 | Revoke source authorization after summary creation | Summary is withheld from the newly unauthorized reader until re-derived from permitted sources or explicitly declassified under an approved policy; no copied source content leaks through summary/snippet/count |
| MEM-023 | Query with same semantic score ties | Stable tie-break or explicitly weaker ranking guarantee |
| MEM-024 | Run current Core test suite after adding optional memory module | Existing Core tests pass; no memory dependency for unrelated operations |
| MEM-025 | Remove/disable memory adapter | Core startup and unrelated canonical operations still work |
| MEM-026 | Model output claims higher confidence than its sources | Epistemic status is not promoted; claim remains attributed as derived/unverified |
| MEM-027 | Retry after partial failure at each persistence boundary | Transaction and recovery invariants hold; no duplicate record or lost pending index task |
| MEM-028 | Revoke one source from a multi-source record | Record remains supported only if the declared typed policy says sufficient valid support remains; otherwise disputed/stale |
| MEM-029 | Reconcile canonical rollback when no new event is appended and max `commit_sequence` is unchanged | Source invalidation is detected through an approved revision/rollback/validity comparison; dependent records and summaries are marked stale or re-evaluated; cursor never falsely claims currentness |
| MEM-030 | Create a summary from a source with distinct record producer and content origin; inspect lineage | Producer identity/method and source attribution remain distinct; the summary producer is not misrepresented as source author or verifier |
| MEM-031 | A derived summary contains content from sources A and B; reader loses permission to A but retains permission to B | Summary is withheld from that reader until a safe re-derivation excluding A or an approved declassification; historical version/audit remains intact |
| MEM-032 | Run the same query under four conditions: no eligible match, access denied/withheld, semantic index unavailable, and partial stale-index results | Outcomes remain distinct and typed; denied/unavailable is never encoded as an ordinary empty result; no protected record existence leaks through metadata |
| MEM-033 | Revoke access after candidate generation but before response serialization | Final authorization revalidation prevents the candidate, snippet, count, or diagnostic from reaching the now-unauthorized reader |

## Threat review checklist

- [ ] authorization before content serialization;
- [ ] world isolation on every query and reference resolution;
- [ ] no caller-controlled authority/provenance;
- [ ] no side effects from retrieval/indexing;
- [ ] deterministic bounds and stable error semantics;
- [ ] record/source lifecycle propagation;
- [ ] auditable correction and deletion;
- [ ] exact-head CI and negative tests;
- [ ] no claims of causal completeness unsupported by Core.
| MEM-034 | Candidate has missing/unknown content kind while carrying otherwise admissible metadata; an unknown kind could conceal a derived summary | Reject as non-ready before prompt serialization; derived-summary lineage/access checks cannot be bypassed by an absent or unrecognized kind; rejection metadata reveals no protected candidate details |
