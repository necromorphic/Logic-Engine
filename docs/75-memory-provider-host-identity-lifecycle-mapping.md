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


## 9. Joint Host + Provider mapping after Core decision (24 Oct 2026)

**Decision source:** Core's conditional approval in [Host issue #258 comment 6388015762](https://github.com/necromorphic/Logic-Engine/issues/258#issuecomment-6388015762). This section is the shared semantic mapping addendum for review alongside the Host evidence in [PR #259](https://github.com/necromorphic/Logic-Engine/pull/259). It does not approve concrete runtime fields or production wiring.

Status labels below are intentionally exact:
- **APPROVED SEMANTIC MAPPING** — Core approved the meaning of the mapping, conditional on trusted Host identity/scope; this is not schema/API approval.
- **PROPOSED CONTRACT** — minimum semantic contract Host + Provider propose for explicit Core review.
- **BLOCKED** — current code/evidence cannot establish the guarantee.

| ST source / event evidence | Provider operation and key | Consequence | Status / required decision |
|---|---|---|---|
| Logical message object; native array index is mutable | captureRawMessage key component message_id | One logical source groups its immutable versions; array position never becomes identity | **APPROVED SEMANTIC MAPPING** for meaning; **PROPOSED CONTRACT** for Host field creation, persistence, migration and collision behavior |
| A swipe/version in swipes[]; native swipe_id is an array position | captureRawMessage key component version_id | Every immutable output has a distinct key; selecting a swipe does not create a new identity | **APPROVED SEMANTIC MAPPING** for meaning; **PROPOSED CONTRACT** for durable Host-owned ID placement/serialization |
| Approved world + conversation scope | world_id, conversation_id in the existing composite Provider key | Prevent silent cross-world/chat rebind | **BLOCKED** until Core approves trusted world/session binding and Host supplies durable conversation identity; names supplied by a caller are not authority |
| Select an existing swipe | selectActiveRawVersion for the exact approved tuple/version | Pointer changes only; alternatives remain retained | **APPROVED SEMANTIC MAPPING**; actual event-to-version handoff remains **BLOCKED** until stable IDs exist |
| Edit an existing message | Candidate: capture a new immutable version_id under the same logical message_id | Preserve prior bytes; link new version to its predecessor | **PROPOSED CONTRACT**; Core + Host + Provider must approve edit-as-new-version and explicit parent-lineage representation. Metadata JSON alone is not lineage proof |
| Delete one swipe/version, identity captured before ST array mutation | markRawSourceDeleted for that exact version | Reversible tombstone; invalidate registered Provider-local dependent copies | **APPROVED SEMANTIC MAPPING**; runtime target capture is **BLOCKED** until Host proves durable IDs and pre-mutation signal |
| Delete whole logical message/chat | Repeated exact-version tombstones only if the complete affected set is authoritatively known | Must retract every retained historical version, not only currently visible swipes | **BLOCKED**: no current Provider method proves exhaustive raw-version enumeration or atomic whole-message deletion |
| Permanent purge | purgeRawSource | Physical deletion only within its documented Provider scope | **APPROVED SEMANTIC DISTINCTION**: never map ordinary ST delete to permanent purge; retention/purge authorization remains separate and unapproved |
| Duplicate event/replay | captureRawMessage with identical composite key/payload; existing tombstone operation for the same exact target | Identical capture is idempotent; same key/different payload conflicts; replay does not silently rebind identity | **APPROVED SEMANTIC MAPPING**, limited to Provider-local behavior and tests at the exact reviewed head; Host replay completeness remains unproven |
| Branch/copy/import/restore and legacy records | No new Provider operation is implied; existing conflict checks apply to supplied keys | Preserve identity only for the same logical source; independent copies need approved remapping; no auto-trust for legacy records | **PROPOSED CONTRACT**; Core + Host approve preservation/remapping/backfill/ancestry rules before capture |
| Restart/replay inventory and whole-source currentness | Existing Provider local enumeration/reconciliation only; reconcile(worldId) concerns canonical-entity records, not completeness of memory_raw_captures | Provider-local row count cannot prove Host-source completeness or missed-event absence | **BLOCKED**: no approved complete/current Host raw-source inventory boundary exists |
| Source currentness, rollback and disclosure-time revocation | Existing Provider validation callbacks are dependency seams, not proof of Core authority | Stale/unknown source and uncertain revocation remain withheld | **BLOCKED** until Core approves a real source-specific revalidation and final disclosure boundary; fixture callbacks are not positive production evidence |

### Minimum concrete contract delta required before implementation

This is the smallest set of owner decisions/evidence needed to turn the semantic mapping into an implementable contract. No field names or APIs are prescribed here.

1. **Host identity and persistence (Host + Core):** choose the persisted location and creation point for logical-message and immutable-version IDs; prove survival through save/load/replay; define migration for old chats and ID collision behavior for branch/copy/import/restore. Host must report the exact before-mutation identity for deletion.
2. **Version lineage and generation completion (Host + Provider + Core):** decide whether edits create immutable new versions; define an explicit predecessor/ancestry representation; define when a generated version is complete versus cancelled/partial. Do not infer lineage from arbitrary metadata or infer completion from event presence alone.
3. **World/conversation binding (Core + Host):** identify the existing authoritative evidence that binds captured data to a Core world/session and a durable conversation. If no verified evidence exists for a source class, classify it unverifiable and fail closed.
4. **Complete inventory/reconciliation (Core + Host; Provider implements only after approval):** specify source domain, consistency boundary, proof of complete enumeration, detection of truncation/pagination/failure/concurrent mutation, and distinction between complete-empty and unavailable/partial. No currently inspected Provider operation proves this for raw ST captures.
5. **Deletion/retraction completeness (Host + Provider + Core):** define exact-version tombstone and the authoritative full affected-version set for whole-message deletion. Repeated delivery must be idempotent; unknown or incomplete affected sets remain withheld. Permanent purge remains a separate retention decision.
6. **Restart, rollback and final disclosure (Core + Provider + Host/disclosure owner):** define what invalidates prior reconciliation, how rollback is detected, and the final authorization/revocation boundary including in-flight disclosure semantics. Currentness flags and injected callbacks alone are insufficient.

### Joint acceptance matrix and evidence classification

| Case | Existing evidence | Acceptance required before production |
|---|---|---|
| Capture duplicate after Provider restart | **FIXTURE-TESTED / Provider-local** in draft tests; not Host-integrated | Real pinned ST event with durable IDs → approved handoff → Provider reopen; exact replay is duplicate |
| Same tuple, different payload | **FIXTURE-TESTED / Provider-local** conflict test | Real adapter collision is rejected; no overwrite/rebind |
| Create/select/delete swipe and reindex | **SOURCE-INSPECTED** in pinned ST; limited event families **RUNTIME-OBSERVED** in existing samples | **NOT TESTED**: persisted IDs before/after on Android/Termux, pre-mutation exact target, restart persistence |
| Edit and parent lineage | **SOURCE-INSPECTED**; no durable prior/next revision relation established | **NOT TESTED**: approved immutable revision + predecessor survives reload and is validated |
| Delete whole message/chat | **SOURCE-INSPECTED**: current event does not identify deleted object; Provider cannot prove complete version set | **NOT TESTED / BLOCKED** until complete affected-version inventory is available and all tombstones survive restart |
| Cancel/stop/regenerate | Existing events are insufficient to prove final persisted version and lineage | **NOT TESTED**: incomplete output is excluded; completed regeneration has a distinct durable version and approved ancestry |
| Branch/copy/import/restore/legacy | No complete collision/backfill proof | **NOT TESTED**: preservation vs remapping is explicit; ambiguous ancestry and legacy IDs fail closed |
| Complete inventory/restart/replay/rollback | Provider local reconciliation only; no raw Host inventory authority | **NOT TESTED / BLOCKED** until approved source inventory boundary detects omitted events, partial enumeration, concurrent mutation and rollback |
| Revocation at final disclosure | Provider/Core seams and tests narrow selected races but do not establish cross-store atomicity | **NOT TESTED / BLOCKED** until Core selects a realizable final-boundary guarantee and real-path race tests pass |

Evidence labels mean: **SOURCE-INSPECTED** = code path read, not executed; **FIXTURE-TESTED** = test uses controlled/injected inputs and proves only that component; **RUNTIME-OBSERVED** = actual host event shape seen in the cited samples; **REAL-RUNTIME-TESTED** = persisted before/after behavior reproduced against the pinned Android/Termux install. No row above claims a new real-runtime test.

### Current joint verdict

Core has approved the **semantic direction**, not a concrete runtime contract. Existing Provider operations can implement immutable capture, active-version pointer changes, exact-version tombstones, duplicate replay and collision rejection once trusted IDs/scope are supplied. They cannot create Host identity, prove ancestry, identify a deleted object from a post-splice index, prove the complete set of historical versions, or establish a complete/current Host inventory.

**Next step:** Host + Provider owners review this same mapping and resolve items 1–6 above, then ask Core to approve the concrete delta before any cross-boundary implementation. Continue Provider-local tests and Host source/runtime evidence gathering independently. Until then, production Memory→NPC remains **DISABLED / FAIL-CLOSED**; no vectorization changes.
