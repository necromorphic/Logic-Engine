# Coordinator proposal: Memory → NPC final-disclosure and dispatch boundary

**Status:** coordinator proposal for Core, Memory Provider, Host/Adapter, and Product/Security review. Documentation only. This file does not approve a runtime API/schema, authorize production disclosure, or claim the required serialization exists.

**Current disposition:** production Memory → NPC remains **DISABLED / FAIL-CLOSED**.

**Pinned first experiment:** SillyTavern upstream commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127, server-side Chat Completions only. All other routes remain unsupported until separately verified.

## 1. Problem statement

The present block is a cross-owner contract gap, not a failure that Provider-local tests can solve alone:

- **Host/Adapter** observes the real source lifecycle and owns the outbound dispatch path. The pinned SillyTavern source audit identifies mutable message indexes/swipe positions and multiple independent outbound routes; no route is currently proven to enforce a Core-approved disclosure decision.
- **Memory Provider** owns its persisted records, derived index readiness, Provider grants, record lineage checks, tombstones and reconciliation. These are Provider-local guarantees; they do not establish that Host supplied an authentic, complete, current source inventory.
- **Core** owns canonical source authority, canonical revision/rollback truth, trusted actor binding, and the policy decision to disclose. Existing authorized field reads are not automatically a subject-relative model-disclosure decision or a transaction enclosing a later network send.
- **Product/Security** owns the policy choice for in-flight requests when revocation races with dispatch.

A browser hook, prompt assembly event, Provider current flag, successful retrieval, context inclusion, or a best-effort check immediately before fetch is not by itself an end-to-end authorization guarantee.

## 2. Bounded first slice

1. One pinned server-side Chat Completions dispatch path, at the last server-side point where the assembled outbound request is available before provider egress.
2. Direct canonical-entity source records only, and only if Core identifies an existing authoritative operation that can prove source identity, current version, validity/retraction and rollback state.
3. No raw Host chat text, no multi-source derived summaries, and no assumption that a Provider index is a complete source inventory.
4. No claims about Text Completions, Kobold, Azure, NovelAI, Horde, OpenRouter, extensions, browser direct egress, or other routes.
5. The experiment runs on a disposable pinned checkout/profile with a recording fake provider. It must not alter the user's SillyTavern install or the existing Ollama vectorization/remote-store patch.

If Core cannot establish source authority for this source class, exclude the source class and keep the path denied. Do not manufacture a substitute source identity from an array index, timestamp, hash, or caller-provided label unless the relevant contract explicitly approves it.

## 3. Required dispatch/revocation semantics

The project must state what “revoked” means relative to an outbound request. This proposal recommends the following bounded policy for review:

- There is one **dispatch-start linearization point**: the authoritative point at which the system commits to handing an authorized request to the outbound transport.
- If a deny, revocation, source invalidation, scope change, or loss of required readiness linearizes before dispatch-start, the request must not be sent.
- If dispatch-start linearizes first, the request is considered in-flight before the later revocation. A later revocation cannot recall bytes already handed to transport.
- This ordering is a contract, not an implementation claim. It is valid only if one authoritative mechanism actually serializes the decision/dispatch-start against the effective revocation state. Separate checks in Core and Provider followed by an unrelated fetch do not establish the ordering.
- A timestamp, revision comparison without serialization, process-local boolean, browser hook, or second check alone is insufficient evidence of this guarantee.
- Product/Security must explicitly accept this in-flight boundary before production use. If policy requires that no physical network send occur after a revocation commit even when dispatch-start had already won, this proposal does not satisfy that stricter policy; a different mechanism is required.

If the existing architecture has no mechanism that can implement the chosen ordering, Core must say **NO APPROVED SERIALIZED DISPATCH SEAM** and propose the smallest reviewable design. The system stays fail-closed until that design is approved and tested. Do not label an internal field-read service as a final egress gate without proving that it owns or serializes the dispatch-start.

## 4. Source authority and Provider readiness are separate gates

Before dispatch-start, all of the following must be established by their respective owners:

| Question | Owner | Fail-closed condition |
|---|---|---|
| Is the source identity authentic and correctly world-bound? | Host + Core | Missing, mutable, ambiguous, or caller-substitutable identity |
| Which immutable source version is referenced? | Host + Core | Version cannot be proven across edit, swipe, delete, copy/import, restore and restart |
| Is that version still current and valid? | Core | Unknown version, rollback, retraction or stale canonical state |
| Is the Provider record a faithful direct-source record with valid lineage? | Provider | Missing/malformed lineage, identity conflict, unsupported derived/multi-source lineage |
| Is access permitted for this actor, purpose, world and requested disclosure? | Core policy owner | No approved policy/seam, revoked grant, unknown actor/purpose/scope |
| Is retrieval state complete and reconciled? | Provider, based on trusted inventory authority | Incomplete inventory, stale/unavailable reconciliation, index inconsistency, unknown readiness |
| Can the decision be serialized against revocation at dispatch-start? | Core + Host + Provider according to actual state ownership | No approved shared/serialized mechanism |

Provider index readiness is not proof of complete source inventory. Provider grant state is not, by itself, Core's authorization to disclose a source to a model. Core's world revision/commit sequence is not automatically a source-specific change/retraction journal. A complete-empty result must remain distinguishable from denied, withheld, stale, unavailable and incomplete results without leaking protected content or counts.

## 5. Owner deliverables

### Core
- Identify the actual code path and authoritative state/transaction for canonical source identity, source currentness, retraction and rollback.
- Identify whether the existing code can serialize the final decision with dispatch-start. Cite exact symbols and tests.
- If no such seam exists, submit a minimal contract/design diff for review. State the proposed owner, linearization point, ordering semantics, failure behavior and crash/restart behavior. Do not implement an unapproved API/schema.
- State what trusted owner supplies the complete inventory, including deleted/retracted sources and import/restore semantics.
- Keep production disclosure disabled pending Product/Security acceptance and real-path evidence.

### Memory Provider
- Verify current PR head and exact-head Runtime CI before reporting completion.
- Map existing Provider operations and typed outcomes for direct canonical-source records: authorized/current, stale/retracted, revoked, unknown identity/version, incomplete inventory, unavailable/reconciliation-required.
- Separate Provider-persisted evidence from Host-supplied identity and Core-authoritative source state.
- Explicitly state whether any existing Provider-owned operation can serialize effective revocation with dispatch-start. If none, say so; do not invent a contract field or claim a second check solves the race.
- Do not change Core, Host, NPC, schemas/APIs, production wiring, or vectorization.

### Host/Adapter
- Prepare a disposable harness against the exact pinned SillyTavern source. A recording fake provider must observe whether any outbound request arrives and must not persist prompt text.
- Do not add a production interceptor until Core's callable contract is approved.
- Exercise the actual server dispatch path, not only a pure helper or fixture.
- Report harness results separately from real browser/IndexedDB and Android/Termux runtime tests.
- Preserve the user's existing vectorization/remote-store patch and installation.

### Coordinator
- Maintain a route-by-route coverage table; one successful route does not imply universal coverage.
- Map every acceptance test to the owner and exact contract it proves.
- Reject claims based only on source inspection, fixture-only tests, stale CI, or a helper that is not called by the real dispatch path.
- Keep Memory → NPC disabled until all required evidence and policy approval are present.

## 6. Required acceptance matrix

| Scenario | Required observation |
|---|---|
| Approved source, current version, authorized request | Fake provider observes exactly one expected request |
| Explicit deny | Zero outbound requests |
| Authorization/source authority unavailable or unknown | Zero outbound requests |
| Source version changed, retracted, rolled back or stale after prompt assembly | Zero outbound requests if invalidation wins before dispatch-start |
| Inventory incomplete or reconciliation unavailable/stale | Zero outbound requests; never convert this to complete-empty |
| Grant/revocation commits before dispatch-start | Zero outbound requests |
| Dispatch-start wins before later revocation | Behavior matches the explicitly approved in-flight policy; record ordering and do not claim the request can be recalled |
| Concurrent revoke versus dispatch-start | Deterministic test proves the chosen serialization/ordering; a timing-only probabilistic test is insufficient |
| Provider restart/rebuild | Revocation, tombstone and stale/readiness outcomes remain fail-closed |
| Old backup/restore | No anti-rollback guarantee may be claimed unless an independent trusted authority or equivalent evidence proves it |
| Other outbound routes | Explicitly unsupported/unverified until separately tested |

For each row, report source inspection, unit/component test, harness test and real-runtime test as distinct evidence classes. Record exact source SHA, PR head SHA, test command, CI URL and observed request count.

## 7. Exit criteria

This proposal is ready to leave the design stage only when all of the following are present:

1. Core-approved source authority/currentness and disclosure decision contract.
2. Explicit Product/Security decision on the in-flight revocation boundary.
3. A proven dispatch-start serialization mechanism, or an explicit statement that the guarantee is unsupported.
4. Provider exact-head CI and evidence mapping for all Provider-owned states.
5. Host recording-fake-provider evidence on the real pinned server dispatch path, including deny/race/zero-egress cases.
6. Exact unsupported-route list and explicit untested browser/Android/Termux limitations.
7. Coordinator review confirming that the evidence covers the actual route and not merely a helper.

Until then, **Memory → NPC remains DISABLED / FAIL-CLOSED**. Passing Provider tests, merging a semantic document, or approving the bounded experiment does not independently authorize production disclosure.

## 8. Evidence checkpoint — 26 Oct 2026

This checkpoint records observed evidence, not an authorization change. The owner responses are classified by what they actually prove; no cross-owner guarantee is inferred from local tests.

| Owner / artifact | Exact evidence observed | Current disposition |
|---|---|---|
| Core issue #140 | Core 1.9 decision matrix at [comment #6411984242](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6411984242): accepts the server-side Chat Completions location as a bounded experiment candidate only; states **NO APPROVED CALLABLE SEAM**; states revocation-after-validation is unsupported for production; universal source authority/currentness and subject-relative acquisition remain unsupported/non-ready. Core's later checkpoint request [#6412542516](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6412542516) asks for any further unresolved authority/inventory/retention decisions to be explicit. | **DECISION RECEIVED, PRODUCTION BLOCKED.** No approved callable disclosure gate, no atomic check-to-fetch, and no complete trusted source inventory/anti-rollback authority evidenced. |
| Provider PR #344 | Current PR head `27129f70d7f33f3c6cf8e1c378e8203038605f62`; exact-head Runtime CI [#40298048164](https://github.com/necromorphic/Logic-Engine/actions/runs/40298048164): `npm test` **602/602** and recalculation oracle **8/8**. Provider's current handoff request [#6412540990](https://github.com/necromorphic/Logic-Engine/issues/181#issuecomment-6412540990) still awaits the compact existing-operation → evidence/outcome map and explicit serialized-dispatch statement. | **PASS — Provider-local tests only; HANDOFF OPEN.** No claim about Host identity/inventory, Core source authority, or dispatch serialization. |
| Host issue #258 | Pinned source inventory for ST SHA `06bde939fb1e9c4c8d8641d810f0a916b5bce127` remains **SOURCE-INSPECTED ONLY**. Coordinator's latest bounded-harness request [#6412541665](https://github.com/necromorphic/Logic-Engine/issues/258#issuecomment-6412541665) is not followed by an evidenced execution report in the current issue timeline. | **BLOCKED / NOT YET EVIDENCED.** No request counts, deny/zero-egress results, or race results may be reported as passed. Browser/IndexedDB and Android/Termux tests remain separate and unproven. |
| Coordinator PR #354 | Current head `c128e8560a132c2824bc812591a1f37e4ac4fa2e`; exact-head Runtime CI [#40299127540](https://github.com/necromorphic/Logic-Engine/actions/runs/40299127540): `npm test` **599/599** and recalculation oracle **8/8**. PR is documentation-only, draft and unmerged. | **PASS — documentation-branch CI only.** Does not authorize runtime changes or prove production behavior. |

### Cross-block interpretation and next gate

- Core has now answered the central feasibility question: there is **no approved callable seam** and no demonstrated atomic revocation-to-dispatch guarantee. The proposed route is an experiment boundary, not an authorization boundary.
- The next Provider result must be a compact map of existing operations and typed outcomes, separating Provider-persisted grants/index/lineage from Host-supplied identity/inventory and Core-authoritative source currentness/retraction/rollback. If there is no Provider-owned serialization operation, the handoff must say so explicitly.
- The next Host result must be a reproducible artifact on the disposable pinned checkout: exact diff and commands, recording fake provider that stores counts only, and results only for cases actually runnable without the missing Core seam. Cases requiring that seam must be **BLOCKED**, not passed by a fake callback.
- No new runtime API/schema, universal interceptor, raw Host-text retention, or changes to the existing Ollama vectorization/remote-store patch are authorized by this checkpoint.
- These are independent gates; one owner's PASS cannot be inherited by another owner.

Production Memory → NPC remains **DISABLED / FAIL-CLOSED**.


## 9. Blocker 1 — real Memory adapter/index, not fixture authority (26 Oct 2026)

**Scope of this closure pass:** distinguish the actual SQLite Provider and consumer integration test from the still-fixture-backed source-authority callbacks. This section is a source-backed implementation disposition; it does not authorize production wiring.

### 9.1 What is already real

- Provider PR #344 contains `src/application/sqlite-memory-provider.js`, a real SQLite-backed Provider with persisted records, index entries/state, query grants, per-record grants, lineage validation, tombstones, rebuild and reconciliation. Its current PR head is `27129f70d7f33f3c6cf8e1c378e8203038605f62`; exact-head Runtime CI #40298048164 passed 602/602 repository tests and 8/8 recalculation-oracle tests. This is Provider-local evidence, not production connection evidence.
- `src/application/memory-npc-consumer.js` is an existing internal consumer seam. It requires injected `AuthorizedReadService`, `ActorBindingService`, and a Provider implementing `authorizeQuery`, `retrieveCandidates`, and `authorizeCandidate`; it fails closed on missing/invalid readiness and reads canonical fields through Core's authorized read service.
- `tests/memory-provider-core-integration.test.js` instantiates the real `SQLiteMemoryProvider`, `LogicEngine`, `ActorBindingService`, `AuthorizedReadService`, and `MemoryNpcConsumer`. It is therefore not a fake Provider implementation.

### 9.2 What is still fixture-backed or absent

- The same integration test injects `validateSourceVersion` that accepts the literal `fixture-source-v1`, and `validateInventory` that returns `true`. These callbacks simulate positive evidence; they do not prove Core source authority or inventory completeness.
- Runtime entrypoint `src/index.js` currently constructs `SQLiteStore`, `LogicEngine`, and the API server only. It does not instantiate or wire `SQLiteMemoryProvider` or `MemoryNpcConsumer` into a production request path.
- Core's decision in issue #140 explicitly says universal source authority/currentness is unsupported and no approved callable disclosure seam exists. Provider's injected validators cannot be promoted to production validators by renaming or wiring them.

### 9.3 Existing Provider operations and their actual evidence boundary

| Existing operation | What the code can establish | What it cannot establish by itself |
|---|---|---|
| `putRecord(record)` | Persists a direct `canonical_entity` record with an explicit source version and exactly one matching direct-source lineage entry; duplicate/conflicting immutable record handling is Provider-local. | That the supplied source version is Core-authoritative or current. |
| `authorizeQuery(scope)` / `grantQuery(scope, allowed)` | Provider-persisted query grant for the exact world/subject/purpose tuple. | Core authorization to disclose to a model, or atomicity with a later dispatch. |
| `authorizeCandidate(input)` / `grantRecord` / `revokeRecord` | Provider-persisted record grant, exact record/version/scope/source match, lineage validation, and a grant recheck after the asynchronous source-validation callback. | Cross-store linearization against Core source mutation or Host dispatch; the recheck narrows but does not eliminate TOCTOU. |
| `retrieveCandidates(scope)` | Enforces query grant, Provider index readiness/reconciliation, current Core snapshot cursor, and Provider result scoping; denial/stale/unavailable/index-not-ready are errors, not complete-empty. | A trustworthy source-version mapping, complete external inventory, or final egress authorization. |
| `rebuildIndex(worldId)` / `reconcile(worldId)` | Rebuilds the Provider's derived index and reconciles persisted Provider records against injected snapshot/source/inventory validators; readiness is withheld on detected failures. | Completeness of an external source inventory unless an approved trusted validator proves it. |
| `markRawSourceDeleted` / `purgeRawSource` / raw-version selection methods | Apply Provider-local lifecycle actions to an exact supplied raw-source identity/version. | Correct Host deletion target, all historical source versions, or retraction of canonical entities. These raw-archive methods are not substitutes for direct canonical-entity currentness. |

### 9.4 Minimum closure sequence without inventing an API

1. **Core-owned source proof:** Core must explicitly approve the existing authoritative evidence for a direct canonical entity's source identity/version, currentness, retraction and rollback. The current `updated_revision` and world snapshot cursor must not be mapped to Provider `source_version` by assumption. If no existing approved operation supplies this proof, this row stays blocked; the smallest new contract requires Core review before implementation.
2. **Real Provider dependency binding:** only after step 1, bind the existing Provider `getSnapshot`, `validateSourceVersion`, and `validateInventory` dependencies to that approved Core evidence, rather than test callbacks. The adapter must return non-ready on unavailable/unknown/partial evidence and must not claim complete-empty.
3. **Persistent restart/rebuild proof:** run the real SQLite Provider with a file-backed temporary database, restart it, rebuild the derived index, reconcile against the approved evidence, and show revoked grants/tombstones and stale-source outcomes remain fail-closed. Existing unit tests are not a substitute for a single reproducible integration report at the approved dependency boundary.
4. **Consumer wiring remains disabled:** do not wire this into `src/index.js` or expose an endpoint until Core approves a callable subject-relative disclosure contract and a real final-dispatch boundary. The present consumer is internal and intentionally dependency-injected; adding a default fixture provider or fake production receiver would conceal the blocker, not close it.
5. **End-to-end exit:** the approved vertical slice must prove exact source/version/lineage → persisted Provider record/index → restart/reconciliation → Core-authorized read → NPC admission, with the final disclosure boundary tested separately. Any unresolved source authority, inventory, or final-dispatch condition keeps production disabled.

**Disposition for blocker 1:** the actual SQLite Provider and real-component test scaffold exist in a draft branch; the production adapter binding does not. The remaining critical gap is not “write another fixture test”; it is the absence of approved Core source/version/inventory evidence to bind into the existing Provider dependencies. No runtime code/API/schema change is made by this section. Memory → NPC remains **DISABLED / FAIL-CLOSED**.


## 10. Superseding checkpoint — source-version mapping approved; independent gates remain (26 Oct 2026)

This section supersedes any earlier statement in sections 8–9 that the bounded direct-canonical-entity source-version mapping is still awaiting Core approval. It does **not** supersede the fail-closed disposition for inventory completeness or final dispatch.

### Core decision now accepted

Core issue #140 has conditionally approved the following existing-code mapping for **direct `canonical_entity` records only**:

- `source_entity_id` must identify exactly one canonical entity in the same `worldId`.
- Provider `source_version` must equal the canonical decimal string of the current entity `updated_revision` returned by `engine.getSnapshot(worldId, { entityIds: [source_entity_id] })`.
- Missing, malformed, mismatched, destroyed, unknown-status, unavailable or stale evidence means NON_READY/DENY. Do not accept `fixture-source-v1` as authority.
- Revalidate the existing snapshot cursor where supported, but do not treat `commit_sequence` as a source-change journal.
- Rollback R2→R1 must reject a record pinned to R2 even if `commit_sequence` is unchanged. If the actual Core projection cannot demonstrate that result, the case remains unsupported and denied.

Decision references:
- [Core bounded source-version decision](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6413031215)
- [Core rollback/retraction rule and required regression](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6413100985)

### Corrected owner sequence

1. **Memory Provider:** implement the approved mapping through the existing injected dependency seam; remove positive fixture source-version acceptance from the relevant integration proof; add rollback, missing/mismatch/destroyed/unknown/unavailable fail-closed cases; separately prove file-backed SQLite restart → rebuild → reconcile → retrieve/deny and that revoked grants do not reappear. Report the actual PR HEAD, changed files, exact command, and exact-HEAD Runtime CI. No new API/schema/store or production wiring.
2. **Coordinator:** compare the returned Provider diff and tests to the exact Core acceptance conditions, and do not treat comments about a commit as proof that it is the current PR HEAD. The PR's actual current head must be read from GitHub before assigning CI evidence.
3. **Host/Adapter:** the complete active + historical/deleted inventory remains **NO SUCH MECHANISM FOUND / NON_READY**. The bounded recording-fake-provider harness on the disposable pinned ST checkout remains a separate required artifact; no raw prompt retention and no production interceptor.
4. **Core + Host + Product/Security:** the final model-disclosure/dispatch seam remains unapproved. There is no demonstrated serialization of revocation against dispatch-start and no real-path zero-egress proof. The documentation proposal in this PR is not an implementation or approval.
5. **Coordinator exit decision:** source-version mapping and Provider persistence evidence can close only their own sub-gates. They cannot close Host inventory completeness, raw-source retention policy, subject-relative disclosure authorization, or dispatch/revocation atomicity.

### Current disposition

- Bounded direct canonical-entity source mapping: **CORE-APPROVED, IMPLEMENTATION/CI STILL TO VERIFY**.
- Provider restart/rebuild/revocation persistence: **SEPARATE PROVIDER ACCEPTANCE GATE**.
- Complete Host source inventory across edit/delete/swipe/import/restore/restart/replay: **NON_READY**.
- Callable final-disclosure gate and revoke-to-dispatch serialization: **NOT APPROVED / NOT PROVEN**.
- Production Memory → NPC: **DISABLED / FAIL-CLOSED**.
