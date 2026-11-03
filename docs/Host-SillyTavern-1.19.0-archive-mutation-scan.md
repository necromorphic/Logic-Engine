# SillyTavern 1.19.0 archive mutation-surface scan

**Input:** user-supplied `SillyTavern-release.zip`  
**Package version:** `1.19.0`  
**Git identity:** unavailable; the archive contains no `.git` metadata.  
**Purpose:** identify additional filesystem-mutating modules that must be reconciled with the pinned Host source audit.

This is a static candidate scan, not a route-level proof. It searched endpoint modules for filesystem write, copy, rename, unlink, remove, directory-create, and write-stream primitives, then listed the route declarations in those modules. A route must be inspected at the callsite before it is classified as an account-root mutation. Some writes may target temporary files, caches, provider outputs, or paths outside the authenticated account data root.

## 1. Additional candidate modules outside the current Host route-guard allowlist

| Source module | Candidate route declarations | Required disposition |
|---|---|---|
| `src/endpoints/content-manager.js` | `POST /importURL`, `POST /importUUID` | Trace imported character/world files and target roots; block or receipt |
| `src/endpoints/image-metadata.js` | `POST /`, `/folders/create`, `/folders/set-thumbnails`, `/folders/update`, `/folders/delete`, `/folders/assign`, `/folders/unassign`, `/cleanup` | Trace metadata and image-folder writes; prove root coverage or guard |
| `src/endpoints/images.js` | `POST /upload`, `POST /delete` | Trace account-root image mutations |
| `src/endpoints/moving-ui.js` | `POST /save` | Trace settings persistence and root location |
| `src/endpoints/presets.js` | `POST /save`, `/delete`, `/restore` | Trace preset writes and restore semantics |
| `src/endpoints/settings.js` | `POST /save`, `/make-snapshot`, `/restore-snapshot` | Writes account settings and settings backups; all three routes are now fail-closed guarded |
| `src/endpoints/quick-replies.js` | `POST /save`, `/delete` | Trace account/global quick-reply persistence |
| `src/endpoints/secrets.js` | `POST /write`, `/delete`, `/rotate`, `/rename`, `/settings` | Trace secret-store writes and account/global scope |
| `src/endpoints/sprites.js` | `POST /delete`, `/upload`, `/upload-zip` | Trace character sprite files and archive expansion |
| `src/endpoints/stats.js` | `POST /recreate`, `/update` | Trace stats-file writes |
| `src/endpoints/stable-diffusion.js` | ComfyUI `/save-workflow`, `/delete-workflow`, `/rename-workflow` | Writes/deletes/renames per-account workflow JSON files; fail-closed guarded and included in source identity coverage |
| `src/endpoints/thumbnails.js` | `GET /` (thumbnail generation side effect) | Writes derived per-account thumbnail cache files; Host mode now serves the original image when a cache miss would write a file |
| `src/endpoints/themes.js` | `POST /save`, `/delete` | Trace theme persistence |
| `src/endpoints/worldinfo.js` | `POST /delete`, `/import`, `/edit` | Trace World Info file writes and imports |
| `src/endpoints/vectors.js` | `POST /insert`, `/delete`, `/purge`, `/purge-all` | Trace vector-store mutations and whether they touch the enrolled root |
| `src/endpoints/extensions.js` | `POST /install`, `/update`, `/switch`, `/move`, `/delete` | Source/runtime mutation; must invalidate source attestation or be disabled while Host authority is active |
| `src/endpoints/users-private.js` | `POST /change-avatar`, `/change-password`, `/backup`, `/change-name`, `/reset-settings`, `/reset-step1`, `/reset-step2` | Account/session/root lifecycle; retain explicit fail-closed treatment for root reset |
| `src/endpoints/users-public.js` | `POST /recover-step2` | Password recovery writes account credentials; blocked while Host authority is active |
| `src/endpoints/users-admin.js` | `POST /create`, `/delete`, `/disable`, `/enable`, `/promote`, `/demote` | Account-directory and authorization lifecycle; deletion must remain blocked until a receipt/revocation contract exists |
| `src/endpoints/backgrounds.js` | `POST /delete`, `/rename`, `/upload` | Trace background file mutations |
| `src/endpoints/avatars.js` | `POST /delete`, `/upload` | Trace avatar file mutations |
| `src/endpoints/assets.js` | `POST /delete`, `/character` | Trace asset copy/delete targets |
| `src/endpoints/files.js` | `POST /upload`, `/delete` | Trace generic account file writes |
| `src/endpoints/backups.js` | `POST /chat/delete` | Already guarded in the Host patch; keep in the primary route audit |

## 2. Important boundary findings

- The Host root scanner is rooted at the authenticated account data directory. It does not automatically cover SillyTavern installation code, plugin directories, extension source, global configuration, or provider cache directories outside that root.
- An extension install/update/switch/move/delete can change the code whose route coverage is being attested. Such a change must invalidate source identity, even if the account data-root manifest is unchanged.
- A filesystem write primitive inside a module is only a candidate signal. The callsite's resolved target path and route middleware must be checked before declaring the route in-scope.
- The pinned Host source audit currently has explicit chat/account mutation anchors and a narrower route-guard matrix. This archive scan adds candidates that require source-level disposition before a complete route-coverage attestation can be signed.
- The remaining write primitives in `src/endpoints/openai.js`, `src/endpoints/speech.js`, and `src/endpoints/backends/kobold.js` remove request-upload temporary files; they do not write into the authenticated account root.
- `src/endpoints/tokenizers.js` writes its shared `DATA_ROOT/_cache` directory, outside the per-account root being attested. It is a global derived cache, not account conversation state; this boundary must remain explicit if the SillyTavern data-root layout changes.
- Server startup also runs content seeding, disk-cache verification, flat-secret migration, settings backup initialization, and stats initialization. These can write account-root files without an HTTP mutation route, so the pinned Host patch now skips those operations while Host authority is configured. Temporary upload cleanup and global access-log maintenance remain outside the per-account root.
- `src/endpoints/data-maid.js` `POST /finalize` and password-recovery step 1 update only in-memory, short-lived tokens; the filesystem deletion/password mutation routes are separately guarded.
- No candidate route in this document is claimed to be safe merely because a later root scan might detect a changed file.

## 3. Current disposition in PR #874

The additional mutation candidates identified above are now patched with `createHostUnsupportedMutationGuard` and included in the pinned-source route audit. The guard returns `503 NON_READY / HOST_MUTATION_ROUTE_UNSUPPORTED` whenever Host deployment identity is configured or a Host session capability is active. It runs before the original mutation handler.

This is deliberately a fail-closed interim contract: it prevents unreceipted account-root and installed-source mutations from silently bypassing Host lifecycle/inventory. It does not implement receipts for those operations, and it does not establish completeness by itself. Route-specific receipts and a runtime source attestation remain P0 work.

## 4. Required next implementation pass

For each candidate route, record: (1) exact resolved write targets, (2) whether the target is inside the enrolled account root or the SillyTavern installation/global root, (3) whether the route is receipted, blocked, or invalidates source authority, and (4) a pinned-source test asserting that disposition. Do not turn this candidate scan into a blanket allowlist.

**Acceptance consequence:** the source-completeness attestation producer must remain disabled until every in-scope route has an explicit disposition and the runtime source identity check covers the installed route handlers and plugin/extension mutation boundary.
