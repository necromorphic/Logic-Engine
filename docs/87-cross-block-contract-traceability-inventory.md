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
