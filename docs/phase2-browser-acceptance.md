# Phase 2 Browser Acceptance

## Purpose

Run a real Chromium browser against an already-running SillyTavern instance and verify the Host Gateway from the browser session.

The launcher is separate from the server/deployment smoke launcher. Start the intended SillyTavern instance first, then point this runner at its loopback URL.

## Run on Windows

From the Logic-Engine repository root:

```powershell
git pull --ff-only origin integration/host-core-v1
.\scripts\Run-Phase2-Browser-Acceptance.ps1 -BaseUrl http://127.0.0.1:8000
```

Use the exact loopback port printed by the deployment smoke harness when it selected a dynamic port.

## Downloads and isolation

No manual download or global installation is required. On first run the script installs pinned Playwright 1.56.1 and Chromium into a timestamped directory under `%TEMP%\LogicEngine-Browser-Acceptance-*`. It does not modify the Logic-Engine package manifest, lockfile, global Node packages, or the SillyTavern installation.

The temporary browser runtime is retained with the report for diagnostics. Subsequent runs currently reuse no cached runtime; each run is self-contained.

## Checks

- SillyTavern page loads and the message composer renders.
- Same-origin `GET /session` returns HTTP 200.
- Same-origin `GET /identity` returns HTTP 200.
- If an API connection is active, the runner opens a fresh chat, enters a unique acceptance message, sends it, waits for a stable assistant response, reloads the page, and verifies both messages remain visible.
- Browser console/network warnings and uncaught page errors are recorded.

If no model/API connection is active, or no active character/chat is available, generation is reported as BLOCKED rather than being represented as a pass.

## Options

- `-SkipGeneration`: check page and identity endpoints without sending a message.
- `-ShowBrowser`: show Chromium instead of running headless.
- `-TimeoutSeconds 180`: change the response wait timeout (15–600 seconds).

Generation mode starts a new chat and leaves the acceptance conversation in SillyTavern so the result can be inspected. It does not send into the previously open chat.

## Reports

The runner prints a summary and writes:

- `browser-acceptance.json`
- `browser-acceptance.png` (or failure screenshot)

under the timestamped report directory printed at the end.

Exit codes: 0 = all executed checks passed; 1 = failure; 2 = at least one check was blocked by environment readiness.
