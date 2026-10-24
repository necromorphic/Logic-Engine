# NPC Causal Rollback and Reconciliation Test Matrix

Status: schema-neutral semantic/test design on `feat/npc-subsystem`. These cases are not executable tests and do not establish that the current core supports alternative causal sufficiency. They define what must be demonstrated at the real canonical production boundary before NPC knowledge or relationship reconciliation may rely on rollback.

Related contracts:
- `docs/18-rollback-and-causality.md` — broader target rollback contract; not proof of current implementation.
- `docs/21-stage1-causality-contract.md` — bounded implemented event rollback contract; inspect the exact target commit before relying on it.
- `docs/39-npc-core-knowledge-contract-proposal.md` — core-owned acquisition/provenance and source-validity reconciliation gate.
- `docs/44-npc-relationship-semantic-acceptance.md` and `docs/45-npc-relationship-typed-operation-design.md` — relationship-specific semantics and typed-operation gates.

## 1. Vocabulary and invariant

- **Required dependency:** the effect is valid only while a specified prerequisite remains valid.
- **Independent support:** a separate, valid causal path that is sufficient under the domain's approved rule, not merely another ID in a list.
- **Derived consequence:** a state/effect whose validity depends on upstream events or records.
- **Reconciliation:** recompute current validity and projections after invalidation while retaining historical audit.
- **Source added after rollback:** a new valid source is committed after an earlier rollback/reconciliation has already completed. It must be evaluated against the then-current world; it must not resurrect invalid history implicitly.

The current `caused_by` / `depends_on` fields must not be interpreted as “any one parent is enough.” No generic OR-support algorithm is specified here. If the canonical model cannot establish dependency semantics, independent sufficiency, and deterministic replay, the affected commit/reconciliation remains unsupported.

## 2. Required scenario matrix

### NPC-CAUSE-001 — Required cause is invalidated

**Given** a committed effect E requires cause C, and no alternative-support rule is declared.

**When** C is invalidated through the canonical rollback path.

**Then**
- E is invalidated or recomputed according to the canonical dependency contract.
- Effects dependent only on E are reconciled transitively.
- Historical audit remains available; current projections do not present the invalid branch as valid.
- The system does not preserve E merely because its record still exists in history.

**Required evidence:** actual canonical rollback/replay path, current projection before/after, retained audit, revision/commit markers.

### NPC-CAUSE-002 — One of two independently sufficient supports is invalidated

**Given** proposition P has support S1 and S2; the approved domain rule explicitly states each support independently suffices; both are valid before rollback.

**When** S1 is invalidated.

**Then**
- S1 no longer contributes valid support.
- P remains valid only if S2 is independently verified as valid and sufficient.
- Dependent state is reconciled from the surviving valid support.
- If the core cannot prove S2's independent sufficiency, the result is blocked/unsupported, not guessed.

**Required evidence:** typed support semantics or deterministic replay contract plus production-path tests. A pair of parent IDs alone is insufficient.

### NPC-CAUSE-003 — All support is invalidated

**Given** P is supported by S1 and S2 under an approved alternative-support rule.

**When** both supports become invalid.

**Then**
- P is invalidated or recomputed as unsupported.
- Derived consequences depending solely on P are reconciled transitively.
- No stale card, cached projection, or NPC context may continue treating P as established.
- Audit records the invalidations without deleting historical evidence.

**Required evidence:** production rollback plus projection/context refresh, not just an isolated reducer test.

### NPC-CAUSE-004 — A new valid source arrives after the first rollback

**Given**
- P was supported by S1 and S2.
- S1 is invalidated and rollback/reconciliation completes.
- The current state is now correctly supported by S2, or P is unsupported if no support survives.
- Only after that completed reconciliation, a new independent source S3 is committed through an authorized canonical path.

**When** reconciliation runs for S3.

**Then**
- S3 is evaluated as a new source against the current canonical revision/commit sequence.
- If S2 still supports P, S3 is added as further valid provenance without replaying S1 as valid.
- If P had become unsupported, P may become supported again only because S3 independently establishes it under the approved rule.
- S3 must not restore consequences whose own prerequisites remain invalid; each dependent consequence is re-evaluated against its own dependency/sufficiency rules.
- Duplicate processing of S3 is idempotent and does not duplicate effects or audit commits.
- A stale reconciliation based on the pre-rollback snapshot is rejected or retried against a fresh snapshot.

**Required evidence:** a multi-step production test with separate commits/markers for rollback and S3, state assertions after each step, duplicate delivery/retry, and stale-snapshot handling. This scenario must not be replaced by a single batch test that hides ordering.

### NPC-CAUSE-005 — Repeated or duplicated source is not independent support

**Given** S1 is delivered twice, copied into two notes, or referenced by two records that share the same causal origin.

**When** support is evaluated and one underlying source is invalidated.

**Then**
- Duplicates do not count as independent causes merely because they have different record IDs or appear in separate retrieval results.
- Provenance/dependency identity is resolved by the canonical source contract.
- If independence cannot be established, the system does not claim redundant support.

**Required evidence:** canonical provenance identity and deduplication rules. Text similarity or record count is not sufficient.

### NPC-CAUSE-006 — A downstream effect has an additional required dependency

**Given** P has valid independent support S2, but downstream effect D also requires condition Q; Q is invalidated.

**When** S1 is rolled back while S2 survives and Q is invalid.

**Then**
- P may remain valid because S2 still supports it.
- D is still invalidated/recomputed because its own required dependency Q is absent.
- Surviving support for P must not override an unrelated required dependency of D.

**Required evidence:** separate assertions for P and D; no blanket “branch survives” or “branch disappears” behavior.

### NPC-CAUSE-007 — Knowledge source invalidation is not retroactive erasure of experience

**Given** an NPC acquired proposition P through source S1 and later performed an independently committed action based on what it believed, and S1 is subsequently invalidated.

**When** acquisition and dependent consequences are reconciled.

**Then**
- The validity of the acquisition record is reconciled according to the core-owned knowledge contract.
- The system does not automatically rewrite past dialogue or erase a committed action merely because the source is invalidated.
- Any belief revision, memory correction, or dependent-world consequence follows an explicit supported rule; it is not inferred from canonical truth alone.
- The distinction between “the source is no longer valid” and “the NPC never experienced it” is preserved.

**Required evidence:** core-owned acquisition/belief semantics and canonical event dependencies. Until those exist, this remains a blocked semantic case.

### NPC-CAUSE-008 — Rollback/replay is deterministic and snapshot-safe

**Given** the same valid canonical event set and approved domain rules, including a completed rollback and later source addition.

**When** projections are rebuilt from that valid set more than once.

**Then**
- The current projection matches deterministic replay of the same valid inputs.
- Historical audit remains append-only and revisions/commit markers follow the core contract; rollback does not rewind the revision.
- No mixed-snapshot result is committed.
- Repeating reconciliation does not duplicate effects, source support, or audit commits.
- Actor-specific reads after reconciliation use a fresh, authorized snapshot and do not fall back to raw state.

**Required evidence:** real canonical replay/rollback, revision and audit assertions, idempotency, stale snapshot rejection, and the actual authorized consumer boundary.

## 3. NPC knowledge and relationship implications

These cases are shared causal requirements, not permission to add NPC-local causal state.

- Knowledge survives source invalidation only to the extent the core-owned acquisition contract can prove another valid, sufficient source.
- A relationship conclusion survives only where the approved relationship-domain rule says the remaining support suffices. Generic fact/event rollback does not automatically supply this rule.
- A later source may support a proposition anew, but it does not retroactively validate an invalidated source or automatically restore every downstream effect.
- Current card summaries are projections, not proof of source validity. After reconciliation, a summary must be refreshed or marked stale through the approved versioning mechanism.
- A relationship, belief, or card entry must not be treated as evidence of the cause that supposedly supports it.

## 4. Implementation gate and test report requirements

For each case, an eventual production-path test report must record:
1. Exact target commit and real production interfaces exercised.
2. Canonical state and relevant acquisition/relationship projection before the first operation.
3. Source/event IDs, provenance, dependency semantics, and snapshot markers.
4. State after each individual commit, rollback, and reconciliation step.
5. Historical audit and revision/commit-sequence effects.
6. Results of duplicate retry and stale-snapshot attempt where relevant.
7. The actual actor-authorized context/card output after reconciliation.
8. Whether the behavior passed, failed, or remains unsupported; do not classify absent interfaces as test failures that a mock can fix.

Do not add a second causal graph, NPC-specific rollback journal, local revision counter, or shadow knowledge store. Do not claim these cases pass based on prompt rules, documentation checks, or mocked missing production interfaces.

**Current status:** all NPC-CAUSE cases are semantic acceptance targets. NPC-CAUSE-002–005 require explicit causal sufficiency/provenance behavior and real tests; knowledge reconciliation in NPC-CAUSE-007 additionally requires the core-owned acquisition/belief path. No runtime capability is asserted by this document.
