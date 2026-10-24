# Relationships → Core typed-transition handoff

Status: **domain-to-runtime handoff, based on current `main`**. This document records the existing first-slice contract; it does not introduce a new API, storage model, authorization policy, or claim that downstream consumers can use Relationship state.

Related: Issue #130; Core implementation #77; Personality traceability #73; merged Core PRs #94–#96, #107–#108, #117, #124, #126.

## 1. Runtime boundary that actually exists

The shipped privileged operation is:

`POST /v1/worlds/:world_id/relationship-transitions`

It requires both the normal API bearer credential and the separate `x-admin-token`. It is an admin-authored canonical mutation path, **not** an NPC/model write capability, general import/correction path, or consumer-facing read API.

The request fields accepted by `LogicEngine.commitRelationshipTransition` in `src/application/engine.js` are exactly:

- `subject_id`, `target_id`
- `rule_module_id`, `rule_module_version`
- `patch`
- `evidence_refs`
- `expected_revision`, `expected_commit_sequence`
- `idempotency_key`

Extra fields are rejected. In particular, caller-supplied `actor_id`, `origin`, `provenance`, `executor_type`, or `evidence_status` cannot widen authority or assert trust. The server derives `executor_type: "admin_credential"`.

## 2. Candidate → typed transition field mapping

| Concern | Domain/Relationships responsibility | Core/runtime responsibility | Existing evidence / limitation |
|---|---|---|---|
| Directed participants | Preserve the evaluator's `subjectId → targetId` direction; never synthesize a reciprocal candidate. | Resolve both canonical IDs in the requested world; reject missing, unresolved, cross-world, or invalid participants. | `tests/relationship-transition-core.test.js`: `admin-gated typed transition commits directed state, event, revision and audit atomically`; `partial dimension patch preserves other dimensions and mixed invalid patch is atomic`. Reverse projection is asserted empty in the first test. |
| Patch shape and dimension isolation | Evaluate only declared dimensions and transitions; keep omitted dimensions omitted; reject a whole mixed invalid patch; express clear as `{ operation: "clear" }`. | Validate the patch against the exact registered immutable rule module and apply the accepted patch within the canonical transaction. | Same Core test file: `partial dimension patch preserves other dimensions and mixed invalid patch is atomic`; `invalid mixed patch commits nothing and idempotent retry does not duplicate a transition`. |
| Set / clear / unset / neutral | Treat neutral as an ordinary explicit domain value only when the World Pack declares it; never equate absent/unset with neutral. Request clear explicitly. | Persist clear distinctly; no projection row means unset; replay must preserve explicit values and clear markers. | `tests/relationship-transition-core.test.js`: `explicit neutral, cleared and unset remain distinct across replay`. This does not make withheld/conflict/insufficient/unsupported into persisted canonical values. |
| Evidence/source references | Select references that actually justify the candidate; the pure evaluator can validate only the supplied shape/status and does not authenticate truth or access. | Accept only unique `event:<event_id>` references; resolve them to valid earlier events in the same world; bind them to `caused_by` so rollback can invalidate dependent transitions. | Core test file: `admin route commits through the canonical event lifecycle and returns the current directed projection`; `source rollback invalidates a Relationship transition that cites the source`. |
| Evidence assessment status | Domain evaluator can return candidate/no-change/withheld/insufficient/conflict/unsupported outcomes for bounded inputs; a caller must not invent an assessment. | The canonical write request does not accept `evidence_status`; the privileged first slice accepts a trusted admin assertion of the transition and fails closed for unsupported evaluator outcomes. | `stale composite cursor and spoofed executor are rejected without mutation`; `rejects unavailable rule versions, cross-world participants, and invalid evidence before mutation` rejects unapproved `alternative_supports` metadata. `tests/relationship-evaluate-candidate.test.js` covers pure evaluator evidence/status outcomes. There is no alternative-support ledger. |
| Domain / World Pack rule version | Specify transition meanings and permitted state changes in the versioned domain rules; do not infer a universal scale, neutral value, or transition. | Resolve the exact immutable `rule_module_id + rule_module_version`; require `metadata.relationship_domain` to match the world's `world_pack_id` and `world_pack_version`; reject mismatch or unsupported metadata. | `tests/relationship-transition-core.test.js`: `admin route commits through the canonical event lifecycle and returns the current directed projection` asserts recorded rule-module ID/version; `tests/relationship-transition-core.test.js` also covers mismatched rule version and fail-closed cases. See the test names directly in that file; the pure evaluator's version-label test is not historical migration/replay evidence. |
| Freshness | Do not treat a candidate as valid beyond the state snapshot against which it was evaluated. | Require both `expected_revision` and `expected_commit_sequence`; reject stale composite cursor. Revision can advance on rollback even when commit sequence does not. | `tests/relationship-transition-core.test.js`: `stale composite cursor and spoofed executor are rejected without mutation`; `trusted state read returns one composite freshness marker across rollback`. |
| Mutation authority / provenance | Candidate evaluation grants no authority. Relationships must not manufacture trusted origin labels or use evidence refs as authorization. | Dedicated route requires bearer + admin credential; Core derives executor and audits it; generic event preparation cannot smuggle the effect. | `tests/relationship-transition-core.test.js`: `API rejects ordinary bearer without the separate admin credential and does not mutate state`; `Relationship transition route rejects missing, wrong, or standalone admin credentials without mutation`; `HTTP Relationship route rejects caller-supplied executor and provenance labels`; `generic event preparation cannot smuggle a Relationship effect`. |
| Idempotency | Re-evaluation determinism is not canonical idempotency. Do not promise exactly-once effects from a pure candidate. | Bind the idempotency key to the complete transition payload; return the established result for a matching retry and reject key reuse with a different payload. | `tests/relationship-transition-core.test.js`: `HTTP idempotent retry returns the established transition without a second event`; `reusing a Relationship idempotency key with a different payload is rejected`. |
| Atomic commit / replay | Supply a bounded domain candidate only. No direct persistence or projection writes. | Use the canonical event transaction for event, projection, revision, audit, idempotency; replay surviving valid typed transitions and invalidate dependent transitions during rollback. | Core test file covers atomicity, rollback, and rebuild; current-main exact-head CI evidence is tracked by the merged PRs listed in `docs/55-core-relationship-transition-runtime-slice.md`. This handoff itself is documentation-only. |

## 3. Status vocabulary: what is and is not persisted

These are intentionally different concepts:

- **unset**: no value exists for that directed pair/dimension; in the projection, the dimension is absent.
- **explicit neutral**: a real domain value, only when declared by the pinned rules.
- **cleared**: an explicit clear operation, represented distinctly in the projection/replay.
- **withheld / conflict / insufficient / unsupported / incomplete**: evaluator or evidence/read outcomes, not interchangeable with unset or neutral. The first-slice write path fails closed on unsupported outcomes; these labels must not be persisted as if they were ordinary relationship values.
- **no-change**: the request is already satisfied or changes no dimensions; it is not a new state transition.
- **invalid candidate / rejected operation**: no canonical mutation.

A pure evaluator result does not prove the actor was authorized to see the inputs or that evidence was valid. The current admin write route validates event references and trusted mutation authority, but no general actor/purpose/field-authorized Relationship read exists.

## 4. Acceptance traceability and explicit blockers

| Acceptance case | Current executable test / evidence | Status |
|---|---|---|
| Partial patch preserves omitted dimensions | `tests/relationship-transition-core.test.js` — `partial dimension patch preserves other dimensions and mixed invalid patch is atomic` | Covered on real Core path. |
| Mixed valid/invalid patch is all-or-nothing | Same test; also `invalid mixed patch commits nothing and idempotent retry does not duplicate a transition` | Covered on real Core path. |
| Directionality; no implicit reciprocity | `admin-gated typed transition commits directed state, event, revision and audit atomically`; `explicit neutral, cleared and unset remain distinct across replay` | Covered for canonical projection/replay; does not imply semantic reciprocity policies. |
| Unset vs neutral vs cleared | `explicit neutral, cleared and unset remain distinct across replay` | Covered on real Core projection/replay. |
| Withheld/conflict/insufficient/unsupported | `tests/relationship-evaluate-candidate.test.js` pure evaluator suite; Core rejects unsupported outcomes and does not accept caller-supplied `evidence_status` | Partially covered at separate boundaries. Not a general read-visibility or support-policy implementation. |
| `__proto__`, `constructor`, `prototype` patch keys | `tests/relationship-evaluate-candidate.test.js` — `supports all special dimension keys as own data keys for set and clear`; `preserves all special dimension keys together in a mixed set patch` | Pure evaluator only. **BLOCKED** for end-to-end Core storage/projection security test; no such claim is made here. |
| Re-evaluation vs idempotency | Pure evaluator deterministic-repeat coverage plus Core `HTTP idempotent retry returns the established transition without a second event` and `reusing a Relationship idempotency key with a different payload is rejected` | Distinct guarantees; both have separate evidence. |
| Meaning-changing World Pack version vs deterministic replay | Pinned immutable module/world-pack version is checked at write time; deterministic replay replays the versioned event. | **BLOCKED** for automatic migration/reinterpretation policy across meaning-changing World Pack versions. No migration is inferred from deterministic replay. |
| Stable Personality traits/values/boundaries remain unchanged | No relationship-to-Personality mutation path is part of the shipped first slice. | **BLOCKED** for a consumer/integration assertion; Relationships does not own Personality's traceability matrix (#73). |
| No inferred consent, motive, obligation, knowledge, loyalty, or reciprocity | Directed typed write and no implicit reverse projection are covered; semantic non-implications are domain/consumer requirements. | **BLOCKED** for NPC/model-facing consumer tests and authorized reads. A relationship value alone proves none of these. |
| New acquisition about an old event is not a new event | Evidence refs identify existing earlier events; the current operation is a new transition event only when explicitly committed. | **BLOCKED** for acquisition/reinterpretation policy and acquisition/belief persistence. No NPC acquisition path is implied. |
| Authorized Relationship reads for NPC/model/player | Current `/authorized-read` remains self-identity-only; no general Relationship projection read contract exists. | **BLOCKED — Core owner**: recipient/purpose/field visibility and non-disclosure contract plus real-path tests. Do not expose raw projection state. |
| NPC/model Relationship write authority | Only separate admin credential is accepted in this first slice. | **DEFERRED**: requires a separately approved trusted actor/capability policy; do not reuse admin credential as an NPC capability. |
| Alternative independent evidence support / OR semantics | Unsupported support metadata is rejected by Core. | **DEFERRED**: requires approved domain sufficiency semantics and Core-owned support/reconciliation representation. |
| Initial import / author correction | No generic trusted import/correction route is part of this slice. | **BLOCKED** for any caller that needs this path; Core must approve a separate authority/transaction contract. |

## 5. Prototype-sensitive keys and the Core boundary

The pure evaluator deliberately writes candidate properties as own data properties and its tests cover `__proto__`, `constructor`, and `prototype`. That demonstrates safety of the candidate object in the evaluator's bounded in-process contract only. It does **not** prove that all downstream JSON parsing, manifest validation, SQLite projection, event serialization, audit, read filtering, or model-facing serialization are safe for these names. The current canonical transition test suite does not establish that end-to-end guarantee; it remains an explicit integration test gap.

## 6. Cross-block handoff

- **Core (#77):** owns canonical identity/world validation, admin authority/provenance, evidence event resolution, pinned immutable rule-module lookup, composite freshness, event/projection/audit/idempotency transaction, and rollback/rebuild.
- **Relationships (#130):** owns directed domain meaning, dimension transition rules, partial candidate semantics, clear/no-change semantics, and fail-closed interpretation. It must not write storage or manufacture authority.
- **Personality (#73):** owns its own semantic acceptance traceability and the distinction between `PERS-SEM-029` (meaning-changing World Pack migration/compatibility) and `PERS-SEM-024` (deterministic repeat under pinned inputs/versions). This handoff links those boundaries without duplicating or editing Personality files.
- **NPC / Memory:** may not consume raw Relationship projection or treat retrieval/evidence references as authorization, delivery, acquisition, belief, or mutation authority. Integration remains blocked until a trusted read/knowledge contract exists.

No generic effect, projector registry, new API, storage schema, import/correction endpoint, or model-facing capability is proposed here.

## 7. Validation record

This is a documentation-only change. No test or CI result is claimed for this document until a Runtime workflow passes on the exact PR head. Existing test names above identify existing evidence; evaluator tests are not substituted for Core integration tests.
