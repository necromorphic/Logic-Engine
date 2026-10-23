# Minimal executable runtime (prototype)

The first executable slice is host-independent. SillyTavern is a future client adapter, not a dependency of the core. A first-party UI can use the same versioned HTTP API.

## Requirements and startup

Node.js 22.13+ (uses the built-in `node:sqlite` API, which is experimental in supported Node releases). Set `ENGINE_API_TOKEN` to a secret at least 16 characters long, optionally set `ENGINE_DB_PATH`, then run `npm start`. Run `npm test` for contract tests.

## Endpoints

- `GET /health` — public health check.
- `POST /v1/worlds` — create a world with a pinned World Pack ID/version and explicit in-world time.
- `GET /v1/worlds/:id/state` — canonical entity/fact projections.
- `GET /v1/worlds/:id/events` — valid events; add `?include_invalid=true` to include retracted events.
- `GET /v1/worlds/:id/audit` — append-only audit.
- `POST /v1/worlds/:id/events` — validate and commit structured effects.
- `POST /v1/worlds/:id/rollback` — invalidate a causal branch and rebuild projections.

## Implemented in this prototype

- SQLite event log, audit, request-fingerprinted idempotency keys, optimistic revision checks.
- Reusing an idempotency key with a different normalized request returns `IDEMPOTENCY_KEY_CONFLICT`. Legacy keys without a stored fingerprint are rejected as unverifiable rather than replayed silently.
- Schema migration tracking in `schema_migrations`; migrations add request fingerprints, typed causal-link storage, and stable per-world `commit_sequence` values to older databases.
- `entity.upsert`, `entity.delete`, and `fact.set` effects.
- Bounded declarative condition evaluator; arbitrary code execution is not supported. The current runtime subset is `eq`, `neq`, `exists`, numeric comparisons, `in`, `all`, `any`, and `not`. Nested rules use the schema's canonical `rules` array (`not` requires exactly one child); legacy `conditions`/`condition` aliases remain accepted. Rule paths, nesting/list sizes, and numeric comparisons are checked deterministically. Other operators in the broader declarative schema are not yet implemented by this runtime.
- Causal references are validated at commit: `caused_by` must refer to a valid prior event in the same world; `depends_on` must refer to a valid prior event or an existing entity/fact in that world; `read_set` must reference existing entities/facts in the current world. Additive `causal_links[]` supports `READS_SOURCE`, `READS_ENTITY`, and `READS_CLAIM`; unknown typed relations are rejected. `REQUIRES` currently supports `entity_exists` and `entity_attribute` predicates and reevaluates them against reconstructed entity state at the event's historical `commit_sequence` during rollback. Fact predicates, negative/absence reads, and tri-state unknown evaluation are not supported yet. Event IDs may not begin with the reserved `entity:` or `fact:` prefixes.
- Rollback follows explicit `caused_by`, `depends_on`, `read_set`, and supported typed links. `READS_CLAIM` preserves a reader while another valid source supports the referenced fact projection. Independent events remain under the current prototype algorithm.
- Each committed event has a per-world `commit_sequence`, stable across rollback and distinct from `world_revision` and `game_time`. Legacy events are backfilled in committed-history order. Failed transactions do not create a committed cursor; rollback itself does not consume one.
- Event timestamps are recorded when the event is committed. Rollback increments `world_revision` and rebuilds projections without rewinding global `game_time`.
- Ordinary time advance is limited to 12 hours; explicit skip to seven days. Time advances only through accepted event proposals.

## Known gaps and limits

This remains a prototype, not the complete simulation engine. The engine validates caller-supplied causal links but does **not** infer a complete causal graph from the context sent to an LLM. A syntactically valid graph can still omit a real dependency. The current rollback implementation is not yet the full RollbackPlan classifier from `docs/05` and `docs/18`: multiple independent causes, process/task/knowledge recomputation, StoryBeat re-evaluation, and explicit conflict/review records are not implemented.

There is no World Pack loader/validator, NPC autonomy, process scheduler, knowledge access control, StoryBeat engine, vector-memory adapter, ST adapter, first-party UI, or multi-user security model. The current runtime still handles projection-identity references rather than historical entity/fact versions; historical `REQUIRES`, context-manifest verification, and proof of causal completeness require a later versioned contract and tests. Back up prototype databases before upgrading and test restore procedures before storing valuable world state.
