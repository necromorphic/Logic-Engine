# Provider coordinator refinement — issue comment #6518857086

**Base:** `main` at `52ad14ddfa6ca23858066e7516b4dbd6a190ab01` (2026-10-30).  
**Scope:** Provider-owned evidence and tests only. This note does not enable raw Host capture, production Memory→NPC traffic, or introduce a public API/schema/outbox/cursor.

## 1. Supported first consumer source

The first consumer slice supports exactly **`canonical_entity`** as its source type.

Executable enforcement:
- `SQLiteMemoryProvider.putRecord()` accepts `source_kind === 'canonical_entity'`.
- The persisted record must have exactly one lineage entry, whose `source_kind`, `entity_id`, and `source_version` match the record's direct source fields.
- `validDirectLineage()` repeats this validation when reading and reconciling persisted rows.
- `MemoryNpcConsumer` performs Core actor binding, Core `AuthorizedReadService` source reads, and final revalidation before returning a ready result.
- Summaries are rejected (`content_kind === 'summary'` is invalid for Provider ingest); arbitrary/multi-source lineage is rejected. Host message records are not an alternate accepted source.

This is a direct-source record path, not a Host chat-history adapter.

## 2. Identity tuple and executable operation map

The coordinator's Host tuple `(world_id, conversation_id, message_id, version_id)` is **not a supported consumer identity** on this base. It is a Host lifecycle candidate only. The raw Host path is deliberately disabled:
- `captureRawMessage()` → `MEMORY_RAW_CAPTURE_NOT_APPROVED`
- `readRawMessageVersion()` / `readActiveRawMessages()` → `MEMORY_RAW_DISCLOSURE_NOT_APPROVED`
- `selectActiveRawVersion()` → `MEMORY_RAW_SOURCE_NOT_APPROVED`
- `registerRawDerivedCopy()` → `MEMORY_RAW_DERIVED_COPY_NOT_APPROVED`

The supported Provider record identity is `(world_id, record_ref, record_version)`; its direct Core source identity is `(canonical_entity, source_entity_id, source_version)`. The Host tuple's `conversation_id`, `message_id`, and `version_id` must not be silently mapped to `record_ref` / `record_version`. A mapping requires a separate approved Host/Core contract.

| Identity / lifecycle | Existing operation | Trusted preconditions | Duplicate / conflict | Revoke / tombstone | Restart / replay |
|---|---|---|---|---|---|
| Supported direct source: `(world_id, record_ref, record_version)` with one `canonical_entity` lineage | `putRecord(record)`; Core consumer `retrieveForNpc()` | Caller is not the authority. Core actor binding and `AuthorizedReadService` must authorize the world/actor/source; Provider's injected `validateSourceVersion` and `validateInventory` must be backed by trusted integrations. Those callbacks in tests are fixtures, not deployment authority. | Same immutable key + identical persisted payload → `duplicate`; same key + changed scope/source/metadata/lineage → `MEMORY_IDENTITY_CONFLICT`. Missing or multi-source lineage fails validation. | `revokeRecord(scope, record_ref, record_version)` revokes that exact grant. `authorizeCandidate()` rechecks the exact version after source validation. Canonical source deletion/retraction remains Core-owned; Provider marks the index stale when source validation fails. | SQLite record/grant/index state persists. Process restart marks readiness stale; retrieval is blocked until index rebuild/reconciliation validates source versions and inventory. Identical ingest replay is idempotent and repairs a missing index row. |
| Host candidate: `(world_id, conversation_id, message_id, version_id)` | No supported consumer operation. Raw capture/read/active-selection/derived-copy registration are hard-disabled. | No trusted Host identity/session binding or complete Host inventory proof is currently connected. Caller-supplied world/conversation labels are not authority. | Not applicable to the supported consumer path. The legacy raw archive code has immutable-key duplicate/conflict logic, but raw capture is blocked and that logic is not an accepted ingestion contract. | Legacy exact-version tombstone can invalidate already registered local dependent copies, but registration is blocked and legacy rows are not consumer input. This is cleanup/recovery behavior, not approval of Host deletion events. | Legacy tombstone persistence tests cover pre-existing rows only. They do not prove Host save/reload/edit/swipe/delete/restore replay completeness. |

## 3. Failure/result matrix

The Provider API keeps these outcomes distinct. The Core/NPC consumer fails closed for every non-ready result; it does not turn them into a successful empty candidate set.

| Case | Provider evidence / observable result | Consumer behavior | Evidence |
|---|---|---|---|
| Authorized complete-empty | `retrieveCandidates()` returns `completeness: 'complete'` and `candidates: []` only after query grant, ready/current index, matching Core snapshot, and no scoped records. | Performs Core snapshot/source-boundary checks before returning ready-empty. | `memory-provider-core-integration.test.js`; new failure-matrix test |
| Denied | Query grant absent/false → `MEMORY_QUERY_DENIED`; `authorizeQuery()` is false. | Non-ready; no candidate identity/content. | `memory-provider-core-integration.test.js`; new failure-matrix test |
| Withheld | Query allowed but scoped indexed records exist and none is granted → `MEMORY_RECORDS_WITHHELD`; no count or identity is returned. | Retrieval exception becomes non-ready; never complete-empty. | New failure-matrix test |
| Partial | More than 50 authorized rows → `completeness: 'partial'` with capped candidates. | Non-ready; candidates/admitted are empty. | `memory-provider-core-integration.test.js`; new failure-matrix test |
| Stale | Core snapshot mismatch → `MEMORY_SNAPSHOT_STALE`; source version failure makes reconciliation stale. | Non-ready; no stale content. | `memory-provider-core-integration.test.js`; new failure-matrix test |
| Unavailable | Core snapshot callback outage → reconciliation `status: 'unavailable'`; retrieval remains blocked by `MEMORY_INDEX_NOT_READY`. | Non-ready. | `memory-provider-typed-failures.test.js`; new failure-matrix test |
| Rebuilding | Index state is rebuilding/non-ready → `MEMORY_INDEX_NOT_READY`. | Non-ready. | `memory-provider-ingest-index-failure.test.js`; `memory-provider-reconcile-interruption.test.js`; new failure-matrix test |

The consumer intentionally does not expose internal Provider error details as candidate-specific diagnostics. Multiple failure causes may share the outward `non_ready` envelope; the Provider-side typed result/error and internal diagnostics remain distinct. This is fail-closed error abstraction, not a successful empty result.

## 4. SQLite lifecycle and dependent-copy boundary

Already exercised on the real file-backed Provider/Core path:
- immutable record identity, exact duplicate replay, conflicting payload rejection;
- per-record grant and exact-version revoke;
- candidate A revalidation while candidate B authorization is awaited;
- raw record persistence surviving index-write failure, followed by rebuild/reconciliation;
- interrupted reconciliation, concurrent state changes, restart, rebuild, and retry;
- source rollback where `world_revision` changes without `commit_sequence` increment;
- restart does not restore readiness before reconciliation.

Dependent-copy invalidation is narrower than the wording may imply:
- The legacy raw tombstone operation invalidates only known, Provider-registered copies of the exact deleted raw version and preserves unrelated versions.
- The existing raw tombstone tests seed legacy rows directly. They do not prove a supported Host ingestion path.
- `registerRawDerivedCopy()` is hard-disabled; summaries and derived Host copies are not first-slice consumer records.
- The accepted `canonical_entity` slice has single-source lineage and no derived-summary disclosure. Therefore there is no approved canonical-entity dependent-copy graph to invalidate yet. Do not claim that legacy raw-copy tests close that separate capability.

## 5. Host inventory proof — why Provider row counts are insufficient

A Provider inventory is the set of rows Provider has received. Reconciliation proves, at most, that:
1. each persisted Provider record's source version still validates;
2. the Provider's derived index covers the Provider's persisted record set;
3. the trusted inventory validator accepted the supplied persisted-row set at a stable Core snapshot.

It cannot prove that Host emitted every source/version/deletion. A Provider containing 12 rows and an index containing those same 12 rows can be internally complete while Host had 13 messages and the 13th was never captured. Re-running reconciliation or comparing Provider row counts does not reveal an object that never entered Provider.

The Host/Adapter closure evidence must establish, using the actual Host lifecycle:
- stable logical-message identity and distinct immutable version identity across generation/swipe/edit/reload;
- exact pre-mutation deletion identity and distinction between deleting one version and deleting the logical message;
- save/reload/import/copy/restore semantics and collision behavior;
- an authoritative complete inventory boundary for the relevant world/session, including how changes concurrent with enumeration are accounted for;
- authenticated binding of that inventory to the Core-authorized world/session, not a caller-supplied label;
- replay/restart evidence showing that no lifecycle transition is silently missed.

No field names, cursor, outbox, journal, or wire schema are prescribed here. Host owns lifecycle truth and inventory completeness; Core owns trusted world/session binding and source authorization/currentness. Provider may consume an approved proof but cannot manufacture it.

## 6. Core #744 comparison and caller-supplied scope

Core PR #744 was a closed, unmerged draft candidate at the time of this audit; its own description says deployment authorizers are unset, Host-session authentication is absent, and production egress is not wired. It is not a merged authorization contract that Provider can assume.

Current-main `MemoryNpcConsumer.retrieveForNpc()`:
1. accepts `worldId`, `adapterId`, and `actorEntityId` as request scope values;
2. resolves that tuple through Core `ActorBindingService`;
3. uses the resulting actor scope for Provider query authorization;
4. uses Core `AuthorizedReadService` for canonical source fields and final revalidation;
5. fails non-ready on scope mismatch, unavailable authorization, stale snapshots, partial results, or revocation races.

This does **not** authenticate the origin of the request tuple. Provider does not treat `conversation_id` or `world_id` from a Host payload as trusted authority; it cannot upgrade request labels into authenticated Host identity. The remaining cross-block requirement is an authenticated Host-session/world binding supplied by the Host/Core owners. Provider must not bypass Core actor binding or source-field authorization to compensate.

## 7. Evidence classes and remaining owners

| Requirement | Owner | Current status | Closure evidence |
|---|---|---|---|
| Direct `canonical_entity` record identity, single-source lineage, duplicate/conflict, Provider grant/revoke, index/reconciliation | Provider | Implemented on current main; focused and integration tests exist | Exact-head native test + CI for this refinement PR |
| Seven-way result distinction and fail-closed behavior | Provider + Core consumer | Provider-side distinctions exist; consumer maps non-ready failures to a generic non-ready envelope | New Provider failure-matrix tests plus existing consumer integration tests |
| Known dependent-copy invalidation | Provider | Legacy exact-version tombstone tested; registration is disabled; not part of canonical-entity consumer slice | No production claim; reopen only with approved source/lineage policy |
| Complete Host source inventory and lifecycle capture | Host/Adapter (#258) | BLOCKED | Real save/reload/edit/swipe/delete/restore lifecycle plus complete inventory proof bound to authenticated session |
| Trusted world/session binding and canonical source authorization/currentness | Core (#140) | BLOCKED at Host-originated boundary; Provider consumes existing Core services in tests | Approved Core contract and integration test rejecting caller-supplied/cross-world rebinding |
| Core #744 acquisition-time value/source-event pinning and reader | Core/NPC | #744 closed unmerged; not a Provider dependency to reimplement | Core-owned merged contract and exact-head tests |
| Production Memory→NPC traffic | Core + Host + NPC + Coordinator | DISABLED / FAIL-CLOSED | All owner gates, authenticated Host path, deployment review, and explicit activation approval |

## 8. Explicit limits

- This PR adds tests and an evidence note; it does not claim full Host→Provider integration.
- Raw Host capture/read/active selection/derived-copy registration remain disabled.
- No public route, schema, outbox, cursor, source journal, or second store is introduced.
- No cross-store atomicity is claimed. Final revalidation narrows but does not eliminate the race after the check.
- Production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
