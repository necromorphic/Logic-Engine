# Memory Provider ↔ Host/Adapter identity and lifecycle mapping

**Owner:** Memory Provider  
**Related:** [Provider issue #181](https://github.com/necromorphic/Logic-Engine/issues/181), [Core gate #140](https://github.com/necromorphic/Logic-Engine/issues/140), [Host/Adapter evidence PR #259](https://github.com/necromorphic/Logic-Engine/pull/259), [Provider SQLite PR #182](https://github.com/necromorphic/Logic-Engine/pull/182), [Provider lifecycle PR #201](https://github.com/necromorphic/Logic-Engine/pull/201).  
**Status:** Provider-side mapping proposal grounded in the current draft implementation. It is not an approved cross-block schema or production handoff. Production Memory→NPC remains **DISABLED / FAIL-CLOSED**.

## 1. Decision boundary

Core’s direction A requires a durable logical-message identity and a distinct durable identity for each immutable message version/swipe. The Host/Adapter evidence for pinned SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` documents that current native message indexes and swipe array positions are mutable, and native lifecycle events do not carry durable before/after version IDs.

Provider can persist a supplied identity tuple and enforce its own duplicate/conflict/tombstone rules. Provider cannot certify that a supplied ID is authentic, current, complete, correctly world-bound, or derived from a particular SillyTavern source. Those are Host/Adapter and Core contracts still requiring owner approval.

The following labels are used throughout:
- **EXISTS (Provider draft):** executable behavior in the Provider draft branch, not necessarily merged or production-wired.
- **HOST EVIDENCE / GAP:** observed SillyTavern behavior or missing durable host signal documented by Host/Adapter.
- **PROPOSED:** minimal cross-block rule to review; not an approved field name, API, or wire schema.
- **BLOCKED:** cannot be asserted until the named owner supplies authoritative evidence.

## 2. Identifier mapping

| Logical concept | Host/Adapter side | Provider side | Status / owner decision |
|---|---|---|---|
| World binding | Must provide the Core-authorized world identity for the captured source. A chat name or caller-provided world string is not proof of binding. | Existing raw capture key includes `world_id`; Provider can isolate records by that value but cannot prove its authority from the value alone. | **BLOCKED — Core** must define/approve the authoritative world-binding evidence; Host must pass it without substitution. |
| Conversation/chat identity | Must provide a durable identity that survives chat rename, switch, save/load, and defined copy/import/restore operations. Native chat filenames/names alone have not been approved as durable identity. | Existing raw capture key includes `conversation_id`; Provider treats it as part of the key and does not infer equivalence between renamed/copied chats. | **PROPOSED — Host + Core** must define persistence and copy/import/restore identity rules. |
| Logical message identity | Must assign/persist one durable identity for the logical message independently of current array index and swipe slot. Deletion must capture identity before the host mutates/splices its array. | Existing key includes `message_id`. A changed/reindexed ST position must not be used as a replacement identity. | **PROPOSED — Host + Core** approve durable ID creation, migration, branch/copy collision handling, and deletion payload evidence. |
| Immutable version / swipe identity | Must assign/persist a distinct durable identity for each created version/swipe; selection of an existing swipe must report that version identity. | Existing key includes `version_id`; the record is immutable for that tuple. Same tuple + same role/content/digest/metadata is idempotent; conflicting payload for the same tuple fails with `MEMORY_RAW_CAPTURE_CONFLICT`. | **PROPOSED — Host + Core** approve version creation and identity preservation across reload, reindex, import, branch, and restore. |
| Parent / ancestry / edit lineage | Host must provide unambiguous lineage evidence when a version replaces or derives from another version. Current ST events do not provide before/after durable revision IDs. | Provider can persist only lineage actually supplied and validated by the approved contract. Existing raw archive key does not itself prove ancestry. | **BLOCKED — Host + Core** define the lineage evidence and completeness semantics. Missing/ambiguous ancestry cannot be guessed. |
| Active version | Host reports the selected durable version identity, not a numeric swipe position alone. | Existing `selectActiveRawVersion()` changes the active pointer while retaining alternate archived versions. | Provider behavior exists; host identity handoff and authorized currentness are **BLOCKED**. Pointer selection is not proof that a source is still authorized/current. |
| Deleted swipe/version | Host captures the exact durable version ID before array mutation/reindexing and distinguishes deletion of one alternative from deletion of the whole logical message. | Existing `markRawSourceDeleted()` marks the exact version deleted and invalidates known registered dependent copies. It is a reversible lifecycle marker, not guaranteed physical erasure. | Provider operation exists; trustworthy Host delete signal and Core authorization/retraction semantics are **BLOCKED**. Never infer target from post-delete array position. |
| Deleted logical message/chat | Host must identify the logical message and the complete set of affected version IDs before removal. Chat deletion/copy/restore needs an explicit defined lifecycle signal. | Provider can mark only known, exact version records. It cannot infer an exhaustive source inventory from records already stored. | **BLOCKED — Host + Core** supply affected-ID completeness and source deletion/retraction authority. Unknown impact means fail closed; do not guess. |
| Source revision/currentness | Host supplies stable source identity and lifecycle facts, not an assertion that a record remains canonical/current. | Provider enforces its own immutable record identity, grants, tombstones, and injected source validation hooks. Test callbacks are not production source authority. | **BLOCKED — Core** owns canonical source version/currentness and rollback semantics. |
| Inventory/reconciliation | Host/Core must provide a way to establish what source objects and versions exist, including deletions, edits, branches, and restores. Event presence alone is not a complete inventory. | Provider's index readiness/reconciliation describes its own persisted provider records/index. It does not prove every ST source was captured or that no source change was missed. | **BLOCKED — Core + Host** approve a complete source inventory/change boundary. No parallel cursor, outbox, or change journal is introduced by Provider. |

## 3. Provider identity and idempotency rules

The current draft raw archive uses the composite identity `(world_id, conversation_id, message_id, version_id)`. This is a Provider storage key, not a declaration that these names are approved Host schema fields.

1. **Exact duplicate replay:** same composite key and same role/content digest/metadata is treated as duplicate and must not create a second record.
2. **Identity collision:** same composite key with different payload is a conflict; fail closed. Never silently overwrite the immutable record.
3. **Missing/ambiguous identity:** reject capture. Do not synthesize a durable identity from array index, timestamp, swipe position, or `extra.gen_id`.
4. **World/chat rebinding:** do not silently move a record to another world or conversation. Rebinding requires an owner-approved migration contract and verified lineage.
5. **Active selection:** selecting another already captured version changes the active pointer only. It does not delete other versions and does not grant disclosure authority.
6. **Raw-first durability:** raw capture must remain durable if derived indexing fails; index health must then remain non-ready/rebuild-required rather than reporting a successful complete query.
7. **Derived copies:** a dependent copy is eligible for use only if its recorded lineage is complete and all required source authorizations can be revalidated. Existing summary/derived content is not made safe merely by registering a copy.

## 4. Lifecycle mapping and required semantics

| Host operation | Provider behavior available now | Required cross-block behavior / test |
|---|---|---|
| Create message / generation | `captureRawMessage()` can persist one immutable tuple. | Host must supply durable logical-message and version IDs. Replaying the same captured version is idempotent. |
| Finish/stop/cancel generation | No approved Host→Provider durable event contract is established by the source evidence. | Host must distinguish a persisted final version from a partial/cancelled generation according to an owner-approved rule. Provider must not infer delivery or acquisition from capture. |
| Regenerate / create swipe | Provider can retain multiple `version_id` records. | Each new immutable output needs a new durable version ID; old alternatives remain available unless explicitly deleted/revoked. |
| Select swipe | `selectActiveRawVersion()` updates the active pointer. | Selection event must identify the stable version ID. Verify after save/reload that the same version remains selected. |
| Edit message | Provider has no authority to decide whether ST edit is a new immutable version or mutation of an existing source. | **Owner decision required:** prefer a new immutable version with explicit ancestry; do not overwrite historical raw content. Test edit before/after restart and stale old-version invalidation. |
| Delete swipe | `markRawSourceDeleted()` can tombstone an exact version. | Host must capture ID before splice/reindex. Test deletion of first/middle/last swipe and verify neighboring versions keep their identities. |
| Delete message / chat | Provider can tombstone known exact records, not unknown records. | Host must provide complete affected-version inventory. If completeness is not proven, affected records must not be disclosed; no index-based guessing. |
| Switch chat / restart / replay | Provider records and active pointers are durable in SQLite. | Host IDs and active selection must survive reload; replay must be idempotent. Missing/corrupt identity or lineage makes the relevant source unavailable, not empty/current. |
| Copy / branch / import / restore | Provider duplicate/conflict checks apply to supplied keys; they do not define host copy semantics. | **Owner decision required:** specify whether copy preserves or remints logical IDs, how version ancestry is mapped, and how conflicting duplicate IDs are resolved. Same ID with different canonical payload or ambiguous ancestry fails closed. |
| Restore a deleted source | Tombstone is not permanent purge and must not be treated as a simple reversible “undelete” without source proof. | Re-admission requires authoritative evidence that the exact version exists again, approved lineage, and renewed authorization/reconciliation. Otherwise keep it withheld. |

## 5. Deletion, revocation, recovery, and inventory boundaries

- **Tombstone is not erasure.** `markRawSourceDeleted()` is a lifecycle/revocation marker. Permanent physical purge is a separate operation and is not claimed by this mapping.
- **Known dependent copies only.** Current Provider invalidation can affect registered copies. It cannot promise to find unregistered copies, external vector entries, caches, or other stores. No cross-store atomicity is claimed.
- **No implicit undelete.** Recovery after restore/replay must revalidate source existence, version identity, lineage, authorization, and inventory before a tombstoned version can become eligible again.
- **Provider inventory is local.** Provider can enumerate records it has stored and its own index/reconciliation state. It cannot report “complete source inventory” for SillyTavern until Host/Core supply an authoritative inventory or change/reconciliation boundary.
- **No false complete-empty.** Empty results are valid only when the relevant query was authorized and the applicable source/index inventory is proven complete/current. Denied, withheld, partial, stale, unavailable, rebuilding, corrupt lineage, and unresolved source-currentness must remain distinct non-success outcomes.
- **Disclosure-time checks.** Query authorization, per-record authorization, and final disclosure-time revalidation are separate. A final recheck narrows the race but does not create cross-store atomicity or eliminate a race after the check.
- **No semantic overreach.** Capture, persistence, indexing, retrieval, or context inclusion does not prove delivery, receipt, observation, acquisition, or belief by an NPC.

## 6. Required joint acceptance matrix

| Test | Provider responsibility | Host/Core evidence required |
|---|---|---|
| Duplicate replay after restart | Same tuple/payload returns duplicate; no duplicate record. | Stable IDs survive save/load and replay. |
| Same tuple, different payload | Reject conflict; do not overwrite. | Collision policy for branch/import/restore approved. |
| Swipe create/select/delete/reindex | Preserve immutable records; active pointer targets exact version; tombstone only exact deleted version. | Stable version IDs and before-mutation delete evidence; exercise first/middle/last swipe. |
| Edit and message deletion | Keep old history immutable; tombstone only explicitly identified affected versions. | Approved edit-as-new-version rule and complete affected-version list. |
| Branch/copy/import/restore | Reject ambiguous/conflicting identity; no implicit rebind/undelete. | Approved ID remapping and ancestry rules. |
| Index rebuild failure/restart | Raw archive survives; index is non-ready until rebuilt/reconciled. | Host replay and Core reconciliation evidence. |
| Source rollback/version invalidation | Provider denies stale source when trusted validation says stale/unavailable. | Core-owned authoritative source version/validity API and rollback test, including revision change without commit-sequence growth. |
| Source deletion/revocation | Tombstone exact known records; invalidate known dependent copies; fail closed on unknown impact. | Host deletion event plus Core-authorized complete inventory/retraction semantics. |
| Complete-empty vs failure | Never translate denial, partial inventory, stale/rebuilding, or outage to complete-empty. | Trusted completeness/currentness evidence. |
| Disclosure-time revocation race | Revalidate record access at final boundary; no claim of atomicity. | Core/Provider approved revocation contract and real-path race test. |

## 7. Decisions requested from owners

**Host/Adapter**
1. Provide an executable mapping from pinned ST lifecycle operations to durable logical-message/version IDs, including before-mutation deletion capture.
2. Specify ID preservation/remapping for save/load, swipe reorder/delete, chat copy/branch, import/export/restore, and migration of existing chats.
3. Supply exact-head tests and evidence for create/edit/select/delete/cancel/chat switch/restart/replay. Event logs alone are not persistence proof.

**Core**
1. Approve authoritative world/session binding and source identity/version/currentness semantics.
2. Define a complete inventory/reconciliation boundary that catches deletion, rollback, retraction, and changes even when the existing composite snapshot cursor is unchanged in one dimension.
3. Approve source revalidation and disclosure-time revocation semantics; do not treat fixture callbacks as authority.

**Memory Provider**
1. Keep the immutable tuple/idempotency/conflict/tombstone behavior covered by Provider-native tests.
2. Report Provider-local inventory separately from source inventory.
3. Keep summaries and production Memory→NPC disabled until lineage-wide authorization and the real Host→Provider→Core→NPC path are proven.

## 8. Acceptance status

- Provider-side immutable raw identity/version tuple and duplicate/conflict behavior: **implemented in draft; exact branch/CI status must be checked per head**.
- Provider-side active-version selection and exact-version tombstone/known-copy invalidation: **implemented in draft; not a production Host handoff**.
- Host durable logical/version IDs and before-mutation deletion identity: **not yet proven by the pinned ST evidence**.
- Core-approved source version/currentness, complete source inventory/reconciliation, and authoritative final revocation: **blocked**.
- Real Host→Provider capture, restart/replay and full end-to-end acceptance: **not proven**.
- Production Memory→NPC: **DISABLED / FAIL-CLOSED**.

This note deliberately does not introduce field names, APIs, routes, callbacks, schemas, stores, cursors, outboxes, or lifecycle hooks beyond the behavior already present in the draft Provider code. It is a reviewable mapping and decision request, not approval to wire production traffic.
