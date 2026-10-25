# 56. Context-aware interpretation of communicative intent

**Status:** Core-owned architecture proposal; documentation only. No runtime implementation, schema, API, storage, or prompt wiring is implied.  
**Owner:** Core.  
**Related:** issue #260; Core authorized-read, knowledge/provenance, Personality, Relationships, NPC and Memory contracts.

## 1. Purpose and boundary

The language model remains the primary interpreter of natural language, social nuance, subtext, and narrative context. This subsystem does not replace the LLM with a deterministic classifier. It defines how the engine represents, checks, preserves, exposes, revises, and invalidates interpretations so separate modules do not silently turn a plausible reading into canonical truth.

The subsystem may help the LLM consider candidate readings, evidence for and against them, contextual alternatives, and uncertainty. The LLM can propose an interpretation; Core enforces provenance, epistemic status, source validity, authorization, and state-transition rules. Domain-specific meanings can be supplied by a World Pack. The core taxonomy is extensible and is not an exhaustive universal list.

## 2. Semantic separation

These concepts must remain distinct:

- **Utterance/source:** the exact message or observable behavior being interpreted, with source identity and revision/version when the host can prove them.
- **Candidate interpretation:** one possible reading, such as flirtation, joking, sarcasm, threat, manipulation, reassurance, insult, evasion, literal request, or ambiguity.
- **Evidence:** context that supports or weakens a candidate, including speaker/listener relationship, preceding turns, observed events, known speech patterns, and relevant world-pack rules. Evidence must cite sources; a model-generated explanation is not independent confirmation.
- **Interpretation record:** a versioned, revisable assessment with epistemic status and provenance.
- **Canonical fact:** an accepted world-state claim established through the engine's existing validation/commit rules. An interpretation is not automatically a fact.
- **Belief/knowledge:** what a particular character believes or knows. An NPC may misunderstand an utterance; the subsystem must not force every character to share the model's best interpretation.
- **Action/relationship/consent:** downstream decisions with their own rules. An interpretation alone does not authorize an action or mutate a relationship.

## 3. Epistemic lifecycle

Use these semantic states in the design; they are not approved runtime enum names:

1. **Candidate** — a possible reading proposed by the LLM or a domain rule; not yet accepted for downstream use.
2. **Assessed** — candidates and evidence have been checked for source validity, scope, alternatives, and uncertainty. This still does not mean the speaker's true intent is known.
3. **Context-usable** — allowed for a specific consumer and purpose under Core's access policy; it may be supplied as a hypothesis with uncertainty.
4. **Confirmed** — supported by an explicit, authoritative source appropriate to the claim (for example, an unambiguous direct clarification by the speaker, if the world/interaction rules treat it as authoritative). Confirmation is scoped to what was actually confirmed; it must not overreach.
5. **Disputed** — competing readings remain plausible or credible sources conflict.
6. **Stale / invalidated / revoked** — source text, relevant context, authority, or provenance changed or was withdrawn. The old record remains in history but cannot be used as current without reassessment.

“Assessed” and “confirmed” are not synonyms. Confidence is not authority. A high-confidence model guess is still a guess.

## 4. Interpretation result requirements

Any future persisted/consumed interpretation must be traceable to:

- the source utterance/behavior and its exact revision/version, where durable identity is proven;
- the context sources actually used, with provenance and validity;
- the candidate reading and meaningful alternatives considered;
- evidence supporting and contradicting each material candidate;
- uncertainty/ambiguity and the reason for the current epistemic state;
- interpreter origin (LLM proposal, explicit user/speaker clarification, or named World Pack rule) without treating a caller-supplied label as authentication;
- the consumer/purpose for which it is exposed;
- the revision/reassessment relationship to previous interpretations.

This is a semantic checklist, not a prescribed field list or schema. If source identity/version cannot be verified, the result is source-unverifiable and must not be represented as durably grounded.

## 5. Uncertainty and conflicting interpretations

- One utterance may have multiple simultaneous functions. “I’ll get you for that 😉” could be playful banter, a threat, or both depending on history, power, delivery, and consequences.
- Flirtation does not imply consent, attraction does not imply permission, and joking tone does not automatically neutralize a threat.
- A character's stated intent, a listener's interpretation, the model's assessment, and the canonical outcome can disagree. Preserve those as distinct claims.
- Do not force a single winner when evidence is insufficient. Keep alternatives and mark the result ambiguous/disputed.
- Do not invent numerical precision. If confidence is represented later, its scale and calibration must be explicitly defined and tested; a number alone is not a validity proof.
- Speech patterns and stable personality traits can influence interpretation but must not override the current utterance, context, or explicit contrary evidence. Stable traits, temporary state, acquired experience, and current belief remain separate inputs.
- World Pack rules may extend categories or specify conventions, but cannot bypass provenance, authorization, uncertainty, player agency, or source invalidation.

## 6. Revision, deletion, and causal invalidation

Interpretations are derived assessments, not immutable truth. If the source message is edited, a swipe/revision becomes inactive, a message is deleted, context is retracted, a branch is restored, or a supporting event is rolled back:

1. mark dependent interpretations stale/invalid for current use;
2. preserve prior interpretation history and its original provenance for audit;
3. reassess against the currently valid source/context set;
4. keep previous NPC beliefs or actions distinct from the current interpretation—belief changes and action consequences require their own causal rules;
5. if dependency cannot be established, source identity is ambiguous, or revalidation is unavailable, fail closed for source-dependent disclosure/use.

Do not claim this lifecycle is implemented merely because Memory has an archive or vector index. Retrieval is not validity; indexing is not authority.

## 7. Consumer contract boundaries

- **Core:** governs source validity, provenance, epistemic transitions, access policy, and audit. It does not decide every nuance by hard-coded universal rules.
- **LLM/narrative layer:** proposes interpretations and uses approved context to formulate a contextual reading. It must be allowed to say “unclear.”
- **NPC:** may act on its own interpretation/belief under its decision rules, not on another NPC's private interpretation unless a valid communication path exists.
- **Personality:** may influence how a character speaks, notices cues, and revises an interpretation; it does not convert a trait into proof of another person's intent.
- **Relationships:** receives validated event/evidence candidates through its own contract. A flirt/threat interpretation alone does not directly commit a relationship change.
- **Memory Provider:** may archive/retrieve interpretation history only under its approved source and authorization contract. It must not promote an interpretation to canonical fact or treat retrieval as authorization.
- **Host/Adapter:** supplies source lifecycle and identity evidence. It must not claim a source version is durable if the pinned host runtime has not demonstrated it.
- **Player agency:** no subsystem infers or writes the player's voluntary action, private thought, consent, or emotional state merely because a model found it narratively plausible.

## 8. Examples

### Ambiguous banter

A character says: “Careful. I might start thinking you like me.”

Possible candidates: flirtation, teasing, boundary-testing, or sarcasm. The system checks the local exchange, relationship history, speaker style, and contrary evidence. Unless the speaker explicitly clarifies and that clarification is authoritative in context, the result remains an assessed hypothesis—not a fact that the speaker is attracted, and never consent.

### Threat framed as a joke

A character laughs while saying: “Touch my people again and I'll bury you.” Candidate readings may include a real threat delivered jokingly, intimidation, theatrical banter, or a mixed act. “Joking” must not automatically erase the threat candidate. The actual action/outcome is decided by simulation and causal evidence, not by the label alone.

### Contradictory clarification

Earlier context supports “playful teasing”; the speaker later says “I meant that as a warning.” Preserve the earlier interpretation and its provenance, append/revise the current assessment, and scope confirmation to the speaker's clarification. Do not rewrite history as if the earlier ambiguity never existed.

### Source edit

A message originally read “I will help you” but is edited to “I will not help you.” The prior interpretation becomes stale for current use; any dependent summary must be revalidated. Existing NPC beliefs and downstream events are not silently erased; they follow separate acquisition and causal-revision rules.

## 9. Failure behavior and acceptance

Before implementation is approved, tests must establish:

- hypotheses never become canonical facts or confirmed intent solely because the model produced them;
- ambiguous and mixed-intent cases retain alternatives rather than forced certainty;
- flirtation is never used as a proxy for consent or permission;
- a contradictory explicit clarification changes the current assessment without erasing history;
- source edit/delete/swipe/replay/rollback invalidates dependent interpretations when lineage is known; unknown lineage is withheld;
- stale, unauthorized, or unverifiable evidence cannot leak through derived summaries, snippets, counts, diagnostics, or prompts;
- two NPCs can hold different interpretations of the same utterance without accidental shared knowledge;
- player agency and private internal state are not inferred as canonical facts;
- evidence classes distinguish source-inspected, fixture-tested, runtime-observed, and real-runtime-tested.

## 10. Non-goals and implementation gate

This document does not authorize a classifier, new runtime enum, table, API, prompt pipeline, or Memory/NPC production wiring. First review the semantic contract across Core, NPC, Personality, Relationships, and Memory. Then submit a separate implementation proposal tied to an actual consumer, existing source identity/validity evidence, persistence owner, invalidation path, authorization policy, and executable tests.

The current Memory→NPC production path remains **DISABLED / FAIL-CLOSED** until its separate integration gates pass. The existing vectorization/remote-store path is out of scope and must not be changed by this subsystem.
