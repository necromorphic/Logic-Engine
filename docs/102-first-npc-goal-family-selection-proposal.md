# First NPC Goal Family — selection proposal

**Status:** decision proposal only. No goal family is approved for production admission or execution by this document.

**Baseline:** docs/81, docs/82, docs/95, docs/99, docs/100; current-main repository port PR #840 (Draft; exact-head CI pending; source prototype PR #806 had 21/21 repository tests and 1208/1208 full Runtime tests on Windows/Linux at tested code/test head `3767c62f9c1f1e581f5aa23fe525d9de7a041ed8`); Core acquisition candidate PR #781 (closed unmerged); current-main VFS probe PR #839 (Draft; clean exact-head Windows/Linux feasibility run #41111165524 passed same-engine registration, WAL/SHM/rollback-journal, sidecar alias/replacement, directory-anchor and concurrent/worker-open checks; broader Runtime workflow #41111165519 is still finishing; production security gates including POSIX xDelete replacement race remain open; Issue #770 remains open).

## 1. Decision required

The project has a pure goal lifecycle, plan progress reducer, autonomy-cycle coordinator, and a repository prototype. None of these defines or authorizes the first semantic goal family.

The existing design records one relevant distinction:

- docs/100 selects observe as the first semantic action for design only.
- docs/100 explicitly says observe is not a goal family.
- docs/81 says no concrete semantic NPC action family has been selected or evidenced.
- docs/82 approves only a separate dispatcher architecture proposal, not implementation.
- docs/99 §9 requires the first supported goal family and its admissibility owner to be settled before production repository wiring.

Therefore, no family may be treated as accepted merely because it fits the generic goal/plan lifecycle.

## 2. Evidence and current limits

| Candidate | Existing evidence | Blocking gap |
|---|---|---|
| Observe one explicit target | docs/100 defines observe as a read-only attempt to obtain a fact about one identified target. Core AuthorizedReadService is a bounded actor-bound read primitive. | Observe is an action, not a goal family. It must not itself create knowledge, a fact, a goal/plan update, event or world mutation. There is no durable read-result receipt in docs/99 reconciliation, which currently accepts verified Core committed results. |
| Acquire one authorized fact | Core has initial/imported acquisition primitives. PR #781 proposed a Core-owned reader, immutable acquisition pins, belief transition events and a shared Coordinator lease around final visibility revalidation and commit. | PR #781 is closed unmerged; production read and visibility authorizers remain unset in src/index.js. No production NPC caller or complete decision-context serializer exists. Lane A is not a shipped production reader. |
| Perform one bounded world effect | The generic Core proposal lifecycle and mechanic evaluator support a limited effect vocabulary, including create_entity, update_attribute and assert_fact. | No NPC-specific action authorization, player-agency policy, approved semantic action, dispatcher or attempt-to-committed-event-to-plan reconciliation path. Generic proposal approval is a separate workflow gate, not NPC authority. |
| Communicate/report | SillyTavern is the intended Host and the project has a Gateway candidate. | Host completeness/final-send proof is NON_READY; no sole outbound path or NPC-specific delivery/knowledge receipt is proven. |

## 3. Recommended first design candidate

### observe_target — read-only, one-target observation

This is the lowest-effect candidate for a first design slice because it is bounded to one explicitly identified target and does not request a canonical world mutation.

Proposed semantic shape, not an executable schema:

- Goal intent: obtain one explicitly requested, policy-permitted observation about one canonical target.
- Target: canonical entity ID supplied by a trusted caller or authored source; never inferred from model text.
- Requested fields: finite allowlisted field IDs; no arbitrary path or broad entity dump.
- Purpose: one fixed observation purpose owned by the NPC policy.
- Actor: exact authenticated NPC binding from the trusted runtime.
- Snapshot: exact world_revision and commit_sequence from Core's authorized read.
- Result: either a complete authorized read result, no_match, withheld, unknown, stale_context or review_required.
- Side effects: none. No Core proposal, event, world revision increment, fact creation or automatic belief mutation.

This is a candidate for a read-only decision slice, not yet a durable goal family.

### Why it cannot be wired to the current repository unchanged

docs/99 reconcileCoreResult requires a trusted committed Core result linked to a proposal and event. A read-only observation normally has no committed event and no proposal ID. Treating a successful read as a committed event would be false.

Before observe_target can become a durable goal family, the contract needs an explicit trusted read-result receipt boundary, for example a separate reconcileReadResult operation or an approved extension to the result contract. It must bind:

- exact world/NPC/actor/purpose;
- target and exact requested field set;
- authorized-read decision and its policy version;
- exact snapshot pair;
- complete/withheld/unknown field statuses;
- the returned values or stable source references;
- the exact decision attempt and active plan step;
- a single-use/idempotent receipt identity.

The receipt must be produced by the trusted Core read boundary, not by model output or a caller-supplied verified flag. It must not be represented as a canonical world event.

If the project does not want to extend docs/99 with a read-result receipt, observe_target must remain ephemeral and cannot mark a durable plan step complete.

## 4. Ownership proposal

The following ownership split is recommended for review:

| Responsibility | Proposed owner | Boundary |
|---|---|---|
| Goal-family semantics and local lifecycle | NPC domain | Defines what the goal means and which local transitions are valid. |
| Goal origin/admission source | Trusted authoring/World Pack or explicit authenticated caller | Supplies the goal request and provenance. Model output may suggest a candidate but cannot admit it. |
| Goal admissibility policy | NPC domain policy, invoked by trusted runtime | Deny by default; checks family, target, scope, provenance, expiry and required context. |
| Actor identity | Core actor-binding primitive plus authenticated Host session binding | Identity only; it does not grant action permission. |
| Read authorization and canonical fields | Core AuthorizedReadService and trusted field policy | Exact actor, purpose, target, fields and snapshot. |
| Host model-input binding | SillyTavern Host/Gateway | Proves the exact serialized input belongs to the authenticated NPC and includes only freshly revalidated data. |
| Durable goal/plan state | NPC GoalPlanRepository | Stores accepted local state only after trusted admission. |
| Canonical world mutation | Core | Not used by observe_target. |
| Read-result receipt verification | Core-facing trusted integration | Must be separately designed; not currently implemented. |

The proposal does not claim that these owners are already wired. In particular, the production Host session binding, complete decision context, read policy authorizers and receipt issuer remain absent.

## 5. Required acceptance gates

Do not implement observe_target in production until all of the following are true:

1. The project owner explicitly approves observe_target as the first goal family, not merely the first semantic action.
2. The origin/admissibility owner is assigned. The model cannot be the authority that creates or accepts goals.
3. A trusted caller supplies the exact NPC, target, purpose and finite field set.
4. Core authorized read is bound to that actor and exact snapshot; withheld and unknown remain distinct from known absence.
5. The exact authorized result is bound to the final Host model input and revalidated at the final-send boundary.
6. The read-result receipt contract is accepted, or the family is explicitly defined as ephemeral and non-completing.
7. NPC local belief/knowledge mutation, if any, is a separate transition with its own evidence and provenance. Observe itself must not silently create knowledge.
8. Repository admission and step reconciliation consume only the trusted receipt, not a model assertion.
9. Duplicate receipt delivery cannot advance twice; stale snapshot, revoked visibility, changed goal/plan revision and incomplete result fail closed.
10. Memory → NPC remains disabled unless its independent grant/revocation contract is proven.

## 6. Alternatives if a committed event is required

If the first goal family must complete only through docs/99's existing committed-Core-result contract, do not use observe_target. Select a concrete, low-risk world-effect family only after the project approves:

- the exact enabled/pinned World Pack mechanic instance and action ID;
- its supported effect mapping;
- the NPC actor/action authorization tuple;
- player-agency and approval semantics;
- the dispatcher caller;
- Core proposal/event correlation and rollback invalidation.

No such first action family is currently evidenced by docs/81 or docs/100. Choosing one now would be an architectural assumption, not a source-backed conclusion.

## 7. Current decision

**Recommendation:** approve observe_target for isolated design work only; do not enable production admission or dispatch. First define the trusted read-result receipt contract and the goal origin/admissibility owner. Keep all world-effect families blocked until their action authorization and Core result/rollback handoff exist.

This recommendation is intentionally narrower than a real autonomous cycle. It creates a testable first read-only vertical slice without pretending that a read is a committed event or that an NPC has learned a fact merely because a field was returned.
