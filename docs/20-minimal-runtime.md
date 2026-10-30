# Minimal executable runtime (prototype)

The Core executable is host-independent, but the current `main` already includes a digest-only Host version-ledger API used by a SillyTavern adapter prototype. This is a partial integration surface, not a complete Host lifecycle contract or production-ready Memory → NPC path. The API can accept digest/version identities and conversation bindings; the default inventory verifier is deliberately deny-only, so capture does not establish inventory completeness or `READY`. See [Host/Core contract and PC acceptance gate](94-host-core-contract-and-pc-acceptance.md).

## Requirements and startup

Node.js 22.13+ (uses the built-in `node:sqlite` API, which is experimental in supported Node releases). Set `ENGINE_API_TOKEN` to a secret at least 16 characters long. Configure `ENGINE_ADAPTER_TOKENS` as a JSON object of adapter IDs to distinct secrets for proposal creation/cancellation. Set a separate `ENGINE_APPROVAL_TOKEN` for approvals, `ENGINE_ADMIN_TOKEN` for world creation, global registry reads/writes/audit, and `ENGINE_INTERNAL_TOKEN` only if the restricted internal proposal-commit route is required. Optionally set `ENGINE_DB_PATH`, `ENGINE_POLICY_AUTHORITY_ID`, and `ENGINE_POLICY_GENERATION`, then run `npm start`. The default policy authority is deny-by-default except for the bound actor's own `entity_id`, `entity_type`, and `status`; all other attributes remain withheld. Change the generation whenever the effective policy changes. This default does not authorize mechanic condition reads or enable production Mechanics. See `.env.example`; run `npm test` for contract tests.

## Trusted World Pack catalog

Runtime startup requires `LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH` to point to a deployment-controlled JSON catalog. The API does not accept a catalog path, artifact path, digest, or manifest from a world-creation request.

Catalog shape (one immutable artifact per exact ID/version):

```json
{
  "schema_version": 1,
  "entries": [
    {
      "world_pack_id": "fixture.biological-world",
      "version": "0.1.0",
      "artifact_path": "biological-world.json",
      "sha256": "<64-character lowercase SHA-256 of the exact artifact bytes>"
    }
  ]
}
```

- `artifact_path` must be a relative path to a regular file below the catalog directory; symlink/path traversal outside that directory is rejected.
- The artifact bytes must match the catalog SHA-256 and parse as JSON whose `world_pack_id` and `version` exactly match the entry. SHA-256 is calculated over the original bytes (including whitespace and line endings), not re-serialized JSON.
- IDs/versions are immutable within the catalog. A changed artifact requires a new version and updated deployment catalog. Restart the runtime to load a changed catalog; it is read once at startup.
- Newly created worlds persist the artifact SHA-256 as `world_pack_digest`, and the `world.created` audit record includes that pin. Existing worlds retain a null digest because the prior runtime did not capture an artifact identity; migration does not retroactively assert trust.
- This is **artifact identity and trust pinning, not full World Pack conformance validation**. The existing World Pack format remains partial; unsupported pack fields are not thereby executed or validated. The digest is not a signature: trust derives from control of the deployment catalog and artifact directory.
- The low-level `LogicEngine` constructor remains usable without a catalog for isolated tests/embedding. The shipped runtime entry point fails closed when the catalog path is missing, and passes the loaded catalog to world creation.

## Host/Adapter digest ledger (partial; fail-closed)

The following routes exist in the current Core runtime:

- `POST /v1/host-conversation-bindings` — administrator binds a configured adapter ID and stable Host conversation ID to a canonical Core world. Requires `x-admin-token`.
- `POST /v1/host-conversation-bindings/resolve` — resolves a binding for the authenticated adapter identity.
- `POST /v1/host-version-ledger/capture` — accepts `conversation_id`, `message_id`, `version_id`, explicit `parent_version_id`, lowercase SHA-256 `content_sha256`, and boolean `active`/`deleted`. Requires authenticated adapter credentials and a prior binding. Raw message text and caller-supplied `world_id` are rejected.

Configure the separate digest-ledger file with `ENGINE_HOST_VERSION_LEDGER_DB_PATH`; it must not alias `ENGINE_DB_PATH` or `LOGIC_ENGINE_COORDINATOR_DB_PATH`. The ledger records identities, digests, active/deleted flags and lineage metadata, not raw message content.

**Critical limitation:** `src/index.js` currently supplies `verifyInventorySnapshot: async () => false`. Consequently, successful capture or binding is not proof of a complete Host inventory and must not be interpreted as `READY`. The browser-side SillyTavern patch is maintained as a separate review-only candidate; it is not automatically installed by Core. Do not enable production Memory → NPC or outbound dispatch on the strength of these endpoints.

## Trusted initial/imported knowledge sources

`ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES` is an optional deployment-owned JSON array. The default `[]` approves no source. Each record requires `world_pack_id`, `world_pack_version`, `source_kind` (`author_initial` or `imported`), `source_ref`, `authorization_ref`, and the SHA-256 digest of the exact UTF-8 source file bytes. Imported entries additionally require an absolute local `source_path`; the path is deployment configuration, never request data. Author-initial entries must not set `source_path`.

Example shape (replace all IDs and the digest with the exact values for your approved bundle):

```json
[
  {
    "world_pack_id": "example.world",
    "world_pack_version": "1.0.0",
    "source_kind": "imported",
    "source_ref": "import:example.world@1.0.0",
    "authorization_ref": "rule:import-approval-v1",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "source_path": "C:\\LogicEngine\\trusted-sources\\example-world.json"
  }
]
```

The importer accepts a `source_ref` only, reads the configured local file, rejects symlinks/non-regular files and files larger than 1 MiB, computes SHA-256 itself, and requires an exact allowlist match before validating every subject/fact assignment against the target world's canonical state. Direct caller-supplied bytes for `imported` sources remain rejected. No public HTTP import endpoint is exposed.

## Endpoints

- `POST /v1/worlds` — create a world with a pinned World Pack ID/version and explicit in-world time (requires `x-admin-token`).
- `POST /v1/worlds/:id/proposals` — create an adapter-owned proposal (requires configured adapter credentials).
- `GET /v1/worlds/:id/proposals/:proposal_id` — retrieve a proposal as its creating adapter or a trusted administrator.
- `POST /v1/worlds/:id/proposals/:proposal_id/approve` — approve a proposal (requires `x-approval-token`; valid body is `{}`).
- `POST /v1/worlds/:id/proposals/:proposal_id/commit` — commit through the creating adapter's proposal lifecycle.
- `POST /v1/worlds/:id/proposals/:proposal_id/cancel` — cancel a proposal as its creating adapter.
- `POST /v1/worlds/:id/authorized-read` — request actor-bound, policy-filtered entity fields (requires configured adapter credentials and a valid actor binding); this is not a complete knowledge/belief system.
- `POST /v1/worlds/:id/actor-bindings` — bind an adapter ID to an entity (requires `x-admin-token`).
- `POST /v1/worlds/:id/actor-bindings/resolve` — resolve the actor bound to the authenticated adapter.
- `DELETE /v1/worlds/:id/actor-bindings/:adapter_id/:entity_id` — revoke an actor binding (requires `x-admin-token`).
- `POST /v1/worlds/:id/relationship-transitions` — commit a typed directed Relationship transition (requires `x-admin-token`; not an NPC-facing write capability).
- `POST /v1/worlds/:id/context-manifests` — register a generation-bound context manifest (requires `x-engine-internal-token`).
- `GET /v1/worlds/:id/mechanic-instances` — list mechanic instances (requires `x-admin-token`).
- `POST /v1/worlds/:id/mechanic-instances` — create a mechanic instance from an exact registered template version (requires `x-admin-token`).
- `POST /v1/worlds/:id/mechanic-instances/:instance_id/enable` and `/disable` — change instance lifecycle (requires `x-admin-token`).
- `GET /v1/mechanic-templates` — list immutable mechanic-template versions (requires `x-admin-token`).
- `POST /v1/mechanic-templates` — validate and register an immutable template version (requires `x-admin-token`).
- `GET /v1/mechanic-templates/:template_id/:version` — retrieve one exact template version (requires `x-admin-token`).
- `GET /v1/rule-modules` — list registered versioned rule-module manifests (requires `x-admin-token`).
- `POST /v1/rule-modules` — validate and register a versioned rule-module manifest (requires `x-admin-token`).
- `GET /v1/rule-modules/:module_id/:version` — retrieve one exact module manifest (requires `x-admin-token`).
- `GET /v1/mechanics/audit` — append-only registry audit records (requires `x-admin-token`).
- `GET /v1/worlds/:id/state` — canonical entity/fact projections; raw reads require trusted internal/admin credentials.
- `GET /v1/worlds/:id/events` — valid events; add `?include_invalid=true` to include retracted events (trusted internal/admin credentials required).
- `GET /v1/worlds/:id/audit` — append-only audit (trusted internal/admin credentials required).
- `POST /v1/worlds/:id/events` — restricted internal route; requires the internal credential and an already-approved `proposal_id`, never an arbitrary event payload.
- `POST /v1/worlds/:id/time-configurations` — register and activate an immutable calendar + TimePolicy configuration for the world's pinned World Pack (requires `x-admin-token`).
- `GET /v1/worlds/:id/time-configurations/current` — read the active or explicitly selected configuration version (requires a trusted admin/internal credential).
- `GET /v1/worlds/:id/time` — project the canonical coordinate through the active calendar (requires a trusted admin/internal credential).
- `POST /v1/worlds/:id/time-triggers` — register an immutable future trigger with a Core-validated effect proposal (requires `x-engine-internal-token`).
- `GET /v1/worlds/:id/time-triggers` and `GET /v1/worlds/:id/time-triggers/:trigger_id` — inspect persisted trigger lifecycle state (internal credential required).
- `POST /v1/worlds/:id/time-triggers/:trigger_id/cancel` — cancel unclaimed pending work (internal credential required).
- `POST /v1/worlds/:id/time-actions` — resolve an action's duration through the active TimePolicy, process registered triggers inside that interval, and commit the action at the confirmed target (requires `x-engine-internal-token`). The action request accepts no caller-controlled duration or event identity. GET and resume use the same durable operation ID.
- `POST /v1/worlds/:id/time-advances` — plan and run a durable time-advance operation (requires `x-engine-internal-token`); provide an expected revision and target millisecond coordinate. Omit `triggers` to use the durable registry, or pass a trigger set for request-scoped compatibility mode.
- `GET /v1/worlds/:id/time-advances/:operation_id` — retrieve persisted operation/checkpoint state (internal credential required).
- `POST /v1/worlds/:id/time-advances/:operation_id/resume` — resume a persisted running operation from its last atomically committed segment (internal credential required).
- `POST /v1/worlds/:id/processes` — create a durable world-scoped process with milestone triggers (internal credential required; see `docs/22-process-manager-runtime.md`).
- `GET /v1/worlds/:id/processes` and `GET /v1/worlds/:id/processes/:process_id` — list or inspect persisted processes (internal credential required).
- `POST /v1/worlds/:id/processes/:process_id/pause`, `/resume`, and `/cancel` — transition process lifecycle using expected checkpoint version and idempotency key (internal credential required).
- `POST /v1/worlds/:id/rollback` — invalidate a causal branch and rebuild projections (requires `x-admin-token`).
## Trust-boundary note

The API requires the general bearer token. Proposal creation and cancellation additionally require a configured per-adapter identity (`x-adapter-id`, `x-adapter-token`); cancellation is restricted to the creating adapter. Registry writes require `x-admin-token`. Approval requires the separate `x-approval-token`, which is a shared-secret gate and not proof of a named human identity. The internal events route cannot bypass the proposal lifecycle: it accepts only an already-approved `proposal_id`. Do not expose any credential to the LLM.

## Implemented in this prototype

- SQLite event log, audit, request-fingerprinted idempotency keys, optimistic revision checks.
- Reusing an idempotency key with a different normalized request returns `IDEMPOTENCY_KEY_CONFLICT`. Legacy keys without a stored fingerprint are rejected as unverifiable rather than replayed silently.
- Schema migration tracking in `schema_migrations`; migrations add request fingerprints, typed causal-link storage, and stable per-world `commit_sequence` values to older databases.
- `entity.upsert`, `entity.delete`, and `fact.set` effects.
- Immutable mechanics registries: exact `(template_id, version)` and `(module_id, version)` keys, contract validation, stable content hashes, rejection of changed content under an existing version, exact-version retrieval, and append-only registry audit.
- Mechanics template/module registration is infrastructure only: registration does not execute module code or attach/enable a mechanic in a world. World-scoped mechanic-instance lifecycle routes are implemented, but activation does not imply a general mechanic executor; general trusted actor roles and conflict execution remain unimplemented. The bounded generic Process Manager lifecycle is implemented separately; see `docs/22-process-manager-runtime.md`.
- Bounded declarative condition evaluator; arbitrary code execution is not supported. The current runtime subset is `eq`, `neq`, `exists`, numeric comparisons, `in`, `all`, `any`, and `not`. Nested rules use the schema's canonical `rules` array (`not` requires exactly one child); legacy `conditions`/`condition` aliases remain accepted. Rule paths, nesting/list sizes, and numeric comparisons are checked deterministically. Other operators in the broader declarative schema are not yet implemented by this runtime.
- Causal references are validated at commit: `caused_by` must refer to a valid prior event in the same world; `depends_on` must refer to a valid prior event or an existing entity/fact in that world; `read_set` must reference existing entities/facts in the current world. Additive `causal_links[]` supports `READS_SOURCE`, `READS_ENTITY`, `READS_CLAIM`, and the restricted `REQUIRES` predicate contract; unknown typed relations are rejected. `REQUIRES` supports `entity_exists`, `entity_absent`, `entity_attribute`, `fact_value`, and `fact_absent` predicates and reevaluates them against reconstructed entity/fact history at the event's historical `commit_sequence` during rollback. A destroyed entity counts as absent for `entity_absent` while remaining as a tombstone identity. A conflicted fact evaluates to `unknown`: new commits requiring it are rejected with `REQUIRED_PREDICATE_UNKNOWN`, while rollback preserves an affected still-valid event and reports its ID in `requires_review_event_ids` if recomputation remains unknown. General predicate composition and other forms of negative/absence reads are not supported yet. Event IDs may not begin with the reserved `entity:` or `fact:` prefixes.
- Rollback follows explicit `caused_by`, `depends_on`, `read_set`, and supported typed links. `READS_CLAIM` preserves a reader while another valid source supports the referenced fact projection. Independent events remain under the current prototype algorithm.
- Each committed event has a per-world `commit_sequence`, stable across rollback and distinct from `world_revision` and `game_time`. Legacy events are backfilled in committed-history order. Failed transactions do not create a committed cursor; rollback itself does not consume one.
- Canonical game time is stored as an integer millisecond coordinate relative to the world's initial time; the ISO `game_time` remains a compatibility projection. Migration 6 backfills existing worlds and event history.
- T3 provides atomic bounded commits for independent event segments. T4 provides deterministic due-work planning over `(from, to]`. T5 persists time-advance operations and resumes from an atomically committed segment checkpoint; the internal start/status/resume routes require `x-engine-internal-token`.
- T6 adds immutable, audited per-world calendar/TimePolicy configurations tied to the pinned World Pack ID/version. With a configuration active, Core resolves action duration from fixed/range/category rules; caller-supplied mismatched durations are rejected. Calendar mapping changes after event history require an explicit author rebase policy.
- Event timestamps are recorded when the event is committed. Rollback increments `world_revision` and rebuilds projections without rewinding global `game_time`.
- Worlds without an active TimePolicy retain legacy 12-hour action / seven-day skip limits for the legacy event path. The new timed-action operation requires an active TimePolicy and processes registered triggers before committing action effects. Direct timed commits require an expected revision and are rejected if they would cross registered pending triggers. With a TimePolicy, the configured duration rules and whole-operation skip ceiling apply; synthetic scheduler events are chunked to at most seven days, with a 1,024-segment operation cap. Time advances only through accepted Core events.

## Known gaps and limits

This remains a prototype, not the complete simulation engine. The engine validates caller-supplied causal links but does **not** infer a complete causal graph from the context sent to an LLM. A syntactically valid graph can still omit a real dependency. The current rollback implementation is not yet the full RollbackPlan classifier from `docs/05` and `docs/18`: multiple independent causes, process/task/knowledge recomputation, StoryBeat re-evaluation, and explicit conflict/review records are not implemented.

There is no World Pack loader/validator, autonomous background scheduler, NPC autonomy, knowledge access control, StoryBeat engine, vector-memory adapter, ST adapter, first-party UI, or human multi-user role/identity model. The persisted trigger registry is invoked by an explicit internal time-advance request; it does not advance time from system-clock ticks. The current runtime still handles projection-identity references rather than historical entity/fact versions; historical `REQUIRES`, context-manifest verification, and proof of causal completeness require a later versioned contract and tests. Back up prototype databases before upgrading and test restore procedures before storing valuable world state.
