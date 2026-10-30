# NPC ↔ Memory boundary acceptance matrix

Date: 2026-10-24  
Owner: NPC  
Status: design/test traceability; not a runtime API or production integration approval  
Related: Issue #70; Core owner decision recorded in PR #104; current oracle `src/npc/memory-candidate-eligibility.js`; tests `tests/npc-memory-candidate-eligibility.test.js`.

## 1. Scope and evidence rules

This document closes the NPC-owned contract/test-traceability portion of Issue #70. It does not claim that the production Memory→NPC retrieval, delivery, acquisition, belief, or reconciliation path exists.

Evidence labels used below:

- **Executable now** — a test can run against the current pure admission helper and fixtures. It proves only behavior for caller-supplied metadata.
- **Contract acceptance** — a required future test against the real owner-approved adapter/host/persistence path. Current helper-only tests cannot prove it.
- **Owner gate** — the behavior cannot be implemented or tested faithfully until the named owner supplies an approved contract and authoritative signal.

The pure oracle returns reference metadata only. It neither fetches content nor writes state. Its `ready` result means only that supplied metadata passed its checks; it does not authenticate that metadata, authorize a real read, prove the context used by a model call, or establish receipt/acquisition/belief. The current result's generic exclusion behavior intentionally avoids per-candidate reasons/counts that could disclose protected record existence.

## 2. NPC-owned consumer contract

### Inputs and checks

The caller must establish trusted request scope independently of model output:

- `world_id`, `subject_id`, and `purpose`;
- the exact consistent snapshot pair `(world_revision, commit_sequence)` when a snapshot is required;
- an owner-approved result whose completeness and request-level access/scope refer to that same request.

For each candidate, the helper checks supplied metadata for:

- stable record reference and version;
- candidate world, subject, and purpose matching the request;
- per-request and per-candidate allow decisions bound to the requested subject and purpose;
- recognized `content_kind` and `epistemic_kind`;
- producer provenance being present, without treating producer identity as content authorship or proof;
- independent lifecycle dimensions and admissible states;
- current freshness and snapshot consistency when a snapshot is required;
- for summaries, complete non-empty source lineage with each source's reference/version, matching world, subject-/purpose-bound allow, and current freshness.

Unknown or absent required evidence is excluded. Exclusion does not mean the underlying proposition is false or that the subject knows nothing.

### Minimal current projection shape (not a runtime retrieval API)

The current helper returns only a status, a list of safe reference projections, and a generic request-level reason when the request cannot be evaluated. Its observable shape is approximately:

```js
// Illustrative projection of the existing pure helper; not a Memory API.
{
  status: "ready" | "non_ready",
  admitted: [{
    record_ref: "owner-supplied stable reference",
    record_version: "owner-supplied version",
    epistemic_kind: "recognized kind",
    evidence_assessment: "unassessed | supported | disputed | insufficient"
  }],
  reason: null | "generic non-ready reason"
}
```

The strings above illustrate the existing helper's output categories, not an approved cross-block schema or proof that the supplied references/versions are authentic. Candidate-level rejection reasons and counts are deliberately not returned. Content, snippets, titles, lineage details, delivery status, acquisition records, and belief records are not output by this helper.

### Idempotency/deduplication candidates (proposal only)

No durable idempotency contract is currently approved. If an existing owner-approved boundary exposes the relevant identities, these are candidate composite keys for review, not new fields or API requirements:

- **Candidate projection:** repeated stable record reference + record version pairs in one result are all excluded as ambiguous. This is request-local ambiguity rejection, not durable idempotency.
- **Delivery attempt:** existing canonical message/event reference + intended target + channel + the host's existing attempt/idempotency identity, if supplied. Do not synthesize an attempt ID or assume an external side effect is safe to repeat.
- **Acquisition:** existing subject/entity reference + existing source event/record reference + proposition/fact reference + acquisition path/type, only where each component is already authoritative. If the source or proposition identity is unavailable, the case is unsupported rather than assigned a fabricated key.
- **Derived summary:** existing summary reference/version plus the authoritative versioned lineage manifest, if Memory already exposes both. A producer ID alone is not a content-lineage key.

Core owns durable delivery/acquisition idempotency and transaction boundaries; Memory/Core owners must approve the exact identity semantics before any persistence work. No new store, schema, event log, or cross-store atomicity assumption follows from these candidates.

### Lifecycle separation

1. **Retrieval eligibility:** pure metadata filtering only; no content returned by this helper.
2. **Authorized content projection:** Core/Memory-owned boundary must authorize before exposing content, snippets, counts, or diagnostics, then re-check relevant source lineage and lifecycle immediately before serialization under an owner-defined consistency guarantee.
3. **Context inclusion:** inclusion in one generation request is transient context preparation, not a persistent receipt, acquisition, or belief.
4. **Delivery attempt/outcome:** record only through a supported host/Core path; injection alone is not evidence of display. If the host has no verified visible-render signal, status remains unconfirmed.
5. **Acquisition/receipt:** persist only when a real, supported evidence path establishes the subject obtained the proposition; retrieval, prompt inclusion, or a generated claim is insufficient.
6. **Belief/inference:** subject-relative stance is separate from acquisition and canonical truth. A model-generated rationale alone is not proof of an acquisition event or a valid inference record.
7. **Invalidation/reconciliation:** Core owns canonical source validity and dependent knowledge reconciliation. Do not infer source-change events by polling `commit_sequence` alone. `world_revision + commit_sequence` is a snapshot freshness marker, not a durable event feed.

## 3. Negative-case matrix

“Content may be returned” refers to a future content-bearing Memory boundary, not the current helper (which never returns content). “Prompt” means inclusion in model context. Persistence must remain unchanged unless a named, approved owner path establishes a real event.

| Case | Content / prompt expectation | Persistence expectation | Owner and retry/reconciliation | Test status and expected assertion |
|---|---|---|---|---|
| Duplicate candidate / repeated delivery | Exclude every occurrence of a repeated stable record reference + version pair from that candidate set; do not infer a second communication from a repeated result. Content still requires authorization. | Oracle writes nothing. A delivery retry must not duplicate a delivery/acquisition fact. | NPC helper rejects ambiguous candidate identity pairs; Core/host owns durable delivery idempotency. Retry with an existing owner-approved idempotency identity only. | **Executable now:** every duplicate ref/version occurrence is excluded. **Contract acceptance:** repeated host attempt does not create duplicate durable records. |
| Repeated source identity in summary lineage | Exclude the entire summary candidate when lineage repeats the same source `ref + version` pair; do not assume duplicate entries are independent or byte-identical. | Oracle writes nothing and exposes no source identity or per-item rejection reason. | NPC helper validates supplied lineage metadata; Memory/Core must define authoritative lineage and immutable digest semantics if duplicate entries are ever to be reconciled rather than rejected. | **Executable now:** repeated source identity is rejected and serialized output does not disclose the source identity. **Contract acceptance:** real Provider lineage is authoritative and complete. |
| Source from another world | Exclude from candidate projection; never place it in prompt. | No state change. | NPC oracle checks metadata; Core/Memory must establish authentic world binding. Retry only after correct scope is available. | **Executable now:** foreign candidate and foreign summary lineage source yield no admission. |
| Missing/denied/withheld/ambiguous access | No protected content, snippets, counts, identifiers, or per-item rejection diagnostics. Do not convert denial into a complete-empty result. | No receipt/acquisition/belief changes. | Core/Memory owns real authorization; fail closed. Retry only after an authoritative new decision, not by trusting caller/model labels. | **Executable now:** request-level failures return non-ready; candidate failures are excluded without per-item leakage. **Contract acceptance:** test non-disclosure at actual content boundary. |
| Retracted/deleted/unavailable source | Do not return or prompt the source or a derived summary that still depends on it unless approved lineage policy proves safe independent support/declassification. | Do not silently erase historical acquisition or rewrite belief; Core reconciles validity. | Core owns source validity and dependent records. Retry after authoritative reconciliation. | **Executable now:** stale/retracted/unavailable lifecycle/freshness labels exclude candidate. **Contract acceptance:** real retraction propagates to dependent summaries/knowledge. |
| Stale source or changed source version | Exclude when candidate snapshot/version is stale or inconsistent; do not silently substitute an unversioned “latest” source. | Oracle writes nothing. | Memory owns source identity/version semantics; Core owns snapshot/revision semantics. Retry with a fresh, consistent approved snapshot. | **Executable now:** stale freshness and mismatched snapshot excluded. **Owner gate:** prove source versions are authoritative in the real adapter. |
| Summary depends on multiple sources; access to one is revoked | Withhold the derived summary unless every source is currently authorized for this recipient or a specific owner-approved declassification rule applies. Producer provenance cannot substitute for source lineage. | No state change from filtering. Any persisted derived record is Core/Memory-owned and must be reconciled separately. | Memory owns lineage and access propagation; Core/security owner approves declassification semantics. Retry only after full lineage/access re-evaluation. | **Executable now:** incomplete lineage and a denied/stale/missing-scope lineage source exclude summary. **Contract acceptance:** revocation of one real source prevents derived text/snippet leakage. |
| Index stale/unavailable/rebuilding | Do not claim a complete empty result or expose stale candidates as current. Return the owner-approved unavailable/partial status without protected diagnostics. | No state change. | Memory owns index health/completeness. Retry after authoritative ready state; preserve distinction between empty and unavailable. | **Executable now:** unhealthy lifecycle labels exclude candidate; partial/unavailable result is non-ready. **Contract acceptance:** real index rebuild/failure status is propagated correctly. |
| Conflicting or insufficient evidence | Reject candidates assessed as `disputed`, `insufficient`, or `unassessed`; only positively `supported` evidence crosses NPC admission. Exclude without per-item reason/count or content disclosure. | No automatic belief change or canonical mutation. | NPC admission is a conservative context-safety gate, not a truth adjudicator; Core remains owner of canonical truth and persistent belief. | **Executable now:** supported-only admission; disputed, insufficient, and unassessed candidates are excluded, with serialized output indistinguishable from authorized-empty and no rejected identifier/content leakage. |
| Empty search result | Only an authoritative, complete, authorized empty result may be represented as empty; it means no eligible result in that query, not “subject knows nothing.” | No acquisition, delivery, or belief change. | Memory owns completeness/access result semantics. Retry only if unavailable/partial or snapshot freshness requires it. | **Executable now:** complete authorized empty result is ready-empty; denied/withheld/scope-mismatched empty result is non-ready. |
| Retrieval succeeds but delivery fails | Retrieval/context preparation does not imply successful delivery. Do not mark the target informed or generate a confirmed receipt. | No acquisition/belief unless a separate supported path establishes them. Record attempt/failure only through existing approved owner path. | Core/host owns delivery. Retry may repeat the delivery attempt under an approved idempotency rule, not the underlying world event. | **Contract acceptance / owner gate:** current main has no identified production Memory→NPC delivery path or approved persistence boundary. |
| Delivery succeeds but receipt is unknown/ambiguous | Do not claim visible display, receipt, comprehension, acquisition, or belief. Host injection alone remains unconfirmed absent a verified signal. | No confirmed receipt/acquisition/belief. Preserve unknown/ambiguous state where the approved owner model supports it. | Host/Core must identify authoritative delivery evidence and retry semantics. Do not blindly retry in a way that duplicates an external effect. | **Contract acceptance / owner gate:** no verified host-rendering signal is established by current oracle tests. |
| Source retracted after acquisition | Future retrieval excludes invalid support. Existing acquired knowledge must be reconciled according to source dependency; it must not automatically disappear if another valid acquisition path remains. | Preserve audit history per Core policy; invalidate only consequences no longer supported. Do not automatically rewrite belief merely because canonical truth changed. | Core owns acquisition validity, source dependency and reconciliation. | **Contract acceptance / owner gate:** no production acquisition/reconciliation path is present in this work slice. |
| Canonical rollback changes validity without higher commit sequence | Do not treat unchanged `commit_sequence` as proof that the source remains valid; require an authoritative rollback/reconciliation result before exposing dependent content. | No NPC-owned rollback or parallel event store. Core reconciles affected canonical/knowledge state. | Core owns rollback and its validity/reconciliation contract. No polling loop, outbox, or cursor is introduced here. | **Current-main evidence:** Core #140 selected version-pinned acquisition semantics (comment `6488390384`): rollback invalidates the pinned version, and a replacement value requires a new explicit acquisition. Core's per-entity source-version ledger was subsequently ported onto current `main` in commit `09a7d9ba4704c6322cae40706867c323c62f7e1a`. `createCanonicalEntitySourceVersionValidator` validates the exact current Core-owned token for a canonical entity; `createCanonicalEntityInventoryValidator` attests the complete direct canonical-entity inventory. The token is independent of world snapshot cursors and advances on rollback when the canonical projection changes. Coverage is present in `tests/canonical-entity-source-version.test.js`, `tests/canonical-entity-inventory.test.js`, `tests/entity-source-versions.test.js`, and the SQLite Provider integration suite. This closes the earlier source-version-ledger implementation gap for the direct canonical-entity Provider slice; it does not establish production Memory→NPC delivery, an NPC acquisition/belief persistence path, Host final-egress ordering, or the end-to-end dispatch/revocation race. The snapshot pair alone is not a durable source-change feed. |
| Retry after partial failure | Do not merge partial/unavailable into complete-empty. Do not leak which protected candidates were found. | No duplicate delivery/acquisition/belief on retry; persist only events actually evidenced through owner-approved paths. | Each owner defines idempotency at its own boundary; cross-store atomicity is not implied. | **Executable now:** partial/unavailable results are non-ready. **Contract acceptance:** fault injection across actual retrieval/delivery/persistence boundary. |

## 4. Lifecycle / ownership transition table

| Transition | Trigger and authority | Durable change | Idempotency / prompt consequence | Testability |
|---|---|---|---|---|
| Candidate → eligible reference projection | Pure oracle evaluates caller-supplied metadata; NPC helper owns only the projection | None | Repeated ref/version pairs are excluded as ambiguous; no content in result | Executable now |
| Reference → authorized content projection | Approved Core/Memory access boundary; Memory/Core owns authorization | None implied by reading | Re-authorize before serialization; fail closed; no snippet/count side channels | Owner gate: approved interface and race/consistency guarantee absent |
| Context included → delivery attempt | Actual existing host/Core integration only | Attempt record only if existing approved persistence path supports it | Inclusion alone is not delivery; retry follows host idempotency contract | Owner gate: production path not established |
| Delivery attempt → failed / unknown / confirmed shown | Authoritative host signal, interpreted by Core/host owner | Delivery status only through approved owner path | Unknown stays unknown; “shown” requires a verified rendering signal | Owner gate |
| Delivery/observation → acquisition/receipt | Supported path-specific evidence; Core owns acquisition | Core-owned acquisition record if contract exists | Repeated event deduped by existing canonical/source identity; prompt inclusion alone is insufficient | Owner gate |
| Acquisition → belief create/update/retract | Subject-relative interpretation under Core-owned authorized persistence | Core-owned belief state, separate from acquisition/canonical truth | No belief from retrieval alone; preserve uncertainty/conflict | Owner gate |
| Source change/reconciliation | Authoritative source validity/revocation/reconciliation signal; Core/Memory owns source validity | Reconcile dependent acquisition/derived records using existing identities | Re-evaluate before future prompt; preserve independently supported acquisition paths | Owner gate |
| Canonical rollback | Existing Core rollback path and validity changes | Core-owned rollback/reconciliation only | Do not key solely to higher `commit_sequence`; no NPC rollback store | Owner gate |
| Access revocation | Authoritative policy decision from owner-approved authorization boundary | No NPC-side permission ledger | Withhold content/derived summaries before serialization; retry only after new authoritative decision | Owner gate |
| Summary re-derivation / declassification | Memory lineage pipeline plus explicit owner-approved declassification policy | Memory/Core-owned derived record if such path exists | Recheck every source for current recipient; producer ≠ claim source | Owner gate |
| Index rebuild/failure | Memory index health/completeness signal | Memory-owned index status only | Never mislabel unavailable/partial as complete-empty; retry after ready | Contract acceptance; current helper only checks supplied labels |

## 5. Executable test traceability

The current `tests/npc-memory-candidate-eligibility.test.js` suite exercises the pure helper for:

- trusted scope and request-/candidate-level subject-purpose binding;
- candidate and summary-lineage world scope;
- missing/unknown content and epistemic kinds;
- missing identity/version and producer provenance;
- required lifecycle dimensions, admissible lifecycle states, evidence-assessment vocabulary and preservation;
- stale/retracted/unavailable freshness, snapshot validation/mismatch;
- summary lineage completeness, source identity/version, scope, access and freshness;
- duplicate record/version ambiguity rejection;
- partial/unavailable versus complete-empty result;
- non-disclosure of rejected identifiers/reasons/counts;
- preservation of conflicting eligible evidence;
- no mutation of acquisition, delivery, belief, or canonical state.

The native repository test command is `npm test` (`node --test`). A successful run proves only the exact tested source/test revision. It does not prove production integration. The clean replacement for the NPC lineage tests is PR #157 (merged); the old mixed-scope PR #138 was superseded and is not the review/evidence path. This document makes no claim that future contract-acceptance cases have run.

## 6. Owner decisions still required before production integration

**Core**
1. Trusted binding for the actual world, requester, recipient/subject, purpose, and actual generation/context used. A caller-supplied `generation_id` or manifest membership is not authentication.
2. Authoritative rollback/source-invalidation/reconciliation signal and consistency guarantee. `world_revision + commit_sequence` is a snapshot marker, not a durable source-change feed.
3. Final authorization/lifecycle check and its revocation/serialization guarantee.
4. Existing canonical persistence boundary and transaction/audit semantics for acquisition, delivery/receipt, and belief; identify actual host evidence for delivery.

**Memory**
5. Approved authorized-read contract, including complete-empty/results, partial, unavailable, denied/withheld, stale/reconciliation-pending, and invalid request outcomes, without existence/count/diagnostic leakage.6. Authoritative source identity/version and versioned summary lineage; per-source authorization propagation and any explicit declassification policy.
7. Index health/completeness contract and how it is reflected in real retrieval results.

No new API, schema, permission enum, outbox, cursor, parallel store, or cross-store atomicity assumption is proposed by this document. Until owners approve the real boundaries and executable tests against them, the production consumer remains unapproved and fail-closed.


## 7. Preserved oracle verification evidence

The oracle implementation and original focused test file are already on `main` through PR #78. Their baseline blob identities were:

| Artifact | Baseline blob SHA |
| --- | --- |
| `src/npc/memory-candidate-eligibility.js` | `c3b540588d64b653d448d4af62c7f255e2d11245` |
| `tests/npc-memory-candidate-eligibility.test.js` before PR #138 | `08fd5785f72e7bca39d62aea6b7b8bcf8480a0fe` |

The baseline native Runtime run [#40061707222](https://github.com/necromorphic/Logic-Engine/actions/runs/40061707222) passed on commit `e06cb35b85a399238cea5ad0ac6dcb3043792b05`; it is evidence for that exact merged slice, not for the old superseded PR #76 head `e3e8fc43e2488227b74ded67434aed522c5ec484`, for which no workflow run was found. The separate evidence-note PR #135 was tested on its own exact head `bcb9e1345d17fe0370d005ffc59340c1ba700bfc` by Runtime run [#40068270957](https://github.com/necromorphic/Logic-Engine/actions/runs/40068270957), with the test job and `Run npm test` step successful.

The reconciled current-main NPC eligibility tests now also cover separator-safe identity, sparse lineage, immutable result projection, snapshot-pair mismatch, malformed entries, and lifecycle separation. PR #290 adds HTTP caller-override rejection and host visibility revocation regression tests; Runtime CI passed on its exact head before merge. PR #292 adds Provider raw-archive lifecycle and authorization-race coverage; Runtime CI passed on its exact head before merge. These checks establish only the tested helper/API boundaries; they do not authenticate arbitrary source metadata or establish a production Memory→NPC delivery/acquisition/belief path.

## 8. Completion statement

NPC-owned design and current-helper test traceability can be reviewed independently. Issue #70 must remain open until this matrix is cross-reviewed and the owner-approved integration gates are resolved; no documentation-only result should be represented as production Memory→NPC completion.


## 9. Cross-check against current Core rollback, snapshot, and read tests

This section maps NPC handoff claims to the current Core test suite without changing Core-owned files. These are existing tests on `main`; they are evidence about Core behavior, not evidence that Memory retrieval or NPC knowledge persistence is integrated.

| Boundary claim | Existing Core evidence | What that evidence establishes | What it does not establish for NPC/Memory |
|---|---|---|---|
| `commit_sequence` is not a rollback event feed | `tests/causality-contract.test.js`: **`commit_sequence is per-world, stable across rollback, and distinct from world_revision`** (around lines 660–695) | Rollback preserves the sequence assigned to committed events while world revision changes; a later committed event receives the next sequence. This directly supports treating the cursor as a committed-event ordering marker, not as a rollback notification stream. | No durable source-change feed or Memory consumer notification is established. NPC must not expect a larger sequence for every validity change. |
| Rollback can invalidate causal readers while preserving independently supported claims | `tests/causality-contract.test.js`: **`typed READS_CLAIM link invalidates a reader when the claim loses its only source`**, **`typed READS_CLAIM reader survives rollback while another valid source still supports the claim`**, **`sequential rollbacks invalidate a READS_CLAIM reader when its last remaining support is removed`** | Core tests cover dependency-sensitive invalidation and preservation when an independent valid source remains. | They do not reconcile Memory summaries, NPC acquisition records, or subject-relative beliefs, and do not prove summary lineage exists in Memory. |
| Rollback updates the canonical projection and advances revision without rewinding game time | `tests/core.test.js`: **`rollback restores projections, preserves independent branch, and never rewinds game time`** (around lines 95–126) | Canonical projections are rebuilt; a causally dependent event is invalidated; an independent branch remains; game time stays advanced; world revision advances. | This is not an NPC-side cache invalidation mechanism and does not establish a race-free read/serialization guarantee for a future Memory adapter. |
| Rollback and audit mutation are atomic in the tested failure path | `tests/core.test.js`: **`a failed rollback audit write leaves the world and rollback metadata unchanged`** (around lines 300–329) | Injected audit failure leaves revision, projection, event validity, and rollback-row count unchanged; a subsequent successful rollback changes them together. | It does not provide a transaction spanning Core and a future Memory index, derived summaries, acquisition, delivery, or belief persistence. |
| Rollback retry uses an existing idempotency key; a new key after an applied rollback is a no-op | `tests/causality-contract.test.js`: **`rollback idempotency replays its original result after history changes and a new key is a no-op`** (around lines 1543–1595) | Existing Core rollback idempotency semantics are exercised for replay and no-op retry. | It does not define delivery/acquisition/belief idempotency keys or make external side effects safe to repeat. |
| Authorized reads preserve a consistent snapshot marker and avoid state mutation | `tests/authorized-read-service.test.js`: **`authorized read emits only fields explicitly allowed by trusted policy and preserves snapshot cursor`** (around lines 49–74) | The internal authorized-read service applies its trusted field policy, returns `world_revision` and `commit_sequence`, withholds a protected field, and leaves revision, sequence, events, and audit unchanged. Related tests cover fail-closed policy errors and non-disclosure for missing/withheld targets. | This service is not yet the approved Memory→NPC adapter contract. The test does not establish a re-check immediately before future content serialization, Memory source identity/lineage, or delivery/receipt/acquisition/belief. |

### Resulting NPC boundary interpretation

- The Core suite already contains meaningful rollback and atomicity tests. The remaining gap is **not** “Core has no rollback tests”; it is the absence of an approved, authoritative handoff from those Core validity changes to Memory source/index/summary reconciliation and then to NPC consumption.
- Because Core deliberately keeps `commit_sequence` stable across rollback, a consumer that only polls for a higher sequence can miss a rollback. The current snapshot pair is useful for detecting that the observed world revision differs from the revision on which a candidate was evaluated, but it is not a replayable change feed and does not by itself identify affected source records.
- Existing `READS_CLAIM` tests demonstrate causal invalidation at the canonical event/fact layer. They do not establish lineage for Memory-derived summaries or policy for reconciling already acquired subject knowledge. Those remain Memory/Core owner gates from Issues #140 and #142.
- Keep the NPC pure oracle and production consumer boundary unchanged until the owners specify the real validity/reconciliation signal and tests exercise it across Core → Memory → NPC. No new cursor, outbox, API, store, or cross-store transaction is introduced by this traceability note.


## NPC-side handoff refresh — 2026-10-24 (supersedes stale PR #138/#139 evidence wording)

### Clean-path reconciliation against current main

- [PR #138](https://github.com/necromorphic/Logic-Engine/pull/138) is closed unmerged and explicitly superseded by [PR #157](https://github.com/necromorphic/Logic-Engine/pull/157). Its intended NPC change was the focused test file tests/npc-memory-candidate-eligibility.test.js. The nine docs/personality/* files are not NPC-owned deliverables: eight have the exact same blob SHA as current main at PR #138 head, and docs/personality/09-per-case-acceptance-traceability.md is stale relative to main (the PR branch would roll it back to an older blob), not a new NPC change to port.
- [PR #139](https://github.com/necromorphic/Logic-Engine/pull/139) is closed unmerged and explicitly superseded by [PR #159](https://github.com/necromorphic/Logic-Engine/pull/159). Its intended NPC deliverable is docs/56-npc-memory-boundary-acceptance-matrix.md. The same nine Personality paths are ancestry/base contamination, not a reason to modify or port Personality content; eight match current-main blobs exactly and the remaining traceability file is stale.
- The clean, reviewable path is already merged: [PR #157](https://github.com/necromorphic/Logic-Engine/pull/157) changes only tests/npc-memory-candidate-eligibility.test.js; [PR #159](https://github.com/necromorphic/Logic-Engine/pull/159) changes only this NPC-owned matrix. No Personality/Core/Memory/Relationships file is to be edited as part of NPC follow-up.

### Evidence map: what NPC can test independently

| NPC concern | Exact test/evidence | What it establishes | Limit |
|---|---|---|---|
| Candidate metadata, scope, lifecycle and freshness | [tests/npc-memory-candidate-eligibility.test.js](https://github.com/necromorphic/Logic-Engine/blob/main/tests/npc-memory-candidate-eligibility.test.js): “candidate exclusions expose neither per-record reasons nor rejection counts”; “partial, unavailable, rebuilding, malformed, or unknown retrieval is not treated as complete-empty”; “a derived summary requires complete lineage and current authorized sources”; “summary lineage sources must match the requested world, subject, and purpose”; “candidate admission does not mutate its request or result inputs” | Pure helper fails closed on the metadata it receives, returns references only, and has no state side effects | Injected metadata is not authenticated; this is not an authorized read or production integration |
| Sparse summary lineage | `tests/npc-memory-candidate-eligibility.test.js`: “summary lineage rejects sparse arrays instead of skipping missing source slots” | Current main rejects sparse lineage arrays; this is pure-helper behavior only | Present on main via the reconciled NPC eligibility integration; it does not establish trusted source authority |
| Collision-safe record identity | `tests/npc-memory-candidate-eligibility.test.js`: “identity tuple encoding does not collide when references or versions contain separators” | Current main uses separator-safe tuple identity for candidate reference/version pairs | Present on main; this remains helper-level identity safety, not proof of immutable source payload equality |
| Immutable result and malformed input regression | `tests/npc-memory-candidate-eligibility.test.js`: “admission result and nested reference projections are immutable”, “non-finite numeric snapshot components fail closed”, and “malformed candidate entries are ignored without leaking or aborting valid peers” | Current main checks helper output immutability and rejects malformed values without exposing them | Present on main after #290; not proof of trusted inputs or authorization |

### Cross-block acceptance and exact blockers

| Requirement | Exact test/evidence now available | Owner and remaining closure test |
|---|---|---|
| Authorized content read and non-disclosure | `tests/authorized-read-service.test.js` and `tests/authorized-read-api.test.js` cover trusted field-policy checks, fail-closed behavior, and non-disclosure for missing/withheld targets; `tests/npc-memory-candidate-eligibility.test.js` covers reference-only admission | The service/API tests are current-main authorization-boundary tests; old PR #183 was closed unmerged and its fixture results are not current-main evidence | Core + Memory + Host still need an approved real source-version/lineage contract and an end-to-end disclosure test |
| Revocation at the authorized-read boundary | `tests/authorized-read-api.test.js`: “host visibility revocation is re-evaluated on every authorized-read request”; raw Provider revocation-race coverage is merged in PR #292 (commit 567ae425738515333d5e1d05c33371e172ef4af3) | The current HTTP test proves the trusted host policy is re-evaluated between requests; it does not prove atomic revocation across serialization or Memory→NPC | Core + Memory + Host must define the final disclosure/serialization guarantee and exercise it across the real source adapter |
| Rollback with unchanged commit sequence | `tests/authorized-read-service.test.js`: “authorized read returns the current composite snapshot after rollback changes revision without sequence growth”; `tests/causality-contract.test.js` covers Core rollback/cursor semantics | The tested service returns the current revision/sequence pair after rollback, but no Provider reconciliation journal or production NPC handoff is implied | Core + Memory must define and test authoritative rollback/source invalidation propagation through Provider and dependent summaries |
| Source version authority and complete inventory | `tests/sqlite-memory-provider.test.js` exercises the injected `validateSourceVersion` and `validateInventory` seams; these are trusted callbacks supplied to the Provider, not authenticated by the Provider itself | Provider tests prove fail-closed behavior for callback outcomes, not that a production callback exists or represents authoritative Core state | Memory + Core must identify and test the real source-version and complete-inventory authority; absent that, keep results non-current |
| Retrieval readiness vs complete-empty | Current oracle test “partial, unavailable, rebuilding, malformed, or unknown retrieval is not treated as complete-empty”; current Provider tests cover injected source-validator/inventory outcomes and query readiness | The pure oracle and Provider unit tests exercise separate layers; closed-unmerged PR #183 does not count as current-main evidence for a real Core→Provider→NPC path | Memory + Core must demonstrate actual status propagation for complete-empty, partial, denied, stale/reconciliation-pending, rebuilding, and unavailable. Keep these distinct; do not synthesize statuses in NPC |
| Delivery, receipt, acquisition and belief | `tests/npc-memory-candidate-eligibility.test.js`: “candidate admission never implies delivery, receipt, acquisition, or belief”; the existing synthetic fixture also checks later lifecycle properties remain absent | Admission output is reference-only and does not accept caller-supplied lifecycle markers as proof of downstream state | Core + Host still need authoritative render/receipt evidence and an approved persistence/idempotency boundary before any positive delivery/acquisition/belief test |
| Stale derived summary after revocation/reconciliation | Current oracle test “a derived summary requires complete lineage and current authorized sources”; Provider raw-archive tests are separate and do not currently index these raw messages as NPC summaries | Memory/Core: test an actual derived record whose source is revoked/retracted and verify no content/snippet leaks before serialization; define any allowed independent-support/declassification rule first. No approved lineage/reconciliation authority means the production test is not yet faithful. |

### Explicit empty/denied/non-ready semantics — TЗ-4

The executable MemoryNpcConsumer fixture tests must keep these outcomes separate:

- **Authorized complete-empty:** return ready with empty admitted and candidates only after query authorization, complete/current Memory result metadata, and a matching current Core snapshot read.
- **Record-level denial:** do not reveal the denied record's identity, reason, count, freshness, or content. Its externally observable result must match a genuine authorized complete-empty result when all other trusted envelope conditions are equal.
- **Query denied/withheld, retrieval unavailable, or incomplete result:** return non_ready with no admitted references or candidates. This means the consumer cannot verify the result; it does not mean no matching memory exists.
- **Query permission revoked during retrieval:** the consumer rechecks query authorization immediately before each ready-empty or content-bearing ready result. If the check denies, throws, or returns anything other than explicit `true`, the result is `non_ready` with no references or content.
- **Limit of this recheck:** it narrows the time-of-check/time-of-use window; it is not an atomic revocation guarantee and does not replace an owner-approved final disclosure gate at the real host/model dispatch boundary.
- **Record revoked during Core source read:** before returning any content-bearing `ready` result, NPC reauthorizes every record that would be returned. If a final check denies or cannot be confirmed, the entire result is `non_ready` with no candidate content. This narrows the race but still does not make revocation atomic with model dispatch.
- **Core changes during final authorization checks:** after the asynchronous query/record rechecks, NPC performs a final authorized Core snapshot read. If the snapshot differs from the one used for admission (including for complete-empty), return `non_ready`; no further asynchronous authorization checks occur after that final snapshot read. This is still not an atomic transaction with eventual model dispatch.
- **Malformed, stale, mismatched, or unavailable canonical snapshot:** return non_ready; never downgrade the result to ready-empty by filtering rows.
- **Interpretation rule:** empty search results are not evidence that an event did not happen, that a source does not exist, or that the NPC never learned something. These tests use injected provider callbacks and establish consumer behavior only; they do not authenticate a production provider or prove Memory→NPC dispatch.

### Acceptance rule and next actions

1. Keep NPC code limited to the pure admission consumer and its tests. The clean mainline baseline is PR #157 + PR #159; review NPC draft fixes #174, #175, #177 independently and do not describe them as merged.
2. For each new NPC-only test, assert safe reference-only output, generic exclusion/no per-item diagnostic leakage, no input mutation, and no side effects where applicable. Use the real current-main helper for unit tests; label injected seams explicitly as fixtures.
3. Cross-block tests must identify the actual Core/Memory/host implementation under test, not only a callback interface. Record source SHA, test name, exact-head CI, and whether authority comes from production owner code or a fixture.
4. Production Memory→NPC remains disabled until Core approves authoritative source validity/version, complete inventory and rollback/reconciliation semantics, and Core/Memory/host approve final disclosure/revocation semantics. NPC cannot manufacture those guarantees in a local helper.


## NPC consumer entry point and lifecycle-separated admission tests — 2026-10-24

### Entry point in the current NPC slice

The only implemented NPC-side decision point in this slice is `evaluateMemoryCandidateAdmission(request, result)` in `src/npc/memory-candidate-eligibility.js`. It is a pure eligibility/admission oracle called by an owner-approved caller; it is **not** the runtime Memory retrieval entry point, an authorization service, a Core adapter, or proof that the result came from Core. It returns a bounded list of reference/version projections and never returns candidate content.

The decision is usable only when the upstream integration has already supplied trustworthy request bindings and an owner-authorized result. The helper's fields (`access.outcome`, scope, snapshot, lifecycle labels, and lineage) are input claims; this function cannot authenticate their origin. A fixture that says `allow` is not Core authorization evidence. Until Core defines and the host/adapter supplies the actual provenance-bound result, no production consumer may call this helper with arbitrary Memory/model/caller data.

### Admission/fail-closed test coverage

- Request scope and snapshot absent/malformed → `non_ready`, no admitted references.
- Result unavailable/partial/rebuilding/unknown or malformed → `non_ready`; never equivalent to authorized complete-empty.
- Request-level or per-candidate access denied/withheld/unknown, subject/purpose mismatch, wrong world, stale/retracted/unavailable source, unknown freshness, incomplete identity/version, malformed lifecycle, or mismatched snapshot → no candidate admitted.
- Summary candidates require a nonempty complete lineage whose every source has identity/version, matching world, subject/purpose-bound allow, and current freshness. Sparse array slots are rejected explicitly by the current helper tests; that still does not authenticate the source or make reconciliation authoritative.
- Identity pairs containing separators must remain distinct; this is covered by the current helper tests and does not prove immutable source payload equality.
- Rejected identifiers, contents, per-item reasons and rejection counts are not exposed.
- The updated #246 branch adds synthetic fixture tests asserting that admission is a pure projection and does not mutate or set delivery/receipt/acquisition/belief lifecycle facts. These are local contract tests only; they do not establish host/Core integration.

### State vocabulary — no implicit transitions

| State | Meaning / authority | What does not prove it |
|---|---|---|
| captured | Host observed an input/event | A database row or index entry |
| persisted | Provider durable write completed under its contract | Capture or in-memory candidate |
| indexed | Search index contains a projection | Currentness, authorization, or complete inventory |
| retrieved / found | Memory returned a candidate under a complete query result | Index presence, partial retrieval, or caller/model assertion |
| authorized | Core/approved policy boundary permits this exact subject, purpose, scope, and content/version | Caller-provided `allow`, candidate metadata, or fixture callback |
| admitted | NPC helper accepted a reference projection only when metadata is complete, current, authorized, and positively supported | Retrieval alone; disputed, insufficient, or unassessed evidence |
| included in context | Content was actually inserted into a particular generation's context | Admission/reference alone |
| dispatched / delivered | The actual Host path starts and completes the target-bound dispatch under its owner-defined evidence contract | Context inclusion, adapter invocation, or a generated claim |
| received | An explicit supported receipt/observation event establishes that the subject or intended channel received it | Retrieval, admission, context inclusion, or unconfirmed rendering |
| acquired / assimilated | Core-owned policy records that the subject acquired a proposition from supported evidence | Receipt alone, repeated context inclusion, or a generated NPC statement |
| believed / accepted as true | A separate subject-relative belief transition was justified and recorded under Core policy | Acquisition, source authority, or canonical truth alone |

No NPC-side test or helper should mutate, synthesize, or infer the later states. A successful admission test establishes only that the supplied fixture metadata passed the local predicate.

### NPC knowledge transitions — isolated reducer candidate, not a production contract

The following distinctions are normative behavior targets. PR #695 adds an NPC-local pure reducer candidate at `src/npc/epistemic-state.js` with focused tests at `tests/npc-epistemic-state.test.js`: receipt, evidence admission, explicit belief update, invalidation requiring review, forgetting with history, and canonical-truth changes that do not silently revise a subject's belief. These tests establish deterministic behavior for caller-supplied events only. They do not authenticate event authority, implement durable NPC state, prove a real host delivery/receipt, or authorize acquisition. The reducer does not implement exposure/observation/context inclusion/delivery and does not define a shared schema, persistence model, or cross-block event API.

| Transition / state | Minimum evidence to justify it | Must not be inferred from | Required NPC interpretation |
|---|---|---|---|
| Exposure / availability | A supported source/host event establishes that information was available in the character's environment or eligible context | Retrieval, a database/index row, prompt inclusion, or a model-generated assertion alone | Exposure does not prove perception, attention, understanding, receipt, acquisition, or belief |
| Observed information | A supported observation/input event tied to the subject and context in which it was available | A world event merely occurring; an event existing in a log; a fact being canonical | The event may be observable, but this alone does not prove the subject noticed or understood it |
| Received information | A supported host/source outcome establishes that information reached the subject or its intended channel | Retrieval, admission, prompt inclusion, generation, or an unconfirmed render | Receipt is evidence of exposure only; do not automatically create knowledge or belief |
| Acquired knowledge | A separately justified subject-relative acquisition event, with source/proposition evidence under an owner-approved policy | Receipt alone, repeated context inclusion, a generated NPC statement, or a source being authorized | Record only what the subject could plausibly acquire through that path; retain source/provenance separately from stance |
| Believed proposition | A distinct subject-relative stance transition supported by the configured evidence/reasoning policy | Acquisition, canonical truth, source authority, or confidence in the source alone | A subject may know a claim was made without believing it; belief strength never grants access or makes a claim canonical |
| Doubt | Evidence or reasoning causes the subject to suspend or reduce confidence in a proposition | Missing retrieval results, access denial, stale index state, or absence of evidence by itself | Doubt is not proof of falsity and must not erase the underlying claim or its provenance |
| Contradiction | Two independently supported, already acquired propositions or evidence items are incompatible | A candidate marked `disputed` / `insufficient`, incomplete lineage, duplicate identity, or unsupported model assertion | Reject disputed/insufficient candidates before context admission; if separately supported evidence later conflicts, preserve that conflict for Core-owned subject-relative evaluation without silently picking a winner or rewriting world truth |
| Forgetting / reduced recall | An explicit, policy-supported subject-relative change in accessibility or recall | Source deletion, authorization revocation, index loss, context truncation, or non-retrieval | Reduced recall does not mean the proposition was false, never acquired, or safely deletable from canonical history |
| Belief revision | A justified transition from a prior stance to a new stance, linked to the evidence/reasoning that changed it where supported | Latest-source replacement, an unversioned summary, a changed snapshot marker, or an ungrounded generated rationale | Preserve the distinction between historical stance, current stance, and canonical world state; do not invent persistence/history guarantees |

Cross-cutting rules:
- Source authority answers whether evidence may be used or disclosed; it does not determine whether a character believes the proposition.
- Proposition truth, source credibility, acquisition, belief, confidence, recall, and externally expressed behavior are separate dimensions.
- Internal state does not automatically determine outward speech or action. An NPC may conceal, misstate, or decline to disclose a belief; observed dialogue is not proof of the internal state.
- One transition does not imply the next. In particular: retrieved ≠ admitted ≠ included in context ≠ dispatched/delivered ≠ received ≠ acquired/assimilated ≠ believed; observed ≠ received; doubt ≠ disproof; forgetting ≠ falsity; contradiction ≠ resolution; revision ≠ canonical world change.
- If authoritative evidence or an approved owner policy is absent, mark the transition **unconfirmed / unsupported** rather than fabricating a runtime event or state.

**Verification status:** SPECIFICATION ONLY / NOT EXECUTABLE as a transition system. Current executable tests cover the pure admission oracle and explicitly assert that admission does not imply delivery, receipt, acquisition, or belief. Real transition tests require approved owner contracts and supported event evidence; this section creates neither.

### Required real Core-authorized result evidence before production use

Core + trusted host/source adapter must provide evidence for all applicable items below, with stable semantics and owner approval:

1. **Provenance and binding:** an unforgeable/owner-trusted indication that this result was produced by the approved Core authorized-read path, bound to the actual world/session, requesting actor, subject/recipient, purpose, and generation/context request. Caller labels or fixture booleans are insufficient.
2. **Authorization:** the effective policy decision for the exact recipient, purpose, record/version, and every source in a derived summary; denied, withheld, ambiguous, or missing decisions fail closed.
3. **Identity/version/lineage:** stable record identity and authoritative source version; complete, non-sparse, versioned lineage for derived summaries; collision-safe identity semantics.
4. **Snapshot/freshness:** trusted snapshot provenance and currentness; a snapshot marker alone is not a durable edit/delete/swipe/rollback journal.
5. **Inventory/completeness:** authoritative evidence that the result is complete for its scope, distinct from partial/unavailable/rebuilding/denied and distinct from authorized complete-empty.
6. **Lifecycle/revocation:** authoritative deletion, edit, swipe, cancellation, rollback, retraction and reconciliation state; dependent indexes/summaries must be invalidated or re-authorized.
7. **Disclosure-time check:** a Core/Memory/host-defined consistency guarantee that closes or explicitly blocks revocation between final authorization and content serialization/rendering. Sequential fixture callbacks do not prove the final-check/output race is closed.
8. **Host outcome evidence:** actual host-owned signals for rendered/delivered/received, plus Core-owned policies and idempotent persistence boundaries for acquisition and belief. These are separate follow-on gates, not part of admission.

Until these inputs and the end-to-end tests against the real approved adapter exist, the current helper remains NPC-only test code. **Production Memory retrieval / Memory→NPC remains disabled.**


## Follow-up: Core/Memory/Host contract gate and collision-safe NPC oracle — 24 Oct 2026

### Existing entry point and hard limit

`evaluateMemoryCandidateAdmission(request, result)` remains the only existing NPC-owned pure decision point. It is **not** a production Core-result receiver and the current repo does not define an approved versioned Core→Memory→NPC result contract. Do not invent a `contract_version` field, a new inventory protocol, or a fake adapter just to make the NPC predicate appear complete.

Therefore the NPC oracle can validate only the proposal-shaped fields already used by its tests. It cannot honestly verify a contract version, authenticate Core provenance, prove complete source inventory, or distinguish a trusted snapshot from a caller-supplied imitation. These are production blockers, not optional defaults. Production wiring must remain absent/disabled until Core and Provider owners approve and implement the actual contract.

### Additional NPC-only hardening

- Summary lineage now checks every numeric array slot explicitly; sparse arrays fail closed rather than bypassing `Array.prototype.every()`.
- Candidate identity tuples are encoded as a JSON pair, avoiding delimiter-based pair collisions.
- If a result repeats the same `record.ref + record.version` pair, all occurrences are excluded. The approved contract does not currently supply a canonical immutable payload digest that lets NPC prove repeated answers are identical; first-wins deduplication would be unsafe.
- Summary lineage also rejects repeated `source.ref + source.version` pairs. Without an approved immutable payload digest, the NPC helper cannot establish that repeated source identities describe the same immutable content. This is a pure metadata guard, not source-authority proof.
- Re-evaluation of the same supplied result is tested for deterministic output and no mutation / lifecycle side effects.
- Exclusion output remains content-free and does not reveal denied IDs, snippets, rejection reasons, or rejection counts.

These are pure NPC helper/unit-test guarantees only. They do not establish that the supplied identity, version, lineage, snapshot, freshness, or access claims are authoritative.

### Owner-contract reconciliation

- **Core #140:** no approved universal Memory source identity/version contract or durable source-change feed; `world_revision + commit_sequence` is a snapshot freshness marker, not a source-specific journal. Rollback can invalidate data without a higher commit sequence. Core must approve source-type-specific version/validity proof, result-contract versioning, and authorized-read binding.
- **Host/Adapter #258:** the observed SillyTavern 1.19.0-1-g06bde939f event samples establish event presence/shapes only. Array indices and swipe IDs remain host-local; no production capture/persistence mapping, stable source version, or complete restart/replay inventory is proven. Host + Provider must establish the real lifecycle-to-persisted-source mapping before any result can be considered production input.
- **Memory Provider #181:** a real Provider vertical slice and durable inventory/reconciliation/access contract are still required. SQLite/provider tests and injected `validateSourceVersion` / `validateInventory` callbacks are not production authority. Provider must supply authoritative record version/lineage, index health, reconciliation status and complete inventory evidence, or mark the result non-ready.

### Required result distinctions and fail-closed behavior

- **Non-ready:** contract/version unknown or unsupported; provenance not trusted; snapshot absent/stale/unverifiable; inventory incomplete/unknown/rebuilding; lineage incomplete/sparse; source identity/version missing or conflicting; freshness unknown; source retracted/revoked; authorization unavailable. No candidate content or counts escape.
- **Authorized complete-empty:** only possible after an approved real contract proves authorized scope plus complete inventory and current snapshot. The current helper's `completeness: "complete"` fixture field is not that proof.
- **Ordinary access denial/withheld:** must remain distinct from complete-empty. Current helper maps request-level unconfirmed/denied access to a generic `non_ready` decision to avoid disclosing which condition occurred; it does not expose a separate public denial diagnostic. If Core requires a typed outward denial, Core must define its safe public semantics first.
- **Retrieval/admission/context inclusion:** are not render, delivery, receipt, acquisition, or belief. The NPC oracle returns references only and creates none of those downstream facts.
- **Repeated answers and races:** repeated same identity/version within one candidate set is excluded; repeated invocation is deterministic. The helper cannot detect a source change/rollback that leaves the supplied snapshot marker unchanged, and cannot close the last authorization-check→serialization race. Those require authoritative Core/Provider/Host contracts and real-path tests.

### Production gate remains closed

Do not call the pure oracle from production with arbitrary Provider/model/caller data. Required real path remains: pinned Host capture with durable identity → Provider persistence and complete reconciliation → Core-authorized result with approved contract version, trusted provenance, per-source version/lineage and complete inventory → NPC admission → owner-defined disclosure-time boundary → actual host serialization evidence. Repeat after restart and exercise edit, swipe, delete, cancel, rollback, revocation-after-check and duplicate/conflicting responses.

No Core, Memory Provider, Host/Adapter, Personality or Relationships files were changed by this NPC work.

## 8. Execution order for the NPC-owned integration work

This section turns the existing acceptance contract into work that can be completed independently of an unapproved Memory runtime. It does not authorize a new API, storage, Core runtime change, or production Memory read.

### Work package NPC-1 — Freeze the consumer input/output contract

**Owner:** NPC. **Can proceed now.**

- Treat `memory-candidate-eligibility.js` as a metadata-only admission oracle, not as a content reader or authorization service.
- Keep the caller's trusted scope separate from candidate metadata: world, subject/actor, purpose, and snapshot marker must come from an approved trusted boundary.
- Keep the output limited to safe reference projections and a generic non-ready result. No raw Memory payload, candidate rejection reasons/counts, or fallback to a raw snapshot.
- Keep retrieval eligibility, authorized content projection, prompt inclusion, delivery, acquisition, and belief as distinct stages.

**Exit evidence:** the consumer contract and field vocabulary are agreed by NPC/Core/Memory owners; any field not backed by an owner-approved source is explicitly marked unavailable rather than inferred.

### Work package NPC-2 — Map initial knowledge to actor-relative context

**Owner:** NPC defines semantics; Core owns authoritative records and filtering. **Contract work can proceed; runtime work is gated.**

- Support only the already-defined first-slice kinds: `author_initial` and `imported`.
- Require explicit subject assignment and provenance; canonical world truth, a retrieval hit, a context manifest, or prompt inclusion does not imply that an actor acquired knowledge.
- Preserve `known`, `known_absent`, `unknown`, `withheld`, `incomplete`, and `unsupported` as distinct outcomes.
- Exclude author-reserved content before model-bound serialization. Never treat missing authorization or incomplete source evidence as a negative fact.

**Exit evidence:** each consumer-facing field has a documented owner, source of authority, failure behavior, and mapping to the first-slice acquisition contract in `docs/50-npc-initial-knowledge-acquisition-contract.md`.

### Work package NPC-3 — Resolve the trusted boundary handoff

**Owners:** Core + Memory, with NPC review. **Blocked on owner decisions.**

Before connecting a real Memory result to the NPC consumer, the owners must identify and approve:
1. the trusted requester/actor binding and bounded purpose;
2. the actual content-disclosure authorization boundary;
3. source identity/version and summary-lineage authority;
4. retrieval completeness and index health versus source freshness;
5. rollback-aware source invalidation and recoverable reconciliation;
6. the exact safe envelope delivered to the NPC consumer.

The NPC side must not invent a replacement permission system, acquisition store, revision cursor, source-change feed, or API to bypass these decisions.

**Exit evidence:** a recorded owner decision maps each required semantic field to an existing approved contract or explicitly approves the smallest new contract. “A helper accepts the shape” is not sufficient evidence.

### Work package NPC-4 — Connect only after the contract gate

**Owners:** Core/Memory implement their approved boundary; NPC integrates as consumer. **Not authorized by this document.**

The first connected path must read only the approved actor-specific initial-knowledge slice. It must not enable general Memory retrieval, delivery/receipt, persistent belief, autonomous scheduling, or off-screen execution by implication. Any unsupported stage remains disabled/fail-closed.

**Exit evidence:** the real production path demonstrates authorized disclosure and safe serialization at the boundary, with exact commit/Actions evidence. Pure-helper tests alone do not satisfy this gate.

### Current work boundary

The permitted NPC-side work while the owner decision is pending is contract alignment, field/ownership mapping, and acceptance criteria. Do not substitute additional fixture tests for missing integration work, and do not implement the blocked runtime path without separate approval. The next useful deliverable is the completed NPC-1/NPC-2 mapping; the next runtime dependency is the Core/Memory decision in NPC-3.


## P0.1 exact base/head and changed-file reconciliation — 2026-10-29

The rows below record GitHub PR metadata inspected for the NPC scope audit. The branch names/SHAs are historical snapshots; the current PR head and exact-head CI are authoritative for review. This table complements the blob comparison above; it does not replace it.

| PR | Base SHA → head SHA | Changed-file scope / disposition |
|---|---|---|
| [#138](https://github.com/necromorphic/Logic-Engine/pull/138) | `fa534a49f556a0d03b24a972e6fa0d0d35ddb991` → `2d571b6c0d4d4ba89229e207ae50d7125d92d3c5` | 10 files: intended NPC eligibility test plus nine `docs/personality/*` paths; closed, unmerged; superseded by #157. Existing blob comparison above identifies eight identical files and one stale rollback. |
| [#139](https://github.com/necromorphic/Logic-Engine/pull/139) | `fa534a49f556a0d03b24a972e6fa0d0d35ddb991` → `c12a3f9b12ef7e2a2f37ee24ec47f77a9f652d48` | 10 files: intended NPC matrix plus nine `docs/personality/*` paths; closed, unmerged; superseded by #159. Existing blob comparison above identifies eight identical files and one stale rollback. |
| [#246](https://github.com/necromorphic/Logic-Engine/pull/246) | `f748603d9b96808406095449f650399207d1e944` → `22b85a803e968b28f9016f532aae6494dc3c8cae` | Two NPC-owned files: admission helper and tests; closed, unmerged; superseded by #279. |
| [#279](https://github.com/necromorphic/Logic-Engine/pull/279) | `1dc0b8715801887e7a5343b6de0e7f73faee66cf` → `30e54290602e9b59eddb83e4b766a78961fd1197` | Two NPC-owned files: admission helper and tests; merged 2026-10-25. |
| [#157](https://github.com/necromorphic/Logic-Engine/pull/157) | `3f0b0077019fd6eefc46c06bd45036fd23aeb52d` → `d5d4421823007d2d46e0002c7d037306aa30b64e` | One NPC-owned test file; merged. |
| [#159](https://github.com/necromorphic/Logic-Engine/pull/159) | `3631bc9853c0f14f0788cbae1d0de698d41f4b3f` → `61d2cf3b2db034ee4361d4915bc444970abce1f2` | One NPC-owned matrix document; merged. |
| [#695](https://github.com/necromorphic/Logic-Engine/pull/695) | `af750f80f617e7ad944e4418c1cba8e345a23d1f` → `55a39406139a89183cb2dea2f30886164748b97b` (head at this recorded revision) | Four files: `.github/workflows/runtime-tests.yml`, `docs/56-npc-memory-boundary-acceptance-matrix.md`, `src/npc/epistemic-state.js`, `tests/npc-epistemic-state.test.js`. Open draft; no sibling-owned runtime source changes. Exact-head CI run [#40859655788](https://github.com/necromorphic/Logic-Engine/actions/runs/40859655788) passed all three jobs on attempt 2. |

For #695, the main base is pinned to `af750f80f617e7ad944e4418c1cba8e345a23d1f`; the PR has not been merged. This is an isolated review path, not a claim that NPC-to-Memory production integration is complete. No unrelated PR was merged or closed as part of this work.

## Current-main call-site verification — real Memory→NPC egress, 29 Oct 2026

Source-inspected current `main` at baseline `af750f80f617e7ad944e4418c1cba8e345a23d1f`; this is code inspection, not an end-to-end runtime test:

| File / inspected blob | Observation | Evidence class and consequence |
|---|---|---|
| `src/index.js` — blob `b2af64f4c4d98cb766ec6be558586bd8e5b1abe5` | Runtime startup constructs `SQLiteStore`, `LogicEngine`, `createApiServer`, and a deny-only `HostVersionDigestLedger` whose inventory verifier returns `false`. It does not import or instantiate `SQLiteMemoryProvider` or `MemoryNpcConsumer`. | Source-inspected. No production Memory→NPC consumer is wired from startup; Host version-ledger readiness remains fail-closed. |
| `src/api/server.js` — blob `b1b1121d61202d9cf4fc0da7fe47b7e77d82e544` | It constructs `AuthorizedReadService`, but contains no `MemoryNpcConsumer` import, call to `retrieveForNpc`, or Memory→NPC route. | Source-inspected. Authorized-read API presence does not establish NPC consumer invocation or model-bound disclosure. |
| `src/application/memory-npc-consumer.js` — blob `74e726d45a1db41a8018dd3f3c3528d60c3880bf` | The injectable consumer seam exposes `retrieveForNpc()` and `revalidateForFinalDispatch()`. Its own contract says it is not wired into the public API. Revalidation narrows freshness risk but explicitly requires Host to serialize it with durable `DISPATCH_STARTED` and the sole outbound Gateway path. | Source-inspected seam only. No atomic revocation/dispatch guarantee or final model-egress proof. |

**Exact closure test still missing:** on the actual pinned Host receiver → Core/Provider read → NPC consumer → serializer → sole Gateway/transport path, revoke or roll back the pinned source before dispatch-start and assert zero upstream calls; if dispatch-start wins, assert exactly one in-flight request and no replay. Repeat across restart/reconciliation and stale Provider-token cases. Until this runs on the integrated current-main implementation, P0.4 remains **BLOCKED**, and Memory→NPC remains **DISABLED / FAIL-CLOSED**.


## Cross-block decision refresh — Core acquisition pinning, 29 Oct 2026

Core's delegated decision in [issue #140 comment 6488390384](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6488390384) selects **version-pinned acquisition semantics**: an NPC must not follow a replacement value for the same fact identity after rollback/reprojection without a new explicit acquisition event. This is a recorded policy decision, not an unresolved policy choice.

## 12. Сквозное ТЗ NPC: аудит реализации и готовности — 30.10.2026

**Статус блока: NOT ACCEPTED. Production Memory→NPC: DISABLED / FAIL-CLOSED.**  
Этот раздел фиксирует исполнение требований R1–R5 и NPC-E2E-01..12. PASS у локального компонента или теста не означает PASS сквозного сценария.

### 12.1 Решение по минимальному контракту

Для дальнейшей реализации принят следующий минимальный контракт, без создания нового публичного API:

1. Реальный Host/NPC runtime получает доверенные `world_id`, `adapter_id`, `actor_entity_id` и согласованный snapshot только из существующего trusted binding.
2. Runtime вызывает существующий `MemoryNpcConsumer.retrieveForNpc()`; произвольные model/caller labels не являются полномочиями.
3. Consumer проверяет Provider readiness/access и Core-authorized canonical source. Core mainline #709 выдаёт per-entity source-version token и полную snapshot-pinned inventory для прямых `canonical_entity` источников. Отдельный current-main implementation candidate [PR #721](https://github.com/necromorphic/Logic-Engine/pull/721) добавляет Core-owned subject-relative acquisition reader и immutable acquisition-time value/source-event pin по уже принятому version-pinned решению #140. Это ещё Draft, не merged и не production-wired. Текущий кандидат уже переносит `adapter_id` и `recipient` через read, visibility, belief-transition и belief-state операции; однако это caller-supplied поля, а не аутентификация. Явного Host-session ID нет, deployment authorizers в `src/index.js` не конфигурируются.
4. NPC получает только разрешённую проекцию, сохраняющую исходный epistemic kind. Retrieval/admission/context inclusion не создают receipt, acquisition или belief.
5. NPC decision/runtime может сформировать изменение только как предложение существующему Core commit path. Canonical mutation и его атомарность принадлежат Core; NPC не пишет canonical state напрямую.
6. Ошибка, неполный ответ, неизвестная версия, потеря доверия, stale snapshot или конфликт дают fail-closed результат. Никакого fallback в полный/неограниченный контекст.
7. Финальная проверка непосредственно перед dispatch и сериализация должны быть связаны с единственным Host/Gateway egress. Повторная проверка consumer сама по себе не закрывает TOCTOU race.

Это рабочее направление интеграции, а не объявление новых интерфейсов существующими. Пункты 3, 4, 5 и 7 зависят от подтверждённых owner boundaries Core/Memory/Host. До их появления нельзя подменять отсутствующий runtime моками или локальным NPC store.

### 12.2 Требования R1–R5

| Требование | Статус | Что реально есть | Чего не хватает для PASS |
|---|---|---|---|
| R1. Сквозной цикл source → Provider → provenance/trust/version/admission → NPC → context → Core commit → retry/failure | **PARTIAL** | Реальный SQLite Provider + Core AuthorizedReadService + MemoryNpcConsumer integration tests; на main есть Core-owned per-entity source-version ledger и snapshot-pinned complete inventory (#709, migration 15); новый current-main Core reader/belief candidate #721 добавляет subject-scoped acquisition read и acquisition-time value/source-event pin, но остаётся Draft и не merged; отдельный pure NPC reducer | Core reader и acquisition pin представлены в Draft PR #721, включая A → rollback source → same fact_id becomes B → no NPC read until new grant regression. Кандидат дополнительно передаёт `adapter_id`/`recipient` через чтение, per-acquisition visibility, belief transition и belief-state read; idempotency hash учитывает эту область, а replay повторно авторизуется до ответа. Но поля всё ещё caller-supplied: нет явного Host-session ID и проверенного server-side binding; authorizers не конфигурируются приложением. Также нет production NPC runtime caller, model-context egress proof и NPC→Core world-commit cycle |
| R2. Initial acquisition + reconciliation | **PARTIAL** | Core-owned acquisition write events/projection существуют; Provider reconcile/revalidation и Core per-entity `core-entity-v1:<counter>` source-version + complete-inventory validation merged on main (#709); Draft PR #721 добавляет acquisition-time value/source-event pins и subject-relative reader | На main NPC пока не читает acquisition projection. Draft PR #721 добавляет миграции 16/17, acquired value/source-event pin и reader. На HEAD `471f72c` exact-head `npc-boundary` (158/158), `core-trusted-acquisition` (16/16), Provider `runtime-linux` (full Runtime 1202/1202 + oracle 20/20) и `provider-acceptance` (110/110) прошли; Windows full Runtime job остаётся in progress. Нет сквозного production NPC invalidation/reacquisition при revoke/trust loss/rollback. Host inventory остаётся NON_READY |
| R3. Разделение belief/inference/report/rumor/unknown | **PARTIAL** | NPC reducer хранит явный `epistemic_status` (`confirmed`, `unconfirmed_report`, `suspicion`, `inference`, `rumor`, `unknown`); только `confirmed` может поддержать `believes_true/false`; остальные статусы допускают только tentative stance/unresolved, а `unknown` не влияет на belief. Добавлены pure reducer regression tests | Caller-supplied status не аутентифицируется; нет production runtime policy/context path. Нельзя трактовать это как cross-block schema или Core source authority |
| R4. Реальная точка интеграции NPC runtime | **NOT IMPLEMENTED** | `MemoryNpcConsumer` — вызываемый in-process seam; pure reducer и autonomy helpers | В `src/index.js` и `src/api/server.js` нет production wiring Consumer/Provider; нет рабочего NPC decision caller, context serializer и финального Host dispatch callsite |
| R5. Safety/fault scenarios | **PARTIAL** | Component/integration tests покрывают ряд отказов Provider, Core authorization, version/snapshot, partial result, revocation и restart/rebuild отдельных проекций | Нет fault injection через один реальный NPC runtime цикл, особенно restart mid-processing, duplicate delivery, Core commit failure и final dispatch race |

### 12.3 NPC-E2E-01..12 acceptance ledger

Статус ниже относится к требуемому сквозному сценарию, а не к наличию похожего unit-теста.

| ID | Сценарий | Статус | Доказательство / точный недостающий участок |
|---|---|---|---|
| NPC-E2E-01 | Trusted source → admissible knowledge | **PARTIAL** | Provider/Core/Consumer integration доказывает admissible canonical-entity candidate при тестовых trusted seams; не доказывает acquisition read → runtime knowledge |
| NPC-E2E-02 | Untrusted source → no admission | **PARTIAL** | Admission fail-closed и Core/Provider denial покрыты раздельно; реальная source identity/trust chain до NPC runtime отсутствует |
| NPC-E2E-03 | Rumor remains rumor | **PARTIAL** | Pure reducer сохраняет `rumor` и отклоняет `believes_true/false` на rumor evidence; допускает только tentative stance. Production runtime/context scenario отсутствует |
| NPC-E2E-04 | New source updates without duplicates | **PARTIAL** | Provider/Core idempotency и projection rebuild покрывают отдельные уровни; нет доставки/reconciliation в NPC acquisition state |
| NPC-E2E-05 | Revoke source invalidates knowledge | **PARTIAL** | Provider/Core revalidation и invalidation primitives покрыты частично; нет NPC acquisition read/reconcile end-to-end |
| NPC-E2E-06 | Conflict preserved | **PARTIAL** | Pure reducer сохраняет conflicting evidence refs; нет production runtime/context use проверки |
| NPC-E2E-07 | Partial Provider response fails closed | **PARTIAL** | Consumer/Provider integration tests возвращают non-ready для incomplete/unavailable результата; не сквозной runtime |
| NPC-E2E-08 | Duplicate delivery is idempotent | **NOT TESTED** | Production delivery transport/correlation identity и NPC receiver отсутствуют |
| NPC-E2E-09 | Restart mid-processing causes no loss/duplicate | **NOT TESTED** | Есть отдельные Core/Provider replay/rebuild tests; нет restart теста единого NPC runtime processing |
| NPC-E2E-10 | Core commit failure leaves no partial canonical state | **NOT TESTED** | Нет NPC runtime commit caller и соответствующего fault-injection сценария |
| NPC-E2E-11 | Inaccessible knowledge is blocked | **PARTIAL** | AuthorizedReadService и consumer tests fail closed; нет фактического model-context/final-egress assertion |
| NPC-E2E-12 | Recovery is deterministic | **PARTIAL** | Core projection rebuild и pure reducer replay determinism тестируются отдельно; не проверена совместная recovery цепочка |

### 12.4 Точные границы кода и владельцы

| Узел | Текущая реализация | Фактическая граница |
|---|---|---|
| Provider query / reconcile | `src/application/sqlite-memory-provider.js` | Provider-owned storage/index/query. Не доказывает полноту Host inventory |
| Consumer | `src/application/memory-npc-consumer.js`: `retrieveForNpc()`, `revalidateForFinalDispatch()` | In-process consumer seam. Revalidation сужает TOCTOU, но не сериализует Host dispatch |
| Core source read | `src/application/authorized-read-service.js`, `src/application/canonical-entity-source-version.js` | Canonical entity field authorization/version. Не выдаёт Core acquisition records |
| Core acquisition write/projection | `src/application/engine.js`; `src/storage/sqlite-store.js` (`knowledge_acquisitions`) | Core-owned write + event projection/rebuild. Production NPC reader отсутствует на main |
| Core NPC reader/belief candidate | PR #721: `readNpcKnowledge()`, `prepareNpcBeliefContext()`, `recordNpcBeliefTransition()`, `getNpcBeliefState()` | Draft-only internal Core candidate. Adapter/recipient are propagated and checked by trusted callbacks, but no explicit Host-session identity or app authorizer configuration; not production-wired |
| NPC epistemic transitions | `src/npc/epistemic-state.js` | Pure/local reducer; сохраняет `epistemic_status` и fail-closed блокирует promotion report/suspicion/inference/rumor/unknown в confirmed belief. Caller-supplied events are not authenticated; no production persistence/runtime caller |
| NPC admission | `src/npc/memory-candidate-eligibility.js` | Pure metadata eligibility oracle; references only |
| Runtime wiring | `src/index.js`, `src/api/server.js` | No Provider/Consumer construction or NPC runtime invocation found |
| Host dispatch | Host prototype PR #595 / #720 and issue #258 | #595 is a frontend `generate_interceptor` seam, not final egress; #720 is delete-safety only. Pinned ST source inspection narrows one Chat Completions server route but does not prove all routes are gated or that Gateway is wired |

### 12.5 Safety cases that remain unproven as a single cycle

- Unknown/untrusted source, missing/stale version, revoked trust, and conflicts: local gates exist at Provider/Core/NPC boundaries, but the full trusted envelope has not traversed a production NPC runtime.
- Candidate partial Provider response: fail-closed behavior is covered in consumer/provider integration tests; no actual context serializer is exercised.
- Duplicate delivery and restart during processing: no production receiver/processing transaction exists to test idempotency or interruption recovery.
- Core commit failure: no NPC runtime commit call exists, so no claim about absence of partial canonical state is made.
- Inaccessible knowledge: authorized read is tested, but final model-context and Host egress are not wired.
- Recovery: Core and Provider rebuild/replay behavior is tested at their respective layers; joint NPC acquisition recovery is not implemented.

### 12.6 Implementation decision and ordered owner gates

No additional NPC persistence, scheduler, event bus, outbox, event log, cursor, canonical store, or transport was introduced. The reducer and admission helper remain NPC-local and side-effect-free. Reducer evidence now carries an explicit NPC-local `epistemic_status`; `rumor`, `unconfirmed_report`, `suspicion`, and `inference` cannot be used for `believes_true/false`, while `unknown` cannot support any belief. This is a local transition guard, not authentication or a mapping from Memory metadata.

The remaining work is blocked by these concrete owner contracts:

1. **Core:** independently review the current-main port [PR #721](https://github.com/necromorphic/Logic-Engine/pull/721). It reconciles #702 acquisition pins/history tests with #699 canonical-event projection/rebuild and privileged-effect forgery hardening, on top of migrations 14/15; adds migrations 16/17. It includes the exact acquire A → rollback source A → same fact_id reactivated as B → no NPC read until new acquisition regression. The latest candidate propagates `adapter_id` and `recipient` through `readNpcKnowledge`, per-acquisition visibility checks, belief transition writes/replays and belief-state reads; those values are included in the idempotency hash, and replay authorization occurs before idempotency-conflict disclosure. Remaining review gaps: these request values are still caller-supplied, no explicit Host-session identifier is present, and `src/index.js` does not configure trusted authorizers. Exact-head `npc-boundary`, `core-trusted-acquisition`, and Provider jobs pass; full Runtime `test` remains in progress on HEAD `c4dabb6`. Keep caller binding, snapshot, error and non-disclosure semantics Core-owned. No public endpoint or NPC SQL access.
2. **Memory Provider:** Provider lifecycle and direct canonical-entity source-token/inventory validation are now present on main (#686/#709). Do not duplicate these mechanisms. Remaining acceptance is to exercise the existing consumer against the eventual Core acquisition reader and prove revoke/version change/partial result/restart remain fail-closed on one real NPC path.
3. **Host/Adapter:** the prior current-main port #680 is closed unmerged and must not be treated as shipped. Main decision register #76 still records no production final-send boundary. Identify the actual NPC runtime invocation and context serialization/final-dispatch point on the pinned SillyTavern target. Prove the sole egress ordering: revocation before durable dispatch-start means zero upstream calls; dispatch-start first permits only the one in-flight call and no automatic replay.
4. **NPC:** after the above are approved and available, implement only the NPC-owned runtime adapter/context projection and E2E tests. Preserve epistemic kind and prevent rumor/report/inference promotion. No cross-block API edits.

Until all four gates and NPC-E2E-01..12 are green on exact HEAD, the module remains **NOT ACCEPTED** and production Memory→NPC remains **DISABLED / FAIL-CLOSED**.

### 12.7 Current-main integration evidence (30.10.2026)

- **Core source version:** PR #709 is merged. Main now has migration 15, durable per-entity `core-entity-v1:<counter>` tokens, token increments on canonical mutation/rollback, and snapshot-pinned paginated complete-entity inventory. This closes the direct canonical-entity source-version/inventory prerequisite for Provider reconciliation; it does **not** pin a `knowledge.acquire` event to the fact value/source version acquired by a subject.
- **Memory Provider:** the Provider lifecycle slice #686 is merged. Its acceptance does not create a Core acquisition reader or a production NPC consumer.
- **Acquisition semantics:** Core #140 already selected version-pinned semantics. This is not an open policy question. #702/#699 contain implementation candidates for the exact Core event/projection binding + internal reader, but their branches are stale and divergent. Current `main` still has no reader; its `knowledge_acquisitions` projection has no acquired fact/source-version pin.
- **Integrated Core candidates:** the previous #702/#699 branches were stale and divergent. Their reconciliation is now ported as [Draft PR #721](https://github.com/necromorphic/Logic-Engine/pull/721), based on current main. It retains #702 acquisition pinning/lifecycle tests and #699 canonical-event projection/rebuild/forgery hardening. Exact-head Runtime + Provider CI is pending; independent Core/security review and Host/session/recipient binding remain open. No production wiring is authorized.
- **Host:** current-main decision register #76 says there is no production final-send boundary. PR #680 is closed unmerged; its candidate CI is not evidence of a shipped Host runtime or sole-egress integration.
- **Current consequence:** R1/R2 remain PARTIAL; R4 remains NOT IMPLEMENTED; no NPC-E2E scenario is promoted to PASS solely because #686/#709 merged.

### 12.8 Current-main Core reader port

- [Draft PR #721](https://github.com/necromorphic/Logic-Engine/pull/721), exact head `c89dcdc8963c4b7bb27a9c8fdeb80fca8aaa126d`, is based on current main `efc02d2b290b2c08d6621fe9eb75570ae4486102` (ahead 20 / behind 0 at creation; 13 changed paths).
- It ports the Core reader, acquisition-time pin, canonical belief events/projection, migrations 16/17, and the A → rollback → same fact_id becomes B regression.
- Exact-head Runtime and Provider workflows were queued/in progress at this matrix update; no pass is claimed yet. It remains Draft and production-disabled.

### 12.9 Candidate reconciliation evidence

- [PR #702](https://github.com/necromorphic/Logic-Engine/pull/702), exact head `6fde427a0c7fa9977d12857a5ad1e47f79944f69`: Runtime run [#40865765274](https://github.com/necromorphic/Logic-Engine/actions/runs/40865765274) passed 1154/1154; Provider run [#40865765211](https://github.com/necromorphic/Logic-Engine/actions/runs/40865765211) passed. Branch is 38 commits behind current main and no longer mergeable as-is.
- [PR #699](https://github.com/necromorphic/Logic-Engine/pull/699), exact head `f25ecfcca80758105cec2b2eb17f68b496aef245`: Runtime run [#40863859487](https://github.com/necromorphic/Logic-Engine/actions/runs/40863859487) and Provider run [#40863859425](https://github.com/necromorphic/Logic-Engine/actions/runs/40863859425) passed. Branch is 15 commits behind current main and no longer mergeable as-is.
- The two candidates overlap in Core engine/storage/rules. They are not safe to merge independently. Required reconciliation: retain #702 acquisition pin/history tests and #699 canonical-event projection/rebuild/forgery hardening, preserve current main migrations 14/15, then revalidate NPC migrations 16/17 on one exact current-main head.

### 12.10 Verification provenance

The documentation-only update was first committed as `9edd2150b2e96ea593dd41bec81814d859db32fa`; exact-head Runtime run [#41011330232](https://github.com/necromorphic/Logic-Engine/actions/runs/41011330232) passed `test`, `npc-boundary`, and `core-trusted-acquisition`, and Provider run [#41011330296](https://github.com/necromorphic/Logic-Engine/actions/runs/41011330296) passed `runtime-linux` and `provider-acceptance`. The follow-up NPC-local epistemic-status guard and its tests are on exact HEAD `bf9386a326221c42f9ed94c4dd507e1ccd5c47fa`; Runtime run [#41011493752](https://github.com/necromorphic/Logic-Engine/actions/runs/41011493752) passed `test`, `npc-boundary`, and `core-trusted-acquisition`, and Provider run [#41011493683](https://github.com/necromorphic/Logic-Engine/actions/runs/41011493683) passed `runtime-linux` and `provider-acceptance`. These runs validate the local reducer change and existing component tests only; they do not close the production runtime or cross-block E2E gates. The branch was synchronized with `main` by merge commit `b34580373d5c0edec245654cd8b50ac3b89c202a`. Exact merge-head Runtime run [#41011777115](https://github.com/necromorphic/Logic-Engine/actions/runs/41011777115) passed `test`, `npc-boundary`, and `core-trusted-acquisition`; Provider run [#41011777099](https://github.com/necromorphic/Logic-Engine/actions/runs/41011777099) passed `runtime-linux` and `provider-acceptance`. A later NPC documentation/epistemic guard head `6b8e3a9bff4966882a8e3431e4d0f44ce7bd3ddd` passed exact-head Runtime run [#41011877893](https://github.com/necromorphic/Logic-Engine/actions/runs/41011877893) (`test`, `npc-boundary`, `core-trusted-acquisition`) and Provider run [#41011877898](https://github.com/necromorphic/Logic-Engine/actions/runs/41011877898) (`runtime-linux`, `provider-acceptance`). Those checks validate the NPC candidate/component boundary only, not production NPC runtime or cross-block E2E acceptance.


### 12.11 Current integration continuation — Core recipient scope and pinned Host callsite (30.10.2026)

#### Core candidate update — PR #721

Current Core candidate HEAD: `471f72c186ed32c81bba5fd7680f4bf7c46b6611` (Draft, not merged). Changes on this continuation:

- `readNpcKnowledge()` now returns the validated `adapter_id` and `recipient` alongside world/actor/purpose/snapshot, so downstream Core visibility checks can use the same recipient scope.
- `prepareNpcBeliefContext()` and `getNpcBeliefState()` pass adapter/recipient to the per-acquisition visibility authorizer and require the returned decision to match them.
- `recordNpcBeliefTransition()` accepts and validates adapter/recipient, includes them in the idempotency hash, and carries them into both initial and replay authorization reads. Replay now performs current read authorization before returning an idempotency-key conflict/acknowledgement.
- Added a regression in `tests/npc-belief-state-snapshot-race.test.js`: after a successful belief transition, revoke read authorization and retry the same idempotency key with a different proposal; the replay is denied before the idempotency conflict is disclosed and the projection remains unchanged.
- Race and integration fixtures were updated in `tests/npc-knowledge-read.test.js`, `tests/npc-knowledge-snapshot-race.test.js`, and `tests/npc-belief-state-snapshot-race.test.js` to use the same explicit adapter/recipient scope.

**Exact-head CI evidence for HEAD `471f72c`:** Runtime [#41018450166](https://github.com/necromorphic/Logic-Engine/actions/runs/41018450166) has `npc-boundary` PASS (158/158) and `core-trusted-acquisition` PASS (16/16); the Windows full `test` job remains in progress and is not counted as a result. Provider [#41018450045](https://github.com/necromorphic/Logic-Engine/actions/runs/41018450045) has `runtime-linux` PASS (full Runtime 1202/1202 and recalculation oracle 20/20) and `provider-acceptance` PASS (110/110).

These changes close a request-scope propagation defect in the Core candidate; they do **not** authenticate the caller. `adapter_id` and `recipient` remain request values. The deployment-owned authorizer must bind them to authenticated server-side Host/session state. No explicit Host-session ID is present, `src/index.js` still does not configure the authorizers, and the candidate is not production-wired.

#### Pinned SillyTavern source audit — generation and transport boundaries

Source inspected in the supplied SillyTavern 1.19.0 archive; the exact target commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` was previously verified in the Host issue. This is source inspection, not browser/runtime evidence.

| Source location | Observed boundary | Consequence |
|---|---|---|
| `public/script.js:4299` | `Generate()` emits `GENERATION_STARTED` before prompt assembly | Operation-start event only; not final prompt or transport authority |
| `public/script.js:5234` | `GENERATE_BEFORE_COMBINE_PROMPTS` receives mutable prompt data before the normal combiner | Candidate for transient context preparation, but not final request-body or egress authorization |
| `public/script.js:5243` and `:5318` | `GENERATE_AFTER_COMBINE_PROMPTS` and `GENERATE_AFTER_DATA` run after prompt/data preparation | Later browser hooks, still before actual provider send; do not close revocation/dispatch race |
| `public/scripts/openai.js:3138-3155` | `sendOpenAIRequest()` builds `generate_data`, emits `CHAT_COMPLETION_SETTINGS_READY`, then serializes it and POSTs to `/api/backends/chat-completions/generate` | This is one Chat Completions browser path; browser extension metadata is not trusted authentication |
| `src/endpoints/backends/chat-completions.js:2242` | Server `POST /generate` selects the provider handler and performs upstream dispatch | Narrowest identified server-side candidate for the selected Chat Completions route, immediately before provider dispatch; not proof that all ST send routes use it |
| `public/scripts/st-context.js:115-160` | `getContext()` exposes character/group/chat IDs, event source/types and generation functions, but no explicit authenticated Host-session ID | `chatId` is a conversation locator, not authentication; trusted world/actor binding must be resolved server-side |

The frontend extension prototype [PR #595](https://github.com/necromorphic/Logic-Engine/pull/595) uses `generate_interceptor` to abort native generation when a protected request is armed, but its callback is not wired to Core/Provider/Gateway. It does not prove server-side sole egress. Host delete-safety PR #720 is a separate lifecycle operation and does not close NPC generation integration.

The current Core Memory Dispatch Gateway exists on main as a primitive, but it is not wired into the pinned ST server route. Before any protected context is sent, Host must resolve the authenticated adapter/conversation/world/actor binding server-side, prepare the NPC context, bind the exact serialized request body/model/stream/route to the authorized source/candidate set, and route the selected provider send through the Gateway's durable `DISPATCH_STARTED` boundary. Other provider/server/native/custom routes must be enumerated and remain unsupported for protected context until proven gated.

**Disposition:** the actual Chat Completions route is now source-located, but R4 remains NOT IMPLEMENTED and NPC-E2E-08/10/11 remain incomplete. No Host source or new cross-block API was changed in this continuation. Memory→NPC remains **DISABLED / FAIL-CLOSED**.


### 12.12 NPC-owned candidate exact-head verification — 30.10.2026

PR [#695](https://github.com/necromorphic/Logic-Engine/pull/695) HEAD: `293eaf1a733c7195a3e7eb503333835092ccb501` (Draft). Comparison against current `main` `8e6aa5f7b585a007f7acea57dff2ab52c229bb3b`: ahead 13 / behind 0; exactly eight changed paths. Two paths are shared Memory integration test fixtures/assertions required by the stricter NPC `supported` admission rule; no Memory production source was changed.

Exact-head Runtime [#41018053554](https://github.com/necromorphic/Logic-Engine/actions/runs/41018053554):
- full Runtime: 1172/1172 PASS;
- Host lifecycle prototype tests: 72/72 PASS;
- recalculation oracle: 20/20 PASS;
- NPC boundary: 127/127 PASS;
- Core trusted acquisition: 15/15 PASS.

Exact-head Provider [#41018053531](https://github.com/necromorphic/Logic-Engine/actions/runs/41018053531):
- full Linux Runtime: 1172/1172 PASS;
- recalculation oracle: 20/20 PASS;
- Provider acceptance: 111/111 PASS.

This validates the isolated admission/reducer candidate and existing component/integration tests. It does not prove the Core reader candidate is merged, Host-session binding, a production NPC decision caller, actual model-context serialization, delivery/receipt/acquisition in the live path, or sole-egress revocation ordering. PR #695 remains Draft; block acceptance remains **NOT ACCEPTED** and Memory→NPC remains **DISABLED / FAIL-CLOSED**.


### 12.12 Current continuation — Core reader security review and CI portability (30.10.2026)

#### Current Core candidate

- Current main: 20c4ab122e44982eb7fae80062c449bfd9f7931d.
- Core candidate: [Draft PR #721](https://github.com/necromorphic/Logic-Engine/pull/721), current review head 4c8df1118e518146fec2940ed1305912edebbbf9; comparison to current main: ahead 46 / behind 0. It remains a separate Core-owned draft; no Core implementation was copied into this NPC PR.
- The candidate includes actor-scoped Core acquisition reads, acquisition-time value/source-event pins, A → rollback → same fact ID becomes B rejection until explicit reacquisition, canonical-event-backed belief transition projection/rebuild, and adapter/recipient scope propagation through read, visibility and idempotent replay.
- Version-pinned acquisition semantics are already selected by Core #140. This is implementation review, not a new policy decision.

#### Security review correction in #721

The first review of src/application/npc-belief-state.js found that its documentation claimed proxy-backed model inputs were rejected, but its original plain-object and stable-JSON validation did not check utilTypes.isProxy. Accessor-backed top-level objects were also not rejected before ordinary property reads.

The Core candidate now:
- rejects proxies before prototype, key, descriptor or value access;
- accepts only plain data objects and dense standard data arrays at reducer/context boundaries;
- avoids array iteration methods on untrusted arrays during stable JSON normalization;
- validates nested evidence values and reference arrays fail-closed;
- adds regression coverage for top-level/nested proxies, proxy arrays, and accessor-backed proposal/context values, asserting that traps/getters are not executed.

#### Exact-head verification and CI portability

The prior exact-head run on #721 HEAD 471f72c186ed32c81bba5fd7680f4bf7c46b6611 had:
- NPC boundary: PASS (158/158);
- Core trusted acquisition: PASS (16/16);
- Provider runtime: PASS (1202/1202 plus recalculation oracle 20/20);
- Provider acceptance: PASS (110/110);
- full Windows Runtime: FAIL (1198/1201).

The three full-suite failures were isolated from NPC tests:
1. coordinator-lock-participation.test.js: 4-second child-process marker timeout;
2. memory-provider-coordinator-lock.test.js: 4-second child-process marker timeout;
3. replay-benchmark.test.js: 120-second child-process timeout (spawnSync.status === null).

The latest #721 candidate extends the two process-startup waits to 15 seconds, the benchmark child/test budget to 300/310 seconds, and the full Windows Runtime job budget to 15 minutes. These are CI/test robustness changes; they do not change runtime semantics. Exact-head Runtime run [#41019981157](https://github.com/necromorphic/Logic-Engine/actions/runs/41019981157) on 4c8df111 has npc-boundary PASS and core-trusted-acquisition PASS; Provider run [#41019980836](https://github.com/necromorphic/Logic-Engine/actions/runs/41019980836) has runtime-linux PASS and provider-acceptance PASS. The exact-head Runtime run [#41019981157](https://github.com/necromorphic/Logic-Engine/actions/runs/41019981157) subsequently completed with test, npc-boundary, and core-trusted-acquisition all PASS. The exact-head Provider run [#41019980836](https://github.com/necromorphic/Logic-Engine/actions/runs/41019980836) completed with runtime-linux and provider-acceptance PASS. The Windows full test pass confirms the timeout-budget correction on Core HEAD 4c8df111; it does not close the private cross-process, Host session, Memory consumer, or final egress gates.

#### Remaining acceptance gaps

- The Core read and visibility authorizers remain unset in src/index.js; the application stays fail-closed.
- adapter_id and recipient are request values, not authentication. There is no explicit authenticated Host-session binding in the Core candidate.
- The Core reader currently covers canonical acquired facts; it does not yet provide an approved mapping from Memory epistemic classes (confirmed, unconfirmed_report, suspicion, inference, rumor, unknown) into the Core belief transition path. The NPC-local reducer's non-promotion guard is not wired to this Core candidate. R3 therefore remains PARTIAL; no claim is made that rumor/report/inference semantics are end-to-end enforced.
- No production NPC runtime caller/context serializer is wired. The pinned SillyTavern Chat Completions server route is source-located, but the Gateway is not installed there and other send routes remain unproven.
- No final Host/Core/Provider revoke-vs-DISPATCH_STARTED race is demonstrated.

Disposition remains NOT ACCEPTED. Production Memory → NPC remains DISABLED / FAIL-CLOSED. The Core candidate is not merged; no production route, prompt injection, or outbound dispatch was enabled.


### 12.13 NPC branch exact-head verification after main synchronization

- PR #695 HEAD: d7210758cc202c7486d29dad10f0139ede3ed18c.
- Current-main comparison: 17 ahead / 0 behind; exactly eight changed paths, all NPC/workflow/test-owned.
- Runtime [#41019771860](https://github.com/necromorphic/Logic-Engine/actions/runs/41019771860): test, npc-boundary and core-trusted-acquisition all PASS.
- Provider [#41019771863](https://github.com/necromorphic/Logic-Engine/actions/runs/41019771863): runtime-linux and provider-acceptance both PASS.
- This validates the NPC-local admission/reducer candidate and existing component integration tests. It does not validate the separate Core reader draft #721 or any production Host runtime path.

PR #695 remains Draft / NOT ACCEPTED. Memory → NPC remains DISABLED / FAIL-CLOSED.


### 12.14 NPC reducer security review correction — own event type validation

Codex identified a P2 issue on the prior NPC head: the reducer accessed event.type before verifying it was an own data property. A getter on Object.prototype could therefore run for a malformed event even though the reducer otherwise rejected proxies and accessor-backed inputs.

The NPC branch now:
- validates the event object as safe data first;
- obtains the own property descriptor for type and requires a data value before reading it;
- passes the validated event type into event-shape validation and dispatches using that local value;
- includes a regression test installing an inherited Object.prototype.type getter and an own accessor-backed type, proving neither getter executes.

Fix commit: f9d8ee4b3376c6e57ff7635757915f483189404c; regression test commit: bbe7489d543c8c195b76fc3416807b42c0645d8d. Exact-head Runtime and Provider workflows for the new NPC head were pending when this entry was written. The previous successful NPC exact-head CI remains historical evidence only.

The finding was addressed in code; independent re-review of the new head is requested. PR #695 remains Draft / NOT ACCEPTED; Memory → NPC remains DISABLED / FAIL-CLOSED.
