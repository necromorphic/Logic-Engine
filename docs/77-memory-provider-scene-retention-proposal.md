# Memory Provider: source-backed scene retention proposal

Status: **PROPOSAL ONLY — no retention contract or raw-text production path is approved**  
Owner: Memory Provider, with decisions required from Core, Host/Adapter, and Product/Security.  
Related: [Provider task #181](https://github.com/necromorphic/Logic-Engine/issues/181), [Core gate #140](https://github.com/necromorphic/Logic-Engine/issues/140), [Host lifecycle evidence #258](https://github.com/necromorphic/Logic-Engine/issues/258), [global gate #264](https://github.com/necromorphic/Logic-Engine/issues/264).

## 1. Purpose and non-goal

Product requires long-term memory to preserve coherent scenes and concrete event details, not only lossy extracted facts. This note proposes a minimum decision surface for preserving source-backed scene material and derived memories without silently enabling raw SillyTavern text retention.

This is **not** an approved schema, API, retention policy, or production integration. It does not authorize capture, reading, model disclosure, or enabling Memory→NPC. It does not change the existing Ollama vectorization/remote-store patch.

## 2. What current code actually does

| Area | Current executable behavior | Evidence boundary |
|---|---|---|
| Provider record storage | `SQLiteMemoryProvider.putRecord()` persists immutable Provider record identity/version, direct canonical-entity source identity/version, semantic metadata and lineage; identical retry is idempotent and conflicting same-key payload is rejected. | Provider-owned persistence only; the record itself does not preserve full scene text. |
| Source version | Core conditionally approved direct `canonical_entity` only: `source_version` must equal the canonical decimal string of that entity's current non-negative `updated_revision`, with exactly one same-world active entity. | Not a universal Host-message version contract; not production wiring by itself. |
| Reconciliation/index | `rebuildIndex()`, `reconcile()`, and `retrieveCandidates()` maintain Provider index health and fail closed on stale/unavailable state, invalid direct lineage, incomplete inventory attestation, and snapshot mismatch. | `validateSourceVersion` and `validateInventory` are injected integrations; test callbacks are not production authority. |
| Raw Host capture | `captureRawMessage()` throws `MEMORY_RAW_CAPTURE_NOT_APPROVED` before writing. | Closed pending an explicit retention contract and trustworthy Host identity/lifecycle evidence. |
| Raw Host disclosure | `readRawMessageVersion()` and `readActiveRawMessages()` throw `MEMORY_RAW_DISCLOSURE_NOT_APPROVED`. | Closed even if an injected read callback would allow access. |
| Raw active-version selection / derived copies | `selectActiveRawVersion()` and `registerRawDerivedCopy()` are fail-closed. | Existing dormant implementation is not an approved production path. |
| Deletion and purge | Provider-local `markRawSourceDeleted()` and `purgeRawSource()` can tombstone/purge an exact tuple and invalidate/delete known Provider-local dependent copies. | They cannot establish that Host supplied every version, delete external copies, or prove global purge completeness. |
| Consumer boundary | The real SQLite Provider → Core `AuthorizedReadService` → `MemoryNpcConsumer` test path exists; unsupported/partial/non-current results fail closed. | No approved production final-disclosure serializer/dispatch seam; no atomic revoke-to-dispatch guarantee. |

## 3. Minimum conceptual separation

Keep these concepts separate; none implies another:

1. **Source scene/event** — preserved source evidence and its immutable source version.
2. **Derived episode/summary/facts** — material computed from one or more source versions, with explicit lineage back to those versions.
3. **Subject acquisition** — what a particular NPC actually observed, received, read, or was told, with the applicable channel/time/evidence.
4. **Belief and recall** — what the NPC currently believes, doubts, disputes, or can recall. Retrieval is not proof of acquisition or belief.
5. **Disclosure decision** — whether a particular subject may receive the selected source or derived material for a specific purpose at the actual model-dispatch boundary.

Do not let a summary's producer authorize the source claims it summarizes. A derived item is eligible only if every required lineage source is present, version-valid, and authorized for the requested subject/purpose. If that cannot be established, fail closed.

## 4. Minimum proposed lifecycle semantics (not a schema)

- **Capture:** only from a Host-provided immutable identity/version tuple after Host can prove its stability. Capture must occur before a destructive edit/delete mutation if the previous version is to be preserved. Missing or ambiguous identity means no capture claim.
- **Idempotency/conflict:** replay of the same complete identity and same payload is idempotent; same identity with different payload is a hard conflict, never an overwrite.
- **Edit/regenerate/swipe selection:** preserve each distinct source version; selecting a newer/current version must not rewrite the old version. Host must provide edit ancestry/selection evidence; Provider must not infer ancestry from array position, timestamps, or content hashes alone.
- **Delete/retract:** tombstone the exact known source version and invalidate its known dependent copies. Do not treat deletion of one version as deletion of all alternate versions unless Host's event explicitly and completely identifies that scope.
- **Restore/import/copy:** do not silently reactivate old grants or treat restored data as current. Require an owner-approved mapping of identity, ancestry, scope and source authority; ambiguous collisions remain unavailable.
- **Derived material:** persist lineage to the exact source versions used. Rebuildable indexes may be regenerated from durable authorized records, but index rebuild must not recreate grants or clear tombstones/revocations.
- **Reconciliation:** a source change, rollback, revocation, missing lineage, incomplete inventory, or unavailable authority makes affected material non-ready until the relevant authority can re-establish currentness. `world_revision + commit_sequence` is a snapshot freshness marker, not a source-specific change journal.
- **Disclosure:** revalidation at Provider read narrows a race but does not serialize a separate Core/Provider permission check with outbound dispatch. No source-backed raw scene is disclosed to a model until Core/Host identify and test the real final boundary.

## 5. Decisions required before implementation

| Decision | Owner | Required answer / closure evidence |
|---|---|---|
| Which Host source types can supply durable message/version identity, edit ancestry, pre-mutation deletion IDs, and complete active/history/deleted inventory? | Host/Adapter | Exact pinned implementation plus lifecycle/restart/replay/import/restore evidence. Current Host result says no authoritative complete inventory mechanism is established. |
| May raw Host/SillyTavern text be retained; for what scope, purpose, duration, and deletion/purge behavior? | Product + Core + Security | Explicit retention decision covering raw source, backups, derived copies, revocation, deletion, restoration and external indexes. Product preference for scene completeness alone is not approval. |
| Which source classes have authoritative currentness/version semantics? | Core | Existing conditional mapping is limited to direct `canonical_entity`; Host message versions remain unapproved/unverifiable until their own contract is accepted. |
| Who authorizes each source and every lineage source for a subject/purpose? | Core + Provider + NPC | Approved source/field and lineage policy with denial/withheld/non-ready semantics and no content/count/diagnostic leakage. |
| What operation serializes the final disclosure decision with outbound model dispatch? | Core + Host + Product/Security | Exact callable boundary and deterministic zero-egress tests for denial, stale/retracted source, incomplete inventory, and revoke-before-dispatch. Existing code has no approved callable seam; a sequential recheck is insufficient to claim atomicity. |
| What does restore mean after a source deletion or permission revocation? | Core + Host + Product/Security | Explicit rule and tests proving whether restore creates a new source version and which grants/derived copies remain invalid. |

## 6. Executable acceptance matrix for the future approved path

These are required closure tests, not claims that raw retention is currently enabled.

- Capture the same immutable tuple twice with identical payload → one logical version; same tuple with different payload → hard conflict and no overwrite.
- Edit/regenerate and select an alternate version; restart/replay → each version and active selection remain exact and stable.
- Delete a selected version → exact tombstone persists, known dependent copies become ineligible, and an alternate version remains independently addressable.
- Delete a message/chat with multiple known versions → every supplied exact version is reconciled; missing/ambiguous inventory prevents a complete-success result.
- Restore/import/copy with colliding or missing ancestry → fail closed without resurrecting grants or source currentness.
- Derived episode with one missing, revoked, stale-version, retracted or cross-world lineage source → derived episode is not disclosed.
- Derived-index failure after source capture → durable source remains recoverable; retrieval stays non-ready until rebuild and reconciliation succeed.
- Query/record revocation during awaits → typed non-ready/denied result, never a successful empty result that hides the failure.
- Revoke or source invalidation winning before actual dispatch-start → zero provider requests; dispatch-start winning first → documented in-flight behavior. This test requires the approved real Host/Core seam and cannot be simulated by Provider-only rechecks.
- Confirm that retrieval/context inclusion does not itself persist delivery, receipt, acquisition, or belief.

## 7. Current disposition

- **Provider-local record/index lifecycle:** executable and covered by repository tests, including SQLite restart/rebuild, grant revocation, lineage validation, rollback invalidation, reconciliation races, raw-first record persistence on derived-index failure, and partial-result fail-closed behavior.
- **Raw scene retention:** **BLOCKED / NOT APPROVED**. No capture or disclosure is enabled by this proposal.
- **Host identity and complete inventory:** **BLOCKED / NON_READY** pending Host-owned evidence.
- **Production Core source authority for Host messages and final dispatch serialization:** **BLOCKED / NO APPROVED CALLABLE SEAM**.
- **Production Memory→NPC:** **DISABLED / FAIL-CLOSED**.

No new API/schema/store, source-change journal, cursor, outbox, production caller, or vectorization change is proposed here. The next step is owner decisions and evidence for the listed gates, while Provider-local work continues independently.

## 8. Host tuple → existing Provider operation mapping

Host's candidate tuple is `(world_id, conversation_id, message_id, version_id)`. It is **not** the same identity as the current direct-record primary key `(world_id, record_ref, record_version)`. No approved conversion between these identities exists, so do not fabricate one or treat a caller-provided mapping as Host authority.

| Host fact/event | Existing Provider operation | Current result / preconditions | What remains unproven |
|---|---|---|---|
| Completed immutable source version captured | `captureRawMessage(tuple + role/content/metadata)` | Immediately throws `MEMORY_RAW_CAPTURE_NOT_APPROVED`; writes nothing. | No production capture is occurring; Host identity and retention approval are absent. |
| Select current swipe/generation | `selectActiveRawVersion(tuple)` | Immediately throws `MEMORY_RAW_SOURCE_NOT_APPROVED`; active pointer is not changed. | Host's selected version must be a stable immutable ID, not a mutable swipe array position. |
| Read one version / active conversation | `readRawMessageVersion(tuple)` / `readActiveRawMessages(world_id, conversation_id)` | Immediately throws `MEMORY_RAW_DISCLOSURE_NOT_APPROVED`. | No raw Host text can reach the consumer through these methods; no approved disclosure boundary exists. |
| Edit or regenerate | No dedicated Host edit-ancestry operation; a new version would require a distinct `version_id` and preserved parent/source evidence. | Provider cannot infer the old version after Host overwrites it. | Pre-mutation capture, parent ancestry and durable IDs are not proven on Host. |
| Delete one exact known version | `markRawSourceDeleted(tuple)` | Provider-local reversible tombstone; removes that exact active pointer and invalidates known local derived copies. Missing tuple returns `missing`. | It only acts on the tuple supplied; it cannot prove all deleted versions were enumerated. |
| Permanently purge one exact known version | `purgeRawSource(tuple)` | Provider-local deletion and cascade of registered dependent copies. | Does not purge external/vector stores or prove complete global erasure. |
| Register a derived episode/copy | `registerRawDerivedCopy(tuple + copy identity/content)` | Immediately throws `MEMORY_RAW_DERIVED_COPY_NOT_APPROVED`. | No raw-source-derived scene is currently stored by this path; future lineage authorization and retention must be approved first. |
| Rebuild/restart/replay | `rebuildIndex()`, `reconcile()`, `putRecord()` apply only to Provider records, not Host raw tuples. | Provider-record persistence/rebuild/reconciliation is tested. | Does not reconstruct Host historical/deleted inventory or map raw tuple IDs to Provider record IDs. |

This mapping consumes the current Host/Provider evidence without certifying Host completeness. Host's owner report remains **NO AUTHORITATIVE COMPLETE ACTIVE + HISTORY/DELETED INVENTORY / NON_READY**. Until Host supplies exact, durable, replayable lifecycle evidence and Core approves the source/retention/disclosure contract, the safe executable result for raw capture/read/derived-copy is refusal, not partial success.

## 9. Requirement → owner → code/test → evidence → disposition

| Requirement | Owner | Current code/test evidence | Evidence class | Disposition |
|---|---|---|---|---|
| Immutable Provider record identity, idempotent duplicate, conflicting payload rejection | Provider | `SQLiteMemoryProvider.putRecord()`; `tests/sqlite-memory-provider.test.js` | Exact-head Runtime CI #40308513276 | **PASS — Provider-local** |
| Durable record/grant state across SQLite restart; rebuild does not restore revoked grants | Provider | `tests/memory-provider-file-backed-reconciliation.test.js`; `tests/sqlite-memory-provider.test.js` | Exact-head Runtime CI #40308513276 | **PASS — Provider-local** |
| Derived-index write failure leaves durable record but retrieval closed until rebuild/reconcile | Provider | `tests/memory-provider-ingest-index-failure.test.js` | Exact-head Runtime CI #40308513276 | **PASS — Provider-record path only; raw Host capture remains disabled** |
| Lineage corruption, source mismatch, missing/wrong-world/destroyed source and rollback fail closed | Provider + Core source rule | `authorizeCandidate()`, `reconcile()`; `tests/memory-provider-lifecycle-regressions.test.js`; `tests/memory-provider-file-backed-reconciliation.test.js` | Exact-head Runtime CI #40308513276 | **PASS — bounded direct canonical_entity only; callback is not production wiring** |
| Incomplete inventory cannot publish current | Provider; Host owns complete inventory evidence | `reconcile()`; inventory failure tests in `tests/memory-provider-core-integration.test.js` | Exact-head Runtime CI #40308513276 | **Provider refusal PASS; authoritative Host inventory BLOCKED** |
| Authorized empty vs query-denied, record-withheld, unavailable, stale, rebuilding and partial result remain distinct | Provider | `retrieveCandidates()`; `tests/sqlite-memory-provider.test.js`; partial end-to-end test in `tests/memory-provider-core-integration.test.js` | Exact-head Runtime CI #40308513276 | **PASS — Provider/test consumer path** |
| Final reconciliation compares the full persisted record payload and atomically publishes current | Provider | Full record comparison plus final `BEGIN IMMEDIATE` compare-and-publish; `tests/memory-provider-lifecycle-regressions.test.js`; file-backed reconciliation tests | Exact-head Runtime CI #40308513276 | **PASS — SQLite Provider-local serialization only** |\n| Query/record revocation during awaited authorization does not become ready-empty; previously allowed A is rechecked after B | Provider + test consumer | `authorizeCandidate()` tracks exact query/record grant generations, rechecks Provider readiness/state generation after awaited source validation; `tests/memory-provider-query-revocation-race.test.js`; `tests/memory-provider-core-integration.test.js` | Exact-head Runtime CI #40308513276 | **PASS — Provider-local race guards; no cross-store atomicity claim** |
| Retrieval through SQLite Provider → Core AuthorizedReadService → NPC consumer with no delivery/acquisition/belief side effects | Provider/Core/NPC test seam | `tests/memory-provider-core-integration.test.js` | Exact-head Runtime CI #40308513276 | **PASS — test seam only, not production receiver or dispatch** |
| Raw source capture, active-version selection, read and derived-copy persistence | Product + Core + Provider; Host supplies trustworthy identity | `captureRawMessage()`, `readRawMessageVersion()`, `readActiveRawMessages()`, `selectActiveRawVersion()`, `registerRawDerivedCopy()`; `tests/memory-provider-raw-archive.test.js` | Exact-head Runtime CI #40308513276 | **BLOCKED / deliberately fail-closed pending retention approval and Host evidence** |
| Host tuple mapping and complete active/history/deleted inventory, including edit/import/restore/replay | Host/Adapter + Core | §8 mapping; Host owner result in issue #258 | Owner evidence/source inspection | **BLOCKED / NON_READY; Provider cannot certify caller inventory** |
| Source-backed summary/episode disclosure with all lineage sources authorized/current | Provider + Core + NPC | Provider rejects summary records in `putRecord()`; summary rejection regression in `tests/sqlite-memory-provider.test.js` | Exact-head Runtime CI #40308513276 | **BLOCKED for summary support; safe rejection PASS** |
| Revoke/source invalidation serialized with actual outbound model dispatch; zero-egress before dispatch-start | Core + Host + Product/Security | No approved callable serializer/dispatch gate identified; existing Provider checks are not atomic with external dispatch | Core/Host owner reports and code mapping | **BLOCKED / NO APPROVED SEAM** |
| Production Memory→NPC enablement | Core + Host + Provider + NPC + Coordinator | Provider implementation PR #359 remains draft; no production default/dispatch wiring added | Global owner gates | **DISABLED / FAIL-CLOSED** |

The current Provider code/test evidence is from Runtime CI run [#40311905777](https://github.com/necromorphic/Logic-Engine/actions/runs/40311905777) on exact head `62647f66f0596e5b332e6c23e586007d4a156ab7`; Runtime CI passed on this head. The final reconciliation compare-and-publish is serialized under `BEGIN IMMEDIATE`; per-record/query grant lifecycle generations and Provider index-state generation are checked across awaited authorization; regression tests cover metadata mutation during reconciliation, index transition during candidate authorization, record revocation, and revoke→regrant of the same grant. These results remain Provider-local and must not be represented as production Host/Core/dispatch verification.

