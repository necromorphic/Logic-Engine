# NPC Memory Candidate Admission — Evidence Note

Date: 2026-10-24  
Owner: NPC  
Scope: pure candidate-admission oracle and current verification evidence; not production Memory→NPC integration approval.

## Source and test identity

The superseded Draft PR #76 points at branch head `e3e8fc43e2488227b74ded67434aed522c5ec484`. GitHub Actions has no workflow run associated with that exact old head.

The candidate-admission implementation and its focused test file are already on current `main` through merged PR #78. The exact current file blob identities are:

| Artifact | Blob SHA |
| --- | --- |
| `src/npc/memory-candidate-eligibility.js` | `c3b540588d64b653d448d4af62c7f255e2d11245` |
| `tests/npc-memory-candidate-eligibility.test.js` | `08fd5785f72e7bca39d62aea6b7b8bcf8480a0fe` |

These same source and test blob SHAs were verified on `feat/npc-subsystem`; therefore PR #76 has no remaining implementation/test delta relative to #78. The stale branch contains 255 commits and 26 changed files, so merging or rebasing it wholesale is not justified. NPC contract documents from that branch have been ported/reconciled on `main`; their current-main text is not to be overwritten with the older branch copies.

## Native test evidence

- Native command: `npm test` (repository script invokes `node --test`).
- Result: **passed** in GitHub Actions Runtime tests run [#40061707222](https://github.com/necromorphic/Logic-Engine/actions/runs/40061707222).
- Tested commit: `e06cb35b85a399238cea5ad0ac6dcb3043792b05`, the two-file candidate-admission slice merged via PR #78.
- The workflow job `test` and its `Run npm test` step both completed successfully.
- This run verifies the same source/test blob identities listed above. It is **not** evidence of a run on PR #76's old head.
- A local run was not possible in the current execution environment because it could not resolve `github.com`; no local result is claimed.

## Oracle coverage verified in the current test file

The 26 named `node:test` cases cover:

- trusted request/result scope and subject-/purpose-bound allow decisions;
- candidate world scope and derived-summary source lineage, including source world, subject, purpose, currentness, identity, and version;
- missing/unknown content kinds and epistemic kinds failing closed;
- preservation of all four evidence assessments: `unassessed`, `supported`, `disputed`, and `insufficient`;
- no per-candidate rejection reasons/counts/markers or rejected-record identifier leakage;
- structural equivalence between a complete empty result and a complete result whose candidates are all filtered;
- snapshot/freshness/lifecycle checks, duplicate record/version handling, and incomplete-result rejection;
- no mutation of acquisition, delivery, belief, or canonical state.

These tests validate only the pure helper's behavior against caller-supplied metadata. They do not prove that metadata is authentic or that any production Memory read path exists.

## Runtime integration gates still blocked

Keep Memory→NPC integration fail-closed until the responsible owners approve and test the actual boundaries:

1. **Core trusted context binding:** prove the world, requester, recipient/subject, purpose, and actual generation/context used; manifest registration or membership alone is insufficient.
2. **Memory authorized retrieval:** a concrete policy and result contract for complete-empty/results, partial, unavailable, denied/withheld, stale/reconciliation-pending, and invalid requests, without existence/count side channels.
3. **Summary lineage:** re-authorize every source for the current recipient and use an approved versioned lineage contract.
4. **Invalidation/reconciliation:** a durable owner-approved signal for source changes, retraction, revocation, rollback, and rebuild. `world_revision` plus `commit_sequence` is a freshness marker, not a source-specific durable feed.
5. **Race-free authorization and transaction/audit boundary:** identify the final authorization/lifecycle check and its revocation/serialization guarantee.
6. **Lifecycle persistence and host evidence:** approved Core-owned acquisition, delivery/receipt, and belief persistence plus tests against the actual adapter/host path.

Owners must identify the existing implementation/API (or explicitly say it is absent), fail-closed behavior, and a runnable acceptance test for each gate. No NPC-owned API, schema, store, outbox, cursor, permission enum, or synthetic receipt/acquisition/belief state is introduced by this note.

## Delta decision

No replacement implementation PR is warranted for the old #76 branch: its helper/tests are already merged in #78, and its wide documentation delta is superseded by the current-main NPC contract docs. This evidence note is a focused documentation-only record; it does not close Issue #70 or claim production integration is complete.
