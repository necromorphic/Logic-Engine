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

- **Candidate projection:** stable record reference + record version, scoped to one trusted request/snapshot. This is already the helper's in-memory deduplication rule only.
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
| Duplicate candidate / repeated delivery | Deduplicate the same stable record reference + version for one admission; do not infer a second communication from a repeated result. Content still requires authorization. | Oracle writes nothing. A delivery retry must not duplicate a delivery/acquisition fact. | NPC helper for projection dedupe; Core/host owns durable delivery idempotency. Retry with an existing owner-approved idempotency identity only. | **Executable now:** duplicate ref/version admitted once. **Contract acceptance:** repeated host attempt does not create duplicate durable records. |
| Source from another world | Exclude from candidate projection; never place it in prompt. | No state change. | NPC oracle checks metadata; Core/Memory must establish authentic world binding. Retry only after correct scope is available. | **Executable now:** foreign candidate and foreign summary lineage source yield no admission. |
| Missing/denied/withheld/ambiguous access | No protected content, snippets, counts, identifiers, or per-item rejection diagnostics. Do not convert denial into a complete-empty result. | No receipt/acquisition/belief changes. | Core/Memory owns real authorization; fail closed. Retry only after an authoritative new decision, not by trusting caller/model labels. | **Executable now:** request-level failures return non-ready; candidate failures are excluded without per-item leakage. **Contract acceptance:** test non-disclosure at actual content boundary. |
| Retracted/deleted/unavailable source | Do not return or prompt the source or a derived summary that still depends on it unless approved lineage policy proves safe independent support/declassification. | Do not silently erase historical acquisition or rewrite belief; Core reconciles validity. | Core owns source validity and dependent records. Retry after authoritative reconciliation. | **Executable now:** stale/retracted/unavailable lifecycle/freshness labels exclude candidate. **Contract acceptance:** real retraction propagates to dependent summaries/knowledge. |
| Stale source or changed source version | Exclude when candidate snapshot/version is stale or inconsistent; do not silently substitute an unversioned “latest” source. | Oracle writes nothing. | Memory owns source identity/version semantics; Core owns snapshot/revision semantics. Retry with a fresh, consistent approved snapshot. | **Executable now:** stale freshness and mismatched snapshot excluded. **Owner gate:** prove source versions are authoritative in the real adapter. |
| Summary depends on multiple sources; access to one is revoked | Withhold the derived summary unless every source is currently authorized for this recipient or a specific owner-approved declassification rule applies. Producer provenance cannot substitute for source lineage. | No state change from filtering. Any persisted derived record is Core/Memory-owned and must be reconciled separately. | Memory owns lineage and access propagation; Core/security owner approves declassification semantics. Retry only after full lineage/access re-evaluation. | **Executable now:** incomplete lineage and a denied/stale/missing-scope lineage source exclude summary. **Contract acceptance:** revocation of one real source prevents derived text/snippet leakage. |
| Index stale/unavailable/rebuilding | Do not claim a complete empty result or expose stale candidates as current. Return the owner-approved unavailable/partial status without protected diagnostics. | No state change. | Memory owns index health/completeness. Retry after authoritative ready state; preserve distinction between empty and unavailable. | **Executable now:** unhealthy lifecycle labels exclude candidate; partial/unavailable result is non-ready. **Contract acceptance:** real index rebuild/failure status is propagated correctly. |
| Conflicting evidence | May return individually authorized, eligible candidates with their epistemic/evidence assessment intact; do not adjudicate truth merely during admission. Exclude any candidate failing safety checks. | No automatic belief change or canonical mutation. | NPC may preserve distinctions for later policy; Core owns canonical truth and persistent belief. Retry is not a conflict-resolution policy. | **Executable now:** conflicting eligible claims remain distinct; `disputed` / `insufficient` labels are preserved. |
| Empty search result | Only an authoritative, complete, authorized empty result may be represented as empty; it means no eligible result in that query, not “subject knows nothing.” | No acquisition, delivery, or belief change. | Memory owns completeness/access result semantics. Retry only if unavailable/partial or snapshot freshness requires it. | **Executable now:** complete authorized empty result is ready-empty; denied/withheld/scope-mismatched empty result is non-ready. |
| Retrieval succeeds but delivery fails | Retrieval/context preparation does not imply successful delivery. Do not mark the target informed or generate a confirmed receipt. | No acquisition/belief unless a separate supported path establishes them. Record attempt/failure only through existing approved owner path. | Core/host owns delivery. Retry may repeat the delivery attempt under an approved idempotency rule, not the underlying world event. | **Contract acceptance / owner gate:** current main has no identified production Memory→NPC delivery path or approved persistence boundary. |
| Delivery succeeds but receipt is unknown/ambiguous | Do not claim visible display, receipt, comprehension, acquisition, or belief. Host injection alone remains unconfirmed absent a verified signal. | No confirmed receipt/acquisition/belief. Preserve unknown/ambiguous state where the approved owner model supports it. | Host/Core must identify authoritative delivery evidence and retry semantics. Do not blindly retry in a way that duplicates an external effect. | **Contract acceptance / owner gate:** no verified host-rendering signal is established by current oracle tests. |
| Source retracted after acquisition | Future retrieval excludes invalid support. Existing acquired knowledge must be reconciled according to source dependency; it must not automatically disappear if another valid acquisition path remains. | Preserve audit history per Core policy; invalidate only consequences no longer supported. Do not automatically rewrite belief merely because canonical truth changed. | Core owns acquisition validity, source dependency and reconciliation. | **Contract acceptance / owner gate:** no production acquisition/reconciliation path is present in this work slice. |
| Canonical rollback changes validity without higher commit sequence | Do not treat unchanged `commit_sequence` as proof that the source remains valid; require an authoritative rollback/reconciliation result before exposing dependent content. | No NPC-owned rollback or parallel event store. Core reconciles affected canonical/knowledge state. | Core owns rollback and its validity/reconciliation contract. No polling loop, outbox, or cursor is introduced here. | **Contract acceptance / owner gate:** snapshot pair alone is not a durable source-change feed; real rollback signal is not approved/identified. |
| Retry after partial failure | Do not merge partial/unavailable into complete-empty. Do not leak which protected candidates were found. | No duplicate delivery/acquisition/belief on retry; persist only events actually evidenced through owner-approved paths. | Each owner defines idempotency at its own boundary; cross-store atomicity is not implied. | **Executable now:** partial/unavailable results are non-ready. **Contract acceptance:** fault injection across actual retrieval/delivery/persistence boundary. |

## 4. Lifecycle / ownership transition table

| Transition | Trigger and authority | Durable change | Idempotency / prompt consequence | Testability |
|---|---|---|---|---|
| Candidate → eligible reference projection | Pure oracle evaluates caller-supplied metadata; NPC helper owns only the projection | None | Stable ref/version dedupe; no content in result | Executable now |
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
- duplicate record/version projection;
- partial/unavailable versus complete-empty result;
- non-disclosure of rejected identifiers/reasons/counts;
- preservation of conflicting eligible evidence;
- no mutation of acquisition, delivery, belief, or canonical state.

The native repository test command is `npm test` (`node --test`). A successful run proves only the exact tested source/test revision. It does not prove production integration. For PR #138, exact-head Actions evidence is tracked in that PR; this document adds no claim that future contract-acceptance cases have run.

## 6. Owner decisions still required before production integration

**Core**
1. Trusted binding for the actual world, requester, recipient/subject, purpose, and actual generation/context used. A caller-supplied `generation_id` or manifest membership is not authentication.
2. Authoritative rollback/source-invalidation/reconciliation signal and consistency guarantee. `world_revision + commit_sequence` is a snapshot marker, not a durable source-change feed.
3. Final authorization/lifecycle check and its revocation/serialization guarantee.
4. Existing canonical persistence boundary and transaction/audit semantics for acquisition, delivery/receipt, and belief; identify actual host evidence for delivery.

**Memory**
5. Approved authorized-read contract, including complete-empty/results, partial, unavailable, denied/withheld, stale/reconciliation-pending, and invalid request outcomes, without existence/count/diagnostic leakage.
6. Authoritative source identity/version and versioned summary lineage; per-source authorization propagation and any explicit declassification policy.
7. Index health/completeness contract and how it is reflected in real retrieval results.

No new API, schema, permission enum, outbox, cursor, parallel store, or cross-store atomicity assumption is proposed by this document. Until owners approve the real boundaries and executable tests against them, the production consumer remains unapproved and fail-closed.


## 7. Preserved oracle verification evidence

The oracle implementation and original focused test file are already on `main` through PR #78. Their baseline blob identities were:

| Artifact | Baseline blob SHA |
| --- | --- |
| `src/npc/memory-candidate-eligibility.js` | `c3b540588d64b653d448d4af62c7f255e2d11245` |
| `tests/npc-memory-candidate-eligibility.test.js` before PR #138 | `08fd5785f72e7bca39d62aea6b7b8bcf8480a0fe` |

The baseline native Runtime run [#40061707222](https://github.com/necromorphic/Logic-Engine/actions/runs/40061707222) passed on commit `e06cb35b85a399238cea5ad0ac6dcb3043792b05`; it is evidence for that exact merged slice, not for the old superseded PR #76 head `e3e8fc43e2488227b74ded67434aed522c5ec484`, for which no workflow run was found. The separate evidence-note PR #135 was tested on its own exact head `bcb9e1345d17fe0370d005ffc59340c1ba700bfc` by Runtime run [#40068270957](https://github.com/necromorphic/Logic-Engine/actions/runs/40068270957), with the test job and `Run npm test` step successful.

PR #138 adds focused negative assertions and corrects the vacuous input-nonmutation test; its exact-head CI is recorded separately in that PR. These hashes/runs establish source and test provenance only. They do not authenticate caller-supplied metadata or establish Memory authorization, retrieval, delivery, receipt, acquisition, belief, or production integration.

## 8. Completion statement

NPC-owned design and current-helper test traceability can be reviewed independently. Issue #70 must remain open until this matrix is cross-reviewed and the owner-approved integration gates are resolved; no documentation-only result should be represented as production Memory→NPC completion.


## 9. Current-head lifecycle regression and evidence status (2026-10-24)

This section is an evidence ledger, not a claim that the real Memory→NPC runtime path exists.

| Boundary | Current executable evidence | Exact evidence | Status / limitation |
|---|---|---|---|
| Candidate metadata admission | Pure helper validates caller-supplied scope/access/status/identity/lineage fields and projects safe references | `src/npc/memory-candidate-eligibility.js`; baseline Runtime run [#40061707222](https://github.com/necromorphic/Logic-Engine/actions/runs/40061707222) on `e06cb35b85a399238cea5ad0ac6dcb3043792b05` | Tested oracle only. Metadata values are not authenticated by the helper. |
| Incomplete retrieval vs complete-empty | Tests reject partial, unavailable, rebuilding, unknown, malformed and unconfirmed-scope results; a complete authorized empty result is distinct | `tests/npc-memory-candidate-eligibility.test.js`; merged NPC-only PR #162 exact-head Runtime run [#40074004967](https://github.com/necromorphic/Logic-Engine/actions/runs/40074004967) | Caller-supplied completeness labels are not proof that a real index query was complete. |
| Candidate admission vs delivery/receipt/acquisition/belief | Draft regression injects lifecycle-shaped fields and asserts they are absent from the safe projection | Draft PR [#169](https://github.com/necromorphic/Logic-Engine/pull/169), head `9427b5506c3056d6c720646c5337d5eb1ac9f942`; exact-head Runtime run [#40076486053](https://github.com/necromorphic/Logic-Engine/actions/runs/40076486053) passed | Regression is green but PR is unmerged. It tests projection semantics only, not actual delivery or state transitions. |
| Authenticated authorization before content exposure | No approved general Memory authorized-read contract or configured production Memory policy established by this NPC helper | Core gate [#140](https://github.com/necromorphic/Logic-Engine/issues/140) | **BLOCKED — Core + Memory.** Need authorized-read denial/withheld and non-disclosure tests against the real read path. |
| Authoritative source identity/version and derived-summary lineage | Matrix and Memory handoff distinguish observed Core identifiers from missing universal source-version/lineage contracts | Memory gate [#142](https://github.com/necromorphic/Logic-Engine/issues/142); merged Memory evidence path [#161](https://github.com/necromorphic/Logic-Engine/pull/161) | **BLOCKED — Memory, with Core source-validity decisions.** Need stale/retracted/revoked-source and derived-summary lineage tests against real records. |
| Rollback/reconciliation | Existing snapshot tests show why revision/sequence markers alone are not a durable source-change feed; no approved cross-block feed is assumed here | Core gate [#140](https://github.com/necromorphic/Logic-Engine/issues/140); Core decision refresh [#154](https://github.com/necromorphic/Logic-Engine/pull/154) | **BLOCKED — Core + Memory.** Need a chosen owner-approved reconciliation operation and a rollback test where validity changes without a higher `commit_sequence`. |
| Actual host delivery and confirmed receipt | No verified host delivery/receipt boundary is implemented by the NPC admission helper | Host/runtime owner not yet assigned in the approved integration contract | **BLOCKED — Core/host owner.** Need host evidence for attempted delivery, confirmed receipt, retry and duplicate handling. |
| Acquisition and subject-relative belief persistence | NPC helper intentionally does not write acquisition or belief state | Core gate [#140](https://github.com/necromorphic/Logic-Engine/issues/140) | **BLOCKED — Core + NPC.** Need an approved canonical persistence path, idempotency semantics and tests distinguishing receipt from acquisition and belief. |

### Required interpretation

- `ready` means only that the supplied candidate/result fields pass this pure oracle's admission checks. It does not mean that the requester was authenticated, the underlying source was authoritatively read, the index was truly complete, or the content was delivered.
- `admitted` contains references and typed metadata, not record content. Content projection/serialization remains a separate authorization boundary.
- Context inclusion is not delivery. Delivery attempt is not confirmed receipt. Confirmed receipt is not acquisition. Acquisition is not belief.
- Source/index lifecycle is not authorization. A fresh snapshot marker does not by itself establish current source validity or detect every rollback/revocation.
- A missing runtime seam is **blocked/unverified**, not passed. Do not enable production Memory→NPC based on these oracle tests.

### Closure ownership

Core must identify the authorized-read, source-validity/reconciliation, and persistence/transaction boundaries using existing runtime seams where possible. Memory must define the real retrieval/index completeness and source-lineage behavior without inventing a provider API while that shape is under owner discussion. The host/runtime owner must identify authoritative delivery/receipt evidence. NPC owns interpretation and must not infer knowledge or belief solely from retrieval or prompt inclusion.

No new API, schema, store, outbox, cursor, permission enum, or cross-store atomicity guarantee is proposed by this evidence ledger.
