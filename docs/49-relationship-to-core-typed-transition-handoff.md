# Relationship → Core domain-side handoff for typed transition review

Status: **proposal for Core review; not a Core API, wire schema, storage schema, or implemented typed effect.** Prepared against current `main` on 2026-10-24 for Issues #73 and #77. The pure evaluator is implemented in `src/relationship/evaluate-candidate.js`; current Core source still has no Relationship typed effect in `validateEffects()` and no Relationship projector/reducer in `SQLiteStore.rebuild()`.

## 1. Boundary and intended use

The domain evaluator accepts a bounded snapshot supplied by its caller and returns one of:
- `candidate`: a proposed directed partial transition;
- `no_change`: the requested patch is empty or already satisfied / clears an unset or already-cleared dimension;
- `invalid_candidate`: the requested operation violates input, dimension, transition, self-relation, or whole-patch validation;
- `unsupported`: the input/configuration/evidence contract is incomplete or outside the evaluator's supported shape;
- `withheld`: the relevant evidence or current value is withheld;
- `insufficient_evidence`: evidence does not meet the evaluator's declared minimum;
- `conflict_review_required`: evidence/current state has a conflict requiring reconciliation.

Only `candidate` describes a proposed transition. Every other result is a non-commit outcome. In particular, Core must not coerce withheld, insufficient, conflict, unsupported, invalid, or no-change into an implicit neutral value or a canonical transition.

This handoff maps the existing candidate to a *conceptual typed transition*. Core must choose and document the actual operation/event representation and lifecycle hook. Relationship must not invent the Core API or persist through `entity.update`, `entity.attributes`, or `fact.set`.

## 2. Existing evaluator candidate fields

The actual successful evaluator envelope currently contains:
```js
{
  status: "candidate",
  subjectId,
  targetId,
  ruleVersion,
  evidenceRefs,
  patch,
  changedDimensions
}
```
This is the current pure evaluator's return shape, not a proposed wire format. It has no world ID, authenticated actor, purpose, expected revision/cursor, canonical event ID, authorization result, commit sequence, or provenance authority. Those values must not be fabricated by Relationship.

| Candidate field / result | Domain meaning and validation already performed by evaluator | Required Core/source-owner validation before any canonical write |
|---|---|---|
| `subjectId`, `targetId` | Opaque non-empty strings; explicit directed subject → target. No reciprocal patch is produced. | Resolve both to canonical identities; bind both to the same canonical world/tenant; reject missing, ambiguous, cross-world, unauthorized, or otherwise invalid participants. Bind authenticated requester/executor separately. Do not infer that caller-provided IDs are trusted identities. |
| `patch` | Explicit partial dimension map. Omitted dimensions are not changed. A set value must be declared by that dimension's World Pack rule. Clear is explicit `{ operation: "clear" }`; a clear does not mean neutral. Whole candidate is rejected if any requested dimension is invalid. | Validate the approved typed operation schema and permitted dimension/value/operation set again at the canonical boundary. Persist all requested changes as one logical transition or reject the entire operation; no partial commit. Core chooses representation for effective value vs clear/history and must preserve that distinction on reads/rebuild. |
| Per-dimension `status` in supplied `currentValues` | Absent key means `unset`; an ordinary domain string is a value (including a World Pack-declared neutral value); `{status:"cleared"}`, `withheld`, `conflict`, `insufficient_support`, `unsupported`, and `incomplete` are not interchangeable. Evaluator refuses to treat non-value states as unset. | Provide only an authorized, correctly scoped current projection. Preserve `unset` vs explicit neutral vs cleared vs withheld vs conflict/insufficient vs unsupported. A withheld read must not reveal whether a value exists. Core owns storage/read-result encoding and disclosure policy; Personality/World Pack own semantic interpretation. |
| `evidenceRefs` | On a supported evaluation, evaluator requires a non-empty array of unique, non-empty strings. This checks shape only. | Resolve references to canonical source/event records; validate existence, world scope, requester/subject access, integrity, causal eligibility, current validity/retraction, and whether each source may support this transition. Preserve attribution/provenance separately from evidence eligibility. Memory/NPC/source owners define acquisition/source meaning; Core enforces canonical reference and access contracts. |
| `ruleVersion` | Must be a non-empty identifier supplied to the evaluator. Rules are supplied explicitly; evaluator does not resolve a version registry. | Resolve to an approved immutable World Pack/domain-rule artifact and verify it is available, enabled, compatible, and permitted for this world. Bind the exact version to the committed transition/event. Do not silently substitute current rules. Personality/World Pack owns meaning and compatibility declarations; Core owns canonical version resolution, pinning, and replay availability. |
| `changedDimensions` | Evaluator-derived list of dimensions actually changed in the candidate; no change is a separate result. | Treat as advisory/derived, not authority. Recompute or validate against the approved operation payload before commit; never let a caller choose it to widen the write. |
| Evaluator result `status` / `reason` | Pure decision outcome; no state is written. `invalid_candidate` rejects the candidate; `unsupported` indicates a missing/unsupported contract; `withheld`, `insufficient_evidence`, and `conflict_review_required` preserve distinct failure/access meanings; `no_change` is not a transition. | Map to an approved Core response/error/result category without committing a transition for non-candidate outcomes. Authorization denial, stale snapshot, identity failure, version incompatibility, idempotent retry, persistence failure, and audit failure are Core lifecycle outcomes, not evaluator statuses. |
| Input `currentValues` and evaluation timing | Evaluator checks transition legality against the values it receives; it does not fetch or authenticate the snapshot. | Verify that values came from an authorized read for the requested actor/purpose/subject/world, and that the same-world directed pair and pinned rule version remain fresh at commit. Compare an approved expected freshness basis, including the composite `(world_revision, commit_sequence)` if Core selects it; account for rollback/retraction changes even where `commit_sequence` does not advance. A stale input must fail/retry, not be silently reinterpreted. |
| Input evidence assessment | Evaluator handles `supported`, `withheld`, `insufficient`, `conflict`, and `unsupported` as distinct statuses and checks reference shape for supported evidence. | Core must not accept a caller-supplied evidence status as proof of authorization or truth. Obtain the status from approved evidence/source contracts, validate current eligibility and access, and preserve conflicts/retractions. Domain rules specify sufficiency policy; Core enforces the trusted boundary. |

## 3. Conceptual mapping to a typed transition (for Core decision)

For review only, a canonical transition would need to express these semantic facts without assuming the final event schema:

1. **Directed pair:** canonical world + canonical subject + canonical target. Subject → target is independent from target → subject. No automatic reciprocal transition.
2. **Explicit operations:** one or more declared dimension set/clear operations, preserving omission as “not requested.” A neutral value is a normal declared value; clear is an explicit operation with distinct history semantics.
3. **Rule identity:** exact approved World Pack/domain-rule version used to validate the candidate.
4. **Evidence/source references:** canonical references with validated world scope, eligibility, access, validity and provenance; a string reference alone is insufficient.
5. **Freshness precondition:** the authorized input snapshot and rule/source versions against which evaluation was performed, plus Core-approved expected cursor/version checks. The evaluator currently does not emit a cursor, so this must be bound by the caller/Core integration rather than invented in the evaluator.
6. **Trusted execution context:** authenticated actor/service and purpose, with authorization and provenance derived from a trusted server-side boundary, not from caller-supplied `origin`, IDs, or status labels.
7. **Atomic lifecycle:** Core owns event identity/idempotency, validation, commit, audit, projection rebuild, revision movement, rollback/replay and failure atomicity. Relationship owns no parallel writer or storage path.

The final typed effect name, payload schema, projection shape, authorization mechanism, import/correction API and lifecycle hook remain **Core decisions**. This document intentionally does not name or prescribe them.

## 4. Failure and non-implication table

| Condition | Domain-side disposition | Core responsibility |
|---|---|---|
| Missing/invalid participant or cross-world pair | Candidate cannot be accepted as a valid directed transition; evaluator IDs are only opaque references. | Canonical identity resolution, same-world binding and rejection. |
| Unsupported dimension/value/transition or incomplete World Pack rule | `invalid_candidate` or `unsupported`; reject the whole candidate. | Repeat canonical schema/rule validation and commit nothing. |
| Evidence withheld | `withheld`; do not replace with unset/neutral. | Enforce access policy and non-disclosure; do not reveal hidden existence/value. |
| Evidence insufficient | `insufficient_evidence`; no candidate transition. | Enforce approved sufficiency/source contract; do not commit. |
| Evidence/current-state conflict | `conflict_review_required`; no candidate transition. | Reconcile under an approved policy or preserve conflict; no silent winner. |
| Unsupported/incomplete evaluator or rule contract | `unsupported`; fail closed. | Return a distinct unavailable/unsupported result and do not invent defaults. |
| Stale current snapshot, stale source, changed rule version, rollback/retraction | Evaluator alone cannot detect these from its inputs. | Revalidate freshness/version at the canonical boundary and reject/retry or follow explicit correction/replay policy. |
| Duplicate retry / partial persistence failure | Pure evaluator makes no idempotency or atomicity claim. | Own idempotency key/event identity, atomic event+projection+audit+revision behavior and retry semantics. |
| New knowledge about an old event | Not a new event and not automatically a new relationship transition. | NPC/Core acquisition and event-identity contracts must govern any reevaluation; no duplicate canonical event or silent rewrite. |

## 5. Acceptance tests required before calling this integrated

### Existing pure evaluator evidence (not Core integration)
Use `tests/relationship-evaluate-candidate.test.js` on current `main`. Relevant test names include:
- `omitted dimensions remain omitted from the candidate patch`
- `clearing one dimension leaves every other dimension outside the candidate patch`
- `rejects a mixed valid/invalid patch without exposing partial output or mutating inputs`
- `keeps direction explicit and does not create a reciprocal patch`
- `distinguishes unset from a previously cleared dimension`
- `keeps explicit neutral distinct from unset and treats an existing neutral value as a no-op`
- `does not silently treat a withheld current relationship value as unset`
- `preserves each non-value relationship state instead of treating it as unset`
- `does not evaluate a transition when evidence is insufficient or conflicting`
- `does not treat unsupported evidence as an empty or neutral relationship`
- `supports all special dimension keys as own data keys for set and clear`
- `preserves all special dimension keys together in a mixed set patch`
- `re-evaluating identical inputs is deterministic and side-effect-free`
- `requires a pinned rule version`

These prove only candidate evaluation against caller-supplied inputs. They do not prove participant resolution, authorized reads, trusted provenance, canonical idempotency, persistence atomicity, audit, or rollback/replay.

### Future real-path Core/NPC/Personality tests (blocked, not currently passing)
1. Canonical A→B write leaves B→A unchanged; separate reverse write requires its own operation.
2. Mixed patch with one invalid dimension commits no event, projection, revision, audit, or idempotency result.
3. Clear preserves explicit clear history; omitted dimensions remain unchanged; explicit neutral differs from unset and cleared on authorized reads.
4. Withheld response does not disclose whether a hidden relationship value exists; conflict/insufficient/unsupported remain distinct.
5. Reject missing, ambiguous, cross-world, spoofed, or unauthorized participants/executors and caller-forged provenance/origin.
6. Reject stale expected cursor, stale/retracted evidence, and unavailable/incompatible rule version; test rollback/retraction when world revision changes without a new commit sequence.
7. Idempotent retry of the same canonical request does not append a duplicate transition or audit result; different request under reused idempotency key is rejected.
8. Inject failure at each persistence boundary and prove atomicity across event, projection, audit, revision and idempotency records.
9. Rebuild/rollback/replay deterministically restores the same directed state under the same pinned versions; missing historical rule version fails explicitly rather than silently using current rules.
10. Personality/NPC consumer tests prove relationship state alone does not create stable traits, knowledge, motive, consent, obligation, or reciprocal state. These consumer tests require their actual approved runtime path; document fixtures alone are not executable evidence.

## 6. Ownership and readiness

- **Relationship:** candidate semantics, directed partial patch, clear/value meaning, evaluator outcomes, rule-version input requirement and evidence-reference shape.
- **Personality / World Pack:** meaning of dimensions and values, explicit transition rules, semantic non-implications, version compatibility/migration declarations and acceptance expectations.
- **Memory / NPC / source owners:** source identity, acquisition/observation/belief meaning, evidence eligibility, and whether knowledge acquisition changes an actor's accessible evidence set.
- **Core:** canonical identity/world binding, authenticated executor and purpose, trusted provenance, authorized reads, snapshot freshness, typed operation/event schema, atomic commit, idempotency, audit, projection, rollback/replay and canonical version pinning.

**Current disposition:** domain-side handoff is ready for Core design review. End-to-end acceptance remains blocked by the absent typed Relationship writer/projector, approved trusted-authority path, authorized Relationship read, and Relationship-specific replay. No runtime integration is claimed.
