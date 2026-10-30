# Host snapshot ↔ Memory Provider acceptance boundary

**Status:** implementation evidence map, 2026-10-30. This document records what the current implementation and executable tests prove. It does not approve a production Host-to-Provider adapter or enable Memory→NPC.

## Non-negotiable source boundary

The first bounded consumer slice accepts only a direct, lineage-complete `canonical_entity` source. Host message-version tuples, raw Host message captures, and derived summaries are not Provider semantic records and must not be promoted into this slice.

Evidence:
- `tests/memory-provider-source-separation.test.js`: raw Host archive rows remain separate from `memory_records` and the rebuildable index; retrieval returns only the canonical Provider record; summary records are rejected until a separate lineage-complete contract is approved.
- `tests/memory-provider-host-snapshot-contract.test.js`: identical canonical Provider record replay is idempotent and leaves Provider reconciliation current.

## Host snapshot and Provider reconciliation are separate authorities

`HostVersionDigestLedger.reconcileConversation()` verifies and reconciles a complete Host message-version inventory into the digest-only Host ledger. It does not reconcile semantic Provider records and does not itself grant Memory disclosure permission.

The Host ledger requires a trusted inventory verifier. The current Core startup path supplies a deny-only verifier, and the repository has no approved production Host snapshot attestor/adapter. Therefore the existence of the ledger or a passing injected-verifier unit test is not evidence of a production-complete Host inventory.

Do not:
- infer Host inventory completeness from individual lifecycle events or current-file inventory;
- treat an account/session binding as proof of complete version history, branch/restore lineage, or rollback resistance;
- derive Provider record identity or authorization from a Host message/version tuple;
- make Host message records or summaries eligible in the first consumer slice.

## Acceptance matrix

| Requirement | Executable evidence | Boundary |
|---|---|---|
| Preserve Provider architecture | `tests/memory-provider-source-separation.test.js`; Provider reconciliation tests | Host digest ledger remains separate; no Provider API/schema rewrite |
| Exact-version deletion | `tests/host-version-digest-ledger.test.js`: “active selection preserves alternatives and exact tombstone does not delete another version”; `tests/host-version-digest-ledger-replay.test.js`: complete-snapshot tombstone preserves the sibling and reselects it; Provider exact-version lifecycle tests | Tombstone is exact tuple; sibling versions remain |
| Identical Provider record replay | `tests/memory-provider-host-snapshot-contract.test.js` | Provider record replay is idempotent |
| Identical Host snapshot replay | `tests/host-version-digest-ledger-replay.test.js` | Same accepted snapshot returns READY without advancing the monotonic anchor |
| Revocation during read | `tests/memory-provider-host-snapshot-contract.test.js`; `tests/memory-provider-cross-connection-revocation-race.test.js`; `tests/memory-provider-query-revocation-race.test.js` | Revocation/ABA during awaited validation fails closed; sibling versions remain independently addressable |
| `empty` vs `denied` | `tests/memory-provider-failure-matrix.test.js` | Authorized complete-empty is not denial or withheld |
| `partial` | `tests/memory-provider-failure-matrix.test.js` | Partial is explicit and never represented as complete |
| `stale` | `tests/memory-provider-failure-matrix.test.js`; `tests/memory-provider-host-snapshot-contract.test.js` | Stale snapshot cannot reuse a previous current marker |
| `unavailable` | `tests/memory-provider-failure-matrix.test.js` | Core unavailability remains unavailable and fail-closed |
| `rebuilding` | `tests/memory-provider-failure-matrix.test.js` | Index rebuild is non-ready, not complete-empty |

## Replay and lifecycle invariants

1. Same immutable Host tuple + same digest + same parent lineage is idempotent.
2. Same tuple with a different digest or parent is a conflict; do not overwrite the immutable row.
3. Tombstoning one `(world_id, conversation_id, message_id, version_id)` must not delete a sibling version; complete-snapshot reconciliation also preserves and can reselect that sibling.
4. Replaying the same trusted complete snapshot must not advance the monotonic snapshot generation.
5. A snapshot that omits a previously known version is not interpreted as deletion unless the trusted complete-inventory contract accepts it; otherwise reconciliation fails closed.
6. A tombstoned version must not silently reappear.
7. Access authorization is revalidated after asynchronous source checks; revoke/re-grant ABA must not restore an in-flight authorization.

## Current disposition

- Provider-local exact identity, tombstone, reconciliation, replay, and revocation safeguards: implemented and covered by the cited tests.
- Host digest-only inventory ledger: draft/local mechanism with an injected verifier.
- Production Host snapshot attestation and complete inventory (including historical swipes, delete-all, import/copy/restore/branch and external mutation): **BLOCKED**.
- Host-to-Provider semantic ingestion: **NOT APPROVED**.
- First consumer slice: **canonical_entity only**.
- Host message records and derived summaries: **EXCLUDED**.
- Production Memory→NPC: **DISABLED / FAIL-CLOSED**.

This boundary is intentional. No new Provider schema, universal source identity, cursor, outbox, raw-text retention, or automatic Host-to-Provider promotion is introduced by this acceptance note.
