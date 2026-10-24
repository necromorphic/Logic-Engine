# 27. Proposal-to-commit boundary

Status: **implemented narrow proposal lifecycle; broader policy and semantic guarantees remain open**. This document is reconciled with `docs/28-proposal-api-stage1.md` and the current runtime slice.

## 1. Current runtime facts

The proposal API is implemented as a narrow lifecycle boundary:

- `POST /v1/worlds/:world_id/proposals` creates a durable proposal using the configured adapter identity.
- `POST /v1/worlds/:world_id/proposals/:proposal_id/approve` requires the separate approval credential and an unchanged base revision/commit sequence.
- `POST /v1/worlds/:world_id/proposals/:proposal_id/commit` commits only an approved proposal and rechecks staleness before canonical commit.
- `POST /v1/worlds/:world_id/proposals/:proposal_id/cancel` is scoped to the adapter that created the proposal.
- The internal events route, when enabled, accepts only an already-approved proposal ID; it does not accept an arbitrary event payload.
- Mechanic template and rule-module registry writes require the separate admin credential.
- Canonical rollback is a privileged correction and requires the separate admin credential for every event type; the event payload is not an authority source.

Proposal creation runs supported validation in a rollback-only transaction preview and does not mutate canonical world state. Canonical event commit, proposal finalization, and proposal commit audit are atomic in SQLite. Proposal creation and commit are idempotent under their documented keys.

This is **not** a complete authorization, semantic validation, causal completeness, generation-lifecycle, or player-agency system. See `docs/28-proposal-api-stage1.md` for the exact endpoint contract and limitations.

## 2. Trust boundary

Treat all model-produced fields as untrusted, including `effects`, `caused_by`, `depends_on`, `read_set`, `causal_links`, `source_text`, and rationale fields.

The model must never receive engine, adapter, admin, internal, or approval credentials, nor direct storage access. These credentials represent service gates; the shared approval credential is not proof of a named human identity.

Only the engine/store transaction may mutate canonical world state. Proposal creation stores a durable proposal and validation report; the canonical commit transaction remains the single operation that writes the world event, projections, audit record, and idempotency result.

## 3. Four distinct validation questions

Do not collapse these into one boolean:

1. **Syntax and supported contract:** Is the normalized request well-formed and limited to fields/effects this runtime implements?
2. **State preconditions:** Does the expected revision/commit sequence match, and do supported `REQUIRES` predicates hold at final commit?
3. **Authority and player agency:** Is the initiating actor permitted to request these effects, and does the action require explicit player/author approval? The current shared approval-token gate does not establish a named actor or implement a complete per-actor policy.
4. **Causal completeness and semantic alignment:** Do the declared reads account for the information used, and do effects match the source action? Current manifest checks do not prove causal completeness. Source text is retained for audit; `needs_review` is a disclosure flag, not proof that semantic review occurred or passed.

A syntactically valid or approved proposal is not thereby proven causally complete or semantically faithful.

## 4. Implemented proposal lifecycle

The current persisted lifecycle includes:

- `pending`: created and stored, not committable;
- `approved`: explicit approval gate passed for the stored proposal while its base revision and commit sequence remain current;
- `needs_review`: validation report indicates semantic alignment needs manual review; this flag does not itself record completion of that review;
- `cancelled`: terminal; cannot be approved or committed;
- `committed`: linked to the canonical event.

The API may expose other validation/status details as documented by the implementation. Do not infer an unimplemented automatic-approval policy from this list: the current slice requires explicit approval for every event.

Server-owned proposal ID, event ID, request hash, base revision, base commit sequence, timestamps, and validation report must not be trusted from client input. Approval does not rewrite the proposal payload. A stale proposal is rejected rather than silently rebound to newer state.

## 5. Staleness, cancellation and retries

- A proposal is bound to the world revision and commit sequence used at creation. A change before approval/commit causes a stale-proposal conflict; do not silently update the snapshot.
- Adapter cancellation is proposal cancellation, not proof that the host generation was cancelled. The engine has no complete generation registry and cannot detect forged or omitted host cancellation signals by itself.
- Replaying proposal creation with the same idempotency key and identical request returns the original proposal; different content under the same key conflicts.
- Commit retries must reuse the same proposal-scoped idempotency identity and must never create a second world event.
- Model calls remain outside short database transactions. Final validation and canonical write must be atomic.

## 6. Protected fields and review policy

The runtime does not yet implement a complete protected-field policy, general actor authorization, or player-character voluntary-action policy. Do not accept a client-provided `protected_fields` list as the authority source. These policies must come from trusted engine configuration or a validated World Pack contract.

Until an explicit policy exists, the runtime must not claim that it can infer whether an action overrides player agency. A shared approval gate is a coarse safety boundary, not a substitute for policy and actor identity.

## 7. Security and migration decision

The adapter-facing path is the persisted proposal API with distinct configured adapter credentials. The internal events route requires both the normal API token and a distinct internal token, and only accepts an already-approved proposal ID. It is not a general-purpose raw event-injection endpoint.

Keep `engine.commitEvent` available internally for the proposal commit implementation and trusted tests. Do not expose direct arbitrary canonical commit to an untrusted model-facing adapter. Never rely on UI hiding or client-side conventions as an authorization boundary.

## 8. Required tests and remaining gaps

The implemented API test suite covers direct-commit isolation, admin-only registry writes, adapter-scoped cancellation, no canonical mutation on proposal creation, separate approval credential, proposal state checks, stale revision/sequence rejection, idempotency, semantic-review disclosure, server-owned field rejection, and internal-route proposal enforcement.

Still required before claiming the broader boundary complete:

- named human/actor identity and fine-grained authorization if deployment requires them;
- a trusted generation registry and verified host cancellation/swipe/regeneration signals;
- server-owned protected-field and player-agency policy;
- a real semantic-alignment procedure rather than a disclosure flag alone;
- causal-completeness guarantees beyond manifest inclusion checks;
- failure-injection coverage for all lifecycle crash points and complete end-to-end host integration.

Until these gaps are implemented and tested, describe the current result as a **narrow proposal-to-commit boundary with explicit limitations**, not a complete semantic or authorization firewall.

## 9. Decisions still required

1. Which event/effect types, if any, may eventually bypass manual approval, and what is the fail-closed behavior when policy is absent?
2. What trusted World Pack/configuration schema declares protected fields and player-character voluntary-action rules?
3. Which host lifecycle signals identify cancellation/swipe/regeneration, and what happens if cancellation arrives after commit?
4. Is semantic alignment checked by deterministic rules, a separately authorized adjudication stage, or left as an explicitly unproven limitation?
5. Which rollback and failure-injection gates must pass before adapter integration is considered safe?
