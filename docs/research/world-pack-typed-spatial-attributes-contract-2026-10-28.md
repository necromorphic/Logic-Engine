# Proposal: World Pack Typed Spatial Attributes at Core Commit Boundary

**Status:** DESIGN PROPOSAL ONLY — NOT AN IMPLEMENTATION AUTHORIZATION  
**Date:** 2026-10-28  
**Decision basis:** Coordinator decision in [Issue #351, comment 6455368293](https://github.com/necromorphic/Logic-Engine/issues/351#issuecomment-6455368293)  
**Related:** [Spatial position semantics proposal / PR #533](https://github.com/necromorphic/Logic-Engine/pull/533); [spatial-temporal evidence report](https://github.com/necromorphic/Logic-Engine/blob/research/spatial-temporal-evidence-2026-10-26/docs/research/spatial-temporal-world-model-evidence-2026-10-26.md)

## 1. Decision and scope

The coordinator selected World Pack-owned typed spatial attributes, validated by Core at the canonical commit boundary, as the preferred design direction.

This document proposes a contract for review. It does **not** authorize production code, schema, API, event, adapter, persistence, projection, runtime, Host, Memory, or NPC changes. No spatial value may be inferred from generic attributes or narrative/model output. **Memory → NPC remains DISABLED / FAIL-CLOSED.**

The approved v1 meaning of position is:
- three coordinates: X, Y, Z;
- one world-relative, right-handed coordinate frame; +Z is up;
- abstract logical units, not metres or another physical unit;
- the position denotes the entity's explicitly defined origin;
- no local frames, transforms, implicit scale, interpolation, or extrapolation.

These semantic decisions do not prove that the current runtime enforces them.

## 2. Source audit: current evidence and gap

The current-main source audit found:
- `schemas/world-pack-manifest.schema.json` declares `entity_types[]` and requires `attributes_schema`, but the field is currently only constrained as a generic object.
- `docs/04-world-pack-format.md` explicitly describes the World Pack format as proposed/partial and says its field list does not prove that every field is accepted or consumed by a runtime loader.
- `src/core/rules.js` exports `validateEffects`; entity effects permit generic `attributes`. That validator checks effect shape and supported fields, not attributes against a pinned World Pack entity-type schema.
- `src/storage/sqlite-store.js` stores entity attributes as `attributes_json`; canonical `commit`, `commitSegment`, `rebuild`, and `readSnapshot` are relevant existing seams, but generic storage and coherent snapshots do not make attributes spatially typed.
- Existing `fact.set` and `located_at` examples are not typed 3D coordinate sources.

**Finding:** no inspected production path currently proves that spatial attributes are schema-validated and committed under the approved position semantics. Do not treat a JSON shape such as `{ "x": 1, "y": 2, "z": 3 }` as position evidence merely because it appears in generic attributes.

This audit is bounded to the paths and evidence listed above; it is not a claim that every file in the repository has been exhaustively reviewed.

## 3. Proposed contract: World Pack declaration

### 3.1 Typed field declaration

A World Pack entity type may declare a spatial position field only through an explicit, versioned schema declaration. The proposal is to represent the field as an object with exactly the three required numeric coordinates `x`, `y`, and `z`; unknown members and non-numeric, non-finite, or partial values must be rejected.

Illustrative shape only — **not an accepted schema or runtime payload**:

```json
{
  "position": {
    "type": "object",
    "required": ["x", "y", "z"],
    "additionalProperties": false,
    "properties": {
      "x": { "type": "number" },
      "y": { "type": "number" },
      "z": { "type": "number" }
    },
    "spatial_semantics": {
      "contract": "position-v1",
      "frame": "world",
      "handedness": "right",
      "up_axis": "+z",
      "units": "logical",
      "anchor": "entity-origin"
    }
  }
}
```

The illustrative `spatial_semantics` location and exact encoding are open design details. The final contract must choose a representation that the actual schema validator can validate and Core can resolve unambiguously; prose or an unconsumed manifest field is insufficient.

### 3.2 Entity-type and pack binding

The final contract must specify:
- how Core resolves the entity's declared `entity_type` to exactly one schema in the World Pack pinned to that world;
- how the pinned pack ID and version (or immutable content identity) are established and checked at commit time;
- what happens when the pack/schema is absent, ambiguous, invalid, unsupported, or changes incompatibly;
- whether existing entity types without spatial declarations remain valid and simply have no supported position.

No global default spatial schema is permitted. A type without an explicit supported declaration has position status `UNKNOWN / UNSUPPORTED`.

## 4. Proposed Core validation and commit boundary

The design must identify the exact production call path and prove validation happens before canonical acceptance. Candidate inspection points—not a pre-approved implementation plan—are:
1. effect-shape validation in `src/core/rules.js:validateEffects`;
2. canonical event acceptance in `src/storage/sqlite-store.js:commit` and bounded segment acceptance in `commitSegment`;
3. projection replay in `rebuild`;
4. coherent state reads in `readSnapshot`.

Core review must determine the authoritative insertion point. It must not be assumed that validating an effect once is sufficient if another canonical commit route can bypass the same invariant. Replay/rebuild must either revalidate against the same pinned schema identity or prove that only previously validated canonical events can enter the valid event stream.

Before a canonical entity effect is accepted, Core must validate:
- the world exists and its pinned World Pack/schema identity is resolvable;
- the entity type exists in that schema;
- every supplied spatial value matches the declared typed field and the approved v1 semantics;
- a create/upsert/update cannot bypass validation or leave a contradictory spatial value through partial updates/removal;
- unsupported or conflicting evidence fails closed rather than being guessed.

Failure must reject the affected canonical effect/commit using the repository's established error/transaction conventions. The contract must not invent an error code before the Core owner reviews the actual error taxonomy.

## 5. Value and unknown-state rules

- Supported position requires a complete, valid X/Y/Z triple and verifiable provenance to a canonical accepted state.
- Missing position, missing schema, unknown entity type, malformed/partial value, unsupported semantics, world mismatch, stale or inconsistent snapshot, or conflicting evidence must not yield a usable coordinate.
- Do not silently coerce strings to numbers, substitute zero, clamp values, infer units, normalize to physical scale, or select one conflicting value by arrival order.
- Unknown and unsupported are not the same as the origin `(0,0,0)`.
- Position is not a claim about visibility, line of sight, observation, NPC knowledge, or belief.

The final contract should define whether the external result uses one status enum or a structured failure reason. That presentation choice must not weaken fail-closed behavior.

## 6. Entity deletion and recreation

The existing entity table is keyed by `(world_id, entity_id)`; the audit has not established a durable entity-incarnation identifier that distinguishes deletion followed by recreation with the same ID.

Therefore:
- a recreated entity ID must not inherit a prior incarnation's position;
- the design must specify how incarnation identity is represented in canonical evidence and replay, or explicitly return unknown whenever identity continuity cannot be proved;
- a consumer must not infer continuity from the reused ID, matching attributes, or narrative text.

This is an implementation blocker until the Core owner identifies a supported mechanism and the contract defines its behavior.

## 7. Temporal binding and coherent reads

Current evidence distinguishes `world_revision`, `commit_sequence`, and `game_time_coordinate`. They are not interchangeable.

The contract must:
- identify a state by the coherent Core snapshot markers required by the existing store contract, including the pair `(world_revision, commit_sequence)` where applicable;
- reject mixed/stale snapshots and rollback-invalidated evidence;
- define exactly how a historical position is bound to a confirmed TimeEngine boundary;
- return unknown if the Core commit/state boundary cannot be mapped to a confirmed TimeEngine boundary for the requested historical answer;
- prohibit interpolation/extrapolation between supported boundaries in v1.

The bounded `getState → getEvents → getState` feasibility seam has prior test evidence, but it does not itself define spatial meaning or prove arbitrary game-time-to-commit mapping. The final proposal must cite the exact evidence and limitations rather than claim this gap is already solved.

## 8. Rollback, rebuild, and deterministic replay

The design must demonstrate:
- rejected/uncommitted effects never become spatial evidence;
- rollback invalidates conclusions dependent on invalidated events;
- rebuild from valid canonical events deterministically reproduces the same position status and value under the same pinned schema/contract version;
- pack/schema identity changes cannot silently reinterpret historical values;
- a stale projection or mismatched source markers cannot be served as current;
- restart/rebuild produces the same result as uninterrupted replay.

No new persistent spatial projection or table is assumed by this proposal. If a projection is proposed, it requires a separate review of storage ownership, lineage, invalidation, and rebuild semantics before implementation.

## 9. Backward compatibility and migration

The contract must preserve existing packs/entities that have no typed spatial declaration. They remain usable under their current behavior, but their positions are `UNKNOWN / UNSUPPORTED`.

The proposal must specify:
- schema/contract versioning and compatibility policy;
- whether existing generic attributes named `position`, `coordinates`, or similar are ignored as spatial evidence until explicitly migrated;
- how invalid existing values are surfaced without retroactively changing canonical history;
- whether migration requires a new World Pack version and how that version is pinned;
- how rollback/rebuild behaves across pack-version boundaries.

No automatic migration or reinterpretation is authorized.

## 10. Proposed acceptance tests

These are required future test cases, not tests claimed to have run. The eventual implementation must provide executable tests at the real validation/commit boundary, not only unit tests of a standalone validator.

| Case | Expected result |
|---|---|
| Valid declared position on a typed entity | Accepted; position supported only at the resulting canonical state boundary |
| Generic `attributes.position` without a typed declaration | Not accepted as spatial evidence |
| Missing/unknown pack schema or entity type | Fail closed; affected commit rejected or position unsupported according to the reviewed transaction contract |
| Partial X/Y/Z, strings, booleans, null, arrays, malformed numbers, unknown keys | Reject; no coercion |
| Unsupported frame/units/anchor declaration | Reject or unsupported; no fallback defaults |
| Update removes or partially overwrites a supported position | Apply only the explicitly reviewed update semantics; never synthesize missing coordinates |
| Cross-world entity or schema reference | Reject |
| Recreated entity reuses the same ID | No inheritance of old position |
| Rejected or uncommitted effect | No spatial evidence |
| Rollback invalidates source event | Dependent result becomes invalid/unknown |
| Rebuild and restart | Deterministic equivalence with valid-event replay |
| Pack schema version changes | No silent reinterpretation of older committed values |
| Inconsistent Core snapshot markers | Reject result |
| No confirmed TimeEngine boundary for historical query | Unknown; no interpolation/extrapolation |
| Conflicting committed evidence | Conflict/unknown unless a separately approved deterministic rule applies |
| Memory/NPC asks for position | No disclosure or integration permission granted |

ST-01–ST-16 remain **NOT TESTED / NOT PASSED** until implemented and actually executed with recorded results.

## 11. Explicit blockers requiring Core review

1. **Canonical validation point:** exact call path and proof no commit route bypasses validation.
2. **World Pack pinning:** source of immutable pack/schema identity available to the commit path.
3. **Entity incarnation:** reliable deletion/recreation distinction or fail-closed behavior.
4. **Core–TimeEngine mapping:** evidence linking a coherent Core state to a confirmed temporal boundary.
5. **Rollback/rebuild:** deterministic handling of invalidated events and schema versions.
6. **Schema representation:** exact JSON Schema form and validator behavior for semantic metadata.
7. **Transaction semantics:** whether invalid spatial data rejects one effect or the whole proposed commit, consistent with existing atomicity rules.
8. **Backward compatibility:** treatment of existing generic attributes and packs.

These are not resolved merely by merging this document.

## 12. Requested review and decision gate

Core reviewer is asked to:
1. confirm or amend the proposed World Pack declaration and semantic metadata;
2. identify exact validation/commit/rebuild symbols and the authoritative enforcement point;
3. resolve or explicitly retain each blocker in §11;
4. review the executable acceptance matrix and required evidence;
5. state whether the contract is approved for a subsequent implementation proposal.

**Gate:** this document may be reviewed and revised as design work. Production implementation remains **NO-GO** until Core explicitly approves a concrete contract and a separate implementation scope. Memory → NPC remains **DISABLED / FAIL-CLOSED**.
