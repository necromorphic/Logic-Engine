# Provider accepted-head mutation protocol — implementation proposal

**Status:** proposal for Core/Security/Provider review. This document does not authorize runtime wiring or production activation.
**Depends on:** draft accepted-head authority contract #480 and dispatch-order ADR #479.
**Safety:** raw Host-text capture remains refused; production Memory→NPC remains **DISABLED / FAIL-CLOSED**.

## 1. Exact problem

The accepted-head authority can advance a monotonic Provider head, but the current Provider has no accepted-head client/configuration, no local accepted-head checkpoint, and no durable operation record tying an authority operation to the exact Provider mutation. Wrapping the current SQLite transaction alone is insufficient: a random operation ID cannot be reliably retried after a crash, and a digest of only the method name does not bind the accepted head to the mutation's actual effects.

## 2. Proposed invariants

1. The Provider is NON_READY unless its local accepted head equals the enrolled authority head and there is no unresolved pending operation.
2. A Provider mutation may publish state only while holding the existing shared coordinator lock. Authority code must never acquire that lock.
3. Every accepted mutation has a stable operation ID, canonical operation digest, expected prior head, and exact resulting head. Reusing an ID with a different digest/domain is a hard conflict.
4. Authority advance happens before the Provider mutation commits. Provider mutation and local operation checkpoint commit atomically in one BEGIN IMMEDIATE transaction. Authority finalize happens only after that local commit is confirmed.
5. Any authority outage, head mismatch, unknown pending operation, digest conflict, local SQLite error, or failed finalize leaves Provider NON_READY; no retrieval may return ready-empty while recovery is unresolved.
6. Authority head never decreases. Restore/re-enrollment is a separate audited administrative flow after reconciliation against trusted Host inventory; it is not an automatic recovery shortcut.
7. This protocol does not authorize raw message retention, change the source-version contract, or establish Host inventory completeness or the final model-dispatch boundary.

## 3. Operation identity and digest

The operation descriptor must be constructed at the Provider-owned method boundary from validated, normalized inputs—not supplied as an arbitrary caller digest.

- **Stable operation ID:** derive from the domain, expected head, operation kind, and canonical semantic request digest. The same logical retry at the same expected head yields the same ID; a different mutation yields a different ID.
- **Canonical digest:** SHA-256 over a versioned, deterministic encoding of the complete semantic mutation descriptor, including the target scope and all fields that change durable state. Do not include wall-clock timestamps or random IDs.
- **Repeated identical calls:** methods whose contract is immutable/idempotent may treat an identical retry as the same operation. Methods where identical inputs can intentionally represent a new action must accept an explicit stable operation ID from their trusted internal caller; do not silently collapse those actions.
- **Payload retention:** do not duplicate raw message text in an operation journal. Raw-capture operations remain disabled. For existing Memory record writes, the design must decide whether the existing record payload can be referenced by a durable record/version key or whether a bounded, separately approved replay envelope is required. If the mutation cannot be retried or proven committed without retaining unapproved content, it remains unsupported and NON_READY.

## 4. Local durable metadata proposal

Use the existing Provider SQLite database only; do not create a second local authority store.

- provider_authority_state: singleton row containing installation/store identity, last locally committed accepted head, and readiness/recovery status.
- provider_authority_operations: operation ID, operation digest, expected head, resulting head, operation kind, local outcome (prepared/committed), and timestamps/diagnostic code that are not part of the operation digest.
- The operation row and provider_authority_state advance in the same transaction as the corresponding Provider mutation. The external authority remains the only source of monotonic accepted-head truth; local metadata is evidence for crash recovery, not anti-rollback protection.

Schema details and exact column constraints must be reviewed with Core/Security before implementation. This proposal intentionally does not create the tables.

## 5. Required execution sequence

1. Acquire the existing cross-process coordinator lock.
2. Read the local checkpoint and synchronous authority status. Require matching installation identity, enrolled Provider domain, equal heads, and no unrelated pending operation.
3. Build the canonical mutation descriptor from validated method inputs; compute stable operation ID and digest.
4. Call advanceAcceptedHeadSync with the current expected head. Reject any response that does not identify the exact domain, operation ID, digest outcome, and next head. A pending replay is permitted only for the same operation/digest.
5. In one Provider BEGIN IMMEDIATE transaction, apply the mutation and write the matching committed operation row plus new local head. If a matching committed row already exists, verify the exact digest/head and do not apply the effect twice.
6. Commit the local transaction, then call finalizeAcceptedHeadSync for the exact operation.
7. Re-read authority status and verify the committed head matches local state before returning the Provider to READY.
8. Release the coordinator lock.

The accepted-head digest-response gap was addressed in the current draft #480 head (`09cb69a7dc7d5d635c492aa3078f17d90e68fafa`): the authority response now includes the persisted digest, and the synchronous client/IPC child reject a mismatch. No exact-head workflow run is associated with that API-created commit yet, so this is an implementation change awaiting CI, not validated behavior. Provider mutation integration and local operation journaling remain unimplemented.

## 6. Crash/restart recovery matrix

| Failure point | Required behavior |
|---|---|
| Authority unavailable before advance | No Provider mutation; remain NON_READY for that operation |
| Authority advances; Provider transaction never commits | Authority shows pending and local head is old. Do not serve retrieval. Retry only with the same stable operation descriptor, or require explicit audited recovery if the descriptor is unavailable |
| Provider mutation and local checkpoint commit; finalize fails | Local operation row proves the exact mutation/head. Remain NON_READY; finalize the same operation idempotently, then verify authority/local equality |
| Process crashes during Provider transaction | SQLite atomicity leaves either no mutation/checkpoint or both. Reconcile against authority before readiness |
| Same operation ID with a different digest | Hard conflict; remain NON_READY; never guess which effect was intended |
| Authority head is ahead but no matching local operation row exists | NON_READY; no automatic replay or head reduction. Require trusted recovery/reconciliation |
| Local DB/backup is older than external authority | Detect head mismatch and remain NON_READY; restore cannot lower authority |
| Finalize response is lost | Query authoritative status and matching local operation row; retry finalize only for the same operation/digest |

## 7. Mutation coverage required before Provider can be READY

The implementation must enumerate and test every durable state-changing path, including:

- query grants and revocations;
- per-record grants and revocations;
- record/version and derived-index writes;
- index rebuild and repair;
- reconciliation start, failure/readiness transitions, and final publication;
- source tombstone/deletion and permanent purge;
- schema migrations, startup repair, and explicit restore/re-enrollment.

Internal readiness-state transitions must not bypass the protocol if they can change disclosure eligibility. Methods that are not yet enrolled in the accepted-head protocol must be explicitly gated while the Provider is NON_READY. Raw capture, active-version selection, and derived raw-copy retention remain refused under the existing policy and must not be enabled by this work.

## 8. Acceptance tests

- Each mutation class advances exactly one head and updates the local checkpoint atomically.
- Same operation + same digest is idempotent across process restart; same operation ID + different digest is rejected.
- Authority outage before advance causes no local mutation.
- Crash after advance/before local commit never permits retrieval or an automatic new operation ID.
- Crash after local commit/before finalize recovers only the matching operation and never duplicates the effect.
- Every grant/revoke, record/index, reconciliation/readiness, tombstone/purge, migration, and recovery path is either covered or explicitly blocked.
- Restore an older Provider DB/WAL/SHM after external head advancement; startup and retrieval remain NON_READY.
- Cross-process tests prove the coordinator serializes Provider mutations against the eventual dispatch-start boundary.
- Windows deployment tests prove the Provider identity cannot write/restore the authority store and validate actual DB/WAL/SHM ACLs.

## 9. Current disposition

This is a design proposal only. The existing Provider transaction wrapper is not an accepted-head protocol. Do not wire production retrieval, add a public API, enable raw-text capture, or claim anti-rollback until Core/Security approves the exact operation identity, local schema, recovery semantics, and exact-head tests.
