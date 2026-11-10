# Phase 2 Browser Acceptance

## Purpose

Run browser acceptance against SillyTavern using the user's existing Microsoft Edge profile. This preserves the ST session and API/model settings rather than starting an isolated Chromium profile.

## Run on Windows

Save work and close **all** Microsoft Edge windows first. From the Logic-Engine repository root:

```powershell
git pull --ff-only origin integration/host-core-v1
.\scripts\Run-Phase2-Browser-Acceptance.ps1 -BaseUrl http://127.0.0.1:55728
```

Use the exact loopback port printed by the deployment smoke harness when it selected a dynamic port.

The script starts Edge normally with the existing profile and opens `edge://inspect`. In Edge, select **Remote debugging** in the left navigation and enable **Allow remote debugging for this browser instance**. Return to PowerShell and press Enter. The script reads the local DevTools port created by Edge, opens the SillyTavern URL in that same profile, and asks you to select the API/model. After the model is connected, press Enter again; Playwright attaches to that same profile. Edge remains open after the test.

## Safety and isolation

- The script refuses to start if any Edge process is still running; it does not forcibly terminate Edge.
- It uses the existing profile at `%LOCALAPPDATA%\Microsoft\Edge\User Data`.
- It uses Edge's built-in per-instance remote-debugging permission. It does not launch Edge with remote-debugging flags against the protected default profile, copy the profile, or bind debugging to a network interface.
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

## Reports

The runner prints a summary and writes `browser-acceptance.json` and `browser-acceptance.png` (or a failure screenshot) under the timestamped report directory.

Exit codes: 0 = all executed checks passed; 1 = failure; 2 = blocked by environment readiness.
