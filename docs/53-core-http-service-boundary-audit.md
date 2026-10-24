# Core HTTP and in-process trust-boundary audit

Status: **audit of `main` at `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`; findings are not runtime fixes**.

This audit follows the authorized-read slice and trusted-mutation-origin contract. It records concrete route-level trust gaps and separates verified implementation facts from policy decisions. It does not authorize a merge, define a new credential model, or claim that the open PRs are integrated.

Related:
- `docs/27-proposal-to-commit-boundary.md`
- `docs/28-proposal-api-stage1.md`
- `docs/50-core-trusted-mutation-origin-contract.md`
- `docs/52-core-authorized-read-runtime-slice.md` (candidate implementation in PR #65; not merged)
- `docs/54-core-proposal-execution-authority-contract.md` (schema-neutral execution-authority proposal; pending Core owner review)
- `docs/55-core-context-manifest-trust-contract.md` (schema-neutral trusted producer/generation binding proposal; current route remains untrusted)
- PR #66, canonical rollback admin boundary (not merged)

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

**Required closure:** protect raw routes with a distinct trusted internal/admin capability; route model/player/adapter reads through a fail-closed authorized-read service. PR #65 proposes the HTTP protection and a deliberately self-only authorized-read endpoint. It remains unmerged and does not audit external host serializers.

### F-02 — Canonical rollback is not uniformly privileged

**Observed route:** `POST /v1/worlds/:world_id/rollback`.

On the audited revision, the route calls `engine.rollbackEvent` after only the general bearer check, except that the current code has a narrow admin check for roots whose effects contain `mechanic.instance.*`. That condition does not make ordinary entity/fact rollback privileged, even though rollback changes the canonical valid-history projection.

**Required closure:** require separate admin/correction authority for every HTTP rollback, independent of root event type. PR #66 proposes this and includes a normal-entity regression test. It remains unmerged. Direct in-process `engine.rollbackEvent` is still a trusted API and needs caller auditing.

### F-03 — Proposal payload reads are not owner-scoped on main

**Observed route:** `GET /v1/worlds/:world_id/proposals/:proposal_id`.

On the audited revision, the route returns `proposals.get(worldId, proposalId)` without checking the creating adapter or an admin override. Proposal source text, event payload, and validation metadata may therefore cross adapter boundaries when a caller knows or obtains another proposal ID.

**Required closure:** return the same external not-found response for a missing proposal and a proposal owned by another adapter; allow only the creating adapter or an explicitly privileged reader. PR #65 proposes adapter scoping and tests. It remains unmerged.

### F-04 — Proposal commit is not requester-scoped

**Observed route:** `POST /v1/worlds/:world_id/proposals/:proposal_id/commit`.

The route uses the general bearer check and calls `proposals.commit` without checking that the requester is the creating adapter or has a distinct trusted execution capability. The proposal service checks lifecycle/staleness and requires the proposal to be approved, so this is not an approval bypass. It is nevertheless a cross-adapter execution/availability boundary: any API-token holder who knows an approved proposal ID may trigger its commit.

**Required closure:** explicitly decide and enforce the commit actor policy. The minimal safe choices are (a) require the creating adapter identity for adapter-facing commits, with a separate internal execution route for trusted orchestration, or (b) require a dedicated execution capability whose intended sharing and scope are documented. Do not silently infer this authority from the general bearer. Add tests for another adapter attempting to commit an approved proposal, the owning adapter retrying idempotently, and the trusted internal execution path. PR #65's proposal-read scoping alone does not close this finding.

### F-05 — Context-manifest registration is not separated from the general API credential

**Observed route:** `POST /v1/worlds/:world_id/context-manifests`.

On the audited revision, any holder of the general bearer can register a context manifest. The request is structurally validated and hashed, but the route does not require adapter identity, a trusted host/internal credential, or a server-side generation binding. A context manifest describes what context was made available to a model; it is not proof of what the model used, and it must not be treated as trustworthy provenance merely because it was stored.

**Required closure:** define the trusted producer and generation binding for manifests. The route/service must derive producer authority server-side and verify the manifest's world, generation, base revision/commit sequence, and ownership against a trusted host-side generation record. Until that generation record exists, fail closed or restrict registration to a dedicated internal capability. Do not accept a caller-supplied origin/producer label as proof. Add tests for wrong-world, stale-cursor, foreign-generation, duplicate, and untrusted-caller attempts.

### F-07 — Raw state read is not the canonical consistent-snapshot API

**Observed path:** `GET /v1/worlds/:world_id/state` → `LogicEngine.getState` → `SQLiteStore.state`.

The audited `SQLiteStore.state` reads the world row, entity projection, and fact projection through separate SELECT statements without opening the read transaction used by `SQLiteStore.readSnapshot`. The returned object also does not carry the snapshot's `commit_sequence` marker. By contrast, `readSnapshot` explicitly reads the world revision, commit cursor, selected projections, manifests, and optional mechanic evaluation state inside one SQLite read transaction and refuses to run inside a write transaction.

**Risk:** the raw state endpoint is already a trusted-only boundary candidate under PR #65, but trust gating does not by itself make its payload a revision-bound atomic snapshot. If another database connection can write concurrently, a multi-query `state` response has no explicit guarantee that every table reflects the same SQLite snapshot. Consumers also cannot bind the payload to a commit cursor from the response alone.

**Required closure:** do not use `getState` as the consistency contract for model-facing or workflow reads. Use `getSnapshot` with bounded selectors and retain `world_revision` plus `commit_sequence`. For trusted operational state endpoints, either migrate the implementation to the same explicit read-transaction semantics or document and test the narrower guarantee. This is separate from authorization and must not be considered closed by PR #65's raw-route credential guard alone.

**Acceptance tests:** concurrent writer/read snapshot test; verify a returned snapshot's rows, world revision, and commit cursor share one SQLite read transaction; verify authorized consumers carry the cursor forward and reject stale use at commit.

### F-06 — World creation and registry reads need explicit capability classification

**Observed routes:** `POST /v1/worlds`, `GET /v1/mechanics/audit`, list/detail reads for mechanic templates and rule-module manifests.

These routes use the general bearer. World creation is a canonical administrative operation; registry metadata may reveal implementation/configuration details. The current code does not express distinct capabilities for these operations.

This is a **policy decision to close**, not a claim that every such route is necessarily exploitable. Define which operations are available to a deployment API client, which require admin/internal access, and whether registry metadata is considered public to all authenticated adapters. Enforce the chosen policy consistently and test it. Do not broaden admin permission to unrelated mutation classes by default.

## 3. In-process APIs and serializers

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

This audit does not introduce credentials, roles, endpoints, schemas, database columns, or runtime changes. It does not decide who is allowed to author/correct canon; that remains governed by the open trusted-mutation-origin decisions. It does not make PR #65 or #66 part of `main`, and it does not authorize merging any PR.
