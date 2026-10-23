# 27. Proposal-to-commit boundary

Status: architecture contract and implementation gap analysis; this document does not claim that a proposal API is implemented.

## 1. Current runtime facts

The current authenticated `POST /v1/worlds/:id/events` route calls `engine.commitEvent(id, body)` directly. `commitEvent` validates the supported event/effect payload, checks revision and supported causal contracts, and delegates the atomic canonical write to the store.

This is not an unvalidated SQL write: the current route requires the shared bearer token and the engine performs its implemented validations. However, there is no persisted proposal resource, approval state, or generation-cancellation state between an adapter-supplied payload and canonical commit. Any caller that possesses the API bearer token can submit a commit-ready event directly. The current runtime also cannot prove that effects semantically match source prose, that caller-supplied causal links are complete, or that the caller has authority under world-specific/player-agency rules.

The intended lifecycle in `docs/02-turn-event-delivery-lifecycle.md` is therefore ahead of the executable runtime. Its statements that the adapter cannot bypass validation and that proposals are validated before commit should be read as target-contract statements, not as proof that a proposal/approval workflow currently exists.

## 2. Trust boundary

Treat all model-produced fields as untrusted, including `effects`, `caused_by`, `depends_on`, `read_set`, `causal_links`, `source_text`, and rationale fields.

The model must never receive the engine bearer token or direct storage access. The existing bearer token is a service-level credential, not an actor identity or an approval credential. Because the current API has one shared token, it does not distinguish trusted adapter calls from human approval or enforce per-actor permissions.

Only the engine/store transaction may mutate canonical world state. A future proposal endpoint must not become a second write path: proposal creation stores a pending/validated record, while the existing canonical commit transaction remains the single operation that writes the world event, projections, audit record, and idempotency result.

## 3. Four distinct validation questions

Do not collapse these into one boolean:

1. **Syntax and supported contract:** Is the normalized request well-formed and limited to fields/effects this runtime implements?
2. **State preconditions:** Does the requested revision match, and do supported `REQUIRES` predicates hold against the state used for final commit?
3. **Authority and player agency:** Is the initiating actor permitted to request these effects, and does the action require explicit player/author approval? This needs an explicit policy source; it cannot be inferred from a generic entity attribute or an LLM rationale.
4. **Causal completeness and semantic alignment:** Do the declared reads account for the information used, and do the effects match the source action? Current context manifests can validate declared-read inclusion, but they do not prove completeness. Storing source text and rationale supports later audit but does not itself validate semantic alignment.

A syntactically valid request is not thereby authorized, causally complete, or semantically faithful.

## 4. Minimal future vertical slice

Before exposing proposal endpoints to an adapter, implement a persisted proposal state machine with at least:

- `pending`: received and stored, not eligible for commit;
- `validated`: supported checks passed and policy allows automatic commit;
- `needs_review`: one or more checks require a human decision;
- `approved`: a named authenticated approver accepted this exact proposal hash;
- `rejected` / `cancelled`: terminal and never committable;
- `committed`: linked to exactly one canonical event.

Server-owned fields should include proposal ID, status, timestamps, normalized request hash, validation report, base world revision, base commit sequence, and the resulting event ID. Client-supplied values must not be trusted for these fields. Keep `generation_id`, `context_manifest_id`, source-message identity, and source text as input evidence only after validation and size limits.

The minimum endpoint shape under consideration is:

- `POST /v1/worlds/:id/proposals`: normalize, validate basic structure, bind to a current world snapshot, persist, and return proposal ID/status/report;
- `POST /v1/worlds/:id/proposals/:proposal_id/approve`: record a distinct authenticated approval for a proposal hash, only if policy says review is required;
- `POST /v1/worlds/:id/proposals/:proposal_id/commit`: atomically re-check proposal status/hash, generation cancellation state, base revision, manifest binding, supported preconditions, and idempotency before writing the canonical event.

These are design targets, not current endpoints. Do not implement an `approve` route until the project defines who may approve and how that identity is authenticated. A reason string is useful audit metadata but is not authentication.

## 5. Staleness, cancellation and retries

- Bind a proposal to the world revision and commit sequence used to build its context. If the world changes before commit, reject with a stable conflict such as `409 STALE_PROPOSAL`, or require an explicit revalidation that creates a new proposal version/hash. Never silently update the proposal's snapshot.
- A generation ID is correlation metadata, not proof that a generation is still current. Cancellation/regeneration needs an explicit adapter signal and persisted state. Until that lifecycle exists, do not claim that the engine detects cancelled generations.
- Idempotency must be scoped to proposal creation and commit separately. Replaying proposal creation with the same key and same request hash returns the same proposal; a different hash must conflict. Replaying commit returns the same committed event, never a second event.
- Approval must bind to the exact immutable proposal hash. Any mutation to its effects or evidence invalidates approval and requires a new proposal/version.
- Keep model calls outside short database transactions. The final state check and canonical write must be atomic.

## 6. Protected fields and review policy

Do not accept a client-provided `protected_fields` list as the source of truth: a caller could omit a field from it. Protected-field policy must be server-owned and eventually derive from validated World Pack policy or engine configuration. Until such a policy exists, the runtime cannot claim to enforce character-specific protected fields or voluntary player-character agency.

Do not automatically send every NPC action to review without a defined policy; equally, do not automatically commit every validated action. The initial policy must explicitly define which event/effect classes are auto-committable, which require player/author approval, and what happens when the policy is unknown. Unknown policy should fail closed into `needs_review` or rejection, not be guessed by the model.

## 7. Security and migration decision

The current route is bearer-authenticated, so it is not literally an unauthenticated public write endpoint. Its risk depends on who receives that token. If the future SillyTavern/model-facing adapter holds the same token, it can call the direct commit route today.

Before treating proposals as a security boundary, either remove `POST /events` from the adapter-facing API or protect it with a distinct internal credential unavailable to the adapter. Do not rely on naming, UI hiding, or a client-side convention. Keep `engine.commitEvent` available internally for the proposal commit implementation and trusted tests, but do not expose it through the same credential used for untrusted proposal submission.

## 8. Required tests before claiming the boundary exists

- Adapter-facing credentials cannot invoke direct canonical commit.
- Malformed proposal is rejected without proposal, event, projection, audit, or idempotency side effects.
- Stale proposal cannot commit after another event changes the world revision.
- Approval is rejected for the wrong state and is bound to the immutable proposal hash.
- Cancelled/superseded generation cannot commit once cancellation integration is implemented.
- Repeated proposal creation and commit are idempotent; changed payload under the same key conflicts.
- Commit rechecks preconditions and writes proposal status, canonical event, audit and idempotency result atomically.
- Missing or incomplete causal manifest produces review/rejection according to an explicit policy; it must not be described as proof of causal completeness.
- Protected-field and player-agency rules are tested against server-owned policy, not client-supplied field lists.
- Source text/rationale is preserved for audit, while tests make clear that preservation alone is not semantic validation.

## 9. Decisions still required

1. Who can approve: player, world author, or both? What authenticates them separately from the adapter service?
2. Which event/effect types may commit automatically, and what is the fail-closed behavior when policy is absent?
3. What World Pack/configuration schema declares protected fields and player-character voluntary-action rules?
4. Which host lifecycle signals identify cancellation/swipe/regeneration, and what happens if a cancellation signal arrives after commit?
5. Is semantic alignment checked by a separate model adjudication stage, by deterministic rules, or left as an explicitly unproven limitation for the first slice?

Until these decisions are made and the relevant code/tests are merged, the proposal/approval boundary remains a documented target rather than an implemented guarantee.
