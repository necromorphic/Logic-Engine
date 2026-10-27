# Memory Provider ↔ Host/Adapter identity and lifecycle mapping

**Owner:** Memory Provider  
**Related:** [Provider issue #181](https://github.com/necromorphic/Logic-Engine/issues/181), [Core gate #140](https://github.com/necromorphic/Logic-Engine/issues/140), [Host/Adapter evidence PR #295](https://github.com/necromorphic/Logic-Engine/pull/295), [Provider SQLite PR #182](https://github.com/necromorphic/Logic-Engine/pull/182), [Provider lifecycle PR #201](https://github.com/necromorphic/Logic-Engine/pull/201).  
**Current status (2026-10-25):** Provider-local raw archive and lifecycle safeguards are present in current `main` at `9ca95312b35d6431699d736aef721602d26639f8`; Runtime CI run #2030 passed (592/592 repository tests and 8/8 oracle-harness tests; [run #2030](https://github.com/necromorphic/Logic-Engine/actions/runs/40203468760)). The code/tests prove Provider-local persistence, tombstone, reconciliation, and revocation behavior only. This remains a mapping proposal, not an approved cross-block schema or production handoff. Production Memory→NPC remains **DISABLED / FAIL-CLOSED**.

**Historical evidence below:** branch/head/CI references are retained as dated audit history where explicitly labeled; they must not be read as the current merge state.

## 1. Decision boundary

Core’s direction A requires a durable logical-message identity and a distinct durable identity for each immutable message version/swipe. The Host/Adapter evidence for pinned SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127` documents that current native message indexes and swipe array positions are mutable, and native lifecycle events do not carry durable before/after version IDs.

Provider can persist a supplied identity tuple and enforce its own duplicate/conflict/tombstone rules. Provider cannot certify that a supplied ID is authentic, current, complete, correctly world-bound, or derived from a particular SillyTavern source. Those are Host/Adapter and Core contracts still requiring owner approval.

The following labels are used throughout:
- **EXISTS (current main, Provider-local):** executable behavior in the current-main Provider-local implementation branch, not necessarily merged or production-wired.
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

- Provider-side immutable raw identity/version tuple and duplicate/conflict behavior: **implemented in current main and covered by Provider-local tests; not a production Host handoff**.
- Provider-side active-version selection and exact-version tombstone/known-copy invalidation: **implemented in draft; not a production Host handoff**.
- Host durable logical/version IDs and before-mutation deletion identity: **not yet proven by the pinned ST evidence**.
- Core-approved source version/currentness, complete source inventory/reconciliation, and authoritative final revocation: **blocked**.
- Real Host→Provider capture, restart/replay and full end-to-end acceptance: **not proven**.
- Production Memory→NPC: **DISABLED / FAIL-CLOSED**.

This note deliberately does not introduce field names, APIs, routes, callbacks, schemas, stores, cursors, outboxes, or lifecycle hooks beyond the behavior already present in the current-main Provider code. It is a reviewable mapping and decision request, not approval to wire production traffic.


## 9. Joint Host + Provider mapping after Core decision (24 Oct 2026)

**Decision source:** Core's conditional approval in [Host issue #258 comment 6388015762](https://github.com/necromorphic/Logic-Engine/issues/258#issuecomment-6388015762). This section is the shared semantic mapping addendum for review alongside the Host evidence in [PR #295](https://github.com/necromorphic/Logic-Engine/pull/295). It does not approve concrete runtime fields or production wiring.

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
| Capture duplicate after Provider restart | **FIXTURE-TESTED / Provider-local** in current-main tests; not Host-integrated | Real pinned ST event with durable IDs → approved handoff → Provider reopen; exact replay is duplicate |
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

**Audit basis:** current-main Provider-local code/tests (current status summarized at the top), pinned Host source evidence, and Core decision comment 6388016376. This is an evidence/ownership audit, not implementation approval. No runtime, API, field, schema, store, cursor, or cross-block wiring is authorized here.

| # | Minimum delta | Owner | What existing Provider code/tests can close now | Missing evidence / decision | Status |
|---|---|---|---|---|---|
| 1 | Host identity and persistence | **Host** creates/persists IDs and captures delete identity; **Core** approves identity/scope semantics; **Provider** persists supplied tuple | Provider can reject missing tuple parts and enforce same-key/same-payload idempotency plus same-key/different-payload conflict. These tests only start after an identity is supplied. | No pinned Android/Termux save/load/replay proof for Host-owned logical-message/version IDs; no approved legacy migration or branch/copy/import/restore collision policy; no pre-mutation delete target proof. Core must approve semantic rules before Host selects field placement/serialization. | **PARTIAL: Provider subrules covered; cross-block item blocked** |
| 2 | Version lineage and generation completion | **Host** observes lifecycle and supplies predecessor identity/completion facts; **Provider** preserves immutable versions; **Core** approves lineage and complete-vs-partial semantics | Distinct immutable keys and active-pointer switching are implemented/tested Provider-locally. | No typed/validated parent relation in the accepted contract; no approved rule for edit-as-new-version or cancelled/partial generation; no real lifecycle test through regenerate/restart. Core decision required before implementation. | **PARTIAL: storage behavior covered; semantics blocked** |
| 3 | Trusted world/conversation binding | **Core** owns authority and binding rules; **Host** supplies verified binding/durable conversation identity; **Provider** enforces approved scope | Provider isolates records by supplied composite-key values and has Provider-local scope tests. | Caller-supplied IDs do not prove authority. No proof binds the captured ST chat to the intended Core world/session through rename, switch, copy/import/restore/replay. Core must define authoritative evidence and fail-closed behavior. | **BLOCKED on Core + Host proof** |
| 4 | Complete inventory/reconciliation | **Core** defines source domain, completeness/currentness proof and consistency boundary; **Host** supplies authoritative complete enumeration/change evidence; **Provider** implements only after approval | Existing tests cover incomplete/unavailable injected inventory, partial results, interrupted reconciliation/restart, index rebuild failure and non-ready behavior. They prove correct fail-closed handling of the test input, not completeness of the source. | No production-capable proof of complete/current `memory_raw_captures` inventory after restart/replay; no detection guarantee for omitted events, truncated pages, concurrent mutation or rollback; no authoritative complete-empty distinction. Core must approve evidence semantics and invalidation rules. | **BLOCKED on Core decision + Host evidence** |
| 5 | Deletion/retraction completeness | **Host** captures exact pre-mutation target and complete whole-message affected set; **Provider** owns exact tombstone/idempotency/known-copy invalidation; **Core** approves affected-set authority and cross-store guarantee | Exact-version tombstone, repeated tombstone, original-capture replay non-resurrection, known dependent-copy invalidation across Provider restart, and final Provider read recheck have tests at historical code/test HEAD `0c7b4abd8a5b3547304f452380b310bb155aeb52`, CI #1784 290/290; current-main lifecycle coverage was extended in #313. | ST's post-splice delete event does not identify the deleted object; no authoritative exhaustive historical-version set for message/chat deletion; other stores/caches are outside Provider transaction. Core must approve completeness and scope of retraction guarantee. Purge remains separate. | **PARTIAL: exact-version Provider behavior covered; whole-source retraction blocked** |
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

Historical evidence for tombstone/replay/final-check regressions: code/test HEAD `0c7b4abd8a5b3547304f452380b310bb155aeb52`, Runtime CI #1784, 290/290. Current-main provider lifecycle safeguards are summarized at the top. This is Provider-local evidence only.

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


## 11. Concrete Host + Provider contract proposal for Core review (24 Oct 2026)

**Purpose:** submit one exact, source-grounded proposal after Core decision #140. This section supersedes the earlier “next step: prepare a concrete proposal” wording above. It is still a proposal, not implementation authorization. The canonical mapping remains this document; Host evidence is maintained only in [docs/27-host-adapter-lifecycle-evidence.md](https://github.com/necromorphic/Logic-Engine/blob/docs/host-adapter-st-lifecycle-evidence/docs/27-host-adapter-lifecycle-evidence.md). No runtime code, field, API, schema, store, journal, cursor, outbox, or cross-block wiring is changed by this commit.

### 11.1 Proposed contract (review each row as ACCEPT / REJECT / REVISE)

| Contract point | Exact proposal | Existing code anchor | Owner | Failure behavior before approval |
|---|---|---|---|---|
| Logical-message identity | One persistent ID on each logical ST message object; independent of chat-array index. Candidate placement: `message.logic_engine_message_id`. Generate once at logical-message creation; preserve on ordinary save/load of the same source. | Pinned ST `public/script.js`: user/assistant message construction; `public/scripts/group-chats.js`: group greeting and group message path; `public/scripts/slash-commands.js`: slash-command insertion. See Host evidence links below. | Host implements creation/serialization; Core approves semantics and migration; Provider consumes only approved IDs. | Missing/duplicate/ambiguous ID => source NON_READY; never derive from index, timestamp, content hash, or `extra.gen_id`. |
| Immutable version identity | One persistent ID per separately selectable immutable swipe/version, stored with its `swipe_info[i]` entry. Candidate placement: `message.swipe_info[i].logic_engine_version_id`. Selecting a swipe changes only `message.swipe_id`; resolve identity through the selected metadata entry. | `public/script.js::saveReply()`; `ensureSwipes()`; existing `swipes[]`, parallel `swipe_info[]`, and `swipe_id`. | Host creates/persists; Core approves; Provider uses as existing `version_id` component. | Missing or mismatched metadata-to-swipe identity => NON_READY; do not infer from array position. |
| Edit and ancestry | Treat an edit as a new immutable version under the same logical-message ID; candidate predecessor placement: `message.swipe_info[i].logic_engine_parent_version_id`. Capture prior version before text mutation. Do not overwrite archived prior raw content. | `public/script.js::messageEditDone()` currently calls `updateMessage(div)` before `MESSAGE_EDITED`; a post-event listener cannot reliably recover the before-state. | Host owns pre-mutation capture; Core + Host + Provider approve ancestry semantics and representation. | Until a pre-mutation capture and persisted parent are proven, edited source is NON_READY for ingestion. No ancestry inference from timestamps, adjacent slots, generation events, or arbitrary metadata. |
| Generation completion | Only a persisted, completed output becomes an ordinary eligible immutable version. Stop/cancel/partial output is not silently classified as complete; any future partial-output semantics require a separate explicit decision. | Pinned ST generation/save paths and their event ordering; see Host source matrix. | Host supplies completion/persistence evidence; Core approves semantic distinction; Provider stores only approved captures. | Ambiguous finish/stop/cancel or failed save => no ready capture. Event emission alone is not a durable-commit signal. |
| Delete one version | Capture the target version ID before either swipe-array splice; then request an exact-version tombstone. | `public/script.js::deleteSwipe()`: target and `swipe_info[swipeId]` exist before `message.swipes.splice()` and `message.swipe_info.splice()`. Existing Provider operation: `markRawSourceDeleted()`. | Host captures exact target; Provider tombstones that tuple and invalidates registered Provider-local copies; Core approves source authority. | Unknown target or post-splice-only evidence => no tombstone success claim; scope remains NON_READY. |
| Delete whole message/chat | Before the first message splice, capture the logical ID and all retained version IDs for every affected message. This list is not exhaustive for versions previously physically removed from ST. Therefore whole-message/chat retraction is **not admissible** unless an authoritative source inventory proves the exhaustive historical set. | `public/script.js::deleteMessage()` splices before `MESSAGE_DELETED`; current event payload is not a durable deleted-object identity. Existing Provider operation is exact-version `markRawSourceDeleted()`; no approved atomic whole-message operation exists. | Host supplies exhaustive affected set; Provider applies exact tombstones; Core approves completeness/authority. | If any historical version is unknown, whole-source deletion is NON_READY/incomplete; never claim all versions retracted. |
| Provider persistence and duplicate semantics | Use the existing Provider draft contract only after approval: composite key `(world_id, conversation_id, message_id, version_id)`; identical tuple+payload replay is idempotent; same tuple with conflicting payload is rejected; a tombstoned version cannot be resurrected by replay; active selection preserves alternatives. | Provider raw archive: `captureRawMessage()`, `selectActiveRawVersion()`, `markRawSourceDeleted()`, `purgeRawSource()`; tests in `tests/memory-provider-raw-archive.test.js`. | Provider owns local storage behavior; Host must prove supplied tuple authenticity/persistence; Core approves scope and source semantics. | Existing draft tests do not authorize production wiring. Missing scope/identity or conflict => reject/withhold. Ordinary delete is a tombstone, not `purgeRawSource()`. |
| World/session and conversation binding | Core must name the existing authoritative evidence that binds each captured source to a world/session and durable conversation. A caller-supplied `world_id`, chat name, filename, character ID, or group ID is not sufficient authority by itself. | Existing Provider composite key includes `world_id` and `conversation_id`; pinned ST load paths `getChat()` and group-chat load/save do not prove Core-authorized binding across copy/import/restore. | Core defines authority; Host supplies evidence and stable conversation identity; Provider enforces the approved scope. | Missing, denied, or ambiguous binding => NON_READY. No silent rebinding. |
| Complete inventory/currentness | Inventory must cover the declared Host source domain for the bound scope, including inactive versions and deleted/retracted identities; establish complete enumeration and a consistent source state; distinguish complete-empty from unavailable/denied/partial/unknown. Any rollback, restore, branch/import replacement, suspected omitted event, unexplained set mismatch, or concurrent mutation invalidates readiness until a fresh authoritative full reconciliation succeeds. | Current ST chat JSON contains only retained objects; swipe/message deletion physically splices objects. Current events have no completeness guarantee. Provider `reconcile(worldId)` / injected `validateInventory` concerns Provider canonical-entity records, not completeness of raw ST captures. | Core defines proof and invalidation rules; Host must identify/prove an existing authoritative inventory source; Provider may consume it only after approval. | **No qualifying source is currently established.** No new journal/cursor/store/API is presumed. Therefore the contract is NON_READY and production ingestion remains blocked until Core approves a concrete evidence mechanism and Host demonstrates it. |
| Final disclosure/revocation | Revalidate the exact source versions, lineage, scope, inventory readiness, and authorization at the actual final serialization/disclosure boundary—after asynchronous reads and candidate assembly. If revocation/tombstone/scope change/stale snapshot/non-ready is observed before that boundary, cancel and return no content, snippet, or diagnostic count. | Provider final raw-read authorization recheck exists in draft tests; no current evidence identifies a production Host→Provider→Core→NPC serialization boundary wired to this source. Provider-local checks do not make cross-store access atomic. | Core defines required semantics and accepted race limits; Provider owns its local check; Host/NPC disclosure owner must identify and test the real final serialization call. | No demonstrated final boundary or bounded race guarantee => no disclosure path is enabled. Do not describe Provider read-time recheck or NPC admission as final authorization. |

### 11.2 Proposed candidate placement in pinned SillyTavern (not approved fields)

The candidate names above are deliberately concrete so Core can accept/reject exact placement; they must not be added before approval.

- `message.logic_engine_message_id`: on the logical message object, not a DOM element or index.
- `message.swipe_info[i].logic_engine_version_id`: on the metadata entry corresponding to the immutable `swipes[i]` version.
- `message.swipe_info[i].logic_engine_parent_version_id`: predecessor reference only if Core approves edit-as-new-version and the required lineage semantics.
- No additional active-version field: existing `message.swipe_id` remains an array-position pointer and resolves to the selected version's durable ID.
- No Host field is proposed for world/session authority; that must be evidenced by a Core-approved binding, not asserted by an ST-local string.

Exact source anchors at pinned ST commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`:
- [Message creation, swipe creation and saveReply](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6642-L6685)
- [Swipe metadata repair/synchronization](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L6833-L7018)
- [Edit mutates before MESSAGE_EDITED](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L8397-L8435)
- [Swipe deletion before/after splice](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L9339-L9408)
- [Whole-message deletion/tool-call cascade](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L1639-L1700)
- [Single-chat load](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/script.js#L7634-L7675)
- [Group-chat load/save](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/group-chats.js#L260-L322)

### 11.3 Executable acceptance plan and evidence labels

**Provider-local tests (completed in CI against frozen source/test blobs; see §11.6):**
1. **Completed:** CI #1809 ran the raw archive, reconciliation interruption/race, and query-revocation race test files together: 19/19 passed; the same run's full suite passed 290/290. Re-run only if Provider source/test blobs change.
2. Exact duplicate tuple + payload after Provider restart yields one logical raw record.
3. Same tuple + different role/content/metadata is rejected as a conflict; prior bytes are unchanged.
4. Select another captured version changes only the active pointer; alternatives remain.
5. Tombstone a version twice, restart Provider, replay the original identical capture: the deleted version remains unavailable and is not resurrected.
6. Register a dependent copy, tombstone its source, restart Provider: the registered copy remains invalidated.
7. Cause revocation to be observed during the final Provider raw-read authorization check: no content is returned.
8. Supply incomplete/unavailable/stale inventory or source-currentness evidence: readiness/read fails closed, never returns complete-empty.
   
Historical Provider-local baseline: code/test HEAD `0c7b4abd8a5b3547304f452380b310bb155aeb52`, CI #1784 **290/290** ([run](https://github.com/necromorphic/Logic-Engine/actions/runs/40121937992)). It is not proof of Host integration, source inventory completeness, or the final serialization race.

**Host runtime tests (not yet run; required on the pinned Android/Termux ST install):**
1. Create a user message and an assistant response; save, close/reopen the chat, restart ST, and compare persisted logical/version IDs before and after.
2. Generate two swipes; select each; save/reload; verify each ID follows its content and the active ID resolves from the selected metadata entry after reindex.
3. Edit the active message; verify old content/version remains identifiable, new version has a distinct ID, and parent points to the exact prior active version.
4. Stop/cancel generation and force a save failure if safely reproducible; verify partial/unpersisted output is not reported as a completed persisted source.
5. Delete first, middle, and last swipes; inspect the target ID captured before either splice and confirm remaining version IDs do not change.
6. Delete a message with multiple swipes and tool-call cascade; record all retained IDs before the first splice. Then demonstrate whether the source can enumerate *previously deleted* versions. If it cannot, assert NON_READY rather than claiming complete retraction.
7. Switch chats; test group-chat load/save; repeat with copy/branch/import/restore and legacy chat data. Verify approved preserve/remap behavior and reject collisions/ambiguous ancestry.
8. Replay the same captured persisted state twice into Provider after restart: no duplicate; then mutate payload under the same tuple: conflict without overwrite.
   
For every case, attach before/after persisted chat evidence with sensitive content redacted, the pinned ST commit, platform/build, and observed save outcome. A fired event log alone does not pass.

**Inventory/currentness tests (BLOCKED until an authoritative existing mechanism is identified and Core approves its exact contract):**
- Prove complete-empty versus denied/unavailable/partial/unknown.
- Inject truncation, omitted page/event, parse/permission failure, unknown legacy source, concurrent mutation, rollback, restore, branch/import replacement and replay ambiguity; each must invalidate readiness.
- Interrupt reconciliation, restart, and prove a fresh full reconciliation is required.
- Delete an inactive and a previously removed version, then prove the inventory still identifies its tombstone/absence.
- Verify Provider compares accepted scope/snapshot before and after reconciliation, while separately proving that this does not substitute for Host completeness.

**Final disclosure race tests (BLOCKED until the real serialization owner/path is identified):**
- Pause after candidate assembly but before final serialization; tombstone/revoke one candidate, change scope, or invalidate inventory; resume and assert no content, snippet, or diagnostic count is returned.
- Repeat with revocation after the final check to characterize the exact residual race. Core must explicitly accept a bounded mechanism or the path remains disabled; sequential checks must not be labelled atomic.
- Run this through the actual Host→Provider→Core→NPC output path, not only injected Provider fixtures.

Evidence status today:
- **SOURCE-INSPECTED:** pinned ST construction/edit/swipe-delete/message-delete/load/save paths above.
- **RUNTIME-OBSERVED:** only the lifecycle event families in the redacted samples linked from Host issue #258; those samples do not prove persistence ordering or completeness.
- **FIXTURE-TESTED:** Provider raw-archive tests at the exact cited draft head/CI.
- **REAL-RUNTIME-TESTED:** none for the full Host→Provider lifecycle on Android/Termux; none for authoritative complete inventory; none for final serialization/revocation race.

### 11.4 Core decision requested

Please mark each item **ACCEPT / REJECT / REVISE**:

1. Candidate Host placements and identity lifecycle in §11.1–11.2.
2. Edit-as-new-immutable-version and explicit predecessor lineage; completion versus cancelled/partial generation.
3. Legacy migration and copy/branch/import/restore ID preservation/remapping/collision policy.
4. World/session binding evidence and durable conversation identity.
5. Inventory contract: because current ST state and events cannot prove complete historical inventory, identify an existing authoritative mechanism that meets §11.1, or explicitly keep the gate blocked pending a separately approved mechanism. This proposal does not introduce a journal, cursor, store, or API.
6. Final serialization owner/path and a concrete race-closing mechanism with explicit residual-race semantics. No production boundary is claimed to exist today.
7. The acceptance criteria and required evidence labels in §11.3.

**Release state:** production Memory→NPC remains **DISABLED / FAIL-CLOSED**. No implementation of the candidate fields or any new API/schema/store/journal/cursor/outbox is authorized by this proposal. Existing Ollama vectorization/remote-store path is untouched.


### 11.5 Provider-only operation mapping after Core's conditional semantic approval (24 Oct 2026)

This section is the Provider-owned implementation-shaped mapping requested by coordinator ruling in issue #181 comment 6388226147. It maps the already-existing draft operations only. It does not approve or add a public endpoint, new schema, store, journal, cursor, outbox, Host caller, or production wiring.

#### Approved storage tuple and trust boundary

The Provider's existing raw-capture key is `(world_id, conversation_id, message_id, version_id)`. It is a **storage identity tuple, not source authority**. Provider must not accept the tuple as proof that a source belongs to the requested world/session, that the version is current, or that the Host inventory is complete. Before any production call, Core must authorize the bound scope and Host must prove durable identity/version provenance. These trust integrations are not supplied by Provider-local row counts or by test callbacks.

#### Existing operation compatibility

| Host semantic transition | Existing Provider operation | Existing behavior at reviewed code head | Required caller precondition / failure behavior |
|---|---|---|---|
| First capture of an immutable version | `captureRawMessage(input)` | Validates tuple/role/content/metadata; inserts one raw row and SHA-256 digest. | Caller must provide a Host-persisted immutable version and Core-authorized scope. Invalid input throws `TypeError`; no trusted identity/scope means do not call. |
| Replay same capture after retry/restart | `captureRawMessage(input)` | Exact same tuple + role/content/metadata returns `duplicate`; existing bytes are not rewritten. | Idempotency applies only to exact payload equality. |
| Same identity with changed payload | `captureRawMessage(input)` | Throws `MEMORY_RAW_CAPTURE_CONFLICT`; it does not overwrite or rebind the version. | Treat as identity collision/contract violation; fail closed and investigate, never mint authority from the conflicting payload. |
| Select a previously captured swipe/version | `selectActiveRawVersion(tuple)` | Updates only the active pointer; other immutable versions remain retained. Missing or tombstoned target throws `MEMORY_RAW_VERSION_UNAVAILABLE`. | Host must resolve the selected ST array position to its durable version ID before calling. An index or native `swipe_id` is not the Provider version ID. |
| Delete one exact version | `markRawSourceDeleted(tuple)` | Idempotently sets the version tombstone, removes its active pointer and invalidates registered Provider-local dependent copies. Unknown target returns `missing`. | Host must capture the exact durable version ID before the ST splice. A `missing` result is not proof that source deletion/retraction is complete. |
| Retry an exact deletion | `markRawSourceDeleted(tuple)` | Repeated tombstone preserves the deleted state; it does not restore the version. | Retry only against the same approved identity tuple. |
| Invalidate a known derived copy when its source is deleted | Internal behavior of `markRawSourceDeleted` | Invalidates only copies registered in this Provider database for that exact source version. | Does not prove invalidation in external stores, search indexes, prompt caches, or unregistered copies. |
| Read a specific version | `readRawMessageVersion(tuple)` | Requires injected `authorizeRawRead`; checks authorization before and after the database read, then rechecks tombstone/content integrity. | Callback is a dependency seam, not automatically a production Core authorization service. Local rechecks narrow but do not eliminate cross-store TOCTOU races. |
| Read active versions for a conversation | `readActiveRawMessages(scope)` | Requires injected `authorizeRawRead`; reads selected non-deleted versions and rechecks authorization after the database read. | Must not be treated as the final production disclosure boundary unless the real serializer invokes an approved check immediately before outbound release. |
| Permanently erase a version | `purgeRawSource(tuple)` | Physically deletes the Provider raw row and registered local dependent copies. | **Not ordinary SillyTavern deletion.** Never map swipe/message delete to purge. Any purge use requires separate explicit authorization and must not claim external stores were purged. |

Code anchors are in `src/application/sqlite-memory-provider.js` at reviewed Provider code/test head `0c7b4abd8a5b3547304f452380b310bb155aeb52`: `captureRawMessage` (129), `readRawMessageVersion` (172), `readActiveRawMessages` (205), `selectActiveRawVersion` (238), `registerRawDerivedCopy` (262), `markRawSourceDeleted` (297), `purgeRawSource` (325), `reconcile` (526). Test anchors: `tests/memory-provider-raw-archive.test.js`. These line numbers are for that exact commit, not a promise about later heads.

#### Reconciliation/currentness and inventory hard gate

At code head `0c7b4abd8a5b3547304f452380b310bb155aeb52`, `reconcile(worldId)` reads `getSnapshot`, validates Provider canonical-entity records through `validateSourceVersion`, calls `validateInventory` on those records, and compares snapshots before/after. These callbacks are injected dependencies. They do **not** enumerate the complete Host source domain and do not prove all retained, inactive, physically deleted, or historically retracted ST versions. A stable snapshot marker and successful Provider-local reconciliation are not Host-source completeness evidence.

The current pinned ST representation physically splices deleted swipes/messages and has no established authoritative retained-plus-deleted historical inventory or approved source-change journal. Therefore the existing Provider API cannot prove completeness after deletion, restart/replay, restore, branch/import, or missed lifecycle events. No qualifying existing mechanism has been identified in the reviewed evidence. The result must remain **NON_READY** for the affected source scope; do not introduce a replacement journal/cursor/store/API without a separate explicit Core review.

#### Exact code/test evidence and limits

- Provider source/test head inspected: `0c7b4abd8a5b3547304f452380b310bb155aeb52`.
- Test file blob: `1926af89dad7676b40b3cb84280885b098cdaea2`.
- Frozen Provider source/test head: source blob `67c84de44ff2783d85a42fded1b583aa25abea99`, raw-archive test blob `1926af89dad7676b40b3cb84280885b098cdaea2`, package script blob `fb0851c43284e2709216a59c54e0df30506a7d4c`. These blobs are identical on the reviewed code head `0c7b4abd8a5b3547304f452380b310bb155aeb52` and the documentation branch commit below.
- Focused CI evidence: [run #1809](https://github.com/necromorphic/Logic-Engine/actions/runs/40124729340), using temporary workflow-only PR #267 (closed unmerged). The runner executed `npm test -- tests/memory-provider-raw-archive.test.js tests/memory-provider-reconcile-interruption.test.js tests/memory-provider-reconcile-race.test.js tests/memory-provider-query-revocation-race.test.js`: **19 passed, 0 failed, 0 skipped** ([focused job](https://github.com/necromorphic/Logic-Engine/actions/runs/40124729340/job/120963615491)). The same run's full `npm test` job passed **290/290** ([full-suite job](https://github.com/necromorphic/Logic-Engine/actions/runs/40124729340/job/120963615668)). The workflow-only commit was `9f55264881b10982a4fc1812a8273e4af457ff24`; Provider source, raw archive test, and package script blobs remained identical to the frozen blobs listed above. This is CI fixture-test evidence, not real Host/runtime integration.
- Evidence class: **FIXTURE-TESTED** for Provider-local behavior; **SOURCE-INSPECTED** for the listed methods; **NOT REAL-RUNTIME-TESTED** for Android/Termux Host persistence, authoritative inventory/currentness, Host→Provider handoff, and final serialization/revocation race.

#### Provider acceptance before any integration review

1. **Completed for the frozen Provider source/test blobs:** focused CI #1809 passed 19/19 and full suite passed 290/290 (§11.6). If any Provider source/test blob changes, repeat against the new exact head before claiming continued coverage.
2. Review the resulting diff against this table and correct any mismatch between documented and actual method behavior.
3. Keep Host-supplied IDs untrusted until Core-approved scope/source authorization exists; reject conflicting identity reuse.
4. Do not mark Host inventory ready from Provider-local row counts, `validateInventory`, or snapshot equality alone.
5. Do not claim whole-message/chat deletion complete without Host's exhaustive historical-version set and confirmed tombstone outcome for every exact target.
6. Do not enable any Host caller or production Memory→NPC disclosure path until the exact implementation diff receives the second explicit Core review and real lifecycle/inventory/final-boundary acceptance evidence is supplied.

**Provider status:** existing local archive operations can support exact immutable capture, active-pointer selection, reversible per-version tombstones, local dependent-copy invalidation, and guarded local reads. They do not currently establish Host identity authority, complete/current Host inventory, cross-store revocation atomicity, or production integration. Production Memory→NPC remains **DISABLED / FAIL-CLOSED**; vectorization is untouched.


### 11.6 Canonical Provider operation guarantees and Core 1.9 contract mapping (26 Oct 2026)

This is the single canonical Provider operation matrix for #181. It maps existing executable operations to the exact clause structure of the proposed Core contract at PR #347 HEAD `da6373706762290de201b145753fc48b0938e185`, [docs/07-knowledge-and-narrative-boundaries.md](https://github.com/necromorphic/Logic-Engine/blob/da6373706762290de201b145753fc48b0938e185/docs/07-knowledge-and-narrative-boundaries.md). PR #347 is still draft/unmerged: this is a compatibility review of the proposal, not approval to wire it or a claim that the proposal is final.

**Code pins and evidence class**
- Current-main Provider implementation at review time: `src/application/sqlite-memory-provider.js`, main blob `15ddf2326aea93d5997c102d61488e63095d439f`. This main version still contains callable raw-archive methods.
- Canonical Provider implementation PR #359 head `066458d8d262daa24c62c87e9357ab778843f4fe` explicitly denies raw capture (`MEMORY_RAW_CAPTURE_NOT_APPROVED`), raw reads (`MEMORY_RAW_DISCLOSURE_NOT_APPROVED`), active selection (`MEMORY_RAW_SOURCE_NOT_APPROVED`), and derived-copy registration (`MEMORY_RAW_DERIVED_COPY_NOT_APPROVED`) pending retention approval. Exact-head Runtime CI #40311519555 passed; this is repository CI, not production Host authority or end-to-end integration.
- Provider-local CI/tests and injected callbacks are not proof of production Host authority, source currentness, complete inventory, or final transport safety.
- No new API/schema/store/journal/cursor/outbox or production caller is authorized here. Raw SillyTavern/Host text retention remains **not approved**; production Memory→NPC remains **DISABLED / FAIL-CLOSED**.

#### Mapping to the proposed Core contract

| Core proposal clause | Existing Provider operation(s) | What is supported now | What is not supported / required decision |
|---|---|---|---|
| §1 — distinguish canonical fact, subject knowledge/belief, narrative delivery, search retrieval | `putRecord`, `retrieveCandidates`, `reconcile`; Core `AuthorizedReadService` / `MemoryNpcConsumer` seam | Provider stores and retrieves Provider-owned records; tested consumer seam filters canonical source fields and does not persist delivery/receipt/acquisition/belief as a side effect of retrieval. | Retrieval is not acquisition, belief, delivery, or canonical truth. Provider does not implement subject learning/belief updates or narrative receipts. |
| §2 — provenance and acquisition path | `putRecord`, `authorizeCandidate`, `reconcile` | Current searchable record path accepts the supported direct `canonical_entity` source/lineage shape and checks lineage consistency; local tests fail closed on corrupt/missing direct lineage. | Injected `validateSourceVersion` is not itself authoritative source proof. No approved Host-message source-kind/identity conversion exists. Provider does not prove that an NPC could observe/receive a source. Core must approve source authority/currentness and any new source class before implementation. |
| §3 — access filtering before actor context | `retrieveCandidates`, `authorizeCandidate`; Core `AuthorizedReadService` seam | Provider query grants and record grants are checked; candidate authorization rechecks Provider grants after awaited source validation. Core seam filters fields in integration tests. | Fixture callbacks do not prove production world/session/actor binding. Provider-local recheck is not a final serializer/transport gate and does not eliminate the post-check race. |
| §4 — multiple sources, invalidation, dispute and belief updates | `reconcile`, `putRecord`; raw `markRawSourceDeleted` only for already-known raw rows | Provider reconciliation can fail closed for its own indexed records, changed Provider record set, stale snapshots, and invalid direct lineage. Raw tombstone implementation can affect only known rows and registered local copies. | Current record lineage is a direct single-source first slice; it does not implement multi-source knowledge reconciliation, subject belief retention/update, or complete Host edit/delete/restore inventory. Core must define authoritative retraction/currentness; Host must prove complete lifecycle evidence. Raw archive operations must remain disabled until retention/source contract approval. |
| §5 — bounded narrative generation contract | No narrative-generation operation in Provider | Provider can return authorized candidates through the existing in-process seam. | Provider does not authorize new canonical effects, generate narrative, or determine viewpoint policy. Consumer/Core owns the contract; no Provider-side substitute. |
| §6 — delivery receipts and supported host confirmation | No delivery/receipt operation in Provider | Existing tests assert retrieval/context inclusion alone does not create delivery, receipt, acquisition, or belief. | No production Host serializer/transport/receipt path is proven. Core + actual outbound-path owner must identify the final release boundary and acceptance test. |

#### Existing-operation matrix and status

| Existing operation | Provider-local behavior / exact test evidence | Status against Core proposal |
|---|---|---|
| `putRecord(input)` | Identity `(world_id, record_ref, record_version)`; exact duplicate is idempotent; conflicting payload under same identity fails; direct canonical-entity lineage validated. `tests/sqlite-memory-provider.test.js`, `tests/memory-provider-corrupt-lineage.test.js`. | **SUPPORTED** for current Provider-record persistence invariants only. Does not map Host `(world_id, conversation_id, message_id, version_id)` into Provider record identity. |
| `rebuildIndex(worldId)` → `reconcile(worldId)` | Rebuilds Provider index and validates persisted Provider records against injected snapshot/source/inventory checks; tested interruption, Provider record-set mutation, stale rollback snapshot and corrupt lineage. `tests/memory-provider-reconcile-interruption.test.js`, `tests/memory-provider-reconcile-race.test.js`, `tests/memory-provider-core-integration.test.js`. | **SUPPORTED** for Provider-local consistency. **UNSUPPORTED** as proof of complete Host active/history/deleted inventory or a source-change journal. |
| `retrieveCandidates(scope)` | Readiness/snapshot checks and query/record grants; denied/withheld/unavailable/stale are not treated as a successful complete-empty result. `tests/sqlite-memory-provider.test.js`, `tests/memory-provider-query-revocation-race.test.js`, `tests/memory-provider-core-integration.test.js`. | **SUPPORTED** for tested local retrieval/failure semantics. **UNSUPPORTED** as delivery/acquisition/belief or final outbound authorization. |
| `authorizeCandidate(input)` | Checks scope, record grant, source binding and direct lineage; rechecks Provider grants after awaited source validation. `tests/memory-provider-query-revocation-race.test.js`, `tests/memory-provider-core-integration.test.js`. | **SUPPORTED** for Provider-local authorization recheck. **DECISION NEEDED** for the Core-authoritative source-version callable and final release boundary. |
| `captureRawMessage`, `selectActiveRawVersion`, `registerRawDerivedCopy`, `readRawMessageVersion`, `readActiveRawMessages` | These methods exist in current main's raw archive implementation, but the proposed Core contract does not approve raw Host text retention or a Host source/lifecycle contract. PR #359 at exact head `066458d8d262daa24c62c87e9357ab778843f4fe` disables these raw operations in code and adds fail-closed denial coverage; exact-head Runtime CI #40311519555 passed. | **NOT APPROVED / MUST REMAIN DISABLED** until Core/product approves retention, source kind, authoritative scope and lifecycle contract. A callback grant does not override this gate. |
| `markRawSourceDeleted`, `purgeRawSource` | Operate only on rows/copies already known in the Provider-local raw tables; cannot discover missing Host versions or external copies. Local lifecycle tests on older branches do not authorize a production caller. | **LIMITED LOCAL MECHANICS**; cannot be used to claim Host deletion completeness or global purge. Keep no production raw caller. Purge replay policy remains unresolved. |

#### Owner decisions and closure tests

| Blocker | Owner | Narrow closure evidence |
|---|---|---|
| Canonical source currentness/retraction authority and approved mapping for opaque `source_version` | Core | A real callable authority on the approved seam; test source v1→v2, rollback with unchanged `commit_sequence`, missing/unknown source, and retraction after restart. Never infer `source_version == updated_revision`. |
| Host message identity, version ancestry, pre-mutation delete target, complete active/history/deleted inventory and missed-change detection | Host/Adapter + Core for world/session binding | Pinned installed ST/extension and real event trace across create/edit/swipe/delete/cancel/save/reload/restart/copy/restore; assert stable IDs and exhaustive inventory or return NON_READY. |
| Last safe point before outbound disclosure and race semantics | Core + Host/Adapter/actual consumer owner | Exercise the actual serialization/transport path with candidate A revoked while candidate B is awaited and immediately before release; assert no unauthorized bytes leave. |
| Raw retention, purge and post-purge replay semantics | Core/product + Provider | Explicit retention/source contract decision before any raw caller. If post-purge replay must be rejected, approve a retention-compatible mechanism first; no ledger/schema is assumed. |

**Disposition:** keep the canonical mapping in this section only. PR #338 is the one focused documentation update; do not create a second matrix document. It does not close #181 or authorize production. Memory→NPC remains **DISABLED / FAIL-CLOSED**; existing Ollama/vectorization/remote-store behavior remains outside this Provider change.


### 11.7 Host ↔ Provider exact-head comparison (25 Oct 2026)

Issue #181 comparison/evidence report: https://github.com/necromorphic/Logic-Engine/issues/181#issuecomment-6393926588

#### Pinned Host evidence

- Pinned SillyTavern source: `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (`public/script.js`).
- Host lifecycle evidence document: commit `b3878e45a59ff1581c98dfef4e09cc639080bdbc`.
- Identity patch candidate: commit `f5a1f4265830ba2a24a0bec7068bef2d81e47c69`, patch blob `2c04a6ec54b8fa9a63e08051f824c503a786b9f7`; candidate only, not installed or merged into ST.
- Disposable patch CI: [run #1814](https://github.com/necromorphic/Logic-Engine/actions/runs/40124854951). Exact target SHA, `git apply --check`, disposable application, `git diff --check`, dependency installation and `npx eslint public/script.js` passed. This is **patch applicability/lint only**, not lifecycle acceptance or Android/Termux persistence.
- Source-inspected Host behavior: `deleteMessage()` and `deleteSwipe()` physically splice retained data; edit changes content before `MESSAGE_EDITED`. The candidate does not implement proven edit ancestry, pre-mutation deletion handoff, legacy/collision migration, copy/import/restore enforcement, or exhaustive historical inventory.

#### Exact Host-to-Provider fit

| Host event or lifecycle fact | Existing Provider operation | Result |
|---|---|---|
| Capture a completed immutable version | `captureRawMessage(input)` | Provider persists an exact tuple and content digest, makes identical retries idempotent, and conflicts on same tuple/different content. Host does not yet provide production-proven durable IDs/scope, so a real caller is not established. |
| Select a retained swipe | `selectActiveRawVersion(tuple)` | Provider changes its active pointer. Native `swipe_id` is an array position, not a durable identity; proposed `swipe_info[i]` ID mapping is not deployed or phone-tested. |
| Edit a message | No dedicated edit operation; immutable capture requires a new exact version identity | Host mutates content before its event; pre-edit immutable capture and parent ancestry are not demonstrated. Provider cannot reconstruct overwritten content. |
| Delete one swipe | `markRawSourceDeleted(tuple)` | Provider can tombstone a known exact tuple and invalidate registered Provider-local copies. Host's existing splice precedes its event; no verified pre-splice identity handoff exists. |
| Delete a message/chat including earlier deleted versions | Repeat `markRawSourceDeleted(tuple)` for every exact known version | Provider can act only on supplied tuples. Host physically removes data and no complete historical inventory/change journal is evidenced; deletion completeness cannot be asserted. |
| Restart, replay, import, restore, or legacy migration | Capture/read/reconcile operations | Provider-local durability/idempotency do not prove Host ID persistence, collision-free migration, ancestry, or lineage through these Host lifecycle operations. |
| Read and reconcile | `readRawMessageVersion`, `readActiveRawMessages`, `reconcile(worldId)` | Local authorization seams and Provider-record consistency are tested. They do not prove Core production authority, exhaustive Host inventory, or final outbound disclosure authorization. |

#### Test pins and evidence classes

- Provider frozen source/test head: `0c7b4abd8a5b3547304f452380b310bb155aeb52`; source blob `67c84de44ff2783d85a42fded1b583aa25abea99`; raw archive test blob `1926af89dad7676b40b3cb84280885b098cdaea2`; package script blob `fb0851c43284e2709216a59c54e0df30506a7d4c`.
- Focused CI #1809: 19/19 passed across four Provider-local test files; full suite 290/290 passed: https://github.com/necromorphic/Logic-Engine/actions/runs/40124729340. Workflow-only PR #267 closed unmerged; frozen Provider source/test blobs unchanged.
- Active-read final-authorization recheck test is now present in current main `tests/memory-provider-raw-archive.test.js`; its guarantee is Provider-local only and does not establish cross-store atomic revocation or a production serialization boundary.
- **FIXTURE-TESTED:** Provider local archive, conflict/idempotency, tombstone, registered local-copy invalidation, guarded read, and Provider reconciliation behavior.
- **SOURCE-INSPECTED / PATCH-CI-VALIDATED:** pinned Host mutation points and patch applicability/lint.
- **NOT PROVEN:** installed ST/Termux durable identity, real Host→Provider caller, edit ancestry, pre-mutation deletion handoff, exhaustive historical Host inventory, copy/import/restore migration, cross-store atomicity, or actual serializer→transport revocation race.

#### Remaining guarantees and owners

- **Host owner:** durable identity/version persistence and migration; pre-mutation exact deletion capture; edit ancestry; copy/import/restore handling; completeness/currentness evidence.
- **Core source-version token (draft PR #490):** Core now issues `core-entity-v1:N` from a durable per-entity counter in the existing Core SQLite database. The counter is stable across unrelated entity changes and advances when the canonical entity projection changes during rebuild/rollback; it is not inferred from `updated_revision` or the world cursor. Exact-head CI #40497648772 passed 823/823 repository tests and 8/8 NPC-boundary tests. This is branch/CI evidence, not merged-main or production evidence. Full-database restore resistance is not provided by the counter alone.
- **Core + Provider + Host:** authoritative complete Host inventory/currentness and retraction semantics remain blocked. Equality of `world_revision + commit_sequence` is not a source-specific journal and cannot alone prove no missed changes or rollback.
- **Core + owner of the actual outbound response path:** identify and test final authorization immediately before serializer/transport release, and quantify or eliminate the residual post-check race. No production serializer→transport binding is currently evidenced.

**Verdict:** Host inventory `NO SUCH MECHANISM FOUND / NON_READY`; final disclosure `NO PRODUCTION PATH FOUND / BLOCKED`; real Host→Provider vertical slice **NOT PROVEN**. Memory→NPC remains **DISABLED / FAIL-CLOSED**. No runtime/API/schema/store/journal/cursor/outbox changes; vectorization remains untouched.


## 12. Coordinator decision update — Provider report and safe work boundary (2026-10-26)

**Evidence source:** Provider's code-grounded report on PR #344 head `55a8d13efc359dd5d002360eb380feffb7b1b495`, [issue #181 report](https://github.com/necromorphic/Logic-Engine/issues/181#issuecomment-6409424750). This is branch-specific evidence and must not be misrepresented as merged-main or production wiring.

### Verified semantics on the reported Provider head

- `record_version` versions a Provider Memory record, keyed with `world_id` and `record_ref`; it does not version a canonical Core entity.
- `source_version` remains an opaque Provider-record token structurally repeated in direct-source lineage. Core's new authoritative token implementation is in draft PR #490 (exact head `f7054a988e98f4702e2bce0ad974bcf70d5eca71`); it is not yet merged and does not establish Host inventory completeness, restore-resistant anti-rollback, or the final disclosure boundary. Do not merge PR #488's earlier `updated_revision`-derived token in isolation.
- `world_revision` and `commit_sequence` are world-level snapshot markers. They are not a source-specific change journal.
- The current Provider record contract has no durable subject-relative acquisition evidence proving which subject acquired which proposition, through which allowed mechanism, with what delivery/observation evidence.
- Provider reconciliation and authorization depend on injected validation/inventory authorities. Fixture callbacks are test evidence, not production authority.
- The report does not establish complete Host/Core inventory, canonical source retraction feed, final disclosure-time revalidation, or cross-store atomicity.

### Permissions and limits

**Allowed now, within Provider ownership:** maintain immutable Provider record identity/version and direct-source lineage checks; preserve idempotent duplicate/conflict behavior; harden tombstone/revocation/rebuild/restart/replay and non-ready behavior; keep summaries with incomplete lineage ineligible; report exact code/test/commit evidence. These are Provider-local safeguards only.

**Not authorized:** persist or disclose raw SillyTavern message text; claim that a Provider row or caller-supplied `source_version` is authoritative; equate `source_version` with `updated_revision`; use test-supplied validators as production authority; create a guessed cross-block API/schema/store/journal/cursor/outbox; or enable production Memory→NPC.

### Dependency and acceptance gate

Core #140 owns the subject-relative knowledge/acquisition contract, trusted scope, canonical source validity/currentness, disclosure policy, and Core validation boundary. NPC owns the meaning and safe projection of admission, without delivery/acquisition/belief side effects. Host #258 owns evidence from the pinned SillyTavern target and the real final pre-send interception; unsupported paths remain NON_READY. Provider can connect to these authorities only after the owners approve the exact contract and a real callable composition exists.

Production remains **DISABLED / FAIL-CLOSED** until the agreed contract is implemented and tested through actual owner components, including stale/revoked/deleted sources and invalidation between candidate assembly and final send, with no protected content or metadata side-channel leakage.

## 13. Coordinator execution permissions and Host interception correction (2026-10-26)

This update consolidates the latest owner reports. It is a documentation decision only: it does not approve new APIs/schemas, cross-block wiring, or production disclosure.

### Host: distinguish UI lifecycle instrumentation from outbound interception

Pinned target: SillyTavern `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

The Host report at [#258 comment 6409724737](https://github.com/necromorphic/Logic-Engine/issues/258#issuecomment-6409724737) corrects the earlier implementation interpretation:

- `CHAT_COMPLETION_SETTINGS_READY` in `public/scripts/openai.js` is a browser pre-serialization point for one Chat Completions route, not a universal provider-send boundary.
- The candidate patch does **not** currently intercept that point, the browser POST to `/api/backends/chat-completions/generate`, the server dispatch/provider-send path, or Text Completions provider fetches.
- Provider-specific branches, native/server callers, extensions/custom routes and other generation families remain unsupported/bypassable for disclosure authorization.
- The candidate lifecycle patch instruments only a subset of UI mutations. Rejecting an unsupported mutation is fail-closed behavior; it is not evidence of complete interception or inventory.
- Exact-commit CI on `d668e263dfab899d361196461b4b1953056e1250` passed patch check [#40279989072](https://github.com/necromorphic/Logic-Engine/actions/runs/40279989072), runtime tests [#40279989073](https://github.com/necromorphic/Logic-Engine/actions/runs/40279989073), and patch validation [#40279989075](https://github.com/necromorphic/Logic-Engine/actions/runs/40279989075). These are repository CI results, not live browser/IndexedDB, Android/Termux, provider-network, or revocation-race proof.

**Current Host verdict:** authoritative complete/current inventory = `NO SUCH MECHANISM FOUND / NON_READY`; actual final disclosure path = `NO PRODUCTION PATH FOUND / BLOCKED`; revoke/edit/delete after candidate assembly and before outbound send = `NOT PROVEN`.

### Permissions now in force

- **Provider:** may harden Provider-local immutable record identity/version, direct-source lineage validation, idempotency/conflict behavior, exact-version tombstones, local-copy invalidation, reconciliation, restart/replay and fail-closed handling. Keep evidence tied to exact HEAD and tests. No raw ST text retention; no fixture authority; no mapping of `source_version` to Core `updated_revision`.
- **Host:** may continue pinned-source inspection and Host-owned patch/tests that document and enforce only proven lifecycle behavior. Must classify route coverage explicitly. Do not add a fabricated authorization callback or claim final-send enforcement; do not modify the separate Ollama/vectorization/remote-store patch.
- **Core:** owns the proposed subject-relative knowledge/acquisition semantics, trusted scope, canonical-source validity and disclosure policy. No field allowlist is approved for `model / npc_decision`.
- **NPC:** owns the admission projection and NPC-only review path. Admission must not imply delivery, receipt, acquisition or belief; no fake receiver or fixture-backed positive authority.

### Next implementation review gate

Before any cross-block runtime diff, all four owners must comment on the same Core proposal with one of: `ACCEPT`, `REJECT` with a concrete conflict, or `UNSUPPORTED` with exact missing runtime evidence. The coordinator then authorizes only the smallest explicitly listed diff. If the proposal requires a new authority or data shape, stop for a separate decision rather than silently implementing it.

A production release gate additionally requires an actual callable Provider/Core/NPC composition and a real test that pauses after candidate assembly, mutates/revokes the source, resumes, and proves no protected data leaves through each enabled outbound route. Untested routes stay disabled. Sequential validation is not atomicity. Production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
