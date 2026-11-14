# SillyTavern Extension Manager installation

## Scope

The repository root is the installable SillyTavern browser extension package. Its root `manifest.json` declares the browser entrypoint at `host-adapter/extension-gateway/index.js`. The entrypoint and its local ES modules are loaded from the cloned repository.

The browser entrypoint resolves SillyTavern's public context module through `/scripts/st-context.js`. This URL is independent of whether the repository is cloned as a nested Git repository or copied by the managed Host bundle installer into its dedicated extension directory.

## Installation boundary

Installing this repository through Extension Manager installs only the browser-side extension files. It does **not** install or configure:

- the Logic Engine Core runtime;
- the server-side SillyTavern Gateway plugin under `plugins/logic-engine-extension-gateway`;
- the separately managed SillyTavern Final-Send patch;
- Host lifecycle/root inventory patches or their authority dependencies.

Those components retain their existing dedicated installation and verification flows. A successful Extension Manager clone is not evidence that the full Host/Core/Final-Send integration is installed or ready.

## Safety constraints

- The extension only attaches Host conversation/request correlation metadata to SillyTavern generation events.
- Registration is guarded by a shared global symbol, so the Extension Manager copy and the separately installed Gateway browser copy cannot register duplicate listeners in the same page.
- It does not enable Memory → NPC.
- It does not add a browser-facing Memory dispatch route.
- Server-side Host authentication, identity, inventory and Core authorization remain authoritative.
- If the server Gateway is absent or unavailable, the browser extension does not create a fallback identity or dispatch path.

## Verification

Run:

```powershell
node --test .\tests\sillytavern-extension-manager.test.mjs
```

This verifies the root manifest, entrypoint path, context module resolution contract, and listener cleanup. It is a repository-level contract test; it does not replace installing through the real SillyTavern Extension Manager and observing browser loading.

## Manual acceptance still required

Install from the exact branch containing this change; the repository default branch may not contain it yet:

1. Open SillyTavern → Extensions → Install extension.
2. Repository URL: `https://github.com/necromorphic/Logic-Engine`.
3. Select branch: `integration/host-core-v1`.
4. Choose the current-user installation scope for the first acceptance run.
5. Install the extension.
3. Confirm the extension appears in the installed extension list and loads without a browser-console module/import error.
4. Restart SillyTavern and confirm the extension loads again without duplicate listeners.
5. Confirm the server Gateway and Final-Send installation states independently. Do not enable Memory → NPC.

Do not use a normal generation as proof of Memory → NPC readiness. That production path remains disabled/fail-closed.
