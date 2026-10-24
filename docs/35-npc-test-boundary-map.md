# NPC First-Slice Test Boundary Map

Status: repository test mapping and implementation gate; documentation only. The initial baseline test inventory was inspected against `main` when this document was first authored; the current NPC acceptance requirements are maintained on `feat/npc-subsystem`. Re-verify test names and behavior against the exact target commit before implementation. No tests were executed and no runtime test file was added.

## 1. Why this document exists

The first NPC slice is a bounded decision-context plus non-committing proposal. The repository already tests several adjacent core guarantees, so the NPC branch must reuse those guarantees and add tests only for genuinely missing semantics. A test that merely mocks the desired behavior or asserts that a design document contains certain words is not an acceptance test for the subsystem.

## 2. Existing tests to reuse as baseline

| Existing test | Responsibility confirmed by source inspection (not executed) | What it does not prove for NPCs |
|---|---|---|
| `tests/core.test.js` — `stale proposal is rejected without partial effects` | A proposal based on stale world history is rejected | Actor-specific knowledge/access or player-agency policy |
| `tests/core.test.js` — `rule evaluator rejects unknown fields and read_set references must exist locally` | Invalid fields and unsupported reads are rejected | Missing input vs known-false distinction for all rule conditions |
| `tests/core.test.js` — `proposal commit rolls back canonical event if proposal finalization fails` | Proposal commit/finalization atomicity in the tested failure case | Whether the proposed action was authorized or semantically appropriate |
| `tests/api.test.js` — `health, auth, proposal approval, and canonical commit boundary` | Proposal requires approval before canonical commit; validation metadata identifies unchecked semantic review | NPC permissions and player-agency checks are enforced (they are explicitly marked unchecked) |
| `tests/api.test.js` — `proposal must be approved and cannot commit against a stale snapshot` | Approval is required and stale snapshots cannot be committed | Actor knowledge and authorization |
| `tests/api.test.js` — `proposal creation performs deterministic validation without mutating canonical state` | Unsupported effects are rejected and proposal creation leaves canonical revision unchanged in the covered case | Full NPC decision cycle or persistent NPC state |
| `tests/api.test.js` — `API registers a generation-bound context manifest and commits against it through the internal route` | A manifest can be registered and referenced by an event | Manifest membership is not proof that an actor was allowed to know each item |
| `tests/causality-contract.test.js` — context-manifest tests | Undeclared reads and stale manifest revisions are rejected in covered cases | Actor-level information access, secret withholding, or belief state |
| `tests/causality-contract.test.js` — `fact_value REQUIRES rejects unknown conflicted claims` | Unknown/conflicted required facts fail closed in this core precondition path | General tri-state rule evaluation for every condition |
| `tests/causality-contract.test.js` — rollback tests for independent branches and required predicates | Core event rollback has tested causal invalidation/preservation behavior in covered cases | NPC knowledge/goals/plans have no verified persistent runtime to reconcile |

These tests are useful regression baselines; they are not substitutes for the NPC-specific acceptance cases below.

## 3. NPC scenarios mapped to current coverage

Legend: **Covered adjacent behavior** means the core tests exercise a related primitive, not the full NPC requirement. **Missing** means no verified end-to-end test was identified in the inspected test files.

| NPC scenario | Existing coverage | Additional test required |
|---|---|---|
| NPC-CTX-001 — Retrieved secret is withheld | Missing | Give the context builder a retrieved-but-unauthorized secret and prove the exact secret never reaches the model input; prove no NPC knowledge or world state is written |
| NPC-CTX-002 — Missing context remains unknown | Partial adjacent coverage: unknown `REQUIRES` predicates; rule evaluator is boolean | Exercise required context field states: known true, known false, unknown/incomplete, and withheld; prove unknown does not silently become false |
| NPC-CTX-003 — False belief remains actor-relative | Missing | Supply canonical fact P and explicit actor belief not-P; prove both remain distinct and decision input does not overwrite canonical state or auto-correct the belief without evidence |
| NPC-CTX-004 — Failed precondition cannot commit | Covered adjacent behavior: core validates supported effects and required predicates | Submit an NPC-originated proposal with a known-false precondition; prove it cannot pass to approval/commit merely because the proposal payload is valid |
| NPC-CTX-005 — Proposal does not mutate state | Covered adjacent behavior: proposal creation is non-committing in existing tests | Add an NPC decision-path test that compares world state, revision, commit sequence, events, time, knowledge, and delivery records before/after proposal generation |
| NPC-CTX-006 — Unsupported effect is not guessed | Covered adjacent behavior: unsupported effect kinds are rejected | Map every allowed NPC intent to an existing core operation; test every unmapped intent returns review/rejection and does not mutate state |
| NPC-CTX-007 — Player agency is preserved | Missing | Validate narrative/output boundary: NPC proposal can be described after authorization, but no player action, dialogue, thought, consent, or decision is generated as a committed fact |
| NPC-CTX-008 — Chat turns do not advance world time | Covered adjacent behavior: core has explicit time-advance rules | Run multiple NPC decision turns without a committed time event and prove game_time, event log, and scheduled progression do not advance |

## 3.1 Crosswalk from core semantic scenarios to executable boundaries

The primary contract IDs NPC-SEM-001–012 in `docs/32` are broader semantic scenarios; the following crosswalk prevents them from being lost behind the lower-level NPC-CTX test labels. These mappings describe future acceptance coverage, not existing implementation.

| Core scenario | Related boundary test(s) | Additional status / constraint |
|---|---|---|
| NPC-SEM-001 — Retrieved secret is not automatically accessible | NPC-CTX-001 | Blocked until a real pre-model context filter exists; test exact secret omission, not merely a flag. |
| NPC-SEM-002 — False belief does not auto-correct with canonical truth | NPC-CTX-003 | Blocked until actor-relative belief can be represented and read without changing canonical truth. |
| NPC-SEM-003 — Knowledge with an alternative source survives source invalidation | Runtime persistence/rollback | Blocked until core-owned acquisition provenance can be reconciled against actual valid source paths. |
| NPC-SEM-004 — Failed plan prerequisite does not erase the goal | Runtime persistence | Blocked until a real goal/plan state boundary exists; do not infer goal state from generated prose. |
| NPC-SEM-005 — Off-screen event is not automatically player knowledge | NPC-CTX-007 plus report/awareness integration | Blocked until player-awareness and valid communication/viewpoint boundaries exist. |
| NPC-SEM-006 — Pending report is not delivered knowledge | Report lifecycle | Blocked until actual send/receipt evidence is defined; prompt inclusion is not delivery. |
| NPC-SEM-007 — Different knowledge/goals permit different reactions | Actor-specific decision context | Blocked until per-actor context and decision boundaries exist; same world state need not imply identical reactions. |
| NPC-SEM-008 — Rejected action proposal is non-mutating | NPC-CTX-005, with existing proposal regression tests | Adjacent core behavior exists; still needs a real NPC-originated path before it proves the NPC contract. |
| NPC-SEM-009 — Rollback removes dependent effects but preserves independent activity | Existing causality/rollback regression tests plus NPC state reconciliation | Core rollback tests cover world effects only; NPC goals, acquisition, and beliefs remain unverified. |
| NPC-SEM-010 — Missing source data does not create canon | NPC-CTX-002 and NPC-CTX-006 | Blocked until missing/unknown/withheld are represented at the actual decision boundary. |
| NPC-SEM-011 — Player agency remains outside NPC authorship | NPC-CTX-007 | Blocked until the real narration/host boundary can be exercised. |
| NPC-SEM-012 — Chat turns do not advance world time | NPC-CTX-008 | Adjacent core time rules exist; verify the real NPC turn path does not itself advance canonical time. |

## 4. Required test layers

The tests should be written in this order, and should use real repository boundaries rather than invented test-only implementations:

### Layer A — Core regression tests (reuse, do not rewrite)

Run the current suite unchanged first. This establishes whether the base revision is healthy before NPC changes. Required environment: Node.js `>=22.13.0` per `package.json`.

### Layer B — Pure semantic contract tests

These tests can be implemented without database or API changes only after a real context-preparation function exists. Test the admission decision independently from the model call:

- permitted item is admitted with source/provenance;
- unauthorized retrieved item is omitted;
- incomplete field is marked unknown rather than converted to false;
- canonical truth and actor belief remain separate;
- proposal generation is a pure/non-mutating operation.

Do not create a mock context builder that pretends to enforce access rules; that would test the mock, not the product.

### Layer C — Integration tests against existing core services

Use the real context-manifest and proposal services to verify:

- the manifest cursor matches the intended world revision and commit sequence;
- a proposal remains pending and does not change canonical world state;
- unsupported effects fail closed;
- approval and commit remain separate;
- a stale proposal is rejected;
- manual semantic review remains required where the core says checks are not performed.

These tests can verify existing primitives today, but the NPC-specific adapter and authorization policy must exist before they can prove end-to-end NPC safety.

### Layer D — Runtime persistence tests (blocked)

Core ownership of acquisition/provenance, delivery status, source reconciliation, and persistent belief has been semantically confirmed. Runtime persistence tests remain blocked until the real NPC state representation and core production interfaces are mapped and available. Required future cases include persistent beliefs, goals/plans, report delivery, off-screen progress, and rollback reconciliation. Do not emulate them in prompt state or add a parallel store.

## 5. Blocking decisions and dependencies

1. **Trusted context source:** identify the existing adapter/caller responsible for actor identity and permitted information. A manifest's item list is not authorization.
2. **Context completeness:** specify how the decision path knows a field is absent, unknown, or withheld. Do not change global `evaluateCondition` behavior in this NPC-only step.
3. **Intent-to-effect mapping:** enumerate the initial NPC action vocabulary and map each item to a supported core effect/event; unknown mappings must require review.
4. **Narrative/player-agency check:** identify the actual host boundary where generated narrative becomes user-visible or a canonical action. No such integration is claimed by this document.
5. **Runtime and test execution:** run the suite locally or in CI using the repository's supported Node version; GitHub source browsing alone cannot report tests as passing.

## 6. Go/no-go rule

**Go** for test authoring only when the relevant production boundary exists and can be called by the test. **No-go** for NPC runtime persistence, scheduler, autonomous background execution, new API, or SQLite changes until the semantic contract, context authorization, action mapping, and causal/rollback requirements are independently reviewed.

This document does not claim any test has passed. It records which existing core guarantees can be reused and exactly what remains unproven for the NPC subsystem.


## 7. Additional author-decision coverage map

The following rows map NPC-SEM-013–020 from `docs/32-npc-semantic-acceptance-matrix.md` to the required production boundary. They are not executable-test claims. Implement a test only when it can invoke the real boundary and assert the relevant result; do not replace a missing subsystem with a mock that merely repeats the intended rule.

| Scenario | Existing adjacent support | Missing production boundary / acceptance assertion | Status |
|---|---|---|---|
| NPC-SEM-013 — Author-mandated outcome | Existing proposal lifecycle can stage a proposed world change; it does not establish author-priority semantics | Test that an explicit author target is retained despite ordinary NPC refusal, while higher-priority constraints and player agency still hold; unprescribed intermediate actions remain open | Blocked: author-intent arbitration is not verified in runtime |
| NPC-SEM-014 — Future causal preparation | Core event/proposal path can represent supported proposed changes; it does not prove a causal planner exists | Verify proposed future causes are prospective and non-canonical until approved/committed; reject fabricated prior history and preserve an explicit unresolved rationale when no route exists | Blocked: causal-planning boundary not verified |
| NPC-SEM-015 — Author-reserved secret | Existing manifests can reference world items; references are not disclosure guards | Verify reserved secret is withheld before model input and cannot be autonomously disclosed; ordinary unrelated NPC actions remain possible | Blocked: author-secret policy/context guard not verified |
| NPC-SEM-016 — Coexisting relationship dimensions | No verified persistent multi-dimensional NPC relationship model in the inspected path | Assert attraction and rivalry/reluctant alliance can coexist, and one actor's attraction does not create reciprocal attraction or consent | Blocked: relationship state and history boundary not verified |
| NPC-SEM-017 — Proportionate relationship change | Existing event causality may record a world occurrence but not actor-specific relationship interpretation | Test separate dimension changes grounded in event importance, prior history, and character-specific response; do not require every NPC to react identically | Blocked: relationship evaluation/persistence not verified |
| NPC-SEM-018 — Off-screen event and player awareness | Canonical event commit can establish an occurrence | Assert event occurrence does not grant player awareness; a later visible consequence or delivered communication may surface it through an authorized channel | Partially adjacent only: awareness/channel contract missing |
| NPC-SEM-019 — Report lifecycle | Generic events/proposals are not a verified report-delivery service | Distinguish pending, sent, received, understood, and player-aware states; each transition needs trusted evidence, and absent primitives must fail closed | Blocked: delivery/receipt ownership not verified |
| NPC-SEM-020 — Acquisition memory versus current belief | Canonical truth and manifest references exist, but actor-specific acquisition/belief persistence is not verified | Assert acquisition history can persist while belief changes, and omitted context does not imply never-acquired information | Blocked: actor-relative memory/belief representation not verified |

## 8. Test-authoring gate after the author-decision update

Before writing end-to-end tests for these scenarios, record for each test:
1. The exact production function or API boundary being called.
2. Which inputs are trusted and how the actor identity is bound to the in-world NPC.
3. The observable canonical state, proposal/event/revision data, actor-relative knowledge or relationship state, and player-awareness state expected before and after.
4. Which assertion is an existing kernel guarantee versus a future NPC requirement.
5. Whether the scenario is still blocked because the required production boundary is absent.

The additional acceptance scenarios do not authorize a new event store, knowledge store, scheduler, revision counter, causal graph, rollback engine, or access-control subsystem. Resolve semantics and ownership first; then implement tests against the agreed boundary, followed by API/storage work only if separately approved. No tests were run as part of this documentation update.


## 9. Social identity editor test-boundary map

See `docs/40-npc-social-identities-editor-contract.md` for the full optional editor proposal. The following scenarios are requirements only; current editor/runtime support has not been verified.

| Scenario | Existing adjacent support | Missing production boundary / acceptance assertion | Status |
|---|---|---|---|
| NPC-SEM-021 — Optional additional identities | `docs/23-character-and-control-architecture.md` describes a provisional character identity/profile view; no social-identity editor implementation verified | Verify zero-or-many identities link to one underlying entity without duplicate writable profile state or extra NPC creation | Blocked: editor/profile model not verified |
| NPC-SEM-022 — Claimed data versus canon | Core distinguishes authored/profile concepts from canonical state at architecture level | Verify claims do not create canonical facts/relations and absent fields remain unknown | Blocked: social identity representation and validation boundary absent |
| NPC-SEM-023 — Inherited appearance/disguise | No verified social identity inheritance/projection path | Verify unspecified fields inherit and disguise changes presentation, not actual stable properties | Blocked: editor/projection behavior absent |
| NPC-SEM-024 — Document declaration versus world record | Core has canonical event/entity mechanisms, but profile text is not a document-issuance operation | Verify editor references/declarations do not create canonical documents; real issuance goes through an approved core operation | Blocked: document/profile reference contract not verified |
| NPC-SEM-025 — No automatic disclosure | Existing context-manifest mechanism records references, not actor-relative access | Verify identity/private notes are withheld before model input unless permitted and that editor creation does not grant awareness | Blocked: trusted actor-relative context boundary missing |
| NPC-SEM-026 — Risk without automatic exposure | Core event path can represent committed world events, but no verified cover-investigation logic | Verify consequences require observer-accessible evidence and applicable World Pack procedure; no automatic reveal | Blocked: observer knowledge and investigation semantics absent |
| NPC-SEM-027 — Impersonated entity remains distinct | Canonical entities have identities, but no verified social identity-to-entity link contract | Verify aliases/claims do not merge entities or create relatives; explicit references are required | Blocked: social identity relation semantics absent |
| NPC-SEM-028 — Consequences use core path | Existing canonical event/proposal path can stage and commit supported effects | Verify consequential exposure/document/world changes use existing validated core path, not editor metadata or local state | Partially adjacent: exact effect mapping and editor integration unverified |
| NPC-SEM-029 — Need-based identity creation | No verified identity creation or profile persistence boundary | Verify a concrete in-world need and plausible means precede creation; the card remains linked to the same NPC, carries its origin, and invents no unsupported history/documents | Blocked: runtime identity creation/persistence absent |
| NPC-SEM-030 — Inactive identity retention | No verified identity lifecycle/status persistence | Verify deactivation retains the card and prior events/observer knowledge, and reactivation does not erase exposure or compromise | Blocked: lifecycle and history boundary absent |
| NPC-SEM-031 — Identity edits preserve history | No verified identity edit/history boundary | Verify justified edits affect current presentation only and do not rewrite earlier statements, events, canon, or other NPCs' knowledge | Blocked: identity revision/history integration absent |
| NPC-SEM-032 — Autonomous context-constrained choice | No verified runtime identity selection or observer-relative access boundary | Verify selection reflects goals, character, knowledge, relationships, resources, and circumstances; coercion/exposure/evidence availability can constrain choices | Blocked: runtime decision/context boundary absent |

Do not create end-to-end tests against a fabricated editor, access filter, document service, or social-identity runtime. First identify the real profile/editor boundary and canonical references. No new event/knowledge store, revision counter, access-control subsystem, or rollback mechanism is authorized.

## 10. Relationship-state proposal test-boundary map

See `docs/42-npc-relationship-state-contract-proposal.md` for REL-001–012. These are semantic acceptance targets only; no relationship-state runtime or card projection has been verified.

| Scenario | Existing adjacent support | Missing production boundary / acceptance assertion | Status |
|---|---|---|---|
| REL-001 — Asymmetric relationship | Existing entity IDs can identify participants when they are canonical entities | Read A→B and B→A independently; do not infer reciprocity | Blocked: relationship read model absent |
| REL-002 — Unknown is not neutral | Current canonical facts distinguish some missing/known values, but no relationship-dimension model exists | Preserve unprovided dimensions as unknown, not zero/neutral | Blocked: relationship representation absent |
| REL-003 — Multidimensional independence | NPC semantic matrix establishes that dimensions can coexist | Change one dimension without silently rewriting the others | Blocked: relationship transition boundary absent |
| REL-004 — Scene co-presence is insufficient | Core events can represent committed world occurrences | Prove scene co-presence alone creates no relationship transition | Blocked: transition evaluator absent |
| REL-005 — Knowledge boundary | Core manifest is a reference list, not actor-specific access | Relationship context cannot grant access to another character's secret | Blocked: actor-specific context filter absent |
| REL-006 — No automatic NPC creation | Core entity creation is an explicit effect | Displaying an unresolved person reference does not create an entity/NPC/card | Partially adjacent: no relationship projection boundary verified |
| REL-007 — Read-only card summary | Character-card document is a planning outline only | Summary is derived from authoritative state and cannot be edited as a second writable copy | Blocked: card projection boundary absent |
| REL-008 — Rollback of dependent transition | Core rollback tests cover causal event effects | Reconcile a relationship transition whose sole cause was invalidated | Blocked: relationship-to-core causal mapping absent |
| REL-009 — Independent support survives | Core rollback tests cover independent world-event branches | Preserve a relationship state supported by a remaining independent valid cause | Blocked: relationship support/reconciliation model absent |
| REL-010 — No invented explanation | NPC contract forbids fabricated motives/history | Missing rationale stays unresolved rather than inventing a prior interaction | Semantic requirement only; no decision/evidence boundary verified |
| REL-011 — No reciprocal inference | NPC contract already forbids inferred romantic reciprocity | Verify directional relationship dimensions remain independent | Blocked: relationship read/decision boundary absent |
| REL-012 — Author edit is attributed | Core audit entries exist for supported operations | Distinguish authored correction from an in-world event through an approved operation | Blocked: author relationship-edit boundary absent |

Do not create a parallel relationship database, ID/revision scheme, causal graph, rollback engine, or card-owned writable state to satisfy these tests.


## 11. Relationship test order after core-owner decision (2026-10-24)

The core owner's five-point response is recorded in PR #38 comment [6377468310](https://github.com/necromorphic/Logic-Engine/pull/38#issuecomment-6377468310) and in docs 42–43. This section turns that response into a dependency-ordered test plan; it does not claim that any missing boundary now exists.

### Gate A — typed canonical operation and validation

Before relationship-transition tests can be executable, the core must define and validate a typed relationship record/effect on the canonical event/revision/audit path. Required tests:
- reject malformed relationship effects and invalid dimension/value combinations;
- preserve directional identity (A→B is not B→A);
- allow dimension-level partial updates without rewriting unspecified dimensions;
- preserve unknown/unset separately from explicit domain-defined neutral;
- distinguish author-initial/imported provenance from an in-world transition;
- reject a committed participant that is not resolved to a canonical entity_id;
- prove that unresolved authoring/import references do not create entities, NPCs, or cards.

Generic entity.update and fact.set tests are not substitutes for this contract.

### Gate B — consistent snapshot plus trusted actor/purpose filter

PR #45 currently proposes a bounded, transaction-consistent internal snapshot read and remains open/unmerged. Even after integration, its raw canonical output is not an NPC/player read contract. Before REL-005, REL-007, or actor-relative decision-context tests can pass, define and test a core-owned filter scoped to the actor, purpose, and exact snapshot marker:
- two actors receive only the relationship/context data authorized for each;
- author-reserved or otherwise restricted material is excluded before it reaches a model/player boundary;
- unknown, withheld, missing, and explicit neutral remain distinguishable where the contract permits that distinction;
- the read and returned relationship summary are tied to one consistent (world_revision, commit_sequence) view;
- character-card summary is bounded, derived, read-only, and does not expose raw records or become a second writable source of truth.

A context manifest, prompt inclusion, vector retrieval, or successful raw snapshot read does not satisfy this gate.

### Gate C — causal support and multi-cause rollback

Before REL-008/009 can be considered implemented, relationship transitions must carry valid canonical source/cause references and the core rollback path must define reconciliation of support from remaining valid causes. Required tests:
- invalidating the sole valid cause removes the dependent relationship transition;
- invalidating one of multiple independent causes preserves the transition while another valid cause remains;
- invalidating the final remaining cause removes it;
- unrelated relationship dimensions and independent transitions survive;
- rollback does not create an NPC-specific causal graph/log or automatically rewrite current belief merely because canonical truth changed.

Existing world-event rollback tests provide adjacent coverage only; they do not prove relationship reconciliation.

### Gate D — authoring/audit and end-to-end acceptance

Once Gates A–C exist, exercise REL-001–012 through the real agreed interfaces and storage/transaction behavior. In particular:
- an author edit is auditable as authored correction/initialization, not misrepresented as an in-world event;
- missing rationale remains unresolved rather than fabricated;
- scene co-presence alone creates no transition;
- the card projection is read-only;
- no relationship change implies reciprocal feeling, consent, knowledge acquisition, or secret access.

Tests must not use mocks to simulate a missing production boundary. No public API, SQLite schema, runtime, or NPC implementation work is authorized by this test map.

### Current gate status

| Gate | Status at this branch review | Reason |
|---|---|---|
| A — typed canonical relationship operation | Blocked | No suitable relationship-specific effect/record was found in inspected core primitives; exact contract remains to be designed. |
| B — authorized relationship read/projection | Blocked | PR #45 is open/unmerged and raw-only; no verified actor/purpose/snapshot relationship filter exists. |
| C — multi-cause rollback reconciliation | Blocked | Current generic rollback is insufficient to promise relationship support reconciliation; no relationship-specific causal mapping/tests verified. |
| D — full acceptance through real interfaces | Blocked | Depends on A–C and an approved author-edit/provenance boundary. |

Do not interpret this table as a request to implement all gates in the NPC branch. Core-owned interfaces and cross-block approval must precede runtime/schema changes.

## 12. NPC-owned semantic checks that can be prepared before core runtime exists

This section separates NPC decision semantics that can be specified without relationship storage from integration assertions that must wait for core-owned interfaces. These are test cases for a future real NPC decision boundary, not claims that an executable NPC runtime or relationship evaluator currently exists.

### NPC-SEM-REL-004 — Co-presence is not a cause

**Fixture**
- Two canonical characters share a scene.
- Their relationship state is absent/unknown or has a known baseline.
- No meaningful interaction, disclosure, conflict, assistance, commitment, or other supported relationship-relevant event occurs.
- No author instruction explicitly changes their relationship.

**Action under test**
Evaluate the NPC decision/relationship-transition policy for the scene.

**Required assertions**
- Mere co-presence does not propose or commit a relationship change.
- Existing relationship dimensions remain unchanged; unknown dimensions remain unknown.
- The system does not invent a conversation, observation, prior interaction, motive, or emotional reaction to justify a change.
- If some other explicit supported event exists, any proposed change must identify that event as its rationale and remain subject to normal validation; scene membership alone is not the rationale.

**Boundary**
This can be specified as an NPC policy acceptance case now. It becomes an executable integration test only when the real decision/transition boundary exists. Do not create a fake relationship store or infer state from generated prose.

### NPC-SEM-REL-010 — Missing rationale remains unresolved

**Fixture**
- An NPC is asked to explain a relationship state or a change.
- The available authorized context contains no supporting interaction, event, source, or author instruction explaining it.
- The relationship value itself may be known, but its cause is not.

**Action under test**
Generate an explanation or decision rationale using only the authorized context.

**Required assertions**
- The NPC may state that the reason is unknown, offer a clearly marked hypothesis only if the task permits hypotheses, or request adjudication where required.
- It must not invent a past interaction, secret motive, event, promise, betrayal, or evidence and present it as established history.
- A relationship value is not itself proof of the event or motive that caused it.
- Any hypothesis remains distinct from canonical truth and from a persisted belief unless the real core contract explicitly records it as such.

**Boundary**
This is an NPC output/decision-semantic requirement. Textual conformance alone does not prove provenance correctness; the eventual integration test must verify the actual authorized context and any structured rationale/source references.

### NPC-SEM-REL-006 — Unresolved person reference does not create a character

**Fixture**
- An authoring note or source refers to a person by a name/alias.
- No canonical `entity_id` has been resolved for that person.
- The person reference is included in a read-only projection or decision-context candidate.

**Action under test**
Resolve/project the reference without an explicit, authorized entity-creation operation.

**Required assertions**
- The reference remains unresolved/claimed data; it does not create a canonical entity, NPC, card, relationship participant, or independent identity record.
- Name, alias, claimed biography, or apparent relationship is insufficient to merge the reference with an existing entity.
- A canonical relationship write involving the unresolved reference is rejected until participants are resolved under the approved core contract.
- Read-only projection has no canonical side effects.

**Boundary**
The no-creation rule can be asserted at the actual pure projection/reference-resolution boundary when one is available. Relationship-write rejection requires the typed core operation and is blocked until that interface exists. Do not implement a second identity registry to make this test pass.

### Evidence required before marking any case passed

For each eventual executable test, record the production function/interface invoked, the actual authorized inputs, canonical state before and after, and the observed proposal/event/revision effects. A prompt-only example, mocked missing interface, or documentation-only assertion is not an integration pass. These cases do not unblock relationship persistence, actor-specific access filtering, or causal rollback.

## 13. Knowledge first-slice acceptance plan — implementation gate remains closed

The first supported acquisition path is limited to explicitly authorized `author_initial`/imported knowledge, as agreed in `docs/39-npc-core-knowledge-contract-proposal.md` §§10–13. This section links the core-owned implementation gate to the broader NPC semantic acceptance matrix in `docs/32-npc-semantic-acceptance-matrix.md`; it does not replace those scenarios or claim they are executable.

| Case | Related semantic scenario(s) | Setup and required assertion | Current status |
|---|---|---|---|
| K-001 — Actor separation | NPC-SEM-001, NPC-SEM-007 | Two canonical actors request the same snapshot. An initial-knowledge entry authorized for A must not appear in B's actor-specific result unless a separately authorized source supports it. | Blocked: trusted actor/purpose/snapshot read boundary and source representation absent |
| K-002 — Provenance survives projection | NPC-SEM-003, NPC-SEM-006, NPC-SEM-019 | An explicitly authorized initial/imported entry retains its authored/imported provenance and source reference in the core result; a bare profile sentence or prompt fragment is not silently upgraded into an acquisition record. | Blocked: executable acquisition record/write boundary not verified |
| K-003 — Truth, acquisition, belief remain distinct | NPC-SEM-002 | A canonical proposition may be true without being acquired by the actor; acquisition does not force belief; a belief does not prove canonical truth or acquisition. Test each state independently using the real core-owned representations. | Blocked: persistent acquisition and belief representations absent |
| K-004 — Unknown differs from withheld | NPC-SEM-001, NPC-SEM-010 | A source not supplied, an inaccessible/reserved source, an incomplete result, and an explicitly false proposition must not collapse to the same result. Do not reveal restricted content merely to explain why it was withheld. | Blocked: authorized read/filter result contract absent |
| K-005 — Read and proposal do not acquire knowledge | NPC-SEM-001, NPC-SEM-008 | Reading a context, registering a manifest, retrieving a vector, or creating a non-committed proposal must not create an acquisition record or change persistent belief. Compare canonical state before and after. | Blocked: acquisition persistence absent; adjacent manifest/proposal primitives alone do not satisfy the epistemic assertion |
| K-006 — Snapshot consistency | NPC-SEM-001, NPC-SEM-007 | All returned source and actor-relative records must correspond to the exact same `(world_revision, commit_sequence)` pair. A stale or mixed-snapshot request fails closed or returns an explicit unsupported/stale status. | Blocked: PR #45 is unmerged; actor filter remains absent even if snapshot read is integrated |
| K-007 — Reserved-secret exclusion | NPC-SEM-001, NPC-SEM-015 | A reserved secret is excluded before model-visible context is constructed unless an explicit trusted rule authorizes its inclusion. The test must inspect actual model-bound input, not only the final prose. | Blocked: secret classification and trusted access filter not verified |
| K-008 — Unsupported acquisition paths fail closed | Acquisition-path matrix in docs/32, §§13.1–13.4 | Observation, communication, document reading, inference, and rumor cannot be recorded as supported acquisition until their evidence paths and acceptance tests are approved and implemented. | Deferred by decision; not a first-slice capability |

These are acceptance targets, not executable test names or evidence of passing behavior. The linked NPC-SEM scenarios remain the normative semantic requirements; the K-cases make their first-slice core dependencies explicit. Do not add test doubles that simulate missing production interfaces and then report the cases as integration passes. Once the core owner exposes the real source and read/filter boundary, bind each case to the exact production function, actor identity, snapshot marker, state-before/state-after assertions, and trusted model-input boundary. Keep the implementation gate closed until those real boundaries exist.


## 14. Relationship acceptance cases after core decision (2026-10-24)

The main architecture chat has confirmed the semantic boundaries for relationship work. The detailed, schema-neutral cases are now collected in [docs/44-npc-relationship-semantic-acceptance.md](https://github.com/necromorphic/Logic-Engine/blob/feat/npc-subsystem/docs/44-npc-relationship-semantic-acceptance.md).

The cases cover:
- directional asymmetry and no inferred reciprocity;
- partial dimension updates without collateral changes;
- unknown/unset versus explicit World Pack-defined neutral;
- co-presence not being a cause;
- separate author-initial/imported, author-correction, and in-world origins;
- rejection of unresolved participants and unsupported self-relations;
- dependent rollback and independently surviving causal support;
- snapshot consistency versus actor/purpose authorization;
- bounded, read-only character-card projection;
- relationship state not granting knowledge;
- no invented explanation for an unsupported relationship value.

**Current status:** semantic cases may be refined now, but they are not executable coverage and do not establish runtime readiness. Keep the existing relationship gates A–D blocked until the typed canonical operation, authorized read/filter boundary, causal support representation, and authoring provenance path exist and are tested through production interfaces. Multi-cause rollback remains a hard blocker if the core causal model cannot prove independent support.

Do not simulate missing production behavior with prompt instructions, arbitrary entity attributes, `fact.set`, a parallel NPC store, a second causal graph, or mocks reported as integration passes.


## 15. Typed-operation design and causal review dependency (2026-10-24)

See [docs/45-npc-relationship-typed-operation-design.md](https://github.com/necromorphic/Logic-Engine/blob/feat/npc-subsystem/docs/45-npc-relationship-typed-operation-design.md) for the schema-neutral design proposal. It distinguishes required event dependencies from alternative relationship support and explains why the current `caused_by` list cannot be treated as OR-support semantics.

REL-SEM-009 and REL-SEM-010 remain blocked. In particular, do not claim that the current generic rollback proves independent relationship support. A real implementation must pass rollback/replay tests through the canonical production path after the main architecture chat approves the typed-effect and causal boundary.
