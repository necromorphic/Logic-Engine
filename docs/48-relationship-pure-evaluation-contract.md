# Relationship Module — Pure Domain Evaluation Contract

Status: **schema-neutral proposal for the Relationship block**. This document defines the conceptual boundary of a side-effect-free domain evaluation. It is not a runtime API, wire schema, Core operation, storage contract, or claim that the full Relationship module is implemented. Any standalone pure evaluator developed separately is a narrower candidate-producing slice and does not, by itself, satisfy this full contract or establish runtime integration.

Related:
- `docs/46-relationship-domain-module-design.md` — module ownership, lifecycle, and domain rules.
- `docs/47-relationship-module-test-traceability.md` — acceptance cases and test readiness.
- `docs/42-npc-relationship-state-contract-proposal.md` and `docs/45-npc-relationship-typed-operation-design.md` — existing relationship semantics and Core integration limits.
- `docs/personality/05-world-pack-relationship-dimension-template.md` — per-dimension authoring requirements.

## 1. Purpose

Specify what the relationship domain evaluator may conclude from an explicit, bounded input and what it must return without taking ownership of canonical state.

The evaluator's output is a **candidate result**. It is not a committed relationship change and grants no authority to commit one.

## 2. Evaluation boundary

The conceptual evaluator receives only inputs already assembled and authorized by its caller:

- exact evaluator and World Pack rule versions;
- a canonical event/trigger reference or an explicitly non-canonical authoring request;
- the directed subject and target references;
- the relationship dimensions and values actually available to the evaluator, preserving unset/neutral/withheld/conflict distinctions;
- the subject-specific evidence and knowledge permitted for this evaluation;
- relevant profile values, goals, context, and pair-specific history, each with explicit source/status;
- the current effective relationship projection and its revision/version marker, if the caller is permitted to provide them.

This list is conceptual, not a payload schema. The evaluator must not fetch unrestricted state, resolve names into entities, discover secrets, infer authorization from caller-supplied identity labels, or read an independent history store.

The caller is responsible for supplying the correct actor, purpose, scope, and authorized evidence. A domain evaluator cannot turn an unauthorized input into an authorized one.

## 3. Pure evaluation invariants

For the same explicit input, same pinned rule versions, and same deterministic configuration, evaluation must produce the same candidate result.

Evaluation must:
1. perform no canonical writes, commits, audit writes, event creation, scheduling, or external side effects;
2. never mutate its input or hidden shared state;
3. affect only the explicitly directed subject → target pair;
4. propose changes only for named, supported dimensions;
5. preserve omitted dimensions and all state distinctions;
6. not infer reciprocal state, knowledge, consent, motives, causality, or obligations from a relationship label alone;
7. not count the same event/history item repeatedly as fresh evidence;
8. avoid time-, turn-, or scene-count drift unless an explicit versioned rule defines a meaningful time-dependent transition and receives authoritative time as input;
9. retain enough rule/version and evidence-reference information for the caller to validate and attribute a candidate through the approved path, without treating evaluator-generated rationale as proof of cause;
10. fail closed to a non-mutating result when a required input, rule, or capability is unsupported.

If probabilistic model interpretation is used upstream, its result is an explicit input/proposal. It is not hidden randomness inside the canonical reducer. Any nondeterministic proposal requires separate policy and must not be described as deterministic replay.

## 4. Candidate result classes

The domain boundary must distinguish at least the following semantic outcomes. Names here are descriptive labels, not mandated enum strings or a wire contract.

| Outcome class | Meaning | Canonical effect |
|---|---|---|
| Candidate transition | One or more justified, supported dimension changes are proposed | None until independently validated and committed through Core |
| No change | Evaluation is supported, but no transition is justified or needed | None |
| Insufficient evidence | Available evidence cannot justify a transition | None; do not guess |
| Conflict / review required | Valid inputs or rules conflict and no declared resolver applies | None; preserve conflict/review status |
| Unsupported capability/rule | Required dimension, rule, input status, or host capability is unavailable | None; do not fabricate a neutral/default result |
| Invalid candidate | A requested dimension/value/transition violates the active domain contract | Reject candidate; no partial effect |
| Stale basis | A supplied revision or source basis is no longer current when checked by the host | Evaluator cannot commit; caller must re-read/re-evaluate through the approved path |

A pure evaluator may not know that a candidate is stale unless the caller supplies a validated revision comparison result. It must not independently decide that a stale candidate can be rebased.

**Withheld** is an access result, not evidence that a relationship is unset. **Unset** is absence of an established value. **Explicit neutral** is a domain value. **Cleared** is an authorized lifecycle operation. **Conflict/insufficient support** is a reconciliation outcome unless a World Pack explicitly models a distinct domain value. These states must not be collapsed into one default.

## 5. Candidate transition shape — conceptual only

A candidate should be expressible in terms of:
- directed subject and target references;
- an explicit patch of affected dimensions only;
- the expected current-state/revision basis used during evaluation, where available;
- references to the already-authorized trigger/evidence inputs;
- the exact rule/World Pack version;
- a structured outcome and validation/review reasons.

This is a semantic checklist, not a proposed JSON object. The Core owner defines the accepted typed effect, identity encoding, trusted attribution, idempotency, atomicity, and revision checks. Do not implement this checklist as a new API or storage schema in the Relationship block.

A candidate must not use a free-form rationale as a substitute for evidence references. It must not accept caller-supplied provenance text as proof that an author, system, or NPC was authorized.

## 6. Re-evaluation, duplicates, and event history

Repeated evaluation of the same event must not itself accumulate relationship change. The host should ensure a given trigger is not committed twice for the same logical transition, using whatever approved idempotency/event contract exists.

The evaluator must distinguish:
- a genuinely new event;
- a repeated presentation of an already-seen event;
- a new observation or acquisition of information about an old event;
- a correction to a prior interpretation;
- a replay/rebuild of already committed history.

These situations are not interchangeable. A newly learned fact about an old event may justify a new interpretation only if the knowledge contract confirms the acquisition and the domain rule allows re-evaluation. It must not silently rewrite an earlier transition. Correction, replay, and migration require their own explicit host/Core contracts.

If the caller cannot establish which situation applies, the evaluator returns a non-mutating insufficient/unsupported/review result rather than guessing.

## 7. Composition with Personality and NPC

- Personality supplies bounded, versioned stable traits/values and enduring constraints. Relationship evaluation may consider them but must not rewrite them.
- NPC supplies the decision context and may consume authorized relationship projections. A relationship candidate does not dictate an NPC's action.
- For player-controlled characters, the evaluator cannot author voluntary thoughts, dialogue, decisions, or actions.
- Knowledge supplies subject-specific evidence/acquisition status. Relationship state cannot grant knowledge or reveal another actor's private beliefs.
- Narration and character-card projections are downstream read-only consumers; prose or card edits cannot commit a relationship change.

## 8. Failure and disable behavior

If the Relationship capability is absent, disabled, version-incompatible, or missing a required rule, no evaluator result may be replaced with an invented neutral relationship. The caller receives the host's supported unavailable/unsupported result, or must omit relationship-dependent behavior.

Disabling the module prevents new evaluations. It does not delete committed state or history, replay missed events, or reverse previous transitions. Re-enabling does not perform implicit catch-up.

A validation failure must reject the candidate as a whole. A later Core commit failure must not be represented as a successful canonical change; the evaluator itself has no rollback responsibility.

## 9. Acceptance checks

These checks are pure-domain or consumer-boundary targets unless explicitly marked otherwise:

1. **Determinism:** same bounded inputs and versions yield the same candidate.
2. **Purity:** evaluation has no write or event side effects.
3. **Direction:** A → B evaluation never patches B → A.
4. **Partial patch:** omitted dimensions remain unchanged.
5. **Knowledge partition:** evidence unavailable to subject A cannot influence A's candidate.
6. **No drift:** repeated evaluation of one event does not accumulate changes.
7. **Outcome distinction:** unset, neutral, withheld, cleared, conflict, unsupported, and insufficient evidence remain distinct.
8. **No inference:** affection does not imply trust, consent, reciprocity, knowledge, or loyalty absent an explicit rule.
9. **Atomic candidate validation:** one invalid requested dimension rejects the whole candidate, rather than returning a silently truncated patch.
10. **Version pinning:** changing the active World Pack version does not silently re-interpret a prior candidate or committed event.
11. **Disabled module:** no evaluation or catch-up occurs while disabled.
12. **Host boundary:** a plausible candidate cannot become canonical without the approved Core operation, trusted provenance, authorization, and revision/atomicity checks.

The first eleven can be covered by pure-domain tests once an evaluator boundary exists. The final check requires production Core integration tests and remains blocked by the dependencies documented in `docs/46-relationship-domain-module-design.md` §10.

## 10. Readiness

This contract is ready for semantic review, not runtime implementation. It does not settle:
- the evaluator's concrete language-level function signature;
- canonical relationship effect/payload or storage representation;
- actor/purpose authorization and trusted evidence acquisition;
- Core commit, idempotency, audit, revision, replay, rollback, or alternative-support contracts;
- the executable mechanic host contract.

Do not invent these interfaces in the Relationship block. Any unresolved question requiring a Core decision must be sent to the user, who decides whether and how to relay it to Core.
