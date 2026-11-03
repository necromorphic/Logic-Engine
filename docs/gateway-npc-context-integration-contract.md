# Gateway ↔ NPC Context integration contract (P0)

Status: integration contract for PR #877; production composition remains fail-closed.
Base candidate: `integration/gateway-final-send-host-core-v2` at `c0281d08dd5963b83741bd26f5c6218dfb03bab1`.

## Ownership

- NPC block owns producing the NPC result/evidence and its readiness semantics. It must not dispatch to a model, write the client response, or add a parallel ingress/sender.
- Gateway block owns request admission, protected dispatch, durable `DISPATCH_STARTED`, Coordinator lease, retry/cancellation/UNKNOWN semantics, and final-send authorization.
- Host Adapter owns authenticated ST session/conversation identity, canonical World/Actor binding, Host inventory evidence, and the native SillyTavern generation request boundary.
- Core/Provider own authoritative source versions, grants/revocations, readiness, and accepted-head evidence.

## Native request path

1. Browser extension attaches only conversation/request locator metadata at SillyTavern's awaited native generation-data event. No `generate_interceptor`, browser-facing Memory dispatch route, or alternate ingress.
2. Native SillyTavern generation handler enters the managed Final-Send Hook.
3. Server Host Adapter authenticates the exact Express request from signed ST session identity and complete Host inventory; resolves conversation→World and adapter→Actor.
4. Core NPC consumer is invoked for this same request. It must return an explicit readiness-bearing result; absence, malformed data, stale scope/version, or any `NON_READY` state is denial.
5. `host-adapter/npc-context-receiver.mjs` validates the NPC envelope and its scope, candidate/source identity, source version, content shape, and bounds.
6. Gateway combines admitted NPC result with synchronous Core, Provider, and Host evidence under the shared Coordinator lease. It persists `DISPATCH_STARTED` before upstream transport.
7. Final-Send serializes only admitted NPC content into the exact outbound body for the selected native sender. Host locator/auth metadata is stripped before transport.
8. Response release is revalidated against current authority immediately before each native response write/end. Revocation/readiness loss denies release; unknown upstream outcome is terminal and never retried.

## Required NPC result contract

- Explicit status/readiness; only the agreed READY value is admissible.
- Stable World and Actor scope matching the authenticated Host binding.
- Candidate identity and source identity/version for every admitted item.
- Bounded, schema-valid content; no arbitrary objects, executable values, or untrusted metadata.
- Empty result is distinct from missing/unavailable result.
- A result may not claim READY by itself as a substitute for live Core/Provider/Host evidence.
- No NPC-side retry, provider call, response write, or dispatch-start.

The concrete field names must match the existing receiver schema in `host-adapter/npc-context-receiver.mjs`; do not introduce a second envelope.

## Fail-closed conditions

No upstream call and no native fallback when receiver validation fails, any evidence reader is missing/unavailable, any authority is stale/revoked, Coordinator lease cannot be acquired, Host inventory is not READY, or sender route is unknown.

## Integration work still open

The candidate's root server plugin intentionally uses a non-transport Gateway stub and reports `NOT_WIRED_FAIL_CLOSED`. Production composition must replace that stub with synchronous Core/Provider/Host evidence readers sharing the Coordinator and accepted-head authority. The Host inventory review-only authority must be resolved by its owner, not relabelled READY. Then run exact-head CI and real pinned-ST acceptance for streaming, non-streaming, revoke races, retries, cancellation, UNKNOWN, and crash/restart.

## Acceptance proof to attach

- Exact generation route/sender registry and native-source audit.
- Receiver schema tests and real Core→NPC→Receiver integration test.
- Evidence-reader composition test with shared Coordinator/accepted heads.
- Zero upstream calls for pre-start revoke/NON_READY/invalid envelope.
- One upstream call max after durable dispatch-start; UNKNOWN never retries.
- Revoke during execution blocks final client release.
- Installed pinned-ST tests prove final check is adjacent to actual response write/end for stream and non-stream.
