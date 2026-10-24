# Memory Provider acceptance traceability (Issue #181)

**Status:** audit of the current provider vertical slice and stacked internal-import PR. This is a test-gap register, not an assertion that blocked behavior is implemented. The provider remains draft-only; Core issue #140 blocks production Memory→NPC wiring.

## Evidence boundary

- Provider implementation: `src/application/sqlite-memory-provider.js` in PR #182.
- Provider tests: `tests/sqlite-memory-provider.test.js`.
- Internal import seam: `src/application/memory-provider-import-internal.js`, tested by `tests/memory-provider-import-internal.test.js` in stacked PR #201.
- Repository-native command: `npm test` (`node --test`). PR #201 exact-head CI passed at `ce687735f50b0e6c8cc926abe517a5ce9512f952` before the latest added provider tests; a new exact-head CI run is required for the added tests.
- Existing CI evidence is not end-to-end provider → Core authorization → NPC admission evidence.

## Acceptance traceability

| Issue #181 requirement | Current executable evidence | Status / remaining closure |
|---|---|---|
| Durable record identity/version, lineage and restart recovery | SQLite provider persistence/reopen/rebuild test | Provider-local slice implemented; no raw message-body archive |
| Idempotent duplicate ingest; conflicting identity rejected | Provider duplicate-ingest test; import-facade idempotency test | Covered for supported direct canonical-entity records |
| Raw ingest survives derived-index failure | Injected index insert failure, raw row survives, rebuild restores readiness | Provider-local behavior covered |
| Query denial and per-record revocation | Default-deny/revocation test; authorization rechecks grant after awaited source validation | Provider-local boundary covered; not a Core authorization decision |
| Snapshot unavailable/stale and inventory incomplete | Tests assert fail-closed behavior | Covered as adapter-fixture behavior; snapshot pair is not a source change journal |
| Cross-world record/grant isolation | Added test: same record ref/version in two worlds, separate subjects, independent retrieval | Added in this branch; pending exact-head CI |
| Authorized complete-empty vs denied | Added test: ready empty result vs `MEMORY_QUERY_DENIED` | Added in this branch; pending exact-head CI |
| Partial result semantics | Retrieval caps candidates at 50 and returns `partial` when a 51st exists | Existing code path; dedicated 51-record regression test still needed |
| Restart during reconciliation | Restart after successful reconcile is covered; crash/restart mid-reconciliation is not | Missing test; readiness marker should fail closed after interrupted work |
| Rollback with unchanged `commit_sequence` | No approved source-specific rollback signal; snapshot revision comparison exists | **Blocked by Core #140**; needs approved source lifecycle signal and real-path test |
| Source deletion/retraction and dependent invalidation | No raw content store, source deletion hook, dependent-copy graph, or purge operation | **Not implemented**; requires approved source identity/version/deletion contract |
| Derived summary with revoked/missing/stale/cross-world lineage source | Summary records are rejected at ingest | Direct-source first slice deliberately excludes summaries; derived-summary behavior needs separate approved lineage/authorization contract and tests |
| Final disclosure-time revalidation for candidate A while candidate B authorization is awaited | Per-candidate authorization rechecks provider grants after its own awaited validation | **Not equivalent** to a consumer-side final sweep over a candidate batch; needs Core consumer integration and race test |
| Complete-empty, denied, withheld, partial, unavailable, stale, rebuilding are distinct | Complete-empty/denied and unavailable/stale/rebuilding error paths partially covered | `withheld` is not an implemented Provider result state; complete state/status matrix and per-state tests remain |
| No content/snippet/count/diagnostic leakage | Current provider returns metadata candidates, no body/snippets or `missing_ids` diagnostics | Metadata-only does not prove future public projection safety; test public projection once it exists |
| Retrieval/context inclusion does not persist delivery, receipt, acquisition, belief | Provider does not implement these NPC lifecycle writes | Provider scope boundary is explicit; end-to-end non-persistence test belongs with real consumer integration |
| Real Provider → Core authorized read/final revalidation → NPC admission | No production wiring; PR #183 is a separate draft integration seam | **Blocked by Core #140**; do not mark satisfied by provider unit tests or fixtures |

## Required next actions by owner

### Provider-owned and safe to continue

1. Add regression for the 51-record partial-result boundary.
2. Add interrupted-rebuild/reopen readiness test using a controlled injected failure; verify retrieval cannot observe a ready marker.
3. Keep error envelopes generic and avoid returning missing IDs/counts to clients by default.
4. Preserve exact-head CI evidence after every code change.

### Core / cross-block decisions required

1. Approve authoritative source identity/version and source deletion/retraction signal; specify rollback behavior even when `commit_sequence` does not increase.
2. Approve the trusted authorized-read contract and disclosure-time revalidation boundary, including candidate-batch races and non-disclosure of content, snippets, counts, and diagnostics.
3. Approve the source inventory contract used by reconciliation; a fixture callback is not production authority.
4. Approve any future derived-summary lineage/authorization semantics before summary admission is enabled.
5. Close Core issue #140 and run real provider → Core → NPC integration tests before production wiring.

## Non-claims

- The internal import facade is single-record only; no batch atomicity is promised.
- `world_revision + commit_sequence` is only a composite snapshot marker, not a durable source-specific journal.
- A passing provider-only suite does not prove Core authorization, NPC epistemic admission, delivery, receipt, acquisition, or belief behavior.
- No PR in this chain is approved for merge or production activation by this document.
