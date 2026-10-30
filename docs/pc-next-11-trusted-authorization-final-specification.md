# PC-NEXT-11 — Trusted authorization and protected egress specification

**Status:** FINAL TECHNICAL SPECIFICATION / IMPLEMENTATION BLOCKED BY EXPLICIT OWNER GATES.  
**Version:** 1.0 — 2026-10-30.  
**Normative baseline:** `main` `6c60b3e6023d2b3f8be800d9f21daa0993d16518`.  
**Supersedes:** PC-NEXT-07 Draft v3 as the normative trusted-authorization specification. PC-NEXT-08 remains the implementation breakdown; PC-NEXT-09 remains the source inventory; PC-NEXT-10 remains the execution work order.  
**Scope:** trusted identity, authorization, Host inventory, Memory evidence, revocation ordering, protected model egress, anti-replay and acceptance.  
**Change class:** documentation only. This document does not authorize production code, API/schema changes, runtime wiring, database/ACL changes, PR merges, release, or feature activation.

---

## 1. Purpose and completion boundary

This specification defines the target contract for a protected NPC context request from authenticated SillyTavern session through Core and Memory Provider to one PC-side outbound model Gateway.

It resolves the semantic questions G1–G10 from the earlier review, fixes the first-slice boundaries, defines the required immutable request binding, and supplies testable acceptance criteria.

It does **not** claim that the target path exists. Current main still does not demonstrate a complete Host → Core/Memory → NPC → sole-Gateway path. The following statuses remain mandatory until exact-head acceptance and separate release approval:

- Host: **NON_READY**.
- Stage 2: **NO-GO**.
- Memory → NPC: **DISABLED / FAIL-CLOSED**.
- Production SillyTavern protected context: **NO-GO**.

A missing, ambiguous, stale, incomplete, unsupported or unverifiable authority is a denial. No positive test fixture, local helper, successful retrieval, candidate PR or health endpoint may be promoted into production authority.

## 2. Normative architecture and ownership

The protected path has three logical trust boundaries:

1. **Host session and egress boundary (PC-side):** authenticates the active SillyTavern session, resolves the active conversation and actor selection from server-side state, owns the dispatch attempt, serializes the exact outbound request and operates the sole protected outbound Gateway.
2. **Core authorization and canonical-state boundary:** derives authenticated adapter identity, resolves the conversation-to-world binding, validates the exact Host-selected actor binding, owns canonical source state and policy decisions, and supplies current source/version evidence.
3. **Memory Provider evidence boundary:** owns record storage, record/query grants, provenance, lineage, reconciliation and readiness state. It supplies evidence, not canonical truth or final disclosure authority.

NPC owns admission, belief and uncertainty semantics. It does not own canonical truth, acquisition identity, authorization, or model egress.

**Host and Gateway are one logical Host-owned egress boundary.** They may be implemented in one PC process or in separate PC-side processes, but process topology does not change the contract: the Gateway must be PC-side, Host-owned, authenticated, and the sole transport for protected requests. A phone/client-side direct provider call is not an acceptable protected route. If separate processes are used, the IPC identity, credential custody, network boundary and shared-order participation must be proven. This document does not prescribe a particular deployment topology.

### 2.1 Authority ownership

| Decision or data | Sole authority |
|---|---|
| Adapter identity | Core, derived from authenticated configured credentials |
| Active ST session and session generation | Host server-side session state |
| Conversation identity and actor selection | Host authenticated session state |
| Conversation → world binding | Core-owned binding |
| Actor binding validity | Core validates the exact Host-selected actor |
| Canonical entity/source state and source version | Core |
| Memory record identity/version, grants, provenance, lineage and readiness | Memory Provider |
| Field visibility and protected disclosure policy | Core |
| NPC admission/belief/uncertainty | NPC |
| Dispatch attempt, exact outbound bytes, route and sole transport | Host-owned PC Gateway |
| Shared ordering and durable dispatch-start | Approved PC-side serialization authority, jointly enforced by Core, Provider and Gateway |

No component may manufacture another component's authority. A signature or digest proves integrity/binding only; it does not replace current authorization.

## 3. First supported slice and evidence lanes

### 3.1 First slice: Lane B only

The first end-to-end implementation slice is **Lane B: Memory Provider evidence for direct `canonical_entity` sources**, because this workstream is specifically the Memory Provider integration path.

Lane B uses the exact purpose `npc_decision` and recipient `model`. It does not include summaries, derived copies, raw Host text capture, unsupported source kinds, or inferred source lineage.

Lane A is excluded from this first slice and remains independently gated:

- Lane A: Core-owned `author_initial` / `imported` acquisition.
- Lane A purposes: `npc_turn_context` or `npc_action_evaluation`, according to the operation.
- Lane A requires acquisition-time value/source-event pins and per-acquisition visibility authorization.
- Lane A must not be silently mapped to Lane B's `npc_decision` purpose.

The two lanes MUST NOT be combined in one model context until a separately reviewed purpose/recipient mapping and conflict-envelope contract is approved and tested.

### 3.2 Core versus Memory conflict

Core is canonical authority for Core-owned facts and source state. Memory is evidence.

If Core and Memory disagree about the same proposition:

1. Preserve both source identities and provenance.
2. Core remains canonical.
3. Mark the Memory item conflicting/derived/uncertain.
4. Do not include it as an unqualified fact.
5. Exclude it unless a separately authorized evidence channel explicitly carries uncertainty and its admission policy permits it.
6. Retrieval score, recency, ranking or model preference cannot override Core.

If conflict policy is missing or unavailable, exclude the conflicting Memory item and fail closed for any required context that cannot be constructed safely.

## 4. Authenticated identity and scope resolution

The only accepted resolution sequence is:

1. Host authenticates the active ST session from server-side session state.
2. Host resolves the stable conversation identity, active session generation and actor selection from that authenticated server-side state.
3. Core derives `adapter_id` from configured credentials on the authenticated Host→Core transport. A request-body adapter label is not identity.
4. Core resolves `(adapter_id, conversation_id) → world_id` through its own binding.
5. Core validates the exact Host-selected `(world_id, adapter_id, actor_entity_id)` binding and confirms the entity is active/eligible.
6. Any missing, revoked, ambiguous, cross-world, destroyed, replaced or stale binding denies.

Current Core services resolve the conversation-to-world mapping and validate an exact actor; they do not uniquely select an actor from adapter identity. Therefore actor selection remains Host-owned. A future Core unique-actor-selection service is a separate design/API change and is not assumed here.

### 4.1 Untrusted caller fields

Caller/body/prompt/model-supplied values MUST NOT establish or widen authority for:

- adapter, Host instance, session or session generation;
- conversation, world, actor or NPC;
- purpose or recipient;
- dispatch/request ID, generation or nonce;
- source, record, acquisition or candidate identity;
- snapshot cursor, source version, policy generation or fingerprint;
- field allowlist, route, model, stream mode or payload digest.

An untrusted identity field is rejected. A documented compatibility adapter may strip legacy fields only if all downstream values are replaced exclusively with authenticated/server-resolved values and the behavior is tested. Internal Host→Core messages may carry stable references only over authenticated Host identity and server-side binding.

First slice: NPC subject is the canonical actor. A separate runtime `npc_id` is deferred; caller-supplied `npc_id` is never authoritative.

## 5. Immutable trusted request envelope

Only trusted server-side composition code may create the protected request envelope. It is immutable after final authorization and binds at least:

- authenticated adapter identity;
- Host instance/session identity and monotonic session generation;
- stable conversation identity and validated world/actor binding;
- exact lane, purpose and recipient;
- unique dispatch/request ID and one-time nonce;
- exact Core snapshot cursor;
- exact Provider record references and record versions;
- exact source identities and source-version pins;
- current grant/revocation and reconciliation/readiness evidence;
- policy authority identity, generation and fingerprint;
- exact outbound payload bytes or an integrity-protected canonical manifest of those bytes;
- exact route, model, stream mode and transport options.

The Gateway must send the exact bytes bound by the decision. Any post-decision mutation to payload, route, model, stream mode, recipient, source set, session generation or policy/source pins invalidates the envelope and denies dispatch.

No cached prepared object may be substituted for the fresh result of final authorization. A stale envelope, changed binding, reused nonce, duplicate attempt or conflicting request identity is denied.

## 6. Purpose, recipient and policy authority

### 6.1 Purpose and recipient

Purpose and recipient are authorization dimensions fixed by the trusted operation, not caller parameters.

- Lane B retrieval/disclosure purpose: `npc_decision`.
- Lane B recipient: `model`.
- Lane A remains separately scoped to `npc_turn_context` or `npc_action_evaluation`.
- A context authorized for one purpose or recipient cannot be reused for another.
- Missing, unsupported, aliased, caller-selected or mismatched purpose/recipient denies.

Required tests: purpose mismatch, recipient mismatch, absent value, unsupported value, caller substitution and cross-lane reuse all produce zero protected outbound calls.

### 6.2 Versioned disclosure policy authority

The current-main mechanic-policy validator is not a versioned disclosure authority. No existing implementation is to be relabelled as such.

The target authority tuple is:

`authority_id + generation + snapshot_fingerprint`

- `authority_id`: stable ID assigned by trusted Core composition.
- `generation`: durable monotonic generation; increment on effective policy content, scope or activation changes. It must not be caller-controlled or silently roll back.
- `policy_content_digest`: Core-computed digest of canonical effective policy.
- `policy_scope`: exact world, actor, recipient, purpose and field/operation scope.
- `world_pack_id` and `world_pack_version`: included as explicit values when effective policy depends on them; otherwise explicit nulls.

**Canonical fingerprint encoding:** UTF-8 JSON using RFC 8785 JSON Canonicalization Scheme; reject duplicate keys, non-finite numbers, executable values, unsupported types and non-normalized schema fields before canonicalization. Compute `snapshot_fingerprint = SHA-256(canonical_bytes)`. The fingerprint is a consistency identifier, not a signature and not authorization. Core must validate the current authority at the point of use.

This schema is the normative design target for implementation review. It is **not currently implemented**. Before code/schema work, Core must explicitly approve the authority owner, durable generation writer, canonical policy source, scope semantics, world-pack dependency rule and invalidation behavior. Missing or throwing authority means NON_READY/DENY; there is no fallback to a default allow policy.

## 7. Version and snapshot semantics

The following dimensions are independent and must never substitute for one another:

1. **Core entity source token:** opaque `core-entity-v1:<positive safe integer>`, backed by the Core entity source-version ledger.
2. **Provider source_version:** for direct `canonical_entity` records, the canonical decimal string of the exact current Core entity's non-negative `updated_revision`; compare for exact equality against the exact current entity snapshot.
3. **Provider record version:** exact `(record_ref, record_version)`, scoped to world/subject/purpose and current grant/provenance state.
4. **Acquisition-time value/source-event pin:** Lane A only; exact acquired value plus sorted source-event IDs from the same trusted Core snapshot.
5. **Policy version:** `authority_id + generation + snapshot_fingerprint`.
6. **Core snapshot cursor:** `(world_revision, commit_sequence)`, used only as a stale-snapshot detector.

The Core entity token, Provider `source_version`, Provider record version, acquisition pin, policy version and Core snapshot cursor have different semantics. In particular, `world_revision + commit_sequence` is not a source journal, source version, acquisition pin, policy fingerprint, proof of complete inventory or proof of cross-database atomicity.

Any missing, malformed, stale, mismatched or unprovable version denies. A rollback that reuses a fact/entity identity must not allow an old Memory record or acquisition to follow the reused identity to new content.

## 8. Host inventory and reconciliation

Provider readiness must be based on an authoritative Host inventory, not on Provider-local row counts.

Host inventory must explicitly distinguish:

- complete current inventory;
- complete-empty inventory;
- partial/incomplete scan;
- unknown history;
- unavailable or stale snapshot;
- ambiguous identity or conflict;
- recovery/restore in progress.

Only a server-authenticated, exact, complete and current inventory may be considered for acceptance. `complete === true` is necessary but not sufficient: a real deployment-owned verifier must attest the exact snapshot and identity/version set. A caller-supplied completion flag is not authority.

The inventory must account for the supported lifecycle scope, including creation, edit/revision, swipe/regeneration, deletion/tombstone, chat switch, restart/reload, import/export, branch/copy, group chat, migration and restore. Unsupported or unobservable history must be reported as unknown/incomplete; it must never be silently treated as empty or complete.

Provider reconciliation may publish READY only after the authenticated Host snapshot is accepted and the Provider's records, versions, grants, lineage and index/readiness state match that accepted snapshot. Provider cannot manufacture Host completeness. A repeated identical complete snapshot may be idempotent, but idempotence is not completeness proof.

Raw Host text capture/read/derived-copy/delete/purge is outside this first slice and remains closed unless separately approved.

## 9. Final disclosure and revocation ordering

### 9.1 Required target: Option B — shared serialized dispatch-start

The target is one enforceable PC-side serialization order shared by every relevant invalidation writer and the protected Gateway. This is required to satisfy the integration objective of unified dispatch-start ordering. Boundary revalidation alone is not treated as sufficient for Lane B.

The linearization point is the **durable commit of `DISPATCH_STARTED`** for the exact immutable request. The Gateway must not hand protected bytes to the network before that commit.

Operations that must participate in the same order include:

- Core canonical source/status/revision changes, destruction, rollback/retraction, actor/conversation binding invalidation and policy generation changes;
- Provider query/record grant and revocation, record/source-lineage changes, readiness, reconciliation, tombstone, purge, rebuild and restore transitions;
- Host session/inventory invalidation relevant to the request;
- Gateway final authorization, request identity check and durable dispatch-start;
- dispatch-ledger recovery/restore operations that could erase or replay a started identity.

If any relevant writer can commit outside the order, the atomicity claim is false and protected dispatch remains disabled. A process-local mutex, sequential Core-then-Provider checks, a shared path string, or separate local SQLite transactions do not establish this contract.

### 9.2 Ordering outcomes

- **Invalidation first:** if denial, revocation, source invalidation, binding change, policy change or readiness loss commits first, the request is denied and outbound transport invocation count is exactly zero.
- **Dispatch-start first:** if `DISPATCH_STARTED` commits first, the request is in-flight. A later revocation cannot recall bytes already handed to external transport. The system must not automatically resend after timeout, lost acknowledgement, crash or restart.
- **Ambiguous state:** if ordering, authority or recovery state cannot be established, fail closed. An already-started ambiguous request remains UNKNOWN/in-flight until resolved under a separately approved manual/retry policy.
- **Duplicate identity:** the same request ID and same exact binding is idempotently rejected from creating a second disclosure; same request ID with changed payload or binding is a conflict and denied.

The coordinator lease must not be held across network I/O. The durable dispatch-start is the authorization/ordering boundary; transport invocation follows it exactly once. The product/security policy for timeout, cancellation, manual retry and in-flight resolution must be approved before implementation.

### 9.3 Mechanism is not preselected

A shared SQLite coordinator with `BEGIN IMMEDIATE` may be evaluated as an implementation mechanism, but it is not approved merely because a helper exists. The chosen mechanism must prove:

- every relevant writer and Gateway participates;
- all processes use the same actual database object, not merely the same path string;
- supported OS file identity and effective permissions are verified;
- Core, Provider, Host ledger and dispatch ledger are protected against partial/stale restore;
- no direct database, maintenance, migration, recovery or alternate route bypass exists;
- crash durability and UNKNOWN/no-retry behavior are deterministic.

SQLite open/handle identity issue #770 remains a separate security gate. A path re-stat or identity check not bound to the object SQLite actually opens is not TOCTOU closure.

## 10. Read, write and revoke semantics

| Operation | Required authority | Commit/ordering boundary |
|---|---|---|
| Read/disclose | Core field policy for exact actor, recipient, purpose, fields and current source; Provider grants/lineage/readiness | Final serialized dispatch-start for protected Lane B disclosure |
| State mutation | Separate Core action/write authorization, validated effect and expected revision | Authorization and expected revision inside Core commit boundary |
| Revoke | Trusted admin/system principal; Core-owned policy/binding revocation or Provider-owned record/query grant revocation as appropriate | Same shared order as dispatch-start for all protected validity-affecting revocations |

Read permission never implies write permission. Host, Memory, NPC, model and ordinary adapter callers cannot impersonate the revoking principal. A revoke request with untrusted identity is denied.

A revocation ordered before dispatch-start must prevent disclosure. A revocation ordered after dispatch-start does not recall an already-authorized in-flight request. This is the exact guarantee boundary; no stronger cancellation claim is made.

## 11. DENY and diagnostics

External protected-read/dispatch failures use the existing generic non-ready/denial behavior. Do not add a new public status enum without API-owner approval.

Externally, missing, withheld, unauthorized, destroyed, stale and unknown targets must not reveal whether a world, actor, record, field, acquisition, grant or policy exists. No partial target list, source name, source count, hidden value, prompt fragment, raw content, credential or secret may be returned.

Detailed reason codes, component, correlation ID and minimal safe identifiers are server-side diagnostics only. Logs must not contain raw private message content, protected payload bytes, hidden values or secrets. The established generic authentication failure may remain generic 401.

## 12. Required implementation work packages

Implementation must follow this order; later packages cannot claim acceptance while an earlier dependency is absent.

1. **WP-1 — Owner decision freeze:** record cross-owner acceptance of Option B; approve first slice Lane B; approve policy authority/fingerprint schema; approve Host session/envelope contract; approve PC-side Gateway topology, credential custody and in-flight retry policy.
2. **WP-2 — Core trusted composition:** one server-side composition root creates trusted authorizers; authenticated adapter and Core-owned conversation/world binding; exact Host-selected actor validation; fail-closed policy and source-version checks; no caller-supplied authority.
3. **WP-3 — Host session and inventory:** authenticated session/generation; stable conversation and actor binding; durable source identity/version; explicit complete/incomplete/unknown inventory; no false completeness.
4. **WP-4 — Provider reconciliation:** authenticated accepted Host inventory; exact record/source version and lineage; grants/revocation/readiness; complete-empty distinguished from incomplete/denied; no READY without real verifier.
5. **WP-5 — Shared ordering and anti-rollback:** enumerate every Core/Provider/Host/Gateway writer; enforce common serialization; protect dispatch ledger and recovery; prove partial restore fails closed.
6. **WP-6 — Provider-neutral sole Gateway:** route every protected sender through the same PC Gateway; bind exact request bytes/route/model/stream; zero direct/fallback/retry bypass; ordinary non-protected generation unchanged.
7. **WP-7 — Integrated acceptance:** deterministic multi-process races, crash/restart, ambiguous-send, replay, restore and complete route-coverage tests on an isolated deployment with exact SHAs.
8. **WP-8 — Independent security review and release:** exact-head source review, CI, PC evidence and explicit separate release approval. No automatic activation after tests.

No API/schema/runtime implementation begins before the required owner approvals and the second explicit Core approval required by issue #264.

## 13. Acceptance test matrix

All tests use synthetic payloads and recording transport. Every denial test asserts **zero protected outbound calls** unless the scenario explicitly tests an already-started in-flight request.

| ID | Scenario | Required result |
|---|---|---|
| AUTH-01 | Missing/invalid adapter credential | DENY |
| AUTH-02 | Caller substitutes adapter identity | Reject; authenticated adapter only |
| AUTH-03 | Caller substitutes world/actor/conversation/session/NPC | Reject or strip only via documented adapter; server-resolved scope only |
| BIND-01 | Missing/revoked conversation binding | DENY |
| BIND-02 | Actor destroyed/replaced/revoked | DENY |
| BIND-03 | Cross-world or cross-adapter actor | DENY |
| BIND-04 | Ambiguous actor selection or unaudited rebind | DENY; never choose first |
| PURPOSE-01 | Lane B purpose not exactly npc_decision | DENY |
| PURPOSE-02 | Lane A/B purpose alias or cross-lane reuse | DENY |
| RECIPIENT-01 | Recipient absent, caller-selected or not model | DENY |
| POLICY-01 | Policy authority missing/throws/unavailable | NON_READY/DENY |
| POLICY-02 | Authority generation stale or rolled back | DENY |
| POLICY-03 | Fingerprint/content/scope mismatch | DENY |
| POLICY-04 | Caller/Host/model attempts to supply or increase policy | DENY |
| POLICY-05 | Field policy denies or returns partial target set | Generic DENY; no partial values |
| CONFLICT-01 | Core and Memory contradict | Core canonical; Memory excluded or uncertainty-tagged |
| CONFLICT-02 | Memory ranking/recency conflicts with Core | Core remains authoritative |
| CONFLICT-03 | Conflict policy unavailable | Exclude conflicting Memory evidence |
| VERSION-01 | Core entity token missing/malformed/mismatch | DENY |
| VERSION-02 | Provider source_version differs from current Core updated_revision mapping | DENY |
| VERSION-03 | Provider record ref/version/grant mismatch | DENY |
| VERSION-04 | Lane A acquisition value/source-event pin mismatch | DENY; reacquisition required |
| SNAPSHOT-01 | Core cursor changes before final decision | DENY |
| SNAPSHOT-02 | Cursor equality used as substitute for source/grant/lineage/completeness | DENY |
| INVENTORY-01 | Missing/false/incomplete/stale/ambiguous Host inventory | No Provider READY; DENY |
| INVENTORY-02 | Provider attempts to claim Host completeness from local row count | DENY |
| INVENTORY-03 | Complete-empty versus incomplete/denied result | Only attested complete-empty is accepted |
| RECON-01 | Repeated identical accepted complete snapshot | Idempotent, no weakened verification |
| RECON-02 | Omitted/deleted version, changed digest, rebind or stale snapshot | NON_READY/DENY |
| HOST-FINAL-01 | Session expired/replaced or generation changed | DENY |
| HOST-FINAL-02 | Stale prepared object used instead of fresh authorized result | DENY |
| HOST-FINAL-03 | Payload/route/model/stream/purpose/recipient/source pin mismatch | DENY |
| HOST-FINAL-04 | Duplicate/replayed nonce or dispatch attempt | DENY; no second call |
| WRITE-01 | Read permission used for state mutation | DENY |
| WRITE-02 | Stale expected revision at Core commit | DENY |
| REVOKE-01 | Untrusted revoke principal | DENY |
| ORDER-01 | Revocation/source invalidation wins before dispatch-start | Zero outbound calls |
| ORDER-02 | Dispatch-start wins before later revocation | One in-flight attempt; no recall claim |
| ORDER-03 | Coordinator unavailable/different actual DB object/writer bypass | DENY; zero calls |
| ORDER-04 | Crash before dispatch-start | Zero calls |
| ORDER-05 | Crash after durable start before transport handoff | UNKNOWN; no automatic retry |
| ORDER-06 | Lost acknowledgement after handoff | UNKNOWN; no automatic retry |
| ORDER-07 | Duplicate request ID with same binding | No second call |
| ORDER-08 | Same request ID with changed binding/payload | Conflict; zero additional calls |
| ROLLBACK-01 | Stale/partial restore of Core, Provider, Host ledger or dispatch ledger | NON_READY until verified recovery; zero calls |
| LEDGER-01 | Restore older dispatch ledger after a started request | Prior identity cannot be erased/replayed |
| EGRESS-01 | Any protected sender bypasses sole Gateway | Release blocked; zero bypass calls |
| EGRESS-02 | Gateway unavailable/rejects/malformed envelope | Zero direct/fallback calls |
| DENY-01 | Missing versus withheld target | Same generic external shape |
| DENY-02 | Diagnostics contain protected content or secrets | Test fails; logs redacted |
| REGRESSION-01 | Ordinary non-protected ST generation on touched route | Existing behavior preserved |

## 14. Evidence and release criteria

A test suite is accepted only when evidence identifies:

- exact Core, Provider, Host and Gateway SHAs;
- exact SillyTavern target commit and supported lifecycle scope;
- Node/runtime version, OS, process identities and deployment profile;
- canonical paths plus actual opened-file identity and effective permissions;
- exact shared serialization object and every participating writer;
- exact command, output, CI URL and evidence class;
- deterministic barrier order and observed outbound call count;
- dispatch-ledger state before/after crash, restart and restore;
- exact route/callsite inventory and zero-bypass evidence;
- absence of protected content/secrets in logs;
- confirmation that production ST/Core/DB/ACL/vectorization were not touched.

Evidence classes: SOURCE, CI, PC-READONLY, PC-FIXTURE, PC-RUNTIME, INDEPENDENT-SECURITY, BLOCKED, NOT-TESTED. A source inspection or fixture test cannot be reported as PC runtime proof. Missing evidence is BLOCKED/NOT-TESTED, never PASS.

No vectorization, embedding, VectorService, Ollama, Vectra or remote vector-store work is in scope. Do not rerun already accepted test families without a code-specific reason. PC tests begin only after a real isolated candidate path exists.

## 15. Owner approval record required before implementation

The technical target is defined above. The following approvals remain external gates and must be recorded against the exact implementation diff:

| Owner | Required approval |
|---|---|
| Core | Policy authority owner/generation/fingerprint schema; canonical source predicate; all Core writer participation; exact source-version checks |
| Host | Authenticated session/generation envelope; stable actor/conversation binding; complete inventory evidence; sole PC Gateway and all-sender coverage |
| Memory Provider | Record/query grants, revocation, lineage, reconciliation/readiness and participation in the same serialization order |
| Security/Operations | Actual opened-file identity, process/ACL boundary, backup/restore and dispatch-ledger anti-rollback |
| Joint Core + Host + Memory | Ratify Lane B as the first isolated slice and keep Lane A separate; accept Option B shared order; approve durable dispatch-start and in-flight/UNKNOWN/no-auto-retry semantics |
| Product/Security | PC-side deployment topology, phone-to-PC authentication, credential custody, audit/retention limits, timeout/cancellation and manual retry policy |\n| Project owner / release authority | Explicit production release approval after exact-head acceptance |

Issue #264's second explicit Core approval remains required before any cross-block API/schema/implementation change. This specification does not replace that approval.

## 16. Source and decision traceability

This specification is grounded in the following current-main contracts and implementation findings, checked against main `6c60b3e6023d2b3f8be800d9f21daa0993d16518`:

- `docs/57-private-host-core-memory-npc-adapter-contract.md`: ownership, separate Lane A/Lane B semantics, Host session and sole-Gateway responsibility, actor binding, source versions and existing fail-closed boundary contract.
- `docs/architecture/core-final-disclosure-authorization-contract.md`: Core's required PC-side serialized final-disclosure/dispatch-start authority, exact request binding, all-writer participation, crash/retry and anti-rollback acceptance.
- `docs/76-core-cross-block-decision-register.md` and `docs/86-cross-block-authority-and-npc-integration-contract-proposal.md`: cross-block approval boundaries and unresolved implementation acceptance.
- `docs/91-core-owned-trusted-initial-knowledge-source-decision.md`: Lane A source ingestion boundary; not part of the first Lane B slice.
- `docs/pc-next-08-trusted-authorization-implementation-breakdown.md`: source-to-contract traceability and owner decision inventory.
- `docs/pc-next-09-core-provider-egress-writer-matrix.md`: known writer/callsite inventory; explicitly not a completeness certificate.
- `docs/pc-next-10-priority1-integration-execution-work-order.md`: ordered execution and strict exclusions.
- GitHub issue #258: pinned SillyTavern lifecycle/inventory evidence.
- GitHub issue #264: global Host→Provider gate and second explicit Core approval.
- GitHub issue #770: SQLite actual-opened-object TOCTOU/security gate.

### Reconciled conflict

The approved private adapter contract's §7.2 allows fail-closed boundary revalidation and explicitly does not promise linearizable revocation/dispatch. The Core-owned final-disclosure contract requires a shared serialized dispatch-start order for protected Memory-derived payloads. These guarantees cannot be silently treated as identical.

For this integration's stated goal, this specification selects **Option B as the required target architecture**. This is a normative technical target, not a claim that cross-owner acceptance or implementation has already occurred. The affected owners must approve the exact mechanism and guarantee before implementation. Until then Lane B remains NON_READY and production egress remains disabled.

## 17. Change log

- **v1.0 (2026-10-30):** finalizes the trusted authorization target; chooses Lane B as the first isolated slice; specifies Host-owned PC Gateway; defines caller identity rules, immutable request binding, policy fingerprint target, version dimensions, complete inventory, Core/Memory conflict behavior, shared dispatch-start ordering, revoke/write semantics, generic DENY, acceptance matrix and owner approval gates. No runtime behavior changed.
