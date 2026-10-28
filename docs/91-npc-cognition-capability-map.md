# NPC Cognition — Capability Map and Implementation Skeleton

**Status:** draft architecture map; documentation-only; requires review.  
**Branch:** `docs/npc-cognition-skeleton-2026-10-28`.  
**Scope:** organize cognition capabilities and identify the next audit/implementation steps.  
**Not authorized by this document:** runtime integration, new persistent schemas, Memory → NPC enablement, unrestricted model actions, or changes to Core authority.

## 1. Purpose

This document gives NPC cognition a stable outline so that future work can proceed incrementally without losing the larger design. It is an inventory and work map, not a claim that the listed behavior already works end to end.

The repository already has relevant contracts and isolated helpers. In particular, `docs/06-npc-autonomy-and-process-manager.md`, `docs/31-npc-subsystem-contract.md`, `docs/34-npc-decision-context-and-proposal.md`, `docs/57-npc-autonomous-intention-selector.md`, `docs/58-npc-goal-lifecycle.md`, `docs/59-npc-plan-progress.md`, and `docs/80-npc-autonomy-contract-inventory-proposal.md` remain the source documents for their respective boundaries. This map links them; it does not replace them.

## 2. Architecture rules

1. **NPC reasons; Core validates and commits.** A model-produced intention or proposal is not a world event and cannot directly mutate canonical state.
2. **Truth and belief are different.** Core owns canonical facts. An NPC's knowledge, suspicion, or false belief is actor-relative and must retain provenance and epistemic status.
3. **Profile is a constraint/input, not a second state store.** Stable traits and author constraints influence decisions but must not silently overwrite canonical world state or mutable character state.
4. **No invented history.** Reasoning may propose future actions or hypotheses, but cannot promote invented past events, evidence, promises, or motives into established canon.
5. **No omniscience by default.** Decision context must be filtered by actor access. Retrieval or presence in a prompt is not authorization.
6. **Durable state is explicit.** Goals, plans, tasks, beliefs, and unresolved conflicts must not depend solely on the model remembering previous prose.
7. **Fail closed on incomplete or ambiguous authority.** Missing inputs produce a bounded `non_ready` / `needs_review` / no-action result, not guessed permissions or world changes.
8. **Narration is downstream.** A proposal, private intention, off-screen event, and delivered information are distinct states.

## 3. Capability map

| Capability | Responsibility | Existing evidence in repository | Current safe status / gap |
|---|---|---|---|
| A. Goals and priorities | Represent desired conditions, importance, deadlines, competing objectives, and reasons for reprioritization. | Goal lifecycle helper: `src/npc/goal-lifecycle.js`, `docs/58-npc-goal-lifecycle.md`; autonomy contract in `docs/06`. | **Partial primitives.** Lifecycle transitions do not generate goals, resolve competing motivations, or persist state. |
| B. Intention selection and planning | Select an eligible next action; maintain or revise a plan as assumptions, resources, deadlines, and blockers change. | `src/npc/autonomous-intention-selector.js`, `src/npc/plan-progress.js`, `docs/57`, `docs/59`; plan-viability candidate documented in PR #617 / `docs/60-npc-plan-viability.md` on its feature branch. | **Isolated helpers.** Selection/progress do not discover actions, prove preconditions, execute effects, or create a durable autonomous loop. Feature-branch work is not assumed to be in `main`. |
| C. Beliefs, uncertainty, and evidence | Track what an NPC believes, suspects, knows, rejects, or is uncertain about; separate confidence from truth and update beliefs from permitted evidence. | `docs/07-knowledge-and-narrative-boundaries.md`, `docs/34-npc-decision-context-and-proposal.md`, `docs/39-npc-core-knowledge-contract-proposal.md`, Memory contracts `docs/64–78`. | **Semantics documented; general runtime not established.** The first-slice knowledge path is deliberately narrow and remains subject to its runtime gates. Do not add a parallel NPC-owned canonical memory store. |
| D. Model of other actors | Maintain actor-relative estimates of others' goals, trustworthiness, capabilities, likely actions, and what they know. | Relationship and social identity contracts, including `docs/23`, `docs/40`, `docs/42–49`, and `docs/78-relationships-npc-interpretation-boundary.md`. | **Needs a focused audit.** Relationship state is not automatically a complete belief/model-of-other-persons system. Keep observed relationship facts distinct from NPC hypotheses. |
| E. Learning from outcomes | Compare expected and observed results; update plans, beliefs, and future choice tendencies without silently rewriting stable character traits. | Plan progress and goal lifecycle accept explicit caller-reported events; `docs/06` defines replanning expectations. | **No general learning loop established.** Outcome validation belongs to the trusted event path; reflection may propose updates but cannot certify its own evidence. |
| F. Internal conflict and constraints | Resolve competing goals, values, obligations, fear, risk, limited resources, and incompatible intentions; preserve unresolved conflicts when no justified choice exists. | Inputs and competing objectives are described in `docs/06`; intention selection is deterministic over supplied candidates. | **Contract gap likely; audit before implementation.** Do not encode all personality as one score or silently discard an unsatisfied motive. |
| G. Personality and current condition | Apply stable traits, values, habits, and current emotional/physical state as distinct inputs that affect plausibility and choice. | `docs/personality/01-personality-and-relationship-semantics.md`, `docs/23-character-and-control-architecture.md`, and related personality contracts. | **Cross-block handoff unconfirmed.** Avoid duplicating personality/relationship ownership inside NPC. |
| H. Reflection and self-model | Assess prior decisions, known limitations, mistakes, and unresolved commitments; produce candidate revisions with evidence and scope. | Related expectations exist in autonomy/plan contracts, but a full reflection contract was not established by this inventory. | **Not verified.** Treat reflection as a proposal generator, not an authority or an automatic personality rewrite. |
| I. Temporal and off-screen autonomy | Advance eligible processes while the player is absent, respecting time, deadlines, interruption, delivery, and rollback. | Generic Process Manager and time-trigger contracts; `docs/06`, `docs/16`, `docs/22`, `docs/57–63`, `docs/78-process-checkpoint-recovery-decision-record.md`. | **Partial infrastructure, not a complete NPC loop.** A scheduler existing does not prove NPC decision invocation, off-screen action execution, or narration delivery. |

## 4. Decision-cycle outline

This is a conceptual order, not a committed API or runtime pipeline:

1. **Build a bounded context:** actor identity, current snapshot/time, permitted facts and their provenance, profile inputs, active goals/plans, relationships, capabilities/resources, and known uncertainty.
2. **Check context readiness:** distinguish complete, partial, inaccessible, stale, and invalid inputs. Do not fill missing facts with guesses.
3. **Evaluate motives and constraints:** identify eligible goals, priorities, obligations, risk limits, and conflicting motives.
4. **Generate candidate intentions/plans:** proposals may include assumptions, prerequisites, alternatives, expected outcomes, deadlines, and what evidence would invalidate the plan.
5. **Evaluate viability:** check only against explicit, trusted inputs; report blockers and uncertainty instead of asserting unsupported feasibility.
6. **Select or defer:** choose an eligible intention deterministically where rules suffice; return no-action or needs-review where material ambiguity remains.
7. **Validate and commit through the owning path:** Core checks permissions, current state/revision, preconditions, causality, idempotency, and policy before canonical effects.
8. **Observe the accepted outcome:** record the result and evidence, then propose bounded updates to plan progress, beliefs, priorities, or reflection.
9. **Schedule and narrate separately:** off-screen progression and player-facing delivery follow their own contracts; an event is not delivered knowledge until the authorized delivery path confirms it.

No step in this outline bypasses Core authority, Memory access controls, or Host outbound gates.

## 5. Minimal conceptual records (not a schema proposal)

The following are responsibility labels only. They do **not** approve storage fields or public APIs.

- **Goal:** desired condition, priority, status, deadline, owner, rationale/evidence.
- **Plan:** ordered or conditional steps, assumptions, alternatives, dependencies, expected outcome, invalidation conditions.
- **Intention:** selected next step, linked goal/plan, eligibility evidence, expiry/revalidation condition.
- **Belief:** proposition, actor, epistemic status (known / believed / suspected / disputed / unknown), evidence references, confidence if the owning contract permits it, and revision history.
- **Actor model:** hypothesis about another actor, basis/evidence, uncertainty, and last validation point.
- **Conflict record:** incompatible goals/constraints, relevant evidence, considered options, unresolved question, and whether review is required.
- **Outcome/reflection proposal:** expected versus observed result, evidence source, proposed update, and reason; never a self-authorizing canonical mutation.

The canonical representation and ownership for each record must be decided with the existing Core, Memory, Personality, Relationships, and Process Manager contracts before persistence is implemented.

## 6. Non-goals and prohibited shortcuts

- Do not create a single monolithic `npc-brain` that owns facts, memory, personality, relationships, scheduling, and world mutations.
- Do not let a language model mark its own preconditions true, certify action success, or directly commit effects.
- Do not equate retrieved text with knowledge authorization.
- Do not infer another character's private thoughts or the player's voluntary actions as facts.
- Do not automatically learn from unverified narration or turn one mistake into a permanent character change.
- Do not claim off-screen autonomy merely because a generic process scheduler exists.
- Do not enable production Memory → NPC as part of this work. It remains **DISABLED / FAIL-CLOSED** until its independent gates pass.

## 7. Acceptance checklist for the cognition foundation

- [ ] Each capability has one explicit owner and no competing canonical store.
- [ ] Existing code, contracts, tests, and open PRs are inventoried before a new module is created.
- [ ] Context distinguishes truth, actor knowledge, belief, hypothesis, missing data, and inaccessible data.
- [ ] A model proposal cannot mutate canonical state or bypass Core validation.
- [ ] Goals/plans/intentions survive request boundaries only through an approved durable owner.
- [ ] A blocked or invalidated plan is reconsidered without inventing past evidence.
- [ ] Competing goals can remain unresolved when available evidence does not justify a choice.
- [ ] Reflection updates are evidence-linked proposals and do not silently rewrite stable personality.
- [ ] Tests cover malformed inputs, stale revisions, missing permissions, conflicting goals, false beliefs, failed outcomes, interruption, restart, and rollback boundaries where supported.
- [ ] End-to-end claims are backed by tests on the exact integrated commit; documentation and isolated unit tests are not described as production proof.

## 8. Work order

1. **Audit existing NPC and cross-block contracts** against this map; record exact source/test/PR evidence and contradictions.
2. **Confirm ownership and semantic decisions** for beliefs, model-of-other-actors, conflict resolution, and reflection. Reuse existing Personality, Relationships, Memory, Core, and Process Manager contracts.
3. **Close the current required work first** (including Memory → NPC and Host readiness blockers) without treating this roadmap as a release blocker or changing their safety gates.
4. **Choose one small vertical slice** after the audit: one explicit input contract, pure deterministic evaluation, tests, and a documented integration boundary.
5. Add runtime integration only after the owning contracts and safe execution path are verified.

## 9. Related documents

- `docs/06-npc-autonomy-and-process-manager.md` — durable autonomy and off-screen process semantics.
- `docs/07-knowledge-and-narrative-boundaries.md` — canonical truth, actor knowledge, retrieval, and delivery separation.
- `docs/31-npc-subsystem-contract.md` — NPC subsystem behavioral boundaries.
- `docs/34-npc-decision-context-and-proposal.md` — bounded context and non-committing proposal.
- `docs/57-npc-autonomous-intention-selector.md`, `docs/58-npc-goal-lifecycle.md`, `docs/59-npc-plan-progress.md` — isolated implemented helper contracts.
- `docs/80-npc-autonomy-contract-inventory-proposal.md` — prior inventory of current autonomy contracts and evidence limits.
- Issue #264 — global Memory → NPC blocker; Issue #140 — NPC/Core integration gate; Issue #252 — project portfolio tracker.
