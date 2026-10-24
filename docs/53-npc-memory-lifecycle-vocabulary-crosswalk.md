# NPC↔Memory Lifecycle and Type Vocabulary Crosswalk

Status: NPC-owned proposal for cross-block review; documentation only. This is not an approved enum registry, adapter, schema, or runtime API.

Date: 2026-10-24

Related:
- `docs/52-npc-memory-consumption-contract-and-failure-matrix.md` — NPC candidate requirements and failure semantics.
- Core Memory PR #68, especially proposed `docs/65-core-memory-record-contract.md` and `docs/66-core-memory-retrieval-contract.md`.
- Issue #70, latest vocabulary crosswalk work order.

## 1. Rules before mapping

1. These vocabularies belong to different proposals and neither enum set is approved. A lexical similarity is not evidence of semantic equivalence.
2. Keep **record type/content kind**, **epistemic kind**, **content disposition**, **source reconciliation/freshness**, **per-request access**, **index health**, and **result completeness** as separate dimensions.
3. A mapping may be applied only after the owner-approved contract establishes equivalent semantics and trusted scope. Until then this table is a review recommendation, not executable conversion logic.
4. Missing, unknown, contradictory, or lossy values fail closed for current model-facing use. Do not turn them into an empty successful result, canonical knowledge, or a positive access decision.
5. Memory producer provenance answers who/what created or transformed a record; content lineage answers which sources support its claims. Neither substitutes for the other.

Mapping labels:
- **Exact** — same meaning and scope, subject to trusted binding.
- **Conditional** — potentially compatible only with additional approved evidence/policy.
- **Lossy** — the target cannot preserve the source distinction.
- **Invalid** — no safe direct conversion; do not map.

## 2. Lifecycle and retrieval crosswalk

| Concern | NPC proposal/oracle vocabulary | Memory proposal vocabulary | Mapping assessment | NPC consumer rule / approval owner |
|---|---|---|---|---|
| Content disposition / candidate usability | `usable` | `active`, `superseded`, `retracted`, `deleted` | **Invalid as a direct enum mapping; conditional as a derived decision.** | `usable` is an NPC eligibility conclusion, not the same dimension as a record's disposition. `active` alone does not establish source freshness, access, lineage, snapshot consistency, or admissibility. `superseded` may be historically relevant only under an approved historical-use policy; `retracted` and `deleted` fail closed for ordinary current-use context. Memory owns disposition semantics; NPC owns its admission policy; Core approves canonical-validity implications. |
| Source reconciliation | `current` | `current`, `stale`, `pending_reconciliation`, `source_unavailable` | **Exact only for the positive `current` label after scope is confirmed; otherwise invalid for current use.** | Memory's `current` must mean the source references/versions have been reconciled under an approved rule. Stale, pending, unavailable, missing, or unknown states cannot be treated as current. Core owns source validity and rollback semantics; Memory owns reconciliation reporting; NPC must fail closed. |
| Request access | `allow` | `allowed`, `withheld`, `denied`, `not_found` | **Conditional** for `allow` ↔ `allowed`; other values are **invalid** as allow. | Equivalent only if the decision is genuine, request-scoped, and bound to the trusted world, subject/recipient, purpose, and applicable source/snapshot. String equality alone cannot authenticate it. `withheld`, `denied`, `not_found`, missing, or ambiguous access never becomes `allow`. Do not leak existence through counts, snippets, reasons, or status differences. Core + Memory approve the authorization contract. |
| Index health | NPC helper result `status=ready` | `current`, `lagging`, `unavailable`, `rebuilding` | **Invalid as a direct mapping.** | NPC `ready` means the supplied request/result envelope passed top-level checks; it is not index health and does not mean every candidate was admitted. Memory `current` describes an index, not source validity or authorization. Lagging results require an explicit approved partial/staleness contract; unavailable/rebuilding must not silently become an empty search. Memory owns index health; NPC owns safe use of the result. |
| Query/result completeness | NPC oracle currently requires `completeness=complete` | Memory retrieval proposal: complete / partial / unavailable outcomes | **Exact only for a semantically equivalent, trusted `complete` result.** | Partial or unavailable must not be normalized to complete or to “no matches.” Unknown completeness is non-ready. Memory defines retrieval completeness/error semantics; NPC defines whether a use case can tolerate a known partial result. |
| Freshness | NPC source freshness `current` | Memory source reconciliation plus retrieval/snapshot metadata | **Conditional, not one-field equivalence.** | A current index or active record does not prove current sources. Require source-version/reconciliation evidence and any snapshot consistency required by the operation. Rollback must be observable even if max commit sequence does not increase. Core owns canonical validity/cursor guarantees; Memory owns reporting/reconciliation; NPC fails closed until defined. |
| Evidence assessment | `unassessed`, `supported`, `disputed`, `insufficient` | Same proposed labels | **Exact as labels only; semantic use remains conditional.** | Preserve the value without reinterpreting it. `supported` is not automatically canonical truth; `disputed` is not the same as retracted; `insufficient` is not absence; `unassessed` is not verified. Admission preserves qualification but does not adjudicate evidence. Memory proposes the vocabulary; Core/domain owners must approve its policy meaning. |
| Producer provenance | NPC `producer.kind` (optional producer reference) | Memory `record_production` | **Conditional; NPC's minimal field is weaker.** | A producer kind alone does not authenticate the producer or prove the content source. If producer identity/verification is required by an approved policy, the caller must supply trusted evidence; otherwise treat provenance as unverified and do not elevate claims. Memory defines record-production semantics; Core/host boundary establishes trust. |
| Content lineage | NPC `lineage.sources[]` with source ref/version/world/access/freshness | Memory `content_lineage` / `source_refs[]` with source identity/version/role and world scope | **Conditional; likely lossy unless all required bindings survive.** | Every materially contributing source must remain identifiable and versioned, and its current world scope/access/freshness must be evaluated for the same request. A summary producer is not the author/verifier of its claims. Incomplete/unavailable lineage fails closed for derived content. Memory owns lineage representation; Core + Memory approve source-access propagation/declassification; NPC validates available evidence. |

## 3. Epistemic kind and record/content type are different axes

### 3.1 Epistemic-kind crosswalk

| NPC proposed value | Closest Memory proposed term(s) | Assessment | Safe rule |
|---|---|---|---|
| `canonical` | `canonical_reference` | **Conditional, not exact.** | A reference to a canonical source is not itself a verified current proposition or actor knowledge. Require trusted source identity, current validity, approved access, and an explicit policy for how the referenced fact may be represented to the subject. Never promote a reference merely because its kind says canonical. |
| `acquired_report` | `reported` (possibly `asserted`) | **Conditional.** | Memory's report/claim describes the record's epistemic source; NPC's `acquired_report` implies an actor-relative acquisition state. A stored report does not prove that a particular subject received or acquired it. Require a separate Core-owned acquisition record before using the actor-relative label. |
| `rumor` | `reported` / `asserted` | **Lossy without extra attribution.** | Do not infer rumor status from generic reported/asserted content. Preserve attribution and epistemic qualification; if rumor classification is not explicit and approved, keep kind unknown/non-admissible for a policy requiring it. |
| `inference` | `hypothesis` (sometimes a derived claim) | **Conditional.** | A hypothesis may be a proposal rather than an NPC-generated inference. Preserve who inferred it, from which evidence, for which subject, and under which approved inference semantics. Never turn it into canonical truth. |
| `authored_initial` | Possibly `asserted` or `observed`; Memory has no direct equivalent established | **Invalid as a direct mapping.** | Author-provided initial knowledge has distinct initialization/authority semantics. Keep the NPC type explicit; require a trusted import/authoring path and provenance contract. Do not infer it from ordinary assertion text. |
| `imported` | `asserted`, `reported`, or a record with `record_production` metadata | **Invalid as a direct mapping.** | Import route is provenance/ingestion information, not epistemic status. Preserve both import provenance and the epistemic status of the imported payload. Require trusted source binding; unverified imported content must not be promoted. |
| No direct NPC equivalent | Memory `observed` | **Conditional.** | Observation is a source/evidence classification, not necessarily a durable NPC acquisition. Map only when the observation's observer, time, source, and acquisition evidence meet the approved NPC contract. |
| No direct NPC equivalent | Memory `derived_summary` | **Invalid as a direct epistemic-kind mapping.** | “Derived summary” describes derivation/record character, not truth status. Preserve the summary record type, its epistemic qualification, and full lineage independently. |

### 3.2 Content kind versus Memory record type

These labels answer different questions and must not share one enum by convenience.

| NPC `content_kind` | Possible Memory `record_type` | Assessment |
|---|---|---|
| `summary` | `summary` | **Conditional** if lineage, versions, access propagation, and epistemic status survive. |
| `claim` / `report` | `evidence` | **Conditional** on payload semantics and attribution; one evidence record may contain a claim or report, but the labels are not synonyms. |
| `author_initial` / `imported` | `evidence`, `episode`, or `source_reference` | **No direct mapping.** The Memory record type cannot prove the trusted initialization/import route. |
| `inference` | `evidence` or `summary` | **Conditional and potentially lossy.** Record type alone cannot establish that the content is an inference or who owns it. |
| Any NPC content kind | `source_reference` | **Not a content-kind equivalent.** It identifies a reference/pointer; inspect the referenced source through an approved authorized boundary. |
| No direct NPC equivalent | `episode` | **No direct mapping defined.** An episode may bundle events, messages, and claims; a consumer-specific projection must preserve their individual semantics. |

Do not map a Memory `record_type` to NPC `epistemic_kind`, or vice versa. Where both axes are present, preserve both.

## 4. Fail-closed conditions and decision ownership

The following conditions are non-admissible for current model-facing knowledge unless an approved, narrower use policy explicitly permits them:

- absent, unknown, contradictory, or untrusted access decision;
- world/subject/purpose mismatch or unproven binding;
- `withheld`, `denied`, or safely indistinguishable `not_found` result;
- source `stale`, `pending_reconciliation`, `source_unavailable`, retracted/deleted disposition, or unknown freshness;
- incomplete/unavailable summary lineage or any materially contributing source whose current access cannot be established;
- index unavailable/rebuilding, or lagging/partial results where the operation requires completeness/currentness;
- unknown record/content/epistemic kind or attempted conversion that erases distinctions such as report versus acquisition, reference versus truth, or summary producer versus source author;
- missing snapshot components or inconsistent source versions where snapshot consistency is required.

Safe failure means: do not include protected content in prompt context; do not persist acquisition, delivery success, belief, or canonical state from this candidate; do not expose rejection reasons/counts that reveal protected record existence; and do not silently replace unavailable/partial retrieval with an empty successful result. A non-ready result is not proof that no matching record exists.

Ownership decisions still required:
- **Core:** trusted actor/request binding; canonical source validity; rollback/revision and snapshot consistency; approved authorized-read decision interface and failure semantics.
- **Memory:** record-type and epistemic-kind definitions; lifecycle dimension semantics; retrieval completeness/index-health reporting; lineage versioning and source-change reconciliation; safe derived-content access propagation.
- **NPC:** actor-relative acquisition meaning; admissibility and prompt-use rules; preservation of uncertainty; behavior on partial/non-ready candidates.
- **Core + Memory + NPC:** exact crosswalk acceptance tests and the boundary where validated metadata becomes trustworthy evidence. No block can approve the others' authority by defining a local mapping.

## 5. Required boundary tests (future contract tests, not current runtime tests)

1. **Disposition is not usability:** an `active` record with stale source, denied access, or incomplete lineage is not admitted; a `superseded` record is not admitted to current-use context unless a separately approved historical-use mode applies.
2. **Access binding:** `allowed` without trusted matching subject/purpose/world binding is not accepted as NPC `allow`; `withheld`, `denied`, and protected `not_found` expose no content/count/snippet/diagnostic distinction.
3. **Index versus result readiness:** `current` index with stale/retracted source is not current knowledge; `unavailable`/ `rebuilding` does not return a false empty result; `lagging` is explicitly partial or fails closed.
4. **Epistemic preservation:** Memory `reported` does not create `acquired_report` without a Core acquisition record; `canonical_reference` does not become canonical knowledge merely through mapping; `hypothesis`/summary never silently becomes canonical.
5. **Lineage access propagation:** a multi-source summary is withheld when one material source is inaccessible, stale, or retracted unless an approved safe re-derivation/declassification path applies.
6. **Assessment orthogonality:** `supported`, `disputed`, `insufficient`, and `unassessed` remain distinct from disposition, freshness, and access; no automatic winner is chosen.
7. **No unsupported API assumptions:** tests against the current pure NPC oracle may validate its supplied-metadata behavior only. Authentic authorization, race-free revocation, source-change delivery, transaction atomicity, and real Memory-to-NPC serialization require owner-approved integration-boundary tests and must not be reported as implemented by this document.

No test is claimed to have run against a production Memory↔NPC integration. The current pure oracle's existing test suite and CI result remain separate evidence; this document introduces proposed future boundary tests, not a new runtime guarantee.
