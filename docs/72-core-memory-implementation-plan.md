# Core Memory staged implementation plan

Status: proposed plan; runtime implementation is gated on repository and cross-block review.

## Phase 0 — repository and dependency audit

### MEM-O08 code evidence checkpoint

- The host-neutral adapter contract on `main` explicitly treats vectorization as a separately owned archive/retrieval system: initial discovery is read-only, no engine-owned archive writes/migrations, and vector hits are not canonical truth.
- The inspected `src/storage/sqlite-store.js` current-main schema contains canonical worlds/events/entities/facts, audit, idempotency, rollbacks, context manifests, and engine registries; no Memory archive, embedding/index, or durable Memory source-change outbox table was identified in that schema.
- The store's `tx(fn)` provides `BEGIN IMMEDIATE`/commit and nested savepoints. This is a usable local transaction primitive, not proof that Memory records can be atomically coupled to every canonical source mutation or external vector index.
- The rollback path runs transactionally, updates source-event validity and world revision/projections, and persists rollback metadata. Therefore a poller keyed only to increasing `commit_sequence` is insufficient.
- The exact vectorization extension/repository and its owner are still unknown from this source audit. Do not implement a second embedding store or infer that the extension is absent. Obtain its concrete location/API before implementing an adapter.


- Inspect SQLite schema/transactions, event and fact storage, source IDs, world revision and commit-sequence semantics, rollback implementation, and current tests.
- Inspect the open Core authorized-read/trusted-origin PRs and identify what is actually in `main`.
- Review NPC knowledge/acquisition contracts, Relations and Personality boundaries, and the existing vectorization patch. In particular, reconcile the Core-owned acquisition/delivery/belief semantics recorded by `feat/npc-subsystem:docs/39-npc-core-knowledge-contract-proposal.md` before choosing record ownership or schema.
- Record exact file/test/PR evidence and decide document numbering with concurrent block owners. The current SQLite audit found a write transaction helper and consistent read snapshot, but no durable source-change outbox in the inspected schema; rollback changes event validity and world revision without requiring a new event commit sequence. Any polling candidate must therefore detect invalidation/revision changes, not just a larger event cursor.

**Exit:** no invented storage/API assumptions; open decisions and dependency versions are recorded.

## Phase 1 — pure domain contracts and test oracles

- Finalize record envelope, provenance classes, lifecycle transitions, query/result/error shapes.
- Add schema-level validation helpers only if they can be isolated without changing runtime behavior.
- Turn MEM-001 through MEM-036 into test fixtures and test-oracle specifications, identifying which cases require authorization, Core rollback, or NPC integration.

**Exit:** contracts and acceptance tests are internally consistent; sibling owners have reviewed integration fields.

## Phase 2 — minimal authoritative record store

- Choose storage placement based on transaction audit.
- Implement bounded create/read/version/retract operations behind a service interface.
- Enforce world isolation, host-derived provenance, idempotency, audit, and safe lifecycle transitions.
- Keep memory optional; no public raw-storage route and no vector dependency.
- Do not add summary generation or semantic search in this phase.

**Exit:** tests prove record invariants and existing Core tests pass on the exact head.

## Phase 3 — canonical source reconciliation

- Implement the smallest proven source-change mechanism: use a durable outbox only if Core approves and it can be written atomically with source mutations; otherwise use explicit, recoverable reconciliation that observes event additions **and** rollback/revision/validity changes. A `commit_sequence`-only cursor is insufficient.
- Track source versions/cursors and derived-record invalidation.
- Add crash/replay/out-of-order tests; never claim source consistency beyond observed cursor.

**Exit:** a rollback/correction can be detected and repaired after process restart.

## Phase 4 — authorized retrieval

- Integrate only with an approved trusted authorization policy and recipient binding.
- Implement structured/exact lookup first, with bounded output and stable ordering.
- Add full-text search only if a current backend exists and its freshness/rebuild contract is proven.
- Add semantic search last, behind an optional adapter, with final record/policy revalidation.

**Exit:** no unauthorized data through hits, snippets, counts, pagination, or diagnostics.

## Phase 5 — summaries and compression

- Add source manifest, interval, derivation metadata, conflict preservation, and stale propagation.
- Validate source membership and schema deterministically; test semantic risks separately.
- Keep source records intact by default.

**Exit:** source mutation invalidates/recomputes derived summaries without losing lineage.

## Phase 6 — integration and release

- Agree actor/delivery contracts with NPC; verify Relations/Personality consumers use their own semantics.
- Run complete `npm test` and targeted adversarial tests on the exact PR head.
- Document migration, rollback, recovery, configuration, and disabled-mode behavior.
- Open a separate PR for review; do not merge without explicit owner approval.

## Minimal safe runtime slice recommendation

The first runtime slice should be only a bounded, world-scoped authoritative record service with provenance classification, immutable/versioned corrections, audit, and exact/structured authorized retrieval. Do not begin with vector search, LLM summarization, autonomous NPC delivery, or cross-subsystem transactions. If the repository lacks an approved authorization policy, the slice must remain internal/test-only or deny protected reads rather than inventing a visibility model.