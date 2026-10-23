# Stage 1 causality contract: verified facts vs caller assertions

Status: normative boundary for the current runtime; typed causal graph and provenance verification are future work.

## 1. Why this contract exists

The engine is authoritative for committed state and rollback decisions. A caller or LLM may propose causal metadata, but the engine must not treat that metadata as proof that the graph is complete. Referential validity and causal completeness are different guarantees.

- **Referential validity**: every referenced record exists, belongs to the same world, and (for event references) is currently valid and earlier than the proposed event.
- **Causal completeness**: every dependency that materially affected an outcome is represented. The current runtime does not prove this.
- **Semantic validity**: a referenced entity/fact satisfies a particular predicate or version requirement. A plain `entity:id` or `fact:id` reference does not express such a predicate.

The current runtime offers partial causal rollback, not a proof-complete rollback engine.

## 2. Current metadata semantics

### `caused_by[]`

Direct event-parent references asserted by the caller. The runtime validates that each referenced event exists, is valid, belongs to this world, and was committed before the new event. The runtime cannot infer omitted causes from prose.

### `depends_on[]`

References to event IDs or to current projection identities using `entity:id` / `fact:id`. These references are used by the current rollback traversal to identify events affected by a retracted event or affected record.

For entity/fact references, the current implementation checks that the identity exists in the current world's projection. It does **not** prove that the referenced entity is alive/active, that a fact is undisputed, or that the record had the same value at the event's historical revision. Do not use this field as a substitute for a typed state predicate or version precondition.

A destroyed entity can remain in the projection as a historical identity. Its existence alone does not mean it is usable or alive.

### `read_set[]`

References to existing entity/fact identities that the caller claims materially influenced the event. The runtime checks reference shape and current-world existence. It does not receive a complete context manifest and therefore cannot verify whether this list is complete or whether every listed record materially changed the decision.

### `causal_links[]`

The runtime now accepts an additive, typed subset of causal relationships while retaining the legacy fields above for backward compatibility. Each item is `{ relation, target_id }`; duplicate relation/target pairs are rejected, and links are normalized before request hashing.

Supported relations in this increment:
- `REQUIRES`: a precondition expressed as `entity_exists` or `entity_attribute`; it must be true before the event commits. During rollback, the engine reconstructs entity state before the event's `commit_sequence` while excluding events already classified for invalidation. If the predicate is false in that reconstructed history, the event becomes a rollback candidate.
- `READS_SOURCE`: target is a prior valid event used as a source; rollback invalidates the reader when that source is invalidated.
- `READS_ENTITY`: target is an entity identity in this world; rollback invalidates the reader when an invalidated event changes/removes that entity's canonical projection.
- `READS_CLAIM`: target is a fact/claim identity with at least one current valid source in this world; rollback invalidates the reader only when no valid source remains for that claim projection.

Unknown relationship types are rejected with HTTP 400 before a committed event or successful idempotency result is written. Corrected input may retry the same key because pre-commit validation did not consume it. The model cannot use these links to activate mechanics or bypass engine validation.

This is intentionally a partial graph contract: `REQUIRES` currently supports only `entity_exists(entity_id)` and `entity_attribute(entity_id, attribute, value)` against entity history. It does not yet support fact predicates, negative reads, manifests/basis verification, `PRODUCES`/evidence/conflict edges, tri-state unknown evaluation, or proof of causal completeness. A stable per-world `commit_sequence` is implemented and is used to reconstruct historical entity state for these supported preconditions. `READS_ENTITY` and `READS_CLAIM` currently identify projection identities, not versioned historical values. `READS_CLAIM` preserves its reader when at least one valid source remains; it invalidates the reader only when the claim loses all valid support. Direct event causation remains represented by the backward-compatible `caused_by[]` field in this increment. The engine continues to report only declared-metadata rollback semantics.

### Effects and projection rebuild

The current projection is rebuilt from valid events. This restores entity/fact projections after event invalidation and retains independent claims. Conflicting valid claims are marked `conflicted`; the runtime does not yet implement a general source-priority or epistemic-confidence policy.

## 3. Rollback guarantees and limits

The current rollback algorithm repeatedly traverses declared `caused_by`, `depends_on`, `read_set`, and supported `causal_links` relationships, together with records touched by invalidated effects, until no additional event is reached. A causal-diamond acceptance test verifies that both branches and their join are invalidated when they depend on the removed root, while a truly independent later branch survives.

This is deterministic for well-formed declared metadata, but it cannot guarantee correct classification when caller-supplied metadata omits a real dependency. A graph traversal algorithm cannot recover edges that were never recorded.

Consequently:

1. Never infer dependency solely from temporal order.
2. Never claim that a causal graph is complete merely because all submitted references passed validation.
3. If an integration cannot provide reliable source IDs or dependency metadata, surface that limitation; do not guess which message caused an event.
4. The current runtime has no NPC knowledge, process, timer, or StoryBeat records to recompute. Those subsystems must not be described as rollback-supported yet.
5. `game_time` is not rewound by rollback; `world_revision` increases monotonically.

### Idempotency compatibility boundary

Legacy idempotency rows without a stored request fingerprint cannot safely be replayed as though their request matched a new retry. The runtime deliberately fails closed with `IDEMPOTENCY_KEY_UNVERIFIABLE` (HTTP 409); assigning a placeholder hash during migration would not prove request equality. Clients should use a new key when retrying a legacy request whose fingerprint is unavailable.

## 4. Next-step contract: verified basis and typed edges

Before implementing autonomous NPC processes, introduce a versioned causal representation. Proposed edge types:

- `CAUSES`: event A directly produced event B.
- `REQUIRES`: B's validity requires a specified state predicate to remain satisfied.
- `READS`: B materially used a versioned record when it was proposed.
- `PRODUCES`: an event produced a record or projection claim.
- `EVIDENCE_FOR`: a source supports a claim without necessarily causing it.
- `CONFLICTS_WITH`: two claims cannot both be treated as unqualified canonical truth.

The edge schema must include typed source/target references, world scope, committed revision, and provenance. Cycles must be rejected for dependency edges that are required to form a DAG; evidence/conflict relations must not automatically be treated as causal cycles.

### Responsibility split

The caller/LLM may submit a compact `basis` of record references and observed versions that it believes materially influenced the decision. The engine must bind that basis to a specific context snapshot/manifest supplied by the host, validate referenced versions and world scope, and record the verified reads itself.

If no trustworthy context manifest exists, the engine cannot determine that a basis is complete. Mark provenance as unknown/inferred or require review at rollback; do not assign numerical confidence values that imply statistical calibration without a defined method.

A context manifest records what was made available to the model, not what materially influenced its answer. A mismatch between manifest and declared basis is evidence of uncertainty, not proof that every omitted record caused the outcome. The future contract must define whether such cases require review, rather than automatically invalidating every event that saw the same context.

### Negative reads

Absence is a first-class observation. Represent it as an explicit predicate/versioned query result (for example, `not_exists` for a typed subject/predicate key), not merely as a missing row. Otherwise a decision based on "no witness was present" cannot be invalidated correctly if a witness is later introduced.

### Multiple sources

A fact claim must retain each source independently. When a source event is invalidated, recompute the fact from remaining valid claims:
- one unopposed value remains: use that value;
- incompatible remaining values: mark disputed/conflicted;
- no valid source remains: retract/remove the current claim from the canonical projection.

The current runtime rebuilds fact claims from valid events and marks conflicting values as `conflicted`, but richer confidence, priority, and evidence semantics remain future work.

## 5. Acceptance tests for this boundary

Current runtime tests should verify:
- rollback invalidates an event whose declared `depends_on` points to an affected entity;
- rollback traverses a causal diamond and preserves a truly independent later branch;
- removing one of two identical fact claims leaves the other claim active;
- removing one of two conflicting claims leaves the surviving claim as canonical;
- cross-world entity/fact references are rejected;
- typed `READS_SOURCE` and `READS_CLAIM` links invalidate dependent events when their source/claim support is removed;
- unsupported typed relationships are rejected before consuming an idempotency key;
- oversized HTTP request bodies receive `413 BODY_TOO_LARGE`;
- legacy idempotency rows without request hashes fail closed rather than fabricating request identity.

Future typed-graph tests must additionally cover omitted basis, stale observed versions, negative reads, causal cycles, knowledge with multiple sources, process checkpoints, timer consequences, and StoryBeat conflicts before those capabilities are implemented.
