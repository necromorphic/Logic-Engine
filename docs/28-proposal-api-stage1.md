# 28. Proposal API — Stage 1 runtime contract

Status: implemented in the proposal API vertical slice. This is a narrow lifecycle boundary, not a complete policy or semantic validation system.

## Endpoints

All endpoints except `GET /health` require `Authorization: Bearer <ENGINE_API_TOKEN>`.

- `POST /v1/worlds/:world_id/proposals` creates a durable proposal. It requires a configured adapter identity via `x-adapter-id` and `x-adapter-token`. Body:
  `{ "idempotency_key": "...", "source_text": "...", "event": { ...event payload... } }`
- `POST /v1/worlds/:world_id/proposals/:proposal_id/approve` requires the additional `x-approval-token: <ENGINE_APPROVAL_TOKEN>` header and an empty JSON body.
- `POST /v1/worlds/:world_id/proposals/:proposal_id/commit` commits an approved proposal after rechecking its captured revision and commit sequence.
- `POST /v1/worlds/:world_id/proposals/:proposal_id/cancel` cancels a pending or approved proposal only for the adapter that created it; it requires that adapter's `x-adapter-id` and `x-adapter-token`. It is not proof that a host generation was actually cancelled.
- `POST /v1/worlds/:world_id/events` is disabled unless `ENGINE_INTERNAL_TOKEN` is configured. Even with that credential, it accepts only `proposal_id` for a proposal already approved; it cannot directly commit arbitrary event payloads.
- `POST /v1/mechanic-templates` and `POST /v1/rule-modules` require `x-admin-token: <ENGINE_ADMIN_TOKEN>` in addition to the API bearer token.

Set `ENGINE_API_TOKEN`, `ENGINE_APPROVAL_TOKEN`, `ENGINE_INTERNAL_TOKEN`, and `ENGINE_ADMIN_TOKEN` to different random secrets of at least 16 characters. Configure `ENGINE_ADAPTER_TOKENS` as a JSON object mapping unique adapter IDs to distinct secrets of at least 16 characters, for example `{"sillytavern-main":"replace-with-a-random-secret"}`. Do not expose any of these secrets to the model. Adapter credentials are separate from general API access; each proposal records its creating adapter, and only that adapter can cancel it. The approval token remains a shared credential, not proof of a named human identity or a multi-user role system.

## Lifecycle and fail-closed behavior

1. Proposal creation runs the existing deterministic event schema, effect, causal-reference, revision, and REQUIRES checks inside a rollback-only transaction preview. It then stores a server-generated proposal ID and event ID, hash, base world revision, base commit sequence, exact event payload, source text, validation report, and timestamps. The preview is fully rolled back and does not mutate canonical world state.
2. All proposals start in `pending`; this first slice intentionally requires explicit approval for every event because no trustworthy per-effect auto-approval policy exists yet.
3. Approval is permitted only for a pending proposal whose base revision and commit sequence are still current. Approval does not rewrite the proposal payload.
4. Commit is permitted only for `approved` proposals. It rejects changed revision/sequence as `409 STALE_PROPOSAL`, injects a server-owned expected revision and proposal-scoped idempotency key, then runs the existing `commitEvent` validation/commit path.
5. Cancellation changes pending/approved proposals to `cancelled` only when requested by the adapter that created the proposal; cancelled proposals cannot be approved or committed. A committed proposal cannot be cancelled.
6. Repeating proposal creation with the same idempotency key and same request returns the original proposal. Reusing the key with different content fails with a conflict.

## Current limitations (not implied guarantees)

- Proposal creation validates the envelope and basic required event fields; full event schema, causal references, effects and `REQUIRES` conditions are validated by the canonical commit path. Approval is not a claim that all those conditions have been proven.
- The proposal hash is an audit fingerprint, not a digital signature. Proposal content is immutable through the API, and the approval action is tied to the stored proposal ID/hash in audit.
- Source text is retained for audit only. There is no semantic judge proving that effects match the source text. Proposals with non-empty effects and non-empty source text report `validation_result.status = "needs_review"` and `requires_manual_semantic_review = true`; this is a disclosure flag, not a semantic correctness guarantee.
- Existing context-manifest checks validate declared reads against the manifest but do not prove causal completeness.
- No protected-field/player-agency policy, general actor authorization, or generation registry is implemented. The adapter must call `cancel` when it authoritatively detects a cancelled or superseded generation; a forged or omitted cancellation signal cannot be detected by this service alone.
- Canonical event commit, proposal status transition, and proposal commit audit are enclosed in one SQLite transaction. The storage transaction helper uses nested savepoints so the existing event commit logic can be reused without opening an independent transaction. A failure in proposal finalization rolls back the canonical event as well.
- The internal events route requires the regular API token plus the distinct internal token, and can only commit an already-approved proposal by ID. It is not a general-purpose event injection or maintenance endpoint.

## Acceptance coverage

The API tests cover direct-commit isolation, admin-only registry writes, adapter-scoped proposal cancellation, no canonical mutation on proposal creation, separate approval credential, pending/approved/committed/cancelled state checks, stale revision/sequence rejection, proposal idempotency, semantic-review disclosure, server-owned field rejection, and internal-route proposal enforcement.
