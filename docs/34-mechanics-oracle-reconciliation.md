# Mechanics PR reconciliation: canonical lifecycle + recalculation oracle

Status as of 2026-10-25: **merged into `main` through PR #280; bounded integration only, not production enablement**.

## Canonical ownership

The canonical shared implementation now in `main` is the proposal lifecycle and storage path used by the bounded Mechanics integration:
- `ProposalService` owns proposal creation, approval, idempotency, stale-snapshot checks, and commit handoff.
- `LogicEngine.commitEvent` remains the only canonical event commit boundary.
- `SQLiteStore` persists canonical events and projections transactionally.
- The bounded effect-intent translator is a pure translation helper. It does not read storage, approve, or commit.

For the three files shared by PR #180 and PR #225, keep the #180 canonical lifecycle/fact-identity changes as the baseline:
- `src/application/proposals.js`: preserve existing proposal → approval → `LogicEngine.commitEvent`, idempotency-before-translation and in-transaction recheck, `duration_proposal` allowlist, stale snapshot and atomic commit behavior. Do not import #225's evaluation attestation or add a second mechanic-evaluation handoff as part of this reconciliation.
- `src/core/rules.js`: retain #180's strict canonical `fact.set` identity token validation and add the dependency collector only if/when a reviewed production consumer needs it. The oracle harness itself must not be coupled to this Core helper.
- `src/storage/sqlite-store.js`: retain #180's canonical fact identity and duplicate-fact-effect guards. Do not add #225's `mechanic_execution_json` event metadata column or migration as part of this bounded integration; that metadata is not needed by the isolated oracle and would expand the persistence contract.

## What is kept from PR #225

The merged integration carries the isolated `experiments/recalculation-oracle/` harness, its independently authored tests, and this reconciliation note. The harness compares A/B/C strategies on a small in-memory dependency model. It does not read or mutate canonical world state, persist events, create proposals, or call Core commit APIs.

## What is deliberately not imported from PR #225

The following remain outside the merged bounded integration and must not be treated as canonical runtime code:
- `src/application/mechanic-executor.js`;
- `src/application/entity-attribute-context-provider.js`;
- `src/application/mechanic-evaluation-attestation.js`;
- the #225 `ProposalService` changes for mechanic evaluation handoff and policy callback;
- `src/application/engine.js` alternate/internal mechanic metadata commit option;
- `src/application/authorized-read-service.js` new mechanic-specific read method;
- `src/core/mechanics.js` and `src/core/rules.js` dependency-analysis additions unless a separate Core contract and production consumer are reviewed;
- `src/storage/sqlite-store.js` schema migration and persistence of `mechanic_execution_json`.

These remain possible future work only after the authoritative policy lifecycle decision and its end-to-end tests. The oracle must not become a second executor, second proposal authority, or alternate store.

## Validation boundary

Run the full suite with `npm test` and the oracle directly with:

```sh
node --test experiments/recalculation-oracle/harness.test.mjs
```

The oracle's independent expected projections test the harness only. They do not prove production dependency completeness, policy freshness, atomic revocation, SQLite rollback, or runtime performance. A full dependency-aware executor is not established by this merge; production mechanics remain disabled/fail-closed pending the Core policy-freshness and end-to-end acceptance gates.


## Current-tree clarification — PR provenance is not production wiring (2026-10-25)

The section above, “What is deliberately not imported from PR #225”, describes the scope of that particular merge; it should not be read as proof that the named paths do not exist anywhere in the current tree. A fresh fetch of the current default branch confirms that several named files and proposal-path features do exist. Their presence likewise does not establish production wiring.

- `src/application/mechanic-executor.js` exists and exports an opt-in, read-only `MechanicExecutor`. It requires a trusted `resolveAuthorizedContext` callback; this requirement does not itself provide or authorize a deployment provider.
- `src/application/mechanic-evaluation-attestation.js` exists and uses an in-process `WeakSet` marker. Its source describes this as an application wiring guard, not a cryptographic security boundary.
- `src/application/proposals.js` contains mechanic evaluation/policy-related code and a `mechanic_execution_json` proposal metadata path. This does not prove a production mechanic evaluation reaches it.
- `src/api/server.js` constructs `ProposalService` with `createActiveMechanicPolicyValidator(getActiveMechanicContextProvider)`. The default provider is `() => null`; validation fails closed when no active provider is resolved.
- `src/index.js` calls `createApiServer({ engine, token, internalToken, approvalToken, adminToken, adapterTokens })` without supplying `getActiveMechanicContextProvider`, and does not construct/bind `MechanicExecutor` with an approved deployment-owned context resolver.

### Correct interpretation

The bounded translator/proposal integration and the source paths listed above are distinct from a fully wired production mechanic evaluator. The shipped entry point has no demonstrated trusted provider binding. A helper, in-process attestation marker, fixture provider, or callback seam is not evidence of an approved deployment policy authority. The production verdict therefore remains **DISABLED / FAIL-CLOSED**, specifically because trusted provider wiring and real-authority lifecycle tests are not evidenced.

### Closure evidence still required

1. Name/approve the deployment-owned policy authority and document how it mints a trusted identity and active generation.
2. Wire that same authority into context evaluation and approval/commit validation through the existing Core proposal path; do not create another writer or proposal route.
3. Add production-entry-point/startup coverage proving the provider is present and correctly bound (and that absence/throwing/malformed identity fails closed).
4. Add real-source end-to-end tests for stable policy success and rotation/revocation after evaluation, before proposal creation, between proposal creation and approval, and between approval and commit; assert stale cases produce no canonical event.
5. State the revocation consistency guarantee honestly. An external callback check immediately before commit is not linearizable against a concurrent revocation unless the authority generation participates in the same canonical transaction or a reviewed equivalent.
6. Reconcile remaining statements against the exact reviewed head and run exact-head Runtime CI. The isolated recalculation oracle does not prove global dependency completeness or production executor readiness.

This clarification documents source provenance and current wiring only. It does not enable execution, approve a provider, expand the supported action subset, or claim that the required integration tests exist or pass.
