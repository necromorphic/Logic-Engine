# NPC Epistemic Model — Stage 1 Contract Proposal

Status: Stage 1 semantic contract COMPLETE (documentation and owner-decision reconciliation only); not an implementation or authorization to enable Memory → NPC.

## 1. Purpose
Define the minimum distinctions an NPC cognition system must preserve between world truth, information available to a subject, the subject's beliefs, and unresolved evidence. This contract is intended for later acquisition, belief-revision, decision-context, planning, and social-reasoning stages.

## 2. Ownership
- Core owns canonical world state, canonical persisted records, revisions, event causality, authorization, and commit/rollback.
- A trusted acquisition/access path establishes whether a subject acquired information, from which source, and whether it remains valid and usable. The executable interface is not yet verified.
- NPC cognition interprets authorized inputs and may propose belief updates or decisions. It cannot certify its own provenance, grant itself access, rewrite canonical truth, or commit effects.
- Host/presentation delivers only authorized output; narrated text does not itself prove an in-world communication event.
- Personality/Relationships may influence interpretation and priorities through approved contracts, but cannot change evidence status merely by preference or relationship score.
- If an owner/source for a field cannot be verified, treat the field as unavailable. Do not create a parallel source of truth.

## 3. Required semantic states
These are semantic categories, not yet a database schema or public API.

| State | Meaning | Must not be confused with |
|---|---|---|
| Canonical truth | What authoritative world state currently supports | What a particular NPC knows |
| Subject-known true | Subject has valid, authorized evidence supporting P as true | Retrieval, prompt inclusion, model-generated explanation |
| Subject-known false | Subject has valid, authorized evidence supporting not-P | Missing information or lack of search results |
| Belief | Subject accepts P as a working representation, potentially incorrectly | Canonical truth |
| Suspicion / hypothesis | P is considered possible with unresolved support | Established knowledge |
| Contradiction | Admissible evidence supports incompatible propositions or interpretations | Permission to arbitrarily choose one |
| Unknown / incomplete | Available evidence/context does not settle P | False |
| Inaccessible / withheld | Information cannot be supplied for this actor/purpose | Non-existence or evidence against P |
| Retrieved candidate | Fragment found but not yet passed source, access, validity, and acquisition checks | Knowledge |
| Invalidated / retracted evidence | Source/acquisition is no longer valid under its governing rule | Automatic erasure of all downstream beliefs without trace |

Do not force every proposition into one exclusive label. Canonical truth may be not-P while an NPC believes P; a separate suspicion may remain unresolved. The model must support these distinctions simultaneously.

## 4. Evidence and belief record semantics
Any eventual persisted representation must be grounded in existing Core contracts and lifecycle. This section lists semantic requirements only.

An acquisition record must trace world and subject; proposition/source; permitted acquisition kind and provenance; source event/revision/snapshot when available; validity, visibility, permitted purpose; revocation/invalidation rule; and the Core-authorized assignment that makes it available to the subject.

A belief/hypothesis representation additionally needs a subject-relative proposition; status (belief, suspicion/hypothesis, unresolved conflict); supporting and conflicting evidence references; uncertainty semantics only if explicitly defined; and the revision/causal link explaining why the belief changed.

Do not introduce a numeric confidence score merely because it is convenient. If confidence is later required, define its scale, calibration meaning, source ownership, update rule, and behavior when sources are incomparable. Until then, preserve qualitative states and conflicting evidence.

The only acquisition kinds in the scoped first Core acquisition stage are author_initial and imported. Observation, conversation, documents, inference, and rumor remain out of scope until their trusted evidence paths are separately specified and tested.

## 5. Transition rules
1. **Candidate is not knowledge.** Retrieval or model output alone cannot transition a proposition into subject-known true/false. A trusted acquisition/authorization path must establish acquisition first.
2. **Truth does not auto-correct belief.** Canonical truth changing does not silently rewrite a subject's belief. The subject may remain mistaken until authorized corrective information becomes available and a belief-revision policy processes it.
3. **Missing is not false.** An absent field, failed lookup, incomplete snapshot, or lack of evidence yields unknown/incomplete unless an authoritative source explicitly establishes the negative proposition.
4. **Withheld is not false.** If access policy withholds a value, context must not expose it or imply that the actor has evidence for either side. Where existence of the hidden information is itself sensitive, use an approved non-disclosing representation.
5. **Conflicts remain visible.** When admissible evidence conflicts, preserve the conflict and sources. Do not resolve it using recency, relationship, personality, or model confidence unless an approved domain rule defines precedence.
6. **Belief updates need a trace.** A belief change identifies the admissible evidence/event and rule that motivated it. Generated rationale is diagnostic text, not provenance.
7. **Retraction follows explicit policy.** When a source is revoked or invalidated, affected acquisitions and beliefs must be handled through a traceable rule. Do not silently erase history or leave invalid data usable. Whether a derived belief is withdrawn, downgraded, or contested depends on surviving support and approved policy.
8. **No unsupported acquisition paths.** An NPC cannot claim it observed, heard, inferred, read, or was told something unless the corresponding trusted acquisition path exists. Those paths are not enabled by this proposal.
9. **Intention is not outcome.** A plan, intention, or proposal is not evidence that an action occurred, succeeded, or was communicated. Only authoritative result feedback can support outcome-dependent belief changes.
10. **Respect subject/world/snapshot boundaries.** Evidence for another world, subject, or incompatible snapshot cannot be silently reused. If compatibility cannot be established, mark it unavailable and fail closed for decisions that require it.

## 6. Reference transition table
| Input | Precondition | Permitted result | Forbidden result |
|---|---|---|---|
| Retrieved text with no verified acquisition | Source/access/provenance not established | Retrieved candidate or omission | Subject knowledge record |
| Core-authorized initial/imported acquisition | Trusted subject/world/source/provenance checks pass | Acquisition becomes eligible for authorized read | NPC self-assigned provenance |
| New evidence supports current belief | Evidence admissible and valid | Preserve belief; attach support | Change canonical truth |
| New evidence conflicts with belief | Evidence admissible and valid | Preserve conflict; mark revision candidate | Silent forced overwrite |
| Canonical truth changes without corrective acquisition | No corrective information delivered to subject | Truth changes; old belief may persist, marked stale according to policy | Auto-correct subject belief |
| Source revoked | Revocation is authoritative and linked | Mark evidence unusable; apply explicit derived-belief policy | Continue treating revoked source as valid |
| Context field absent | Missing/incomplete or no proof otherwise | Unknown/incomplete | Known false |
| Context field withheld | Access policy denies use | Omit value and avoid leakage | Send secret and ask model to ignore it |
| Action proposal returned | No authoritative commit/result | Proposal only | Success/acquisition/communication record |

## 7. Decision-context projection
When a future trusted caller constructs model-visible context, each relevant proposition must preserve the distinction between canonical truth (only if permitted for this actor/purpose), actor-relative knowledge/belief, hypothesis/suspicion, conflict, unknown/incomplete, withheld/inaccessible, and retrieved-but-not-admitted candidates (normally excluded from factual context).

The context must identify stale, incomplete, or invalidated evidence when safe and meaningful to disclose. It must not disclose withheld contents or use omission to imply a negative. This proposal defines no serialized schema or new endpoint; those must be mapped to existing Core/Host contracts before runtime work.

## 8. Acceptance scenarios
1. **False belief:** Core truth is not-P; subject believes P; no corrective evidence was acquired. Context keeps them distinct and does not silently correct P.
2. **Corrective information:** subject receives authorized evidence supporting not-P. A later belief transition references that evidence and the governing revision rule.
3. **Conflicting sources:** two valid sources disagree. Both remain traceable; no arbitrary winner is selected.
4. **Unsearched proposition:** no evidence is available. Result is unknown, not false.
5. **Withheld secret:** actor is not authorized to see P. The value is absent from model input and no acquisition is created.
6. **Untrusted retrieval:** search returns P with missing provenance. P is not admitted as knowledge.
7. **Revoked source:** source becomes invalid. It is no longer usable; dependent beliefs follow an explicit policy and remain auditable.
8. **Wrong subject/world:** acquisition assigned to a different subject/world is rejected for the current actor/world.
9. **Failed action:** NPC proposes action A but Core does not commit it. NPC cannot record A as successful.
10. **Replay/idempotency:** replaying the same authorized acquisition or belief transition does not duplicate semantic state or detach causal references.
11. **Partial context:** a required field was not loaded. It cannot be treated as a confirmed negative.
12. **Personality bias:** personality or relationship preference may affect interpretation/priority only within approved semantics; it cannot turn inadmissible evidence into knowledge or rewrite canonical truth.

## 9. Stage 1 exit gate
- Semantic owners and terms reviewed against current Core and Personality/Relationships contracts.
- States and transitions have unambiguous definitions.
- Uncertainty/confidence is explicitly specified or intentionally deferred.
- Conflict, invalidation, stale evidence, and world/subject boundaries have testable rules.
- Acceptance scenarios map to tests or are explicitly blocked on a Core interface.
- No runtime schema/API/store is introduced by the semantic proposal alone.
- Memory → NPC remains DISABLED / FAIL-CLOSED.

## 10. Contract reconciliation and Stage 1 decisions

Reviewed against the current Core contracts and the recorded author/core-owner decisions in:
- `docs/07-knowledge-and-narrative-boundaries.md` — truth, subject-relative knowledge, narrative delivery and retrieval are separate; missing/withheld are not false; source invalidation must preserve independent support.
- `docs/31-npc-subsystem-contract.md` and `docs/38-npc-author-decisions-and-semantic-delta.md` — NPCs may retain false beliefs, reason differently from the same evidence, forget or doubt, and act on mistaken beliefs only through normal Core validation/commit.
- `docs/39-npc-core-knowledge-contract-proposal.md` §10 and §§13–16 — Core owns acquisition/provenance, delivery status, reconciliation and persistent subject-relative belief; acquisition does not force belief; belief does not establish acquisition or truth.
- `docs/43-core-npc-knowledge-runtime-implementation-plan.md`, `docs/49-npc-core-knowledge-live-audit.md`, `docs/50-npc-initial-knowledge-acquisition-contract.md`, and `docs/51-npc-acquisition-source-reconciliation.md` — the real acquisition and actor/purpose/snapshot-filter interfaces remain absent or unverified; the first supported acquisition kinds are only `author_initial` and `imported`.
- `docs/32-npc-semantic-acceptance-matrix.md` and `docs/35-npc-test-boundary-map.md` — semantic scenarios already have a repository acceptance/test-traceability home; actual production-boundary tests remain dependent on missing Core interfaces.

### Decisions resolved for the semantic model

1. **Acquisition is not belief and does not prove objective truth.** An authorized acquisition establishes only that a subject was assigned/acquired a claim or source through an approved path. It must not automatically become `known_true`, `known_false`, or an accepted belief. Keep “acquired claim/source”, current belief stance, and canonical truth separate. The first Core acquisition slice does not implement persistent belief transitions.
2. **Stale evidence does not silently rewrite belief.** Mark the evidence/acquisition stale or unusable under its governing Core rule. Preserve the subject's existing belief as a separate state; a later revision/reconsideration requires an explicit policy and traceable evidence. Do not auto-downgrade or auto-correct a belief merely because canonical truth changed.
3. **Forgetting is allowed, but no implicit expiry exists.** The author-confirmed semantic target permits forgetting/loss of detail and changing beliefs. There is no default time-to-live, wall-clock expiry, or automatic forgetting rule. Any forgetting/expiry mechanism requires an explicit policy, causal/audit treatment, and later-stage acceptance tests.
4. **Revocation invalidates evidence support, not history by fiat.** Stop using the revoked source. Reconcile acquisition support against remaining independently valid sources. Preserve independent valid support. If no valid support remains, mark the derived support invalid/unsupported or contested according to the applicable record semantics; do not silently delete acquisition history or force the character's belief to change without a separate belief-revision transition.
5. **No numeric confidence scale in Stage 1.** Preserve qualitative states, provenance and conflicting evidence. Numeric confidence is deferred until its scale, meaning, owner, calibration and update rules are explicitly approved. Personality and relationships may affect interpretation and priorities, not evidence admissibility or canonical truth.
6. **The concrete Core representation remains a later implementation decision.** Reuse existing Core identity, snapshot and lifecycle contracts; do not introduce an NPC-local store, event log, revision counter, causal graph or rollback path. Current source audits do not establish a complete acquisition/belief record or actor/purpose/snapshot-bound safe read. This is an implementation blocker for later stages, not a reason to leave Stage 1 semantics undefined.

### Acceptance mapping and scope boundary

The twelve scenarios in §8 are semantic acceptance requirements. Their existing repository traceability is through the NPC semantic acceptance matrix and test-boundary map; production-path execution is blocked wherever the required Core interface is absent. In particular, actor isolation, acquisition provenance, revocation/replay, safe pre-model filtering, and persistent belief transitions must not be marked as runtime-tested on the strength of documentation or mocks.

Stage 1 is complete as a **semantic contract and decision record only**. It does not claim that acquisition, persistent beliefs, Memory retrieval, actor-relative reads, or NPC dispatch are implemented. Memory → NPC remains **DISABLED / FAIL-CLOSED**. No runtime schema, API, storage, prompt, vectorization or dispatch changes are authorized by this document.