# Private Host–Core–Memory–NPC Adapter Contract

Version: 0.1  
Status: **APPROVED AS PRIVATE ARCHITECTURE CONTRACT; NOT A PRODUCTION API OR ENABLEMENT APPROVAL**  
Decision authority: project owner delegated architectural decisions for Core, Memory, Host and NPC to the coordinator.  
Scope: contract semantics and implementation boundaries only. No runtime wiring, schema migration, public endpoint, or production enablement is authorized by this document.

Related evidence:
- `docs/56-npc-memory-boundary-acceptance-matrix.md`
- `docs/50-npc-initial-knowledge-acquisition-contract.md`
- `docs/76-core-cross-block-decision-register.md`
- `docs/86-cross-block-authority-and-npc-integration-contract-proposal.md`
- `docs/91-core-owned-trusted-initial-knowledge-source-decision.md`
- `docs/92-trusted-initial-knowledge-importer-operations.md`
- `docs/architecture/core-final-disclosure-authorization-contract.md`
- Core candidate PRs #709, #744; NPC candidate PR #695; Host/Gateway candidates #646, #680, #689
- `src/npc/memory-candidate-eligibility.js`
- `src/application/memory-npc-consumer.js`
- `src/application/sqlite-memory-provider.js`
- `src/application/authorized-read-service.js`
- `src/application/actor-bindings.js`

## 1. Decision

This document resolves the private adapter architecture and the semantic decisions required to plan implementation.

### 1.1 Delegated decision record

| Decision | Project decision |
|---|---|
| D1 — Prepare private adapter contract | **YES** |
| D2 — Core owns authorization and canonical state/commit | **YES** |
| D3 — Host owns session authentication and sole Gateway | **YES** |
| D4 — NPC owns belief semantics and cognition | **YES**; Core owns durable authoritative persistence where enabled |
| D5 — Change another block's API without explicit owner approval | **NO**; schema, semantics, guarantees and behavior are included |
| D6 — Automatically enable production after tests | **NO** |

The project owner delegated architectural decision authority for the four blocks to the coordinator. This document records the resulting decisions for this contract only. It does not grant blanket approval for unspecified future API/schema changes or production enablement.

It does **not** claim that the end-to-end path exists. Current implementation evidence shows:
- Trusted `author_initial` / `imported` source ingestion is implemented on main by PR #683. Core validates deployment-owned source material and emits canonical `knowledge.acquire` effects; this is source ingestion, not a knowledge reader or Memory dispatch.
- Core stores acquisition effects in its canonical event lifecycle and maintains a rebuildable `knowledge_acquisitions` projection. The current writer's deterministic `acquisition_id` binds world, subject, fact, source kind/reference/digest and authorization reference, but does not yet pin the exact acquired fact value and sorted source-event set.
- Core reader/belief candidate PR #744 adds `LogicEngine.readNpcKnowledge()`, acquisition-time value/source-event pins, canonical belief-transition events and a derived projection. It is draft/unmerged; authorizers are not configured in `src/index.js`, and it does not add Host-session authentication, NPC runtime invocation or model dispatch.
- NPC epistemic reducer/admission candidate PR #695 preserves `confirmed`, `unconfirmed_report`, `suspicion`, `inference`, `rumor` and `unknown`. It is draft/unmerged and is not an authorization or acquisition service.
- `MemoryNpcConsumer` is a separate internal application seam for Memory candidates backed by direct `canonical_entity` sources. It excludes summaries and initial/imported candidates; it must not be mistaken for the Core initial-acquisition reader.
- `memory-candidate-eligibility.js` is metadata-only. It does not authenticate, authorize, acquire or prove source authenticity.
- `ActorBindingService` resolves adapter-to-actor identity only. `AuthorizedReadService` is a Core field-disclosure seam, not the final dispatch authority.
- Core source-version token and complete canonical-entity inventory support were merged by PR #709. Host lifecycle PR #680 is closed unmerged; persisted-save receipt PR #689 remains a draft stacked on that branch; Gateway PR #646 remains a draft with a stronger shared-order design. None establishes a production Host → NPC decision/context → sole-Gateway path. No such complete path has been demonstrated.

Therefore this contract defines the target private boundary without relabelling existing helpers as a finished adapter.

## 2. Non-negotiable ownership

| Block | Owns | Must not do |
|---|---|---|
| Host | Session authentication; session-to-world/actor binding; dispatch lifecycle; sole outbound model Gateway; exact context serialization | Decide Memory trust, grant Core access, create canonical facts/acquisitions, bypass Gateway |
| Core | Authenticated adapter identity validation; actor binding resolution; authorization; canonical truth; acquisition identity/validity; snapshot consistency; restricted-field disclosure; canonical commit | Delegate canonical authority to Memory or NPC; accept model-supplied identity/authorization |
| Memory | Record storage/index; record/query grants; provenance; source identity/version; lineage; completeness/index health; reconciliation evidence | Decide canonical truth; grant itself permission to disclose canonical fields; create Core acquisition or NPC belief |
| NPC | Admission semantics; belief/inference; uncertainty/conflict preservation; decision-context interpretation and belief-state machine | Own canonical truth, source validity, acquisition ledger, access policy, or model egress. Core owns durable authoritative belief-transition events/projection where persistence is enabled |

Core is the authorization and canonical-state authority. Memory is an evidence provider, not an authority to disclose Core-owned canonical values. NPC is a consumer and interpreter, not a second truth store.

## 3. Two distinct evidence lanes

The contract deliberately separates two paths. They must not be collapsed into one generic "Memory" concept.

### Lane A — Core-owned initial acquisition

`trusted author/import bundle → Core source validation → canonical knowledge.acquire event → Core acquisition projection → Core actor-scoped knowledge read → NPC`

- The source ingestion foundation is implemented on main by PR #683.
- The reader and acquisition-time value/source-event pins are represented by draft PR #744, not main runtime.
- This lane does **not** require Memory Provider retrieval. It represents explicit `author_initial` / `imported` subject assignment.
- A Core acquisition means the subject was assigned information. It does not itself mean the proposition is objectively true or that the NPC believes it.
- Until the Core reader and authorizers are implemented/configured and accepted, this lane is not consumable by production NPC runtime.

### Lane B — Memory Provider evidence

`Host-owned source identity → Memory Provider record/index/grants → Core actor/field authorization and source-version check → NPC admission → NPC cognition`

- Memory candidates are evidence references, not Core acquisitions.
- A retrieval hit, record grant, prompt inclusion or successful admission does not create an acquisition, receipt, belief or canonical fact.
- Current `MemoryNpcConsumer` only supports direct `canonical_entity` candidates; summaries and other source kinds remain excluded.
- Raw Host text capture/read and complete Host inventory remain separate gated capabilities. A Memory record must not be assumed to originate from an authenticated or complete Host history.

### Dispatch path shared by both lanes

1. Host authenticates the active SillyTavern session and resolves a server-side binding to exactly one `world_id` and actor/NPC identity for the generation.
2. Host invokes the private Core application boundary using its configured authenticated adapter identity. Session and actor identifiers are not trusted merely because they appear in a request body.
3. Core resolves the adapter-to-actor binding through `ActorBindingService`. A missing, revoked, ambiguous, cross-world or destroyed-actor binding fails closed.
4. For Lane A, Core reads its own acquisition projection under the approved reader. For Lane B, Core orchestrates the Memory query/retrieval boundary for fixed purpose `npc_decision`, validates record/query grants, provenance, source version, lifecycle and snapshot metadata.
5. Core reads canonical source fields only through `AuthorizedReadService` with an explicit trusted field policy and the same actor, recipient `model`, purpose `npc_decision` and exact target set. The Core snapshot must match the relevant source/acquisition snapshot.
6. NPC admission evaluates only the validated envelope. `evaluateMemoryCandidateAdmission` is a filter, not authorization or acquisition proof. The epistemic reducer is not allowed to upgrade source certainty.
7. Immediately before model dispatch, Host performs the final revalidation and sends only the fresh context through the sole Gateway.
8. Any canonical mutation or durable belief transition is a separate Core-owned event/commit. Retrieval, admission, inference or model output is never a canonical commit.

The current `MemoryNpcConsumer.retrieveForNpc()` and `revalidateForFinalDispatch()` are implementation seams for Lane B. Draft PR #744 is the current Core reader candidate for Lane A. Neither is evidence that the production NPC callsite, Host serializer or sole-Gateway dispatch path is complete.

## 4. Request binding and session scope

Every private sub-operation must be bound to:
- authenticated adapter identity established by Host/Core credentials;
- canonical `world_id`;
- canonical actor/NPC entity identity;
- the exact purpose allowed by that sub-operation;
- one generation/dispatch attempt identity owned by Host;
- the trusted snapshot required by that sub-operation.

Purpose values are intentionally **not unified or aliased** across the two evidence lanes:
- Lane A Core acquisition reader (`readNpcKnowledge` candidate): `npc_turn_context` or `npc_action_evaluation`, selected by the actual operation.
- Lane B Memory candidate retrieval and its current `AuthorizedReadService` call: `npc_decision`.

A successful authorization under one purpose does not authorize another purpose. Until an explicit Core/Memory purpose-mapping rule exists and is tested, Lane A and Lane B results must not be combined into one model context merely because both target the same NPC. This is a real integration blocker, not a string-renaming task: Core field-policy and Memory grants must authorize the actual final use.

Host owns the session-to-world/actor mapping. Core owns validation of the adapter-to-actor binding. The actor ID, world ID, purpose, record IDs, field allowlist, and snapshot values must never be accepted from model output or prompt text.

No new public `session_id` wire field is prescribed. The current Core adapter authentication and actor-binding interfaces do not establish a SillyTavern session contract. Host must pass a trusted server-side binding to the private application boundary; any new cross-process session-binding endpoint or token claim is a separate API change requiring explicit approval.

The adapter binding authorizes identity resolution only. It is not a blanket grant to all Memory records or canonical fields.

## 5. Acquisition identity and rollback

### 5.1 Authority

Core alone owns acquisition identity, assignment, validity, rollback and reconciliation. Memory record identity (`record.ref + record.version`) is not an acquisition identity. A Memory hit, query grant, candidate admission, context inclusion, context manifest, generated statement or delivery attempt does not create acquisition.

The first initial-knowledge slice remains exactly `author_initial` and `imported`, as defined by `docs/50-npc-initial-knowledge-acquisition-contract.md`. Other acquisition kinds remain unsupported unless separately approved.

### 5.2 Required semantic identity

An acquisition is an immutable Core-owned assignment of a specific proposition/source to a specific subject in a specific world under a specific authorization basis and initial boundary.

The current Core writer creates `acquisition_id` from world, subject, fact, source kind, source reference, trusted source digest and authorization reference. This is a useful source-assignment identity, but it does **not** pin the exact canonical fact value or the sorted source-event set that supported that value at acquisition time.

The required immutable acquisition pin therefore includes:
- world and canonical subject;
- canonical fact/proposition identity;
- acquisition kind;
- trusted source identity, source digest and authorization reference;
- exact acquired canonical value (or its lossless canonical representation);
- exact sorted canonical source-event IDs supporting that value at acquisition;
- initial assignment boundary and Core event identity.

The value and source-event pins must be captured from the same trusted Core snapshot used to validate the assignment. A digest of the author/import bundle is not a substitute for the acquired canonical value. A fact ID or event ID alone is not a source-version token.

Draft PR #744 implements the missing acquisition-time value/source-event pins and corrects acquisition identity to bind the exact value and sorted source-event IDs. Until that change is merged and independently accepted, an acquisition without a valid pin is non-ready for NPC disclosure. Do not silently use the current value of a reused `fact_id`.

The physical schema and identifier encoding remain Core decisions. Do not introduce an NPC-local acquisition ID or treat a Memory record ID/version as sufficient.

### 5.3 Rollback and reuse rules

- The trusted ingestion event already records canonical source-event dependencies and the acquisition projection is derived from valid Core events. The merged PR #683 tests cover rollback, independent supports, restart/rebuild and idempotent retry.
- The acquisition-time pin is still essential: if source A is rolled back and the same `fact_id` is later reactivated with value B, the old acquisition for A must not silently follow the reused fact ID to B.
- The required regression is: acquire A → roll back A's source → reactivate the same `fact_id` with B through an independent canonical claim → the reader returns no active NPC knowledge until B is explicitly acquired. Draft PR #744 contains this regression.
- Replaying the same still-valid canonical assignment event with the same immutable payload is idempotent. Reusing an idempotency key with changed source bytes or assignment content is a conflict.
- Re-acquisition of B requires a new trusted assignment event and an acquisition identity bound to B's exact value/source-event set. The invalidated acquisition for A remains historical and must not be reactivated.
- If Core cannot prove the value/source-event pin and rollback validity for a source, that source is non-ready.
- `world_revision + commit_sequence` is a snapshot marker only. It is not a source-specific version token or durable source-change feed.

This explicitly closes the acquisition-reuse defect class without inventing a new NPC-side ledger.

## 6. Provenance, versions and snapshot consistency

Every Memory candidate intended for disclosure must have authoritative:
- stable Provider record reference and Provider record version;
- source kind and source reference;
- Core-approved source-version token and validity proof;
- producer provenance (producer is not automatically the content author or authority);
- lifecycle dimensions, including content disposition, source reconciliation, evidence assessment, access outcome and index health;
- world/subject/purpose scope;
- complete result declaration and bounded candidate set;
- snapshot marker that can be compared to the Core canonical read.

For direct `canonical_entity` sources, the selected Core source-version contract is an opaque Core-issued token of the form `core-entity-v1:<positive safe integer>`, backed by the durable `entity_source_versions` ledger. It advances transactionally on canonical entity mutation and rollback. This implementation and the snapshot-pinned canonical entity inventory were merged by PR #709 (merge commit `09a7d9ba4704c6322cae40706867c323c62f7e1a`). The token is now a mainline capability; it does not by itself prove complete Host inventory, configured Memory grants, final disclosure authorization or production dispatch. Do not substitute `updated_revision`, fact/event IDs, content hashes or `world_revision + commit_sequence` for this token.

Provider `record_version`, Provider `source_version`, Core's entity source token, acquisition-time value/source-event pins, and Core `(world_revision, commit_sequence)` are distinct values with distinct meanings. They must not overwrite or impersonate one another.

For a summary, every source in its lineage must have a stable identity/version, same world and recipient/purpose scope, current freshness and an allow decision. Until this can be proven, summaries are excluded. A producer ID or summary's own version does not substitute for source lineage.

A complete-empty result is valid only if Memory proves complete authorized inventory for the requested scope and Core proves the same current snapshot. Denied, withheld, partial, unavailable, rebuilding or unsupported results must never be converted to empty.

## 7. Authorization and final model egress

### 7.1 Revalidation points

Authorization and validity are rechecked at these boundaries:
1. **Acquisition/assignment:** Core validates explicit subject assignment and its authorization basis.
2. **Context preparation:** Core resolves actor binding, Memory query/record grants, canonical field policy and snapshot consistency.
3. **Immediately before model send:** Host invokes `revalidateForFinalDispatch()` (or its separately approved equivalent) as the last authorization/freshness check. It must use the fresh returned context, not the previously prepared object.
4. **Before canonical commit:** Core revalidates the caller, actor/world scope, expected canonical revision, policy/authorization and command validity inside the commit boundary.

If any check is unavailable, throws, returns an unknown state, or cannot establish current authorization, the operation fails closed. No stale cached allow decision may be reused.

### 7.2 Explicit guarantee boundary — delegated project decision

For this Memory → NPC contract, the approved guarantee is **fail-closed revalidation at the defined boundaries**, not linearizability between a concurrent revocation/commit and model dispatch.

- A revocation or denial observed by the final revalidation blocks the send.
- The final check must be the last authorization/freshness operation before Host hands the exact payload to its sole Gateway. Host must use the freshly revalidated object, never the prepared/stale object.
- A revocation that races after the final check may occur before or during transport handoff. The contract does not promise cancellation or atomic ordering across Host, Provider and Core stores.
- Host's dispatch/idempotency record may prevent duplicate attempts, but it is not by itself a cross-store authorization fence.
- If a required authority is unavailable or the final check is ambiguous, no send occurs.

This is an explicit scope decision and narrows the stronger shared-order/linearization target described in `docs/86-cross-block-authority-and-npc-integration-contract-proposal.md`, `docs/architecture/core-final-disclosure-authorization-contract.md`, issue #356 and draft Gateway PR #646. Those stronger guarantees are **not** claimed or required by this contract. Do not describe the remaining TOCTOU interval as solved.

If strict linearizability is later required, it is a separate mechanism: policy version must participate in the same Core transaction/authorization fence as the dispatch decision, and all relevant writers must participate in that order. That mechanism requires a separate decision and implementation acceptance.

### 7.3 Gateway ownership

Only Host Gateway sends model requests. Core and Memory do not call the model. NPC does not open its own transport. Any request that bypasses Gateway is a contract violation.

## 8. Epistemic mapping and canonical precedence

Memory's current vocabulary is not itself an NPC belief schema:
- `content_kind`: `claim`, `report`, `summary`, `author_initial`, `imported`, `inference`;
- `epistemic_kind`: `canonical`, `acquired_report`, `rumor`, `inference`, `authored_initial`, `imported`;
- `evidence_assessment`: `unassessed`, `supported`, `disputed`, `insufficient`;
- NPC reducer candidate PR #695 uses `confirmed`, `unconfirmed_report`, `suspicion`, `inference`, `rumor`, `unknown` and separate belief stances.

The mapping is deliberately conservative:

| Memory/Core class | NPC context meaning | NPC epistemic/belief rule |
|---|---|---|
| Core `author_initial` / `imported` acquisition | `known/assigned` information | Assignment is not an epistemic status and does not automatically create a belief or `confirmed` evidence |
| `epistemic_kind=acquired_report` | attributed report | Map to `unconfirmed_report`; cannot support `believes_true/false` |
| `epistemic_kind=rumor` | attributed rumor | Map to `rumor`; cannot be promoted by repetition |
| `epistemic_kind=inference` | derived inference | Map to `inference`; preserve premises and uncertainty |
| `epistemic_kind=canonical` | Core canonical proposition reference | Not a subject belief or acquisition; may be used only if Core separately authorizes disclosure and subject acquisition is established |
| `evidence_assessment=supported` | supported evidence assessment | Does not automatically map to `confirmed`; source kind and subject-relative acquisition still govern |
| `evidence_assessment=disputed` | conflicting/disputed evidence | Preserve opposing evidence refs; belief stance remains `unresolved`/review-required where applicable |
| `evidence_assessment=insufficient` | insufficient evidence | Preserve the insufficient marker and map belief to `unknown`/no stance; never treat as false |
| `evidence_assessment=unassessed` | unassessed evidence | Do not submit it to belief revision |
| No eligible evidence / incomplete scope | unknown, withheld or incomplete according to Core result | Never infer `known_absent` from a missing candidate |

`authored_initial` and `imported` are acquisition mechanisms, not epistemic certainty classes. They may establish that the subject was assigned information, but not that the proposition is objectively true or believed. The NPC may later reason about the assigned content, but any belief transition must cite separately admitted evidence and follow the NPC belief policy.

No automatic mapping to `confirmed` is permitted from `canonical`, `supported`, producer trust, repetition, retrieval score, or model fluency. `confirmed` is allowed only when a trusted boundary explicitly establishes a valid, subject-relative evidence basis and the NPC transition policy permits it. The reducer itself does not authenticate the evidence class.

Suspicion is an NPC cognition output, not a Memory source class. It may be created only by NPC reasoning from explicitly available premises and must remain labeled as suspicion. Contradiction is not a stronger source class: preserve conflicting evidence refs and unresolved stance. Insufficient evidence remains distinct from a false proposition.

### Canonical precedence

1. Core canonical state has priority for claims about the actual world.
2. Memory-derived evidence never overwrites canonical state.
3. If derived belief conflicts with canonical state, NPC preserves it as a subject-relative disputed/uncertain belief; it cannot present the derived claim as canonical fact.
4. If provenance is incomplete, stale, revoked or conflicting, the derived belief is excluded from decision context unless an explicit approved rule allows clearly marked uncertain use.
5. A subject may hold a mistaken belief, but that belief remains subject-relative and cannot mutate or supersede Core truth.
6. Core owns durable authoritative belief-transition events/projection; NPC owns the belief semantics and cognition. No derived belief becomes canonical without an independent Core-owned world-state command/commit.

## 9. Failure semantics

The current internal consumer uses `ready` / `non_ready`. This contract does not invent a new public status enum. Until a typed response contract is separately approved, all security-relevant uncertainty maps to the existing generic non-ready path.

Fail closed for:
- unknown adapter, actor binding, world, subject or purpose;
- missing/invalid session binding;
- denied or unavailable query/record authorization;
- unknown source, provenance, source version or acquisition identity;
- rollback or source validity that cannot be resolved;
- stale or mismatched Core snapshot;
- stale/rebuilding/unavailable Memory index;
- incomplete result or inventory;
- summary with incomplete/unauthorized lineage;
- duplicate or conflicting record/acquisition identity;
- unknown epistemic/content/lifecycle enum;
- partial Provider response or exceeded bound;
- final dispatch revalidation failure;
- Core commit failure.

A denial is not complete-empty. An unavailable read is not denial-as-fact. Missing evidence is not evidence of absence. Partial results are not ready. No rejected candidate IDs, counts, snippets or sensitive reasons may leak through model-visible errors.

## 10. API change control (D5)

No block may change another block's API, schema, semantics, guarantees, compatibility behavior, lifecycle, or failure behavior without explicit approval from the owner of every affected API.

This includes changes that are nominally backward compatible.

For each proposed change, record:
- owner(s) of the affected API;
- current contract and exact delta;
- compatibility and migration impact;
- failure/security implications;
- tests and rollback plan;
- explicit owner approval.

The delegated architectural authority used to approve this document does not silently approve unspecified future API changes. This contract is not a blanket authorization to change public routes, request/response schemas, storage schemas, or Host events.

## 11. Implementation gates

| Gate | Exit condition | Current state |
|---|---|---|
| C0 — Private contract | Semantics and block boundaries fixed by this document | **Complete for v0.1** |
| C1 — Core acquisition reader/pins | Merge/review the Core reader candidate; prove immutable value/source-event pins and per-acquisition visibility authorization | Draft candidate PR #744; not main |
| C2 — Core source version | Use the opaque canonical entity source-version token and snapshot-pinned inventory contract | **Implemented on main** by PR #709; Host/Provider production completeness remains separate |
| C3 — Memory/Host evidence | Prove Provider inventory/reconciliation against authoritative Host lifecycle identity and restart/restore | Host PR #680 closed unmerged; #689 remains draft and is stacked on #680; production authority not established |
| C4 — Final disclosure | Implement the approved fail-closed final revalidation and sole Gateway route; do not claim linearizability | Candidate #646 is review-only; actual pinned Host route is not wired |
| C5 — NPC semantics/runtime | Integrate reducer/admission into the real NPC decision/context callsite; preserve epistemic classes | Draft NPC reducer PR #695; no production caller |
| C6 — E2E acceptance | All negative, recovery, rollback, retry and dispatch cases pass on the integrated path | Not tested end-to-end |
| C7 — Independent acceptance | Independent review against exact commit SHAs and evidence | Not started |
| C8 — Production enablement | Separate explicit approval after C1–C7 | **Not authorized** |

Required integrated tests include rollback/re-acquisition identity, revoked trust, stale versions, source conflicts, incomplete inventory, partial Provider response, duplicate delivery, restart/reconciliation, final-send revalidation, no Gateway bypass, and Core commit failure/retry. Existing helper and consumer tests remain useful but cannot substitute for the real NPC runtime callsite.

## 12. Final status

- Private architecture contract v0.1: approved for implementation planning under delegated block authority.
- Existing APIs and schemas: unchanged by this document.
- Production wiring: not authorized.
- NPC: `NOT ACCEPTED`.
- Memory → NPC: `DISABLED / FAIL-CLOSED`.
- Production readiness: not claimed.
- No second canonical state; no NPC-owned acquisition ledger; no Memory-to-model egress.

The next implementation work is C1–C3 in their owning boundaries, followed by C4. Each code change must be isolated, tested, and reviewed against this contract. Passing tests does not automatically advance C7.
