# Memory Provider lifecycle decisions (implementation checkpoint)

**Status:** owner decisions recorded; implementation is deliberately partial. This note does not approve production wiring or a Core source-change contract.

## 1. Record edits, active versions, deletion, and purge

Chosen policy: **hybrid**.

- Ordinary edits may retain version history under the approved retention policy.
- Selecting a different SillyTavern swipe/generation changes the active version; it is not by itself a permanent-delete request for every alternative.
- A source deletion must make the deleted version ineligible for retrieval and invalidate dependent derived episodes/summaries and search-index entries.
- Permanent deletion is a distinct operation. It must remove the selected source content and dependent copies/index entries to the extent required by the retention/deletion policy.
- A Core world rollback is a canonical-state lifecycle event, not an implicit instruction to erase archive history.

### Provider-local implementation now present

The SQLite provider now has an isolated raw-message archive slice in its provider-owned database:

- `captureRawMessage` persists the exact UTF-8 text, role, metadata, capture time, and SHA-256 integrity digest under a world/conversation/message/version key. Identical retries are idempotent; a conflicting payload for the same version fails with `MEMORY_RAW_CAPTURE_CONFLICT`.
- `selectActiveRawVersion` changes only the active-version pointer. It does not erase other swipe/generation alternatives.
- `registerRawDerivedCopy` records a provider-local dependent copy with source-version lineage.
- `markRawSourceDeleted` marks the selected version deleted, removes it from active selection, and marks registered dependent copies invalidated.
- `purgeRawSource` is a separate explicit permanent operation. It removes the selected version and cascades to registered dependent copies in this provider database.

### Remaining limits

This is a provider-local persistence/lifecycle API, not a SillyTavern capture hook, public HTTP route, source-change feed, or production Memory→NPC integration. Raw reads are available only through `readRawMessageVersion` / `readActiveRawMessages` when a trusted `authorizeRawRead` callback is injected; absent, denying, or throwing callbacks fail closed with `MEMORY_RAW_READ_DENIED`. No search/vector index over raw message bodies is wired. Only dependent copies explicitly registered in this database are invalidated/purged; external stores and indexes are not managed by this operation. Retention duration, encryption-at-rest, and host authorization for capture remain host/deployment policy questions and are not inferred here.

Do not infer source deletion or canonical freshness from `world_revision + commit_sequence`. The source identity/version and complete-inventory production gates remain blocked by Core #140.

## 2. `missing_ids` diagnostics

Chosen policy: **detailed internal diagnostics**.

- Internal diagnostics may retain exact missing record IDs and reason codes needed for troubleshooting.
- Diagnostic details must not be copied automatically into NPC-facing results, client responses, or general API envelopes.
- Diagnostic logging must not include secret record content merely because IDs/reasons are allowed.
- Any future public projection must explicitly omit or safely coarsen internal `missing_ids`, including counts where counts could disclose hidden records.

### Current implementation boundary

The current provider API does not emit `missing_ids`; this is a policy for future import/reconciliation diagnostics, not a claim that a diagnostics subsystem already exists.

## 3. Internal import-only facade

Chosen policy: **small internal interface for tests; no production wiring**.

- Expose only a single-record import operation over an explicitly supplied provider instance.
- Keep the module internal and do not export it from a public application barrel, HTTP route, or default runtime.
- Preserve the provider's existing identity validation and idempotency behavior; the facade must not synthesize source IDs, versions, lineage, or permissions.
- This is not a batch-import contract and makes no atomicity guarantee across multiple records.
- Test it against the real SQLite provider. Production integration remains blocked by Core issue #140 and approved source lifecycle contracts.

## Non-negotiable boundaries

Core remains the sole canonical world-state authority. Provider records and indexes are not canon. Search indexes are derived and fail closed when stale or unavailable. Retrieval candidates do not by themselves establish NPC knowledge, authorize disclosure, or persist delivery/acquisition. No merge or production activation is implied by this checkpoint.
