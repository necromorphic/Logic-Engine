# Core Stage B — Initial Acquisition Runtime Traceability

Status: implementation candidate on `feat/core-initial-acquisition-stage-b`. This document records what the code implements and what remains deliberately disabled. It is not a claim that Memory → NPC is production-ready.

## Selected Core model

An acquisition is represented as a **typed effect in the existing canonical Core event log** (`knowledge.acquire`). The `knowledge_acquisitions` SQLite table is a rebuildable projection only; it is not an independent source of truth. The projection is rebuilt from valid `world_events`, alongside entity/fact projections.

This preserves the existing world scope, revision/commit sequence, transaction, idempotency, causal rollback, and replay mechanisms. The acquisition is a subject-relative assignment to a canonical fact, not a world-truth write, belief, observation, delivery, or inference.

## Trust boundary

- Existing identity seam: `src/application/actor-bindings.js`, `ActorBindingService.resolve`; test coverage: `tests/actor-binding.test.js`.
- The writer requires an active `(world_id, adapter_id, subject_id)` binding and a non-destroyed subject in that world.
- The writer accepts only `author_initial` and `imported`.
- Authorization/provenance comes from a deployment-owned `initialAcquisitionPolicy` passed when constructing `LogicEngine`; it is not accepted in the operation payload. The policy must return an explicit allow decision, stable source reference, SHA-256 source digest, and authorization-rule reference.
- The policy is unset by default. With no configured trusted policy, acquisition creation fails closed.
- Generic event validation rejects `knowledge.acquire` unless the internal Core option is explicitly enabled. No HTTP write route or acquisition read route is added.
- The current public API does not expose the acquisition projection. Stage C must define a separate safe actor/purpose/snapshot-bound reader before any consumer can use it.

## Traceability

| Requirement | Implementation | Executable evidence |
|---|---|---|
| Bind actor/subject/world | `src/application/engine.js::recordInitialAcquisition` checks active Core actor binding and current same-world entity | `tests/initial-acquisition.test.js`: unknown/unbound subject, revoked binding |
| Permit only initial/imported kinds | `src/core/rules.js` and `recordInitialAcquisition` | `tests/initial-acquisition.test.js`: both supported kinds; unsupported kind denied |
| Prevent caller-supplied provenance | policy is constructor configuration; input rejects extra fields | `tests/initial-acquisition.test.js`: denied/malformed policy output; generic HTTP event spoof denied |
| Bind to canonical source | writer requires an active, supported same-world fact; event declares `READS_CLAIM` and `READS_ENTITY` | `tests/initial-acquisition.test.js`: unknown source denied |
| Persist with Core lifecycle and reject stale cursors | `knowledge.acquire` is stored in `world_events.effects_json`; migration 13 adds derived projection; commit checks both expected world revision and commit sequence | rollback, restart/rebuild, and stale revision/commit-sequence tests in `tests/initial-acquisition.test.js` |
| Source invalidation removes unsupported acquisition | causal `READS_CLAIM` plus rebuild omits records whose fact is no longer active | source rollback/rebuild test in `tests/initial-acquisition.test.js` |
| Reject unauthorized read | no acquisition HTTP reader; public API cannot return projection rows | `tests/initial-acquisition.test.js`: route is non-200 |
| Keep Memory → NPC disabled | no consumer wiring, no prompt serialization, no Gateway changes | scope review; existing integration remains fail-closed |

## Limits that remain

1. `initialAcquisitionPolicy` is intentionally deployment-owned and defaults to unset. This PR does not invent a public authoring/import endpoint or a new author credential.
2. The current source proposition type is a canonical active fact. Other source types are unsupported in this slice.
3. This is not the Stage C authorized knowledge reader. The projection must not be queried by NPC, Memory Provider, or Host as a substitute for that reader.
4. The projection suppresses acquisitions when their subject is destroyed or their source fact becomes inactive/conflicted. Rolling back the acquisition event itself revokes the assignment through the canonical event lifecycle.
5. Full suite results must be taken from CI on the exact PR head; local tests against the uploaded archive are not evidence for the current-main PR head.
