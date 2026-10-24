# Core Memory integration contracts

Status: proposed integration boundary. These contracts are not approved on behalf of Core, NPC, Relations, or Personality owners.

## 1. Core → Memory

Core may provide canonical source references, event validity/retraction signals, consistent snapshot cursors, and trusted service identity. Before implementation, confirm which of these are available on the chosen base revision and which are only described in proposals.

Memory must not mutate Core state, issue canonical events, determine rollback outcomes, or treat caller-provided causal metadata as proof of complete causality. A Core source reference is accepted only after world-scoped resolution and validation appropriate to the source type.

## 2. Memory → NPC

Memory exposes authorized candidate records and evidence metadata. NPC owns acquisition policy, actor-specific delivery, personal knowledge, beliefs, inferences, and the decision to update them. A memory retrieval response is not itself proof that a character has received or accepted the information.

Required agreement points with the NPC block:
- stable actor/recipient binding shape;
- acquisition and delivery event identifiers;
- which source kinds can be delivered;
- how delivery retries are idempotent;
- how source rollback invalidates derived knowledge;
- who owns the knowledge entry and its causal dependencies;
- whether NPC requests require an explicit purpose and visibility scope.

Until these are agreed, expose no direct memory-to-belief mutation path.

## 3. Memory → Relations

Memory may return historical evidence, source references, and records relevant to an evaluation. Relations owns the meaning and evaluation of relationship state. Memory does not compute dimensions, transition rules, current relation values, or confidence in a relationship.

Evidence authorization and canonical event validation remain external preconditions; a pure relation evaluator result is not a write.

## 4. Memory → Personality

Memory may return permitted episodes and source-grounded history. Personality owns traits, motivation, and psychological inference. Retrieval must not turn a summary into a persistent trait or silently alter personality state.

## 5. External adapters

Adapters call a bounded service contract, not SQLite or an index directly. Raw storage access, internal snapshots, administrative operations, and trusted provenance assignment must not be exposed to model-facing callers. Host-derived requester and recipient identity cannot be overridden by request fields.

## 6. Authorized-read dependency

PR #65 describes a fail-closed authorized-read service candidate, but is open and explicitly limited to self-only fields. It is not a complete memory visibility policy and must not be treated as merged. Memory integration must be reviewed against the actual base branch and any approved successor contract. If policy is unavailable or throws, deny the protected read.

## 7. Open integration contract

No sibling contract is presumed approved by this document. Record exact versions/PR references and resolve incompatible fields through a cross-block review before runtime integration.