# NPC Goal and Action Contracts — Isolated Design Proposal

**Status:** proposal only; coordinator approved the existing mechanic-evaluation seam for design only. A concrete semantic NPC action and trusted actor/action authorization remain BLOCKED; E = APPROVED for isolated NPC-only contracts.
**Scope:** semantic contract and acceptance criteria. This is not an executable schema, public API, runtime implementation, or authorization to integrate blocks.
**Related work:** PR #532 (pure NPC helpers, open/draft); PR #535 (contract inventory, open/draft); `docs/31-npc-subsystem-contract.md`; `docs/34-npc-decision-context-and-proposal.md`.

## 1. Decision boundary

This proposal defines the information an NPC-owned goal/action contract would need to express. It does not assert that all fields have existing production sources.

- **NPC subsystem:** may propose goals, maintain NPC-local goal/plan state, select among explicitly supplied eligible candidates, and return a bounded non-committing intention/proposal.
- **Core:** remains authoritative for canonical world state, game time, revisions, causal provenance, policy-filtered reads, validation, proposal lifecycle, commit, rollback and supported effects.
- **Personality / Relationships:** remain owners of their semantics. Their runtime handoff into a combined NPC decision context is not confirmed by this proposal.
- **Trusted caller:** must identify the acting NPC, assemble the bounded decision context, and bind it to the relevant snapshot. The exact composite caller is **UNCONFIRMED / BLOCKED**.
- **Model output:** is a proposal, not proof of truth, permission, action success, knowledge acquisition, or a committed event.

No subsystem may create a parallel canonical world log, revision cursor, causality graph, permission system, or authoritative knowledge store.

## 2. Source inventory and readiness

| Input / capability | Evidence currently identified | Contract status |
|---|---|---|
| Acting NPC identity | Core actor bindings and actor-bound authorized reads are documented in `docs/20-minimal-runtime.md`; `docs/34-npc-decision-context-and-proposal.md` describes the trusted caller boundary. | Existing primitives are not by themselves a complete NPC decision-context contract. Exact binding through the whole decision is **UNCONFIRMED**. |
| World state and snapshot | Core snapshot/context-manifest primitives are described in `docs/34-npc-decision-context-and-proposal.md`. | Reuse existing Core references when available; do not invent a parallel revision. Exact binding of model input to snapshot must be verified. |
| World rules / action effects | `src/core/rules.js` exports legacy Boolean `evaluateCondition(...)` and opt-in tri-state `evaluateConditionResult(...)`; `src/core/mechanics.js` validates mechanic contracts; `src/core/mechanic-effect-translator.js` translates a bounded mechanic-intent vocabulary; `src/application/proposals.js` validates supported proposal effects and requires explicit approval before commit. | These are distinct layers. Tri-state evaluation does not prove access/completeness; mechanic intents are not automatically NPC action candidates; proposal validation explicitly does not check actor authorization, player agency, causal completeness, or semantic alignment. |
| Personality / Relationships | Semantic ownership is documented in `docs/31-npc-subsystem-contract.md` and the Personality semantics documentation cited by PR #535. | NPC-facing read path and field-level contract **UNCONFIRMED / BLOCKED**. |
| NPC goal lifecycle / intention / plan progress | Pure helpers are proposed in open draft PR #532. | Helpers consume supplied data; they do not generate goals/candidates, persist state, verify outcomes, or execute actions. |
| Candidate discovery and precondition evaluation | `MechanicExecutor.evaluate(...)` evaluates a caller-supplied action ID from an enabled instance's pinned template, checks declared conditions using a trusted same-snapshot context provider, and returns a non-committing result. `tests/mechanic-executor.test.js` and `tests/mechanic-core-integration.test.js` describe coverage. | A generic bounded mechanic-action evaluation seam exists and the coordinator approved it as the first technical candidate for design. NPC-specific candidate enumeration/selection, actor/action authorization, and dispatch remain **UNCONFIRMED / BLOCKED**. No concrete semantic NPC action family has been selected or evidenced. |
| Authoritative action result | `POST /v1/worlds/:world_id/proposals` creates a durable `pending` proposal; `/approve` requires the separate approval credential and current snapshot; `/commit` commits only an approved proposal after a stale-snapshot check; `/cancel` is adapter-owned. `src/application/proposals.js` records validation limits. | This is a real generic event-proposal route, not an NPC-specific executor. Explicit approval is required; adapter identity is not in-world NPC authorization. The full NPC proposal-to-result-to-plan-reconciliation path is **UNCONFIRMED / BLOCKED**. |

### Concrete existing action-evaluation candidate (not yet an NPC action family approval)

`src/application/mechanic-executor.js::MechanicExecutor.evaluate({ worldId, instanceId, actionId, input })` is a real, bounded, read-only action-evaluation path. It looks up a caller-supplied `actionId` in an enabled mechanic instance's exact pinned template, checks the snapshot, requires a trusted context provider, verifies same-snapshot dependency evidence, evaluates applicability/preconditions/constraints with `evaluateMechanicActionConditions(...)`, translates supported mechanic effect intents, and returns a structured `ready`, `no_match`, `unknown`, or `rejected` result without committing world state. `ProposalService.createFromMechanicEvaluation(...)` accepts only an attested ready result and hands it into the existing pending-proposal lifecycle; normal approval and commit remain separate.

This is the **coordinator-approved technical seam for design only**, not proof that NPCs can discover or autonomously select actions or that a semantic action family is approved. The caller must already know the `instanceId` and `actionId`; no NPC-specific enumerator chooses among actions. The slice rejects non-empty action inputs, required capabilities without a grant contract, rule modules, non-manual conflict policy, participant selection/interactions, and unsupported effect intents. It does not supply NPC goal admissibility, NPC-specific actor authorization, Personality/Relationships context, a dispatcher, or plan reconciliation. Do not mark a first NPC action family approved without one evidenced production template/action and a verified actor/purpose policy for the NPC caller.

Source/test evidence inspected: `tests/mechanic-executor.test.js` covers pinned instances/templates, trusted context, unknown conditions, unsupported inputs/capabilities, snapshot freshness, dependency evidence, policy freshness, stale proposals, proposal handoff, rollback/recovery, and non-commit behavior; `tests/mechanic-core-integration.test.js` covers use of the ordinary Core proposal/commit path and no writes during evaluation/proposal/approval. These test names establish intended coverage in source, not that this review reran the suite.

### Additional observed Core boundaries relevant to the contract

- `LogicEngine.getSnapshot(...)` provides a bounded, transaction-consistent canonical read. It is not itself an actor-authorized model context.
- `evaluateConditionResult(...)` can preserve `unknown` for missing paths unless a trusted caller supplies `knownAbsentPaths`; that option is a caller assertion and must be derived from the same consistent, authorized snapshot. It is not access control or a completeness proof.
- `POST /v1/worlds/:world_id/authorized-read` uses a configured adapter identity and a trusted field policy. This bounded read does not establish a complete Personality/Relationships feed or general NPC knowledge model.
- Generic proposals are stored as `pending`; the current API requires explicit approval for every event. The validation record explicitly lists `semantic_alignment_with_source_text`, `causal_completeness`, `actor_authorization`, and `player_agency_policy` as not checked.
- The existing mechanic-intent translator supports only its declared intent vocabulary and maps into existing effect kinds. This does not establish that an NPC action family has a trusted candidate source or that an NPC is permitted to request those effects.

These are observed reusable primitives with limits, not an approved integrated NPC contract.

## 3. Conceptual goal contract (not a wire schema)

A goal record, if later approved and implemented, should carry at least these semantic elements:

- **Stable goal identity** within the owning NPC's domain.
- **Owner NPC reference** supplied by trusted code; never inferred from name, appearance, prompt text, or model output.
- **Desired condition**, stated as a target rather than a guaranteed future event.
- **Origin / provenance**: author instruction, explicit caller input, or a supported observation/event reference. Unknown origin is not silently filled in.
- **Evidence and snapshot references** used when the goal was proposed or last evaluated, if the existing Core can provide them.
- **Admissibility status**: accepted, rejected, or unresolved/review-required. The authoritative admissibility owner and policy are not yet identified.
- **Priority and conflict status** only where supplied by an approved policy or explicit authored rule. Do not invent a universal priority order.
- **Lifecycle status** and explicit transition reason. Completed/abandoned terminal behavior follows the helper proposal in PR #532, subject to review.
- **Uncertainty / missing dependencies**, so absent context is not misrepresented as a negative fact.
- **Revision / stale-context marker**, if supported by an existing authoritative source; do not add a parallel world revision.

Goal generation may use world facts, rules, Personality and Relationships **only through confirmed and authorized interfaces**. If a required source, access decision, owner, or snapshot binding is unavailable, return unresolved/no goal or request review. Do not fabricate a substitute source.

## 4. Conceptual action-candidate contract (not a wire schema)

An action candidate, if later supplied by an approved caller, should identify:

- **Candidate identity and action family** from an explicitly allowed vocabulary.
- **Acting NPC reference** and **world/snapshot reference** for which the candidate was evaluated.
- **Originating source** and provenance for the candidate.
- **Required preconditions**, the evidence used for each, and the identity of the trusted evaluator.
- **Eligibility result** that distinguishes eligible, known-ineligible, and unknown/unverifiable. A boolean alone can conceal uncertainty.
- **Capability / access / rule checks** only when their authoritative owner and semantics are identified.
- **Supported effect mapping**, if one exists, to an existing Core operation. Unknown mappings are unsupported; they must not be guessed.
- **Expiry/staleness condition** or an explicit statement that freshness could not be established.
- **Bounded proposal payload** that does not itself mutate state.

The selector may choose only among caller-supplied candidates that have passed the approved eligibility checks. A field such as `preconditions_met: true` is trustworthy only if its caller and evaluator are trusted and its evidence is bound to the relevant snapshot. The selector is not the evaluator.

**Concrete candidate for coordinator review:** a single action declared in an enabled, pinned mechanic template, restricted to the existing `MechanicExecutor` slice. The source of action definitions, precondition evaluator, effect-intent translator, and generic proposal handoff now have source-level evidence. However, `actionId` is supplied by the caller rather than discovered by an NPC dispatcher, and the end-to-end NPC actor/purpose authorization path is not established. Therefore the technical evaluation seam is approved for design, but the first semantic NPC action family remains **BLOCKED pending a concrete template/action and confirmation of the trusted NPC caller/policy**.

## 5. Provenance, snapshot and NPC binding requirements

Before a contract can be implemented, reviewers must identify how the following are supplied and checked through the entire decision:

1. Authenticated/trusted caller identity.
2. Stable acting-NPC identity and the permitted relationship between caller and actor.
3. World identity and canonical snapshot/revision cursor.
4. Explicit in-world time where relevant; chat-turn count and OS wall-clock time are not substitutes.
5. Origin references for world facts, profile/relationship inputs and candidate actions.
6. Access/visibility decision and epistemic status for each model-visible fact.
7. Completeness status: present, known absent, unknown/incomplete, or withheld/inaccessible. Omission must not be interpreted as a negative fact.
8. The decision's allowed purpose and action family.
9. Whether the decision result is stale before it is passed to any existing Core validation path.
10. An authoritative action result that is separate from the NPC's own claim of success.

Existing context manifests and proposal records should be reused where they actually provide the needed guarantees. They must not be overloaded with actor authorization or completeness semantics they do not currently guarantee. No new shared field, schema, API, storage or service is authorized here.

## 6. Fail-closed outcomes

The conceptual contract must be able to return a bounded non-action result such as:

- `no_action`: no candidate/goal is currently eligible, with no claim that missing data is false;
- `needs_review`: a material dependency, authority check, action mapping, or evidence is unresolved;
- `stale_context`: the relevant snapshot is no longer current, where an existing revision check can establish this;
- `unsupported`: no approved action/effect mapping exists;
- `proposal`: a bounded candidate for separate validation, never a committed result.

These are semantic outcome labels for review, **not approved enum values or API fields**. Exact vocabulary must be aligned with existing contracts before implementation.

Fail closed when actor binding, access, provenance, snapshot relevance, admissibility ownership, precondition evaluation, or effect mapping cannot be proven. Do not leak withheld details through the error or rationale. Preserve explicit author-mandated outcomes as targets where applicable, but do not bypass validation, approval, player-agency limits, or higher-priority constraints.

## 7. Acceptance criteria before implementation

The contract is ready for implementation review only when all are satisfied:

- [ ] A real source and owner are named for each input category: world, rules, Personality, Relationships and NPC-local state.
- [ ] The trusted caller and actor-binding path are identified and tested.
- [ ] Snapshot/revision and staleness guarantees are documented against the actual Core implementation.
- [ ] Goal admissibility has an identified authoritative owner and conflict policy.
- [ ] One action family is selected by review, with source, precondition evaluator, effect mapping and result route all evidenced.
- [ ] Unknown, withheld, absent and known-false states are distinguishable.
- [ ] Goal and candidate provenance can be traced without creating parallel canonical storage.
- [ ] Unsupported or stale candidates cannot reach commit.
- [ ] Tests exercise real boundaries, not only mocks that repeat this proposal.
- [ ] Changes to Core, Host/Adapter, Memory Provider, shared API/schema/storage, or Personality/Relationships have separate explicit approval.

## 8. Required review questions

1. Who owns goal admissibility, and which approved policy determines allowed goal categories and conflict handling?
2. Which exact interfaces provide Personality and Relationships inputs to the NPC decision context?
3. Which action family, if any, should be first? Identify its candidate source, precondition evaluator, supported effect mapping, and authoritative result route.
4. Which source supplies a snapshot-bound actor/NPC identity through candidate evaluation and proposal validation?
5. Which exact tests are required to prove the end-to-end boundary?

Until those answers are evidenced, mark unresolved dependencies **UNCONFIRMED / BLOCKED**. This document authorizes design clarification only, not implementation or execution.

## 9. Explicit non-goals

- No runtime implementation or automatic NPC invocation.
- No action execution, world mutation, new effect kind, or bypass of Core validation/approval.
- No background worker, scheduler, queue, new process semantics, or persistent NPC store within this isolated proposal slice. The blanket no-store limitation is superseded only for NPC-local goal/plan/task-progress state by the later A1 decision in `docs/97` and the design contract in `docs/98`; it remains in force for knowledge/acquisition/belief/delivery and does not authorize a dispatcher or autonomous execution.
- No changes to Host/Adapter, Core, Memory Provider, shared APIs, schemas, storage, Personality or Relationships.
- No enablement of Memory → NPC; it remains **DISABLED / FAIL-CLOSED**.
- No merge of PR #532, #535 or #536 is requested or implied.


## 10. Coordinator decision and next implementation gate (2026-10-28)

The coordinator has answered the three questions in [PR #537 comment](https://github.com/necromorphic/Logic-Engine/pull/537#issuecomment-6455273246):

- **Approved for design:** use the existing MechanicExecutor.evaluate(...) → ProposalService.createFromMechanicEvaluation(...) seam as the first *technical candidate*. This does not select a semantic NPC action family and does not authorize runtime implementation.
- **Still blocked:** the trusted NPC caller/action-authorization contract. Existing adapter-to-actor binding and purpose-filtered reads are useful primitives, but they do not by themselves prove that this NPC is permitted to request this particular action for this purpose.
- **Result boundary confirmed:** read-only evaluation and creation of an ordinary pending proposal only. No automatic approve/commit, canonical world mutation, or automatic NPC plan update. Plan reconciliation would require a separate future contract based on an authoritative result.
- **Unchanged guardrails:** no runtime implementation, new API/schema/storage, dispatcher/worker/scheduler, or cross-boundary changes. Memory → NPC remains DISABLED / FAIL-CLOSED.

### Action-family inventory result

The source search found the generic translator currently supports only create_entity, update_attribute, and assert_fact mechanic intents in this execution slice. The executor test fixture's action_id: "wait" creates a new character entity; it is a test fixture, not evidence of a meaningful production NPC action. No production World Pack/mechanic template with a semantically defined NPC action was identified in the reviewed repository paths.

Therefore **do not choose an action ID or effect target by guessing from test fixtures**. Before implementation, the next evidence package must name one actual enabled/pinned template and one declared action, then trace:
1. its authored source and intended in-world meaning;
2. its exact preconditions and same-snapshot context dependencies;
3. its supported effect intent and target semantics;
4. the trusted actor/purpose authorization decision for this NPC;
5. the pending-proposal handoff and the authoritative result source after a separately authorized commit.

Until that concrete template/action and the NPC action-authorization contract are evidenced, the first technical seam is approved for design but the first semantic action slice and runtime implementation remain **BLOCKED**.

## 11. First semantic action contract: `observe` (design only, 2026-10-28)

**Decision:** coordinator-approved for contract design only. This section does not make `observe` executable and does not authorize runtime integration.

### 11.1 Meaning and boundary

`observe` means: an NPC attempts to obtain a fact about one explicitly identified target. It is an information-acquisition attempt, not a claim that the NPC successfully saw, learned, or proved anything.

The action must be read-only with respect to canonical world state. It must not create/update world entities, assert a canonical fact, advance time, create a committed event, grant durable NPC knowledge, or update an NPC goal/plan. A generated sentence such as “I saw X” is not evidence that observation occurred.

The target must be explicitly supplied by trusted input and validated against the exact pinned, trusted snapshot used for the decision. Do not resolve an ambiguous target by model guesswork. A missing, malformed, ambiguous, stale, or out-of-scope target yields a bounded `unknown/denied` outcome and no asserted fact.

### 11.2 Evidence and epistemic result

A successful observation can be considered for a knowledge proposal only if all of the following are established by trusted code:

1. A specific authoritative evidence source is identified.
2. The source is valid for the target and the current pinned snapshot.
3. Access/visibility policy explicitly permits this NPC, target/scope, action family `observe`, and decision purpose.
4. The evidence is sufficiently unambiguous to support the exact proposed claim.
5. The source and snapshot references can be preserved as provenance for independent validation.

Model-generated text, retrieved text not yet validated, prompt inclusion, a target's mere existence, or a test fixture is not evidence. No inference may be silently substituted for direct observation. If the source contract does not distinguish direct observation from other evidence types, return `unknown/denied` or `needs_review`; do not relabel inference as observation.

Outcomes are conceptual labels, not approved API enum values:

- `observed_candidate`: trusted evidence supports a bounded claim, with source and snapshot references; this is not yet durable NPC knowledge.
- `unknown`: evidence is absent, incomplete, ambiguous, stale, or cannot establish the claim.
- `denied`: the explicit authorization check fails or the requested source/target/purpose is outside the allowlist.
- `needs_review`: a required semantic owner, evidence type, or safe mapping is unresolved.

Do not reveal withheld source details in a denial rationale. Unknown/inaccessible must not be converted into known-false.

### 11.3 Authorization

Authorization is an explicit allowlist and defaults to deny. A decision must cover the acting NPC, action family, target/scope, permitted purpose, and the evidence source or source class where applicable. Each decision must be current and bound to the same relevant snapshot/context.

Identity binding, adapter identity, `instanceId`, `actionId`, a successful authorized read, or possession of a reference does not grant permission to perform `observe` or to acquire the returned information. Missing, stale, ambiguous, or mismatched authorization denies. The authorization owner and runtime contract remain unimplemented/unassigned; this paragraph records required semantics only.

### 11.4 Knowledge proposal and Core proposal/effect boundary

A supported observation result may be submitted for consideration as an ordinary knowledge proposal only after the authoritative evidence, authorization, provenance, and effect mapping are independently validated. Any such proposal remains `pending`; separate existing approval and commit requirements continue to apply. No automatic approval, commit, or NPC plan reconciliation is permitted.

**Important compatibility finding:** the current reviewed mechanic-intent translator documents only `create_entity`, `update_attribute`, and `assert_fact` in its supported slice. The illustrative World Pack `propose_knowledge` intent in `docs/04-world-pack-format.md` is explicitly not an executable contract. The current `docs/34-npc-decision-context-and-proposal.md` also says observation remains unsupported until its evidence path is specified and tested. Therefore this proposal does **not** claim that `observe` or a knowledge-proposal effect can currently pass through `MechanicExecutor.evaluate(...)` → `ProposalService.createFromMechanicEvaluation(...)`. The existing seam is a design reference only; a real supported mapping and source contract must be evidenced before implementation is considered.

Generic proposal validation does not establish NPC actor authorization or semantic alignment with the source. Do not treat a `pending` proposal as evidence that observation occurred or that knowledge was acquired. For any future committed proposal, the authoritative outcome must be correlated to the Core-owned committed result/event record and audit trail; model output, NPC response, or proposal status alone is insufficient. A future plan-reconciliation consumer remains separately blocked.

### 11.5 Negative-test and acceptance matrix (required before implementation review)

These are required test cases for a future implementation; **they were not run by this documentation change**.

| Case | Required expected behavior |
|---|---|
| Target missing, malformed, or wrong type | Reject/unknown; no fact, proposal, or state mutation |
| Target reference is ambiguous or does not resolve in the pinned snapshot | Unknown/denied; do not guess a target |
| Target resolves only in a newer/different snapshot | Stale-context outcome; no claim from the mismatched snapshot |
| NPC is not on the allowlist for `observe` | Deny by default |
| Action family, target/scope, purpose, or source is absent/mismatched in authorization | Deny; identity or read access must not substitute |
| Authorization record is stale, ambiguous, or cannot be verified | Deny |
| Evidence source is absent or unavailable | Unknown; do not assert a fact |
| Evidence is ambiguous, conflicting, incomplete, or cannot support the exact claim | Unknown/needs review; preserve uncertainty |
| Evidence is retrieved/generated text without authoritative validation | Do not treat it as evidence or NPC knowledge |
| Evidence is stale or not bound to the decision snapshot | Unknown/stale; no proposal |
| Source access is forbidden or source is withheld | Deny without leaking protected details |
| Evidence supports a different claim from the model's wording | Reject the unsupported wording; do not broaden the evidence |
| Observation evaluation completes | Canonical world state, world revision/time, event log, NPC knowledge, goals, and plans remain unchanged |
| A supported evidence-backed knowledge proposal is eventually permitted by a separately approved mapping | Create ordinary `pending` proposal only; no auto-approval/commit and no knowledge grant |
| Proposal validation/approval/commit fails or snapshot becomes stale | No committed knowledge claim; preserve failure/unknown state |
| Later commit succeeds | Consumer must correlate to the Core-owned committed result/event and audit record; do not reconcile from model output or proposal status alone |
| Duplicate/replayed result is presented to a future consumer | Do not assume idempotency; plan reconciliation remains disabled until its separate replay/idempotency contract and tests exist |

### 11.6 Gate summary

- `observe` semantics: **APPROVED FOR DESIGN**.
- Trusted NPC/action/target/purpose/source authorization: **NOT IMPLEMENTED / FAIL-CLOSED**.
- Authoritative observation evidence source and executable knowledge-effect mapping: **UNCONFIRMED / BLOCKED**.
- Ordinary pending proposal and later Core commit: existing generic infrastructure only; no proven NPC observation integration.
- NPC plan reconciliation: **DISABLED / BLOCKED**.
- Runtime/API/schema/storage/dispatcher/scheduler/worker changes: **NOT AUTHORIZED**.
- `Memory → NPC`: **DISABLED / FAIL-CLOSED**; Host: **NON_READY** until independent gates pass.

### 11.7 Source audit and cross-contract reconciliation gate

A source-level check of current `main` confirms a sharper boundary than “the translator has no knowledge intent”:

- `src/core/mechanic-effect-translator.js` lists `propose_knowledge` among known intent names, but its executable `SUPPORTED_INTENTS` allowlist contains only `create_entity`, `update_attribute`, and `assert_fact`. A `propose_knowledge` intent is therefore explicitly rejected as unsupported by the current translator. Recognition as a known name is not implementation.
- `MechanicExecutor.evaluate(...)` is a bounded, read-only evaluator for a caller-supplied action ID on an enabled instance's exact pinned template. It requires a trusted context provider and fails closed for unsupported capability/input/policy cases. It does not discover NPC actions or independently grant actor-purpose authorization.
- `ProposalService` is a generic proposal boundary; its documented validation gaps include actor authorization and semantic alignment. A generic `pending` record is not evidence that an NPC observed or learned anything.
- `docs/34-npc-decision-context-and-proposal.md` and `docs/39-npc-core-knowledge-contract-proposal.md` define separate, still-blocked knowledge/acquisition prerequisites. In particular, the accepted direction in `docs/39` scopes the candidate first runtime knowledge path to explicit `author_initial`/imported acquisition with provenance, and says its executable source/record/filter contract is not yet implemented. The newer `observe` decision authorizes semantic **design**, not a replacement implementation path or a bypass around those Core-owned gates.

Before any implementation request, the coordinator/core owner must explicitly reconcile whether `observe` is a later semantic slice or a revision to the existing `author_initial`/imported first-slice decision. The owner must also identify the real authoritative observation source, the supported knowledge-proposal mapping, and the trusted actor/purpose/source filter. Until then these are separate design tracks, not a single executable route.

**Implementation entry gate:** provide source references to a real enabled instance and exact pinned template/action, the authoritative source and evidence type, the explicit authorization owner/decision, the supported effect/proposal mapping, the snapshot/provenance correlation, and production-path negative tests. If any item is absent, stop at `unknown/denied/needs_review`; do not add a substitute NPC-local store, permission system, or effect mapping in this PR.

### 11.8 Source-level commit-result correlation audit

The inspected Core source/docs identify a candidate authoritative result path, but only for the existing bounded mechanic-evaluation slice:

- `ProposalService.createFromMechanicEvaluation(...)` rechecks the evaluated world revision and commit sequence transactionally before creating a normal proposal.
- The proposal stores the evaluation identity, context/evaluation fingerprints, policy version, and effect provenance; `proposal.created` audit carries related provenance.
- On a successful commit through the existing `LogicEngine.commitEvent` / SQLite persistence path, the corresponding `world_events` row stores the mechanic-execution metadata; `getEvents(...)` returns it, and the `proposal.committed` audit entry carries the committed `event_id` and provenance.
- The proposal path remains pending → separately approved → separately committed. Proposal creation, approval, or a `pending`/`approved` status is not proof of a committed effect.

**Scope limitation:** this source trace does not provide an executable `observe`/knowledge-acquisition path because `propose_knowledge` is not in the translator's executable allowlist, and the Core-owned acquisition record/source/filter contract remains unimplemented or unverified. Do not treat the mechanic metadata or `event_id` as proof that an NPC acquired knowledge. A future consumer would need a separately approved contract to bind the exact NPC, observation attempt, evidence/provenance, proposal, and committed event; define duplicate/replay behavior; and verify that the committed event represents the intended knowledge effect. No such consumer or plan-reconciliation contract is established here.

### 11.9 Coordinator sequencing decision and implementation boundary

The coordinator has resolved the sequencing question: **A — establish the `author_initial` / `imported` acquisition path first.** This is the Core-owned knowledge-acquisition foundation; `observe` remains approved for design only and is a later, separate action contract.

Core owns acquisition records, provenance and validity, snapshot consistency, and actor-/purpose-scoped safe filtering. The available evidence does not establish an individual implementation assignee. Relevant contracts are `docs/39-npc-core-knowledge-contract-proposal.md`, `docs/43-core-npc-knowledge-runtime-implementation-plan.md`, `docs/49-npc-core-knowledge-live-audit.md`, and `docs/50-npc-initial-knowledge-acquisition-contract.md`.

This resolves sequencing only. The authoritative author/import source and lifecycle still require verification, and the executable Core-owned acquisition/read boundary and production-boundary tests remain outstanding. No runtime readiness or implementation authorization is implied.

## 12. Cross-contract sequencing decision: initial acquisition before observation (2026-10-28)

**Decision: A — implement and verify the explicitly authorized `author_initial` / `imported` acquisition path first.** This resolves the sequencing question raised in PR #537. It does not approve runtime implementation in this proposal branch.

The distinction is between a *knowledge-acquisition foundation* and a *semantic action*:

1. **First knowledge foundation:** Core-owned `author_initial` / `imported` records, explicit subject assignment, trusted provenance/validity, and an actor + purpose + exact-snapshot safe read/filter. This direction is already specified in `docs/39-npc-core-knowledge-contract-proposal.md` and the implementation gates in `docs/43-core-npc-knowledge-runtime-implementation-plan.md`. The current implementation audit in `docs/49-npc-core-knowledge-live-audit.md` says the required acquisition records and safe actor-relative context are still missing.
2. **`observe` remains design-only:** the semantics in §11 may be retained as a later action contract, but observation requires its own authoritative evidence source, access/visibility policy, provenance and supported acquisition mapping. It cannot create or substitute for the initial-acquisition foundation.
3. **No implicit acquisition:** a canonical fact, entity attribute, context manifest, retrieved record, prompt inclusion, or model-generated statement does not establish that an NPC knows it. The first slice must not implement observation, communication, documents, inference, or rumor by relabeling them as `author_initial` / `imported`.
4. **Owner:** Core owns acquisition records, provenance/validity, snapshot consistency and the safe read/filter. NPC owns neither a parallel knowledge store nor a replacement authorization/reconciliation mechanism. The available evidence does not establish a named individual implementation assignee; do not invent one.
5. **Next gate:** Core must verify the real author/import source and lifecycle, implement the narrow Core-owned record/read boundary, and add production-boundary tests for actor isolation, provenance, secret exclusion, snapshot freshness and replay/reconciliation. Only after that gate passes should the team decide whether to implement `observe` as the next acquisition path.

This sequencing decision does not claim the blocker is already fixed in executable code. Until the Core implementation and tests exist, the first NPC knowledge slice remains **BLOCKED**, `Memory → NPC` remains **DISABLED / FAIL-CLOSED**, and Host remains **NON_READY**. No API/schema/storage or runtime behavior is authorized by this documentation change.


## 13. Post-decision author/import source audit (2026-10-28)

This is a bounded source check against Core `main`, not a runtime change or exhaustive proof that no source exists elsewhere.

### Verified entry points

- `src/application/engine.js` — `LogicEngine.createWorld(x)` validates `world_pack_id`, `world_pack_version`, and `game_time`, then delegates world creation. It does not load a world-pack payload or accept a subject-specific initial-knowledge assignment in this method.
- `src/storage/sqlite-store.js` — `createWorld(w)` inserts the world identity/version/time and a `world.created` audit entry. The inspected schema contains canonical `world_events`, `fact_claims`, and `facts`; no Core-owned actor-acquisition record was identified in this schema.
- `src/api/server.js` — `POST /v1/worlds` is admin-gated and forwards the request to `engine.createWorld`. This route creates the world record; it is not an author/import knowledge-assignment route.
- `LogicEngine.registerContextManifest(...)` stores generation/cursor/item references. It does not create subject-specific acquisition records and must not be repurposed as their source.

### Additional source checks: World Pack and authoring boundary

- `schemas/world-pack-manifest.schema.json` defines `knowledge_channels[]` entries with `channel_id`, `source_kind`, and `validation_policy` (including `author_seeded`). This is channel/validation metadata; the inspected schema does not define a subject-to-proposition initial-knowledge assignment.
- `docs/04-world-pack-format.md` explicitly labels the full World Pack contract as proposed/partial and states that the existing schema does not establish a production loader or complete conformance path.
- Repository search for `importWorld`, `loadWorldPack`, `author_initial`, `imported`, `world_pack_id`, and `author_seeded` found semantic contracts, candidate-consumer metadata, tests/fixtures, and the world-creation pinning path, but no verified production author/import assignment loader. Search results are supporting evidence, not a proof of global absence.
- `src/application/memory-npc-consumer.js` and `src/npc/memory-candidate-eligibility.js` contain candidate admission/filter logic for Memory records. They do not constitute the author/import source: their metadata labels cannot authenticate an initial assignment or create a Core-owned acquisition record.

### Gate result

**Finding: no authoritative production `author_initial` / `imported` assignment source was identified in the inspected Core `main` paths and repository search.** This is stronger than the earlier world-creation-only check, but remains a bounded audit—not proof that no deployment-specific or unsearched loader exists. The current visible World Pack manifest metadata does not bind an initial assignment to a canonical subject and proposition.

Before implementation, Core must identify the actual author/import entry point (or explicitly confirm that one does not exist), show how it binds a source item to a canonical subject and world, and establish how that assignment is versioned, replayed, replaced, invalidated, and audited. If no such path exists, Core must approve a minimal Core-owned representation and lifecycle before code is written. Do not infer assignment from `fact.set`, `world.created`, canonical facts, context manifests, or prompt content.

No runtime tests were run for this documentation audit. No executable code, API, schema, or storage was changed. `Memory → NPC` remains **DISABLED / FAIL-CLOSED** and Host remains **NON_READY**.

## 13. Coordinator decision A — initial acquisition contract design (2026-10-28)

The coordinator approved the minimal Core-owned `author_initial` / `imported` acquisition contract for **design only**. The bounded source audit did not identify an authoritative production loader that assigns either kind to a canonical NPC; this is a bounded finding, not proof that no deployment-specific source exists.

The detailed proposal and contract-review acceptance criteria are in [`docs/83-core-owned-initial-knowledge-acquisition-contract-proposal.md`](83-core-owned-initial-knowledge-acquisition-contract-proposal.md). It is governed by `docs/50-npc-initial-knowledge-acquisition-contract.md` and `docs/43-core-npc-knowledge-runtime-implementation-plan.md`.

Core owns the acquisition contract, records, provenance and authorization checks, validity lifecycle, snapshot consistency, and actor-/purpose-scoped safe filtering. No individual implementation assignee is established by available evidence.

The proposal binds each assignment semantically to world, canonical subject, assigned proposition/source, acquisition kind, trusted source and assignment authorization, initial boundary, validity, lifecycle identity, and relevant restrictions. It specifies deterministic replay, replacement, invalidation, restart/reconstruction, and safe-read requirements without selecting a physical schema or API.

**Review gate:** review the contract and KAC-01 through KAC-15 acceptance criteria before requesting a separate implementation authorization. At the time of this 2026-10-28 decision, no runtime/API/schema/storage/migration/prompt changes, dispatcher/scheduler/worker, plan reconciliation, NPC-local store, or new permission system were authorized. The later 2026-10-30 A1 decision supersedes the no-store restriction only for NPC goal/plan/task-progress persistence, through docs/97–98. It does not authorize runtime implementation or alter Core ownership of knowledge/acquisition/belief/delivery. Do not infer acquisition from canonical facts, World Pack channel metadata, context manifests, Memory candidate labels, or model-generated text.

`Memory → NPC` remains **DISABLED / FAIL-CLOSED**; Host remains **NON_READY**. No runtime readiness is claimed, and this documentation update does not claim tests were run.



## 14. Goal/plan lifecycle and causal-reconciliation contract (design only)

This section develops the NPC-domain boundary already stated in `docs/31-npc-subsystem-contract.md` §§5, 11–12. It does not define a storage format, executable enum, reducer API, or authorization to implement.

### 14.1 Distinct domain meanings

Keep these concepts separate:

- **Goal:** a desired condition, not a prediction or guarantee that it will occur.
- **Plan:** a revisable strategy for pursuing a goal, including assumptions, prerequisites, dependencies, and alternatives.
- **Task:** a concrete step with an owner, prerequisites, progress, and a completion/failure condition.
- **Commitment:** an obligation or promise; it is not proof that the promised action occurred.
- **Intention:** a proposed or private direction of action; it is not a canonical event and is not automatically visible to other actors or the player.
- **Authoritative outcome:** a result established by the appropriate Core boundary, not by NPC/model narration, a proposal status, or a caller-supplied success flag.

NPC goal/plan/task state is NPC-domain state. It must not become a second canonical world state, event log, revision cursor, causal graph, or knowledge store. Core remains authoritative for canonical effects and their validity.

### 14.2 Lifecycle semantics required before implementation review

A future contract must distinguish at least the following *semantic situations*; these are not approved wire values:

| Situation | Required meaning |
|---|---|
| Goal proposed / unresolved | A candidate goal exists but admissibility, priority, or a material dependency is not established. It must not silently become accepted. |
| Goal accepted | The goal passed an explicitly owned admissibility policy. The policy owner and conflict rules must be named before implementation. |
| Plan active | A strategy is currently considered viable under its recorded assumptions and prerequisites; this does not guarantee its steps will succeed. |
| Plan needs reconsideration | A prerequisite failed, an assumption was contradicted, relevant information changed, a required resource became unavailable, a deadline passed, or an action failed. Do not continue automatically as if nothing changed. |
| Task attempted / outcome unknown | An attempt was made, but no authoritative result is available. Do not mark the task successful. |
| Task/action confirmed | The relevant authoritative result was verified and correlated to this NPC attempt. Proposal creation or approval alone is insufficient. |
| Goal completed | The desired condition is supported by verified current evidence under the applicable rules; a narrated claim or one completed task is not enough by itself. |
| Goal abandoned / superseded | The transition has an explicit reason and provenance. A failed plan alone does not automatically erase the underlying goal. |
| Blocked / needs review | Required evidence, policy, causal dependency, or result correlation is unavailable, ambiguous, stale, or contradictory. Preserve that uncertainty. |

The exact labels and transition graph remain open. Do not encode a state machine in runtime code until the owner, allowed transitions, and authoritative inputs have been reviewed.

### 14.3 Replanning and priority conflicts

A plan must be reconsidered when a material assumption or prerequisite changes. Reconsideration is not the same as deleting the goal or automatically selecting a replacement plan.

- Preserve the goal when one strategy fails, unless an explicit authorized rule or decision changes the goal itself.
- Do not assume a task's success from intent, proposal creation, approval, or model output.
- Do not infer priority from list order, recency, personality traits, or model confidence unless an approved policy defines that rule.
- If two goals or author constraints conflict and no authoritative priority rule resolves the conflict, return an unresolved/review-required outcome rather than inventing a universal ordering.
- A commitment remains distinct from execution and completion; failed or cancelled execution must not rewrite history as if the promise never existed.

### 14.4 Causal rollback and reconciliation boundary

When a Core source event is invalidated or corrected, NPC-domain state may need reconciliation, but the NPC subsystem must not implement its own canonical undo.

Before any reconciliation implementation, the contract must identify:
1. the authoritative source/event identity and current validity signal;
2. the exact NPC goal, plan, task, belief, relationship, or report effects that depend on it;
3. whether each effect has another independent valid cause or support;
4. the owner-approved way to recompute current NPC-domain state after rollback/correction;
5. how retries and replay avoid duplicate transitions and survive restart;
6. how the audit trail preserves the correction/rollback operation without silently erasing history.

Required semantic behavior:
- invalidate or recompute a dependent effect when its only valid support is removed;
- preserve an effect when an independent valid cause still supports it;
- do not erase all later activity merely because an earlier event was rolled back;
- do not preserve a dependent effect solely because it appears later in the timeline;
- do not treat an unchanged commit sequence as proof that source validity is unchanged;
- if causality is incomplete or support cannot be established, stop at unresolved/needs-review rather than guess.

The current documentation/source inventory does not establish a production NPC goal/plan reconciliation consumer. The generic Core rollback and proposal mechanisms are dependencies, not proof that this NPC-domain lifecycle exists.

### 14.5 Acceptance matrix for the next design review

| ID | Scenario | Required result |
|---|---|---|
| GOAL-LC-01 | One attempted plan fails while the goal remains admissible | Mark the plan for reconsideration; preserve the goal unless a separate authorized transition changes it. |
| GOAL-LC-02 | A required prerequisite is missing or unknown | Do not treat it as false or satisfied; block/review the plan. |
| GOAL-LC-03 | Two goals conflict and no approved priority rule applies | Preserve the conflict as unresolved; do not invent an ordering. |
| GOAL-LC-04 | Model says an action succeeded, but no authoritative Core result is correlated | Task/action outcome remains unknown; no completion transition based on narration. |
| GOAL-LC-05 | Proposal is pending or approved but not committed | Do not mark the action/task successful or reconcile plan progress as committed. |
| GOAL-LC-06 | A supporting event is invalidated and no independent valid support remains | Reconcile affected NPC-domain state according to the approved causal contract; do not silently retain dependent progress. |
| GOAL-LC-07 | A supporting event is invalidated but an independent valid cause remains | Preserve the independently supported effect. |
| GOAL-LC-08 | Rollback affects one branch of later activity | Reconcile dependent effects only; preserve independent later activity. |
| GOAL-LC-09 | Reconciliation is retried or replayed after restart | No duplicate transition or false success; exact idempotency/recovery behavior must be defined and tested before implementation. |
| GOAL-LC-10 | The causal chain is incomplete or current source validity cannot be verified | Return unresolved/needs-review; do not fabricate a causal explanation or claim currentness. |
| GOAL-LC-11 | A commitment exists but the action has not been confirmed | Preserve the obligation separately from execution/completion status. |
| GOAL-LC-12 | Chat turns occur without canonical game-time advancement | Do not advance time-dependent tasks, deadlines, or off-screen processes solely because another chat turn occurred. |

These cases are design acceptance requirements, not tests claimed to have run. They complement the broader semantic cases in `docs/31-npc-subsystem-contract.md`, `docs/32-npc-semantic-acceptance-matrix.md`, and the readiness limitations in `docs/33-npc-runtime-readiness-audit.md`.

### 14.6 Gate status

- Goal/plan/task/commitment distinctions: **DOCUMENTED SEMANTIC BASELINE**.
- Goal admissibility owner and conflict policy: **UNCONFIRMED / BLOCKED**.
- Trusted NPC caller, actor-purpose authorization, and action-result correlation: **BLOCKED**.
- Production NPC goal/plan persistence and reconciliation: **NOT VERIFIED**.
- Runtime, API, schema, storage, dispatcher, scheduler, worker, and plan-reconciliation implementation: **NOT AUTHORIZED**.
- `Memory → NPC`: **DISABLED / FAIL-CLOSED**; Host: **NON_READY**.

This section is an independent design clarification. It does not resolve or bypass the coordinator's pending review of the Core-owned initial-knowledge acquisition contract.


## 15. Goal-formation vertical slice and implementation gate

The conceptual goal contract above still does not authorize a goal generator. Before implementation, the first slice must be limited to one goal family whose inputs and admissibility rules are already owned and testable.

### 15.1 Required inputs

The trusted caller must provide, using existing approved source contracts only:

- the acting NPC identity and decision purpose;
- a consistent, authorized world/rule snapshot;
- only the Personality motive/trait fields approved for this decision;
- only the Relationships fields approved for this NPC and purpose;
- the NPC's existing goal state, if an approved source exists;
- completeness/accessibility status for each required input.

No combined Personality/Relationships/Core context feed has been verified. Until the owners identify the exact source path and authority for each item, the generator must not be implemented by guessing field names or inventing a shared schema.

### 15.2 Proposal-only behavior

Once the input contracts and first goal family are approved, the NPC helper may return one of three bounded outcomes:

- `goal_proposed` — a candidate goal with traceable references to the approved inputs and explicit assumptions;
- `no_goal` — complete permitted inputs were assessed and no candidate met the approved admissibility rules;
- `needs_review` — required information is missing, incomplete, inaccessible, contradictory, or outside the supported goal family.

These are conceptual outcomes, not approved wire values. A proposed goal must not automatically become persisted/active state, execute an action, mutate canonical world state, grant knowledge, or alter relationships. Missing context must never be converted into a negative fact.

### 15.3 Decisions required before implementation

1. Personality owner: exact permitted motive/trait source and completeness signal.
2. Relationships owner: exact actor-/purpose-scoped read contract and completeness signal.
3. Core/mechanic owner: current world/rule evidence and snapshot binding for the chosen goal family.
4. NPC owner: existing goal-state source, duplicate-intent handling, and whether the first proposal remains transient.
5. Coordinating owner: one first goal family and its authoritative admissibility rule.

### 15.4 Acceptance evidence

The later implementation must test deterministic output for identical approved inputs; missing versus known-absent versus inaccessible inputs; contradictory evidence; unsupported goal families; terminal existing goals; duplicate proposals under approved identity semantics; no input mutation; no world mutation; and no conversion of Memory retrieval into knowledge. Unit tests alone do not prove the production caller or persistence path.

**Current gate:** goal formation remains **BLOCKED / NOT IMPLEMENTED** until these decisions are supplied. The next step is contract-owner review, not a speculative runtime implementation.
