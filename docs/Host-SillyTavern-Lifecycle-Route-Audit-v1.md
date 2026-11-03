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

A filesystem scan is evidence for the current file set only. It is not, by itself, source-route completeness proof or Core authorization.

The Host now verifies the pinned-source manifest against the installed ST route files, browser lifecycle files, Gateway server files, and handler blob. Only a verified source manifest plus a shared VSS snapshot allows the server to create an HMAC-signed root attestation using the adapter credential. Core independently validates the signature, exact root journal head, inventory sequence/digest, lifecycle head, nonce, expiry, and registered installation/account/root binding. An unchanged already-attested manifest is reused without creating a conflicting duplicate attestation. If the source-manifest digest changes while the account-root manifest is unchanged, Core appends a no-op reconciliation event to advance the inventory sequence, allowing a fresh signed attestation without replacing the immutable prior proof.

## 5. Remaining P0 acceptance blockers

1. **Windows pinned-source acceptance:** the source-manifest generator now verifies the exact pinned checkout, patched route files, browser lifecycle files, Gateway files, and installed Host handler. CI generates the manifest only after its Windows acceptance suite succeeds and uploads it as `host-pinned-source-manifest`. That CI result and artifact have not yet been accepted for deployment.
2. **Real deployment manifest installation:** the generated `pinned-source-manifest.json` must be installed beside the Gateway server plugin. Runtime source identity is fail-closed if the manifest is missing, malformed, or any pinned file digest differs.
3. **Live Windows acceptance:** run the exact patched installation through VSS-backed create/edit/delete/clear-chat, restart, restore/import/export/move denial, logout, account switch, session rotation, and recovery scenarios. This is separate from the repository CI harness.
4. **Unresolved lifecycle coverage:** source status remains non-authoritative while any required coverage path or source blocker remains. Branch creation/copy is blocked for enrolled conversations; clear-chat is implemented as sequential delete-message receipts. Import/export/restore/move and account-root mutation routes remain blocked until operation-specific receipts are implemented.
5. **Deployment boundary:** the source manifest is generated from the pinned checkout and its exact patched files. Do not generate it from an arbitrary release ZIP or treat `LOGIC_ENGINE_HOST_BUILD_SHA` as source proof.

The signed root-inventory attestation producer is now wired: it submits an HMAC-signed proof only for a shared Windows VSS snapshot and a verified pinned-source manifest. Core still refuses authority on any invalid delta, pending mutation, source mismatch, missing manifest, or unresolved blocker. No production acceptance is claimed yet.

## 6. Source evidence and limits

The repository CI pins SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, applies the reviewed Host patches, syntax-checks patched files, runs the source audit, and exercises the real-file harness on Windows. The separately supplied Sillytavern release archive identifies itself as version 1.19.0 but does not include Git metadata; that archive alone cannot prove the pinned commit or that the Host patches are installed. Live deployment acceptance therefore remains separate from the pinned CI result.
