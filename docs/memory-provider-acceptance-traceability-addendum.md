# Memory Provider acceptance traceability — follow-up addendum

**Current-main update (2026-10-25):** Provider lifecycle safeguards are merged in `9ca95312b35d6431699d736aef721602d26639f8`; Runtime CI run #2030 passed (592/592 repository tests and 8/8 oracle-harness tests; [run #2030](https://github.com/necromorphic/Logic-Engine/actions/runs/40203468760)). The historical PR #201 heads/runs below are preserved as historical evidence only.

This addendum corrects the two completed Provider-owned items still listed as future work in the original `memory-provider-acceptance-traceability.md` checklist and records the raw archive and typed-failure slices. The original register is retained as historical context rather than silently rewritten.

## Completed Provider-owned regressions

- The 51-record retrieval boundary is covered in `tests/sqlite-memory-provider.test.js`: only 50 candidates are returned and completeness is `partial` when a 51st authorized candidate exists.
- Interrupted index rebuild followed by reopen is covered in `tests/sqlite-memory-provider.test.js`: retrieval remains unavailable after the injected rebuild failure and provider restart.
- Interrupted reconciliation is covered in `tests/memory-provider-reconcile-interruption.test.js`: the test pauses at an awaited source-validation boundary, closes/reopens the same SQLite database, confirms retrieval fails with `MEMORY_INDEX_NOT_READY`, and then requires a successful complete reconciliation before retrieval resumes.
- Raw archive lifecycle is covered in `tests/memory-provider-raw-archive.test.js`: durable capture and digest, idempotent retry versus identity conflict, active-version switching without deleting alternatives, source deletion and dependent-copy invalidation, explicit purge with dependent-copy cascade, world isolation, fail-closed reads without trusted host authorization, active-version-only reads, restart persistence of deletion/invalidation, integrity mismatch rejection, and a second authorization check at the disclosure boundary.
- Typed readiness failures are covered in `tests/memory-provider-typed-failures.test.js`: source validation failure, incomplete inventory, Core snapshot outage, index rebuild failure, durable internal reason codes, generic non-disclosing retrieval failure after restart, and migration of a pre-existing readiness table without losing state.

## Exact-head test evidence

- Runtime CI run #1616: **success, 283/283 tests**, code/test HEAD `88451463bf4545adaaa38eab42e3df30f28da54f`.
- Run: https://github.com/necromorphic/Logic-Engine/actions/runs/40101226193
- The previous exact documentation HEAD passed run #1604 (282/282): https://github.com/necromorphic/Logic-Engine/actions/runs/40101053726
- The prior raw archive lifecycle code/test HEAD also passed run #1585 (278/278): https://github.com/necromorphic/Logic-Engine/actions/runs/40100622470.
- Provider-local tests do not establish that a SillyTavern hook, external archive/index purge, authoritative Core source-version API, or production Core → Provider → NPC integration exists.

## Implementation boundary and remaining gates

- The SQLite provider persists exact raw UTF-8 message text, role, metadata, capture time, and SHA-256 digest under world/conversation/message/version identity. Raw reads fail closed unless the trusted host injects `authorizeRawRead`; reads recheck authorization after loading data to narrow the TOCTOU window, without claiming cross-store atomicity.
- Selecting another swipe/generation changes only the active pointer; alternatives remain retained.
- Source deletion excludes that version from active reads and invalidates only dependent copies explicitly registered in this provider database. Permanent purge is a separate operation and cascades to those registered copies.
- Capture/version selection/dependent-copy registration/deletion/purge use SQLite immediate transactions to prevent provider-local lifecycle races. External stores and indexes are not managed by this operation.
- Typed failure codes are provider-internal diagnostics only. Retrieval continues to use generic fail-closed errors and does not expose the internal reason, source IDs, counts, or content. Boolean callbacks cannot prove more specific source/inventory outcomes than their contract returns.
- No public HTTP route, default-runtime wiring, SillyTavern capture hook, raw-body search/vector index, retention scheduler, or cross-store purge is implemented. Host authorization for capture, retention duration, and encryption-at-rest are not inferred by this provider slice.
- Source-specific authoritative validity/version, complete consistent source inventory, rollback/retraction reconciliation policy, and cross-store disclosure/revocation semantics remain blocked by Core Issue #140. Callback-backed fixtures remain fixture evidence, not source authority.
- Summary admission and NPC knowledge side effects remain excluded. Retrieval/context inclusion does not create belief, acquisition, receipt, or delivery.
- No universal source schema/version field, API, outbox, cursor, source-change journal, or parallel canonical store is introduced.

PR #201 is now superseded for code/tests by current-main integration #313. Production Memory→NPC stays disabled until owners approve the missing source/inventory/reconciliation/disclosure contract and real-adapter acceptance tests pass.

## Follow-up acceptance batch — 24 October 2026

- Historical PR #201 code/test HEAD before its documentation-only traceability update: `21a405c608c8599a135f5a35d4f544a2a2f0894b`; Runtime CI #40102186709 passed **286/286 tests**: https://github.com/necromorphic/Logic-Engine/actions/runs/40102186709.
- `tests/sqlite-memory-provider.test.js` now verifies that a thrown host/Core source-version validator is not collapsed into a normal record denial. Provider authorization raises only `MEMORY_SOURCE_VALIDATION_UNAVAILABLE`; host exception details are not propagated.
- The same test file verifies direct-source ingestion rejects derived summaries while lineage-wide authorization is unavailable.
- PR #183 adds real Core/NPC seam checks for query denial, per-record denial without identity/content leakage, read-only retrieval/context inclusion, and source-validator outage returning non-ready rather than ready-empty. Exact-head Runtime CI #40102217996 passed **298/298 tests** on `27523e0e592745ac995103b1a36e36d04f7f83c9`: https://github.com/necromorphic/Logic-Engine/actions/runs/40102217996.
- The source-validator exception fix was applied to both stacked PR branches so each branch's tests exercise the same fail-closed behavior. An earlier #183 run failed because that branch still had the old provider implementation; the failure exposed the missing propagation, and the corrected exact head passed.
- These tests establish only the in-process provider/Core/NPC seam and provider-local behavior. They do not close Core #140's authoritative source-version, complete-inventory, rollback/reconciliation, real host-adapter, or cross-store disclosure/revocation gates.

## Source-currentness versus access-denial follow-up — 24 October 2026

- Provider code/test HEAD `be20382ccc05cae5052de2223afc0d286a7728a5`; exact-head Runtime CI #40102439980 passed **287/287 tests**: https://github.com/necromorphic/Logic-Engine/actions/runs/40102439980.
- Candidate-time source validator exceptions raise generic `MEMORY_SOURCE_VALIDATION_UNAVAILABLE`; a validator returning `false` raises generic `MEMORY_SOURCE_VERSION_UNVERIFIABLE`. Both cause the Core/NPC consumer to return non-ready instead of filtering a potentially stale record into a false ready-empty result. Host details are not surfaced.
- New Provider unit coverage verifies that source version becoming unverifiable after a previously current reconciliation is not collapsed into an ordinary record denial.
- PR #183 exact head `bd5dd74c5cbb159d244aa8517bb730c01d767baf`; exact-head Runtime CI #40102454110 passed **300/300 tests**: https://github.com/necromorphic/Logic-Engine/actions/runs/40102454110. Added real-seam tests for query authorization outage and source becoming stale after reconciliation.
- Explicit Memory record grants remain ordinary access denials; trusted source validation failure is treated as source-currentness uncertainty, not as proof that the user has no accessible memories.


## Joint Host/Provider mapping follow-through — Provider-owned verification

- Follow-up commit: `0c7b4abd8a5b3547304f452380b310bb155aeb52`.
- Exact-head Runtime CI run #1784: **290/290 tests passed**: https://github.com/necromorphic/Logic-Engine/actions/runs/40121937992
- Added `tests/memory-provider-raw-archive.test.js` regression coverage:
  - repeated exact-version tombstone remains idempotent across replay/restart;
  - replaying the identical original capture does not resurrect a tombstoned version;
  - known dependent-copy invalidation and the original deletion timestamp survive restart;
  - selecting a tombstoned version remains rejected;
  - if the exact source is tombstoned during the second/final raw-read authorization check, the read returns `MEMORY_RAW_VERSION_UNAVAILABLE` rather than disclosing the content.
- This closes Provider-local test gaps only. It does **not** establish Host ID persistence, pre-mutation deletion identity, complete `memory_raw_captures` inventory, source authority, or a production Host→Provider caller. No new API/schema or runtime integration was introduced; Memory→NPC remains **DISABLED / FAIL-CLOSED**.


## ТЗ-2 — согласование версий и отзыв данных (exact reviewed head)

Reviewed Provider/Core/NPC branch HEAD: `791c52eb994011cbb0474ab48895413be3a1aef0` (PR #504, branch `test/provider-consumer-real-sqlite-2026-10-27`; base is `coord/core-source-version-consolidated`, not current `main`). Exact-head CI: [Runtime run #40577381900](https://github.com/necromorphic/Logic-Engine/actions/runs/40577381900) — repository tests **817/817**, recalculation oracle **8/8**, NPC boundary **83/83**; all jobs passed. This is evidence for that exact branch head only, not a claim that PR #504 is merged or based on current main.

### Behavior matrix

| Scenario | Existing executable evidence | Result / limit |
|---|---|---|
| Exact repeated record ingest / conflicting same identity-version payload | `tests/sqlite-memory-provider.test.js` — duplicate ingest and immutable identity rebinding | Identical replay is idempotent; conflicting payload/version binding is rejected. |
| Active raw-message variant changes | Provider `selectActiveRawVersion`; `tests/memory-provider-raw-archive.test.js` | Selection changes the pointer only; alternatives remain archived. This raw Host path is currently denied/disabled pending trusted Host handoff. |
| Exact-version deletion/tombstone | `tests/memory-provider-raw-tombstone.test.js`, `tests/memory-provider-raw-archive.test.js` | Tombstone applies only to the exact known version; repeated tombstone is idempotent; unknown version is not guessed; tombstoning the active version clears that pointer. |
| Known dependent-copy invalidation | Raw archive/tombstone tests | Only dependent copies registered in this Provider database are invalidated. External indexes/stores and unknown dependants are outside the guarantee. |
| Source entity update, deletion/status change, or stale source version | `tests/canonical-entity-source-version.test.js`, `tests/memory-provider-core-integration.test.js`, `tests/memory-provider-file-backed-reconciliation.test.js` | Current canonical source-version mismatch or non-active/missing source fails closed; Core outage is non-ready, not empty. |
| Rollback with unchanged `commit_sequence` | `tests/memory-provider-lifecycle-regressions.test.js`, `tests/memory-provider-file-backed-reconciliation.test.js` | Stale prior version is rejected; Provider does not treat the composite world cursor as a source-specific journal. |
| Interrupted reconciliation and restart | `tests/memory-provider-reconcile-interruption.test.js` | Reopened Provider stays non-ready until a complete successful reconciliation. |
| Restart/replay and persistent revocation | `tests/memory-provider-file-backed-reconciliation.test.js`, raw tombstone tests | Grants/revocations, tombstones and active-version state persist; original capture replay does not resurrect a tombstoned version. |
| Revocation while reading/authorizing | `tests/memory-provider-query-revocation-race.test.js`, `tests/memory-provider-core-integration.test.js`, raw archive tests | Query/record revocation during awaited validation is rechecked and fails closed. The final check narrows TOCTOU but is not an atomic disclosure lease. |
| Incomplete/unavailable inventory | `tests/memory-provider-core-integration.test.js`, `tests/memory-provider-typed-failures.test.js` | Reconciliation/read becomes non-ready; Provider row counts do not prove Host inventory completeness. Positive inventory callbacks in tests are fixtures, not Host evidence. |
| Restore of prior content/version | `tests/memory-provider-coordinated-restore.characterization.test.js` | A normal source-version change invalidates old candidates. **Known blocker:** coordinated restoration of matching Core and Provider database backups can reproduce the old matching state and cannot be detected by current snapshot/version markers alone. Requires a Core-owned restore-resistant authority signal; Provider must not invent one. |

### Trust boundary and source-version contract

- Provider's raw archive key is `(world_id, conversation_id, message_id, version_id)`; that is a storage identity tuple, **not** proof that the caller is authorized to assert those IDs. Current raw Host capture and disclosure are deliberately denied by tests until the trusted Host/Core handoff is approved. The actual SillyTavern source tuple, durable ID lifecycle, and complete historical inventory are therefore **not verified/production-integrated**.
- The executable `createCanonicalEntitySourceVersionValidator` currently accepts a canonical decimal string equal to the active entity's `updated_revision`, with exactly one matching direct-source lineage entry. Its tests cover malformed decimal values, stale revisions, rollback, destroyed/missing entities and Core outage.
- The requested opaque token spelling `core-entity-v1:N` is **not accepted by that validator as currently implemented**: the validator explicitly checks canonical decimal `N`, not the prefixed token. Do not silently strip the prefix or claim support. Core must confirm whether this token is a distinct wrapper at the Core/consumer boundary or the value Provider must persist and validate; then add exact contract tests on the agreed representation. This is an owner-contract discrepancy, not evidence that a prefixed token already works.
- The current source validator supports only direct `canonical_entity` lineage with one source. Host-message sources, summaries, and arbitrary multi-source lineage are not approved by this validator.
- Reconciliation can prove currentness only against the supplied trusted validator/inventory callbacks. The current test callback `validateInventory: async () => true` is a fixture; it is not a production completeness proof.

### Acceptance status

**Provider-local lifecycle and real in-process Core/NPC seam: tested at the exact PR #504 head. Overall TЗ-2: PARTIAL / BLOCKED.** Remaining blockers are (1) trusted Host tuple and complete source inventory, (2) explicit Core decision on `core-entity-v1:N` representation, (3) detection of coordinated Core+Provider restore, and (4) atomic final disclosure/revocation semantics. Production Memory→NPC remains **DISABLED / FAIL-CLOSED**. No new API, schema, store, journal, or cursor is introduced by this addendum.
