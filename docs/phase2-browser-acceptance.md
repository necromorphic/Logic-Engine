# Phase 2 Browser Acceptance

## Purpose

Run a browser acceptance check against an already-running SillyTavern instance, using the user's existing Microsoft Edge profile. This preserves the ST session and API/model settings rather than starting an isolated Chromium profile.

## Run on Windows

Save work and close **all** Microsoft Edge windows first. From the Logic-Engine repository root:

```powershell
git pull --ff-only origin integration/host-core-v1
.\scripts\Run-Phase2-Browser-Acceptance.ps1 -BaseUrl http://127.0.0.1:55728
```

Use the exact loopback port printed by the deployment smoke harness when it selected a dynamic port.

The script will start Edge with the existing profile and a loopback-only DevTools endpoint on port 9222. When Edge opens, select the SillyTavern API/model and make sure it is connected, then return to PowerShell and press Enter. Playwright attaches to that Edge session, runs the checks, and leaves Edge open afterward.

## Safety and isolation

- The script refuses to start if any Edge process is still running; it does not forcibly terminate Edge.
- It uses the existing profile at `%LOCALAPPDATA%\Microsoft\Edge\User Data`.
- Remote debugging listens on `127.0.0.1` only. Do not change the CDP binding to a network interface.
- Playwright 1.56.1 is installed in a timestamped directory under `%TEMP%\LogicEngine-Browser-Acceptance-*`; no global install or project package manifest changes.
- The runner attaches to the existing Edge context and does not close the browser when finished.
- The runner starts a new ST chat before sending the unique acceptance message. It does not send into the previously open chat.

## Checks

- SillyTavern page loads and the message composer renders.
- Same-origin `GET /api/plugins/logic-engine-extension-gateway/session` returns HTTP 200.
- Same-origin `GET /api/plugins/logic-engine-extension-gateway/identity` returns HTTP 200.
- If the API/model connection is active, the runner sends a unique acceptance message, waits for a stable assistant response, reloads the page, and verifies both messages remain visible.
- Browser console/network warnings and uncaught page errors are recorded.

If no API/model connection is active, or no active character/chat is available, generation is reported as BLOCKED rather than being represented as a pass.

## Options

- `-SkipGeneration`: check page and identity endpoints without sending a message.
- `-TimeoutSeconds 180`: change the response wait timeout (15–600 seconds).
- `-CdpPort 9222`: change the local Edge DevTools port if required.

## Reports

The runner prints a summary and writes `browser-acceptance.json` and `browser-acceptance.png` (or a failure screenshot) under the timestamped report directory.

Exit codes: 0 = all executed checks passed; 1 = failure; 2 = blocked by environment readiness.
