# Phase 2 Windows live acceptance preparation

**Target:** a disposable SillyTavern 1.19.0 copy on Windows.

**Candidate branch:** integration/host-core-v1. Record the exact HEAD SHA immediately before testing; do not use a moving branch name as the test identity.

**Scope:** verify the Host patch installation, Host authentication/identity, Root Inventory, lifecycle persistence, VSS snapshot, Final-Send registration, and ordinary native generation. Memory → NPC remains disabled.

## 0. One-command isolated installation smoke test

The runner downloads and checks out the exact pinned SillyTavern 1.19.0 source commit itself, then creates a disposable test copy. It does not read an extracted local SillyTavern directory or the daily profile.

From the Logic-Engine checkout, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-LogicEngine-PR870-Test.ps1 -CandidateCommit "<exact-40-character-PR-870-SHA>"
```

The runner:

- checks Node.js, Git, npm registry and GitHub access before copying anything;
- checks out the supplied exact Logic Engine candidate SHA (do not use a moving branch name for acceptance);
- copies the clean SillyTavern release into a disposable directory under `%TEMP%`;
- installs SillyTavern dependencies with its committed lockfile;
- calls the same `install-sillytavern-host-plugin.ps1` installer used for deployment;
- verifies the root plugin, Gateway plugin, pinned source manifest and browser extension;
- prepares a disposable Host identity and a deployment-owned Core root-identity registry from the installed pinned source manifest;
- starts a separate Core process with fresh SQLite databases, a local World Pack catalog and generated per-run credentials;
- starts the disposable SillyTavern instance on loopback with Core URL and credentials configured.

It does not modify the source SillyTavern directory. It does not require ST-VectorService and does not connect to it. Memory → NPC is explicitly disabled. The Core databases, credentials and identity registry are disposable and are kept under the printed temporary directory for diagnostics.

**Scope limitation:** this runner exercises the actual Host-to-Core HTTP connection, identity binding, Root Inventory baseline/attestation attempt, lifecycle endpoints, plugin loading and ordinary native generation. It does not promote the local acceptance bypass to production authority. Uncovered mutation routes remain marked non-authoritative, and a successful smoke run does not authorize Memory → NPC or prove the full protected Final-Send matrix.

The runner uses `LOCAL_LOOPBACK_ONLY`. Do not expose either temporary service to LAN, VPN, reverse proxies or the public internet. Preserve the printed temporary directory, Core logs and `TEST-INFO.txt` after stopping the server.

## 1. Preconditions

- The P0 stabilization commit is on integration/host-core-v1.
- Required GitHub Actions checks are green on that exact commit.
- For the manual procedure below, the root Logic Engine runtime must be installed at plugins/logic-engine.
- Its managed Final-Send patch must be installed and verified.
- The target SillyTavern copy is disposable and backed up.
- Node.js 22.13.0 or newer is installed.
- No unknown server plugins or third-party browser extensions are present.

Do not use the daily SillyTavern profile for this test.

## 2. Install the Host bundle

From the Logic Engine repository root:

```powershell
git status --short
git rev-parse HEAD
npm run host:install:bundle -- --st-root "C:\Path\To\Disposable\SillyTavern"
```

The installer must report a verified installation. It verifies the existing root Logic Engine entrypoint and package identity, applies the three Host patches, installs the Gateway server plugin and browser extension, writes the pinned source manifest, and keeps backups for rollback.

The installer must not overwrite plugins/logic-engine or the existing Final-Send patch state. If it reports an unknown file, source mismatch, unsupported SillyTavern version, or incomplete backup, stop. Do not delete the conflicting file to force installation.

## 3. Start and verify the two first-party plugins

Start the disposable SillyTavern copy using the normal server startup process.

Under Host authority, both first-party server plugins must load:

- logic-engine — registers the Final-Send adapter and status endpoint.
- logic-engine-extension-gateway — provides the authenticated Host ingress.

All other server plugins must remain blocked. The browser extension must be present only at public/scripts/extensions/third-party/logic-engine-extension-gateway.

Verify:

- /api/plugins/logic-engine/final-send/status reports the existing Final-Send adapter as active.
- /api/plugins/logic-engine-extension-gateway/session returns the authenticated SillyTavern session identity.
- /api/plugins/logic-engine-extension-gateway/identity resolves the persisted Host identity.
- /api/plugins/logic-engine-extension-gateway/inventory reports the current source and Root Inventory state.
- The lifecycle status endpoint reports the expected genesis or persisted sequence.

Do not treat HTTP 200 alone as proof of authority. Check the response identity, readiness state, source status, and diagnostic code.

## 4. Temporary local UI acceptance mode

The mutation receipt protocol does not yet cover every SillyTavern write route. To test the installed UI, session, Gateway and Final-Send composition without mistaking that gap for a broken server, the Host patch supports an explicit local-only acceptance switch.

In the disposable SillyTavern PowerShell window, set the variable **before** starting the server:

```powershell
$env:LOGIC_ENGINE_HOST_ACCEPTANCE_MODE = "LOCAL_LOOPBACK_ONLY"
npm start
```

This permits otherwise-unreceipted mutation routes only when the TCP peer is loopback (127.0.0.1, ::1, or ::ffff:127.0.0.1) and a Host session is active. Accepted mutation responses carry:

```
X-Logic-Engine-Host-Acceptance: LOCAL_NON_AUTHORITATIVE
```

This is a temporary test bypass, not a production fix and not evidence that mutation receipts are complete. Do not expose the test server to LAN, VPN, reverse proxies, or the public internet while this variable is set. Remove the variable and restart the server to return to strict fail-closed behavior:

```powershell
Remove-Item Env:LOGIC_ENGINE_HOST_ACCEPTANCE_MODE -ErrorAction SilentlyContinue
npm start
```

Memory → NPC remains disabled. The test mode does not promote the Host mutation runtime acceptance blocker to READY.

## 5. Verify Root Inventory and lifecycle

Use a fresh disposable chat and verify the full lifecycle:

1. Host Root Scan completes against the installed source.
2. Root Manifest is persisted server-side.
3. Source attestation matches the pinned handler and patch bundle.
4. Lifecycle attestation is signed and bound to the current Host identity.
5. Core VSS snapshot is persisted.
6. Inventory state survives a SillyTavern restart.
7. A changed source file or unexplained Root Drift makes readiness non-ready.
8. A missing or invalid lifecycle attestation cannot promote Inventory to READY.

For a fresh account, sequence zero is valid only with the all-zero genesis digest. The first persisted lifecycle append must advance the sequence to one.

## 6. Verify ordinary generation and Final-Send

With Memory → NPC still disabled:

- Open a normal chat.
- Send a standard native model request.
- Confirm the model response is delivered once.
- Confirm Final-Send remains active.
- Confirm a second ordinary request still works after the first.
- Restart SillyTavern and repeat the status and ordinary-generation checks.

This stage does not authorize enabling Memory → NPC or bypassing the protected Gateway flow.

## 7. Stop conditions

Stop the acceptance run if any of the following occurs:

- either first-party plugin fails to load;
- an unreviewed plugin is loaded;
- Host identity changes between requests;
- Root Inventory is READY with missing or mismatched source evidence;
- lifecycle state does not survive restart;
- Final-Send is unavailable;
- ordinary generation is blocked or delivered more than once;
- a source mismatch is accepted;
- the installer overwrites an unknown file or cannot roll back.

Save the SillyTavern console output, Host/Core logs, installer report, and exact candidate SHA. Do not repeatedly retry a failed scenario without diagnosing its first failure.

## 8. Not part of this acceptance

Memory → NPC stays disabled. The five protected routes, 30 sender identities, Dispatch Ledger replay/revocation cases, and full Gateway/Final-Send security matrix remain subject to the separate P1 acceptance evidence. A successful Windows install does not replace those checks.

## 9. Evidence to retain

- Candidate branch and exact commit SHA.
- SillyTavern version and Node.js version.
- Installer report and backup directory.
- Host Inventory response and readiness state.
- Source manifest digest and handler/patch bundle pins.
- Final-Send status response.
- Startup and restart logs.
- Result of ordinary native generation.
- Any remaining REVIEW_ONLY or NON_READY blockers.
