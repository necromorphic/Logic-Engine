# SillyTavern Logic-Engine Diagnostic Extension (review-only)

Target: SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

This isolated UI extension checks whether the configured Logic-Engine health endpoint can be reached. It does not read chat content, Memory, NPC state, provider settings, or any model API. It does not send an API token from the browser.

## Important boundaries

- The UI calls only the same-origin SillyTavern endpoint `GET /api/extensions/logic-engine-diagnostics/status`.
- A small server-side patch proxies a fixed `GET /health` request to the root configured by `LOGIC_ENGINE_CORE_URL`.
- The health probe sends no Bearer token, adapter token, message content, world ID, or caller-supplied URL.
- `adapter_authorized` is explicitly reported as `not_checked`; a successful health probe is not an adapter-authentication test.
- `protected_memory_route` is reported as `not_exposed`. The extension neither reads nor dispatches Memory and cannot enable Memory→NPC.
- This is a review-only prototype. It is not installed into a live SillyTavern instance and is not a production integration.

## Install on a disposable pinned checkout

1. Check out SillyTavern at the exact target SHA above.
2. Copy `diagnostic-health-proxy.mjs` from this directory's parent prototype directory to `SillyTavern/src/endpoints/logic-engine-diagnostic-health.mjs`.
3. Apply `patches/sillytavern-1.19.0-diagnostic-status.patch` from the Logic-Engine repository root.
4. Set `LOGIC_ENGINE_CORE_URL` in the **SillyTavern server process** environment to the Logic-Engine root URL, for example `http://127.0.0.1:8787`. Do not set any engine token for this diagnostic feature.
5. Copy this `diagnostic-extension` directory to `SillyTavern/data/<user-handle>/extensions/logic-engine-diagnostic`.
6. Restart SillyTavern and enable the extension in the extension settings. The panel appears under Extensions settings. Press **Проверить подключение** to run the health check.

If the server patch is absent, the panel reports that the diagnostic route is not installed. If the target is unconfigured or unavailable, the panel reports that state and does not retry automatically.

## Automated checks

The Logic-Engine test suite covers target validation, no-credential requests, minimal response fields, invalid upstream responses, and fail-closed transport errors. The pinned-source patch workflow verifies that the patch applies to the exact SillyTavern SHA and syntax-checks the patched files. These checks do not replace a real browser/device smoke test.
