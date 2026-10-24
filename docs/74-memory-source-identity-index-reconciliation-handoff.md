# Memory source identity, index lifecycle, and reconciliation handoff

**Issue:** [#142](https://github.com/necromorphic/Logic-Engine/issues/142)  
**Related:** completed [#129](https://github.com/necromorphic/Logic-Engine/issues/129), open Core gate [#140](https://github.com/necromorphic/Logic-Engine/issues/140)  
**Audit base:** `main` at `1de33fa8da45783cddde74f209b0141658a33648` (2026-10-24)  
**Status:** Memory-owned contract proposal and evidence map. This is not a runtime implementation, Core decision, API/schema approval, or approval for production Memory→NPC wiring.

## 1. Reading rule

This document distinguishes facts observable in current Core code from proposed Memory behavior and missing cross-block contracts. “Source identity exists” does not mean a stable source-version contract, complete lineage, authorization, or a durable change feed exists. A source's Core identifier and the composite snapshot cursor must not be relabelled as a Memory version.

No new API, schema, store/table, outbox, cursor, permission policy, callback, or cross-store atomicity guarantee is proposed for implementation by this handoff. No Core or NPC runtime files are changed by this work.

## 2. Source identity, version, and lineage inventory

| Source/input class | Current-main evidence | Identity / version / lineage assessment | Owner and closure condition |
|---|---|---|---|
| Canonical events | `src/storage/sqlite-store.js`: `world_events` rows include `world_id`, `event_id`, `commit_sequence`, `committed_revision`, `validity`, `rollback_id`, causal references and effects. `tests/snapshot-read.test.js` covers snapshot and rollback behavior. | **Identity: authoritative within Core** as world-scoped `(world_id, event_id)`. **Version: partial**: sequence/revision locate a snapshot; validity can change during rollback, so `event_id` and `commit_sequence` alone do not identify current validity. **Lineage: partial**: event causal/read/dependency fields are present but the repository's causal contract does not promise complete causal provenance. | Core owns event identity, validity, rollback semantics and any source-version contract. Before Memory uses an event as current support, Core must define the authoritative source-state read/validation boundary and test validity changes. |
| Canonical entities | `src/storage/sqlite-store.js`: world-scoped `entities` projection has `entity_id`, `created_by_event_id`, `updated_revision`; projection is rebuilt from valid events. | **Identity: authoritative within Core** as `(world_id, entity_id)`. **Version: not a durable per-entity version history**: `updated_revision` is a projection marker, while source event validity can change. **Lineage: partial**: `created_by_event_id` does not enumerate all events that contributed to the current attributes. | Core owns canonical entity version/lineage semantics. Memory must treat the entity as unverifiable for source-dependent currentness if the required version or contributing lineage cannot be established. |
| Canonical facts and claims | `src/storage/sqlite-store.js`: `fact_claims` rows link claims to `event_id`; `facts` is a rebuilt world-scoped projection with `fact_id`, status/value/candidates, source event IDs and `updated_revision`. | **Identity: authoritative within Core** for world-scoped fact IDs and individual claim event IDs. **Version: partial**: `updated_revision` marks projection rebuild state, not a Memory source-version contract. **Lineage: partial but explicit for facts** through source event IDs; completeness still depends on canonical source validity and the causal contract. | Core owns claim/fact semantics and source validity. Memory must revalidate all materially supporting claim/event IDs and cannot treat a fact ID alone as proof that its prior value remains current. |
| Relationships | `src/storage/sqlite-store.js`: relationship projections are rebuilt from valid events and expose subject/target/dimension, `last_event_id`, `updated_revision`. | **Identity: composite projection key is observable**, but this is not a separate Memory record identity. **Version: partial**; the projection's last event/revision is not a durable immutable history contract. **Lineage: partial** through event-derived projection; `last_event_id` is not necessarily the complete set of contributors. | Core owns relationship source semantics; Relations owns relationship interpretation. Memory must not infer complete lineage from `last_event_id` alone. |
| Context manifests | `src/api/server.js`, `src/storage/sqlite-store.js`, `tests/snapshot-read.test.js`; snapshot reads expand manifests only against the exact composite `world_revision + commit_sequence` cursor. | **Identity: authoritative for a registered manifest within its world**; manifest membership is not source identity or authorization. **Version: anchored cursor, not source version**. **Lineage: a list of target references, not proof that content was assembled, disclosed, or attended to.** | Core owns manifest semantics. Memory must never treat manifest membership as authorization, a source-change signal, proof of context inclusion, delivery, receipt, acquisition, or belief. |
| External messages, generations, artifacts, and host/vector index | No general Memory source adapter, record/retrieval service, or Memory index runtime was identified on audited `main`. The actual SillyTavern/extension vectorization boundary is not established by this repository audit. | **Identity/version/lineage: absent or unverified here**. Do not invent stable IDs or claim a complete vector/archive inventory. A digest proves byte equality only against a trusted known digest; it does not prove origin or truth. | Memory + adapter/project owner must inspect the actual installed host integration and approve a binding contract. Until then, classify source-dependent records as provenance-incomplete and fail closed for current/protected use. |

### Composite cursor limitation

The trusted operational snapshot exposes `world_revision` and `commit_sequence` together. These values describe the snapshot boundary, not an individual source version or durable source-change journal. In particular, `tests/snapshot-read.test.js` test **“internal snapshot preserves the composite marker across rollback-only revision changes”** verifies that rollback can advance `world_revision` while `commit_sequence` remains unchanged. Any reconciliation logic that only notices a higher `commit_sequence` can miss invalidation.

## 3. Index state and retrieval outcomes

Index health is not authorization, and index health is not source freshness. Treat these as separate dimensions.

| Observed condition | Required Memory contract behavior (proposal; no runtime service currently implements it) | Owner / testable closure |
|---|---|---|
| Index current and source reconciliation complete | A result may be labelled current only if the authoritative source snapshot, all required source versions/validity, lineage, and access decision were successfully revalidated. | Memory defines evidence needed for currentness; Core supplies authoritative source facts. Positive test must prove exact source/version and complete reconciliation, not just a successful query. |
| Index stale/lagging | Never report results as current. Strict-current retrieval withholds or returns explicit stale/partial/unavailable status; an explicitly eventual mode would require an owner-approved contract and visible staleness. | Memory. Test a changed source version and rollback-only revision movement; old hit/snippet/summary must not pass as current. |
| Index missing/unavailable | Do not convert backend failure into a complete-empty result. Use an approved authoritative fallback only if it has the same access and lineage checks; otherwise return explicit unavailable/partial status without protected metadata. | Memory + host/index owner. Force index outage and assert status differs from complete-empty, with no candidate/count/snippet leakage. |
| Index rebuilding | Rebuild from authoritative, access-safe records. Until the rebuild and reconciliation checkpoint are complete, status remains rebuilding/non-current. A partially rebuilt index must not claim completeness. | Memory. Stop during rebuild; restart; verify it resumes/restarts safely and does not advance the completed marker early. |
| Index failure or corrupt/unknown marker | Do not infer currentness from `ready`, a successful query, or a caller-supplied state flag. Do not advance a reconciliation checkpoint after a failed/incomplete scan. | Memory. Inject failure and malformed/unknown checkpoint; assert fail-closed status and repeatable recovery. |
| Search is complete but every candidate is filtered/withheld | Do not reveal protected candidate existence/count or confuse filtering with backend-empty. Return only the owner-approved safe result shape. | Core owns access enforcement; Memory owns result semantics. Test hidden candidates do not leak via count, snippet, ranking, cursor, timing-oriented diagnostics, or error detail. |

**Result-completeness rule:** distinguish at least complete-empty, complete-nonempty, partial/truncated, stale, denied/withheld, timeout, index-unavailable/rebuilding, and generic unavailable outcomes in the future contract. These are proposed semantic outcomes, not an approved wire enum. Do not freeze names or add an API/schema without Core review.

## 4. Source changes, retraction, revocation, and derived summaries

- **Canonical correction/rollback:** Core owns canonical validity and rollback. Memory can only react to a change it can reliably observe or discover during a complete authoritative reconciliation. A larger `commit_sequence` is not sufficient.
- **Source retraction/invalidation:** preserve permitted audit/history, but mark dependent records non-current. A retracted or invalidated source must not continue to support a current record merely because its vector remains searchable.
- **Access revocation:** authorization must be checked at retrieval/serialization time under the approved Core/host policy. Filtered search results are not enough: summaries, copied snippets, exact-ID lookup, counts and pagination can retain the revoked information. Derived content inherits applicable source restrictions; do not assume a summary is safe because its raw source was omitted from the result list.
- **Lineage incomplete or cross-world:** reject the reference or withhold source-dependent derived content. A source reference must resolve in the expected world; no cross-world source may be accepted by accidental ID collision.
- **Summary support changes:** if a material source changes, becomes unavailable, is retracted, or loses reader authorization, the summary is stale/withheld until all required support is revalidated or it is safely recomputed under an approved derivation policy. If independent valid support remains, preserve only the support that can be demonstrated; do not invent a rewritten summary.
- **No silent source deletion:** Memory lifecycle changes do not roll back Core or erase historical audit by assumption. Physical erasure and retention rules remain a separate owner decision.

### Required negative acceptance cases before a production consumer

1. **Cross-world lineage:** source ID exists only in world B but a record/summary in world A references it; reject/withhold and reveal no protected details.
2. **Stale version:** source S/v1 is indexed; authoritative source becomes v2; exact-ID lookup, semantic hit, snippet and dependent summary cannot be represented as current from v1.
3. **Revoked source in derived summary:** source was authorized when summarized but access is revoked later; the summary and all search-derived disclosures are withheld for that reader until approved re-derivation/declassification.
4. **Unavailable/retracted source:** source cannot be revalidated or is retracted; do not treat an old vector hit as current evidence or complete-empty.
5. **Index unavailable/rebuilding/failure:** force each state and ensure retrieval reports a distinct non-current/unavailable state; no false complete-empty or current marker.
6. **Rollback with unchanged `commit_sequence`:** rollback changes validity and `world_revision`; reconciliation discovers affected records without requiring sequence growth.
7. **Restart during reconciliation/rebuild:** terminate after partial work; restart; replay idempotently, revalidate dependent records, and do not mark current until a complete pass succeeds.
8. **Partial inventory / failed scan:** source inventory errors or truncation prevent completion marker advancement.
9. **Revocation after indexing:** test exact-ID, semantic search, snippets, summaries, counts and pagination; no protected payload or existence leak.
10. **Persistence boundary failure:** fail between Memory authoritative write, Memory audit, and index update; do not claim durable success or a current projection when commit outcome is unknown.

These are **future Memory integration acceptance tests**, not claims that a Memory runtime currently exists or that these tests already pass.

## 5. Reconciliation and restart recovery

No Memory-specific durable source-change feed, outbox, cursor, invalidation worker, archive, or index table was identified on the audited Core `main`. The existing Core event/rollback records and consistent snapshot are evidence sources, not an already-approved Memory feed.

| Candidate approach (not selected) | Required proof before adoption | Owner |
|---|---|---|
| Consume canonical event + rollback/validity records | Core confirms a complete query/snapshot boundary and a stable scan strategy covering additions **and** validity/retraction changes; tests cover duplicates, ordering, rollback, and restart. Event sequence alone is insufficient. | Core + Memory |
| Revision-triggered full authoritative reconciliation | Core proves Memory can enumerate the complete relevant source inventory consistently and that revision changes cover all relevant source validity changes; Memory proves idempotent scan and safe marker advancement. | Core + Memory |
| Hybrid incremental signal plus periodic full comparison | The incremental signal's limits and maximum stale window are explicit; a missed signal is repaired by full comparison. Strict-current reads cannot rely on the interval as immediate proof. | Core + Memory |

Do not choose or implement an option in this docs/tests PR. Do not create an outbox, cursor, schema, store, API, or callback. Until an owner-approved recoverable mechanism exists, restart or unknown reconciliation state means **currentness unproven**; protected/source-dependent retrieval must fail closed or return a safe explicit unavailable/stale outcome.

## 6. Persistence, audit, and transaction boundary

- `src/storage/sqlite-store.js` supplies a Core-local SQLite transaction helper and persists canonical events, rollback records, canonical audit, idempotency/replay data, and projections within Core's existing ownership.
- The presence of that helper does **not** mean Memory records exist, that Memory writes are included in the transaction, or that Memory audit/index changes are atomic with canonical Core writes.
- A separately owned archive/vector index cannot be assumed atomic with SQLite. Memory must not report durable success if its own authoritative write/audit outcome is unknown, and must not label a projection current after failed indexing.
- Core owns canonical source truth, canonical audit, and rollback. Memory would own its record mutations, derived record lifecycle, index lifecycle, reconciliation state, and Memory-operation audit only after those storage boundaries are approved.
- If Memory-owned records and a derived index use different persistence systems, recovery must be idempotent and rebuildable. The authoritative-record commit point, audit requirements, and recovery marker must be decided before implementation. This document does not prescribe a table or transaction design.

## 7. Evidence map and exact current tests

| Contract claim | Source or test evidence | What the evidence proves—and does not prove |
|---|---|---|
| Canonical event identity, validity and rollback persistence | `src/storage/sqlite-store.js`, `rollback(...)`, `rebuild(...)` | Core stores world-scoped events, validity, rollback rows and rebuilds projections. It does not provide a Memory source feed or per-source Memory version. |
| Snapshot cursor is composite | `src/storage/sqlite-store.js`; `tests/snapshot-read.test.js` test **“internal snapshot preserves the composite marker across rollback-only revision changes”** | Snapshot exposes revision and sequence and proves rollback can change revision without sequence growth. It does not give Memory a durable cursor or notification mechanism. |
| Manifest scope is world-bound | `tests/snapshot-read.test.js` test **“snapshot reports requested context manifests that do not exist in the requested world”** | Missing/foreign manifest IDs are not expanded in the requested world. It does not establish source lineage or access permission. |
| Manifest cannot expand stale references after rollback | `tests/snapshot-read.test.js` test **“snapshot does not expand a manifest after rollback changes revision without advancing the event cursor”** | The snapshot path avoids expansion at an old cursor after rollback. It does not reconcile Memory records or index entries. |
| Memory record/retrieval/index implementation | No corresponding Memory service/schema/index implementation identified in audited `main`; proposed contracts are in `docs/64-core-memory-architecture.md` through `docs/72-core-memory-implementation-plan.md`. | **Blocked/absent**. This is a repository inspection finding, not proof that a host-side vectorization extension is absent. |
| Authorization | `src/application/authorized-read-service.js`, `src/api/server.js`, `tests/authorized-read-service.test.js`, `tests/authorized-read-api.test.js` | Existing narrow authorized-read path and opt-in host field-policy seam; no configured production Memory visibility policy. |
| Transaction boundary | `src/storage/sqlite-store.js` transaction helper and canonical mutation/rollback paths | Core-local transaction behavior only; no cross-store Memory/Core atomicity. |

## 8. Owner decisions and closure conditions

| Decision | Owner | Minimum decision / closure condition |
|---|---|---|
| Which source types/fields may be read by Memory for a declared requester, recipient and purpose? | Core + host; Memory specifies record semantics | Approve a narrow trusted policy/snapshot boundary and real-path non-disclosure tests. Until then, default-deny protected reads. Related: [#140](https://github.com/necromorphic/Logic-Engine/issues/140). |
| What stable source-version and complete-lineage guarantees exist for each canonical source type? | Core | Per-type contract identifies authoritative ID, version/validity read, contributing-source lineage, and rollback behavior; tests prove stale/retracted rejection. Unknown dimensions remain blocked. |
| What signal/reconciliation strategy survives rollback and restart? | Core + Memory | Select one approach only after Core proves source inventory/signal completeness; add failure/restart/idempotency tests with marker advancement after complete reconciliation only. |
| What is the actual external-message/vectorization adapter and its trusted identity binding? | Memory + host/project owner | Inspect the installed extension/API and document exact source ID/version/lineage and invalidation behavior; no duplicate index/store by assumption. |
| Which Memory writes/audit must be atomic, and where is the authoritative record commit point? | Memory + Core | Approve storage placement and failure/recovery semantics; test crashes between record, audit, and index steps. |
| How do summaries inherit source permissions and handle explicit declassification? | Core + Memory; NPC validates consumer admission | Approve source permission propagation and any declassification authority; test revocation after summarization. Do not let a summary widen source access. |

## 9. Scope and non-claims

This handoff does not:
- implement Memory record, retrieval, summary, archive, index, invalidation or reconciliation runtime;
- authorize broad production reads or production Memory→NPC wiring;
- define an approved API/wire schema, source version enum, durable feed/cursor, outbox, or new store;
- equate retrieval with context inclusion, delivery, receipt, acquisition, comprehension, belief, or canonical truth;
- close Issue #70 or #77, or reopen completed Issue #129.

The tests added with this handoff guard the completeness of this evidence/decision document only. They do not substitute for the runtime integration tests listed above.


## 10. Cross-review against the NPC admission contract

**Evidence reviewed:** `src/npc/memory-candidate-eligibility.js` and `tests/npc-memory-candidate-eligibility.test.js` on `main`; NPC handoff proposed in PR #139 (still a separate, unmerged design/test-traceability change at review time). This section describes compatibility requirements, not a shared runtime contract.

### Compatibility matrix

| Boundary | What the NPC oracle actually checks | Required Memory/Core behavior and closure evidence |
|---|---|---|
| Record identity/version | Caller-supplied non-empty `record.ref` and `record.version`; no authentication of either. | Memory/adapter must resolve the reference in the requested world and verify its version against an authoritative source boundary. Test forged/stale references on the real adapter path; oracle-only fixtures do not satisfy this gate. |
| Freshness vs index health | Candidate freshness must say `current`; lifecycle must say `source_reconciliation: current` and `index_health: ready`. These are supplied labels, not observations. | Keep the three dimensions separate: `ready` means index service health only; it must not imply source freshness, authorization, or completed reconciliation. Test a healthy-but-stale index, an unavailable index, and a rollback-only revision change. No stale candidate may be admitted as current. |
| Access and revocation | Request and candidate allow metadata must bind to the requested subject and purpose. Summary lineage sources must each carry matching world, subject-/purpose-bound allow and `freshness.status: current`. The oracle cannot establish that an allow is genuine or re-check revocation. | Core owns authoritative access decisions; Memory/adapter must revalidate access at the approved read/serialization boundary. Test revocation after indexing for direct record, exact-ID lookup, snippets, counts, pagination and summaries, with no protected detail leakage. |
| Summary lineage | Summary must have non-empty `lineage.sources`, each with ref/version, same world, bound allow and current freshness. Non-summary candidates do not receive this summary-specific lineage check. | Memory must emit complete, versioned lineage only when it can prove it; missing, partial, cross-world, stale, retracted or revoked support makes dependent content non-current/withheld unless an approved derivation policy proves remaining support. Test each negative case through the actual consumer path. |
| Snapshot and rollback | If the request supplies a snapshot, candidate snapshot must match both `world_revision` and `commit_sequence`. The oracle cannot discover a source change and does not validate a lineage source's version against an authoritative snapshot. | Core must define how the consumer obtains authoritative current source state. Reconciliation must detect rollback when revision changes but sequence does not. Test candidate and each lineage source across that transition; equality of caller-supplied markers alone is insufficient proof. |
| Result completeness | The helper accepts only a request-level result marked `completeness: complete` with bound allow/scope. It returns only `ready`/`non_ready` and safe references; it does not define the full retrieval result-status vocabulary. | Memory/Core must decide how complete-empty, partial/truncated, stale, denied/withheld, timeout, rebuilding and unavailable map to the future consumer contract. Do not translate backend failure into complete-empty or treat helper `ready` as proof that content was delivered or acquired. |
| Rebuild, restart and persistence | The pure oracle has no index, checkpoint, reconciliation loop, persistence or restart behavior. | Memory + host/index owner must define a durable completion/checkpoint rule without assuming Core/Memory atomicity. Test interruption after partial reconciliation, restart/replay, failed/truncated scans, idempotence, and that no current/completed marker advances before a full successful pass. Core separately decides any canonical event/audit atomicity requirement. |

### Minimum decisions still required

1. **Core (#140):** authoritative source-currentness/version-validation boundary; authorized-read semantics for recipient/subject, purpose, field visibility and non-disclosure; rollback/reconciliation signal choice; and which records, if any, must share Core's canonical event/audit transaction.
2. **Memory + host/index owner:** actual source adapter and index identity/version/lineage evidence; lifecycle/result-completeness semantics; revocation/retraction propagation; checkpoint ownership and crash/restart recovery; retention/erasure behavior.
3. **NPC (#70 / PR #139):** confirm the consumer's accepted metadata semantics and real-path contract tests. The oracle's supplied `current`, `ready`, `allow`, and version values remain assertions from its caller until a trusted adapter is approved.

### Verifiable closure checklist

- [ ] A real-path positive test proves source reference, version, world, lineage and access against authoritative owner boundaries—not only fixture labels.
- [ ] Negative tests cover cross-world/incomplete lineage; stale v1 after source advances to v2; retracted/unavailable support; revocation after indexing including derived summaries; and index health states distinct from freshness and access.
- [ ] Rollback test changes `world_revision` without increasing `commit_sequence` and proves affected candidates/summaries are invalidated or reconciled.
- [ ] Restart test interrupts rebuild/reconciliation after partial work, restarts, and proves idempotent recovery with no premature completed/current marker.
- [ ] Complete-empty, partial, stale, denied/withheld, timeout, rebuilding and unavailable are distinguishable without disclosing protected candidate existence or details.
- [ ] Core/Memory transaction and audit ownership is explicitly decided; no cross-store atomicity is inferred.
- [ ] NPC confirms the consumer contract and its real-path acceptance suite; production Memory→NPC remains disabled until all required owner gates pass.

Until these conditions are met, PR #144 is a documentation/test-traceability handoff only. The Memory document-contract test does not prove runtime lifecycle enforcement, and NPC oracle tests do not prove authentic authorization, retrieval, delivery, acquisition, or belief.
