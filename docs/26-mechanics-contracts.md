# Universal mechanics contracts and safe defaults

Status: implementation contract for the first mechanics runtime slice. This document narrows the open points in `docs/25-universal-mechanics-system.md`; it does not add genre-specific behavior or a World Pack example.

## 1. Contract artifacts

- `schemas/mechanic-template.schema.json`: immutable, reusable, versioned definition.
- `schemas/mechanic-instance.schema.json`: world-local attachment to an exact template version.
- `schemas/rule-module-manifest.schema.json`: allowlist registration contract for versioned module implementations.
- `schemas/declarative-rule.schema.json`: existing bounded rule vocabulary; no arbitrary code is permitted.

A template is identified by `(template_id, version)`. That pair is immutable once registered. Publishing changed content under an existing pair is rejected; a changed definition requires a new version. A world instance pins one exact version and is never silently upgraded.

## 2. Instance lifecycle

New instances start as `disabled`. Only an engine-mediated, attributed operation may enable or disable an instance. Instance status is one of `disabled`, `enabled`, or `needs_review`.

The operation must check the expected world revision, validate the pinned template and every referenced module against the allowlist, and commit its state change and audit record atomically. A stale revision or invalid reference must not partially mutate state. Model output is a proposal, not authorization to perform this operation.

Disabling changes which rules may be considered for new actions. It does not retract events or erase facts, knowledge, or other consequences created earlier. Existing processes follow the pinned template's `lifecycle_policy.on_disable`; the engine must not infer a default.

## 3. Conflicts and unknown mechanics

- `automatic` requires a registered exact-version resolver module that declares `resolve_conflict`. No generic priority or array-order tie-break is implied by this contract.
- `manual` produces a durable review result; no winner is selected until an authorized decision is recorded.
- Unsupported or unresolved mechanics follow the declared `unknown_policy`. The universal default is `mark_unknown`: return a structured unknown/review result and do not execute unvalidated effects.
- Resolver output is still a proposal. The engine validates it and performs the canonical mutation through its normal event pipeline.

## 4. Module allowlist

A module manifest declares identity, exact version, supported operation(s), capabilities, input/output schemas, failure behavior, and core compatibility. Registration alone does not execute code. Only implementation identifiers explicitly enabled by the host's allowlist may be invoked. Unknown identifiers, versions, capabilities, or incompatible contracts fail closed or produce the declared non-mutating unknown/review result.

Module implementations cannot write SQLite or other canonical storage directly. The runtime must mediate all effects, attribution, validation, audit, and rollback.

## 5. Isolation and history

Every instance, activation state, parameters, state, process reference, and audit entry is scoped to one `world_id`. Cross-world references are rejected. A template definition is global immutable library data; no mutable instance state is stored on the template.

Activation/deactivation and conflict adjudication must be represented in event history with exact template/module versions. Rollback may invalidate causally dependent world-local instance/process state, but must never rewrite or delete template definitions. Disabling a mechanic and rolling back an event are different operations.

## 6. Authorization boundary

The current API has a single bearer token and does not yet distinguish model proposals from trusted author/operator actions. Therefore a public activation/deactivation or manual-adjudication route must not be exposed until the trusted caller identity/role is supplied by the host boundary. A role field supplied by an LLM or included only in the request body is not authentication.

The initial runtime slice may implement immutable template/module registration and read-only retrieval. World-instance creation and status transitions remain gated on a trusted actor contract; they must not be implemented by trusting model-authored identity fields.

## 7. Runtime implementation order

1. Add immutable, versioned template and module registries with persistence and duplicate-content checks.
2. Add read-only registry routes and tests for empty registries, exact-version lookup, duplicate registration, and immutability.
3. Define trusted host actor/authorization before exposing instance mutation routes.
4. Add world-scoped instance storage and event-backed activation/deactivation, including rollback behavior and process lifecycle handling.
5. Add conflict evaluation/adjudication and structured `mark_unknown` responses.
6. Only then connect a World Pack, model proposal flow, or SillyTavern adapter.

This sequence deliberately separates safe immutable registration from mutable world operations. It does not claim that mechanics execution or rollback integration is complete.
