# NPC internal-conflict evaluator — isolated cognition slice

**Status:** isolated NPC-owned implementation candidate; no production orchestration or persistence.  
**Purpose:** classify candidate actions when an NPC's active motives conflict, without collapsing values, obligations, needs, fears, and goals into one universal personality score.

## Scope

The module src/npc/internal-conflict-evaluator.js is a pure deterministic evaluator over caller-supplied active motives, candidate options, hard-constraint assessments, feasibility assessments, and explicit conflict-resolution rules.

It does not:
- discover goals, motives, options, or evidence;
- authenticate the caller or prove that assessments are true or current;
- read Core, Memory, Relationships, Personality, or World Pack state;
- create or persist beliefs, goals, plans, intentions, or conflict records;
- call a language model, select a winning option, execute an action, or mutate canonical state;
- turn unknown or withheld information into a negative fact;
- invent a universal priority order for moral or value conflicts.

The caller must pass only active motives and assessments already admitted by its owning boundary. This helper is not an authorization or integration seam.

## Input contract

The input contains three arrays:

- motives: objects with unique id and kind;
- options: objects with id, supported motive IDs, frustrated motive IDs, feasibility, and hard-constraint assessments;
- resolutions: objects identifying a conflicting pair, the preferred motive, and a reference to the applicable rule.

Motive kind is one of goal, obligation, value, need, fear, or commitment. Every motive and option ID is unique. Motive references must resolve within the supplied active-motive set. A resolution covers one unordered pair, explicitly prefers one of its two motives, and cites an applicable author or World Pack rule. Duplicate pair resolutions are invalid.

## Per-option outcomes

| Outcome | Meaning |
|---|---|
| eligible | Feasibility and hard constraints are explicitly clear, and every support/frustration conflict is either absent or resolved in favor of the option. |
| ineligible | A hard constraint is violated, feasibility is explicitly false, or an explicit resolution prefers a motive the option frustrates. |
| needs_review | A hard constraint or feasibility is unknown, or at least one motive conflict has no explicit resolution. |
| non_ready | Input shape, references, bounds, uniqueness, or required fields are invalid. No option is admitted. |

The top-level result lists eligible, review, and ineligible option IDs. It deliberately does not choose a winner. The existing intention selector remains responsible for selection among eligible candidates under its own priority and cost rules.

## Required invariants

1. **Hard constraints are not priorities.** A violated hard constraint excludes an option regardless of goal priority.
2. **Unknown is not success.** Unknown feasibility or constraint status requires review.
3. **Conflicting motives are retained.** If an option advances one active motive while frustrating another, an explicit applicable rule must resolve that pair; otherwise the option is not silently selected.
4. **No universal scalarization.** This helper does not add together loyalty, fear, obligation, affection, or values into one score.
5. **No unsupported authority.** A rule reference identifies the caller-supplied resolution basis; this helper does not authenticate the rule or its current validity.
6. **No mutation or execution.** The helper returns a classification only. It cannot commit actions, persist state, or certify outcomes.
7. **Fail closed.** Malformed, sparse, duplicate, or unknown references produce non_ready rather than a partial evaluation.

## Focused acceptance coverage

- Independent options remain eligible and no winner is selected by this helper.
- An unresolved obligation-versus-goal conflict produces needs_review.
- An explicit rule can resolve a conflict for or against a candidate.
- A violated hard constraint excludes an option regardless of motive priority.
- Unknown feasibility or constraint status is preserved as needs_review.
- Unknown motive references, duplicate resolution pairs, missing rule references, and sparse arrays are rejected.
- Accessor-backed fields are rejected without invoking their getters.
- Caller-owned input remains unchanged.

## Integration boundary

This is a pure NPC-block capability, not an end-to-end cognition claim. A future caller must supply trusted, current assessments and pass eligible candidates to the existing intention selector. Any persistent conflict history, model-generated motive discovery, authoring UI, World Pack rule loader, or production invocation requires a separate reviewed contract. Memory-to-NPC remains independently disabled; this change neither uses nor enables it.
