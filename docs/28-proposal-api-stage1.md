# 28. Proposal API — Stage 1 runtime contract

Status: implemented in the proposal API vertical slice. This is a narrow lifecycle boundary, not a complete policy or semantic validation system.

## Endpoints

All endpoints except `GET /health` require `Authorization: Bearer <ENGINE_API_TOKEN>`.

- `POST /v1/worlds/:world_id/proposals` creates a durable proposal. Body:
  `{ "idempotency_key": "...", "source_text": "...", "event": { ...event payload... } }`
- `POST /v1/worlds/:world_id/proposals/:proposal_id/approve` requires the additional `x-approval-token: <ENGINE_APPROVAL_TOKEN>` header and an empty JSON body.
- `POST /v1/worlds/:world_id/proposals/:proposal_id/commit` commits an approved proposal after rechecking its captured revision and commit sequence.
- `POST /v1/worlds/:world_id/proposals/:proposal_id/cancel` cancels a pending or approved proposal. It is intended for a trusted adapter lifecycle signal; it is not proof that a host generation was actually cancelled.
- `POST /v1/worlds/:world_id/events` is disabled unless `ENGINE_INTERNAL_TOKEN` is configured, and then requires `x-engine-internal-token` as well as the normal API bearer token.

Set `ENGINE_API_TOKEN`, `ENGINE_APPROVAL_TOKEN`, and `ENGINE_INTERNAL_TOKEN` to different random secrets of at least 16 characters. Do not expose these secrets to the model. The approval token is an independent gate, but the current runtime does not identify a human by name or provide a multi-user role system.

## Lifecycle and fail-closed behavior

1. Proposal creation stores a server-generated ID, hash, base world revision, base commit sequence, exact event payload, source text, and timestamps. It does not mutate canonical world state.
2. All proposals start in `pending`; this first slice intentionally requires explicit approval for every event because no trustworthy per-effect auto-approval policy exists yet.
3. Approval is permitted only for a pending proposal whose base revision is still current. Approval does not rewrite the proposal payload.
4. Commit is permitted only for `approved` proposals. It rejects changed revision/sequence as `409 STALE_PROPOSAL`, injects a server-owned expected revision and proposal-scoped idempotency key, then runs the existing `commitEvent` validation/commit path.
5. Cancellation changes pending/approved proposals to `cancelled`; cancelled proposals cannot be approved or committed. A committed proposal cannot be cancelled.
6. Repeating proposal creation with the same idempotency key and same request returns the original proposal. Reusing the key with different content fails with a conflict.

## Current limitations (not implied guarantees)

- Proposal creation validates the envelope and basic required event fields; full event schema, causal references, effects and `REQUIRES` conditions are validated by the canonical commit path. Approval is not a claim that all those conditions have been proven.
- The proposal hash is an audit fingerprint, not a digital signature. Proposal content is immutable through the API, and the approval action is tied to the stored proposal ID/hash in audit.
- Source text is retained for audit only. There is no semantic judge proving that effects match the source text.
- Existing context-manifest checks validate declared reads against the manifest but do not prove causal completeness.
- No protected-field/player-agency policy, general actor authorization, or generation registry is implemented. The adapter must call `cancel` when it authoritatively detects a cancelled or superseded generation; a forged or omitted cancellation signal cannot be detected by this service alone.
- Canonical event commit and proposal status/audit update are two transactions. The canonical event is idempotent under a server-generated proposal key, so retry after a process interruption can recover the committed result, but this is not a single atomic transaction across both records. A later hardening step should move proposal finalization into the same storage transaction as canonical commit.
- The direct internal route still requires the regular API token plus the distinct internal token. Its intended use is trusted server-side maintenance/adapters only.

## Acceptance coverage

The API tests cover direct-commit isolation, no canonical mutation on proposal creation, separate approval credential, pending/approved/committed/cancelled state checks, stale revision rejection, proposal idempotency, server-owned field rejection, and internal context-manifest commits.
