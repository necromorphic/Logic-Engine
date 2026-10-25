# NPC knowledge-state semantics (proposal; no runtime contract)

**Status:** NPC-owned conceptual specification for review. This document does not define a runtime API, persisted schema, database, event bus, or cross-block contract. It does not claim these transitions are implemented.

**Scope:** Clarify the meaning and ordering of information exposure, acquisition, belief, doubt, forgetting, revision, and observable behavior. Any shared state or persistence implementation requires review by Core, Personality, Relationships, Memory Provider, and Host/UI owners as applicable.

## Non-equivalent states

| Concept | Meaning | Does not establish |
|---|---|---|
| Observed / exposed | An authoritative event indicates that the character perceived or was exposed to a specific event or statement. | That the character understood, retained, or believed it. |
| Received | A supported host/source signal says information reached the intended character boundary. | That it was incorporated into knowledge or belief. |
| Acquired | A character-relative decision records information as learned from eligible evidence. | That the information is true or believed. |
| Belief | The character's current stance toward a proposition, with uncertainty where appropriate. | Source authorization or canonical truth. |
| Doubt | The character has reason to reduce confidence, suspend judgment, or reconsider a proposition. | That the proposition is false or its source is unauthorized. |
| Contradiction | Two or more claims/evidence items conflict under an explicit comparison. | Which claim wins, or that either source should be deleted. |
| Forgotten / inaccessible | The character cannot currently recall or use some previously acquired information under the relevant memory policy. | Source deletion, revocation, or loss of provenance. |
| Revised / retracted belief | The character's current stance changes after new evidence or reassessment. | That historical evidence or the prior stance never existed. |
| Observable behavior | The externally rendered action or dialogue selected from internal state under applicable disclosure rules. | A complete or literal representation of hidden motives, beliefs, or reasoning. |

## Conceptual transition sequence

These are semantic distinctions, not a mandated linear pipeline. A system may need to model skipped, failed, repeated, or competing events explicitly once the owning contracts exist.

1. **Exposure:** a source/host event establishes that information was available to the character. Prompt inclusion, retrieval, or a model-generated assertion alone is not reliable receipt evidence.
2. **Acquisition decision:** the system decides whether the character actually learned the information. The decision must be separate from retrieval and must retain provenance under an approved owner contract.
3. **Interpretation and belief revision:** acquired information is assessed against existing beliefs, prior evidence, contradictions, source reliability, and character-specific interpretation. Personality may influence interpretation but must not grant access to sources or alter source authority.
4. **Current belief stance:** the character may believe, disbelieve, doubt, suspend judgment, or have no settled view. Confidence is character-relative and must not be conflated with factual validity or access permission.
5. **Later reassessment:** new evidence, correction, contradiction, or changed context can alter the stance. Preserve distinctions between the source claim, the character's interpretation, and the current belief; do not silently rewrite provenance.
6. **Recall and forgetting:** reduced recall/accessibility is a character-memory behavior. It must not erase the authoritative source record or simulate deletion/revocation. A forgotten proposition may still exist in authoritative history, if policy permits.
7. **External expression:** action and dialogue are selected from internal state through an explicit output/disclosure boundary. Hidden motives, private belief state, and internal reasoning are not automatically exposed.

## Required invariants

- Exposure is not acquisition.
- Acquisition is not belief.
- Belief is not canonical truth.
- Confidence is not source authority or authorization.
- Contradiction does not automatically select a winner.
- A source becoming stale, deleted, or revoked is not a psychological forgetting event.
- Psychological forgetting does not revoke or delete an authoritative source.
- Revising a belief does not rewrite the historical source claim.
- Internal state is not equivalent to externally observable behavior.
- Memory candidate admission never creates receipt, acquisition, or belief.
- No NPC-only helper may infer downstream lifecycle states from admission, context inclusion, generation, or rendered text.

## Evidence and provenance separation

A future implementation should keep these questions distinct, without assuming a particular schema:

- **Source authority:** who/what is permitted to establish or revise the authoritative record and its version?
- **Evidence provenance:** which source/version supports a claim, and what is known about its currentness and authorization?
- **Character interpretation:** what did this character infer from the evidence, with what uncertainty?
- **Character belief:** what stance does the character currently hold, and why?
- **Behavioral expression:** what is safe and appropriate to expose through dialogue/action?

A character may sincerely believe a false claim; a canonical record may be true without a character knowing it; authorized evidence may be doubted; and an unauthorized/revoked source must not become usable merely because a character strongly believes it. The implementation must preserve these distinctions.

## Failure and conflict handling

- **Missing/ambiguous exposure evidence:** do not claim receipt or acquisition.
- **Unavailable source or uncertain authorization:** fail closed for source disclosure; do not convert an access failure into a belief update.
- **Conflicting claims:** preserve provenance and represent unresolved conflict; resolution policy is a separate decision.
- **Insufficient evidence:** allow uncertainty or suspension of judgment rather than forced certainty.
- **Source revocation/deletion:** enforce the source owner's policy at access/disclosure boundaries and invalidate dependent copies according to the approved cross-block contract; do not model revocation as forgetting.
- **Character forgetting:** affect character recall/use only according to an approved NPC memory policy; do not delete source lineage.
- **Unknown state or transition:** do not silently coerce it to a positive state.

## Ownership and implementation gate

This proposal is NPC-owned semantic guidance only. It does not introduce shared fields, enum values, storage, or APIs. Before implementation:

- Core must approve authoritative event/state transitions, persistence/idempotency, and any canonical truth or disclosure semantics.
- Personality must approve how stable traits and temporary state influence interpretation without changing evidence authority.
- Relationships must approve any relationship updates caused by events or belief changes.
- Memory Provider must approve provenance, source version, lineage, revocation, and derived-copy behavior.
- Host/UI must define what counts as actual exposure, receipt, rendering, and user/character-facing disclosure.

Until those boundaries are approved, do not represent these semantics as implemented runtime behavior. Production Memory→NPC remains DISABLED / FAIL-CLOSED under issue #317.
