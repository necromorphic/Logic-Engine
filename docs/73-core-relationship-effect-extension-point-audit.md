# Core Relationship write path: extension-point audit

Status: implementation gate / interface proposal. This document is not a runtime implementation and does not authorize a new storage schema or write API.

## Scope

Issue #77 requires a real typed Relationship transition through Core's canonical event lifecycle. The Relationship evaluator in PR #62 is pure and remains a candidate producer. It must not become a storage writer or authority source.

## Findings against current `main`

1. **Effect validation is a closed inline map, not a plugin hook.** `src/core/rules.js` exports `validateEffects(effects)`. Its `allowedFields` map explicitly lists `entity.create`, `entity.update`, `entity.upsert`, `entity.delete`, `fact.set`, and `mechanic.instance.create/enable/disable`. There is no typed Relationship effect and no registered projector/effect-handler extension point.
2. **The canonical commit entry point is real but not domain-extensible today.** `src/application/engine.js` exposes `commitEvent(id, x)`, implemented as `this.store.commit(id, this.prepareEvent(x))`. `SQLiteStore.commit` owns the transaction, event insert, revision and commit-sequence allocation, projection rebuild, audit and idempotency result. A Relationship-specific direct write around this method would bypass those guarantees.
3. **Projection rebuild is a hard-coded effect switch.** `SQLiteStore.rebuild(id, revision)` rebuilds mechanic instances, entities, fact claims and facts by inspecting event effects. It has no Relationship projection or Relationship transition replay.
4. **Rollback causality has no Relationship reference type.** The rollback implementation propagates dependencies through the current entity/fact projection references and known causal links. It cannot safely infer that a Relationship transition changed a projection or which later events depend on that directed state.
5. **Trusted authoring provenance is not supplied by the Relationship evaluator.** The evaluator's candidate is not evidence of authority. The accepted design requires Core to derive and validate the executor/provenance from a trusted server-side boundary; caller-provided origin/actor labels must not grant write authority. This audit does not identify an already-approved generic import/correction endpoint and does not create one.

## Conclusion

There is **no existing suitable typed-effect/projector hook** to plug the Relationship evaluator into without fabricating an extension mechanism. The existing canonical transaction lifecycle is reusable, but adding a new effect kind requires coordinated Core changes in validation, preflight/participant checks, event representation, projection rebuild, dependency/rollback replay, authorization/provenance, and tests.

Per Issue #77, stop before production mutation. Do not:
- encode Relationship state inside `entity.attributes` or `fact.set`;
- write a projection table directly from the evaluator;
- treat `caused_by`, evidence references, an adapter ID, or a caller-supplied origin as authority;
- add a generic projector registry or correction endpoint without an approved contract;
- claim that pure evaluator tests prove the canonical write path.

## Narrow interface proposal for Core-owner decision

Before implementation, Core should explicitly choose and document:

1. **Typed event representation:** the exact Relationship transition effect/event schema, including directed participant IDs, explicit patch/status values, evidence/source references, domain/rule version, and expected `(world_revision, commit_sequence)` freshness basis.
2. **Validation placement:** a Core-owned validation/preflight path that resolves both participants in the same world, validates patch completeness and rule version, and rejects unsupported/ambiguous operations before any mutation.
3. **Projection/replay contract:** the canonical Relationship projection representation and deterministic rebuild from surviving valid typed transitions; no alternative-support semantics in this slice.
4. **Trusted execution provenance:** the server-derived principal/capability and audit fields, including the separate approved path (if any) for initial import/author correction. No endpoint is presumed to exist.
5. **Rollback dependency references:** how a Relationship transition is represented in causal/read/dependency references so rollback can invalidate dependent events correctly while respecting composite freshness and revision advancement.
6. **Atomic failure behavior:** event, projection, audit, idempotency result and revision must commit or roll back together through the existing `SQLiteStore.tx()` boundary.

Until those choices are approved, the safe deliverable is this verified blocker/interface proposal, not a pretend runtime hook. The authorized-read work in PR #65 is a narrow self-identity read slice and does not authorize Relationship disclosure to NPC/model consumers.
