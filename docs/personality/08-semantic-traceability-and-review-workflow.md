# Personality Block — Semantic Traceability and Review Workflow

Status: documentation-only quality-control contract. This document makes existing semantic requirements easier to review and trace. It does not add runtime behavior, authorize API/schema/storage changes, or claim integration tests pass.

## 1. Purpose

The Personality block has several complementary documents: semantic invariants, an acceptance matrix, a World Pack dimension template, a stable-trait lifecycle contract, and Core integration gates. This traceability guide states which artifact is authoritative for each kind of decision and how to keep a proposed change from silently crossing ownership boundaries.

Use this document to answer four questions for every change:
1. What semantic rule or acceptance case is being changed or clarified?
2. Which block owns the decision?
3. What evidence supports the current status?
4. Does the change remain a specification, or has it actually been implemented and tested?

## 2. Source-of-truth order

When reviewing Personality documentation, apply this order without treating it as permission to override another block's ownership:

1. **Author-confirmed world canon and explicit project decisions** define the intended fictional/domain facts.
2. **Core-owned implementation contracts and verified source behavior** define what canonical operations, authorization, provenance, reads, commits, and rollback actually support.
3. **Personality semantic documents** define the intended meaning of traits and relationship state within the boundaries above.
4. **World Pack definitions** instantiate supported relationship dimensions and world-specific transition rules; they cannot weaken Core guarantees.
5. **NPC decision and character-card contracts** define how consumers use authorized projections; they do not create alternate canonical personality state.
6. **Narrative text, retrieval results, model interpretations, and character-card prose** are not by themselves canonical writes or proof of knowledge, cause, consent, or authorization.

If two sources conflict, do not silently choose a winner. Record the conflict, preserve the more restrictive implementation/authorization boundary, and route the unresolved semantic or ownership decision to the responsible block.

## 3. Requirement traceability map

| Requirement family | Canonical semantic reference | Acceptance references | Owner of closure | Current status |
|---|---|---|---|---|
| Direction and participant identity | `01-personality-and-relationship-semantics.md`, §4 | PERS-SEM-001, 009–010; PERS-REL-001, 007–008 | Core for canonical IDs; Personality/World Pack for semantics | Semantics specified; typed write not implemented/verified |
| Partial update and state distinctions | `01-personality-and-relationship-semantics.md`, §4; `05-world-pack-relationship-dimension-template.md`, §3 | PERS-SEM-002–004 | Personality defines meaning; Core defines operation/read representation | Semantics specified; exact operation/wire representation unresolved |
| Dimension values and transitions | `05-world-pack-relationship-dimension-template.md`, §§2, 5–6 | PERS-SEM-006–007 | World Pack defines domain; Core enforces approved boundary | Authoring requirements specified; runtime readiness is per-dimension and remains unverified |
| Scene co-presence and implicit transitions | `01-personality-and-relationship-semantics.md`, §4; `04-semantic-acceptance-matrix.md`, §2 | PERS-SEM-008; PERS-REL-004 | Personality semantics; Core typed write boundary | Specified; typed write remains blocked |
| Initial/imported, in-world, correction provenance | `01-personality-and-relationship-semantics.md`, §4.1; `03-core-decision-and-integration-gates.md`, §5 | PERS-SEM-011–013; PERS-TRAIT-004 | Core for trusted operation, authorization, and audit | Semantic distinction approved; trusted boundary unresolved |
| Stable traits and development | `06-stable-trait-lifecycle.md`, §§2–6 | PERS-SEM-014–017; PERS-TRAIT-001–010 | Personality for semantics; Core for canonical mutation; NPC for decision use | Semantic contract specified; no automatic inference/runtime support claimed |
| Cross-dimension isolation and relationship non-implications | `01-personality-and-relationship-semantics.md`, §§3–5; `05-world-pack-relationship-dimension-template.md`, §4 | PERS-SEM-005, 018–020 | Personality/World Pack | Semantic contract specified; each World Pack must declare any intentional cross-dimension rule explicitly |
| Rollback and causal support | `03-core-decision-and-integration-gates.md`, §§3, 6 | PERS-SEM-021–024; PERS-REL-013–014 | Core for causal representation/rebuild; World Pack for domain sufficiency | Conditional replay target only; relationship-specific guarantees unverified |
| Actor-authorized reads and withheld values | `03-core-decision-and-integration-gates.md`, §4 | PERS-SEM-025–026; PERS-TRAIT-009 | Core | Blocking; snapshot consistency does not equal authorization |
| Character-card projection | `01-personality-and-relationship-semantics.md`, §§2, 4; `07-cross-block-readiness-and-handoff.md` | PERS-SEM-027; PERS-REL-012 | Core/card owner for view; Core for authorized read | Read-only semantic target; safe runtime projection unverified |
| Player agency | `01-personality-and-relationship-semantics.md`, §3; `06-stable-trait-lifecycle.md`, §7 | PERS-SEM-028; PERS-TRAIT-008 | Project-level player-control contract, respected by Personality/NPC | Semantic invariant specified |
| Versioned relationship semantics | `05-world-pack-relationship-dimension-template.md`, §§2, 5–6 | PERS-SEM-029; PERS-SEM-024, with PERS-SEM-006–007 for active-rule validation | World Pack owns semantic version/compatibility policy; Core owns any version-pinning, migration, and replay mechanism | Authoring requirement specified; historical rule-version enforcement remains unverified/blocked |
| Versioned relationship semantics | `05-world-pack-relationship-dimension-template.md`, §§2, 5–6 | PERS-SEM-029; PERS-SEM-024, with PERS-SEM-006–007 for active-rule validation | World Pack owns semantic version/compatibility policy; Core owns any version-pinning, migration, and replay mechanism | Authoring requirement specified; historical rule-version enforcement remains unverified/blocked |

Acceptance IDs are stable references. If a scenario is split, renamed, or retired, preserve a redirect/cross-reference so downstream docs do not silently lose traceability.

## 4. Status vocabulary

Use these terms consistently in this block:

- **Semantic rule specified:** the intended meaning and required outcome are documented.
- **Contract proposed:** an interface or behavior is described for review but has not been approved by its owner.
- **Owner-approved contract:** the responsible block explicitly approved the contract; this does not prove implementation.
- **Source-verified:** the named code path was inspected at a stated branch/commit and supports the exact claim.
- **Implemented:** the behavior exists in the relevant runtime path; name the path/commit when material.
- **Tested on production boundary:** tests exercise the real supported interface and assert canonical and actor-visible outcomes.
- **Blocked:** a required contract, implementation, or test is missing.
- **Deferred/unsupported:** intentionally outside the first slice; callers must not assume it works.

Avoid unqualified labels such as “done,” “supported,” “ready,” or “passed” where they could conflate semantic design with runtime behavior. A green general CI run does not prove every acceptance case is implemented.

## 5. Change workflow

For each proposed Personality documentation change:

1. **Identify the trigger.** Cite the author decision, Core response, verified code path, or acceptance gap that requires the change.
2. **Name the owner.** Keep relationship meaning and trait semantics in Personality/World Pack; keep canonical writes, identity, provenance authorization, safe reads, commit/audit/revision, and rollback in Core; keep decision orchestration in NPC; keep cards as derived views.
3. **Update the semantic source first.** Modify the relevant primary contract before updating cross-reference or handoff summaries.
4. **Trace the acceptance IDs.** Add or revise scenarios only when the expected result is clear. State which boundary must be tested and avoid pretending a specification is executable.
5. **Update readiness status.** Mark each claim as specified, proposed, approved, source-verified, implemented, tested, blocked, or deferred using §4.
6. **Check non-implications.** Ensure the change does not silently infer reciprocity, knowledge, consent, cause, truth, identity, or authorization from a relationship label, narrative, or trait.
7. **Check cross-document links and wording.** Remove stale claims that a blocker is closed, but do not rewrite another block's ownership or contract without evidence.
8. **Report the scope honestly.** State which files changed and whether runtime code or tests changed/run. A documentation-only update is not an implementation.

## 6. Review checklist

Before considering a Personality documentation change internally consistent:

- [ ] No generic relationship score or universal dimension list has been introduced by assumption.
- [ ] A → B remains distinct from B → A.
- [ ] Omitted dimensions remain unchanged; clearing is explicit.
- [ ] Unset (sometimes called unknown only when no canonical value exists), explicit neutral, withheld/inaccessible, cleared, and conflict/insufficient-support reconciliation results are not conflated.
- [ ] A relationship does not imply knowledge, consent, reciprocity, truth, or cause.
- [ ] Stable traits remain separate from current condition, goal, belief, behavior, and hypothesis.
- [ ] Canonical identity and trusted authorization are not inferred from names, caller labels, or prose.
- [ ] Rollback claims match the exact approved and verified causal model.
- [ ] Character cards and NPC context remain consumers of authorized canonical state, not duplicate stores.
- [ ] Player-controlled voluntary actions, dialogue, and thoughts remain outside engine/model authorship.
- [ ] Acceptance criteria identify real boundaries and do not claim unrun tests.
- [ ] Runtime readiness is not declared while required Core gates remain blocked.

## 7. Current handoff summary

As of this document's creation, the Personality-side semantic contracts are documented. The following remain integration blockers unless Core later provides explicit contract/implementation evidence:

- typed canonical relationship operation and atomic partial update;
- trusted distinction and authorization for initial/imported state, in-world transition, and author correction;
- actor/purpose/snapshot-scoped authorized read/filter and safe result states;
- the first-slice causal representation and verified deterministic replay/rollback for typed relationship transitions;
- any multi-source alternative-support/conflict reconciliation beyond the declared replay-only subset;
- production-boundary tests and a read-only authorized character-card projection.

PR #45 (bounded consistent snapshot) and PR #46 (opt-in tri-state condition results) are merged into `main`; the snapshot/context extension was merged via PR #49. These primitives do not constitute an actor/purpose-authorized read/filter interface or establish NPC behavior. No new Core or NPC behavior is inferred from this status summary. Update this section only when evidence changes.

## 8. Related documents

- `01-personality-and-relationship-semantics.md`
- `02-core-integration-review-request.md`
- `03-core-decision-and-integration-gates.md`
- `04-semantic-acceptance-matrix.md`
- `05-world-pack-relationship-dimension-template.md`
- `06-stable-trait-lifecycle.md`
- `07-cross-block-readiness-and-handoff.md`
- `09-per-case-acceptance-traceability.md` — individual mapping for all PERS-SEM cases and stable-trait criteria, with ownership and runtime evidence status.
