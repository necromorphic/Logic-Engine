# NPC Decision Context and Non-Committing Proposal — Stage 0.1

Status: design contract only, on `feat/npc-subsystem`. This document narrows the first NPC vertical slice. It does not authorize runtime, API, schema, persistence, prompt, or host-adapter changes.

## 1. Purpose

The first slice must prove one safe boundary:

> Given an explicitly prepared and validated decision context, an NPC decision step may return a bounded proposal without changing canonical world state.

This is deliberately smaller than a persistent autonomous NPC process. It does not yet implement durable goals, schedules, long-running plans, knowledge storage, off-screen progression, or rollback reconciliation.

## 2. Ownership boundaries

| Concern | Owner | First-slice rule |
|---|---|---|
| Canonical world facts and current world state | Core | Read-only input; never inferred from generated prose |
| World time, event identity, revisions, causality and rollback | Core | No parallel implementation in the NPC subsystem |
| Stable character profile and author constraints | Character/profile layer | Inputs only; never silently overwritten by a proposal |
| NPC-specific knowledge and beliefs | NPC domain contract / future runtime | Must be distinguished from canonical truth; this slice does not invent a store |
| Information access and source validity | Existing trusted access/visibility boundary, once verified | Retrieval alone is never authorization |
| Decision context preparation | Trusted caller/adapter, under a separately defined contract | Must declare what was included, excluded, inaccessible, or incomplete |
| Decision reasoning and candidate action | NPC decision step | May return a proposal only |
| Effect validation and commit | Core's supported validation/event path | No commit path is implemented by this document |
| Narrative delivery | Host/presentation layer | Cannot turn a proposal into an event or knowledge transfer |

If an owner or trusted service for a required field cannot be identified, the field is unavailable—not something the NPC model may fill in by guessing.

## 3. Decision context envelope

The context supplied to a decision step is an input envelope, not a new source of truth. Conceptual fields:

- **actor reference**: stable identifier for the acting NPC, supplied by trusted code;
- **world snapshot reference**: identity/revision/cursor supplied by the existing core if available; do not fabricate one if the caller cannot provide it;
- **world-time value**: explicit in-world time, if available; chat-turn count and operating-system time are not substitutes;
- **profile constraints**: only the profile data intentionally provided for this decision;
- **permitted facts**: facts the actor may use for this decision, each with a source reference and declared epistemic status;
- **actor knowledge/beliefs**: only when supplied by an authoritative NPC-state source; label truth, belief, suspicion and uncertainty distinctly;
- **access/completeness manifest**: which requested fields were provided, known absent, withheld by access rules, or unavailable because the context is incomplete;
- **decision purpose and bounds**: the question being decided and the kinds of proposal allowed;
- **viewpoint/player-agency constraints**: actions and narrative claims the model is forbidden to author on behalf of the player.

These are semantic fields, not an approved JSON schema or public API. Exact types and integration sources are deferred.

### 3.1 Required epistemic distinctions

A consumer must not collapse these states:

1. **Known true** — supported as true in the relevant authoritative source.
2. **Known false** — the relevant source explicitly supports the negative result.
3. **Unknown / incomplete** — evidence or required context is missing.
4. **Inaccessible / withheld** — the information exists or may exist but must not be exposed to this actor or decision.
5. **Actor believes P** — a claim in the NPC's belief state, which may conflict with canonical truth.
6. **Retrieved candidate** — text returned by search or retrieval but not yet authorized or established as the actor's knowledge.

Unknown is not false. Inaccessible is not evidence of non-existence. Retrieved candidate is not knowledge. A false belief is not automatically corrected by canonical truth.

### 3.2 Context admission rules

- Context preparation happens before the model receives the decision input.
- A retrieved fragment is admitted only after its source, access, visibility, validity, and permitted use have been checked by a trusted component.
- If the current code cannot establish those checks, omit the fragment.
- Do not include a secret and rely on the model to ignore it.
- Do not add a knowledge record merely because a fact appeared in a prompt, search result, or generated explanation.
- A field marked incomplete cannot be treated as a confirmed negative in precondition checks.
- Conflicting sources remain a conflict unless an existing authority rule resolves them.
- No new access-control subsystem is introduced here.

## 4. Proposal envelope

A decision step may return one proposal or an explicit no-action / needs-review result. The conceptual proposal contains:

- acting NPC reference;
- decision-context/snapshot reference, when supplied by the caller;
- proposed action intent in a bounded, declared vocabulary;
- the facts or source references the proposal relies on;
- required preconditions and assumptions;
- uncertainty or missing prerequisites;
- a disposition: `proposed`, `no_action`, or `needs_review`;
- a concise rationale suitable for diagnostics, not as proof that the action is valid.

This is a semantic contract, not a schema. It does not define a new canonical event, event ID, revision, persistent record, or externally callable API.

### 4.1 Non-commit guarantee

Producing a proposal must not:

- change canonical world state;
- advance world time;
- create a canonical event or claim that an event occurred;
- grant or persist NPC knowledge;
- change goals, plans, relationships, resources, inventory, or commitments;
- deliver a report to another NPC or the player;
- author a voluntary player action, dialogue, thought, feeling, intention, consent, or response.

A proposal may be rejected, superseded, or sent for adjudication. It becomes an action only after the existing core path validates and commits the relevant effect. If no supported effect mapping exists, return `needs_review` rather than inventing a mapping.

### 4.2 Existing core infrastructure to reuse, not duplicate

The current core already has two relevant primitives:

- `LogicEngine.registerContextManifest(...)` records a generation reference, base world revision, base commit sequence, and a normalized list of referenced world items (entities, facts, events, and explicit absences).
- `ProposalService.create(...)` stages a pending event proposal, records its base revision/commit sequence, runs supported payload/effect/reference validation, and writes proposal/audit records. It does not immediately commit the canonical event; approval and a separate commit operation are required.

These primitives are **not sufficient on their own** for an NPC decision context. The manifest does not prove actor-specific knowledge or permission. The proposal service explicitly leaves semantic alignment with source text, causal completeness, actor authorization, and player-agency policy unchecked. Its proposal/audit rows are persistent workflow records, but they are not the same as a canonical world event.

Therefore:

- evaluate these existing services as the preferred integration boundary before proposing any new API or storage;
- do not duplicate proposal persistence, world-revision cursors, or context-manifest storage in the NPC subsystem;
- keep a proposal in manual review if the NPC-specific authorization and narrative/player-agency checks cannot be proven;
- do not interpret successful payload validation as approval of the proposed meaning or as permission for the actor to perform it.

## 5. Validation and fail-closed behavior

Before a proposal can be considered for commitment, the caller/core must be able to check:

1. the actor reference is valid;
2. the context is from the intended snapshot/time, where those identifiers exist;
3. every required precondition has sufficient, permitted evidence;
4. unknown/incomplete inputs are not mistaken for false or true;
5. the proposed action belongs to the declared action vocabulary;
6. actor capability, access, timing, world rules and player-agency constraints are satisfied;
7. the effect maps to an existing supported core operation;
8. no partial mutation occurs on rejection.

The NPC decision step itself does not replace core validation. Model confidence, a fluent rationale, retrieved text, or narrative assertion cannot satisfy a failed check.

When a check cannot be completed, the safe outcome is no proposal or `needs_review`, not speculative execution.

## 6. First-slice scenarios

These cases are the proposed acceptance contract. They are not executable tests until a real implementation boundary exists.

### NPC-CTX-001 — Retrieved secret is withheld

**Given** a search result contains a secret, but the actor has no authorized acquisition path.

**When** the trusted context is prepared.

**Then** the secret is absent from the model-visible context; the retrieval result does not create actor knowledge; no state changes.

### NPC-CTX-002 — Missing context remains unknown

**Given** a required capability or precondition field is missing because the context is incomplete.

**When** an action requiring that field is proposed.

**Then** the field is not treated as a proven negative or positive; the result is `needs_review` or no action.

### NPC-CTX-003 — False belief remains actor-relative

**Given** canonical truth contradicts an explicitly supplied actor belief and no corrective evidence was delivered.

**When** the NPC decides.

**Then** the context keeps canonical truth and actor belief distinct; the decision may reflect the belief where otherwise valid, without rewriting canonical truth.

### NPC-CTX-004 — Failed precondition cannot commit

**Given** an action requires a condition that is known false.

**When** the proposal is validated.

**Then** the proposal is rejected or reviewed under the declared rule; no part of the action is committed.

### NPC-CTX-005 — Proposal does not mutate state

**Given** a valid-looking candidate action is returned.

**When** the decision step completes without invoking a supported core commit operation.

**Then** canonical state, world time, events, NPC knowledge, and player awareness remain unchanged.

### NPC-CTX-006 — Unsupported effect is not guessed

**Given** a proposed domain intent has no verified mapping to an existing core effect.

**When** the proposal is validated.

**Then** it is marked unsupported/needs review; the subsystem does not add an effect kind or translate it by guesswork.

### NPC-CTX-007 — Player agency is preserved

**Given** an NPC proposal creates an opportunity for the player to respond.

**When** a narrative adapter describes the result.

**Then** it may describe the NPC action after validation, but does not supply the player's voluntary response.

### NPC-CTX-008 — Chat turns do not advance world time

**Given** world time and simulation triggers have not advanced.

**When** multiple model/chat turns occur.

**Then** no time-based NPC progress or event is inferred solely from those turns.

## 7. Explicit non-goals

This slice does not implement:

- persistent NPC runtime state or a new knowledge store;
- a scheduler, process manager, background worker, or off-screen simulation loop;
- new database tables, SQLite changes, or storage migrations;
- new public API endpoints or changes to existing API contracts;
- changes to `evaluateCondition` or global rule semantics;
- new core effect kinds or speculative mappings for mechanic-level vocabulary;
- a parallel event log, revision counter, causality graph, rollback engine, or access-control layer;
- vectorization, retrieval configuration, prompts, SillyTavern integration, or character-card projection changes;
- claims of rollback safety beyond the core's verified current guarantees.

## 8. Exit criteria before runtime work

Runtime implementation should not begin until all of the following are evidenced:

- a real, trusted source for actor identity and permitted context is identified;
- the existing context-manifest and generic proposal services have been checked as candidate infrastructure, without duplicating their persistence/cursors;
- snapshot/time identity can be supplied or its absence is handled explicitly;
- completeness/access status can distinguish known false from unknown and withheld;
- the proposal action vocabulary is mapped to existing core operations, with unsupported cases listed;
- the eight scenarios above have executable tests against real boundaries, not a mock that merely repeats the contract;
- the test suite is run in an environment with the repository's required Node version;
- any missing core primitive is documented as a dependency rather than simulated in the NPC layer.

## 9. Current decision

**Proceed with specification and test-boundary discovery only.** The readiness audit found material gaps in context completeness, effect mapping, and rollback guarantees. Until those gaps are closed, the correct first vertical slice is a non-mutating contract—not autonomous runtime code.
