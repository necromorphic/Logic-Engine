# Memory Provider contract status: existing, proposed, blocked

**Status:** Provider-local audit note. This document does not approve a new API, schema, source type, storage model, production caller, or cross-store guarantee.

**Audit target**
- Repository baseline: current `main` at `bf35fb8dd13628718dacc11c27654c0929fba0e2` for the Provider-local PR branch.
- Provider source: `src/application/sqlite-memory-provider.js`, blob `15ddf2326aea93d5997c102d61488e63095d439f`.
- Host source evidence: `docs/27-host-adapter-lifecycle-evidence.md`, pinned SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Consumer tests: `tests/memory-npc-consumer.test.js`; real SQLite/Core integration fixture: `tests/memory-provider-core-integration.test.js`.

## 1. Contract inventory

| Concern | Existing executable behavior | Proposed / not approved | Blocked decision or owner |
|---|---|---|---|
| Provider persistence | SQLite provider persists canonical Memory records and a separate raw Host-message archive; raw archive capture is immutable by tuple and detects duplicate vs conflicting payload. | Any new cross-process Provider HTTP/API or new store. | None for current local behavior; production Host caller remains absent. |
| Canonical record identity | `putRecord` accepts `source_kind === canonical_entity`, `source_entity_id`, `source_version`, and one matching canonical lineage item. | Mapping raw Host chat text into `canonical_entity`. | Core (#140) must approve a distinct Host-message source class and contract before implementation. |
| Raw Host identity | Existing raw archive methods accept `world_id`, `conversation_id`, `message_id`, `version_id`; tuple and payload replay/conflict checks are Provider-local. | Treating caller-supplied IDs as proof of trusted origin, or deriving identity from mutable ST array indexes/timestamps/content hashes. | Host (#258) must prove durable IDs and lineage at pinned implementation; Core must approve trusted world/session binding. |
| Active version | `selectActiveRawVersion` changes the active pointer and refuses deleted/missing versions. | Automatically restoring a tombstoned version or inferring swipe ancestry. | Restore semantics require explicit owner decision; no undelete API exists. |
| Deletion and purge | `markRawSourceDeleted` tombstones a known exact tuple and invalidates registered Provider-local derived copies; `purgeRawSource` deletes the source and registered copies. | Claiming external/unregistered stores are discoverable, globally purged, or atomically revoked. | External-store ownership/revocation mechanism is absent; do not claim global purge. |
| Derived copies and lineage | Registered raw derived copies have identity/digest and are invalidated with known source deletion. | Admitting summaries unless every lineage source can be checked for current authorization. | Provider must fail closed for unproven lineage-wide authorization; Core/Provider need approved contract before candidate admission. |
| Search candidates | `retrieveCandidates` reads `memory_records`, `memory_index_entries`, and `memory_record_grants`; raw archive rows are not candidates. | Implicit promotion from raw capture to searchable record. | Core/Provider must agree source type, lineage, authorization and indexing semantics. |
| Reconciliation | `reconcile(worldId)` checks Provider `memory_records` and `memory_index_entries`, validates source versions, and passes that Provider-record projection to `validateInventory`. | Treating `world_revision`/`commit_sequence` as a Host source-change journal. | Host (#258) must provide/prove complete active + historical + deleted inventory, tombstones and pre-enrollment boundary; current input cannot establish it. |
| Query/read authorization | Provider query and raw-read paths use injected authorization/validation callbacks and fail closed when required checks are unavailable; raw reads check before and after the DB read. | Claiming those callbacks are production Core authority merely because tests inject them. | Trusted callback wiring and source/scope binding require owner-approved production composition. |
| Core/NPC consumer | Tests exercise the existing consumer with real SQLite Provider and Core components; candidate authorization is rechecked in the in-process seam. | Calling the seam a deployed Host→Provider→Core→NPC vertical slice or claiming cross-store atomicity. | No production Host caller or final serializer-to-transport revocation barrier is proven. |
| Delivery/acquisition/belief | Retrieval and context inclusion do not themselves persist these side effects. | Inferring receipt, acquisition, belief, or rendered delivery from retrieval. | These semantics belong outside Provider scope. |

## 2. Existing test evidence versus missing evidence

### Existing repository tests / local guarantees
- `tests/memory-provider-raw-archive.test.js`: raw capture replay/conflict, active version selection, deletion/tombstone, registered-copy behavior and restart scenarios.
- `tests/sqlite-memory-provider.test.js`: durable record identity/version, index rebuild/restart, grants/revocation, stale source versions, incomplete inventory, duplicate identity, derived summary refusal, fail-closed retrieval.
- `tests/memory-provider-reconcile-interruption.test.js`: interrupted reconciliation/index lifecycle.
- `tests/memory-provider-query-revocation-race.test.js`: Provider query rechecks after asynchronous source validation.
- `tests/memory-provider-core-integration.test.js`: real SQLite Provider + Core consumer integration fixture, revocation during candidate authorization, rollback/currentness and source-version/inventory failure.
- `tests/memory-npc-consumer.test.js`: consumer fail-closed conditions, actor binding and source revalidation.

These tests prove only their implemented test boundary. Fixture-injected validators do not prove Host authority, deployed wiring, complete Host inventory, or final transport atomicity.

### Provider-local PR #331
- `tests/memory-provider-tombstone-selection.test.js`: selecting an exact tombstoned version again must fail.
- `tests/memory-provider-purge-boundary.test.js`: registered Provider-local dependent copy is purged while a sentinel in a separate external SQLite store remains.
- Exact head `889d8f11fb4027030a9c608334fd81e37cae21d8`; Runtime CI run [40215757526](https://github.com/necromorphic/Logic-Engine/actions/runs/40215757526): 601/601 tests and 8/8 oracle harness reported passing. PR remains Draft/unmerged.

## 3. Required closure evidence and owners

1. **Host / #258 — durable identity and complete lifecycle inventory.** Prove stable logical-message/version IDs and lineage, exact pre-mutation deletion targets, and active + historical + deleted inventory across restart/replay/import/export/copy/restore/migration. Unknown pre-enrollment or unrecoverable history must remain explicitly incomplete.
2. **Core / #140 — source and disclosure contract.** Approve a distinct Host-message source type, trusted world/session binding, version/lineage/currentness proof, and final disclosure-time authorization boundary. Existing canonical-entity-only ingestion cannot be reused as a substitute.
3. **Memory Provider / #181 — resume executable integration only after prerequisites.** Map the approved contract to existing Provider operations, then add a real caller/integration test without enabling production traffic by default. Until the source contract exists, no safe Provider-only code change can establish missing Host identity or Core authority.
4. **Provider-local limitation.** No current mechanism can guarantee atomic revocation across Provider storage, Core state, external derived-copy stores, and final transport. Sequential checks narrow races but do not eliminate the post-check race.

## 4. Decision

- No new API, schema, storage, cursor, outbox, or production wiring is introduced by this note.
- Do not claim that a production Host→Provider→Core→NPC vertical slice is complete.
- Continue Provider-local tests that do not require missing cross-block authority.
- Production Memory→NPC remains **DISABLED / FAIL-CLOSED** until Host evidence and Core/Provider owner approvals are satisfied.
