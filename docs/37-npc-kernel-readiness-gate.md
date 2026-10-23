# NPC/Core Boundary — Provisional Assumptions and Kernel Readiness Gate

Status: planning note for `feat/npc-subsystem`. The core is still under active development. This document is deliberately provisional and must not be read as a claim that the kernel already implements every principle below.

## 1. Purpose

Prevent the NPC subsystem from freezing assumptions about unfinished core behavior. The NPC work can identify requirements and candidate seams, but it must not force the kernel to adopt unapproved semantics or duplicate mechanisms that the kernel is still developing.

This document is a coordination checklist, not a runtime contract, implementation plan, or acceptance verdict on the core.

## 2. Evidence labels

Use these labels in NPC design notes and reviews:

- **Observed** — directly confirmed in the currently inspected source or tests. State the exact function, route, schema, or test that supports it.
- **Documented target** — described in a core design/contract document, but not necessarily implemented or complete.
- **Candidate seam** — an existing mechanism that might be reused after its contract is confirmed.
- **Open core decision** — semantics are still being designed or have not been confirmed against current core implementation.
- **NPC requirement** — behavior the NPC subsystem needs, without implying the core already supports it.
- **Deferred** — do not implement or test as a kernel guarantee until the owner of the core approves the semantics and implementation exists.

Never silently upgrade a documented target, candidate seam, or NPC requirement into an observed core guarantee.

## 3. Current provisional inventory

| Topic | Current label | Safe statement | Do not assume yet |
|---|---|---|---|
| Context manifest | Observed / candidate seam | Existing code registers and persists a manifest with snapshot-related identifiers and references. | That it is a model-ready context, actor-specific access proof, complete knowledge ledger, or immutable binding to the exact model input. |
| Proposal lifecycle | Observed / candidate seam | Existing service can create pending proposals and has approval/commit paths with validation and stale-snapshot checks. | That a valid proposal is semantically faithful, actor-authorized, safe for player agency, or fully causally justified. |
| Canonical state and revisions | Observed, within current APIs | Existing engine owns current canonical event/state operations and revision-related checks. | That every future NPC state category is already represented or that all revision semantics are final. |
| Rollback and causality | Documented target plus partial implementation | Existing code/tests cover some causal invalidation and preservation cases; design docs describe broader goals. | That every causal edge, derived fact, external effect, or future NPC action has complete rollback semantics. |
| Condition evaluation | Observed limitation | Current evaluator returns boolean for the inspected condition path; missing paths can collapse to false for several operators. | That false, unknown, incomplete, inaccessible, and conflicted are already distinct kernel values. Do not change this globally from NPC code. |
| Actor identity and authorization | Open core decision | NPC integration will need a trusted actor identity and a defined authorization boundary. | That adapter identity is the same as in-world actor identity, or that proposal approval is actor authorization. |
| NPC belief and knowledge | NPC requirement / deferred core dependency | NPC behavior must not confuse canonical truth with what a character believes or has learned. | That a canonical NPC belief store, provenance model, or actor-specific knowledge API already exists. |
| Intent-to-effect mapping | Open core/NPC coordination decision | NPC proposals need an explicit mapping to effects the core supports. | That high-level mechanics intents can be sent directly wherever the lower-level validator expects core effects. |
| Player agency | NPC requirement / deferred integration policy | The NPC layer must not invent or commit player-controlled dialogue, thoughts, or decisions. | That a universal player-agency policy already exists in core services. |
| Time progression | Observed only for explicit current paths; wider semantics open | NPC generation must not independently mutate the world clock. | That all chat-turn, event-time, and scheduled-event semantics are complete and final. |

This table is intentionally conservative. Reclassify items only after inspecting the relevant current branch and identifying evidence.

## 4. Test policy while the core is being written

Tests must follow implementation and approved semantics—not the other way around.

### Tier 0 — source facts

May be recorded now: what a named function currently accepts/returns, what a route calls, what a schema validates, and which existing tests exercise it. Mark the inspected commit or branch when practical. These are audit facts, not permanent architectural guarantees.

### Tier 1 — existing-core regression tests

May be run unchanged against the core's current supported Node version. Their purpose is to detect regressions in behavior the core already claims to implement. Do not broaden them to enforce new NPC semantics.

### Tier 2 — proposed semantic tests

Keep as scenarios/specifications only while the relevant kernel principle or owner decision is unsettled. Examples include tri-state knowledge, actor-specific access, causal ownership for NPC actions, and complete player-agency enforcement. Do not implement fake services just to make these tests pass.

### Tier 3 — integration acceptance tests

Write only after:
1. the kernel owner has agreed on the relevant semantics;
2. a real implementation boundary exists;
3. its inputs, outputs, errors, and ownership are documented;
4. the test can exercise real code rather than a mock that assumes the desired result.

### Tier 4 — persistence/API tests

Do not add or change these from the NPC branch unless the core owner explicitly approves API, schema, or storage changes.

## 5. Review protocol for every proposed NPC test

Before converting a scenario into an executable test, answer:

1. Is the expected behavior already implemented, merely documented, or still proposed?
2. Which exact source function or existing test proves that status?
3. Is the behavior owned by core, NPC subsystem, or their integration adapter?
4. Would this test require a new core principle or change existing global semantics?
5. Could the same behavior be tested at a narrower layer without mocking an unimplemented system?
6. Has the relevant design decision been approved by the core owner?
7. If the answer is uncertain, can the scenario remain a documented requirement rather than an executable test for now?

A test must not fail the kernel for not implementing a future principle that has not been agreed or delivered. Conversely, a passing mock-based test must not be presented as proof that the real boundary is safe.

## 6. Current next step

Do not add runtime code or new executable NPC tests at this stage. Maintain the semantic scenarios as requirements, continue source-level discovery, and classify each proposed test using the evidence labels above.

The next implementation step should be chosen only after the kernel's current work and decisions are checked again. If the core changes, update this inventory rather than treating this note as authority over the core.


## 7. Active core work discovered during source-level review

This is a time-bounded branch snapshot, not a statement that any listed change is merged or approved. The default branch inspected for this review was `main` at `cb4ad189f12484ca5458c30b1d176cbd9f7d4ccc`. Always re-check current branch heads and PR dependencies before relying on this inventory.

| Area | Observed development location | Safe interpretation for NPC work |
|---|---|---|
| Universal mechanic execution | `docs/core-stage1.3-mechanics-execution-contract`, including `docs/30-stage1.3-mechanic-execution-boundary.md` | A proposed core execution contract exists on a separate branch. Its stated scope explicitly excludes NPC goals, plans, schedules, and off-screen autonomy. Do not treat it as shipped runtime behavior. |
| Mechanic intent translation and proposal integration | `feat/mechanic-effect-translator`, `docs/mechanic-intent-proposal-boundary`, and `feat/mechanic-intent-proposal-integration`; PRs #36–#40 form a stacked sequence | Translation and proposal integration are being developed with tests and explicit fail-closed limits. Keep the stack's dependencies and unresolved decisions intact; do not create a second translator in the NPC subsystem or assume these changes are already in `main`. |
| Typed causal links | `feat/typed-causal-links` | A separate implementation/test line exists. Because it diverges from `main`, its exact semantics must be reviewed against current core decisions before NPC work depends on them. |
| Historical tri-state predicates | `feat/tri-state-historical-fact-predicates` | Work exists around historical predicate uncertainty. This does not prove that general rule evaluation has a universal tri-state result; keep the observed boolean behavior of the inspected `main` path distinct from branch-specific behavior. |
| Generation-bound context manifests | `feat/generation-bound-context-manifests` | A separate line develops manifest binding and persistence behavior. Do not assume that the `main` manifest is already immutably bound to the exact model input or that it proves actor-specific access. |
| Proposal validation before approval | `feat/validate-proposals-before-approval` | A separate proposal-lifecycle change exists. Re-check its current diff and dependencies before asserting where validation occurs in the final lifecycle. |

### Consequences for NPC planning

1. Use `main` to state what is currently shipped; use a feature branch only as evidence that work is in progress.
2. Do not copy code, tests, or assumptions from a diverged branch into the NPC branch without first checking its current PR, base, dependency stack, and approved contract.
3. Treat mechanic intent translation as a potential shared core capability, not an NPC-owned implementation. The NPC subsystem should express its needs and wait for the agreed boundary rather than fork the translator.
4. Keep open questions—especially provenance mapping, canonical fact identity/replacement semantics, actor authorization, and the general meaning of unknown/incomplete context—open until the relevant core owner resolves them.
5. This branch inventory is evidence for coordination only. It does not authorize merges, rebases, API/storage changes, or runtime implementation.

## 8. Non-authority statement

This document does not amend the kernel contract, freeze its architecture, require a new knowledge/access-control subsystem, or authorize changes to runtime code, API, schemas, storage, event semantics, rollback, prompts, or SillyTavern. It exists to keep the NPC branch aligned with the evolving core.
