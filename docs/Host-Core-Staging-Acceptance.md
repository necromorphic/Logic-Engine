# Host/Core staging acceptance and operational scope

Status: **staging integration evidence**  
Applies to: `integration/host-core-v1` / PR #870

## 1. What this integration proves

The staging retrieval path is:

`SillyTavern Host adapter → authenticated Core HTTP → MemoryNpcConsumer → file-backed SQLiteMemoryProvider → Result Envelope`

The Host owns the SillyTavern-side request gate, server-persisted installation/account identity, inventory preconditions, and the signed assertion. Core verifies the assertion, consumes its durable nonce, resolves World/Actor from Core-owned bindings, applies Core authorization, retrieves through `MemoryNpcConsumer`, and returns the strict Result Envelope.

This PR does **not** implement or claim:

- serialization of arbitrary SillyTavern chat metadata, digests, or identity collections into an NPC prompt context;
- an NPC/model receiver that consumes the Result Envelope;
- model prompt construction or model dispatch;
- a final-send authorization gate or durable dispatch-start protocol.

Those belong to separately scoped Host context and Gateway/Final-Send work. The retrieval endpoint returns candidates and admission data; it does not itself cause model dispatch.

## 2. Production authorizer wiring

The production runtime does not use the standalone Consumer's deny-all default as its configured authorizer.

The actual composition is:

1. `src/index.js` reads `ENGINE_ADAPTER_TOKENS` and constructs the persistent Core `SQLiteStore`.
2. It creates `createMemoryNpcProviderAdapter` for each configured adapter when `ENGINE_MEMORY_PROVIDER_DB_PATH` is set.
3. `createMemoryNpcProviderAdapter` constructs `createHostBoundNpcKnowledgeAuthorizers` using the live Core store, configured adapter ID, and deployment-owned trusted-source registry.
4. It passes `coreAuthorizers.memoryQueryAuthorizer` into `MemoryNpcConsumer` as `coreQueryAuthorizer`.
5. `src/index.js` places the resulting Consumer facade in `memoryNpcConsumers[adapterId]` and passes that map to `createApiServer`.

The default `coreQueryAuthorizer = () => false` on the low-level Consumer constructor is an intentional fail-closed fallback for uncomposed/direct construction. It is not the production adapter wiring. The production authorizer requires the verified Host-session capability, fixed `recipient: model` and purpose, an active adapter/conversation/World binding, and an active adapter/World/Actor binding. Provider query and record grants are additional restrictions; they cannot replace Core authorization.

Required deployment configuration includes:

- `ENGINE_API_TOKEN` — Core HTTP bearer secret;
- `ENGINE_MEMORY_PROVIDER_DB_PATH` — durable Provider SQLite path; when absent, the Memory retrieval consumer is not created;
- `ENGINE_MEMORY_NPC_CONTENT_FIELDS` — non-empty JSON allowlist of Core-authorized fields;
- `LOGIC_ENGINE_COORDINATOR_DB_PATH` — absolute path to the shared Coordinator database;
- `ENGINE_DB_PATH` — Core canonical database path;
- `ENGINE_ADAPTER_TOKENS` — JSON object mapping each adapter ID to a unique server-to-server secret;
- `ENGINE_HOST_ROOT_IDENTITIES` — JSON array of deployment-approved `{ adapter_id, host_installation_id, authenticated_account_id, root_id }` bindings; an empty array leaves Host root lifecycle authority unconfigured;
- `ENGINE_HOST_AUTHORITY_ID` and `ENGINE_HOST_AUTHORITY_GENERATION` — deployment-owned lifecycle authority identity and positive generation; both are required for an active root lifecycle authority;
- `ENGINE_HOST_LIFECYCLE_DB_PATH` — durable lifecycle journal SQLite path (defaults to `./data/logic-engine-host-lifecycle.sqlite`);
- `ENGINE_HOST_ASSERTION_NONCE_DB_PATH` — durable assertion replay SQLite path (defaults to `./data/logic-engine-host-assertion-nonces.sqlite`);
- `ENGINE_HOST_VERSION_LEDGER_DB_PATH` — durable Host version ledger path (defaults to `./data/logic-engine-host-versions.sqlite`);
- `LOGIC_ENGINE_HOST_BUILD_SHA` — pinned Host build claim supplied to the SillyTavern Host adapter; it is a deployment claim, not runtime attestation;
- `ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES` — deployment-owned source registry (may be an empty array when no such trusted sources are configured);
- `LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH` — deployment-controlled World Pack catalog path required by Core startup.

The SillyTavern Host adapter also reads `globalThis.DATA_ROOT` from the SillyTavern server runtime to resolve the authenticated user's data directories. This is a Host-process runtime global; it is not expected to be set by Core `src/index.js`. The adapter fails closed with `HOST_IDENTITY_DATA_ROOT_UNAVAILABLE` if it is absent.

The adapter token is also the HMAC-SHA256 key for that adapter's Host assertion. The Core API bearer and adapter token are distinct credentials. The adapter token is server-to-server only; it must not be exposed to browser code, prompts, query strings, or logs. Configure the matching value in the SillyTavern server-side Host extension and Core runtime. This version has no dual-key overlap/rotation protocol; rotate the two sides as one coordinated maintenance change and repeat the staging acceptance checks.

If `ENGINE_MEMORY_PROVIDER_DB_PATH` is absent, the runtime does not create Memory Provider consumers. If Provider configuration is present but invalid or incomplete, startup fails rather than silently substituting an in-memory Provider or permissive authorizer.

## 3. Test boundaries: fixture versus production code

### Existing same-process E2E

`tests/host-core-sqlite-e2e.test.js` uses the real Host adapter, Core HTTP server, `MemoryNpcConsumer`, file-backed SQLite Provider, and file-backed assertion nonce store. It sends a real HTTP request through Node `fetch`.

Its fixtures include the ST request/session object, authoritative inventory enumerator output, accepted root-inventory persistence result, test identity, World/Actor binding, Provider record, and grants. It does not launch a SillyTavern installation or prove the live ST authentication middleware is connected to a real logged-in user.

### Cross-process E2E

`tests/host-core-cross-process.test.js` launches the Core HTTP server in a separate operating-system process using `tests/fixtures/host-core-sqlite-core-server.mjs`. The Host adapter remains in the test process and reaches Core over an actual loopback TCP HTTP connection. Core opens its own file-backed Core, Provider, Coordinator, and nonce SQLite databases. The test asserts the child PID differs from the Host test PID and verifies a retrieved candidate crosses the process/network boundary.

The cross-process test proves OS-process separation and a real loopback TCP HTTP exchange between the Host adapter runtime and Core. It still runs the Host adapter inside the test harness rather than a separately booted SillyTavern server, and uses a fixture ST request, fixture inventory, and fixture root-proof result. It therefore does not prove live ST authentication integration or behavior under real machine-to-machine network partitions, TLS termination, DNS, or production process supervision.

### Revocation and recipient semantics

The retrieval HTTP route is intentionally read-only. It does not expose a caller-controlled Provider-record revoke endpoint. The `DELETE /v1/host-conversation-bindings/{adapter}/{conversation}` lifecycle operation (where configured) revokes a conversation binding; it is not a Provider-record revoke API and must not be described as one. Provider record revocation is performed through the trusted Core/Provider control path; retrieval must observe the resulting denied grant and disclose no candidate. The E2E Provider-level revoke test verifies this read-side behavior, but it is not a test of an HTTP Provider-record revoke API.

`recipient` is fixed to `model` by the Consumer contract, not accepted from the request body. The production Core authorizer explicitly rejects any query scope whose recipient is not `model`. A separate user-selectable recipient API is not part of this integration.

## 4. Acceptance still required on a real SillyTavern installation

Before enabling this path for production use, run a separate test SillyTavern installation against a separately running Core service and verify:

1. a real logged-in ST request passes the pinned Host authentication middleware;
2. the real Host filesystem inventory scan and Core root-inventory acceptance both complete;
3. the Host assertion is accepted by Core and the request resolves the intended Core World/Actor;
4. the configured Provider returns only granted, current, allowlisted data;
5. identity mismatch, replay, expired assertion, revoke, stale Provider data, and incomplete inventory all fail closed;
6. no prompt/model dispatch is implied by retrieval success; Final-Send remains a separate gate.

Do not use the user's primary roleplay installation for the first acceptance run. Record the exact ST build, extension build, Core HEAD, Provider configuration, and redacted request/result diagnostics.

## 5. Commands and evidence

Run the repository suite on the exact candidate HEAD:

```sh
npm test
```

The cross-process test is part of the normal Node test suite. CI evidence is valid only for the exact commit SHA reported by the PR after the final changes.
