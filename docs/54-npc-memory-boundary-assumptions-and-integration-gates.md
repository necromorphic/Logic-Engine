# NPC Memory Boundary Assumptions and Integration Gates

Status: NPC-owned review package / acceptance plan; documentation only, on `feat/npc-subsystem`.
Date: 2026-10-24.
Related: #70, PR #76, `docs/52-npc-memory-consumption-contract-and-failure-matrix.md`, `docs/53-npc-memory-lifecycle-vocabulary-crosswalk.md`.

This document is a handoff checklist for Core and Memory owners. It does not define a production API, authenticate metadata, create a source-change feed, or claim that Memory→NPC integration exists. The pure oracle is a defense-in-depth consumer check over supplied metadata. Any field that passes shape/value checks remains untrusted unless a future approved boundary establishes its origin and meaning.

## 1. Evidence classes for every input

| Input / assumption used by the NPC oracle | What the oracle actually checks | What it does **not** establish | Required trusted boundary |
|---|---|---|---|
| Request `world_id`, `subject_id`, `purpose` | Non-empty strings; candidate/result scope equality | That IDs resolve to canonical entities, that caller is entitled to act for the subject, or that purpose is authorized | Core-owned trusted identity and request-scope binding before retrieval |
| Request snapshot (`world_revision`, `commit_sequence`) | Both components are present and well-formed when snapshot is supplied | That the snapshot was atomically read, is current, or belongs to the requested world | Core-owned consistent read/snapshot contract; bind world identity and revision semantics |
| Result completeness and candidate array | Requires `completeness=complete` and an array | That the backend actually searched completely or did not omit inaccessible data in a revealing way | Memory-owned retrieval contract and typed partial/unavailable errors |
| Result scope | Exact world/subject/purpose match | Authentication of the scope fields | Trusted caller/adapter constructs the envelope; do not accept model-authored scope |
| Result-level access | Requires `outcome=allow` plus matching subject/purpose | That the decision is genuine, current, policy-derived, or evaluated before content/count/snippet disclosure | Approved Core/Memory authorization interface, decision reference/version, and ordering guarantee |
| Candidate-level access | Same binding checks as result access | Authenticity, freshness, revocation safety, or protection against forged `allow` | Candidate access evidence issued or verified by approved boundary; define whether one request decision covers all candidates |
| Candidate world/subject/purpose | Exact equality to request | Canonical membership or access authorization | Trusted retrieval adapter binds canonical references and request scope |
| Record `ref` and `version` | Non-empty strings | Stable identity semantics, immutable versioning, or source-record existence | Memory/Core define stable source identity and version semantics |
| `content_kind`, `epistemic_kind` | Membership in the oracle's current illustrative allowlists | Owner approval of these vocabularies or truth of the classification | Core/Memory/NPC approve canonical vocabulary and transition rules before an adapter maps values |
| Producer provenance | Requires a non-empty producer kind | Producer identity, integrity, authorship of underlying claims, or verification | Trusted producer/transform metadata with a defined namespace and integrity boundary |
| Summary lineage | Requires non-empty lineage; source ref/version; matching world; matching subject/purpose access binding; current freshness | That lineage is complete, unforgeable, or checked against the authoritative source at read time | Memory supplies complete authenticated lineage; Core/Memory defines access propagation and approved declassification |
| Lifecycle dimensions | Requires fields; accepts only proposal-defined positive values for disposition/reconciliation/access/index; preserves recognized evidence assessment | That enums are approved or values came from authoritative lifecycle state | Owners approve dimension vocabularies and supply trustworthy values; keep dimensions independent |
| Candidate freshness | Requires `current` | That a race did not occur after check or that source state was read atomically with content | Current-snapshot read or revalidation at the actual content-use boundary |
| Candidate snapshot | If request snapshot exists, requires equal, well-formed revision and commit sequence | That both objects refer to the same atomic source snapshot, or that all lineage sources share it | Core-defined snapshot identity and source validity semantics |
| Duplicate identity | Deduplicates by `ref + version` within one result | Delivery idempotency, cross-request deduplication, or stable acquisition identity | Core-owned idempotency contract for each semantic write |
| Output reference projection | Returns references/version/kind/evidence only; no candidate content or rejection diagnostics | That an upstream component has not already disclosed restricted snippets, counts, titles, or timing | Authorization must precede all sensitive retrieval output; boundary tests must inspect the whole response, not only oracle output |

**Trust rule:** a field is not trusted merely because the oracle validates it. The request bindings must be created by a trusted caller, and authorization/source-state evidence must be produced or verified by the approved Core/Memory boundary. If the owner cannot identify that boundary, the corresponding integration remains blocked.

## 2. Required boundary tests before production integration

These are tests for a future adapter/service path, not tests currently executed by `tests/npc-memory-candidate-eligibility.test.js`. Each test must exercise the actual boundary that retrieves and exposes data, not only call the pure oracle with hand-built objects.

| ID | Setup and action | Expected observable result | Owner(s) |
|---|---|---|---|
| BND-01 Authentic authorization | Caller supplies forged or stale `allow`; request is made for another actor/purpose | Boundary rejects before content, snippets, counts, titles, refs, or rejection diagnostics can reveal protected records | Core + Memory |
| BND-02 Deny/withheld equivalence | Compare genuinely empty authorized query with query containing only denied candidates | Publicly observable response is indistinguishable except for permitted generic operational metadata; no candidate count or filtered marker leaks | Memory + Core |
| BND-03 Revocation race | Access is revoked after retrieval but before content/prompt admission | Content is not exposed on stale authorization; revalidation/version semantics are explicit and tested | Core + Memory + NPC |
| BND-04 Foreign-world lineage | Summary has a permitted top-level record but one lineage source is foreign-world or lacks proven world binding | Summary is excluded before disclosure; no partial snippet from the summary escapes | Memory + NPC |
| BND-05 Lineage permission propagation | One source of a multi-source summary becomes denied/withheld | Derived summary is withheld or re-derived only under owner-approved policy; no content or diagnostic identifies the restricted source | Memory + Core |
| BND-06 Snapshot consistency | Result/candidate content is read at revision R, source validity changes before prompt admission | Either a single approved snapshot is honored or the candidate is rejected/revalidated; no mixed-snapshot admission | Core + Memory + NPC |
| BND-07 Rollback without higher sequence | Rollback changes event/source validity without increasing max commit sequence | Reconciliation detects the changed validity through an owner-approved signal/read path; no sequence-only poll misses it | Core + Memory |
| BND-08 Stale index | Index reports lagging/rebuilding/unavailable while authoritative source is changed or deleted | No candidate is asserted current solely because it was indexed; incomplete/unavailable is not interpreted as “no knowledge” | Memory + NPC |
| BND-09 Content fetched after admission | Oracle admits a ref/version; fetch returns a different version or a now-retracted source | Content is not added to context; no acquisition/belief/delivery success is persisted | Memory + NPC + Core |
| BND-10 Duplicate and retry | Same delivery/acquisition operation is retried after timeout or partial failure | Same approved idempotency key is reused; at most one semantic record is committed; unknown outcome is reconciled before retry | Core + host integration |
| BND-11 Delivery boundary | Retrieval succeeds but host injection/rendering fails or returns ambiguous status | Retrieval remains successful as retrieval only; no delivery success, receipt, acquisition, or belief is inferred | Host integration + Core + NPC |
| BND-12 Output side channels | Vary only whether denied candidates exist, including snippets, titles, counts, pagination, errors, timing diagnostics | Protected existence/content is not distinguishable through disallowed response fields; test the entire endpoint/adapter response | Memory + Core |
| BND-13 Canonical versus epistemic kind | Report, rumor, inference, and imported content pass retrieval | Consumer preserves type/qualification; none is promoted to canonical truth or acquired belief without separate evidence and approved write path | NPC + Core |
| BND-14 Authoritative identity | Model output or caller-supplied text invents actor/world refs | Trusted resolver rejects or replaces it before authorization; model text never becomes a trusted scope binding | Core |
| BND-15 Source deletion/retention | Source is deleted or erased while a derived summary/index entry remains | Approved deletion/retention policy prevents stale content from reappearing; index rebuild and derived-content cleanup are observable and tested | Core + Memory |

A test that merely asserts the pure helper rejects a fixture is useful consumer-unit coverage, but it cannot satisfy BND-01–BND-15. Boundary tests must record the exact runtime entry point, authoritative source of each access/lifecycle field, test fixture, and expected absence of sensitive output.

## 3. Integration gates and owner decisions

Do not implement an adapter or merge as production-ready until the following decisions are recorded by the responsible owners.

1. **Authorized-read contract (Core + Memory):** canonical input bindings; access outcome semantics; decision identity/version; whether access is per-request, per-record, or both; failure/withheld behavior; and proof that authorization runs before content, snippets, counts, and diagnostics are exposed.
2. **Consistent snapshot and revalidation (Core + Memory):** exact meaning of world revision and commit sequence; how candidate and lineage source versions bind to one read view; how to revalidate at content-use time; and what to do when the snapshot is stale.
3. **Source-change/reconciliation (Core + Memory):** durable handling of deletion, retraction, version changes, access revocation, rollback, and summary lineage invalidation. A higher sequence alone is insufficient if rollback can change validity without advancing it. No outbox, cursor, or event feed is assumed to exist.
4. **Lineage and declassification (Memory + Core):** complete lineage semantics, source-specific permission propagation, derived-summary invalidation, and whether/how a restricted source can be transformed into a permitted derivative.
5. **Vocabulary ownership (Core + Memory + NPC):** approved content kind, epistemic kind, lifecycle axes, error/completeness states, and lossless/conditional mappings. The crosswalk in docs/53 is a proposal, not approval.
6. **Persistence and transaction boundary (Core):** the existing authorized persistence path for delivery attempts/outcomes, receipt/acquisition, belief/inference, and audit; atomicity guarantees; retention/deletion; and idempotency keys. NPC must not create a parallel store.
7. **Host delivery evidence (host integration + Core):** distinguish attempted injection, accepted write, visible rendering, confirmed receipt, and comprehension. Do not infer one from another.
8. **Index operation contract (Memory):** health, completeness, stale/rebuilding/unavailable semantics, and recovery/rebuild behavior.

Until those decisions are resolved, the safe implementation boundary is the pure NPC admission oracle plus proposal documentation and unit tests. It may return safe reference metadata for already-authorized supplied candidates; it is not an authorized retrieval endpoint and must not be wired directly to arbitrary caller-provided objects as a security boundary.

## 4. Readiness statement

- **Implemented on NPC branch:** pure metadata admission checks, negative fixtures, no-content output projection, candidate exclusion non-disclosure behavior, and proposal documentation/crosswalk.
- **Not established by the oracle:** authentic authorization, authorization-before-disclosure, race-free revocation, authoritative currentness, actual Memory retrieval, host delivery/receipt, acquisition/belief persistence, rollback-aware source reconciliation, or cross-subsystem transactionality.
- **CI evidence:** a successful repository-native Actions run on an earlier exact head is not evidence for a later head. Report CI only with the exact tested SHA and run URL. An isolated compatible test harness is not native `npm test` or GitHub Actions.
- **Merge posture:** keep PR #76 Draft/unmerged until current-head native CI, owner-approved contracts, and applicable boundary tests are evidenced. No Core/Memory branch or file is modified by this document.


## 5. Current Core security baseline — refreshed 2026-10-24

The previous readiness statement remains valid, but the HTTP security baseline has changed since the earlier audit:

- **Core PR #65 is merged.** The HTTP API now has a narrow authorized-read route that authenticates a configured adapter and exposes only its bound actor's own `entity_id`, `entity_type`, and `status`. Arbitrary attributes and multi-entity NPC/Memory reads remain unavailable until a trusted visibility contract is approved. The separate internal/admin credential protects raw canonical HTTP state/events/audit reads, and proposal reads are scoped to their creator unless an admin override is used.
- **Core PR #83 is merged.** Every HTTP canonical rollback requires the separate admin credential, regardless of event type. This is an authorization hardening, not a source-change feed or reconciliation signal.
- Neither change authenticates hand-built candidate metadata passed directly to the NPC pure oracle. The oracle must continue to be described as defense-in-depth, not as an authorization boundary.
- The unresolved BND-01/BND-03/BND-06/BND-07 and related gates remain open: no general Memory retrieval authorization, race-free content-use revalidation, lineage permission propagation, durable rollback-aware source reconciliation, or NPC acquisition/delivery/belief persistence path is established by these PRs.

Therefore the Core security changes reduce existing HTTP exposure but do not unblock production Memory→NPC integration. Keep the adapter and semantic persistence path blocked until the responsible owners approve the missing contracts and the real boundary tests exercise them.


## Verification checkpoint — 2026-10-24

At the time of this checkpoint, PR #76 source HEAD was `7afe7ebff95f7979ae37197981a456d352611bcd`. The available exact-SHA GitHub Actions lookup and combined-status lookup returned no run/check records for that SHA. This means **native CI is unverified**, not failed and not passed. The earlier successful run on `0106f6da30034ce414e1ab2ee377b6707a0ca48a` predates later branch changes and cannot validate the current source tree.

The next evidence required is a repository-native `npm test` / Runtime tests run whose pull-request head SHA matches the then-current PR #76 source HEAD. Keep the PR Draft and unmerged until that evidence and the owner-approved integration gates above are satisfied.
