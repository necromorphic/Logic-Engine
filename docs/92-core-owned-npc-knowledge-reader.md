# Core-Owned NPC Knowledge Reader

**Status:** implementation candidate; draft PR only.  
**Scope:** internal Core read boundary for previously acquired knowledge.  
**Not enabled:** HTTP/API exposure, prompt injection, automatic dispatch, or Memory → NPC production integration.

## Contract

The reader returns the value and canonical source-event set pinned by the acquisition event, and only while the active fact projection still matches that acquired version. It fails closed if the same fact ID now resolves to a different value or source-event set; a replacement value requires a new explicit acquisition event. It does not infer knowledge from mere fact existence, vector matches, prompts, display names, or chat metadata. Legacy acquisition events without a pinned version are not exposed.

Each read requires:

- an existing non-destroyed NPC entity in the requested world;
- one supported purpose (`npc_turn_context` or `npc_action_evaluation`);
- an explicit Host `conversation_id`, configured `adapter_id`, `recipient` (`model`), world, and actor;
- the exact current `world_revision` and `commit_sequence`;
- a deployment-owned synchronous authorizer that requires an active Core Host conversation → world binding and an active adapter → actor binding, and binds world, conversation, adapter, actor, recipient, purpose, revision, and commit sequence;
- a stable authorization-rule reference.

The read result includes the Host conversation identity, snapshot cursor, and source/acquisition provenance. It is immutable at the returned object/array boundaries and nested JSON value level. Stale snapshots, missing/revoked Host or actor bindings, mismatched authorization scope, unsupported purposes, and invalid provenance fail closed.

## Trust boundary and limitations

- readNpcKnowledge is an internal LogicEngine method and is not registered as an HTTP route.
- `src/index.js` now wires the production authorizers from the persistent Core store, configured adapter IDs, and deployment-owned trusted source registry. Read authorization requires an active `host_conversation_world_bindings` row and active `actor_bindings` row for the exact conversation, world, adapter, and actor. Missing rows, revoked rows, unknown adapters, or storage errors deny the read. The only supported purposes are `npc_turn_context` and `npc_action_evaluation`; the generic `npc_decision` purpose is deliberately not accepted.
- Per-acquisition visibility is separately checked against the trusted source registry: provenance reference and digest must match a deployment-approved source for the world's exact World Pack ID/version. Anything else is withheld. A read grant does not imply visibility.
- A successful read means only “the Core has an active acquisition for this NPC,” not “the NPC believes the fact” or “the NPC should disclose it in every context.” The separate belief/context contract is documented in `docs/93-core-npc-belief-transition-runtime.md` and remains subject to its own visibility and lifecycle gates.
- There is no prompt injection or automatic Memory dispatch.
- imported source ingestion is restricted to the existing deployment-owned allowlisted local-file importer; arbitrary caller paths and raw Host/SillyTavern text are not accepted.
- Memory → NPC remains **DISABLED / FAIL-CLOSED** pending full lifecycle, visibility, disclosure, rollback, and integration review.

## Explicit integration gaps before production use

- The read request now carries `world_id`, `conversation_id`, `adapter_id`, `actor_id`, `recipient` (`model`), purpose, snapshot and limit. The authorizer binds the exact conversation and actor to Core-owned active rows. The request values themselves are not credentials: any future HTTP caller must derive `adapter_id` from the authenticated adapter token and `conversation_id` from the authenticated SillyTavern session; neither may be trusted from model text or an untrusted request body.
- The authorizers are wired into the runtime composition, but the reader remains an internal method and is not exposed as an HTTP route. No production NPC runtime caller or model-context serializer is included. The binding checks therefore establish the Core-side policy boundary, not end-to-end Host caller authentication or final-send authorization.
- Host conversation bindings and actor bindings must be provisioned through the existing Core administrative binding operations. A read is denied until both are active. Revocation of either blocks subsequent reads and visibility checks.

## Acceptance checks

- Only the actor's acquired facts are returned.
- Acquisition-time value and source-event identities are persisted in the canonical acquisition effect and derived projection.
- A changed current fact value/source-event set cannot silently replace the acquired version; version mismatch fails closed.
- Current snapshot identity is bound into authorization and result.
- Authorization from another world, conversation, adapter, actor, recipient, purpose, or snapshot is rejected.
- Unsupported purpose, stale cursor, missing/revoked Host or actor binding, destroyed/missing actor, malformed request, and missing source provenance fail closed.
- Read path is covered by the NPC boundary workflow and the full Runtime suite.
