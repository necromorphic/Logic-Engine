# Core HTTP and in-process trust-boundary audit

Status: **historical source audit of `main` at `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`, with current-main disposition appended below**.

This audit follows the authorized-read slice and trusted-mutation-origin contract. It records concrete route-level trust gaps and separates verified implementation facts from policy decisions. It does not authorize a merge, define a new credential model, or claim that the open PRs are integrated.

Related:
- `docs/27-proposal-to-commit-boundary.md`
- `docs/28-proposal-api-stage1.md`
- `docs/50-core-trusted-mutation-origin-contract.md`
- `docs/52-core-authorized-read-runtime-slice.md` (PR #65 merged; default read remains self-identity-only)
- `docs/54-core-proposal-execution-authority-contract.md` (contract and current implementation status; PR #103 enforces the first-slice policy)
- `docs/55-core-context-manifest-trust-contract.md` (schema-neutral trusted producer/generation binding proposal; current route remains untrusted)
- PR #66 was closed unmerged; PR #83 now enforces the canonical rollback admin boundary

## 1. Authentication model observed

`src/api/server.js` applies the general bearer token to every route except `GET /health`. This establishes possession of the shared API credential, not a distinct capability for every operation. Adapter identity is separately derived from the configured `x-adapter-id` / `x-adapter-token` pair. Internal, approval, and admin credentials exist as separate gates for some routes.

Do not treat these identities as interchangeable:
- API bearer: access to the API surface, not by itself an actor, author, or reviewer identity.
- Adapter identity: identifies the integration submitting a request; does not prove semantic authority.
- Approval credential: a shared gate, not a named approver.
- Internal/admin credentials: privileged service capabilities; should not be passed to models.

## 2. Findings on the audited main revision

### F-01 — Raw canonical reads share only the general API gate

**Observed routes:** `GET /v1/worlds/:world_id/state`, `GET /v1/worlds/:world_id/events`, `GET /v1/worlds/:world_id/audit`.

On the audited revision, these return canonical world state, event history, or audit after only the general bearer check. They do not require an internal/admin credential or actor-specific authorized read. This is a direct bypass of any future NPC/player/narrator visibility policy if the API token reaches an untrusted consumer.

**Required closure:** protect raw routes with a distinct trusted internal/admin capability; route model/player/adapter reads through a fail-closed authorized-read service. PR #65 merged the HTTP protection and deliberately self-only authorized-read endpoint; PR #101 adds an opt-in trusted host policy seam but does not audit external host serializers.

### F-02 — Canonical rollback is not uniformly privileged

**Observed route:** `POST /v1/worlds/:world_id/rollback`.

On the audited revision, the route calls `engine.rollbackEvent` after only the general bearer check, except that the current code has a narrow admin check for roots whose effects contain `mechanic.instance.*`. That condition does not make ordinary entity/fact rollback privileged, even though rollback changes the canonical valid-history projection.

**Historical finding, closed by PR #83:** every HTTP rollback now requires separate admin/correction authority regardless of root event type. PR #66 was closed unmerged as superseded. Direct in-process `engine.rollbackEvent` remains a trusted API and still needs caller auditing.

### F-03 — Proposal payload reads are not owner-scoped on main

**Observed route:** `GET /v1/worlds/:world_id/proposals/:proposal_id`.

On the audited revision, the route returns `proposals.get(worldId, proposalId)` without checking the creating adapter or an admin override. Proposal source text, event payload, and validation metadata may therefore cross adapter boundaries when a caller knows or obtains another proposal ID.

**Required closure:** return the same external not-found response for a missing proposal and a proposal owned by another adapter; allow only the creating adapter or an explicitly privileged reader. PR #65 merged adapter-scoped proposal reads. PR #103 now binds public proposal commit to the creating adapter; internal execution remains separately capability-gated.

### F-04 — Proposal commit is not requester-scoped

**Observed route:** `POST /v1/worlds/:world_id/proposals/:proposal_id/commit`.

The route uses the general bearer check and calls `proposals.commit` without checking that the requester is the creating adapter or has a distinct trusted execution capability. The proposal service checks lifecycle/staleness and requires the proposal to be approved, so this is not an approval bypass. It is nevertheless a cross-adapter execution/availability boundary: any API-token holder who knows an approved proposal ID may trigger its commit.

**Required closure:** explicitly decide and enforce the commit actor policy. The minimal safe choices are (a) require the creating adapter identity for adapter-facing commits, with a separate internal execution route for trusted orchestration, or (b) require a dedicated execution capability whose intended sharing and scope are documented. Do not silently infer this authority from the general bearer. Add tests for another adapter attempting to commit an approved proposal, the owning adapter retrying idempotently, and the trusted internal execution path. PR #65's proposal-read scoping alone does not close this finding.

### F-05 — Context-manifest registration is not separated from the general API credential

**Observed route:** `POST /v1/worlds/:world_id/context-manifests`.

On the audited revision, any holder of the general bearer can register a context manifest. The request is structurally validated and hashed, but the route does not require adapter identity, a trusted host/internal credential, or a server-side generation binding. A context manifest describes what context was made available to a model; it is not proof of what the model used, and it must not be treated as trustworthy provenance merely because it was stored.

**Required closure:** define the trusted producer and generation binding for manifests. The route/service must derive producer authority server-side and verify the manifest's world, generation, base revision/commit sequence, and ownership against a trusted host-side generation record. Until that generation record exists, fail closed or restrict registration to a dedicated internal capability. Do not accept a caller-supplied origin/producer label as proof. Add tests for wrong-world, stale-cursor, foreign-generation, duplicate, and untrusted-caller attempts.

**Current-main disposition:** PR #106 now requires the separately configured internal-host credential for registration. This closes the general-bearer route gate only; the trusted host-side generation record and server-derived binding described above remain unimplemented. The stored manifest is not proof that a trusted generation used it.

### F-07 — Raw state read is not the canonical consistent-snapshot API

**Observed path:** `GET /v1/worlds/:world_id/state` → `LogicEngine.getState` → `SQLiteStore.state`.

The audited `SQLiteStore.state` reads the world row, entity projection, and fact projection through separate SELECT statements without opening the read transaction used by `SQLiteStore.readSnapshot`. The returned object also does not carry the snapshot's `commit_sequence` marker. By contrast, `readSnapshot` explicitly reads the world revision, commit cursor, selected projections, manifests, and optional mechanic evaluation state inside one SQLite read transaction and refuses to run inside a write transaction.

**Risk:** the raw state endpoint is already a trusted-only boundary candidate under PR #65, but trust gating does not by itself make its payload a revision-bound atomic snapshot. If another database connection can write concurrently, a multi-query `state` response has no explicit guarantee that every table reflects the same SQLite snapshot. Consumers also cannot bind the payload to a commit cursor from the response alone.

**Required closure:** do not use `getState` as the consistency contract for model-facing or workflow reads. Use `getSnapshot` with bounded selectors and retain `world_revision` plus `commit_sequence`. For trusted operational state endpoints, either migrate the implementation to the same explicit read-transaction semantics or document and test the narrower guarantee. This is separate from authorization and must not be considered closed by PR #65's raw-route credential guard alone.

**Acceptance tests:** concurrent writer/read snapshot test; verify a returned snapshot's rows, world revision, and commit cursor share one SQLite read transaction; verify authorized consumers carry the cursor forward and reject stale use at commit.

**Current-main disposition:** PR #114 closes the `SQLiteStore.state()` consistency defect for the trusted operational state response: it now reads the world/entity/fact projection in one SQLite read transaction and returns `commit_sequence` with `world_revision`. The route remains privileged-only and this change does not grant model-facing authorization. Bounded actor-authorized reads remain a separate policy boundary.

### F-06 — World creation and registry reads need explicit capability classification

**Observed routes:** `POST /v1/worlds`, `GET /v1/mechanics/audit`, list/detail reads for mechanic templates and rule-module manifests.

These routes use the general bearer. World creation is a canonical administrative operation; registry metadata may reveal implementation/configuration details. The current code does not express distinct capabilities for these operations.

This is a **policy decision to close**, not a claim that every such route is necessarily exploitable. Define which operations are available to a deployment API client, which require admin/internal access, and whether registry metadata is considered public to all authenticated adapters. Enforce the chosen policy consistently and test it. Do not broaden admin permission to unrelated mutation classes by default.

**Decision artifact:** `docs/56-core-api-capability-matrix-proposal.md` (PR #115) records the current gates, recommended dispositions, and the explicit deployment-owner decisions. The unresolved routes remain unchanged until those decisions are approved.

## 3. In-process APIs and serializers

### Repository source inventory (audited `main`)

The `src/` tree contains the HTTP server, engine, proposal service, actor-binding service, character-card projector, core validators, and SQLite store. It does not contain a separate production SillyTavern/host adapter or another model-context serializer in this revision. The concrete external serialization boundary found in this repository is therefore `src/api/server.js`; this is not evidence that an out-of-repository host integration is safe.

The route inventory additionally confirms:
- `GET /v1/mechanics/audit` returns mechanic registry audit through the general API bearer;
- mechanic template and rule-module list/detail routes return registry metadata through the general API bearer, while their writes require admin authority;
- `GET .../state` uses `getState`, not the revision-bound `getSnapshot` path;
- the character-card projector is a pure projection helper and is not called as an authorization layer by the audited API server.

These are source-level observations, not claims that a model has already received the data. Actual exposure depends on which credentials and endpoints a deployment gives to each consumer.


`LogicEngine.getSnapshot`, `getState`, `getEvents`, `getAudit`, and `rollbackEvent` do not authenticate callers themselves. That is appropriate for a core library only if they are treated as trusted in-process interfaces and every boundary that exposes their output is audited. `character-card-projection.js` is a pure projector over a supplied snapshot, not an authorization layer.

The repository's API route is one such boundary; it is not proof about consumers outside this repository. Before enabling NPC, narrator, player, or adapter integrations, inventory each production caller/serializer and record:
1. which principal and recipient it serves;
2. which world and snapshot cursor the output is bound to;
3. which trusted policy authorizes each field/target;
4. whether missing/withheld data is disclosed differently;
5. whether rollback/concurrent commits can make the output stale;
6. whether any raw event, audit, attribute, proposal, or mechanic state escapes the authorized boundary.

Do not claim the authorized-read system complete until this inventory and its end-to-end tests exist.

## 4. Ordered closure plan

1. Reconcile and validate PR #65 on its final head; it closes F-01 and F-03 at the HTTP layer and supplies the narrow first authorized-read route.
2. Rebase/reconcile PR #66 after the authorized-read change; validate F-02 without assuming the two server patches combine cleanly.
3. Resolve the policy gate in `docs/54-core-proposal-execution-authority-contract.md`; if approved, implement and test F-04 proposal commit actor policy. This is not closed by read scoping.
4. Resolve the trust-chain gates in `docs/55-core-context-manifest-trust-contract.md`; implement and test trusted context-manifest producer/generation binding, or explicitly keep the route internal-only until the generation registry exists.
5. Resolve F-06 as a deployment capability policy; avoid unnecessary privilege expansion.
6. Close F-07 by making state-read consistency explicit; raw-route authentication alone does not make a multi-query response an atomic snapshot.
7. Audit all external host serializers and direct in-process callers before declaring authorized reads or causal rollback safe for NPC integration.
8. Run tests against exact final heads. A green run on an earlier commit is not validation of later changes.

## 5. Non-goals and constraints

This audit was originally documentation-only and did not introduce runtime changes. The current-main disposition below records subsequent fixes; trusted import/author correction and context-manifest producer binding remain unresolved.


## Current-main disposition (2026-10-24)

- **Closed by PR #65:** raw HTTP state/events/audit require a distinct internal/admin credential; proposal reads are creator-scoped; the authorized-read service exists, with self-identity-only API default.
- **Extended by PR #101:** a host may inject a trusted `authorizedReadFieldPolicy` and request bounded target IDs. The policy is never request/model input; without one, other targets remain unavailable. No visibility schema or Memory/NPC policy is configured.
- **Closed by PR #83:** every HTTP canonical rollback requires the separate admin credential.
- **Closed by PR #103:** public proposal commit requires authenticated adapter identity matching the stored proposal creator; a different adapter gets non-enumerating `PROPOSAL_NOT_FOUND`; trusted orchestration uses the separate internal-token route.
- **Implemented by PRs #94–#96:** admin-only typed Relationship write/projection/replay, transaction failure tests, source dependency rollback and fail-closed unsupported metadata.
- **Still open:** trusted initial import/author correction; context-manifest registration producer/generation binding; general visibility policy and direct in-process serializer inventory; Memory source-change/reconciliation; any NPC/model-facing Relationship write authority. The historical source audit below is not a statement that the fixed findings remain open.

## Combined regression evidence (2026-10-24)

PR #119 adds a real API test that exercises internal-only context-manifest registration and creator-bound proposal commit in the same flow. It proves a general adapter cannot register a manifest, a different adapter cannot commit an approved proposal, the denied commit leaves world revision unchanged, and the creator can commit through the canonical lifecycle. Exact-head Runtime CI passed on `64504a93c17f776cb8404a4d6c9c8a8a3650622a` ([run #804](https://github.com/necromorphic/Logic-Engine/actions/runs/40066216679)). This does not close context generation binding or general Memory/NPC visibility policy.