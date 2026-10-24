# Core 1.5 cross-block integration matrix

**Status:** evidence-based integration audit, documentation only.  
**Audit date:** 2026-10-24.  
**Main baseline checked:** `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`.  
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

| Area | Verified evidence | Current status | Integration consequence |
|---|---|---|---|
| Canonical world state, event commit, world revision / commit sequence, and limited causal rollback | `src/application/engine.js`, `docs/21-stage1-causality-contract.md`, `docs/24-causality-test-matrix.md` on `main` | Main runtime, with documented limits | Reuse existing Core lifecycle; do not claim proof-complete causal completeness or general relationship replay. |
| Actor-to-entity binding | `src/application/actor-bindings.js` on `main` | Main runtime, but identity binding only | A bound actor is not automatically authorized to read arbitrary world facts, memories, beliefs, or relationship attributes. |
| Actor/recipient/purpose/field-authorized reads | [PR #65](https://github.com/necromorphic/Logic-Engine/pull/65), branch `core/authorized-read-service-prototype`, head `971fe4c7` | Open Draft implementation candidate; not on main | Do not route NPC or Memory production reads through it as an established capability. Its proposed HTTP surface is deliberately self-only until a trusted visibility policy exists; direct internal snapshot consumers still require audit. |
| Trusted initial import / author correction provenance | [PR #63](https://github.com/necromorphic/Logic-Engine/pull/63) | Proposal only | Caller-supplied `origin` must not grant authority. Trusted authority source, correction semantics, and audit attribution remain open implementation gates. |
| HTTP rollback authorization hardening | [PR #66](https://github.com/necromorphic/Logic-Engine/pull/66) | Open Draft implementation candidate; not on main | Do not assume ordinary API credentials are blocked from every canonical rollback path until the patch is integrated and verified. Trusted in-process rollback remains a separate boundary. |
| Trust-boundary / proposal-execution audit | [PR #67](https://github.com/necromorphic/Logic-Engine/pull/67) | Proposal only | Useful as an audit plan, not an authorization implementation or approved policy. |
| Typed relationship write, atomic commit and relationship-specific replay/rollback | [PR #61](https://github.com/necromorphic/Logic-Engine/pull/61) | Proposal only; runtime work not demonstrated on main | Relationship evaluator output cannot be committed as canonical relationship state until a Core-owned typed operation and its transaction/audit/revision/idempotency tests exist. |
| Pure relationship candidate evaluation | [PR #62](https://github.com/necromorphic/Logic-Engine/pull/62), head `a4cae80d1606264242f1a402e0d41ae27b73d4f2` | Isolated implementation candidate; Runtime tests run #544 succeeded | The evaluator validates domain rules and returns a candidate only. It does not resolve identities, authorize evidence, write state, create events, or provide rollback. Special-key handling is implemented; tests for `constructor`, `prototype`, and clear with `__proto__` remain coverage gaps. |
| Relationship module boundary and test traceability | [PR #60](https://github.com/necromorphic/Logic-Engine/pull/60), branch `feat/relationship-domain-module`, head `a81ab380` | Documentation-only proposal | Domain semantics can be reviewed independently; no runtime relationship consumer or canonical writer is implied. |
| Memory record/retrieval/summary contracts | [PR #68](https://github.com/necromorphic/Logic-Engine/pull/68), branch `feat/core-memory-contracts`, head `b76a499d` | Documentation-only proposal | Retrieval must remain separate from access authorization and NPC knowledge acquisition. Memory must not become a second canonical or belief store. |
| NPC knowledge acquisition, delivery, and belief boundary | [NPC proposal](https://github.com/necromorphic/Logic-Engine/blob/feat/npc-subsystem/docs/39-npc-core-knowledge-contract-proposal.md), branch head `1b1054ed` | Branch-local proposal; branch diverges from main (200 ahead / 17 behind at audit) | The semantic boundary is specified, but no claim of NPC production runtime integration is supported by this branch document. Avoid merging/rebasing the branch as a shortcut. |
| Personality traits and relationship interpretation | [Personality semantics](https://github.com/necromorphic/Logic-Engine/blob/fix/personality-relationship-case-crosswalk/docs/personality/01-personality-and-relationship-semantics.md) and [crosswalk branch](https://github.com/necromorphic/Logic-Engine/tree/fix/personality-relationship-case-crosswalk) | Documentation-only; crosswalk branch is 19 commits ahead of main, no open Personality PR found in current open-PR listing | Personality owns stable-trait semantics and interpretation; it does not own canonical persistence, authorization, or rollback. Keep its acceptance IDs and crosswalks; do not duplicate relationship acceptance systems. |
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

Evidence: actor binding exists on main, but its code explicitly limits its meaning to identity resolution. PR #65 is an unmerged candidate; PR #64 is a proposal.

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

Evidence: PR #62 supplies only pure candidate evaluation; PR #61 records the first-slice replay boundary as a proposal.

Required:
1. Validate canonical participant identities and same-world scope in Core.
2. Convert a validated candidate into a typed Core operation without letting the evaluator write.
3. Atomically commit canonical state, event history, projection/revision, idempotency result, and audit—or leave all unchanged.
4. Pin the applicable domain/rule version.
5. Implement the agreed first-slice replay of surviving valid typed transitions and relationship-specific rollback; do not silently add alternative-independent-support semantics.
6. Exercise a real commit and rollback/replay production path; pure tests alone do not satisfy this gate.

### Gate 4 — Define Memory-to-NPC knowledge lifecycle

Evidence: PR #68 is docs-only. NPC `docs/39` is a proposal on a divergent branch. The Memory decision register leaves authorization, source-change notification/reconciliation, storage transaction boundary, and NPC-owned actor/delivery identifiers open.

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
- **Not integration-ready:** actor-authorized multi-entity reads; trusted import/correction; canonical typed relationship writes; relationship-specific replay/rollback; Memory/NPC production knowledge lifecycle; authorized freshness-aware relationship/card projection.
- **No merges or mainline changes are implied by this matrix.** Open Draft PRs and sibling branches remain separate until their contracts and runtime evidence are reviewed together.
