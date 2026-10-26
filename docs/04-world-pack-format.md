# 04. World Pack format and validation contract

Status: **proposed Stage 1 pack contract; partial schema artifacts exist, but the complete World Pack format is not finalized.** The repository already contains schemas for mechanic templates, mechanic instances, rule-module manifests, and declarative rules. Those artifacts do not constitute a complete World Pack manifest schema, a production loader, or full conformance validation.

## 1. Purpose

A World Pack supplies domain semantics to the universal core without replacing core invariants. It is a versioned, declarative artifact pinned by each world.

## 2. Required manifest fields

A pack manifest should define:
- `world_pack_id`: stable namespaced ID.
- `version`: immutable semantic/version identifier.
- `display_name` and optional description.
- `schema_version`: supported core contract version.
- `capabilities`: declared rule families supported by this pack.
- `entity_types[]`, `relation_types[]`, `fact_schemas[]`.
- `action_types[]` with input schema, preconditions, effects and ambiguity policy.
- `process_types[]` with stages, transitions, triggers and completion conditions.
- `knowledge_channels[]` and source validation rules.
- `story_arcs[]`, `story_beats[]` and approved alternatives.
- `time_policy` overrides only where core allows them.
- `conformance_tests[]`.
- `unknown_mechanics_policy`.

This list is a proposed pack-level contract, not a claim that every field is accepted by an existing schema or consumed by a runtime loader.

## 3. Declarative rule shape

Conceptual rule:
- stable rule ID and version;
- applicability scope;
- condition AST;
- trigger;
- effect intents;
- validation constraints;
- rollback/recalculation policy;
- provenance and explanatory message.

Allowed operators should be explicitly enumerated, typed and bounded (e.g. equality, numeric comparison where values are numeric, membership, boolean all/any/not, reference-exists, status-is, time-window). Operators must not execute arbitrary JavaScript, Python, shell, SQL, network calls or dynamic imports.

Rule conditions are evaluated by the engine against a validated state snapshot. Effects are intents until validated and committed.

## 4. Example (illustrative only)

```json
{
  "world_pack_id": "example.minimal-world",
  "version": "0.1.0",
  "schema_version": "core-1",
  "capabilities": ["entities", "relations", "processes", "knowledge"],
  "entity_types": [
    {
      "type": "observer",
      "attributes_schema": {
        "type": "object",
        "properties": {"active": {"type": "boolean"}},
        "additionalProperties": false
      }
    }
  ],
  "action_types": [
    {
      "type": "observe",
      "input_schema": {"type": "object", "properties": {"target_ref": {"type": "string"}}, "required": ["target_ref"]},
      "preconditions": [{"op": "reference_exists", "path": "input.target_ref"}],
      "effects": [{"kind": "propose_knowledge", "target": "actor_ref", "source": "observation"}]
    }
  ],
  "unknown_mechanics_policy": "needs_review"
}
```

This example demonstrates a proposed shape only. It is not a finalized World Pack JSON Schema, does not prove that the example is accepted by the current runtime, and does not specify a complete executable pack loader.

## 5. Unknown and unsupported mechanics

- `defined`: rule is present and validated.
- `partially_defined`: some constraints are known, others unresolved.
- `unknown`: no authoritative rule is available.
- `unsupported`: rule exists in the world fiction but the core has no safe evaluator.

For consequential actions, unknown/unsupported behavior must block, request author adjudication, or create a `needs_review` result according to explicit pack policy. A language model may explain uncertainty or suggest a proposed rule, but cannot silently canonize it.

## 6. Versioning and migration

A world pins one immutable pack version. Updating to another version is an explicit migration:
1. load old and new schemas;
2. identify changed/removed types, rules and process stages;
3. generate a dry-run report;
4. validate current records and active processes;
5. request author resolution for conflicts;
6. commit migration as a new revision and append audit;
7. retain old pack/version references for historical event interpretation.

No rule update silently rewrites past event outcomes. Migration logic itself must be versioned, tested and auditable. Historical replay, semantic re-evaluation, and meaning-changing migration are distinct operations and must not be treated as interchangeable.

## 7. Security and trust

World Pack content is data, not executable code. Reject unknown operators, oversized/deep ASTs, invalid references, unsafe regexes or unbounded evaluation. Never allow a pack or retrieved lore text to override core instructions or access controls.

## 8. Implementation boundary

Existing mechanic-template and declarative-rule schemas cover parts of the mechanics subsystem only. Before calling World Pack support complete, the project still needs an agreed full pack format, a loader/validation path, compatibility/conformance tests, and evidence that each declared field is either consumed or explicitly rejected. The presence of individual schema files must not be represented as completion of those requirements.
