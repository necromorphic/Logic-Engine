# NPC Belief, Actor-Model, and Internal-Conflict Foundation

**Status:** design note for review; documentation only.  
**Branch:** `docs/npc-cognition-skeleton-2026-10-28`; part of PR #633.  
**No runtime, API, schema, prompt, persistence, or Memory → NPC activation is authorized by this document.**

## 1. Why this note exists

The cognition map in `docs/81-npc-cognition-capability-map.md` identifies several related but distinct concerns. This note records the minimum semantic boundaries needed before implementing them. It reuses existing repository contracts rather than defining a second source of truth.

Sources reviewed:
- `docs/07-knowledge-and-narrative-boundaries.md`
- `docs/31-npc-subsystem-contract.md`
- `docs/34-npc-decision-context-and-proposal.md`
- `docs/39-npc-core-knowledge-contract-proposal.md`
- `docs/78-relationships-npc-interpretation-boundary.md`
- `docs/personality/01-personality-and-relationship-semantics.md`
- `docs/23-character-and-control-architecture.md`

These documents are proposed contracts or bounded subsystem contracts; their existence does not prove a complete integrated runtime.

## 2. Belief is not truth, acquisition, or retrieval

Keep these dimensions separate:

| Dimension | Question it answers | Owner/boundary |
|---|---|---|
| Canonical fact | What does the current world state accept as true? | Core |
| Acquisition evidence | How could this NPC have obtained the proposition? | Authoritative Core knowledge contract; runtime path must be verified |
| Belief stance | What does this NPC currently accept, doubt, reject, or suspect? | NPC-relative semantics; no competing canonical knowledge store |
| Retrieval candidate | What did search return? | Retrieval provider; not authorization |
| Context inclusion | What was included in this particular decision input? | Trusted context-preparation boundary |
| Delivery | Was information sent to a target, and what does the host actually confirm? | Authoritative delivery contract/Host evidence |
| Comprehension or acceptance | Did the actor understand or accept the information? | Separate evidence or adjudication; never inferred from injection alone |

Required behavior:

1. A canonical fact may be unknown to an NPC.
2. An NPC may retain a false or outdated belief if no valid correction reached them.
3. An NPC may remember that a claim was communicated without continuing to believe it.
4. A retrieved fragment, prompt inclusion, generated sentence, or player-visible narration must not by itself create knowledge or belief.
5. Conflicting evidence stays conflicting unless an existing approved rule resolves it. Do not use majority vote or number of similar snippets as a universal truth rule.
6. Unknown, inaccessible, withheld, invalid, disputed, false, and unsupported are not interchangeable.
7. A model may propose a belief update with evidence references; it cannot certify acquisition, delivery, source validity, or canonical truth itself.
8. If the required authoritative acquisition record or actor/purpose filter is unavailable, the corresponding input is deferred and the decision must remain bounded or return `needs_review`. Do not add an NPC-local substitute store.

The initial `author_initial`/imported knowledge path described in `docs/34` and `docs/39` is still a narrow first-slice target, not a general executable belief system.

## 3. Model of another actor is a hypothesis, not mind-reading

An NPC may reason about another character, but the engine must preserve the difference between observed evidence and inferred private state.

Conceptual categories:
- **Observed fact:** behavior, statement, location, or event supported by permitted evidence.
- **Reported claim:** what a source said, attributed to that source rather than automatically accepted as true.
- **Interpretation:** a possible meaning of observed behavior.
- **Hypothesis about another actor:** estimated goal, trustworthiness, knowledge, capability, fear, intention, or likely next action.
- **Unresolved alternative:** another explanation that has not been ruled out.
- **Confirmed state:** only a state supported by the appropriate canonical or actor-authorized source.

Rules:

1. Never turn a hypothesis about another actor's private thoughts or motives into canonical fact merely because a model produced it.
2. Preserve attribution: “NPC A suspects B is lying” is not equivalent to “B is lying.”
3. Keep relationships directional and actor-relative. A's trust in B does not imply B trusts A.
4. Do not resolve ambiguous social evidence by majority vote or by silently choosing the most convenient interpretation. Reuse the conflict semantics in `docs/78-relationships-npc-interpretation-boundary.md`.
5. A model of another actor can inform an NPC's own decision, but must not grant access to that actor's private knowledge.
6. Update a hypothesis only from newly permitted evidence or an explicit authored override. If evidence is insufficient, retain uncertainty instead of inventing certainty.

This note does not propose a separate “theory of mind” database or relationship store. The owning state representation must be decided against existing Core, Relationships, Personality, and Memory contracts.

## 4. Internal conflict is not a single personality score

NPC decisions may involve incompatible goals or constraints, for example:
- loyalty to one person versus an obligation to another;
- immediate safety versus a long-term objective;
- a deadline versus a resource or capability limit;
- a stable value versus a temporary fear or pressure;
- an intended action versus a new fact that invalidates its assumptions.

Before implementing a resolver, the design must distinguish:

1. **Hard constraint:** an action is prohibited or impossible under trusted rules; it is ineligible, not merely “low priority.”
2. **Goal priority:** relative importance among otherwise eligible objectives.
3. **Resource/cost constraint:** whether an action is feasible with current supplied resources; the model cannot assert feasibility without evidence.
4. **Risk tolerance:** an explicit authored or World Pack rule that may affect choice, not an invented universal constant.
5. **Value/obligation conflict:** competing reasons that may not have a universal numeric conversion.
6. **Uncertainty:** missing or disputed evidence that may require delay, a reversible action, an alternative, or review.
7. **Unresolved conflict:** no supported rule decides the conflict; preserve it and return `needs_review` rather than silently discarding a motive.

The existing intention selector chooses among supplied eligible goals/actions using bounded priorities, costs, and stable tie-breaking. It is not yet a general moral/value conflict resolver and should not be stretched into one without a separately accepted contract.

## 5. Reflection and learning must be evidence-bound

A reflection step may compare:
- the expected outcome recorded by a plan;
- the accepted/observed result from the trusted event path;
- the evidence that supports that result;
- which assumptions were contradicted;
- a proposed change to belief, plan, priority, or future action choice.

It must not:
- treat a generated narration as proof of success;
- invent a past event or retroactive source to explain an outcome;
- silently rewrite stable personality from one behavior;
- use an unverified outcome to update canonical knowledge;
- bypass Core rollback/reconciliation or Memory admission rules.

A reflection output is a proposal. Any durable update must pass through the owner of that state and preserve provenance/revision semantics.

## 6. Safe implementation sequence

This order is proposed for review, not a commitment to begin every module immediately.

1. **Inventory and exact-head verification:** list the current source, tests, open PRs, and ownership for goals, intention selection, plan progress, knowledge, relationships, and personality handoff.
2. **Keep existing pure helpers narrow:** validate their semantics and tests; do not add model calls or persistence to them.
3. **Choose one minimal deterministic slice:** prefer a pure evaluator over caller-supplied, explicitly typed evidence and candidate states; define malformed, missing, conflicting, and withheld inputs first.
4. **Add adversarial tests:** false belief versus canonical truth; retrieved-but-unauthorized text; ambiguous actor motives; conflicting goals; hard constraint versus low priority; invalidated plan assumptions; unverified outcomes; restart/rollback boundaries where relevant.
5. **Review ownership before persistence:** Core owns canonical truth, acquisition/delivery evidence and rollback; Personality owns stable trait semantics; Relationships owns its domain transitions; NPC owns decision orchestration, not parallel copies.
6. **Only then consider a real caller:** context preparation and effect validation must use existing trusted boundaries. Isolated unit tests do not prove end-to-end autonomy.

## 7. Explicit non-goals

- No new storage tables, public API, schema, or model prompt.
- No autonomous background loop or off-screen execution.
- No model authority to commit world effects or certify its own evidence.
- No inference that a character knows all facts present in the world snapshot.
- No automatic relationship or personality mutation from an interpretation.
- No production Memory → NPC activation; it remains **DISABLED / FAIL-CLOSED** until its independent gates pass.
