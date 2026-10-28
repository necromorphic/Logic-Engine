# Core competencies — source-backed audit (2026-10-28)

**Scope:** current Core responsibilities, actual source seams, and the evidence currently available. This is a documentation/source audit only. It does not authorize runtime, API, schema, storage, Host, Memory, NPC, or integration changes.

**Repository baseline:** latest observed `main` commit at audit time: `d4d880cef46e005f684ca16d66ba9a8872660e8a` (`test(memory): cover cross-connection query grant ABA`). The audit is bounded to the listed files and current documented test evidence; it is not a claim that every call path or deployment was executed.

## Status key

- **Implemented and test-supported:** source behavior and relevant tests exist.
- **Partial / bounded:** a limited slice exists, but broader guarantees are not established.
- **Docs-only / missing:** requirements or proposals exist without a demonstrated production implementation.
- **Blocked:** cannot be called ready until a specific missing gate is proven.

## Competency matrix

| Core competency | Current evidence | Verdict | Boundary / next proof |
|---|---|---|---|
| Canonical world state, events, revisions, commit sequence | `src/application/engine.js`; `src/storage/sqlite-store.js`; event and snapshot tests | **Partial / test-supported** | Canonical commit paths exist. The exact-head segment rollback-on-rebuild-failure regression is now merged via [PR #573](https://github.com/necromorphic/Logic-Engine/pull/573), merge commit `8d48021399824e96907541832cde4ce2a5012224`. This proves that injected rebuild failure rolls back the tested segment writes; it does not prove all possible writer paths or cross-store atomicity. |
| Input/effect validation and stale cursor checks | `src/core/rules.js`; `LogicEngine.prepareEvent/commitEvent/commitSegment`; `tests/tri-state-rules.test.js` and commit/proposal tests | **Partial / bounded** | Supported effect types and revision/sequence checks exist. They do not constitute a universal world-rule evaluator, dependency validator, or conflict-resolution planner. |
| Proposal → approval → canonical commit | `src/application/proposals.js`; engine/store commit path; proposal/API tests | **Implemented for supported paths** | Proposal lifecycle is real, but proposal creation is not a commit. Existing validation does not prove semantic alignment, causal completeness, actor authorization, or player-agency compliance for every operation. |
| Consistent snapshots and composite freshness cursor | `LogicEngine.getSnapshot`; `SQLiteStore.readSnapshot`; `tests/snapshot-read.test.js` | **Implemented for bounded reads** | `(world_revision, commit_sequence)` identifies a Core snapshot boundary. It is not a universal change journal and does not itself bind a temporal boundary or every external source mutation. |
| Actor identity binding | `src/application/actor-bindings.js`; `tests/actor-binding.test.js` | **Implemented, identity only** | Authenticated adapter-to-canonical-entity binding exists. It does not grant knowledge-read, arbitrary-field, proposal-approval, or commit authority. |
| Authorized reads / disclosure filtering | `src/application/authorized-read-service.js`; read-boundary tests | **Partial / fail-closed seam** | The service requires an injected trusted field policy and rechecks actor binding/snapshot freshness. A general production visibility policy and end-to-end safe model serialization are not proven. |
| Causal rollback and projection rebuild | `SQLiteStore.rollback/rebuild`; `tests/causality-contract.test.js`; merged #573 regression | **Partial / supported-effect scope** | Existing causal references and rebuild logic cover supported effects and tested cases. Completeness of dependencies and independent alternative support are not established universally. |
| General dependency graph, conflict resolution, recalculation planner | `docs/57-core-evaluation-recalculation-boundary.md`; bounded recalculation oracle harness | **Docs-only / missing as general capability** | The oracle is not a canonical world-state recalculation engine. No universal dependency closure, cycle/conflict strategy, or production-wide A/B/C recalculation policy is proven. See [issue #262](https://github.com/necromorphic/Logic-Engine/issues/262). |
| Time progression and durable segmented advancement | `src/application/engine.js`; `src/storage/sqlite-store.js`; `src/time/model.js`; time-advance tests | **Partial / bounded** | Time-advance operations and segment recovery exist. The operation record stores coordinates and world revisions, but the inspected schema does not persist a confirmed-boundary mapping to the full Core composite cursor. Do not infer that mapping from a coordinate or revision alone. |
| World Pack schema identity and historical interpretation | `schemas/world-pack-manifest.schema.json`; current world storage fields; spatial contract audit | **Blocked for spatial semantics** | Pack ID/version are stored, but canonical manifest/type-schema digest and exact historical schema resolution are not proven. |
| Core-owned actor knowledge acquisition/provenance | `docs/43-core-npc-knowledge-runtime-implementation-plan.md`; `docs/49-npc-core-knowledge-live-audit.md`; `src/application/memory-npc-consumer.js` | **Missing for production NPC knowledge** | The Memory→NPC consumer is an internal seam with injected provider functions, not a configured public production path. No complete Core-owned acquisition record lifecycle was demonstrated by this audit. Retrieval, facts, manifests, and prompt inclusion do not prove acquisition. |
| Spatial state / typed 3D positions | `docs/research/world-pack-typed-spatial-attributes-contract-2026-10-28.md`; coordinator report | **Docs-only / NO-GO** | Axis/frame convention is selected in the coordinator report. Runtime validation, immutable schema identity/history, complete incarnation/write-path coverage, and confirmed TimeEngine-boundary mapping remain unproven. No spatial runtime is authorized. |
| Authorized result publication as one complete Core pipeline | `docs/57-core-evaluation-recalculation-boundary.md`; bounded read and projection seams | **Partial / general pipeline missing** | There are individual read/projection paths, not proof of a universal evaluate → resolve → commit → recalculate → authorize → publish pipeline. |

## Evidence update: segment atomicity

[PR #573](https://github.com/necromorphic/Logic-Engine/pull/573) is merged. Its exact-head Runtime run [#40661437871](https://github.com/necromorphic/Logic-Engine/actions/runs/40661437871) succeeded. The run reported `npm test`: **930 passed, 0 failed, 0 skipped**, and recalculation oracle harness: **8 passed, 0 failed**. The regression injects a failure after `rebuild()` has run inside `commitSegment()` and checks that event rows, projection, revision, commit sequence, game-time coordinate and idempotency rows revert.

This is evidence for the tested segment failure path only. The latest-main combined-status query returned no status checks in the inspected response; that absence is not a green CI result for the latest `main` head.

## Current Core assessment

The existing README estimate of **Core = 55%** remains an approximate portfolio estimate, not a test-derived metric. It is reasonable only if read as “substantial canonical/proposal/snapshot primitives exist, while several engine-wide guarantees remain incomplete.” It must not be read as 55% production-ready.

The strongest completed areas are bounded canonical commits, proposal lifecycle, composite snapshot reads, actor identity binding, and specific tested rollback/rebuild paths.

The largest missing competencies are:

1. **General dependency-aware recalculation and conflict resolution** — the current oracle is not the runtime planner.
2. **Complete authorized result publication** — actor binding and a consistent snapshot do not alone prove field-level permission or safe final serialization.
3. **Core-owned acquisition/provenance lifecycle** — required before a production NPC can be given a trustworthy actor-relative account of what it knows.
4. **Historical schema and source identity** — required for spatial interpretation and replay determinism.
5. **Cross-block boundary completeness** — TimeEngine, Memory Provider, Host and NPC seams need explicit evidence without creating parallel writers, journals, clocks, or permission systems.

## Ordered next work — return to Core competencies

1. **Keep this audit as the baseline.** Do not promote docs-only or branch-only work to implemented capability.
2. **Continue the Core competence review at dependency/recalculation.** Enumerate the actual supported dependency types, their writers/readers, invalidation behavior, and tests. Mark missing dependency closure explicitly; do not invent a general graph API.
3. **Then review authorized result publication.** Trace one actual authorized-read request through actor binding, injected field policy, freshness revalidation, result encoding and final consumer. Record where production policy/serialization is still absent.
4. **Then assess Core-owned acquisition/provenance.** Reconcile current mainline source-version and Memory candidate gates with the knowledge contract; do not confuse Memory source lineage with actor acquisition.
5. Only after a bounded gap and its exact consumer are identified should a separate implementation proposal be considered. This audit itself authorizes no implementation.

## Safety disposition

- Spatial production runtime: **NO-GO**
- Memory → NPC: **DISABLED / FAIL-CLOSED**
- Universal recalculation/publication claim: **NOT ESTABLISHED**
- Runtime/API/schema/integration changes from this audit: **NONE**
