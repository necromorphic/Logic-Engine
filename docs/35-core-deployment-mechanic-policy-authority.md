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

This decision identifies the owner and the trust contract. It does not claim that the provider, context resolver, validator wiring, bounded executor, or end-to-end tests already exist. The current main source does not construct and bind such an authority, and the bounded executor path from the old #225/#270 stack is not part of current main.

Do not mechanically rebase or merge #225/#270 to close this gap: their stale diff contains excluded executor, attestation, proposal-handoff, and storage changes. Implement a fresh current-main vertical slice against this contract, review its effective diff, run exact-head Runtime CI plus the recalculation harness, and keep production mechanics disabled until all applicable tests above pass.

**Current verdict: policy ownership is decided; production integration is not yet implemented or proven.**
