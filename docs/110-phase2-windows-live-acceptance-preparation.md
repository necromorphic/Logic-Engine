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

## 10. Acceptance execution log (do not repeat passed steps without a version change)

### Windows live run — 2026-11-09

**Candidate:** PR #946, branch fix/windows-root-inventory-path-order.

**Exact Logic Engine commit tested:** 6d277bd881772f735e34f0951f40dc7fe0302d7a.

**SillyTavern source:** 06bde939fb1e9c4c8d8641d810f0a916b5bce127 (pinned 1.19.0).

**Patch state:** Host patch 1.0.0; Gateway and Memory → NPC report DISABLED_FAIL_CLOSED.

**Environment:** Windows, Node.js 22.18.0, npm 10.9.3, disposable ST/Core loopback harness. Temporary root recorded by the operator: LogicEngine-ST-Test-20261109-093251.

**Passed and retained as evidence for this exact candidate/environment:**

- Isolated SillyTavern and Core start successfully.
- Both first-party server plugins load.
- Native model generation works; chat messages save; character cards can be created and saved.
- Authenticated ST session endpoint succeeds.
- Persisted Host identity endpoint succeeds using the same cookie session.
- Initial conversation enrollment creates a baseline with sequence 1 and explicitly marks pre-enrollment history UNKNOWN_UNRECOVERABLE, REVIEW_ONLY, NON_READY.
- Disposable Core World provisioning succeeds.
- Explicit Host conversation-to-World binding succeeds (BOUND, active, fixed test World).
- The initial installer/backup verification and pinned ST source identity are recorded as successful for this harness run.

Do not repeat these steps unless the tested Logic Engine commit, Host patch bundle, pinned ST commit, or disposable harness changes in a way that affects them.

**Current blocker at the tested commit:**

- GET /api/plugins/logic-engine-extension-gateway/inventory?... returned HTTP 503, SOURCE_INVENTORY_UNAVAILABLE, reason UNKNOWN.
- Follow-up POST .../host-version-ledger/reconcile returned HTTP 409, HOST_INVENTORY_INCOMPLETE.
- Core capture status remained NOT_SYNCED.
- The 409 is downstream of incomplete Host inventory; it is not an independent root cause.
- Root cause is not yet established. Do not label the Root Inventory ordering fix as proven to have solved the Windows failure until a successful authoritative inventory response is observed.

### Diagnostic patch after the failed run

The candidate was advanced after the above test to add bounded server-side diagnostics for unexpected Host Inventory exceptions. The browser response remains fail-closed and does not expose paths, chat IDs, UUIDs, or raw exception text. The diagnostic patch is not yet Windows-accepted until the operator runs the updated candidate once and the server log identifies the failure.

Commits after the tested run:
- 6573463a55ceb8b8ee1d6324d856d92ff9d31224 — safe server-side Host Inventory diagnostics.
- 5eae547b9da153e9bb07a6cf6f452fb6008cb1a2 — diagnostic redaction correction.
- 3924d5a9c3fe0be5cd474c53bc79a5c7b2375a55 — diagnostic regression tests.
- d1335980f5404087c4228d5a1296efb76103bee8 — complete test fixture.

These commits do not retroactively change the version on which the failed Windows result was observed.

## 11. Remaining acceptance gates for Phase 2

Run only the failed or not-yet-proven gates below. Preserve the exact Logic Engine SHA and patch bundle digest with every new result.

### A. Windows Host / Root Inventory — currently blocking

1. On the diagnostic candidate, capture the single server-side [LogicEngine] Host inventory failed diagnostic from the existing isolated run. Identify and fix the actual exception; do not loop the browser request.
2. Re-run the inventory sync once after the fix. Required: complete filesystem inventory from one shared VSS snapshot, matching source inventory snapshot ID, verified pinned source identity, verified mutation-route coverage, Core baseline and attestation accepted, and an authoritative reconciliation response.
3. Confirm Core capture changes from NOT_SYNCED to the documented ready state only after all proofs are accepted.
4. Confirm lifecycle sequence/head and root manifest survive a SillyTavern restart without creating a second baseline or silently rebinding the conversation.
5. Change one enrolled file in the disposable root and confirm the next inventory detects the exact drift and remains non-ready until reconciled.
6. Confirm missing, stale, malformed, or mismatched VSS/source/lifecycle evidence cannot produce AUTHORITATIVE_COMPLETE.
7. Confirm the Windows VSS snapshot is released on both success and failure; no live-tree fallback is permitted.

### B. Host mutation authority

1. Exercise the covered mutation routes against a real ST session and verify each accepted mutation produces exactly one durable receipt.
2. Exercise unsupported mutation routes and confirm they fail closed without modifying data.
3. Exercise pending mutation recovery after process interruption; confirm no duplicate receipt, partial mutation, or generation while recovery is required.
4. Repeat only the relevant UI save/create flows after mutation receipts are authoritative. The earlier local acceptance-mode success is explicitly non-authoritative and does not satisfy this gate.

### C. Core / Memory / NPC context

1. Verify durable World/Actor binding and authorization are resolved by Core, not selected by browser request data.
2. Verify both NPC evidence lanes are immutable and handed off exactly once, with the expected source, identity, sequence and authorization.
3. Verify missing, stale, revoked, cross-world, cross-actor, and replayed evidence fails closed.
4. Verify provider/context construction produces the expected bounded NPC context and no legacy retrieval or alternate route bypasses Core authorization.

### D. Gateway / Final-Send protected flow

1. Verify all five protected routes through the real Host → Core → Provider → NPC → Gateway → Final-Send path.
2. Verify the 30 sender-identity cases, including valid identities and invalid/forged/mismatched identities.
3. Verify Dispatch Ledger idempotency, replay rejection, revocation, expiry, and duplicate-send prevention.
4. Verify cancellation, crash/restart, timeout, and partial-failure cases do not cause a second send or a send after revocation.
5. Verify the final response is delivered exactly once and ordinary native generation remains functional when Memory → NPC is disabled.
6. Verify there is no alternate direct ST/Core route, legacy fallback, or bypass around the Extension Gateway and Final-Send gates.

### E. SQLite VFS / ST-VectorService integration

1. Verify POSIX xDelete semantics and Windows handle-relative deletion without path traversal or reparse-point escape.
2. Verify database/WAL/SHM role and sidecar manifest consistency, including create, checkpoint, close, delete and reopen.
3. Verify crash recovery and interrupted WAL/SHM cleanup preserve database integrity and never delete an unrelated file.
4. Verify Windows ACL/handle ownership and POSIX permissions enforce the intended provider boundary.
5. Verify ST-VectorService uses the approved VFS/provider path and cannot open or mutate the database through an alternate filesystem path.
6. Verify corruption, missing sidecar, stale manifest, permission denial and concurrent access all fail closed with recoverable diagnostics.

### F. CI and release evidence

- All required workflows must be green on the exact candidate SHA that is being accepted; a previous SHA's green run does not qualify.
- The Windows live acceptance must be green on that same candidate and pinned ST commit.
- Security review must confirm no acceptance-only bypass is enabled in production configuration.
- Memory → NPC stays disabled until A–F are accepted and the release authority explicitly enables it.

**Current completion state:** Windows installation/session/enrollment/binding smoke path is partially accepted. Root Inventory is blocked. Full Phase 2 acceptance is not complete.

### CI review — 2026-11-09, candidate 56dd34e395516469d8b1d99add1dcae7652d7b35

Completed workflow results:

- PASS: Host Account Mutation Receipts.
- PASS: Host browser IndexedDB restart.
- PASS: Host Extension Gateway static validation.
- PASS: Host Extension Gateway candidate check.
- PASS: Pinned SillyTavern Host source audit.
- PASS: Gateway Final-Send Validation.
- FAIL: Runtime tests — 2,128 passed, 67 skipped, 1 failed.
- FAIL: Host Extension Gateway pinned SillyTavern source audit.
- FAIL: SillyTavern Host Plugin Installer.

The three failures share one cause: the exact Git blob pin for the Host inventory handler was calculated/compared inconsistently across Windows line-ending modes. Windows may materialize CRLF while the reviewed source identity is the canonical LF Git blob. The installer/pinned-source generator and the consistency test did not all normalize line endings identically.

The failing runtime assertion was `Host and Core pin the same exact lifecycle patch bundle and inventory handler`. The pinned-source audit and installer stopped at `HOST_PINNED_HANDLER_BLOB_SHA_MISMATCH`; these are not independent installer defects.

### Corrective patch — after 56dd34e395516469d8b1d99add1dcae7652d7b35

- Canonical handler Git blob pin aligned to `2c83528f5d66068de186425bf93e8cb6e336ca3a` in Host and Core.
- Pinned-source generator now normalizes CRLF/CR to LF before calculating the handler Git blob identity.
- Cross-platform pin consistency test now calculates the same canonical LF identity.

Corrective commits:
- `15c7974a84387b41856e359c92c0fcd6f48873aa` — Host canonical pin.
- `94e4f6b89784dbbb85b5eb664bcdadc02462645c` — Core canonical pin.
- `c8458ccb83b62dc2dba7f2e1fb2e57979c8453d9` — generator line-ending normalization.
- `1e980eafbc20a85f4fe5bd83e7dbbf373ab5a11` — cross-platform consistency test.

These corrective changes are awaiting exact-head CI. Do not repeat the Windows live test yet; the current blocker is CI/source-pin consistency, not a newly established Host Inventory runtime diagnosis.


### CI review — 2026-11-09, candidate 3e63fa0c9e939d7cfa95c255bd64974e1aa26725

Completed workflow results:

- PASS: Host Extension Gateway static validation.
- PASS: Host Extension Gateway candidate check.
- PASS: SillyTavern Host Plugin Installer.
- PASS: Host Extension Gateway pinned SillyTavern source audit.
- PASS: Pinned SillyTavern Host source audit.
- PASS: Host Account Mutation Receipts.
- PASS: Host browser IndexedDB restart.
- PASS: Gateway Final-Send Validation.
- FAIL: Runtime tests — 2,124 passed, 67 skipped, 5 failed.

The five failures are one fixture-drift issue, not five independent runtime defects. The Host and Core implementation now correctly pins the canonical Host inventory handler Git blob SHA to `2c83528f5d66068de186425bf93e8cb6e336ca3a`, but two test fixtures still signed attestations containing the previous SHA `7fa465f6276dac38c386c4a91245ec5b8c79cde8`. The strict attestation shape/pin validator therefore rejects those fixtures as `HOST_ROOT_INVENTORY_ATTESTATION_INVALID` before the signature-verification branch is reached. The five affected tests are in `tests/host-lifecycle-journal.test.js` and `tests/host-root-inventory-attestation-api.test.js`.

### Fixture correction — 2026-11-09

Updated the stale Host handler pin in both affected test fixtures to the canonical SHA:

- `caf379617ccfdb140f2febd10d23875c5245aaf8` — lifecycle journal attestation fixture.
- `5f2107afab8b3f1b00d08a60fb7be646e2ea9f41` — Core HTTP attestation fixture.

These are fixture-only corrections. No production validation was weakened and no security gate was bypassed. The correction is not accepted until Runtime tests and all required workflows pass on the exact resulting branch head.

**Next verification:** inspect CI on the latest PR #946 head. Do not rerun Windows live acceptance yet; the immediate blocker is the stale test fixture, now corrected. Once exact-head CI is green, resume at the single outstanding Windows Root Inventory sync/diagnostic step; do not repeat the already-passed installer, ST session, enrollment, World creation, or binding setup.
