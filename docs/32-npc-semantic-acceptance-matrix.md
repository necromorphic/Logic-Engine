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
