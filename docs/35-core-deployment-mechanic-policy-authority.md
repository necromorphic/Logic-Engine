# Core decision: deployment-owned mechanic policy authority

Status: **binding owner decision; partial implementation exists on the current mechanics-policy-authority branch. Production mechanic execution remains disabled.**

Decision owner: **Core/deployment**. The deployment owner constructs the trusted policy authority at process startup; Core validates its evidence at every canonical lifecycle boundary. Neither an LLM, adapter, proposal payload, mechanic template, nor a rule-module manifest is an authority for access policy.

Related:
- docs/30-stage1.3-mechanic-execution-boundary.md
- docs/34-mechanics-oracle-reconciliation.md
- docs/28-proposal-api-stage1.md
- Issue https://github.com/necromorphic/Logic-Engine/issues/226

## 1. Decision

Use one deployment-owned policy authority for bounded mechanic evaluation. Context resolution and proposal validation must resolve the active policy from the same authority. A separate callback or configuration object that is not demonstrably the same source is insufficient.

The authority provides a trusted identity and a monotonically changing generation (or an equally strong immutable revision identifier) for the effective policy. The runtime identity is stable for one process lifetime and combines the configured deployment policy-source ID with a cryptographically random process-instance suffix. A new process therefore has a new identity even if an operator accidentally restores an old generation value. Identity and generation are produced by trusted application/deployment code; they must never be accepted from model output, an adapter request, a proposal body, or a caller-supplied evaluation object.

The policy evidence captured during evaluation binds, at minimum:
- authority identity and policy generation;
- authorization scope;
- authenticated adapter and resolved actor binding;
- recipient and purpose;
- field mapping and exact requested scope;
- world ID, world revision, and commit sequence;
- exact mechanic instance/template/module snapshot used by evaluation.

This evidence is an input to stale-policy detection, not a capability grant that survives revocation.

## 2. Lifecycle rule

At each applicable boundary — context resolution, evaluation acceptance/proposal creation, approval, and commit — the application resolves the current policy from the configured authority and compares it with captured evidence.

Fail closed if the authority is missing, unavailable, throws, returns malformed identity/generation, denies any required read, or reports a generation mismatch. Do not treat unknown as false or as permission. Do not silently refresh an old evaluation, its read evidence, or its proposal after policy rotation; reject it and require a new evaluation.

The ordinary canonical path remains proposal → approval → Core commit. Preserve both world_revision and commit_sequence guards. Policy validation must not add a second writer, alternate commit route, or model-controlled authorization endpoint.

## 3. Revocation consistency guarantee

The initial deployment contract guarantees **fail-closed revalidation at each lifecycle boundary**, not linearizable revocation against a concurrent commit when the policy authority is external to the Core transaction.

A policy rotation can occur after an external validator's final successful read and before canonical commit. This race must remain documented and must not be described as eliminated by a callback check or passing sequential tests.

If product requirements demand linearizable revocation, the active policy generation must be stored and checked in the same transactional boundary as canonical commit (or an explicitly reviewed equivalent with a demonstrated linearizability argument). That stronger guarantee is a separate implementation gate; it must not be implied by the initial contract.

## 4. Implemented authority contract

The current implementation introduces `MechanicPolicyAuthority` in `src/application/mechanic-policy-authority.js`.

- It owns a process-scoped `authority_id` (deployment source ID plus random process-instance suffix), a positive integer `generation`, and the trusted synchronous field-policy function.
- `getSnapshot()` returns the exact authority identity/generation pair.
- `authorizeField()` checks the expected generation both before and after the field-policy callback. A synchronous rotation during authorization therefore denies the read.
- `rotate()` increments the in-process generation and replaces the trusted policy function.
- `createProcessScopedMechanicPolicyAuthority()` generates a fresh authority identity on every process start. Persisted proposals from an earlier process therefore fail closed even if `ENGINE_MECHANIC_POLICY_GENERATION` is restored to an earlier value.
- The class is an in-process authority adapter. It does **not** coordinate policy changes across multiple processes and does not make revocation linearizable with SQLite commit. A multi-process deployment must remain disabled until a shared authority store and transactional consistency contract are implemented.

`AuthorizedReadService` uses the same authority for ordinary field reads and internal mechanic attribute reads when configured with it. Mechanic reads require the expected authority snapshot and return that snapshot with the read result. A legacy bare field-policy callback remains usable for ordinary reads, but it cannot authorize mechanic attribute reads.

`CanonicalEntityAttributeContextProvider` requires a versioned-authority-backed `AuthorizedReadService` for the mechanic path. It captures the authority identity/generation, passes it into every attribute read, verifies it did not rotate during resolution, and includes it in the context policy fingerprint. Its lifecycle validator also rechecks the current authority and the authenticated adapter-to-actor binding.

`MechanicExecutor` includes authority identity/generation in the resolved-context contract, context fingerprint, and evaluation fingerprint. A context without valid authority evidence cannot produce a ready evaluation.

`ProposalService` persists the authority evidence and revalidates it at proposal creation, approval, and commit. Missing validators, malformed evidence, authority replacement, actor-binding revocation, or generation rotation fail closed. A stale evaluation is not refreshed or made current by retrying it.

`createApiServer` accepts one `mechanicPolicyAuthority` and passes that exact object to `AuthorizedReadService` and the proposal lifecycle validator. The validator also requires the active context provider to expose that exact authority object; matching strings from two separate sources are insufficient.

## 5. Deployment composition and current limitation

`src/index.js` now constructs a default `MechanicPolicyAuthority` and passes it into `createApiServer`.

Configuration:
- `ENGINE_MECHANIC_POLICY_AUTHORITY_ID` — deployment policy-source identity prefix; defaults to `logic-engine.default-visibility-policy`.
- `ENGINE_MECHANIC_POLICY_GENERATION` — positive integer initial generation for this process; defaults to `1`.

The runtime appends a cryptographically random process-instance suffix to the configured identity on every start. This removes the prior manual requirement to remember to rotate the identity after restart: old persisted mechanic proposals cannot match the new process authority, even if the generation environment variable rolls back. Pending mechanic proposals are intentionally invalidated by restart. This is fail-closed, not proposal continuity. The default policy intentionally permits only the bound actor's own identity fields and denies all attributes. This is a narrow fail-closed policy, not a general NPC/mechanic visibility policy.

**Production context-provider wiring is still incomplete.** `src/index.js` does not construct/register an active `CanonicalEntityAttributeContextProvider`; `getActiveMechanicContextProvider` remains null by default. Therefore the proposal validator remains fail-closed in the standalone runtime. The default authority also denies attribute reads, so it cannot make arbitrary mechanic condition paths readable. A deployment must supply its real context binding and policy source and construct the provider with the exact same authority object before enabling mechanic evaluation. Do not replace the null provider with a permissive default.

The ordinary authorized-read and proposal paths now share the authority when one is configured. The full deployment-owned evaluation → proposal → approval → commit path is not yet proven on the standalone entry point.

## 6. Required verification before enabling the bounded executor

Tests must use the real configured authority and ordinary proposal lifecycle, not only direct helper calls or a stub validator.

1. Missing authority, unavailable authority, thrown lookup, malformed identity/generation, and non-true validation fail closed.
2. Stable policy permits a supported bounded evaluation through proposal, approval, and commit; both world snapshot guards remain enforced.
3. Rotation after context resolution but before proposal creation rejects the stale evaluation without canonical mutation.
4. Rotation after proposal creation but before approval rejects approval.
5. Rotation after approval but before commit rejects commit and creates no canonical event.
6. A rejected stale proposal cannot be made current by retrying the old evaluation; a fresh evaluation under the new generation can proceed.
7. A concurrent/cross-process rotation test documents the actual consistency guarantee. If linearizable revocation is required, race generation change against commit inside the approved transactional design.
8. Verify no unauthorized fields are disclosed at the final recipient boundary, not merely that an internal helper returns false.
9. Run exact-head Runtime CI and the isolated recalculation-oracle harness. Record exact commit SHA, authority identity/generation, command, and result.

Current branch tests add coverage for versioned reads, malformed/missing authority, in-read rotation, shared authority identity, actor-binding revocation, and policy generation rotation across proposal creation, approval, and commit. These tests are not considered passed until exact-head CI completes.

## 7. Confirmed executor boundary and dependency completeness

The supported executor remains `bounded_deterministic_action_v1`. Its confirmed supported slice is read-only evaluation of a deterministic action with empty object input, explicit same-snapshot condition evidence, and canonical effect-intent translation. The dependency manifest intentionally reports:
- `condition_ast_dependencies_complete: true` for the declared condition paths in this slice;
- `context_projection_dependencies_complete: true` when the trusted provider supplies exactly one authorized canonical mapping per condition path;
- `effect_target_dependencies_complete: true` for the supported translated effect targets;
- `causal_read_set_complete_for_supported_slice: true`;
- `mechanic_dependencies_complete: true` only within this bounded slice;
- `global_mechanic_dependencies_complete: false`.

The final flag is not a defect to hide or a value to flip. Full mechanic dependency completeness is not established for modules, input-derived reads, participant selection, interactions, capability grants, automatic conflict resolvers, or future action/effect types. The independent A/B/C recalculation oracle remains an isolated benchmark and does not prove global dependency completeness or production runtime correctness.

Unsupported cases must remain rejected before effect translation/proposal creation:
- registered rule modules or required capabilities without an explicit executable allowlist/grant contract;
- non-empty action input schemas or non-empty action input values;
- eligible participants, participant constraints, or interactions;
- automatic conflict resolution or any conflict mode other than the current manual policy;
- unsupported ambiguity policies and effect-intent kinds.

Future support for input parameters, modules, participants, interactions, capability grants, and conflict resolution requires separate versioned contracts, trusted authorization/dependency semantics, conflict rules, and tests. Do not implement any of these by silently expanding the current executor's accepted shape.

**Current verdict: authority contract and lifecycle revalidation are implemented on the review branch; standalone production context-provider wiring, cross-process generation ownership, and exact-head CI remain open. Production Mechanics stays DISABLED / FAIL-CLOSED.**
