# Host / SillyTavern lifecycle route audit — v1

**Target:** SillyTavern 1.19.0, pinned source commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`  
**Host implementation:** PR #874, branch `host/p0-lifecycle-authority-v1`  
**Status:** route inventory and fail-closed dispositions implemented; complete source attestation and live Windows acceptance remain open.

This report distinguishes three things that must not be conflated:

1. **Receipted mutation** — Host records PREPARED, verifies the persisted result against real files, then records COMMITTED/ABORTED.
2. **Explicitly blocked mutation** — the route refuses to proceed whenever Host authority is configured or a Host-capability session is active, until an operation-specific persisted receipt exists.
3. **Root-manifest observation** — a full account-root snapshot detects file drift, but does not by itself authorize a mutation or prove route coverage.

## 1. Supported chat lifecycle — receipted

| SillyTavern surface | Operation | Host disposition |
|---|---|---|
| `POST /api/chats/save` | Save character/root chat | PREPARED → persisted-file verification → COMMITTED receipt |
| `POST /api/chats/group/save` | Save group chat | PREPARED → persisted-file verification → COMMITTED receipt |
| Browser message send/receive hooks | Create user/assistant message | Stable message/version identity and persisted-file receipt |
| Browser message edit/update hooks | Edit current message version | Version lineage + persisted-file receipt |
| Browser swipe hooks | Create/select/delete swipe | Version chain and active-version verification |
| Browser message-delete hook | Delete message | Stable identity transition and persisted-file receipt |

The server receipt store verifies the actual post-mutation chat file. A browser event alone is not accepted as proof. Core receives only bounded digest metadata and a signed receipt; raw chat text is not sent to the lifecycle journal.

Supported receipt operations are: `create-message`, `message-send`, `message-receive`, `create-swipe`, `select-swipe`, `delete-swipe`, `delete-message`, and `edit-message`.

## 2. Chat, group, character, and account mutations — explicitly blocked

These operations do not yet have operation-specific persisted lineage receipts. They are guarded or explicitly unsupported; they must not be treated as successful lifecycle support.

| SillyTavern surface | Operation(s) | Disposition |
|---|---|---|
| `src/endpoints/chats.js` | `/rename`, `/delete`, `/export`, `/import`, `/group/import`, `/group/delete` | Bulk mutation guard; fail closed whenever Host authority is active |
| `src/endpoints/groups.js` | `/create`, `/edit`, `/delete` | Bulk mutation guard; fail closed whenever Host authority is active |
| `src/endpoints/characters.js` | `/create`, `/rename`, `/edit`, `/edit-avatar`, `/edit-attribute`, `/merge-attributes`, `/delete`, `/import`, `/duplicate` | Bulk mutation guard; fail closed whenever Host authority is active |
| `src/endpoints/backups.js` | `/chat/delete` | Bulk mutation guard; fail closed whenever Host authority is active |
| `src/endpoints/data-maid.js` | `/delete` | Bulk mutation guard; fail closed whenever Host authority is active |
| `src/endpoints/settings.js` | `/save`, `/make-snapshot`, `/restore-snapshot` | Unsupported/bulk mutation guards; account settings and snapshot files cannot change without receipts |
| `src/endpoints/users-private.js` | `/change-avatar`, `/change-password`, `/backup`, `/change-name`, `/reset-settings` | Unsupported/bulk mutation guard; fail closed while Host authority is active |
| `src/endpoints/users-private.js` | `/reset-step2` (user-root reset) | Explicitly unsupported; fail closed |
| `src/endpoints/users-public.js` | `/recover-step2` (password recovery) | Unsupported mutation guard; credential changes are blocked while Host authority is active |
| `src/endpoints/stable-diffusion.js` | ComfyUI `/save-workflow`, `/delete-workflow`, `/rename-workflow` | Unsupported mutation guard; per-account workflow files cannot change while Host authority is active |
| `src/endpoints/thumbnails.js` | `GET /` thumbnail generation side effect | When Host authority is active, serve the original image instead of writing an unreceipted account thumbnail cache file |
| `src/endpoints/users-admin.js` | `/create`, `/disable`, `/enable`, `/promote`, `/demote`, `/delete` | Unsupported mutation guard; fail closed while Host authority is active |
| Startup group metadata migration | Legacy group metadata rewrite | Blocked whenever Host authority is configured; pre-migration scans cannot authorize writes |
| Server startup account-root migrations | Content seeding, disk-cache verification, flat-secret migration, settings backup initialization, stats initialization, system-prompt migration | Skipped whenever Host authority is configured |
| Legacy public-to-user data migration | `migrateUserData()` copies and deletes legacy public data | Startup fails with `HOST_LIFECYCLE_LEGACY_USER_DATA_MIGRATION_BLOCKED` if legacy public data still exists; migrate with Host disabled before enabling authority |
| Account-directory initialization | `ensurePublicDirectoriesExist()` creates missing per-user folders | Startup fails with `HOST_LIFECYCLE_USER_DIRECTORY_MISSING` instead of changing the account root while Host authority is configured |
| Browser character/group import and group-bookmark copy | Import/copy/restore path | Client guard; server bulk guards remain authoritative |

**Consequences:** chat rename/move, import, export, backup restore, group deletion, character/group CRUD, account profile changes, and account/root reset are not enabled while Host authority is active. They remain blocked rather than being represented as completed lifecycle operations. A future implementation must add an operation-specific persisted lifecycle receipt for each operation before removing its guard.

Additional unreceipted account-root and installed-source mutation surfaces are now guarded by `createHostUnsupportedMutationGuard`. While Host authority is configured (or a Host-capability session is active), these routes return `503 NON_READY / HOST_MUTATION_ROUTE_UNSUPPORTED` before the SillyTavern handler runs:

- Content imports: `/api/content-manager/importURL`, `/importUUID`
- Image metadata writes/generation: `/api/image-metadata/folders/create`, `set-thumbnails`, `update`, `delete`, `assign`, `unassign`, root metadata write, `/all`, `/cleanup`
- Image/sprite/background/avatar/asset/file writes and deletes
- Moving-UI settings persistence
- Preset, Quick Reply, Secret, Theme, World Info and vector-store mutations
- Statistics recreation/update
- Extension install/update/switch/move/delete (source identity boundary)
- Account profile changes, password/name/avatar changes and account backup creation
- Administrative account create/disable/enable/promote/demote/delete operations

The guard intentionally does not claim these operations are receipted. It disables them until operation-specific persisted receipts or a separately verified inventory reconciliation contract exists. Read-only routes are not guarded solely because they use POST.

### Additional filesystem primitives outside the authenticated account root

The recursive pinned-source audit also found filesystem primitives in four endpoint modules. These are now included in the source manifest and explicit route inventory; they are not silently omitted from the source audit.

| Module / route | Filesystem effect | Root-inventory disposition |
|---|---|---|
| `src/endpoints/backends/kobold.js` — `POST /transcribe-audio` | Removes the server-created temporary upload after reading it | Transient upload cleanup; not a persisted chat/account-root mutation |
| `src/endpoints/openai.js` — provider `POST */transcribe-audio` routes | Removes the server-created temporary upload after successful transcription | Transient upload cleanup; not a persisted chat/account-root mutation |
| `src/endpoints/speech.js` — `POST /recognize` | Removes the server-created temporary upload after speech recognition | Transient upload cleanup; not a persisted chat/account-root mutation |
| `src/endpoints/tokenizers.js` — tokenizer encode routes | Downloads/decompresses tokenizer models in `DATA_ROOT/_cache` | Shared server cache outside the authenticated per-user root; source-attested separately, not represented as per-user inventory data |

These operations are not used to establish conversation identity, do not write chat histories, and do not mutate the authenticated account root. The source manifest pins their exact implementations so a later change to their path behavior cannot silently enter an authoritative Host deployment. The shared tokenizer cache is explicitly outside the per-user inventory boundary; no claim is made that the per-user root manifest covers it.

## 2A. Machine-checked mutation-route guard matrix

The pinned route verifier now checks **92 distinct POST route declarations** and **92 required middleware assertions** across the primary lifecycle routes and the additional fail-closed mutation patch. Where patch layers touch the same route, the contract records the exact guard present after the ordered patch composition; it does not assume two guards are installed.

The additional guard matrix covers content imports, image metadata and image upload/delete, moving-UI settings, preset save/delete/restore, Quick Reply save/delete, secret write/delete/rotate/rename, sprite upload/delete, stats writes, theme writes, World Info import/edit/delete, vector insert/delete/purge, extension install/update/switch/move/delete, background and avatar mutations, asset/file mutations, account recovery/profile changes, administrative account lifecycle, and ComfyUI workflow save/delete/rename.

The verifier reads the actual patched endpoint source files and requires each declared route line to contain every expected guard. The resulting route count and guard-assertion count are checked independently. The matrix digest is bound to the pinned SillyTavern commit and is included in the Host inventory candidate metadata; the deployed source manifest separately hashes the exact installed endpoint bytes.

This is still a fail-closed disposition, not support for those operations: until operation-specific receipts exist, the route must reject before its original handler executes.

## 3. Authentication and session lifecycle

| SillyTavern path | Required ordering | Disposition |
|---|---|---|
| Native `POST /logout` | Signed Core revocation → clear ST session | Implemented; fail closed and preserve old session if Core revocation fails |
| `POST /login` account switch | Revoke old tuple → clear old Host session ID → set new account | Implemented; fail closed on revocation failure |
| Single-user auto-login | Revoke old tuple before assigning account | Implemented |
| Trusted-header SSO | Revoke old tuple before assigning account | Implemented |
| Basic Auth account switch | Revoke old tuple before assigning account | Implemented |
| Account-version invalidation in `setUserDataMiddleware` | Revoke old tuple before clearing/rotating session | Implemented |
| Host session creation/rotation | Server-generated ID in signed ST session; revoke old ID before replacement | Implemented |

Revocation is server-to-server and scoped to the exact adapter + installation + account + session tuple. The Core nonce/revocation store is durable. Browser logout signals are not authority.

## 4. Root inventory coverage

The Host filesystem inventory covers the complete configured authenticated account data root, not just chat directories. On Windows, enumeration is performed from one shared VSS point-in-time snapshot; reparse points and unsafe entries are rejected. The manifest records normalized relative path, file identity, size/metadata, and SHA-256 content digest.

Core's append-only Root Inventory journal verifies monotonic sequence, previous hash, event hash, manifest digest, and replay/conflict behavior. Deltas distinguish added, removed, modified, metadata-changed, replaced, and moved files. An unresolved or oversized delta remains non-ready.
A fresh account may have no lifecycle events yet. The first signed root attestation therefore binds lifecycle sequence `0` only to the all-zero genesis head; Core rejects any nonzero head at sequence zero. This permits the initial inventory authority to be established without fabricating a lifecycle event, after which the first real lifecycle event advances the sequence to `1`.

A filesystem scan is evidence for the current file set only. It is not, by itself, source-route completeness proof or Core authorization.

The Host now verifies the pinned-source manifest against the installed ST route files, browser lifecycle files, Gateway server files, and handler blob. The verifier also requires the authenticated account's local extension directory to be empty, and requires the server plugin root and global third-party browser-extension root to contain exactly the attested Logic Engine Gateway; any additional plugin or third-party extension makes source identity NON_READY. In addition, the pinned `src/plugin-loader.js` patch enforces the server-plugin allowlist before importing any plugin and disables automatic plugin updates while Host authority is configured, so unknown server code is rejected before execution rather than only at the later inventory check. The source manifest also pins `public/scripts/extensions.js`, the browser extension discovery/activation loader, together with the guarded `src/endpoints/extensions.js` route. This deliberately blocks executable extension code that could add unreviewed routes or mutate account data outside the built-in route patch set. Adding an extension requires extending the source-coverage contract and generating a new pinned manifest. Only a verified source manifest plus a shared VSS snapshot allows the server to create an HMAC-signed root attestation using the adapter credential. Core independently validates the signature, exact root journal head, inventory sequence/digest, lifecycle head, nonce, expiry, and registered installation/account/root binding. An unchanged already-attested manifest is reused without creating a conflicting duplicate attestation. If the source-manifest digest changes while the account-root manifest is unchanged, Core appends a no-op reconciliation event to advance the inventory sequence, allowing a fresh signed attestation without replacing the immutable prior proof.

## 5. Remaining P0 acceptance blockers

1. **Windows pinned-source acceptance:** the source-manifest generator now verifies the exact pinned checkout, patched route files, browser lifecycle files, Gateway files, and installed Host handler. CI generates the manifest only after its Windows acceptance suite succeeds and uploads it as `host-pinned-source-manifest`. That CI result and artifact have not yet been accepted for deployment.
2. **Real deployment manifest installation:** the generated `pinned-source-manifest.json` must be installed beside the Gateway server plugin. Runtime source identity is fail-closed if the manifest is missing, malformed, any pinned file digest differs, or an unreviewed server plugin / third-party browser extension is present.
3. **Live Windows acceptance:** run the exact patched installation through VSS-backed create/edit/delete/clear-chat, restart, restore/import/export/move denial, logout, account switch, session rotation, and recovery scenarios. This is separate from the repository CI harness.
4. **Unresolved lifecycle coverage:** source status remains non-authoritative while any required coverage path or source blocker remains. Branch creation/copy is blocked for enrolled conversations; clear-chat is implemented as sequential delete-message receipts. Import/export/restore/move and account-root mutation routes remain blocked until operation-specific receipts are implemented.
5. **Deployment boundary:** the source manifest is generated from the pinned checkout and its exact patched files. Do not generate it from an arbitrary release ZIP or treat `LOGIC_ENGINE_HOST_BUILD_SHA` as source proof.

The signed root-inventory attestation producer is wired for shared Windows VSS snapshots and a verified pinned-source manifest. Core additionally requires `source_manifest_sha256` in each deployment-owned `ENGINE_HOST_ROOT_IDENTITIES` record and compares the submitted digest to that exact registry pin both when accepting an attestation and when re-reading stored authority. A self-consistent replacement manifest cannot refresh authority without an explicit Core deployment-registry update. The manifest generator now prints the exact digest to copy into `ENGINE_HOST_ROOT_IDENTITIES[].source_manifest_sha256`; update that registry value during a reviewed deployment. Core still refuses authority on invalid deltas, pending mutations, source mismatch, missing manifest, or unresolved blockers. No production acceptance is claimed yet.

## 6. Source evidence and limits

The repository CI pins SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, applies the reviewed Host patches, syntax-checks patched files, runs the source audit, and exercises the real-file harness on Windows. The separately supplied Sillytavern release archive identifies itself as version 1.19.0 but does not include Git metadata; that archive alone cannot prove the pinned commit or that the Host patches are installed. Live deployment acceptance therefore remains separate from the pinned CI result.

## 7. Exact mutation-route authority gate — 3 November 2026

The runtime Host inventory handler now executes the pinned mutation-route verifier against the installed SillyTavern source tree. It does not trust a route-coverage object produced by the filesystem enumerator. The verifier checks the 92 distinct POST route declarations and their 92 route-specific middleware assertions, plus the pinned account, logout, migration, extension-loader and group-startup guards.

Before calling Core to persist a root baseline, Host requires both:
- a current installed-source identity with a valid manifest digest; and
- mutation coverage with the exact `PINNED_ST_MUTATION_COVERAGE_SHA256` and exact `PINNED_ST_MUTATION_ROUTE_COUNT` for the pinned Host commit.

A merely well-formed digest, a nonzero but incomplete route count, or a verifier exception leaves the inventory diagnostic-only and adds `UNVERIFIED_MUTATION_ROUTE_COVERAGE`; it cannot create a Core baseline. Negative tests cover forged coverage digests and incorrect route counts. The deployed Gateway handler blob and the route-contract module are both included in the pinned source manifest.

The route assertions were aligned with the actual patched SillyTavern 1.19.0 source: account-admin mutations use route-scoped guards; user-data migration blocks legacy writes and skips system-prompt migration under Host authority; group metadata migration skips writes when the startup migration gate refuses authority. The tests do not require a global `router.use()` where the implementation intentionally guards individual POST routes.

This strengthens source/route attestation only. It does not make import, export, restore, move, branch-copy, account-root reset, or other explicitly unsupported operations receipted. Those routes remain fail-closed. Exact-head CI for the current integration head and live Windows VSS/deployment acceptance are still required; no production completion is claimed.
