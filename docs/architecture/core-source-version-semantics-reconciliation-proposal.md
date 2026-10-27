# Core decision proposal: canonical source-version semantics

**Status:** draft for review; no runtime change and no production authorization.  
**Owner:** Core. **Related:** Issue #140; PRs #509 and #521; `docs/architecture/core-source-authority-audit.md`; `docs/architecture/core-restore-resistant-accepted-head-contract.md`.

## Why this proposal exists

The repository currently contains two different source-version contracts:

1. The current-main Core audit records the narrow approved mapping for `canonical_entity`: Provider `source_version` is the canonical decimal encoding of the entity projection's `updated_revision`, validated by reading the exact entity from the exact world.
2. The open draft implementation in PR #509/#521 uses a durable per-entity monotonic source-version ledger and opaque `core-entity-v1:N` tokens. A resolved rollback advances the token even when rebuilding the projection restores earlier visible content.

These are not interchangeable representations. Treating them as one contract without an explicit decision risks a consumer validating a projection revision where the system expects a monotonic validity generation, or accepting a token that has been re-used after rollback.

## Core invariant that must hold

For a protected canonical entity source, a previously issued source token must never become current again solely because a rollback restores old visible content. A source token is provenance/freshness metadata; it is not permission to disclose content.

Therefore the final contract must answer, explicitly:

- What exact value issues the token?
- Does a resolved rollback always invalidate the prior token for every affected entity, including deletion/restoration and validity-only changes?
- Can the token be reconstructed from the current projection, or must it come from a durable monotonic ledger?
- Which exact comparison does Provider perform, and how does it obtain the value from Core rather than asserting it?
- What is the migration baseline for pre-existing entities?
- What happens on missing/corrupt ledger state, integer exhaustion, failed read, authority mismatch, or uncertain restore?

## Options to review

### Option A — projection revision token

Use the existing entity `updated_revision` as the source token, following the currently recorded Issue #140 mapping. This is simpler, but it is acceptable only if exact-head tests prove that rollback/rebuild can never make a previously invalidated token current again. The test must compare actual tokens before mutation, after mutation, and after rollback—not just compare world cursors or visible attributes.

### Option B — monotonic Core-issued source generation

Use a Core-owned per-entity monotonic generation, persisted atomically with canonical mutations and advanced for all affected entities during resolved rollback. Consumers treat the token as opaque and obtain it from Core readback. This better expresses rollback invalidation, but it changes the representation recorded in the current-main audit and must be explicitly reconciled with the prior approval before merge.

This proposal does not choose a storage vendor, network API, extra outbox, or independent accepted-head implementation.

## Required executable evidence before the contract is considered settled

1. **Create/update/upsert/delete:** each relevant committed mutation invalidates the prior token for the affected entity; unrelated entities keep their token.
2. **Rollback update:** R1 → R2 → rollback R2 restores R1's visible projection but does not make R2's token current or revive an invalidated token.
3. **Rollback deletion/restoration:** deleting and rolling back a deletion cannot revive the token from before deletion.
4. **Validity-only rollback:** if canonical validity changes without a new commit sequence, source validation still rejects the stale token.
5. **Atomicity:** injected failure leaves neither canonical mutation nor source token half-committed.
6. **Migration:** pre-existing entities receive a documented baseline; missing or malformed version state does not silently reset to a lower generation.
7. **Restart versus restore:** ordinary process restart preserves accepted currentness; restoring an old full Core database is tested separately and is not claimed safe without independent accepted-head comparison.
8. **Provider comparison:** use real Core-issued tokens and the real validator, not fixture strings or caller-supplied “current” booleans.
9. **Snapshot race:** a mutation during paged inventory reconciliation cannot publish a mixed-generation READY result.
10. **Fail-closed behavior:** unavailable, malformed, stale, or conflicting source readback yields NON_READY and no protected disclosure.

## Separate trust boundary — not solved by source versions

Even a correct monotonic source token does not prove:

- that the Host supplied a complete inventory of current, historical, edited, deleted, swiped, regenerated, and tombstoned messages;
- that a restored Core + Provider backup pair is newer than the independently accepted state;
- that authorization is checked at the final model-request serialization/dispatch boundary;
- that revocation winning before dispatch-start causes zero outbound transport calls.

Those remain separate acceptance gates. Source-version correctness must not be used to mark Host inventory, restore resistance, or final dispatch as READY.

## Proposed review disposition

- Reconcile the existing Issue #140 approval with the PR #509/#521 monotonic-ledger candidate before merging either contract as the definitive source-version rule.
- If the monotonic ledger is selected, update the audit and downstream contract references together and preserve the exact source-token semantics in tests.
- If the projection revision is retained, demonstrate rollback non-revival with executable tests before asserting that it satisfies the invariant.
- Keep Memory→NPC `DISABLED / FAIL-CLOSED` until the independent accepted-head, Host completeness, and final-dispatch gates are separately proven.

No runtime code, schema, public API, or production wiring is changed by this document.
