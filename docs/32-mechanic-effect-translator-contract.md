# Mechanic effect-intent translator contract — initial bounded slice

Status: **proposed contract; not an implementation authorization**. This document defines the smallest defensible translation boundary between mechanic-template intents and the canonical effect vocabulary. It does not add an alternate commit path.

## 1. Purpose and trust boundary

Mechanic intents are untrusted declarative requests. They are not canonical effects and do not authorize a mutation. A future translator must be a pure, deterministic function: it validates an intent batch and either returns a complete translation or fails without returning a partial batch.

The caller must send translated effects through the existing event validation and proposal → approval → commit lifecycle. The translator must not access storage, allocate entity/fact IDs, evaluate world state, approve proposals, write audit records, or commit events.

## 2. Initial support set

Only these three intent kinds are candidates for the initial translator:

- `create_entity` → `entity.create`
- `update_attribute` → `entity.update`
- `assert_fact` → `fact.set`

All other mechanic intent kinds are rejected by the translator in this initial slice. In particular, do not translate `entity.upsert` or `entity.delete`; do not encode relations as attributes/facts; do not infer that `fact.set` supports retraction. `request_adjudication` and `needs_review` are review/result outcomes, not mutation effects.

## 3. Field mapping

All intent objects must first pass the existing mechanic-template validation. The translator must additionally enforce the field-level rules below. `target_ref` is interpreted only according to the intent kind; it is never resolved through storage by the translator.

### 3.1 `create_entity` → `entity.create`

Input:
- `target_ref`: non-empty entity ID, maximum 200 characters.
- `payload`: required object containing `entity_type`; optional `status` and `attributes` only.
- `entity_type`: non-empty string.
- `status`: if present, one of `active`, `inactive`, `destroyed`, `unknown`.
- `attributes`: if present, a JSON object, not an array or null.

Output:
```json
{
  "kind": "entity.create",
  "entity_id": "<target_ref>",
  "entity_type": "<payload.entity_type>",
  "status": "<payload.status, when supplied>",
  "attributes": "<payload.attributes, when supplied>"
}
```

The translator must not generate an ID or silently replace an existing entity. Existence/collision checks remain canonical commit validation responsibilities.

### 3.2 `update_attribute` → `entity.update`

Input:
- `target_ref`: non-empty entity ID, maximum 200 characters.
- `payload`: required object containing at least one of `attributes`, `remove_attributes`, or `status`; no other fields.
- `attributes`: optional JSON object patch.
- `remove_attributes`: optional array of unique, non-empty attribute names (maximum 200 entries).
- `status`: optional value from the entity status set listed above.

Output uses `kind: "entity.update"` and `entity_id: target_ref`, copying only supplied fields from the allowed payload set. An attribute name must not appear in both `attributes` and `remove_attributes`; reject the whole batch on overlap. Empty patches are invalid. The translator does not read the entity, decide whether it exists, or infer deletion semantics. The canonical event validator also requires an event-level `REQUIRES(entity_exists)` causal link for `entity.update`; the proposal caller must supply that precondition explicitly or canonical validation rejects the translated event. The translator must not infer or synthesize this link from `target_ref`. The canonical event validator also requires an event-level `REQUIRES(entity_exists)` causal link for `entity.update`; the proposal caller must supply that precondition explicitly or canonical validation rejects the translated event. The translator must not infer or synthesize this link from `target_ref`.

### 3.3 `assert_fact` → `fact.set`

Input:
- `target_ref`: non-empty fact ID, maximum 200 characters.
- `payload`: required object containing `predicate` and `value`; optional `subject_ref` only.
- `predicate`: non-empty string.
- `value`: required JSON-serializable value; `null` is a value, not a request to retract the fact.
- `subject_ref`: optional string or null.

Output uses `kind: "fact.set"`, `fact_id: target_ref`, and copies `predicate`, `value`, and optional `subject_ref`. The translator does not invent a fact ID or query storage. The canonical commit boundary enforces stable identity per `fact_id` within a world: `predicate` and normalized `subject_ref` must match existing valid claims; absent and explicit-null `subject_ref` are equivalent; non-null identity strings must be non-empty and have no surrounding whitespace. Identity mismatches fail with `FACT_IDENTITY_MISMATCH` before durable writes. At most one `fact.set` effect for a given `fact_id` is allowed per event; duplicates fail before writes. Claims remain append-only and conflict-aware, not last-write-wins, and rollback reconstructs the projection from valid event history.

## 4. Batch atomicity, identity, and provenance

- Require a non-empty batch of 1–128 intents. An explicitly empty batch is invalid and must fail with `INVALID_MECHANIC_EFFECT_INTENT`.
- Validate the complete batch before returning any output. If one intent is invalid or unsupported, reject the whole batch; never return a translated prefix.
- Require unique, non-empty `effect_id` values within a batch. Preserve input order in the translated output; do not deduplicate intents by guessing semantic equivalence.
- Treat `effect_id`, `kind`, `target_ref`, `predicate`, and `subject_ref` as exact identifiers/tokens; reject surrounding whitespace rather than silently trimming or preserving a padded identifier.
- Preserve deterministic mapping: identical validated inputs produce byte-equivalent canonical effect arrays.
- Do not copy `effect_id`, `source_refs`, or `caused_by` into canonical effect objects; those fields are not accepted by the canonical effect schema.
- Do not silently discard provenance. Until an explicit mapping from intent-level `source_refs`/`caused_by` to event-level `read_set`/`causal_links`/ `caused_by` is defined, any non-empty `source_refs` or `caused_by` on an intent must fail with a stable `TRANSLATION_REQUIRES_PROVENANCE_MAPPING` result. Empty or absent arrays are allowed.
- The translator must not mutate input objects or arrays and must not mutate canonical world state, proposal state, commit history, or audit history.

## 5. Failure contract

Use stable machine-readable reason codes, at minimum:

- `INVALID_MECHANIC_EFFECT_INTENT`: malformed or ambiguous fields/payload.
- `UNSUPPORTED_MECHANIC_EFFECT_INTENT`: valid intent kind outside the initial support set.
- `TRANSLATION_REQUIRES_PROVENANCE_MAPPING`: non-empty intent provenance has no approved destination.
- `DUPLICATE_MECHANIC_EFFECT_ID`: duplicate `effect_id` in one batch.

Failure must be all-or-nothing and side-effect free. The caller may turn a failure into a review result, but must not treat an unsupported intent as a no-op success.

## 6. Required conformance tests before implementation is accepted

1. Golden mapping tests for each of the three supported intent kinds, including optional fields omitted versus supplied.
2. Rejection tests for all 15 other declared intent kinds, including review/result kinds.
3. Unknown payload fields, missing required fields, invalid status, invalid JSON/object shapes, empty update patches, overlapping patch/removal keys, duplicate removal keys, duplicate `effect_id` values, and an empty batch fail closed.
4. Unsafe object keys (`__proto__`, `constructor`, `prototype`) are rejected recursively in nested JSON payloads. Nested JSON values are bounded to depth 32, at most 10,000 nodes per batch, and at most 1,000 entries per array/object; exceeding a bound fails closed.
5. Non-empty `source_refs` or `caused_by` fail with the provenance-specific reason; the translator must never drop them.
6. A batch with one valid intent followed by an invalid/unsupported intent yields no partial output.
7. Output is deterministic and input is unchanged after both success and failure.
8. Feed successful output through `validateEffects`; every supported mapping is accepted by the canonical validator.
9. Translator failures do not change world revision, commit sequence, events, entities, facts, proposals, or audit entries. This must be checked at the integration boundary, not merely asserted from the purity of the translator.

## 7. Explicit non-goals

This contract does not implement mechanic evaluation, actor authorization, semantic alignment with source text, causal completeness, relation/knowledge/process/task/goal stores, automatic ID allocation, conflict resolution, NPC behavior, character-card logic, or a new commit API. It does not authorize SQLite, HTTP API, schema, or canonical-effect-vocabulary changes.

## 8. Deferred scope

- A typed mapping from intent provenance to event-level causal/context fields. Until approved, non-empty provenance remains fail-closed as specified above.
- Whether a future translator should support additional canonical effect kinds after their event, rollback, and audit semantics are independently specified.

The candidate integration adds the canonical fact-identity guard at the commit boundary; it does not authorize the translator to implement a second identity policy or query storage.