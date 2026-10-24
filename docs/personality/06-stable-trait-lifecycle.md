# Personality Block — Stable Trait and Mutable State Lifecycle

Status: semantic contract for authoring and review. This is not a runtime schema, mutation API, or claim that automatic trait inference exists.

## 1. Purpose

Keep relatively stable personality description distinct from state that can change during simulation. The distinction prevents temporary circumstances, single observed actions, model-generated interpretations, or narrative shorthand from silently rewriting a character's canonical profile.

The Personality block defines meanings and acceptance rules. The core owns canonical records, authorized writes, provenance, event/revision/audit lifecycle, reads, and rollback. The NPC subsystem uses authorized personality context to generate and evaluate candidate actions; it does not own a parallel personality store.

## 2. Record categories

Classify each authored or observed item by its meaning before deciding how it can change.

| Category | Meaning | Default lifecycle rule |
|---|---|---|
| Stable trait | A relatively persistent tendency, disposition, preference, value, or characteristic intended to inform plausibility across situations. | Changes only through an explicit authorized authoring/development rule; never from one action by default. |
| Biography / identity fact | A claim about a character's history, identity, or enduring circumstances. | Not a personality trait; requires its own canonical fact/provenance treatment. |
| Temporary condition | A time-bounded or situation-dependent state such as fatigue, fear, pain, intoxication, stress, or current mood, if the world models it. | May change through valid world events; does not silently mutate stable traits. |
| Goal / intention | A desired outcome or commitment attributed to the character. | Can be adopted, revised, abandoned, blocked, or completed under its own lifecycle; not itself a stable trait. |
| Belief / knowledge claim | What the character knows, suspects, assumes, or believes. | Governed by knowledge/evidence rules, not inferred solely from personality or relationship values. |
| Observed behavior | An action or response that occurred or was reported. | Evidence for interpretation, not an automatic profile update. |
| Interpretation / hypothesis | A tentative explanation of a trait or action. | Must remain marked as inference/hypothesis and must not silently become authored canon. |

If one sentence mixes categories, split it into separately typed claims where the underlying system supports that distinction; otherwise preserve the ambiguity and flag it for author review rather than silently choosing a category.

## 3. Stability is not immutability

“Stable” means that the trait is not rewritten by ordinary transient events or by a single model inference. It does not mean a character can never develop.

A stable trait may change only through a declared path, such as:
- an explicit authorized author edit/correction;
- an explicitly modeled character-development process, if the World Pack and runtime support one;
- an import/migration operation with explicit provenance.

The list above is semantic guidance, not confirmation that all these write paths currently exist. Until the relevant authorized operation is approved and tested, the safe behavior is to leave the canonical trait unchanged and surface the proposed change for review.

A character's temporary state can affect how a trait manifests without changing the trait itself. Example: a normally patient character may respond sharply while exhausted. The response alone does not establish that the stable trait has changed.

## 4. Behavior-to-trait inference

Observed behavior can be used as evidence during author review, but evidence and canonical re-authoring are separate operations.

The following are prohibited as implicit mutation rules:
- one action automatically changes a stable trait;
- repeated behavior automatically changes a stable trait without a declared threshold and review/authorization policy;
- a model's explanation of an action is treated as a confirmed motive;
- a relationship change is treated as proof of a personality change;
- an inferred description is promoted into authored canon merely because it appears in narrative output.

If a World Pack later supports trait development from repeated behavior, it must specify a separate rule: qualifying observations, time window, contradictory evidence, confidence/threshold policy, actor authorization, audit/provenance, and rollback/rebuild behavior. It must also state whether the result is a suggestion for author review or a canonical mutation. In the absence of such a rule, no automatic update occurs.

## 5. Contradiction and uncertainty

A character may behave inconsistently with a stable trait. Possible explanations include competing goals, incomplete information, pressure, coercion, deception, changed circumstances, deliberate exception, or development—but the system must not select one explanation as canonical unless supported.

When evidence is ambiguous:
- retain the stable trait as currently authored;
- retain the observed behavior separately where the system supports it;
- leave the cause unresolved or present multiple hypotheses as non-canonical;
- do not invent hidden motives, diagnoses, backstory, or personality revisions;
- request author resolution when the contradiction materially affects canon or a consequential decision.

A trait is a constraint on plausibility, not a deterministic policy that forces the same action in every context.

## 6. Provenance and correction

At minimum, semantic review must distinguish:
- **author-authored initial/imported trait:** supplied as part of the initial authored world or imported canon;
- **authorized author correction:** an explicitly attributed correction, not a silent rewrite of history;
- **world-derived update:** a trait change caused by a declared in-world development rule, only if such a rule and authorized write path exist;
- **observed behavior:** evidence that does not itself rewrite the trait;
- **inference/hypothesis:** an interpretation that has not been promoted to canon.

A caller-supplied provenance label does not grant permission to perform an operation. Authorization and audit are core responsibilities. No direct storage edits, hidden mutable side store, or event-log bypass is permitted.

## 7. Decision-use constraints

Personality context may influence an NPC's candidate actions, priorities, tone, risk assessment, interpretation, and likely response. It must not:
- grant the NPC facts it does not know;
- override world-state preconditions or authorization;
- convert a tendency into a guaranteed action;
- override explicit commitments or World Pack constraints;
- authorize voluntary dialogue, thoughts, or actions for a player-controlled character;
- be exposed to a caller who is not authorized to receive it.

The same trait can lead to different plausible actions depending on knowledge, stakes, goals, social pressure, obligations, capabilities, and current conditions.

## 8. Acceptance criteria

| ID | Scenario | Required result |
|---|---|---|
| PERS-TRAIT-001 | Temporary mood changes | Mood/condition changes without silent stable-trait mutation. |
| PERS-TRAIT-002 | One contradictory action | The action is retained as behavior/evidence; trait remains unchanged by default. |
| PERS-TRAIT-003 | Repeated behavior without a declared rule | No automatic trait update occurs. |
| PERS-TRAIT-004 | Explicit authorized correction | Proposed correction is distinguishable from initial authoring and in-world change, with core audit/authorization. |
| PERS-TRAIT-005 | Unconfirmed motive | A model-generated explanation remains an inference, not canonical motive. |
| PERS-TRAIT-006 | Trait-development rule unavailable | The system does not pretend that a supported development operation exists. |
| PERS-TRAIT-007 | Context-sensitive manifestation | Multiple actions can be plausible under different contexts without changing the trait. |
| PERS-TRAIT-008 | Player-controlled character | Traits do not authorize invented voluntary actions, thoughts, or dialogue. |
| PERS-TRAIT-009 | Unauthorized read | Private/sensitive personality data is not passed to a caller without permission. |
| PERS-TRAIT-010 | Rollback of development event | If a supported trait change is event-derived, the canonical projection follows the core's approved rollback/rebuild contract. |

These are semantic acceptance criteria, not claims of passing runtime tests. Criteria requiring authorization, persistence, audit, reads, or rollback must be exercised through real core interfaces once available.

## 9. Author review checklist

Before approving a trait entry, verify:
- [ ] It describes a relatively stable tendency rather than a current emotion, goal, belief, or single behavior.
- [ ] Its wording leaves room for context-sensitive exceptions.
- [ ] Any causal explanation or motive is supported rather than guessed.
- [ ] Authored canon is distinguished from inference.
- [ ] The permitted mutation path and authorization are explicit.
- [ ] Development rules, if any, specify evidence, thresholds, contradictions, provenance, and rollback.
- [ ] Decision-use does not leak knowledge or override player agency.

If these cannot be answered from available sources, mark the item unresolved instead of filling the gap by assumption.
