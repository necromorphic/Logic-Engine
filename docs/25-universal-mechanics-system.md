# Universal mechanics system — architecture decision

Status: **accepted architecture decision; implementation contract for the universal system only**.

This document records the decisions agreed in the project discussion about the world mechanics system. It deliberately specifies reusable infrastructure, not the mechanics of any particular game or genre.

## 1. Scope and exclusions

The engine will provide a universal, data-driven mechanism for defining, versioning, attaching, resolving, and auditing world mechanics.

This stage must **not** add:
- concrete gameplay mechanics;
- genre-specific rules or illustrative game examples;
- a demonstration World Pack;
- sample mechanics merely to make the registry look populated.

The mechanic-template library, a world's mechanic-instance list, and mechanic-specific world state may all be empty. Technical tests should exercise the infrastructure and contracts without introducing fictional/gameplay mechanics.

## 2. Architectural placement

Mechanics infrastructure belongs inside the existing **modular monolith**, separated by domain/application/ports boundaries. It is not a separate network service.

The mechanics subsystem uses the same authoritative engine, persistence boundary, event history, validation, audit, and rollback model as the rest of the world. Host adapters and management tools call validated application operations; they do not mutate mechanic state directly.

## 3. Core concepts

### 3.1 `MechanicTemplate`

An immutable, reusable, versioned definition of a mechanic.

A template contract may define:
- applicability conditions;
- eligible participants and objects;
- permitted actions and proposed effects;
- preconditions, constraints, exceptions, and interactions;
- conflict-resolution policy;
- supported rule-module contracts and required capabilities;
- lifecycle semantics for processes started by the mechanic.

A template version is immutable once referenced by a world instance or historical event. Publishing a new version must not silently rewrite a running world's configuration or reinterpret committed history.

### 3.2 `MechanicInstance`

A world-local attachment of one exact `MechanicTemplate` version to one world.

An instance may contain:
- template identity and pinned version;
- instance parameters;
- local configuration and state;
- activation status;
- priority or precedence data, where the selected conflict policy needs it;
- lifecycle and audit metadata.

An instance belongs to exactly one world. Another world must not share its mutable instance state, history, activation status, or process records.

### 3.3 Active rules versus world state and consequences

The engine must distinguish between:
1. which mechanics/rules are currently enabled for evaluating new actions; and
2. canonical world facts, committed events, effects, memories, and processes already created.

Disabling a mechanic changes the active rule set. It does **not** erase or reverse facts, effects, memories, events, or consequences that already exist. The engine is responsible for simulation consequences; disabling does not require a narrative justification.

If disabling affects a process already in progress, that process must follow an explicit policy. The engine must not silently delete, freeze, or continue such a process by assumption. Process policies must be defined and validated as part of the mechanic lifecycle contract.

## 4. Activation, deactivation, and authority

Enabling or disabling a `MechanicInstance` is an explicit, validated, attributed, auditable world operation.

- A language model may propose a mechanic-related action or a configuration change for an authorized decision-maker to review.
- The model must not directly activate/deactivate mechanics, change template versions, bypass conflict resolution, or apply effects.
- Only the engine can validate and commit the operation.
- A configuration change must be represented in event history so the applicable rule set can be reconstructed for historical evaluation.
- Invalid or unauthorized configuration changes must not partially mutate canonical state.

Policy for who may approve configuration changes belongs to the authorization contract; it must not be inferred from model output.

## 5. Conflicts between mechanics

Mechanic interaction/conflict policy is explicit rather than accidental.

Supported policy labels:
- `automatic`: the engine resolves a conflict using a declared, deterministic policy encoded in the validated configuration.
- `manual`: the conflict is surfaced for author/operator review; the engine must not invent a winner.

If a conflict cannot be conclusively resolved by the declared automatic policy, it remains unresolved and requires review. Model-generated prose is not a substitute for a validated resolution. Priority is not a universal implicit tie-breaker; it may be used only when the applicable policy explicitly defines it.

Conflict evaluation and resolution must be auditable and reproducible from the relevant template versions, instance configuration, and event history.

## 6. Rule modules and executable behavior

Executable rule modules must be registered through an explicit allowlist and expose a versioned contract.

A rule-module contract must identify, at minimum:
- stable module identifier and exact version;
- declared capabilities/operations;
- input and output schemas;
- validation and failure behavior;
- compatibility requirements;
- whether it can propose effects, evaluate predicates, or perform another narrowly defined engine-mediated operation.

Unknown modules, versions, capabilities, or contract shapes must be rejected or marked unsupported; they must never execute because a model mentioned them in text. Module code cannot write canonical storage directly and cannot bypass event attribution, validation, audit, or rollback.

## 7. World isolation and unsupported mechanics

Every world has its own mechanic instances, instance configuration, active rule set, process records, state, and history. No mechanic instance or mutable state is shared across worlds. Cross-world references and effects are forbidden unless a future, separately specified feature explicitly authorizes them; they are not part of this contract.

When an action or requested mechanic is not supported by the loaded template/module contracts, the default policy is `mark_unknown`: preserve the fact that the request is unsupported/unknown and do not fabricate behavior or apply unvalidated effects. A caller may receive a validation/review result, but unsupported behavior must not be silently approximated as if it were authoritative.

## 8. Relationship to causality, history, and rollback

Mechanic activation changes, conflict resolutions, process starts/stops, and effects must be attributable to committed engine events.

The engine must preserve enough version/configuration identity to determine which rules applied at a historical point. Rolling back an event must not mutate a template version. It must invalidate/recompute only causally dependent instance state, process state, claims, or projections according to the universal causality contract, while preserving independent consequences.

Disabling a mechanic is not itself a rollback of the events that were produced while it was enabled. Those are distinct operations with distinct audit records and semantics.

## 9. Implementation boundaries and order

The initial implementation should establish:
1. schema/contracts for templates, instances, versions, and activation state;
2. world-scoped storage and isolation invariants;
3. a registry/allowlist for versioned rule modules;
4. validated activation/deactivation and conflict-resolution operations;
5. lifecycle hooks for active processes, with an explicit policy required before changing their behavior;
6. audit and causal attribution;
7. technical tests for empty registries, version pinning, isolation, unauthorized model proposals, conflict policies, and disabling without erasing consequences.

Do not implement concrete gameplay mechanics or populate a demonstration World Pack as part of these steps. Do not start implementation until the relevant schema and operation contracts are precise enough to test.

## 10. Decisions still open

These points require explicit design before implementation where applicable:
- final serialization/schema for template and instance contracts;
- exact deterministic algorithms allowed under `automatic` conflict resolution;
- the operation/API shape for author approval under `manual` resolution;
- authorization roles for mechanic configuration changes;
- the complete set of active-process policies;
- how template/module compatibility is declared and migrated;
- exact representation of `mark_unknown` results in API and persisted state.

Open items do not weaken the accepted invariants above: no model-controlled activation, no direct canonical writes, no cross-world mutable state, no silent history rewrite, and no deletion of existing consequences merely because a mechanic is disabled.
