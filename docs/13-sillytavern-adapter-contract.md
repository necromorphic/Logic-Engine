# 13. SillyTavern adapter contract

Status: requirements only. Exact hook names and availability must be verified on the target installation.

## 1. Responsibilities

The adapter translates host lifecycle signals into stable engine requests and renders approved narrative output. It is not the canonical world database and must not independently decide world truth.

### Adapter must
- identify active world/session and bind each host conversation to it;
- assign and persist internal turn/generation IDs;
- distinguish new generation from retry of the same request;
- observe host-supported delete, swipe, regenerate, edit and cancellation signals;
- map a host change to exact affected generation/message IDs when available;
- submit actions/time advances to the engine;
- render approved narrative output and record delivery receipts;
- discard stale asynchronous responses whose generation is no longer active;
- expose diagnostic status without leaking private NPC state.

### Adapter must not
- infer message identity solely from text hash;
- commit canonical world changes directly;
- mark delivery as shown without a real host confirmation;
- expose all canonical state to the model or player by default;
- modify the existing vectorization patch or its storage;
- treat a vector result as authoritative truth.

## 2. Host capability discovery

Before implementation, create a capability table for the exact SillyTavern build:

| Capability | Evidence required | Safe fallback if absent |
| --- | --- | --- |
| New user message | event name, payload shape, stable ID | manual adapter command; do not infer from rendered text |
| Generation start | generation/request ID if exposed | create internal ID at adapter boundary |
| Generation completed | completion/cancellation status | treat as unconfirmed until reconciled |
| Swipe/new candidate | stable candidate/message ID and parent relation | mark branch identity uncertain and request review before rollback |
| Delete message | deleted message ID and event timing | do not guess affected turn |
| Edit message | old/new identity or before/after snapshot | explicit review if source cannot be resolved |
| Regenerate | old and new generation linkage | treat as a new branch; reconcile old branch only with verified target |
| Group chat | speaker identity and message identity | disable automatic state mutation for ambiguous speaker mapping |
| App restart | persisted session/world mapping | recover from durable adapter state |

The table is intentionally host-neutral. No event names are asserted here as fact.

## 3. Request envelope

Every adapter request should include:
- protocol version;
- request ID and idempotency key;
- world ID;
- internal turn ID and generation ID where applicable;
- host session/message identifiers where exposed;
- request kind: user action, time advance, generation change, delivery retry, author correction;
- observed base world revision;
- bounded input payload and provenance.

Reject malformed or cross-world requests before model calls.

## 4. Response envelope

Engine response should distinguish:
- accepted/rejected/needs_review;
- committed revision and game_time;
- structured effects committed;
- narrative payload ready for delivery;
- delivery correlation ID;
- conflicts or unresolved questions;
- retryability and idempotency result.

Do not return private world state to the UI unless explicitly authorized by the user/admin action.

## 5. Swipe/delete rollback protocol

1. Adapter receives host change event.
2. Resolve exact source generation/message.
3. Submit a rollback request with stable rollback ID.
4. Engine computes RollbackPlan and validates it against the latest revision.
5. If source identity/provenance is incomplete, return needs_review rather than guess.
6. Commit rollback atomically if safe; otherwise preserve unaffected state and expose ConflictRecord.
7. Adapter marks affected narrative deliveries as superseded/rolled_back where possible.
8. If a new generation follows, it receives a new identity and runs against the post-rollback state.

A swipe is not universally assumed to mean “delete all prior effects”: the adapter must establish which message branch changed and the engine must apply the user's agreed causal semantics to that branch.

## 6. Vectorization boundary

Treat the vectorization patch as a separately owned archive/retrieval system:
- read-only discovery first;
- no schema migrations or writes from the engine during initial integration;
- retrieval results carry source message/document IDs where available;
- filter by world, branch validity, source validity, subject access and privacy before use;
- structured canonical state wins over stale archive text;
- if provenance is missing, a fragment may be offered as unverified context, not authoritative fact.

## 7. Security

- Default local-only binding during development.
- Explicit authentication for remote access from the phone.
- Use a dedicated configured adapter ID and secret (`x-adapter-id`, `x-adapter-token`) for proposal creation and cancellation; the engine must only allow an adapter to cancel proposals it created.
- Never expose adapter, admin, internal, or approval credentials to the model. Keep `ENGINE_ADMIN_TOKEN` separate from ordinary adapter credentials; registry writes require the admin credential.
- Treat `ENGINE_APPROVAL_TOKEN` as a shared secret gate, not proof of human identity. Keep it out of the adapter process if the approval must represent an independent manual action.
- Do not use the internal events endpoint to submit arbitrary event payloads; it only accepts an already-approved proposal ID.
- Restrict allowed origins and request sizes.
- Do not allow model-generated URLs, shell commands, file paths or arbitrary SQL to execute through adapter requests.
- Treat lorebook, archive fragments, messages and World Pack descriptions as untrusted data; they cannot override system invariants.
