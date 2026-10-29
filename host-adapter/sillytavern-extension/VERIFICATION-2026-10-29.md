# SillyTavern extension interface — verification 2026-10-29

Scope: the extension-interface stage only. Google/Gemini/OAuth/API-key and Google
egress checks were stopped before this work. No model routing, Ollama,
vectorization, SillyTavern memory, schemas, storage or Host/Provider lifecycle
were changed. Memory → NPC remains disabled.

## 1. State before the change

- Logic-Engine worktree `C:/LogicEngine/Logic-Engine` was on `main` at `de0d8d10`
  with pre-existing modified and untracked files from other work. Nothing was
  reset or removed.
- `main` has no SillyTavern extension directory. `host-adapter/` contained only
  `prototype/` (Host lifecycle/journal prototype and its tests).
- PR #501 (`feat/st-extension-ui-bridge-2026-10-27`, draft, open) already
  contains `host-adapter/sillytavern-extension/`: settings panel, `/health`
  client, manifest with `activate`/`disable` hooks, tests, and the exact-origin
  `ENGINE_HEALTH_ALLOWED_ORIGINS` CORS change for `GET /health`.
- PR #595 (`host/sillytavern-extension-gateway-prototype`) is a different,
  review-only generation interceptor prototype. It is not a settings/health UI
  and was not reused or modified.
- The engine-side CORS files also existed uncommitted in the `main` worktree;
  on this branch they are committed as part of PR #501.

Audit conclusion: the approved interface already existed on PR #501 and was not
merged or verified in a real browser. The missing work was therefore a small
delta, not a new architecture.

## 2. Files created or changed by this branch

Branch: `feat/st-extension-connection-states-2026-10-29`, based on PR #501 head
`72cd292c`.

- `host-adapter/sillytavern-extension/bridge-core.mjs`
  - typed `HealthCheckError` with `unavailable` / `error` kinds;
  - timeout, refused/offline, HTTP error, malformed JSON, foreign response and
    invalid URL are classified separately;
  - `describeHealthResult` / `describeHealthFailure` map results to the three
    required UI states.
- `host-adapter/sillytavern-extension/index.js`
  - correct SillyTavern import depth `../../../../script.js` (the old
    `../../../script.js` produced HTTP 404 and blocked activation in real ST);
  - appends the panel to `#extensions_settings2` with a fallback to
    `#extensions_settings`;
  - runs one read-only check on activation, then on every button click, so a
    reload and a post-recovery recheck both work;
  - fixes the init promise reset so activation errors are awaited and cleaned.
- `host-adapter/sillytavern-extension/settings.html`
  - makes the read-only nature of the automatic check explicit.
- `host-adapter/sillytavern-extension/style.css`
  - distinct colours for `connected`, `unavailable`, `error`.
- `host-adapter/sillytavern-extension/tests/extension.test.mjs`
  - 9 tests: URL validation, request shape, protocol envelope, HTTP/foreign
    response = error, offline/timeout = unavailable, malformed JSON = error,
    cancellation, exact status mapping, manifest/UI contract, pinned patch.
- `host-adapter/sillytavern-extension/README.md`
  - documents the three states and the activation check.

No engine, schema, storage, API or Host/Provider file was changed by this
branch delta.

## 3. Automated test results

Run from `C:/LogicEngine/Logic-Engine-st-states`:

| Command | Result |
| --- | --- |
| `node --test host-adapter/sillytavern-extension/tests/*.test.mjs` | 9/9 pass |
| `node --import ./tests/configure-test-env.js --test tests/api.test.js` | 38/38 pass (includes 2 health-CORS tests) |
| `npm test` | 811/811 pass, 0 fail |
| `node --test host-adapter/prototype/tests/*.test.mjs` | 71/71 pass |

The first extension run on the untouched PR head was 7/7; the new run is 9/9.

## 4. Real SillyTavern verification

Target: pinned SillyTavern 1.19.0 disposable checkout
`C:/Users/rt/AppData/Local/Temp/opencode/st-tz1` (commit `06bde93`), served on
`http://127.0.0.1:8001` because port 8000 is occupied by an unrelated Docker
process. `C:/AI/SillyTavern` was not modified. No SillyTavern core file was
edited; the extension was only copied into
`public/scripts/extensions/third-party/logic-engine/`.

Engine: this branch started with
`ENGINE_HEALTH_ALLOWED_ORIGINS=http://127.0.0.1:8001`, a temporary SQLite DB and
`ENGINE_PORT=8787`.

Observed in the real browser:

| Check | Evidence |
| --- | --- |
| Extension loads without errors | panel present, browser console error list empty after reload |
| Panel visible and accepts an address | panel `777x409` px, input and buttons visible; invalid value rejected as an error |
| Working engine = connected | `Подключено: logic-engine, протокол v1.`, green, `data-state="connected"` |
| Stopped engine = unavailable, no hang | `Недоступно: движок недоступен: соединение не установлено.`, orange, button disabled during check then enabled, page `complete` |
| Recovery after engine restart | after restarting the engine, click returns `connected` |
| Error state is distinct | engine base set to the ST server: `Ошибка: движок ответил HTTP 404.`; invalid text: `Ошибка: некорректный адрес движка.` |
| Address persists | `data/default-user/settings.json` contains `logicEngine.engineUrl = http://127.0.0.1:8787` |
| SillyTavern restart | after stopping/starting ST and reloading, panel reappears, saved URL restored, automatic check reports `connected`, no console errors |
| No RP content access/transmission | static scan found no `getContext`, chat, message, prompt, character or generation-interceptor calls; the only engine traffic observed was `GET http://127.0.0.1:8787/health` |

Screenshots could not be captured because the in-app browser reported no visible
desktop window; the evidence above is DOM/computed-style and console/network
data from the same live tab.

## 5. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Loads in SillyTavern without errors | PASS |
| Address UI shown, accepts Logic-Engine address | PASS |
| Working engine shows success | PASS |
| Stopped engine shows unavailable without hanging | PASS |
| Connection recoverable after engine restart | PASS |
| SillyTavern restart does not break the extension | PASS |
| Does not read or transmit RP chat content | PASS (static + network evidence) |
| Existing project tests not broken | PASS (811/811) |
| New tests and results listed | PASS (section 3) |

## 6. Remaining blockers and limits

- The branch is not merged. PR #501 is still an open draft; this delta is a
  separate local branch so no other work was overwritten.
- `/health` CORS requires the exact SillyTavern origin in
  `ENGINE_HEALTH_ALLOWED_ORIGINS`; wildcard is forbidden by design.
- The optional Host lifecycle bridge / enrollment controls remain disabled and
  unverified. The generated Host patch is review-only and was not applied.
- Memory → NPC, production disclosure and model routing remain out of scope and
  disabled.
- Verification used the pinned 1.19.0 checkout, not `C:/AI/SillyTavern`; the
  exact same files are what a user would copy into any 1.19.0 installation.
