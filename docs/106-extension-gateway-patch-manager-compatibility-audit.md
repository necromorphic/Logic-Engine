# Extension Gateway + Patch Manager — implementation compatibility audit

**Status:** Patch Manager native-source allowlist and transaction tests implemented; Extension Gateway core/client transport implemented; ST route mount and Authenticated Host Adapter wiring pending. Protected generation remains FAIL-CLOSED.
**Target:** Official SillyTavern 1.19.0 tag, commit `7e8663cd9c184a550b37238218bdd32c6efc68e9`.
**Decision:** Managed local source-level patching of the installed ST distribution is authorized through Logic-Engine Patch Manager. Official upstream remains read-only and unchanged.

## Approved architecture

`SillyTavern → untrusted Logic-Engine Client Extension → Extension Gateway → Authenticated Host Adapter → Core Security Gateway`

Client Extension is untrusted. Host Adapter authenticates the real ST session from server-owned state. Core Security Gateway is the sole authorization authority. No standalone Server Companion, extra API port, Provider URL substitution/relay, direct browser/ST → Core path, alternative connector, or vectorization change.

## Source identity and patch scope

The official 1.19.0 tag resolves to `7e8663cd9c184a550b37238218bdd32c6efc68e9`. The user-provided `SillyTavern-release.zip` is a different, one-commit-later checkout (`1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`); the uploaded archive's inspected files match that commit's Git blob hashes. Therefore the deployment Patch Manager target for this installation is the exact uploaded build `06bde...`, not the official tag commit `7e866...`. The two pins must remain separately labelled; never silently substitute one for the other.

Patch Manager permits package-owned files only under the integrated client extension and Gateway plugin directories, plus exact native source files from a fixed code allowlist. Every target must also be declared in the package manifest. Native candidate paths:

- `src/server-startup.js`
- `src/endpoints/backends/chat-completions.js`
- `src/endpoints/backends/text-completions.js`
- `src/endpoints/backends/kobold.js`
- `src/endpoints/horde.js`
- `src/endpoints/novelai.js`

This is not a broad `src/**` permission. Config, arbitrary routes, unrelated extensions, traversal, symlinks, unlisted paths and mismatched commits remain prohibited.

## Generation integration requirements

Chat Completions has 13 provider-specific early-return sender branches plus the generic path; specialized senders have independent transport sites. Other families are Text Completions, Kobold, Horde async submit/poll/cancel, and NovelAI. Exact sender-to-transport mapping, streaming, retries, cancellation and secondary calls must be inventoried. Global fetch monkey-patching is prohibited.

For protected generation:
1. Authenticate the actual ST session from server-owned state.
2. Resolve trusted installation/world/actor/purpose bindings; ignore caller authority fields.
3. Bind model, stream mode and exact serialized outbound body to the authorized request.
4. Enter Core Security Gateway/shared Coordinator dispatch-start.
5. Invoke the original provider transport under the dispatch-start lease, without relaying generation through Core.
6. Preserve revoke ordering and do not retry ambiguous transport starts.
7. Revalidate the final response before it is exposed to the conversation.
8. Fail closed for any uncovered route or sender.

## Patch Manager transaction requirements

Exact ST commit, clean-worktree preflight, manifest/hash validation, patch check, backups, durable journal, apply/verify, idempotency, recovery, uninstall and rollback remain mandatory. The journal records the exact authorized target paths. Rollback/recovery must not expand scope or overwrite user edits. Verify the actual ST process runtime; Logic-Engine requires Node >=22.13.0.

## Status

| Area | Status |
|---|---|
| Official ST source pin | VERIFIED |
| Local source-level patch authorization | GRANTED |
| Manager exact-path native allowlist | IMPLEMENTED; focused CI PASSING |
| Real ST session authentication | NOT WIRED; Host Adapter remains separate dependency |
| Single Extension Gateway ingress | CORE IMPLEMENTED; ST MOUNT PENDING |
| Core dispatch-start bound to senders | NOT WIRED |
| Complete sender/transport inventory CI | NOT IMPLEMENTED |
| Final-Send interception | NOT IMPLEMENTED |
| Pre-LLM deny / zero upstream calls | NOT PROVEN |
| Final-response revalidation | NOT IMPLEMENTED |
| Production protected sending | DENY / FAIL-CLOSED |

## Acceptance criteria

- Manager accepts only exact allowed and manifest-declared paths; rejects arbitrary paths, config, traversal and symlinks.
- Apply/rollback/recovery/idempotency/user-edit tests pass for package and native files.
- Every protected route, branch and transport is mapped; inventory CI rejects unclassified additions.
- Deny/stale/revoked/unknown/unavailable evidence causes zero provider calls.
- Allow path persists dispatch-start before exactly one original provider call under the shared Coordinator lease.
- Streaming, cancellation, errors, retries, crash/restart and ambiguous-start behavior pass.
- Revocation/change during generation is caught before final response delivery.
- Disposable ST 1.19.0 and installed-instance acceptance pass.
- Official upstream remains unchanged.

Until all acceptance evidence passes, protected Memory dispatch remains `DISABLED / FAIL-CLOSED`.
