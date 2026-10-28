# Host Lifecycle Mutation Capability — Contract Proposal

**Status:** proposal for review; not implementation evidence. Host remains `NON_READY`. This document does not authorize merge or enable Memory → NPC.

## Problem

The lifecycle middleware currently rejects enrolled chat/group-chat saves before SillyTavern overwrites their files because no trusted request-bound capability exists. Removing that guard would turn a post-write scan into the only safeguard and would permit an unjournaled mutation if the scan fails.

## Security decision

A request header, client-generated UUID, client-supplied digest, authenticated browser session, or capability-minting endpoint callable by that same browser is **not** sufficient authorization. The browser is not the trust anchor. A permit must be issued only after a trusted server-side Host→Core path has validated the proposed transition.

## Proposed bounded protocol

1. **Prepare (before native mutation).** Host middleware derives the canonical operation and target from the routed request, not from an independent client claim. It computes a canonical digest of the exact proposed persisted payload and binds the current enrolled conversation identity plus the pre-mutation snapshot/version cursor.
2. **Core validation.** Through the existing authenticated Host→Core integration, Core validates the adapter/actor binding, world/subject, operation policy, candidate capture IDs and lineage, and expected current cursor. Core returns a one-shot permit only for an admissible transition. No caller may submit a trusted source identity or self-assert Core approval.
3. **Permit binding.** The permit binds at minimum: protocol version, operation ID, authenticated Host adapter, HTTP method + canonical route, enrolled conversation ID, source locator, pre-state digest/cursor, candidate payload digest, expiry, and a unique nonce. It is authenticated by a server-side trust mechanism unavailable to browser code; the nonce is consumed atomically. A permit for one target, payload, route, or cursor cannot be replayed for another.
4. **Native mutation.** Middleware verifies and consumes the permit before calling the native handler. If the permit is absent, invalid, expired, stale, mismatched, or already consumed, reject before mutation.
5. **Durable postcondition.** After the native handler, Host re-reads the persisted source using the trusted server path. It must match the permit's candidate digest and stable identity/version lineage. Only then may Host submit the corresponding capture/receipt to Core and append a local non-authoritative journal outcome.
6. **Failure/recovery.** If mutation fails after prepare, Host reports failure to Core and releases/aborts the prepared transition idempotently. If the result is uncertain, the journal enters reconciliation-required state and the operation is not retried as a fresh mutation. Replays of the same operation ID return the recorded result; conflicting reuse is rejected.
7. **Atomicity limitation.** A local Host journal is not an independent trust anchor and does not establish anti-rollback. If the current Core capture API cannot express prepare/commit/abort against the same cursor, stop and propose the smallest Core-owned lifecycle extension; do not simulate atomicity with two unrelated writes.

## Required tests

- No permit, forged header, caller-created nonce, expired permit, replay, conflicting operation-ID reuse.
- Permit bound to route, enrolled conversation, source locator, pre-state cursor, and exact candidate payload digest.
- Cross-world/adapter/subject mismatch and revoked actor binding.
- Stale cursor between prepare and mutation.
- Native handler failure, swallowed save failure, persisted digest mismatch, post-scan failure and process restart between each protocol stage.
- Idempotent abort/retry and uncertain-outcome reconciliation.
- Real HTTP integration against the pinned SillyTavern route and response semantics.
- Verify denied requests do not modify the file, append a success receipt, or produce a Core-accepted capture.

## Acceptance gate

Do not remove the existing fail-closed guard until the trusted server-side permit issuer, Core lifecycle semantics, pinned-host integration tests, Runtime tests, and Windows target evidence all pass on the exact same PR head and are reviewed. This proposal does not make those conditions true.

## Explicit non-goals

No browser-trusted token minting endpoint, no public bypass header, no weaker test assertions, no raw message-body logging, no Host readiness promotion, and no Memory → NPC enablement.
