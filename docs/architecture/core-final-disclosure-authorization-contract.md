# Core decision: final Memory disclosure and model-dispatch contract

**Decision owner:** Core  
**Decision date:** 26 Oct 2026  
**Status:** Core semantics are decided below; cross-owner implementation acceptance and production proof remain outstanding. This is not a callable runtime API and does not enable production Memory→NPC.

## 1. Core decision

A protected Memory-derived payload may be sent to a model only through one PC-side serialized egress authority that both (a) makes the final disclosure decision and durably orders dispatch-start, and (b) owns the only outbound transport for that protected request.

A standalone Core `allow`, a preflight read, a token/lease detached from the transport, or a PC check followed by a phone-side direct provider call is not authorization to dispatch. The existing `AuthorizedReadService` remains a bounded in-process source/field-read seam; it is not the final-dispatch gate.

This is the required target architecture for the current phone-UI / PC-processing deployment. It is a contract decision, not a claim that the gateway or the shared ordering already exists.

## 2. Linearization and ordering rule

There must be one enforceable serialization order for all state changes that can make a pending disclosure invalid and the durable dispatch-start decision. Relevant operations include:

- Core canonical source changes, status changes, destruction, rollback/retraction, and policy/binding invalidation;
- Provider query/record grant changes, revocation, source-lineage changes, reconciliation/inventory readiness changes, and recovery/restore transitions;
- the final decision and durable dispatch-start for the exact outbound request.

The ordering point is the durable dispatch-start decision. The gateway must not hand protected request bytes to the network before that decision is durably committed.

- If any relevant denial, revocation, source invalidation, or readiness loss is ordered first, the request is denied and the protected outbound transport invocation count is **zero**.
- If dispatch-start is durably ordered first, the request is in-flight. Later revocation cannot recall bytes already handed to an external transport. The system must not silently resend on timeout, lost acknowledgement, crash, or restart.
- If ordering cannot be established, an authority is unavailable, or the result is ambiguous, fail closed. An ambiguous already-started request remains in-flight/unknown until resolved under an explicitly approved retry policy.
- A duplicate request identity cannot create a second protected disclosure. Reuse of the same identity with a different payload or binding is rejected.
- No relevant writer may bypass the serialization authority. If a Core or Provider writer can commit independently without participating in the same order, the atomicity claim is false and protected dispatch remains disabled.

A process-local mutex is insufficient if a writer or the gateway can run in another process. Sequentially checking Core then Provider, or Provider then Core, is also insufficient. Existing separate SQLite transactions do not by themselves create a cross-store serialization boundary.

## 3. Request binding required for every dispatch

The final decision must apply to one immutable, exact request and must not be reusable for a later or modified request. Before dispatch-start, the authority must bind and validate all of the following using authenticated identities and owner-approved existing contracts:

1. Authenticated Host/adapter instance and actor binding; caller-supplied labels alone are not identity proof.
2. Exact world, subject/actor, recipient/model route, and purpose.
3. Exact protected source-record identities and Provider record versions used for this request.
4. Exact source type, source identity, and source version for each protected source.
5. Exact fields/content manifest or an equivalently strong binding to the protected bytes that will be sent. Any post-decision mutation of the payload invalidates the decision.
6. Current Core source state and policy decision at the serialization point.
7. Current Provider grants and complete, current reconciliation/inventory readiness for the relevant scope.
8. A unique request identity with durable duplicate/conflict handling and explicit crash/retry semantics.
9. The exact outbound route and payload that the gateway itself will send.

The contract does not prescribe a public endpoint, payload schema, table, outbox, cursor, token format, or new store. Those implementation details require a separate design freeze grounded in the actual owners' persistence and transport paths. They must not be guessed in adapter code.

## 4. Core-owned source authority

For direct `canonical_entity` records only, the approved source-version mapping is:

- Provider `source_version` is the canonical decimal string of the exact current Core entity's non-negative `updated_revision`;
- compare it for exact equality with the entity returned by `LogicEngine.getSnapshot(worldId, { entityIds: [source_entity_id] })`;
- require exact world/entity binding and an explicitly valid status; absent, destroyed, unknown, malformed, mismatched, or unavailable source state denies;
- revalidate the Core snapshot cursor `(world_revision, commit_sequence)` as a stale-snapshot detector, but never treat it as a source journal or as a substitute for the per-entity version check.

Provider `record_version`, Provider `source_version`, Core `updated_revision`, and Core `(world_revision, commit_sequence)` are distinct values with distinct meanings. The approved mapping does not authorize derived summaries or other source types, prove complete inventory, prove historical lineage, or establish end-to-end dispatch atomicity.

Rollback may restore an earlier entity revision while `commit_sequence` remains unchanged. The final decision must reject a record pinned to the rolled-back revision. Core's rollback/read-currentness regressions are covered by draft PR [#368](https://github.com/necromorphic/Logic-Engine/pull/368), exact head `9fc6d7ca107993b97798406376f79252539ddfcc`, Runtime CI [#40314713771](https://github.com/necromorphic/Logic-Engine/actions/runs/40314713771): `npm test` 625/625; recalculation oracle 8/8. This is Core regression evidence, not a production egress proof.

## 5. Failure and disclosure behavior

The decision is fail-closed if any required fact is false, missing, stale, partial, conflicting, unavailable, or unverifiable. This includes unknown source type; absent or destroyed source; version mismatch; rollback/retraction ambiguity; missing or revoked grant; incomplete or stale inventory/reconciliation; invalid actor binding; denied field/purpose/recipient; unknown request identity; unavailable serialization authority; and ambiguous recovery state.

Denial responses and diagnostics must not disclose protected source text, snippets, source counts, source-existence oracles, prompts, API keys, or other secrets. Audit evidence may contain only the minimum non-content metadata needed to prove ordering and correlate a request. Raw prompt/content retention is off by default.

No positive fixture callback, candidate label, index-ready flag, successful retrieval, NPC admission result, or test-only helper counts as production authority.

## 6. Owner obligations

- **Core:** provide the current canonical source/status/revision predicate and field/purpose/actor policy; ensure every relevant Core mutation/invalidation participates in the agreed ordering; retain rollback regression coverage.
- **Memory Provider:** provide durable grant/revocation and reconciliation/readiness state; establish authoritative inventory completeness and lineage for the supported scope; ensure all relevant Provider writers participate in the same ordering. Provider-local SQLite checks alone do not serialize with Core or network dispatch.
- **Host/Adapter:** route every protected outbound request through the PC-side gateway; enumerate the exact pinned Host routes and prove there is no direct-provider, extension, retry, regenerate, continuation, or alternate-backend bypass for protected content. Host remains UI/capture owner; it must not become a second Memory Provider.
- **Product/Security:** decide provider-key placement, phone-to-PC authentication, minimum audit metadata, retention, timeout/cancellation behavior, and the explicit treatment of in-flight/ambiguous requests and manual retries.
- **Joint implementation owners:** select and implement the concrete shared serialization mechanism, including crash durability and restore behavior. The chosen mechanism must be enforceable by all relevant writers, not merely documented.

These obligations allocate implementation responsibility; they do not let one owner assert another owner's authority or mark an unimplemented boundary as passed.

## 7. Required acceptance evidence

Before protected Memory can be enabled in production, exact-head tests using real persistence writers and the pinned Host transport must prove:

1. Valid current source + valid grants + complete reconciliation produces exactly one outbound call.
2. Denied actor/field/purpose/recipient, unknown source type, missing/destroyed source, stale or mismatched source version, and rollback/retraction produce zero calls.
3. Provider revocation/readiness loss ordered before dispatch-start produces zero calls.
4. Dispatch-start ordered before revocation is durably classified in-flight and cannot cause a duplicate disclosure after retry/restart.
5. Duplicate request identity is idempotent; conflicting reuse is rejected.
6. Core and Provider unavailability, partial inventory, stale reconciliation, and unknown serialization state produce zero calls.
7. Crash before dispatch-start, crash after dispatch-start but before handoff, lost acknowledgement after handoff, restart, and stale-backup restore follow the stated fail-closed/no-duplicate rules.
8. Every protected Host route reaches the sole gateway; any bypass blocks release.
9. Denial/error responses and logs contain no protected content or secrets.
10. Existing SillyTavern vectorization and the separate remote vector-store patch remain unchanged.

Tests must record the exact Core, Provider, and Host SHAs, deterministic barrier ordering, observed outbound-call count, durable final state, and CI URL. Sleeps, pure helper tests, fixture-positive validators, and baseline fake-provider success are not sufficient for the race/zero-egress claims.

## 8. Current disposition

**Core semantics: DECIDED. Cross-owner implementation contract: NOT YET ACCEPTED. Production egress: NOT IMPLEMENTED/NOT PROVEN.**

The present code has no approved serialized dispatch seam: `AuthorizedReadService` does not own outbound transport; Provider writes use separate persistence boundaries; the pinned Host baseline test is not a universal final-send gate; Host has reported no authoritative complete active + historical/deleted source inventory. Therefore production Memory→NPC remains **`DISABLED / FAIL-CLOSED`**.

Next implementation work is to map the actual Core and Provider writers onto one enforceable serialization mechanism and route protected transport through the PC gateway, then add deterministic race/crash/restore tests. If any relevant writer cannot participate, do not weaken the invariant; retain fail-closed behavior and revise the storage/ownership design before runtime implementation.

The existing SillyTavern vectorization and remote-store patch are explicitly out of scope and must not be changed by this contract.


## 9. Current-main implementation mapping — verified 26 Oct 2026

This section maps the decision above to the actual code currently on `main`. It records present seams and does not imply that a missing seam exists.

| Contract responsibility | Actual code path | What it currently guarantees | Exact gap against this contract |
|---|---|---|---|
| Canonical Core state and revision | `src/storage/sqlite-store.js`: `tx()` at lines 477–508; `state()` at 884–905; canonical projection rebuild at 2109 onward; rollback writer at 1877–2030 | Core mutations use `BEGIN IMMEDIATE` on the Core DB connection. Snapshot/state reads use one SQLite read transaction. Rollback changes `world_revision`, invalidates/retracts events and rebuilds projections; the commit sequence can remain unchanged. | This lock is local to the Core SQLite database. It does not lock Provider's separate DB or the external Host transport. |
| Core read policy/currentness | `src/application/authorized-read-service.js`: `readEntityFields()`, `readEntityAttributeForMechanic()`, `_assertDisclosureStillCurrent()` | Validates adapter/actor binding, recipient/purpose, trusted field policy and expected snapshot cursor; rechecks actor binding and the Core snapshot after the policy callback. | Returns a read result, not a dispatch-start decision. The cursor recheck narrows an in-process race but does not hold a lock through Provider validation and network handoff. It does not itself bind the exact final payload or route. |
| Runtime wiring | `src/index.js` | Constructs `SQLiteStore`, `LogicEngine`, and `createApiServer`; Core API is bound to loopback unless remote access is explicitly enabled. | No production egress gateway or final-disclosure coordinator is constructed/wired here. |
| Provider persistence and grants | `src/application/sqlite-memory-provider.js`: constructor/tables at 40–121; grant writes at 412–437; candidate authorization at 447–540; record persistence at 542–607 | Provider has its own SQLite connection, durable query/record grant tables, Provider-local readiness and race checks. `authorizeCandidate()` rechecks grants, `PRAGMA data_version`, readiness and source validator after awaiting. | The trusted `getSnapshot`, `validateSourceVersion`, and `validateInventory` are injected functions. Provider's local transaction/data-version protections do not serialize with Core's DB transaction or Host's network call. Some in-memory authorization generations are process-local; they are supplementary to, not a cross-owner serialization authority. |
| Provider reconciliation | Same Provider file: `reconcile()` at 630 onward; final publication uses Provider-local write locking | Revalidates source records, asks injected inventory validator for completeness, compares persisted record sets and Core snapshot before publishing ready/current. Fail-closed if checks are missing/false/throwing. | It cannot prove Host's inventory is complete unless a production authoritative adapter supplies that proof. A fixture-positive validator is not authority. Provider readiness is not final-send authorization. |
| Raw source capture/read | Same Provider file: `captureRawMessage()`, `readRawMessageVersion()`, `readActiveRawMessages()`, active selection/derived-copy operations | Raw Host capture/read and related operations currently throw explicit not-approved errors. | No approved raw retention or content lineage contract; do not open these methods as a shortcut to final dispatch. |
| Host final outbound transport | Pinned ST `06bde939fb1e9c4c8d8641d810f0a916b5bce127`; `src/endpoints/backends/chat-completions.js` includes provider-specific sends; Host route inventory also names text-completions, Kobold and other endpoint families | A bounded server-side Chat Completions harness demonstrates one baseline outbound request; source inventory identifies multiple separate route families. | No universal protected-payload gate or sole PC gateway is installed. The baseline test does not prove zero-egress denial, route completeness, browser/Android lifecycle, or bypass resistance. See Host inventory candidate in PR [#323](https://github.com/necromorphic/Logic-Engine/pull/323) and evidence in [issue #258](https://github.com/necromorphic/Logic-Engine/issues/258). |
| Shared dispatch/invalidation ordering | No current shared production code path | Core and Provider each have local transaction/race protections. | **No shared serialization authority exists.** Core's `BEGIN IMMEDIATE`, Provider's `BEGIN IMMEDIATE` and a later Host `fetch` are separate ordering domains. Sequential checks cannot establish the contract's linearization point. |

### 9.1 Consequence of the mapping

The current code does not support a truthful Core-only patch that adds a final `allow` response and claims atomic dispatch. Doing so would widen the API while leaving the race intact. The next runtime design must make all relevant Core mutation writers, Provider grant/readiness/reconciliation writers, and the gateway's durable dispatch-start participate in one enforceable ordering protocol.

A concrete candidate to evaluate is a PC-owned serialization authority with a durable coordinator transaction: every relevant invalidation writer must acquire the same authority before committing its mutation, and the gateway must acquire it while validating current Core/Provider state and recording dispatch-start. The gateway must own the subsequent transport and deduplicate request identities. This candidate is **not yet an approved schema or implementation**; it must be checked against all mutation entry points, direct DB writers, process boundaries, crash/restart, and backup/restore before any code is written. A process-local mutex or an advisory lock that some writers can bypass is not enough.

### 9.2 Owner-specific concrete work items from the mapping

- **Core:** enumerate every production writer that can change canonical entity status/revision or actor/field policy, then define the precise point where it acquires/releases the shared serialization authority. Existing `SQLiteStore.tx()` is not sufficient by itself.
- **Memory Provider:** enumerate every writer for query/record grants, records/lineage, index readiness, reconciliation and restore. Ensure a real writer can participate in the same order; the current separate Provider transaction must not be treated as automatically coordinated with Core.
- **Host/Adapter:** use the bounded route inventory as the starting point, not as a completeness claim. The selected protected route must be redirected through the PC gateway and all direct provider branches/extensions/alternate backends must remain unavailable for protected payloads until individually covered.
- **Product/Security:** decide the operational policy for provider credentials on the PC, phone-to-PC authentication, timeout/cancel, audit metadata, retention, and ambiguous in-flight requests. These choices do not replace the technical ordering proof.
- **Joint:** before runtime code, review a call-site matrix with exact writer/transport method names and demonstrate that none can bypass the shared order. If any path cannot participate, retain fail-closed behavior and mark that path unsupported.



### 9.3 Core write-entry-point inventory (current `src/storage/sqlite-store.js`)

The following public/store methods enter the Core `tx()` write boundary and therefore must be reviewed for participation if their effects can alter disclosure-relevant state or invalidate a source. This list is a source-level inventory of the current store file, not proof that all API/maintenance/restore paths have been covered.

| Method | Relevant write scope | Contract handling |
|---|---|---|
| `createWorld()` | World creation / canonical world state | Must participate if a protected request can target the world during create/reset/recovery. |
| `registerMechanicTemplate()`, `registerRuleModuleManifest()` | Mechanic/rule authority used by runtime behavior | Include if these versions affect source interpretation or disclosure policy; pin/validate exact rule authority rather than assume unrelated. |
| `registerContextManifest()` | Context manifest anchored to world revision/commit sequence | A manifest is not itself final-send authorization; source/payload binding must still be checked at dispatch. |
| `commit()`, `commitSegment()` | Canonical event commit and projection-changing effects | Must order source mutations/status changes and policy-relevant changes against dispatch-start. |
| `createTimeAdvanceOperation()`, `resumeTimeAdvanceOperation()` | Durable time operation and segment commits | Every segment that changes canonical state must use the same ordering; operation metadata alone is not a source-validity authority. |
| `registerTimeTrigger()`, `cancelTimeTrigger()`, `registerTimeConfiguration()` | Scheduled world behavior / time configuration | Include whenever changes can alter a protected source or its future validity/purpose policy. |
| `rollback()` | Event retraction/invalidation, projection rebuild, world revision advance | Must be serialized against dispatch-start; checking `commit_sequence` alone is insufficient. |
| `rebuild()` and projection-writing helpers | Reconstruct entity/fact/mechanic/relationship projections | Confirm whether each helper is reachable only under an already-coordinated writer transaction or can be invoked independently. |
| `processStore.invalidateEvents()` called by rollback | Cross-store process/event invalidation | This is a separate persistence boundary that needs its own ordering review; Core SQLite transaction alone does not prove atomicity with it. |

**Core-side finding:** `SQLiteStore.tx()` is a synchronous, same-connection SQLite transaction using `BEGIN IMMEDIATE`; nested calls use savepoints. This is a sound Core-local write boundary, but not a cross-owner lock. The contract implementation must decide whether all these writers can acquire a coordinator before entering `tx()`, whether any callback/maintenance/restore path bypasses these methods, and how lock ordering avoids deadlocks. Do not wrap only `commit()` and `rollback()` while leaving other relevant source/policy writers uncoordinated.


## 10. Core owner verdict for the current repository (26 Oct 2026)

**Verdict: UNSUPPORTED for the exact coordinator-lock candidate against current code.** This does not reject the desired safety invariant or claim that a PC-side gateway is impossible in principle. It means Core cannot accept this candidate as enforceable today because complete writer participation and bypass exclusion have not been demonstrated.

Reasoning:
- `SQLiteStore.tx()` provides Core-DB-local `BEGIN IMMEDIATE`, not mandatory acquisition of a separate coordinator by every writer.
- Direct API→store commit paths exist in `src/api/server.js` (current-main lines 331 and 371); therefore an engine-level wrapper alone would not cover canonical writes.
- Actor-binding changes use Core `store.tx()`, but do not acquire a shared coordinator.
- Time, trigger/configuration, rollback/rebuild, mechanic/rule/context registration, and process-store invalidation paths have not been shown to participate in a shared order.
- Store construction/migrations use direct DB DDL/data writes; direct DB access is available to application services. No complete maintenance/migration/restore/recovery bypass exclusion has been demonstrated.
- Provider persists to a separate DB and relies on injected asynchronous source/inventory validators. Final validation under a synchronous SQLite writer lock must be synchronous and authoritative; otherwise this candidate is unsupported until a separately approved async coordination protocol exists.
- `src/index.js` does not wire a production egress gateway. The PR #377 test-only multi-process experiment uses synthetic databases and does not prove production writer participation or actual Host transport ordering.

This is a conservative implementation verdict, not a statement that every possible writer has been exhaustively enumerated. The audit is incomplete by definition until API/direct-store, process-store, migration, maintenance, restore, recovery and direct-DB paths are covered by a source-backed call-site matrix.

No runtime API/schema/gateway change is authorized by this verdict. Production Memory→NPC remains `DISABLED / FAIL-CLOSED`. Reconsider only after every relevant Core/Provider writer is proven to participate in the same durable order (or is technically prevented from mutating protected validity), final checks are synchronous and authoritative under that order, and real two-process tests instrument the actual pinned Host upstream transport. Writer-first must yield no dispatch-start and exactly zero upstream calls; gateway-first must durably record dispatch-start before exactly one transport invocation; crash/restart and ambiguous sends must never auto-retry. Existing ST vectorization/remote-store changes remain out of scope.

## 11. Stacked implementation checkpoint — 26 Oct 2026

The source-level verdict in section 10 describes the unmodified `main` baseline at the time of that audit. Subsequent draft implementation branches have added real Core/Provider participation in the shared coordinator primitive, but they do not supersede the verdict for production: the branches are unmerged and the final Host dispatch barrier is still absent.

| Workstream | Exact evidence | What advances | Still not proven |
|---|---|---|---|
| Core PR [#380](https://github.com/necromorphic/Logic-Engine/pull/380) | Head `c461864b5f8983c9b50673cfb3bfcedf840d4481`; Runtime CI [#40358534076](https://github.com/necromorphic/Logic-Engine/actions/runs/40358534076), 632/632 npm tests and 8/8 recalculation-oracle tests | Core `SQLiteStore.tx()` participates in a shared coordinator lock; guarded `db` facade routes supported standalone DML/DDL through the transaction boundary; proposal/process-store schema paths are wrapped; runtime requires an explicit absolute coordinator path. | A separate process can still open the Core DB file independently and bypass the facade. Full maintenance/restore/third-party writer exclusion is not proven. No egress gateway. |
| Provider PR [#383](https://github.com/necromorphic/Logic-Engine/pull/383) | Head `4c040a26ec66e9327af5dc24d7612a8ae6b8da17`, base Core head `c461864b5f8983c9b50673cfb3bfcedf840d4481`; Runtime CI [#40359991519](https://github.com/necromorphic/Logic-Engine/actions/runs/40359991519), 641/641 npm tests and 8/8 recalculation-oracle tests | Provider startup DDL/migration, grant/revocation, ingest identity+record/index window, readiness, tombstone/purge, index rebuild and reconciliation publication participate in the shared lock; recovery after index-write failure is tested. | This does not establish authoritative Host inventory/source lineage, anti-rollback after coordinated copy/restore, cross-store atomic commit, or dispatch serialization. Raw capture/disclosure remains fail-closed. |
| Host PR [#378](https://github.com/necromorphic/Logic-Engine/pull/378) | Pinned ST `06bde939fb1e9c4c8d8641d810f0a916b5bce127`; head `8a3130f4aaef8255ff3eddb0c9332e627dea29f7`; source-audit CI [#40347644580](https://github.com/necromorphic/Logic-Engine/actions/runs/40347644580) and Runtime CI [#40347644499](https://github.com/necromorphic/Logic-Engine/actions/runs/40347644499) passed | The actual pinned MakerSuite handler reaches a loopback fake gateway exactly once for the configured `reverse_proxy` path. | Direct Google fallback still exists when proxy is absent. Loopback is not Android/Termux→physical-PC evidence; auxiliary Google routes are not all exercised. No protected request authorization/dispatch-start ledger is wired. |

### 11.1 Reconciled implementation disposition

The shared coordinator primitive is now implemented and exercised by the Core and Provider draft branches; it is no longer accurate to describe those branches as having no coordinator participation. However, participation in the tested methods is not equivalent to proving that every validity-changing writer is forced to participate. In particular, a separate process that opens the Core SQLite file independently is outside the guarded `SQLiteStore.db` facade.

The Host test proves only the configured-proxy branch of one pinned MakerSuite route. It does not force protected requests through the gateway, remove the no-proxy direct-Google fallback, establish dispatch-start ordering, or prove physical PC connectivity. Do not combine these three separate green CI runs into a claim of end-to-end integration.

**Current disposition remains unchanged:** cross-owner implementation acceptance is incomplete; protected egress is not implemented/proven; Memory→NPC remains `DISABLED / FAIL-CLOSED`. The next admissible proof must use the exact Core and Provider writer methods plus the pinned final Host transport call, show writer-first ⇒ zero upstream calls, dispatch-first ⇒ durable dispatch-start before exactly one invocation, exercise bypass/restart/ambiguous-send cases, and distinguish loopback CI from Android/Termux runtime evidence. No new public API/schema or vectorization changes are authorized by this checkpoint.
