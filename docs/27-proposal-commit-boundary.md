# 27. Proposal-to-commit boundary: runtime status and implementation contract

Status: historical design note, written before the proposal API was implemented. The current Stage 1 runtime contract is in `docs/28-proposal-api-stage1.md`; the proposal lifecycle and direct-commit isolation were implemented in PR #24, and deterministic rollback-only proposal validation in PR #25. The sections below retain the original reasoning and unresolved policy questions; statements about absent runtime functionality describe the pre-implementation state.

## 1. Pre-implementation runtime snapshot

- `POST /v1/worlds/:id/events` in `src/api/server.js` calls `engine.commitEvent(id, body)` directly.
- `LogicEngine.commitEvent` in `src/application/engine.js` normalizes and validates the event payload, effects, supported causal links, and related fields before delegating to the store.
- The store performs commit-time checks and persistence in its transaction path. The API requires one bearer token for protected routes.
- There is no proposal resource, proposal status machine, approval endpoint, or generation-cancellation registry in the current runtime.
- `docs/02-turn-event-delivery-lifecycle.md` defines a desired lifecycle, but explicitly labels itself a proposed contract to reconcile with implementation.

At the time this snapshot was written, the runtime did not enforce a separate proposal-to-commit transition. The current API now has proposal creation, retrieval, approval, cancellation, and commit routes. Direct `POST /events` is disabled unless a distinct internal token is configured. See `docs/28-proposal-api-stage1.md` for the current behavior and remaining limitations.

## 2. Keep the trust boundaries distinct

These are different checks and must not be represented by one generic “validated” boolean:

1. **Syntax and normalization** — fields, types, supported effects and references are well formed.
2. **Preconditions** — current state and the captured revision satisfy the conditions at commit time.
3. **Authorization** — the authenticated caller/actor is permitted to request this class of mutation.
4. **Player/author approval** — a human decision was recorded where policy requires it.
5. **Causal completeness** — the event's declared reads and causes adequately describe what influenced it.
6. **Semantic alignment** — effects are consistent with the source action/text.

The current engine implements parts of (1) and (2), plus structural and existence checks for some causal metadata. A context manifest can verify that declared reads were present in that manifest; it cannot prove that the proposal omitted no relevant reads. The runtime does not currently establish general actor authorization, human approval, causal completeness, or semantic alignment.

## 3. Security invariants and remaining hardening

- Treat model-produced structured output as untrusted input.
- The model must not receive the engine bearer token or direct database access.
- Canonical state may change only through the engine's validated, transactional commit path; no adapter or proposal handler may write canonical tables directly.
- A proposal's world, identifiers, status, timestamps, validation report, normalized hash, approval metadata, and commit result are server-owned.
- A proposal records the exact base world revision and commit sequence used to prepare it. Commit must reject or explicitly revalidate stale proposals; it must not silently apply stale assumptions.
- Approval is bound to the exact normalized proposal hash. Any edit to effects or causal metadata creates a new proposal/hash and invalidates previous approval.
- Idempotent retries return the original result. A conflicting request reusing an idempotency key is rejected.
- Cancellation or regeneration is enforceable only when a trusted adapter reports it through a defined lifecycle operation. A client-supplied status field is not proof of cancellation.
- Preserve source text or a stable source-message reference and rationale for audit, but do not treat those fields as proof of semantic correctness.
- Protected fields and player-agency policy must be server/world configuration, not client-supplied `protected_fields`.

## 4. Original minimal vertical-slice proposal

A first implementation can add a durable proposal resource with these operations:

- `POST /v1/worlds/:id/proposals`: normalize, run existing checks, capture a server-owned base revision/sequence and validation report, persist a pending/validated/rejected proposal.
- `POST /v1/worlds/:id/proposals/:proposal_id/approve`: record an authenticated approver and the hash being approved. Only available when policy says human approval is required.
- `POST /v1/worlds/:id/proposals/:proposal_id/commit`: in one transaction, verify proposal status/hash, current revision, preconditions and idempotency; then invoke the same canonical commit logic and atomically mark the proposal committed.

Before this slice can be considered safe, the project must decide whether the existing `POST /events` remains an explicitly trusted internal endpoint, is guarded by a distinct internal credential, or is removed from the public adapter surface. Merely adding proposal endpoints while leaving an equally accessible direct commit endpoint would not enforce the boundary.

Do not accept client-provided `status`, `proposal_id`, `proposal_hash`, `validation_result`, `approved_at`, or `committed_at`. Do not accept a client-provided protected-field list as authority.

## 5. Deliberately unresolved policy decisions

These decisions require an explicit policy; they should not be guessed in the persistence layer:

- Which event/effect categories can auto-commit after deterministic validation, and which require human approval?
- Who may approve: player, world owner/author, or distinct roles? The current single bearer token does not identify such roles.
- What authoritative host signal means a generation was cancelled or superseded, and how does the adapter report it?
- Which player-character fields and voluntary actions are protected, and where is that policy versioned?
- Is semantic alignment checked by a separate model adjudicator, deterministic rules, or manual review? Source text alone is audit material, not a validator.
- When causal completeness cannot be proven, does policy reject, require review, or allow commit under an explicitly weaker assurance level?

## 6. Minimum acceptance tests for the implementation

- A model-facing or adapter-facing credential cannot reach the internal direct-commit path if the chosen design intends to restrict that path.
- Proposal creation never mutates canonical world state.
- Client-supplied server-owned fields are rejected.
- Proposal hash and base revision/sequence are immutable after creation.
- A stale proposal cannot commit without an explicit supported revalidation path.
- Approval of one proposal hash cannot authorize altered effects.
- A proposal requiring review cannot commit before approval.
- Cancelled/superseded generation proposals cannot commit once cancellation has been authoritatively recorded.
- Proposal commit, canonical event, audit entry, idempotency result and proposal status change are atomic.
- Duplicate proposal creation and duplicate commit are idempotent; conflicting idempotency reuse fails closed.
- Missing or incomplete causal metadata is not reported as “causally complete” merely because declared reads match the context manifest.

## 7. Scope warning

This boundary does not itself implement a World Pack policy engine, a universal authorization system, a semantic proof of effect/text alignment, complete causal inference, player-agency rules, or SillyTavern cancellation hooks. Those must remain explicit future capabilities rather than implied guarantees.
