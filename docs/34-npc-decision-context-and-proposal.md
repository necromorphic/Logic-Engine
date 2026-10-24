# NPC Decision Context and Non-Committing Proposal — Stage 0.1

Status: design contract only, on `feat/npc-subsystem`. This document narrows the first NPC vertical slice. It does not authorize runtime, API, schema, persistence, prompt, or host-adapter changes.

## 1. Purpose

The first slice must prove one safe boundary:

> Given an explicitly prepared and validated decision context, an NPC decision step may return a bounded proposal without changing canonical world state.

This is deliberately smaller than a persistent autonomous NPC process. Following the core owner's later semantic decision in `docs/39`, the first supported knowledge path is narrower still: explicitly authorized `author_initial`/imported knowledge only, with provenance. Observation, communication, documents, inference, and rumor remain unsupported until their evidence paths are specified and tested. The slice does not implement durable goals, schedules, long-running plans, off-screen progression, or NPC-aware rollback reconciliation.

**Implementation gate: this first slice is blocked until the core owner explicitly approves and verifies the executable acquisition-record contract described in `docs/39-npc-core-knowledge-contract-proposal.md` §4.1.** That document is a proposal, not an approved or implemented runtime contract. The `author_initial`/imported path is the only scoped first-slice target, but it is not currently an available runtime capability. The core owner must approve the semantic contract and define/verify the trusted creation/read boundary using existing core identity, snapshot, provenance, and causal mechanisms before implementation begins. If the proposal is changed or rejected, this slice must be revised before implementation.

## 2. Ownership boundaries

| Concern | Owner | First-slice rule |
|---|---|---|
| Canonical world facts and current world state | Core | Read-only input; never inferred from generated prose |
| World time, event identity, revisions, causality and rollback | Core | No parallel implementation in the NPC subsystem |
| Stable character profile and author constraints | Character/profile layer | Inputs only; never silently overwritten by a proposal |
| Authoritative knowledge/acquisition and delivery records | Core architecture contract; runtime support must be verified | The NPC contract defines actor-relative semantics; the trusted caller selects a permitted decision-time subset from authoritative sources. If the core record/source is not implemented, the field is deferred—not recreated in an NPC-owned store |
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

When a check required for safe execution cannot be completed, the safe outcome is no executable proposal or `needs_review`, not speculative execution. This rule must not silently erase an explicit author-mandated outcome: retain that outcome as a required target, identify the unresolved check or missing rationale, and prepare only a bounded prospective path or a review result. The author instruction does not bypass higher-priority constraints, player agency, validation, approval, or commit requirements.

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

**Proceed with specification and test-boundary discovery only.** The core owner has since confirmed the knowledge ownership semantics and narrowed the first knowledge path to authorized author-initial/imported knowledge. The remaining gaps are production-interface and test-boundary gaps: actor/entity binding, source representation, context completeness/withholding, supported action mapping, and exact snapshot/input binding. The first slice remains a non-mutating contract—not autonomous runtime code.


## 10. Actor-relative context: what the current core does and does not establish

This section records a source-level boundary check. It is not a new core contract and does not claim that the fields below are implemented.

### 10.1 Observed current primitives

The inspected `src/application/engine.js` implementation of `registerContextManifest(...)` validates and records:

- `generation_id`;
- `base_world_revision` and `base_commit_sequence`;
- a normalized list of `items`, whose supported kinds are `entity`, `fact`, `event`, `entity_absence`, and `fact_absence`;
- an optional SHA-256 `content_hash` per item.

This is a reference manifest for a generation and world snapshot. The inspected validator does **not** accept an actor identity, an actor-specific permission decision, a knowledge-acquisition history, an actor belief, or an explicit completeness/access status for each requested information field. An explicit absence item is a world-reference type; by itself it does not prove that the actor knows the absence.

The inspected `ProposalService.create(...)` requires a trusted adapter identity and stages a pending proposal. Its validation metadata explicitly lists actor authorization and player-agency policy among the checks not performed there. This does not make the adapter identity equivalent to the NPC whose action is proposed.

These are source observations for the inspected branch revision. Re-check them before implementation if the core changes.

### 10.2 Field-by-field readiness

| Context concern | Current evidence in inspected core | NPC decision for the first slice |
|---|---|---|
| World identity and snapshot cursor | Manifest accepts world-scoped base revision and commit sequence | Reuse when supplied; reject stale/mismatched context through the existing core path where supported |
| Generation reference | Manifest accepts `generation_id` | Reuse as a correlation reference; do not assume it proves the exact model input was immutably bound unless that behavior is verified |
| Referenced entities/facts/events | Manifest accepts normalized typed references and optional content hashes | Treat as references only, not proof of actor knowledge or permission |
| Explicit entity/fact absence | Manifest has `entity_absence` and `fact_absence` kinds | Do not interpret omission as absence; do not interpret a reference as actor awareness |
| Acting NPC identity | Not represented by the inspected manifest item schema | Must come from a trusted caller/adapter input; exact field/API remains undecided |
| Actor-specific access/authorization | Not established by the inspected manifest validator or proposal semantic checks | If no trusted check exists, omit restricted content and fail closed for actions requiring authorization |
| Actor's knowledge acquisition | No acquisition provenance is established by the manifest itself | Do not create knowledge from retrieval or prompt inclusion |
| Actor belief, suspicion, or false belief | Not represented as distinct actor-relative states by the inspected manifest schema | Keep as a separate semantic input only if an authoritative source supplies it; otherwise mark unavailable |
| Known true vs known false vs unknown/incomplete | Manifest references do not provide a complete epistemic status model | Do not infer a negative from missing references; leave a blocked precondition unresolved |
| Inaccessible/withheld information | No per-actor withheld status is established by the inspected manifest schema | Enforce withholding before model input; do not send secrets for the model to self-filter |
| Decision purpose and allowed action set | Not a manifest guarantee | Must be bounded by the caller/decision contract; do not assume core validation enforces NPC-specific action policy |
| Player-agency restrictions | Explicitly outside the proposal service's listed semantic checks | Keep in the NPC/presentation contract; proposal validation alone cannot certify compliance |

### 10.3 Proposed preparation sequence (not implemented)

1. A trusted caller identifies the actor and the decision being requested.
2. It obtains the current world snapshot and explicit world time from existing authoritative sources where available.
3. It gathers candidate source material. Retrieval output remains untrusted.
4. A trusted validation step checks source validity, visibility/access, and whether the actor has a permitted path to the information. Anything it cannot verify is omitted from model-visible content.
5. It labels supplied information by epistemic status and origin: canonical fact, explicit absence, actor belief, uncertainty, or unresolved conflict. It never turns missing data into a negative claim.
6. It records context completeness separately from the current manifest unless and until the core approves an extension. The existing manifest must not be overloaded with invented semantics.
7. It binds the resulting decision input to the appropriate snapshot/generation reference using whatever binding guarantees the core actually provides; if exact binding is not proven, the limitation is explicit and the decision remains review-only where material.
8. The NPC decision step returns a bounded proposal or `no_action` / `needs_review`. Existing core validation and approval remain separate; successful staging is not authorization to act.

This sequence describes the responsibility boundary, not a requirement to add a new service. A future implementation may reuse an existing trusted caller if it can demonstrate these checks.

### 10.4 Minimal example: a secret appears in search

- Retrieval returns a document containing a secret.
- The fact that the document was retrieved proves only that a candidate was found.
- If source, visibility, and actor acquisition/access cannot be verified, the trusted preparation step excludes the secret from the model input.
- The context may record that the decision is incomplete or that the candidate was withheld, but must not reveal the secret itself through the status or rationale.
- The NPC cannot use the omitted secret as evidence. No knowledge record, world event, report, or state mutation is created by this preparation step.
- If an action can only be justified by that secret, the safe result is no proposal or `needs_review`.

### 10.5 Open decisions before executable tests

The following are intentionally unresolved, not hidden implementation assumptions:

1. Which existing caller is trusted to assemble actor-relative context, and how its identity/permissions are established.
2. The production source/API for actor-relative acquisition and belief is not verified in the inspected runtime. Core ownership is semantically confirmed; if the required source is not implemented, this slice must operate without inventing persistent NPC state or an NPC-owned substitute.
3. How to represent context completeness and withheld information without conflating it with core world absence.
4. What exact binding exists between `generation_id`, the manifest, and the bytes actually sent to the model on the target branch.
5. Which actions require actor capability/authorization checks, and which trusted component owns those checks.
6. How the caller communicates a blocked decision without accidentally leaking restricted content.
7. Which of these guarantees can be proven at a real boundary and therefore deserve executable tests.

Core dependency refresh (2026-10-24): `main` now includes the opt-in `evaluateConditionResult(...)` tri-state API, the bounded `LogicEngine.getSnapshot(...)` read, and the mechanic/context snapshot extension (PRs #45, #46, and #49; current main `8602a9ed41f13f536d87b1103a02e8fd12de3b03`, Runtime tests #378 passed). This removes the former assumption that no tri-state primitive exists, but does not resolve the actor-specific questions above. Until those questions have evidence-backed answers, keep the remaining items as design acceptance criteria. Do not add tests that assume a complete NPC actor filter, a new knowledge store, actor authorization inside `ProposalService`, or a new manifest schema. Any tri-state tests must use the real `evaluateConditionResult(...)` API and must not claim that it authenticates context or proves actor access.


### 10.6 Author-mandated outcomes and causal preparation

The author-confirmed rule in `docs/31-npc-subsystem-contract.md` applies to this decision-context slice, but it does not turn a proposal into a committed action or weaken core validation.

- If the author directly requires an outcome compatible with higher-priority constraints and player agency, preserve it as a mandatory target. Do not silently discard it because an NPC's ordinary preferences would point elsewhere.
- First evaluate established motives, relationships, evidence, goals, pressures, commitments, and circumstances.
- If those do not support a plausible path, the decision step may identify or propose new future circumstances/actions as prospective steps. They remain proposals until the normal supported core path validates and commits them.
- Never invent prior events, evidence, promises, or hidden motives as established facts to retrofit a cause.
- If no credible path can yet be grounded, return `needs_review` with the required outcome and missing rationale preserved. Do not convert the missing rationale into an unmarked cancellation or fabricate a causal explanation.
- The author-mandated outcome fixes the required destination, not unspecified intermediate actions. NPC autonomy remains for the path between the current state and that destination. No step may author the player's voluntary action, dialogue, internal state, consent, or unprovided reaction.

This remains a semantic requirement, not a feature claim. The current first slice has no verified causal planner or author-intent arbitration implementation. Acceptance coverage is in NPC-SEM-013 and NPC-SEM-014; both remain blocked until a real production boundary can be tested.


### 10.7 Knowledge ownership versus context preparation

The repository's architecture baseline assigns authoritative knowledge records and delivery statuses to the core. This NPC contract does not transfer that ownership to a prompt adapter or create an NPC-side substitute. The responsibilities are distinct:

- **Core (target architecture):** owns authoritative world/knowledge/delivery records, their provenance, and supported validation/causal semantics. The current runtime audit has not verified a complete NPC knowledge/acquisition API or persistent belief model.
- **Trusted context-preparation caller:** selects and filters the information that may enter this particular decision input, using verified source/access rules. It does not turn retrieval into acquisition, invent a missing authoritative record, or become the canonical owner of knowledge.
- **NPC decision step:** reasons over the supplied bounded context and may propose a belief-dependent action; it does not persist beliefs or grant itself knowledge merely by generating text.

Until the core exposes the required authoritative source and a trusted context boundary is agreed, acquisition-sensitive decisions remain blocked or review-only. Do not introduce a parallel knowledge store or change the core ownership contract from the NPC branch.
