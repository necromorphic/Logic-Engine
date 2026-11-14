# Gateway / Final-Send live acceptance checklist

**Target:** SillyTavern 1.19.0, pinned commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
**Status:** Manual Windows acceptance required. This checklist does not authorize production Memory → NPC activation.

## Before testing

1. Use a disposable SillyTavern profile and isolated Logic-Engine Core/Provider/Coordinator/dispatch/Host-ledger paths. Do not use the production profile or databases.
2. Confirm the installed ST source matches the pinned revision. Keep a backup of the disposable profile.
3. From the Logic-Engine checkout, run:
   ```powershell
   npm ci
   npm test
   $env:LOGIC_ENGINE_SILLYTAVERN_ROOT = "C:\path\to\SillyTavern"
   npm run host:patch:preflight
   npm run host:patch:install
   npm run host:patch:verify
   ```
4. Record the Logic-Engine commit, ST commit, Windows version, Node version, test totals and patch verification output.
5. Do not enable Memory → NPC unless the deployment reports READY for Core, Provider, Host root inventory, accepted-head authority and shared Coordinator. If any gate is NON_READY, stop and preserve fail-closed behavior.

## Acceptance matrix

| Scenario | Procedure | Required result |
|---|---|---|
| Native route coverage | Exercise the five pinned text-generation handlers: Chat Completions, Text Completions, Kobold, NovelAI text and Horde text | Protected dispatch is routed only through the registered Gateway path |
| Sender registry | Run the fixture matrix for all 30 registered identities; include an unknown sender | Registered identities map deterministically; unknown sender is denied before upstream transport |
| Non-streaming | Send a protected request through a test provider | Exactly one upstream call; response released only after evidence revalidation |
| Streaming | Send a protected streaming request and capture multiple chunks | Every protected write is revalidated; no unguarded fallback write/end |
| Cancellation/disconnect | Cancel before dispatch and disconnect during streaming | No dispatch before start; after start, outcome is terminal/UNKNOWN as applicable and no unauthorized response release occurs |
| Revocation before start | Revoke the Host session before generation | Zero upstream calls |
| Revocation during inference | Revoke while the provider is pending, then allow it to return | Response release is denied |
| Revocation between chunks | Revoke after one chunk, before the next | No later protected chunk is written |
| Retry/duplicate | Retry the same Host response/request after dispatch begins or completes | No second upstream call; duplicate/replay is denied |
| UNKNOWN outcome | Simulate transport ambiguity, then retry | UNKNOWN is not automatically replayed |
| Crash/restart | Stop the disposable process after durable dispatch-start, restart, retry with a new request ID | Prior dispatch is not replayed; new request cannot bypass the durable ledger |
| Outbound body | Inspect a redacted provider request fixture | Host correlation/session/inventory metadata is absent; only intended projected context is present |
| Empty context | Use a complete, revalidated empty Lane A + Lane B result | Native fallback is allowed only for that complete-empty case |
| Incomplete evidence | Remove/stale one evidence reader or accepted head | Terminal NON_READY; no native fallback and no upstream call |

## Evidence to retain

- Exact commit hashes and command output.
- PASS/FAIL per scenario, upstream-call count, dispatch state, and whether any response bytes were written.
- Redacted logs for dispatch-start, evidence revalidation, revoke, UNKNOWN and restart.
- Do not include API keys, cookies, session tokens, raw protected Memory text or private conversation content.

## Stop conditions

Stop immediately on any unexpected native fallback, second upstream call, protected response write after revocation, Host metadata in provider JSON, stale evidence accepted as READY, or automatic replay after UNKNOWN/crash. Keep Memory → NPC disabled and report the scenario plus redacted logs.
