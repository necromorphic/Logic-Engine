# PC-NEXT-07 — Trusted authorization flow (Draft v3)

**Status:** DRAFT; specification decisions recorded, implementation prerequisites remain.  
**Audit baseline:** `main` `40704c1b6a2b5e6b31379973683f90e4b50eee9c` (2026-10-30).  
**Scope:** documentation only. No production code, schema, runtime configuration, database, tests, PR state, or release status is changed.

## 1. Decision and architecture

Draft v3 closes G1–G10 as explicit contract decisions. The target path has three logical responsibilities:

1. **Host session boundary** authenticates the active SillyTavern session and resolves server-side conversation/world/actor scope.
2. **Core authorization boundary** validates adapter/actor bindings, owns canonical state and policy decisions, and returns a context bound to purpose, recipient, snapshot and source versions.
3. **Host egress boundary** owns dispatch lifecycle and the sole outbound model Gateway. Host verifies session/generation/envelope/transport binding; it does not make a second Core policy decision.

The private contract assigns Host session authentication and sole Gateway to Host, Core authorization and canonical state to Core, Memory provenance/storage to Memory, and belief semantics to NPC (`docs/57-private-host-core-memory-npc-adapter-contract.md` §§1–4). Host and Gateway are two logical responsibilities in the Host-owned egress boundary; this document does not claim they are separate processes or trust domains.

**No complete Host → NPC → sole-Gateway path is verified on main.** Lane A reader is draft/unmerged PR #744. Lane B's `MemoryNpcConsumer` is an internal seam, not a production Host dispatch. Memory → NPC remains **DISABLED / FAIL-CLOSED**.

## 2. Immutable trusted context

Only trusted server-side composition code may create the protected context. It binds:
- authenticated adapter identity;
- Host-authenticated session and stable conversation identity;
- Core-resolved world and canonical actor;
- exact purpose and recipient;
- Host-owned generation/dispatch attempt and one-time nonce;
- Core snapshot cursor `(world_revision, commit_sequence)`;
- source-specific version pins;
- policy authority identity/generation, once implemented;
- digest of the exact serialized request.

Request bodies, prompt text, model output and Memory metadata cannot create or extend this context. Missing, ambiguous, unsupported or stale data produces DENY/NON_READY.

First slice: **NPC subject = canonical actor**. Separate runtime `npc_id` is deferred. If introduced later, its mapping to actor must be Core-owned; caller-supplied `npc_id` is never authoritative.

## 3. Identity resolution and caller payload (G2)

1. Host authenticates the active ST session from server-side session state.
2. Host resolves stable conversation and actor selection from its authenticated server-side session binding.
3. Core derives `adapter_id` only from verified adapter credentials.
4. Core resolves `(adapter_id, conversation_id) → world_id` using its own binding.
5. Core validates the exact actor against its active `(world_id, adapter_id, actor_entity_id)` binding and confirms the canonical entity is eligible.
6. Missing/revoked/ambiguous/cross-world/destroyed/changed bindings deny.

**Current-main correction:** `ActorBindingService.resolve(worldId, adapterId, entityId)` validates a supplied actor ID; it does not select a unique actor from adapter identity. `HostConversationWorldBindingService.resolve({adapterId, conversationId})` resolves a world, not an actor. Thus actor selection must come from Host's authenticated server-side session binding and then be validated by Core. Do not claim unique Core actor selection exists. A future Core-only selection service requires its own contract and ambiguity tests.

**Caller identity rule:** untrusted identity fields are rejected. A documented temporary compatibility adapter may strip them, but downstream scope must be replaced with server-resolved values only. Applies to adapter/world/actor/NPC/conversation/session IDs, purpose, recipient, generation, snapshot, source/record IDs and policy/version fields. Credentials are accepted only through authenticated transport. Host-to-Core internal messages may carry stable conversation/actor references only under authenticated Host identity and server-side binding.

Tests:
- **AUTH-01** missing/invalid adapter credential → DENY.
- **AUTH-02** body adapter substitution → DENY or authenticated identity only.
- **AUTH-03** body world/actor/conversation/session/NPC substitution → reject or strip through documented compatibility adapter; only server-resolved scope is used.
- **BIND-01..04** missing/revoked conversation, actor, destroyed entity, ambiguous selection, cross-world mismatch or unaudited rebind → DENY; never choose first candidate.

## 4. Purpose and recipient (G1)

Purpose and recipient are authorization dimensions, fixed by the trusted operation and included in the immutable envelope/digest.

- Lane A uses exact purpose `npc_turn_context` or `npc_action_evaluation`, according to the operation.
- Lane B and current `MemoryNpcConsumer` use `npc_decision`.
- Cross-lane purpose aliasing or combining results is prohibited until a reviewed Core/Memory mapping authorizes the actual final use.
- Recipient is an exact trusted value (for model dispatch: `model`). A context for `player` or `adapter` cannot be reused for `model`.

Tests:
- **PURPOSE-01** reuse under another purpose → DENY.
- **PURPOSE-02** absent/unsupported/caller-selected purpose → DENY.
- **RECIPIENT-01** reuse for another recipient → DENY.
- **RECIPIENT-02** absent/unsupported/caller-selected recipient → DENY.

## 5. Lane A / Lane B conflict rule (G4)

Core canonical state and Core-authorized acquisition have authority over canonical facts and acquisition-time assignment. Memory is evidence, not canonical truth.

If both lanes describe the same proposition inconsistently:
1. Preserve both source identities and provenance; do not overwrite or silently merge.
2. Memory evidence is marked derived/conflicting/uncertain.
3. It cannot enter NPC decision context as an unqualified fact.
4. It may be included only through a separately authorized evidence channel that explicitly carries uncertainty and whose admission policy permits it.
5. If that channel or policy is unavailable, exclude the conflicting Memory item.
6. Memory retrieval score/order/recency cannot override Core. Resolution requires an authoritative Core transition or separately authorized NPC belief transition, never model preference.

Tests:
- **CONFLICT-01** Core/Memory contradiction → Core remains canonical; Memory excluded or explicitly uncertainty-tagged.
- **CONFLICT-02** Memory ranking cannot override Core.
- **CONFLICT-03** conflict policy unavailable → conflicting Memory evidence omitted.

## 6. Host final revalidation and Gateway (G3, G8)

Host's final step is **not** a second policy authorizer. Immediately before dispatch Host checks only:
1. original authenticated ST session remains active and matches the generation;
2. server-side conversation/world/actor binding is unchanged (otherwise Core must re-resolve or Host denies);
3. the object being sent is the fresh result from final Core/Memory revalidation, not an earlier cached result;
4. purpose, recipient, generation/attempt ID, nonce, source pins, snapshot and payload digest match the immutable envelope;
5. dispatch attempt is one-time and not replayed;
6. route/model/stream/body match the signed request and protected route allowlist;
7. no direct provider fallback exists after Gateway rejection/failure.

Host MUST NOT decide Core field visibility, recreate policy, broaden field allowlists, manufacture policy fingerprints, or treat a signature as proof that permissions remain current. Core/Memory revalidation checks permissions and source freshness at the approved boundary. Host checks session, exact envelope, generation, one-time dispatch and route. Whether the Gateway must also own a shared serialized final-disclosure/dispatch-start decision is an unresolved cross-owner contract conflict recorded in §16; do not claim that the current Host→Gateway sequence provides that stronger ordering.

Tests:
- **HOST-FINAL-01** expired/replaced session or changed binding → DENY.
- **HOST-FINAL-02** stale prepared object instead of fresh result → DENY.
- **HOST-FINAL-03** digest/purpose/recipient/generation/nonce/source/snapshot/model/route/stream mismatch → DENY.
- **HOST-FINAL-04** duplicate/replayed attempt → DENY.
- **EGRESS-01** direct provider route/fallback → DENY.

## 7. Policy authority and fingerprint (G5)

Current main has `createActiveMechanicPolicyValidator(getActiveMechanicContextProvider)` in `src/api/server.js`; it asks a deployment-owned provider to validate mechanic policy identity. This is **not** a versioned disclosure authority carrying `authority_id + generation + snapshot_fingerprint`.

Current `AuthorizedReadService` requires an explicit trusted field-policy callback, validates actor/recipient/purpose and rechecks binding/snapshot after callbacks. Its comment explicitly excludes a cross-process atomic lease. `createApiServer` retains a narrow self-identity-only default when no broader trusted field policy is configured. No request-supplied policy callback is accepted.

Therefore do not relabel the mechanic validator as disclosure authority. No current-main versioned disclosure authority tuple is claimed. Until implemented and configured, protected NPC disclosure remains NON_READY/DENY.

**Proposed fingerprint definition (not implemented):**

`snapshot_fingerprint = SHA-256(canonical_encode({schema_version, authority_id, generation, policy_content_digest, policy_scope, world_pack_id, world_pack_version}))`

- `authority_id`: stable ID assigned by trusted Core composition root.
- `generation`: monotonic generation incremented on policy content, scope or activation change.
- `policy_content_digest`: server-computed digest of canonical effective policy.
- `policy_scope`: exact world/actor, recipient, purpose and field/operation scope.
- World Pack ID/version are included only when effective policy depends on them; otherwise explicit nulls under schema version.

Canonical encoding must specify UTF-8, deterministic key order, normalized strings, explicit nulls, and rejection of non-finite/executable values. Hash is a consistency identifier, not authorization or signature. Core must still validate current authority at use time. Core owner must approve whether World Pack pinning belongs in this schema.

Tests:
- **POLICY-01** authority unavailable → NON_READY/DENY.
- **POLICY-02** generation mismatch → DENY.
- **POLICY-03** content/scope digest mismatch → DENY.
- **POLICY-04** caller/model/Host supplies or increases authority → DENY.
- **POLICY-05** field policy denies/throws → no context.

## 8. Version dimensions and snapshot cursor (G6, G10)

Keep four independent version dimensions:
1. **Core entity source token:** opaque `core-entity-v1:<positive safe integer>` backed by the Core entity source-version ledger, merged by PR #709.
2. **Provider source_version:** for direct `canonical_entity` records, the Core final-disclosure contract maps this to the canonical decimal string of the exact current Core entity's non-negative `updated_revision`; it must be compared against the exact entity snapshot. This is distinct from the opaque Core entity source token above and must not be substituted for it.
3. **Memory record version:** exact `(record_ref, record_version)`, scoped by world/subject/purpose and grant/provenance state.
4. **Acquisition-time value pin:** exact acquired value and sorted source-event set. Source ingestion foundation is main; reader/value/event pins described by draft PR #744 are not main.
5. **Policy version:** `authority_id + generation + snapshot_fingerprint`, proposed above, not confirmed as implemented for disclosure.

**Correction:** `world_revision + commit_sequence` is confirmed in `AuthorizedReadService` and `MemoryNpcConsumer` as a Core snapshot cursor for stale-read comparison. It is not a source journal, acquisition pin, policy fingerprint, universal source version, or proof of cross-database atomicity. No separate `world_snapshot_id` is claimed.

Tests:
- **VERSION-01a** opaque Core entity source token mismatch/missing/malformed → DENY.
- **VERSION-01b** Provider `source_version` does not exactly match canonical decimal `updated_revision` of the current Core entity → DENY.
- **VERSION-01c** Memory record ref/version/grant mismatch or revocation → DENY.
- **VERSION-01d** acquisition value/source-event pin mismatch → DENY; require new acquisition.
- **VERSION-01e** policy generation/fingerprint mismatch → POLICY-02/03.
- **SNAPSHOT-01** Core cursor changes before final validation → DENY.
- **SNAPSHOT-02** cursor equality substituted for source/grant/lineage/completeness proof → DENY.

## 9. Read, state mutation and revocation (G7)

| Operation | Required authority | Boundary |
|---|---|---|
| Read/disclose | Core policy for actor, recipient, purpose, fields and snapshot; Lane B Memory query/record grants | Pre/post revalidation; missing/throwing/changed authority denies |
| State mutation | Separate Core action/write authorization, expected revision, validated effect and Core commit | Authorization and expected revision inside Core commit boundary; read permission never grants write |
| Revoke | Trusted admin/system principal, Core-owned revocation and audit | Future authorization checks must deny revoked permission; Host/model/Memory cannot impersonate revoker |

**Guarantee boundary:** fail-closed at every authorization/revalidation boundary is required. This does **not** claim linearizable revocation against a concurrent commit or already-started external model request. Linearizable revocation requires authorization generation/version to participate in the same serialized Core transaction as protected mutation and, for dispatch, a defined shared order with Gateway durable dispatch-start. Post-read revalidation alone does not close cross-process or transport TOCTOU.

Tests:
- **STATE-01** read permission used for mutation → DENY.
- **STATE-02** stale expected revision at commit → DENY.
- **REVOKE-01** untrusted revocation request → DENY.
- **REVOKE-02** revoked permission at next check → DENY.
- **REVOKE-03** no linearizability claim without transactional generation ordering and concurrency proof.
- **REVOKE-04** asynchronous propagation deadline remains unspecified owner decision.

## 10. DENY semantics (G9)

External protected-read/dispatch failures must use the existing generic non-ready/denial path and must not reveal whether a world, actor, record, field, acquisition, grant or policy exists. The private adapter contract explicitly says it does not invent a new public status enum. Existing Core authorized-read internals include `READ_NOT_AVAILABLE` (404) and `STALE_AUTHORIZED_READ_SNAPSHOT` (409); those internal codes must not be exposed in a way that creates an existence oracle. Any new public error code/status requires explicit API-owner approval.

Detailed reason codes, component, correlation ID and safe identifiers are server-side diagnostics only. Logs must not include raw private message content, secrets or hidden values. Authentication may retain the established generic outer 401.

Tests:
- **DENY-01** missing and withheld targets have same external shape.
- **DENY-02** detailed reason is operator-only and does not leak content/secrets.
- **DENY-03** no partial targets, hidden values, source names, counts or per-field denial details.

## 11. Known constraints

- Actor destruction/replacement can orphan actor-relative Memory records. They must be denied; cleanup/reconciliation is follow-up, not permission to reassign.
- Lane A is not operational: PR #744 reader/value/source-event pin path is draft/unmerged.
- Lane B is not operational for production: consumer is an internal seam without production Host callsite/serializer/Gateway integration.
- Neither lane is approved for production NPC dispatch; activation is a separate release gate.
- No asynchronous revoke propagation deadline is defined.
- Host remains NON_READY; conversation binding does not prove complete/fresh ST history or source authenticity.

## 12. Acceptance matrix v3

| ID | Scenario | Required result |
|---|---|---|
| AUTH-01/02/03 | Credential or caller identity substitution | DENY; server-resolved identity only |
| BIND-01..04 | Missing/revoked/ambiguous/destroyed/cross-world binding | DENY |
| PURPOSE-01/02 | Purpose mismatch, missing or caller-selected purpose | DENY |
| RECIPIENT-01/02 | Recipient mismatch, missing or caller-selected recipient | DENY |
| POLICY-01..05 | Authority missing, generation/content mismatch, caller policy, field denial | NON_READY/DENY |
| READ-01/02 | Unauthorized field, hidden target or partial target set | Generic DENY |
| CONFLICT-01..03 | Lane A/B contradiction or missing conflict policy | Core authority; exclude or uncertainty-tag Memory |
| SNAPSHOT-01/02 | Cursor changes or cursor used as source proof | DENY |
| VERSION-01a..e | Core entity token, Provider source_version, Memory record, acquisition pin, policy version mismatch | DENY |
| HOST-FINAL-01..04 | Session, stale result, envelope mismatch or replay | DENY |
| STATE-01/02 | Read permission used to write or stale commit revision | DENY |
| REVOKE-01..04 | Unauthorized revoke, stale grant, unproven linearizability, unspecified timeout | DENY / no unsupported guarantee |
| DENY-01..03 | Enumeration or content leakage | Generic external response; safe server diagnostics |
| EGRESS-01 | Direct/fallback provider route | DENY |

## 13. Current-main evidence

Audited at `40704c1b6a2b5e6b31379973683f90e4b50eee9c`:
- `src/api/server.js`: adapter ID is derived from configured adapter token plus matching `x-adapter-id`; composes Core conversation/actor binding services; narrow self-only authorized-read policy remains default; mechanic policy validator is not versioned disclosure authority.
- `src/application/host-conversation-world-bindings.js`: Core mapping `(adapterId, conversationId) → worldId`; no actor resolution.
- `src/application/actor-bindings.js`: validates exact `(worldId, adapterId, entityId)`; does not select actor.
- `src/application/authorized-read-service.js`: explicit trusted policy dependency, purpose/recipient checks, post-callback binding/snapshot revalidation; comments exclude cross-process atomic lease.
- `src/application/memory-npc-consumer.js`: subject is actor entity; fixed `npc_decision`; internal retrieval/final-revalidation seam, not transport lease.
- `src/index.js`: Host inventory verifier remains deny-only (`verifyInventorySnapshot: async () => false`).
- `src/security/memory-dispatch-gateway.js`: signed dispatch primitive and protected route allowlist exist; this does not prove ST route wiring or complete end-to-end dispatch.

Related contracts: `docs/57-private-host-core-memory-npc-adapter-contract.md`, `docs/76-core-cross-block-decision-register.md`, `docs/86-cross-block-authority-and-npc-integration-contract-proposal.md`, `docs/91-core-owned-trusted-initial-knowledge-source-decision.md`. PR #709 is merged; PR #744 remains draft/unmerged.

## 14. Implementation and release gate

Before implementation is called ready:
1. Core approves the versioned disclosure authority/fingerprint schema.
2. Host specifies server-side ST session/conversation/actor binding and generation/nonce lifecycle.
3. Core/Host decide Host-resolved + Core-validated actor vs a new Core unique-resolution service.
4. Core/NPC approve conflict-envelope semantics for Memory evidence.
5. Gateway integration proves one protected ST route and no direct/fallback provider send.
6. Acceptance tests exercise actual boundaries, including revoke/commit and transport-start concurrency wherever guarantees are claimed.
7. Exact-head source review and runtime evidence are recorded; unit tests alone do not prove ST UI/transport integration.
8. Separate explicit release approval precedes production enablement.

**Unchanged statuses:** Host **NON_READY**; Stage 2 **NO-GO**; Memory → NPC **DISABLED / FAIL-CLOSED**; production ST **NO-GO**.

## 15. Change log

- **v3:** closes G1–G10; corrects actor-resolution claims against current-main services; distinguishes mechanic policy validation from versioned disclosure authority; specifies Host final checks, Lane A/B conflict precedence, four version dimensions, snapshot cursor limits, revocation guarantee boundary and generic DENY semantics.


## 16. Cross-contract reconciliation — 2026-10-30 (G3/G7/G9 and version semantics)

This section is normative for reading Draft v3 and records an unresolved owner-level conflict. It does not silently supersede either source contract.

### 16.1 Conflicting revocation/dispatch guarantees

Two current-main documents make materially different commitments:

- `docs/57-private-host-core-memory-npc-adapter-contract.md` §7.2 is an **approved private cross-block contract**. It explicitly selects fail-closed revalidation at defined boundaries and explicitly does **not** promise linearizability between concurrent revocation/commit and model dispatch. It states that a revocation after the final check may race with transport handoff; the remaining TOCTOU interval is not solved.
- `docs/architecture/core-final-disclosure-authorization-contract.md` §§1–3 is a **Core-owned decision** for protected Memory-derived payloads. It requires one PC-side serialized egress authority to make the final disclosure decision, durably order dispatch-start, own the sole transport, and serialize all relevant Core/Provider invalidation writers with dispatch-start. Its disposition says cross-owner implementation acceptance remains outstanding.

These statements cannot both be treated as the already-approved cross-block guarantee for the same Lane B payload. The Core document is not evidence that the stronger order is implemented or accepted by Host and Memory; the private adapter contract is not permission to ignore the Core owner's stricter final-disclosure requirement.

**Decision required before Lane B implementation is implementation-ready:** Core, Host and Memory owners must explicitly choose one of:
- **Option A — retain approved boundary revalidation only:** accept the documented residual race after final revalidation and before/during transport handoff; explicitly record Core owner's acceptance of this weaker guarantee for Lane B.
- **Option B — adopt serialized final disclosure/dispatch-start:** approve a concrete shared ordering mechanism; all relevant Core writers, Provider grant/record/lineage/readiness/reconciliation/restore writers and the PC Gateway must participate. The Gateway must evaluate the exact current policy/source/grant/readiness state, bind the exact outbound bytes/route/request identity, durably record dispatch-start, and only then hand bytes to its sole transport. No writer may bypass the order. Crash/restart/restore and ambiguous in-flight behavior require proof.

Until this decision is recorded by the affected owners, Lane B remains NON_READY and cannot be described as having a solved final-dispatch TOCTOU boundary. Draft v3 does not select A or B on their behalf.

Lane A (Core-owned initial acquisition) does not query Provider, so the specific cross-store Core/Provider serialization requirement in the Core final-disclosure document does not automatically map one-to-one. It still requires a Core-owned per-acquisition visibility decision, exact acquisition value/source-event pins, exact request binding and Host sole-Gateway route. Its final revocation/dispatch guarantee must be stated separately by Core and Host; do not infer it from Lane B's rule.

### 16.2 Final authorization responsibility versus Host transport checks

The phrase “Host final revalidation” means Host orchestrates the last approved authorization/freshness call and verifies Host-owned session and transport facts. It does not mean Host independently decides Core field visibility.

- Host authenticates the session, verifies the server-side session/conversation/actor binding and generation, ensures the exact fresh result is used, and verifies the request digest, recipient, purpose, nonce, route, model/stream settings and one-time dispatch identity.
- Core/Memory performs the authorization and source-currentness checks assigned to those owners.
- The sole Host-owned Gateway is the only model transport.
- Under Option B, the Gateway and shared serialization authority must own the final decision + durable dispatch-start order; a separate preflight response/token from Core is insufficient.
- Under Option A, the last Core/Memory revalidation must immediately precede Gateway handoff as §7.2 of the approved private contract states; the residual race remains explicit.

The Gateway is a logical Host-owned component, not a second policy owner. Whether it is a module in the ST server process or a separate PC service is not established by current-main evidence and must be decided in deployment design. The Core document's “PC-side” requirement constrains its location/ownership but does not prove a deployed process exists.

### 16.3 Lane composition rule

The approved private contract §4 explicitly prohibits combining Lane A and Lane B results into one model context until a Core/Memory purpose-mapping rule is approved and tested. Therefore the Lane A/B contradiction rule in §5 of this document is a **future conditional rule**, not permission to combine the lanes now:

- Default: do not combine Lane A and Lane B in the same protected decision context.
- If a future approved mapping permits combination, Core canonical state remains authoritative for claims about actual world state; Memory-derived evidence remains evidence and cannot overwrite canonical state.
- A contradictory Memory item must be excluded from unqualified factual context; it may be retained only in a separately authorized uncertainty-bearing evidence channel. If no such channel/policy exists, omit it.
- Retrieval score, recency, ordering or model preference never resolves the conflict.

### 16.4 DENY/public status compatibility

The approved private adapter contract §9 says the current internal consumer uses `ready / non_ready` and does not invent a new public status enum. Draft v3's proposed `PROTECTED_CONTEXT_NOT_AVAILABLE` is therefore withdrawn as a normative requirement. Use the existing generic non-ready/denial path at the current internal boundary. A new public code or HTTP status requires an explicit API-owner decision and must not expose source existence, counts, fields or policy outcomes.

### 16.5 Source-version crosswalk correction

The current contracts describe multiple independent values. For direct `canonical_entity` records, do not collapse:
- opaque Core entity source token `core-entity-v1:<counter>` (PR #709);
- Provider `source_version`, which the Core final-disclosure contract maps to canonical decimal `updated_revision` of the exact current Core entity;
- Provider `record_version`;
- Core snapshot cursor `(world_revision, commit_sequence)`;
- acquisition-time value + sorted source-event pins (PR #744 candidate);
- proposed disclosure-policy authority generation/fingerprint.

Each must be compared under its own owner-defined semantics. Cursor equality is not a substitute for entity source-version validation or acquisition pins.

### 16.6 Current-main baseline and readiness

Latest repository commit search confirms `main` remains at `40704c1b6a2b5e6b31379973683f90e4b50eee9c` at this audit. The Core final-disclosure contract and private adapter contract were fetched from this exact branch. No implementation or runtime test was performed for this reconciliation.

**Readiness remains unchanged:** Host NON_READY; Stage 2 NO-GO; Memory → NPC DISABLED / FAIL-CLOSED; production ST NO-GO. The cross-contract guarantee conflict is an explicit implementation blocker, not a defect to resolve by weakening fail-closed behavior.
