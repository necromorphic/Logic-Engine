# Subject Knowledge Acquisition and Delivery — Stage 1 Contract

Status: **proposed core contract; review required. Not an implementation authorization.**

This document defines the smallest defensible contract for subject-specific knowledge and narrative delivery. It is a design boundary for the Logic-Engine core and its adapters. It does not claim that persistent KnowledgeRecords, delivery receipts, actor-specific access filtering, or host-render confirmation are currently implemented.

Related contracts:
- `docs/00-architecture-baseline.md` — authority, objective truth versus subject knowledge, provenance and rollback.
- `docs/02-turn-event-delivery-lifecycle.md` — independent turn, world-event and delivery lifecycles.
- `docs/06-npc-autonomy-and-process-manager.md` — autonomous NPC state and off-screen reports.
- `docs/07-knowledge-and-narrative-boundaries.md` — epistemic access and narrative visibility.
- `docs/18-rollback-and-causality.md` — causal invalidation and reconciliation.
- `docs/28-proposal-api-stage1.md` — implemented proposal lifecycle and its limits.

## 1. Core invariants

1. The engine is the authority for canonical world state, subject-specific knowledge, source validity, and delivery status. A model or adapter may propose changes but cannot make them canonical by assertion.
2. Objective truth and what a subject knows, believes, suspects, disputes, or rejects are distinct state dimensions.
3. Context retrieval, vector similarity, inclusion in a prompt, generated text, and a delivery attempt do not by themselves prove that a subject acquired knowledge.
4. A message being delivered to the player does not make its contents known to every NPC. An NPC's private context does not make those contents public or player-visible.
5. Every acquisition must have a permitted in-world or explicitly authorized source and a traceable acquisition path. The model must not invent provenance after the fact.
6. Source invalidation triggers reconciliation against the remaining valid provenance. It is not a blanket instruction to erase every memory, nor permission to preserve a claim whose only acquisition path was invalidated.
7. Delivery failure or retry must never recommit the underlying world event.
8. A missing policy, missing host signal, stale snapshot, or ambiguous acquisition path fails closed: do not promote uncertain data to confirmed knowledge or confirmed display.

## 2. Separate lifecycle records

The implementation must keep these concepts separate, even if a future storage design co-locates them:

- **Canonical fact / world event:** accepted state and its causal history.
- **Knowledge record:** what one specific subject has acquired or currently believes about a proposition, with provenance and epistemic stance.
- **Context manifest:** what references were offered to a particular generation and under which snapshot; this is an input trace, not evidence of learning.
- **Delivery receipt:** what was selected or attempted for a recipient, and what the host actually confirmed.
- **Search result:** retrieved material that still requires permission, validity, temporal and epistemic filtering.

No record in one category automatically creates a record in another. In particular, context-manifest inclusion is not knowledge acquisition; generated narration is not a world event; injection is not proof of rendering; rendering to the player is not NPC knowledge.

## 3. Proposed KnowledgeRecord contract

The following is a conceptual minimum, not a committed database schema. Exact IDs and serialization remain subject to implementation review.

A KnowledgeRecord must be scoped to a world and one holder/subject, and must carry:

- a stable record identity;
- the holder's entity reference;
- a proposition reference or explicit proposition payload sufficient to identify what is being represented;
- an epistemic stance, separate from objective truth;
- one or more source references and the acquisition path;
- acquisition time in world time when available, plus audit timestamps kept separate from world time;
- current validity/reconciliation status;
- confidence only when the source or World Pack defines how it is interpreted; a model-generated number alone is not authority.

### 3.1 Epistemic stance

At minimum, the contract distinguishes:
- `knows`: supported under the applicable acquisition rules and not currently disputed;
- `believes`: the subject accepts the proposition, but support does not meet the World Pack's stronger knowledge rule;
- `suspects`: the subject treats it as plausible but uncertain;
- `disputes`: the subject has conflicting support or an unresolved contradiction;
- `rejects`: the subject does not accept the proposition.

A false belief is represented as a subject's belief/stance that conflicts with current objective state, not as a change to canonical truth. A subject may continue to hold a false belief until they receive a valid correction. The core must not infer certainty from confident narrative wording.

### 3.2 Allowed acquisition sources

The source kind and required evidence must be validated by the core and/or an explicitly configured World Pack policy. Candidate source kinds are:

- direct observation, with the observer, time/location, visibility or audibility conditions, and relevant event/source references;
- communication, with sender, recipient, in-world channel, message/event reference, and evidence that the communication was delivered through that channel;
- document, recording or other artifact, with a stable artifact reference and access/inspection evidence when required;
- inference, with the premises already available to the holder, the declared inference rule, and the derived proposition;
- author-provided initial knowledge, explicitly marked as authored/imported state rather than an in-world discovery;
- imported initial state, with explicit provenance and scope.

The list is a contract proposal, not a claim that each acquisition mechanism already exists. Unknown source kinds must not be silently accepted.

### 3.3 Provenance and reconciliation

A knowledge record may have multiple independent sources. The engine must be able to determine which sources remain valid and which acquisition paths remain admissible.

When a source is invalidated:
1. Re-evaluate the record using all remaining valid sources and the configured acquisition rules.
2. Preserve the proposition as supported knowledge if valid independent sources still support it.
3. If the only support is gone, do not continue to assert it as currently verified knowledge.
4. Preserve an independently acquired memory or belief when its own acquisition event remains valid, even if the proposition's objective truth later changes; mark it stale, disputed, or false-believed as appropriate rather than rewriting history.
5. If the acquisition itself causally depends on a rolled-back event, apply the rollback contract to that acquisition path. Do not assume either unconditional erasure or unconditional survival.
6. Record reconciliation provenance so the resulting status is auditable and repeatable.

Reconciliation must be deterministic for the same world history, policy version, and valid source set. It must not silently turn a rumor or inference into direct knowledge.

## 4. Context construction and knowledge filtering

Before a model receives actor-specific context, the engine/authorized context builder must filter by:

- world and snapshot scope;
- the exact holder/actor for whom the context is built;
- source validity and acquisition path;
- access rules and public/private visibility;
- current, historical, retracted, disputed, stale, and false-belief status;
- secrecy and sensitivity policy;
- World Pack restrictions and explicit author overrides;
- snapshot/generation binding.

The filter must be applied after retrieval, including vector retrieval. Similarity is not authorization. Unavailable evidence must not be smuggled into context through a summary, related entity, event payload, or cached profile.

A context manifest may record which approved references were supplied, their stable IDs/content hashes, generation identity, and the composite world snapshot marker `(world_revision, commit_sequence)` when those values are available from the same read view. It must not be treated as proof that the model read, understood, accepted, or retained the content.

A change in either snapshot marker makes the previous snapshot stale for callers that require exact snapshot identity. Do not invent a new revision counter or treat `commit_sequence` and `world_revision` as interchangeable.

## 5. Proposed DeliveryReceipt contract

A delivery receipt is a record of an attempt to present a specific payload/event reference to a specific recipient through a named channel. At minimum it identifies:

- stable receipt and attempt identity;
- world and recipient/target;
- payload and relevant world-event references;
- channel and adapter/host correlation identifiers when available;
- current delivery state;
- host confirmation signal/type and its source, when available;
- timestamps for audit and retry ordering;
- causal validity or rollback linkage where the payload depends on a world event.

The delivery state vocabulary follows the existing lifecycle contract:
`pending`, `selected`, `injected_unconfirmed`, `shown`, `failed`, `superseded`, `rolled_back`, `orphaned`, and `rejected_by_author`.

Rules:
- Use `injected_unconfirmed` when injection was accepted but the host provides no supported rendering confirmation.
- Only an actual, documented host signal may set `shown`. Do not infer it from a successful API response, message text in history, or prompt inclusion.
- Preserve the host signal and correlation data that justify a state transition.
- Retry a failed delivery against the same underlying event and idempotency identity; do not repeat canonical effects.
- If the source world event is rolled back, reconcile or invalidate dependent delivery records according to the causal contract. A receipt is not evidence that the rolled-back event remains true.
- Delivery to one recipient is not delivery to another recipient. Player, NPC, tool, and narrator targets must not be conflated.

## 6. Delivery is not acquisition

The system must distinguish at least these outcomes:

1. **Prepared for context:** permitted information was included in a generation context. No learning is implied.
2. **Injected or presented:** the adapter attempted to send content to a recipient. Rendering may remain unconfirmed.
3. **Host-confirmed display/delivery:** the supported host signal confirms presentation to the relevant target. This proves delivery status only.
4. **Knowledge acquisition:** a separate validated acquisition operation records that a subject gained information through a permitted source/path.

For an in-world NPC communication, the World Pack or core policy must specify what constitutes delivery and what additional conditions are required for acquisition (for example, the recipient must be able to receive the channel). The engine must not equate a narrator mentioning a conversation with the NPC having heard it. For player delivery, even a confirmed display does not update NPC knowledge unless a separate in-world event supports that transfer.

## 7. Authorization and mutation boundary

- Models may propose observations, communications, inferences, belief updates, or delivery selections as structured intents.
- The engine validates the actor, source, channel, visibility, temporal constraints, causal links, and World Pack policy before committing an acquisition or state transition.
- The context builder and vector adapter are read-only with respect to canonical world and knowledge state.
- A delivery adapter may report supported host outcomes; it may not mark a receipt `shown` based on a guess.
- The translator/proposal API remains the only approved route for proposed world effects. Knowledge acquisition and delivery status must not become a second arbitrary event-commit path.
- Player-character voluntary actions, dialogue, and inner state remain protected by the existing player-agency boundary.
- Until named actor authorization and policy schemas exist, the core must explicitly disclose that the shared approval gate is not proof of actor-specific permission.

## 8. Rollback and concurrency

Knowledge and delivery records must reference the world events, sources, generations, and snapshots they depend on. Rollback must reconcile affected records in the same causal model as other derived state.

A rollback must not:
- erase unrelated memories just because they mention the same entity;
- retain a knowledge claim whose only valid acquisition path was invalidated;
- treat an old delivery receipt as proof that its source event is still valid;
- repeat a world effect merely to retry narrative delivery.

Reads that need exact consistency must bind their rows and snapshot marker to one read view. Writes must recheck relevant world revision, commit sequence, source validity, and policy at the canonical transaction boundary. The exact SQLite isolation guarantees must be demonstrated by deterministic concurrency tests before claiming atomic snapshot behavior.

## 9. Stage 1 non-goals

This contract does not authorize or define:
- a new SQLite schema or migration;
- new public API endpoints;
- a second knowledge store, delivery event log, revision counter, or rollback system owned by the NPC block;
- a vectorization/indexing redesign;
- automatic semantic truth inference by an LLM;
- a universal rule for forgetting, persuasion, deception, or belief change across all worlds;
- specific SillyTavern hook names or claims about render-confirmation signals not verified against the target host;
- NPC-card authored fields or lorebook implementation.

These are separate decisions. The NPC block is a consumer of the core contract, not the authority for canonical knowledge or delivery state.

## 10. Required acceptance tests before runtime implementation

1. Two subjects exposed to different evidence receive different knowledge projections from the same canonical world state.
2. Context construction never grants knowledge merely because a retrieved or summarized fragment contains it.
3. A private fact or secret remains filtered even when vector search returns it.
4. A communication acquisition requires a permitted channel and evidence of delivery; prompt inclusion alone is insufficient.
5. An inference records its premises and declared rule; missing premises fail closed.
6. Multiple valid sources preserve knowledge after one source is invalidated.
7. Invalidating the only source triggers reconciliation without silently asserting verified knowledge.
8. A false belief persists when the subject has not received a valid correction, even if objective truth differs.
9. Rollback invalidates only acquisition paths causally dependent on invalidated sources and preserves independent valid sources.
10. An injection without a rendering signal remains `injected_unconfirmed`, not `shown`.
11. A failed delivery retry does not recommit a world event and is idempotent.
12. Player delivery does not update NPC knowledge without an explicit in-world acquisition path.
13. A stale snapshot or changed source validity is rejected/re-read according to explicit policy.
14. Every resulting record can be traced to source, actor, policy and causal history.
15. Tests use the actual SQLite driver/isolation mode and deterministic concurrency coordination; they do not rely on arbitrary sleeps.

## 11. Implementation gate

Before runtime work begins, reviewers must agree on:
- the minimal persistent record and source-reference shapes;
- which acquisition types are supported in the first vertical slice;
- how host delivery signals are represented and which signals actually exist;
- the exact reconciliation behavior for rollback versus independent memory;
- actor/policy authorization boundaries;
- the transaction and concurrency strategy;
- migration, failure-recovery and idempotency tests.

Until these decisions are reviewed, this document is a proposed contract only. Existing context manifests, proposal APIs, canonical facts, and rollback projections are useful infrastructure but do not prove that subject-specific knowledge acquisition or delivery receipts are implemented.
