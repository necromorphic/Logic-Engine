# Cross-Block Authority and NPC Integration Contract — Proposal

**Status:** project-owner-authorized contract draft; documentation only. Defines intended authority boundaries across Host/Adapter, Memory Provider, Core, NPC, Personality, Relationships, World Pack/Mechanics, Time/Process Manager, and Narrative. It does not claim that all required runtime interfaces exist or are connected.

**Authorization:** the project owner explicitly authorized drafting the contract across block boundaries, including assigning conceptual authority to the other blocks. This permits defining the target design. It does not by itself create deployed permissions, merge code, prove tests, or activate production Memory → NPC.

**Release state:** Memory → NPC remains **DISABLED / FAIL-CLOSED** until §14 is satisfied.

## 1. Purpose

This is the cross-block semantic contract for a safe autonomous-NPC vertical slice. It defines ownership, allowed requests, evidence required across boundaries, proposal-versus-commit semantics, failure behavior, and integrated acceptance criteria.

A rule written here is a target contract, not evidence that code currently enforces it. Design authority, implementation availability, runtime authorization, and production readiness are separate states.

## 2. Normative terms

- **MUST / MUST NOT:** mandatory for conformance.
- **SHOULD / SHOULD NOT:** expected unless a documented and reviewed reason says otherwise.
- **MAY:** permitted within the stated boundary.
- **UNKNOWN:** truth cannot safely be determined.
- **DENIED:** policy rejected the operation.
- **INCOMPLETE:** the result may omit relevant records or fields.
- **STALE:** evidence is not bound to the required current revision.
- **UNAVAILABLE:** the trusted source or interface cannot provide the answer.
- **PROPOSAL:** a requested future change; it has not changed canonical state.
- **COMMITTED:** an authoritative transition recorded through Core's supported lifecycle.

UNKNOWN, DENIED, INCOMPLETE, STALE, and UNAVAILABLE MUST NOT silently become false, empty, permitted, or complete. A complete empty result is distinct and requires positive completeness evidence.

## 3. System-wide invariants

1. **One canonical world authority.** Core owns canonical world state, world time, event identity, revisions, causal provenance, validation, commit, rollback, and replay. No other block may maintain a competing canonical world log or revision counter.
2. **One owner per data class.** Consumers may cache or derive data only while preserving source identity, version, validity, and invalidation semantics.
3. **Retrieval is not authorization.** Fetchability does not imply permission to use or disclose data.
4. **Knowledge is actor-relative.** A world fact is not automatically known by every NPC. World truth, actor knowledge, belief, suspicion, rumor, and narrative claim remain distinct.
5. **A model is not an authority.** Model output cannot grant identity, capabilities, access, provenance, action success, or committed truth.
6. **Narrative does not mutate canon.** Text cannot create events, transfer knowledge, or prove an action succeeded.
7. **Player agency is protected.** NPC autonomy does not permit choosing the player's unprovided actions, thoughts, consent, dialogue, or decisions.
8. **Side effects are explicit.** Read/evaluate/propose operations MUST be non-mutating. Canonical effects occur only through Core's validated commit path.
9. **Snapshot and provenance travel together.** A decision must be traceable to actor, purpose, policy, world snapshot, source versions, and bounded inputs.
10. **Fail closed at trust boundaries.** Missing or unverifiable identity, permission, completeness, provenance, freshness, or policy blocks the protected operation.
11. **No inferred authority.** Personality, relationships, World Pack capabilities, or model statements do not independently grant technical permission.
12. **Optional modules remain optional.** Missing Personality, Relationships, Memory, resource, magic, infection, or other mechanics are marked unavailable rather than guessed.
13. **No silent contract drift.** Changes to field meaning, enums, ownership, or versions require a versioned contract change and compatibility tests.
14. **Audit without content leakage.** Audit records should capture identifiers, versions, decisions, and reason codes without indiscriminately copying private message bodies or secrets.

## 4. Authority matrix

| Block | Owns / may decide | May provide | MUST NOT do |
|---|---|---|---|
| **Host / Adapter** | Host-session identity, capture of host events, request construction, delivery of approved outputs, transport status, host-specific source inventory | Authenticated requests, exact request/response references, capture-completeness evidence, delivery receipts, bounded context manifest | Declare world truth; invent NPC knowledge; bypass Core policy; fall back to unprotected egress after a protected path rejects |
| **Memory Provider** | Stored source records, source/version lineage, retrieval mechanics, tombstones/revocations, retention and provider integrity | Candidates with source identity/version, scope, validity, lineage, completeness and retrieval status | Decide what an NPC may know; turn text into world facts; resurrect revoked content; represent incomplete retrieval as complete empty |
| **Core** | Canonical world state/time/events/revisions/causality, actor bindings, policy-filtered canonical reads, authoritative acquisition records where implemented, effect validation, proposal lifecycle, commit/rollback/replay | Snapshot-bound facts, actor/purpose-filtered records, admissibility decisions, authoritative outcomes | Treat model text as committed fact; infer knowledge from world truth; accept an action because the model proposed it |
| **NPC** | NPC-local goals/plans/tasks/intentions, ranking among admissible candidates, bounded non-committing proposals | Goal/plan/action proposals and requests for missing adjudication | Write canonical state directly; create authoritative knowledge records; self-approve or commit effects; invent missing source data |
| **Personality / Profile** | Stable traits, values, habits, authored constraints, characterization and declared capabilities | Versioned profile facts and constraints | Overwrite world state; grant technical permissions; force deterministic behavior; invent hidden biography |
| **Relationships** | Typed, directed social relationship state and its semantics under its own persistence/visibility contract | Actor-scoped relationship facts with version/provenance/status | Grant access by itself; imply shared knowledge; turn one character's view into objective truth; bypass Core writes |
| **World Pack / Mechanics** | Setting rules, supported mechanics, action/effect vocabulary, capability definitions, precondition semantics | Version-pinned rules/templates and legal candidate vocabulary | Execute effects because they are defined; change runtime authorization; silently update a live world's pinned rules |
| **Time / Process Manager** | Scheduling and trigger lifecycle within the approved contract; Core remains authority for canonical game time and effects | Due-work candidates, trigger identity, claim/idempotency and timing evidence | Create a second clock or event log; execute effects outside Core; infer in-world time from OS time/chat turns |
| **Narrative / Presentation** | Wording, style, viewpoint and formatting of permitted content | Player-facing text derived from authorized context and confirmed results | Commit events, grant knowledge, widen visibility, turn proposals into facts, disclose hidden data |
| **Coordinator** | Sequence approved work, collect evidence, identify blockers and dependency order | Work plans and readiness summaries | Become a world-state authority, infer human ownership, bypass block-owner or production gates |

**Conflict rule:** authority follows the named owner of the data or decision, not the block that happens to hold a copy. Conflicting values must be preserved and resolved by the owner; consumers must not pick a convenient value without an explicit resolution rule.

## 5. Identity and permission model

Every request that can expose protected data or propose a state change must be bound by trusted code to:
- authenticated service/adapter identity;
- acting entity/NPC identity when actor-relative;
- world/session identity;
- operation purpose;
- allowed data classes or effect kinds;
- current policy/version;
- applicable snapshot and source-version references;
- request/idempotency identity;
- freshness/expiry conditions where needed.

Identity stated only in model output, narrative, retrieved source text, or untrusted request fields does not establish identity.

These checks are separate and MUST NOT imply one another:
1. transport authentication;
2. actor binding;
3. read authorization;
4. knowledge admissibility;
5. action authorization;
6. approval authority;
7. Core commit authority;
8. final disclosure authority.

A generic adapter token is not NPC action authorization. A Core read is not proof of knowledge acquisition. A stored proposal is not approval or commit.

Missing permission metadata, actor binding, current policy, inventory completeness, or revocation evidence returns non-ready/unknown and blocks protected use. Errors must not disclose whether a hidden record exists where that fact is protected.

## 6. Cross-block decision envelope

The following is a **semantic envelope, not an approved wire schema**. Exact types, endpoints, persistence and serialization require a separately versioned implementation contract.

Each NPC decision must use a trusted bounded envelope containing:
- contract version and unique decision ID;
- world/session reference and trusted actor reference;
- purpose;
- Core-issued snapshot/revision and canonical world-time reference when available;
- exact Personality/Profile version or explicit unavailable status;
- permitted Relationship records and versions or explicit unavailable status;
- permitted knowledge candidates with source lineage and complete/partial/denied/unavailable status;
- exact enabled World Pack/mechanic/rule versions and allowed action vocabulary;
- NPC-local goal/plan state version or explicit unavailable status;
- access manifest distinguishing included, known absent, denied, incomplete, stale and unavailable data;
- access, player-agency and disclosure policy versions;
- closed set of proposal kinds allowed for this decision;
- freshness/expiry condition where required.

The model may not author or modify trusted envelope metadata. Missing data must be marked unavailable rather than fabricated. If a bound source or policy changes, the decision must be invalidated or re-evaluated under a new decision ID.

Where relevant, implementations must distinguish canonical fact, actor-known fact, belief, suspicion, rumor, model hypothesis, unknown, known absent, denied, incomplete, stale, revoked, proposed, approved, committed, rejected, cancelled, delivered, not delivered and delivery unknown. Implementations may use different strings only through an explicit versioned mapping.

## 7. Memory Provider → Core → NPC

### 7.1 Provider

For each candidate, Provider must preserve where supported: stable record ID; exact source ID/version or accepted-head reference; source kind/lineage; scope; lifecycle state including revocation/tombstone; integrity/validation state; query/inventory completeness; retrieval operation reference; retention/access classification.

Provider returns candidates and evidence. It does not declare them admissible knowledge for an NPC.

A response must distinguish complete-with-candidates, complete-empty, denied, incomplete, unavailable/error, stale, and revoked/invalidated. Provider outage or uncertain completeness must not be represented as “the NPC has no memories”.

### 7.2 Core

Core or a trusted Core-owned acquisition service decides whether a source becomes authoritative actor-relative knowledge. An acquisition record, when implemented, must bind actor, source/version, acquisition mechanism, canonical in-world acquisition time where applicable, provenance, lifecycle validity, and causal relationship to the acquisition event.

The first supported acquisition slice remains narrow: authored initial knowledge and explicitly imported knowledge only, where source and provenance are trusted. Observation, conversation, documents, inference, rumor and model synthesis remain unsupported until their evidence contracts are separately approved and tested.

Core must not copy every world fact into every NPC's knowledge. Actor, purpose, visibility, source and lifecycle filters apply.

### 7.3 NPC

NPC consumes only actor-relative records explicitly admitted by the trusted caller. It may reason about them and propose hypotheses only where that capability is allowed. A thought, summary, dialogue line or model response cannot create an authoritative acquisition record.

### 7.4 Final disclosure boundary

The final serialized model request is the actual disclosure boundary. The protected path must bind the exact final body, or an integrity-protected manifest of its components, to admitted candidate IDs/versions, actor, purpose, policy and snapshot.

Immediately before dispatch, it must revalidate source validity, revocation/tombstone, scope and policy. Retrieval-time checks alone are insufficient. If revocation cannot be checked reliably at final dispatch, dispatch must fail closed.

Host must use one protected outbound route for covered requests. Direct model calls, alternate proxies, retries, embedding/image/TTS paths or debug routes must not bypass the same policy. Diagnostics must not log protected bodies or credentials.

## 8. Personality and Relationships → NPC

### 8.1 Personality/Profile

Personality supplies characterization, not world truth or technical permission. Profile data must be versioned and entity-bound, distinguishing stable traits and authored constraints from temporary emotion or condition. Traits may influence goal ranking and plan choice only within permitted capabilities. “Protective”, “aggressive”, “loyal” or “curious” does not authorize a forbidden effect.

Missing profile data is unavailable; the model may not invent it.

### 8.2 Relationships

Relationships supplies typed, directed, actor-relative relationship state under its own authority and visibility policy. Records should identify subject and perspective, type/status, version, provenance/validity where supported, and whether the value is canonical, a character belief or an interpretation.

Relationship values may affect priorities, trust assumptions, dialogue and cooperation. They do not automatically grant read access, disclose another actor's private knowledge, bypass consent/player-agency policy, or authorize world effects.

Absent, stale, contradictory or invisible Relationship data remains unknown/unavailable; the NPC may proceed without it or defer.

## 9. Core / World Pack / Mechanics → NPC action contract

### 9.1 Candidate generation and evaluation

NPC may select only from candidates supplied by a trusted version-pinned source or generated under a reviewed contract. A model-suggested label does not prove the action exists or is allowed.

For each candidate, the trusted path must determine action/effect identity and exact definition version; actor and targets; preconditions and required facts; capabilities/permissions; timing and snapshot; supported effects; missing dependencies/uncertainty; conflict policy; and whether the action is permitted for this purpose.

The existing generic mechanic-evaluation seam is not itself an NPC action catalogue or NPC-specific authorization policy. A concrete action family and actor policy must be evidenced before it is called supported.

### 9.2 Proposal and commit lifecycle

1. Trusted caller builds the immutable decision envelope.
2. NPC returns a bounded goal/plan/action proposal.
3. Structural validation checks shape and allowed vocabulary.
4. Core-side validation checks actor/action authorization, current preconditions, policy, mechanic versions, snapshot freshness, player agency and supported effects.
5. Proposal is recorded as pending if supported by the existing lifecycle.
6. A configured trusted authority approves it; NPC/model cannot self-approve.
7. Core commits through the canonical event/causality path only after approval and current checks.
8. Core returns an authoritative committed result or explicit non-commit outcome.
9. NPC reconciles goals/plans/tasks against that result.
10. Narrative receives only the permitted result and viewpoint.

A ready evaluation is not a commit. A pending proposal is not a committed event. A cancelled, rejected, stale, failed or unknown outcome must not be reported as success.

### 9.3 Goal, plan and task semantics

- A goal describes a desired condition, not a guaranteed future event.
- A plan is a tentative strategy with assumptions, dependencies, alternatives and stopping conditions.
- A task is a bounded step with prerequisites and verifiable completion/failure conditions.
- A commitment is an obligation, not proof of completion.
- An intention remains private unless separately disclosed.
- Goal/plan records are NPC-domain state, not canonical world events.
- Goal completion requires authoritative observed state or verified Core outcome, never the model's claim alone.
- Reconsider plans when snapshot, dependencies, permissions, actor condition, source validity or rules change.
- No candidate is not equivalent to no goal; no goal is not equivalent to no capability; unknown preconditions are not satisfied preconditions.

## 10. Time, off-screen autonomy and processes

NPC autonomy is not permission to run continuously or advance world time implicitly.

- Core owns canonical in-world time and its progression.
- Time/Process Manager schedules or identifies due work only through its approved contract.
- Chat turns, API calls, OS time or elapsed wall-clock time do not advance in-world time unless the explicit world-time contract authorizes it.
- An off-screen NPC step requires an explicit trigger/orchestration request, current decision envelope, bounded work limits and idempotency key.
- Duplicate delivery of one trigger must not duplicate committed effects.
- Process Manager reports due/claimed/completed/failed states; Core's committed result determines whether a world effect occurred.
- Missing scheduler, time source, snapshot or process owner pauses progression rather than fabricating time or success.
- High-impact actions requiring approval remain gated.

## 11. Narrative and Host delivery

Narrative may transform authorized state/results into prose but cannot increase their authority. It must distinguish confirmed committed event, proposal/intention, belief/suspicion/rumor, unknown outcome, private information, and information that may be narrated but must not become NPC knowledge.

Host delivery status is separate from Core commit status. A committed event may not have been delivered; a delivered message may describe an event that did not commit if integration is faulty. Preserve both statuses and reconcile without rewriting canon.

Internal NPC context and player-facing output are separate disclosure decisions. Permission to use a fact internally does not automatically permit public narration or disclosure to another NPC.

## 12. Errors, retries, idempotency and recovery

Every cross-block operation must define stable request identity, idempotency, stale-snapshot behavior, timeout/partial-response behavior, cancellation, replay/recovery, audit reason code, and whether retries can repeat a side effect.

1. Retry reads only under their freshness/completeness contract.
2. Retry proposal creation with the same idempotency identity when it is the same intent.
3. After an unknown commit result, read authoritative lifecycle state before retrying; never blindly commit through another route.
4. Timeout is neither success nor failure without authoritative readback.
5. Revocation/withdrawal overrides stale positive cache entries.
6. If recovery cannot prove lineage, event status or lifecycle order, mark non-ready and reconcile.
7. Audit metadata without unnecessarily storing protected content.

## 13. Versioning and compatibility

Each implemented cross-block contract must name an owner and version, required/optional fields, allowed enum values, trust assumptions, freshness/invalidation rules, non-ready/error semantics, compatibility policy, conformance tests, and migration/rollback notes where needed.

Consumers reject unsupported major versions. Additive optional fields are compatible only when old consumers fail safely if they require an unknown field. Changing ownership, disclosure, empty-result semantics, actor binding or commit behavior is a breaking change.

A conceptual field in documentation or a fixture does not prove an implemented interface.

## 14. Production gate: Memory → NPC

Production use is **NO-GO** until all applicable requirements are proven against the exact target deployment and integrated commit:

- [ ] Host inventory is complete for active, historical, branched/imported, deleted and restored source versions in scope.
- [ ] A trusted verifier positively proves inventory completeness; a fixture callback or self-asserted boolean does not qualify.
- [ ] Provider preserves exact source/version lineage and lifecycle state through retrieval.
- [ ] Core has an implemented authoritative actor-relative acquisition/read contract for the selected acquisition mechanisms.
- [ ] The real path is proven end-to-end: Host capture → Provider adapter/storage → Core source/admissibility decision → actor/purpose-filtered NPC consumer → final serialized model input.
- [ ] Exact final serialized input is bound to admitted record IDs/versions, actor, purpose, policy and snapshot.
- [ ] Revocation/tombstone/scope changes are revalidated at final disclosure with race-resistant behavior.
- [ ] One protected egress path is used; direct/alternate routes cannot bypass it.
- [ ] Target-PC process identity, DB/file/WAL/SHM ACLs, backup/restore and anti-rollback are verified.
- [ ] Restart, recovery, stale data, incomplete inventory, Provider/Core outage, timeout, revocation race and replay tests pass.
- [ ] Exact-head tests and end-to-end acceptance pass on the proposed activation commit.
- [ ] Disable/rollback procedure is documented and tested.

Until every required gate is closed, Memory → NPC MUST remain disabled and fail-closed. Green unit tests, open PRs, feature-branch passes, a contract draft or successful retrieval do not satisfy this gate.

## 15. Integrated acceptance matrix

Tests must use real adapters/storage where required; mocks are useful for unit tests but cannot prove production readiness.

| ID | Scenario | Required result |
|---|---|---|
| XBC-01 | Model fabricates actor/source identity | Trusted caller identity wins; fabricated metadata rejected |
| XBC-02 | Actor binding missing or revoked | Non-ready; no fallback actor |
| XBC-03 | World fact exists but actor has not acquired it | Not injected as actor knowledge |
| XBC-04 | Provider complete-empty response | Distinct from denied, incomplete and error |
| XBC-05 | Inventory incomplete/stale | Protected use blocked |
| XBC-06 | Source revoked after retrieval, before dispatch | Final disclosure blocked |
| XBC-07 | Final body includes non-admitted candidate | Dispatch blocked without body leakage |
| XBC-08 | Profile suggests capability but policy denies action | Action rejected |
| XBC-09 | Relationship suggests trust but does not grant access | Access remains denied absent separate authorization |
| XBC-10 | Unsupported action or wrong version | No proposal/commit |
| XBC-11 | Preconditions unknown | Candidate is not ready |
| XBC-12 | Model claims success without Core commit | Goal remains incomplete; narration cannot claim success |
| XBC-13 | Proposal pending/approved but not committed | No committed-event claim |
| XBC-14 | Commit response times out | Authoritative readback before retry |
| XBC-15 | Same off-screen trigger delivered twice | At most one canonical effect |
| XBC-16 | OS time advances while world time is frozen | No in-world progression |
| XBC-17 | NPC proposal determines player choice | Reject or require player input |
| XBC-18 | Narrative receives private/out-of-viewpoint data | Exclude/redact per policy |
| XBC-19 | Snapshot/policy changes mid-decision | Invalidate/revalidate; stale proposal cannot commit |
| XBC-20 | Optional module absent | Explicit unavailable state, no invented facts |
| XBC-21 | Retry after unknown result | Idempotency/readback prevents duplicate commit |
| XBC-22 | Recovery finds conflicting history | Non-ready and reconcile; no silent winner |
| XBC-23 | Audit records protected request | Metadata retained without protected body/secrets |
| XBC-24 | Consumer sees unsupported major contract version | Safe rejection |
| XBC-25 | Real Host→Provider→Core→NPC path | Traceable evidence for each hop and final disclosure |

A test is PASS only when exact test run, commit SHA, environment and result are recorded. Test existence, a pass on another branch, or a mock pass is not sufficient.

## 16. Implementation order and exit criteria

### Phase A — freeze semantic ownership
Review the matrix against merged contracts; resolve explicit contradictions rather than silently replacing prior decisions; select the first supported NPC action family and knowledge-acquisition family.
**Exit:** named owners, versioned contract, accepted scope, no unresolved authority conflict for the first slice.

### Phase B — prove source and actor envelope
Identify actual production sources for actor identity, snapshot, profile, relationships, acquisition status, mechanics and world time. Define a versioned envelope only after each field has an authoritative source.
**Exit:** every required field is sourced, versioned and filtered; unavailable fields remain explicit.

### Phase C — one non-committing NPC decision
Feed the bounded envelope to the NPC decision step and return one bounded proposal from a selected action family. Prove read/evaluate/propose do not mutate canonical state.
**Exit:** invalid actor, missing data, unknown preconditions, forbidden action, stale snapshot and malformed output tests pass.

### Phase D — Core validation and lifecycle
Validate actor/action permission, policy, preconditions, snapshot freshness, player agency, effect support, approval, commit and readback. Reconcile NPC state only from authoritative outcomes.
**Exit:** proposal → approval → commit/reject/cancel/stale → NPC reconciliation is traceable and idempotent.

### Phase E — secure Memory → NPC disclosure
Complete §14 through the real Host, Provider, Core, NPC and final egress path.
**Exit:** all required evidence is recorded for the exact integrated deployment. Until then the feature stays disabled.

### Phase F — bounded off-screen progression and narrative
Add explicit time/process triggers, idempotency, work limits and delivery receipts only after earlier phases pass.
**Exit:** duplicate triggers, paused time, delivery failure and uncommitted results cannot create false history or narration.

## 17. Authority granted by this draft; limits

The project owner authorized this comprehensive cross-block contract draft. It defines the intended conceptual authority matrix for design and review.

It does **not** claim that missing APIs, schemas, events, storage records, permission checks or adapters exist; grant technical credentials or OS/database permissions; approve all actions or knowledge-acquisition methods; allow NPC to write Core state directly; authorize production Memory → NPC; mark tests as run; or supersede a merged contract without explicit conflict resolution.

**Required next implementation artifact:** a contract-to-code traceability table listing each requirement, current source/test evidence, missing owner/source, implementation PR and acceptance result. Only verified evidence may be marked implemented.
