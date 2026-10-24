# Core 1.5 cross-block integration matrix

**Status:** evidence-based integration audit, documentation only.  
**Audit date:** 2026-10-24.  
**Main baseline checked:** `f70e353ada10994f43b01a0ce1ddb46abe6a344e`...
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

**Status refresh (2026-10-24):** PR #61 (first-slice replay decision), PR #84 (extension-point audit), and PR #91 (Relationship domain-side handoff) are merged as documentation/decision records; PR #62 is merged as a pure evaluator; PR #65 and PR #83 are merged runtime slices with intentionally narrow scopes; PR #94 adds the admin-gated typed Relationship writer/projection/replay; PR #95 completes event/audit failure-injection tests; PR #96 rejects unapproved alternative-support metadata and links source rollback causality; PR #93 completes Personality/Relationship per-case evidence traceability; PR #97 and #98 integrate the current Memory and NPC contracts; PR #101 adds an opt-in trusted host field-policy hook for bounded authorized reads while preserving the self-identity-only default; PR #103 binds public proposal commit to the creating adapter; PR #106 restricts context-manifest registration to the internal host credential. PR #107 adds HTTP-level Relationship admin-auth/idempotent-retry coverage (Runtime run #754); PR #108 adds disk-backed close/reopen and deterministic projection-rebuild coverage (Runtime run #761). PR #114 makes the trusted operational `state` read transaction-bound and adds `commit_sequence` beside `world_revision`; its exact-head Runtime run #783 passed. PR #115 records the unresolved route-capability decisions. PR #117 distinguishes domain-defined neutral, cleared, and unset Relationship states (Runtime run #795); PR #119 verifies the internal-only manifest registration and creator-bound proposal commit gates compose without unauthorized mutation (Runtime run #804). PR #120 adds a two-connection WAL concurrency test proving the trusted state read returns a projection and composite cursor from one SQLite snapshot (Runtime run #807). PR #121 corrects the context-manifest trust contract to reflect the internal-only route gate while preserving the unresolved generation-binding blocker (Runtime run #810). PR #124 adds multi-dimension partial-patch preservation, mixed-patch atomic rejection, and idempotency-payload-substitution tests (Runtime run #827). PR #126 verifies caller-supplied executor/origin/actor/provenance fields are rejected and that server-derived executor, evidence refs, and pinned rule version are persisted in both event and audit (Runtime run #832). PR #131 adds a proposal-creation regression test for mismatched proposal/manifest generation labels (Runtime run #841); it proves equality checking only, not generation authenticity. PR #132 corrects the trusted-origin documentation and test naming so it no longer implies that generation labels are authenticated. Concrete production visibility policy, trusted manifest generation binding, trusted import/correction, and Memory/NPC source-reconciliation runtime remain unimplemented.


| Area | Verified evidence | Current status | Integration consequence |
|---|---|---|---|
| Canonical world state, event commit, world revision / commit sequence, and limited causal rollback | `src/application/engine.js`, `docs/21-stage1-causality-contract.md`, `docs/24-causality-test-matrix.md` on `main` | Main runtime, with documented limits | Reuse existing Core lifecycle; do not claim proof-complete causal completeness or general relationship replay. |
| Actor-to-entity binding | `src/application/actor-bindings.js` on `main` | Main runtime, but identity binding only | A bound actor is not automatically authorized to read arbitrary world facts, memories, beliefs, or relationship attributes. |
| Actor/recipient/purpose/field-authorized reads | [PR #65](https://github.com/necromorphic/Logic-Engine/pull/65), [PR #101](https://github.com/necromorphic/Logic-Engine/pull/101), [PR #102](https://github.com/necromorphic/Logic-Engine/pull/102) | Main runtime seam, intentionally fail-closed by default | Raw canonical HTTP reads/events/audit require internal/admin credentials; proposal reads are creator-scoped. The default authorized-read policy is self-identity-only. PR #101 allows a host-supplied trusted field policy and bounded target list; PR #102 proves other targets remain unavailable without it. This is not general NPC/Relationship authorization yet. |
| Trusted initial import / author correction provenance | [Core mutation-origin contract](https://github.com/necromorphic/Logic-Engine/blob/main/docs/50-core-trusted-mutation-origin-contract.md), originally proposed in closed unmerged PR #63 and ported via #82 | Contract proposal only; runtime import/correction authority remains unimplemented | Caller-supplied `origin` must not grant authority. Trusted authority source, correction semantics, and audit attribution remain open implementation gates. |
| HTTP rollback authorization hardening | [PR #83](https://github.com/necromorphic/Logic-Engine/pull/83) | Main runtime; exact-head Runtime tests passed before merge | Every HTTP canonical rollback requires a separate admin credential regardless of event type. Trusted in-process callers still need equivalent authorization. |
| Trust-boundary / proposal-execution audit | [Current-main audit](https://github.com/necromorphic/Logic-Engine/blob/main/docs/53-core-http-service-boundary-audit.md), [execution-authority contract](https://github.com/necromorphic/Logic-Engine/blob/main/docs/54-core-proposal-execution-authority-contract.md) via merged PR #104 | Historical findings reconciled; proposal-commit authority fixed by #103; context-manifest route gate fixed by #106 | Audit docs are not themselves runtime. Remaining gaps are trusted manifest generation binding, trusted import/correction, configured visibility policy, and direct in-process serializer inventory. |
| Typed relationship write, atomic commit and relationship-specific replay/rollback | [PR #94](https://github.com/necromorphic/Logic-Engine/pull/94), [PR #95](https://github.com/necromorphic/Logic-Engine/pull/95), [PR #96](https://github.com/necromorphic/Logic-Engine/pull/96), [PR #107](https://github.com/necromorphic/Logic-Engine/pull/107), [PR #108](https://github.com/necromorphic/Logic-Engine/pull/108), [PR #114](https://github.com/necromorphic/Logic-Engine/pull/114), [PR #117](https://github.com/necromorphic/Logic-Engine/pull/117), [PR #124](https://github.com/necromorphic/Logic-Engine/pull/124), [PR #126](https://github.com/necromorphic/Logic-Engine/pull/126) | Main runtime; exact-head Runtime tests passed on #94 run #705, #95 run #707, #96 run #717, #107 run #754, #108 run #761, #114 run #783, and #117 run #795, #124 run #827, #126 run #832 | Admin-gated `relationship.transition` uses immutable versioned `metadata.relationship_domain`, canonical commit/audit/idempotency, directed projection/rebuild, composite freshness, rollback dependency replay, explicit neutral/cleared/unset semantics, and restart persistence, multi-dimension partial-patch preservation, atomic mixed-patch rejection, and payload-bound idempotency, and HTTP-level provenance rejection/audit binding. General NPC/model writes and authorized Relationship reads remain blocked. #77's privileged first-slice criteria are met; visibility and non-admin authority remain separate gates. |
| Pure relationship candidate evaluation | [PR #62](https://github.com/necromorphic/Logic-Engine/pull/62) | Main runtime; exact-head tests passed before merge | The evaluator returns a candidate only. It does not resolve identities, authorize evidence, write state, create events, or provide rollback. Its input shape is not a Core API or wire format. |
| Relationship module boundary and test traceability | [PR #80](https://github.com/necromorphic/Logic-Engine/pull/80), [PR #91](https://github.com/necromorphic/Logic-Engine/pull/91) | Selected Relationship boundary and Core handoff docs are integrated on main; source PR #60 was closed unmerged | Domain semantics can be reviewed independently; the docs do not imply a consumer runtime. Canonical writing is implemented separately in #94–#96. |
| Memory record/retrieval/summary contracts | [PR #81](https://github.com/necromorphic/Logic-Engine/pull/81), [PR #97](https://github.com/necromorphic/Logic-Engine/pull/97), [PR #101](https://github.com/necromorphic/Logic-Engine/pull/101) | Memory contracts and Memory→NPC reconciliation are integrated; Core has an opt-in trusted host policy seam, but no concrete production Memory retrieval policy/path is configured | Retrieval must remain separate from access authorization and NPC knowledge acquisition. Memory must not become a second canonical or belief store. |
| NPC knowledge acquisition, delivery, and belief boundary | [PR #98](https://github.com/necromorphic/Logic-Engine/pull/98), superseded [PR #76](https://github.com/necromorphic/Logic-Engine/pull/76) | Current NPC-owned contract docs are integrated on main; PR #76 is closed unmerged as superseded | Semantic contract is available on main, but no NPC production runtime integration is supported. The divergent branch was not merged wholesale. |
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

Evidence: Memory contracts are integrated through PR #81 and the Memory↔NPC reconciliation through PR #97; the current NPC contract package is integrated through PR #98. These are documentation-only. The authorized-read service now accepts a trusted host policy hook (#101), but no concrete Memory/NPC visibility policy is configured; trusted state reads carry a composite marker (#114), while source-specific change/reconciliation, persistence transaction boundary, and NPC-owned actor/delivery runtime remain open.

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


## 7. Core production-path audit (main baseline)

**Audited files:** `src/api/server.js`, `src/application/proposals.js`, `src/application/actor-bindings.js`, `src/application/engine.js`, and `src/storage/sqlite-store.js` on the recorded `main` baseline. This is static source review, not a local runtime reproduction.

### Finding CORE-AUTH-01 — proposal commit authority was broader than proposal ownership (fixed by PR #103)

**Historical finding at the recorded source-audit baseline; closed in current main.**

- At the audited baseline, the public `POST .../proposals/:proposal_id/commit` route called `proposals.commit(worldId, proposalId)` without matching the authenticated adapter to `created_by_adapter_id`.
- PR #103 now requires configured adapter credentials and verifies proposal ownership before public commit. A different adapter receives the same non-enumerating `PROPOSAL_NOT_FOUND` response as a missing proposal; denied attempts do not mutate canonical state.
- Trusted orchestration continues through the separately authenticated internal-token `/events` route, which accepts only an approved proposal ID and uses the same canonical commit service.

**Current evidence:** API tests cover cross-adapter denial, creator success, internal-path success, idempotent retry, and no-state-change-on-denial. PR #119 verifies the context-manifest and proposal-commit gates together on exact head `64504a93c17f776cb8404a4d6c9c8a8a3650622a` ([run #804](https://github.com/necromorphic/Logic-Engine/actions/runs/40066216679)).

**Current disposition:** PR #103 closes the public proposal-commit creator-authorization finding. The trusted internal execution route remains separately capability-gated. The original finding is retained here as historical audit evidence.

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

These are source-level findings. Follow-up test coverage has since been merged through PRs #72 and #74, and the typed Relationship operation is implemented/tested in PRs #94–#96. PR #103 closes public proposal-commit creator authorization; PR #106 adds internal-only context-manifest registration. Remaining gaps include trusted manifest generation binding, trusted import/correction, a configured field visibility policy, and Memory source reconciliation.

### Core implementation order after this audit

1. Close the execution/read/rollback HTTP trust-boundary findings with small independently reviewable changes, preserving proposal approval and commit lifecycle.
2. Keep the authorized-read service fail-closed and narrow until a trusted field visibility schema and recipient/purpose contract are approved.
3. Add a Core-owned typed Relationship commit operation only after its request shape, domain-version pinning, identity checks, and audit attribution are approved. Reuse `SQLiteStore.tx()` and canonical event commit; do not write relationship projections directly from the evaluator.
4. Add transaction-failure and composite-cursor tests before claiming relationship rollback/replay readiness.


### Additional findings already specified in the parallel Core HTTP boundary audit

The detailed Core audit is now on `main` at [`docs/53-core-http-service-boundary-audit.md`](https://github.com/necromorphic/Logic-Engine/blob/main/docs/53-core-http-service-boundary-audit.md) via merged PR #104. It is still a documentation audit, not a substitute for runtime fixes. The findings below are cross-checked against the current `main` source reviewed above:

- **CORE-AUTH-04 — context-manifest registration trust:** the historical audit found that `POST .../context-manifests` used only the general bearer. PR #106 now requires the separate internal-host credential. The remaining gap is server-derived producer/generation binding: stored and hashed manifest content is not proof that a trusted host actually prepared or used that context. Do not accept a caller-supplied producer/origin label as authority.
- **CORE-READ-05 — trusted state snapshot consistency (fixed in main by PR #114; concurrency-tested by PR #120):** `SQLiteStore.state()` now reads world/entity/fact rows in one SQLite read transaction and returns `commit_sequence` alongside `world_revision`. PR #120 proves a concurrent second-connection write cannot mix the old world row with the new entity projection in one response. The raw state route remains privileged-only and is not an actor-authorized/model-safe read. Model/workflow consumers should continue to use bounded authorized snapshots and must carry both freshness markers.
- **CORE-CAP-06 — capability classification is incomplete:** world creation, mechanic-registry audit, and template/rule-module metadata reads use the general bearer. Whether each should be admin/internal-only is a deployment policy decision, not something to infer by granting broad admin rights. Record and enforce an explicit capability matrix before exposing these routes to untrusted adapters.

For closure tracking, use the detailed finding IDs in PR #67 (F-01 through F-07) as the primary traceability set; the CORE-* labels above are only this matrix's cross-block references. Do not implement duplicate fixes on sibling branches without reconciling the ownership and dependency order in PR #67.


## 8. Follow-up test-only coverage merged after the source audit

**Status rechecked 2026-10-24:** both test-only PRs below are merged into main. The source audit above remains anchored to its recorded baseline (37b05c38b15eda1743fb6fce08a8ccc2f1d2e672); these later commits add tests, not runtime behavior or authorization changes.

- [PR #72 — canonical commit and rollback atomicity](https://github.com/necromorphic/Logic-Engine/pull/72) — merged as 506d3a6376a3b0209afb8622db61cbbb4ef98c0a. Its test suite covers injected rollback projection failure, rollback replay-record persistence failure, canonical commit replay-record persistence failure, no-partial-write assertions, successful retry/replay, nested savepoint isolation/recovery, and proposal commit failure/retry/idempotency. The recorded CI run passed.
- [PR #74 — context-manifest snapshot boundaries](https://github.com/necromorphic/Logic-Engine/pull/74) — merged as 683cbc3866468585173da8ad3e717d87be9e570a. Its tests cover exact composite-marker matching, invalidation after normal advancement and rollback-only revision changes, missing/cross-world IDs without cross-world leakage, per-manifest and combined snapshot limits, and deduplication of overlapping references. The recorded CI run passed.

These merged tests strengthen regression evidence for the existing Core lifecycle and snapshot boundaries. They do not add runtime behavior, authorize new reads or writes, or establish a typed Relationship commit/replay implementation. Remaining integration claims must be tied to the specific production paths and tests that actually exist.

## 9. Core 1.6 current-main refresh — trust boundaries and remaining runtime gates

**Audit date:** 2026-10-24. **Scope:** targeted re-check of current main after PRs #119–#132. This section supersedes older forward-looking implementation-order text above where that text describes the typed Relationship writer/replay as future work. Earlier source-audit findings remain historical evidence and are not rewritten as if they were observed on the older baseline.

### Verified shipped behavior

- **Typed Relationship first slice:** #94–#96 provide the admin-gated typed relationship.transition write, canonical projection/rebuild and rollback/replay integration, and failure/alternative-support fail-closed tests. Follow-ups #107, #108, #114, #117, #124, and #126 cover HTTP authorization/retry, disk restart/rebuild, transaction-bound composite freshness, neutral/cleared/unset distinction, partial patch and atomic rejection, payload-bound idempotency, and server-derived provenance/audit binding. The first-slice privileged writer is implemented; this does not authorize NPC/model writes or relationship reads.
- **Proposal and manifest route gates:** #103 binds public proposal commit to the creating adapter; #106 requires the separate internal-host credential for context-manifest registration. #119 tests that these gates compose without unauthorized mutation.
- **Snapshot consistency:** #114 and #120 provide a transaction-bound state snapshot with world_revision and commit_sequence, including a two-connection WAL concurrency test. Consumers must compare both markers because rollback can change revision without advancing commit sequence.
- **Generation-label consistency:** #131 rejects a proposal when its generation_id differs from its registered context manifest, without changing world revision. This is a consistency guard, not proof that either label is authentic. #132 corrects docs/test naming to preserve that distinction.
- **Authorized reads:** the host-supplied field-policy hook exists, but the default remains self-identity-only. There is no approved, configured production policy for arbitrary actor/recipient/purpose/field access, and a trusted operational snapshot is not a model-safe projection.

### Generation binding: explicit blocker, not an implementation invitation

Current src/application/engine.js validates and hashes a manifest carrying caller-supplied generation_id, snapshot cursor, and canonical item references. The HTTP registration route is restricted to the internal-host credential, and proposal commit checks consistency between the proposal, manifest, and snapshot. Current src/application/proposals.js stores proposal generation/manifest labels but does not consult a trusted generation record. docs/55-core-context-manifest-trust-contract.md accurately states that no host generation registry/lifecycle or verified derivation from actual assembled context exists.

No existing host lifecycle contract was found that supplies an authenticated generation record, ownership, cancellation/supersession, and the exact authorized context assembled for that generation. Therefore Core must not invent a generation registry, new runtime API, or schema field in this pass. Until the host/orchestrator supplies an approved contract, manifest provenance remains a trusted-internal-host assertion with structural checks—not proof that the manifest came from the actual prompt or that the model used the listed material. Any operation that requires proof-grade binding must fail closed; legacy behavior must not be tightened silently without a compatibility decision.

### Remaining Core-owned gates

1. **Trusted generation binding:** blocked on an approved host/orchestrator lifecycle contract and authenticated source of generation ownership and assembled-context evidence. #131 does not close this.
2. **Visibility policy:** requires deployment/owner approval of the concrete field-level policy and its trusted configuration. Keep the default narrow; do not infer permission from actor binding, world scope, manifest membership, or a Memory hit.
3. **Trusted import/author correction:** no approved runtime authority path exists. Caller-provided origin/producer labels remain non-authoritative; do not reuse the privileged Relationship transition path as an import shortcut.
4. **Direct in-process reads and serializers:** HTTP raw-read protections do not establish that every in-process consumer applies authorization before serialization. Inventory concrete consumers before claiming closure.
5. **Capability matrix:** world creation, registry audit, and template/rule-module metadata routes need explicit deployment classification; do not grant blanket admin access based on ambiguity.
6. **Memory/NPC source reconciliation and knowledge lifecycle:** composite state cursors exist, but no approved durable source-change feed/outbox or complete production Memory→delivery→acquisition→belief path is established by these Core changes. Memory/NPC own their contracts; Core must not duplicate their ledgers or pretend documentation is runtime.
7. **Relationship read/write authority:** the privileged admin-authored first slice remains the only shipped typed write authority. General authorized Relationship reads and NPC/model/non-admin mutation remain blocked until policy and runtime tests are approved.

### Core acceptance rule

Close each gate only against a named production boundary, exact test path/name, and exact-head CI evidence. Documentation, a matching caller-supplied label, a pure evaluator test, or a passing mocked test is not enough. Keep #77 open for any remaining Core-owned criteria and do not merge or rewrite sibling branches as a shortcut.

## 10. Current-stage scope correction — block integration only

**Scope clarification dated 2026-10-24. This section controls interpretation of the current-stage acceptance gates above.** The project is currently integrating the existing large blocks (Core, Memory, NPC, Relationships, Personality). Mechanics and isolated worlds have not been introduced as current capabilities. Do not turn their absence, or the lack of supporting registries/metadata endpoints, into a defect or a prerequisite for completing this stage.

### Required now — only where the existing code path is involved

- Preserve the already-shipped canonical Core lifecycle and typed, privileged Relationship transition; verify cross-block handoffs against existing contracts rather than designing a broader architecture.
- Keep existing read and mutation security boundaries fail-closed. Where Memory/NPC currently need data from an existing production path, identify the actual consumer and policy seam before calling it blocked; actor identity alone must not be described as authorization.
- Keep source lineage, rollback/freshness, audit, and failure atomicity claims tied to existing Core/Memory code and exact tests. The composite freshness marker remains important for existing snapshots because rollback may change `world_revision` without advancing `commit_sequence`.
- Keep Memory retrieval, NPC delivery/acquisition/belief, Relationship domain interpretation, and Personality semantics owned by their respective blocks. Do not add parallel stores or ledgers to Core.
- Record a gate as blocked only when a named current-stage consumer or operation actually depends on the missing contract. State the exact consumer, current runtime path, and test evidence; otherwise classify it as an open design question or unverified—not a release blocker.

### Deferred — not acceptance gates for this stage

- Mechanics as a new extensibility/runtime system and mechanics-specific lifecycle or authorization work.
- Isolated-world/multi-world behavior beyond scope checks already required by existing operations.
- Registry audit, world-creation capability decisions, and rule-module/template metadata access when their only purpose is to support the not-yet-introduced mechanics or isolated-world capabilities.
- New generation registries/lifecycle APIs, outboxes/change feeds, storage models, serializers, or schemas invented solely to anticipate future features. These require an owner-approved contract and a demonstrated current consumer before implementation.

Some older sections retain historical findings and forward-looking wording from earlier audits. Read those as historical context only where they conflict with this scope correction. In particular, CORE-CAP-06 and the capability-matrix item in section 9 are **deferred scope**, not current-stage blockers, unless a concrete existing block integration is shown to rely on the affected route. Do not remove valid security checks from existing routes; this classification only prevents future-feature gaps from being promoted into current requirements.

### Reporting rule

Every remaining Core gate must be labeled one of: **current-stage required**, **current-stage open question**, **deferred**, or **unverified**. A future capability does not become current-stage required merely because an older audit listed it. This is a scope correction, not approval to merge PR #133 or to change another block's branch.


## 10. Core-owned Memory/NPC integration gate resolution

**Decision refresh:** 2026-10-24. This section resolves what can be decided from current Core runtime evidence. It does not authorize production Memory→NPC wiring or invent a missing interface.

### Gate A — authorized read: resolved as fail-closed, policy remains unapproved

- The existing `AuthorizedReadService` requires trusted application-supplied `fieldPolicy`; its policy decision is evaluated for authenticated adapter binding, in-world actor, recipient, purpose, and requested fields. Missing/throwing decisions deny. The HTTP default remains limited to the bound actor's own non-attribute identity fields.
- The concrete production policy for Memory/NPC, other actors, derived summaries, snippets, counts, and diagnostics is **not approved/configured**. No Memory/NPC consumer may infer access from actor identity, manifest membership, retrieval success, or caller-supplied labels.
- Before enabling a consumer, exercise the real authorized-read/serialization path for unauthorized field, unauthorized target, withheld-versus-missing non-disclosure, cross-world target, policy absent/throwing, and derived-summary non-disclosure. The existing self-identity route tests do not satisfy these wider cases.

### Gate B — source identity/version: no universal contract; source-specific fail-closed rule

- Core canonical entity, fact, event, and manifest references have structural identifiers. These are not interchangeable source-version tokens. A manifest item's optional `content_hash` identifies submitted content; it does not authenticate its producer or prove that the underlying source remains valid.
- The verified state snapshot provides `world_revision` and `commit_sequence` from one transaction. Both are required for snapshot freshness because rollback can change revision without advancing the event sequence. Neither marker is a durable per-source change journal.
- **Decision:** do not introduce a universal Memory source ID/version field. For any source kind without a verified authoritative version/validity check on its actual read path, Memory must classify source-dependent use as unverifiable and withhold/reject it rather than treating retrieval or a manifest reference as proof of freshness. A future source-kind contract must name its existing canonical identity, authoritative validity/version check, and real-path test.

### Gate C — rollback/reconciliation: design choice deliberately not guessed

- Current evidence does not establish a durable source-change feed/outbox or a complete production Memory→NPC consumer. The composite snapshot marker alone cannot guarantee detection of all source validity changes.
- Do not implement an outbox, cursor, polling API, schema, or parallel ledger in this pass. Before choosing journal, revision-triggered full reconciliation, or a hybrid, the Memory/NPC owners must identify the concrete consumer operation, maximum acceptable stale interval, source classes, retraction semantics, and recovery behavior. If those constraints are not agreed, production consumption remains disabled.
- Required real-path acceptance: a source becomes stale/retracted without an increased `commit_sequence`; consumer rejects/withholds it, reconciliation converges after rollback/revocation, and restart/retry does not resurrect invalid knowledge. Test both same-process and restart recovery where applicable.

### Gate D — persistence and transaction ownership

- Core canonical event, projection, rollback, audit, and idempotency behavior remains owned by the existing Core transaction path; reuse it rather than writing canonical state from Memory/NPC.
- Memory may own archival/index records, but no atomic transaction across a Memory-owned store and Core canonical events/audit is established. Do not claim cross-store atomicity or place a duplicate delivery/acquisition/belief/causal ledger in Core.
- A future integration contract must state the durable write owner for each semantic record, the retry/idempotency boundary, and how partial completion is reconciled. Acceptance must inject failure at each cross-boundary step and prove no false delivery/knowledge claim survives.

### Gate E — production enablement checklist

Production Memory→NPC consumption stays **blocked** until all are true:

1. Core + Memory/NPC approve the trusted recipient/actor/purpose/field policy and its deployment configuration.
2. Each consumed source kind has a verified authoritative identity and validity/version rule, or is rejected as unverifiable.
3. A named change/reconciliation strategy covers rollback and revocation without relying on `commit_sequence` alone.
4. Record ownership, persistence, retry/idempotency, and recovery boundaries are explicit; no unsupported cross-store atomicity claim.
5. Real production-path tests pass for unauthorized-field non-disclosure, stale/retracted-source rejection, rollback with unchanged `commit_sequence`, revocation/reconciliation, and restart-safe recovery.
6. Core matrix and Memory/NPC acceptance documents cite the exact test/run and exact tested commit.

**Current outcome:** documentation/decision boundary is clarified; the production consumer is not enabled. This gate is independent of mechanics and isolated worlds, which remain deferred.


### Gate F — direct in-process read and serializer inventory (current-main source check)

This is a bounded inventory of the code present in this repository, not a claim about external host/orchestrator integrations.

| Path / seam | Observed behavior | Evidence / disposition |
|---|---|---|
| `src/application/engine.js`: `getSnapshot`, `getState`, `getEvents`, `getAudit` | Trusted internal methods return canonical snapshot/state/history/audit; they do not apply actor/recipient/field authorization themselves. | Treat as trusted internal APIs only. Any host that serializes their result to a model/player/adapter must apply an approved boundary first. |
| `src/application/authorized-read-service.js`: `AuthorizedReadService.readEntityFields` | Resolves the actor binding, requests bounded entity snapshots, invokes the trusted field policy per field, fails closed for missing/withheld targets, and returns both `world_revision` and `commit_sequence`. | Current approved seam for bounded entity-field reads; no production Memory/NPC policy is configured. Tests: `tests/authorized-read-service.test.js` and `tests/authorized-read-api.test.js`. |
| `src/api/server.js`: `POST .../authorized-read` | The HTTP route is the only in-repository caller that constructs a model-recipient authorized read. The raw `state`, `events`, and `audit` GET routes require the separate internal or admin credential. | HTTP boundary evidence is in `tests/authorized-read-api.test.js`; this does not authenticate any external host serializer. |
| `src/index.js`: server construction | The shipped entry point does not pass `authorizedReadFieldPolicy`; therefore it runs the deliberate self-identity-only default. A host can inject a trusted callback only when it constructs `createApiServer` itself. | No configured production Memory/NPC visibility policy exists in the shipped entry point; do not describe the hook as enabled by environment configuration. |
| `src/application/character-card-projection.js`: `projectCharacterCard` | Pure projection over a caller-supplied snapshot; requires an explicit entity-type allowlist and emits identity/type/status plus limited source/revision metadata. It does not read storage, apply authorization, or establish access. | It must only receive an already-authorized snapshot when used for a protected consumer. No route/call site in `src/api/server.js` currently wires this projector into a production response. Test: `test/character-card-projection.test.js`. |
| `src/application/proposals.js` via API | Proposal reads are adapter-owner-scoped, with an explicit admin read path; internal commit uses the internal credential and approved lifecycle. | Existing route-level behavior; not a general snapshot serializer. See proposal ownership/commit cases in `tests/api.test.js`. |

**Result of this inventory:** within the checked-in runtime, no production Memory→NPC consumer or character-card response route was found. The concrete in-repository model-facing read is the bounded authorized-read route, whose shipped default remains self-only. Direct engine methods and the card projector remain trusted/internal building blocks, not an alternate public visibility path. This closes only the repository inventory/documentation subtask; it does not prove how an external host serializes data.

**Acceptance for any future in-process consumer:** name its exact call site, show that authorization runs before serialization (including snippets/counts/diagnostics and derived summaries), carry the composite freshness markers, and add a real-path non-disclosure test on the exact consuming boundary. Until such a consumer exists in this repository, classify external host wiring as **unverified / owner contract required**, not as a runtime defect that justifies inventing a new API.
