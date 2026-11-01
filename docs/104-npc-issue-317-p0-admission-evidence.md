# Issue #317 P0 admission boundary — implementation evidence

Date: 2026-11-01  
Status: NPC-owned admission correction implemented; real Provider integration remains a cross-PR acceptance gate.

## Admission rule

evaluateMemoryCandidateAdmission() is a pure metadata eligibility oracle. A candidate crosses the NPC admission boundary only when its evidence assessment is exactly supported. The following are non-admissible:

- unassessed
- disputed
- insufficient
- missing, malformed, or unknown assessment values

A rejected candidate does not contribute an identifier, content, snippet, per-candidate reason, or rejection count to the returned projection. The helper still reports a generic complete-result status when the trusted request/result envelope itself is valid; this does not mean any candidate was admitted.

## Lifecycle separation

Admission does not establish context inclusion, rendering, delivery, receipt, acquisition, or belief. The existing Core acquisition/belief candidate in PR #721 is a separate Core-owned transition path; the NPC reducer must not infer belief from retrieval or admission.

## Core result envelope and real Provider evidence

The current main consumer has fixture-backed coverage for Core authorized reads, snapshot equality, source revalidation, and Memory authorization. It does not yet prove the new supported-only admission rule against the real file-backed Provider adapter.

PR #845 contains the real SQLite Provider → Core → NPC consumer integration harness and currently uses an unassessed fixture in its positive-path test. Once the supported-only rule is applied to that branch, that fixture must be changed to supported, and real-adapter negative cases for unassessed, disputed, and insufficient must assert no content/snippet/identifier/count disclosure. This is a required follow-up before P0 can be marked complete.

PR #846 supplies the separate authenticated Core request boundary and final field reread. Its current PR description still identifies Host final-dispatch integration and complete Host inventory as outstanding. No claim of end-to-end production delivery or sole-egress authorization is made here.

## Diagnostics and disclosure

The NPC admission helper exposes no diagnostics object, snippet, candidate rejection reason, or rejected count. The consumer's non-ready outcomes are fixed generic reason codes; Provider exceptions and raw error text are not copied into results. Diagnostics refinement in the Provider adapter must remain non-content-bearing and must not expose record-level counts or identifiers.

## Required acceptance evidence

| Requirement | Current evidence | Status |
|---|---|---|
| Supported-only admission | New NPC unit regression tests on this branch | Pending exact-head CI |
| Core result envelope correctness | Existing consumer fixture tests; real adapter integration in #845, authenticated Core request boundary in #846 | Partial; exact-head cross-PR integration required |
| Insufficient/disputed/revoked evidence | Existing unit and Provider revoke tests; new supported-only tests cover evidence classes | Partial; real-adapter evidence assessment cases required |
| Diagnostics/snippets/count non-disclosure | NPC oracle serialization tests and consumer non-disclosure tests | Partial; real adapter output assertions required |
| Context / knowledge / belief separation | NPC lifecycle reducer and Core acquisition/belief candidate remain separate | Partial; no production runtime wiring |
| Real Provider adapter | File-backed SQLite integration harness exists in #845 | Not yet tested against the new supported-only gate |

## Production disposition

Memory → NPC remains **DISABLED / FAIL-CLOSED**. This branch does not add Host routes, dispatch, transport, persistence, acquisition, or belief transitions. It does not merge #845/#846 or claim their evidence as accepted production integration.