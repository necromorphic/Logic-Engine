# Memory ↔ NPC contract reconciliation and integration gate

Status: Memory-owned handoff specification, documentation only. Integrated cleanly from the Memory-owned handoff branch; this file is documentation only.
Integrated into `main` through clean current-main PR #97. Historical branch-base information is intentionally omitted from this active contract.
This document records the boundary that exists today, the proposed contract that still needs owner approval, and the evidence required before production integration. It does not define a new runtime API, schema, outbox, cursor, permission system, or storage layer.

## 1. Executive result

**Production Memory → NPC retrieval remains blocked.** The merged NPC helper (`src/npc/memory-candidate-eligibility.js`, with `tests/npc-memory-candidate-eligibility.test.js`) is a pure consumer-side eligibility oracle over caller-supplied metadata. It does not retrieve Memory records, authenticate access decisions, provide a consistent snapshot, or prove authorization-before-disclosure.

Core PR #65 provides a protected `/authorized-read` route whose default scope is deliberately limited to the bound adapter actor's own `entity_id`, `entity_type`, and `status`. PR #101 adds an opt-in trusted host field-policy hook and bounded target IDs, but no policy is configured by default and no general Memory/NPC retrieval boundary is approved or wired yet. Core PR #83 requires a separate admin credential for HTTP canonical rollback; it does not publish a durable rollback-aware Memory source-change feed. Core PRs #94–#96 add admin-only typed Relationship writes and replay, but do not authorize NPC/Memory reads or provide a Memory source-change feed. Core PR #101 provides a configurable authorization seam only; PR #114 makes trusted operational state reads transaction-bound and returns both `world_revision` and `commit_sequence`, so rollback-only revision changes are observable to trusted callers. This is not a source-specific invalidation feed and does not authorize Memory content reads. Production access remains blocked until a trusted field policy and real boundary tests are approved. Core transaction support does not prove atomicity between canonical storage and an external vector archive/index.

No `allow`, `current`, `ready`, `active`, `usable`, or `reported` value supplied by an untrusted caller may be treated as proof of authorization, freshness, index health, acquisition, or delivery.

## 2. Evidence labels and ownership

- **Implemented/runtime** means present in the checked-in code and exercised by an appropriate test.
- **Merged specification** means documentation exists in `main`; it is not runtime implementation.
- **Proposal** means semantics are described but no approved runtime contract or owner decision establishes them.
- **Missing/blocking** means no verified contract or runtime path has been identified.
- **Memory owner** owns Memory record/retrieval semantics, index status, source lineage, deletion/retraction semantics, and reconciliation policy.
- **Core owner** owns canonical source identity/version, source validity, transaction/rollback truth, authorization primitives and any durable source-change signal.
- **NPC owner** owns NPC-side interpretation/admission, acquisition and belief semantics, and context-consumer behavior. NPC cannot promote supplied metadata into trusted authority.
- **Joint decision** means Memory and Core (and NPC where its consumer semantics are affected) must explicitly agree before implementation.

## 3. Required Memory contracts

### MEM-01 — Stable source identity and version

**Current state**
- Canonical entities/events/facts, audit/idempotency, rollback, and context manifests exist in the Core architecture/runtime.
- No verified general Memory retrieval contract was found that binds a Memory item to an immutable canonical source identity plus a source version/revision and validity state across rollback.
- A Memory record identifier, vector identifier, summary identifier, canonical reference, and source-event identity must not be assumed interchangeable.

**Status:** partially implemented at the Core canonical-data layer; end-to-end Memory identity/version binding is missing. Existing Memory documents are specifications, not proof of runtime support.

**Owners:** Core owns canonical identity, source revision/validity, and rollback truth; Memory owns its record identity and explicit source binding; joint approval for the mapping.

**Required Core contract:** a stable source reference and a verifiable way to determine the referenced source's current validity/version. The exact shape must be selected by Core; this document does not invent a field or API.

**Observable failure:** an item with a missing, malformed, stale, or rolled-back source reference is not silently admitted as current knowledge; the operation returns the agreed unavailable/stale outcome without disclosing protected content.

**Acceptance test:** create a Memory item from source S/version V; change or invalidate S; verify that the item cannot be represented as current under V and that an independent still-valid source can continue to support the same claim.

### MEM-02 — Retrieval completeness, unavailable, and partial results

**Current state**
- The NPC proposal distinguishes upstream retrieval completeness from candidate-level exclusions. Candidate filtering must not reveal the number or reasons for excluded records.
- The NPC oracle does not perform retrieval and cannot know whether an upstream query was complete, unavailable, timed out, or partially fulfilled.

**Status:** consumer-side semantics are proposed; a trusted Memory operation/result contract is missing.

**Owner:** Memory defines operation-level completeness and failure semantics; NPC consumes them without reclassifying candidate exclusions as retrieval failures.

**Required Core contract:** an authoritative operation status or equivalent signal that distinguishes a completed retrieval (including a genuinely empty result) from unavailable or partial retrieval, and states what is known about source/index coverage. Core must decide whether this is supplied by Core or by a Memory service backed by Core-valid source state.

**Observable failure:** a timeout, unavailable index, truncated scan, or partial backend response is never silently reported as a complete empty result. Candidate filtering does not expose protected candidate counts or rejection reasons.

**Acceptance test:** exercise complete-empty, complete-nonempty, unavailable, timeout, and partial retrieval; verify that operation status distinguishes them while a fully filtered authorized result does not disclose hidden candidate existence.

### MEM-03 — Source freshness versus index health

**Current state**
- The NPC proposal separates source reconciliation/freshness from index readiness; a value such as `ready` is not proof that source records are current.
- No verified durable contract was found that proves a vector/index has reconciled every relevant canonical source change, especially rollback.

**Status:** proposal only at the Memory↔NPC boundary; authoritative index/source freshness coupling is missing.

**Owner:** Memory owns index health and reconciliation progress; Core owns canonical source validity and change/rollback truth; joint approval defines how one is observed against the other.

**Required Core contract:** a trustworthy source-validity/change observation that cannot miss rollback merely because `commit_sequence` did not increase. Memory must separately define index operational health and reconciliation coverage.

**Observable failure:** the index may be operational but stale; retrieval must not label it current. When freshness cannot be established, return the approved unavailable/partial/stale result and do not present it as complete current knowledge.

**Acceptance test:** index source S, then invalidate/rollback S without advancing `commit_sequence`; verify reconciliation detects the change and that index readiness alone does not admit the old item as current.

### MEM-04 — Summary lineage and per-source access propagation

**Current state**
- The NPC oracle rejects incomplete summary lineage and checks that each supplied lineage source is bound to the requested world, actor, and purpose.
- Those checks validate shape and equality of supplied metadata; they do not authenticate the lineage, fetch source records, or enforce access at a trusted boundary.
- A summary's own access flag cannot safely widen access beyond any source from which its content was derived.

**Status:** consumer-side fail-closed checks are implemented; authenticated lineage and source-level permission propagation are missing.

**Owner:** Memory owns lineage capture and summary provenance; Core owns trusted source access decisions; NPC owns fail-closed consumption. Joint decision for mixed-source summaries and access changes after summarization.

**Required Core contract:** an authoritative source-access decision usable before content, snippets, counts, or record-specific diagnostics leave the trusted boundary. It must cover every lineage source under the actual requesting actor, world, and purpose, and define behavior when one source becomes inaccessible.

**Observable failure:** a summary with missing, forged, cross-scope, stale, or partly unauthorized lineage is withheld or reduced only by an explicitly approved safe recomputation rule. No protected text or record-existence signal leaks before authorization.

**Acceptance test:** summarize two sources; revoke access to one; verify the summary is not returned unchanged to the now-unauthorized requester and no content/count/diagnostic reveals the inaccessible source.

### MEM-05 — Deletion, retraction, access revocation, and invalidation

**Current state**
- Canonical rollback is protected by Core controls, but no general durable Memory invalidation/reconciliation contract has been verified for deletion, retraction, revocation, or source invalidity.
- A caller-supplied `current` or `allow` flag is not a revocation check.

**Status:** Memory policy and consumer failure semantics are proposals; end-to-end invalidation is missing.

**Owner:** Core owns canonical deletion/rollback and access truth; Memory owns removal or suppression from its records/indexes and summary descendants; NPC owns downstream reconciliation of acquired knowledge/beliefs according to valid alternative acquisition paths.

**Required Core contract:** an authoritative way to re-evaluate source validity and access at the point of disclosure, plus a durable or otherwise proven reconciliation mechanism for changes that affect stored Memory. Exact mechanism is a Core decision; do not assume an outbox or cursor exists.

**Observable failure:** after revocation/invalidation takes effect, a new retrieval cannot disclose the protected item or dependent summary. Failure to complete background cleanup must not bypass point-of-use authorization.

**Acceptance test:** retrieve an item, revoke access or invalidate its source, then retrieve again; verify no protected content or existence diagnostics are returned. Verify downstream NPC knowledge is reconciled without deleting a claim that still has another valid acquisition path.

### MEM-06 — Rollback reconciliation without a `commit_sequence` increment

**Current state**
- Core supports rollback as a distinct audited operation, and HTTP rollback requires the separate admin credential.
- A rollback may alter source-event validity without increasing `commit_sequence`; sequence-only polling is therefore not a safe complete reconciliation contract.
- No verified durable Memory source-change/outbox signal was found.

**Status:** rollback capability exists; Memory-aware rollback notification/reconciliation is missing.

**Owner:** Core owns rollback semantics and the reliable observation of source validity changes; Memory owns re-indexing, invalidation, lineage-descendant reconciliation, and retry/idempotency; NPC owns reconciliation of dependent acquisition/belief state. Joint approval is required for ordering and consistency guarantees.

**Required Core contract:** a durable, queryable or push-based signal that lets Memory discover every relevant source-validity change including rollback when the normal commit sequence is unchanged. Core must specify delivery guarantees, ordering, retention/recovery, and how consumers establish that they have caught up. This document intentionally does not prescribe an outbox, cursor, or API.

**Observable failure:** a rollback cannot leave a dependent Memory item indefinitely marked current merely because no new commit sequence was observed. If reconciliation status is unknown, retrieval must fail closed or return the approved stale/partial status.

**Acceptance test:** create source S and derived Memory item M; rollback S without advancing `commit_sequence`; restart the Memory reconciler between discovery and application; verify it eventually discovers the change, retries idempotently, invalidates M and dependent summaries, and does not erase independent sources.

## 4. Keep the operations distinct

These are separate state transitions and must not be collapsed into one “Memory succeeded” result:

1. **Retrieval:** a trusted service obtains a set of candidate records and an operation-level completeness/failure result.
2. **Authorization before disclosure:** a trusted boundary verifies scope and source access before returning content, snippets, counts, lineage details, or candidate-specific diagnostics.
3. **Context inclusion:** the host/model pipeline chooses which authorized retrieved content is actually placed in a prompt. Inclusion does not mean an NPC learned it.
4. **Delivery / receipt:** an in-world communication is sent and actually received/acknowledged according to the agreed channel semantics. Prompt inclusion is not delivery.
5. **Acquisition:** an NPC obtains information through a valid observation, communication, document, permitted inference, or explicit author-provided initial knowledge. Retrieval alone is not acquisition.
6. **Belief formation/persistence:** the NPC may form a belief, suspicion, or false belief from acquired evidence; a canonical truth change does not automatically rewrite the belief.
7. **Narrative presentation:** narration may report an authorized, supported result; narration is not evidence that delivery or acquisition occurred.

Each operation needs its own evidence and observable outcome. A success in one stage must not be silently reused as proof for a later stage.

## 5. Memory↔NPC field crosswalk and trust rules

| Concept | NPC consumer expectation | What can be trusted today | Required decision / gate |
|---|---|---|---|
| `content_kind`, `epistemic_kind`, `evidence_assessment` | Explicit semantic labels; unknown values fail closed | NPC oracle validates supplied values only | Memory owner approves canonical vocabulary and compatibility/versioning |
| Source identity/version | Stable, current source binding | No general end-to-end Memory binding verified | Core + Memory approve identity/version/validity contract |
| `allow` / access decision | Bound to requesting actor, world, and purpose | Supplied flag is untrusted; shape/scope equality is not authentication | Core supplies trusted authorization boundary before disclosure |
| `current` / source freshness | Source still valid and reconciled | Supplied flag is not authoritative | Core source validity + Memory reconciliation contract |
| `ready` / index state | Index operational and adequately reconciled | Readiness is independent from freshness | Memory defines index health and coverage/freshness separately |
| `active` / `usable` | Lifecycle dimensions relevant to the consumer | Proposal vocabulary, not interchangeable runtime enums | Memory/NPC agree mapping and owner of each state |
| `reported` / `acquired_report` | Report state versus actor-relative acquisition | `reported` alone proves neither receipt nor acquisition | NPC/Core agree on delivery, receipt, acquisition evidence |
| Summary lineage | Every source is known and independently authorized | NPC checks supplied lineage shape/scope only | Memory records lineage; Core authorizes each source before disclosure |
| Retrieval status | Complete, partial, unavailable, or failed | Oracle does not retrieve | Memory defines operation-level status; candidate filtering must not leak exclusions |
| Rollback/change signal | Detect source invalidation even without sequence increase | No verified durable Memory change feed | Core specifies rollback-aware change observation and recovery guarantees |

Do not add fields to the production API merely because they appear in this crosswalk. They are semantic requirements to be mapped to an owner-approved contract.

## 6. Boundary tests required before production integration

The following are release gates, not claims that current tests already pass:

- **AUTH-01 — Before-disclosure:** an unauthorized source never crosses the trusted boundary as content, snippet, summary, count, lineage, or candidate-specific diagnostic.
- **AUTH-02 — Revocation race:** revoke access between candidate discovery and return; the final disclosure is denied or safely recomputed under the agreed consistency contract.
- **SRC-01 — Version/validity:** stale, missing, or rolled-back source identity cannot be represented as current.
- **RET-01 — Completeness:** complete-empty, unavailable, timeout, and partial retrieval remain distinguishable.
- **IDX-01 — Freshness:** index health `ready` cannot mask stale or unreconciled sources.
- **LIN-01 — Summary lineage:** access to every source is checked before returning the derived summary.
- **DEL-01 — Delivery:** sent, received, and acknowledged are separate outcomes; prompt inclusion is not receipt.
- **ACQ-01 — Acquisition:** retrieval/context inclusion alone does not create an actor-relative acquisition record.
- **BEL-01 — Belief persistence:** canonical correction does not silently overwrite a false belief without a valid correction path.
- **RB-01 — Rollback discovery:** invalidation is observed even when `commit_sequence` does not advance.
- **RB-02 — Recovery/idempotency:** interrupted reconciliation can resume without missing or duplicating semantic effects.
- **LEAK-01 — Filter non-disclosure:** an authorized empty result and an all-filtered result are indistinguishable where revealing excluded record existence would violate access rules.

The existing `tests/npc-memory-candidate-eligibility.test.js` covers consumer-side metadata validation only. It is not evidence for these production boundary tests.

## 7. Merge/readiness decision

**Current decision: production integration is blocked.** The following owner decisions/evidence are still required:

1. Core: identify the actual approved source identity/version and source-validity observation contract, including rollback without sequence increment.
2. Core: identify the actual trusted retrieval/disclosure authorization boundary for a requester other than the adapter's self-identity route; specify consistency/revocation guarantees.
3. Memory: approve retrieval completeness/failure semantics, index health versus freshness, lineage, invalidation, and reconciliation policy.
4. Memory + Core: agree on durable rollback-aware change discovery and recovery semantics without presuming a particular mechanism.
5. NPC + Memory: approve the field/vocabulary mapping and ensure the consumer oracle is not misrepresented as authorization.
6. Integration owners: implement and run the boundary tests in section 6 against the real path; record exact commit SHA and native test/Actions result.

No Memory adapter, runtime endpoint, schema migration, parallel canonical store, authorization shortcut, outbox, or cursor is introduced by this document. PR #76 is closed unmerged as superseded: the helper/tests are on main via #78, the missing NPC contract docs are on main via #98, and selected current-main crosswalks were reconciled separately. Issue #70 stays open until the real authorized retrieval boundary, source-change/reconciliation path, and cross-owner acceptance tests are implemented; production readiness must not be inferred from documentation-only agreement.


## Current-main runtime checkpoint — Issue #129, 2026-10-24

The authoritative current-main runtime audit and cross-owner boundary decisions are maintained in [docs/73-memory-current-main-core-boundary-handoff.md](73-memory-current-main-core-boundary-handoff.md), audited against `main` at `c8b416440f5360f812f38bdb03644e79f52b0f1d`. This section supersedes historical PR-state statements above; it is a pointer, not a second copy of the audit.

Read authorization remains restricted and default-deny unless a trusted host policy is explicitly configured; no production Memory read policy or Memory record/retrieval/index/summary runtime is approved by this documentation. The handoff contains the current runtime classification, fail-closed boundaries, owners, and acceptance tests. No new runtime API, schema, store, outbox, cursor, or permission policy is authorized here; Issues #70 and #77 remain separate and open.