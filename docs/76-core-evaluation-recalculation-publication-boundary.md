# Core evaluation, recalculation, and result-publication boundary

Status: source-backed architecture boundary for #262. This document separates implemented behavior from missing production guarantees. It does not introduce an API, schema, graph store, scheduler, outbox, cursor, or alternate canonical writer.

Audit base: current main at commit bf35fb8dd13628718dacc11c27654c0929fba0e2 (25 Oct 2026). Re-pin the cited paths and rerun the matrix before treating this as current implementation evidence.

## 1. Executive finding

Logic-Engine currently has a modular-monolith boundary, not a general-purpose calculation service. Application orchestration lives in src/application/engine.js; canonical events, projections, transaction handling and replay/rebuild behavior live in src/storage/sqlite-store.js. The pure due-work planner in src/time/scheduler.js plans which time triggers are due; it is not a world dependency graph or general recalculation planner.

The existing proposal → approval → Core commit path remains the canonical write path. A bounded deterministic mechanic/rule subset exists in the repository, but its presence must not be described as universal dependency analysis, universal effect conflict resolution, or a fully wired production evaluation-and-publication pipeline. Result authorization has an internal fail-closed read seam, but that alone does not prove every outbound serializer/transport uses it or that revocation is atomic with release.

Therefore, #262 is not complete as a production feature. This document records the boundaries and a test matrix; it does not claim missing runtime behavior has been implemented.

## 2. Current implementation boundaries

| Stage | Source-backed behavior | Not established / not to infer |
| --- | --- | --- |
| Proposal and approval | Existing application path separates proposal/approval from canonical commit; stale base/revision is rejected by the commit path. | Approval does not guarantee a proposal remains current forever; every commit must revalidate its base and relevant rule versions. |
| Rule evaluation | src/core/rules.js implements a bounded set of deterministic operators and safe path reads. | It is not an arbitrary code executor, a global dependency graph, or proof that all semantic reads are declared. |
| Due-work planning | src/time/scheduler.js deterministically plans registered work over canonical time coordinates and documented ordering/constraints. | It does not read/write storage, advance time, execute effects, recalculate arbitrary projections, or grant NPC knowledge. |
| Application orchestration | src/application/engine.js orchestrates existing time advance, proposals, process transitions, and calls into storage/services. | Orchestration of known paths is not proof every action type follows one universal evaluation lifecycle. |
| Canonical commit | src/storage/sqlite-store.js owns canonical event/state transactions and commit/revision bookkeeping. Existing transaction boundaries can roll back a failed segment. | No second writer or direct model/adapter write is permitted. A successful local transaction does not prove a complete causal read-set. |
| Rebuild/replay | The store rebuilds projections from committed events in commit order and reapplies persisted effect patches for the supported path. | Projection replay is not historical semantic re-evaluation under new rules, nor a general re-planner. Stored effects must not be silently recalculated under current rules. |
| Process Manager | The first durable process/time slice supports bounded milestones, triggers, interruption/recovery, idempotency and a needs_review terminal review boundary. | This does not implement cross-process prerequisites, global causal closure, automatic replan, or universal transitive recomputation. |
| Authorized reads | src/application/authorized-read-service.js provides an internal fail-closed field-policy read boundary and rechecks canonical snapshot information around policy callbacks. | It is not proof of end-to-end serializer/transport wiring or linearizable revocation-vs-delivery. |
| Memory/NPC consumer | The current consumer seam can reauthorize records and prepare a result against a Core snapshot. | It is not a production receiver or proof every real Host → Provider → Core → NPC → serializer → transport path is connected. Memory→NPC remains DISABLED / FAIL-CLOSED. |

## 3. Required semantic lifecycle (design contract, not a claim of universal implementation)

1. Receive a proposal. Treat model/adapter output as untrusted intent, never as canonical fact or a direct write.
2. Bind the proposal to a base. Record existing canonical revision/commit-sequence evidence available to the path and applicable pinned rule/module versions. Do not invent missing identity fields.
3. Validate authority and preconditions. Check actor/world binding, permissions, current state, preconditions, supported effect shape, and rule compatibility. Unknown or unavailable evidence fails closed.
4. Evaluate only the supported deterministic subset. Evaluation must be pure or otherwise bounded as documented. Separate rule reads from proposed writes. If the path cannot prove relevant read dependencies, do not claim global conflict safety.
5. Plan and resolve conflicts. For each supported path, define stable ordering, overlapping write behavior, same-coordinate behavior, unknown prerequisites, and rejection behavior. The due-work scheduler only supplies due-work ordering; it is not a substitute for semantic conflict resolution.
6. Revalidate immediately before commit. Reject stale proposal bases and changed applicable rule/module versions. Do not partially mutate canonical state on rejection.
7. Commit atomically through Core/SQLite. Canonical events, supported projection updates, commit sequence, and relevant operation/process checkpoint must share the existing transaction boundary where the current contract requires it. On failure, roll back the whole segment and preserve a durable review/failure outcome without pretending the action completed.
8. Rebuild/replay deterministically. Replay committed event/effect evidence in recorded order. Historical semantic re-evaluation and meaning-changing migration are separate, unsupported operations until explicitly contracted.
9. Publish only through an authorized read/release boundary. The final response recipient and purpose must be checked against current authority. A check before serialization is not enough to claim atomic revocation safety unless the release protocol proves it.
10. Keep delivery/acquisition distinct from canonical completion. A committed world event does not imply that an NPC learned it, that a model context included it, or that a player/adapter received it.

This sequence is the target semantic boundary for supported paths. It is not evidence every stage is currently wired for every action type.

## 4. Dependency/read-set and conflict requirements

A future bounded implementation must explicitly identify, using existing approved contracts only:

- which canonical fields and rule/module versions were read to produce the proposal;
- which canonical fields/effects are written;
- whether read evidence is complete for the chosen supported action subset;
- how two proposals with overlapping writes, stale reads, same-coordinate triggers, or mutually incompatible preconditions are ordered or rejected;
- what invalidates downstream projections/results after a committed event, rollback, rule-version change, or rebuild;
- which evidence is persisted so a restart can replay the same decision without re-running a model or silently using newer rules.

Static inspection can establish declared field paths and explicit source-level dependencies. Dynamic tests can establish observed behavior for exercised branches, transactions, retries, and conflicts. Neither proves completeness for unexercised paths without an explicit closed-world assumption and coverage argument. If a rule or action can read arbitrary state outside its declared input, completeness is not provable from its output alone.

Do not add a generic dependency graph, new read-set schema, event outbox, cursor, or alternate writer as part of this boundary document. Any such implementation requires a separately reviewed design with ownership, migration, world isolation, versioning, cycle handling, and recovery semantics.

## 5. Failure and replay semantics

| Condition | Required behavior | Evidence needed |
| --- | --- | --- |
| Stale proposal base | Reject before canonical mutation; preserve proposal/operation evidence according to existing contract. | Assert state, revision, commit sequence, events, audit, idempotency records and proposal status unchanged; repeat after SQLite reopen. |
| Unsupported or unknown precondition | Fail closed; do not guess or treat unknown as false/true implicitly. | Tests for missing context, malformed rules, unknown prerequisites and no-residue behavior. |
| Conflicting effects | Reject or apply an explicitly approved deterministic resolution rule. | Competing proposals and same-coordinate trigger tests; assert stable result under input permutation where order is semantically irrelevant. |
| Mid-segment failure | Roll back the complete canonical segment and related checkpoint/effect writes that share its transaction. | Inject failure after an earlier event/effect; verify no partial event, audit, revision, trigger completion or process progress. |
| Failure → restart → same-key retry | Return the persisted terminal outcome without duplicate canonical mutation. needs_review is not permission to auto-resume. | Combined failure/reopen/replay regression; compare operation record, canonical time, revision, commit sequence, event count, process state, trigger state and audit. |
| Rebuild/replay | Reconstruct from committed evidence in stable commit order; do not silently re-evaluate historical meaning under current rules. | Replay determinism test with exact event/effect and rule-version evidence. |
| Authorization revoked before release | Deny disclosure if revalidation cannot prove current authority. | Real release-owner integration test that races revoke/rotation against final release; unit tests on the read helper alone are insufficient. |
| Restart with contradictory checkpoints | Fail closed into explicit review; do not guess which record is authoritative. | Corrupt/stale operation-vs-segment/process checkpoint tests and recovery evidence. |

The failure/restart/same-key test is tracked in PR #335. Its exact-head CI status must be read from that PR's commit workflow, not inferred from this document.

## 6. Bounded executor and adjacent work

The bounded mechanic executor/rule work associated with #226 is one limited semantic subset. It must remain clearly separated from the broader lifecycle:

- presence of evaluator/helper code does not prove production policy authority is bound;
- collecting condition dependencies does not prove all reads/effects are represented or all branches execute under an approved authority;
- passing unit tests do not prove deployment-owned policy rotation/revocation or real-source lifecycle;
- a bounded deterministic evaluator does not automatically provide downstream projection invalidation or authorized publication.

The current-main implementation work is tracked separately under #226 / PR #301 and related policy-authority decision work. Keep production mechanics disabled/fail-closed until approved real authority, context resolution, approval/commit revalidation, and real-source rotation/revocation acceptance tests are demonstrated.

## 7. Publication and non-disclosure boundary

AuthorizedReadService is an internal fail-closed read boundary. Its trusted field policy must explicitly allow every disclosed field for the requester/actor, recipient, and purpose; missing or throwing policy decisions deny the read. This is useful but narrower than end-to-end publication.

Still required before claiming production publication safety:

- identify the actual response-release owner and every serializer/transport path;
- show the final response is built only from the authorized read result, not a stale pre-authorization object;
- revalidate at the last responsible boundary or document an approved lease/transaction protocol that closes the revoke-vs-release race;
- prove that failure, stale snapshot, policy error, unknown actor binding, or revoked source causes no bytes/records to be delivered;
- distinguish captured, persisted, indexed, authorized, admitted, context-included, rendered, delivered, received, acquired, and believed. These states are not interchangeable.

No production end-to-end release guarantee is claimed here. Memory→NPC remains DISABLED / FAIL-CLOSED.

## 8. Ownership and acceptance checklist

| Work item | Owner/boundary | Acceptance evidence | Current status |
| --- | --- | --- | --- |
| Proposal base and canonical transaction | Core / application + SQLite store | Stale-base and rollback no-residue tests; exact-head CI | Existing bounded behavior; not universal causal proof |
| Due-work planning | Core / src/time/scheduler.js | Stable ordering and trigger/conflict tests | Implemented for registered due work only |
| General dependency/read-set completeness | Core design + supported evaluator owners | Approved closed subset, explicit reads/writes, branch/coverage argument, adversarial tests | Open |
| Deterministic downstream recalculation/invalidation | Core | Contract-approved bounded slice; dependency closure and replay tests | Open; do not claim a general planner exists |
| Process recovery | Core / Process Manager | Failure → durable review → reopen → same-key replay; checkpoint consistency tests | Narrow regression in PR #335; broader #243 remains open |
| Historical semantic re-evaluation/migration | Core + rule/World Pack owners | Separate versioned contract and migration/replay acceptance tests | Unsupported until separately approved |
| Authorized result release | Core + identified serializer/transport owner | Real-path deny/revoke/rotation race tests; no-disclosure proof | Open; actual release owner/path not yet established |
| Host/Provider/NPC integration | Host, Memory Provider, NPC owners with Core contract review | Real-source vertical slice and lineage/revocation/inventory evidence | Outside this issue's implementation scope; disabled/fail-closed |

## 9. Non-goals and explicit non-claims

This document does not implement or claim:
- a universal dependency graph or planner;
- complete read-set capture for arbitrary model-generated actions;
- global deterministic conflict resolution for all mechanics;
- automatic recomputation after every event or rollback;
- historical semantic re-evaluation or meaning-changing migration;
- cross-process process prerequisites or automatic replanning;
- atomic authorization revocation against external transport delivery;
- production Memory→NPC wiring or knowledge acquisition.

Changes to these boundaries require separately scoped, reviewed implementation slices. Keep #262 open until the source-backed architecture document is reviewed and the bounded runtime gaps are separately assigned and tested.
