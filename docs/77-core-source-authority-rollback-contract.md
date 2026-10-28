# Core source authority, authorization, and rollback contract (TЗ-3)

Status: **implementation proposal / decision record; not production authorization**  
Owner: Core  
Related: Issue #140, PR #509 (transactional source-version ledger), PR #521 (Core readback and validation), Provider PR #504.

This document records the narrow source-version contract that can be supported by the current Core implementation candidate and separates it from guarantees that are not yet proven. Open-PR code is not shipped on `main`. Memory→NPC production use remains **DISABLED / FAIL-CLOSED**.

## 1. Single source-version authority

Core is the authority for canonical source versions. Do not create a second version registry and do not derive source versions from `updated_revision`, `world_revision`, `commit_sequence`, caller labels, Provider record versions, or context-manifest membership.

For canonical entities, the candidate token format is opaque to consumers:

`core-entity-v1:<positive safe integer>`

The durable `entity_source_versions` ledger in the existing Core SQLite store is the sole proposed persistence source. The token is issued/read by Core; Provider preserves and compares the exact token. A consumer cannot assert a version by supplying a string that merely has the right shape.

### Source-type support matrix

| Source type | Identity/version owner | Validation method | Invalidating changes | If unverifiable |
|---|---|---|---|---|
| Canonical entity projection | Core owns `world_id + entity_id` scope and monotonic source counter | Core snapshot read with source versions enabled; Provider validator compares the exact current Core-issued token and requires an active canonical entity | Any committed create/update/upsert/delete affecting the entity; resolved rollback affecting it; any canonical projection change that changes its validity | Reject as unavailable/stale; do not return a ready candidate |
| Canonical events, facts, relationships, context manifests | No single per-source token contract established by this change | No source-specific version contract is approved here | Must be defined per source type before source-dependent use; a world cursor is not a substitute | Treat as unverifiable for source-dependent use |
| Host/SillyTavern messages, generations, serialized prompt/body, external artifacts, vector-index records | No authoritative Core-owned identity/version and complete inventory demonstrated | No verified complete active/historical/deleted inventory or final-delivery binding | Not defined sufficiently to trust invalidation/revocation | **NON_READY / FAIL-CLOSED**; caller-supplied IDs, labels, or digests do not establish authority |

Do not extend the entity token to other source types by analogy. Each additional type requires an explicit owner, scoped identity, validity/version check, invalidation semantics, and tests.

## 2. Monotonicity and rollback

For canonical entities, a committed mutation advances the source counter in the same Core SQLite transaction as the canonical event/projection mutation. A resolved rollback advances the counter for every affected entity; it must never rewind the counter to match restored visible content. Unrelated entity changes must not advance an untouched entity's token.

Therefore a rollback may restore the same visible content while the previous token remains invalid. `commit_sequence` alone cannot establish freshness: rollback can alter canonical validity without increasing it.

Required tests:
- create/update/upsert/delete advance the token;
- rollback of update and rollback of delete issue a new token, even if the earlier projection is restored;
- unrelated events do not change an untouched entity token;
- ordinary process restart preserves the token;
- legacy migration gives pre-existing entities a safe baseline;
- missing ledger rows, malformed/overflowed counters, and authority outage/mismatch fail closed.

The combined candidate in PR #521 has an exact-head Runtime/NPC-boundary CI pass recorded for `9efc12e8dacef094851abf3b3b19d9a25d0f081f`. This is repository test evidence for that draft head, not merge approval or production readiness.

### Full-database restore limitation

Restoring an older complete Core database may restore an older source counter together with the old canonical state. The current per-entity counter does **not** prove restore-resistant anti-rollback. Distinguishing an authorized restore from rollback of authority requires an independent, trusted recovery/accepted-head procedure and deployment evidence. Until that procedure is specified and tested, this criterion is **BLOCKED**. Do not label ordinary restart tests as restore tests.

## 3. Minimum authorized-read contract

A source token is provenance/freshness metadata, not a grant of permission to read content.

Every protected read must be bound to:
- **Recipient:** the authenticated server-side consumer/service identity, not a caller-supplied label.
- **Subject:** the actor/entity resolved through the existing Core binding path in the correct world.
- **Purpose:** an explicitly permitted operation; purpose labels alone are not authorization.
- **Fields:** a finite allowlist for that recipient/purpose, evaluated by the existing authorized-read policy seam. Default behavior remains narrow/self-identity-only unless an owner-approved policy is actually configured.
- **Source:** a Core-resolved canonical identity and current Core-issued version, not a caller-provided version treated as authority.
- **Revalidation:** recheck the relevant conversation/actor/source authority after asynchronous candidate work and before returning protected content, where the current internal consumer path supports it. This narrows a race but does not prove final Host serialization/send enforcement.

Denial, missing source, stale/revoked source, policy error, or authority unavailability must fail closed. Externally visible denial must not reveal protected content, snippets, record counts, hidden target existence, or sensitive diagnostic details. Internal diagnostics must use safe error codes/messages and must not include protected payload fragments. Source-version-only metadata must not turn a fully withheld entity into an existence oracle.

The Core authorized-read service is a bounded seam, not blanket authorization for direct snapshots, events, audit, Host messages, or model-facing serialization. No broader policy is inferred from actor identity, manifest membership, or successful token validation.

## 4. Atomicity and persistence ownership

- Canonical event/projection mutation and its Core source-version ledger update must commit or roll back together in the existing Core transaction.
- Do not create a parallel canonical store or a second version ledger.
- Memory-owned indexes, retrieval records, and derived summaries may live in Memory-owned storage. Their persistence is not automatically atomic with Core canonical events or Core audit.
- Any claim that audit, revocation state, or a cross-store record commits atomically must be tied to the actual transaction implementation and a real-path test. No cross-store atomicity is claimed by this proposal.
- A derived summary must retain sufficient source lineage to be rejected when any authoritative source it depends on is stale, retracted, revoked, or unverifiable.

## 5. Source-change and revocation discovery

The current source-version contract supports point validation of a canonical entity token. It does not provide a durable change feed or guarantee that Provider learns about every change immediately.

### Core decision: hybrid, with a fail-closed reconciliation baseline

Core selects a **hybrid strategy** for the architecture:

1. **Primary change signal:** consume an existing durable Core-owned change journal only if implementation review proves it records every relevant committed mutation/revocation in order, supports replay after a cursor, and is transactionally coupled to the canonical mutation. Do not assume the current event/projection tables already satisfy this contract.
2. **Recovery path:** run a full reconciliation against current authoritative Core state at startup/restart, after a detected sequence gap, after cursor loss/uncertainty, and after any recovery operation that can invalidate consumer state.
3. **Point-of-use authority check:** regardless of journal or reconciliation status, validate the exact current Core-issued source token and authorization before protected content is accepted. If validation is unavailable, stale, or ambiguous, reject it.
4. **No silent fallback:** if the existing journal cannot meet the proof requirements, do not create a parallel unreviewed outbox. Keep the consumer **NON_READY / FAIL-CLOSED** until the Core/Memory interface contract and storage/API change are reviewed.

This is the Core architectural decision, not a claim that the required journal/reconciliation runtime already exists. A production integration still needs the consumer operation, source classes, maximum stale-time bound, expected volume, retraction semantics, and restart/partial-failure acceptance tests agreed with Memory and NPC owners. Those details gate implementation and rollout, not the choice of the hybrid safety model. Do not implement a new outbox, cursor, store, schema, or public API merely from this decision. Provider token validation remains mandatory; a change feed is not authorization.

### Source-code audit result (2026-10-28)

The current Core implementation does contain canonical `world_events` records and rollback validity/metadata writes, and the rollback path updates event validity, the rollback row, world revision, source-version counters, projection rebuild, and audit within the Core transaction. However, the reviewed surface does **not** expose a complete Memory-facing journal contract with a stable replay cursor that covers both newly committed events and rollback-only validity changes. `commit_sequence` alone is insufficient; the composite snapshot marker detects a rollback-only revision change but is not itself an incremental journal.

**Disposition today:** the existing tables are authoritative source material, but they have **not passed the proof gate for use as the hybrid's incremental primary signal**. Do not wire a consumer to infer journal completeness from table existence. Full reconciliation remains a required recovery path; its real consumer, complete source inventory, staleness bound, and failure/restart behavior must be implemented and tested by the owning integration work before use. This finding does not authorize a parallel outbox or change-feed API in PR #521.
### Full-inventory API audit (2026-10-28)

The existing Core snapshot API does **not** currently provide the complete entity inventory required by reconciliation. In `SQLiteStore.readSnapshot(id, request)`, omitted `entityIds` normalizes to an empty list, and the entity query runs only when the resulting list is non-empty. Therefore `getSnapshot(worldId)` returns the world marker but no entity rows; it is not an all-entities snapshot. Explicit entity reads are also bounded to 200 IDs per request and fail if any requested ID is missing.

The current Provider `validateInventory(worldId, records)` callback receives the Provider's own persisted record inventory. It can attest to that supplied set, but by itself it cannot prove that the set contains every current Core source or discover Core entities/revocations that have no corresponding Provider record. Test fixtures that return `true` do not establish that production guarantee.

**Minimum missing interface contract — specify and review before implementation:**

- A trusted Core-owned enumeration of all source entities in the agreed supported source domain for one world, including the state needed to distinguish active, deleted/destroyed, and unverifiable sources.
- A consistent snapshot marker binding the entire enumeration to one Core state; pages (if needed) must be pinned to the same marker and detect truncation, duplicates, gaps, or cursor loss.
- An explicit completeness result. Empty inventory must be distinguishable from unavailable, partial, malformed, or unauthorized inventory.
- A comparison/reconciliation rule that invalidates Provider records whose sources are absent, inactive, revoked, or version-mismatched, and that does not publish `current` until enumeration and Provider state are rechecked.
- Tests for more than 200 entities, multi-page consistency, empty versus unavailable inventory, concurrent mutation/rollback, deleted source with an existing Provider record, missing Provider records, interrupted restart/reconciliation, and idempotent retry.

This is a contract gap, not permission to add a public API, cursor table, outbox, or new schema in PR #521. The former inventory gap is closed at the Core entity-inventory API level in this draft branch, with pagination and validator tests. Full reconciliation is still **not production-ready** until the actual reconciliation lifecycle (including Provider-record invalidation, interruption/restart, idempotent retry, and publication gating) is implemented and tested. Memory→NPC stays **NON_READY / FAIL-CLOSED**.

## 6. Acceptance gate

| Requirement | Current disposition | Evidence needed to close |
|---|---|---|
| One Core-owned version contract for canonical entities | **PROPOSAL — implementation candidate exists** | Independent review and approval of the combined PR #509/#521 tree; no duplicate migration/table |
| Unsupported source kinds cannot authorize | **CONTRACT: FAIL-CLOSED** | Tests for each source kind; no fallback to world/commit cursor or caller labels |
| Rollback does not revive an old token | **TESTED in draft candidate** | Preserve exact-head CI and Provider stale-token-after-rollback test |
| Non-disclosing denial | **PARTIAL** | Real route/service tests for protected content, snippets, counts, target-existence probing, and diagnostic leakage |
| Restart | **TESTED for ordinary process restart in draft candidate** | Keep restart test on exact combined head |
| Full-database restore / authority rollback | **BLOCKED** | Approved restore/accepted-head protocol, separate authority evidence, and restore-from-old-backup tests |
| Provider notification/reconciliation strategy | **CORE DECISION: HYBRID; PARTIAL IMPLEMENTATION** | Prove existing journal contract or review a Core-owned change-feed contract; implement and test reconciliation lifecycle, agree consumer freshness bound, and pass interruption/recovery/idempotency tests with Memory/NPC owners |
| Host final serialized-body and send-time enforcement | **BLOCKED / NOT PROVEN** | Stable trusted Host identity, actual serializer/transport test, and revocation race test |
| Production Memory→NPC | **DISABLED / FAIL-CLOSED** | All required gates approved and passing against the actual end-to-end path |

## 7. Non-goals and safety boundary

This document does not approve a public source-version API, raw Host-message retention, a broader read policy, a new outbox/cursor, cross-store atomicity, restore-resistant anti-rollback implementation, or production Memory→NPC traffic. It is a Core-owned contract proposal and acceptance checklist for review; any unresolved trust boundary remains fail-closed.


### Full-inventory API implementation update (2026-10-28)

The first audit correctly found that `getSnapshot(worldId)` does not enumerate entities. A bounded Core-owned inventory method is now implemented as a candidate on this branch: `getCanonicalEntityInventory(worldId, { limit, cursor })`. It returns all canonical entities, including destroyed entities, with their source token (or explicit `null` when unverifiable), and binds each page to `world_revision + commit_sequence`. Pages are capped at 200 entities; continuation cursors carry the marker and an integrity digest. If the world changes between pages, the read fails with `ENTITY_INVENTORY_SNAPSHOT_STALE`; missing worlds, malformed cursors, and unavailable Core authority fail closed.

A Core-owned Provider callback, `createCanonicalEntityInventoryValidator(engine)`, now enumerates every page and verifies that each Provider record maps to an active entity with the exact current source token. The Core↔Provider integration tests now use this callback rather than a fixture that blindly returns `true`.

**Status:** implementation candidate added; exact-head Runtime and NPC-boundary CI passed on `a5fb6d012012a0d55d3ff522ede2574fd9a90e73` (run [#40586323309](https://github.com/necromorphic/Logic-Engine/actions/runs/40586323309)). Independent review is still required. This closes the previously missing inventory interface at code level only. It does not prove Host final-send enforcement, backup-restore anti-rollback, or journal replay completeness, and it does not authorize production Memory→NPC traffic.

### Reconciliation lifecycle test update (2026-10-28)

The Provider integration suite now explicitly verifies:
- an interrupted/unavailable inventory check leaves the Provider non-ready;
- restoring the trusted inventory validator permits a clean retry;
- repeated reconciliation is idempotent and does not duplicate Provider records or index entries;
- a Core mutation during inventory validation prevents the reconciliation attempt from publishing `current`, and the changed source remains stale on the next attempt.

These tests passed on PR head `0b869680e165ac72cd28081bc591553cce4f04d2` in Runtime + NPC-boundary CI run [#40587584663](https://github.com/necromorphic/Logic-Engine/actions/runs/40587584663).

**Still not proven:** process-restart recovery of a partially completed reconciliation; selective invalidation/quarantine of stale Provider records while preserving unrelated valid records; complete incremental journal replay; full-database restore anti-rollback; Host final-send enforcement. The current safe behavior is world-level fail-closed: a stale record can keep that world's Provider index non-ready until the record lifecycle is explicitly defined. Do not add destructive deletion or a new persistence schema implicitly. Memory→NPC remains **NON_READY / FAIL-CLOSED**.


### Provider process-restart recovery update (2026-10-28)

The Provider now invalidates persisted ready/current readiness during startup, clears the old snapshot marker, and records PROCESS_RESTART_RECONCILIATION_REQUIRED. Existing failure states such as INDEX_REBUILD_FAILED and SOURCE_VALIDATION_FAILED are preserved rather than overwritten. Retrieval remains blocked until a fresh full reconciliation succeeds.

A file-backed restart regression now closes and reopens the actual SQLite Provider, proves retrieval fails before reconciliation, and proves the persisted record can be reconciled and retrieved afterward. Related persistence tests were updated to require reconciliation after restart. Exact-head CI passed at 5095adf7aed447678dff5212f16b6f4450be9d89, Runtime run [#40588294420](https://github.com/necromorphic/Logic-Engine/actions/runs/40588294420): Runtime npm test 823/823, recalculation-oracle harness 8/8, and NPC-boundary passed.

**Scope of this evidence:** this tests a Provider process restart while the canonical Core engine remains available. It is not a Core process restart, a full-database restore test, or proof of restore-resistant anti-rollback. Selective stale-record quarantine is still not implemented; the current behavior remains world-level fail-closed to avoid deleting or silently changing persisted records without an approved lifecycle contract. Incremental journal replay, full-database restore anti-rollback, and Host final-send enforcement remain blocked/unproven. Memory→NPC stays **NON_READY / FAIL-CLOSED**.

## Inventory continuation authenticity — 2026-10-28

Core decision: `cursor_digest` must be an authenticity check, not a public deterministic checksum. Continuations are authenticated with a process-local secret and are invalidated when the Core process restarts. A consumer must restart enumeration at page one after restart or any invalid/uncertain cursor; it must never manufacture a continuation or treat snapshot markers as cursor authenticity. This is intentionally separate from restore-resistant accepted-head authority: it prevents callers from recomputing a continuation digest, but does not detect coordinated restoration of old Core and Provider backups. Exact-head CI must include a forged cursor whose public digest has been recomputed after changing `after_entity_id`.
