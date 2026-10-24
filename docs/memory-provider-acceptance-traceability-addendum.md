# Memory Provider acceptance traceability — follow-up addendum

**Applies to:** PR #201. Exact current HEAD `7a5bfa7cb48c9e6e36c73331424df08cfa53e286` passed Runtime CI run #1604 with **282/282 tests**.

This addendum corrects the two completed Provider-owned items still listed as future work in the original `memory-provider-acceptance-traceability.md` checklist and records the raw archive and typed-failure slices. The original register is retained as historical context rather than silently rewritten.

## Completed Provider-owned regressions

- The 51-record retrieval boundary is covered in `tests/sqlite-memory-provider.test.js`: only 50 candidates are returned and completeness is `partial` when a 51st authorized candidate exists.
- Interrupted index rebuild followed by reopen is covered in `tests/sqlite-memory-provider.test.js`: retrieval remains unavailable after the injected rebuild failure and provider restart.
- Interrupted reconciliation is covered in `tests/memory-provider-reconcile-interruption.test.js`: the test pauses at an awaited source-validation boundary, closes/reopens the same SQLite database, confirms retrieval fails with `MEMORY_INDEX_NOT_READY`, and then requires a successful complete reconciliation before retrieval resumes.
- Raw archive lifecycle is covered in `tests/memory-provider-raw-archive.test.js`: durable capture and digest, idempotent retry versus identity conflict, active-version switching without deleting alternatives, source deletion and dependent-copy invalidation, explicit purge with dependent-copy cascade, world isolation, fail-closed reads without trusted host authorization, active-version-only reads, restart persistence of deletion/invalidation, integrity mismatch rejection, and a second authorization check at the disclosure boundary.
- Typed readiness failures are covered in `tests/memory-provider-typed-failures.test.js`: source validation failure, incomplete inventory, Core snapshot outage, index rebuild failure, durable internal reason codes, and generic non-disclosing retrieval failure after restart.

## Exact-head test evidence

- Runtime CI run #1604: **success, 282/282 tests**, exact current HEAD `7a5bfa7cb48c9e6e36c73331424df08cfa53e286`.
- Run: https://github.com/necromorphic/Logic-Engine/actions/runs/40101053726
- The code/test commit also passed run #1599 (282/282): https://github.com/necromorphic/Logic-Engine/actions/runs/40100990862
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

PR #201 remains draft and unmerged, stacked on PR #182. Production Memory→NPC stays disabled until the owners approve the missing source/inventory/reconciliation/disclosure contract and real-adapter acceptance tests pass.
