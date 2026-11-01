# Issue #317 P0 admission boundary — implementation evidence

Date: 2026-11-01
Status: Existing admission and epistemic separation are retained; real Provider integration coverage is being extended.

## Admission rule

The NPC admission oracle is an eligibility and disclosure boundary, not a truth adjudicator. It admits reference metadata for known evidence assessments (`unassessed`, `supported`, `disputed`, `insufficient`) when the independent scope, access, lifecycle, freshness, snapshot, provenance and lineage checks pass.

Rejected candidates contribute no identifier, content, snippet, per-candidate reason or rejection count to the returned projection. Unknown or malformed assessment values fail closed.

## Knowledge versus belief

Retrieval/admission makes permitted knowledge available as attributed material; it does not establish that the NPC believes the claim. `mapMemoryEvidenceToNpcEpistemicStatus()` maps the evidence class separately:

- `unassessed` → no belief-revision mapping;
- `supported` acquired report → `unconfirmed_report`, never `confirmed`;
- `disputed` acquired report → `unconfirmed_report`, with the reducer prohibiting a directional stance;
- `insufficient` → `unknown`, which cannot support a directional or unresolved belief.

The epistemic reducer separately enforces belief revision. Conflicting disputed evidence can only produce an unresolved stance when both polarities are represented. Invalidated/revoked evidence cannot be used for a new belief revision and marks existing beliefs for review.

## Core result envelope and real Provider evidence

PR #845 contains the file-backed SQLite Provider → Core → NPC consumer integration. Its new integration test exercises all four recognized assessment values through the real adapter and checks that the consumer preserves the classification without leaking private content. The test also checks the separate NPC epistemic mapping.

PR #846 supplies a separate authenticated Core request boundary and final field reread. Its Host final-dispatch integration and complete Host inventory remain outside this P0 slice. No end-to-end production delivery or sole-egress authorization is claimed.

## Diagnostics and disclosure

The NPC admission helper exposes no diagnostics object, snippet, candidate rejection reason or rejected count. The consumer's non-ready outcomes use fixed generic reason codes; Provider exceptions and raw error text are not copied into results. Real-adapter denial/revocation tests must continue to assert no content, identifiers or counts are disclosed.

## Acceptance evidence

| Requirement | Evidence | Status |
|---|---|---|
| Admission boundary | NPC candidate eligibility tests for scope, access, source, freshness, snapshot, lineage and malformed inputs | Existing tests; exact-head CI required |
| Core result envelope | File-backed Provider → Core → NPC integration in #845; authenticated Core request boundary in #846 | Integration candidate; cross-PR exact-head validation required |
| Insufficient/disputed evidence | Real Provider classification test plus reducer tests blocking unsafe belief revisions | Added to #845; CI pending |
| Revoked evidence | Provider authorization-generation and revocation/re-grant integration tests in #845 | Existing coverage; exact-head CI required |
| Diagnostics/snippet/count non-disclosure | NPC oracle and consumer non-disclosure tests; real Provider integration assertions | Partial; inspect exact-head test results |
| Context / knowledge / belief separation | Consumer retrieval is read-only; epistemic reducer owns receipt/evidence/belief transitions separately | Existing contract and tests; no production runtime wiring |
| Real Provider adapter | File-backed SQLite Provider → Core AuthorizedReadService → MemoryNpcConsumer | Added assessment matrix; CI pending |

## Production disposition

Memory → NPC remains **DISABLED / FAIL-CLOSED**. No Host route, final-send dispatch, automatic acquisition or belief persistence is enabled by these changes. PRs #845/#846 are not merged or treated as production acceptance.