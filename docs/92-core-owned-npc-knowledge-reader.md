# Core-Owned NPC Knowledge Reader

**Status:** implementation candidate; draft PR only.  
**Scope:** internal Core read boundary for previously acquired knowledge.  
**Not enabled:** HTTP/API exposure, prompt injection, automatic dispatch, or Memory → NPC production integration.

## Contract

The reader returns the value and canonical source-event set pinned by the acquisition event, and only while the active fact projection still matches that acquired version. It fails closed if the same fact ID now resolves to a different value or source-event set; a replacement value requires a new explicit acquisition event. It does not infer knowledge from mere fact existence, vector matches, prompts, display names, or chat metadata. Legacy acquisition events without a pinned version are not exposed.

Each read requires:

- an existing non-destroyed NPC entity in the requested world;
- one supported purpose (`npc_turn_context` or `npc_action_evaluation`);
- an explicit `adapter_id` and `recipient` (`model`), in addition to world and actor;
- the exact current `world_revision` and `commit_sequence`;
- a deployment-injected synchronous authorizer whose decision binds world, adapter, actor, recipient, purpose, revision, and commit sequence;
- a stable authorization-rule reference.

The read result includes the snapshot cursor and source/acquisition provenance. It is immutable at the returned object/array boundaries and nested JSON value level. Stale snapshots, missing authorizer, mismatched authorization scope, unsupported purposes, and invalid provenance fail closed.

## Trust boundary and limitations

- readNpcKnowledge is an internal LogicEngine method and is not registered as an HTTP route.
- The deployment must provide a real trusted authorizer. No default allow policy exists. The only supported purposes are `npc_turn_context` and `npc_action_evaluation`; the generic `npc_decision` purpose is deliberately not accepted.
- A successful read means only “the Core has an active acquisition for this NPC,” not “the NPC believes the fact” or “the NPC should disclose it in every context.” The separate belief/context contract is documented in `docs/93-core-npc-belief-transition-runtime.md` and remains subject to its own visibility and lifecycle gates.
- There is no prompt injection or automatic Memory dispatch.
- imported source ingestion is restricted to the existing deployment-owned allowlisted local-file importer; arbitrary caller paths and raw Host/SillyTavern text are not accepted.
- Memory → NPC remains **DISABLED / FAIL-CLOSED** pending full lifecycle, visibility, disclosure, rollback, and integration review.

## Explicit integration gaps before production use

- The read request now carries `world_id`, `adapter_id`, `actor_id`, `recipient` (`model`), purpose, snapshot and limit. The read authorizer receives and must bind all of these fields. The adapter and recipient values are still request data, not authentication: the deployment-owned authorizer must verify them against an authenticated Host/session and intended recipient using trusted state outside the request. There is no explicit Host-session identifier in the Core request, and no such trusted binding is implemented or demonstrated by this candidate.
- The current application bootstrap in `src/index.js` does not configure either NPC authorizer. Their constructor defaults are `null`; therefore the application-level read path fails closed with `NPC_KNOWLEDGE_READ_NOT_CONFIGURED` until an owner-approved trusted binding is supplied.
- The Core reader checks that the actor exists and is not destroyed, but does not itself authenticate the Host adapter/session. A future caller must derive actor identity from the approved Host binding, not from model text or an arbitrary request.
- No production NPC runtime caller, model-context serializer, or Host final-egress integration is included. This candidate is not an enablement switch.

## Acceptance checks

- Only the actor's acquired facts are returned.
- Acquisition-time value and source-event identities are persisted in the canonical acquisition effect and derived projection.
- A changed current fact value/source-event set cannot silently replace the acquired version; version mismatch fails closed.
- Current snapshot identity is bound into authorization and result.
- Authorization from another world, adapter, actor, recipient, purpose, or snapshot is rejected.
- Unsupported purpose, stale cursor, missing authorizer, destroyed/missing actor, malformed request, and missing source provenance fail closed.
- Read path is covered by the NPC boundary workflow and the full Runtime suite.
