# Core-approved request-scoped transport handoff

**Decision date:** 2026-10-28  
**Authority:** explicit user delegation to Core for this narrow decision.  
**Status:** approved for implementation review; not merge or production-activation approval.

## Decision

Use a request-scoped, server-owned transport handoff (Option B). Do not restrict the architecture to one arbitrary provider, but do not claim any provider route is supported until that route has been explicitly wired and tested.

## Contract

1. The provider-specific handler runs trusted server-side code to resolve its configured endpoint, credentials, provider-specific request transformations, and stream semantics. Browser-supplied endpoint, headers, credentials, or Memory admission fields are never authority.
2. Provider transformations complete before final serialization. The resulting serialized request body is immutable for the protected dispatch. The Gateway hashes and authorizes that exact body; the final transport must send those exact bytes without parsing or reserializing them.
3. The transport capability is an in-process server-side function/closure, not JSON and not a browser-visible field. It must be created by trusted Host code and must not initiate network I/O merely by being constructed.
4. The Gateway remains the sole initiator of the upstream send. It validates current authority/evidence, persists `DISPATCH_STARTED`, then invokes the trusted transport capability exactly once. The capability returns a synchronous start acknowledgement `{ started: true, response: Promise }`.
5. No direct-provider fallback, alternate sender, or retry is permitted for an enrolled protected-Memory request. Unwired, unsupported, or uncertain routes fail closed.
6. Revocation before the durable dispatch-start boundary must yield zero upstream calls. Any ambiguous result after start becomes `UNKNOWN`; never retry it automatically.
7. The exact implementation diff must demonstrate the final transport boundary and pass tests for exact-body binding, fabricated/incomplete admission, pre-start revocation, post-start ambiguity, Gateway denial/timeout, unsupported routes, and no fallback.

## Explicit non-approval

This decision does not approve new storage, journal, schema, admission-evidence sources, provider routes by implication, deployment, raw-source capture, or Memory→NPC disclosure. Current production state remains **DISABLED / FAIL-CLOSED**. Independent review of the exact implementation and deployment evidence is still required.
