# Spatial/Temporal Runtime Implementation Roadmap — 2026-10-28

**Status:** Research proposal for owner review only — NOT approved for implementation  
**Scope:** Dependency order and decision gates for a future World Pack typed-spatial implementation. Documentation only.  
**Safety:** Production remains **NO-GO**. Memory → NPC remains **DISABLED / FAIL-CLOSED**. No runtime, schema, API, event, storage, adapter, Host, Memory, or NPC behavior is changed by this document.

## Executive decision

Do not start by adding a spatial query or a position field. First make the *meaning and provenance of a position durable and verifiable*. A query layer built before that would turn generic attributes into apparently authoritative facts.

The current direction is World Pack-owned typed spatial attributes, validated at the canonical Core commit boundary. Existing source evidence does not demonstrate that this validation, immutable schema pinning, or historical schema resolution is implemented.

## Dependency order

`World Pack identity and loader`
→ `canonical schema identity`
→ `canonical commit validation`
→ `lifecycle and historical replay`
→ `temporal evidence and snapshot freshness`
→ `read-only spatial query contract`
→ `Host exposure review`
→ `Memory/NPC review (separate approval)`

A later stage must not be treated as ready while an earlier stage is unresolved.

## Stage 0 — Freeze the acceptance contract

**Deliverable:** Owner-reviewed normative contract, not code.

Keep the selected position semantics from the typed-spatial contract revision 2:
- X = logical east, Y = logical north, Z = up; right-handed frame.
- Abstract logical units; entity-origin anchor.
- Frame instance scoped to one world; no implicit transforms, interpolation, extrapolation, or narrative inference.
- Unsupported or unproven spatial evidence returns a non-confirmed status.

**Open decision:** Which JSON Schema validator/version and vocabulary are supported by the repository? Custom `spatial_semantics` metadata is not enforcement unless the selected validator and loader explicitly consume it.

**Exit condition:** Core/World Pack owners accept the schema vocabulary, canonicalization rules, and fail-closed error behavior. No implementation before this decision.

## Stage 1 — Establish a trusted World Pack loading boundary

**Known source boundary:** `schemas/world-pack-manifest.schema.json` requires `entity_types[].type_id` and `attributes_schema`, but constrains `attributes_schema` only to an object. The reviewed repository paths have not demonstrated a loader that validates and registers spatial semantics.

**Required design:**
1. Identify the single authoritative manifest ingestion/registration path and every alternate import, migration, repair, and reload path.
2. Validate the complete manifest with one explicitly pinned validator and supported schema dialect.
3. Reject duplicate `type_id` values and malformed or unsupported schema features.
4. Produce a canonical manifest representation and stable digest; define canonicalization precisely (UTF-8, deterministic object-key ordering, number representation, and treatment of arrays).
5. Bind the loaded immutable pack version to the exact canonical content. Same pack ID/version with different content is a version-immutability violation, not an in-place update.
6. Make loader failure visible as non-ready; never fall back to an unvalidated or latest schema silently.

**Exit condition:** Every path that makes a pack available produces the same verified identity, or refuses to make it available.

## Stage 2 — Pin schema identity to canonical world state

The proposed spatial schema identity is:
`(world_pack_id, world_pack_version, canonical_manifest_digest, canonical_entity_type_schema_digest, spatial_contract_id)`.

The current world row stores pack ID/version; those fields alone do not prove which schema bytes were used. Before choosing storage changes, owners must decide:
- Where immutable pack manifests and digests live, and their retention/deletion rules.
- Whether the world row pins the manifest digest directly or references an immutable registry record.
- How existing worlds with no verified digest are handled (recommended: spatial status remains UNKNOWN until explicitly migrated/re-pinned).
- How restore from an older database backup is detected. A digest stored only inside the same restorable database does not independently prove that the database is the newest accepted state.

**Exit condition:** A world can resolve its exact historical schema identity after restart and replay; missing or mismatched identity fails closed.

## Stage 3 — Put validation at the canonical commit boundary

The source audit identifies `SQLiteStore.commit()` and `commitSegment()` as central write paths. The typed-spatial contract chooses the storage-backed canonical transaction as the authoritative gate; this is a target design, not existing behavior.

The gate must:
- Resolve the entity type against the world's pinned pack version exactly (byte-for-byte type ID; no aliases or fallback).
- Validate the *full resulting attribute state*, not just an incoming patch.
- Validate create, update, upsert, delete, and any operation that can alter spatial interpretation.
- Reject unsupported schema features rather than partially validating.
- Ensure segment writes cannot partially commit if any spatially relevant event fails.
- Ensure idempotent replay returns only the original result for the same request identity/hash; a retry must not be reinterpreted under a different schema.

**Exit condition:** No canonical writer can accept a spatial claim outside the same gate. Alternate writers that cannot prove this leave spatial state unsupported.

## Stage 4 — Make entity continuity and replay schema-aware

The current entity projection is keyed by `(world_id, entity_id)`; existing create/tombstone guards narrow ordinary ID reuse, but they do not by themselves prove spatial continuity across all import, rebuild, restore, or migration paths.

Required design:
- Preserve lifecycle identity across create/update/delete and replay; decide whether a durable incarnation ID is required before implementation.
- Bind each accepted spatial state to the schema identity under which it was accepted.
- Rebuild from canonical valid events in commit-sequence order using the schema identity historically associated with each event, never silently the newest pack schema.
- Rollback/retraction must invalidate dependent spatial results and recompute only from still-valid evidence.
- If historical schema or lifecycle evidence is missing, the affected spatial state is UNKNOWN, not reconstructed by guesswork.

**Exit condition:** Rebuild, rollback, and restore cannot silently change the meaning of an old position.

## Stage 5 — Define the temporal evidence envelope

A position is not a complete spatial fact without a trustworthy state/time boundary.

Required envelope for any future spatial read:
- `world_id` and entity identity/lifecycle;
- typed position value and schema identity/digest;
- canonical Core snapshot marker (revision and commit sequence remain distinct);
- explicit TimeEngine/game-time coordinate and its authority/version;
- validity/freshness status and relevant source-event provenance.

Do not substitute wall-clock timestamps for game time. Do not assume that Core's revision/sequence pair alone proves that every external source or schema registry is current. If temporal mapping, schema provenance, or snapshot consistency is missing, return UNKNOWN/STALE as applicable.

**Exit condition:** A read can explain exactly which accepted state and time boundary it represents and why it is still current.

## Stage 6 — Specify read-only spatial queries

Only after Stages 0–5 are accepted should the query surface be specified. Initial scope should be deliberately small:
- exact position lookup for one entity;
- same-world coordinate comparison only;
- no pathfinding, collision, visibility, reachability, inferred movement, or cross-frame transforms in v1;
- no NPC-facing prose in the Core result.

Every result must include evidence/status. Suggested non-confirming states are `UNKNOWN`, `STALE`, `CONFLICT`, `ABSENT`, and `UNSUPPORTED`; final names and transitions require owner review. A query must never promote a generic `attributes.position` object into a confirmed position.

**Exit condition:** Query semantics, failure states, and provenance fields are reviewed independently from any Host or NPC integration.

## Stage 7 — Keep Host, Memory, and NPC as separate gates

A correct world position does not prove an NPC perceived it, was told it, remembers it, or is allowed to use it. The world-state result must not be injected into NPC context as a shortcut.

Required future reviews:
1. Host/Adapter read-only exposure and authorization.
2. Separate Memory policy review for whether and how spatial evidence may be stored.
3. Separate NPC-boundary review for perception/knowledge and permitted use.
4. Explicit owner approval before any Memory → NPC path is enabled.

Until all separate gates are approved, Memory → NPC stays disabled and fail-closed.

## Current blockers and next concrete decisions

| Priority | Decision / evidence needed | Why it blocks progress |
|---|---|---|
| P0 | Identify and pin the supported schema validator/dialect and custom spatial metadata vocabulary | Without it, typed semantics are descriptive only |
| P0 | Identify the authoritative World Pack loader/registration path and alternate writers | Cannot guarantee one immutable pack identity |
| P0 | Choose digest canonicalization and immutable registry/storage authority | Cannot prove which schema defined an accepted position |
| P1 | Decide handling of legacy worlds without schema digests | Prevents silently treating old generic attributes as typed facts |
| P1 | Decide durable entity-incarnation semantics across replay/restore | Prevents ID continuity assumptions from overstating evidence |
| P1 | Specify event-to-schema provenance and rollback/rebuild behavior | Prevents historical reinterpretation |
| P2 | Define temporal envelope and read-only query response | Depends on trusted schema and commit evidence |
| P3 | Review Host, Memory, and NPC separately | Not part of Core spatial correctness |

## What this roadmap does not claim

- It does not claim that the loader, digest registry, spatial validation gate, or spatial query API exists.
- It does not authorize production changes or migration.
- It does not mark the spatial contract approved.
- It does not authorize Host, Memory, or NPC integration.
- It does not change the current production NO-GO or Memory → NPC DISABLED / FAIL-CLOSED decisions.
