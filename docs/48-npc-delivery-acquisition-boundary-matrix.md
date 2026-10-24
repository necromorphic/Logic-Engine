# NPC Delivery, Receipt, and Acquisition Boundary Matrix

Status: schema-neutral semantic acceptance design on `feat/npc-subsystem`. These cases are not executable tests and do not claim a delivery, acquisition, or belief runtime exists. They define evidence thresholds for future core-owned behavior.

Related contracts:
- `docs/39-npc-core-knowledge-contract-proposal.md` — ownership, acquisition, delivery, belief, actor/purpose filter, and core review gates.
- `docs/46-npc-authoring-correction-and-card-summary-contract.md` — context/card summaries are not acquisition records.
- `docs/47-npc-causal-rollback-reconciliation-test-matrix.md` — source invalidation and later-source reconciliation.
- `docs/35-npc-test-boundary-map.md` — production-boundary gate map.

## 1. State distinctions that must survive the full path

A future implementation must not collapse these separate questions:

1. Was a message or payload prepared?
2. Was a delivery attempt made?
3. Did the host accept the payload?
4. Is there reliable evidence that the target actually saw it?
5. Did the target acknowledge receipt?
6. Did the target comprehend the content?
7. Was an acquisition record created for the target through an approved path?
8. What stance does the target hold toward the content?
9. Is the content objectively true in canonical world state?

Each step requires its own evidence. A later step must not be inferred from an earlier one. A host injection acknowledgement does not prove visible rendering; visible rendering does not prove comprehension; comprehension does not prove belief; belief does not establish canonical truth.

## 2. Acceptance cases

### NPC-DELIV-001 — Context inclusion is not delivery

**Given** proposition P is included in an NPC model request or retrieval result, with no in-world communication event or supported host-delivery evidence.

**When** the context request completes.

**Then**
- No in-world delivery, receipt, acquisition, or belief change is inferred from inclusion alone.
- The context/generation reference may be retained for audit if the real host supports it, but it is not converted into a knowledge source.
- Repeating the context request does not accumulate knowledge.

**Required evidence:** inspect the actual adapter/model input and core acquisition/delivery state before and after; no prompt-only assertion.

### NPC-DELIV-002 — Attempted delivery that fails

**Given** a message is addressed to target T through channel C and the delivery attempt fails with supported failure evidence.

**When** the attempt is recorded.

**Then**
- The attempt/failure may be recorded if the core has an authorized delivery record path.
- T is not marked as informed, and no acquisition or belief update is created solely from the failed attempt.
- Retry remains a distinct attempt or an idempotent retry according to the approved operation contract; it must not create duplicate successful acquisitions.

**Required evidence:** real host/channel failure signal and core record/projection assertions.

### NPC-DELIV-003 — Host accepted injection, visibility unconfirmed

**Given** the host accepts a payload for injection but provides no verified signal that it was rendered visibly to T.

**When** the host acceptance is received.

**Then**
- Status may be `injected_unconfirmed` or another explicitly approved equivalent.
- Status must not be upgraded to `shown`, acknowledged, comprehended, acquired, or believed.
- Missing visibility evidence is represented as unconfirmed/unsupported, not success by assumption.

**Required evidence:** actual host adapter contract and verified delivery signal; a successful HTTP/API return alone is insufficient unless the host contract explicitly guarantees the relevant stage.

### NPC-DELIV-004 — Visible rendering does not prove comprehension

**Given** the host provides reliable evidence that a message was rendered to T, but there is no acknowledgement or comprehension signal.

**When** delivery status is reconciled.

**Then**
- The system may record the exact supported visibility status.
- It must not infer acknowledgement, comprehension, acquisition, or belief.
- A later NPC decision may use the message as acquired information only if a separately approved acquisition rule is satisfied by evidence available to the core.

**Required evidence:** distinct status assertions at the actual delivery boundary.

### NPC-DELIV-005 — Acknowledgement does not prove belief

**Given** T explicitly acknowledges receiving message M, but M's content is false or disputed in canonical state.

**When** receipt and acquisition are recorded under an approved communication path.

**Then**
- Receipt evidence remains attributed to T and M.
- The content is represented as a received claim/report, not silently promoted to canonical truth.
- T's belief stance remains separate: acknowledgement alone does not mean acceptance or belief.
- Another actor's receipt or belief is not inferred from T's acknowledgement.

**Required evidence:** separate delivery/receipt, acquisition/report, belief, and canonical-truth assertions.

### NPC-DELIV-006 — False report can be acquired as a report

**Given** source S tells T that proposition P is true, while canonical world state establishes P as false, and the approved channel evidence shows that T received the report.

**When** the acquisition path records the received content.

**Then**
- T may acquire the proposition that “S reported P” or a source-attributed claim P, according to the approved representation.
- The system must not convert the report into canonical P.
- The source and report status remain traceable so later correction or source invalidation can be reconciled without rewriting the fact that a report was received.
- T's belief in P remains unknown unless a real core-owned belief state says otherwise.

**Required evidence:** canonical truth and subject-relative report/acquisition records shown independently.

### NPC-DELIV-007 — Two targets are isolated

**Given** a message is delivered to T1 with supported evidence, while T2 is not a recipient or has no evidence of receipt.

**When** actor-relative decision context is prepared for T1 and T2.

**Then**
- Only T1 may receive the corresponding acquisition context, and only within the approved evidence/authorization rule.
- T2 remains unknown/uninformed unless another valid source independently supports acquisition.
- Shared location, relationship, party membership, or the fact that both characters exist in the same scene does not imply receipt.
- The model input for each target is verified separately; no cross-target leakage is allowed.

**Required evidence:** two trusted actor bindings, two filtered model-input captures, and separate acquisition state.

### NPC-DELIV-008 — Duplicate delivery/retry is idempotent

**Given** one logical message is retried or the same delivery receipt is processed more than once.

**When** the host callback or reconciliation is repeated.

**Then**
- Duplicate callbacks do not create duplicate acquisitions, repeated belief updates, or duplicate canonical consequences.
- Distinct genuine delivery attempts remain distinguishable in audit when the approved contract requires it.
- Idempotency is based on a trusted operation/message identity, not matching message text alone.

**Required evidence:** real callback/retry path, stable operation identity, audit and state assertions.

### NPC-DELIV-009 — Source invalidation does not erase the receipt event

**Given** T received a report through a valid delivery path, and the underlying source claim is later invalidated.

**When** source reconciliation runs.

**Then**
- The validity of the source claim and the historical fact that T received a report remain distinct.
- Any acquisition that depends on the invalidated source is reconciled under the core-owned acquisition rules.
- The system does not silently erase the communication history or rewrite prior dialogue/actions; dependent effects are re-evaluated only through explicit causal rules.
- An independent valid source may support the same proposition only under the approved sufficiency rule; it does not make the invalidated report true retroactively.

**Required evidence:** separate source invalidation and delivery/acquisition history, with state snapshots between operations.

### NPC-DELIV-010 — No supported signal means no invented success state

**Given** the adapter has no reliable signal for visible rendering, receipt, acknowledgement, or comprehension.

**When** the system prepares its result or NPC decision context.

**Then**
- Unsupported stages remain unsupported/unconfirmed.
- No synthetic `shown`, receipt, comprehension, acquisition, or belief record is created from a best-effort guess.
- The consumer receives a safe incomplete/unsupported result where that uncertainty affects the decision.
- The implementation does not infer success from absence of an error.

**Required evidence:** actual adapter capability inventory and end-to-end status projection.

## 3. Test sequence for the first future delivery-capable slice

When a supported delivery path is eventually implemented, test each transition as a separate step and record the canonical revision/commit marker where applicable:

1. Prepare payload; assert no delivery/acquisition/belief mutation.
2. Attempt delivery with a controlled host result; assert only the supported attempt state.
3. Process the real host receipt/rendering signal, if one exists; assert exactly that stage and no stronger stage.
4. Prepare actor-specific context for the intended recipient and a non-recipient; capture the actual model inputs.
5. If the approved acquisition path is satisfied, assert a target-specific acquisition record and provenance.
6. Assert belief and canonical truth remain independent.
7. Retry the same operation/callback and verify idempotency.
8. Invalidate the underlying source and reconcile; assert the receipt history and source validity are not conflated.
9. Verify no read, context inclusion, or proposal creation changed world revision, commit sequence, acquisition, belief, or delivery state.

If any required interface or host signal is absent, mark that case **blocked/unsupported** rather than substituting a mock as proof of production behavior.

## 4. Ownership and implementation gate

- Delivery attempts, receipt status, and acquisition/provenance are core-owned records, as specified by the core review outcome in `docs/39`.
- Host-specific evidence must be established at the real adapter boundary. The NPC branch must not infer rendering from injection or create local delivery/receipt persistence.
- Belief state remains a separate core-owned simulation state; receipt or acquisition must not force belief.
- A card summary or prompt reference is a read projection, never proof of delivery or acquisition.
- No runtime/API/schema/storage work is authorized by this matrix. All NPC-DELIV cases are acceptance targets until core-owned records, trusted actor binding, the real host signal, pre-model filtering, and production-path tests exist.

**Current status:** no delivery-capable NPC runtime is claimed. Core review explicitly leaves `shown` unsupported until a real host signal is identified and verified.
