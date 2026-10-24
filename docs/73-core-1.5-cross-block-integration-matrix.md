# Core 1.5 cross-block integration matrix

**Status:** evidence-based integration audit, documentation only.  
**Audit date:** 2026-10-24.  
**Main baseline checked:** `378123fec5fc07dd4251ebe2028831da51a30fff`.  
**Purpose:** keep parallel Core, Memory, Relationships, NPC, and Personality work compatible without treating an open PR or a branch-local proposal as shipped runtime behavior.

This document records observed repository state and integration gates. It does not approve a new API, schema, storage model, authorization policy, or merge. Re-check branch heads before acting on this snapshot.

## 1. Evidence vocabulary

- **Main runtime** — code/docs present on the recorded `main` baseline.
- **Open implementation PR** — executable candidate exists on an unmerged branch; not a main guarantee.
- **Proposal only** — contract or design document without corresponding production-path implementation.
- **Branch-local** — content exists only on a sibling working branch.
- **Blocked** — a required production contract or test seam is absent; mocks/specification do not satisfy the gate.
- **Ready for independent work** — a task can proceed without assuming a blocked interface.

## 2. Current cross-block status

**Status refresh (2026-10-24):** PR #61 (first-slice replay decision), PR #84 (extension-point audit), and PR #91 (Relationship domain-side handoff) are merged as documentation/decision records; PR #62 is merged as a pure evaluator; PR #65 and PR #83 are merged runtime slices with intentionally narrow scopes; PR #94 adds the admin-gated typed Relationship writer/projection/replay; PR #95 completes event/audit failure-injection tests; PR #96 rejects unapproved alternative-support metadata and links source rollback causality; PR #93 completes Personality/Relationship per-case evidence traceability; PR #97 and #98 integrate the current Memory and NPC contracts; PR #101 adds an opt-in trusted host field-policy hook for bounded authorized reads while preserving the self-identity-only default; PR #103 binds public proposal commit to the creating adapter; PR #106 restricts context-manifest registration to the internal host credential. Concrete production visibility policy, trusted manifest generation binding, and Memory/NPC source-reconciliation boundary are still not implemented.


| Area | Verified evidence | Current status | Integration consequence |
|---|---|---|---|
| Canonical world state, event commit, world revision / commit sequence, and limited causal rollback | `src/application/engine.js`, `docs/21-stage1-causality-contract.md`, `docs/24-causality-test-matrix.md` on `main` | Main runtime, with documented limits | Reuse existing Core lifecycle; do not claim proof-complete causal completeness or general relationship replay. |
| Actor-to-entity binding | `src/application/actor-bindings.js` on `main` | Main runtime, but identity binding only | A bound actor is not automatically authorized to read arbitrary world facts, memories, beliefs, or relationship attributes. |
| Actor/recipient/purpose/field-authorized reads | [PR #65](https://github.com/necromorphic/Logic-Engine/pull/65), [PR #101](https://github.com/necromorphic/Logic-Engine/pull/101), [PR #102](https://github.com/necromorphic/Logic-Engine/pull/102) | Main runtime seam, intentionally fail-closed by default | Raw canonical HTTP reads/events/audit require internal/admin credentials; proposal reads are creator-scoped. The default authorized-read policy is self-identity-only. PR #101 allows a host-supplied trusted field policy and bounded target list; PR #102 proves other targets remain unavailable without it. This is not general NPC/Relationship authorization yet. |
| Trusted initial import / author correction provenance | [PR #63](https://github.com/necromorphic/Logic-Engine/pull/63), current head `cf7df864` | Proposal only | Caller-supplied `origin` must not grant authority. Trusted authority source, correction semantics, and audit attribution remain open implementation gates. |
| HTTP rollback authorization hardening | [PR #83](https://github.com/necromorphic/Logic-Engine/pull/83) | Main runtime; exact-head Runtime tests passed before merge | Every HTTP canonical rollback requires a separate admin credential regardless of event type. Trusted in-process callers still need equivalent authorization. |
| Trust-boundary / proposal-execution audit | [PR #67](https://github.com/necromorphic/Logic-Engine/pull/67) | Proposal only | Useful as an audit plan, not an authorization implementation or approved policy. |
| Typed relationship write, atomic commit and relationship-specific replay/rollback | [PR #94](https://github.com/necromorphic/Logic-Engine/pull/94), [PR #95](https://github.com/necromorphic/Logic-Engine/pull/95), [PR #96](https://github.com/necromorphic/Logic-Engine/pull/96), with decisions in #61/#84 and handoff in #91 | Main runtime; Runtime tests passed on exact PR #94 head `1aa59e6d` (run #705), PR #95 head `6b8c4e6f` (run #707), and PR #96 head `79deb588` (run #717) | Admin-gated `relationship.transition` uses immutable versioned `metadata.relationship_domain`, canonical commit/audit/idempotency, directed projection/rebuild, composite freshness, and rollback dependency replay. General NPC/model writes and authorized Relationship reads remain blocked. #77 can close for the privileged first slice; visibility and non-admin authority remain separate gates. |
| Pure relationship candidate evaluation | [PR #62](https://github.com/necromorphic/Logic-Engine/pull/62) | Main runtime; exact-head tests passed before merge | The evaluator returns a candidate only. It does not resolve identities, authorize evidence, write state, create events, or provide rollback. Its input shape is not a Core API or wire format. |
| Relationship module boundary and test traceability | [PR #80](https://github.com/necromorphic/Logic-Engine/pull/80), [PR #91](https://github.com/necromorphic/Logic-Engine/pull/91) | Selected Relationship boundary and Core handoff docs are integrated on main; source PR #60 was closed unmerged | Domain semantics can be reviewed independently; the docs do not imply a consumer runtime. Canonical writing is implemented separately in #94–#96. |
| Memory record/retrieval/summary contracts | [PR #81](https://github.com/necromorphic/Logic-Engine/pull/81), [PR #97](https://github.com/necromorphic/Logic-Engine/pull/97), [PR #101](https://github.com/necromorphic/Logic-Engine/pull/101) | Memory contracts and Memory→NPC reconciliation are integrated; Core has an opt-in trusted host policy seam, but no concrete production Memory retrieval policy/path is configured | Retrieval must remain separate from access authorization and NPC knowledge acquisition. Memory must not become a second canonical or belief store. |
| NPC knowledge acquisition, delivery, and belief boundary | [PR #98](https://github.com/necromorphic/Logic-Engine/pull/98), legacy divergent [PR #76](https://github.com/necromorphic/Logic-Engine/pull/76) | Current NPC-owned contract docs are integrated on main; PR #76 remains Draft/unmerged and divergent | Semantic contract is available on main, but no NPC production runtime integration is supported. Do not merge/rebase the divergent branch as a shortcut. |
| Personality traits and relationship interpretation | [PR #79](https://github.com/necromorphic/Logic-Engine/pull/79), [PR #93](https://github.com/necromorphic/Logic-Engine/pull/93) | Selected cross-block docs and per-case executable evidence traceability are integrated on main | Personality owns stable-trait semantics and interpretation; it does not own canonical persistence, authorization, or rollback. Keep its acceptance IDs and crosswalks; do not duplicate relationship acceptance systems. |
| Older Personality subsystem branch | `feat/personality-subsystem` | Diverged (62 ahead / 14 behind at audit) | Do not base a new integration PR on this branch without explicit reconciliation; use the ahead-only crosswalk branch as the safer review reference for its listed docs, subject to owner review. |

## 3. Ownership and integration matrix

| Boundary | Owning block | Required handoff | What must not be inferred |
|---|---|---|---|
| Canonical facts/events, world revision, commit, audit, trusted mutation authority, rollback/replay | Core | Typed and versioned operation; authorization result; provenance; atomic outcome; canonical event/revision/audit basis | A domain candidate or caller-supplied origin is not a canonical change. |
| Generic archival/evidence records and retrieval/index lifecycle | Memory | Stable record/source reference and version, world scope, typed source/epistemic kind, provenance/lineage, lifecycle/freshness, bounded deterministic result and explicit partial/unavailable status—only where each is supported by the agreed contract | Search result, rank, embedding similarity, or prompt inclusion does not mean the source is authorized, current, true, delivered, acquired, or believed. |
| Subject-specific acquisition, delivery attempt/receipt, belief/inference and source reconciliation | Core knowledge lifecycle with NPC semantics | A permitted candidate source enters an explicit acquisition/delivery/belief transition; failure, duplicate, stale source, and retraction outcomes remain distinct | Memory must not create a parallel acquisition, delivery, belief, causal, or rollback ledger; NPC must not treat retrieval as knowledge. |
| Relationship dimension meanings and candidate transition rules | Relationships + active World Pack | Directed, partial, version-pinned candidate; explicit distinction among unset, explicit neutral, cleared, withheld, conflict, insufficient, unsupported | A candidate is not authorized evidence or canonical state; A→B does not imply B→A. |
| Relationship canonical mutation and projection/replay | Core | Trusted typed write, canonical identity check, revision/commit basis, idempotency, audit, atomic failure, deterministic first-slice replay/rollback | Pure evaluator tests do not establish write atomicity, projection freshness, or rollback correctness. |
| Stable traits, goals/beliefs/conditions distinction, personality semantics | Personality | Explicit authored trait/profile semantics and acceptance IDs consumed by NPC/World Pack | A trait does not dictate an action; a relationship value does not establish its cause or an NPC's knowledge. |
| Decision context, autonomous action proposals, player agency | NPC | Consume only authorized, actor-relevant and freshness-valid inputs; preserve source attribution and epistemic distinctions | A model prompt, retrieved memory, card summary, or generated rationale is not itself a state transition or proof. |
| Character-card / narrative summary | Read-only projection consumer, under Core read policy | Bounded authorized snapshot and freshness basis; summary must be regenerated/withheld when source access or validity changes | Summary prose is not canonical state, evidence, belief, or a new acquisition event. |

## 4. Integration gates — ordered by dependency

### Gate 1 — Establish the trusted read boundary

Evidence: actor binding establishes identity only. PR #65 is merged as a narrow self-identity-only authorized-read slice; PR #101 adds an opt-in host policy hook; PR #102 verifies default non-self denial. PR #104 integrated the policy contract/audit. A concrete policy is still unconfigured.

Required before production Memory/NPC/Relationship reads:
1. Decide and approve the visibility/authorization policy and its trusted source.
2. Bind authenticated requester, in-world actor, recipient, purpose, target, and fields separately.
3. Apply authorization before serialization; fail closed on missing/ambiguous policy and avoid leaking withheld-record existence.
4. Audit direct in-process snapshot consumers, not only HTTP routes.
5. Test cross-world, unauthorized, withheld, missing, stale snapshot, and partial-field cases through the real production path.

**Independent work that can proceed:** contract review, negative-case matrices, and tests against already-existing pure functions. Do not present mocks as production authorization passes.

### Gate 2 — Establish trusted mutation provenance

Evidence: PR #63 documents the boundary but does not implement it.

Required before author import/correction or relationship writes:
1. Derive authority from a trusted authenticated execution path, never from a caller-controlled provenance label.
2. Keep initial import, in-world transition, and author correction distinct.
3. Define audit attribution, idempotency/retry behavior, and failure atomicity.
4. Test unauthorized self-assignment, spoofed origin, partial failure, duplicate retry, and correction audit.

### Gate 3 — Establish typed relationship commit

Evidence: PR #62 supplies pure candidate evaluation; PR #61 records the approved first-slice replay boundary; PR #94–#96 implement the admin-gated typed write, projection/replay and fail-closed tests. PR #101 adds an opt-in trusted host policy seam for bounded authorized reads, but the default remains self-identity-only and no approved production Memory/NPC visibility policy is configured.

Required:
1. Validate canonical participant identities and same-world scope in Core.
2. Convert a validated candidate into a typed Core operation without letting the evaluator write.
3. Atomically commit canonical state, event history, projection/revision, idempotency result, and audit—or leave all unchanged.
4. Pin the applicable domain/rule version.
5. Implement the agreed first-slice replay of surviving valid typed transitions and relationship-specific rollback; do not silently add alternative-independent-support semantics.
6. Exercise a real commit and rollback/replay production path; pure tests alone do not satisfy this gate.

### Gate 4 — Define Memory-to-NPC knowledge lifecycle

Evidence: Memory contracts are integrated through PR #81 and the Memory↔NPC reconciliation through PR #97; the current NPC contract package is integrated through PR #98. These are documentation-only. The authorized-read service now accepts a trusted host policy hook (#101), but no concrete Memory/NPC visibility policy is configured; source-change/reconciliation signal, persistence transaction boundary, and NPC-owned actor/delivery runtime remain open.

Required before Memory runtime finalization:
1. Approve the minimal retrieval response and the owner of each field.
2. Keep archival record, acquisition record, delivery attempt/receipt, and belief/inference as distinct semantic records.
3. Specify duplicate retrieval/delivery, delivery failure, stale index, source version change, retraction after acquisition, and unavailable policy.
4. Decide how source invalidation reaches Memory: a durable Core change feed/outbox if approved and implemented, or explicit reconciliation/polling with bounded staleness. Do not assume a durable outbox exists.
5. Require authorized revalidation of hits and derived summaries; actor binding alone is not read authorization.

### Gate 5 — Personality and NPC consume approved semantics

Independent semantic work can continue now:
- preserve PERS-SEM and REL-SEM acceptance ownership and the current crosswalk;
- keep stable traits, temporary condition, goals, beliefs, conduct, and canonical relationship state distinct;
- test directionality, partial dimensions, unset/neutral/cleared/status separation, no invented causal motive, and player agency at existing pure seams;
- mark real authorization, commit, stale projection, acquisition/delivery, and rollback assertions **blocked** until the corresponding production interfaces exist.

## 5. Decisions that must remain open until owners approve them

| Decision | Why it cannot be guessed | Current owner(s) |
|---|---|---|
| Visibility policy / authorized field disclosure | The current actor binding proves identity resolution, not permission to read arbitrary data | Core, with Memory/NPC consumers |
| Trusted authority source for import/correction | A provenance string is not proof of authority | Core |
| Durable source-change feed/outbox versus reconciliation | Crash durability and invalidation guarantees differ | Core + Memory |
| Shared database transaction versus optional separate Memory store | Atomicity and coupling differ | Core + Memory |
| Actor/recipient IDs and delivery record semantics | Memory must not invent a second delivery ledger | NPC + Memory + Core |
| Exact transaction scope for relationship state/event/projection/audit | Partial commit would violate the canonical-state contract | Core |
| Alternative independent relationship support | Not required for the first slice and not established by the current runtime | Core + Relationships; domain rules from World Pack |
| Memory summary declassification when source access changes | A derived summary can leak a source to a reader who cannot access it | Core + Memory |

## 6. Current disposition

- **Can proceed independently:** pure Relationship evaluator and tests; Relationship/Personality semantic review; Memory record/retrieval contract review; NPC acquisition/delivery semantic design; Core trust-boundary audit and negative-test specification.
- **Not integration-ready:** actor-authorized multi-entity reads; trusted import/correction; non-admin/NPC relationship mutation authority; Memory/NPC production knowledge lifecycle; authorized freshness-aware relationship/card projection. The privileged admin-authored Relationship write/replay slice is on main.
- **No merges or mainline changes are implied by this matrix.** Open Draft PRs and sibling branches remain separate until their contracts and runtime evidence are reviewed together.


| NPC Memory/acquisition/delivery contract | [PR #98](https://github.com/necromorphic/Logic-Engine/pull/98) | NPC-owned contract package integrated on main; docs only, no production Memory read/acquisition/delivery/belief runtime | Keep retrieval, authorization, delivery/receipt, acquisition, belief persistence, and narrative presentation as distinct lifecycle stages. No NPC-local store or cursor. |

## 7. Core production-path audit (main baseline)

**Audited files:** `src/api/server.js`, `src/application/proposals.js`, `src/application/actor-bindings.js`, `src/application/engine.js`, and `src/storage/sqlite-store.js` on the recorded `main` baseline. This is static source review, not a local runtime reproduction.

### Finding CORE-AUTH-01 — proposal commit authority is broader than proposal ownership

**Severity: High; confirmed in source.**

- In `src/api/server.js`, the `POST .../proposals/:proposal_id/commit` branch calls `proposals.commit(worldId, proposalId)` without requiring a configured adapter identity or matching the proposal's `created_by_adapter_id`.
- `ProposalService.commit()` enforces that the proposal exists, has been approved, and is not stale; it does not bind the executor to the proposal creator.
- The separate internal route is restricted to an approved proposal ID, but that does not narrow the ordinary public commit route.

**Impact:** a caller with the general API bearer token who learns an approved proposal ID can execute its commit even when it is not the adapter that created it. Approval and stale-revision checks remain in place; the finding is an execution-authority mismatch, not arbitrary event injection.

**Candidate fix for review:** preserve the existing adapter credential and require its authenticated adapter ID to match `created_by_adapter_id` on the public commit route. Keep the existing internal orchestrator path separately capability-gated. Do not use a request-body adapter ID as authority. Add cross-adapter denial, creator success, internal-path success, committed replay, and no-state-change-on-denial tests.

**Related proposal:** [PR #67 — trust-boundary audit](https://github.com/necromorphic/Logic-Engine/pull/67) / [PR #65 — authorized read service](https://github.com/necromorphic/Logic-Engine/pull/65). No fix is assumed merged.

### Finding CORE-AUTH-02 — raw canonical reads are available to any caller with the general API bearer

**Historical finding at the recorded source-audit baseline; fixed in main by PR #65.** The general bearer no longer suffices for raw canonical HTTP reads; the narrow self-identity-only route is not general actor/recipient/purpose/field authorization.

- `src/api/server.js` authenticates the general bearer globally.
- The `GET .../state`, `GET .../events`, and `GET .../audit` branches then return raw canonical snapshots/history/audit without requiring the separate internal or administrative credential.
- `SQLiteStore.readSnapshot()` explicitly documents that attributes, facts, events, manifests, and mechanic evaluation state are raw internal data and are not actor-authorized or model-safe context.
- `ActorBindingService.resolve()` establishes adapter-to-actor identity binding only; its class contract explicitly disclaims knowledge-read authorization.

**Impact:** the HTTP boundary does not currently enforce the distinction between general API access and trusted raw-state inspection. Whether exploitable depends on credential distribution, but the code itself does not enforce the intended boundary.

**Fix on main:** PR #65 requires a separate internal/admin credential for raw state/events/audit and limits the authorized-read endpoint to the bound actor's identity metadata. This does not establish actor/recipient/purpose/field policy or secure direct in-process serializers; those remain separate gates.

### Finding CORE-AUTH-03 — rollback authorization is conditional on effect kind

**Historical finding at the recorded source-audit baseline; fixed in main by PR #83.** Every HTTP canonical rollback now requires the separate admin credential; in-process rollback remains a trusted-host responsibility.

- In `src/api/server.js`, `POST .../rollback` checks the separate admin credential only when the target root event contains a `mechanic.instance.*` effect.
- All other canonical event types proceed to `engine.rollbackEvent()` under the global general bearer check alone.
- Rollback changes event validity, world revision, derived projections, rollback history, and audit.

**Fix on main:** [PR #83](https://github.com/necromorphic/Logic-Engine/pull/83) requires the separate admin credential for every HTTP canonical rollback, regardless of event type.

### Verified positive invariants — do not replace existing lifecycle

The current Core write path has useful safeguards that the future typed Relationship operation should reuse rather than bypass:

- `SQLiteStore.tx()` uses `BEGIN IMMEDIATE` for the outer transaction and savepoints for nested calls; thrown errors roll back the relevant transaction scope.
- `SQLiteStore.commit()` checks idempotency before new writes, validates expected world revision, rejects duplicate event IDs, validates causal metadata and relevant entity/mechanic preconditions, then writes the event, advances world revision/game time, rebuilds projections, writes audit, and saves the idempotent result in the same transaction.
- `ProposalService.commit()` wraps canonical commit, proposal status transition, and proposal audit in the existing transaction; stale world revision **or** commit-sequence mismatch rejects the commit.
- `SQLiteStore.rollback()` performs causal invalidation, revision update, event-validity changes, projection rebuild, rollback row, audit, and replay result in one transaction. A `requires_review` outcome stores its idempotent diagnostic response without applying a semantic rollback or incrementing world revision.
- The event cursor is `MAX(commit_sequence)`; rollback advances `world_revision` but does not create a new world event or advance `commit_sequence`. Consumers must therefore use the composite freshness marker `(world_revision, commit_sequence)`, not the event cursor alone.

These are source-level findings. Follow-up test coverage has since been merged through PRs #72 and #74: PR #72 exercises injected rollback projection failure, canonical commit/rollback replay-record persistence failure, atomic rollback metadata, retry/replay behavior, nested savepoint isolation, and proposal-commit failure recovery; PR #74 exercises composite snapshot freshness, cross-world/missing manifest handling, and snapshot size boundaries. These tests strengthen existing Core invariants, but they do not by themselves implement a typed Relationship operation. Explicit injected audit-write failure and stale revision/cursor race coverage remain separate verification items before a new Relationship operation can claim those guarantees.

### Core implementation order after this audit

1. Close the execution/read/rollback HTTP trust-boundary findings with small independently reviewable changes, preserving proposal approval and commit lifecycle.
2. Keep the authorized-read service fail-closed and narrow until a trusted field visibility schema and recipient/purpose contract are approved.
3. Add a Core-owned typed Relationship commit operation only after its request shape, domain-version pinning, identity checks, and audit attribution are approved. Reuse `SQLiteStore.tx()` and canonical event commit; do not write relationship projections directly from the evaluator.
4. Add transaction-failure and composite-cursor tests before claiming relationship rollback/replay readiness.


### Additional findings already specified in the parallel Core HTTP boundary audit

The Core branch's detailed audit proposal is [PR #67, `docs/53-core-http-service-boundary-audit.md`](https://github.com/necromorphic/Logic-Engine/blob/03706188f044a4821c5957a0f7aa7199df193eb0/docs/53-core-http-service-boundary-audit.md). It is a documentation-only audit, not a runtime fix, and remains separate from this matrix. The findings below are cross-checked against the current `main` source reviewed above:

- **CORE-AUTH-04 — context-manifest registration trust:** `POST .../context-manifests` uses only the general bearer. There is no server-derived producer/generation binding on this route. Stored and hashed manifest content is not proof that a trusted host actually prepared that context. Until a trusted generation record exists, restrict registration to a dedicated internal capability or fail closed; do not accept a caller-supplied producer/origin label as authority.
- **CORE-READ-05 — raw state is not a revision-bound atomic snapshot:** `GET .../state` calls `getState` → `SQLiteStore.state`, which reads world/entity/fact rows through separate queries and does not return `commit_sequence`. `readSnapshot` instead uses a bounded selector and a single SQLite read transaction with both `world_revision` and `commit_sequence`. The state route must not be treated as the model/workflow snapshot contract even though raw HTTP access is now gated.
- **CORE-CAP-06 — capability classification is incomplete:** world creation, mechanic-registry audit, and template/rule-module metadata reads use the general bearer. Whether each should be admin/internal-only is a deployment policy decision, not something to infer by granting broad admin rights. Record and enforce an explicit capability matrix before exposing these routes to untrusted adapters.

For closure tracking, use the detailed finding IDs in PR #67 (F-01 through F-07) as the primary traceability set; the CORE-* labels above are only this matrix's cross-block references. Do not implement duplicate fixes on sibling branches without reconciling the ownership and dependency order in PR #67.


## 8. Follow-up test-only coverage merged after the source audit

**Status rechecked 2026-10-24:** both test-only PRs below are merged into main. The source audit above remains anchored to its recorded baseline (37b05c38b15eda1743fb6fce08a8ccc2f1d2e672); these later commits add tests, not runtime behavior or authorization changes.

- [PR #72 — canonical commit and rollback atomicity](https://github.com/necromorphic/Logic-Engine/pull/72) — merged as 506d3a6376a3b0209afb8622db61cbbb4ef98c0a. Its test suite covers injected rollback projection failure, rollback replay-record persistence failure, canonical commit replay-record persistence failure, no-partial-write assertions, successful retry/replay, nested savepoint isolation/recovery, and proposal commit failure/retry/idempotency. The recorded CI run passed.
- [PR #74 — context-manifest snapshot boundaries](https://github.com/necromorphic/Logic-Engine/pull/74) — merged as 683cbc3866468585173da8ad3e717d87be9e570a. Its tests cover exact composite-marker matching, invalidation after normal advancement and rollback-only revision changes, missing/cross-world IDs without cross-world leakage, per-manifest and combined snapshot limits, and deduplication of overlapping references. The recorded CI run passed.

These merged tests strengthen regression evidence for the existing Core lifecycle and snapshot boundaries. They do not add runtime behavior, authorize new reads or writes, or establish a typed Relationship commit/replay implementation. Remaining integration claims must be tied to the specific production paths and tests that actually exist.
