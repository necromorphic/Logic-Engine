# 57. Core evaluation, recalculation, and result-publication boundary

**Status:** Core-owned architecture proposal; documentation only. No runtime/API/schema/storage change is authorized by this document.  
**Owner:** Core.  
**Related:** issue #262; issue #226 and bounded mechanic executor PR #225; docs/00-architecture-baseline.md; docs/01-core-domain-model.md; docs/21-stage1-causality-contract.md.

## 1. What “the logical core” means in the current repository

The Logic-Engine is a modular monolith, not a separate network service. The logical core is a set of responsibilities crossing current code boundaries:

| Responsibility | Existing code anchor | What is established | What must not be assumed |
|---|---|---|---|
| Validation and application orchestration | `src/application/engine.js` | Validates requests/effects and coordinates canonical operations, time policy, trigger planning, and commit path. | It is not proof of a general dependency graph or universal recalculation planner. |
| Domain primitives / constrained evaluation | `src/core/errors.js`, `src/core/rules.js`, `src/core/mechanics.js` | Error contracts, rule/effect validation, and bounded declarative mechanics helpers exist. | A constrained evaluator is not a general reasoning engine or arbitrary module executor. |
| Canonical persistence and transaction boundary | `src/storage/sqlite-store.js` | SQLite-backed world state, events, audit, idempotency, projections and rollback-related persistence use existing Core write paths. | Cross-store atomicity and complete arbitrary causal dependency tracking are not implied. |
| Proposal lifecycle | `src/application/proposals.js` | Proposals can be created/approved/committed through the existing lifecycle and canonical commit path. | Proposal creation or approval is not itself a canonical world change. |
| Time due-work planning | `src/time/scheduler.js` | Pure due-work planning over supported trigger coordinates/references. | It does not itself advance time, execute effects, calculate arbitrary dependencies, commit state, or authorize disclosure. |
| Bounded mechanic execution | PR #225 / issue #226 | A narrow opt-in deterministic subset is described and tested on its branch. | It is not a selected production-wide executor or general recalculation strategy; PR evidence is not mainline runtime evidence until merged. |
| Authorized reads | `src/application/authorized-read-service.js`, `src/application/actor-bindings.js` | A narrow fail-closed read boundary and actor identity binding exist. | Actor identity or a consistent snapshot does not grant access to arbitrary fields or derived results. |

The core is therefore **not just the `src/core/` directory**. The directory contains some low-level primitives; application orchestration and canonical state transitions are elsewhere. The intended architecture should clarify these responsibilities before code is extracted or duplicated.

## 2. Required semantic lifecycle

This is a conceptual lifecycle, not a proposed API sequence or guarantee that every stage is implemented for every event class.

1. **Observe input** — receive a player/host signal, a due-work trigger, an authorized external event, or a model-proposed action. Preserve source origin and scope; do not infer authority from text labels.
2. **Interpret / propose** — an LLM or a supported world-pack rule may propose an intent, interpretation, or candidate effects. Natural-language output is not a canonical event.
3. **Bind evidence** — identify the source and current world snapshot; collect the read set, causal dependencies, policy context, and source versions that the supported path can actually verify. Missing required evidence means non-ready/reject, not guessed provenance.
4. **Evaluate and validate** — apply the exact pinned rules/templates and declared preconditions. Reject unsupported rule/module capabilities. The read set and relevant snapshot markers must be the ones actually used by evaluation.
5. **Resolve conflicts explicitly** — use a declared, deterministic policy only when the operation supports it. If the applicable policy is missing, competing writes cannot be resolved safely, or a required dependency is unknown, return a rejected/unknown/needs-review result rather than invent an order.
6. **Create or update a proposal** — preserve the evaluated payload and its provenance/fingerprint. Proposal is still not a canonical world effect.
7. **Approve and revalidate** — authorization, policy validity and snapshot freshness must be rechecked at the approved boundary. Stale or changed evidence requires reevaluation or rejection.
8. **Commit canonically** — use the existing Core transaction and commit path. Canonical event, state projection updates, audit and idempotency must obey the existing transaction semantics; no alternate writer is introduced.
9. **Recalculate affected derived state** — rebuild or update only those projections/derived records for which the repository has an explicit supported dependency contract. Do not claim general dependency closure when dependencies were not recorded or cannot be reconstructed.
10. **Publish an authorized result** — expose only the result permitted for the recipient, purpose, and fields at the relevant disclosure boundary. Raw internal snapshots, candidate hypotheses, audit details, or retrieved memory are not automatically model/player-safe output.
11. **Revise / rollback** — preserve audit history and invalidate/recompute represented causal consequences using the existing rollback contract. Missing causal edges cannot be reconstructed by wishful inference; affected state whose validity cannot be established remains non-ready.

A specific runtime slice may implement fewer stages. Documentation and tests must state which stages are present rather than implying the full lifecycle exists everywhere.

## 3. Critical distinctions

- **Scheduling ≠ evaluation:** selecting due work determines what may be eligible to run, not what it means or what effects are valid.
- **Evaluation ≠ conflict resolution:** producing candidates does not determine how incompatible candidates interact.
- **Proposal ≠ commit:** candidate effects cannot mutate canonical state before the existing approval/commit path.
- **Commit ≠ universal recalculation:** existing projections and rollback logic cover explicit implemented dependencies only.
- **Recalculation ≠ disclosure:** a correct internal result may still be unauthorized for a recipient.
- **Causality ≠ dependency completeness:** stored causal references do not prove that every dependency was captured.
- **Consistent snapshot ≠ source authority:** `world_revision + commit_sequence` identifies a snapshot boundary, not a universal source-change journal.
- **LLM interpretation ≠ canonical truth:** intent, threat/flirt interpretation, inferred motive, or character belief must not become canonical fact without the relevant validation and provenance.
- **Unknown ≠ empty:** missing policy, unsupported input, incomplete dependency evidence, or failed reconciliation must not be serialized as a successful empty result.

## 4. Conflict and recalculation policy

A future general planner must be explicit about:
- which input classes it supports (canonical facts, entities, relationships, time triggers, mechanic instances, processes, and/or model proposals);
- how the read set and write set are determined and validated;
- what dependency forms are represented (all-required dependencies versus alternatives, invalidation edges, and derived projections);
- deterministic ordering, conflict policy, cycle detection, and behavior for unsupported dependencies;
- whether recalculation is incremental, full rebuild, or hybrid for each declared source class;
- how rollback, source revocation, restart and interrupted recalculation invalidate previous readiness;
- where work is atomic and where recovery is eventual;
- how output is authorized separately from internal calculation.

No universal graph schema, planner API, queue, outbox, or persistence table is prescribed here. These are design decisions for a later concrete contract based on an identified consumer and measured requirements.

## 5. Relationship to current bounded mechanic execution

Issue #226 / PR #225 is a narrow candidate, not the general core pipeline:
- supported action and effect kinds are intentionally limited;
- the evaluation is bound to an immutable mechanic snapshot and explicit context/policy evidence;
- unsupported inputs/modules/capabilities fail closed;
- accepted effects still use proposal → approval → canonical Core commit;
- the broader production A/B/C recalculation strategy is not selected;
- visibility-policy correctness, policy rotation/revocation boundaries, dependency completeness, and performance thresholds remain separate gates.

Do not expand the bounded executor by silently treating unsupported modules, arbitrary action inputs, participant selection, automatic conflict resolution, or undeclared dependencies as supported.

## 6. Ownership boundaries

- **Core:** canonical state, validation, snapshot consistency, transaction/commit, causal metadata and rollback semantics, explicit supported dependency contracts, authorization decisions, audit, and publication policy.
- **World Pack / domain modules:** domain meanings, rules, action preconditions, conflict policy and the dependency semantics those rules require.
- **LLM layer:** candidate interpretation, action proposal, and narrative wording; it does not directly commit canonical state.
- **TimeEngine:** clock and due-work lifecycle; it supplies triggers/temporal coordinates but does not bypass Core validation/commit.
- **Memory Provider:** archival/indexing/retrieval under its own approved contract; it is not a second canonical state store and cannot grant authorization.
- **Host/Adapter:** source lifecycle and interaction signals; it cannot assert source identity/currentness without evidence.
- **NPC / Personality / Relationships:** domain consumers and candidate producers; each retains its own semantic ownership but cannot bypass Core authorization or canonical commit.

## 7. Minimum acceptance matrix for a future implementation slice

| Case | Required result |
|---|---|
| Invalid or unsupported candidate effect | Rejected/unknown; no canonical mutation or false success. |
| Stale world revision or commit sequence | Proposal/evaluation rejected or reevaluated; no stale commit. |
| Competing writes with no approved policy | Non-ready/rejected; no accidental last-writer-wins. |
| Missing causal/read-set dependency | Fail closed for any guarantee requiring it; do not claim complete recalculation. |
| Failure during canonical commit/audit/proposal finalization | Existing transaction rolls back the required atomic unit; no partial success record. |
| Idempotent replay | Same request returns the same accepted result without a second canonical event; changed payload under the same key conflicts. |
| Rollback of a represented source | Supported dependent effects are invalidated/recalculated; audit remains; unrepresented dependencies are explicitly outside guarantee. |
| Interrupted/restarted recalculation | Prior readiness is invalidated unless a complete/current state can be re-established. |
| Policy revoked or recipient lacks field access | No content, snippet, count, or diagnostic side-channel is disclosed. |
| Candidate hypothesis only | No canonical fact, consent, relationship mutation, or claimed NPC belief is created solely from the hypothesis. |

Every acceptance claim must identify the exact tested commit and evidence class: SOURCE-INSPECTED, FIXTURE-TESTED, RUNTIME-OBSERVED, or REAL-RUNTIME-TESTED.

## 8. Next decision gate

This document is a map and design boundary, not implementation approval. The next Core implementation task must name one current consumer and one bounded gap, tie it to existing files/symbols, state the guarantees it can prove, and add exact-head tests. The bounded mechanic executor/recalculation strategy is tracked in issue #226. TimeEngine durability is tracked separately. Memory→NPC and the ST source lifecycle remain separate integration gates.

Do not create a second canonical writer or invent a general graph/API before the consumer, dependency semantics, consistency boundary, and acceptance tests are approved.
