# Windows acceptance bootstrap — Host/Core v1

**Target:** isolated acceptance installation only.  
**Branch:** `integration/host-core-v1`  
**Disposition:** preparation may proceed; Core/Provider enrollment and protected dispatch remain blocked until independent baseline and Host identity evidence exist.

## 1. Safety boundary

Use only:

- Logic Engine checkout: `C:\\LogicEngine\\Logic-Engine`
- SillyTavern acceptance copy: `C:\\AI\\SillyTavern-Windows-Acceptance`
- acceptance data root: `C:\\AI\\LogicEngine-Acceptance`

Do not point any command at the original SillyTavern installation or an existing user database. Do not create replacement IDs for Host installation, authenticated account, session, root, or source-manifest identity. Do not enroll Accepted-Head until the database baseline and source inventory have been independently reviewed and recorded.

Memory → NPC must remain disabled.

## 2. Configuration names: source of truth

The current source reads these names:

### Core process

- `ENGINE_API_TOKEN` (required; minimum 16 characters)
- `ENGINE_ADAPTER_TOKENS` (JSON object; each secret minimum 16 characters and unique)
- `ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES` (JSON array; only deployment-approved records)
- `ENGINE_DB_PATH`
- `LOGIC_ENGINE_COORDINATOR_DB_PATH` (required absolute path)
- `LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH` (required deployment-controlled catalog)
- `ENGINE_HOST_VERSION_LEDGER_DB_PATH` (optional; otherwise default under ./data)
- `ENGINE_HOST_ASSERTION_NONCE_DB_PATH` (optional; otherwise default under ./data)
- `ENGINE_HOST_ROOT_IDENTITIES` (deployment-owned JSON allowlist; empty means no root is authorized)
- `ENGINE_HOST_AUTHORITY_ID`
- `ENGINE_HOST_AUTHORITY_GENERATION`

### Embedded Gateway inside the ST server process

- `LOGIC_ENGINE_ADAPTER_ID`
- `LOGIC_ENGINE_ADAPTER_TOKEN` (must exactly match the corresponding entry in `ENGINE_ADAPTER_TOKENS`)
- `ENGINE_ADAPTER_TOKENS`
- `ENGINE_DB_PATH` (existing accepted Core DB; opened read-only by the Gateway)
- `ENGINE_MEMORY_PROVIDER_DB_PATH`
- `LOGIC_ENGINE_COORDINATOR_DB_PATH`
- `ENGINE_MEMORY_DISPATCH_LEDGER_DB_PATH`
- `ENGINE_HOST_LIFECYCLE_DB_PATH`
- `ENGINE_HOST_ASSERTION_NONCE_DB_PATH`
- `LOGIC_ENGINE_ACCEPTED_HEAD_PORT`
- `LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN` (separate from Core and Provider tokens)
- `LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH`
- `ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES`
- `ENGINE_MEMORY_NPC_CONTENT_FIELDS` (non-empty allowlist required only when the embedded Memory/NPC runtime or Core Memory Provider is configured; do not add it merely for Memory-disabled native-generation acceptance)
- `ENGINE_HOST_ROOT_IDENTITIES`
- `ENGINE_HOST_AUTHORITY_ID`
- `ENGINE_HOST_AUTHORITY_GENERATION`

The earlier presence report also listed `LOGIC_ENGINE_API_TOKEN`, `LOGIC_ENGINE_CORE_URL`, and `LOGIC_ENGINE_ADAPTER_TOKEN`. These are not substitutes for the Core's `ENGINE_API_TOKEN`; URL/token names may be consumed by the ST plugin configuration and must be audited separately. Do not rename variables by guesswork.

## 3. Accepted-Head Authority

The service entrypoint is:

```powershell
node scripts/security/run-accepted-head-authority.js
```

It binds to `127.0.0.1` only. It requires:

- `LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH` — absolute file path
- `LOGIC_ENGINE_ACCEPTED_HEAD_INSTALLATION_ID` — stable service installation identifier
- `LOGIC_ENGINE_ACCEPTED_HEAD_CORE_TOKEN`
- `LOGIC_ENGINE_ACCEPTED_HEAD_PROVIDER_TOKEN`
- `LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN`
- `LOGIC_ENGINE_ACCEPTED_HEAD_PORT`

All three tokens must be distinct and at least 32 characters. Keep them outside source control and logs. The authority DB must be writable only by the authority service identity. The service code does not create Windows ACLs or install a Windows service.

Core and Provider must use the same absolute `LOGIC_ENGINE_COORDINATOR_DB_PATH`; each process must set `LOGIC_ENGINE_ACCEPTED_HEAD_REQUIRED=1` and its own domain token.

**Do not start enrollment yet.** The enrollment script requires an existing file-backed Core/Provider DB, the coordinator DB, an approval ID, and a 64-character SHA-256 baseline digest. The approval ID and digest must refer to independently reviewed evidence. They are not values to generate merely to satisfy the script. The enrollment helper also requires the local accepted-head schema to exist and be fresh.

## 4. Required order of operations

1. **Freeze and identify the data sources.** Confirm whether a Core DB or Provider DB already exists in the acceptance root. Record its exact path, file hash, schema/version, and provenance. Never enroll an unknown or user-data DB.
2. **Review the World Pack.** Select an actual reviewed artifact. Put the catalog and artifact under a deployment-controlled directory. The catalog entry must contain the exact artifact SHA-256, matching `world_pack_id` and `version`; the artifact must be a regular file beneath the catalog directory.
3. **Create service secrets locally.** Generate separate random tokens for Core API, adapter, Accepted-Head Core, Accepted-Head Provider, and Accepted-Head read access. Do not print them or commit them. The adapter token must be identical in Core's adapter map and ST's adapter setting.
4. **Prepare isolated database paths.** Core, Coordinator, Provider, Dispatch Ledger, Host Lifecycle, Host Assertion/Revocation, Host Version Ledger, and Accepted-Head Authority must be separate files. Confirm no path aliases another file. Do not create or initialize a DB by guessing its intended schema.
5. **Restrict the Accepted-Head DB.** Apply and verify a Windows ACL that grants write access only to the authority service identity and required read access only where explicitly needed. The Core/Provider/Gateway clients communicate over the authenticated loopback service; they must not write the authority DB directly.
6. **Start the Accepted-Head service only after the ACL check.** Confirm it listens on the configured loopback port. Query its status with the read token. Both domains must initially be un-enrolled with head 0 and no pending operation.
7. **Review each database baseline independently.** Produce an evidence record for Core and Provider separately. Only after review may an operator provide an approval ID and baseline digest to the explicit enrollment script. Enroll Core and Provider separately; verify both report enrolled, no pending operations, and the expected head.
8. **Start the isolated ST copy in Host-only acceptance mode.** Keep `LOGIC_ENGINE_MEMORY_NPC_ENABLED` unset/false. Configure only the Host identity/receipt directories and the pinned Host components. This startup is for collecting the real signed ST session identity; it is not a protected generation test.
9. **Collect the real ST session identity.** From the authenticated browser session, call `/api/plugins/logic-engine-extension-gateway/session`, then `/identity`. Record the returned installation/account/session identifiers locally. Do not fabricate them. The identity route does not prove Root Inventory completeness.
10. **Start Core with isolated paths and reviewed deployment configuration.** Then verify the Host `/inventory` route can persist the full-root manifest and receive a signed authoritative result. A missing root registry binding, source-manifest mismatch, missing shared VSS snapshot, or incomplete lifecycle chain must remain NON_READY.
11. **Run read-only preflight and base integration acceptance.** Validate process-specific variables, JSON schemas, path separation, ACL, source hash, World Pack catalog, Accepted-Head status, and actual Host identity. Keep Memory → NPC disabled. Once Host inventory is AUTHORITATIVE_COMPLETE, run lifecycle persistence checks and two ordinary native model generations with exactly-once response delivery. The separate Host Version Digest Ledger verifier remains deny-only by design; it is not a substitute for, nor proof of, the signed Root Inventory gate required by Host preparation.

## 5. Current known blockers

- No independently reviewed Core/Provider baseline evidence or approval IDs are present in the current conversation.
- No actual Host root identity binding has been collected.
- No verified Windows ACL/service identity has been established for Accepted-Head.
- No reviewed World Pack artifact/catalog has been selected.
- The current Host lifecycle design remains fail-closed when the required signed inventory/receipt evidence is absent.
- The embedded Memory/NPC runtime is optional while `LOGIC_ENGINE_MEMORY_NPC_ENABLED` is false. Its content-field allowlist is not a prerequisite for the base Host identity/session and ordinary native-generation acceptance path unless the Core Memory Provider is separately configured.

## 6. Acceptance rule

A successful patch installation, HTTP 200, service listening state, or Accepted-Head head value alone does not establish readiness. Do not enable protected dispatch unless the real Host identity, complete reviewed inventory, lifecycle authority, Core/Provider accepted heads, and sole-egress Final-Send gates all pass.
