# Host / SillyTavern lifecycle route audit — v1

**Target:** SillyTavern 1.19.0, pinned source commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`  
**Host implementation:** PR #874, branch `host/p0-lifecycle-authority-v1`  
**Status:** route inventory and fail-closed dispositions implemented; complete source attestation and live Windows acceptance remain open.

This report distinguishes three things that must not be conflated:

1. **Receipted mutation** — Host records PREPARED, verifies the persisted result against real files, then records COMMITTED/ABORTED.
2. **Explicitly blocked mutation** — the route refuses to proceed while an enrolled conversation exists, until a route-specific lineage/receipt implementation exists.
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
| `src/endpoints/chats.js` | `/rename`, `/delete`, `/export`, `/import`, `/group/import`, `/group/delete` | Bulk mutation guard; fail closed when an enrolled conversation exists |
| `src/endpoints/groups.js` | `/create`, `/edit`, `/delete` | Bulk mutation guard |
| `src/endpoints/characters.js` | `/rename`, `/delete`, `/import`, `/duplicate` | Bulk mutation guard |
| `src/endpoints/backups.js` | `/chat/delete` | Bulk mutation guard |
| `src/endpoints/data-maid.js` | `/delete` | Bulk mutation guard |
| `src/endpoints/settings.js` | `/restore-snapshot` | Bulk mutation guard |
| `src/endpoints/users-private.js` | `/reset-settings` | Bulk mutation guard |
| `src/endpoints/users-private.js` | `/reset-step2` (user-root reset) | Explicitly unsupported; fail closed |
| `src/endpoints/users-admin.js` | `/delete` (account/root deletion) | Explicitly unsupported; fail closed |
| Startup group metadata migration | Legacy group metadata rewrite | Skipped when inventory is non-ready or any enrolled conversation exists |
| Browser character/group import and group-bookmark copy | Import/copy/restore path | Client guard; server bulk guards remain authoritative |

**Consequences:** chat rename/move, import, export, backup restore, group deletion, and account/root reset are not enabled for enrolled data. They remain blocked rather than being represented as completed lifecycle operations. A future implementation must add a real-file lineage receipt for each operation before removing its guard.

Additional unreceipted account-root and installed-source mutation surfaces are now guarded by `createHostUnsupportedMutationGuard`. While Host authority is configured (or a Host-capability session is active), these routes return `503 NON_READY / HOST_MUTATION_ROUTE_UNSUPPORTED` before the SillyTavern handler runs:

- Content imports: `/api/content-manager/importURL`, `/importUUID`
- Image metadata writes/generation: `/api/image-metadata/folders/create`, `set-thumbnails`, `update`, `delete`, `assign`, `unassign`, root metadata write, `/all`, `/cleanup`
- Image/sprite/background/avatar/asset/file writes and deletes
- Moving-UI settings persistence
- Preset, Quick Reply, Secret, Theme, World Info and vector-store mutations
- Statistics recreation/update
- Extension install/update/switch/move/delete (source identity boundary)
- Account profile changes, password/name/avatar changes and account backup creation

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

## 5. Remaining P0 acceptance blockers

1. **Trusted source-completeness attestation producer:** production currently records baseline/observation, but does not yet create the signed deployment attestation required by Core. The deployment build claim is explicitly not runtime source attestation.
2. **Installed-source identity:** prove the actual installed patched SillyTavern source and Host handler identities at runtime; do not infer this from an environment variable or a local filesystem scan.
3. **Route-completeness proof:** prove every mutation route that can change the enrolled root is receipted or explicitly blocked in the installed source. The static pinned-source audit is a CI guard, not proof about an arbitrary running installation.
4. **Real Windows acceptance:** run VSS-backed create/edit/delete, restart, restore, import/export/move denial, logout, account switch, and session rotation against the exact pinned patched installation.
5. **Lifecycle extensions:** implement operation-specific receipts for rename/move, import, export, and backup restore before enabling those operations for enrolled conversations.

Until these gates are closed, Host reports review/non-ready state and Core must refuse Memory disclosure. This is intentional fail-closed behavior, not a successful production acceptance.

## 6. Source evidence and limits

The repository CI pins SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, applies the reviewed Host patches, syntax-checks patched files, runs the source audit, and exercises the real-file harness on Windows. The separately supplied Sillytavern release archive identifies itself as version 1.19.0 but does not include Git metadata; that archive alone cannot prove the pinned commit or that the Host patches are installed. Live deployment acceptance therefore remains separate from the pinned CI result.
