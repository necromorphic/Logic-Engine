# Stage B — Core-owned initial knowledge acquisition implementation report

Status: implementation candidate on `feat/npc-initial-acquisition-stage-b-20261028`; **Stage B exit gate remains blocked** until the trusted authoring/import call path and imported-source authority are resolved. This report distinguishes implemented code from unavailable capabilities.

## 1. Implemented in this branch

- `src/application/initial-knowledge-acquisition.js` adds an internal Core service for assigning `author_initial` knowledge. It is not mounted as an HTTP endpoint and is not connected to NPC, Memory, or Host input.
- The service requires an existing, non-destroyed canonical subject in the specified world; an exact currently valid `fact.set` claim; the claim's source event; and an exact `(world_revision, commit_sequence)` cursor.
- The Core derives the acquisition identifier and source-claim SHA-256 digest. The caller cannot provide a provenance object, issuer label, source predicate, or source value.
- The acquisition is recorded as a dedicated `knowledge.acquire` effect in the existing canonical event history. It uses the current revision/commit sequence, idempotency, event causality, transaction, projection rebuild, and rollback lifecycle rather than a separate event log.
- `knowledge_acquisitions` is a rebuildable SQLite projection of valid Core events, not a second source of truth. Migration 13 creates it.
- Exact source-event dependency means rollback of the source event invalidates the acquisition event. Rebuild removes invalid records from the active projection. Destroyed/unavailable subjects retain historical records but receive `subject_unavailable` status.
- Ordinary event preparation rejects `knowledge.acquire`. Store commit independently checks the trusted operation flag, subject, exact source claim, source hash, snapshot cursor, causal links, and visibility status.
- Visibility is fixed to `unclassified`. This record does not grant permission to disclose the source to a model. No read API exists, and no consumer can use these records through the public API.

## 2. Verified source boundaries

- Adapter-to-actor binding already exists in `src/application/actor-bindings.js`, with coverage in `tests/actor-binding.test.js`. This is a separate boundary: initial assignment is author/import initiated, not an actor-requested read.
- Canonical fact claims are keyed to their source event in `fact_claims`; valid event projections are rebuilt from `world_events`. The new record binds to one exact source event rather than inferring acquisition from a fact, manifest, prompt, or retrieval result.
- No new public endpoint was added. The existing HTTP event path cannot set the privileged `allowKnowledgeAcquisition` option and rejects the effect.

## 3. Deliberately unsupported / remaining blocker

**Imported acquisition is fail-closed.** The repository does not contain an executable trusted World Pack/import loader or an import-source registry/manifest contract that can prove that a source event and package digest came from a trusted import. The internal service rejects `acquisition_kind: imported` with `UNSUPPORTED_TRUSTED_IMPORT_SOURCE`; it does not treat caller-supplied import labels or digests as authority.

There is also no production caller for the internal authoring service yet. This branch adds the Core primitive and its real persistence/rollback behavior, but does not expose a new public endpoint to make the missing authoring/import trust contract appear solved. The next required work is a reviewed trusted authoring/import source contract that:
1. identifies the actual trusted caller and server-derived authority context;
2. defines how import package identity/content digest is verified and bound to source events;
3. defines atomicity/idempotency for the import source without overloading ordinary `fact.set`;
4. authorizes the call into this Core primitive without granting NPC, Memory, or Host self-assignment authority.

Until that exists, this implementation must not be described as a complete production acquisition path. This is the specific Stage B exit blocker, not a reason to create a parallel NPC/Memory store or a public write endpoint.

## 4. Scope explicitly not implemented

- No actor/purpose/snapshot-bound acquisition read/filter; that is Stage C.
- No belief state, confidence, forgetting policy, communication, observation, documents, inference, rumors, or delivery/receipt state.
- No NPC adapter, Memory consumer, prompt injection, or production dispatch.
- No change to Memory → NPC; it remains **DISABLED / FAIL-CLOSED**.

## 5. Tests and exact commands

The focused tests passed locally on the worktree based on the uploaded repository snapshot (Node v22.16.0):
- `node --import ./tests/configure-test-env.js --test tests/initial-knowledge-acquisition.test.js` — 14 passed.
- `node --import ./tests/configure-test-env.js --test tests/storage-migrations.test.js` — 3 passed.
- `node --import ./tests/configure-test-env.js --test tests/actor-binding.test.js` — 2 passed.
- `node --import ./tests/configure-test-env.js --test tests/causality-contract.test.js` — 43 passed.
- `node --import ./tests/configure-test-env.js --test tests/snapshot-read.test.js` — 12 passed.
- `node --import ./tests/configure-test-env.js --test tests/tri-state-rules.test.js` — 5 passed.

All 69 test files in that uploaded snapshot were run in eight batches: 735 subtests passed, 0 failed. The repository-wide suite was not run as one monolithic command, and the uploaded snapshot predates the current main head in some Core files. Therefore these are local regression results, not evidence that the current PR head passes CI. The exact PR-head tests must be verified against current main before Stage B can be called complete.

No production-path test is claimed for imported source authority, a production authoring caller, an actor-relative knowledge read, or final model serialization.
