# Core cross-block contract-path matrix

**Status:** Core architectural decision recorded; runtime implementation remains blocked. This matrix does not approve production disclosure.
**Repository baseline:** current `main` plus the explicitly named draft branches/PR evidence noted below.
**Rule:** every row separates what existing code enforces from what remains unproven.


## Core decision recorded 26 Oct 2026 — #140

- **ACCEPT as target topology:** protected Memory-bearing model requests must go through a PC-side egress gateway that owns final authorization and the sole upstream transport for the covered route.
- **ACCEPT CONDITIONALLY as the protocol candidate:** a cross-process coordinator lock held by every validity-changing writer and by the PC gateway from final synchronous checks through durable dispatch-start and the single upstream invocation attempt. The lock prototype is a viable candidate for production implementation only if the shared authority is technically mandatory for all writers and direct egress is blocked. **REJECT the current prototype as production evidence**, because its tests establish behavior only when every participant obeys the lock; production participation and bypass exclusion are not proven. A Core-only `SQLiteStore.tx()` or sequential preflight followed by a later Host fetch remains insufficient.
- **UNSUPPORTED as current implementation:** no production gateway is wired; Provider authority writers do not join a proven common order; the pinned Host route still permits direct upstream egress; complete direct-DB, migration, recovery and maintenance bypass exclusion is not established.
- Production Memory→NPC stays **DISABLED / FAIL-CLOSED**. This decision approves the topology direction for planning, not a runtime API/schema/store/outbox/cursor or production activation.

### Required protocol invariants

1. The PC gateway owns the sole upstream transport for every protected request. No reusable allow token followed by phone-side fetch; any uncovered backend/extension/path must not carry protected Memory.
2. One enforceable serialization authority orders durable dispatch-start against every validity-changing writer: Core source/entity/status/binding changes and rollback/rebuild; Provider grants/revocations, source/version/lineage, readiness/reconciliation, purge/restore; and startup/migration/recovery/maintenance. Any writer that cannot participate or be technically blocked is a bypass.
3. Immediately before durable dispatch-start, the gateway rechecks canonical source identity/version/currentness, actor binding, disclosure policy, Provider grant/revocation, and readiness/reconciliation under that same order. No awaited validator may be treated as authoritative while a synchronous SQLite writer lock is held.
4. If denial, revocation, invalidation, staleness, or readiness loss is ordered first, there must be zero upstream invocations. If dispatch-start wins first, the request is in-flight and cannot be recalled. A crash/ambiguous send after durable dispatch-start is not automatically retried; record it as ambiguous until explicitly reconciled. This is at-most-once invocation attempts, not exactly-once provider processing.
5. The serialization protocol does not imply cross-store atomic commit or atomicity with the network. Core canonical events/audit remain Core-owned; Provider records remain Provider-owned absent a separate owner decision.
6. Unknown source/version/lineage, incomplete inventory, unavailable/rebuilding Provider, unrecognized route, gateway/auth/authority failure, or unproven restore path means no protected payload is sent.

### Gate sequence

- **A — owner contract:** Host maps every protected route and proves direct egress can be technically disabled; Provider maps every authority-changing writer and provides a synchronous authoritative currentness check or identifies the missing interface; Core maps every canonical writer and closes or technically prevents direct DB/migration/restore bypass. Product/Security separately approves key placement, audit/retention, LAN/bridge authentication, and in-flight/retry semantics.
- **B — choose the exact serialization point:** only after Gate A, approve the minimum runtime seam and any persistence/API changes. No speculative outbox/cursor/store/schema before that decision.
- **C — production-path proof:** pinned Core + Provider + Host commits and actual PC gateway route. Writer-first → zero upstream arrivals; dispatch-start-first → durable start before one invocation; bypass attempt → test failure; crash/restart/restore/migration → no automatic retry and fail-closed unless current authority is proven; unauthorized fields/content/counts/diagnostics never leak.


| Condition / invariant | Existing code path | Existing test/evidence | Owner | Status / gap |
|---|---|---|---|---|
| Caller is bound to an actor and adapter | `src/application/actor-bindings.js`; `AuthorizedReadService.readEntityFields` / `readEntityAttributeForMechanic` | `tests/authorized-read-service.test.js`: wrong adapter/actor denied; revocation during policy evaluation prevents return | Core (read contract), Host (authenticated adapter identity) | Core in-process seam exists. Real Host identity mapping and outbound route still need pinned Host evidence. |
| Only explicitly permitted fields are returned | `src/application/authorized-read-service.js` field policy | `tests/authorized-read-service.test.js`: explicit allow-list, throwing/unknown policy denied, missing and withheld targets share safe error | Core / Product-Security policy owner | Service is not wired by `src/index.js` as a production Memory→NPC disclosure path; no approved broad Memory/NPC visibility policy is configured. |
| Canonical source exists, is active, and has exact version | `src/application/sqlite-memory-provider.js` calls trusted `validateSourceVersion`; approved narrow rule in Issue #140 comment 6413100985 | `tests/memory-provider-core-integration.test.js` exercises a fixture validator; Provider PR #362 (merged as `675c6876fc56bb0a0436c7880f48211cdb0008e9`) passed exact-head Runtime CI #40312515729; this is Provider-local evidence only | Core owns canonical snapshot/version predicate; Provider owns record validation integration | Mapping approved only for `canonical_entity`. The test fixture uses `source_version: 'fixture-source-v1'`; it is not proof that production wiring uses the canonical decimal `updated_revision` validator. Other source kinds remain unverifiable. |
| Rollback cannot make an old source cursor look current | `LogicEngine.getSnapshot`, `LogicEngine.rollbackEvent`, Core SQLite rollback/projection path | PR #355: R1→R2→rollback R2 restores R1; stale R2 cursor denied; `world_revision` advances while `commit_sequence` stays fixed. Follow-up deletion/restore regression added at commit `54bdcc59d66a110be1f9c77c43efee22cda33c74`; CI run #40309904999 was in progress at audit time. | Core | Attribute-update regression has exact-head CI evidence at prior head; deletion/restoration regression awaits exact-head CI result. |
| Provider query/record grants are current after awaited source validation | `SQLiteMemoryProvider.authorizeCandidate`, grant methods and Provider-local immediate transaction | `tests/memory-provider-query-revocation-race.test.js`; Provider PR #362 exact-head Runtime CI #40312515729 covers per-scope grant-generation and post-await rechecks | Memory Provider | Provider-local race is covered; it does not order revocation against Core mutation or final network dispatch. |
| Provider index/reconciliation is ready and current | `SQLiteMemoryProvider.rebuildIndex`, `reconcile`, `memory_index_state` | Provider reconciliation tests; Provider PR #362 documents atomic record comparison/readiness publication under Provider `BEGIN IMMEDIATE`; exact-head Runtime CI #40312515729 passed | Memory Provider | Inventory completeness depends on trusted `validateInventory`; test uses `async () => true`. Actual Host inventory and restore/reconciliation contract remain unproven. |
| Raw Host message/version lifecycle is complete | Provider raw capture/tombstone methods are Provider-owned; Host event capture is outside Core | Host #258 reports **NO SUCH MECHANISM FOUND / NON_READY** for a complete authoritative active + historical/deleted inventory with missed-change, rollback and replay detection. PR #358 verifies pinned ST SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, 7/7 source assertions and one baseline server-handler fake-provider request; it is not a full browser/Android lifecycle test. | Host/Adapter + Provider | Core cannot infer completeness from Provider records. Host inventory remains NON_READY; fake-provider baseline does not prove historical/deleted inventory or revocation safety. |
| Final model request passes one protected egress gate | No production egress coordinator is wired by `src/index.js`; `MemoryNpcConsumer` is an admission/context helper, not a model-dispatch receipt | Host PR #361 (merged as `e220fe6fe3f216825af6362d2115a6a53d2a0968`) proves only one baseline `POST /v1/chat/completions` request reached a recording fake provider; deny/stale/revoke cases requiring Core authorization remain BLOCKED. Provider #181 explicitly reports **NO PROVIDER-OWNED SERIALIZED DISPATCH SEAM**. | Host/Adapter + Product/Security + Core + Provider | **Topology direction ACCEPTED for planning; runtime UNSUPPORTED.** Gateway must own the sole protected upstream transport; direct Host egress remains a blocking bypass. |
| Revocation/source invalidation is serialized against dispatch-start | Core `SQLiteStore.tx()` uses Core DB `BEGIN IMMEDIATE`; Provider has its own SQLite transaction; Host network handoff is external | PR #377 passes controlled multiprocess lock-order/crash tests, but its synthetic stores assume participants obey the protocol | Joint | **Protocol candidate conditionally ACCEPTED; prototype REJECTED as production proof.** No shared production serialization point is yet established across all writers and actual network handoff. Remain fail-closed. |
| Retry, crash, ambiguous acknowledgement and restore cannot duplicate/resurrect disclosure | No single cross-owner durable dispatch-start contract exists yet | Acceptance scenarios are listed in `memory-disclosure-dispatch-implementation-plan.md`; no real end-to-end route test | Product/Security + Host/Adapter + Provider + Core | Decision and mechanism still required before runtime implementation. |
| Existing vectorization remains untouched | Separate ST vector patch is outside Core source paths | PR #357 scope statement and this audit | Host/Adapter / project owner | No changes authorized or made here. |


| Host-requested callable final-disclosure authorization contract | Existing `AuthorizedReadService.readEntityFields` / `readEntityAttributeForMechanic` in `src/application/authorized-read-service.js` | New Core proposal: `docs/architecture/core-final-disclosure-authorization-contract-proposal.md` | Core + Provider + Host/Adapter + Product/Security | No approved callable final-send contract exists today. Existing reads are internal field-read seams, not a final-send authorization; a preflight followed by phone-side direct fetch is insufficient. Proposal only; no runtime endpoint/wiring. |

## Decision summary

- **Core source-version predicate:** keep the only approved `canonical_entity` rule narrow and fail closed.
- **Core rollback/currentness:** preserve entity projection restoration and composite-cursor checks; do not rely on `commit_sequence` alone.
- **Provider-local guarantees:** useful and testable, but do not imply Core/Provider/Host atomicity.
- **Production gate:** disabled until exact Host routes, authoritative inventory, all invalidation writers, and the sole outbound transport share a proven serialization order. The PC-side sole-egress topology and cross-process coordinator-lock protocol are accepted conditionally for implementation planning; the current prototype is not accepted as production proof.
- **No guessed contracts:** no new API, schema, outbox, cursor, receiver, or production wiring is introduced by this audit.


## Clarification — protocol candidate vs proof (26 Oct 2026)

The coordinator-lock approach is **not rejected as inherently unworkable**. It is conditionally accepted as the candidate to implement and falsify against production paths, because it can establish a single order across separate Core/Provider databases and the gateway if every participant acquires the same cross-process lock *before* mutation and retains it through its local commit, and the gateway retains it through final synchronous authorization, durable dispatch-start, and the single upstream invocation attempt. The dispatch ledger must be durably committed separately while the coordinator lock remains held; a lock transaction must not be released before the invocation attempt begins.

The existing test-only prototype is rejected only as sufficient evidence for production readiness. The missing proof is enforcement/coverage: every writer must be unable to bypass the authority, and the actual Host route must be gateway-only. If those constraints cannot be enforced, the candidate must be rejected and the route stay disabled. This clarification does not authorize runtime wiring or production enablement.


## Concrete serialization primitive candidate — 26 Oct 2026

The candidate is narrowed to a **dedicated coordinator SQLite database used as a cross-process write lock, plus a separate durable dispatch ledger**. This is a proposed primitive to falsify, not an approved runtime API/schema and not production readiness.

1. Every Core, Provider, startup/migration, maintenance, recovery, restore, grant/revoke, source-currentness, readiness/reconciliation and binding writer acquires the coordinator DB write transaction (candidate: `BEGIN IMMEDIATE`) **before** mutating its owned store, retains it through local commit/rollback, and releases it only after that outcome. Any writer that cannot be forced through the authority or technically disabled is a bypass and fails the candidate.
2. The PC gateway acquires the same coordinator write transaction and performs final **synchronous authoritative** reads against current Core and Provider state. Async validators are not final in-lock authority. Unknown source kind/version/lineage, incomplete inventory, unavailable/rebuilding Provider, or any uncertain state denies.
3. While still holding the coordinator lock, the gateway commits a durable dispatch-start to a **separate dispatch ledger**, then initiates the one upstream transport invocation before releasing the coordinator lock. It does not hold the lock for the model response. A durable start with no conclusive transport result is ambiguous/in-flight and is never automatically retried.
4. The ledger must not be rolled back with an older Core/Provider backup. Restore/recovery must reconcile against it or keep protected dispatch disabled. If this cannot be guaranteed, reject the candidate.
5. This establishes ordering only; it does not provide cross-store atomic commit or exactly-once provider processing. Core remains owner of canonical state/audit, Provider of Memory grants/records/readiness, and the gateway of the actual outbound call.

### Required falsification tests

- Inventory every Core and Provider mutation plus migrations, maintenance, backup/restore and recovery; label each `participates`, `technically blocked`, or `unresolved bypass`, with exact method and test.
- Prove an uncooperative direct writer cannot mutate protected state (or cannot run in the production deployment).
- Against real Core/Provider stores and the actual gateway/Host route: writer-first means zero upstream invocations; dispatch-start-first means durable start before at most one invocation; crash/restart after start means no retry; stale-backup restore cannot resurrect a grant/source or roll back the dispatch ledger.
- Test lock-owner crash, process contention, busy/timeout, coordinator DB unavailable/corrupt, ledger unavailable, and failure between ledger commit and transport call. All uncertain cases fail closed.
- Product/Security sign-off remains separate for ledger retention, credentials, LAN/bridge authentication and in-flight semantics.

This refinement narrows the implementation choice but authorizes no runtime files, API/schema, production wiring, or activation. Memory→NPC remains **DISABLED / FAIL-CLOSED** until actual writer and egress paths pass these tests.


## Core writer participation inventory — current source mapping (26 Oct 2026)

This is a Core-side source inventory, not a claim that the coordinator primitive exists. In the current `main` baseline, **none of these paths is proven to participate in the proposed coordinator lock**.

| Writer family | Exact current entry/path | Current transaction boundary | Coordinator status |
|---|---|---|---|
| Canonical event commit | `src/application/engine.js`: `LogicEngine.commitEvent` → `store.commit`; `commitSegment` → `store.commitSegment` | Core `SQLiteStore` transaction | **Unresolved** — must join the shared authority before any protected-state mutation |
| Rollback/retraction | `LogicEngine.rollbackEvent` → `store.rollback` in `src/application/engine.js`; rollback projection and dependent process invalidation in `src/storage/sqlite-store.js` / `src/storage/process-store.js` | Core-local transactions and projection restoration | **Unresolved** — source currentness can change on rollback even when `commit_sequence` does not advance |
| Direct mechanic API commits | `src/api/server.js`, `mechanic-instances` create and enable/disable routes call `engine.store.commit(worldId, prepared)` directly | Store commit transaction, bypassing the Engine wrapper | **Unresolved bypass** — move behind the eventual mandatory Core entrypoint or technically prevent this route from writing |
| Actor binding grant/revoke | `src/application/actor-bindings.js`: `ActorBindingService.bind` / `revoke` | `engine.store.tx`; binding table uses the Core DB handle | **Unresolved** — same DB transaction does not itself join a cross-process coordinator |
| Proposal lifecycle | `src/application/proposals.js`: `create`, approval, `commit`, `cancel`; `commit` calls `engine.commitEvent` inside Core transaction | Core DB transaction/savepoint nesting | **Unresolved** — each mutation affecting authorization or canonical commit must acquire coordinator authority before its local transaction |
| Process/reconciliation state | `src/storage/process-store.js`: process create/update/transition/invalidation/review paths | `store.tx` on Core DB | **Unresolved** — must be included if any state changes source validity or snapshot admissibility |
| Time, trigger, mechanic/rule/config state | `src/application/engine.js` time-advance, trigger, mechanic and rule operations; routes in `src/api/server.js` | Multiple Core Store transaction paths; some route-level direct Store calls | **Unresolved** — classify each mutation individually; no blanket assumption from the main event path |
| DB access and schema lifecycle | `SQLiteStore.db` is exposed to application services; constructor and service constructors create/upgrade tables | Direct SQLite handle / startup DDL | **Unresolved bypass** — raw writes, migrations and schema maintenance are not technically forced through a coordinator today |
| Backup, restore, maintenance, recovery | No complete enforced coordinator participation mechanism established by this source audit | Not proven | **Unresolved / release blocker** — prove participation or disable protected dispatch for the affected deployment |
| Provider-owned grants, record versions, readiness and reconciliation | Separate Provider persistence and async validation paths; not owned by Core | Provider-local transaction | **Joint unresolved** — Core cannot certify Provider participation; Provider must map its exact writers |
| Actual upstream model transport | `src/index.js` wires `SQLiteStore`, `LogicEngine`, and `createApiServer`; no production PC egress gateway is wired | No protected dispatch boundary in Core runtime | **Missing** — Host must prove the sole gateway route and eliminate direct-provider bypass |

### Core conclusion from the inventory

The minimum safe next change is **not** to wrap only `LogicEngine.commitEvent`: that would miss rollback, actor binding, direct API commits, process/config mutations, raw DB access and startup/recovery. Before implementation, the chosen coordinator must be enforced at a lower shared boundary for all Core writes (or those paths must be blocked), while Provider independently proves its writers and Host proves gateway-only transport. A helper that callers may omit is not enforcement. Until that proof exists, the implementation remains **UNSUPPORTED / DISABLED / FAIL-CLOSED**.


## Production proof result — source and CI evidence (26 Oct 2026)

**Result: FAIL / NOT ESTABLISHED.** This is a failed production proof, not an inferred success.

- `src/index.js` (blob `db933d74403b28344a32950f2851158e96f7bc85`) constructs `SQLiteStore`, `LogicEngine`, and `createApiServer`; no PC egress gateway is instantiated or wired.
- `src/storage/sqlite-store.js` (blob `bf713de7bb6caedecf9d5e8026055d9147f94185`), `SQLiteStore.tx()` at lines 477–508, opens `BEGIN IMMEDIATE` only on the Core connection, commits/rolls back that connection, and handles nested savepoints. It does not acquire a cross-process coordinator or Provider lock.
- `src/api/server.js` (blob `f97e4ed28a540b89073653dc0a8ec0fc9c0a50bb`) calls `engine.store.commit(worldId, prepared)` directly at lines 331 and 371 for mechanic create and lifecycle routes, bypassing the `LogicEngine.commitEvent` wrapper.
- `src/application/authorized-read-service.js` (blob `4da9477569c0610a611811432b29d3b68592a2a5`) describes its revalidation as narrowing in-process TOCTOU windows, not as a cross-process atomic lease. It does not own transport invocation.
- PR #377's `tests/experimental-dispatch-order-protocol.test.js` creates synthetic `coordinator.sqlite`, `core.sqlite`, `provider.sqlite`, and `dispatch-ledger.sqlite` fixtures. Its worker code manually acquires the lock in every role; it does not instantiate `SQLiteStore`, the production Provider, API routes, or Host transport. The test proves ordering behavior **under the all-participants-cooperate assumption only**.
- Runtime CI for this matrix's current head `8bcf6464645d858c9b2a98bc1a1e997c9939f071` completed successfully at [run #40348312542](https://github.com/necromorphic/Logic-Engine/actions/runs/40348312542). This is repository test/CI evidence for a docs-only commit, not evidence that production serialization is implemented.

### Required next executable proof

The next Core test must exercise the actual `SQLiteStore` and service paths under separate OS processes, including canonical commit, rollback, actor binding, proposal lifecycle, process/config writes, migrations and direct `engine.store.commit` API routes. It must show that every write acquires the shared authority before the local write transaction and that a deliberately uncoordinated writer is rejected or impossible. Provider must demonstrate the same against its real persistence implementation. Host must demonstrate that the actual configured ST route has no direct upstream transport and reaches only the PC gateway. Synthetic fixtures cannot substitute for these checks.

Until those tests exist and pass, no claim of production ordering, revocation safety, or gateway-only egress is permitted; Memory→NPC remains **DISABLED / FAIL-CLOSED**.
