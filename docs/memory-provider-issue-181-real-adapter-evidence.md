# Memory Provider issue #181 — real adapter lifecycle evidence

**Status:** implementation candidate; an initial CI attempt exposed one test assertion mismatch and a missing focused-test environment preload; both were corrected, and exact-head CI is pending on the updated commit.  
**Base main:** `b5fc27506ffda4fd6bc2e236c0463231f6c6c321`  
**Candidate branch:** `provider/issue-181-real-adapter-lifecycle-2026-10-29`  
**Candidate head for current validation attempt:** `c8a516c88d15d29007f420f5ddc858c341457771`  
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

## Exact test commands

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
