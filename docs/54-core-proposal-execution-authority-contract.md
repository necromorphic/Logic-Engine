# Core proposal execution authority contract

Status: **schema-neutral design proposal; not runtime behavior or authorization approval**.

Scope: define who may execute an already-approved proposal and how that authority relates to proposal ownership, approval, internal orchestration, retries, and audit. This document does not add an endpoint, credential, schema field, database column, or runtime behavior.

Related:
- `docs/27-proposal-to-commit-boundary.md`
- `docs/28-proposal-api-stage1.md`
- `docs/50-core-trusted-mutation-origin-contract.md` (proposed in PR #63; not merged)
- `docs/53-core-http-service-boundary-audit.md` (proposed in PR #67; not merged)

## 1. Verified current boundary

The current proposal lifecycle records the creating adapter, requires a separate shared approval credential to approve, rechecks the captured world revision and commit sequence before commit, and records the commit through the canonical event path.

The current HTTP contract does not require the creating adapter identity on `POST /v1/worlds/:world_id/proposals/:proposal_id/commit`. A caller with the general API bearer who knows an approved proposal ID can therefore trigger its commit. This does not bypass the approved-state or stale-proposal checks, but it does separate execution authority from proposal ownership without an explicit policy.

The internal events route is a distinct path: when enabled, it requires the general API bearer plus the internal credential and accepts only the ID of an already-approved proposal. It is not arbitrary event injection. Neither fact establishes a complete policy for every possible executor.

## 2. Required distinctions

The implementation and documentation must not conflate these authorities:

1. **Submission authority** — which adapter may create a proposal under its identity.
2. **Approval authority** — which trusted approval mechanism may approve that stored proposal. The current shared approval token is a service gate, not a named human identity.
3. **Execution authority** — which principal may ask the engine to execute an already-approved proposal.
4. **Canonical validation authority** — the core's commit path validates lifecycle, captured revision/sequence, event constraints, and atomic commit invariants.
5. **Correction/admin authority** — a separate privileged path for operations such as canonical rollback; it must not be implied by ordinary API access.
6. **Audit attribution** — which authenticated principal triggered each transition. Caller-supplied labels are not proof of identity.

Approval is not execution permission. Possession of a proposal ID is not execution permission. A valid proposal is not proof that the source text is true or semantically aligned with the effects.

## 3. Recommended first-slice policy

**Recommendation for review, not an approved implementation decision:**

- An adapter-facing commit request must authenticate the adapter and match the proposal's stored `created_by_adapter_id`.
- A trusted orchestrator may execute an approved proposal through the existing internal route only when the separate internal capability is configured and supplied. The internal path must continue to accept only an approved proposal ID and must use the same canonical commit service.
- Do not let the general API bearer alone imply cross-adapter execution authority.
- Do not grant the admin credential an implicit proposal-execution bypass unless a separately documented operational requirement justifies it. Admin/correction authority and execution authority are distinct.
- Return a non-enumerating not-found response for an adapter attempting to execute another adapter's proposal, matching the proposal-read boundary.
- Preserve existing lifecycle, staleness, approval, atomicity, and idempotency checks for every execution path. The trusted path must not bypass canonical validation.
- Attribute the execution request to the authenticated adapter or trusted internal principal in audit using server-derived identity. Do not accept a caller-provided executor label as authority.

This policy minimizes the adapter trust surface while preserving a trusted orchestration path. If the product requires a central executor to commit proposals on behalf of multiple adapters, that must be an explicit capability decision rather than an accidental consequence of a shared bearer token.

## 4. Retry and race semantics

The same approved proposal may receive concurrent or repeated commit attempts. The contract must guarantee:

- At most one canonical event commit for a proposal.
- Retries after a successful commit return the documented idempotent result and do not duplicate the world effect.
- A different adapter cannot gain authority by replaying the proposal ID or the original idempotency key.
- A stale proposal remains rejected even when the caller is otherwise authorized.
- Concurrent attempts cannot produce a split outcome where the canonical event commits but proposal status/audit does not, or vice versa.
- A failed or unauthorized execution attempt does not mutate canonical state, proposal lifecycle, or commit audit (security-denial logging, if any, is separate and must not masquerade as a world event).

## 5. Required acceptance matrix

| Scenario | Expected result |
|---|---|
| Creating adapter commits its approved, current proposal | Allowed; canonical validation and atomic lifecycle run |
| Different adapter attempts commit by proposal ID | Denied; externally non-enumerating response |
| No adapter identity on adapter-facing commit route | Denied |
| Trusted internal orchestrator commits an approved proposal | Allowed only through the separately authenticated internal path |
| Internal credential absent or invalid | Denied; no canonical mutation |
| Any caller commits a pending, cancelled, or rejected proposal | Denied |
| Authorized caller commits stale proposal | Conflict; no canonical mutation |
| Same authorized commit is retried after success | Idempotent result; no duplicate event/effect |
| Two authorized commit attempts race | One canonical commit; both responses consistent with stored lifecycle |
| Caller forges executor/origin/provenance fields | Rejected or ignored; authority comes from server-authenticated context |
| Execution fails during proposal finalization | Entire transaction rolls back, including canonical event |
| Unauthorized attempt targets another adapter's proposal | Same external not-found behavior as a nonexistent proposal |

Tests must exercise the actual HTTP routes and service/transaction path, not only a mocked policy predicate.

## 6. Integration constraints

- Keep proposal execution separate from author-initial/imported state and author correction. A proposal's adapter ownership does not authorize canon initialization or correction.
- Keep relationship semantics, NPC knowledge acquisition, personality, and domain meaning outside the proposal lifecycle service. The proposal service controls lifecycle; canonical core controls commit invariants.
- Do not use context-manifest presence as proof that a model actually used the context or that its proposed effects are true.
- Do not expose internal credentials to models or client-side prompt content.
- Do not claim the policy is enforced until the exact implementation head has tests and the HTTP/in-process callers have been audited.

## 7. Open decision and implementation gate

The recommended policy above remains **pending Core owner review**. Before runtime work, confirm whether the product requires any adapter to execute another adapter's approved proposal. If yes, specify the trusted orchestrator identity and capability boundary explicitly.

Until this decision is approved, keep the current behavior documented as a known boundary; do not silently change API/schema semantics or treat this proposal as authorization to merge a runtime patch.
