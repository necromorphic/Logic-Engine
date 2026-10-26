# Universal mechanics contracts and safe defaults

Status: accepted implementation contract. Immutable template/module registries and the world-scoped MechanicInstance lifecycle slice are implemented. A bounded, opt-in application-layer executor/effect-intent path also exists, but it does not establish universal dependency closure/recalculation, general conflict evaluation/adjudication, complete template-defined parameter/state validation, production policy-provider freshness/lifecycle wiring, or active-process lifecycle policy execution. This document narrows the open points in `docs/25-universal-mechanics-system.md`; it does not add genre-specific behavior or a World Pack example.

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

The API uses the normal bearer token plus a separate `ENGINE_ADMIN_TOKEN` for mechanic template registration and world-instance lifecycle operations. The admin credential is withheld from model/adapter proposal requests; ordinary adapter proposals are explicitly rejected if they contain mechanic lifecycle effects. A role or actor ID supplied by an LLM or included only in a request body is not authentication.

This is a coarse shared-credential boundary, not proof of a named human identity or a fine-grained per-user role system. Audit records show the committed event and credential-gated route, not an inferred human identity. Manual adjudication and richer host actor/role attribution remain out of scope.

## 7. Runtime implementation order

1. **Implemented:** immutable, versioned template and module-manifest registries, content hashes, exact-version lookup, and append-only registry audit. The authenticated API client is recorded as the registration principal; this does not identify a human author.
2. **Implemented:** authenticated registry list/register/read routes and tests for empty registries, exact-version lookup, duplicate registration, immutability, and audit.
3. **Implemented — lifecycle slice:** world-scoped `MechanicInstance` projection pinned to an exact template version; admin-only create/list/enable/disable routes; expected-revision and idempotency checks; lifecycle predecessor causality; rebuild from valid event history; rollback dependency tracking; adapter-proposal rejection.
4. **Partially implemented / remaining work:** a bounded, opt-in executor and effect-intent/proposal path exist, but they are not a universal production executor. Universal dependency closure/recalculation, general conflict evaluation/adjudication, parameter/state schema validation against template-defined schemas, production policy-provider freshness/lifecycle wiring, process lifecycle policy execution, and end-to-end structured `mark_unknown` behavior remain incomplete. These gaps must be resolved and tested before treating World Pack-driven autonomous execution as production-ready or enabling it through a SillyTavern adapter.
5. Define a richer trusted host actor/authorization contract if the deployment needs per-user attribution or roles beyond the shared admin credential.

The runtime contract validator is a dedicated bounded validator, not a general JSON Schema 2020-12 implementation. Schema files are structurally checked by tests, but full JSON Schema conformance testing remains open.

The lifecycle slice does not claim that mechanic execution or process rollback semantics are complete.
