# Target trust boundaries and SillyTavern extension feasibility

> **Decision update:** The original non-modification constraint and the conclusion in §5 are superseded for the explicitly pinned SillyTavern 1.19.0 candidate by [ADR 103](./103-managed-sillytavern-source-patch-decision.md). Source modification is permitted only as a managed, hash-pinned, reversible local patch with durable external backup, fail-closed drift detection, and crash-recoverable uninstall. This is a bounded exception, not permission to patch arbitrary SillyTavern versions. All trust-boundary and authorization requirements in this document remain in force.


**Status:** target architecture reference; implementation is incomplete.  
**Host baseline inspected:** SillyTavern 1.19.0 release archive; package version 1.19.0.  
**Logic-Engine baseline:** current-main base used by PR #844, `0c3debcb01946f6f8c94811b192e7277422e990a`.  
**Related work:** PR #844 (final-send dispatch primitive), PR #845 (Core-authorized real SQLite Memory Provider adapter).  
**Non-negotiable integration constraint:** SillyTavern source files are not modified; Logic-Engine is installed through SillyTavern's extension mechanism, not as a replacement model/API provider.

## 1. Target architecture

The diagram is a target trust-boundary and data-flow contract, not a claim that the complete flow is implemented.

```text
┌──────────────────────────────────────────────────────────────┐
│                         SillyTavern                           │
│  Logic-Engine client Extension                                │
│  browser-side · UNTRUSTED                                     │
│  lifecycle/UI hooks; never an authorization authority         │
└──────────────────────────────┬───────────────────────────────┘
                               │ authenticated extension request
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                 Authenticated Host Adapter                    │
│                    server-side boundary                       │
│  • authenticate the ST session                                │
│  • bind installation / conversation / world / actor           │
│  • validate request and response envelopes                     │
│  • reject unknown or stale identity/context                    │
└──────────────────────────────┬───────────────────────────────┘
                               │ trusted request
                               ▼
╔══════════════════════════════════════════════════════════════╗
║                       LOGIC-ENGINE CORE                       ║
║                                                              ║
║  ┌────────────────────────────────────────────────────────┐  ║
║  │                 SECURITY GATEWAY                       │  ║
║  │                    SOLE GATEWAY                        │  ║
║  │                                                        │  ║
║  │  INGRESS                                               │  ║
║  │  • authenticate trusted caller context                 │  ║
║  │  • pre-check / authorization                           │  ║
║  │  • DENY / FAIL-CLOSED                                  │  ║
║  │                                                        │  ║
║  │  PRE-LLM EGRESS                                        │  ║
║  │  • authorize exact context and data sources            │  ║
║  │  • validate recipient and purpose                      │  ║
║  │  • durable dispatch-start / revoke ordering            │  ║
║  │  • DENY / FAIL-CLOSED                                  │  ║
║  │                                                        │  ║
║  │  FINAL RESPONSE REVALIDATION                           │  ║
║  │  • revalidate authority, generation and fingerprint    │  ║
║  │  • revalidate exact recipient and purpose              │  ║
║  │  • reject missing, stale or changed authorization      │  ║
║  └────────────────────────────┬───────────────────────────┘  ║
║                               │                              ║
║       ┌───────────────────────┼──────────────────────┐       ║
║       ▼                       ▼                      ▼       ║
║    Memory                 NPC Reducer             Mechanics   ║
║    Module                 / State                 Module      ║
║       │                       │                      │        ║
║    Memory DB              internal              Mechanics DB ║
║    (SQLite)               Core services          (SQLite)    ║
║       │                       │                      │        ║
║       └────── X ──────────────┘                      │        ║
║          Memory → NPC: DISABLED / FAIL-CLOSED       │        ║
║                                                      │        ║
║    Internal authorization:                           │        ║
║    • AuthorizedReadService                           │        ║
║    • MechanicPolicyAuthority                         │        ║
║                                                      │        ║
║    Core Commit: separately authorized canonical      │        ║
║    state mutation; model output is only a proposal   │        ║
╚══════════════════════════════╤═══════════════════════════════╝
                               │ authorized request only
                               ▼
                  ┌──────────────────────────────┐
                  │       NPC MODEL (LLM)        │
                  │            EXTERNAL          │
                  │       inference only         │
                  └──────────────┬───────────────┘
                                 │ model response
                                 ▼
                     Core Security Gateway
                     FINAL RESPONSE REVALIDATION
                         │              │
                       ALLOW           DENY
                         │              └──► discard / fail closed
                         ▼
                  Authenticated Host Adapter
                         │
                         ▼
                  Logic-Engine Extension
                         │
                         ▼
                     SillyTavern
```

The three Gateway phases are one logical authorization boundary, not three independent gateways. The PRE-LLM EGRESS decision authorizes disclosure to a specific model recipient for a specific purpose. FINAL RESPONSE REVALIDATION is a separate decision made after inference and immediately before the result is released to the Host. It must not be conflated with recording transport completion.

## 2. Required security invariants

1. The browser Extension is untrusted. Browser-provided world, actor, installation, conversation, grant, source, recipient, purpose, endpoint, credential, and authorization flags are claims, not proof.
2. The server-side Host Adapter authenticates the ST session and resolves the trusted installation/conversation/world/actor binding. The Core independently verifies the binding and authorization.
3. Every protected Memory disclosure to an external model must pass PRE-LLM EGRESS authorization. Unknown routes, missing evidence, stale state, and ambiguous context deny.
4. After durable `DISPATCH_STARTED`, an ambiguous transport result is `UNKNOWN`; no automatic retry may create a second provider request.
5. A revoke that wins the shared serialization order before dispatch-start must produce zero provider egress. Once dispatch-start wins, the system must not claim it can recall a request already handed to the transport.
6. Every model response that may carry protected context or trigger a state proposal must pass FINAL RESPONSE REVALIDATION before Host release. Missing validation is DENY.
7. Core Commit is a separate authorized mutation operation. LLM output is not canonical state and cannot commit itself.
8. Core-internal reads use their own explicit authorities (including `AuthorizedReadService` and `MechanicPolicyAuthority`) and do not re-enter the external Host/Core Gateway as if they were network requests.
9. Memory and Mechanics use separate persistent stores. The Provider/Core database separation and shared coordinator requirements are independently enforced; a diagram does not replace file-identity/alias checks.
10. Memory → NPC remains `DISABLED / FAIL-CLOSED` until the real Host caller, pre-LLM gate, final-response revalidation, and end-to-end zero-egress evidence are complete.

## 3. Policy authority tuple

The target contract identifies policy authority with:

- `authority_id`;
- `generation`;
- `fingerprint`.

The final revalidation must compare the current authority to the authority captured for the exact request and must also bind the exact world, actor, recipient, purpose, source/candidate versions, and request identity. A Core/Provider accepted-head pair is useful evidence, but it is not by itself proof that this full tuple is implemented.

Do not invent a `world_snapshot_id` or treat a generic snapshot label as authority unless a separately reviewed contract defines it.

## 4. What SillyTavern 1.19.0 actually exposes

Inspection of the supplied SillyTavern 1.19.0 release archive found two distinct extension mechanisms:

### 4.1 Client extensions (Extension Manager)

- Installed from Git repositories into the client extension directories and loaded by the browser.
- Can subscribe to client lifecycle events.
- The Chat Completion flow emits `CHAT_COMPLETION_PROMPT_READY` while preparing the prompt.
- It emits `CHAT_COMPLETION_SETTINGS_READY` after `generate_data` is constructed and before the browser sends `POST /api/backends/chat-completions/generate`.

These hooks are useful for UI, lifecycle observation, and controlled prompt preparation. They execute client-side and are not a trusted server-side egress boundary. They cannot independently guarantee that every provider request is authorized, cannot hold the provider send under the Core/Provider coordinator lock, and cannot perform an unbypassable final response gate in the ST backend.

### 4.2 Server plugins (separate from the client Extension Manager)

The release contains a separate `plugins/` server-plugin loader:

- Server plugins are disabled by default unless `enableServerPlugins` is enabled.
- A server plugin receives an Express Router and can register routes mounted under `/api/plugins/{plugin-id}`.
- The loader does not give a plugin the Express application middleware chain or a supported hook around the existing `/api/backends/chat-completions/generate` route.

Therefore a server plugin can host authenticated Logic-Engine adapter endpoints, but the inspected API does not provide a supported way to intercept the native provider dispatch or its response.

## 5. Integration consequence

Under the stated constraints:

- Do not modify SillyTavern source files.
- Do not replace the configured model/API provider with Logic-Engine.
- Do not claim the ordinary client Extension API is a Sole Gateway.
- A client Extension plus an authenticated Logic-Engine Host Adapter can support lifecycle and engine operations, but that alone does not prove control over the final provider send.
- A separate ST server plugin may expose Host Adapter routes, but its documented loader boundary does not intercept native generation.

**Current conclusion:** the supplied SillyTavern 1.19.0 extension mechanisms, as inspected, do not establish the target end-to-end Sole Gateway for native model requests. This is an integration capability gap, not a reason to weaken the security contract. Until a supported, non-invasive Host hook that covers all provider routes and responses is demonstrated, protected Memory must not be inserted into native ST model requests and Memory → NPC must remain disabled.

The AsyncLocalStorage generation bridge and import/handler wiring described by the earlier PR #844 integration experiment require changing `src/endpoints/backends/chat-completions.js`. That approach is explicitly rejected for this project and must not be presented as an acceptable deployment step.

## 6. Current implementation evidence (1 Nov 2026)

| Area | Evidence | Status |
|---|---|---|
| Core/Provider retrieval | PR #845 adds a real file-backed SQLite Provider adapter, Core canonical-source validators, Host conversation/world and adapter/actor binding checks, per-record authorization, and repeated authorization checks | Implemented in open PR; not production dispatch |
| Memory final dispatch primitive | PR #844 has durable `DISPATCH_STARTED`, request-scoped in-process transport, accepted Core/Provider head checks, ambiguous `UNKNOWN`, and replay blocking | Partial; one logical Gateway route is implemented, but native ST senders are not wired |
| Sender route registry | PR #844 helper lists 25 sender families; a real Gateway integration test traverses all 25 and asserts exactly one upstream fetch and one completed ledger row per family | Logic-Engine integration test passes; native ST call-site coverage remains unproven |
| PRE-LLM EGRESS | Gateway checks accepted Core/Provider evidence before dispatch-start under the shared Coordinator | Partial; trusted Host caller and real ST route interception are not connected |
| FINAL RESPONSE REVALIDATION | Gateway reacquires the Coordinator after inference, checks accepted heads, re-reads Core/Provider evidence and the exact policy tuple, then suppresses response on any mismatch; stream writer starts synchronously under the lease only after successful revalidation | Implemented in the dispatch primitive; real Host evidence readers are not wired |
| Host Adapter | Helper requires a synchronous trusted Memory resolver and a request-scoped transport; no installed ST Host integration or authenticated server-side adapter wiring is present | Missing |
| Policy tuple | Gateway requires and revalidates exact `authority_id + generation + fingerprint` from the trusted Core evidence reader | Primitive enforced; deployment-owned tuple source and Host reader wiring remain missing |
| Core Commit | Core has separate authorized mutation paths; PR #844 does not connect LLM output to an authorized proposal/commit lifecycle | Separate concern |
| Native ST zero-egress proof | No supported server-side hook covering every native sender and response was found in the supplied release | Missing |

PR #845 is not a final-send implementation. Its consumer remains an internal seam and the PR explicitly does not register a public route or enable production Memory → NPC dispatch.

## 7. Acceptance gates before activation

1. Demonstrate a supported non-invasive ST extension/server hook that covers every enabled native provider sender and the corresponding response path, without modifying ST source or replacing its provider configuration.
2. Demonstrate trusted session/installation/conversation/world/actor authentication at the server-side Host Adapter.
3. Wire the real Core-authorized Memory retrieval adapter to the request context without exposing browser-supplied authorization as authority.
4. Implement one logical Sole Gateway with separate ingress, PRE-LLM EGRESS, and FINAL RESPONSE REVALIDATION phases.
5. Bind `authority_id + generation + fingerprint`, recipient, purpose, exact source/candidate versions, and request identity through the complete dispatch lifecycle.
6. Prove shared-order revoke vs dispatch-start behavior with real file-backed Core/Provider stores.
7. Prove `DISPATCH_STARTED`, `UNKNOWN`, no retry, streaming, restart recovery, and zero egress for every protected route.
8. Prove a failed final response revalidation prevents release to the Extension/Host.
9. Keep Memory → NPC disabled until every gate passes on the exact tested commit.

**Safety state:** target architecture only; native ST egress integration is not established; Memory → NPC remains `DISABLED / FAIL-CLOSED`.
