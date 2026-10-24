# Core Memory integration contracts

Status: proposed integration boundary. These contracts are not approved on behalf of Core, NPC, Relations, or Personality owners.

## 1. Core → Memory

Core may provide canonical source references, event validity/retraction signals, consistent snapshot cursors, and trusted service identity. Before implementation, confirm which of these are available on the chosen base revision and which are only described in proposals.

Memory must not mutate Core state, issue canonical events, determine rollback outcomes, or treat caller-provided causal metadata as proof of complete causality. A Core source reference is accepted only after world-scoped resolution and validation appropriate to the source type.

## 2. Memory ↔ NPC/Core knowledge contract

Memory exposes authorized candidate archival records and evidence metadata. It does not decide actor-specific knowledge, delivery, belief, or inference. The NPC proposal at `feat/npc-subsystem`, `docs/39-npc-core-knowledge-contract-proposal.md` (section 10), records a Core-owner decision that Core owns authoritative acquisition/provenance records, delivery attempts/receipt status, source reconciliation, and persistent subject-relative belief state. The focused NPC consumer contract and failure matrix in `docs/52-npc-memory-consumption-contract-and-failure-matrix.md` now spells out candidate eligibility, fail-closed behavior, lifecycle distinctions, negative cases, and test layers. Both documents remain unmerged proposals on the NPC branch; neither is a Memory API nor current runtime capability.

The storage implementation may eventually reuse Memory primitives for some Core-owned records only after Core explicitly approves the ownership, schema, and transaction boundary. It must not create a competing NPC knowledge store. A memory retrieval response, context manifest, or prompt inclusion is not proof that a character acquired, received, understood, or believes information.

Required agreement points with the NPC block:
- stable actor/recipient binding shape;
- acquisition and delivery event identifiers;
- which source kinds can be delivered;
- how delivery retries are idempotent;
- how source rollback invalidates derived knowledge;
- who owns the knowledge entry and its causal dependencies;
- whether NPC requests require an explicit purpose and visibility scope.

Until these are agreed, expose no direct memory-to-belief mutation path. Before implementation, reconcile the illustrative candidate shape in NPC `docs/52` with `docs/66-core-memory-retrieval-contract.md`; neither shape is frozen. Preserve record/source versions, trusted request binding, per-request access, producer provenance versus content lineage, freshness/reconciliation, orthogonal lifecycle dimensions, result completeness, and typed non-ready outcomes without leaking protected metadata.

## 3. Memory → Relations

Memory may return historical evidence, source references, and records relevant to an evaluation. Relations owns the meaning and evaluation of relationship state. Memory does not compute dimensions, transition rules, current relation values, or confidence in a relationship.

Evidence authorization and canonical event validation remain external preconditions; a pure relation evaluator result is not a write.

## 4. Memory → Personality

Memory may return permitted episodes and source-grounded history. Personality owns traits, motivation, and psychological inference. Retrieval must not turn a summary into a persistent trait or silently alter personality state.

## 5. External adapters

Adapters call a bounded service contract, not SQLite or an index directly. Raw storage access, internal snapshots, administrative operations, and trusted provenance assignment must not be exposed to model-facing callers. Host-derived requester and recipient identity cannot be overridden by request fields.

## 6. Authorized-read dependency

PR #65 is merged and provides a fail-closed authorized-read service. PR #101 adds an opt-in trusted host field-policy hook; without that explicit host configuration, the HTTP route remains self-identity-only. These are shipped Core primitives, not a configured production Memory visibility policy or a complete Memory retrieval integration. See docs/73-memory-current-main-core-boundary-handoff.md.

The current `ActorBindingService` on `main` resolves an authenticated adapter to a canonical actor identity; its own code comment explicitly limits that authority to identity resolution, not knowledge reads, action semantics, approval, or commit. A valid actor binding is therefore necessary identity context where applicable, but is not authorization to retrieve any memory or secret.

Memory integration must be reviewed against the actual base branch and any approved successor contract. It needs a separate approved actor/purpose/world/snapshot-scoped access decision that filters before content, snippets, counts, and diagnostics are exposed. If policy is unavailable or throws, deny the protected read.

## 7. Open integration contract

No sibling contract is presumed approved by this document. Record exact versions/PR references and resolve incompatible fields through a cross-block review before runtime integration. NPC follow-up Issue #70 tracks review of `docs/52`; it remains open until the NPC owner confirms the deliverable. Remaining Core/Memory gates include the approved authorized-read boundary, rollback-aware recoverable reconciliation, derived-summary access propagation, and the actual storage/transaction boundary for Core-owned semantic records.

## Current-main runtime checkpoint — Issue #129, 2026-10-24

The authoritative current-main runtime audit and cross-owner boundary decisions are maintained in [docs/73-memory-current-main-core-boundary-handoff.md](73-memory-current-main-core-boundary-handoff.md), audited against `main` at `c8b416440f5360f812f38bdb03644e79f52b0f1d`. This section supersedes historical PR-state statements above; it is a pointer, not a second copy of the audit.

Read authorization remains restricted and default-deny unless a trusted host policy is explicitly configured; no production Memory read policy or Memory record/retrieval/index/summary runtime is approved by this documentation. The handoff contains the current runtime classification, fail-closed boundaries, owners, and acceptance tests. No new runtime API, schema, store, outbox, cursor, or permission policy is authorized here; Issues #70 and #77 remain separate and open.