# Relationships — World Pack version semantics and migration boundary

Status: domain contract for Issue #143, based on the current `main` runtime. This document clarifies the version semantics of the existing typed Relationship transition; it does not add a migration API, registry, storage field, or replay implementation.

Related: Issues #143 and #130; Core runtime contract in `docs/55-core-relationship-transition-runtime-slice.md`; Personality acceptance identifiers `PERS-SEM-024` and `PERS-SEM-029`.

## 1. Version identities that exist today

The current typed operation accepts `rule_module_id` and `rule_module_version`. Its registered immutable rule-module manifest carries `metadata.relationship_domain`, which includes `world_pack_id`, `world_pack_version`, and the dimension rules. The target world itself has `world_pack_id` and `world_pack_version`.

These are related but distinct identifiers:

- **World Pack identity/version** describes the domain vocabulary and semantics intended for a world.
- **Rule-module identity/version** selects the exact registered rule-module manifest and its declarative Relationship dimension rules consumed by the candidate evaluator. The manifest is not an executable historical evaluator.
- **Core contract version** in the manifest's `compatibility.core_contract_versions` describes runtime-contract compatibility; it is not a World Pack version.

The commit path requires the exact registered `rule_module_id + rule_module_version`; the module must declare `validate_transition`; and `relationship_domain.world_pack_id + world_pack_version` must match the target world's identity/version. An unknown module version supplied to a typed commit fails with `RELATIONSHIP_RULE_VERSION_NOT_FOUND`; a direct `getRuleModuleManifest()` lookup for an absent registry entry fails with `RULE_MODULE_NOT_FOUND`; a mismatched World Pack identity/version or unsupported `relationship_domain` metadata fails closed with `RELATIONSHIP_RULE_VERSION_INCOMPATIBLE`. These error codes belong to distinct API boundaries.

Source evidence: `src/application/engine.js` (request validation and construction of the typed effect); `src/storage/sqlite-store.js` (exact manifest lookup, World Pack compatibility checks, and invocation of `evaluateRelationshipCandidate` with the manifest's declarative dimensions); `src/core/mechanics.js` (manifest-shape validation); `docs/55-core-relationship-transition-runtime-slice.md`; `tests/relationship-transition-core.test.js` — `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`.

## 2. What is pinned to an operation/event

At commit time, the request selects `rule_module_id` and `rule_module_version`. The accepted `relationship.transition` effect records both values; the source test asserts these exact fields on the committed event effect. The same event records the directed participants, patch, evidence references, and server-derived executor. The world’s World Pack identity/version is checked against the registered module before the mutation is accepted.

Therefore, the **operation's explicit historical rule pin is the pair `(rule_module_id, rule_module_version)` stored on the committed typed effect**. The matching World Pack identity/version is currently validated through the registered manifest at write time; do not assume a separate World Pack version field is stored on the event unless an exact event-schema/test assertion establishes it.

Source evidence: `tests/relationship-transition-core.test.js` — `admin route commits through the canonical event lifecycle and returns the current directed projection`; `src/application/engine.js`; `docs/55-core-relationship-transition-runtime-slice.md`.

## 3. Replay is not migration or re-evaluation

The current Core rebuild path deterministically replays surviving valid typed event effects to reconstruct the projection. That is a projection-rebuild guarantee, not permission to reinterpret a historical transition using whatever World Pack is current today.

Domain rule:

1. Replay/materialization must preserve the committed event's accepted effect and its pinned `rule_module_id + rule_module_version`; it must not silently replace that pin with a newer version.
2. Re-evaluating a candidate is a different operation. It must use the exact historical rule module and its matching World Pack semantics. If those inputs are unavailable, it must fail closed rather than substitute current rules.
3. A meaning-changing World Pack version is not a transparent patch-level refresh merely because both versions can be represented as semantic-version strings.
4. An event that was validly committed under an older version remains a historical event. Migration, if ever approved, must be explicit, version-to-version, reviewable, and separately auditable; it must not mutate the meaning of the original event in place.

Core PR #148 is merged and adds `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` in `tests/relationship-transition-core.test.js`. On exact head `f493f719fddcec2f1a085d7d6a22781f75a5106c`, Runtime CI run #903 passed. The test commits an event pinned to `relationship-rules@1.0.0`, reopens the SQLite store, removes the `1.0.0` manifest directly from the registry table, and registers `relationship-rules@2.0.0`. A direct `getRuleModuleManifest('relationship-rules', '1.0.0')` lookup then fails with `RULE_MODULE_NOT_FOUND`; the test verifies that this failed lookup does not mutate the captured canonical state. Projection rebuild then succeeds from the committed effect and verifies that the event and projection still carry `relationship-rules@1.0.0`. The registry lookup failure and projection rebuild are separate operations. This proves projection-only replay and exact lookup behavior, not historical semantic re-evaluation or migration.

Source evidence: `tests/relationship-transition-core.test.js` — `Relationship projection survives store restart and deterministic rebuild from valid events`, `admin route commits through the canonical event lifecycle and returns the current directed projection`; `docs/55-core-relationship-transition-runtime-slice.md`.

## 4. Fail-closed matrix

| Condition | Required domain interpretation | Existing evidence / status |
|---|---|---|
| Exact registered rule module and matching World Pack version available at commit | Candidate may be evaluated against those exact rules; commit only through the existing typed Core path. | Covered at write boundary by `admin route commits through the canonical event lifecycle and returns the current directed projection`. |
| Requested rule-module version is unknown at commit | Reject without mutation; do not fall back to latest or nearest version. | Covered by `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` (`RELATIONSHIP_RULE_VERSION_NOT_FOUND`). |
| Registered module pins a different World Pack version/identity than the world | Reject without mutation; do not coerce or auto-upgrade the module metadata. | Covered by the same test (`RELATIONSHIP_RULE_VERSION_INCOMPATIBLE`). |
| Historical committed event pins an old version that is no longer registered; only projection rebuild is requested | Rebuild from the committed typed event/effect, without resolving or executing the old manifest and without rewriting its pin or applying current semantics. | **RUNTIME-TESTED — Core PR #148**: projection rebuild succeeds from the committed effect and preserves the event/projection pin. The test separately proves that direct exact registry lookup of the removed `1.0.0` manifest fails with `RULE_MODULE_NOT_FOUND` while `2.0.0` is registered; the failed lookup is read-only (Runtime CI #903). |
| Historical event needs semantic re-evaluation, but its exact rule module/World Pack definition is missing or unavailable | Historical semantic re-evaluation is unsupported in the current release; fail closed and never use current rules as a substitute. | **UNSUPPORTED / FAIL-CLOSED — current-release decision in Core #146 and Relationships #143**: exact historical World Pack provenance and an approved executable evaluator are not established. PR #148 covers projection-only rebuild, not re-evaluation. |
| Historical event/version is incompatible with a current World Pack | Do not reinterpret the historical event under the current pack. Projection-only rebuild remains separate; historical semantic compatibility/re-evaluation is unsupported in the current release. | **UNSUPPORTED / FAIL-CLOSED**: no exact historical World Pack provenance/evaluator contract or historical compatibility execution path is established. |
| Explicit version-to-version migration is requested | Migration is unsupported/refused in the current release. Permit it only after a separately approved migration definition and auditable execution path exist; preserve the original event. | **UNSUPPORTED / REFUSED**: no approved migration schema/API/path or executable migration test exists in current main. |
| Candidate is re-evaluated twice with identical inputs and identical pinned rules | Domain evaluator should return the same result; this is deterministic evaluation, not a guarantee of canonical idempotency. | Cross-reference Personality `PERS-SEM-024`; pure evaluator evidence lives in `tests/relationship-evaluate-candidate.test.js`. Core idempotency is separate and covered by `HTTP idempotent retry returns the established transition without a second event`. |
| A meaning-changing World Pack migration or incompatibility is proposed | Require explicit compatibility/migration decision; never infer safety from deterministic replay. | Cross-reference Personality `PERS-SEM-029`; its traceability remains Personality-owned and is not edited here. |

## 5. Acceptance cases and ownership

The following cases are the Relationships acceptance contract. Rows marked **BLOCKED** identify a missing cross-layer guarantee; they are not represented as passing tests.

| Case | Acceptance assertion | Existing named evidence / disposition |
|---|---|---|
| Same-version deterministic replay | Rebuild of surviving valid transition events yields the same directed projection and does not turn an explicit clear/value into unset. Historical module pin remains unchanged. | `Relationship projection survives store restart and deterministic rebuild from valid events`; `explicit neutral, cleared and unset remain distinct across replay`; Core PR #148 test `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` (Runtime CI #903). **Runtime-tested**, with scope limited to projection rebuild. |
| Unknown version on a new commit | Reject before mutation; no fallback to latest. | `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`. |
| Incompatible World Pack version on a new commit | Reject before mutation; no coercion to current world version. | Same named Core test. |
| Unknown/unavailable historical version during projection rebuild | Projection rebuild applies the already-committed effect and preserves its stored pin; it does not require the missing manifest. Any separate operation that requires the historical manifest must resolve that exact version and fail closed if absent. | **RUNTIME-TESTED — Core PR #148**: rebuild preserves the original event/projection pin; separate direct `getRuleModuleManifest()` lookup fails with `RULE_MODULE_NOT_FOUND` without mutation while a newer version is registered (Runtime CI #903). This does not cover semantic re-evaluation. |
| Historical semantic re-evaluation with missing rules | Unsupported in the current release; any future approved entry point must fail closed on missing exact rules/provenance and must not use current rules. | **UNSUPPORTED / FAIL-CLOSED**: no historical evaluator/provenance path is shipped. |
| Approved migration exists | Validate the declared source and target versions, preserve the original event, record the explicit migration result, and test replay before/after migration. | **NOT APPLICABLE YET**: no approved migration path exists in current main; do not invent its API/schema or add a fake passing test. |
| No approved migration exists | Refuse semantic migration and retain original historical interpretation. | Normative domain rule for this handoff; executable end-to-end migration-refusal test is **BLOCKED — Core owner** because no migration entry point exists. |
| Deterministic repeat vs meaning-changing migration | Same pinned inputs are a repeat-evaluation case; a semantic version change is a compatibility/migration case requiring separate review. | Personality cross-references: `PERS-SEM-024` and `PERS-SEM-029`. No Personality file changed. |

## 6. Boundaries and deferred work

- **Relationships owns** domain meaning, the rule that old events must not be silently reinterpreted, and acceptance criteria distinguishing replay from migration.
- **Core owns** event/effect persistence, registry availability, canonical replay/rebuild, historical pin preservation, runtime errors, and any future migration transaction/API. This PR does not alter Core storage or replay.
- **Core historical-version disposition:** [Issue #146](https://github.com/necromorphic/Logic-Engine/issues/146) records the current-release boundary: projection rebuild applies committed effects and preserves their pins; historical semantic re-evaluation is unsupported because exact historical World Pack provenance and an approved executable evaluator are not available. [PR #153](https://github.com/necromorphic/Logic-Engine/pull/153) is a merged documentation proposal, not runtime authorization. Reopening this capability requires a new cross-block approval and a separately reviewed Core contract.
- **Separate migration handoff:** no approved migration API/schema/path exists. Relationships must approve the meaning-changing source-to-target policy; Core must then define and implement the separately authorized, auditable execution path and refusal behavior. No silent migration or in-place reinterpretation of original events.
- **Personality owns** `PERS-SEM-024` and `PERS-SEM-029` traceability. This PR only references those identifiers; it changes no Personality file.
- No current evidence establishes an approved World Pack migration path. No API, schema, compatibility algorithm, migration registry, or automatic upgrade is proposed.
- NPC/model authority, general authorized Relationship reads, acquisition/belief integration, and alternative evidence-support semantics remain outside this issue and are not implied by version pinning.

## 7. Validation record

Documentation-only Relationships change. Existing test names above are evidence for the exact bounded behaviors stated; they are not a claim that the new acceptance gaps pass. Exact-head CI status must be recorded from the workflow run for the PR head. No Core runtime/storage/replay or Personality traceability files are changed.

## 8. Personality ↔ Relationships cross-review

Cross-reviewed against Personality PR #141, `docs/personality/09-per-case-acceptance-traceability.md` (current PR head at review time). This table distinguishes evaluator-level determinism from persisted event pinning, canonical projection replay, and semantic migration. A related traceability row or deterministic evaluator test is not evidence that a historical-version runtime path exists.

| Personality case / scenario | Relationships interpretation | Evidence class | Status / owner |
|---|---|---|---|
| `PERS-SEM-024`: repeat evaluation with identical inputs and the same pinned rules | Same candidate inputs plus the same `rule_module_id + rule_module_version` should yield the same evaluator result. This is narrower than event persistence or replay. | Evaluator test: `tests/relationship-evaluate-candidate.test.js`; canonical idempotency has separate Core evidence: `HTTP idempotent retry returns the established transition without a second event`. | **Evaluator-tested** for deterministic evaluation; **runtime-tested separately** for the named idempotency behavior. Do not treat either as proof that the historical rule module remains available after restart. |
| `PERS-SEM-024`: replay of committed same-version transitions | Rebuild the directed projection from surviving valid events; the event's rule-module pin must not be rewritten. | Core runtime tests: `Relationship projection survives store restart and deterministic rebuild from valid events`; `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` (Core PR #148, Runtime CI #903). | **Runtime-tested** for projection rebuild and historical pin preservation. This is not proof of semantic re-evaluation. |
| Unknown rule-module version on a new transition | Reject before mutation; no fallback to latest/nearest. | Runtime test: `tests/relationship-transition-core.test.js` — `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`. | **Runtime-tested** at the new-commit boundary. This does not establish behavior for an already-committed historical event. |
| Incompatible World Pack identity/version on a new transition | Reject the candidate against the target world if the registered module's World Pack identity/version does not match. | Same named Core runtime test; incompatible metadata maps to `RELATIONSHIP_RULE_VERSION_INCOMPATIBLE`. | **Runtime-tested** at the new-commit boundary; historical replay compatibility remains separate. |
| Historical event whose pinned module is unavailable during replay/rebuild | Projection-only rebuild must not substitute a newer module or mutate the historical pin. | Core PR #148 test `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` removes `1.0.0`, registers `2.0.0`, and verifies lookup failure plus pin preservation (Runtime CI #903). | **Runtime-tested for projection rebuild**; semantic re-evaluation remains unsupported and untested. |
| `PERS-SEM-029`: meaning-changing World Pack version or historical incompatibility | Treat as a compatibility/migration decision, not a deterministic-repeat case. No silent reinterpretation, automatic upgrade, or in-place mutation of the original event. | Relationships domain contract documented here; Personality PR #141 identifies this as an implementation/test gate. No approved migration schema/API/path or runtime migration test was found in current `main`. | **Documented only / migration absent**. **BLOCKED — Relationships + Core** until domain compatibility policy and any execution path are explicitly approved. |
| Explicit migration from an old World Pack version to a new one | Only an approved, explicit, auditable source-to-target migration may be considered; preserve the original event and separately verify replay. | No existing migration entry point, schema, or named runtime test. | **Not applicable yet**: no approved migration path exists. Do not invent one in this PR. |
| Migration requested when no approved path exists | Refuse semantic migration; retain the original historical interpretation. | Normative domain rule in this document; no executable migration entry point exists to test refusal end-to-end. | **Documented rule; runtime test BLOCKED — Core** until an approved entry point exists or the system exposes a concrete refusal boundary. |

### Cross-review result

There is no semantic contradiction between PR #141 and this contract provided that `PERS-SEM-024` remains limited to deterministic evaluation/replay under identical pinned inputs and `PERS-SEM-029` remains the separate meaning-change/migration gate. The remaining gap is narrower: historical semantic re-evaluation with missing rules and executable migration refusal are **not** established by current runtime tests. Projection-only rebuild and preservation of the historical pin are now covered by Core PR #148 (Runtime CI #903). Keep semantic re-evaluation and migration rows blocked rather than presenting evaluator-only or documentation evidence as Core runtime proof.

Ownership boundary remains unchanged: this PR changes only Relationships documentation. Core storage/replay/runtime and Personality traceability are untouched.

## 9. Relationships compatibility decision boundary

For domain interpretation, a version string is an identifier, not evidence of semantic compatibility. Semantic-version ordering (including patch/minor/major labels) alone must never authorize interpreting a historical Relationship transition under another World Pack version.

Until a separately reviewed compatibility declaration and executable Core path exist, use this default:

- **New typed transition:** accept only through the existing Core path with the exact registered `rule_module_id + rule_module_version` and the exact `world_pack_id + world_pack_version` match already required at commit. A different World Pack identity/version is incompatible; reject before mutation.
- **Already-committed event, projection-only rebuild:** replay the committed effect and preserve its stored result and exact rule-module pin. Do not re-run current rules. This narrow operation may succeed even when the old manifest is unavailable, as covered by Core PR #148.
- **Historical semantic re-evaluation:** exact historical executable rules and World Pack provenance are prerequisites. If either cannot be resolved unambiguously, the domain decision is **unsupported / fail closed**; never infer compatibility from the current world, a newer manifest, or semver distance. There is no shipped evaluator contract in current main.
- **Meaning-changing migration:** unsupported in the current release. No implicit migration, in-place reinterpretation, or “best effort” conversion is permitted. A future migration requires an explicit Relationships-owned source→target semantic policy and a separately approved Core execution/audit contract; no such API/schema/path is implied here.

### Acceptance boundary for tests

Relationships can define these semantic outcomes, but cannot honestly add an executable end-to-end test for historical re-evaluation or migration refusal while Core exposes no approved runtime entry point for either operation. Such a test would be a fixture/pure-helper assertion, not proof of production behavior. Keep those rows **BLOCKED — Core runtime path + joint domain approval** until the actual entry point and contract exist. When they do, require no-write assertions for missing/unknown/incompatible provenance and refusal without an approved migration path; preserve the original event and verify deterministic projection rebuild independently.

This section is a domain compatibility default, not a storage/API/schema change and not authorization to edit Core or Personality-owned files.

## 10. Refreshed domain invariant and operation acceptance contract (26 Oct 2026)

### World Pack provenance invariant

For every committed Relationship transition, the historical semantics needed to explain or re-evaluate that transition must remain unambiguous for its full retained lifetime, including process restart, projection rebuild, manifest unregister/removal, replacement by a newer manifest, backup/restore, and recovery. A version label alone is not provenance. Even where an event/effect records `world_pack_id + world_pack_version`, those identifiers alone do not prove that the complete historical executable rules and provenance remain available; they are necessary identification metadata, not sufficient proof that semantic re-evaluation is possible.

**Preferred representation:** persist the exact `world_pack_id + world_pack_version` on the committed event/effect alongside the existing `rule_module_id + rule_module_version`, if and when Core approves the event-contract change. Relationships does not authorize or implement that schema change.

**Permitted alternative:** an indirect event-to-World-Pack mapping is acceptable only when Core demonstrates that it is immutable, append-only, durable for every referencing event, integrity-checked, exact-version-addressable, retained through restart/restore, and cannot be deleted, rebound, or silently resolved to a replacement. A lookup through the currently registered manifest is not by itself sufficient proof of historical provenance.

**Fail-closed consequence:** if provenance cannot be resolved exactly for an operation that requires semantic interpretation, reject that operation before canonical mutation. Never substitute the latest/nearest module or World Pack. Projection-only rebuild of an already committed effect remains a distinct operation and must preserve the original effect and module pin without semantic re-evaluation.

### Per-operation acceptance matrix

| Operation | Status in current release | Required inputs | Owner | Failure behavior | Acceptance test / evidence required |
|---|---|---|---|---|---|
| New typed Relationship transition | Supported through existing Core commit path, subject to exact current registration | Exact rule-module ID/version; manifest World Pack ID/version matching target world; existing typed transition inputs/evidence | Core runtime; Relationships defines domain compatibility | Reject before mutation on unknown module or World Pack mismatch; no latest fallback | Existing Core test `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`; assert canonical state/event count unchanged |
| Deterministic projection replay of a committed effect | Supported within existing replay contract | Original committed event/effect and its stored rule-module pin; no current-rule re-evaluation | Core runtime; Relationships defines preservation invariant | Do not rewrite event/pin or reinterpret under current rules; invalid event handling follows existing Core replay contract | Core PR #148 test `projection rebuild preserves the exact historical rule-version pin when its module is unavailable`; restart/rebuild with old module removed and newer module registered |
| Historical semantic re-evaluation | Unsupported until joint contract approval and executable Core path exist | Original event/effect; exact historical rule-module ID/version; exact World Pack identity/version and executable semantics; approved evaluator contract | Core owns execution/version resolution; Relationships + Personality approve domain contract | Explicit unsupported/unavailable/incompatible failure before mutation; no fallback; canonical events, revision, projection, and audit remain unchanged | BLOCKED: after entry point is approved, test exact historical selection; missing/unknown/incompatible provenance and newer-only module each fail with no writes |
| Meaning-changing migration | Unsupported; no approved executable path | Explicit approved source→target semantic policy; exact source/target versions; preserved original event; auditable migration result; approved Core execution contract | Relationships owns semantic policy; Core owns transaction/API/audit path; Personality owns its traceability | Refuse while no approved path/policy exists; never mutate the original event in place or silently auto-upgrade | BLOCKED: no migration entry point exists; after approval, test explicit version-to-version result, original-event preservation, audit record, and deterministic replay before/after |

These are domain acceptance criteria, not claims that blocked runtime behavior is implemented. Do not add fixture-only or pure-helper tests and label them as production-path evidence. Close the blocked rows only against the approved real Core entry point and exact-head CI evidence.

## 11. Relationships domain scope and ownership boundaries (27 Oct 2026)

This section defines the intended domain boundary of Relationships. It clarifies responsibility; it does not claim that every capability below is already implemented in the runtime.

### 11.1 Relationships owns

Relationships owns the domain semantics for relationship state and change, including:

- **Relationship dimensions and their meaning:** the supported dimensions, their allowed values, and the distinction between absent, explicitly neutral, cleared, withheld, conflicting/insufficiently supported, and unsupported/incomplete information where those states are defined by the existing domain contract.
- **Evidence-based change justification:** deciding whether available, admissible evidence supports a proposed relationship change, which dimensions it supports, and what uncertainty or conflict must remain explicit. A signal or interpretation is not automatically a canonical fact.
- **Social-interaction consequences:** domain rules for how interpreted interactions may affect relationships, including flirtation, sarcasm, teasing, irony, affection, care, hostility, provocation, rejection, apology, boundary-setting, and ambiguous or mixed signals. These categories are examples of semantic cases, not a claim that a complete classifier currently exists.
- **Context-sensitive relationship interpretation:** rules for considering prior interactions, current relationship state, situational context, and relevant World Pack semantics when determining whether evidence supports a relationship consequence.
- **Transition policy and explainability:** allowed relationship transitions, rejected transitions, the evidence and rule basis for a decision, unresolved ambiguity, and why a proposed change is insufficiently supported.
- **Relationship-specific World Pack semantics and compatibility policy:** domain meaning of relationship dimensions/rules, exact-version compatibility requirements, and any future explicit source-to-target semantic migration policy, subject to joint approval where another block owns execution or traceability.

Relationships must not turn a single interaction label (for example, “sarcasm” or “flirtation”) into a fixed relationship delta unless an approved, versioned domain rule explicitly justifies that result. It must not infer reciprocity, consent, commitment, attraction, intent, or durable personality traits merely from ambiguous behavior or one-sided evidence.

### 11.2 Boundary with NPC

NPC owns character-relative perception and interpretation of observed behavior: what a particular character notices, how that character may read an utterance or action, and how that interpretation is constrained by the character's knowledge, perspective, and context.

Relationships owns the relationship-domain decision that follows from admissible evidence or an explicitly supplied interpretation: whether it supports a relationship consequence, which dimensions may change, and how uncertainty is represented.

Therefore:
- NPC's interpretation that an action *might be flirtation* is evidence/context for Relationships, not an automatic relationship fact.
- Relationships must not invent what a character observed, knew, intended, felt, or believed.
- Relationships must not replace NPC's character-specific perception model with a universal social-signal classifier.
- When the input does not distinguish flirtation from sarcasm, teasing, hostility, or another plausible reading, preserve ambiguity or return an insufficient-support outcome under the existing domain contract; do not force a single reading.

The exact transport shape between NPC and Relationships remains governed by existing approved contracts. This document does not create a new API, event, field, schema, or runtime receiver.

### 11.3 Boundary with Personality

Personality owns stable personality traits and their semantic evaluation/traceability under its own contract. Relationship state may provide context to Personality where an approved integration permits it, but a transient interaction or relationship transition must not silently become a stable personality trait.

Relationships must not:
- infer a stable trait from a single interaction or relationship dimension;
- use relationship state as proof of a character's knowledge, motive, consent, obligation, or reciprocity;
- overwrite or reinterpret Personality-owned results;
- implement Personality's acceptance cases or version-traceability contract on Personality's behalf.

Cross-block semantic rules and tests must be explicitly coordinated. Existing Personality acceptance identifiers and the separation between deterministic repeat under pinned inputs and meaning-changing migration remain unchanged.

### 11.4 Boundary with Core

Core owns canonical authority and execution: validating the approved operation and its provenance, enforcing the canonical commit path, persistence, event/revision behavior, and any approved replay, audit, or migration execution contract.

Relationships may define domain acceptance/rejection criteria and provide domain-owned rules or decisions through existing approved seams. It must not independently write canonical state, bypass Core's transaction/commit path, invent storage/API/schema/lifecycle guarantees, or claim production integration from pure evaluator tests.

If a required provenance, authorization, version, or runtime contract is missing, the operation must follow the existing fail-closed boundary. Documentation of a rule does not mean the runtime enforces it.

### 11.5 Boundary with World Pack and versioned rules

World Pack supplies versioned world/domain configuration through the approved registration and resolution contract. Relationships owns the semantics of relationship rules within that pack and the compatibility decision for relationship interpretation.

A World Pack version label alone does not prove semantic compatibility. Exact historical provenance and the operation-specific rules in Sections 9–10 remain in force. Relationships cannot register, mutate, or replace Core-owned version storage or resolve missing history to the latest version.

### 11.6 Explicit exclusions

Unless a future reviewed contract assigns the work to Relationships, the block does **not** own:

- raw language/perception classification as a universal NLP subsystem;
- character-specific beliefs, observations, knowledge boundaries, or mental-state generation (NPC responsibility);
- stable personality traits and Personality-owned semantic traceability;
- canonical storage, event transactions, authorization, global scheduling/recalculation, cross-block orchestration, or publication of committed results (Core responsibility);
- a generic memory store, source authority, or Memory→NPC admission/reconciliation path;
- automatic relationship changes from every dialogue turn, automatic reciprocity, or automatic migration to a newer World Pack;
- historical evaluator runtime and meaning-changing migration execution (Core responsibility; see Sections 12–13 for the implemented bounded operation and migration boundary).

### 11.7 Acceptance boundary for social-interaction reasoning

A future implementation of social-interaction reasoning is not complete merely because a pure evaluator can map a label to a result. Acceptance must separately establish, using approved contracts:

1. ambiguous interaction cases (including flirtation vs sarcasm/teasing/hostility) preserve uncertainty when evidence is insufficient;
2. character-relative interpretation is supplied by the authorized NPC path rather than invented by Relationships;
3. relationship consequences are justified by explicit domain rules and do not imply consent, reciprocity, intent, or stable personality;
4. unsupported or conflicting evidence does not cause partial or unintended canonical changes;
5. exact rule/World Pack provenance is preserved for committed transitions;
6. the actual Core commit path and relevant integration tests enforce the behavior.

Until the real approved integration path exists, these are domain acceptance criteria, not claims of implemented production behavior. Do not add guessed APIs/schemas or pure-helper tests as substitutes for production-path evidence.


## 12. Final current-release disposition (30 October 2026)

This section records the accepted disposition after the Relationships, Core, and Personality decisions. It supersedes earlier dated status notes in this document where they describe the same operation differently.

- **New typed transition:** supported only through the existing Core commit path with the exact registered `rule_module_id + rule_module_version` and matching current World Pack identity/version. An unknown requested rule-module version fails with `RELATIONSHIP_RULE_VERSION_NOT_FOUND`; an incompatible World Pack declaration fails with `RELATIONSHIP_RULE_VERSION_INCOMPATIBLE`.
- **Historical projection rebuild:** supported within the tested contract. Core reapplies the already-committed effect and preserves its exact rule-module pin. It does not need to resolve or execute the historical manifest. The merged PR #148 regression covers restart, removal of `1.0.0`, registration of `2.0.0`, read-only failure of a separate exact registry lookup with `RULE_MODULE_NOT_FOUND`, and successful projection rebuild retaining the original `1.0.0` pin.
- **Historical semantic re-evaluation:** unsupported in the current release. The committed effect does not directly persist the exact World Pack identity/version, and no immutable durable mapping proving that provenance has been demonstrated. The current projection test does not execute historical rules. Any future operation requiring historical semantics must fail closed when exact provenance or the approved executable artifact is unavailable; it must never substitute the current/latest version.
- **Meaning-changing migration:** unsupported/refused in the current release. There is no approved migration API/schema/execution path, so there is no honest production entry point on which to test migration refusal. A future migration requires a separate Relationships-owned source→target semantic policy and an approved, auditable Core execution contract; the original event must remain immutable.

### Acceptance evidence and issue disposition

| Acceptance | Current evidence / disposition |
|---|---|
| Same-version deterministic evaluator result | Pure evaluator test `re-evaluating identical inputs is deterministic and side-effect-free`; evaluator-level only. |
| Same-version historical projection rebuild | Core test `Relationship projection survives store restart and deterministic rebuild from valid events` plus `projection rebuild preserves the exact historical rule-version pin when its module is unavailable`; production-path projection evidence only. |
| Unknown version on a new typed commit | Core test `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`; expects `RELATIONSHIP_RULE_VERSION_NOT_FOUND`. |
| Missing exact historical registry manifest | Core PR #148 test calls `getRuleModuleManifest()` for the removed exact version and expects `RULE_MODULE_NOT_FOUND` without mutation. This is a registry lookup boundary, not a semantic replay test. |
| Incompatible historical World Pack / semantic re-evaluation | Unsupported in the current release; no historical evaluator/provenance contract or production-path test is claimed. |
| Explicit migration | Unsupported/refused; no approved path or executable migration test exists. |

The related trackers are closed for their defined current-release decision/traceability scopes, not as a claim that unsupported capabilities were implemented: Relationships [#143](https://github.com/necromorphic/Logic-Engine/issues/143), Core [#146](https://github.com/necromorphic/Logic-Engine/issues/146), and Personality [#73](https://github.com/necromorphic/Logic-Engine/issues/73). Personality's version-semantics traceability was updated in merged [PR #722](https://github.com/necromorphic/Logic-Engine/pull/722). The #73 closure leaves unrelated authorized-read and NPC-consumer runtime work with its owning trackers; it does not mark those behaviors implemented.


## 13. Follow-up runtime implementation — historical candidate re-evaluation (30 October 2026)

This section supersedes Section 12 only for the bounded historical candidate re-evaluation operation. The projection-rebuild and meaning-changing migration dispositions remain unchanged.

- **Historical candidate re-evaluation:** supported as a read-only Core application operation after merged [Core PR #733](https://github.com/necromorphic/Logic-Engine/pull/733) (merge commit `cf61ad1`). Each new typed Relationship transition persists the exact seven inputs consumed by the pure candidate evaluator, the originating event ID, exact rule-module ID/version, and exact World Pack ID/version. An input digest and a separate envelope digest cover the captured data and provenance.
- **Exact historical evaluator:** Core resolves a version-addressed evaluator artifact by exact `rule_module_id + rule_module_version`. It never substitutes the latest/nearest artifact. A missing, incompatible, or unknown artifact returns unavailable. The original rule-module manifest may be absent: the captured `dimensionRules` are in the event snapshot, so re-evaluation does not reconstruct them from a current manifest. This is not historical World Pack registry lookup; the evaluator consumes the captured rules, not executable World Pack code.
- **Comparison and mutation boundary:** Core compares the historical candidate with the committed effect and reports whether they match. This operation does not change the event, projection, revision, or audit. It does not rerun authorization, evidence discovery, NPC knowledge acquisition, Personality decisions, or upstream proposal generation; it is not a full event-pipeline replay.
- **Legacy events:** events without the captured v2 snapshot return unavailable. Core does not reconstruct missing historical inputs from present-day state.
- **Meaning-changing migration:** still unsupported/refused. No source→target semantic mapping has been approved, and no migration API/schema/execution path is shipped. A future migration requires a separate Relationships-owned mapping policy and an auditable Core operation; the original event must remain immutable.
- **Digest limitation:** the SHA-256 digests detect inconsistent/corrupt changes but are not signatures against an actor able to rewrite the canonical database and recompute them.

### Runtime evidence

| Acceptance | Evidence / disposition |
|---|---|
| Same exact pinned inputs and evaluator artifact | Core PR #733: `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` now checks re-evaluation before and after restart/rebuild and verifies that the candidate matches the committed effect. |
| Historical evaluator after old manifest removal | The same test removes the `1.0.0` manifest, registers `2.0.0`, rebuilds the projection, and re-evaluates from the captured snapshot and exact `1.0.0` evaluator artifact. |
| Unknown exact artifact; no newer-version fallback | `historical re-evaluation rejects an unavailable pinned artifact instead of substituting a newer registered version`; a `0.9.0` event is unavailable when only the newer `1.0.0` artifact exists. |
| Legacy event without snapshot | `historical re-evaluation fails closed for a legacy event without a captured input snapshot`. |
| Snapshot provenance corruption | `historical evaluation detects an altered World Pack provenance value when its digest is not updated`. |
| Read-only behavior | The Core integration test compares world revision, events, relationship projection, and audit before/after evaluation. |
| Meaning-changing migration | Still unsupported/refused; no approved mapping or production migration path exists, so no migration-execution test is claimed. |

Runtime CI #5924 passed on exact PR head `e59d329a821764c6605e2f1b3318b8a04672fce9` (all three jobs, including `npm test`). Codex code review on that exact head completed with no findings. Projection rebuild remains a separate operation that reapplies the committed effect without executing the historical evaluator.
