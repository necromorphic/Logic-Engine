# Spatial canonical writer inventory — research note

**Date:** 2026-10-28  
**Audited source revision:** `main` at `8d48021399824e96907541832cde4ce2a5012224`  
**Relevant source blob identities:** `src/storage/sqlite-store.js` = `e92f5b23cda9c0777af9624748c0549434300f3e`; `src/application/engine.js` = `dcb8b84e54b29e8697f14eb7e709cc6e0cd65a13`; `src/core/rules.js` = `ce874841e90cad18db020f038388c35008708349`; `schemas/world-pack-manifest.schema.json` = `73b59694280ebf4e6c5affd98a41c09e4da6031c`.  
**Status:** bounded source inventory; research only, not an implementation contract or authorization.

## 1. Finding

The canonical entity projection is rebuilt from valid committed events. The inspected storage paths that can accept canonical events are `SQLiteStore.commit()` and `SQLiteStore.commitSegment()`; the segment path delegates each event to `commit()` with deferred projection rebuild, then calls `rebuild()`. Rollback changes event validity and rebuilds the projections. Therefore, any future typed spatial invariant must cover the storage commit path and its segment/deferred-rebuild behavior, plus rollback/rebuild consistency. A check only in the application caller or only in the derived read model would not establish complete canonical enforcement.

The current World Pack manifest schema still constrains `entity_types[].attributes_schema` only as an object. The audited source does not establish a runtime resolver that binds committed entity attributes to an immutable, historically resolvable World Pack schema. Generic JSON attributes remain insufficient spatial evidence.

## 2. Writer and state-transition inventory

| Path | Current source behavior observed | Spatial-contract implication |
|---|---|---|
| `LogicEngine.commitEvent()` → `SQLiteStore.commit()` | Application prepares an event; store transaction checks replay/idempotency, world existence, expected revision/cursor, causal metadata, and effect-specific invariants before event persistence and optional rebuild. | Application preparation is not a sufficient sole gate; direct store use and segment commits must be considered. No typed spatial schema validation was found in the audited store path. |
| `LogicEngine.commitSegment()` → `SQLiteStore.commitSegment()` → repeated `commit()` | Segment transaction checks start revision and commit sequence, event IDs/keys, then calls `commit(..., { deferRebuild: true })` for each event and performs one rebuild at the end. | Any spatial validation must cover every event in the segment before acceptance and preserve all-or-nothing behavior if validation or rebuild fails. |
| `SQLiteStore.rollback()` → `rebuild()` | Rollback invalidates affected events, then rebuilds derived projections from remaining valid events ordered by `commit_sequence`. | Derived spatial state must be invalidated/reconstructed from the same valid event history; stale readers cannot keep a previously confirmed position after rollback. |
| `SQLiteStore.rebuild()` | Reconstructs entity/fact/relationship/mechanic projections from valid event effects. It checks entity identity history, including tombstone reuse, before clearing/rebuilding projections. | A spatial interpretation must be deterministic under replay and must not survive a removed/invalidated source event. Existing identity guards narrow one lifecycle risk but do not establish schema history or a separate incarnation token. |
| `SQLiteStore.readSnapshot()` / `state()` | Provides coherent state/snapshot reads with world markers; `getEvents()` reads event history separately. | The read experiment must continue checking marker consistency around state/event reads. Snapshot coherence does not prove typed position semantics. |
| `SQLiteStore.createWorld()` | Stores `world_pack_id` and `world_pack_version` on the world row. | These identifiers alone do not prove the pack content is loaded, immutable, digest-pinned, or historically resolvable. |
| Migration / direct database restore | Migration code exists; no supported spatial schema restore/verification contract was identified in this bounded inspection. | Restore/backup import must not be described as covered. This remains an explicit unverified path until the repository has a documented, tested restore boundary. |

## 3. Typed schema consumption check

At the audited source revision:

- `schemas/world-pack-manifest.schema.json` defines `entity_types[]`; each type requires `type_id` and `attributes_schema`, but the latter is constrained only to `{ "type": "object" }`.
- `src/core/rules.js` exports `validateEffects()` for effect shape. The reviewed entity attributes checks do not resolve a World Pack schema or prove validation against its entity-type `attributes_schema`.
- `SQLiteStore.commit()` reads the world row and enforces other commit invariants, but the inspected path does not resolve a pinned manifest digest or validate the full post-state against typed spatial metadata.
- No current runtime field or result from `getState()` was found that certifies a position's schema identity, frame, semantic contract, or validation provenance.

These are bounded source findings, not a claim that every repository file or every external restore workflow was exhaustively audited.

## 4. Transaction-seam conclusion

The narrowest future enforcement seam, if separately approved, is inside the canonical `SQLiteStore.commit()` transaction, before an event is accepted as valid. `commitSegment()` already funnels its member events through that method, so a shared gate there would cover ordinary and segment commits only if all other canonical writer/restore paths are also shown not to bypass it. Validation must inspect the effective full entity state, not just a partial incoming patch, and must bind it to the exact immutable World Pack/entity-type schema identity.

This is a seam recommendation for further review, **not authorization to implement it**. No runtime code, schema, API, event, adapter, persistence, projection, Host, Memory, or NPC code was changed by this research note.

## 5. Still unproven

1. Complete inventory of every canonical writer and any backup/restore/import path, including whether any path can insert or revalidate valid events without passing through `commit()`.
2. Immutable manifest/schema digest calculation, storage, and historical resolution.
3. Exact validator capability and enforcement against full post-state at every accepted write.
4. Typed spatial provenance surviving replay/rebuild and being invalidated correctly by rollback.
5. A durable confirmed TimeEngine boundary associated with the Core composite cursor `(world_revision, commit_sequence)`.
6. Exact-head test evidence for the proposed end-to-end contract. This source inspection did not run tests on `8d48021399824e96907541832cde4ce2a5012224`.

Until those are closed, generic `position: {x,y,z}` remains unconfirmed, production spatial integration remains NO-GO, and Memory → NPC remains DISABLED / FAIL-CLOSED.


## 6. TimeEngine boundary-to-Core cursor mapping

The same audited source revision has a durable time-advance operation record, but the persisted fields and public operation projection do not establish the full required mapping:

- The `time_advance_operations` table stores `confirmed_coordinate`, `starting_world_revision`, and `current_world_revision`; it has no `commit_sequence` field.
- The `timeAdvanceOperation(row)` projection returns those same fields and does not return a confirmed-boundary composite cursor.
- During resume, each planned segment is committed through `commitSegment()`. The segment result contains start/end game-time coordinates, start/final world revision, and start/final commit sequence. The operation checkpoint update persists `segment.coordinate` and `worldAfter.world_revision`, but does not persist `worldAfter`'s commit sequence alongside that confirmed coordinate.
- Therefore, the operation can persist a confirmed time coordinate and a world revision, while the reviewed operation checkpoint does not itself persist a durable `(world_revision, commit_sequence)` pair for that exact boundary. A caller might reconstruct current state by other means, but that is not the same as a durable historical boundary mapping.

Existing durable checkpoint/restart tests and segment commit sequence results are useful primitives, but this source inspection does not establish that an operation's confirmed boundary can be recovered unambiguously to the exact Core composite cursor after later commits, rollback, or older-backup restoration. Equal `game_time` alone is not a sufficient history cursor.

This is a source-level gap, not authorization to add a `commit_sequence` column, API field, cursor, or event. The next temporal step is to identify whether an already approved durable checkpoint or segment record can provide this association without a new contract; otherwise the missing association needs explicit design approval before implementation.
