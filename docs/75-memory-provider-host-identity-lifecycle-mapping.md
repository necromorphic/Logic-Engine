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


## 10. Provider audit of the six minimum contract-delta items

**Audit basis:** current Provider draft code/tests, pinned Host source evidence, and Core decision comment 6388016376. This is an evidence/ownership audit, not implementation approval. No runtime, API, field, schema, store, cursor, or cross-block wiring is authorized here.

| # | Minimum delta | Owner | What existing Provider code/tests can close now | Missing evidence / decision | Status |
|---|---|---|---|---|---|
| 1 | Host identity and persistence | **Host** creates/persists IDs and captures delete identity; **Core** approves identity/scope semantics; **Provider** persists supplied tuple | Provider can reject missing tuple parts and enforce same-key/same-payload idempotency plus same-key/different-payload conflict. These tests only start after an identity is supplied. | No pinned Android/Termux save/load/replay proof for Host-owned logical-message/version IDs; no approved legacy migration or branch/copy/import/restore collision policy; no pre-mutation delete target proof. Core must approve semantic rules before Host selects field placement/serialization. | **PARTIAL: Provider subrules covered; cross-block item blocked** |
| 2 | Version lineage and generation completion | **Host** observes lifecycle and supplies predecessor identity/completion facts; **Provider** preserves immutable versions; **Core** approves lineage and complete-vs-partial semantics | Distinct immutable keys and active-pointer switching are implemented/tested Provider-locally. | No typed/validated parent relation in the accepted contract; no approved rule for edit-as-new-version or cancelled/partial generation; no real lifecycle test through regenerate/restart. Core decision required before implementation. | **PARTIAL: storage behavior covered; semantics blocked** |
| 3 | Trusted world/conversation binding | **Core** owns authority and binding rules; **Host** supplies verified binding/durable conversation identity; **Provider** enforces approved scope | Provider isolates records by supplied composite-key values and has Provider-local scope tests. | Caller-supplied IDs do not prove authority. No proof binds the captured ST chat to the intended Core world/session through rename, switch, copy/import/restore/replay. Core must define authoritative evidence and fail-closed behavior. | **BLOCKED on Core + Host proof** |
| 4 | Complete inventory/reconciliation | **Core** defines source domain, completeness/currentness proof and consistency boundary; **Host** supplies authoritative complete enumeration/change evidence; **Provider** implements only after approval | Existing tests cover incomplete/unavailable injected inventory, partial results, interrupted reconciliation/restart, index rebuild failure and non-ready behavior. They prove correct fail-closed handling of the test input, not completeness of the source. | No production-capable proof of complete/current `memory_raw_captures` inventory after restart/replay; no detection guarantee for omitted events, truncated pages, concurrent mutation or rollback; no authoritative complete-empty distinction. Core must approve evidence semantics and invalidation rules. | **BLOCKED on Core decision + Host evidence** |
| 5 | Deletion/retraction completeness | **Host** captures exact pre-mutation target and complete whole-message affected set; **Provider** owns exact tombstone/idempotency/known-copy invalidation; **Core** approves affected-set authority and cross-store guarantee | Exact-version tombstone, repeated tombstone, original-capture replay non-resurrection, known dependent-copy invalidation across Provider restart, and final Provider read recheck have tests at code/test HEAD `0c7b4abd8a5b3547304f452380b310bb155aeb52`, CI #1784 290/290. | ST's post-splice delete event does not identify the deleted object; no authoritative exhaustive historical-version set for message/chat deletion; other stores/caches are outside Provider transaction. Core must approve completeness and scope of retraction guarantee. Purge remains separate. | **PARTIAL: exact-version Provider behavior covered; whole-source retraction blocked** |
| 6 | Restart, rollback and final disclosure/revocation | **Core** owns source currentness, rollback/replay invalidation and required final-boundary semantics; **Provider** owns durable local state/rechecks; **Host/disclosure owner** supplies lifecycle and real-path evidence | Provider restart persistence, fail-closed validator/inventory failures, tombstone during final Provider read authorization check, and non-ready behavior have Provider-local tests. | Local recheck is not cross-store atomicity. No approved source-specific rollback/retraction contract or real Host→Provider→Core→NPC race test; no Core decision on exact final disclosure point and accepted post-check race limits. | **PARTIAL: local checks covered; end-to-end guarantee blocked** |

### Direct answer: what is and is not closable without Core

**Closable now by existing Provider code/tests, without changing contracts:**
- Immutable raw tuple duplicate replay and conflicting-payload rejection.
- Active-version pointer switch without deleting alternatives.
- Exact-version tombstone and repeated-tombstone behavior.
- Replay of the original identical capture does not resurrect a tombstoned source.
- Invalidation of registered Provider-local dependent copies and persistence of that state across Provider restart.
- Fail-closed response when supplied source/inventory validation is incomplete, unavailable, stale or fails.
- Provider-local final-read authorization recheck when revocation is observed at that check.

Evidence for the newest tombstone/replay/final-check regressions: code/test HEAD `0c7b4abd8a5b3547304f452380b310bb155aeb52`, Runtime CI #1784, 290/290. This is Provider-local evidence only.

**Not closable by Provider-local code/tests alone; explicit Core decision and/or Host proof required:**
- The Host's durable identity placement, creation, persistence, migration and collision rules.
- Parent/version ancestry and completed-vs-cancelled generation semantics.
- Authoritative world/session/conversation binding.
- Complete/current raw Host-source inventory and a consistent reconciliation boundary.
- Exhaustive historical version set for whole-message/chat deletion and the authority of that set.
- Rollback/replay invalidation and the cross-block final disclosure/revocation guarantee, including accepted race limits.
- Real pinned Android/Termux Host capture → Provider persistence → restart/reconciliation → Core-authorized read → NPC admission → disclosure acceptance.

**No entire one of the six contract-delta items is fully closed.** Provider-local sub-behaviors are covered as listed; all six still have a cross-block dependency or missing authoritative evidence.

### Exact contract submitted for Core decision

The six semantic rules proposed for approval are:

1. **Identity:** one durable Host-owned ID per logical message and a distinct durable ID per immutable version; never derive identity from indexes, timestamps, native swipe positions or generation metadata; capture exact deletion identity before mutation.
2. **Versioning:** selecting a version only changes the active pointer. Editing-as-new-immutable-version, predecessor lineage and the definition of completed versus cancelled/partial output require explicit approval; lineage cannot be inferred from arbitrary metadata.
3. **Scope/authority:** the Provider composite key is a storage key, not authority. Core defines authoritative world/session binding; Host supplies durable conversation binding; absent or ambiguous binding is withheld.
4. **Inventory/currentness:** currentness is accepted only from an authoritative, complete, consistent inventory/reconciliation proof for a defined source scope. Partial, truncated, failed, concurrently invalidated, stale or unverifiable results are non-ready; complete-empty is distinct from denied/unavailable/partial. Core defines the proof and invalidation/rollback rule.
5. **Retraction:** exact-version deletion is an idempotent tombstone of that version. Whole-message/chat deletion is allowed only with an authoritative complete set of all affected historical versions. Unknown/incomplete sets remain withheld. Permanent purge is a separate retention action.
6. **Disclosure boundary:** source/version/lineage and inventory authorization must be revalidated at the approved final disclosure point. Revocation observed before that point prevents disclosure. Core must specify the final point and explicitly accept the residual race/consistency limits after the last check; Provider-local checks must not be described as cross-store atomicity.

### Verifiable acceptance criteria after Core approval

- On the pinned Android/Termux ST build, exercise create, two swipes, select each, edit, regenerate, cancel/stop, delete one swipe, delete a whole message, chat switch, save/load, restart, replay, branch/copy/import/restore. IDs and ancestry remain unambiguous; no index is used as identity. Record persisted before/after evidence.
- Provider restart/replay: identical tuple/payload creates no duplicate; same tuple with different payload conflicts without overwrite/rebind; repeated tombstone and original capture replay do not resurrect a deleted version; tombstone and known-copy invalidation survive restart.
- In-flight read: if revocation is observed at the Core-approved final authorization point, no content is returned. Exercise the approved race semantics through the real path, not only injected Provider fixtures.
- Inventory: prove complete-empty differs from unavailable/denied/partial; detect omitted/truncated enumeration and concurrent mutation; interrupt/restart reconciliation; prior currentness is invalidated on rollback/retraction.
- Whole-message/chat deletion: enumerate and tombstone every historical version, including inactive swipes, and verify all dependent-copy invalidation within the explicitly declared store boundary. Incomplete enumeration fails closed.
- Full vertical slice: pinned ST capture → durable Provider persistence → restart/reconciliation → Core-authorized source/version/lineage read → NPC admission → final disclosure boundary. Label each case SOURCE-INSPECTED, FIXTURE-TESTED, RUNTIME-OBSERVED or REAL-RUNTIME-TESTED accurately.

**Request to Core:** approve/revise the six semantic rules and explicitly choose (a) authoritative inventory/currentness evidence and invalidation semantics and (b) final disclosure/revocation point plus accepted race limits. After that decision, Host + Provider will submit the concrete field/API/schema proposal for explicit review. Until then, no cross-block implementation; production Memory→NPC remains **DISABLED / FAIL-CLOSED**, and vectorization is untouched.


## 11. Single Host + Memory contract submitted for Core review (24 Oct 2026)

**Purpose:** one review artifact, not two competing Host/Provider tables. This section binds the proposed semantics to existing code and names the owner, the evidence that exists, and the executable test that must pass. It authorizes **no implementation** of new ST fields, API, schema, store, route, cursor, outbox, or runtime wiring. Core must approve or revise this contract first.

### 11.1 Existing code anchors (not proposed API names)

| Concern | Existing code/evidence anchor | What it actually proves | Owner |
|---|---|---|---|
| ST message/swipe lifecycle | Pinned ST commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`; `public/script.js` swipe storage/selection and generation dispatch; `public/scripts/events.js`; `public/scripts/slash-commands.js`; `public/scripts/group-chats.js`. Host evidence is in [docs/27-host-adapter-lifecycle-evidence.md](https://github.com/necromorphic/Logic-Engine/blob/docs/host-adapter-st-lifecycle-evidence/docs/27-host-adapter-lifecycle-evidence.md). | Current event payloads include mutable array positions; swipe-delete and message-delete events do not provide approved durable source identity; save/reload/replay persistence is not proven. | Host |
| Raw immutable capture | Provider draft `captureRawMessage()`, `tests/memory-provider-raw-archive.test.js`, PR [#201](https://github.com/necromorphic/Logic-Engine/pull/201). | Provider can persist a supplied tuple, treat exact replay as duplicate, and reject same-key/different-payload conflicts. It cannot authenticate that tuple as a Host source identity. | Provider |
| Active version | Provider draft `selectActiveRawVersion()`, raw archive tests. | Changes the active pointer while retaining alternatives; does not prove Host selection event identity or source currentness. | Provider + Host |
| Exact-version deletion | Provider draft `markRawSourceDeleted()`, raw archive tests. | Tombstones the supplied exact version and invalidates registered Provider-local dependent copies. Does not identify the ST deletion target or enumerate all historical versions. | Host supplies target; Provider applies; Core approves authority/completeness |
| Permanent purge | Provider draft `purgeRawSource()`, raw archive tests. | Provider-scope physical purge is distinct from normal ST deletion. It does not establish cross-store erasure. | Provider + retention owner; separate approval |
| Provider currentness/reconciliation | Provider draft SQLite reconciliation and injected `getSnapshot`, `validateSourceVersion`, `validateInventory` dependencies in PRs #182/#201. | Tests prove fail-closed handling of supplied callback outcomes; callbacks/fixtures are not production authority and Provider reconciliation is not a complete ST-source inventory. | Core defines proof; Host supplies source evidence; Provider implements after approval |
| Core→NPC admission | Core's existing `MemoryNpcConsumer`/authorized-read seam and NPC fail-closed admission helper; see Core issue [#140](https://github.com/necromorphic/Logic-Engine/issues/140). | In-process seam can deny/non-ready on injected failures; does not prove Host source identity, full inventory, or final cross-store disclosure guarantee. | Core owns authorization and boundary; NPC consumes only authorized results |

### 11.2 Contract proposal for approval

The following are **normative semantic requirements**. They are not field names, request shapes, or permission to code the integration.

1. **Identity and persistence.** Host owns one durable identity for each logical message and a distinct durable identity for every immutable version/swipe. Both must survive save/load, selection, reindex, restart and replay. Native indexes, timestamps, swipe positions, chat labels and generation metadata are not identities. The exact persisted representation and legacy migration are a Core-reviewed follow-up, not presumed here.
2. **Version lifecycle.** A new immutable output gets a new version identity; selecting an existing output changes only the active pointer. An edit must preserve prior bytes and have explicit predecessor/ancestry evidence. A generated output is eligible only after the agreed completion condition; cancellation/partial output is not silently treated as complete. Core must approve edit and completion semantics before implementation.
3. **Scope binding.** The Provider's existing composite key `(world_id, conversation_id, message_id, version_id)` remains a draft storage key, not the approved wire schema or authority. Core defines trusted world/session binding; Host proves durable conversation identity and passes the binding without substitution. Missing or ambiguous binding is withheld.
4. **Capture handoff.** After identity and scope are approved, Host capture maps to existing Provider `captureRawMessage()`; exact replay is idempotent and payload collision fails. No new public route is implied. The concrete invocation boundary must be reviewed against the actual Provider branch before a runtime caller is added.
5. **Selection/deletion.** Selection maps to `selectActiveRawVersion()` for the exact identity. Single-version deletion maps to `markRawSourceDeleted()` using identity captured before ST mutation. Whole-message/chat deletion requires an authoritative complete set of every historical version, including inactive alternatives. Ordinary deletion never maps to `purgeRawSource()`.
6. **Inventory/currentness.** Provider may report its own stored-record/index status, but must not call it complete Host inventory. Core must define the authoritative source domain, completeness proof, consistency boundary, and invalidation on missed events, partial enumeration, concurrent mutation, restart/replay, restore, rollback and retraction. Complete-empty must be distinguishable from denied, unavailable, partial, stale and rebuilding.
7. **Disclosure/revocation.** Core defines the final authorization point and the accepted race semantics. If revocation is observed at that approved point, content is withheld. Provider's second read authorization check is only a local check; no cross-store atomicity is claimed. Retrieval or context inclusion does not imply delivery, receipt, acquisition or belief.
8. **Failure policy.** Unknown ID, conflicting payload, ambiguous lineage/scope, incomplete inventory, source-validator outage, stale/unverifiable source, interrupted reconciliation or unresolved deletion impact yields rejection/non-ready/withheld—not a fabricated identity, guessed deletion, or successful empty result.

### 11.3 Concrete owners and closure evidence

| Deliverable | Accountable owner(s) | Required evidence before marking accepted |
|---|---|---|
| Persisted logical-message and per-version identity, migration and copy/import/restore rules | Host accountable; Core approves semantics | Pinned Android/Termux test artifacts show IDs before/after save/load/restart, swipe selection/reorder/delete, edit/regenerate, branch/copy/import/restore; collision and legacy cases are explicit. |
| Edit ancestry and completion/cancellation semantics | Host supplies observed lifecycle; Provider preserves immutable versions; Core approves rule | Executable test proves predecessor chain survives reload; partial/cancelled output is not admitted as complete; regenerated output gets a distinct identity. |
| Trusted world/session and conversation binding | Core accountable for authority; Host for mapping | Positive and negative tests for correct world/chat, chat switch, rename, copy/import/restore; caller-supplied labels alone cannot authorize. |
| Provider persistence/idempotency/tombstones | Provider | Existing raw archive tests plus exact-head CI; restart test for duplicate replay, collision, repeated tombstone, non-resurrection and registered-copy invalidation. |
| Complete/current source inventory and reconciliation | Core accountable for contract; Host supplies authoritative enumeration/change evidence; Provider implements approved algorithm | Executable complete-empty/unavailable/partial tests; omission/truncation and concurrent-mutation detection; interrupted reconciliation + restart; rollback/retraction invalidates previous currentness. |
| Whole-message/chat deletion | Host provides exact complete affected set; Provider tombstones each version; Core approves completeness/authority | Test deletes a message with multiple swipes including inactive versions; every historical version is withheld after restart; deliberately incomplete enumeration fails closed. |
| Final disclosure/revocation boundary | Core accountable; Provider implements local checks; Host/disclosure path participates | Race test on the real Host→Provider→Core→NPC path: revoke before approved final point and assert no bytes are returned/disclosed. Document and test the explicitly accepted race after that point. |
| End-to-end vertical slice | Host + Provider + Core + NPC owners | Pinned ST capture → durable Provider persistence → process restart/replay → complete reconciliation → Core-authorized read with source/version/lineage revalidation → NPC admission → final disclosure check. No fixture callback may stand in for production authority. |

### 11.4 Executable acceptance sequence

Run against pinned ST `06bde939fb1e9c4c8d8641d810f0a916b5bce127` on Android/Termux and the actual PC-hosted Logic-Engine process. Record source commit, test command/run, before/after persisted data, and evidence class for each case.

1. **Create/replay:** create one message/version; capture it; restart Provider and ST; replay the same event. Expect exactly one immutable record and no identity change.
2. **Conflict:** replay the same identity with different role/content/metadata. Expect explicit conflict; original bytes remain unchanged.
3. **Swipe:** create at least three versions; select each; delete the middle version; reindex; restart. Expect each surviving version to retain identity, active selection to target the same version, and only the selected deletion target to be tombstoned.
4. **Edit/regenerate/cancel:** edit and regenerate; stop/cancel a generation mid-stream; restart. Expect old bytes preserved, each completed output distinctly identified and linked by approved ancestry, and incomplete output excluded under the approved completion rule.
5. **Whole-message/chat deletion:** delete a logical message with multiple historical/inactive versions and then a chat. Expect every affected version to be enumerated and withheld after restart. If enumeration is incomplete, expect non-ready and no disclosure.
6. **Copy/import/restore/legacy:** execute each operation under the approved preserve/remap rule. Expect no cross-chat/world rebind, no identity collision, no implicit resurrection of a tombstoned source, and ambiguous legacy lineage withheld.
7. **Inventory/reconciliation:** inject a missing event, truncated page, concurrent mutation, restart during reconciliation and rollback/retraction. Expect the prior current marker to be invalidated; complete-empty is returned only with authoritative proof of complete/current inventory.
8. **Authorization race:** revoke/tombstone after candidate discovery but before the Core-approved final disclosure point. Expect no content returned. Also test validator outage/stale version and ensure they cannot become ready-empty.
9. **End-to-end:** run all applicable cases through actual Host capture, Provider durable storage, Core source/inventory authorization and NPC admission. Verify no content/snippet/count leaks on any non-ready result.

**Pass condition:** all required cases pass on the approved exact contract; every source identity, lineage, inventory and revocation claim has evidence at its owning boundary; no required case is satisfied solely by source inspection or injected fixtures. Any unresolved case keeps production Memory→NPC **DISABLED / FAIL-CLOSED**.

### 11.5 Core review decisions requested

Core is asked to respond to this single contract with **APPROVE**, **APPROVE WITH CONDITIONS** (list each condition and owner), or **REJECT** (identify the exact conflicting rule), and explicitly decide:

- whether the eight semantic requirements above are accepted;
- the authoritative evidence for world/session binding and source-version/currentness;
- the complete/current inventory and rollback/reconciliation guarantee;
- edit ancestry and complete-vs-cancelled generation semantics;
- the whole-message affected-version completeness rule;
- the final disclosure point and accepted post-check race limits.

Only after that recorded review may Host + Provider submit concrete field placement and any required API/schema diff for a second explicit review. Until then, this contract is documentation only: no new API/schema or cross-block implementation; production Memory→NPC remains **DISABLED / FAIL-CLOSED**; vectorization remains untouched.
