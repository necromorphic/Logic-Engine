# NPC ↔ Memory boundary acceptance matrix

Date: 2026-10-24  
Owner: NPC  
Status: design/test traceability; not a runtime API or production integration approval  
Related: Issue #70; Core owner decision recorded in PR #104; private adapter contract `docs/57-private-host-core-memory-npc-adapter-contract.md`; current oracle `src/npc/memory-candidate-eligibility.js`; tests `tests/npc-memory-candidate-eligibility.test.js`.

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
| authorized | Core/approved policy boundary permits this exact subject, purpose, scope, and content/version | Caller-provided `allow`, candidate metadata, or fixture callback |
| admitted | NPC helper accepted a reference projection for bounded context preparation | Delivery or any knowledge transition |
| included in context | Content was actually inserted into a particular generation's context | Admission/reference alone |
| rendered | Host UI rendered the output | Generation completion or adapter invocation |
| delivered | An owner-defined host signal establishes delivery to the intended target | Context inclusion or a generated claim |
| received | An explicit supported receipt/observation event exists | Rendered/delivered alone unless policy says so |
| acquired | Core-owned policy records that the subject acquired a proposition from supported evidence | Retrieval, prompt inclusion, delivery attempt, or receipt alone |
| believed | A separate subject-relative belief transition was justified and recorded under Core policy | Acquisition or canonical truth alone |

No NPC-side test or helper should mutate, synthesize, or infer the later states. A successful admission test establishes only that the supplied fixture metadata passed the local predicate.

### NPC knowledge transitions — specification only, not a runtime contract

The following distinctions are normative behavior targets for future NPC-owned implementation and acceptance tests. They do **not** define a shared schema, persistence model, event API, or a claim that the current repository implements these transitions.

| Transition / state | Minimum evidence to justify it | Must not be inferred from | Required NPC interpretation |
|---|---|---|---|
| Exposure / availability | A supported source/host event establishes that information was available in the character's environment or eligible context | Retrieval, a database/index row, prompt inclusion, or a model-generated assertion alone | Exposure does not prove perception, attention, understanding, receipt, acquisition, or belief |
| Observed information | A supported observation/input event tied to the subject and context in which it was available | A world event merely occurring; an event existing in a log; a fact being canonical | The event may be observable, but this alone does not prove the subject noticed or understood it |
| Received information | A supported host/source outcome establishes that information reached the subject or its intended channel | Retrieval, admission, prompt inclusion, generation, or an unconfirmed render | Receipt is evidence of exposure only; do not automatically create knowledge or belief |
| Acquired knowledge | A separately justified subject-relative acquisition event, with source/proposition evidence under an owner-approved policy | Receipt alone, repeated context inclusion, a generated NPC statement, or a source being authorized | Record only what the subject could plausibly acquire through that path; retain source/provenance separately from stance |
| Believed proposition | A distinct subject-relative stance transition supported by the configured evidence/reasoning policy | Acquisition, canonical truth, source authority, or confidence in the source alone | A subject may know a claim was made without believing it; belief strength never grants access or makes a claim canonical |
| Doubt | Evidence or reasoning causes the subject to suspend or reduce confidence in a proposition | Missing retrieval results, access denial, stale index state, or absence of evidence by itself | Doubt is not proof of falsity and must not erase the underlying claim or its provenance |
| Contradiction | Two incompatible propositions or evidence items coexist in the subject's available information | A conflict in metadata alone, a duplicate identity, or a model-generated assertion without supporting evidence | Preserve the conflict for subject-relative evaluation; do not silently pick a winner or rewrite world truth |
| Forgetting / reduced recall | An explicit, policy-supported subject-relative change in accessibility or recall | Source deletion, authorization revocation, index loss, context truncation, or non-retrieval | Reduced recall does not mean the proposition was false, never acquired, or safely deletable from canonical history |
| Belief revision | A justified transition from a prior stance to a new stance, linked to the evidence/reasoning that changed it where supported | Latest-source replacement, an unversioned summary, a changed snapshot marker, or an ungrounded generated rationale | Preserve the distinction between historical stance, current stance, and canonical world state; do not invent persistence/history guarantees |

Cross-cutting rules:

- Source authority answers whether evidence may be used or disclosed; it does not determine whether a character believes the proposition.
- Proposition truth, source credibility, acquisition, belief, confidence, recall, and externally expressed behavior are separate dimensions.
- Internal state does not automatically determine outward speech or action. An NPC may conceal, misstate, or decline to disclose a belief; observed dialogue is not proof of the internal state.
- One transition does not imply the next. In particular: observed ≠ received ≠ acquired ≠ believed; doubt ≠ disproof; forgetting ≠ falsity; contradiction ≠ resolution; revision ≠ canonical world change.
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

- **Core #140:** there is still no universal source identity/version contract or durable source-change feed for every source class. The direct `canonical_entity` source-version token (`core-entity-v1:<counter>`) and snapshot-pinned canonical entity inventory are now implemented on main by merged PR #709. `world_revision + commit_sequence` remains a snapshot marker, not a source-specific journal. Core initial-knowledge acquisition-time value/source-event pins and the actor-scoped reader are in draft PR #764; until merged, legacy/unpinned acquisitions remain non-ready for NPC disclosure. External Host messages and derived summaries remain unsupported as direct sources.
- **Host/Adapter #258:** the observed SillyTavern event samples establish event presence/shapes only. Array indices and swipe IDs remain host-local; no production capture/persistence mapping, stable conversation/session identity, or complete restart/replay inventory is proven. Host lifecycle PR #680 was closed unmerged; persisted-save receipt PR #689 remains a draft stacked on that branch; PR #740 is a documentation checkpoint, not the executable egress patch. Host + Provider must establish the real lifecycle-to-persisted-source mapping and authenticated session binding before any result can be considered production input.
- **Memory Provider #181:** Provider-side SQLite grants, candidate authorization, reconciliation and the Core source-version/inventory validators exist as bounded runtime primitives. They do not establish complete Host history by themselves: injected validators are authoritative only when backed by a trusted Host inventory. Raw Host text capture/read remains explicitly disabled. Provider must supply complete, current record inventory, lineage, index health and reconciliation evidence from the approved Host source, or mark the result non-ready.

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

The NPC-1/NPC-2 semantic mapping is now recorded in `docs/57-private-host-core-memory-npc-adapter-contract.md` (PR #747). That document is a private architecture contract, not runtime evidence. The next runtime dependencies are the Core reader/value-pin candidate #764, an authenticated Host-session binding, a production Memory inventory/reconciliation source, and a real NPC decision/context callsite. Do not substitute more fixture tests for these missing runtime links.


## 9. Cross-block contract and end-to-end status snapshot — 30 Oct 2026

The private semantic contract is recorded in `docs/57-private-host-core-memory-npc-adapter-contract.md` (PR #747). D1–D4 are decided under delegated project authority; D5 requires explicit approval for every affected API owner; D6 prohibits automatic production enablement. This matrix remains the acceptance evidence register. Contract completion is not runtime acceptance.

### Requirement status

| Requirement | Status | Current evidence and remaining gap |
|---|---|---|
| R1 — Acquisition identity, provenance and source version | **PARTIAL** | Trusted source ingestion #683 and direct `canonical_entity` source-version/inventory support #709 are on main. Acquisition-time value/source-event pins and Core NPC reader are draft in #764; Memory evidence is not wired into the NPC runtime. |
| R2 — Actor, recipient, purpose and field authorization | **PARTIAL** | Core actor binding and bounded authorized-read exist. #764 has per-read/per-acquisition authorizers but they are unset in `src/index.js`; adapter/recipient remain request scope, not Host authentication. |
| R3 — Epistemic class → belief mapping | **PARTIAL** | Private contract PR #747 is implemented as an NPC-local pure mapping in draft PR #769. Runtime Core/Memory/Host integration and production context serialization are not present. |
| R4 — Production NPC decision/context callsite | **NOT IMPLEMENTED** | No production caller/serializer has been demonstrated to consume the authorized result and preserve the epistemic distinctions. |
| R5 — Host final disclosure and Gateway | **PARTIAL** | A bounded Core/Provider dispatch primitive exists, but no pinned SillyTavern final-send route is wired to it; Host inventory/restore and authenticated session binding remain incomplete. Contract requires fail-closed final revalidation and does not claim linearizability. |

### Required end-to-end cases

| Test | Status | Evidence boundary |
|---|---|---|
| E2E-01 — Valid source through Core/Memory to actual NPC runtime | **PARTIAL** | Component and in-process integration fixtures exist; no production NPC callsite. |
| E2E-02 — Unknown/untrusted source rejected | **PARTIAL** | Provider and admission negative tests exist; no complete production path. |
| E2E-03 — Stale source version rejected | **PARTIAL** | Core source-version token and Provider checks exist; no end-to-end NPC disclosure test. |
| E2E-04 — Revoked trust/access rejected | **PARTIAL** | Provider grant/revocation tests exist; no pinned Host final-send integration. |
| E2E-05 — Rollback and same-fact replacement do not reuse acquired value | **PARTIAL** | Regression is present in draft Core reader candidate #764; not mainline runtime evidence. |
| E2E-06 — Duplicate delivery/acquisition is idempotent | **PARTIAL** | Core ingestion and candidate belief idempotency tests exist; no integrated Host delivery/receipt path. |
| E2E-07 — Canonical/derived-belief conflict preserves Core precedence | **PARTIAL** | Rule is defined by PR #747; candidate Core/NPC semantics are not integrated in production. |
| E2E-08 — Partial Provider response never becomes ready/empty | **NOT TESTED** | No real integrated Host→Provider→Core→NPC partial-response test. |
| E2E-09 — Result limit/truncation fails closed end-to-end | **NOT TESTED** | Local bounded-reader tests are not an integrated Memory/NPC context test. |
| E2E-10 — Revocation at final-send boundary blocks when observed | **PARTIAL** | Gateway primitive/candidate race tests exist; actual pinned Host route and all-route no-bypass proof are absent. No linearizability claim is made. |
| E2E-11 — Restart/reconciliation does not resurrect revoked/stale knowledge | **PARTIAL** | Core/Provider restart and projection tests exist separately; full Host inventory and integrated recovery are not proven. |
| E2E-12 — Core commit failure/retry does not falsely confirm mutation | **PARTIAL** | Core event/idempotency and draft belief-transition tests exist; no production NPC action/commit path is integrated. |

**No E2E case is marked PASS.** PASS requires a real integrated path, exact tested SHAs, reproducible CI evidence and the assertions defined in the acceptance matrix. A contract, unit test, fixture, or draft PR cannot upgrade a case to PASS.

### Current release disposition

- NPC: `NOT ACCEPTED`.
- Memory → NPC: `DISABLED / FAIL-CLOSED`.
- Host protected dispatch: not production-ready.
- Production readiness: not claimed.
- No API/schema changes or production wiring are authorized by this matrix update.


## 13. Issue #317 execution snapshot — 30 Oct 2026

This is the current NPC execution record. Earlier dated sections above are historical evidence and must not be read as the current PR/base status.

### P0.1 — exact current-main baseline and ownership

- Current `main` at the start of this port: `8c8b9059ae12af3a63e96eb7cb86851e12a6d925`.
- Closed historical PRs were compared against that exact current `main`:

| PR | Historical base | Head | Current-main comparison | Actual changed paths relative to current main |
|---|---|---|---|---|
| #138 | `fa534a49f556a0d03b24a972e6fa0d0d35ddb991` | `2d571b6c0d4d4ba89229e207ae50d7125d92d3c5` | 2 ahead / 539 behind; diverged | `tests/npc-memory-candidate-eligibility.test.js` only |
| #139 | `fa534a49f556a0d03b24a972e6fa0d0d35ddb991` | `c12a3f9b12ef7e2a2f37ee24ec47f77a9f652d48` | 2 ahead / 539 behind; diverged | `docs/56-npc-memory-boundary-acceptance-matrix.md` only |
| #246 | `f748603d9b96808406095449f650399207d1e944` | `22b85a803e968b28f9016f532aae6494dc3c8cae` | 9 ahead / 499 behind; diverged | `src/npc/memory-candidate-eligibility.js`, `tests/npc-memory-candidate-eligibility.test.js` |
| #279 | `1dc0b8715801887e7a5343b6de0e7f73faee66cf` | `30e54290602e9b59eddb83e4b766a78961fd1197` | 2 ahead / 493 behind; diverged | `src/npc/memory-candidate-eligibility.js`, `tests/npc-memory-candidate-eligibility.test.js` |

The old PRs are closed. The comparison shows no Personality/Core/Memory/Host/Relationships/vectorization path to port from those historical heads. Their ancestry is not part of the new implementation diff.

The clean replacement is [PR #769](https://github.com/necromorphic/Logic-Engine/pull/769), Draft, based exactly on `8c8b9059ae12af3a63e96eb7cb86851e12a6d925`. The implementation commit `f5e14c4ddf5aa9f9bc020bf3cf01b8faab8ca674` contains the current reducer/mapping hardening; its exact-head Runtime workflow is pending at the time of this matrix update. Earlier code heads passed, but do not substitute those runs for this exact head. Its four changed paths are:
- `.github/workflows/runtime-tests.yml` — NPC-owned boundary workflow adds the reducer test and repository test bootstrap;
- `src/npc/epistemic-state.js` — NPC-owned reducer and conservative mapping;
- `tests/npc-epistemic-state.test.js` — focused reducer/mapping regressions.

No Core, Memory Provider, Host/Adapter, Personality, Relationships, or vectorization file is changed. The former draft PR #759 is not the clean review path because it contained cross-block test edits and was based on an older main; PR #769 is the replacement.

### P0.2 — frozen admission boundary

Current-main admission implementation remains unchanged by PR #769:
- Source: `src/npc/memory-candidate-eligibility.js`, blob `68c5a82dd80e46dd0d023debd12121e869ddeac5`.
- Tests: `tests/npc-memory-candidate-eligibility.test.js`, blob `2252448ba47d9c40519787b62ed782f9c426af74`; 45 focused tests.
- The function remains a pure metadata eligibility oracle. It returns stable reference/version metadata only; it does not authenticate the source, fetch content, authorize a read, or mutate lifecycle state.
- Current coverage includes malformed/missing snapshot, sparse arrays/lineage, duplicate identity/version ambiguity, stale/retracted/unavailable sources, wrong world/subject/purpose, incomplete lineage, safe generic exclusion, serialized non-disclosure, proxy/getter/iterator hardening, and input immutability.
- Candidate assessment labels are preserved as metadata; the helper does not decide proposition truth or create belief. Do not infer that `ready` means authorized content was disclosed.

**Disposition:** PASS for the isolated pure-oracle contract/tests; real authorization remains an owner gate.

### P0.3 / P1.1 / P1.3 — NPC-local lifecycle and epistemic semantics

PR #769 adds:
- `createNpcEpistemicState()` and `applyNpcEpistemicEvent()` in `src/npc/epistemic-state.js`, blob `4468abaf3af2671e57a62fca8ce4ea5caa81f9c5`;
- 41 focused tests in `tests/npc-epistemic-state.test.js`, blob `a81aa5e87b011c5cdaa479e50c1dd425871db6f4`.

The reducer keeps `information_received`, `evidence_admitted`, and `belief_updated` separate. Receipt does not create evidence or belief; admission does not establish delivery or receipt; invalidation requires review; canonical truth changes do not silently rewrite a subject-relative belief; forgetting is explicit. This is an NPC-local state machine, not evidence that Host delivery or Core acquisition occurred.

The Memory mapping implements the private contract in PR #747:
- `acquired_report` → `unconfirmed_report`;
- `rumor` → `rumor`;
- `inference` → `inference`;
- `insufficient` → `unknown`;
- `unassessed` → no belief revision;
- `supported` does not promote any of those classes to `confirmed`;
- `canonical`, `authored_initial`, and `imported` are not Memory-to-belief mappings; Core assigned knowledge remains separate;
- `suspicion` is NPC cognition output, not a Memory source class;
- disputed evidence retains its class and assessment in the NPC evidence record; it cannot support a directional stance, and an unresolved stance requires evidence on both sides. Insufficient evidence cannot support any stance. Restored state/history validation enforces the same rules.

The reducer also validates exact event shape and an explicit evidence assessment, own data descriptors for trusted scope, proxy/exotic-object rejection, dense arrays, restored state and history polarity, unique evidence references, and resistance to a polluted `Array.prototype[Symbol.iterator]`. It does not authenticate the evidence labels supplied by its caller.

**Disposition:** PASS for the bounded NPC-local reducer/mapping contract, subject to exact-head CI and independent NPC/Security review. No production caller is claimed.

### P0.4 — real-path handoff and integrated acceptance

The current Core candidate is [PR #764](https://github.com/necromorphic/Logic-Engine/pull/764), Draft, not merged. It adds an internal `readNpcKnowledge()` and belief/context preparation candidate, but its own contract states:
- Core read/visibility authorizers are not configured in `src/index.js`;
- `adapter_id` and `recipient` are request data, not authenticated Host session binding;
- no production NPC caller, model-context serializer, or Host final-egress integration exists;
- it is not an enablement switch.

NPC therefore has no approved real callsite/context envelope to implement yet. Do not serialize raw Core acquisition values directly into a prompt. The next NPC implementation step is gated on Core owner acceptance of the reader/visibility result and Host delivery of a trusted session/recipient binding. Then the NPC-owned adapter can map the approved result into the envelope and test its serialized form. Creating a speculative envelope now would invent a cross-block contract.

| Hop | Exact code / test evidence | Evidence class | Current result |
|---|---|---|---|
| NPC admission | `src/npc/memory-candidate-eligibility.js`; `tests/npc-memory-candidate-eligibility.test.js` | Source + focused tests on main | Component PASS; caller metadata is not authenticated |
| NPC epistemic reducer | `src/npc/epistemic-state.js`; `tests/npc-epistemic-state.test.js` | Source + focused tests in #769 | Pending exact-head CI; no runtime caller |
| Core acquisition reader | `src/application/engine.js`, `readNpcKnowledge()`; draft #764 | Candidate source + candidate tests | NOT ACCEPTED / authorizers unconfigured |
| Host authenticated session / recipient | No production callsite identified in pinned Host path | Not verified | BLOCKED — Host owner |
| NPC context serializer / model envelope | No production serializer consuming Core reader result | Not implemented | BLOCKED — NPC can implement after Core/Host contract |
| Sole final Gateway dispatch | No pinned Host route wired to Core/Memory Gateway | Not verified | BLOCKED — Host/Core owner |

No integrated real-path acceptance test can run against a path that does not exist. Fixture-only reducer tests are not E2E evidence. Keep E2E-01..12 at their existing PARTIAL / NOT TESTED statuses; no E2E case is PASS. The exact closure suite must exercise valid, withheld, stale, revoked, partial, complete-empty, duplicate delivery, same-fact rollback/replacement, serialized non-disclosure, restart/rebuild, and Core commit failure through the real Host→Core/Memory→NPC→serializer→Gateway path.

### Issue #317 disposition

| Item | Status |
|---|---|
| P0.1 exact baseline / clean NPC-only diff | **PASS** — current-main base and historical comparisons recorded above |
| P0.2 pure admission boundary | **PASS** — current-main helper and 45 focused tests; no source edit in #769 |
| P0.3 lifecycle separation | **PASS at NPC-local state level**; real delivery/receipt remains external |
| P0.4 real-path handoff | **BLOCKED** — Core reader/authorizers and Host session/final egress are not accepted/implemented |
| P1.1 reducer hardening | **PENDING exact-head CI** for implementation commit `527554733b2cf54847e5723af366d10f61afee25`; independent NPC/Security review remains pending |
| P1.2 single matrix / review path | **PARTIAL** — this is the single acceptance matrix; #769 awaits review |
| P1.3 epistemic semantics | **PASS at NPC-local mapping/reducer level**; production callsite remains blocked |
| P2 capability expansion | **NOT STARTED** — intentionally outside P0/P1 |

Overall NPC remains `NOT ACCEPTED`; Memory→NPC remains `DISABLED / FAIL-CLOSED`. No merge, production wiring, or sibling-owned file change is included.
