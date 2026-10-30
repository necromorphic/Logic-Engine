# Core decision: deployment-owned mechanic policy authority

Status: **owner decision; binding contract for the next bounded mechanics integration. This does not enable production mechanic execution.**

Decision owner: **Core/deployment**. The deployment owner is responsible for constructing the trusted policy authority at process startup; Core is responsible for validating its evidence at each canonical lifecycle boundary. Neither an LLM, adapter, proposal payload, mechanic template, nor a rule-module manifest is an authority for access policy.

Related:
- docs/30-stage1.3-mechanic-execution-boundary.md
- docs/34-mechanics-oracle-reconciliation.md
- docs/28-proposal-api-stage1.md
- Issue https://github.com/necromorphic/Logic-Engine/issues/226

## 1. Decision

Use one deployment-owned policy authority for any future bounded mechanic evaluation. Context resolution and proposal validation must resolve the active policy from the same authority. A separate callback or configuration object that is not demonstrably the same source is not sufficient.

The authority must provide a trusted, stable identity and a monotonically changing generation (or an equally strong immutable revision identifier) for the effective policy. The identity/generation is produced by trusted application/deployment code; it must never be accepted from model output, an adapter request, a proposal body, or a caller-supplied evaluation object.

The policy evidence captured during evaluation must bind, at minimum:
- authority identity and policy generation;
- authorization scope;
- authenticated adapter and resolved actor binding;
- recipient and purpose;
- field mapping and exact requested scope;
- world ID, world revision, and commit sequence;
- exact mechanic instance/template/module snapshot used by evaluation.

This evidence is an input to stale-policy detection, not a capability grant that survives revocation.

## 2. Lifecycle rule

At each applicable boundary — context resolution, evaluation acceptance/proposal creation, approval, and commit — the application must resolve the current policy from the configured authority and compare it with the captured evidence.

Fail closed if the authority is missing, unavailable, throws, returns malformed identity/generation, denies any required read, or reports a generation mismatch. Do not treat unknown as false or as permission. Do not silently refresh an old evaluation, its read evidence, or its proposal after policy rotation; reject it and require a new evaluation.

The ordinary canonical path remains proposal -> approval -> Core commit. Preserve both world_revision and commit_sequence guards. Policy validation must not add a second writer, alternate commit route, or model-controlled authorization endpoint.

## 3. Revocation consistency guarantee

The initial deployment contract guarantees **fail-closed revalidation at each lifecycle boundary**, not linearizable revocation against a concurrent commit when policy authority is external to the Core transaction.

A policy rotation can occur after an external validator's final successful read and before the canonical commit. This race must remain documented and must not be described as eliminated by a callback check or passing sequential tests.

If product requirements demand linearizable revocation, the active policy generation must be stored and checked in the same transactional boundary as canonical commit (or an explicitly reviewed equivalent with a demonstrated linearizability argument). That stronger guarantee is a separate implementation gate; it must not be implied by the initial contract.

## 4. Deployment wiring requirements

The deployment composition root (src/index.js) owns construction of the trusted authority and passes the same authority instance/reference to both:
1. the context-resolution path used by mechanic evaluation; and
2. the trusted proposal lifecycle validator used at approval and commit.

No such end-to-end path is currently wired on main. In particular, authorizedReadFieldPolicy alone is only a visibility callback; it is not a versioned policy authority. Do not pretend otherwise, and do not create a test stub and call it production authority.

Before any executor is enabled, implementation must demonstrate that both paths resolve the same authority identity and active generation. If the current runtime cannot make that connection because the bounded executor/context-provider path is absent, keep the executor disabled and fail-closed rather than adding a partial production route.

## 5. Required tests before enabling the bounded executor

Use the real configured authority and ordinary proposal lifecycle, not only direct helper calls or a stub validator invoked by hand.

1. Missing authority, unavailable authority, thrown lookup, malformed identity/generation, and non-true validation all fail closed.
2. Stable policy allows a supported bounded evaluation through proposal, approval, and commit; both world snapshot guards remain enforced.
3. Rotation after context resolution but before proposal creation rejects the stale evaluation without canonical mutation.
4. Rotation after proposal creation but before approval rejects approval.
5. Rotation after approval but before commit rejects commit and creates no canonical event.
6. A rejected stale proposal cannot be made current by retrying the old evaluation; a fresh evaluation under the new generation can proceed.
7. A concurrent/cross-process rotation test documents the actual consistency guarantee. If linearizable revocation is required, race the generation change against commit inside the approved transactional design.
8. Verify no unauthorized fields are disclosed at the final recipient boundary, not merely that an internal helper returns false.

Each test report must record exact commit SHA, authority identity/generation, test command and result. A green unit test with a fake provider is not closure evidence for deployment wiring.

## 6. Current status and scope

The decision identifies the owner and the trust contract. The current tree contains several bounded mechanics implementation pieces, but their presence is not proof of a production authority binding:

- `src/application/authorized-read-service.js` exposes `readEntityAttributeForMechanic` and `readEntityFields`. It now accepts `DeploymentPolicyAuthority` as the versioned field-policy source; the legacy plain callback remains for compatibility and does not satisfy the Mechanics authority contract.
- `src/application/entity-attribute-context-provider.js` can resolve mechanic condition paths through `AuthorizedReadService`. When that service uses `DeploymentPolicyAuthority`, the provider pins the authority identity/generation before reads, verifies it after reads, and incorporates the evidence into the returned policy version. The legacy direct `canRead` path remains available for isolated/compatibility use but cannot pass the production API's exact-authority check.
- `src/application/mechanic-executor.js` exists as a read-only bounded evaluator. It requires versioned authority evidence in the trusted context and rejects non-empty instance data/action input, unsupported unknown policies, multiple active mechanics, modules/capabilities, participants/interactions, and non-manual conflict policies.
- `src/application/proposals.js` accepts attested mechanic evaluations and revalidates the same authority identity/generation and context policy fingerprint at proposal insertion, approval, and commit. The API now rejects provider-only validation and requires the context provider to expose the exact authority instance used by authorized reads.
- `src/api/server.js` accepts one `deploymentPolicyAuthority` and uses that same object for authorized reads and the proposal lifecycle validator. The validator also requires the active context provider to expose that exact object instance. It rejects simultaneous authority and legacy field-policy configuration.
- `src/index.js` now constructs and passes a deployment authority with the explicit self-identity-only policy. `ENGINE_POLICY_AUTHORITY_ID` and `ENGINE_POLICY_GENERATION` identify its authority and generation; the default generation is `self-identity-only-v1`. The shipped process still does not construct a mechanic context provider, so production mechanic evaluation remains fail-closed.

### Required implementation for the next vertical slice

Complete production wiring by using the already-constructed deployment authority in a trusted mechanic context resolver that owns both:
1. the effective field authorization decision used by `AuthorizedReadService`; and
2. the trusted identity plus active generation used by mechanic context resolution and ProposalService validation.

The authority must be resolved afresh at each boundary. A plain callback, provider fingerprint, or matching configuration string is not sufficient unless the same authority explicitly binds its identity and active generation to the actual field decision. Ready evaluations without complete authority evidence are rejected by the executor, ProposalService, and Core. The context provider must capture the authority identity/generation before reading, verify it remains current after all reads, and return that evidence with the evaluation. The executor, ProposalService, and Core commit boundary all require that evidence; proposal insertion, approval, and commit revalidate it.

Do not silently promote the existing `authorizedReadFieldPolicy` callback into this role. Do not use a test-only authority as production configuration. The deployment may use a deny-only policy while no visibility schema is approved; that is a valid fail-closed state, but it cannot authorize mechanic condition attributes or enable production mechanics.

The exact-current tree now has a versioned authority and the Core integration path. The remaining deployment gap is a trusted context resolver and approved domain visibility mapping configured with that exact authority object. Do not mechanically rebase or merge #225/#270: their stale diff contains excluded executor, attestation, proposal-handoff, and storage changes. Implement a fresh current-main vertical slice against this contract, review its effective diff, run exact-head Runtime CI plus the recalculation harness, and keep production mechanics disabled until all applicable tests below pass.



## 7. Future extension gates

The following features are deliberately not part of the bounded executor. They require separate contracts and acceptance tests before their rejection guards may be relaxed.

### Action inputs and instance parameters/state
- Define template-owned input, parameter, and state schemas using the exact schema dialect the runtime can validate.
- Define canonical binding paths and whether each value is read-only input or mutable world-local state.
- Include schema/version hashes and actual consumed paths in the evaluation fingerprint and dependency manifest.
- Prove missing, defaulted, malformed, and unknown fields have explicit semantics. No implicit defaults or model-authored executable expressions.

### Registered modules
- Bind a registered module manifest to a host-allowlisted implementation identifier and immutable implementation/build digest.
- Enforce operation, capability, input/output schema, determinism, timeout, memory/resource, and failure-policy contracts.
- Declare module reads/writes and verify runtime reads against the declared dependency set. Module registration alone never authorizes execution.
- Keep all returned effects as proposals and validate them through the canonical Core path.

### Participants and interactions
- Define same-world participant resolution, role identity, eligibility constraints, visibility authorization, and snapshot binding.
- Include all participant/interaction condition paths and resolved participant identities in dependency evidence and fingerprints.
- Define how missing, ambiguous, or inaccessible participants map to `unknown` or `needs_review`; never infer a participant from narrative context.

### Conflict resolution
- `manual` remains the only supported executor policy, and the current executor rejects worlds with more than one enabled/review-required mechanic instance because the cross-mechanic conflict graph is not complete.
- Automatic resolution requires an exact-version allowlisted deterministic resolver module, explicit conflict graph inputs, declared dependencies, bounded resources, and an independently tested tie-break contract.
- Resolver output remains a proposal; the resolver cannot commit or bypass approval.
- No priority, array order, registration order, or incidental storage order may be used as an implicit winner rule.

Until each extension gate is accepted and tested, the executor must continue returning a structured non-ready result with no effects for those cases.

**Current verdict: shared versioned authority is wired to production authorized reads and required by evaluation/proposal/Core contracts; production Mechanics remains DISABLED / FAIL-CLOSED because no trusted mechanic context resolver or approved domain visibility mapping is configured.**
