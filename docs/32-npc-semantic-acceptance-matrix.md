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


## 14. Author-confirmed behavior scenarios (requirements; not yet executable)

These scenarios operationalize `docs/38-npc-author-decisions-and-semantic-delta.md`. They are acceptance requirements only. They must remain marked blocked until a real production boundary can exercise them; do not simulate missing guarantees in a test-only mock.

### NPC-SEM-013 — A direct author-mandated outcome is not silently cancelled

**Given**
- The author explicitly requires outcome O.
- O does not conflict with higher-priority system constraints or player agency.
- The NPC's ordinary preferences would normally make O unlikely or lead the NPC to refuse.
- No instruction prescribes every intermediate step.

**When** the system plans the next story developments.

**Then**
- O remains a mandatory target; the NPC's ordinary refusal tendency alone does not cancel it.
- The NPC retains autonomy over intermediate actions not specified by the author.
- The system first evaluates already-established motives, relationships, evidence, pressures, and circumstances.
- It does not invent a past cause or silently rewrite established history to force O.
- Any route still awaiting causal justification is explicitly marked as needing rationale, not represented as settled canon.
- No voluntary player action, dialogue, thought, feeling, intention, consent, or reaction is invented.

### NPC-SEM-014 — Missing motivation is prepared through future causes, not fabricated history

**Given**
- The author requires outcome O.
- Existing established circumstances do not yet provide a convincing causal path to O.
- The outcome remains compatible with higher-priority constraints and player agency.

**When** the system prepares a path toward O.

**Then**
- It may propose new future circumstances or actions that could credibly motivate O.
- New causes are prospective proposals until they occur through the approved world/event path.
- It does not assert that the NPC secretly had a previously unrecorded motive, promise, encounter, or piece of evidence.
- If no credible route can yet be constructed, O remains an explicit author requirement and the missing causal link is surfaced for resolution.

### NPC-SEM-015 — An author-reserved secret is not autonomously disclosed

**Given**
- Secret S is explicitly reserved by the author and marked as not to be disclosed autonomously.
- An NPC has access to S and a dramatic opportunity to reveal it.
- No explicit author instruction authorizes this disclosure.

**When** the NPC's candidate action or dialogue is prepared.

**Then**
- The system does not disclose S through that autonomous action, including as an accidental leak invented solely for drama.
- The restriction is applied before S is placed into a context that could cause an unauthorized disclosure.
- Ordinary NPC autonomy remains available for unrelated actions.
- Any explicit authorized override is evaluated under the higher-priority instruction rules; it is not inferred from narrative convenience.

### NPC-SEM-016 — Relationship dimensions may coexist without implying reciprocity

**Given**
- NPC A feels attraction toward character B.
- A and B also have rivalry or a reluctant alliance.
- No evidence establishes that B reciprocates A's attraction.

**When** the system evaluates their relationship and proposes a reaction.

**Then**
- Attraction and rivalry/alliance may coexist; one label or score does not erase the other.
- A's attraction is not converted into B's attraction, consent, or romantic commitment.
- The proposed reaction is grounded in each character's own history, traits, evidence, and current goals.
- A change to one relationship dimension does not automatically change all other dimensions.

### NPC-SEM-017 — Relationship change is dimension-specific and proportionate to the event

**Given**
- Two NPCs have a documented relationship history across multiple dimensions.
- A new event affects them; its importance and meaning differ by context or character.
- No rule mandates a universal response.

**When** relationship consequences are evaluated.

**Then**
- Each NPC may react differently to the same event for grounded character-specific reasons.
- A minor interaction normally causes a limited or gradual change; a major betrayal, rescue, or revelation may cause a sharp change.
- Only supported dimensions change; a trust increase need not erase hostility, attraction, rivalry, obligation, or suspicion.
- The cause and relevant history remain available for explaining the change; a lone aggregate score is not sufficient evidence.

### NPC-SEM-018 — An off-screen event reaches the player only through a plausible channel

**Given**
- NPC A completes a consequential action outside the player's viewpoint.
- The action is committed through the approved world/event mechanism.
- No message, report, conversation, visible consequence, or other allowed channel has yet informed the player.

**When** a later player-facing scene is generated.

**Then**
- The event and its valid effects may remain part of canonical world state.
- The player is not treated as already aware merely because the event exists in canon, logs, or model context.
- The system may later surface it through a plausible in-world channel, including an NPC independently requesting help.
- A report being drafted or pending is not the same as being sent, received, understood, or known by the player.

### NPC-SEM-019 — Report lifecycle distinguishes occurrence, sending, receipt, and awareness

**Given**
- NPC A prepares a report about event E for NPC B or the player.
- Delivery may be delayed, fail, or be received without being understood.
- The current implementation may not yet provide report lifecycle primitives.

**When** knowledge and player awareness are prepared.

**Then**
- Occurrence of E does not by itself establish awareness.
- A pending report does not establish sending; sending does not by itself establish receipt; receipt does not automatically establish comprehension or belief.
- The system must not claim these transitions occurred without trusted evidence.
- If the necessary transition boundary is absent, the scenario remains blocked rather than being faked by prompt text or a parallel store.

### NPC-SEM-020 — Significant information persists without forcing permanent certainty

**Given**
- An NPC acquired meaningful information through a valid, actor-specific source.
- The information later becomes disputed, partially forgotten, or contradicted by new evidence.
- The source event and the NPC's acquisition are distinct from the current canonical truth.

**When** the NPC's later decision context is prepared.

**Then**
- The history of acquisition may remain distinguishable from the NPC's current belief.
- The NPC may retain the memory of a rumor or statement while doubting or rejecting its content.
- New evidence may change belief without rewriting the earlier acquisition or canonical history.
- Selection of relevant context must not imply that omitted information was never acquired.
- Until a trusted persistence/acquisition boundary exists, this remains a blocked requirement, not a claimed runtime capability.

## 15. Author-decision coverage and blocking status

| Author-confirmed requirement | Acceptance coverage | Current status |
|---|---|---|
| Author-mandated outcome must not be silently cancelled | NPC-SEM-013 | Semantic requirement; runtime boundary not verified |
| Prepare future causes without rewriting past history | NPC-SEM-014 | Semantic requirement; causal-planning support not verified |
| Protect author-reserved secrets | NPC-SEM-015 | Semantic requirement; disclosure/context guard not verified |
| Multidimensional relationship tension and non-reciprocal attraction | NPC-SEM-016 | Semantic requirement; relationship model not verified |
| Event-weighted, character-specific relationship changes | NPC-SEM-017 | Semantic requirement; persistent relationship history not verified |
| Off-screen events surfaced through natural channels | NPC-SEM-018 | Existing event path does not establish player awareness |
| Distinguish report lifecycle and awareness | NPC-SEM-019 | Trusted delivery/receipt boundary not verified |
| Persist acquisition separately from changing belief | NPC-SEM-020 | NPC persistence/belief representation not verified |

These scenarios supplement, rather than replace, NPC-SEM-001–012 and the acquisition matrix. Do not claim end-to-end acceptance until each scenario can call the real production boundary and assert canonical state, actor-relative information, player awareness, and relevant event/revision effects. No new store, event log, scheduler, causal graph, or rollback subsystem is authorized by this test specification.


## 16. Optional social identity editor scenarios

The detailed authoring and integration proposal is in `docs/40-npc-social-identities-editor-contract.md`. These scenarios are semantic requirements, not claims of current runtime support.

### NPC-SEM-021 — Additional social identities are optional representations of one character

**Given** an ordinary character has no additional social identity, or an author adds one or more cover identities.

**When** the character profile is read or edited.

**Then**
- Zero additional identities is valid; no placeholder form is required.
- Each additional social identity links explicitly to the same underlying character.
- Creating an identity does not create another NPC/entity or independent copy of shared traits, abilities, relationships, inventory, or history.
- Social identities are not conflated with multiple psychological personalities.

### NPC-SEM-022 — Claimed identity data does not become canonical truth

**Given** a social identity claims an age, biography, occupation, relative, affiliation, or other attribute that is false, partial, or unverified.

**When** the editor stores or the NPC layer uses that claim.

**Then**
- The claim remains distinct from canonical world facts and may be explicitly classified as true, false, partial, fabricated, unverified, or unresolved where the model supports that classification.
- A claimed twin/relative does not create a real entity or canonical relationship.
- Missing fields remain unknown; no biography, motive, relationship, document, or supporting event is invented to fill them.

### NPC-SEM-023 — Shared traits inherit; disguise affects presentation only

**Given** a social identity defines only some appearance or presentation differences.

**When** its appearance is rendered or used in a scene.

**Then**
- Unspecified properties inherit from the underlying character.
- Explicit disguise details change the presented appearance only; they do not change actual anatomy, abilities, weaknesses, or stable traits.
- Shared data is not duplicated as an independent writable copy in each identity.

### NPC-SEM-024 — Document declarations do not create world records

**Given** an author enters a document, credential, registration, witness, or other supporting evidence in the social identity editor.

**When** the profile is saved.

**Then**
- The entry is treated as an author declaration/reference with an explicit evidence status.
- It does not by itself create an issued, valid canonical document, registration, event, or witness.
- Unknown, missing, proposed, forged, disputed, and verified-existing evidence are not collapsed into one status.
- Canonical creation/issuance uses an approved core operation.

### NPC-SEM-025 — Creating a cover does not disclose it

**Given** an author creates or activates a social identity with private editor notes.

**When** another NPC or the player receives a decision context.

**Then**
- The existence and details of the identity are not automatically disclosed.
- Private editor notes and reserved secrets are excluded before model input unless authorized by the relevant context/access rules.
- Context inclusion or retrieval does not establish in-world acquisition, delivery, or belief.

### NPC-SEM-026 — Inconsistencies create risk, not automatic exposure

**Given** a social identity has missing documents or contradictory claims.

**When** an observer interacts with the character.

**Then**
- Consequences depend on the observer's accessible evidence, the situation, stakes, and applicable World Pack procedure.
- A mismatch may prompt questions, inspection, suspicion, or no consequence.
- It does not automatically reveal the underlying identity.
- An observer cannot act on private weaknesses they have not discovered or received through a valid channel.

### NPC-SEM-027 — Real impersonated persons remain distinct

**Given** a character uses the name or biography of an actual person in the world.

**When** the social identity is authored or referenced.

**Then**
- The impersonator and impersonated person remain distinct entities unless an explicit canonical relation says otherwise.
- Names, shared appearance, or claimed family ties do not merge them.
- Any real-world claims/relationships require explicit references or remain unverified claims.

### NPC-SEM-028 — Social identity consequences use existing core boundaries

**Given** a scene may reveal a cover, issue or invalidate a document, or establish a new fact about identity.

**When** the NPC system proposes the consequential change.

**Then**
- Editor changes alone remain authored profile/configuration changes, not in-world events.
- Canonical exposure, registration, document issuance, and related consequences use the existing approved core validation/event path.
- The NPC subsystem adds no parallel identity truth store, knowledge store, event journal, revision counter, access-control subsystem, or rollback mechanism.
- If the required production boundary is absent, the scenario remains blocked rather than being simulated by prompt text or mocks.


### NPC-SEM-029 — Need-based identity creation by an NPC

**Given** an NPC has a concrete in-world need for a new social cover and sufficient plausible means.

**When** the NPC creates the identity during play.

**Then**
- The new identity is retained as an additional card linked to the same underlying NPC, not as a new NPC/entity.
- Its origin is distinguishable from an author-authored identity.
- Unsupported biography, documents, contacts, and past events are not invented merely to complete the cover.
- The act of creating the card does not by itself establish canonical documents or disclose the identity to observers.

### NPC-SEM-030 — Inactive identities are retained, not erased

**Given** an NPC stops using a social identity.

**When** that identity becomes inactive.

**Then**
- Its card remains available as history and may be reactivated if circumstances permit.
- Inactive status does not mean forgotten, deleted, or unknown to observers who already learned about it.
- Deactivation does not undo past statements, events, evidence, or observer knowledge.

### NPC-SEM-031 — Identity edits preserve event history

**Given** an NPC has an existing social-identity card and a concrete reason to adapt its cover.

**When** the NPC revises the identity.

**Then**
- The revision is justified by current circumstances and available means.
- Previously spoken claims and committed events are not retroactively rewritten.
- Existing core history/revision mechanisms are reused; no identity-specific revision counter or parallel event log is added.
- Changed claims do not automatically rewrite canonical facts or other NPCs' knowledge.

### NPC-SEM-032 — Identity choice is autonomous but context-constrained

**Given** an NPC has multiple available social identities.

**When** it decides how to present itself in a scene.

**Then**
- It chooses based on its goals, character, knowledge, relationships, resources, and circumstances.
- Coercion, exposure, unavailable evidence, or other established events may constrain its options.
- Suspicion alone does not equal exposure, and reactivation does not erase an already compromised cover.
- The behavior remains a semantic requirement until a real runtime decision boundary exists.


## Relationship-state proposal cross-reference

The dedicated relationship-state contract proposal defines REL-001–012 in `docs/42-npc-relationship-state-contract-proposal.md`. These are proposed semantic acceptance scenarios, not executable tests. They cover asymmetry, unknown-versus-neutral, independent dimensions, evidence for changes, knowledge boundaries, references to people without NPC cards, read-only card summaries, causal rollback, independent support, attribution, and non-reciprocal inference. Reconcile these scenarios with the final core record/effect interface before implementing them; do not treat their presence here as runtime readiness.


## Authoring, correction, and card-summary cases

The detailed requirements and full Given/When/Then cases are specified in `docs/46-npc-authoring-correction-and-card-summary-contract.md`. The following case IDs must remain part of the NPC semantic acceptance set; they are not executable-test claims:

- **NPC-AUTH-001:** Profile correction does not rewrite canon.
- **NPC-AUTH-002:** Canonical correction does not teach every NPC or automatically rewrite belief.
- **NPC-AUTH-003:** Unknown/unset is not explicit neutral.
- **NPC-AUTH-004:** Withheld is not known absent.
- **NPC-AUTH-005:** Character-card summary is not a source of truth and must respect freshness.
- **NPC-AUTH-006:** Missing card entry does not prove nonexistence or lack of knowledge.
- **NPC-AUTH-007:** Author-reserved editorial secret stays outside unauthorized model input.
- **NPC-AUTH-008:** Author-mandated future outcome is not a committed event.
- **NPC-AUTH-009:** Social-identity claims are not canonical evidence.
- **NPC-AUTH-010:** Compact summaries preserve material uncertainty.

The implementation gate for each case is the real production boundary named in `docs/35-npc-test-boundary-map.md`. Do not replace a missing boundary with a mock and report it as an integration pass.


## Causal rollback/reconciliation acceptance cases

The detailed Given/When/Then definitions for NPC-CAUSE-001–008 are in `docs/47-npc-causal-rollback-reconciliation-test-matrix.md`. They cover required-cause invalidation, alternative independent support, loss of all support, a source committed after an earlier rollback, duplicate/non-independent sources, additional required dependencies, knowledge-source invalidation, and deterministic snapshot-safe replay.

These IDs are semantic acceptance targets, not executable tests. In particular, a later source must be tested as a separate operation after the first rollback/reconciliation has completed; a single batched scenario is insufficient evidence. Keep alternative-support cases blocked unless the core can prove source independence and domain sufficiency through the real production path.
