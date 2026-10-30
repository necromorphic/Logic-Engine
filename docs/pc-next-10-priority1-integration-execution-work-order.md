# PC-NEXT-10 — Priority 1 integration execution work order

**Status:** DRAFT EXECUTION SPECIFICATION — documentation only; no implementation or release approval.  
**Date:** 2026-10-30.  
**Repository:** `necromorphic/Logic-Engine`.  
**Current-main checkpoint used for this work order:** `d11211401957576545ca9099d41bffa3936aaef3`. Re-resolve `origin/main` before every implementation step; this SHA is a recorded checkpoint, not a permanent pin.  
**Parent documents:** PC-NEXT-07 Draft v3, PC-NEXT-08 implementation breakdown, PC-NEXT-09 Core/Provider/egress writer matrix.  
**Purpose:** convert the latest source/PR/deployment evidence into one ordered agent task that advances the actual Host → Core → Memory Provider → NPC → protected model egress integration. This is not a request to repeat completed test suites.

## 1. Target and non-negotiable status

Target chain:

`authenticated ST server session → complete Host source/version inventory → Core-owned conversation/world binding → Core-validated canonical actor → trusted Core authorization/acquisition → optional Memory evidence with provenance/grants → immutable exact-request context → one protected Host egress route → durable dispatch-start → one outbound transport`.

The chain is not currently proven end-to-end.

Keep these statuses until exact evidence and separate approval change them:

- Host: `NON_READY` unless complete inventory and authenticated binding are proven.
- Stage 2: `NO-GO`.
- Memory → NPC: `DISABLED / FAIL-CLOSED`.
- Production SillyTavern: `NO-GO` for protected NPC context.
- All new integration routes and candidate PRs remain Draft until their exact contracts, reviews and CI are accepted.

A primitive, passing unit test, health response, partial inventory, candidate PR or source review is not an end-to-end integration PASS.

## 2. Current evidence snapshot — revalidate before acting

The following states were read from GitHub during preparation of this work order. The agent MUST refresh them before relying on them; do not assume branches or PRs have stayed unchanged.

| Workstream | Recorded state | What it does NOT prove |
|---|---|---|
| Core reader PR #797 | OPEN / Draft; HEAD `077719d4992c1f3afa2e78cc9121b5344bd70be2`; PR base metadata still points to `40704c1...`; comparison against checkpoint `b1bf0393...` showed divergence (37 ahead / 2 behind) | Production trusted-authorizer composition, Host identity, serializer or Gateway wiring |
| Host inventory PR #800 | OPEN / Draft; HEAD `2ae9744bc0016295cc4399471a0b9c5e4c6fcc2e`; comparison against checkpoint showed divergence (29 ahead / 5 behind) | Atomic filesystem snapshot, complete history/deleted/branch/import/export/restore inventory, durable installation attestation |
| Host/Core reconciliation PR #793 | OPEN / Draft; HEAD `6974c999068e0827193717dffed1d3e446acca8b`; comparison against checkpoint showed divergence (11 ahead / 5 behind) | Complete Host inventory, Provider acceptance, production authorizer, final model dispatch; API change is still subject to second explicit Core approval under issue #264 |
| Earlier combined PR #799 | CLOSED | Do not treat it as an active merge candidate or assume its branch is the accepted integration stack |
| Earlier Host session-binding PR #783 | CLOSED | Do not treat its session binding as a merged/current production guarantee |
| Dispatch-start PR #777 | OPEN / Draft; HEAD `091950592f018f213703c9ecfbe97b18922b4b1e`; comparison showed divergence (2 ahead / 5 behind) | Production Host route, all-writer participation, provider-neutral transport or dispatch-ledger anti-rollback |
| SQLite VFS probe PR #798 | OPEN / Draft; HEAD `489952d5d36ac31c93ed9b09c329023d07858efb`; comparison showed divergence (82 ahead / 5 behind) | Secure handle acquisition; registration/delegation probe is not TOCTOU closure |
| Accepted-head/ACL PR #801 | OPEN / Draft; HEAD `a93e5ed0f3b200a6ec8f53b8264b1158a43412bf`; base checkpoint `d4f4a26...`; comparison against current checkpoint showed divergence (14 ahead / 4 behind) | Target-PC effective ACL, independent backup domain or authority self-restore resistance |
| Provider acceptance | Provider-local acceptance work is merged; prior exact Runtime evidence was recorded as 1160/1160 | Joint Host snapshot reconciliation, complete Host inventory or final disclosure ordering |
| Host source inventory | Prior pinned ST audit enumerated 13 early-return provider senders in `src/endpoints/backends/chat-completions.js`, including multiple callsites in one backend | A protected route that intercepts every actual sender in the deployed ST version |
| SQLite open security | Issue #770 remains open; PR #798 is only an extension-registration feasibility probe | Validation and retention of the exact OS object SQLite opens, including WAL/SHM/journal behavior |

Important: PC-NEXT-07/08/09 were authored against an earlier source baseline (`40704c1...`). Treat them as design/inventory documents, not as current PR status. Reconcile every source claim against the refreshed current main and exact candidate head before implementing.

## 3. Execution rules

1. Work only in `necromorphic/Logic-Engine` and explicitly named isolated Host/PC fixtures. Do not modify the user's production ST installation, production Core process, live databases, chats, vector stores or runtime configuration.
2. Do not merge PRs, mark Draft PRs ready, close PRs, force-push, rewrite shared branches or change issue decisions.
3. Do not replace any deny-only callback (including `verifyInventorySnapshot: async () => false`) with an unconditional allow or a permissive mock.
4. No caller/body/prompt/model-supplied identity, policy, purpose, recipient, world, actor, conversation, session, generation, source or version field may become trusted.
5. Implement within the binding cross-block contract approved by merged ADR #809. The second Core approval required by issue #264 is satisfied for that contract. Any deviation or new cross-block API/schema/authority requires a new explicit decision; exact implementation diffs still require review, CI and release gates.
6. Do not select or hardcode a model vendor. Gateway/transport contract must be provider-neutral.
7. Do not change, benchmark, re-index, reconfigure or retest existing vectorization, embeddings, VectorService, Ollama, Vectra or remote vector storage. These are explicitly out of scope.
8. Do not repeat already accepted Core proposal/commit, Provider acceptance, Process Manager, D4/D5 lifecycle, Direction A delete, vectorization or full `npm test` suites merely to produce another green number. Run only tests directly affected by a changed candidate; use exact-head CI for that candidate.
9. No live model request and no real user chat content. Egress tests use a local recording transport with synthetic payloads.
10. If a required runtime path does not exist, report `BLOCKED / ABSENT`; do not create a mock path and label it integrated.

## 4. Ordered work packages

### WP-10.0 — Refresh source of truth

Before code changes:

- Fetch current `main` SHA, all PR states/heads/bases for #797, #800, #793, #777, #798, #801 and issue #770/#264/#356.
- Record exact comparison results against current `main`; distinguish `ahead`, `behind`, `diverged`, closed and merged.
- Inspect each candidate's full diff and changed-file list. Do not infer content from PR title or previous report.
- Re-run no tests at this stage.
- Produce a dependency graph showing which candidate can be safely rebased/ported, which is obsolete/closed, and which needs an owner decision.
- Preserve all existing branches and local dirty state; do not reset user worktrees.

**Acceptance:** a fresh exact-head matrix with source links, SHA, base, PR state, changed files and unresolved dependency for each candidate.

### WP-10.1 — Core trusted-authorizer composition

**Owner:** Core.

Inspect current `src/index.js`, `src/api/server.js`, `src/application/authorized-read-service.js`, actor binding and Host conversation binding services, plus PR #797.

Implement only on a new isolated Draft branch after confirming the contract:

- one server-side composition-root factory is the sole creator of trusted read/visibility/policy authorizers;
- callbacks are injected from trusted deployment composition, never from HTTP request, Host body, prompt, Memory record or model output;
- adapter identity is derived from configured credentials; conversation → world comes from Core-owned binding; Host-resolved actor is validated by Core against the exact active binding;
- first slice keeps `NPC subject = canonical actor`; no caller-controlled `npc_id`;
- missing, throwing, stale, ambiguous or unavailable authorizer returns `NON_READY/DENY`;
- no fallback to `() => true`, no implicit allow, no default broad field policy;
- exact purpose and recipient are fixed by the trusted operation and included in the immutable context;
- policy authority fields (`authority_id`, monotonic `generation`, canonical policy digest/fingerprint) remain unimplemented until Core approves their schema and invalidation semantics;
- pre-read and post-read checks bind the same actor, world, purpose, recipient and Core snapshot cursor;
- read authorization is not write authorization; state mutation still requires a separate Core write/effect authorization at commit.

Required focused tests (only after the implementation exists):
- missing factory/dependency, factory throw, authorizer throw/timeout → zero protected values returned;
- attempt to inject/replace authorizer from request/body/prompt → rejected or ignored before trusted resolution;
- adapter/world/actor/conversation/session/NPC identity substitution → DENY; only server-resolved values used;
- purpose mismatch and recipient mismatch → DENY;
- stale binding, actor destroyed/revoked, cross-world actor → DENY;
- field denied and partial-result path → generic external denial with no existence oracle;
- pre/post read snapshot or policy-generation mismatch → DENY;
- read permission cannot authorize a write.

**Do not claim versioned policy authority is complete** until the approved durable authority and generation writer are implemented and tested.

### WP-10.2 — Host authenticated session and complete inventory

**Owner:** Host; Core validates references.

Reconcile PR #800 and the closed #783/#799 work without treating either closed PR as accepted production code.

Required behavior:

- session identity is generated and authenticated by the ST server, not accepted from a browser request field;
- session generation and stable conversation identity are bound to the dispatch attempt;
- actor selection comes from authenticated server-side Host state; Core validates the exact actor binding;
- persisted message/version identity survives restart and is stable across edits, swipe/regeneration, delete, import/export, branch/copy, chat/group changes and restore;
- scanner must detect incomplete or ambiguous inventory and return `INCOMPLETE/NON_READY`, never silently downgrade to a partial complete snapshot;
- distinguish pathname double-scan from atomic snapshot; do not claim atomicity without filesystem-level proof;
- explicitly enumerate pre-enrollment history and deleted/restored versions. If they cannot be recovered, mark the history unknown and keep enrollment REVIEW_ONLY;
- no raw message text is added to Provider or Core storage by this work package.

Required focused tests:
- same conversation/message identity after restart;
- duplicate/missing IDs, partial persisted data and scan mutation during inventory;
- chat switch, rename, branch/copy, import/export, whole-chat/group deletion and restore;
- stale or replaced session, replayed generation and caller-supplied identity;
- incomplete scan/verifier absent/false/throws → NON_READY with no Provider readiness publication.

**Acceptance:** a bounded, explicit inventory contract plus proof of every supported mutation path. If atomicity or historical completeness is absent, document the exact limit and retain NON_READY.

### WP-10.3 — Host → Core reconciliation → Memory Provider

**Owners:** Host + Memory Provider + Core.

Reconcile PR #793 with the Host inventory candidate only after WP-10.2 has a defined completeness result.

- Core-owned Host ledger remains the authority for enrolled conversation/world binding and accepted inventory digest.
- Host must authenticate before reconciliation; caller-supplied `adapter_id`, world, actor, conversation or completion claims are not authority.
- Core reconciliation route must require `complete === true` and reject before verifier invocation or ledger mutation for false/missing/incomplete snapshots.
- A real deployment-owned verifier must attest the exact Host inventory. Until that verifier exists and is approved, the deny-only verifier remains unchanged and the route cannot publish READY.
- Provider readiness requires the complete accepted Host snapshot, matching source/version digest and current grants/lineage; Provider cannot manufacture Host completeness from its own record set.
- Reconciliation must be idempotent without treating idempotence as completeness proof.
- Revocation/rebind must invalidate subsequent reads and protected egress; preserve the known distinction between fail-closed boundary checks and linearizable revocation.

Required focused tests:
- `complete: false`, missing, malformed, stale, partial or verifier-throwing snapshot → no verifier bypass, no ledger mutation, no READY publication;
- authenticated session missing/replaced/revoked → DENY;
- repeated identical complete snapshot → idempotent;
- changed source set, omitted/deleted version, stale digest, rebind or revoke → NON_READY;
- Provider grants/readiness/lineage change after retrieval → final revalidation denies.

**Approval/evidence gate:** ADR #809 approves the bounded reconciliation contract and implementation authority. Keep the candidate Draft until its exact implementation diff, verifier behavior, exact-head CI, and pinned Host evidence are reviewed and accepted. ADR approval does not merge the PR or permit READY/production use.

### WP-10.4 — Shared serialization and dispatch-start

**Owners:** Security + Core + Memory + Host jointly.

Use PC-NEXT-09 as a starting inventory, not a completeness certificate. Reconcile PR #777 against current main and enumerate all relevant writers:

- Core canonical entity/source, actor binding, conversation binding, policy/authority, rollback, migration, rebuild and restore writers;
- Provider query/record grants, revocation, record/source lineage, readiness, reconciliation, tombstone, purge, rebuild and restore writers;
- Host inventory/session invalidation writers;
- dispatch-ledger creation, state transition and recovery writers.

A shared SQLite coordinator using `BEGIN IMMEDIATE` is only a cooperative primitive. Prove that every relevant process opens the same actual file object, uses compatible permissions and participates in the same order. A matching path string is insufficient.

Option B and the bounded in-flight semantics are already approved by merged ADR #809 and issue #356. Do not reopen the policy decision. Implement and prove the approved mechanics:
- durable `DISPATCH_STARTED` is the linearization point;
- invoke the actual transport-start callback synchronously while holding the shared Coordinator lease;
- release the lease before awaiting the response/stream;
- define and test every participating mutation and invalidation writer;
- preserve UNKNOWN/no-auto-retry behavior for crash or ambiguous acknowledgement;
- prove dispatch-ledger anti-rollback and partial-restore behavior.

The Gateway must:
- revalidate current Core policy/source and Provider grants/readiness under the approved order;
- bind exact payload bytes or a canonical integrity-protected manifest, request ID, nonce, session generation, world, actor, purpose, recipient, policy version, source pins, route, model and stream mode;
- durably record the one-time dispatch identity before handoff;
- reject duplicate/replayed request IDs and conflicting reuse;
- be the sole transport for protected payloads; no direct route, retry or fallback may bypass it.

Do not await the network response/stream while holding the SQLite coordinator lease. The synchronous actual transport-start callback must run under the lease immediately after durable dispatch-start; release the lease before awaiting the returned Promise.

Required focused tests:
- cross-process barrier race: revocation/source invalidation/readiness loss wins before dispatch-start → zero outbound calls;
- dispatch-start wins first → durable in-flight/unknown semantics; later revocation does not claim to recall already handed-off bytes;
- writer configured to another coordinator file → startup/deployment validation fails closed;
- any enumerated writer bypass → release blocked;
- crash before start → zero calls; crash after start/before handoff → UNKNOWN/no retry;
- lost acknowledgement and duplicate request ID → no second call;
- restoring an older dispatch ledger cannot erase a previously started identity.

**Do not mark this complete** while any relevant writer, process, restore path or alternate egress route remains unenumerated.

### WP-10.5 — Provider-neutral SillyTavern protected egress

**Owner:** Host; Security reviews.

Use the pinned SillyTavern source audit as a starting point. Revalidate the exact deployed ST commit and all 13 previously identified early-return senders; do not assume one generic route or fetch wrapper covers them.

- Define a provider-neutral internal transport contract. The chosen provider is a separate owner decision and is not hardcoded in this spec.
- Identify every path that can send a protected NPC payload: all provider senders, early returns, extensions, alternate backends, retries and streaming variants.
- Route protected payloads through one server-owned Gateway; reject protected payloads on all other paths.
- Ordinary non-protected ST generation must remain unchanged.
- Gateway URL, credentials and route selection are server-side only; client request/config cannot override them.
- Gateway rejection/outage must fail closed; no direct provider fallback.
- No protected body, token or private context in logs.
- Preserve existing vectorization and remote vector-store behavior unchanged.

Required focused tests:
- each enumerated protected sender reaches the same Gateway exactly once;
- each unsupported sender/extension/backend produces zero outbound calls for protected payloads;
- Gateway outage, timeout, malformed envelope or route/model/stream/body mismatch → zero fallback calls;
- ordinary non-protected generation regression test only for the touched route(s);
- no vectorization setting, index, embedding or query path changes.

### WP-10.6 — SQLite open identity and accepted-head restore boundary

**Owners:** Security + Core + Operations.

- Treat PR #798 as an extension-registration feasibility probe only. It is not secure-open and does not close Issue #770.
- Do not accept pathname re-stat, BigInt `stat`, or a VFS wrapper that delegates `xOpen` then stats the path as TOCTOU closure.
- Continue only with a native/open-handle design that validates and retains the actual OS handle SQLite opened, including Windows and Linux behavior and WAL/SHM/journal sidecars.
- Cover every registered database role: Core, Coordinator, Host ledger, Provider, dispatch ledger, accepted-head authority and enrollment/recovery storage.
- Reconcile PR #801's candidate ACL/accepted-head changes against the current contract; disposable CI/fixture success is not target-PC effective ACL or backup-domain proof.
- Restore of any one store without matching authority/coordinator state must leave all protected reads and egress NON_READY.
- Authority must not be able to silently restore itself to an older accepted state.

Required evidence:
- exact handle identity before/after open and adversarial path replacement/symlink/reparse/hard-link cases;
- sidecar identity and access tests;
- process identity/effective ACL inventory on the target PC;
- stale/partial restore tests for each durable store;
- zero protected egress until all stores reconcile.

Do not change live ACLs, create service users or restore production databases without separate approval.

### WP-10.7 — Integrated acceptance and PC validation

Run only after the real candidate path exists in an isolated disposable deployment.

Required evidence:
- exact Core, Host, Provider and Gateway commit SHAs;
- exact Node version, process identities, paths and non-secret config fingerprint;
- exact test command, focused output and exact-head CI links;
- actual cross-process coordinator identity and writer participation;
- complete bounded Host inventory result and Core/Provider reconciliation state;
- deterministic barrier race with outbound call count;
- durable dispatch ledger before/after and crash/restart/restore outcomes;
- route coverage for every protected ST sender;
- no raw private content or credentials in logs;
- proof production ST/Core/DB/vectorization were not touched.

Do not repeat the already completed test families listed in §3. A missing runtime path is `BLOCKED`, not a reason to fabricate a mock integration.

## 5. Required final report format

| ID | Evidence class | Exact SHA / environment | Command or action | Result | Status | Remaining blocker |
|---|---|---|---|---|---|---|
| WP-10.0…10.7 | SOURCE / CI / PC-READONLY / PC-FIXTURE / PC-RUNTIME / BLOCKED | exact | exact | observed | PASS / PARTIAL / BLOCKED / NOT TESTED | specific |

The report must separately state:
- what changed in Git (branch, commit, paths);
- PR states and exact-head CI status;
- what was only inspected;
- which tests were run and which were deliberately not repeated;
- whether any live process, production DB, ST installation, ACL, provider config or vectorization was changed;
- exact reason each remaining gate is blocked;
- next dependency in execution order.

Never report overall integration PASS while any required work package is absent or only mocked/source-verified.

## 6. Explicit non-goals

- No production activation or Memory → NPC enablement.
- No real user conversation/model request.
- No vectorization, embeddings, VectorService, Ollama, Vectra or remote vector-store work.
- No repeat of completed lifecycle, Provider acceptance, Process Manager or broad Core test suites without a code-specific reason.
- No provider-vendor selection in this specification.
- No production ACL, service identity, firewall, backup/restore or database changes.
- No PR merge or release decision.

## 7. Change log

- **v1 (2026-10-30):** consolidated current Priority-1 integration blockers into ordered work packages; reconciles PC-NEXT-07/08/09 design with the latest recorded candidate PR states; keeps production and vectorization untouched.

## Normative trusted-authorization specification

The finalized contract and acceptance matrix are in [PC-NEXT-11 — Trusted authorization and protected egress specification](./pc-next-11-trusted-authorization-final-specification.md). PC-NEXT-11 supersedes PC-NEXT-07 Draft v3 for normative trusted-authorization semantics. This work order remains the execution sequence; it does not override the implementation-evidence and conjunctive release gates in PC-NEXT-11 or ADR #809 §9.
