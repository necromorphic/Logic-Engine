# Local Host patch audit — 2026-10-29

**Scope:** Logic-Engine Issue #519. Tests were run in a disposable Linux scratch copy of the supplied Logic-Engine and SillyTavern ZIP archives. No installed `C:\\AI\\SillyTavern` files or ACLs were changed. No runtime code was changed.

## Results

| Check | Result | Evidence / limit |
|---|---|---|
| Pinned-source comparison | **PASS for existing patch targets** | Seven existing files touched by the patch had the same Git blob SHA as SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. |
| Full exact Git checkout | **BLOCKED** | The supplied ZIP has no Git metadata and the scratch environment could not resolve `github.com`. This is not described as a full checkout. |
| Patch apply | **PASS** | `git apply --check` and `git apply` passed in a disposable copy of the supplied SillyTavern 1.19.0 archive. |
| Syntax | **PASS, 12/12** | Eight patched ST JavaScript files plus four separately copied modules passed `node --check`. |
| Host prototype suite | **PASS, 3/3 runs** | `node --test host-adapter/prototype/tests/*.test.mjs`: 71/71 each run. |
| Focused SQLite/coordinator suite | **PASS, 3/3 runs** | Four file-backed/coordinator test files: 16/16 each run. |
| Full repository suite | **PASS, 800/800** | `npm test -- --test-concurrency=4`; exit 0; 26.2 s. This is the supplied archive, not current-main CI. |
| Windows `EBUSY` root cause | **OPEN / NOT TESTED** | Linux runs cannot prove Windows handle lifetime. Prior issue notes say later retries did not reproduce it; cause remains unproven. No retry-based deletion workaround was added. |
| Real browser/Android persistence | **NOT TESTED** | Prototype tests use a test double; no live installed-browser or Android/Termux test was run. |
| Target-PC ACL / restore resistance | **NOT TESTED** | Only requirements are documented. No live ACL changes were made. |
| Production Memory→NPC | **DISABLED / FAIL-CLOSED** | No production wiring or enablement. |

## Exact target-file hashes

Target SillyTavern commit: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

| File | Git blob SHA |
|---|---|
| `public/script.js` | `777a2d5983a6283ef9b26726e75192da1e3f3cea` |
| `public/scripts/bookmarks.js` | `713b106de27018c999422578d192c3fcc9e9ff91` |
| `public/scripts/group-chats.js` | `7b82ca84132f2e04ab41ee8ee26a1bf7c1796a1f` |
| `public/scripts/chat-backups.js` | `966bd78fe0ccbe3b64be3743074744e49b7779bd` |
| `public/scripts/slash-commands.js` | `78018cc5fc76158202d4eadc87068afd3fae38c6` |
| `src/server-startup.js` | `4bfc843b86ef76102889a4d931204f8ed04e3b61` |
| `src/endpoints/backends/chat-completions.js` | `0d98c77f7b64502c5b0f504eaa1f67df0f26041e` |

The new `src/endpoints/logic-engine-lifecycle.js` file is added by the patch and therefore has no upstream blob SHA.

## Reproducible commands

```sh
node --test host-adapter/prototype/tests/*.test.mjs
# Three runs: 71 passed, 0 failed each

node --import ./tests/configure-test-env.js --test --test-concurrency=4 \
  tests/memory-provider-file-backed-reconciliation.test.js \
  tests/memory-provider-coordinator-lock.test.js \
  tests/host-conversation-world-bindings.test.js \
  tests/coordinator-lock-participation.test.js
# Three runs: 16 passed, 0 failed each

npm test -- --test-concurrency=4
# 800 passed, 0 failed; exit 0
```

## Remaining blockers

The original Windows `EBUSY` was not reproduced in this environment. The suggested `rmSync(..., maxRetries, retryDelay)` workaround was not added because it can mask a still-open handle and is not root-cause evidence.

Host capture remains review-only and enrollment-forward-only. Import/export, copy/branch, restore, external edits, whole-chat file deletion, complete historical/deleted inventory, independent anti-rollback authority, real browser/Android persistence, target-PC ACLs, and the pinned final-send gateway remain unresolved. No production API/schema or raw-text retention was added; Ollama/vectorization was not changed.

This document is evidence for review, not a production-readiness declaration and not a closure of Issue #519.
