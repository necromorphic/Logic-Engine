# NPC Subsystem — Semantic Acceptance Matrix

Status: test design only on `feat/npc-subsystem`. These cases are not yet executable tests and do not imply that the corresponding runtime features exist. They operationalize `docs/31-npc-subsystem-contract.md` before API or storage design.

## Test conventions

- **Canonical state** is read from the core's authoritative state, not from generated prose.
- **NPC state** means the actor-specific profile/runtime information available under the contract.
- **Player awareness** means information actually delivered to the player through an allowed channel, not merely present in logs or model context.
- Every test should compare state before and after, including event/audit effects. A rejected proposal must not partially commit.
- Use synthetic entities and secrets; no setting-specific facts are needed.

## NPC-SEM-001 — Retrieved secret is not automatically accessible

**Given**
- Canonical fact `secret_X` exists and is private to character A.
- Character B has no valid source, authorization, or acquisition path for `secret_X`.
- A similarity search returns a fragment containing `secret_X`.

**When** a decision context is prepared for B.

**Then**
- The secret is excluded from B's usable decision context.
- The search result does not create a knowledge record for B.
- B cannot cite the search result as in-world evidence.
- No canonical state changes.

## NPC-SEM-002 — False belief does not auto-correct with canonical truth

**Given**
- The canonical state establishes proposition P as false.
- Character A still believes P is true.
- A has not received valid corrective evidence.

**When** A makes a decision that depends on P.

**Then**
- A's belief remains distinguishable from canonical truth.
- A may act consistently with the false belief if otherwise plausible.
- The system does not silently rewrite A's belief just because the canonical fact differs.

## NPC-SEM-003 — Knowledge with an alternative source survives source invalidation

**Given**
- Character A knows proposition P from two independent valid sources S1 and S2.
- S1 is later invalidated by a core rollback.
- S2 remains valid and sufficient under the acquisition rules.

**When** NPC knowledge is reconciled after rollback.

**Then**
- A retains knowledge of P with S2 as surviving provenance.
- The invalidated S1 path is no longer treated as valid.
- Audit history records the rollback/reconciliation rather than erasing history.

## NPC-SEM-004 — Failed plan prerequisite does not erase the goal

**Given**
- Character A has goal G and plan PL intended to achieve G.
- PL requires prerequisite R.
- R becomes false or unavailable.

**When** A's planning state is reconciled.

**Then**
- PL is marked blocked, invalidated, or due for revision according to the declared plan semantics.
- G remains active unless its own success/failure/expiry condition is met.
- The system does not execute a step that requires unavailable R without an explicit supported exception.

## NPC-SEM-005 — Off-screen event is not automatically player knowledge

**Given**
- Character A performs a validated action while outside the player's viewpoint.
- The action commits canonical event E.
- No communication or narration channel has delivered E to the player.

**When** the current scene is rendered.

**Then**
- E and its valid effects remain in canonical state.
- The scene does not state E as something the player knows unless the viewpoint explicitly permits omniscient narration.
- Absence of a narrated report does not cancel E.

## NPC-SEM-006 — Pending report is not delivered knowledge

**Given**
- Character A has a valid report about event E intended for character B.
- Communication is currently unavailable or delivery has not been confirmed.

**When** the system prepares B's knowledge and the player's view.

**Then**
- B does not receive the report as known information.
- The player is not treated as informed merely because the report exists.
- Report state remains pending/undelivered (or the equivalent declared state) until a valid delivery transition occurs.

## NPC-SEM-007 — Different knowledge/goals permit different reactions

**Given**
- Characters A and B are exposed to the same canonical event E.
- A knows motive M and prioritizes goal GA.
- B does not know M and prioritizes a materially different goal GB.
- No rule forces identical reactions.

**When** reactions are proposed for A and B.

**Then**
- Each reaction is evaluated against its actor's own permitted knowledge, goals, character profile, and current state.
- Identical reactions are allowed only if independently plausible; the system must not copy one reaction to the other by default.
- Any committed relationship change has an explicit supported cause.

## NPC-SEM-008 — Rejected action proposal is non-mutating

**Given**
- Character A proposes action X.
- X violates a declared precondition or capability rule.

**When** the core validates X.

**Then**
- X is rejected or sent for review according to the rule's defined failure semantics.
- No effect from X enters canonical state.
- A generated explanation of X does not count as a commit.
- Any diagnostic record is clearly non-canonical unless explicitly defined otherwise.

## NPC-SEM-009 — Rollback removes dependent effects but preserves independent activity

**Given**
- NPC action E2 depends solely on source event E1.
- Separate event E3 has an independent valid cause and remains consistent with the post-rollback state.
- E1 is rolled back.

**When** causal reconciliation runs.

**Then**
- E2 is invalidated or recomputed according to its declared dependency.
- E3 is preserved if its invariants still hold.
- The system does not invalidate E3 merely because it occurred later than E1.
- Any unresolved contradiction becomes an explicit conflict/review item rather than an invented resolution.

## NPC-SEM-010 — Missing source data does not create canon

**Given**
- A character profile or world data does not specify secret S, motive M, relationship R, or capability C.
- No valid evidence or author override supplies the missing detail.

**When** the model proposes a consequential statement or action that requires one of those details.

**Then**
- The proposal is marked uncertain/reviewed or replaced with an option that does not depend on the unsupported detail.
- The missing detail is not committed as canon.
- Fluent narration or model confidence does not count as evidence.

## NPC-SEM-011 — Player agency remains outside NPC authorship

**Given**
- An NPC action creates an opportunity for the player to respond.
- The player has not supplied a voluntary response.

**When** narrative text is generated.

**Then**
- The system may describe the NPC action and externally observable consequences.
- It does not invent the player's dialogue, choice, intention, feeling, consent, or voluntary movement.
- The scene can stop at the decision point without forcing a player action.

## NPC-SEM-012 — Chat turns do not advance world time

**Given**
- An NPC process advances only through world-time advancement or a declared trigger.
- World time remains unchanged.
- Multiple chat turns occur.

**When** the NPC process state is checked.

**Then**
- No time-dependent progress is inferred solely from the number or duration of chat turns.
- A declared event trigger may progress the process only through the supported simulation operation.
- Real operating-system time does not substitute for game time.

## Exit criteria for this matrix

Before implementation begins, review each expected result against the core's actual supported contracts. Convert these cases into automated tests only after the relevant state/event interfaces exist. If a required primitive is not implemented, record the case as blocked by a core dependency rather than faking it with prompt text or test-only state.


## 13. Information-acquisition scenarios and current core support

This section makes the knowledge scenarios more concrete. It is still a semantic acceptance specification, not a claim that the repository currently implements NPC knowledge acquisition or that these cases are executable.

### 13.1 Source-type matrix

| Situation | What the NPC may tentatively know/believe | Evidence required before treating it as acquired knowledge | Current core support observed in this branch | Acceptance outcome until a trusted acquisition boundary exists |
|---|---|---|---|---|
| NPC directly witnesses event E | E, limited to what the character could perceive from their location and senses | A supported event/observation record or trusted scene adapter recording actor, event, time, and perceptible details | Core can represent canonical events and context references; the inspected context manifest does not itself record that this actor witnessed E | Do not infer witnessing merely because E is canonical or appears in narration; leave acquisition unconfirmed |
| NPC receives a report from character A | The report's contents, with source attribution; not necessarily the underlying truth | A delivered communication/report transition with sender, recipient, content, delivery status, and in-world time | Generic proposals/events may support ordinary world changes, but no NPC report-delivery/knowledge transition was established by this audit | Pending report is not recipient knowledge; only a confirmed delivery boundary may establish receipt |
| NPC reads a document D | Information actually present in D and accessible to this character at the time | A valid document/source reference plus access and reading/acquisition evidence; distinguish reading from mere document existence | Manifest references entities/facts/events and may include content hashes; it does not prove actor access or that the actor read D | Search result or document reference alone must not establish knowledge |
| NPC infers conclusion C from evidence E1…En | A belief, inference, suspicion, or confidence-qualified conclusion—not automatically a canonical fact | Explicit input evidence, inference provenance, and a policy for recording beliefs separately from canonical truth | No actor-relative belief record or inference transition was verified in the inspected core path | Keep C as an uncommitted decision-time inference; do not write C into canonical world state or durable knowledge by implication |
| NPC hears a rumor R | That a rumor was heard, attributed to a source if known; R itself remains unverified | A delivered rumor/statement record and recipient acquisition transition | No rumor-delivery or actor-knowledge acquisition service was established by this audit | Do not promote rumor content to canon; keep source and uncertainty attached if a trusted caller supplies them |
| NPC searches/retrieves candidate X | At most, that the system found a candidate; not that the NPC encountered or understood it in-world | A separately authorized acquisition path; retrieval provenance alone is insufficient | The inspected manifest is a reference list, not an access-control or acquisition log | Candidate is excluded from usable context if permission and permitted acquisition cannot be established |
| NPC is told a false claim F | The NPC may believe F; canonical truth remains unchanged unless a separate supported event changes it | Delivered communication plus an actor-belief state or explicitly scoped decision input | The manifest does not distinguish actor belief from canonical truth | Do not auto-correct the NPC's belief from canon, and do not rewrite canon to match the belief |
| NPC independently observes an absence (e.g. person not present) | Only a bounded observation: “I did not see X here/then,” not universal “X does not exist” | Scene bounds, actor perception, time, and observation conditions | `entity_absence` / `fact_absence` manifest references exist, but do not establish an actor's observation or universal absence | Keep the claim scoped to the observation; absence of a manifest entry is not evidence |

### 13.2 Cross-cutting rules for every acquisition path

1. **World fact and acquired information are separate dimensions.** A canonical event may be true without every NPC knowing it.
2. **Acquisition is an event/transition, not a retrieval side effect.** Searching, injecting into a prompt, or mentioning something in generated prose does not by itself grant knowledge.
3. **Source reliability and actor belief are separate.** A trusted record that A said P proves the utterance/delivery if that is what the record represents; it does not automatically prove P.
4. **Perception is bounded.** Location, timing, visibility, audibility, attention, language comprehension, and relevant capabilities may limit what was acquired. Do not assume these values unless a trusted scene/context source supplies them.
5. **Inference is not canon.** A conclusion can guide a proposed decision while remaining a belief or suspicion. It becomes canonical only through an explicit, supported core operation and the ordinary validation/commit path.
6. **Withheld information must be withheld before model input.** Do not expose a secret together with instructions not to use it.
7. **Missing acquisition evidence remains unknown.** It must not be silently interpreted as either “the NPC knows” or “the NPC definitely does not know.”
8. **A delivery/acquisition transition must have a declared owner.** Until the core or a trusted adapter owns that boundary, these cases remain blocked specifications rather than prompt-only guarantees.

### 13.3 Worked distinctions

- **Witnessed event:** the event is canonical; whether NPC B saw it is a separate question. If B was not present or visibility is unknown, do not claim B witnessed it.
- **Report:** a message was prepared for B; that does not mean it arrived. Even after delivery, B may misunderstand it or disbelieve it if the actor-belief model allows that distinction.
- **Document:** D exists and a search found it; that does not prove B could access, opened, read, or understood D.
- **Inference:** B sees footprints and suspects A was present. The suspicion can motivate a question or investigation proposal, but cannot be recorded as a confirmed fact that A was present.
- **Rumor:** B hears “A betrayed the group.” The supported acquired information is that B heard a claim (and perhaps who said it), not that A betrayed the group.
- **False claim:** A tells B “the meeting is tomorrow,” while the meeting is today. The utterance may be a supported event and B may believe it, but neither changes the canonical meeting time.

### 13.4 Required test-boundary classification

Do not create runtime tests for these scenarios yet. Once an authoritative acquisition boundary exists, split tests by layer:

- **Pure semantic tests:** given a trusted input describing witness/report/document/inference/rumor, verify the expected epistemic distinction without pretending to test persistence or authorization.
- **Context-preparation tests:** verify unauthorized/retrieved-only secrets are excluded before model input; verify provenance, actor identity, and completeness failures fail closed.
- **Core integration tests:** verify only real supported event/transaction paths establish canonical changes, report delivery, or durable records; verify rejected operations do not partially mutate state.
- **Rollback tests:** add only after the core's causal ownership for acquisition and derived belief records is explicitly defined; preserve independent sources of knowledge when one source is invalidated, if the approved semantics require that behavior.

The current branch has not established the required actor-relative acquisition boundary. Therefore the immediate decision is to retain these as acceptance criteria and identify the trusted caller/core owner before authoring executable tests or adding any NPC state model.
