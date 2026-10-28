# NPC plan viability — isolated capability slice

## Purpose

This pure NPC-owned evaluator decides whether an existing plan may continue, should be treated as blocked, needs reconsideration, or needs review. It makes plan assumptions and uncertainty explicit instead of treating an old plan as an unconditional script.

## Inputs and outcomes

The caller supplies a plan status, declared assumption IDs, declared blocker IDs, and an assessment for each. Each assumption is `holds`, `contradicted`, or `unknown`; each blocker is `clear`, `active`, or `unknown`; the deadline is `not_due`, `due`, or `unknown`.

- `continue`: all declared assumptions hold, all blockers are clear, and the deadline is not due.
- `blocked`: at least one declared blocker is active, unless an assumption contradiction or passed deadline already requires reconsideration.
- `reconsider`: an assumption is contradicted or the deadline has passed. The evaluator does not invent a replacement plan.
- `needs_review`: evidence is unknown or an assessment is missing.
- `resume_candidate`: a previously blocked plan now has explicit clear checks. This is not an unblock event; the caller must separately validate and apply the existing plan transition.
- `not_applicable`: the plan is already completed or abandoned.
- `non_ready`: malformed, duplicated, sparse, or out-of-scope input.

## Boundaries

The evaluator does not inspect the world, verify the truth or authority of supplied checks, generate goals or alternative plans, execute actions, persist state, schedule off-screen work, or mutate canonical world state. Unknown is not success. Missing assessment coverage is not proof that an assumption holds or a blocker is clear. The output is an NPC-local recommendation only and must not be interpreted as an authenticated world event.

This is not production autonomy and does not enable Memory → NPC. A trusted caller, persistent state integration, and approved execution/scheduling path remain separate work.
