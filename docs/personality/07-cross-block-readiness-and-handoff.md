# Personality Block — Cross-Block Readiness and Core Handoff

Status: documentation-only integration handoff, checked against the Personality branch and current public PR metadata on 2026-10-24. This document does not authorize implementation, merge, or a new runtime/API/schema/storage contract.

## 1. Purpose

The Personality semantic contract is now documented in a form that can be reviewed against core and NPC work without creating a parallel relationship model. This handoff identifies what is settled, what belongs to another block, and what remains a real implementation gate.

## 2. Source-of-truth and scope

- [01 — Personality and relationship semantics](./01-personality-and-relationship-semantics.md) defines this block's semantic scope and invariants.
- [03 — Core decision and integration gates](./03-core-decision-and-integration-gates.md) is the authoritative record of the core owner's decisions and remaining blockers.
- [04 — Semantic acceptance matrix](./04-semantic-acceptance-matrix.md) lists semantic acceptance targets; these are not claims of passing runtime tests.
- [05 — World Pack relationship dimension template](./05-world-pack-relationship-dimension-template.md) specifies the domain information required for each supported dimension.
- [06 — Stable trait lifecycle](./06-stable-trait-lifecycle.md) specifies the distinction between stable traits, mutable conditions, goals, beliefs, observed behavior, and hypotheses.
- The NPC branch's [docs/42-npc-relationship-state-contract-proposal.md](https://github.com/necromorphic/Logic-Engine/blob/feat/npc-subsystem/docs/42-npc-relationship-state-contract-proposal.md) is the adjacent relationship integration proposal. It contains additional NPC-specific concerns such as unresolved descriptive references and card/decision-context usage. It is on feat/npc-subsystem, not this branch; do not assume it is merged or use it as evidence of runtime behavior.

The Personality block defines semantic meaning. It does not own canonical persistence, access control, actor-specific knowledge, runtime scheduling, or rollback implementation.

## 3. Settled semantic rules

The following are treated as agreed, not reopened by this handoff:

1. Relationship state is directed and multidimensional; A→B does not imply B→A.
2. A partial update affects only dimensions explicitly supplied.
3. Unknown/unset, explicit neutral, withheld/inaccessible, and an authorized clearing operation are distinct.
4. No dimension silently mutates another. Any intentional cross-dimension rule must be explicit, testable, provenance-bearing, and rollback-aware.
5. Relationship state does not by itself prove knowledge, consent, reciprocity, obligation, the truth of a claim, or the reason a value exists.
6. Stable personality traits are not rewritten by a single observed action, temporary condition, or model-generated motive.
7. World Pack owns the meaning and permitted values/transitions of its supported dimensions. No universal dimension list or value scale is assumed.
8. Character-card content is a derived, read-only view, not a second canonical store.
9. Core owns the canonical typed write, authorization, audit/revision/event lifecycle, safe read, projection rebuild, and rollback.
10. Deterministic replay of surviving valid typed transitions is an approved conditional first-stage target only where replay is semantically sufficient. The exact first-slice causal representation remains a Core gate; this does not imply OR-style alternative support or prove relationship replay exists in runtime.

## 4. Current integration evidence and limits

### PR #45 — consistent internal snapshot read

As checked on 2026-10-24, PR [#45](https://github.com/necromorphic/Logic-Engine/pull/45) is open and unmerged. Its latest reviewed head in the PR metadata is 09e48c2fd764c8e3f7b1e8f96e485a58ea34c793; the recorded runtime-test workflow passed on that head.

The PR's bounded getSnapshot(...) / readSnapshot(...) primitive is a candidate canonical snapshot boundary. The diff and its tests support a coherent bounded read in the tested SQLite rollback-journal and WAL scenarios, deterministic ordering, world scoping, and the composite world_revision + commit_sequence marker.

It is **not** an actor-authorized read interface. It returns raw canonical internal records and does not implement actor/purpose authorization, secret filtering, actor-specific knowledge, acquisition, belief, or delivery semantics. It must not be passed directly to an NPC, narrator, player, or host adapter. A green test run for this PR is evidence for the narrow snapshot primitive only.

### Relationship operation

No typed relationship effect/operation is exposed by the inspected runtime. Core has approved the semantic direction: one typed effect for one directed participant pair and transition, with a partial dimension patch; omitted keys mean unchanged; clearing is explicit; the whole patch is validated and committed atomically. The exact effect payload/name, public API, storage representation, and implementation are not approved. Generic entity attributes and `fact.set` are not substitutes. Before the contract can close, Core must specify the first-slice causal representation and the trusted authoring/import/correction boundary, then verify the operation against existing typed-effect conventions and real-path tests.

### Authoring, import, and correction

Initial/imported state, in-world transitions, and author corrections are distinct semantic origins. Generic event/audit infrastructure exists, but a trusted author/actor authorization boundary that enforces these classifications is not established. A caller-supplied origin label cannot confer authority. A trusted core-owned operation/authorization boundary and auditable lifecycle remain prerequisites.

### Rollback and independent support

Core approves deterministic replay of surviving valid typed transitions only where that is semantically sufficient; the first-slice representation is still unresolved. `caused_by` and `depends_on` are required-dependency metadata, not OR-support lists. Multi-source sufficiency/conflict reconciliation remains unsupported unless a narrow domain rule and core-owned representation/reducer/tests are approved. Existing generic rollback is not evidence of relationship-specific replay or independent-support handling.

## 5. Responsibility and blocker matrix

| Work item | Owner | Status | Evidence required to close |
|---|---|---|---|
| Meaning of relationship dimensions | World Pack, guided by Personality semantics | Template ready; each world must fill it in | Every supported dimension has meaning, domain, transitions, non-implications, and examples. |
| Stable trait lifecycle | Personality | Semantic contract documented | Author review confirms entries are correctly classified; runtime behavior must later be tested at the real write boundary. |
| Typed relationship write | Core | Semantic direction approved; runtime operation absent; contract incomplete | Specify the first-slice causal representation and trusted write classification; finalize schema-neutral operation contract; prove atomic validation, partial update, direction and canonical identity through real-path tests. |
| Initial/import/correction operations | Core | Generic event/audit exists; trusted boundary not established | Define the authorized command/classification boundary and provenance/audit representation; test unauthorized origin claims, accepted correction, and history preservation. |
| Actor/purpose-authorized read | Core | Blocking | Real internal read/filter contract using actor, purpose, world, snapshot, sensitivity/visibility, and current validity; explicit unknown/withheld/incomplete outcomes. |
| Snapshot consistency primitive | Core | PR #45 open, unmerged | Review/merge decision is outside Personality; even if merged, this alone does not close authorized-read blocker. |
| Deterministic replay and rollback | Core | Generic event rollback exists; relationship guarantee unproven | Decide whether the first slice is limited to replayable transitions; test projection equality against fresh replay and dependent rollback on actual typed relationship events. |
| Independent multi-source support | Core + World Pack domain rule | Deferred / unresolved | Define sufficiency and conflict policy; if needed, approve a narrow typed support/reconciliation contract and production tests. |
| NPC decision-context consumption | NPC subsystem | Depends on authorized read | Consume only bounded authorized data; no parallel canonical relationship or personality store. |
| Character-card projection | Core/card subsystem | Depends on authorized read and typed state | Read-only derived view; no arbitrary attributes or hidden/private fields; no mutation path through the summary. |

## 6. Review sequence

1. Keep the Core-owner response on [PR #38, comment 6377879793](https://github.com/necromorphic/Logic-Engine/pull/38#issuecomment-6377879793) as the current source-backed status; the consolidated Personality-side record is doc 03. Revisit the handoff when Core supplies a new contract or implementation evidence.
2. Have Core close the first-slice causal representation and trusted authoring/correction command contract, then finalize the typed relationship operation against actual effect conventions.
3. Treat snapshot consistency and authorization as separate gates. PR #45 can close only the former.
4. Have core architecture define and test the actor/purpose/snapshot read boundary before any model/player exposure.
5. Verify limited replay on the real core path. Keep independent-support cases blocked until a domain sufficiency rule and core-owned implementation exist.
6. Only then plan runtime integration. Do not add a Personality-owned database, event log, identity registry, authorization layer, or causal graph.

## 7. Non-claims

This handoff does not state that the runtime supports typed relationships, safe reads, author corrections, or relationship rollback. It does not claim the Personality semantic acceptance cases pass integration tests. It does not authorize changes to runtime code, API, schema, storage, prompts, UI, or character-card output. No PR is created or merged by this document.
