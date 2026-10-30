# NPC Integration Readiness Audit — Goal, Context, Authorization, Action and Result

**Audit date:** 2026-10-30  
**Core source baseline:** `main` at `8c8b9059ae12af3a63e96eb7cb86851e12a6d925`  
**NPC design branch:** `npc/autonomy-cycle-composition-2026-10-30` at audit time  
**Status:** source-level audit; documentation only. No runtime tests were run by this audit and no production integration is claimed.

## 1. Executive finding

The accepted NPC goal/plan ownership decision (A1) and the repository interface contract in `docs/97`–`docs/99` can be retained. The next implementation boundary is **not yet ready**.

Current `main` contains several reusable components:
- Core-owned trusted initial/imported knowledge ingestion;
- adapter-to-canonical-actor identity binding;
- bounded, fail-closed Core authorized reads;
- an internal Memory-to-NPC candidate consumer with source revalidation;
- generic mechanic evaluation and a separate pending-proposal/approval/commit lifecycle;
- Core rollback for its implemented event-root subset;
- a durable generic Process Manager.

However, no production call path joins them into an NPC decision. In particular, there is no approved first goal family with an admissibility owner, no production trusted NPC decision-context builder/serializer, no NPC-specific action authorization policy, no evidenced production NPC action template, no dispatcher, and no NPC goal/plan result-reconciliation or rollback handoff.

**Decision:** continue contract/source work only. Do not implement the NPC repository adapter, dispatcher, scheduler, automatic proposal approval/commit, or world-effect execution yet.

## 2. Evidence baseline and scope

The source inspection was performed against the current `main` SHA above and cross-checked against:
- `src/application/actor-bindings.js`
- `src/application/authorized-read-service.js`
- `src/application/memory-npc-consumer.js`
- `src/application/sqlite-memory-provider.js`
- `src/application/proposals.js`
- `src/core/mechanic-effect-translator.js`
- `src/npc/goal-lifecycle.js`
- `src/npc/plan-progress.js`
- `docs/34`, `docs/36`, `docs/49`, `docs/57`, `docs/76`, `docs/81`, `docs/82`, `docs/91`, and `docs/92`.

This is a targeted source audit, not an exhaustive review of every branch or every World Pack. PR content is not treated as shipped code. A test fixture is not treated as a production template.

## 3. Gate 1 — first goal family and admissibility owner

**Status: BLOCKED / NOT SELECTED.**

What is established:
- A1 assigns durable NPC goals/plans and their local lifecycle to the NPC domain.
- The pure `transitionNpcGoal`, `advanceNpcPlan`, and autonomy-cycle helpers validate/reduce supplied values; they do not generate goals, determine admissibility, authenticate outcomes, or persist them.
- `docs/81` states that goal admissibility and allowed categories need an explicit policy/owner.
- The coordinator selected `observe` as the first semantic *action* for design only. This is not a goal family and does not authorize execution.
- The later sequencing decision in `docs/82 §11.2` selected Core-owned `author_initial` / `imported` acquisition as the first knowledge foundation. It does not create a goal family or authorize observation.

What is not established:
- an approved list of goal families;
- which owner may create/accept a goal and which rules decide its admissibility;
- the initial World Pack or authoring source for a concrete goal;
- a production action/candidate set that can advance that goal;
- whether the first goal family may be completed without any canonical world mutation.

Do not infer a goal family from the generic lifecycle statuses, illustrative World Pack examples, test fixtures, or the generic Process Manager.

**Required decision:** NPC domain owns goal semantics and local lifecycle under A1, but the first admissibility policy and source must be explicitly assigned/approved. Until then, no production goal can be accepted by the future repository.

## 4. Gate 2 — trusted NPC decision context

**Status: PARTIAL PRIMITIVES / NO PRODUCTION CALLER.**

### 4.1 Core identity and reads

Observed:
- `ActorBindingService.resolve(worldId, adapterId, entityId)` resolves an authenticated adapter binding to an eligible canonical entity. Its source comment explicitly limits it to identity resolution; it does not grant knowledge access, action permission, approval, or commit.
- `AuthorizedReadService.readEntityFields()` obtains a bounded Core snapshot, calls a trusted application field policy for each requested field, and revalidates actor binding plus the composite `(world_revision, commit_sequence)` after policy evaluation.
- The default API field policy remains self-identity-only. Arbitrary attributes/non-self fields are withheld unless deployment code supplies an explicit trusted policy.
- `MemoryNpcConsumer.retrieveForNpc()` is a real internal seam. It binds world/adapter/actor, checks Memory query and record grants, rejects unsupported source classes and initial/imported candidates, re-reads direct canonical-entity source fields through `AuthorizedReadService`, checks matching snapshot cursors, and revalidates grants/currentness.
- `MemoryNpcConsumer.revalidateForFinalDispatch()` repeats retrieval and returns fresh values only when the result matches the prepared result.

### 4.2 Missing context composition and dispatch

Current Core candidate discovered after the first audit pass:
- Draft PR #789 replaces closed/unmerged PRs #744 and #764. It adds `LogicEngine.readNpcKnowledge()`, `prepareNpcBeliefContext()`, `recordNpcBeliefTransition()`, and `getNpcBeliefState()`, backed by acquisition-time value/source-event pins and canonical `npc.belief.transition` events with a rebuildable projection.
- The candidate checks the exact actor/purpose/recipient/snapshot tuple through deployment-injected read and per-acquisition visibility authorizers; it rejects truncated reads, withheld proposition evidence, stale snapshots, mismatched acquisition pins, and duplicate/conflicting evidence references. It rechecks visibility before the Core belief commit.
- This is materially closer to a usable Lane A acquisition/belief seam than the old #744 snapshot, but it remains PR-only. Its `prepareNpcBeliefContext()` builds a bounded context for one proposed proposition from selected Core-assigned evidence; it is not the complete NPC decision envelope (goals/plans, world context, Personality, Relationships, action candidates, or completeness manifest). Both authorizers are unset in `src/index.js`; request `adapter_id` and `recipient` values are not Host authentication. No Host session binding, production NPC caller, or model serializer is added.
- PR #789 exact head at audit time: `fb20e83244df8e8497d6be6bf9fbfa6fd5e12398`, based directly on current `main` with 3 commits ahead and 0 behind. Memory Provider workflow passed; Runtime workflow was cancelled, so full exact-head Runtime CI is not green/complete. Independent Core/Security review is still required.

Not established:
- a production caller that invokes the consumer/Core reader for an NPC decision;
- a single typed decision envelope combining authorized Core data, Memory evidence, goal/plan state, time, Personality, Relationships, and completeness/access markers;
- a proven binding between the exact final serialized model input, its generation/manifest, the selected NPC, and the proposal created afterward;
- a production Host callsite that performs the final revalidation and sends only the returned fresh result through a sole outbound Gateway;
- an accepted Core reader and per-acquisition visibility/context builder for the Core-owned initial/imported lane.

Important lane separation:
- Core initial/imported acquisition is Lane A. The ingestion foundation exists, but the reader/value/source-event pin and per-acquisition disclosure boundary are not accepted as a complete production reader.
- Memory direct canonical-entity retrieval is Lane B. The internal consumer is implemented, but it is not the Lane A acquisition reader and cannot authorize initial/imported assignment records.
- The two lanes have distinct purposes and authorization contracts. Do not merge them into one context merely by renaming purpose strings.

Host evidence:
- The Host lifecycle candidate PR #680 is closed unmerged.
- Gateway PR #646 remains Draft/open and is not evidence that the installed Host uses one sole egress path.
- Host completeness remains `NON_READY`; the documented archive/pinned-source checks do not equal a full live SillyTavern lifecycle and egress proof.

**Required next step:** define the actual production caller/owner and the exact model-input envelope; then prove the final Host serializer/Gateway uses the fresh revalidated object. Until then, do not send Memory/Core content to the model through an assumed integration.

## 5. Gate 3 — NPC actor/action authorization

**Status: IDENTITY PRIMITIVE EXISTS; ACTION AUTHORIZATION BLOCKED.**

Observed:
- adapter authentication and `ActorBindingService` provide a trusted adapter-to-actor identity relation;
- `AuthorizedReadService` governs disclosure of requested fields under a trusted field policy;
- `MechanicExecutor.evaluate()` uses a trusted context provider and pinned mechanic policy for a supplied action evaluation;
- mechanic proposal approval/commit may revalidate a pinned mechanic policy callback.

Not established:
- an authorization rule that explicitly permits a particular NPC to perform a particular action family against a particular target/scope for a particular purpose and evidence source;
- a production policy owner/configuration that supplies that decision;
- a binding from that action authorization decision to the same NPC, snapshot, action, target and eventual proposal;
- player-agency rules at the NPC proposal/commit boundary.

The generic proposal service explicitly lists actor authorization and player-agency policy among checks it does not perform. Approval via the separate shared approval credential is a workflow gate, not proof that the in-world NPC is authorized to perform the action.

**Required next step:** assign the policy owner and specify the deny-by-default decision tuple: `(world, NPC actor, action family/action ID, target/scope, purpose, source/evidence, snapshot/policy version)`. Do not reuse read permission or adapter binding as action permission.

## 6. Gate 4 — first action, Core effect and authoritative result

**Status: DESIGN ACTION SELECTED; EXECUTABLE PATH BLOCKED.**

### 6.1 First semantic action

`observe` is selected for design only. It means an attempt to obtain a fact about one explicitly identified target. It is read-only and must not itself create a fact, knowledge acquisition, goal/plan update, event, or world mutation.

The existing translator declares `propose_knowledge` as a known name but its executable allowlist supports only:
- `create_entity`;
- `update_attribute`;
- `assert_fact`.

Therefore `propose_knowledge` is rejected as unsupported. No production World Pack/mechanic template with an authored NPC `observe` action was established in this audit. The `wait` mechanic-executor fixture creates an entity and is not a valid substitute.

### 6.2 Generic Core proposal lifecycle

Observed:
- `MechanicExecutor.evaluate()` is a bounded read-only evaluator for a caller-supplied enabled instance and exact pinned template/action.
- `ProposalService.createFromMechanicEvaluation()` accepts only an attested ready evaluation and rechecks the snapshot cursor before staging.
- `ProposalService.create()` persists a pending proposal.
- `approve()` requires pending state and a current world revision/commit sequence.
- `commit()` requires approved state, repeats stale checks, commits through Core and persists the commit result. Repeated commit of an already committed proposal returns the stored result.
- For the supported mechanic path, the committed Core event/audit can expose an `event_id` and mechanic provenance.

Not established:
- a real NPC dispatcher that supplies the instance/action IDs and trusted context;
- an executable observation/knowledge effect mapping;
- automatic or NPC-specific approval authority (none is authorized);
- an NPC attempt ID carried through proposal/event metadata;
- a trusted consumer that proves a committed event corresponds to the exact NPC plan step;
- a durable reconciliation operation that advances that step once and only once.

The Core event ID is authoritative for a committed Core event, but it is not by itself proof that an NPC observed or acquired knowledge. Proposal status, model text, or a generic `action.completed` event must not advance NPC plan progress without the separately verified correlation contract.

### 6.3 Goal/plan progress and rollback

- `advanceNpcPlan(plan, event)` is a pure reducer that accepts caller-reported `step_succeeded` / `step_blocked` / `step_unblocked` events. It does not authenticate them.
- Core rollback supports a bounded event-root subset. The wider `docs/05` algorithm is a target architecture, not proof of full NPC-plan recomputation.
- Generic Process Manager can mark directly affected process milestones and prerequisite descendants `needs_review` in its own bounded rollback path. It is not an NPC goal/plan store and must not be repurposed.
- No Core-to-NPC invalidation/reconciliation caller was found that marks a locally persisted NPC plan/step for review when a supporting Core event is rolled back.

**Required next step:** define and test an attempt → proposal → committed event → NPC step reconciliation contract, plus a Core rollback invalidation handoff. Until then, NPC progress remains unchanged/review-required when an outcome cannot be authenticated.

## 7. Consolidated readiness matrix

| Gate | Status | Evidence |
|---|---|---|
| A1 ownership of durable goals/plans | DECIDED | `docs/97` |
| One current plan per goal; alternatives retained | ACCEPTED | `docs/98 §4.3` |
| Repository operation semantics | DESIGNED, not implemented | `docs/99` |
| First goal family/admissibility owner | BLOCKED | `docs/81`; no production family/source selected |
| Core identity binding | IMPLEMENTED, narrow | `ActorBindingService` |
| Authorized field reads | IMPLEMENTED, narrow | `AuthorizedReadService`; default self-only |
| Memory direct-source consumer | IMPLEMENTED internal seam, not wired | `MemoryNpcConsumer` + tests |
| Core initial/imported ingestion | IMPLEMENTED | `docs/91` / `docs/92` |
| Core initial/imported reader + disclosure context | PR CANDIDATE / NOT MAIN / NOT PRODUCTION-READY | PR #789 replaces closed/unmerged #744/#764; authorizers remain unconfigured and Host binding/caller/serializer are absent |
| Trusted NPC decision-context builder | BLOCKED | no production caller/serializer |
| NPC action authorization | BLOCKED | identity/read permission are not action permission |
| First action `observe` | DESIGN ONLY | `docs/81 §11`, `docs/82 §8, §10–11` |
| Production action template/effect mapping | BLOCKED | no production observe template; `propose_knowledge` unsupported |
| Generic proposal and commit result | IMPLEMENTED, generic | `ProposalService` |
| NPC attempt-to-event correlation/reconciliation | BLOCKED | no trusted consumer |
| NPC plan rollback/invalidation handoff | BLOCKED | no Core-to-NPC caller |
| NPC dispatcher/scheduler | BLOCKED | `docs/82`; Process Manager is not dispatcher |
| Host sole Gateway/final send | BLOCKED / NON_READY | PR #646 Draft; PR #680 closed unmerged |

## 8. Recommended implementation order

Do not start with the NPC-local repository adapter. The store contract is ready for review, but it cannot safely consume untrusted outcomes.

Recommended sequence:

1. **Core Lane A reader:** review and validate PR #789 on its exact head; configure no production authorizers until their trusted Host/session binding is specified. Then finish/approve immutable acquisition pins, per-acquisition visibility authorization, and safe context projection for `author_initial` / `imported`. Do not route this through Memory Lane B.
2. **Host final-send proof:** establish the exact production Host caller, serialized payload binding, final revalidation and sole Gateway egress. Preserve the currently approved fail-closed guarantee; do not claim cross-store linearizability unless separately approved.
3. **NPC action authorization:** assign owner and implement the explicit actor/action/target/purpose/source policy at the real caller/proposal boundary.
4. **First goal/action vertical slice:** only after a real approved goal family and production template/action/effect mapping are named. `observe` remains read-only until a separately supported acquisition proposal exists.
5. **Core result and rollback handoff:** carry a stable NPC attempt identity through the proposal, correlate the committed event, reconcile once, and surface rollback-invalidated progress as review-required.
6. **NPC-local repository implementation:** implement `docs/99` operations and tests only after the authenticated evidence/authorization/result interfaces above are settled. This can proceed in parallel as a pure adapter design, but no production progress reducer should be fed by caller assertions.

## 9. Explicit non-claims

This audit does not claim:
- that PR #789 is merged (it remains Draft; its Provider workflow passed but Runtime workflow was cancelled, and independent review is outstanding); that PR #744/#764 or PR #695 is merged (closed unmerged);
- that PR #646 is a shipped sole Gateway;
- that Host source inventory is complete;
- that Memory → NPC is enabled;
- that `observe` is executable;
- that generic proposal commit is NPC authorization;
- that Core rollback already reconciles NPC goals/plans;
- that tests were run as part of this documentation audit.

**Safety state:** Memory → NPC remains **DISABLED / FAIL-CLOSED**. Host remains **NON_READY**. PR #773 remains Draft and unmerged.
