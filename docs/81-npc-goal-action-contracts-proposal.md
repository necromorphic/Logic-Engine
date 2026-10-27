# NPC Goal and Action Contracts — Isolated Design Proposal

**Status:** proposal only; coordinator decision A/B = CONDITIONAL, E = APPROVED for isolated NPC-only contracts.
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
| Candidate discovery and precondition evaluation | `MechanicExecutor.evaluate(...)` evaluates a caller-supplied action ID from an enabled instance's pinned template, checks declared conditions using a trusted same-snapshot context provider, and returns a non-committing result. `tests/mechanic-executor.test.js` and `tests/mechanic-core-integration.test.js` describe coverage. | A generic bounded mechanic-action evaluation seam exists. NPC-specific candidate enumeration/selection, actor authorization, and dispatch remain **UNCONFIRMED / BLOCKED**. The first NPC action family still requires coordinator selection. |
| Authoritative action result | `POST /v1/worlds/:world_id/proposals` creates a durable `pending` proposal; `/approve` requires the separate approval credential and current snapshot; `/commit` commits only an approved proposal after a stale-snapshot check; `/cancel` is adapter-owned. `src/application/proposals.js` records validation limits. | This is a real generic event-proposal route, not an NPC-specific executor. Explicit approval is required; adapter identity is not in-world NPC authorization. The full NPC proposal-to-result-to-plan-reconciliation path is **UNCONFIRMED / BLOCKED**. |

### Concrete existing action-evaluation candidate (not yet an NPC action family approval)

`src/application/mechanic-executor.js::MechanicExecutor.evaluate({ worldId, instanceId, actionId, input })` is a real, bounded, read-only action-evaluation path. It looks up a caller-supplied `actionId` in an enabled mechanic instance's exact pinned template, checks the snapshot, requires a trusted context provider, verifies same-snapshot dependency evidence, evaluates applicability/preconditions/constraints with `evaluateMechanicActionConditions(...)`, translates supported mechanic effect intents, and returns a structured `ready`, `no_match`, `unknown`, or `rejected` result without committing world state. `ProposalService.createFromMechanicEvaluation(...)` accepts only an attested ready result and hands it into the existing pending-proposal lifecycle; normal approval and commit remain separate.

This is a **candidate seam for coordinator review**, not proof that NPCs can discover or autonomously select actions. The caller must already know the `instanceId` and `actionId`; no NPC-specific enumerator chooses among actions. The slice rejects non-empty action inputs, required capabilities without a grant contract, rule modules, non-manual conflict policy, participant selection/interactions, and unsupported effect intents. It does not supply NPC goal admissibility, NPC-specific actor authorization, Personality/Relationships context, a dispatcher, or plan reconciliation. Do not mark a first NPC action family approved without the coordinator's explicit choice and a verified actor/purpose policy for the NPC caller.

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

**Concrete candidate for coordinator review:** a single action declared in an enabled, pinned mechanic template, restricted to the existing `MechanicExecutor` slice. The source of action definitions, precondition evaluator, effect-intent translator, and generic proposal handoff now have source-level evidence. However, `actionId` is supplied by the caller rather than discovered by an NPC dispatcher, and the end-to-end NPC actor/purpose authorization path is not established. Therefore the first NPC action family remains **BLOCKED pending explicit coordinator selection and confirmation of the trusted NPC caller/policy**. Do not treat this candidate as approved by this document.

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
- No background worker, scheduler, queue, new process semantics or persistent NPC store.
- No changes to Host/Adapter, Core, Memory Provider, shared APIs, schemas, storage, Personality or Relationships.
- No enablement of Memory → NPC; it remains **DISABLED / FAIL-CLOSED**.
- No merge of PR #532, #535 or #536 is requested or implied.
