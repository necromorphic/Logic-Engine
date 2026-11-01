# Memory Provider issue #181 — real adapter lifecycle evidence

**Status:** implementation candidate; the final code/test commit `f17ac61024d3098866bbd88a1393941cfe8a5080` passed exact-head CI. A report-only update follows that tested commit; the new PR head is rechecked by the linked workflows.  
**Base main:** `b5fc27506ffda4fd6bc2e236c0463231f6c6c321`  
**Candidate branch:** `provider/issue-181-real-adapter-lifecycle-2026-10-29`  
**Candidate head:** use the exact SHA shown on [PR #686](https://github.com/necromorphic/Logic-Engine/pull/686) and its linked checks; a report-only edit also advances the branch head.  
**Issue:** [#181](https://github.com/necromorphic/Logic-Engine/issues/181)

## Audit: current main and prior work

| Item | Finding | Classification |
|---|---|---|
| PR #182, “feat(memory-provider): add durable SQLite provider vertical slice” | Closed, not merged as that PR. The current main independently contains `src/application/sqlite-memory-provider.js`, the provider persistence/index tables and Provider tests. Do not treat the old PR diff itself as proof of current behavior. | Historical proposal/draft; verify current main code |
| PR #201, “feat(memory): record lifecycle decisions and add internal import test seam” | Closed and superseded by #313 (per PR #201 close summary). The current main contains the lifecycle tests and the internal import-only test seam. | Superseded |
| SQLite Provider | `SQLiteMemoryProvider` owns durable `memory_records`, version identity, grants, index entries/state, reconciliation, source validation, and typed fail-closed retrieval. Provider DB is required to be separate from Core/coordinator storage. | Executable |
| Core consumer | `MemoryNpcConsumer` already consumes `authorizeQuery`, `retrieveCandidates`, and `authorizeCandidate`; it performs Core actor binding, `AuthorizedReadService` source reads, and final revalidation. It is not wired to a production default or public route. | Executable internal seam |
| Real integration test | `tests/memory-provider-core-integration.test.js` instantiates real `SQLiteMemoryProvider`, `SQLiteStore`/`LogicEngine`, `ActorBindingService`, `AuthorizedReadService`, and `MemoryNpcConsumer`. The Core snapshot reader and canonical source-version validator are real. `validateInventory: async () => true` remains an explicit test fixture and is NOT evidence of Host inventory completeness. | Real in-process integration, not Host or production E2E |
| Raw SillyTavern text | Core decision [#140](https://github.com/necromorphic/Logic-Engine/issues/140#issuecomment-6401452420) does not authorize durable raw-text retention. Capture, raw disclosure and active raw version selection remain fail-closed. | Policy gate; do not bypass |

## Provider → Core adapter lifecycle test added on this branch

New test: `real Provider preserves immutable versions and duplicate/conflict semantics across restart, then revokes only the selected version` in `tests/memory-provider-core-integration.test.js`.

It exercises the actual file-backed SQLite Provider through the existing Core consumer seam and asserts:

1. Initial record becomes current after index rebuild and reconciliation.
2. Replaying the exact same `(world_id, record_ref, record_version)` payload returns `duplicate`.
3. Rebinding that same immutable identity to a changed payload fails with `MEMORY_IDENTITY_CONFLICT`.
4. A second immutable record version is persisted and independently granted.
5. Both versions reach the real Core/NPC consumer before revocation.
6. Revoking version `record-v1`, closing/reopening Provider, rebuilding and reconciling does not restore its access.
7. Version `record-v2` remains accessible after restart; the test recreates the consumer against the reopened real Provider.

The existing Provider suite additionally covers durable record persistence when index insertion fails, unavailable/non-ready behavior, replay repair, index rebuild, reconciliation interruption/races, source rollback/version mismatch, query and record revocation, corrupt lineage, typed failures, and the raw-text fail-closed policy.

## Requirement → owner → code/test → evidence status

| Requirement | Owner | Code/test | Status before exact-head CI |
|---|---|---|---|
| Immutable version, duplicate idempotency, conflicting payload rejection | Provider | `sqlite-memory-provider.js`; new real integration lifecycle test; `sqlite-memory-provider.test.js` | Implemented; CI pending |
| Exact-version access revocation persists through Provider restart without reviving another version | Provider | New real integration lifecycle test; existing Provider revocation/restart tests | Implemented; CI pending |
| Durable record survives derived-index failure; read stays blocked until recovery | Provider | `tests/memory-provider-ingest-index-failure.test.js` | Existing test; CI pending on candidate head |
| Restart/rebuild/replay and reconciliation interruption/races | Provider | `tests/memory-provider-lifecycle-regressions.test.js`, `tests/memory-provider-reconcile-interruption.test.js`, `tests/memory-provider-typed-failures.test.js` | Existing tests; CI pending on candidate head |
| Real Provider → Core authorization/final revalidation → NPC admission | Provider + Core/NPC | `tests/memory-provider-core-integration.test.js` | Real in-process integration; CI pending; not production wiring |
| Authoritative complete Host inventory and truthful Host source lifecycle events | Host/Adapter (#258) | Current Provider integration uses a test-only `validateInventory` fixture | **BLOCKED / NOT PROVEN** |
| Canonical world/session binding, currentness/rollback authority and approved cross-block guarantees | Core (#140) | Real Core snapshot and canonical entity version validator are used in tests; Host-to-Core authority is not proven by this test | **PARTIAL / BLOCKED at Host boundary** |
| Raw source text capture/read/active swipe selection | Core policy (#140) | `tests/memory-provider-raw-archive.test.js` verifies denied operations and no new raw content | **NOT AUTHORIZED; FAIL-CLOSED** |
| SillyTavern save/edit/swipe/delete/reload/restore inventory completeness | Host/Adapter (#258) | Not exercised by this Provider test | **NOT TESTED HERE** |
| Production Memory→NPC traffic/default route | Core + NPC + Coordinator | No production default or public route added | **DISABLED / FAIL-CLOSED** |

## Exact-head CI evidence\n\nTested implementation commit: [`f17ac61024d3098866bbd88a1393941cfe8a5080`](https://github.com/necromorphic/Logic-Engine/commit/f17ac61024d3098866bbd88a1393941cfe8a5080).\n\n- [Provider blocker 3 workflow](https://github.com/necromorphic/Logic-Engine/actions/runs/40821857355): PASS. Focused Provider acceptance: **108/108**; Runtime suite in the same workflow: **1070/1070**; recalculation oracle: **20/20**.\n- [Runtime tests workflow](https://github.com/necromorphic/Logic-Engine/actions/runs/40821857439): PASS. Full Runtime test job: **1070/1070**; Core trusted-acquisition and NPC-boundary jobs also passed.\n- CI environment fingerprint and exact SHA are recorded by those workflow runs. This is GitHub Linux CI evidence, not a local Windows/Termux run.\n\n## Exact test commands

Focused Provider/Core lifecycle acceptance:

```sh
node --test tests/accepted-head-authority.test.js tests/core-accepted-head-handshake.test.js tests/provider-accepted-head-handshake.test.js tests/memory-dispatch-gateway.test.js tests/memory-provider-raw-archive.test.js tests/memory-provider-core-integration.test.js tests/memory-provider-ingest-index-failure.test.js tests/memory-provider-lifecycle-regressions.test.js tests/memory-provider-reconcile-interruption.test.js tests/memory-provider-typed-failures.test.js tests/sqlite-memory-provider.test.js
```

Full native repository suite:

```sh
npm test
```

CI is required to report the exact tested commit SHA and result links before any PASS is claimed for this candidate. The candidate has not been run on the user's Windows/Termux deployment. No production traffic is enabled.

## Remaining blockers and closure evidence

- **Host/Adapter (#258):** supply exact candidate source identity/version and deletion/revocation events plus real save/reload/edit/swipe/delete/restore evidence. Closure test: drive the same source lifecycle through Host and verify the Provider receives exact identity/version transitions without caller-asserted world/session authority.
- **Core (#140):** approve/implement the trusted world/session binding and source-currentness/rollback contract for Host-originated records. Closure test: reject cross-world/session rebinding and rollback/replay when Core authority disagrees, using the actual trusted integration seam.
- **Inventory attestation:** replace the integration test's permissive fixture only when Host/Core supply an approved completeness authority. Until then, the real Provider adapter is testable, but production-ready source completeness is not established.
- **NPC/Coordinator:** continue to require owner review and global gates before production wiring. Retrieval/context inclusion is not acquisition, belief, receipt, or delivery.

This branch intentionally adds no second storage engine, no new public API/route, no Core schema or event journal, no raw-text retention, and no production default.


## Current-main integration refresh — 30 Oct 2026

The current `tests/memory-provider-core-integration.test.js` setup uses both Core-owned validators by default:

- `createCanonicalEntitySourceVersionValidator(engine)` validates each Provider record against the real `SQLiteStore`/Core engine.
- `createCanonicalEntityInventoryValidator(engine)` validates the complete canonical-entity inventory from the same Core engine. The test can override this callback to force incomplete/unavailable cases, but the positive path is **not** `validateInventory: async () => true`.

The real in-process integration test therefore proves more than a fixture-positive callback: Provider reconciliation can validate actual Core canonical entity source versions and Core canonical entity inventory, then pass authorized fields through `AuthorizedReadService` and `MemoryNpcConsumer`. It also exercises Provider record/query revocation, source-version invalidation, Core rollback with unchanged commit sequence, and non-ready behavior when canonical inventory attestation fails.

This still does **not** prove the Host side:

- Core canonical entity inventory is not a SillyTavern message/swipe inventory.
- `HostVersionDigestLedger` is a separate digest-only ledger with its own `verifyInventorySnapshot` callback; Core startup still supplies a deny-only verifier.
- The current Host file inventory route does not emit the complete message-version envelope required by `HostVersionDigestLedger.reconcileConversation()`.
- No production adapter joins ST save/edit/swipe/delete/import/restore evidence to canonical Core entity versions or Provider reconciliation.
- Provider-local revocation and Core final-read revalidation are not the same as a shared final-dispatch/zero-egress guarantee. Security PR #777's dispatch-start primitive is not wired to the pinned ST senders.

**Correct disposition:** Provider → Core canonical-entity reconciliation and revocation tests are executable and pass current CI; Host-originated source inventory/reconciliation and final disclosure remain blocked. Do not describe the positive Core validator path as proof of Host completeness or production Memory → NPC readiness.


## Core query authorization and real adapter composition — 1 Nov 2026

The current implementation now has a concrete composition factory:
`src/application/memory-npc-provider-adapter.js`.

It creates a **file-backed `SQLiteMemoryProvider`**, not a fake or in-memory test double, and wires only trusted Core-owned dependencies:

- Core `LogicEngine.getSnapshot()` for the Provider snapshot reader;
- `createCanonicalEntitySourceVersionValidator(engine)` for each direct source;
- `createCanonicalEntityInventoryValidator(engine)` for complete canonical-entity inventory attestation;
- Core `createHostBoundNpcKnowledgeAuthorizers()` for query authorization;
- Core `ActorBindingService` and `AuthorizedReadService` for actor binding and per-field source disclosure;
- an explicit trusted field policy and field allowlist supplied by deployment configuration;
- the same live coordinator database used by Core and Provider.

The Core query authorizer requires an active configured adapter → actor binding and an active Host conversation → world binding for the exact `world_id`, `conversation_id`, `adapter_id`, and `actor_id`. The Provider query grant is an additional restriction; it cannot replace Core authorization. The consumer checks both before retrieval and again after asynchronous record checks and source reads.

Per-record Provider authorization remains exact to `(world_id, subject_id, purpose, record_ref, record_version)`. Each admitted source is then reread through Core `AuthorizedReadService`; record grants are rechecked after the Core source read and before a ready result is returned. Revocation of the Core Host-conversation binding during candidate validation also blocks disclosure.

Executable proof:
- `tests/memory-npc-provider-adapter.test.js`: factory creates a real file-backed Provider and uses real Core store/engine, source-version validator, full canonical inventory validator, Host conversation binding, actor binding, and field policy; a bound conversation retrieves the Core source value, while an unbound conversation is denied.
- `tests/memory-provider-core-integration.test.js`: real Provider/Core integration additionally covers Core query denial, Host-conversation revocation during candidate validation, Provider query revocation, per-record revocation and Core rollback/source invalidation.
- `tests/memory-provider-source-separation.test.js`: a Host `host_message_version` tuple is rejected by `putRecord()`; neither semantic record nor index row is persisted.

The factory deliberately does not register a public HTTP route, infer authenticated adapter identity from request data, or enable final model dispatch. The factory pins one deployment-configured adapter identity into the consumer; the Host caller supplies only a stable conversation identity that Core has bound. The factory does not accept a request-selected adapter identity. The current repository still has no complete SillyTavern source lifecycle attestor or sole-egress final-dispatch integration. Therefore this closes the real Provider → Core query/retrieval adapter slice, **not** production Memory→NPC traffic or Host-message ingestion.


Failure-state handling at the consumer boundary is also explicit: authorized complete-empty remains a ready empty result; partial results, query denial, withheld records, stale snapshots, unavailable Core snapshots, unavailable index/reconciliation, rebuilding, lineage failure, source-version failure, authorization changes, and mid-flight record revocation retain separate safe non-ready reasons. Provider diagnostic state is used only to refine an already non-ready `MEMORY_INDEX_NOT_READY` result; it cannot turn a failed retrieval into ready or empty. Internal error messages, record counts and identities are not returned.

## Independent review corrections — PR #845 review findings

The first independent review of PR #845 found that identifier-only Core query authorization was insufficient and that a record revoke after retrieval but before the first authorizeCandidate() call could be filtered into ready-empty. The follow-up implementation addresses those two defects without changing the Provider's retrieval/index architecture.

### Authenticated Host session boundary

- src/application/host-session-context.js creates a branded, non-serializable capability only from the authenticated SillyTavern server request shape: signed-session handle must match the authenticated user handle, the server-generated logicEngineSessionId and logicEngineSessionHandle must match, and the composite conversation ID must be scoped to that session.
- Host-owned work must run inside runWithAuthenticatedHostSession(request, conversationId, callback). MemoryNpcConsumer reads the capability from AsyncLocalStorage; no caller-supplied conversation ID alone can authorize a query.
- Core memoryQueryAuthorizer now requires that exact branded session capability and still checks the active Core conversation → world and adapter → actor bindings.
- tests/npc-knowledge-authorization.test.js covers missing capability, a copied/plain object, a different conversation in the same session, and a second active conversation belonging to another authenticated session.
- tests/memory-npc-provider-adapter.test.js verifies that calling the consumer outside an authenticated Host context returns non-ready with no candidates.

### Retrieval-time record grant snapshot

- memory_record_grants.authorization_generation is durable and increments on every grant/revoke update, including revoke → re-grant.
- retrieveCandidates() returns the exact generation alongside each (record_ref, record_version).
- MemoryNpcConsumer requires that generation and supplies it to every per-record authorization check, including the final check after Core source reads.
- authorizeCandidate() rejects a revoked grant as MEMORY_RECORD_ACCESS_REVOKED and rejects a changed generation as MEMORY_AUTHORIZATION_CHANGED; it cannot reinterpret a previously retrieved row as an ordinary filtered denial.
- Existing Provider callers that start a fresh direct authorization without a retrieval snapshot remain compatible; the Core consumer always supplies the captured generation.
- tests/memory-provider-core-integration.test.js covers revoke strictly after retrieveCandidates() returns but before the first record authorization, plus cross-connection revoke → re-grant using a second file-backed Provider connection. Both cases must be non-ready, never ready-empty.
- The multi-record race now rejects the complete candidate set if one previously retrieved record is revoked during another record's authorization. It does not silently return a partial disclosure.

### Provider exposure boundary

- The adapter no longer returns the raw SQLiteMemoryProvider.
- The factory exposes only a narrow ingestion/grant administration facade (putRecord, grantQuery, grantRecord, revokeRecord); retrieval and per-record authorization remain private inside MemoryNpcConsumer.
- The consumer stores the real Provider in a JavaScript private field and freezes its public instance surface.
- The adapter test asserts that raw retrieval/authorization methods and a public consumer.memoryProvider reference are absent.

### Remaining explicit limitation

These changes close the review's identifier-only authorization and retrieval-to-first-record-check defects. They do not claim cross-database atomicity between a Core binding revoke, Provider grant revoke, the last consumer check, and an external model transport. revalidateForFinalDispatch() remains a freshness re-read, not a dispatch lease. A shared serialized dispatch-start/sole-egress contract is still required before any production Memory→NPC dispatch is enabled.