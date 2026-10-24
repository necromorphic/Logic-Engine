# Core trusted mutation-origin contract

Status: **Core design proposal; not runtime behavior or authorization approval**.

Scope: define the minimum contract that must distinguish imported initial state, in-world transitions, and author corrections without allowing an untrusted request to grant itself authority by naming an origin. This document does not add an endpoint, credential, database column, event kind, or public API by itself.

Related contracts:
- `docs/27-proposal-to-commit-boundary.md` — current proposal/commit trust boundary.
- `docs/28-proposal-api-stage1.md` — implemented proposal API and its limitations.
- `docs/21-stage1-causality-contract.md` and `docs/22-causality-semantics.md` — event causality and rollback boundaries.
- `docs/personality/03-core-decision-and-integration-gates.md` — relationship first-slice and integration gates.
- `src/application/proposals.js` — current adapter proposal lifecycle.
- `src/api/server.js` — current credential checks and route-to-service boundary.

## 1. Problem and current runtime boundary

The engine currently has a narrow proposal lifecycle. An authenticated adapter creates a proposal; a separate shared approval credential approves it; commit revalidates the captured revision and sequence and uses the canonical event commit path. The adapter identity is retained for proposal ownership and cancellation.

That is useful but does **not** establish a complete trusted mutation-origin contract:

- Adapter identity identifies the integration that submitted a proposal. It does not prove that the event is true, that the adapter is an author, or that it may initialize/correct canon.
- The shared approval credential is a service gate, not a named human identity or role system.
- Source text, event type, cause fields, source IDs, and any caller-supplied `origin`/provenance label are untrusted request data. They are not authority.
- Existing event/audit metadata and rollback do not by themselves distinguish all three semantic command classes below.
- The current proposal contract says semantic alignment, causal completeness, actor authorization, and player-agency policy are not established by basic proposal validation.

Until a trusted command boundary exists, do not infer an origin from prose or caller-provided labels, and do not expose initial-import or author-correction powers through the ordinary adapter proposal path.

## 2. Three distinct mutation classes

### 2.1 Initial import

Purpose: establish a world's initial canonical state from an explicitly supplied, versioned authoring/import source.

Required semantics:
- The import command is a privileged operation selected by the trusted route/service, not a request-body field.
- The command is scoped to one target world and an identified import package/source version; retain a stable source reference or content digest where available.
- Import must have an explicit policy for whether the target world is empty or whether a controlled migration/import is permitted. It must not silently overwrite a non-empty world.
- The import operation must validate the whole batch before commit and commit atomically, or fail without a partially initialized canonical world.
- Imported state is not retroactively presented as an in-world character action. Provenance records that it entered through initial import.
- Re-running the same import key and same content is idempotent; reusing the key with different content is a conflict.

The exact import package schema and batch size are outside this contract. Until they exist, initial import is not a supported public mutation mode.

### 2.2 In-world transition

Purpose: record an event that is intended to have happened inside the simulated world.

Required semantics:
- Ordinary adapter proposals may request in-world transitions only, subject to existing approval and commit gates.
- The transition must pass canonical event/effect validation and final commit-time preconditions.
- Cause/dependency/read metadata remains untrusted declarations subject to the existing validators; it is not proof of causal completeness.
- Successful transition effects enter the ordinary append-only canonical event history and use the existing atomic event/projection/audit/revision/idempotency path.
- A transition does not gain extra authority because its `event_type`, `source_text`, or provenance label claims to be an import or correction.

This is the only one of the three classes currently approximated by the ordinary proposal lifecycle; it is not a claim that every effect or policy is implemented.

### 2.3 Author correction

Purpose: repair or revise canonical state because the author has determined that an earlier record was wrong, incomplete, or intentionally superseded.

Required semantics:
- Correction requires a trusted authoring authority distinct from ordinary adapter identity. The authority source and credential/role design remain unresolved and must be decided before implementation.
- A correction request must identify its target scope and provide a reason or correction note suitable for audit. The note is rationale, not proof that the correction is authorized.
- A correction must append an auditable correction record or compensating event through the canonical transaction boundary. It must not edit or delete past committed events, erase audit history, or silently rewrite historical provenance.
- Where current projections are rebuilt from valid event history, correction semantics must state whether the operation adds a compensating transition, invalidates an identified event under the approved rollback contract, or uses another explicitly typed correction operation. Do not mix these meanings into one generic `origin` flag.
- Correction must be atomic with projection/revision/audit/idempotency effects. Rejection must leave canonical state and committed history unchanged, aside from a separately documented rejection diagnostic.
- A correction that cannot be represented without unsafe history rewriting is unsupported and must fail closed pending a dedicated contract.

The exact correction effect shape is intentionally not specified here. It depends on the causal/rollback contract and on the authority decision.

## 3. Authority is server-derived, origin is recorded

The implementation must keep two concepts separate:

1. **Authority context:** a server-created result of authenticating the caller and checking permission for a specific command class and world.
2. **Mutation provenance:** a server-validated record of which command class was used and which trusted principal/adapter initiated it, with stable source/correction references where available.

Rules:
- Never derive authority from `body.origin`, `body.actor_id`, `body.author_id`, `source_text`, a model-produced rationale, or caller-supplied audit fields.
- Routes authenticate first, then construct an internal authority context. Services must not accept a bare string such as `"author"` or `"import"` as proof of permission.
- Command class is selected by a dedicated route/service method or trusted internal call, not freely chosen by the caller inside a generic event payload.
- Authority is scoped to world and operation class. Permission to manage mechanic templates or actor bindings does not automatically grant permission to import or correct canonical world state.
- An authenticated adapter is not automatically the canonical in-world actor. Actor binding is identity resolution only, not mutation authorization or approval.
- The model never receives engine, adapter, admin, internal, approval, or future authoring credentials.
- If trusted identity cannot be established, reject the command. Do not downgrade a failed privileged command to an ordinary transition or guess the intended origin.

The design does not prescribe whether the future authoring authority is a dedicated credential, a role mapping, a local-only administrative channel, or a combination. That is an explicit implementation decision, not something the module may infer.

## 4. Provenance and audit requirements

Every accepted mutation must be traceable to a server-assigned command class and the existing canonical event/transaction boundary.

Minimum semantic audit information, represented using existing fields where possible:
- world and canonical event/correction identity;
- command class: `initial_import`, `in_world_transition`, or `author_correction`;
- authenticated initiating principal category and stable principal/adapter reference where available;
- source/import package reference or digest for import, or target reference and correction rationale/reference for correction;
- resulting world revision and commit sequence;
- accepted/rejected outcome and structured validation reason;
- idempotency identity and timestamp.

This list defines required meaning, not a requirement to add identically named database columns. Do not duplicate the canonical event log with a parallel provenance store if the existing event and audit records can carry the information safely.

For initial import, preserve source provenance for each imported batch and sufficient mapping to identify which initial records it established. For correction, preserve both the historical record and the correction link. For in-world transitions, preserve the existing event/cause/read metadata without upgrading unverified declarations into facts about trust or completeness.

## 5. Transaction and failure invariants

For each command class:
- Authorization is checked before any canonical mutation.
- Structural and domain validation runs before commit; commit-time preconditions are rechecked against the relevant current revision/snapshot.
- Canonical event/effect writes, derived projection updates, audit/provenance, idempotency outcome, and revision advancement share the canonical atomic transaction boundary where they are part of one mutation.
- A failed or unauthorized command does not advance world revision/commit sequence, append a successful canonical event, or leave partial projection changes.
- Retry with the same idempotency key and identical normalized request returns the original result; changed content under the same key conflicts.
- Audit is append-only. A correction or rollback can change the current projection but cannot erase the fact that earlier history existed.
- Unknown command classes and unsupported correction semantics fail closed.
- A successful API response means the canonical transaction committed, not merely that the proposal was stored or approved.

## 6. Integration with relationship transitions

The first relationship slice is deterministic replay of surviving valid typed transitions only. The origin contract must not bypass that boundary.

- Initial relationship values may be established by a trusted initial import, but import validation must use the same World Pack dimension/value semantics as ordinary transitions.
- Ordinary relationship changes must be represented as typed in-world transitions and pass the canonical event lifecycle.
- An author correction to a relationship must preserve historical audit and use a separately approved correction/compensation/rollback semantic; it must not mutate the relationship projection directly.
- No relationship-specific independent-support semantics are implied by an import or correction label.
- Typed Relationship transitions are now implemented for the privileged first slice in PRs #94–#96, with atomicity, replay, rollback dependencies, and server-derived provenance covered by current tests. Initial import and author correction remain unimplemented; the requirements in this section must not be read as runtime support for those command classes.

## 7. Acceptance tests required before implementation is ready

### Authority and request classification
- A model/adapter request containing `origin: "author_correction"` is rejected as an unsupported/server-owned field or otherwise cannot change command class.
- A request cannot turn an ordinary adapter proposal into an initial import by changing `event_type`, source text, or metadata.
- A caller with only mechanic-admin permission cannot import/correct canonical world state unless an explicit policy separately grants it.
- An unauthenticated or unauthorized privileged command produces no canonical mutation or successful mutation audit.
- A trusted command context cannot be forged by passing a string in a public service argument.

### Initial import
- Valid import into an eligible empty world commits all-or-nothing and records source/version provenance.
- Invalid item anywhere in the batch leaves the target world unchanged.
- Repeating the same import key/content is idempotent; changing content with the same key conflicts.
- Import into a non-empty world fails unless a separately approved migration/import mode permits it.
- Imported initial state is not falsely represented as an in-world action.

### Author correction
- Correction preserves the original event and audit history.
- Correction and resulting projection/revision/audit changes are atomic.
- A correction with no valid target or unsupported semantics fails without partial mutation.
- Retrying a correction is idempotent; reusing its key for changed content conflicts.
- A correction's declared rationale does not grant authority or prove factual correctness.

### In-world transition and shared lifecycle
- Ordinary proposals continue through pending → approved → committed, with stale revision/sequence rejection.
- Origin/provenance metadata in the committed event is server-derived and cannot be spoofed by request fields.
- Rollback/replay yields the approved current projection without erasing the historical command/audit record.
- Tests run against the exact final commit; prior green runs do not validate later branch heads.

## 8. Open decisions before runtime work

1. What trusted identity or role system authorizes initial import and author correction? Existing adapter identity and shared approval token do not answer this.
2. Is initial import limited to empty worlds for the first runtime slice, or is a separately typed migration path required immediately?
3. Which correction cases can be represented as compensating events, and which require the existing rollback invalidation semantics? The correction API must not choose silently.
4. Which existing canonical event/audit fields can encode the provenance requirements without schema duplication?
5. What import source/package format and deterministic ordering are required for replayable initialization?

These decisions must be closed before implementation. This document closes the semantic distinction between the three classes, not the authority mechanism or correction algorithm.

## 9. Non-goals

This contract does not implement a general role-based access-control system, semantic truth verification, causal-completeness proof, NPC knowledge/memory, relationship effects, arbitrary state repair, or automatic approval. It does not authorize changes to public API, storage schema, prompt/UI, or the existing SillyTavern vectorization patch.


## Current proposal execution boundary (2026-10-24)

PR #103 closes the public proposal-commit ownership gap: a public adapter commit requires the stored creator adapter identity; a different adapter receives non-enumerating `PROPOSAL_NOT_FOUND`. Trusted orchestration uses the separate internal-token route. This does not implement trusted initial/imported-state provenance or authorized author correction; those remain separate Core-owned gates. PR #106 separately restricts context-manifest registration to the internal host but does not prove actual context-generation binding.