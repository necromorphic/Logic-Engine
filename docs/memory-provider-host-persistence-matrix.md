# Memory Provider: existing persistence path and Host/Adapter blockers

Date: 2026-10-24

Status: implementation evidence for the current draft branch only. This is not approval to enable production retrieval.

## Current executable path

- Provider implementation: [`src/application/sqlite-memory-provider.js`](../src/application/sqlite-memory-provider.js), `SQLiteMemoryProvider.captureRawMessage(input)`.
- It writes to the existing Provider-owned SQLite table `memory_raw_captures`, keyed by `(world_id, conversation_id, message_id, version_id)`. It stores `role`, exact JavaScript string content encoded as UTF-8 for SHA-256, JSON metadata, capture time, and a provider-local deletion marker. A duplicate key with different role/content/digest/serialized metadata throws `MEMORY_RAW_CAPTURE_CONFLICT`; identical payload returns `duplicate`.
- `selectActiveRawVersion(input)` changes the pointer in `memory_raw_active_versions` and retains alternate rows.
- `markRawSourceDeleted(input)` marks one exact version deleted, removes the active pointer only if it points at that version, and invalidates registered dependent copies in `memory_raw_derived_copies`. `purgeRawSource(input)` permanently deletes that exact version and its Provider-local dependent copies.
- These are callable Provider methods, not a Host/Adapter event listener or production ingest API. The repository's `docs/13-sillytavern-adapter-contract.md` is requirements-only. PR #259 documents the pinned host evidence; it does not add a listener.
- `memory-provider-import-internal.js` is an internal test/import seam, not a production host transport. Raw archive rows are separate from `memory_records` / derived index entries; capture alone does not make a raw message an NPC retrieval candidate.

## Capability matrix

| Capability | Existing file / function | Existing test evidence | Production status | Limit / safe behavior |
|---|---|---|---|---|
| Persist raw version and digest | `src/application/sqlite-memory-provider.js` — `captureRawMessage` | `tests/memory-provider-raw-archive.test.js`: durable capture, digest, duplicate and conflict cases | Provider-local implementation in draft PR #201; not wired to ST | Accepts caller-supplied identity; does not prove it came from the host or Core. Do not ingest an event until identity is resolved by an approved adapter contract. |
| Duplicate delivery | `captureRawMessage` compares key + role/content/digest/metadata inside `BEGIN IMMEDIATE` transaction | `raw message capture is durable, integrity-tagged, and idempotent across restart` | Implemented/tested locally | Identical payload is a duplicate. Same key with different payload is `MEMORY_RAW_CAPTURE_CONFLICT`; never overwrite. No host redelivery path is connected. |
| Selected swipe/version | `selectActiveRawVersion`, `readActiveRawMessages` | `active-version switching retains alternative generations`; new regression verifies selection survives restart and deleting inactive alternative preserves it | Provider-local implementation; not host-mapped | Requires known `message_id` and `version_id`. ST `MESSAGE_SWIPED` supplies a numeric chat-array index in the pinned source/sample, not a proven durable branch/generation ID. Fail closed rather than map the index. |
| Edit creates immutable version | `captureRawMessage` can store a distinct caller-provided `version_id` | Conflict and multi-version archive tests | Primitive only; no edit adapter | `MESSAGE_EDITED` / `MESSAGE_UPDATED` report an index, not an approved immutable revision ID or before/after bytes. A later edit cannot safely be linked to a prior source version today. |
| Delete one swipe | `markRawSourceDeleted` can invalidate one exact version and its registered copies | `source deletion excludes the version from active selection and invalidates known dependent copies` | Provider-local exact-version operation only | Host `MESSAGE_SWIPE_DELETED` payload `messageId`, `swipeId`, `newSwipeId` contains host-local numeric indices. No proven durable mapping to `message_id/version_id`; do not call deletion based on those numbers alone. |
| Delete whole message | `markRawSourceDeleted` for each known exact source version | Version-deletion and restart tests | No real host path | Inspected `MESSAGE_DELETED` emits the post-delete chat length, not the deleted logical message identity or full set of versions. Cannot determine the exact source(s) to retract. Keep affected source use non-current until authoritative reconciliation can resolve it. |
| Invalidate dependent copies | `registerRawDerivedCopy`, `markRawSourceDeleted`, `purgeRawSource` | Dependent-copy invalidation, purge cascade, restart persistence tests | Provider-local only | Only copies registered in this SQLite database are invalidated/purged. External vector indexes, other stores, and unregistered copies are not covered. |
| Restart/reopen | SQLite tables persist raw versions, active pointers, deletion markers and registered copies | Raw capture/restart; delete/invalidation/restart; new active-version/restart regression | Provider-local persistence verified by tests/CI | Reopening SQLite restores what Provider already knew. It cannot reconstruct missed host events, prove the selected ST swipe, or discover a deletion that was never captured. |
| Source identity and provenance | `captureRawMessage` keys on world/conversation/message/version and accepts generic metadata | Unit fixtures use literals such as `world-a`, `chat-a`, `message-1`, `generation-1` | No production identity binding | The IDs in tests are fixture values, not an approved mapping. Metadata is caller-supplied and not authoritative provenance. No host build/event/revision linkage is validated by Provider. |
| Trusted source version | Constructor requires `validateSourceVersion`; direct-record authorization calls it in the canonical-entity path | `tests/sqlite-memory-provider.test.js` and typed-failure tests inject callbacks | Test seam only; no trusted production binding identified | Callback presence is not authority. ST events do not prove Core source validity, source version, lineage, rollback state or field authorization. Unknown/unavailable validation must remain non-ready/fail-closed. |
| Complete inventory / snapshot | Constructor requires `getSnapshot` and `validateInventory`; reconciliation checks these integrations | `tests/sqlite-memory-provider.test.js`, `tests/memory-provider-reconcile-interruption.test.js`, `tests/memory-provider-reconcile-race.test.js` use injected fixtures | Test seam only; no production trusted inventory source identified | `world_revision + commit_sequence` is a snapshot marker, not a source-specific change journal. No approved complete, consistent Core inventory/change-feed contract is available. Do not interpret callback `true`, zero rows, or a host event sample as complete inventory. |
| Source deletion, rollback and revoke reconciliation | Provider-local deletion/invalidation exists; Core gate is tracked in [#140](https://github.com/necromorphic/Logic-Engine/issues/140) | Provider-local tests plus Core/NPC seam tests on separate draft branches | End-to-end reconciliation blocked | No authoritative durable host lifecycle replay + Core source-currentness proof. Keep readiness unavailable/stale when source version or inventory cannot be proven. |
| Real ST → Provider write | No implemented listener/transport in current Provider branch; see [Host/Adapter #258](https://github.com/necromorphic/Logic-Engine/issues/258) and [PR #259](https://github.com/necromorphic/Logic-Engine/pull/259) | Runtime logs show event presence/shape only; not persistence or restart acceptance | Not implemented | Do not add an ad-hoc route, event schema, cursor/outbox, ID map or second lifecycle without owner approval. Production retrieval remains disabled. |

## Field-by-field identity source

| Provider field | What is available in the pinned ST evidence | Safe decision |
|---|---|---|
| `world_id` | No ST event is a Core-authenticated world binding. | Must come from an existing trusted Core/adapter binding; absent that, do not ingest for source-dependent use. Do not derive it from chat name/metadata. |
| `conversation_id` | `CHAT_CHANGED` carries the current host chat ID; source inspection/runtime sample do not establish its persistence/reuse semantics across every reload, rename, import or duplicate chat. | Candidate host key only after stability and Core-world binding are proved. Not yet approved as a durable Provider identity. |
| `message_id` | Lifecycle events inspected here primarily carry mutable chat-array indices; delete reports post-delete length. | No approved durable message ID is available from the observed payloads. Never persist array index as this field. |
| `version_id` | Swipe event carries an index; swipe-delete carries host-local indices; generation start/end can repeat and expose no proven durable generation UUID. | No stable revision/generation identity or parent lineage is proven. Do not fabricate a version ID from event order, timestamp or text hash. |

## Event semantics evidence

Host target: SillyTavern checkout reported as `1.19.0-1-g06bde939f`, exact source HEAD `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. The source audit and two redacted diagnostic samples are recorded in [Host/Adapter #258](https://github.com/necromorphic/Logic-Engine/issues/258).

- `MESSAGE_SENT` is a host event whose ordinary append path is after save; insert-at-index has a different ordering. Payload index is not durable identity.
- `MESSAGE_RECEIVED` can occur before `saveChatConditional()` in generated-message finalization and can occur on an error-streaming path. It is not persistence confirmation.
- `MESSAGE_EDITED` / `MESSAGE_UPDATED` provide numeric index; no immutable revision/parent pair.
- `MESSAGE_SWIPED` provides numeric index; no durable generation/branch identity.
- `MESSAGE_SWIPE_DELETED` provides `{ messageId, swipeId, newSwipeId }` as host-local numeric indices.
- `MESSAGE_DELETED` provides post-delete `chat.length`, not deleted logical IDs.
- `GENERATION_STARTED` may repeat; `GENERATION_STOPPED` has no args; `GENERATION_ENDED` has a numeric index in the inspected path. No stable generation ID is established.
- `USER_MESSAGE_RENDERED` / `CHARACTER_MESSAGE_RENDERED` are render signals, not proof of human receipt, NPC receipt, acquisition or belief.

The samples are useful event-presence evidence, not a full lifecycle/persistence/restart experiment. Do not infer unobserved semantics.

## Contract findings and blocker owners

- **Core (#140):** no approved universal source identity/version contract or durable source-change feed; no authoritative consistent full-inventory boundary. Core must decide the supported source type(s), version/lineage proof, world binding, and reconciliation boundary.
- **Memory Provider (#181 / PR #201):** Provider-local persistence and lifecycle primitives exist on a draft branch. It cannot authoritatively bind host IDs or treat callback fixtures as source authority. The current raw archive input is not a production host API.
- **Host/Adapter (#258 / PR #259):** exact ST target and event-shape evidence exist; stable durable message/generation IDs, exact delete target mapping, selected branch durability and restart/replay semantics are not proven.
- **NPC (#149):** production Memory→NPC remains disconnected until source validity, inventory, authorization and disclosure gates close.

No additional runtime API, table, cursor, outbox, transport, source authority or lifecycle is introduced by this report. The safe result for missing/ambiguous identity, unproven source version, incomplete inventory, or unresolved deletion is non-current/non-ready with no production candidate disclosure.
