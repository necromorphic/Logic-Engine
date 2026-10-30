# Relationships current-state migration mapping artifact

**Status:** domain-owned artifact contract and fixture examples; not approved for production execution.  
**Policy authority:** [Relationships migration policy, Section 14](./75-relationships-world-pack-version-semantics.md#14-approved-domain-policy--current-state-migration-30-october-2026), merged in PR #745.  
**Core execution boundary:** [Core execution contract proposal](./79-core-relationships-current-state-migration-execution-contract-proposal.md), PR #746 (Draft; not an approved runtime contract).

## 1. Scope and ownership

This document defines the Relationships-owned shape and semantic completeness rules for an immutable mapping artifact for migration model **B: current Relationships projection state only**.

Relationships owns:
- approval of exact source-to-target dimension mappings;
- exact value mappings for each source rule-module pin;
- explicit special-state handling;
- explicit retirement of removed dimensions;
- explicit disposition of target-only dimensions;
- semantic approval of the exact source/target version pair.

Core owns resolution of exact pins, trusted World Pack digest verification, conformance-gate enforcement, atomic execution, persistence, derived-result provenance, audit, idempotency, rebuild, rollback, and query-time selection. This document does not define or implement any of those mechanisms.

The artifact is not:
- a World Pack manifest or a replacement for the unfinished full World Pack format;
- a rule-module manifest or executable evaluator;
- a public API, storage schema, transaction protocol, or migration implementation;
- permission to rewrite historical events or effects;
- permission to change Personality traits or NPC knowledge.

Model C (historical event re-materialization) remains excluded. Historical candidate re-evaluation from Core PRs #733/#739 is source-semantic audit evidence only, never a transformation engine.

## 2. Artifact identity and exact pins

The schema is `schemas/relationship-state-migration-mapping.schema.json`.

Every artifact declares:
- immutable `migration_id + migration_version`;
- artifact schema version;
- exact source World Pack ID/version/SHA-256;
- exact target World Pack ID/version/SHA-256;
- the complete set of exact source `rule_module_id + version` pins covered;
- one exact target rule-module ID/version;
- all dimension/value/state dispositions;
- target-only dimension dispositions;
- target-pack conformance evidence bound to the target digest.

No latest/nearest fallback is valid. A mapping is scoped to its exact source module pin. Identical dimension/value labels under another source module version do not authorize reuse. A later migration step requires a separately approved artifact for that exact pair; artifacts are not automatically chained.

An approved artifact is immutable. A semantic correction creates a new artifact version and a new approval decision; it does not edit an artifact already referenced by a migration result.

## 3. Dimension mapping rules

Each `dimension_mappings` entry is scoped by:
`source_rule_module.module_id + source_rule_module.version + source_dimension`.

There are two explicit dispositions:

### `map`

A mapped dimension must declare:
- one target dimension;
- an exact mapping for every value in the source dimension's exact rule-module domain;
- explicit handling for every special state in the artifact state vocabulary.

Value matching is exact and type-preserving. No fuzzy match, coercion, range interpolation, nearest value, default, or implicit deletion is allowed.

Mapping v1 rejects many-to-one target-dimension collisions. Two source dimensions cannot map to the same target dimension. There is no implicit merge/aggregation operation.

### `retire`

A removed source dimension may be retired only through an explicit `retire` disposition with a non-empty domain reason. This is an approved semantic disposition, not an implicit drop. The artifact must still identify the exact source module and source dimension. The example is fixture-only and does not assert that a production dimension is currently retired.

## 4. Special-state semantics

The artifact requires explicit mappings for these state identifiers:

- `unset`
- `cleared`
- `withheld`
- `conflict`
- `insufficient`
- `insufficient_support`
- `unsupported`
- `incomplete`

The policy's `insufficient` label and the evaluator's `insufficient_support` token are both represented explicitly; the artifact does not silently normalize one to the other. A source/target domain may only use a state that its exact contract supports.

Important representation boundaries:

- **Unset:** in the current projection this is absence of a dimension key, not a synthetic source row. An artifact's `unset` mapping declares the semantic disposition if that source dimension is absent; it must not cause Core to create a source row.
- **Cleared:** an explicit clear lifecycle state; it is not equivalent to unset or a neutral value.
- **Withheld:** a read-result/visibility state, not proof that a canonical value exists or does not exist. If a migration input contract actually supplies it, it needs an explicit mapping; otherwise the operation rejects.
- **Conflict / insufficient:** reconciliation states, not ordinary domain values. They must remain distinct unless an explicitly approved mapping defines a different target meaning.
- **Unsupported / incomplete:** unsupported input states are not coerced to neutral, unset, or a valid value.

The schema permits an explicit state-to-state or state-to-value mapping, but the domain acceptance check rejects collapsing two distinct source special states into the same target outcome. Any non-identity conversion needs a documented semantic justification and approval. Missing or ambiguous special-state handling rejects the entire migration.

## 5. Target-only dimensions

Every target dimension that has no source mapping must appear in `target_only_dimensions` with exactly one disposition:

- `remain_unset`: leave the target dimension absent/unset;
- `initialize_value`: initialize it to one exact value in the target dimension's declared domain.

No implicit neutral value, empty string, zero, default, or guessed value is permitted. A target-only dimension cannot also be the target of a source mapping.

## 6. Conformance and approval gate

A World Pack digest proves exact artifact bytes under the trusted catalog; it does not prove semantic schema conformance. The repository's `docs/04-world-pack-format.md` explicitly says the complete World Pack format and production loader are not finalized.

Accordingly:
- a draft/fixture artifact may say `target_pack_conformance.status = not-established`;
- an artifact cannot be marked `approved` unless it is non-fixture, the target conformance status is `passed`, the conformance evidence is bound to the exact target digest, and approval metadata cites the policy and decision;
- absence of a supported conformance result is a fail-closed release blocker, not something this mapping schema can solve.

The `target_pack_conformance.evidence_ref` is a reference to external conformance evidence. This schema does not invent or implement a World Pack validator.

## 7. Fixture examples and their evidence boundary

### Complete example

`examples/relationship-migrations/test-pack-1.0.0-to-fixture-v2-2.0.0.json` uses the source dimensions from the Core integration test fixture in `tests/relationship-transition-core.test.js`:
- `trust`: `low | neutral | high`;
- `affinity`: `low | high`;
- source module pin: `relationship-rules@1.0.0`;
- source pack label: `test-pack@1.0.0`.

The target pack, target rule module, target dimension names, and SHA-256 strings are deliberately fixture-only. They are not registered production World Packs or trusted catalog entries. The fixture demonstrates complete mapping syntax and explicitly leaves target-only `reliability` unset. Its conformance status is `not-established`, so it is not an approved executable mapping.

The separate pure evaluator test fixture in `tests/relationship-evaluate-candidate.test.js` uses different dimensions/values (`trust: low|guarded|high`, `affection: absent|warm|strong`). Those are not interchangeable with the Core integration fixture and are not asserted as a production World Pack domain.

### Explicit retirement example

`examples/relationship-migrations/explicit-retirement-fixture.json` shows how a removed source dimension can be retired with a reason. All identifiers and pins in that file are synthetic fixture data.

## 8. Acceptance coverage

`tests/relationship-migration-mapping-artifact.test.js` exercises the mapping contract and fixtures only:

| Case | Expected result |
|---|---|
| Complete exact source/target pins and values | Accepted by the domain fixture checker |
| Missing source value | Reject whole artifact |
| Unset vs cleared | Both explicitly represented and kept distinct |
| Special-state collision | Reject |
| Target-only dimension without disposition | Reject |
| Many-to-one target dimension | Reject |
| Wrong source or target digest | Reject |
| Extra/unmapped source rule-module pin | Reject |
| Removed dimension without explicit retirement reason | Reject |
| Fixture marked approved / conformance not established | Schema gate rejects approval |

These are **Relationships-owned artifact/fixture tests**, not Core migration runtime tests. They do not prove trusted catalog resolution, actual World Pack conformance, transaction atomicity, immutable derived-result persistence, query selection, restart/rebuild, rollback, or idempotency. Those remain Core-owned acceptance gates in PR #746 and any subsequent runtime implementation PR.

## 9. Cross-review of Core PR #746

The current #746 proposal is consistent with the approved #745 policy and this artifact contract on the central constraints:

- exact source/target World Pack ID/version/digest and exact rule-module pins;
- source-module-scoped dimension/value mappings;
- whole-operation refusal for any missing mapping or provenance;
- explicit `cleared` handling;
- `unset` represented by absence, without synthesizing a source row;
- explicit target-only dimension disposition;
- explicit removed-dimension disposition;
- collision rejection in mapping v1;
- no latest fallback, coercion, automatic chain, or historical event rewriting;
- read-only historical candidate re-evaluation is not the transform engine.

Clarifications supplied by this artifact contract:
1. The artifact lists the complete source rule-module pin set and scopes every dimension mapping to one exact pin.
2. The state vocabulary preserves both policy-level `insufficient` and evaluator-level `insufficient_support` as separately explicit identifiers rather than silently normalizing them.
3. Mapping v1 rejects every many-to-one target-dimension collision; it does not define a collision operator.
4. A fixture/draft mapping is not production-approvable until exact target-pack conformance evidence exists and is bound to the target digest.

No contradiction with #745 was found in the reviewed #746 proposal. Its Core-owned storage, derived-base/rebuild, rollback, audit, and transaction requirements remain Core work and are not implemented here.

## 10. Release boundary

This PR does not authorize migration runtime. Until Core separately approves and implements the execution contract, and a non-fixture mapping has exact trusted source/target pins plus target conformance evidence and domain approval:

- migration remains unavailable and fail-closed;
- no partial derived result is written;
- source events/effects/snapshots/pins remain immutable;
- Personality traits and NPC knowledge remain unchanged;
- Memory→NPC remains `DISABLED / FAIL-CLOSED`.
