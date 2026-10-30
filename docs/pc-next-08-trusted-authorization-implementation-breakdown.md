# PC-NEXT-08 — Trusted authorization implementation breakdown

**Status:** IMPLEMENTATION PLAN / DRAFT. No production implementation is authorized by this document.  
**Parent:** PC-NEXT-07 Draft v3 + reconciliation addendum.  
**Audit baseline:** `main` `40704c1b6a2b5e6b31379973683f90e4b50eee9c` (2026-10-30).  
**Branch:** `docs/pc-next-07-trusted-authorization-flow`  
**Scope:** turn the approved semantics and unresolved owner decisions into ordered implementation work packages, source-to-contract traceability, and acceptance evidence. Documentation only.

## 1. Executive result

The trusted authorization work is not one patch. It consists of four independently owned boundaries that must converge on one exact protected request:

1. **Core identity and authorization:** authenticated adapter, Core-owned world binding, actor validation, policy authority, source/field/purpose/recipient decisions.
2. **Host identity and inventory:** authenticated ST session, stable conversation/actor binding, complete source/version inventory, exact request construction.
3. **Memory Provider evidence:** durable grants/revocation, record/source lineage, reconciliation completeness, rollback/recovery state.
4. **Security egress:** exact-request binding, one protected route, durable dispatch identity, rollback/anti-rollback, no direct or fallback transport.

The present repository contains useful primitives, but no production Host → Core/Memory → NPC → sole-Gateway path. This plan does not label those primitives as an integrated feature.

**Current readiness remains:** Host NON_READY; Stage 2 NO-GO; Memory → NPC DISABLED / FAIL-CLOSED; production ST NO-GO.

## 2. Evidence vocabulary

- **VERIFIED ON MAIN:** exact current-main source path supports the narrow statement.
- **PARTIAL:** a relevant primitive exists, but the full contract or cross-process guarantee is absent.
- **DRAFT / UNMERGED:** behavior exists only in a candidate branch/PR and is not shipped.
- **ABSENT:** no supported current-main implementation was found.
- **OWNER DECISION:** implementation must wait for an explicit decision from every affected contract owner.

A passing unit test, a candidate PR, an API health response, a local lock, or a source-level callsite does not prove an end-to-end security boundary.

## 3. Blocking design decisions before implementation

### D0 — Final revocation/dispatch guarantee

There is an explicit cross-contract conflict:
- Approved private adapter contract `docs/57-private-host-core-memory-npc-adapter-contract.md` §7.2 selects fail-closed checks at defined boundaries and explicitly does not promise linearizable ordering between concurrent revocation/commit and dispatch.
- Core-owned `docs/architecture/core-final-disclosure-authorization-contract.md` §§1–3 requires one PC-side serialized egress authority to make the final disclosure decision, durably order dispatch-start and own the only transport, with all relevant Core/Provider writers participating.

These cannot be represented as one already-approved guarantee for the same protected Lane B payload.

**Required owner decision:** Core + Host + Memory select:
- **A:** explicitly accept the residual race after final revalidation; or
- **B:** approve and implement one shared enforceable serialization order for all relevant invalidation writers and the PC Gateway.

**Recommendation for the stated integration goal:** Option B is the only option consistent with a requirement to prove unified dispatch-start ordering and prevent a revoke/source invalidation from slipping between final authorization and dispatch-start. This is a recommendation, not an owner decision. Until the owners approve B and its concrete persistence design, do not claim the race is solved or enable Lane B.

Lane A does not query Provider and therefore does not automatically inherit every cross-store requirement. It still requires exact acquisition pins, per-acquisition visibility, final request binding and Host sole-Gateway egress. Core and Host must state its revocation/dispatch guarantee separately.

### D1 — First supported evidence lane

Lane A and Lane B have different semantics and purpose values:
- Lane A: Core-owned `author_initial` / `imported` acquisition; candidate reader PR #744; purposes `npc_turn_context` or `npc_action_evaluation`.
- Lane B: Memory Provider evidence; current consumer seam supports direct `canonical_entity` candidates only; purpose `npc_decision`.

The private adapter contract prohibits combining the lanes into one model context until a reviewed purpose-mapping rule is approved and tested.

**Required owner decision:** choose one lane for the first end-to-end slice. Do not combine them to increase coverage. The other lane remains disabled until independently accepted.

### D2 — Host actor selection and binding

Current Core services do not uniquely select an actor from adapter identity:
- `HostConversationWorldBindingService` resolves `(adapterId, conversationId) → worldId`.
- `ActorBindingService` validates an exact `(worldId, adapterId, entityId)` binding; it does not choose an actor.

Host must resolve actor selection from authenticated server-side session state, then Core validates that exact actor. If Core-owned unique selection is required, it is a separate service/API decision.

### D3 — Disclosure policy authority

No current-main versioned disclosure authority tuple `authority_id + generation + snapshot_fingerprint` was confirmed. The active mechanic policy validator is not the disclosure authority.

Core must approve:
- authority identity and owner;
- generation increment rules;
- effective policy canonicalization;
- fingerprint schema and hash;
- scope dimensions;
- invalidation and revalidation semantics.

The proposed PC-NEXT-07 fingerprint is a design candidate only. Do not implement against it until Core approves it.

### D4 — Gateway location and ownership

Private contract: Host owns session authentication and the sole Gateway. Core contract: the final disclosure/dispatch authority must be PC-side. Current-main source does not prove whether the Gateway is a module in the ST server process or a separate PC service.

Host/Product/Security must choose the deployment boundary, phone-to-PC authentication, provider credential placement, and network-egress enforcement. A client-configurable reverse proxy is not trusted authority. Do not reuse old provider-specific gateway artifacts as a current provider decision; provider-neutral routing is required.

## 4. Source-to-contract traceability

| Requirement | Current evidence | Status | Required work |
|---|---|---|---|
| Adapter authentication | `src/api/server.js`: `adapterIdFor(req)` derives identity from configured adapter token and matching `x-adapter-id` | VERIFIED narrow | Keep credentials server-side; no body identity authority; add boundary tests for substitution and missing credentials |
| Conversation → world | `src/application/host-conversation-world-bindings.js` | VERIFIED narrow | Bind only from authenticated Host session; test missing/revoked/rebind/cross-adapter |
| Actor binding | `src/application/actor-bindings.js` | VERIFIED narrow | Host session resolves actor; Core validates exact actor; add ambiguity/destroy/revoke tests |
| Authorized field read | `src/application/authorized-read-service.js` | PARTIAL | Trusted composition-root policy factory, versioned disclosure authority, exact purpose/recipient, post-read checks; do not treat as final dispatch authorization |
| Versioned disclosure authority | No confirmed current-main `authority_id + generation + snapshot_fingerprint` | ABSENT | Core-owned design and implementation; no fallback or request-supplied policy |
| Lane A acquisition ingestion | Main source-ingestion foundation (PR #683) | VERIFIED narrow | Reader, per-acquisition visibility, value/source-event pins; PR #744 remains draft/unmerged |
| Lane A reader | Candidate `readNpcKnowledge()` in PR #744 | DRAFT / UNMERGED | Reconcile against current main, review rollback/value-reuse regression, separate visibility decision and context builder |
| Lane B consumer | `src/application/memory-npc-consumer.js` | PARTIAL | Internal seam only; no production Host callsite, serializer or final Gateway integration |
| Core entity source token | PR #709 merged; opaque `core-entity-v1:<counter>` ledger | VERIFIED narrow | Keep distinct from Provider source_version and snapshot cursor |
| Provider source_version | Core final-disclosure contract maps direct canonical_entity Provider source_version to canonical decimal `updated_revision` | CONTRACT DECIDED; integration PARTIAL | Exact compare against current Core entity snapshot; rollback mismatch must deny |
| Provider record version/grants | `src/application/sqlite-memory-provider.js` local durable grants and record state | PARTIAL | Prove all grant/record/lineage writers and final revalidation participate in selected dispatch guarantee |
| Provider reconciliation | Provider-local reconciliation and readiness checks | PARTIAL | Authoritative Host inventory verifier, full active/historical/deleted/restored scope, deterministic incomplete/stale tests |
| Host inventory | `src/index.js` wires `verifyInventorySnapshot: async () => false` | VERIFIED deny-only | Keep NON_READY until real Host proof; never replace false with true as a shortcut |
| Shared invalidation/dispatch order | Core and Provider have separate persistence boundaries; no complete shared production authority | ABSENT | If D0=B, design and implement one coordinator all relevant writers and Gateway must use |
| Sole Gateway | `src/security/memory-dispatch-gateway.js` primitive/route allowlist exists | PARTIAL | No proof ST route is wired, no universal bypass inventory, no sole outbound transport proof |
| Rollback/anti-rollback | Core source/event rollback primitives and Provider-local state exist; cross-store restore ordering not proven | PARTIAL | Recovery/backup/restore design, accepted-head protection, stale-backup detection, zero-egress tests |
| DENY behavior | Current internal consumer `ready/non_ready`; private contract avoids new public enum | VERIFIED semantic contract | Generic caller response; detailed safe diagnostics server-side; no enumeration |
| Production activation | No complete path and release gates remain open | ABSENT / NO-GO | Separate explicit approval after exact-head end-to-end evidence |

## 5. Ordered implementation work packages

### WP-00 — Freeze cross-owner semantics

**Owners:** Core, Host, Memory, Security/Product.  
**Dependencies:** none.  
**Deliverables:**
- written D0 decision (A or B) with exact guarantee boundary;
- selected first lane (D1);
- actor-resolution owner and source (D2);
- approved policy authority/fingerprint schema (D3);
- Gateway deployment/credential/network ownership (D4);
- API-change approvals for any changed cross-block contracts.

**Acceptance:**
- no contradictory guarantee statements remain for the selected lane;
- every trusted identity and policy value has one owner;
- every public/private API delta is approved by its owner;
- unsupported lane and routes remain explicitly denied.

### WP-01 — Host session and identity binding

**Owner:** Host; Core validates the binding.  
**Dependencies:** WP-00 D2.  
**Required behavior:**
- authenticate actual ST server-side session;
- resolve stable conversation identity and actor selection from server-side state;
- bind session generation to each dispatch attempt;
- reject body/prompt/model-provided identity fields;
- pass only the trusted internal binding to Core;
- Core derives adapter identity from configured credentials and validates conversation/world and exact actor binding.

**Acceptance tests:**
- AUTH-01..03; BIND-01..04; HOST-FINAL-01;
- session replacement, conversation switch, actor switch, revoked binding, cross-world binding and duplicate actor candidates all deny;
- no fallback to first actor or caller-supplied world/actor.

### WP-02 — Core trusted-authorizer composition root

**Owner:** Core.  
**Dependencies:** WP-00 D3; WP-01 identity contract.  
**Required behavior:**
- one server-side factory creates all trusted authorizers and policy providers;
- HTTP request, Host body, prompt, model output and Memory record cannot inject callbacks or policy;
- missing provider/policy => NON_READY; no permissive fallback;
- authority tuple includes approved identity, generation and fingerprint;
- every field decision binds actor, world, recipient, purpose, policy scope and relevant version;
- policy is checked before and after any asynchronous read callback; snapshot/binding are revalidated.

**Acceptance tests:**
- POLICY-01..05;
- purpose/recipient substitution;
- callback throw/timeout/unavailable;
- generation rollback/replay and stale policy content;
- verify no code path replaces a deny-only callback with unconditional allow.

### WP-03 — Lane A Core acquisition reader (only if selected)

**Owner:** Core; NPC owns belief interpretation.  
**Dependencies:** WP-00 D1/D3; WP-02.  
**Required behavior:**
- reconcile PR #744 against current main and current #709 source-version contract;
- only `author_initial` and `imported` sources in first slice;
- immutable acquisition pin binds exact value and sorted source-event IDs at assignment;
- per-acquisition visibility decision before any value leaves Core;
- exact Lane A purpose; no silent alias to `npc_decision`;
- rollback/reused fact ID cannot cause old acquisition to follow a new value;
- no raw reader result directly serialized to Host/model.

**Acceptance tests:**
- VERSION-01d acquisition pin;
- rollback A → retract A → reuse fact ID for B → no old A acquisition returned;
- independently supported source remains valid only under its own acquisition;
- withheld/unknown visibility emits no value and no existence oracle;
- stale/revoked acquisition fails closed.

### WP-04 — Lane B Provider evidence path (only if selected)

**Owners:** Memory Provider + Core.  
**Dependencies:** WP-00 D1/D3; WP-02.  
**Required behavior:**
- support only direct `canonical_entity` candidates in first slice;
- validate Provider record ref/version, query grant, record grant, lifecycle, provenance, evidence assessment, lineage and complete result declaration;
- validate Provider source_version against canonical decimal Core `updated_revision` and separately validate the opaque Core entity source token;
- Core re-reads only approved fields for exact actor, recipient `model`, purpose `npc_decision`;
- Core cursor, entity source version, record version and grants remain separate checks;
- summaries, raw Host message text and unsupported source types stay excluded;
- canonical Core state outranks derived Memory evidence; unassessed/disputed/insufficient evidence cannot be promoted by retrieval score or model fluency.

**Acceptance tests:**
- VERSION-01a/b/c as applicable; READ-01/02; CONFLICT-01..03;
- record grant revoke after retrieval;
- source update/revision rollback between retrieval and final revalidation;
- Provider incomplete/partial/complete-empty/denied/unavailable distinguished;
- unsupported source type and summary lineage deny;
- no partial target set or protected existence leakage.

### WP-05 — Host inventory and reconciliation proof

**Owners:** Host + Memory Provider; Core consumes verified result.  
**Dependencies:** WP-00 D0/D4; WP-01.  
**Required behavior:**
- inventory includes active, historical, branched/imported, deleted and restored source versions in the agreed scope;
- inventory identity is stable across restart, chat switch, edit, swipe/regenerate, delete and restore;
- every capture version has exact parent lineage and content digest;
- reconciliation can prove completeness, not just idempotent sync;
- source mutation and inventory readiness loss invalidate protected use;
- verifier is deployment-owned and cannot be caller-controlled.

**Acceptance tests:**
- inventory omission, stale cursor, parent mismatch, duplicate version ID, deletion/reappearance, branch/rewrite, restore from stale backup;
- completeness verifier missing/false/throws => NON_READY;
- reconciliation repeated with same snapshot is idempotent, but this alone is not recovery proof;
- no raw text persistence unless a separately approved capture contract permits it.

### WP-06 — Shared serialization authority and dispatch-start (if D0=B)

**Owners:** Security/Core/Memory/Host jointly.  
**Dependencies:** WP-00 Option B; WP-02; WP-04; WP-05.  
**Required behavior:**
- choose one enforceable durable serialization primitive supported by all relevant processes;
- enumerate every Core canonical source/policy/binding writer;
- enumerate every Provider grant, record, lineage, reconciliation, readiness, tombstone, purge, rebuild and restore writer;
- require each relevant writer to participate before committing an invalidating change;
- Gateway revalidates current policy, actor, source, grants, readiness and inventory under the same order;
- bind exact serialized bytes or integrity-protected manifest, candidate IDs/versions, actor, world, purpose, recipient, model/route, stream mode, request ID and nonce;
- durably record dispatch-start before network handoff;
- Gateway owns the only outbound transport for protected payloads;
- duplicate request identity cannot cause second disclosure; conflicting reuse denied;
- after dispatch-start, ambiguous timeout/crash remains in-flight/unknown; no silent replay.

**Acceptance tests:**
- deterministic barrier race: revoke/source invalidation/readiness loss wins before dispatch-start → outbound call count zero;
- dispatch-start wins first → durable in-flight state; later revoke does not claim to recall handed-off bytes;
- crash before dispatch-start → no outbound call;
- crash after durable start but before handoff → explicit unknown/recovery semantics; no blind resend;
- lost acknowledgement after handoff → no duplicate call;
- duplicate ID same exact payload idempotent; same ID changed payload/binding conflicts;
- any writer bypassing serialization blocks release.

### WP-07 — Rollback, restore and anti-rollback

**Owners:** Core + Memory + Security/Operations.  
**Dependencies:** WP-00 D0; WP-06 if Option B.  
**Required behavior:**
- define authoritative accepted-head/generation state for every durable ledger used by dispatch authorization;
- backup/restore cannot silently move accepted state backwards;
- stale backup, missing coordinator ledger, mismatched Core/Provider generation, partial restore or unknown recovery state => NON_READY;
- recovery must reconcile Core, Provider, Host inventory and dispatch ledger before reopening;
- dispatch identities already started cannot be reset to unseen by restoring an older database;
- do not invent a second independent rollback ledger unless owner-approved and proven necessary.

**Acceptance tests:**
- restore Core DB older than coordinator;
- restore Provider DB older than grants/revocations;
- restore dispatch ledger older than dispatch-start;
- partial restore of one store;
- missing/corrupt coordinator;
- stale accepted head / generation rollback;
- each scenario produces zero new protected egress until recovery completes.

### WP-08 — Sole route and transport integration

**Owner:** Host; Security reviews.  
**Dependencies:** WP-00 D4; WP-06 if Option B.  
**Required behavior:**
- identify exact ST route(s) that can carry protected NPC context;
- one protected route reaches Gateway; all other provider/extension/alternate-backend routes reject protected payloads;
- no fallback to direct provider transport on Gateway failure;
- server-side Gateway address and credential cannot be replaced by client request/config;
- provider credentials exist only at approved egress owner;
- no request body, token or private context in logs;
- non-protected ordinary ST generation remains unchanged unless separately scoped.

**Acceptance tests:**
- every route in the bounded inventory: supported route passes through Gateway; unsupported route zero-egress denies;
- route/model/stream/body mismatch denies;
- Gateway unavailable denies without direct fallback;
- client attempts to override Gateway URL/credential deny;
- verify no changes to SillyTavern vectorization or remote vector-store patch.

### WP-09 — Integrated acceptance and release gate

**Owners:** all blocks; Security independent reviewer.  
**Dependencies:** WP-01 through WP-08 applicable to selected lane and D0.  
**Required evidence:**
- exact Core, Provider, Host and Gateway SHAs;
- clean isolated deployment identity and config fingerprint (no secrets);
- exact test command, test output and CI URL;
- deterministic barrier ordering for race tests;
- observed outbound call count;
- durable post-test ledger state;
- crash/restart/restore evidence;
- route-completeness evidence;
- no protected content in logs;
- explicit owner sign-off and separate production enablement approval.

No unit-only, mocked-only, source-only or health-only result can mark end-to-end acceptance PASS.

## 6. Dependency order

`WP-00 → WP-01 → WP-02 → (WP-03 OR WP-04) → WP-05 → [WP-06 if Option B] → WP-07 → WP-08 → WP-09`

Notes:
- WP-03 and WP-04 are alternative first slices, not a combined scope.
- WP-06 is mandatory if Option B is selected; if Option A is selected, the residual race must be explicitly accepted and the Core final-disclosure contract reconciled before any Lane B enablement.
- WP-07 restore tests depend on the actual chosen persistence/order mechanism; do not write fake anti-rollback tests against an unapproved schema.
- WP-08 may be developed in isolation, but production route coverage cannot be declared until the exact target ST commit and all relevant routes are enumerated.
- No production enablement is implied by completion of any individual WP.

## 7. Explicit exclusions

- No changes to production code, Core DB, Provider DB, Host installation, SillyTavern vectorization, remote vector store, or user data.
- No activation of Memory → NPC.
- No use of the legacy provider-specific egress patch as current architecture; provider choice is not defined here.
- No PR creation, merge, deployment or runtime test in this documentation task.
- No replacement of deny-only inventory verifier with a positive callback without a real authoritative verifier.
- No API/schema change without approval from every affected owner, per private contract D5.

## 8. Immediate next work

1. Produce a source-level writer/transport callsite matrix for the exact current Core and Provider code, extending PC-NEXT-06 without rerunning already-completed test suites.
2. Reconcile the concrete coordinator and restore/anti-rollback design against the attached Security/Coordinator artifacts only if they are current and provider-neutral; legacy provider-specific artifacts must be marked obsolete, not adopted.
3. Ask the owners to resolve D0 and select the first lane.
4. Only after those decisions, freeze the implementation contract and create implementation PRs.

**User input currently required:** none to continue source-level, read-only decomposition. Owner decisions D0–D4 are required before implementation, but this documentation plan does not assume those decisions have been made.

## 9. Change log

- **v1:** initial implementation decomposition; separates owner decisions, source traceability, work packages, deterministic acceptance evidence, rollback/recovery and route integration. Documentation only.


## 10. Additional current-main audit — Gateway and coordinator primitive

This addendum records a closer source inspection of `src/storage/coordinator-lock.js`, `src/storage/sqlite-store.js`, `src/application/sqlite-memory-provider.js`, and `src/security/memory-dispatch-gateway.js` at the same `main` baseline. This is source review only; no runtime test was run.

### 10.1 What exists

- `src/storage/coordinator-lock.js` implements a file-backed SQLite coordinator. `beginCoordinatorLock()` uses `BEGIN IMMEDIATE`; the lease is released with `ROLLBACK`. The helper explicitly requires synchronous callbacks and forbids awaiting while the lease is held.
- Core `SQLiteStore.tx()` acquires its configured coordinator lease around the local Core transaction. Nested writes reuse the outer transaction/savepoint.
- Memory Provider `#withImmediateTransaction()` acquires its configured coordinator lease around its local Provider transaction. `#withSerializedWrite()` routes serialized Provider writes through it. Async source validation is intentionally outside the lock; final Provider grant/readiness checks are synchronous under the coordinator.
- `MemoryDispatchGateway.dispatchProtectedRequest()` acquires the coordinator, checks accepted-head status, calls injected synchronous Core and Provider evidence readers, verifies exact world/actor/purpose/readiness/head/source/candidate sets, writes a durable `DISPATCH_STARTED` row in its dispatch ledger, commits that row, and releases the coordinator before awaiting `sendUpstream()`.
- On startup, durable `DISPATCH_STARTED` rows are converted to `UNKNOWN`; the code comments prohibit automatic retry of an ambiguous request.
- The Gateway has no fallback reader or transport; `sendUpstream` is injected. Its current protected route constant is `host-selected-chat-generation`.

These are meaningful primitives. They do not by themselves prove that every production Core/Provider writer uses the exact same coordinator file, that a production Host route invokes this Gateway, or that the injected readers/transport are the approved production implementations.

### 10.2 Important provider-direction mismatch

The Gateway source comment currently restricts support to one explicitly allowlisted provider chat route. The allowlist string `host-selected-chat-generation` is not proof of a provider-neutral transport implementation.

The project has explicitly rejected the legacy provider-specific route as its target. Therefore:
- do not treat the current Gateway route/comment as an approved provider choice;
- do not adopt the uploaded legacy provider-specific SillyTavern patch or its environment-variable contract as the current integration design;
- retain the generic security semantics (server-owned route, no client override, no direct fallback, no secret leakage), but define a provider-neutral Host→PC Gateway transport contract;
- the exact provider adapter and supported route must be chosen separately and must not weaken the dispatch authorization envelope.

This is a source-level compatibility blocker for using the current Gateway as-is, not evidence that its shared-lock primitive is useless.

### 10.3 Current Gateway gaps against the target contract

1. **Runtime composition absent:** `src/index.js` constructs Core and Host version ledger but does not construct/wire `MemoryDispatchGateway`. No current-main ST route callsite was demonstrated.
2. **Injected authority functions:** `readCoreEvidence`, `readProviderEvidence` and `sendUpstream` are constructor dependencies. The source does not establish that production composition supplies authoritative implementations or that there are no alternate senders.
3. **Route/provider mismatch:** current source comment restricts the protected route to a provider-specific implementation that is not the selected project target.
4. **Shared coordinator configuration must be proven:** Core, Provider and Gateway must all use the same absolute coordinator DB path and same filesystem object, not merely a path string that happens to be similar. Deployment ACLs and process identity must prevent a participant from silently opening a different coordinator.
5. **Accepted-head scope:** Gateway checks the Core/Provider accepted-head authority before dispatch. The dispatch ledger itself is a separate durable database; its own restore/rollback protection and recovery semantics must be demonstrated. Do not assume Core/Provider accepted-head enrollment automatically protects a restored dispatch ledger.
6. **Transport ordering evidence:** the Gateway commits `DISPATCH_STARTED`, releases the coordinator and only then calls `sendUpstream`. This matches the declared durable dispatch-start ordering point only if the owners explicitly define that point as the transition to in-flight. It does not prove that bytes were handed to the network, and a crash in the gap must remain UNKNOWN/no-auto-retry. If owners require transport invocation itself to be inside the shared ordering window, the current implementation does not prove that stronger rule; the alternative must not await network I/O while holding the coordinator.
7. **Exact request binding:** current request signature/digest binds body digest, route, model, stream, world, actor, purpose, sources and candidates. The integrated envelope still needs authenticated Host session/generation, recipient, policy authority version/fingerprint and any selected lane-specific pins. No field may be added from an untrusted caller without a trusted owner resolution.
8. **No production provider credentials decision:** constructor accepts a transport callback; credential custody and outbound network restrictions are not established by this source alone.

### 10.4 Required focused tests (source-derived)

- **COORD-01:** Core, Provider and Gateway contend on the exact same coordinator DB and demonstrate deterministic serialization across processes.
- **COORD-02:** a participant configured with a different coordinator file is detected by deployment validation or fails closed; path equality alone is not accepted as proof of shared inode/ACL.
- **GW-01:** invalid/missing accepted-head state, pending operation, unenrolled Core/Provider or head mismatch → zero transport calls.
- **GW-02:** Core evidence reader or Provider evidence reader throws, returns a Promise, wrong scope, wrong head, non-ready inventory/grants or mismatched source/candidate set → zero transport calls.
- **GW-03:** durable `DISPATCH_STARTED` exists before `sendUpstream` is invoked.
- **GW-04:** crash/restart with `DISPATCH_STARTED` transitions to `UNKNOWN`; no automatic second send.
- **GW-05:** duplicate request ID and unresolved digest replay are denied; same identity with changed binding/payload conflicts.
- **GW-06:** every protected ST route invokes this exact Gateway; direct provider, extension, alternate backend and retry paths cannot carry protected payload.
- **GW-07:** provider-neutral adapter is used; no dependency on legacy provider-specific route/configuration remains.
- **GW-08:** restoring an older dispatch ledger cannot erase a prior request identity or permit a duplicate disclosure.
- **GW-09:** exact recipient, policy generation/fingerprint, Host session generation and lane-specific source pins are bound and revalidated.

### 10.5 Security 1.1 uploaded artifact disposition

The uploaded `Security 1.1.txt` describes a legacy provider-specific SillyTavern egress patch and environment variables. It is not a provider-neutral contract and conflicts with the current project direction. It is retained as historical evidence only and is **not** used as an implementation dependency.

The uploaded `Координатор 2.16.txt` is a diagnostic-package report describing a health-only ST/Core connectivity check and test counts on an archive without Git metadata. It does not prove trusted authorization, Memory reconciliation/revocation, shared dispatch ordering, or anti-rollback. It is not acceptance evidence for this workstream.

## 11. Revised immediate sequence

1. Finish the exact Core/Provider writer participation matrix, including restore/maintenance paths and whether each writer shares the same coordinator database object.
2. Inspect the Gateway's full current source and exact tests against the required dispatch ledger restore semantics; do not assume accepted-head state protects the dispatch ledger.
3. Design the provider-neutral route/transport contract without changing SillyTavern or provider configuration.
4. Resolve D0 with Core/Host/Memory owners and select the first lane.
5. Only then freeze implementation PR boundaries.

No runtime test, database operation, production-code edit, ST patch application, PR creation or merge was performed in this addendum.
