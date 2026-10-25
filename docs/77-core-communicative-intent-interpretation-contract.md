# Core communicative-intent interpretation contract

Status: documentation proposal for review; not a runtime contract or implementation authorization.

Issue: #260  
Owner: Core  
Scope: world-agnostic epistemic, provenance, revision, invalidation, and consumer boundaries for LLM-proposed interpretations of communicative intent.

## 1. Purpose and non-goals

The language model remains responsible for contextual interpretation of nuanced language and narrative. Core defines how a proposed interpretation is represented, qualified, revised, invalidated, and exposed to consumers. This contract does not claim that Core can independently determine the true intent behind an utterance.

The categories below are extensible by a World Pack or domain-specific rules. Examples include flirtation, joking, sarcasm, threat, manipulation, reassurance, insult, ambiguity, and non-literal speech. They are not an exhaustive universal taxonomy, and multiple categories may apply to one utterance.

This document adds no runtime API, schema, store, event, cursor, outbox, lifecycle hook, or prompt wiring. Any implementation requires a separate reviewed task and explicit approval.

## 2. Epistemic states

These labels describe the status of an interpretation, not the truth of the underlying claim. They are conceptual states for contract and review; this document does not prescribe persisted enum values.

- **Candidate** — a possible interpretation proposed by a model or other permitted analysis. It is a hypothesis only.
- **Model-selected** — the model currently prefers this candidate given the cited context. Selection is not external confirmation and does not make it canonical fact.
- **Explicitly confirmed** — a permitted, identified source explicitly confirms a narrowly stated proposition or intent. Record what was confirmed and by whom/what source; do not infer broader consent, motive, or facts than the source supports.
- **Disputed** — credible alternatives or contradictory evidence remain. Preserve the competing interpretations and their evidence; do not collapse the dispute to a single certain answer.
- **Stale / revoked** — required source evidence is edited, deleted, swiped away, branched away from the active lineage, revoked, inaccessible, or otherwise no longer verifiable for the current use. The old interpretation may remain in history, but it must not be represented as currently verified.

These are not necessarily a single linear state machine. For example, an explicitly confirmed narrow statement can coexist with a disputed broader motive. A selected interpretation can become stale after its source changes. A previously recorded interpretation must not be silently overwritten when a new interpretation is preferred.

## 3. Evidence and provenance

An interpretation intended for downstream use must retain, to the extent the existing approved source contract can prove it:

- the proposition being interpreted and its scope;
- the source message or evidence references that support it;
- source identity/version and lineage where those are available and trusted;
- the relevant context boundary or references to additional context;
- alternative interpretations, including evidence for and against each;
- uncertainty and unresolved ambiguity, without false numerical precision;
- who or what proposed the interpretation, and what source (if any) explicitly confirmed it;
- revision history or a link to prior interpretations sufficient to avoid silent replacement;
- the conditions under which the interpretation must be invalidated or re-evaluated.

Do not fabricate missing provenance fields or treat a model-generated source label as trusted identity. If the current Host/Provider contract cannot prove source identity, version, lineage, or inventory completeness, the result is unverified/non-ready for source-dependent use. Provider-local reconciliation cannot prove that Host inventory is complete.

Confidence is not authority. A high-confidence model output does not substitute for source confirmation, access authorization, or a valid lineage.

## 4. Revision and invalidation

A new interpretation creates a new revision or history entry under a future approved implementation; it must not silently mutate the meaning of an earlier recorded interpretation. The exact persistence mechanism is intentionally unspecified here.

A dependent interpretation must be marked stale/non-ready and re-evaluated only when permitted if any required source is:

- edited or replaced;
- deleted or tombstoned;
- a swipe/version that is no longer the active version;
- excluded by a branch change or lineage switch;
- revoked or no longer authorized;
- unavailable during a required verification;
- found to have conflicting, incomplete, or unknown version/inventory state.

If the system cannot establish whether a source change affects the interpretation, it must not claim the interpretation remains verified. Preserve historical evidence as history where permitted, but do not expose stale material as current truth. Re-evaluation is not permission to rewrite the historical record as if the new interpretation had always been known.

This document does not define an event stream, revision cursor, dependency graph, tombstone schema, or atomic cross-store protocol. Those require separate design and approval.

## 5. Separation from other concepts

An interpretation is not, by itself:

- an objective fact about the world;
- proof of the speaker's actual internal intent;
- consent, permission, or authorization;
- a character's belief or knowledge;
- authorization to act;
- a relationship transition or personality change;
- a durable memory candidate eligible for production admission.

In particular, flirtation does not imply consent; joking does not rule out a threat; an insult may be playful in one context and hostile in another; reassurance may coexist with manipulation; and a single utterance can support mixed or competing interpretations. Do not turn an interpretation into a canonical fact or permanent memory solely because it is repeated or model-selected.

## 6. Examples and required handling

### A. Ambiguous compliment

Utterance: “You look dangerous tonight.”

Possible interpretations include flirtation, a warning, teasing, or a literal observation about visible equipment. The model may select one for the current response, but the alternatives and context that distinguishes them should remain available. Without explicit supporting evidence, none is confirmed fact.

### B. Joke with a threat-shaped statement

Utterance: “Keep talking and I'll make you disappear,” followed by laughter.

The laughter supports a joking interpretation but does not prove the absence of threat. Preserve both readings if context does not resolve them. Do not automatically classify the statement as harmless, and do not infer that a threat occurred as an objective fact solely from the wording.

### C. Reassurance mixed with manipulation

Utterance: “I'm only doing this to protect you; don't tell anyone.”

A reassurance interpretation and a manipulation/coercion interpretation may both be plausible. The secrecy request is evidence to evaluate, not proof of motive. Keep intent uncertain unless a permitted source confirms a narrow claim.

### D. Contradictory context

An earlier message appears playful, while a later message explicitly says the speaker was serious and identifies a concrete threat. Preserve the earlier inference and its provenance as historical; create a revised interpretation that cites the new evidence. If the later source is not authorized, has unknown lineage, or cannot be verified, do not silently promote it to confirmation.

### E. Consent boundary

A model interprets an utterance as flirtatious. That interpretation must not be consumed as consent, permission for physical contact, or action authorization. Those require their own permitted evidence and checks.

### F. Source edited or swiped away

A message supporting an interpretation is edited, deleted, or no longer belongs to the active swipe/branch. The dependent interpretation is stale until the source and lineage are revalidated. If the Host cannot report a complete, trustworthy inventory, return non-ready rather than an empty set or a claim that the old interpretation remains current.

## 7. Consumer boundary

- **Core** validates permitted provenance, current source state, and whether the interpretation is eligible for the requested use. It must preserve uncertainty and must not silently convert a hypothesis to fact.
- **NPC** may use an eligible interpretation as contextual evidence, but retrieval or context inclusion is not proof that the NPC received, acquired, or believes it. The NPC must not treat a hypothesis as objective truth or action authorization.
- **Personality** may use eligible evidence to inform a proposed reaction, but must distinguish a transient interpretation from a stable trait or acquired experience.
- **Relationships** must not commit a relationship transition solely because an interpretation exists. Relationship effects require the separately approved relationship contract and canonical commit path.
- **Memory Provider** may not treat a low-confidence or model-selected interpretation as a production memory candidate merely because it was stored or retrieved. Production Memory→NPC remains disabled/fail-closed until the source authority, version, lineage, inventory, reconciliation, revocation, and final-release gates are proven.
- **Narrative prompting** may receive an eligible, qualified interpretation as context. Inclusion in a prompt is not confirmation, authorization, receipt, acquisition, or belief.

Consumers must preserve the distinction between “proposed,” “selected,” “confirmed,” “disputed,” and “stale/revoked” in their own behavior. No consumer may invent missing provenance or upgrade epistemic status on its own.

## 8. Failure behavior and acceptance criteria

If source identity, version, lineage, authorization, or currentness is unknown; if required evidence is stale/revoked; if source reconciliation is incomplete; or if required verification is unavailable, the interpretation is **unverified / non-ready** for any use requiring that guarantee. Do not silently substitute an empty result, assume the source still exists, emit a canonical fact, or expose stale evidence as current.

A future implementation review must demonstrate, using the real approved source and consumer path:

1. candidate and model-selected hypotheses remain distinct from explicit confirmation;
2. competing interpretations and evidence for/against survive revision;
3. edits, deletion, swipe changes, branch changes, revocation, and unavailable verification invalidate dependent current-use eligibility;
4. historical interpretations remain distinguishable from current interpretations;
5. downstream consumers cannot treat retrieval/context inclusion as proof of delivery, acquisition, belief, consent, or authorization;
6. unknown or incomplete source inventory fails closed;
7. no new runtime API/schema/store/prompt wiring is introduced without a separate approved task.

This is a documentation proposal only. It does not claim that the required runtime mechanisms exist or that any production gate has passed.
