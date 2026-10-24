# Memory → Core → NPC unified contract (24 October 2026)

**Status: contract proposal; production gate remains CLOSED.** This consolidates Core #140, Memory Provider #181, NPC #149 and evidence in draft PRs #168/#182/#183/#201/#246/#253. It does not authorize a new API, schema, source journal, outbox, cursor, store, production wiring, or merge.

## Authority and state vocabulary

- **Implemented** means present in the cited branch and exercised by a named test. A draft PR is not main.
- **Fixture-only** means a test injects a callback that claims source authority/inventory; it proves fail-closed behavior under that callback, not that a real source can make the claim.
- **Unavailable** means no approved implementation can prove the guarantee. Treat the source/result as unverifiable or non-ready; never convert this to ready-empty.
- **Ready** requires trusted query authorization, per-record authorization, authoritative source-currentness, complete inventory/reconciliation, valid scope/snapshot, and final disclosure checks. Caller labels, context manifests, retrieval hits, and Core's composite snapshot are not source authority.

## 1. Real source and trusted adapter

**Contract.** A candidate is eligible only when a trusted adapter resolves it to an actual world-scoped canonical source and validates source access/currentness through an approved Core boundary. Adapter identity/authority is configured out-of-band, not supplied by the query, candidate, LLM, or manifest. First supported source type is limited to a direct canonical Core entity with single-source lineage; summaries are ineligible until every contributing source can be validated.

**Current implementation.** Core SQLite canonical records, ActorBindingService, AuthorizedReadService and NPC admission oracle exist. PR #168 proposes an injected Core consumer seam; PR #182 persists provider records/index in a separate SQLite database; PR #183 exercises that provider through Core/NPC. The positive source-validator callback in #183 is fixture-only.

**Exact tests.**
- PR #183, tests/memory-provider-core-integration.test.js: positive provider→Core→NPC path, but authority callback is fixture-only.
- Same file: Core entity exists but authoritative per-entity version proof is unavailable → reconciliation stale and retrieval non-ready.
- Same file: source adapter cannot attest complete inventory → reconciliation stale and retrieval non-ready.
- Main authorized-read/API tests exercise the existing field-policy boundary, not Memory source authority.

**Missing guarantee / owner.** No approved production adapter proves source identity, version, access and lineage together. **Core** owns canonical source authority/field policy; **Memory Provider** owns record identity and Memory-side grants; **host/integration owner** configures the real adapter. Until then positive authority proof is unavailable and the consumer must fail closed.

## 2. Authoritative per-record version and lineage

**Contract.** Every record version binds immutably to stable identity, world/scope, exact canonical source identity and authoritative source version, and complete lineage. Source version must come from a trusted adapter at use time or an approved immutable source journal, not provider metadata or caller input. Summaries require validation of every lineage source; any missing, stale, revoked, cross-world or unverifiable source rejects the summary.

**Current implementation.** PR #182 stores record/version identity, direct entity reference/version and single-source lineage; conflicting duplicate identity/version payloads are rejected. PR #183 tests stale/unverifiable source handling. Core world_revision + commit_sequence is only a composite snapshot freshness marker, not a per-record version or lineage journal. PR #201/#183 distinguish source-validator outage/unverifiable version from explicit record-grant denial.

**Exact tests.**
- PR #182, tests/sqlite-memory-provider.test.js: source-version staleness, duplicate identity conflict, persistence/restart (provider branch).
- PR #183, tests/memory-provider-core-integration.test.js: source becoming unverifiable after reconciliation returns non-ready; validator outage returns generic non-ready.
- PR #201, tests/sqlite-memory-provider.test.js: validator outage does not collapse to ordinary denial; direct-source summary ingestion rejected pending lineage-wide authorization.

**Missing guarantee / owner.** Current main has no production-authoritative per-record source-version/lineage proof; positive PR callbacks are fixtures. **Core** must define/provide canonical source authority; **Memory Provider** binds persisted versions/lineage to it; **NPC** rejects unsupported summary lineage. Do not infer authority from updated_revision, created_by_event_id or commit_sequence, and do not create a universal version field by assumption.

## 3. Boundary of a complete, consistent inventory

**Contract.** Complete means a trusted adapter enumerated the entire relevant source domain for a named world/scope at one consistent source snapshot, including deletions/retractions and all records relevant to the query/index. A boolean callback without an independently grounded inventory boundary is not proof. If completeness cannot be established, return non-ready—not ready-empty, partial success or authorization-filtered empty.

**Current implementation.** PR #182 persists a provider reconciliation marker and requires trusted validateInventory. PR #183 tests that incomplete inventory and loss of previously successful proof invalidate readiness. Positive inventory callbacks in #183 are fixtures; Core has no approved complete, consistent inventory boundary.

**Exact tests.**
- PR #183, tests/memory-provider-core-integration.test.js: incomplete inventory leaves reconciliation stale; loss of proof after previous readiness yields non-ready/no candidates.
- PR #182, tests/sqlite-memory-provider.test.js: inventory incompleteness rejected (provider-local).
These negative tests establish fail-closed behavior only, not positive inventory proof.

**Missing guarantee / owner.** No approved inventory scope/snapshot/enumeration contract. **Core** owns canonical inventory consistency; **Memory Provider** owns reconciliation against it; **host adapter owner** must exercise real enumeration. Positive complete-inventory proof is currently impossible to certify.

## 4. Reconciliation after rollback, deletion, revocation and restart

**Contract.** Rollback, deletion, active-version change, grant revocation, inventory loss, provider restart or interrupted rebuild invalidates readiness until reconciliation against a newly proven source snapshot and complete inventory succeeds. Stale index/archive entries must never be resurrected. world_revision + commit_sequence can detect some snapshot mismatch but is not a durable change feed. Cross-store atomicity is not implied.

**Current implementation.** Core rollback can change world_revision without increasing commit_sequence. PR #182/#201 implement provider-local SQLite raw records, rebuildable index, persisted readiness marker, idempotent identical ingest and fail-closed stale/rebuilding/unavailable states. PR #183 exercises rollback through the real provider adapter and tests loss of source/inventory proof. PR #201 tests raw capture surviving derived-index rebuild failure and provider restart; PR #254 tests provider-local raw-read reauthorization after load. These are draft-branch results, not main guarantees.

**Exact tests.**
- PR #183, tests/memory-provider-core-integration.test.js: rollback where revision advances but sequence does not leaves old reconciliation non-ready; missing source-version/inventory proof invalidates prior readiness.
- PR #201, tests/sqlite-memory-provider.test.js: raw capture survives index rebuild failure and restart while retrieval remains MEMORY_INDEX_NOT_READY; interrupted rebuild/reconciliation and corrupt lineage fail closed.
- PR #254, tests/sqlite-memory-provider.test.js: initial raw-read allow followed by post-load deny returns generic MEMORY_RAW_READ_DENIED without content.

**Missing guarantee / owner.** Provider-local recovery exists on draft branches; durable source-to-provider retraction/revocation signal and cross-store atomicity do not. **Core** owns canonical rollback/deletion and any authoritative change signal; **Memory Provider** owns durable invalidation/rebuild/restart; **NPC** rejects stale/non-ready output. Do not invent an outbox, cursor or journal before Core approves a concrete source domain and contract.

## 5. Disclosure-time revocation

**Contract.** Query authorization, per-record authorization and final disclosure revalidation are separate gates. Denial, source-currentness failure, inventory uncertainty or validation outage at the final boundary excludes the candidate and returns generic non-ready/withheld without content, snippets, candidate identity, counts or host diagnostics. Recheck after awaited operations that can race with revocation. This narrows TOCTOU but does not promise atomicity after the final check or across Core and Provider stores.

**Current implementation.** PR #168 revalidates initially admitted candidates after the first authorization sweep. PR #182 checks provider grants and source-version callback. PR #183 covers candidate A revoked while candidate B validation is awaited; Core's final sweep excludes A. PR #201/#254 reauthorize raw archive reads after load. The positive source-authority callback in #183 is fixture-only.

**Exact tests.**
- PR #183, tests/memory-provider-core-integration.test.js: multi-candidate revocation race excludes A; query denial/outage and record denial do not leak candidate identity/content; validator outage returns generic non-ready.
- PR #201, tests/sqlite-memory-provider.test.js: validator exception becomes generic MEMORY_SOURCE_VALIDATION_UNAVAILABLE; explicit false is not treated as outage.
- PR #254 raw-read race: initial allow then post-load deny returns generic MEMORY_RAW_READ_DENIED without content.

**Missing guarantee / owner.** No cross-store transaction/shared revocation linearization point exists, so “revocation always wins at the exact instant of disclosure” is impossible to guarantee today. **Core + Memory Provider** own a future approved boundary; **NPC** must not treat final recheck as durable permission or receipt. Best-effort repeated revalidation is not strict atomic revocation.

## 6. Retrieval/context inclusion ≠ delivery ≠ receipt ≠ acquisition ≠ belief

**Contract.**
1. **Retrieval:** provider returned a candidate.
2. **Context inclusion:** candidate was inserted into a model request.
3. **Delivery:** a payload was handed to a recipient/channel with an identifier and outcome.
4. **Receipt:** recipient/channel acknowledged payload receipt; this is transport evidence, not comprehension.
5. **Acquisition:** NPC knowledge state records a source-backed update under an approved policy.
6. **Belief:** NPC-owned, subject-relative state records acceptance/confidence and may differ from receipt/acquisition.

Retrieval/context inclusion are read-only and must not persist delivery, receipt, acquisition or belief. No state advances merely because an LLM saw a prompt, generated a statement or retrieved the same record again.

**Current implementation.** PR #183 integration asserts repeated retrieval/context inclusion does not mutate provider rows or create delivery/receipt/acquisition/belief state. Repository README/NPC handoff state that full NPC knowledge/acquisition/belief and delivery lifecycle are not implemented. PR #246 tightens the pure admission oracle to require a trusted request snapshot; it is draft/unmerged, not end-to-end source authority. PR #253 is NPC documentation/traceability only, draft/unmerged.

**Exact tests.**
- PR #183, tests/memory-provider-core-integration.test.js: repeated retrieval/context inclusion does not mutate provider rows or create downstream lifecycle state (PR-head only).
- PR #246, tests/npc-memory-candidate-eligibility.test.js: missing/null request snapshot rejected (PR-head only).
- No current-main production consumer test can prove delivery, receipt, acquisition or belief because these runtime states are not implemented.

**Missing guarantee / owner.** Delivery/receipt is **Core/host integration**; source-backed acquisition and subject-relative belief are **NPC-owned**, with Core supplying authorized source evidence and Memory supplying provenance. These state machines are not implemented; this document does not invent them.

## Minimum acceptance suite before production enablement

All positive authority/inventory cases must run through the actual trusted source adapter, real Core SQLite/LogicEngine/AuthorizedReadService, actual Memory Provider SQLite adapter and NPC consumer. Fixture callbacks may be used for negative fault injection, but cannot satisfy positive authority/inventory acceptance.

1. **Real source identity/version/lineage:** ingest an actual canonical source; retrieve; assert adapter-derived identity/version/lineage match the persisted record; mutate, roll back and remove source; reject old version.
2. **Real complete inventory:** enumerate a bounded world/scope at a consistent source snapshot; prove all source records and deletions are included; concurrent mutation must retry or become non-ready, never false-complete.
3. **Rollback/retraction/restart:** reconcile, rollback/delete without assuming sequence increases, restart during reconciliation; stale index/archive must never become ready or be returned.
4. **Revocation race:** authorize A, block B validation, revoke A through the real grant/source path, release B; A is not disclosed. Revoke after provider load but before final disclosure; fail closed. Document post-final-check race unless a shared atomic boundary is implemented.
5. **Authority/inventory loss after ready:** establish readiness with real authority, make source version/inventory unverifiable, restart and query; non-ready, no candidate/content/counts/snippets/host diagnostics.
6. **Summary lineage:** reject if any contributing source is missing, stale, revoked, cross-world or unverifiable; producer metadata cannot authorize source claims.
7. **State non-implication:** repeated retrieval/context inclusion changes no delivery/receipt/acquisition/belief; separately test those transitions once operations exist.
8. **Failure distinction:** complete-empty differs from denied, withheld, partial, stale, unavailable, rebuilding, source-unverifiable and inventory-incomplete; none becomes ready-empty.
9. **Non-disclosure:** every negative path excludes candidate identity/content/snippet/count/lineage and host exception details.
10. **No canonical side effects:** retrieval/reconciliation append no canonical events/audit unless an explicitly approved canonical operation requires it.

## Owners and release gate

| Clause | Accountable owner | Supporting owner(s) | Current status |
|---|---|---|---|
| Real source + trusted adapter | Core | Memory Provider, host/integration | Blocked: no approved real source-authority adapter |
| Per-record version + lineage | Core | Memory Provider; NPC for summaries | Blocked: authoritative proof absent |
| Complete consistent inventory | Core | Memory Provider, host adapter | Blocked: positive proof fixture-only |
| Rollback/delete/revoke/restart | Core for source changes; Memory Provider for provider recovery | NPC consumer | Partial draft implementation; no durable source-change contract |
| Disclosure-time revocation | Core + Memory Provider | NPC consumer | Best-effort rechecks only; cross-store atomicity unavailable |
| Retrieval/delivery/receipt/acquisition/belief | Core/host for transport; NPC for acquisition/belief | Memory Provider provenance | Retrieval/context tests only; downstream state machines absent |

**Release rule:** production Memory→NPC remains disabled. Unavailable/unverifiable, incomplete, stale, revoked or uncertain source states fail closed. Passing draft CI verifies only the tested branch and its fixtures; it does not turn fixture-provided authority into production proof.
