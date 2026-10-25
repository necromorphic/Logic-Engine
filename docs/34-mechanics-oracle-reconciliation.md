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
