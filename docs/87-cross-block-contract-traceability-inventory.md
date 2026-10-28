# Cross-Block Contract Traceability Inventory — Working Evidence Register

**Status:** evidence inventory for draft contract PR #631. Snapshot date: 2026-10-28. This document is not a certification of production readiness. Statuses refer to evidence identified during review; exact-head tests must be rerun before implementation decisions.

**Rule:** “documented” means the rule exists in documentation; “implemented” means code exists in the current main branch; “integrated” means the real path across boundaries has been demonstrated; “production-ready” means target deployment controls and acceptance evidence pass. These statuses are not interchangeable.

## Status definitions

- **DOCUMENTED:** semantic requirement exists in a source contract.
- **IMPLEMENTED-PARTIAL:** a current-main primitive exists, but it does not satisfy the full cross-block requirement.
- **UNVERIFIED:** reviewed evidence does not prove the required end-to-end behavior.
- **BLOCKED:** required contract, trusted source, or integration proof is missing.
- **NOT RUN:** this review did not execute the relevant tests.
- **NO-GO:** must not be enabled in production.

## Traceability table

| Contract area | Existing evidence identified | Status | Missing evidence / next action |
|---|---|---|---|
| Canonical world-state authority | docs/31-npc-subsystem-contract.md; docs/34-npc-decision-context-and-proposal.md; docs/20-minimal-runtime.md describe Core-owned world state, time, events, revisions, causal history and commit lifecycle | DOCUMENTED; relevant Core primitives exist | Map each requirement to exact current-main implementation and tests before claiming full conformance |
| Host identity vs in-world actor identity | docs/20-minimal-runtime.md describes adapter credentials and actor bindings / resolve / revoke endpoints | IMPLEMENTED-PARTIAL | Prove the exact identity survives the real Host request, Core authorization, NPC decision, proposal, and final output path |
| Actor- and purpose-bound reads | Current runtime documents authorized-read as a bounded actor-bound read | IMPLEMENTED-PARTIAL | Prove field policy, purpose, snapshot binding and completeness for the exact NPC decision context; a read endpoint is not a full NPC knowledge contract |
| Memory source lineage / accepted head | Current main commit 1ad46f96161778d8cf6f1bc66e8db31d56593f65 is titled “feat(memory): enforce accepted-head revocation gate” | IMPLEMENTED-PARTIAL | Verify every Provider → Core → NPC hop preserves exact source/version lineage and the final request is bound to the admitted version |
| Provider retrieval completeness | README.md and issue #264 identify incomplete Host inventory and fail-closed behavior as blockers | BLOCKED | A trusted verifier must prove complete inventory for all in-scope source versions, including edits, branches/imports, deletions and restores |
| Core authoritative knowledge acquisition | docs/34-npc-decision-context-and-proposal.md narrows the first proposed path to authored initial/imported knowledge and states the executable acquisition record contract remains unimplemented/unverified; PR #537 records this as a design gate | DOCUMENTED / BLOCKED | Identify the real Core-owned acquisition source/record, actor binding, provenance, validity, and snapshot-bound filter; do not substitute an NPC-owned store |
| Observation / communication / inference acquisition | Existing proposal explicitly defers these mechanisms until evidence contracts exist | DOCUMENTED / NOT APPROVED | Separate contract and acceptance tests for each mechanism before supporting it |
| Personality → NPC | docs/31-npc-subsystem-contract.md identifies profile semantics; PR #537 notes the combined decision-context handoff is not confirmed | DOCUMENTED / UNVERIFIED | Identify exact source/version and trusted field-level feed into the decision envelope; test absent/stale profile behavior |
| Relationships → NPC | docs/31-npc-subsystem-contract.md and relationship-specific docs define semantics; current proposal does not establish a complete combined feed | DOCUMENTED / UNVERIFIED | Verify directed subject/perspective, version, visibility and provenance through the actual caller; ensure relationship does not grant technical access |
| Mechanic evaluation | docs/81-npc-goal-action-contracts-proposal.md describes MechanicExecutor.evaluate as a bounded, non-committing generic evaluation seam | IMPLEMENTED-PARTIAL | Select one concrete action family, prove candidate enumeration and NPC actor/action authorization; evaluation seam alone is not an NPC action catalogue |
| Generic proposal lifecycle | docs/20-minimal-runtime.md describes pending proposal, approval, commit and cancellation routes; NPC proposal contract notes limits | IMPLEMENTED-PARTIAL | Prove the NPC proposal uses the normal lifecycle and that actor authorization, player agency and semantic alignment are checked before commit |
| NPC goal/plan helper functions | PR #532 added isolated NPC helper modules; PRs #626–#628 contain hardening changes but remain draft as of this inventory | IMPLEMENTED-PARTIAL in current main for merged helper baseline; draft PRs are not integrated | Verify exact main commit and tests; add persistence/reconciliation only against an approved source contract |
| NPC goal formation | PR #537 section 15 defines a proposal-only gate and owner inputs; current runtime does not prove a complete autonomous loop | DOCUMENTED / BLOCKED | Define trusted goal inputs, admissibility, priority/stop policy, persistence owner and acceptance cases; no model-created canonical facts |
| NPC candidate discovery / autonomous dispatch | PR #537 states no verified end-to-end autonomous NPC loop and no NPC-specific dispatcher/candidate enumerator | BLOCKED | Implement only after candidate source, actor authorization, effect vocabulary and Core lifecycle are approved and tested |
| Core world-time authority | docs/20-minimal-runtime.md describes Core time and explicit triggers; project context says Core time triggers run only via explicit time-advance and are not a wall-clock scheduler | IMPLEMENTED-PARTIAL | Prove trigger idempotency and result reconciliation before off-screen NPC progression |
| Process Manager / off-screen execution | Generic scheduling/process primitives do not themselves prove NPC scheduling or a full autonomous loop | UNVERIFIED / BLOCKED | Define trigger ownership, idempotency, bounded work, cancellation, retry, and Core-result reconciliation |
| Narrative reflects committed results | docs/31-npc-subsystem-contract.md sets the semantic boundary that narrative is not proof of an event | DOCUMENTED / UNVERIFIED | Test that pending/rejected/stale/unknown proposals cannot be narrated as completed; verify viewpoint filtering on actual serialized output |
| Final serialized model input binding | README.md and issue #264 identify exact final-body binding to admitted candidates as a production blocker | BLOCKED / NO-GO | Implement one protected egress path and prove final body/manifest binding to actor, source versions, policy and snapshot |
| Revocation at disclosure boundary | Current-main revocation protections exist for part of the source lifecycle; README says final-boundary race-resistant revocation is not yet proven | IMPLEMENTED-PARTIAL / NO-GO | Prove source revocation/scope change between retrieval and final dispatch blocks disclosure without a race |
| Host sole-egress and network isolation | Security 1.1.txt says the proposed SillyTavern patch was not installed and real gateway/network isolation remain unverified | UNVERIFIED / NO-GO | Apply only after target-version check; verify actual gateway, auth, all Google routes and OS/network egress policy |
| Target-PC storage / backup / restore controls | README and issue #264 identify target-PC ACL and backup/restore/anti-rollback evidence as outstanding | BLOCKED / NO-GO | Verify process identity, DB/WAL/SHM ACLs, backup isolation, restore behavior and anti-rollback on the target machine |
| Integrated Host → Provider → Core → NPC path | Issue #264 and README identify the global end-to-end path as unproven | BLOCKED / NO-GO | Produce a trace with exact commit, actor, source version, policy, snapshot, final serialized body manifest and authoritative result |
| Cross-block retry / replay safety | Core and Provider have separate idempotency/recovery primitives, but no evidence in this inventory proves every cross-block operation is joined correctly | UNVERIFIED | Test timeout-after-commit, duplicate trigger, retry with same idempotency key, recovery and authoritative readback |
| Contract version compatibility | Proposed in PR #631; no claim of an integrated cross-block version negotiation mechanism | DOCUMENTED / UNVERIFIED | Decide version owners and add consumer compatibility tests before the first implemented envelope is shipped |

## Current conclusion

1. The semantic ownership baseline is sufficiently documented to review the intended boundaries.
2. Several individual primitives exist in current main, but the combined cross-block decision envelope and autonomous NPC loop are not proven.
3. The highest-risk blockers are trusted actor/purpose context, authoritative acquisition records, complete Host inventory, exact final-input binding, disclosure-time revocation, and sole protected egress.
4. The first implementation slice should be a single non-committing NPC decision over an explicitly prepared and validated context, with one selected action family and no Memory → NPC production access.
5. Memory → NPC remains **DISABLED / FAIL-CLOSED**. No test result in this inventory authorizes activation.

## Evidence update rule

When updating this inventory, every status change must cite an exact current-main file/line or commit SHA and, for tests, the exact workflow run, commit SHA, environment, and result. An open PR or green feature-branch run remains not integrated until merged. A test file existing is not a passing test result.


## Source-level reconciliation refresh — 2026-10-28

The cross-block contract was compared with these current-main documents and source files during review:

- `docs/38-npc-author-decisions-and-semantic-delta.md` — explicit NPC semantics, including false beliefs, character-relative reasoning, author-mandated outcomes, off-screen continuity and multidimensional relationships.
- `docs/39-npc-core-knowledge-contract-proposal.md` and `docs/43-core-npc-knowledge-runtime-implementation-plan.md` — Core-owned knowledge/acquisition boundary and the narrow first vertical slice.
- `docs/42-npc-relationship-state-contract-proposal.md` and `docs/43-npc-relationship-core-integration-decision.md` — Core owns canonical persisted relationship state and commit/rollback; Relationships owns domain semantics/evaluation, not a competing persistence store.
- `docs/51-core-authorized-read-boundary-contract.md`, `docs/54-core-proposal-execution-authority-contract.md`, and `docs/55-core-context-manifest-trust-contract.md` — actor-bound reads, proposal execution authority and context-manifest limitations.
- `docs/73-core-1.5-cross-block-integration-matrix.md`, `docs/76-core-cross-block-decision-register.md`, and `docs/78-memory-provider-accepted-head-revocation-gate.md` — integration blockers and production-dispatch restrictions.
- `src/application/memory-npc-consumer.js` (current-main blob SHA `63b6d4ea03c34b0cc4321df64b27eacae444a694`) — a future Host seam with injected trusted functions; no default Provider/policy and not wired into the public API.
- `src/npc/autonomous-intention-selector.js` (SHA `8ffa44aad910cb780a275d3d57307a33377eaec8`), `src/npc/goal-lifecycle.js` (SHA `3fad1e1c8d349a404ca363f256e0c87262813d47`), and `src/npc/plan-progress.js` (SHA `e1eee92492d63fc2658abbc3355c6ff78c696d29`) — isolated deterministic/pure helpers only.
- `docs/20-minimal-runtime.md` (SHA `6eec17da9ae3d8dbd9702a47d493347c38265422`) — current runtime endpoint inventory and explicit limits of authorized-read.

### Refined boundary findings

| Boundary | What is evidenced | What remains unproven |
|---|---|---|
| Core authorized read | A real endpoint resolves a trusted adapter binding and returns actor-bound, policy-filtered entity fields | It is not a complete knowledge/belief system; policy defaults and field-level visibility must be traced for the intended NPC purpose |
| Memory candidate consumer | Code joins trusted Memory candidate authorization with Core authorized source reads and returns non-ready on malformed/incomplete states | It has no default Provider/policy, is not wired into public API, and does not itself prove Core's explicit initial-assignment record path |
| Final-dispatch revalidation | The consumer re-reads current authorization/source state and compares it with a prepared result | Its own comment says this is not a transport lease; Host still needs durable dispatch-start serialization and sole-egress Gateway to close the TOCTOU window |
| Accepted-head/revocation | Core SQLite and enrolled file-backed Provider writes share accepted-head/revocation coordination | Does not prove complete Host source inventory, final-send reauthorization, sole-egress deployment or restore/anti-rollback controls |
| NPC selector and lifecycle helpers | Pure, bounded local transformations with tests | No candidate discovery, trusted source builder, durable goal persistence, scheduler, universal action mapping, dispatch, or commit loop |
| Relationship state | Contract and code separate domain interpretation from Core canonical persisted state | The actual combined actor-specific relationship feed into the NPC decision envelope is not established by the current runtime evidence reviewed here |
| Belief state | Author decision says persistent subject-relative belief is Core-owned and separate from truth/acquisition | Executable representation and reconciliation interface remain unverified; NPC must not add a parallel belief store |
| Context manifest | Runtime supports registration of generation/snapshot cursor metadata | Manifest does not prove exact final body derivation, source-lineage authorization or protected egress |

### Evidence discipline

This refresh is a source inspection, not an end-to-end run. No integrated Host → Provider → Core → NPC trace was executed as part of this review. The Runtime workflow for contract PR #631 has a passing `npc-boundary` job while the full `test` job remains queued at the latest observed check. Therefore the contract PR remains documentation-only and production Memory → NPC remains **NO-GO / DISABLED / FAIL-CLOSED**.


## Test-location map — test existence is not a pass

The following are current-main test files identified by repository listing. This table maps the contract to likely relevant suites; it does **not** assert that every scenario in the new contract is already covered, nor that these files passed on the latest commit.

| Contract area | Current-main test files | Coverage limit to preserve |
|---|---|---|
| Adapter ↔ actor binding | `tests/actor-binding.test.js`, `tests/authorized-read-api.test.js`, `tests/authorized-read-service.test.js` | These establish the existing binding/read seam; they do not prove a complete NPC decision envelope or Memory → NPC disclosure |
| Canonical snapshot and revision | `tests/snapshot-read.test.js`, `tests/core.test.js`, `tests/causality-contract.test.js` | Does not by itself establish actor-relative acquisition or prompt-safe filtering |
| Proposal lifecycle / API | `tests/api.test.js`, `tests/api-least-privilege-policy.test.js`, `tests/core.test.js` | Does not prove NPC semantic alignment, player-agency checks, or that every NPC proposal reaches the same protected commit route |
| Relationship state and interpretation | `tests/relationship-transition-core.test.js`, `tests/relationship-assess-interaction-interpretations.test.js`, `tests/relationship-evaluate-candidate.test.js` | Does not prove the full actor-specific Relationship feed into the NPC decision envelope |
| Memory candidate admission and final revalidation | `tests/memory-npc-consumer.test.js`, `tests/npc-memory-candidate-eligibility.test.js` | Consumer is not wired to the public API; final revalidation is not a transport lease; Core initial-assignment read is missing |
| Provider source lifecycle / revocation | `tests/memory-provider-core-integration.test.js`, `tests/memory-provider-query-revocation-race.test.js`, `tests/memory-provider-cross-connection-revocation-race.test.js`, `tests/memory-provider-corrupt-lineage.test.js`, `tests/accepted-head-authority.test.js` | Does not prove Host inventory completeness, final-body binding, or production sole-egress |
| Host version inventory | `tests/host-version-digest-ledger.test.js`, `tests/host-version-ledger-api.test.js`, `tests/memory-dispatch-gateway.test.js` | Digest ledger is not proof of complete Host source inventory; deployment-level sole-egress and ACL evidence remain outstanding |
| NPC goal/intention/plan helpers | `tests/npc-autonomous-intention-selector.test.js`, `tests/npc-goal-lifecycle.test.js`, `tests/npc-plan-progress.test.js` | Pure helper behavior only; no autonomous scheduling, durable goal persistence, action discovery, or commit reconciliation |
| Process/time triggers | `tests/process-api.test.js`, `tests/process-contract.test.js`, `tests/process-manager.integration.test.js`, `tests/process-time-contract.test.js`, `tests/time-scheduler.test.js`, `tests/time-trigger-registry.test.js` | Generic process/time support is not an NPC-specific off-screen scheduler and must not silently advance world time |
| Storage migration/recovery | `tests/storage-migrations.test.js`, `tests/core-transaction-recovery.test.js`, `tests/memory-provider-coordinated-restore.characterization.test.js` | Does not yet prove the proposed Core-owned acquisition record's causal lifecycle, migration, rollback, and recovery behavior because that record is not implemented |
| Final narrative/output | No single current-main suite was identified as proving the exact authorized NPC context through final serialization and delivery | A real serializer/outbound integration test is still required |

### Immediate next implementation gate

The next bounded Core-owned work item is **Stage B: initial/imported acquisition and provenance**, after confirming the already-existing actor-binding seam is the chosen trusted identity source. It must not start by connecting raw Memory candidates directly to NPC.

Minimum acceptance evidence for that work item:

1. A Core-owned record distinguishes canonical truth from subject-relative acquisition.
2. Only `author_initial` and `imported` are supported; all other acquisition kinds return explicit unsupported/non-ready.
3. The record binds world, subject, source/proposition, acquisition kind, provenance, validity, and any required visibility restriction.
4. The implementation uses Core's existing revision/event/causal lifecycle or documents and tests a compatible Core-owned lifecycle; no parallel NPC store or revision counter.
5. Tests cover cross-world/unknown/destroyed subjects, duplicate/idempotent assignment, missing or malformed provenance, source invalidation, snapshot changes, rollback/replay, and unauthorized reads.
6. Until Stage B and Stage C are implemented and tested, the Memory candidate consumer must continue to reject initial/imported rows without Core assignment proof, and production Memory → NPC remains disabled.
