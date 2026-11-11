# Local-first deployment and trust-boundary decision

**Status:** DECIDED — local-first; no mandatory external authority  
**Applies to:** Logic-Engine Core, Memory Provider, SillyTavern Host adapter, and the planned standalone application  
**Decision date:** 2026-11-11  
**Supersedes:** Any deployment interpretation that makes a VPS, cloud database, or remote accepted-head service mandatory.

## 1. Product architecture decision

Logic-Engine is a local engine. Its canonical state and operational data are stored in Logic-Engine-owned local storage, not in SillyTavern's database.

- Core, Memory Provider, Host lifecycle metadata, dispatch evidence, and their coordination state remain local.
- SQLite is the current storage implementation. The current design uses multiple separately-owned SQLite files for distinct trust and transaction boundaries; this decision does not merge them into one file.
- SillyTavern is the first Host/UI integration. It does not own Logic-Engine's canonical world state or Memory database.
- The planned standalone application will reuse the local engine and its storage; the UI/Host adapter can be replaced without moving canonical state to a server.
- Internet access is optional for engine operation. It may be used for software updates, explicitly selected remote integrations, and language-model API calls. A model may instead run locally.
- No VPS, cloud database, telemetry endpoint, or remote accepted-head authority is required by this architecture.

A local HTTP/loopback connection between Host, Core, Provider, or a local authority process is not an Internet dependency.

## 2. Accepted-head authority: permitted local design and limits

The repository already contains a local accepted-head service:
- `scripts/security/run-accepted-head-authority.js`;
- `src/security/accepted-head-authority.js`;
- authenticated loopback clients in `src/security/accepted-head-client*.js`;
- separate Core and Provider mutation domains.

The service binds to `127.0.0.1` and stores its state in a dedicated file-backed SQLite database. It is an optional local process, not a cloud service. Its database must have a separate service identity/ACL and must not be included in routine Core/Provider restore operations.

This design can detect a Core-only or Provider-only restore, and can detect a coordinated Core+Provider restore, **only while the authority's accepted state remains newer and is not rolled back with those stores**. Separate files alone do not establish that protection: OS permissions, backup selection, restore procedure, and recovery evidence matter.

The local design does not protect against:
- restoring a full disk/system image that also rolls back the authority database;
- restoring the authority database to an older checkpoint;
- a local administrator or compromised process that can alter both the stores and the authority boundary;
- physical loss or destruction of the device.

Those scenarios are explicitly outside the local-first guarantee. The project must not claim full-device anti-rollback or tamper-proof monotonicity without a hardware-backed or external trust anchor. Such an anchor is not part of the current product decision.

## 3. Keep three different problems separate

### A. Transaction and crash consistency

Use SQLite transactions, WAL/durability settings, the shared Coordinator ordering boundary, idempotency, pending-operation recovery, and the local accepted-head service where configured. These mechanisms address interrupted writes, concurrent Core/Provider mutation, restart, and partial database restore.

### B. Host source inventory completeness

The Host must prove that the supported SillyTavern source set and lifecycle operations are inventoried completely enough for the declared product guarantee. A source-manifest pin, HMAC signature, VSS scan, or local journal hash is not by itself proof of complete coverage.

The current `src/index.js` deny-only `verifyInventorySnapshot: async () => false` must remain deny-only until a real verifier validates the complete Host snapshot against an approved, tested contract. The local Core/Provider accepted-head service does not solve Host inventory completeness and must not be represented as doing so.

### C. Final disclosure and outbound dispatch

Memory retrieval, NPC context admission, and model dispatch remain separate authorization stages. The actual SillyTavern egress path must be shown to pass through the approved Gateway and final revalidation boundary. Accepted-head checks do not by themselves prove that every model request uses that Gateway.

## 4. Guarantee matrix

| Scenario | Local-first disposition |
|---|---|
| Process crash during a SQLite transaction | Must recover atomically or remain non-ready; verify with file-backed tests |
| Core/Provider concurrent mutation | Must be ordered through the shared Coordinator and accepted-head protocol |
| Core-only or Provider-only restore | Detectable if the local authority state is preserved |
| Core+Provider coordinated restore | Detectable only if the authority state is preserved outside that restore |
| Full-device image restore including authority | Not guaranteed; must not claim detection |
| Local administrator compromise | Not guaranteed |
| Authority unavailable, malformed, mismatched, or pending recovery | Fail closed for protected operations |
| Host inventory incomplete or unverified | Host readiness remains NON_READY |
| Gateway bypass or unverified outbound route | Protected Memory disclosure remains disabled |

## 5. Implementation constraints

1. Do not add a mandatory remote service, VPS, cloud database, or network dependency for Core operation.
2. Keep Logic-Engine data local and separate from SillyTavern-owned storage.
3. Keep the local accepted-head service loopback-only; protect its database, tokens, service identity, and backup boundary.
4. Do not silently downgrade accepted-head enforcement for an already-enrolled store if the service is unavailable.
5. Do not change the production Host inventory verifier to permissive behavior merely to clear the current gate.
6. Do not promote the Host scanner from `DOUBLE_SCAN_CANDIDATE / NON_AUTHORITATIVE` to `READY` without complete lifecycle coverage and real-path evidence.
7. Keep Memory → NPC and protected Final-Send disabled until Host inventory, authorization, lifecycle, and sole-egress acceptance gates pass.
8. Do not modify the SillyTavern vectorization patch as part of this decision.

## 6. Future standalone application

The standalone application should embed or launch the same local Logic-Engine runtime and use the same local canonical storage and policy boundaries. Its UI replaces SillyTavern as the Host. The language model remains a provider integration: local model or remote API. A remote model connection must not move the engine's canonical state or Memory database to the provider.

## 8. Current code observations on `integration/host-core-v1`

These are static source observations, not runtime acceptance claims:

- `src/index.js` defaults the Core HTTP listener to `127.0.0.1`. A non-loopback bind is rejected unless `ENGINE_ALLOW_REMOTE=true` is explicitly set.
- `scripts/security/run-accepted-head-authority.js` binds the local authority to `127.0.0.1` and requires a file-backed local SQLite path plus distinct Core, Provider, and read tokens.
- `host-adapter/extension-gateway/server-plugin/index.mjs` registers the ST-facing session, identity, inventory, lifecycle, and Host version-ledger routes. It does not register a browser-facing Memory dispatch route.
- The production ST plugin entrypoint `index.mjs` imports and invokes `createEmbeddedGatewayRuntime()` from `host-adapter/embedded-gateway-runtime.mjs`; the pinned-source workflow copies both into `plugins/logic-engine`. The entrypoint registers the native Final-Send adapter against the embedded runtime when its feature flag is enabled. This confirms static composition linkage, not successful runtime loading or live model-egress interception.
- `src/index.js` still supplies `verifyInventorySnapshot: async () => false`. This remains an intentional fail-closed Host inventory gate.
- The Host generation authentication gate now separately requires an injected runtime mutation-acceptance verifier bound to the pinned ST commit, current VSS snapshot digest, source-manifest digest and mutation-coverage manifest. No production verifier is currently composed, so protected generation returns `HOST_MUTATION_RUNTIME_ACCEPTANCE_UNVERIFIED` before Core root attestation/context resolution. The positive verifier used by the integration test is explicitly test-only.

Therefore the local-first architecture is the selected product direction, but the complete ST → Logic-Engine → model transport integration is not established by these source observations alone.

## 7. Next engineering block

The next work is not provisioning infrastructure. It is:
1. implement a production runtime-acceptance verifier for the pinned SillyTavern mutation surface, using real persisted before/after/restart evidence and binding it to the current VSS snapshot, source manifest and route manifest;
2. verify runtime loading of the statically linked ST composition and prove the Host → Core/Provider → Receiver → Gateway → sole model transport path;
3. keep the local accepted-head protocol limited to the Core/Provider consistency and partial-restore guarantees it actually provides;
4. document and test the local backup/restore and recovery procedure;
5. preserve fail-closed behavior until those gates have evidence.

This decision changes deployment requirements and documentation only. It does not authorize enabling Memory → NPC, relaxing authorization, changing the Host verifier, or changing runtime schemas.
