# 07. Knowledge, narrative and visibility boundaries

Status: proposed core contract.

## 1. Separate four concepts

1. **Canonical fact:** what the engine currently accepts as true in the world.
2. **Subject knowledge/belief:** what a specific entity knows, suspects, disputes or falsely believes.
3. **Narrative delivery:** what text was selected/injected/shown to a user or actor.
4. **Search retrieval:** which archive fragments were retrieved for a model call.

None of these automatically implies the others. A retrieved fragment is not automatically valid; text shown to the player is not automatically known by every NPC; a generated statement is not automatically a canonical fact.

## 2. Knowledge provenance

Every KnowledgeRecord must identify one or more valid sources and the path by which the holder could acquire the proposition. Allowed source kinds are declared by the core contract and/or World Pack, for example:
- direct observation with location/time/visibility constraints;
- communication from a source, with channel and delivery evidence;
- document or recording;
- inference from known premises using a declared rule;
- authorized author-provided knowledge;
- imported initial state with explicit provenance.

The model cannot invent a source retroactively to justify knowledge.

## 3. Access filtering

Before building an actor context, filter:
- world scope;
- subject/role access;
- public/private visibility;
- source validity;
- current knowledge validity;
- sensitivity or secrecy policy;
- confidence and epistemic status;
- whether the fact is current, historical, disputed or retracted.

Vector search must be followed by this access and validity filter. Embedding similarity is not permission to reveal a secret.

## 4. Multiple sources and belief updates

A proposition can be supported by several sources. Invalidating one source triggers reconciliation, not unconditional deletion. If at least one valid source still supports knowledge under the acquisition rules, preserve it. If sources disagree, use the pack's reconciliation rule or mark disputed. A subject may retain a false belief if they have not learned a valid correction.

Do not automatically erase a memory just because objective truth changed; distinguish learning, forgetting, contradiction and rollback of the source event.

## 5. Narrative generation contract

Narrative generation receives a bounded, permission-filtered result package containing:
- confirmed effects that may be narrated;
- unresolved outcomes explicitly marked;
- permitted viewpoint and visibility;
- actor dialogue/action intents approved by simulation;
- player-agency constraints;
- facts intentionally withheld from the current viewpoint.

Narration may add sensory language and stylistic detail but may not create consequential canonical events, change time, reveal inaccessible knowledge, or decide the player's voluntary actions.

## 6. Delivery receipts

A receipt identifies the target, payload/event references, attempt, state and any host confirmation available. Use `injected_unconfirmed` when the host accepted injection but did not confirm visible rendering. Only an actual supported signal can set `shown`.

A delivery failure can be retried without recommitting the underlying world event. A rolled-back event invalidates associated deliveries but does not use delivery state as evidence that the event happened.


## 7. Current implementation boundary and cross-block authorization gate (2026-10-26)

**Status: proposed semantic contract; not an executable authorization service. Production Memory→NPC remains DISABLED / FAIL-CLOSED.**

Core's source review in [issue #140](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6409471135) found no existing callable, executable subject-relative knowledge/acquisition authority. `AuthorizedReadService.readEntityFields()` authorizes selected canonical entity fields; it does not prove that a particular NPC acquired the information. No fields are approved for production disclosure to recipient `model`, purpose `npc_decision`.

### Required evidence for any future subject-relative admission
A future approved contract must establish, using trusted owner-controlled evidence:

1. Authenticated world and recipient/subject scope; caller labels and context-manifest membership are not authority.
2. Exact proposition/source identity and version/lineage, plus authoritative source currentness and retraction status.
3. An allowed acquisition mechanism and its mechanism-specific evidence. Retrieval, candidate assembly, context inclusion, or model-generated claims alone do not establish delivery, receipt, acquisition, or belief.
4. Invalidation/reconciliation semantics for edit, delete, revoke, rollback, rebuild, restart/replay, and missing, unknown, partial, or inconsistent state. Unknown or incomplete evidence fails closed.
5. A final disclosure-time revalidation boundary and a defined consistency guarantee; sequential checks must not be described as atomic.

### Mechanism-specific evidence required (not yet implemented as a callable contract)

The following are candidate semantic requirements for owner review, not a new schema or a claim that these evidence sources exist today:

- **Observation:** authenticated subject, source/event identity, location/time and visibility/access conditions sufficient to establish that the subject could perceive the proposition. World truth or co-location alone is insufficient.
- **Delivered communication:** sender, intended recipient, exact source/version and channel plus a real supported delivery/receipt signal. Candidate assembly, attempted injection, or an unconfirmed send is insufficient.
- **Document/recording:** exact artifact identity/version, source lineage and evidence that the subject accessed or perceived the relevant content; mere archive presence or retrieval is insufficient.
- **Inference:** identified premises already admissible for this subject, a declared inference rule/version, and deterministic replayable derivation evidence. The model's unsupported assertion is not evidence.
- **Authorized author knowledge / imported initial state:** explicit product/World Pack authorization and provenance identifying the initial scope and source. A caller-supplied label is not authority.
- **Unknown or unimplemented mechanism:** UNSUPPORTED / NON_READY; do not infer acquisition from canonical truth, retrieval metadata, Provider row metadata, or a fixture callback.

### Lifecycle and stage invariants

- Source edit/version change requires revalidation against authoritative source identity, lineage and currentness; an unknown version comparison is NON_READY.
- Source deletion/retraction and access-grant revocation are distinct invalidation causes and must be tested separately.
- Rollback/rebuild may restore an earlier projection revision without a monotonically increasing per-source token. Re-evaluate from authoritative restored state; do not use updated_revision, world_revision, or commit_sequence as a substitute for a source journal.
- Restart/replay may reconstruct a claim only from durable, validated evidence and deterministic implemented rules. Missing/corrupt lineage, partial inventory, validator errors, or changing inventory during reconciliation fail closed.
- Multiple independent valid acquisition paths may support one proposition. Invalidating one path triggers reconciliation; it must not erase a still-valid independent path or preserve a claim with no valid path.
- Keep these stages distinct: candidate retrieval → NPC admission → final model disclosure → outbound delivery → recipient receipt → subject acquisition → belief update. Each later stage requires its own supported evidence and cannot be inferred from the previous stage.

### Owner decisions still required before implementation

- **Core / product owner:** confirm the first permitted subject-relative acquisition mechanism and its authoritative source/currentness/retraction authority; decide whether any recipient model, purpose npc_decision field visibility is ever allowed. Current policy remains DENY / NON_READY; no field is approved.
- **Memory Provider:** confirm which immutable record/version/lineage and lifecycle guarantees its existing operations actually provide, and identify where trusted Core/Host authority is absent. Provider metadata cannot mint acquisition evidence.
- **NPC:** confirm the existing consumer's representable input/evidence and narrow projection; do not equate ready/admission with knowledge, delivery, receipt, acquisition or belief.
- **Host/Adapter:** identify the actual outbound send boundary and all enabled/bypassable routes; prove edit/delete/revoke after candidate assembly and before actual release, or mark the route unsupported. Raw ST text retention is not approved.
- **Coordinator:** consolidate one owner-reviewed decision in #264 before any cross-block API/schema design. Each owner must respond ACCEPT, REJECT (with concrete incompatibility), or UNSUPPORTED (with exact missing callable runtime evidence) against this same proposal.

### Acceptance criteria before any production enablement

Using real owner components—not fixture-only validators—prove: source v1→v2 invalidation; delete/retraction distinct from grant revocation; rollback/rebuild even without an increased commit sequence; restart/replay; missing/corrupt lineage and incomplete inventory fail closed; a valid independent second source survives invalidation of the first; authorization/source invalidation after candidate assembly but before actual outbound release results in zero protected content or metadata leakage; and unsupported generation routes remain disabled. Separately evidence admission, disclosure, delivery, receipt, acquisition and belief. These criteria do not themselves authorize production enablement.

### Explicit non-equivalences

- Provider `record_version` versions a Provider record; it is not a canonical source revision.
- Provider `source_version` is currently an opaque supplied token. It has no approved mapping to Core `updated_revision`.
- `world_revision + commit_sequence` is a snapshot freshness marker, not a per-source change/retraction journal.
- Canonical truth does not imply subject knowledge; admission does not imply delivery, receipt, acquisition, or belief.
- A green unit/fixture suite, proposed document, browser guard, or Provider-local adapter does not prove production composition or end-to-end authorization.

### Work allowed before the contract is approved

Owner blocks may continue isolated, non-production work within their existing code and scope: Core may draft the narrow contract and acceptance criteria; Provider may harden Provider-local persistence, identity/lineage validation, tombstone/reconciliation and fail-closed behavior without retaining raw Host text or claiming Core authority; Host may inspect/test the pinned ST lifecycle and actual pre-send boundary, with unsupported paths remaining fail-closed; NPC may finish independent review of NPC-only PRs and preserve the existing admission seam without fabricating a receiver. None of these permissions authorizes a new cross-block API/schema/store, a positive fixture-backed production validator, raw ST-text retention, production wiring, or enabling Memory→NPC.

Before runtime implementation crosses block boundaries, Core, Memory Provider, NPC, and Host must agree on the exact semantic contract and ownership. The coordinator records that agreement in the existing critical-path tracker; it does not unilaterally approve fields or invent wire shapes.

## 8. Execution permissions and the actual disclosure boundary (coordinator clarification, 2026-10-26)

This section records the current evidence and permission boundary; it does not approve a runtime contract or any production field.

### Current owner findings

- Core #140: no executable/callable subject-relative acquisition authority exists. The proposed KnowledgeRecord semantics are not implemented as a callable authority. Policy B remains DENY / NON_READY for `model / npc_decision`; no fields are approved.
- Provider #181: `record_version` versions a Provider record. `source_version` remains opaque and is not mapped to Core `updated_revision`; Provider records do not prove which subject acquired a proposition through an allowed mechanism.
- NPC #149: `MemoryNpcConsumer.retrieveForNpc(request)` is an injected internal seam, not a production receiver. It performs retrieval/admission and a canonical-field read; it cannot establish subject-relative acquisition.
- Host #258: on pinned SillyTavern SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, the inspected `CHAT_COMPLETION_SETTINGS_READY` point precedes serialization for one browser Chat Completions path only. The current candidate patch does not intercept the actual provider-send path; server/provider branches, Text Completions, native/server callers, extensions/custom routes, and other generation families remain unsupported or bypassable. Complete Host inventory and revoke/edit/delete-after-assembly-before-send are not proven.

### Safe permissions before cross-block approval

- **Core:** finish the narrow semantic proposal and list product-owner decisions. Documentation and tests for existing behavior are allowed; no runtime authority, fields, or schema are implicitly approved.
- **Provider:** continue Provider-local immutable identity/version/lineage, duplicate/conflict, tombstone, reconciliation, restart/replay, and fail-closed hardening. Do not treat injected validators or Provider rows as Core or acquisition authority.
- **Host:** continue source-backed investigation and patch applicability/lifecycle tests on the pinned target; classify every route as intercepted, unsupported, or unverified. No claim of a final-send gate unless the actual outbound path is intercepted and tested.
- **NPC:** continue independent review of NPC-only PRs and prepare a minimal consumer adaptation plan against the actual signature. No oracle-only test churn absent a demonstrated defect; no production receiver.

### What would unlock a cross-block implementation

First, Core, Provider, NPC and Host must review the same semantic proposal and explicitly identify what they accept, reject, or cannot implement. The agreement must cover trusted world/subject scope; proposition and source identity; source currentness/retraction; acquisition mechanism and evidence; edit/delete/revoke/rollback/rebuild/restart/replay; unknown/incomplete states; and separate admission, disclosure, delivery, receipt, acquisition and belief stages.

Only then may the coordinator authorize a **specific, minimal implementation diff** with named files, owners, and acceptance tests. That authorization is not permission to enable production. Release remains blocked until an actual callable owner-component path and the real pre-dispatch revalidation/revocation test pass across every enabled generation route. If a route cannot be covered, it must remain disabled/unsupported.

A source-inspected hook, fixture test, patch-apply CI, or sequential recheck is not proof of atomic revocation or complete end-to-end enforcement.

## 9. Reconciled owner evidence and current implementation gate (Core 1.9, 2026-10-26)

This section incorporates the concrete Provider, NPC and Host inputs to central task #264. It records current capability, not desired architecture, and does not approve runtime integration.

### 9.1 Provider raw Host archive is not an executable lifecycle

On Provider PR #344 head `55a8d13efc359dd5d002360eb380feffb7b1b495`, the tuple-shaped raw Host archive operations are explicitly fail-closed:
- `captureRawMessage()` denies capture;
- `readRawMessageVersion()` and `readActiveRawMessages()` deny disclosure;
- `selectActiveRawVersion()` denies source selection;
- `registerRawDerivedCopy()` is disabled.

The corresponding tests establish denial/non-persistence, not successful Host capture or disclosure. The executable Provider record path (`putRecord` / `retrieveCandidates`) is not a mapping for Host tuple `(world_id, conversation_id, message_id, version_id)`. Provider-local duplicate/conflict, direct canonical-entity lineage, grants, index health and reconciliation checks are useful local guarantees, but injected snapshot/source/inventory callbacks are not themselves trusted authority. A green Provider CI run does not prove complete Host inventory or final-send safety.

### 9.2 NPC acquisition and later lifecycle states

NPC owner input confirms that the current consumer supports bounded retrieval/admission and canonical-field projection only within its existing in-process composition. It has no executable evidence for subject-specific observation, delivered communication, document access, inference, author knowledge or imported-state acquisition. A candidate label such as `epistemic_kind: acquired_report` is not acquisition authority.

Keep these stages distinct and independently evidenced: candidate discovery, admission, disclosure authorization, context inclusion, serialization/provider send, delivery, recipient receipt, acquisition and belief. Missing evidence leaves the later stage unknown; no earlier stage implies a later one.

### 9.3 Host boundary and inventory

The pinned Host map identifies browser Chat Completions and Text Completions preparation events, but neither is an installed authorization gate. Server Chat Completions has provider-specific dispatch branches; Text Completions is a separate family; other model-capable routes and callers remain unexhaustively inventoried. No current universal final-send check or real edit/delete/revoke-after-assembly race test is established.

The inspected ST state and lifecycle events do not prove a complete retained-plus-deleted historical inventory or a completeness-guaranteed change feed, nor detection of missed mutations/rollback. Current result: **NO SUCH MECHANISM FOUND / NON_READY**. Do not infer completeness from the Provider's local inventory callback or from retained chat objects.

### 9.4 Current owner status and decisions

| Contract element | Current result | Owner / next gate |
|---|---|---|
| Trusted world + subject/purpose end-to-end | PARTIAL in Core/NPC local composition; UNSUPPORTED across production Host binding | Core defines authority semantics; Host proves authenticated binding across chat switch/copy/import/restore; Provider/NPC consume the same authority |
| Subject-relative acquisition | UNSUPPORTED; no production-supported mechanism | Product/Core owner must select the first acquisition mechanism and authoritative evidence before mechanism-specific acceptance criteria can be approved |
| Provider source/version/currentness | Provider-local record identity/version supported; cross-system source authority/version mapping UNSUPPORTED | Core names canonical source/version/retraction authority; Provider maps only to that approved authority |
| Complete Host inventory and missed-change/rollback detection | NO SUCH MECHANISM FOUND / NON_READY | Host must identify an existing authoritative mechanism with tests, or keep the route NON_READY; no speculative journal/cursor/store is approved |
| Final model disclosure | No production route approved; no universal installed gate or real race proof | Core + Host must identify the actual last pre-dispatch boundary and consistency guarantee; Host proves zero provider egress on deny/unknown/stale for every enabled branch |
| Provider raw archive integration | Explicitly denied on the reviewed Provider head | No capture/read/select/derived-copy wiring until contract and owner review explicitly approve a specific diff |
| NPC consumer integration | No production receiver; admission does not imply acquisition | NPC adapts only after an approved callable contract exists; real-composition positive/negative tests required |

No implicit version equivalence is permitted: Provider `record_version`, opaque Provider `source_version`, Core `updated_revision`, and `(world_revision, commit_sequence)` remain distinct.

### 9.5 Minimum implementation diff after decisions

No implementation diff is authorized yet. After the product/Core acquisition decision and the Core+Host final-boundary/consistency decision, the smallest reviewable implementation proposal must be split by owner and list exact files and tests:
1. Host: stable identity across applicable source roles; authenticated world/session binding; explicit per-route final gate; real deny/unknown/stale and edit/delete/revoke race tests. User messages without `swipe_info[]`, edit ancestry, cancellation/partial output, import/restore and historical deletion require explicit semantics rather than assumed coverage.
2. Provider: only after source authority/inventory are named, map existing operations to the approved source identity/version and currentness/retraction evidence; preserve fail-closed behavior when inventory is incomplete or callbacks are untrusted.
3. Core: expose/approve only the callable authorization semantics and consistency boundary actually agreed by owners; no guessed fields or equivalence mapping.
4. NPC: consume the approved result without inventing a receiver; test that admission alone never sets delivery, receipt, acquisition or belief.

Required acceptance includes valid/invalid scope; authoritative source edit/delete/restore/revocation/rollback/restart/replay; incomplete inventory never becoming authorized-empty; and a real release-boundary race that proves zero unauthorized/stale provider requests. Every route without that proof remains disabled.

**Current release decision:** production-supported acquisition mechanisms = NONE; production disclosure routes = NONE approved. Core policy remains **DENY / NON_READY** for `model / npc_decision`; Memory→NPC remains **DISABLED / FAIL-CLOSED**. This section is documentation only and does not approve API/schema/store/hook changes, raw text retention, or production enablement.

## 10. Core decisions and competing-work reconciliation (2026-10-26)

This is the decision delta requested by #140. It distinguishes decisions Core can make under current authority from product choices and implementation facts that remain unresolved. It does not create a runtime contract or authorize integration.

### 10.1 Decisions Core makes now

| Topic | Core decision now | Decision owner / unresolved choice | Fail-closed consequence |
|---|---|---|---|
| First subject-relative acquisition mechanism | **No mechanism is approved for production today.** Current code does not establish an executable acquisition authority. | **Product owner + Core** must choose the first supported mechanism (for example, a specific observed event, delivered communication, or authorized document access) and define authoritative evidence for that mechanism. This is a product-semantic choice, not inferable from code. | No Memory-derived proposition is represented as acquired by an NPC; no production Memory→NPC route. |
| Source identity/version/currentness | Source-specific identity/version must be authoritative at the source boundary. Provider record identity and opaque source_version do not substitute for Core source revision. updated_revision and (world_revision, commit_sequence) also remain distinct. No implicit equivalence mapping is accepted. | **Core** must name an existing authoritative source/version/retraction operation for the chosen source class. **Host** supplies authenticated source identity for Host-originated sources. **Provider** maps only after the authority and mapping evidence are approved. If no authoritative operation exists, that source class remains unsupported pending a separately approved change. | Missing, ambiguous, stale, revoked, unmapped or unverifiable source/version means non-ready and no disclosure. |
| Deletion, restoration, rollback and reconciliation | Source deletion/retraction, access-grant revocation, rollback/rebuild and restoration are distinct. Restoration does not automatically reinstate authorization. Uncertain source closure or incomplete/interrupted reconciliation invalidates readiness. commit_sequence alone is not a source-change journal. | **Core + Provider**, with **Host** for Host-originated changes, must identify the existing authoritative operation and completion evidence for each supported source class. Exact reconciliation trigger/completion mechanism remains undecided until an existing operation is identified; this decision approves no journal, cursor, outbox or store. | Fail closed until source currentness and reconciliation are re-established; never convert unknown/incomplete inventory into ready-empty. |
| Trusted world/session/subject/purpose | Reuse ActorBindingService / AuthorizedReadService only for their existing narrow guarantees. Actor binding does not prove NPC acquisition. Caller labels, chat names, candidate metadata and manifest membership are not authority. | **Core** owns authorization semantics. **Host** must prove authenticated world/session binding across chat switch, copy/import/restore and restart. **NPC/Provider** must consume the same approved binding. End-to-end binding remains unproven. | Missing, caller-only, ambiguous or mismatched binding means deny and no protected content. |
| Final pre-disclosure check | The check must occur at the last controllable boundary before the actual model request is released—not at retrieval, manifest creation, browser preparation, or Core HTTP response serialization. **No production route is approved.** | **Core + Host** must identify the exact callable final boundary and approve the consistency guarantee. Host must enumerate outbound branches and prove zero provider egress on deny/unknown/stale. Provider checks currentness only against approved authority; NPC admission cannot substitute for release authorization. | Every uncovered route stays disabled; failure must not release protected bytes, snippets, counts, source identifiers or diagnostics. |
| Revocation race / linearization | Sequential rechecks are not an atomic cross-process revocation guarantee. Core does not claim atomic revocation at model send without a demonstrated shared consistency boundary. | **Core + Host**, with Provider input, must choose and prove the permitted race guarantee at the real release boundary. If it cannot be enforced, the route stays disabled rather than silently weakening the semantics. | A revoke/edit/delete after candidate assembly but before release must be covered by the agreed guarantee; absent proof, deny/unsupported. |
| Raw Host text retention | **Not approved** under this contract. | Product/security owner must separately approve purpose, retention, access, deletion and audit semantics before any raw-text persistence/transfer. | No raw Host text capture/transfer under this contract. |

### 10.2 Acceptance tests and exact dependencies

These are required future tests, not claims that the path currently exists.

| Case | Existing anchor / future test location | Required result | Dependency |
|---|---|---|---|
| Wrong world/subject/purpose, caller-supplied identity, chat switch/copy/import/restore | src/application/actor-bindings.js; src/application/authorized-read-service.js; src/application/memory-npc-consumer.js; then real Host→Core→NPC integration tests | Deny; zero protected content and no side-channel | Host authenticated binding + Core-approved recipient semantics |
| Stale, edited, deleted, restored, revoked or lineage-conflicting source | src/application/sqlite-memory-provider.js provider-local tests; src/application/memory-npc-consumer.js candidate checks | Reject source and dependent summaries; no stale disclosure | Core names source authority/version/retraction semantics; Provider maps and tests them |
| Incomplete inventory, missed mutation, interrupted reconciliation, restart/replay, rollback | Provider reconciliation tests and tests/authorized-read-service.test.js; later real multi-component tests | Non-ready, not ready-empty; no disclosure until version-bound reconciliation is proven | Host complete/current inventory evidence + Provider reconciliation evidence + Core rollback semantics |
| Revocation/edit/delete after candidate assembly but before provider send | No production send gate currently exists; future test at Host's identified final outbound dispatch using actual Provider/Core/NPC composition | Zero provider egress for deny/unknown/stale under the agreed race guarantee | Core + Host select and implement a provable final release boundary; Provider supplies authoritative recheck |
| Unsupported route, validation timeout/error, ambiguous identity | Host route-specific dispatch tests + real integration harness | Route disabled or request blocked before protected bytes leave | Host route inventory + Core policy + Provider fail-closed validation |
| Admission vs disclosure/delivery/receipt/acquisition/belief | tests/memory-npc-consumer.test.js; tests/npc-memory-candidate-eligibility.test.js | Admission alone never sets later lifecycle states | Product/Core selects mechanism-specific acquisition evidence; NPC implements approved semantics |
| Canonical field read racing rollback with unchanged commit_sequence | tests/authorized-read-service.test.js; PR #330 head 460587bc3538c8704055f1f2e781d8722874909e | Existing regression rejects with STALE_AUTHORIZED_READ_SNAPSHOT; preserve this test | Existing bounded Core read contract; does not prove Host final-send atomicity |

### 10.3 Reconciliation of related Core work

The canonical cross-block knowledge-boundary proposal is this PR (#347) plus Core gate #140. Do not maintain a second competing Memory→Core→NPC contract.

| Work | Unique material / disposition |
|---|---|
| #256 docs/memory-core-npc-unified-contract.md | Broadly duplicates the source-authority/version/lineage/inventory/reconciliation/revocation contract now consolidated here. Keep useful source/test references as history/cross-links; close the competing document PR after this incorporation is reviewed. Do not merge a second contract document. |
| #261 contextual interpretation | **Not a duplicate.** Preserve docs/56-context-aware-interpretation-of-communicative-intent.md, README/architecture index changes, and the 20-case fixture/test corpus. These are semantic fixture guardrails, not runtime/LLM/acquisition proof. Keep its separate scope. |
| #263 evaluation/recalculation boundary | **Not a duplicate.** Preserve docs/57-core-evaluation-recalculation-boundary.md and its source-backed distinction between current proposal/commit/scheduler/read primitives and absent universal dependency/recalculation/publication machinery. Keep its separate scope. |
| #330 rollback-during-authorized-read regression | **Unique test; preserve.** Keep tests/authorized-read-service.test.js and exact-head evidence. It proves rollback during the bounded Core authorized read is rejected; it does not prove cross-store revocation or zero egress at Host model send. |
| #345 integration matrix refresh | Operational matrix/index refresh, not a second semantic contract. Keep the cross-block integration matrix as the status/index surface and point it to #140/#347 as the single knowledge-boundary decision record. Preserve dated evidence and route blockers; do not duplicate the full contract table there. |
| #346 release-boundary proposal | Its source-inspected MemoryNpcConsumer / AuthorizedReadService / src/api/server.js distinction and proposed owner split are incorporated in §§10.1–10.2. Close the competing proposal after this incorporation is reviewed; no separate release-boundary document should compete with #347. |
| #348 subject-relative acquisition proposal | Already closed as duplicate of #347. Keep closed; do not revive or merge its duplicate document. |

This reconciliation does not itself close PRs or alter their branch contents. The coordinator/PR owners should apply the disposition after verifying the unique material named above is retained in the canonical branch or distinct scoped artifact.

### 10.4 Exact-head owner confirmation

Provider accepted the previous section-9 delta on commit 8dc8f89d3a991295a213e6a3e0df63788d03528e (comment #6410460989). That acceptance does not approve this new section 10. The updated exact head must be reviewed separately by:
- **Provider:** source/version/currentness and deletion/reconciliation wording;
- **NPC:** acquisition-vs-admission and lifecycle-state semantics;
- **Host/Adapter:** authenticated binding, inventory limits, route coverage and final release boundary;
- **Product owner + Core:** first supported acquisition mechanism and authoritative evidence;
- **Core + Host:** last pre-disclosure boundary and permitted revocation-race guarantee.

Required response on the exact updated head: ACCEPT, REJECT with a concrete contradiction, or UNSUPPORTED with exact missing evidence. Until responses and product/Core decisions exist, this remains a decision record only.

**Current release decision:** production-supported acquisition mechanisms = NONE; production disclosure routes = NONE approved; Core policy = **DENY / NON_READY** for model / npc_decision; Memory→NPC = **DISABLED / FAIL-CLOSED**. No API/schema/store/hook, raw-text retention or production enablement is approved by this document.


## 11. Scene integrity and durable episodic memory — minimal contract (Core 1.9, 2026-10-26)

**Status:** semantic proposal for owner review. The product requirement is durable recall of coherent scenes with source-grounded detail, not only disconnected extracted facts. This section defines the minimum meaning and acceptance boundary; it does not approve a runtime schema, raw Host-text retention, a new store/API, or production Memory→NPC.

### 11.1 What counts as a scene

A **scene/episode** is the smallest bounded, source-grounded interval of world activity that can be understood as a coherent occurrence: it has an identifiable beginning/end or explicit open boundary, an ordered set of actions/changes, participating entities and relevant objects, and enough temporal, spatial, causal and sensory relations to distinguish what happened from a bag of facts. A scene may span multiple messages or source records; one message is not automatically one scene, and one scene is not necessarily one message.

A scene is **complete for a declared purpose** only when its retained evidence is sufficient to answer the declared recall questions without silently inventing missing details. Completeness is purpose-relative and must be reported as supported, partial, conflicting or unavailable—not inferred from a summary's fluency. At minimum, assess:

- **Identity and boundaries:** stable reference to the occurrence and its source records/versions; known start/end or explicit uncertainty.
- **Temporal structure:** ordering, simultaneity where supported, and known gaps; do not fabricate exact times.
- **Participants and objects:** who/what is evidenced as present or involved, with identity ambiguity preserved.
- **Spatial relations and motion:** only evidenced positions, visibility, orientation, movement and changes; unknown layout remains unknown.
- **Actions and outcomes:** observed or source-recorded actions, their order, and confirmed versus unresolved consequences.
- **Sensory/source detail:** relevant dialogue, sounds, visible details and other source content actually preserved; do not claim a channel was captured if it was not.
- **Viewpoint and provenance:** for each subject-relative detail, what source supports it and whether the subject could perceive/access it.
- **Uncertainty and contradictions:** missing, ambiguous, disputed or incompatible evidence stays explicit.
- **Lineage and lifecycle:** source versions, derivation links and the effect of edit/delete/retraction/revocation/rollback/restore are traceable.

This is a semantic checklist, not a proposed field list. Existing contracts and implementations must be inspected before deciding where or how any item is represented.

### 11.2 Four different things; never collapse them

1. **Original source/event evidence** — the actual source material available to the engine (for example, a source event record, dialogue/message, observation record, or document). Preserve its identity, version and provenance. A source existing in storage does not mean every NPC can access it.
2. **World-side scene record/reconstruction** — a structured account of the occurrence assembled from one or more sources. It may combine evidence, but must preserve conflicts and gaps rather than presenting inference as original source. It describes the world-side event; it is not a record of every character's knowledge.
3. **Derived representation** — extracted facts, a compressed summary, an index/embedding, or a spatial/temporal snapshot. Each is a derivative with a traceable source lineage and an explicit indication of whether detail is lost. A summary or embedding is not the original scene and cannot, by itself, prove exact wording, perception, or source currentness.
4. **Character-specific episodic memory and later recall** — what a particular NPC actually perceived/acquired, retained, forgot, inferred, and can currently recall. It is subject-relative and may be incomplete, mistaken, uncertain or contradicted. A complete world-side scene or a retrieved archive chunk must not automatically become this NPC's memory.

Canonical world truth, source availability, scene reconstruction, search retrieval, authorized disclosure, acquisition, recall and belief remain separate states. No transition is implied without evidence from the relevant mechanism.

### 11.3 Minimum lineage and lifecycle rules

- Every derived scene representation must be traceable to the source identities and versions it depends on, using existing approved contracts where they suffice. Do not invent a universal ID/version field or assume Provider `record_version`, opaque `source_version`, Core `updated_revision`, and `(world_revision, commit_sequence)` are interchangeable.
- Preserve original source evidence separately from summaries/facts/snapshots when the approved retention policy permits it. If the original is not retained or is no longer available, mark that limitation; never label a reconstruction as the original.
- A source edit/version change invalidates or revalidates dependent representations. Deletion/retraction, access-grant revocation, rollback, restoration and retention-policy purge are distinct causes and must not be treated as synonyms.
- Restoration does not automatically restore access rights. Rebuild/replay may re-establish a derived representation only from authoritative current evidence and deterministic supported rules.
- If source inventory is incomplete, reconciliation is interrupted, lineage is missing/corrupt, or currentness cannot be established, affected representations are NON_READY for source-dependent disclosure. Do not translate unknown/incomplete into “empty and valid.”
- Invalidate only the unsupported derivation path. If an independent valid source remains, retain that support after reconciliation; if no valid path remains, do not present the dependent detail as supported.
- Compression, indexing and tiering may change retrieval efficiency, but may not silently upgrade a lossy representation into an authoritative source. Recalling a detail absent from retained evidence must return unknown/uncertain, not a plausible invention.

### 11.4 Representation options — trade-offs, not an architecture selection

| Representation | What it preserves well | What it loses or cannot prove alone | Contract position |
|---|---|---|---|
| Original source/event record or transcript | Concrete source wording and recorded details; strongest anchor for source-grounded reconstruction | May omit spatial layout, unrecorded sensory information, or what a particular NPC perceived; can be large and sensitive | Preserve when policy and available source permit; access/version/deletion controls are mandatory |
| Derived structured episode with ordered actions and relations | Temporal order, entities, event relations and queryable details | May omit exact wording, nuance or details not extracted; extraction can be wrong | Useful derivative; must link to source and expose gaps/conflicts |
| Summary/facts only | Compact search and quick orientation | Loses detail and relationships; cannot reliably reconstruct omitted scene specifics | Never the sole authoritative record when scene-complete recall is required |
| Spatial/temporal snapshot or future 3D world-state representation | Positions, poses, layout and changes at represented points in time | A snapshot can miss dialogue, sound, causal sequence, subjective viewpoint and events between snapshots | Optional complementary representation; not selected or assumed implemented |
| Hybrid source + episode + selective snapshots/summaries/indexes | Can combine source fidelity, structured retrieval and spatial reasoning | More lifecycle/reconciliation complexity; all derived copies need lineage and access control | Best candidate to evaluate against acceptance tests, not yet an approved implementation |

**Current recommendation:** design toward a hybrid semantic model—source-grounded episode plus optional derived representations—because no single summary, transcript or snapshot proves all required dimensions. This is a design direction only; implementation must reuse existing approved mechanisms where possible and name any missing capability before proposing an API/schema/store.

### 11.5 Acceptance criteria for scene integrity

These are observable criteria for a future implementation, not claims that tests or production wiring already exist.

1. **Long-term recall:** retrieve an old scene after intervening activity without relying only on recency; locate relevant detail through more than one query formulation or cue.
2. **Coverage and source fidelity:** for a fixed review set of source-supported details, report which details are retained/retrievable, which are missing, and which are derived. Do not score fluent reconstruction as correct without comparing it to evidence.
3. **Temporal coherence:** preserve supported order and distinguish simultaneous, unknown and conflicting order; do not add unsupported events or exact timestamps.
4. **Spatial coherence:** preserve only supported positions/relations/movement. If no spatial source exists, explicitly report spatial detail as unavailable rather than infer a complete layout.
5. **Viewpoint separation:** two NPCs with different sightlines/access receive only their own supported perceptions and authorized information. A private observation of NPC A must not appear in NPC B's context unless B later acquires it through a separately valid path.
6. **Stage separation:** tests independently check source stored, scene reconstructed, derivative indexed, candidate retrieved, disclosure authorized, context included, delivered, received, acquired, recalled and believed. No earlier stage sets a later stage by implication.
7. **Compression transparency:** after summarization/indexing/tiering, compare against the source-backed detail set; identify loss and ensure missing details are not presented as source-grounded recall.
8. **Lifecycle propagation:** source v1→v2, delete/retraction, grant revocation, rollback with unchanged `commit_sequence`, restore, restart/replay and interrupted/incomplete reconciliation must invalidate or revalidate every dependent representation according to the approved rule.
9. **Multiple-source reconciliation:** invalidating one source preserves a genuinely independent valid support path; invalidating the last valid path removes readiness for dependent disclosure.
10. **No-invention behavior:** deliberately omit a detail from all accessible retained evidence; the recall path must answer unknown/uncertain rather than reconstruct it as fact.
11. **Access and failure isolation:** unknown subject/world, stale lineage, incomplete inventory, validation error/timeout, or unsupported Host route results in deny/NON_READY and zero protected content leakage.
12. **Retention policy:** tests establish the approved retention/purge behavior for source material and derivatives, including the effect of a purge on dependent representations. No raw-text retention is enabled by this semantic contract alone.

Acceptance requires evidence from the actual owner components and real retrieval/disclosure path. Fixture-only tests, document agreement, a green isolated Provider suite, or a proposed 3D model do not establish end-to-end scene fidelity or authorization.

### 11.6 Decisions: what needs product-owner choice, and what does not

**Already decided by product intent:** coherent scene recall must preserve concrete event details and relationships over the long term; isolated extracted facts alone are insufficient. Observation is the conceptual first way NPCs learn about the world, but the first integration test may use a simpler end-to-end mechanism. Scene storage does not imply universal NPC knowledge. A future 3D/snapshot capability is optional, not a prerequisite.

**Technical design should not be bounced to the product owner:** Core/Provider/Host/NPC must compare the representation options, map existing source and lifecycle operations, recommend a minimal retention/lineage design, identify actual missing operations, and propose measurable coverage/loss checks. Do not ask the product owner to choose a database, field names, API, index, or reconciliation algorithm before that evidence exists.

**Only unresolved product/security choices requiring explicit owner approval:**

1. **Raw source-text retention permission and policy:** whether original Host/ST message text may be persisted/transferred at all, for what purpose, access scope, retention period, deletion/purge behavior and audit requirements. The preference for scene fidelity is not itself authorization to retain raw Host text. Until approved, existing raw Host archive operations stay disabled.
2. **Retention horizon and resource ceiling:** if the implementation cannot preserve all source material indefinitely, set the acceptable retention horizon/resource budget and what must happen when it is reached (for example, purge, archive/tier, or mark recall as degraded). The technical team should present measured cost/fidelity options before asking for this decision.

No other product choice is required to complete the first technical comparison. Memory→NPC remains **DISABLED / FAIL-CLOSED** until the acquisition, source authority/currentness, lifecycle reconciliation, subject binding and final-send gates in §§7–10 are independently satisfied.


## 12. 3D thinking / spatial-temporal world model — architectural status and next step (2026-10-26)

**Status: previously recorded product direction; not yet a formally specified subsystem or an approved Core runtime component.** The intended capability is an internal, time-aware representation of where entities and objects are, their spatial relations, positions/poses, and changes/movement after events. Future visualization is optional and must not be confused with the reasoning/state model itself.

### 12.1 Boundary: Core vs spatial-temporal subsystem

Do not implement all spatial reasoning as ad hoc logic inside Core, and do not create a second canonical world-state store.

- **Core remains authoritative** for canonical world state, event/transaction commit, world/session identity, revision and rollback semantics, and the approved interface through which world changes become canonical.
- A future **Spatial/Temporal World Model** may be a separately testable engine subsystem that derives/maintains spatial relations and time-indexed scene state from canonical events/state through an approved Core-owned seam. It must not independently commit canonical facts or silently disagree with Core.
- **Scene/episodic memory** consumes source-grounded events and, when available, spatial-temporal state as a complementary representation. It must retain provenance and must not infer that every NPC perceived every world-state change.
- **Visualization/rendering** is a later optional consumer of the spatial-temporal model; no renderer or 3D graphics stack is required to prove the logical model.
- The exact module owner, persistence model, update/replay contract and interfaces are **not yet approved**. This section establishes a boundary to investigate, not a new runtime API/schema or a commitment that a spatial subsystem already exists.

### 12.2 Should development start now?

**Yes: start a bounded design-and-feasibility track now, in parallel with the Memory→NPC critical path. Do not start a full production implementation or make it a prerequisite for current Memory→NPC work.**

First deliverable should be a short architecture spike, not a new runtime store:
1. Define the minimal spatial-temporal concepts required for a scene: entity/object identity, location/coordinate frame or relative spatial relations, orientation/pose where relevant, time/order, movement/change, uncertainty, and source provenance. This is a concept checklist, not field names.
2. Identify which canonical events/state the current Core actually exposes and whether they are sufficient to derive the model. Map exact existing code paths and missing guarantees.
3. Compare a derived in-memory projection, a persisted/rebuildable projection, event-linked scene records, and optional snapshots. Do not assume snapshots capture between-snapshot actions, dialogue, sounds, or viewpoint.
4. Specify deterministic update, replay, rollback/rebuild, unknown/conflicting positions, object creation/removal, teleport/scene transition, and multiple-world isolation behavior.
5. Define a small measurable prototype/test set: apply a sequence of supported movement/pose events; reconstruct state at a chosen time; replay and rollback; represent unknown/conflicting positions without guessing; verify that derived state never becomes canonical without Core commit.
6. Report implementation owner, minimal seam, files/modules likely affected, dependency on Core event semantics, resource/cost estimate, and an explicit go/no-go recommendation before runtime integration.

### 12.3 Priority and non-goals

This track is **parallel exploratory architecture work**, not a blocker for Provider-local implementation, Host lifecycle evidence, NPC-only work, or the current Memory→NPC gate. It must not alter the existing Ollama vectorization/remote-store patch.

Do not build a graphics engine, animation system, image/screenshot pipeline, or general-purpose physics simulator merely because the capability is called “3D thinking.” First prove the minimum logical spatial-temporal state model. A “snapshot” may be one derived representation, not the source of truth and not a substitute for a coherent episode.

No new API/schema/store, Core event contract, or production dependency is approved by this section. After the spike, Core and the relevant subsystem owner must review the exact proposed boundary and tests before implementation crosses block boundaries.

### 12.4 Bounded feasibility spike — current Core evidence and go/no-go

**Scope of this inspection:** current `main` base commit `bf35fb8dd13628718dacc11c27654c0929fba0e2`; source inspection only. This is not runtime execution or a claim that the broader target documents are implemented.

#### Existing usable primitives

- `src/storage/sqlite-store.js` defines canonical `worlds`, `world_events` and `entities` tables (current base file blob `bf713de7bb6caedecf9d5e8026055d9147f94185`, around lines 161–181). Events already have world/event identity, `game_time`, `committed_revision`, `commit_sequence`, validity, causal/read-set metadata, `effects_json`, and optional `source_message_id`. Entities store `attributes_json` and `updated_revision`. This is a usable event/state substrate, but it is not a scene archive: the event row does not contain a guaranteed complete source transcript, sensory record, viewpoint, or typed spatial history.
- The same file exposes bounded state/event reads and projections (`readSnapshot`, `state`, `events`, `currentEntityProjection`, `entityProjectionAtCursor`, `factProjectionAtCursor` around lines 641, 884–930, 1057–1087), canonical commit (`validateCommit` / `commit`, around lines 1162–1400), and rollback/rebuild paths (`rollback` / `rebuild`, around lines 1876 and 2109). These are the candidate existing seams to study; this section does not approve a new consumer hook or assert that they expose a public projection API.
- `docs/13-event-type-contract.md` explicitly says `event_type` is descriptive metadata, not a trust boundary. A spatial event cannot be treated as authoritative merely because of its event-type string.
- `src/time/model.js` provides pure integer time-coordinate/calendar primitives. `src/time/scheduler.js` is a pure due-work planner and explicitly does not read/write storage, execute effects, or grant knowledge. Neither is a spatial engine or a canonical movement executor.
- `docs/01-core-domain-model.md` describes WorldEvent, Entity and StateFact as a proposed domain model; `docs/18-rollback-and-causality.md` is a target architecture. `docs/21-stage1-causality-contract.md` is the narrower current-runtime boundary and explicitly limits claims about causal completeness. Do not treat the target docs as proof that every listed semantic is implemented.

#### Findings and limits

1. **No typed spatial-temporal model was found in the inspected Core store/module paths.** The current entity attribute JSON could technically hold a location-like value, but that alone gives no validated coordinate frame, units, pose semantics, temporal validity, movement continuity, uncertainty, or conflict resolution. Treating arbitrary attributes as a supported spatial contract would overstate the implementation.
2. **The existing event substrate is the most plausible source for a derived projection, not an independent canonical store.** A future projection would need to consume only successfully committed canonical events/state and be rebuildable after rollback/replay. It must never mutate canonical state or authorize effects itself.
3. **The current Core event record is not enough to promise scene-complete recall.** `source_message_id` is only a reference; the inspected event row does not guarantee original message text or all observed sensory details are retained. Host must prove what source material can actually be captured/versioned, and Provider must separately propose an approved retention/lineage path. Until then, exact dialogue/sensory fidelity is unsupported where the original source is unavailable.
4. **Cross-world isolation must be preserved.** Any future derived projection must be partitioned by the existing world boundary and tied to the relevant committed state/replay point. Do not infer current spatial state from a stale snapshot or merge worlds on matching entity names.
5. **No-go for production spatial integration at this stage.** There is enough substrate to run a bounded prototype against existing committed events, but not enough evidence to approve a durable spatial schema/store, event vocabulary, API, or canonical movement effects.

#### Minimum spike and measurable checks

Use a disposable test fixture and existing store/event paths only; no production schema or public API change:

- **Projection from committed effects:** apply an existing supported entity create/update sequence whose attributes encode a deliberately simple test position/pose; verify the derived view follows committed revisions only and ignores rejected/uncommitted proposals.
- **Deterministic reconstruction:** from the same valid event sequence and pinned inputs, rebuild the same projection at a chosen commit cursor.
- **Rollback:** retract a source event through the existing rollback path; verify the derived view no longer exposes effects supported only by that event, while an independent surviving source remains.
- **Unknown/conflict:** omit a position or provide incompatible source-supported positions; the projection must preserve unknown/conflict rather than choosing a plausible value.
- **World isolation:** same entity identifier in two worlds must never share spatial state.
- **No authority escalation:** projection output must not become a canonical fact or NPC-acquisition evidence without a separate approved Core commit/knowledge contract.

**Go/no-go:** GO only for this bounded, disposable feasibility spike and source-backed design report. NO-GO for production persistence, public contract/API/schema, automatic movement commits, or use as Memory→NPC authority until Core and the relevant spatial-temporal owner approve the exact seam and tests. The spatial spike remains parallel work and is not a blocker for independent Provider, Host or NPC tasks.


## 13. New chat handoff — Spatial/Temporal World Model feasibility owner (2026-10-26)

**Canonical task:** [Issue #350 — Spatial/Temporal World Model bounded architecture and feasibility spike](https://github.com/necromorphic/Logic-Engine/issues/350).

### Mission for the new chat

Own only the bounded architecture/feasibility spike described in issue #350. The goal is to determine what can be proven from the current Core implementation and what would be needed for a future time-aware spatial representation of entity/object locations, spatial relations, orientation/pose and movement/change. Do not treat “3D thinking” as a request to build a renderer, animation engine, physics simulator, or screenshot pipeline.

### Starting evidence and baseline

- Read sections 11, 12, and 12.4 of this document before proposing architecture.
- Current documented Core inspection baseline: `main` commit `bf35fb8dd13628718dacc11c27654c0929fba0e2`; the evidence summary in §12.4 names the inspected files and approximate line ranges. Re-check the current branch/head and file lines before relying on that snapshot.
- Relevant candidate substrate: `src/storage/sqlite-store.js` canonical `worlds`, `world_events`, `entities` tables; snapshot/state/event reads; current entity/fact projections; canonical commit; rollback/rebuild. These are candidate existing primitives, not approval of a spatial API.
- Current negative finding: no typed spatial-temporal model was found in the inspected Core paths. Arbitrary `attributes_json` is not a spatial contract. Existing event rows do not guarantee a complete original transcript, sensory record, or subject viewpoint. A source-message reference is not the source itself.
- Current disposition: GO for a disposable, bounded feasibility spike against existing paths; NO-GO for production persistence, new public API/schema/store/event vocabulary, automatic movement commits, or Memory→NPC authority.

### Hard boundaries

1. Core remains the canonical authority for world state, committed events/effects, world/session identity, revision and rollback/rebuild semantics.
2. Any spatial model is a derived projection/read model. It must not independently commit canonical facts, execute world effects, become a second canonical store, or silently diverge from Core.
3. Do not invent APIs, schema fields, stores, journals, event types, hooks or lifecycle contracts. If existing code cannot support a required guarantee, mark it missing and name the owner/decision needed.
4. This work is isolated and parallel. Do not modify Core runtime, Memory Provider, NPC, Host/Adapter, their active PRs, or their contracts. Do not block their current tasks.
5. Do not touch the existing SillyTavern Ollama vectorization/remote-store patch.
6. Memory→NPC remains DISABLED / FAIL-CLOSED until its own acquisition, authority, lineage, inventory/reconciliation, revocation and real disclosure-boundary gates pass. The spatial model cannot bypass or satisfy those gates by itself.
7. Scene-complete episodic memory remains a separate requirement: source evidence, world-side scene reconstruction, summaries/facts/indexes/snapshots, and each NPC’s viewpoint-specific memory are distinct. Never infer that every NPC perceived all world changes. Never fill gaps with plausible invention.
8. Visualization is optional and out of scope for this spike.

### Required work and deliverables

- Pin exact branch + commit SHA and cite exact files/line ranges/tests for every repository claim. Re-check the current head rather than relying on a prior audit.
- Trace the actual current Core event/state paths and classify each claim as verified by code, verified by test, documentation-only, partial, or absent.
- Define the minimum concepts (identity, world isolation, spatial relation/coordinate assumptions, pose/orientation, time/order, movement/change, uncertainty/conflict, provenance) without prematurely naming fields.
- Compare: (a) in-memory derived projection, (b) persisted but rebuildable projection, (c) event-linked scene/episode records, and (d) snapshots as checkpoints/accelerators. Explain replay determinism, rollback, staleness, recovery, provenance, scene completeness, cost and limitations.
- Define failure behavior for uncommitted/rejected changes, duplicate/out-of-order inputs, missing or conflicting positions, create/remove, movement/teleport, rollback/rebuild, restart/replay, and multiple-world isolation. Mark anything the current contract cannot guarantee.
- Run only a small disposable feasibility spike using existing store/event paths. At minimum test: committed effects only; deterministic rebuild at a chosen cursor; rollback removes unsupported derived effects; unknown/conflicting position remains unknown/conflicting; same entity identifier in separate worlds never shares state; projection cannot become canonical truth or NPC acquisition evidence.
- Report reproducible commands, exact outputs and SHA. Do not say tests passed unless actually run. Use Context7 for current library/API references where relevant and Superpowers-style verification/test-first discipline; distinguish those workflow aids from repository evidence.
- Deliver a short decision brief: recommendation, rejected options, smallest next step, owner/seam/dependencies, measurable acceptance criteria, estimated cost, and explicit Core/product decisions. End with GO/NO-GO and why.

### Stop condition

This chat’s task is complete when the evidence-backed design report and test matrix are available on a dedicated documentation branch or a proposed documentation PR, and another reviewer can reproduce the claims. It is **not** complete merely because a conceptual schema or mock implementation exists. Do not implement production runtime changes without a separately reviewed, explicit Core approval of the exact seam and diff.



### 13.1 Explicit boundary with the existing Time / TimeEngine block (2026-10-26)

The Spatial/Temporal World Model must reuse the existing Time subsystem; it must **not** create a second clock, time-advance mechanism, calendar, due-work scheduler, trigger registry, or process-milestone scheduler.

The current Time/Process Manager contract is tracked in [issue #243](https://github.com/necromorphic/Logic-Engine/issues/243), with related milestone-scheduling contract review in [PR #249](https://github.com/necromorphic/Logic-Engine/pull/249). Issue #243 describes the existing durable time-advance substrate, including canonical millisecond coordinates, versioned calendar/TimePolicy, deterministic `(from, to]` planning, atomic bounded segment commits, world-scoped triggers, interruption and SQLite restart recovery. Process lifecycle work is intended to reuse that pipeline rather than introduce a second scheduler. Re-check current code/heads during the spike; issue/PR descriptions are not by themselves proof that every claim is merged into `main`.

**Responsibility split for the feasibility study:**

- **Time / TimeEngine owns temporal progression:** game-time coordinates and calendar/policy semantics; explicit advancement; due-work ordering and triggers; process/milestone scheduling and interruption/replanning within its approved contract. Game time does not advance merely because real time passes or the application is idle.
- **Core owns canonical state and commits:** validates/commits world effects and revisions, with rollback/rebuild semantics. Time may propose/coordinate advancement but must not bypass Core's canonical transaction path.
- **Spatial/Temporal World Model studies spatial state over the existing temporal axis:** location/relative relations, orientation/pose, movement and scene state indexed to the TimeEngine's canonical game-time coordinate and supported committed-event/revision cursor. It consumes existing approved time/event/state outputs; it does not advance time or schedule work itself.
- **Scene/episodic memory preserves source and viewpoint:** it may use event order and spatial-temporal state as complementary evidence, but does not treat world state as proof that a particular NPC observed or remembers it.

**Required checks in the new-chat spike:**

1. Map the exact existing TimeEngine coordinate, advancement, event/segment and revision/cursor contracts; record exact paths, SHA and tests.
2. Identify which of those are actually available to a derived spatial projection without a new API. If the seam is not callable or the semantics are insufficient, report the gap instead of inventing an adapter contract.
3. Test reconstruction against TimeEngine's existing game-time coordinate and committed Core cursor, including equal-time events, interval boundaries where relevant, interruption/replay and rollback. Do not introduce a second ordering rule that conflicts with the existing deterministic `(from, to]` planning semantics.
4. Keep two questions separate: “what spatial state was canonical at a supported game-time/revision point?” and “what did this NPC perceive/acquire?” The latter remains governed by the existing Memory→NPC authorization gates.
5. Any proposal to change TimeEngine, its calendar/policy, trigger/process scheduling, Core commit semantics or event schema is **out of scope** for this spike and requires a separate owner-reviewed task/approval.

This clarification narrows §12's phrase “time-aware representation”: “time-aware” means keyed to the existing TimeEngine's approved temporal coordinates and canonical Core history, **not** an independent time subsystem. No new runtime contract is approved here.
