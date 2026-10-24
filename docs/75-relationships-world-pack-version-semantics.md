# Relationships — World Pack version semantics and migration boundary

Status: domain contract for Issue #143, based on the current `main` runtime. This document clarifies the version semantics of the existing typed Relationship transition; it does not add a migration API, registry, storage field, or replay implementation.

Related: Issues #143 and #130; Core runtime contract in `docs/55-core-relationship-transition-runtime-slice.md`; Personality acceptance identifiers `PERS-SEM-024` and `PERS-SEM-029`.

## 1. Version identities that exist today

The current typed operation accepts `rule_module_id` and `rule_module_version`. Its registered immutable rule-module manifest carries `metadata.relationship_domain`, which includes `world_pack_id`, `world_pack_version`, and the dimension rules. The target world itself has `world_pack_id` and `world_pack_version`.

These are related but distinct identifiers:

- **World Pack identity/version** describes the domain vocabulary and semantics intended for a world.
- **Rule-module identity/version** selects the exact registered validator/rules used for a typed transition.
- **Core contract version** in the manifest's `compatibility.core_contract_versions` describes runtime-contract compatibility; it is not a World Pack version.

The commit path requires the exact registered `rule_module_id + rule_module_version`; the module must declare `validate_transition`; and `relationship_domain.world_pack_id + world_pack_version` must match the target world's identity/version. Unknown module versions fail with `RELATIONSHIP_RULE_VERSION_NOT_FOUND`; a mismatched World Pack identity/version or unsupported `relationship_domain` metadata fails closed with `RELATIONSHIP_RULE_VERSION_INCOMPATIBLE`.

Source evidence: `src/application/engine.js` (typed transition validation and registered module resolution); `src/core/mechanics.js` (immutable rule-module manifest validation); `docs/55-core-relationship-transition-runtime-slice.md`; `tests/relationship-transition-core.test.js` — `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`.

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

Core PR #148 is now merged and adds `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` in `tests/relationship-transition-core.test.js`. On exact head `f493f719fddcec2f1a085d7d6a22781f75a5106c`, Runtime CI run #903 passed. That test removes the historical `1.0.0` manifest, registers `2.0.0`, verifies exact lookup fails rather than falling back, and checks that the event and projection preserve the original pin through restart/rebuild. This proves projection-only replay, not historical semantic re-evaluation or migration.

Source evidence: `tests/relationship-transition-core.test.js` — `Relationship projection survives store restart and deterministic rebuild from valid events`, `admin route commits through the canonical event lifecycle and returns the current directed projection`; `docs/55-core-relationship-transition-runtime-slice.md`.

## 4. Fail-closed matrix

| Condition | Required domain interpretation | Existing evidence / status |
|---|---|---|
| Exact registered rule module and matching World Pack version available at commit | Candidate may be evaluated against those exact rules; commit only through the existing typed Core path. | Covered at write boundary by `admin route commits through the canonical event lifecycle and returns the current directed projection`. |
| Requested rule-module version is unknown at commit | Reject without mutation; do not fall back to latest or nearest version. | Covered by `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` (`RELATIONSHIP_RULE_VERSION_NOT_FOUND`). |
| Registered module pins a different World Pack version/identity than the world | Reject without mutation; do not coerce or auto-upgrade the module metadata. | Covered by the same test (`RELATIONSHIP_RULE_VERSION_INCOMPATIBLE`). |
| Historical committed event pins an old version that is no longer registered; only projection rebuild is requested | Rebuild from the committed typed event/effect, without rewriting its pin or applying current semantics. | **RUNTIME-TESTED — Core PR #148**: `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` removes `1.0.0`, registers `2.0.0`, and asserts exact lookup failure plus event/projection pin preservation after restart/rebuild (Runtime CI #903). |
| Historical event needs semantic re-evaluation, but its exact rule module/World Pack definition is missing or unavailable | Refuse re-evaluation; do not use the current version as a substitute. | **BLOCKED — Core + Relationships**: there is no shipped historical semantic re-evaluation API or named test; PR #148 covers projection-only rebuild, not re-evaluation. |
| Historical event/version is incompatible with a current World Pack | Keep the historical interpretation separate; do not silently reinterpret the old event. A read/rebuild may proceed only under the existing event-replay contract, not by implicit migration. | **BLOCKED — Core owner** for an end-to-end historical incompatibility/rebuild test; no automatic migration policy is implemented. |
| Explicit version-to-version migration is requested | Permit only if a separately approved migration definition and execution path exists, with an auditable result and original event preserved. | **ABSENT**: no approved migration schema/API/path or executable migration test is present in current main. Until approved, refuse migration. |
| Candidate is re-evaluated twice with identical inputs and identical pinned rules | Domain evaluator should return the same result; this is deterministic evaluation, not a guarantee of canonical idempotency. | Cross-reference Personality `PERS-SEM-024`; pure evaluator evidence lives in `tests/relationship-evaluate-candidate.test.js`. Core idempotency is separate and covered by `HTTP idempotent retry returns the established transition without a second event`. |
| A meaning-changing World Pack migration or incompatibility is proposed | Require explicit compatibility/migration decision; never infer safety from deterministic replay. | Cross-reference Personality `PERS-SEM-029`; its traceability remains Personality-owned and is not edited here. |

## 5. Acceptance cases and ownership

The following cases are the Relationships acceptance contract. Rows marked **BLOCKED** identify a missing cross-layer guarantee; they are not represented as passing tests.

| Case | Acceptance assertion | Existing named evidence / disposition |
|---|---|---|
| Same-version deterministic replay | Rebuild of surviving valid transition events yields the same directed projection and does not turn an explicit clear/value into unset. Historical module pin remains unchanged. | `Relationship projection survives store restart and deterministic rebuild from valid events`; `explicit neutral, cleared and unset remain distinct across replay`; Core PR #148 test `projection rebuild preserves the exact historical rule-version pin when its module is unavailable` (Runtime CI #903). **Runtime-tested**, with scope limited to projection rebuild. |
| Unknown version on a new commit | Reject before mutation; no fallback to latest. | `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation`. |
| Incompatible World Pack version on a new commit | Reject before mutation; no coercion to current world version. | Same named Core test. |
| Unknown/unavailable historical version during projection rebuild | Replay the committed event/effect without silently substituting another version; never use a newer module to rewrite the historical event pin. | **RUNTIME-TESTED — Core PR #148**: exact historical lookup returns `RULE_MODULE_NOT_FOUND`, and projection rebuild preserves the event/projection pin after restart (Runtime CI #903). This does not cover semantic re-evaluation. |
| Historical semantic re-evaluation with missing rules | Return an explicit unavailable-version failure; do not evaluate under current rules. | **BLOCKED — Core + Relationships**: no shipped historical re-evaluation path. |
| Approved migration exists | Validate the declared source and target versions, preserve the original event, record the explicit migration result, and test replay before/after migration. | **NOT APPLICABLE YET**: no approved migration path exists in current main; do not invent its API/schema or add a fake passing test. |
| No approved migration exists | Refuse semantic migration and retain original historical interpretation. | Normative domain rule for this handoff; executable end-to-end migration-refusal test is **BLOCKED — Core owner** because no migration entry point exists. |
| Deterministic repeat vs meaning-changing migration | Same pinned inputs are a repeat-evaluation case; a semantic version change is a compatibility/migration case requiring separate review. | Personality cross-references: `PERS-SEM-024` and `PERS-SEM-029`. No Personality file changed. |

## 6. Boundaries and deferred work

- **Relationships owns** domain meaning, the rule that old events must not be silently reinterpreted, and acceptance criteria distinguishing replay from migration.
- **Core owns** event/effect persistence, registry availability, canonical replay/rebuild, historical pin preservation, runtime errors, and any future migration transaction/API. This PR does not alter Core storage or replay.
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
