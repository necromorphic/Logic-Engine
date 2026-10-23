# 01. Universal core domain model

Status: proposed Stage 1 contract. No runtime implementation implied.

## 1. Design rule

The core models mechanics that are useful across many worlds without assuming any particular genre. A record's type does not imply biology, humanity, physical embodiment, money, morality, magic, or faction membership.

A world pack may define domain-specific subtypes and rules, but may not bypass core validation, audit, causal rollback, player agency, or knowledge access controls.

## 2. Canonical record families

### World
- `world_id`: stable identifier.
- `world_pack_id`, `world_pack_version`: exact pinned ruleset.
- `game_time`: canonical in-world time; independent of wall-clock time.
- `world_revision`: monotonically increasing committed-state revision.
- `status`: active, paused, needs_review, archived.

### Entity
Any persistent actor, object, place, organization, system, phenomenon, or abstract participant recognized by a world pack.
- `entity_id`, `world_id`, `entity_type`, `status`.
- `attributes`: schema-validated extension data.
- `created_by_event_id`, `validity`.

The core does not require every entity to be an NPC or living organism.

### Relation
A typed, directed or undirected relationship between records.
- `relation_id`, `world_id`, `relation_type`, `source_ref`, `target_ref`.
- `attributes`, `validity`, `provenance`.

Examples such as trust, ownership, membership, distance, command, hostility, or kinship are world-pack-defined types, not mandatory core fields.

### StateFact
A claim about canonical world state, separated from a subject's belief about it.
- `fact_id`, `world_id`, `subject_ref` (optional), `predicate`, `value`.
- `validity`, `valid_from`, `valid_until` (optional).
- `source_event_ids[]`, `causal_refs[]`, `schema_version`.

A fact can have multiple sufficient sources. Invalidating one source must not invalidate the fact if another valid source still supports it and its validation rules remain satisfied.

### KnowledgeRecord
A subject's epistemic state, not an objective world fact.
- `knowledge_id`, `world_id`, `holder_ref`, `proposition_ref_or_value`.
- `epistemic_status`: known, believed, suspected, disputed, false_belief, unknown.
- `confidence` (optional bounded value), `source_refs[]`, `acquired_at`.
- `access_scope`, `validity`, `last_reconciled_revision`.

Knowledge must be traceable to an allowed source: observation, communication, document, inference rule, or world-pack-defined channel. A false belief can persist as a belief even when it is not canonical truth.

### Process
A durable, time-progressing or condition-progressing activity.
- `process_id`, `process_type`, `owner_ref` (optional), `participants[]`.
- `stage_id`, `status`, `start_time`, `deadline` (optional).
- `prerequisite_refs[]`, `progress_state`, `outputs[]`.
- `causal_refs[]`, `next_trigger` (optional), `last_advanced_revision`.

A process may represent travel, construction, research, recovery, investigation, negotiation, an abstract countdown, or any pack-defined activity. The core supplies lifecycle and scheduling; the pack supplies meaning and transitions.

### Goal, Plan, Task
Keep the distinctions explicit:
- Goal: desired state or outcome.
- Plan: chosen strategy to pursue a goal, with alternatives and assumptions.
- Task: an actionable unit with preconditions, owner, status, dependencies, and result.

NPC autonomy depends on durable records, not on the model remembering an intention from earlier prose.

### WorldEvent
An accepted occurrence or state-changing operation.
- `event_id`, `world_id`, `event_type`, `turn_id` (optional for off-screen events).
- `occurred_at_game_time`, `committed_revision`.
- `caused_by[]`, `depends_on[]`, `read_set[]`, `produces[]`.
- `validity`, `compensated_by[]`, `payload`.

Audit entries are append-only. Current world projections must exclude retracted or invalidated effects.

### StoryArc and StoryBeat
StoryArc describes authored intent, not guaranteed destiny. StoryBeat has declarative prerequisites and a validated postcondition. Current beat status is derived from current valid state; audit can retain a historical completion that was later invalidated by rollback.

### Delivery
Tracks whether a narrative/event payload was selected, injected, confirmed shown, superseded, or rolled back. Delivery status never proves a world effect occurred.

## 3. Cross-cutting fields

Where relevant, canonical records carry:
- stable typed identifiers;
- world scope;
- schema/type version;
- source/provenance references;
- causal parents and dependencies;
- validity/retraction state;
- created/updated revision;
- author/manual override metadata where applicable.

Avoid adding all cross-cutting fields mechanically to every table if normalized references serve the same purpose; the contract is semantic, not a demand for denormalized columns.

## 4. Core invariants

1. A world cannot read another world's records unless an explicit import creates new provenance-bearing records.
2. Narrative text is not a canonical state mutation.
3. Every accepted mutation has a validated proposal or an explicit deterministic/system origin.
4. Every knowledge claim has a provenance path and access scope.
5. Every rollback-able mutation has sufficient source and dependency metadata.
6. Derived projections and search indexes can be rebuilt from canonical records and audit.
7. Core behavior must remain valid when optional record families such as resources, factions, bodies, or money are absent.
8. Unsupported mechanics must fail closed or enter an explicit review state; the model cannot silently invent a rule.

## 5. Stage 1 scope boundary

Define record contracts, transition semantics, invariants and conformance tests first. Do not implement a generic arbitrary-code plugin system in Stage 1. Prefer a constrained declarative rule format whose operators can be validated and interpreted by the engine.
