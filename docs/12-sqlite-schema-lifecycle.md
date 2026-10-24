# SQLite schema lifecycle and upgrade contract

Status: adopted storage-maintenance contract for the current SQLite runtime.

## 1. Supported schema version

The current numbered migration ledger is version **5**. The runtime supports opening:
- a new empty database, which receives the inline bootstrap schema and then applies/records numbered migrations 1–5;
- an older database with the historical columns/tables covered by the numbered migrations, which is upgraded on SQLiteStore construction;
- a database already migrated through version 5, which is reopened without reapplying those migrations.

This contract applies to the schema states represented by the repository's fixtures and migration code. It does not promise compatibility with arbitrary hand-edited databases or undocumented pre-release layouts.

## 2. Upgrade sequence

| Version | Upgrade responsibility |
| ---: | --- |
| 1 | Add idempotency_keys.request_hash when missing. |
| 2 | Add world_events.causal_links_json when missing. |
| 3 | Add/backfill world_events.commit_sequence when missing, deterministically ordered by committed revision and event ID per world; create the unique world/sequence index. |
| 4 | Add world_events.context_manifest_id; ensure context_manifests exists and has base_world_revision. |
| 5 | Create the world/event unique index and mechanic_instances table when missing. |

The migration fixture in tests/storage-migrations.test.js exercises a legacy schema with missing columns/indexes/tables, checks preservation of existing rows, verifies commit-sequence backfill, performs canonical write and projected read after migration, closes/reopens the database, and confirms the committed state remains readable. A separate failure-injection test verifies that migration DDL and its ledger entry roll back together and that opening succeeds after the injected failure is removed.

## 3. Transaction and idempotency rules

- Each unapplied numbered migration runs through SQLiteStore.tx(). DDL and the matching schema_migrations row must commit together or roll back together.
- Migration apply() functions should be safe against an already-present column/table/index where practical; the ledger is the authoritative record of which numbered migrations completed.
- A migration version is inserted only after its apply() function succeeds inside the same transaction.
- A failed migration must not be treated as applied. After correcting the underlying cause, reopening may retry it.
- Backfills must have deterministic ordering and preserve existing canonical rows. Do not rewrite event history to make a migration easier.

## 4. Adopted rule for future schema changes

**Every forward schema change must have a new numbered migration.** The inline CREATE TABLE IF NOT EXISTS block is the bootstrap snapshot for new databases; it is not a substitute for an upgrade path for existing databases.

For each future schema change:
1. add a new monotonically increasing migration version with the upgrade logic for older databases;
2. update the inline bootstrap schema so fresh databases start at the latest shape;
3. make the migration idempotent where feasible and keep DDL plus ledger write in one transaction;
4. add a fixture for the prior supported schema, asserting open → migrate → read/write → close/reopen;
5. inject a migration failure and verify no partial DDL or version record survives;
6. run the complete runtime suite on the exact PR head and document the previous/current schema versions.

Do not edit production schema tables manually or mark a migration version as applied without its DDL. Before upgrading a real world database, take a backup and verify restoreability.

## 5. Non-goals

- This contract does not choose a new database engine or move projections out of SQLite.
- It does not make derived projections a second source of truth; canonical events and the current Core write path remain authoritative.
- It does not permit changing past event meaning during migration. Any semantic replay/rollback change needs its own versioned contract and tests.
