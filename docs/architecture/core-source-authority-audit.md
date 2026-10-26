# Core source-authority and source-version audit

**Status:** source audit recorded; production disclosure remains `DISABLED / FAIL-CLOSED`.
**Owner:** Core. **Scope:** existing repository contracts only. This is not an authorization to add runtime APIs, schemas, stores, or Memory→NPC wiring.

## Verified current-main paths

| Concern | Existing code path | Evidence / behavior | What it does not prove |
|---|---|---|---|
| Core canonical state | `src/application/engine.js` — `getSnapshot(worldId, { entityIds })`, `rollbackEvent` | Snapshot is the authoritative Core projection read. Rollback delegates to the Core store. | It is not a Provider inventory or an egress authorization. |
| Core entity projection and rollback | `src/storage/sqlite-store.js` — canonical projection updates, rollback transaction | Core writes use the Core store's transaction boundary. The R1→R2→rollback regression in PR #355 proves the entity projection restores R1 while `world_revision` advances and `commit_sequence` does not. | This transaction does not include Provider's separate SQLite connection or Host's network call. |
| Field authorization | `src/application/authorized-read-service.js` — `readEntityFields`, `readEntityAttributeForMechanic`, `_assertDisclosureStillCurrent` | Requires explicit trusted field policy, authenticated actor binding, allowed recipient/purpose, expected snapshot cursor; rechecks binding and Core cursor after policy evaluation; returns a generic unavailable response for withheld/missing targets. | Not an HTTP endpoint, not the final model-dispatch boundary, and not a cross-process atomic lease. |
| Runtime composition | `src/index.js` | Wires `SQLiteStore`, `LogicEngine`, and the API server. | Does not wire a production Memory→NPC disclosure/dispatch coordinator or make the read service the sole model transport. |
| Provider source record | `src/application/sqlite-memory-provider.js` | Requires trusted `getSnapshot`, `validateSourceVersion`, and `validateInventory` callbacks. Record writes accept only `canonical_entity` in this first slice and require one matching lineage entry. | The constructor requires callbacks but does not make a fixture callback authoritative. The callback implementation and real deployment wiring remain part of the proof. |
| Provider candidate admission | `src/application/sqlite-memory-provider.js` — `authorizeCandidate` | Checks query grant, record grant, subject/purpose/source identity, invokes the trusted source-version validator, then rechecks Provider-owned grants after the awaited validator. Unknown/unavailable source validation fails closed. | The post-await grant recheck is Provider-local; it does not serialize Provider revocation against Core mutation or an external outbound request. |
| Provider readiness | `src/application/sqlite-memory-provider.js` — `reconcile` | Checks a Core snapshot, indexed records, per-record source validation, inventory callback, and snapshot stability before publishing readiness. | Completeness is only as authoritative as the injected inventory callback. A test callback returning `true` is not production inventory evidence. |
| Provider transaction | `src/application/sqlite-memory-provider.js` — `#withImmediateTransaction` | Uses `BEGIN IMMEDIATE` on the Provider-owned SQLite connection for Provider-local transactions. | Does not lock Core's separate DB connection or the network transport. |

## Approved source-version mapping (narrow)

For `source_kind === 'canonical_entity'` only, Provider `source_version` is a canonical decimal encoding of the exact current Core entity's `updated_revision`. The validator must read the named entity from the named world, require exactly one matching entity and an allowed active status, and fail closed for missing/destroyed/unknown state, malformed/non-canonical version, mismatch, or unavailable/stale snapshot. This was approved in Issue #140 comment https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6413100985.

Do not conflate:
- Provider `record_version`: immutable version of a Provider record;
- Provider `source_version`: source revision claim checked against an approved source rule;
- Core entity `updated_revision`: canonical entity revision;
- Core `(world_revision, commit_sequence)`: composite snapshot freshness cursor.

The cursor is not a source journal. In particular, rollback can restore R1 and advance `world_revision` without increasing `commit_sequence`.

## Relevant existing tests / evidence

- `tests/authorized-read-service.test.js`: explicit field allow-list; denied/missing-target indistinguishability; actor-binding revocation during policy evaluation; canonical mutation during read; R1→R2→rollback; stale R2 cursor rejection after R1 restoration. Core-only PR #355 exact head `db599eeac336e7301f7d891369429e615b3dc584` passed Runtime CI: https://github.com/necromorphic/Logic-Engine/actions/runs/40308944856 (`npm test` 601/601, recalculation harness 8/8).
- `tests/memory-provider-core-integration.test.js`: Provider→Core authorized-read→NPC admission integration uses a fixture source validator and `validateInventory: async () => true`; this proves the exercised integration seam, not production authority/inventory.
- `tests/memory-provider-query-revocation-race.test.js`: deterministic Provider-local query-grant revocation during an awaited source validation is denied.
- Provider PR #344 latest reported evidence (Issue #181 comment https://github.com/necromorphic/Logic-Engine/issues/181#issuecomment-6413928974): exact head `52ffa54a7010aa6cd21720cc99bbec5831bc2734`, Runtime CI 612/612 and harness 8/8; it documents Provider-local grant-generation and reconciliation hardening, but explicitly does not prove Host inventory, production Core authority wiring, or revoke-to-egress atomicity. PR #344 remains draft/unmerged.

## Core disposition

1. Keep the direct `canonical_entity` mapping as the only approved source-version mapping in this slice.
2. Do not infer authorization for other source kinds from a matching cursor, lineage field, Provider grant, or successful unit fixture.
3. Preserve rollback tests that compare the restored entity projection and exact entity `updated_revision`; never use `commit_sequence` alone to decide source currentness.
4. Do not attempt to close revoke-to-dispatch races by wrapping Core `SQLiteStore.tx()` around a read. It cannot serialize Provider writes or an external Host transport.
5. Production stays disabled until the exact pinned Host routes, real Provider writer boundaries, authoritative inventory/reconciliation, and one shared dispatch-start serialization mechanism are proven end-to-end.
