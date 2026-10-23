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

### Effects and projection rebuild

The current projection is rebuilt from valid events. This restores entity/fact projections after event invalidation and retains independent claims. Conflicting valid claims are marked `conflicted`; the runtime does not yet implement a general source-priority or epistemic-confidence policy.

## 3. Rollback guarantees and limits

The current rollback algorithm traverses declared `caused_by`, `depends_on`, and `read_set` links, together with records touched by invalidated effects. It preserves unrelated events that are not reached by that traversal. This gives useful deterministic behavior for well-formed metadata, but it cannot guarantee correct classification when caller-supplied metadata omits a real dependency.

Consequently:

1. Never infer dependency solely from temporal order.
2. Never claim that a causal graph is complete merely because all submitted references passed validation.
3. If an integration cannot provide reliable source IDs or dependency metadata, surface that limitation; do not guess which message caused an event.
4. The current runtime has no NPC knowledge, process, timer, or StoryBeat records to recompute. Those subsystems must not be described as rollback-supported yet.
5. `game_time` is not rewound by rollback; `world_revision` increases monotonically.

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
- rollback preserves an independent later event;
- removing one of two identical fact claims leaves the other claim active;
- removing one of two conflicting claims leaves the surviving claim as canonical;
- cross-world entity/fact references are rejected;
- oversized HTTP request bodies receive `413 BODY_TOO_LARGE`.

Future typed-graph tests must additionally cover omitted basis, stale observed versions, negative reads, causal cycles, knowledge with multiple sources, process checkpoints, timer consequences, and StoryBeat conflicts before those capabilities are implemented.
