# Product/Security policy decision — protected Memory→NPC disclosure

**Decision date:** 2026-10-26  
**Decision authority:** Coordinator acting under the user's explicit delegation for project coordination.  
**Authority limitation:** This records a project policy decision for design review. It is not a claim of separate human Product/Security sign-off, and it does not authorize runtime implementation, production wiring, or Memory→NPC enablement.

## 1. Scope

These defaults apply only to requests that may disclose protected Logic-Engine Memory to an NPC/model provider. They do not require changing ordinary SillyTavern traffic that does not carry protected Memory. The existing user SillyTavern installation and Ollama vectorization/remote-store patch are out of scope and must not be changed by this decision.

## 2. Decisions

| Area | Decision | Required proof before production |
|---|---|---|
| Egress topology | **Approve PC-side egress gateway as the preferred and required topology for protected requests.** The gateway must own the final authorization decision and actual upstream transport. | Every protected send route is enumerated; no direct-provider bypass or alternate extension path can send protected content. |
| Direct credentials on phone | **Prohibited for covered protected routes.** Provider credentials for those routes remain on the PC gateway. Existing unrelated/non-protected ST routes are not changed by this policy. | Secret scan/configuration audit and runtime tests show protected routes cannot access or use upstream credentials on the phone. |
| Gateway unavailable | **Fail closed. No direct-send fallback.** | Gateway-offline, timeout, malformed response, auth failure, and unknown route each produce zero upstream requests. |
| Phone↔PC trust | The phone client must be authenticated and the LAN/bridge channel must provide confidentiality and integrity. Mutual TLS is the preferred candidate, not an assumed existing implementation. Credential provisioning, rotation, revocation, device replacement, and recovery must be specified before implementation. | Threat model and tests cover unauthenticated clients, replay, expired/revoked credentials, LAN and bridge paths, and recovery. |
| Payload retention | **No durable raw prompt, Memory text/snippet, raw Host message, derived Host summary, secret, or provider-key retention** for the first slice. No payload logging for debugging. | Inspect logs, error reporting, traces, crash dumps, and test fixtures; prove payloads are not persisted. Provider raw capture/read/derived-copy operations remain fail-closed until a separate retention decision. |
| Audit record | Permit only minimal metadata required to prove ordering and investigate failures: opaque dispatch/correlation ID, route class, decision/outcome code, dispatch-start state, and only the source/version/scope identifiers necessary for authorization audit. Do not record human-readable message content, names, prompt fragments, credentials, or secrets. | Exact schema and fields reviewed before implementation; content-free assertions against all log sinks. |
| Audit retention/access | Default retention **30 days**, then deletion. Access is restricted to authorized maintainers/operators with a troubleshooting need; access itself should be auditable where the host platform supports it. Do not copy logs into broad/shared channels by default. | Implemented retention/deletion and access controls demonstrated; if deployment cannot enforce them, remain fail-closed for protected disclosure. |
| Unsupported routes/backends/extensions | **Unsupported means fail closed**, never silent fallback to direct upstream transport. | Route inventory plus negative tests prove unsupported route requests send zero protected bytes. |
| Revocation ordering | Keep the approved bounded in-flight rule: denial, effective revocation, source invalidation/staleness, scope change, or readiness loss ordered before the one authoritative dispatch-start must produce **zero outbound requests**. If dispatch-start wins first, later revocation cannot recall bytes already handed to transport. | One real serialization/linearization point shared by all relevant state changes and actual transport handoff; deterministic race tests, not timing-only checks. |
| Ambiguous transport result/retries | After durable dispatch-start, if timeout/crash/connection loss leaves it unknown whether protected bytes reached the provider, **do not automatically retry**. Return an explicit ambiguous/fail-closed result unless a separately reviewed idempotency contract proves retry cannot create a second disclosure. | Crash/timeout/restart tests demonstrate at-most-once disclosure behavior. |
| Failure details | A denied request must not reveal protected content or snippets. Return only a generic failure plus an approved non-sensitive reason code. | Tests cover unknown/stale source, revoked grant, incomplete inventory, and unavailable authorization authority. |

## 3. Threat assumptions and non-goals

- The phone is a UI/client, not a trusted source of authorization truth.
- Client-supplied actor, world, recipient, purpose, source version, or “authorized” flags are claims to validate, not authority by themselves.
- A preflight boolean, short-lived token, timestamp, second check, or process-local flag is not a substitute for serialization against revocation.
- Core's SQLite transaction, Provider's separate SQLite transaction, and Host's network handoff are not atomic merely because each component has local transactions.
- The existing pinned SillyTavern Chat Completions harness proves only a bounded baseline request to a recording fake provider. It does not prove gateway enforcement, complete inventory, Android/Termux behavior, revocation races, or zero-egress denial.
- No new API, schema, store, receiver, endpoint, token, outbox, or runtime topology is implied by this policy record.

## 4. Acceptance gate — all required

1. Core identifies an existing approved callable final-disclosure seam, or explicitly states that none exists and proposes the smallest reviewable contract.
2. Core, Provider, Host/Adapter, and Product/Security agree on one enforceable dispatch-start serialization authority and identify every writer and transport path that participates.
3. The PC gateway is the sole upstream transport for covered protected requests; unsupported paths cannot bypass it.
4. Complete Host active/history/deleted inventory, lifecycle/replay/restart, import/restore and anti-rollback behavior is proven or the affected feature remains unavailable.
5. Deterministic tests prove zero egress when denial/revocation/invalidation wins before dispatch-start; dispatch-start-first is recorded as in-flight and is never automatically retried after an ambiguous transport outcome.
6. Credentials, authenticated phone↔PC transport, content-free audit, 30-day retention, deletion, and access controls are verified.
7. Browser/IndexedDB and Android/Termux evidence is reported separately from source inspection and unit tests.
8. The user-facing release gate is explicitly reviewed. Until every required gate passes, Memory→NPC remains **DISABLED / FAIL-CLOSED**.

## 5. Disposition

**Policy defaults: APPROVED for design and contract review under delegated Coordinator authority.**  
**Production implementation / runtime wiring: NOT AUTHORIZED by this record.**  
**Separate human Product/Security approval: NOT EVIDENCED.**  
**Production Memory→NPC: DISABLED / FAIL-CLOSED.**
