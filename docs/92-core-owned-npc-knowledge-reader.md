# Core-Owned NPC Knowledge Reader

**Status:** implementation candidate; draft PR only.  
**Scope:** internal Core read boundary for previously acquired knowledge.  
**Not enabled:** HTTP/API exposure, prompt injection, automatic dispatch, or Memory → NPC production integration.

## Contract

The reader returns the value and canonical source-event set pinned by the acquisition event, and only while the active fact projection still matches that acquired version. It fails closed if the same fact ID now resolves to a different value or source-event set; a replacement value requires a new explicit acquisition event. It does not infer knowledge from mere fact existence, vector matches, prompts, display names, or chat metadata. Legacy acquisition events without a pinned version are not exposed.

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
- This is not yet an NPC belief/evidence reducer adapter. A successful read means “the Core has an active acquisition for this NPC,” not “the NPC believes the fact” or “the NPC should disclose it in every context.”
- There is no prompt injection or automatic Memory dispatch.
- imported source ingestion remains disabled until a trusted importer exists.
- Memory → NPC remains **DISABLED / FAIL-CLOSED** pending full lifecycle, visibility, disclosure, rollback, and integration review.

## Acceptance checks

- Only the actor's acquired facts are returned.
- Acquisition-time value and source-event identities are persisted in the canonical acquisition effect and derived projection.
- A changed current fact value/source-event set cannot silently replace the acquired version; version mismatch fails closed.
- Current snapshot identity is bound into authorization and result.
- Authorization from another actor, purpose, world, or snapshot is rejected.
- Unsupported purpose, stale cursor, missing authorizer, destroyed/missing actor, malformed request, and missing source provenance fail closed.
- Read path is covered by the NPC boundary workflow and the full Runtime suite.
