# 03. Persistence and storage contract

Status: proposed. SQLite is a candidate, not yet a frozen implementation choice.

## 1. Canonical data vs derived data

### Canonical / authoritative
- World metadata and pinned World Pack version.
- Entity, relation, fact, resource (if defined by pack), knowledge, goal, plan, task and process records.
- Accepted WorldEvents and append-only audit entries.
- Turn idempotency outcomes and rollback plans/results.
- Story arc/beat definitions and current derived statuses where they cannot be reconstructed cheaply.
- Delivery records, kept separate from world truth.

### Derived / rebuildable
- NPC/world read projections.
- Search/vector indexes and embeddings.
- Summaries, caches, denormalized dashboards.
- Narrative context blocks generated for one model call.
- Event projections and timeline views.

The vector archive is not canonical truth. Its records must carry provenance/access metadata sufficient for filtering; results are revalidated against current structured state. The existing SillyTavern vectorization patch must not be modified during architecture work.

## 2. World isolation options

No decision yet between:
A. one database with strict `world_id` scoping;
B. separate schema/namespace per world, if supported by selected database;
C. separate SQLite file per world.

Separate files can simplify backup/restore and reduce accidental query leakage, but do not by themselves guarantee complete isolation: connection routing, filesystem permissions, cache keys, logs, embeddings and API authorization still matter.

Before selecting, compare:
- number and size of worlds;
- atomic cross-world import requirements;
- backup/restore granularity;
- connection management and migration complexity;
- risk of missing a `world_id` filter;
- memory and file-locking behavior on the target PC;
- how the adapter identifies the active world.

Regardless of physical storage, all canonical records and cache/retrieval keys must be world-scoped and checked.

## 3. Transaction requirements

A successful mutation must atomically persist:
- accepted event/effect records;
- canonical state updates or projection checkpoint;
- append-only audit entries;
- idempotency result;
- causal references;
- new world revision;
- outbox/delivery intent if created by the same operation.

If the chosen storage cannot provide the required atomicity, the design must define a transactional outbox or recovery protocol before implementation.

## 4. Audit and revisions

- `world_revision` is monotonically increasing for committed world mutations and rollback operations.
- `game_time` is independent and may stay constant while revision advances (e.g. rollback or author correction).
- Audit is append-only; corrections add records rather than deleting history.
- Current canonical projections exclude invalidated effects.
- A snapshot is a recovery optimization, not a substitute for causal metadata or the audit contract.

## 5. Backup, migration, recovery

- Create a backup before migrations, bulk author edits and first-use schema upgrades.
- Test restore, not just backup creation.
- Keep backups outside Git and exclude world databases, chat archives, API keys and personal data from commits.
- A World Pack upgrade pins an explicit source and target version, validates compatibility, produces a migration plan and records results.
- If an active process or fact cannot be migrated safely, halt the affected migration and request author review; do not auto-repair canonical truth.

Retention default from current open-decisions register: seven daily and four weekly backups, subject to implementation feasibility and user confirmation.
