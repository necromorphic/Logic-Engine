# Private Host–Core–Memory–NPC Adapter Contract

Version: 0.1  
Status: **APPROVED AS PRIVATE ARCHITECTURE CONTRACT; NOT A PRODUCTION API OR ENABLEMENT APPROVAL**  
Decision authority: project owner delegated architectural decisions for Core, Memory, Host and NPC to the coordinator.  
Scope: contract semantics and implementation boundaries only. No runtime wiring, schema migration, public endpoint, or production enablement is authorized by this document.

Related evidence:
- `docs/56-npc-memory-boundary-acceptance-matrix.md`
- `docs/50-npc-initial-knowledge-acquisition-contract.md`
- `src/npc/memory-candidate-eligibility.js`
- `src/application/memory-npc-consumer.js`
- `src/application/sqlite-memory-provider.js`
- `src/application/authorized-read-service.js`
- `src/application/actor-bindings.js`

## 1. Decision

This document resolves the private adapter architecture and the semantic decisions required to plan implementation.

It does **not** claim that the end-to-end path exists. Current implementation evidence shows:
- the NPC admission oracle is metadata-only and returns reference projections;
- `MemoryNpcConsumer` is an internal application seam, not a public API, and is not wired into the production NPC runtime;
- the consumer currently supports only direct `canonical_entity` sources, excludes summaries, and fails non-ready for initial/imported knowledge until Core assignment-read proof exists;
- `ActorBindingService` binds an authenticated adapter identity to a canonical actor, but does not itself grant Memory or field disclosure;
- `AuthorizedReadService` is the Core-owned field disclosure boundary;
- no complete production Host → NPC decision/context → Gateway path has been demonstrated.

Therefore this contract defines the target private boundary without relabelling existing helpers as a finished adapter.

## 2. Non-negotiable ownership

| Block | Owns | Must not do |
|---|---|---|
| Host | Session authentication; session-to-world/actor binding; dispatch lifecycle; sole outbound model Gateway; exact context serialization | Decide Memory trust, grant Core access, create canonical facts/acquisitions, bypass Gateway |
| Core | Authenticated adapter identity validation; actor binding resolution; authorization; canonical truth; acquisition identity/validity; snapshot consistency; restricted-field disclosure; canonical commit | Delegate canonical authority to Memory or NPC; accept model-supplied identity/authorization |
| Memory | Record storage/index; record/query grants; provenance; source identity/version; lineage; completeness/index health; reconciliation evidence | Decide canonical truth; grant itself permission to disclose canonical fields; create Core acquisition or NPC belief |
| NPC | Admission semantics; belief/inference; uncertainty/conflict preservation; decision-context interpretation | Own canonical state, source validity, acquisition ledger, access policy, or model egress |

Core is the authorization and canonical-state authority. Memory is an evidence provider, not an authority to disclose Core-owned canonical values. NPC is a consumer and interpreter, not a second truth store.

## 3. Private call path

Target logical path:

1. Host authenticates the active SillyTavern session and resolves its server-side binding to exactly one `world_id` and actor/NPC identity for the generation.
2. Host invokes the private Core application boundary using its configured authenticated adapter identity. Session and actor identifiers are not trusted merely because they appear in a request body.
3. Core resolves the adapter-to-actor binding through `ActorBindingService`. A missing, revoked, ambiguous, cross-world or destroyed-actor binding fails closed.
4. Core orchestrates the Memory query/retrieval boundary for the fixed purpose `npc_decision`. Memory must return a complete, current, bounded result with record- and query-level authorization, provenance, source identity/version, lifecycle and snapshot metadata.
5. Core verifies that each candidate is in scope and supported. The current first slice accepts only direct `canonical_entity` sources. Summary/derived-source lineage is unsupported until every lineage source has an authoritative authorization and freshness proof.
6. Core reads only an explicit trusted field allowlist through `AuthorizedReadService`, using the same actor binding, recipient `model`, purpose `npc_decision`, and exact target set. The Core snapshot must match the Memory result snapshot.
7. NPC admission evaluates the metadata using `evaluateMemoryCandidateAdmission`. The helper is a filter only: its `ready` result is not authorization, acquisition, belief, or proof of source authenticity.
8. Before model dispatch, Host invokes the final revalidation boundary and uses only the freshly revalidated result. Host then performs its durable dispatch-start transition and sends through the sole Gateway.
9. Any canonical mutation caused by NPC output is a separate Core-owned command/commit. Context retrieval, admission, inference, or model output is never a commit.

The current `MemoryNpcConsumer.retrieveForNpc()` and `revalidateForFinalDispatch()` are implementation seams relevant to steps 3–7. They are not evidence that steps 1, 8 or the production NPC callsite exist.

## 4. Request binding and session scope

The private call must be bound to:
- authenticated adapter identity established by Host/Core credentials;
- canonical `world_id`;
- canonical actor/NPC entity identity;
- fixed purpose `npc_decision`;
- one generation/dispatch attempt identity owned by Host;
- a trusted snapshot requirement.

Host owns the session-to-world/actor mapping. Core owns validation of the adapter-to-actor binding. The actor ID, world ID, purpose, record IDs, field allowlist, and snapshot values must never be accepted from model output or prompt text.

No new public `session_id` wire field is prescribed. The current Core adapter authentication and actor-binding interfaces do not establish a SillyTavern session contract. Host must pass a trusted server-side binding to the private application boundary; any new cross-process session-binding endpoint or token claim is a separate API change requiring explicit approval.

The adapter binding authorizes identity resolution only. It is not a blanket grant to all Memory records or canonical fields.

## 5. Acquisition identity and rollback

### 5.1 Authority

Core alone owns acquisition identity, assignment, validity, rollback and reconciliation. Memory record identity (`record.ref + record.version`) is not an acquisition identity. A Memory hit, query grant, candidate admission, context inclusion, context manifest, generated statement or delivery attempt does not create acquisition.

The first initial-knowledge slice remains exactly `author_initial` and `imported`, as defined by `docs/50-npc-initial-knowledge-acquisition-contract.md`. Other acquisition kinds remain unsupported unless separately approved.

### 5.2 Required semantic identity

An acquisition is an immutable Core-owned assignment of a specific proposition/source to a specific subject in a specific world under a specific authorization basis and initial boundary.

Its identity must be anchored to a unique, non-reusable Core assignment/event identity and bind, at minimum, the semantic tuple:
- world;
- subject;
- acquired proposition/fact or Core-recognized source reference;
- acquisition kind;
- authorization basis;
- provenance/source identity;
- initial assignment boundary;
- immutable assignment payload/version.

The physical schema and identifier encoding are Core decisions. Do not introduce an NPC-local acquisition ID, derive identity from `fact_id` alone, or treat a Memory record ID/version as sufficient.

### 5.3 Rollback and reuse rules

- Rollback invalidates the affected assignment according to Core's canonical event validity rules; it does not erase the audit identity or make it reusable.
- Replaying the same still-valid canonical assignment event with the same immutable payload is idempotent.
- Reusing an old assignment/event identity with a different proposition, source, authorization basis, subject, or payload is a conflict and must fail closed.
- Re-acquisition after rollback requires a new Core-owned assignment event identity/generation. It must not resurrect the invalidated acquisition by reusing the old ID.
- If Core cannot prove unique event identity, payload binding, and rollback validity for a source type, that source type is `unsupported/non_ready`.
- `world_revision + commit_sequence` is a snapshot marker only. It is not a durable source-change feed, acquisition identity, or proof that rollback did not occur.

This explicitly closes the acquisition-reuse defect class without inventing a new NPC-side ledger.

## 6. Provenance, versions and snapshot consistency

Every candidate intended for disclosure must have authoritative:
- stable record reference and record version;
- source kind and source reference;
- source version/validity proof;
- producer provenance (producer is not automatically the content author or authority);
- lifecycle dimensions, including content disposition, source reconciliation, evidence assessment, access outcome and index health;
- world/subject/purpose scope;
- complete result declaration and bounded candidate set;
- snapshot marker that can be compared to the Core canonical read.

For a summary, every source in its lineage must have a stable identity/version, same world and recipient/purpose scope, current freshness and an allow decision. Until this can be proven, summaries are excluded. A producer ID or summary's own version does not substitute for source lineage.

Memory's `source_version` and Core's `world_revision + commit_sequence` are different version domains. Core's snapshot must not overwrite or impersonate Memory's source freshness. A mismatch, missing version, incomplete inventory, stale index, unknown lifecycle state or conflicting identity makes the result non-ready.

A complete-empty result is valid only if Memory proves complete authorized inventory for the requested scope and Core proves the same current snapshot. Denied, withheld, partial, unavailable, rebuilding or unsupported results must never be converted to empty.

## 7. Authorization and final model egress

### 7.1 Revalidation points

Authorization and validity are rechecked at these boundaries:
1. **Acquisition/assignment:** Core validates explicit subject assignment and its authorization basis.
2. **Context preparation:** Core resolves actor binding, Memory query/record grants, canonical field policy and snapshot consistency.
3. **Immediately before model send:** Host invokes `revalidateForFinalDispatch()` (or its separately approved equivalent) as the last authorization/freshness check. It must use the fresh returned context, not the previously prepared object.
4. **Before canonical commit:** Core revalidates the caller, actor/world scope, expected canonical revision, policy/authorization and command validity inside the commit boundary.

If any check is unavailable, throws, returns an unknown state, or cannot establish current authorization, the operation fails closed. No stale cached allow decision may be reused.

### 7.2 Explicit guarantee boundary

This contract guarantees fail-closed revalidation at the defined boundaries. It does **not** claim linearizability between a concurrent Memory/policy revocation and a model request that has already passed final revalidation.

Host must order its own dispatch lifecycle as:
- final revalidation;
- durable `DISPATCH_STARTED` transition under the existing Host dispatch/idempotency mechanism;
- sole Gateway send.

There must be no alternate egress path and no use of a stale pre-revalidation context. A revocation observed by the final revalidation blocks the send. A revocation racing after that check may occur after the request has crossed the dispatch boundary; this contract does not promise cancellation or atomic ordering across the Host and Memory/Core stores.

If strict linearizability is later required, it is a separate design: policy version must participate in a Core transaction/authorization fence that orders the dispatch authorization with revocation. It is not implied here and must not be claimed by tests or documentation.

### 7.3 Gateway ownership

Only Host Gateway sends model requests. Core and Memory do not call the model. NPC does not open its own transport. Any request that bypasses Gateway is a contract violation.

## 8. Epistemic mapping and canonical precedence

Memory's current vocabulary is not itself an NPC belief schema:
- `content_kind`: `claim`, `report`, `summary`, `author_initial`, `imported`, `inference`;
- `epistemic_kind`: `canonical`, `acquired_report`, `rumor`, `inference`, `authored_initial`, `imported`;
- `evidence_assessment`: `unassessed`, `supported`, `disputed`, `insufficient`.

The mapping is deliberately conservative:

| Memory class / assessment | NPC interpretation | Constraint |
|---|---|---|
| `epistemic_kind=acquired_report` | `reported/unconfirmed` | Preserve source attribution; not confirmed fact |
| `epistemic_kind=rumor` | `rumor` | Never promote to confirmed by repetition |
| `epistemic_kind=inference` | `inference` | Preserve premises and uncertainty; inference is not observation |
| `epistemic_kind=canonical` | canonical evidence reference, not an NPC belief | Core truth does not imply subject acquisition or belief |
| `epistemic_kind=authored_initial` | `known/assigned` only after Core proves explicit assignment | Does not imply belief, objective truth, or in-world observation |
| `epistemic_kind=imported` | `known/assigned` only after Core proves explicit subject assignment | Import into world state alone is not actor knowledge |
| `evidence_assessment=supported` | supported evidence | Not automatically `confirmed` |
| `evidence_assessment=disputed` | `disputed/conflicting` | Keep conflicting claims distinct |
| `evidence_assessment=insufficient` | `insufficient/unknown` | Must not be treated as negative proof |
| `evidence_assessment=unassessed` | `unassessed` | No confidence promotion |

No automatic mapping to `confirmed` is permitted from `canonical`, `supported`, producer trust, repetition, retrieval score, or model fluency. A future `confirmed` belief requires an explicit NPC belief rule with independently sufficient subject-relative evidence and an approved transition policy.

Suspicion is an NPC inference/stance, not a Memory source class. It may be created only by NPC cognition from explicitly available premises and must remain labeled as suspicion. Absence of a record means unknown unless Core proves a complete authorized scope that supports `known_absent`.

### Canonical precedence

1. Core canonical state has priority for claims about the actual world.
2. Memory-derived evidence never overwrites canonical state.
3. If derived belief conflicts with canonical state, NPC must preserve the conflict as `disputed/derived_uncertain`; it cannot present the derived claim as canonical fact.
4. If provenance is incomplete, stale, revoked or conflicting, the derived belief is excluded from decision context unless an explicit approved policy allows a clearly marked uncertain use.
5. A subject may have a mistaken subjective belief, but that belief remains a subject-relative derived state and cannot mutate or supersede Core truth.
6. No derived belief becomes canonical without an independent Core-owned command/commit.

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
| C1 — Core acquisition closure | Immutable assignment identity, rollback non-reuse, assignment-read proof, canonical precedence and version-pinned read | Not implemented/proven end-to-end |
| C2 — Memory evidence closure | Authoritative provenance/source versions, complete inventory, lineage and revocation/reconciliation proof | Partial; production authority not established |
| C3 — Host boundary | Trusted session binding, durable dispatch lifecycle and sole Gateway egress with final revalidation | Not proven for this Memory→NPC path |
| C4 — NPC runtime | Real NPC decision/context callsite consumes only the approved envelope | Not implemented/proven |
| C5 — E2E acceptance | All required negative and recovery cases pass on the integrated path | Not tested end-to-end |
| C6 — Independent acceptance | Independent review against exact commit SHAs and evidence | Not started |
| C7 — Production enablement | Separate explicit approval after C1–C6 | **Not authorized** |

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
