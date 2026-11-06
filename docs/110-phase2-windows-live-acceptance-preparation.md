# Phase 2 — Windows live acceptance preparation

**Candidate:** `integration/host-core-v1`, starting HEAD `4b897b7dfdb92aed792f2d1994ba07e942be1079`  
**Target:** disposable SillyTavern 1.19.0 copy on Windows  
**Purpose:** install the missing Host ingress/browser components and prepare the real Host → Core → Provider → NPC → Gateway → Final-Send path for acceptance.  
**This is not production approval. Keep Memory → NPC disabled until the complete deployment authority and acceptance matrix is green.**

## What is already installed in the current test copy

The root Logic Engine plugin owns the managed Final-Send hook. The status response previously captured from the test copy reported:

- patch: `INSTALLED_AND_BACKUPS_VERIFIED`;
- patch version: `1.0.0`;
- gateway: `DISABLED_FAIL_CLOSED`;
- memoryNpc: `DISABLED_FAIL_CLOSED`.

This confirms patch installation and ordinary native generation compatibility only. It does not confirm Host inventory or protected Gateway dispatch.

## Missing installation components

The existing `host:install:st` installer installs the root `plugins/logic-engine` plugin and its managed Final-Send patch. It does not install the separate public Host ingress plugin or the browser locator extension.

The new additive installer installs only those two missing components. It refuses to overwrite either destination and does not touch the root Logic Engine plugin, its patch, the ST profile, or databases.

Run from the Logic-Engine checkout in PowerShell, targeting only the disposable ST copy:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
& .\scripts\install-sillytavern-host-components.ps1 -SillyTavernRoot 'C:\PATH\TO\ISOLATED-SILLYTAVERN'
```

Expected output: `HOST_COMPONENTS_INSTALLED`, with both destination paths printed.

If either destination already exists, stop. Do not delete it or rerun with overwrite; inspect and preserve the existing component first.

The installer creates:

- `plugins/logic-engine-extension-gateway` — bounded authenticated Host routes;
- `public/scripts/extensions/third-party/logic-engine-extension-gateway` — awaited generation locator metadata.

Restart the isolated ST instance after installation. Keep `enableServerPlugins: true` and `enableServerPluginsAutoUpdate: false`.

## Runtime prerequisites before enabling the embedded Gateway

The embedded runtime is not a one-flag feature. Setting `LOGIC_ENGINE_MEMORY_NPC_ENABLED=true` causes plugin initialization to require all of the following. Missing or invalid values prevent the embedded runtime from starting:

| Setting | Requirement |
|---|---|
| `ENGINE_ADAPTER_TOKENS` | JSON object containing the configured adapter ID and a secret of at least 16 characters |
| `LOGIC_ENGINE_ADAPTER_ID` | Stable adapter ID matching the token map |
| `LOGIC_ENGINE_ADAPTER_TOKEN` | Must exactly match that adapter's token |
| `ENGINE_MEMORY_PROVIDER_DB_PATH` | Separate durable Provider DB path |
| `LOGIC_ENGINE_COORDINATOR_DB_PATH` | Absolute shared Coordinator DB path |
| `ENGINE_DB_PATH` | Core DB path; opened read-only by the embedded runtime |
| `ENGINE_HOST_ASSERTION_NONCE_DB_PATH` | Absolute separate Host assertion/revocation DB path |
| `ENGINE_HOST_LIFECYCLE_DB_PATH` | Host lifecycle journal path |
| `LOGIC_ENGINE_ACCEPTED_HEAD_PORT` | Port of the independent accepted-head authority |
| `LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN` | Read-only authority token, at least 32 characters |
| `LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH` | Trusted world-pack catalog file |
| `ENGINE_MEMORY_NPC_CONTENT_FIELDS` | Non-empty JSON array of explicitly approved Provider fields |
| `LOGIC_ENGINE_HOST_IDENTITY_DIR` | Absolute deployment-owned directory outside ST global DATA_ROOT |
| `LOGIC_ENGINE_HOST_RECEIPT_DIR` | Absolute deployment-owned directory outside ST global DATA_ROOT |
| `LOGIC_ENGINE_HOST_BUILD_SHA` | Pinned Host build claim |
| `ENGINE_HOST_ROOT_IDENTITIES` | Trusted root identity registry matching this installation/account/root and source manifest |
| `ENGINE_HOST_AUTHORITY_ID` and `ENGINE_HOST_AUTHORITY_GENERATION` | Deployment-owned lifecycle authority identity and positive generation |

The accepted-head authority itself is a separate local service. It requires its own DB path, stable installation ID, three distinct secrets (Core, Provider, read-only Gateway), and fixed loopback port. Core and Provider must use the same Coordinator DB and their respective authority tokens. Do not invent enrollment baselines or enroll existing databases without an independently reviewed inventory and approval record.

Do not put secrets in Git, chat, screenshots, or diagnostic output. Do not point this test at the normal SillyTavern profile, ST-VectorService data, or any production database.

## Host ingress checks after restart

From the same authenticated ST browser session, check:

- `/api/plugins/logic-engine-extension-gateway/session`
- `/api/plugins/logic-engine-extension-gateway/identity`
- `/api/plugins/logic-engine-extension-gateway/inventory`
- `/api/plugins/logic-engine-extension-gateway/host-lifecycle/status`
- `/api/plugins/logic-engine/final-send/status`

The first three must be interpreted as authenticated Host evidence, not merely HTTP reachability. Inventory must reach an authoritative, signed, complete state before protected dispatch can become READY. A first baseline, missing root registry entry, unverified mutation, missing shared VSS snapshot or incomplete lifecycle chain remains NON_READY.

Current source accepts lifecycle sequence zero only with the all-zero genesis digest; the first actual lifecycle append must advance it to sequence one. This removes the bootstrap cycle but does not by itself prove a real Windows inventory/VSS acceptance.

## Acceptance order

1. Install the two missing Host components into the disposable ST copy.
2. Restart and verify plugin loading and the bounded Host routes.
3. Verify signed Root Inventory, lifecycle genesis, first append, and shared VSS snapshot on the real Windows filesystem.
4. Prepare isolated Core, Provider, Coordinator, dispatch ledger, Host lifecycle and Host revocation stores plus the independent accepted-head authority. Verify distinct paths and service/OS access boundaries.
5. Verify accepted-head enrollment and restore resistance on disposable data only.
6. Only after all preceding evidence is accepted, run the full protected Gateway matrix in `docs/108-gateway-live-acceptance-checklist.md`: five native routes, all 30 senders, non-streaming, streaming per-chunk revalidation, cancellation, revoke-before-start, revoke-during-inference, retry/duplicate, UNKNOWN, crash/restart, outbound-body stripping, complete-empty and incomplete-evidence cases.
7. Record exact candidate SHA, ST SHA, environment versions, upstream request counts, dispatch states and redacted evidence. No prompt text, Memory content, cookies or tokens.

**Stop condition:** any missing authority, NON_READY Host inventory, unknown sender, unexpected fallback, duplicate upstream call, response write after revocation, or ambiguous dispatch. Preserve fail-closed behavior.

## Current code/documentation reconciliation

- The current integration HEAD contains the sequence-zero/all-zero-genesis invariant in the Host inventory and source-attestation validators. Closed draft PRs #880 and #887 were not merged; do not cite either as a merged prerequisite. The invariant must still be proven against the exact installed source and live Windows lifecycle/VSS behavior.
- CI green on a commit is not a substitute for target-PC acceptance.
- The normal SillyTavern profile and ST-VectorService remain out of scope and must not be modified.
