# Core-Owned NPC Knowledge Reader

**Status:** implementation candidate; draft PR only.  
**Scope:** internal Core read boundary for previously acquired knowledge.  
**Not enabled:** HTTP/API exposure, prompt injection, automatic dispatch, or Memory → NPC production integration.

## Contract

The reader returns canonical fact values only when the target NPC has a current, active knowledge-acquisitions projection row for that fact. It does not infer knowledge from mere fact existence, vector matches, prompts, display names, or chat metadata.

Each read requires:

- an existing non-destroyed NPC entity in the requested world;
- one supported purpose (npc_turn_context or npc_action_evaluation);
- the exact current world_revision and commit_sequence;
- a deployment-injected synchronous authorizer whose decision binds world, actor, purpose, revision, and commit sequence;
- a stable authorization-rule reference.

The read result includes the snapshot cursor and source/acquisition provenance. It is immutable at the returned object/array boundaries and nested JSON value level. Stale snapshots, missing authorizer, mismatched authorization scope, unsupported purposes, and invalid provenance fail closed.

## Trust boundary and limitations

- readNpcKnowledge is an internal LogicEngine method and is not registered as an HTTP route.
- The deployment must provide a real trusted authorizer. No default allow policy exists.
- A successful read means only “the Core has an active acquisition for this NPC,” not “the NPC believes the fact” or “the NPC should disclose it in every context.” The separate belief/context contract is documented in `docs/93-core-npc-belief-transition-runtime.md` and remains subject to its own visibility and lifecycle gates.
- There is no prompt injection or automatic Memory dispatch.
- imported source ingestion remains disabled until a trusted importer exists.
- Memory → NPC remains **DISABLED / FAIL-CLOSED** pending full lifecycle, visibility, disclosure, rollback, and integration review.

## Acceptance checks

- Only the actor's acquired facts are returned.
- Current snapshot identity is bound into authorization and result.
- Authorization from another actor, purpose, world, or snapshot is rejected.
- Unsupported purpose, stale cursor, missing authorizer, destroyed/missing actor, malformed request, and missing source provenance fail closed.
- Read path is covered by the NPC boundary workflow and the full Runtime suite.
