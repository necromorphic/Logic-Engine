# NPC Memory↔NPC Consumption Contract and Failure Matrix

Status: NPC-owned semantic contract and acceptance plan, documentation only, on `feat/npc-subsystem`. This document does not create or approve a runtime API, schema, storage path, authorization mechanism, change feed, cursor, or host-delivery signal.

Date: 2026-10-24

Related:
- `docs/39-npc-core-knowledge-contract-proposal.md` — overarching Core/NPC knowledge boundary.
- `docs/48-npc-delivery-acquisition-boundary-matrix.md` — delivery/receipt/acquisition evidence thresholds.
- `docs/49-npc-core-knowledge-live-audit.md` — observed Core capability audit.
- `docs/50-npc-initial-knowledge-acquisition-contract.md` — first-slice acquisition semantics.
- `docs/51-npc-acquisition-source-reconciliation.md` — source and cross-subsystem reconciliation.
- Core Memory design proposal: PR #68 and `docs/64–72` are unmerged design material, not approved runtime behavior.

## 1. Purpose and status vocabulary

This follow-up turns the Memory audit findings into a usable NPC consumer contract. It resolves NPC-owned behavior where possible and marks Core/Memory-owned gates explicitly.

Evidence labels used throughout:
- **Observed on reviewed Core main** — source/test evidence recorded in `docs/49`; only the exact described behavior is established.
- **Design proposal** — a semantic requirement or illustrative shape, not a callable interface.
- **Blocked** — the behavior requires a Core/Memory-owned contract or production path that has not been established by the audit.
- **NPC-owned rule** — how NPC must behave when consuming a candidate, including safe failure behavior.

Do not infer current implementation from a proposed field name, pseudocode, issue, PR, or documentation contract. No test in this document is claimed to have run against a production Memory↔NPC integration.

## 2. Ownership and the candidate contract

### 2.1 Responsibility split

| Concern | Owner | NPC consumer rule |
|---|---|---|
| Canonical world truth and canonical source identity/validity | Core | Never promote a retrieved candidate or summary into canonical truth. |
| Retrieval/index implementation, index health, retrieval provenance, derivation metadata | Memory, subject to Core boundaries | Treat retrieval as candidate discovery only; an index hit is not proof of current validity or permission. |
| Access decision for a named actor, world, purpose and request | Core/Memory contract, approval required | No affirmative decision means no content, snippet, count, or diagnostic that reveals protected existence/content. |
| Subject assignment and acquisition record | Core | NPC cannot create acquisition by reading, ranking, prompting, summarizing, or generating prose. |
| Delivery attempt and delivery/receipt evidence | Core plus actual host integration | Do not claim sent/shown/received without the matching supported evidence. |
| Subject-relative belief and inference persistence | Core; NPC may propose interpretation | Keep belief separate from acquisition and canonical truth; no local persistent shadow store. |
| Eligibility, source-lineage checks, handling of non-ready candidates, safe prompt admission | NPC consumer, using owner-supplied evidence | Fail closed if a required security or freshness decision is missing. |
| Ranking and bounded selection among already eligible candidates | Memory retrieval policy and/or NPC context planner | Ranking never overrides authorization, source validity, or world scope. |
| Retry orchestration | Consumer/integration, constrained by Core-owned idempotency semantics | Retry the same semantic operation with a stable key; never turn uncertainty into a duplicate fact. |

### 2.2 Minimum candidate semantics

The following fields describe information a future candidate response must make available to its consumers. They are **requirements, not an approved API schema**. Names are illustrative. A missing required field is not a default permission.

| Semantic field | Why the NPC consumer needs it | Consumer if absent/ambiguous |
|---|---|---|
| Stable record reference and record version (or explicit version-unavailable status) | Deduplicate candidates and detect changed records without trusting text equality | Candidate is non-ready for stateful use; do not persist acquisition or derived belief. |
| World scope | Prevent cross-world contamination | Reject candidate; do not prompt it as in-world knowledge. |
| Requested actor/subject and purpose binding | Establish what decision the access result actually covers | Reject if absent, mismatched, ambiguous, or caller/model supplied without trusted resolution. |
| Per-request access outcome and policy/decision reference where supported | Separate authorization from ranking and storage metadata | Withheld/unknown/non-ready; do not expose content or existence-revealing metadata. |
| Typed content/source kind | Distinguish canonical proposition, authored initial knowledge, report, observation, inference, summary, etc. | Treat kind as unknown and exclude from knowledge-asserting prompt context. |
| Epistemic kind/status | Preserve claim/report/rumor/inference/known-absent distinctions | Never silently cast to verified fact or subject belief. |
| Producer provenance | Identify who/what created or transformed this record | Do not treat producer as source author, witness, or verifier. |
| Content lineage | Identify the source claims/records on which content depends, including all sources for a multi-source derivation | If lineage is required but unavailable, exclude derived content by default. |
| Freshness/source status and version linkage | Detect stale, retracted, unavailable, or changed source state | Treat as non-ready; request owner-approved revalidation/reconciliation, not an invented cursor query. |
| Snapshot identity, when supplied by Core | Prevent mixing results from different world snapshots | Reject mixed/stale snapshots for a decision requiring consistency. |
| Independent lifecycle dimensions | Distinguish content disposition, source reconciliation, evidence assessment, access decision, and index health | Do not infer one dimension from another or collapse them into a single status. |
| Completeness/partial-result status and typed errors | Avoid treating partial or unavailable results as complete absence | Mark context non-ready where incompleteness can affect safe interpretation; do not claim “not known.” |

A stable record reference is not necessarily a canonical source reference. The record that contains a summary and the source claims summarized by it must be separately identifiable. Each lineage source must also be bound to the requested world, actor, and purpose: an authorized summary record does not prove that every underlying source belongs to the same world or is accessible to the same actor for the same purpose. If a storage system cannot expose a source reference/version, NPC must not fabricate one from a hash of visible text and treat it as canonical identity.

### 2.3 Illustrative response shape (not runtime)

```json
{
  "contract_status": "proposal_only",
  "request": {
    "world_id": "<trusted-world-ref>",
    "subject_id": "<trusted-canonical-actor-ref>",
    "purpose": "<declared-bounded-purpose>",
    "snapshot": {
      "world_revision": "<same-read-view>",
      "commit_sequence": "<same-read-view>"
    }
  },
  "response": {
    "completeness": "complete | partial | unavailable",
    "scope": {
      "world_id": "<same-world>",
      "subject_id": "<same-request-actor>",
      "purpose": "<same-request-purpose>"
    },
    "access": {
      "outcome": "allow | deny | withheld | unknown",
      "subject_id": "<same-request-actor>",
      "purpose": "<same-request-purpose>",
      "decision_ref": "<if supported>"
    },
    "candidates": [
      {
        "record": { "ref": "<stable-record-ref>", "version": "<record-version>" },
        "world_id": "<same-world>",
        "subject_id": "<same-request-actor>",
        "purpose": "<same-request-purpose>",
        "access": {
          "outcome": "allow | deny | withheld | unknown",
          "subject_id": "<same-request-actor>",
          "purpose": "<same-request-purpose>",
          "decision_ref": "<if supported>"
        },
        "content_kind": "claim | report | summary | author_initial | imported | inference | unknown",
        "epistemic_kind": "canonical | acquired_report | rumor | inference | authored_initial | imported | unknown",
        "producer": { "kind": "<producer-or-transform>", "ref": "<if supported>" },
        "lineage": {
          "status": "complete | incomplete | unavailable",
          "sources": [
            {
              "ref": "<source-ref>",
              "version": "<source-version>",
              "world_id": "<same-world>",
              "access": {
                "outcome": "allow",
                "subject_id": "<same-request-actor>",
                "purpose": "<same-request-purpose>"
              },
              "freshness": { "status": "current | stale | retracted | unavailable | unknown" }
            }
          ]
        },
        "freshness": { "status": "current | stale | retracted | unavailable | unknown" },
        "snapshot": {
          "world_revision": "<same-read-view>",
          "commit_sequence": "<same-read-view>"
        },
        "lifecycle": {
          "content_disposition": "<independent dimension>",
          "source_reconciliation": "<independent dimension>",
          "evidence_assessment": "<independent dimension>",
          "access_outcome": "<request-scoped dimension>",
          "index_health": "<retrieval-system dimension>"
        }
      }
    ],
    "errors": [{ "kind": "<typed-error>", "retryable": false }]
  }
}
```

The example intentionally uses strings for owner-defined values rather than establishing enums. It omits raw content from the illustrative skeleton because content may be returned only after the access decision is approved and applied. The actual contract must define which metadata is safe to expose on deny/withheld responses. A denied response must not leak protected content through candidate count, snippets, source titles, error text, timing diagnostics, or pagination. The pure NPC admission oracle requires both request-level and candidate-level access decisions to be explicitly bound to the requested subject and purpose, as well as matching world/subject/purpose scope. An `allow` outcome by itself is insufficient, including when the candidate list is empty. These binding fields are a proposed consumer requirement, not a claim about the current Memory runtime schema; the approved Memory owner contract must supply equivalent trustworthy evidence. Candidate-level rejection output is deliberately aggregated to one generic marker, because per-record rejection reasons and rejection counts can reveal protected record existence. The helper's `ready_with_exclusions` status means at least one candidate was admitted and at least one excluded; it is deliberately distinct from the upstream retrieval result's `partial` completeness status. The helper is still only a defensive consumer check: it cannot undo a disclosure that occurred before candidate metadata reached it. If the caller supplies a snapshot, both its revision and commit-sequence components must be present and well-formed, and every candidate must carry the same well-formed pair. Missing snapshot components must not compare equal merely because both sides are absent.

### 2.4 Independent lifecycle dimensions

Do not encode all status in one `status` field. The dimensions answer different questions and may coexist:

- **Content disposition:** usable, superseded, deleted, or other owner-defined disposition of the record itself.
- **Source reconciliation:** current, stale, retracted, pending reconciliation, unsupported, or unknown relationship to the current canonical source.
- **Evidence assessment:** verified, disputed, unverified, contradicted, or unknown, only where an owner-defined evidence policy supports the label.
- **Access outcome:** allow, deny, withheld, unknown, or incomplete for this request/actor/purpose. It is request-scoped and must not be cached as universal permission.
- **Index health:** ready, stale, rebuilding, unavailable, or failed for the retrieval mechanism.
- **Lineage completeness:** complete, incomplete, or unavailable for the derivation/source graph.
- **Result completeness:** complete, partial, or unavailable for the query as a whole.

These are proposed semantic axes, not approved persisted enums. One dimension must not be used to infer another: a current index can contain a retracted source; an accessible record can be disputed; a valid record can be withheld; a record marked superseded can still be relevant as historical evidence if an approved policy permits it.

## 3. Retrieval-to-knowledge lifecycle

The numbered flow below is a design contract. The identity-binding, bounded-snapshot, and proposal primitives observed on Core main do not by themselves implement the full flow.

1. **Declare request scope.** A trusted caller binds the canonical world and actor; NPC declares purpose and bounded context requirements. A model-provided actor ID, Memory metadata, or a context manifest cannot establish trusted identity or authorization. Trusted actor binding is observed on reviewed Core main, but is identity resolution only.
2. **Authorize before disclosure.** Core/Memory applies an approved actor/world/purpose access decision before exposing content, snippets, counts, source names, pagination details, or diagnostics. This general authorized-read contract remains blocked. Missing, ambiguous, withheld, or unavailable decision means fail closed.
3. **Validate candidate eligibility.** NPC checks world match, access outcome, record/source version, source status, lineage completeness, epistemic kind, snapshot consistency, and result completeness. Ranking is considered only after safety gates pass.
4. **Prepare context without state mutation.** A candidate admitted to a model context is a temporary input, not acquisition, receipt, belief, or delivery. Prompt inclusion, generated summaries, context manifests, and vector hits cannot create those records.
5. **Cross a real delivery boundary.** If the integration communicates information to an NPC, the host must expose a defined attempt/outcome signal. Persist delivery through the Core-owned path with an idempotency key. Injection accepted by a host is not proof of visible rendering; rendering is not comprehension. No verified host-rendering signal is established by the current audit.
6. **Record acquisition only on an approved path.** The first specified slice is authorized `author_initial`/`imported` knowledge, not live-play discovery. Future observation, message, document, and inference paths require their own evidence contract. Delivery success and acquisition are distinct, even if a future approved transaction relates them.
7. **Interpret separately from receipt.** NPC interpretation may produce a proposed inference or belief change. Persistent subject-relative belief must go through Core-owned authorized persistence; it must not be written to a local NPC store. A report can be acquired while false; a subject can receive information and reject it.
8. **Reconcile changes and retries.** Retraction, rollback, source-version change, access revocation, summary lineage change, or reconciliation signals trigger owner-approved re-evaluation. Do not rely only on a higher maximum commit sequence: rollback can change validity without increasing it. Until an approved durable signal/read path exists, do not invent an outbox, cursor, polling token, or local change log; mark affected decisions non-ready and use only a real owner-approved revalidation path.
9. **Preserve uncertainty.** On partial failure, keep retrieval, prompt inclusion, delivery attempt, host acceptance, confirmed visibility, receipt, acquisition, comprehension, belief, and canonical truth distinct. Unknown outcome is not success and not proof of failure; reconcile before unsafe retry.

**Current runtime boundary:** steps 1 has a limited identity-binding primitive and bounded snapshots; proposal staging exists but is not knowledge persistence. Steps 2 and 4–9 are not collectively implemented as the Memory↔NPC lifecycle. The exact implemented surface must be rechecked before any runtime work.

## 4. Negative-case matrix

Legend: “No” means do not expose content to the model; safe generic operational status may be returned only if it does not reveal protected existence. “No semantic write” means no acquisition, belief, delivery-success, or canonical-state write by the NPC consumer. All rows are acceptance requirements, not current test results.

| Case | May content be returned? | May enter prompt? | Persisted state | Owner | Retry / reconciliation | Testable expected result |
|---|---|---|---|---|---|---|
| Duplicate result / repeated delivery | Only after normal access and eligibility checks; duplicate metadata may be deduplicated without revealing denied records | At most once per semantic context/delivery operation under declared policy | No new acquisition or belief solely because of duplicate; delivery attempt dedupes under approved key | Memory retrieval; Core delivery/acquisition | Reuse same proposed idempotency key for same operation; do not dedupe distinct real deliveries merely because text matches | Same record/version returned twice does not create two acquisitions; retry does not duplicate delivery fact |
| Source from another world | No, unless a separate explicit cross-world contract authorizes it (none assumed here) | No | No semantic write | Core world scope + Memory filter; NPC validates | Do not retry as a same-world candidate; return safe mismatch/non-ready result | Foreign-world record cannot enter context even if actor ID or search query matches |
| Missing/denied/withheld/ambiguous access | No content, snippets, titles, counts, or existence-revealing diagnostics | No | No acquisition/delivery/belief write | Core/Memory access decision; NPC fail-closed consumer | Retry only after policy/input changes or owner-approved recheck; never convert unknown to allow | Denied and withheld cases are indistinguishable where existence itself is protected; no side-channel leaks |
| Retracted/deleted/unavailable source | Do not return as current usable knowledge; historical use only if an explicit policy permits and labels it clearly | No as current fact; historical context only if separately authorized and explicitly labeled | No new acquisition; existing records are not locally erased or rewritten | Core source validity/reconciliation; Memory index; NPC eligibility | Use owner-approved reconciliation; preserve audit semantics set by Core | A retracted source is not silently served as current; unavailable is not converted to false |
| Stale source or changed source version | Not as current verified content until revalidated; old version only as labeled historical evidence if permitted | No as current fact | No new semantic write | Core source truth; Memory version/lineage; NPC consumer | Re-fetch/revalidate using approved interface; no invented revision cursor | Version mismatch makes candidate non-ready and prevents prompt admission as current |
| Multi-source summary; access to one source revoked | No derived content until lineage and permission propagation are evaluated; default deny | No, unless an approved derivation/declassification rule proves safe output | No summary authorization cache or belief write | Memory derivation/lineage; Core/Memory access policy; NPC fail-closed | Re-derive from still-authorized sources only under approved rules; otherwise withhold whole summary | Revoking one source prevents a summary from leaking its restricted contribution via paraphrase/snippet |
| Index stale/unavailable/rebuilding/failed | Only if a separate authoritative, authorized read path validates candidate and completeness; otherwise no usable content | No when freshness/completeness affects safety; no raw-index fallback | No semantic write; operational health telemetry only if approved and non-sensitive | Memory index; Core source authority; NPC context planner | Wait/retry or use approved authoritative fallback; do not treat empty index result as absence | Index outage yields unavailable/partial, not “actor does not know” |
| Conflicting evidence | Return only authorized, current candidates with their distinct source/epistemic labels; do not hide conflict by summary collapse | Yes only if each item independently passes access/lineage/freshness gates and prompt can preserve conflict/uncertainty | No automatic canonical truth or belief update; optional future proposal only | Core canonical adjudication; Memory retrieval; NPC interpretation | Re-query/reconcile under owner policy; do not resolve solely by ranking or repetition | Conflicting claims remain distinct and labeled; no unsupported “winner” is fabricated |
| Empty search result | Return an empty result only with safe scope/completeness metadata; no claim of universal absence | No content; “no candidates in this bounded complete query” only if authorized and complete | No acquisition/belief write | Memory retrieval; Core scope/completeness; NPC interpretation | Retry only for incomplete/unavailable/index recovery; complete empty result is not a reason to invent knowledge | Empty complete result is distinct from withheld, unknown, and index unavailable |
| Retrieval succeeds, delivery fails | Candidate may be returned to trusted consumer if authorized; not to target as delivered knowledge | It may have been in an internal preparation prompt, but that is not target delivery; do not claim target saw it | Persist attempt/failure only via Core-owned delivery record; no receipt/acquisition implied | Memory retrieval; host adapter; Core delivery record | Retry same logical delivery with stable proposed key; reconcile uncertain host outcome before retry | Failed host send leaves target uninformed unless independent evidence proves another acquisition path |
| Delivery succeeds but receipt is unknown/ambiguous | Source content may remain accessible under normal rules; do not expose receipt claim | Do not phrase as “target knows/received” | Delivery may be accepted/injected; receipt/acquisition remain unknown absent evidence | Host adapter + Core delivery/acquisition | Reconcile with actual host signal; avoid duplicate side effects while outcome uncertain | Host acceptance does not create confirmed receipt or belief |
| Source retracted after acquisition | Retrieval must not present the source as currently valid; prior acquisition history may remain visible to authorized reconciliation logic | Do not present as current verified truth; historical claim may be contextualized if allowed | Core reconciles source-dependent acquisition; belief is not automatically rewritten | Core acquisition/reconciliation; Memory index; NPC consumer | Evaluate alternative valid support; keep historical acquisition and current validity distinct | Retraction invalidates unsupported current basis without blindly erasing independent support or changing belief automatically |
| Canonical rollback changes validity without higher commit sequence | Do not assume previous candidate is still current solely because sequence did not increase | No until source validity is revalidated under approved boundary | No NPC-local invalidation ledger; Core owns reconciliation/audit | Core rollback/source validity; Memory stale detection; NPC fail-closed | Use explicit stale/unavailable/reconciliation response or fresh authoritative read; no sequence-only cursor assumption | Test rollback with unchanged/lower/equal sequence marker: stale candidate is blocked and later valid source is not lost |
| Retry after partial failure | Only candidates revalidated for the current request may be returned | Only candidates passing all gates; never reuse an unsafe cached prompt fragment | Each owner records only its own confirmed transition; no inferred completion of missing stages | Each stage’s owner; Core owns semantic records | Stable operation keys; read back/reconcile before retry if outcome unknown; no all-or-nothing claim without a real transaction | Repeating after failure does not duplicate confirmed effects, skip missing evidence, or convert unknown to success |

## 5. Lifecycle transition and ownership table

The key is to identify the semantic owner without pretending an implementation path exists. Proposed idempotency key ingredients below are design candidates, not current API contracts.

| Transition | Trigger / evidence | Authoritative owner | Persisted change | Idempotency candidate (proposal) | Retrieval / prompt consequence | Required test |
|---|---|---|---|---|---|---|
| Acquisition / receipt | Approved acquisition path with source evidence; receipt only with supported host/target signal | Core; host supplies evidence | Core-owned acquisition and/or receipt record, if implemented | `world + subject + source ref/version + acquisition kind + originating event/message ref` | Candidate may be labelled acquired only after the relevant record exists and is authorized | Retrieval alone never creates acquisition; duplicate evidence is idempotent |
| Delivery attempt | Actual invocation of a delivery boundary | Core record + host adapter | Attempt outcome and evidence, if supported | `world + target + payload ref/version + channel + logical delivery operation id` | Attempted does not mean delivered/received | Failed/unknown attempts do not set receipt |
| Delivery success/failure/unknown | Actual host response; visible success only with verified rendering signal | Host adapter evidence; Core owns record | State supported by evidence only | Same logical delivery key, with attempt identity per approved contract | Unknown cannot be upgraded to success from retries alone | Host acceptance, visible render, receipt and comprehension stay distinct |
| Belief create/update/retraction | Authorized interpretation/adjudication based on subject-available evidence | Core | Core-owned subject-relative stance and provenance; not local NPC storage | `world + subject + proposition ref + decision/operation ref` | Prompt can include only authorized current belief view; belief is not truth | False belief may persist separately from canonical truth; no model output writes directly |
| Source change/reconciliation | Canonical source changes, becomes invalid, or owner emits reconciliation outcome | Core source owner; Memory maintains derivation/index consistency | Core reconciles semantic acquisition; Memory refreshes/rebuilds derived retrieval data | Existing source/event identity and owner-approved operation key; no new local revision counter | Stale dependent candidates blocked until revalidated | Alternative support survives; invalid-only support is not presented as current |
| Canonical rollback | Existing Core rollback changes source validity/revision state | Core | Existing Core rollback/audit plus approved downstream reconciliation | Existing rollback/source identities; no NPC-specific rollback ID | Invalidate/revalidate regardless of whether max commit sequence increased | Rollback with unchanged sequence invalidates affected candidates |
| Access revocation | Owner-approved access policy changes or request decision changes | Core/Memory access-policy owner | Policy/audit record only through its approved path; no NPC shadow ACL | Policy decision/version + subject + purpose + resource ref where supported | Remove from subsequent prompt inputs; do not rely on stale cached allow | Revocation blocks record and dependent summaries before model input |
| Summary re-derivation / declassification | Source set/version or approved policy changes; explicit authorized declassification if supported | Memory for derivation; Core/Memory owners for policy | Derived record/version and full lineage under approved mechanism | Derivation recipe/version + ordered source refs/versions + policy version | New version is eligible only after lineage and access re-evaluation | Revoked source cannot leak via old summary; producer is not verifier |
| Index rebuild/failure | Index version changes or backend reports stale/rebuilding/unavailable | Memory | Index health/operational metadata only in its approved store | Existing index generation/build identity if available; do not invent one | Candidate must be validated independently; incomplete search cannot establish absence | Rebuilding/outage returns partial/unavailable, not false negative knowledge |

### Transaction boundary requirement

Do not assume that delivery, receipt, acquisition, and belief update are one transaction. A future design must say which records can commit atomically, which stages are independently durable, and how an ambiguous partial result is reconciled. Until the owning Core implementation identifies the actual transaction boundary, NPC must treat each semantic transition as unconfirmed unless its own owner-approved evidence is available. No mock transaction can prove production atomicity.

## 6. NPC consumer algorithm (design pseudocode)

```text
request = trusted_scope(world, actor, purpose, bounded_query)
if any trusted scope component is missing or ambiguous:
    return NON_READY without exposing candidates

result = memory_candidates(request)  # hypothetical; not a current API
if result.access_decision is absent, ambiguous, withheld, or not applicable:
    return NON_READY without content/snippet/count leakage

for candidate in result.candidates:
    require candidate.world == request.world
    require candidate.access == allow for this actor + purpose + request
    require candidate.record_ref and required version semantics
    require candidate.source_status is current or explicitly permitted historical
    require candidate.lineage is complete when content is derived
    require all source permissions are safe under the approved propagation rule
    require candidate.epistemic_kind is explicit enough for truthful presentation
    require snapshot and completeness satisfy this decision's safety requirements
    otherwise exclude candidate and mark result partial/non-ready as appropriate

rank only eligible candidates
include selected content with its epistemic labels and uncertainty
do not persist acquisition, delivery, receipt, comprehension, or belief from inclusion

if a real delivery operation occurs:
    record only the host-supported attempt/outcome through Core-owned path
    if outcome is unknown, reconcile before retrying a potentially duplicating side effect

if NPC interpretation suggests belief/inference change:
    submit only through an approved Core-owned operation
    never persist model output directly as canonical truth or local shadow belief
```

The pseudocode is an NPC-side safety oracle. The hypothetical `memory_candidates` call and all semantic persistence calls require owner-approved interfaces and are not runtime methods.

## 7. Proposed test plan

All tests below are **contract/prototype acceptance tests** until implemented against an owner-approved production boundary. They must not be reported as passing current `main` merely because they can be simulated with mocks.

| ID | Setup | Action | Expected result / guarantee |
|---|---|---|---|
| MEMNPC-001 | Two worlds contain similarly named records; actor belongs to world A | Query from world A | Only authorized world-A candidates are eligible; world-B content never reaches prompt |
| MEMNPC-002 | Access decision missing, denied, withheld, ambiguous, or for a different purpose | Request candidates and inspect all response surfaces | No content/snippet/title/count/pagination/diagnostic leakage; no semantic writes |
| MEMNPC-003 | Same candidate appears twice and same delivery operation retries | Run consumer twice | No duplicate acquisition; same logical operation uses proposed stable key; no text-based identity fabrication |
| MEMNPC-004 | Source version changes after indexing | Retrieve old index hit | Candidate is stale/non-ready and not presented as current; no acquisition/belief write |
| MEMNPC-005 | Source retracted/deleted/unavailable | Retrieve and then revalidate | Not served as current truth; status remains distinct from false/known absent |
| MEMNPC-006 | Summary combines sources A and B; access to B is revoked | Retrieve summary and inspect snippets/derived output | Summary withheld unless approved lineage policy proves safe; no paraphrase leak |
| MEMNPC-007 | Index is stale, rebuilding, unavailable, or failed | Query and observe result completeness | Partial/unavailable is explicit; empty result is not asserted as absence |
| MEMNPC-008 | Two authorized sources conflict | Retrieve candidates and build context | Both claims retain source and epistemic labels; ranking does not fabricate adjudication |
| MEMNPC-009 | Complete authorized query has no candidates | Query empty set | Reports only bounded complete-query absence; does not claim universal absence or subject ignorance |
| MEMNPC-010 | Retrieval succeeds; host delivery fails | Execute delivery boundary | Attempt/failure only if host evidence supports it; no receipt/acquisition/belief |
| MEMNPC-011 | Host accepts injection but visible receipt signal is absent | Execute delivery and query target knowledge | `injected_unconfirmed` or equivalent only; not shown/received/understood |
| MEMNPC-012 | Source is invalidated after an acquisition record exists | Reconcile | Core preserves history, invalidates unsupported basis, preserves alternative valid support, and does not auto-rewrite belief |
| MEMNPC-013 | Rollback changes source validity without higher commit sequence | Retrieve pre-rollback candidate then request revalidation | Candidate is blocked/reconciled despite unchanged sequence; no sequence-only freshness assumption |
| MEMNPC-014 | Failure occurs after one stage but before later stage; outcome may be ambiguous | Retry same operation | Read/reconcile first when needed; no duplicate side effect or inferred completion |
| MEMNPC-015 | Producer is Memory summarizer; underlying claim author is another source | Inspect candidate and prompt | Producer provenance and claim lineage are separate; producer is not treated as witness/verifier |
| MEMNPC-016 | Lineage missing or only partially available | Retrieve derived content | Derived content is excluded by default; result reports safe partial/non-ready status without leaking sources |
| MEMNPC-017 | Candidate record is current but disputed; or accessible but superseded | Retrieve candidate | Independent dimensions remain distinct; policy controls eligibility rather than one overloaded status |
| MEMNPC-018 | Context manifest contains a reference; no acquisition record exists | Prepare NPC prompt | Manifest/prompt inclusion does not establish access, acquisition, receipt, or belief |
| MEMNPC-019 | Proposal is created from candidate context | Compare canonical and semantic state before/after | Proposal staging alone does not mutate canonical state, acquisition, delivery, or belief |
| MEMNPC-020 | One record is allowed for purpose P but withheld for purpose Q | Query both purposes | Access result is request-scoped; P's allow cannot be reused as universal permission for Q |

### Test layering

1. **Current-main tests:** use only existing source paths and assertions supported by the live audit (for example actor binding, snapshot consistency, tri-state condition results, proposal non-commit behavior). These tests validate those existing primitives only; they do not validate Memory authorization, acquisition, delivery, or belief.
2. **Contract tests:** pure tests for the NPC eligibility decision and failure mapping against explicit candidate fixtures. Label them as contract tests; they prove the consumer oracle, not production authorization.
3. **Integration tests (blocked):** require a real approved Core/Memory read/filter interface, real source-lineage policy, Core-owned persistence, and verified host signals. Mocks must not be presented as evidence that these contracts exist.
4. **Rollback/reconciliation tests (blocked until real boundary):** use actual Core rollback/source invalidation and subsequent source commits. Verify reconciliation even when the maximum commit sequence does not increase. Do not substitute a local fake cursor or synthetic event log.

## 8. Open decisions by owner

### Core-owned decisions

1. **Authorized-read boundary:** exact internal operation, trusted actor/world/purpose binding, snapshot contract, failure semantics, and safe behavior for unknown/withheld/incomplete results.
2. **Canonical source validity and rollback signal:** which real source identities/statuses the consumer can revalidate after rollback or invalidation, including cases where commit sequence does not increase. Do not presume an outbox/change-feed/cursor exists.
3. **Semantic persistence and transaction boundaries:** authoritative write path for initial acquisition, delivery/receipt, belief, audit, and which combinations are atomic. Define partial-commit recovery.
4. **Lifecycle authority:** who may create/revise/retract acquisition and belief records; which operations are proposal-only; retention/deletion and audit obligations.
5. **Known-absent semantics:** what evidence establishes absence in a complete authorized actor/purpose scope, distinct from unknown, withheld, and incomplete.

### Memory-owned or joint Core/Memory decisions

1. **Candidate version/freshness contract:** stable record and source references/versions; what “current” means when the index lags canonical source validity.
2. **Lineage propagation:** representation of all source claims and versions for derived summaries, including nested derivations and incomplete lineage behavior.
3. **Access propagation and declassification:** whether a derived record inherits the strictest source restriction, can be safely recomputed from allowed sources, or can be declassified only by an explicit authorized decision. No implicit declassification by summarization.
4. **Independent lifecycle dimensions:** exact labels and transition rules for content disposition, reconciliation, evidence assessment, access outcome, lineage completeness, result completeness, and index health.
5. **Safe error/partial-result envelope:** which diagnostics may be returned under deny/withheld; guarantee that counts, snippets, titles, ranking explanations, and pagination do not leak restricted data.
6. **Index fallback and revalidation:** approved authoritative fallback or recheck path when index is stale/unavailable; no claim of absence when completeness cannot be proven.

### NPC-owned decisions resolved here

- Retrieval and prompt inclusion are non-persistent.
- NPC only admits candidates after access, scope, source, lineage, freshness, epistemic-kind, and completeness checks.
- Missing or ambiguous safety evidence fails closed.
- Producer provenance is not content lineage or verification.
- Conflicting evidence remains distinct absent an approved adjudication rule.
- Retry preserves unknown outcomes and uses owner-approved idempotency semantics; the key ingredients in this document are proposals only.
- NPC does not add local acquisition, delivery, belief, rollback, causality, or authorization storage.

## 9. Implementation boundary and acceptance checklist

Before marking this issue complete, the NPC branch should contain:
- [x] Candidate semantic requirements and consumer consequences.
- [x] Illustrative response shape explicitly marked proposal-only.
- [x] Numbered retrieval-to-knowledge lifecycle with design-only gates.
- [x] Negative-case matrix with content/prompt/persistence/owner/retry/test outcomes.
- [x] Lifecycle transition and ownership table.
- [x] Concrete setup/action/expected test plan, separated by executable layer.
- [x] Core vs Memory vs NPC decision ownership list.
- [x] Explicit rollback invalidation rule that does not depend only on a higher commit sequence.
- [x] Producer provenance/content lineage distinction and fail-closed summary rule.
- [ ] Production integration; blocked on owner-approved Core/Memory contracts and real host evidence.
- [ ] Tests against real Memory↔NPC production boundary; blocked until that boundary exists.

This document is a design deliverable, not evidence that the blocked items are implemented or that the acceptance tests pass.

## 10. Pure NPC candidate-admission oracle and executable coverage

The branch now includes:
- `src/npc/memory-candidate-eligibility.js` — a pure consumer-side admission oracle;
- `tests/npc-memory-candidate-eligibility.test.js` — Node test-runner coverage for its explicit behavior.

This helper is deliberately **not wired to a Memory/API call** and does not establish authenticity of caller scope, enforce access control, query current source state, or persist any semantic transition. It can only reject or admit candidate metadata based on evidence already supplied by a trusted, future integration boundary. The real authorized read must still apply access before content disclosure and revalidate before serialization.

The tests cover: incomplete trusted scope; foreign world; missing/denied/withheld/unknown request and candidate access; subject/purpose mismatch; missing record identity/version; unknown epistemic kind; stale/retracted/unavailable freshness; snapshot mismatch; derived summary lineage and source permissions; duplicate record/version; partial/unavailable retrieval; authorized complete empty results versus denied/withheld/scope-mismatched empty results; rejection-output leakage; and non-mutation of acquisition/delivery/belief/canonical state.

**Admission-oracle field boundary:** the helper requires a recognized `content_kind` (`claim`, `report`, `summary`, `author_initial`, `imported`, or `inference`) and a recognized `epistemic_kind`; unknown or absent kinds fail closed. `summary` additionally requires complete lineage and an affirmative access/currentness decision for every listed source. The helper also requires producer provenance (`producer.kind`) and all independent lifecycle dimensions. For admission it accepts only the positive lifecycle states explicitly illustrated by this proposal (`content_disposition=usable`, `source_reconciliation=current`, `access_outcome=allow`, `index_health=ready`); unknown states fail closed. `evidence_assessment` must be present but is not collapsed into a truth judgment. These are NPC-side semantic gates over supplied metadata, not an approved Memory API or proof that producer, lifecycle values, or access decision are authentic.

**Interpretation limit:** these tests establish the pure helper's fail-closed decision behavior only. They do not prove Memory authorization, source freshness, revocation races, summary derivation safety in a production pipeline, delivery/receipt, acquisition, belief persistence, rollback reconciliation, or prompt integration. No test execution result is claimed in this document unless separately confirmed by a run against the exact commit.

