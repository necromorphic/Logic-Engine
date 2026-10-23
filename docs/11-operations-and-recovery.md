# 11. Operations, backup and recovery

Status: proposed operational contract for a future local runtime.

## 1. Runtime boundary

Initial target: engine service on the user's PC; SillyTavern remains on Android/Termux and connects over a private trusted network. This is a target, not yet verified on the actual device setup.

- Bind the API to loopback by default during local development.
- Remote access must require explicit configuration and authentication; never expose an unauthenticated engine API to the public internet.
- Store provider credentials only in the selected secret store/environment configuration, never in world state, logs, chat, or Git.
- Redact secrets and sensitive narrative content from diagnostic logs by default.
- Use bounded request sizes, timeouts, concurrency and model retries.

## 2. Backup and restore

Create backup:
- before schema migration;
- before World Pack migration;
- before bulk author edits;
- before rollback engine upgrades;
- at configured startup/scheduled intervals where safe.

A backup is only accepted as useful after a restore test confirms the world can be loaded and its canonical state/revision verified. Keep backups outside the Git repository.

## 3. Startup recovery

At startup:
1. validate storage schema and migration level;
2. verify pinned World Pack versions are available;
3. recover incomplete delivery jobs without recommitting world effects;
4. reconcile durable scheduler jobs with canonical process records;
5. rebuild derived projections and retrieval indexes as needed;
6. identify incomplete rollback plans and resume idempotently or mark needs_review;
7. report unresolved corruption or missing packs instead of silently inventing replacements.

## 4. Observability

Every diagnostic event should include correlation IDs (world, turn, generation, event, revision and rollback where applicable) without dumping full secrets or unrestricted NPC memories. Logs should distinguish proposal, validation, commit, projection, and delivery errors.

## 5. Data safety

Never commit:
- world databases or snapshots;
- chat archives and embeddings;
- API keys, cookies, tokens or .env files;
- private character/persona data;
- runtime logs containing private content.

Use repository ignore rules before the first runtime database is created.
