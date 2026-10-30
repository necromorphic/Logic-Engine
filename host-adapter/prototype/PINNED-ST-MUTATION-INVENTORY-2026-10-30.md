# Pinned SillyTavern mutation-route inventory — 2026-10-30

**Source:** `SillyTavern/SillyTavern` commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.

This is a static source inventory of server routes and file mutation sites inspected for Host Inventory P0. It is not runtime acceptance and is not a claim that every mutation path has been found. The existing browser lifecycle event audit covers message/chat events; it does not automatically cover the server routes below.

## Per-user data and chat state

| Source file | Mutation routes / operations observed | Evidence in pinned source |
|---|---|---|
| `src/endpoints/characters.js` | create, rename, edit, edit-avatar, edit-attribute, merge-attributes, delete, import, duplicate, export; character rename copies and removes chat directories; character delete removes avatar and recursively removes its chat directory | `/create` L1024, `/rename` L1053, `/edit` L1101, `/edit-avatar` L1142, `/edit-attribute` L1193, `/merge-attributes` L1328, `/delete` L1416, `/import` L1560, `/duplicate` L1601, `/export` L1646; `cpSync` L1086, `rmSync` L1087, recursive chat delete L1442, card copy L1637 |
| `src/endpoints/chats.js` | save, rename, delete, export, group import, chat import, group delete, group save; rename is copy + unlink; import writes chat files | `/save` L545, `/rename` L621, `/delete` L654, `/export` L679, `/group/import` L751, `/import` L771, `/group/delete` L900, `/group/save` L922; copy/unlink L644–645, atomic writes L819/L859 |
| `src/endpoints/groups.js` | group create, edit, delete; migration routine backs up group/chat files and rewrites both group metadata and chat content | `/create` L156, `/edit` L190, `/delete` L203; backup/copy/write sites L55–96; delete sites L221/L230 |
| `src/endpoints/settings.js` | settings save, load snapshot, make snapshot, restore snapshot; restore copies a snapshot over settings | `/save` L206, `/load-snapshot` L316, `/make-snapshot` L340, `/restore-snapshot` L350; atomic write L209, snapshot copy L154/L367 |
| `src/endpoints/avatars.js` | avatar upload/overwrite and delete | `/delete` L22, `/upload` L41; atomic write/unlink L33/L58–59 |
| `src/endpoints/backups.js` | chat backup delete; chat backup download/read | `/chat/delete` L32; unlink L46 |
| `src/endpoints/files.js` | user file upload and delete | `/upload` L28, `/delete` L54; atomic write/unlink L44/L69 |
| `src/endpoints/worldinfo.js` | world-info delete, import, edit | `/delete` L81, `/import` L99, `/edit` L134; unlink/atomic writes L94/L130/L154 |
| `src/endpoints/presets.js` | preset save, delete, restore | `/save` L42, `/delete` L60, `/restore` L83; atomic write/unlink L56/L76 |
| `src/endpoints/quick-replies.js` | quick-reply save/delete | `/save` L10, `/delete` L21; atomic write/unlink L16/L28 |
| `src/endpoints/themes.js` | theme save/delete | `/save` L10, `/delete` L21; atomic write/unlink L16/L32 |
| `src/endpoints/backgrounds.js` | background upload/delete/rename; rename copies then removes the original and updates metadata | `/delete` L68, `/rename` L100, `/upload` L135; copy/unlink L117–118/L141–142 |
| `src/endpoints/assets.js` | asset-category cleanup, streamed asset write, asset delete, character asset path | `/delete` L269, `/character` L315; write stream/copy/unlink L237/L252–253/L297 |
| `src/endpoints/data-maid.js` | data cleanup/delete operation | `/delete` L770; unlink L808 |
| `src/endpoints/vectors.js` | vector insert/delete/purge/purge-all; deletes source directories recursively | `/insert` L512, `/delete` L547, `/purge-all` L565, `/purge` L583; recursive removes L572/L596 |

## Account, global and installation state

| Source file | Mutation routes / operations observed | Evidence in pinned source |
|---|---|---|
| `src/endpoints/users-private.js` | reset settings and reset/delete the current user's entire data root; also profile/avatar/password/name operations | `/reset-settings` L184, `/reset-step2` L261; file/root removal L194/L289 |
| `src/endpoints/users-admin.js` | administrative user creation/deletion and account-state changes; deleting a user recursively removes that user's data root | `/create` L172, `/delete` L219; root removal L241 |
| `src/endpoints/extensions.js` | extension install, update, branch switch, move and delete; extension code is outside the per-user data-root fingerprint | `/install` L92, `/update` L169, `/switch` L266, `/move` L329, `/delete` L442; recursive removals L149/L466 |

## What the current Host inventory does and does not cover

- The generic scanner now fingerprints regular files under the authenticated per-user `directories.root`, so file changes under characters, avatars, worlds, settings, backups, user files, vectors and other per-user directories affect the aggregate digest.
- The semantic parser still understands only chat/group roots. Character/persona data is fingerprinted as files, not represented by semantic character identity or lifecycle events.
- The root digest is currently returned as a summary only. The bridge does not persist/compare a durable full-root baseline or consume per-file diffs. This is **not yet an end-to-end detector**; the response carries `NO_DURABLE_FULL_ROOT_BASELINE` and `NO_FULL_ROOT_PER_FILE_DIFF`.
- Public/global SillyTavern state and extension installation directories are outside `directories.root`; the response carries `NO_GLOBAL_SILLYTAVERN_DATA_ROOT_COVERAGE`.
- Recursive deletion, import/export, copy/move/duplicate, backup restore, group metadata migration, data cleanup, user reset, vector purge and extension lifecycle need explicit before/after/restart acceptance. Browser message events do not prove these server-side operations.
- VSS provides a shared Windows point-in-time file view, not an application-level SillyTavern transaction. The Windows result retains `NO_APPLICATION_LEVEL_ATOMIC_SNAPSHOT`.

## Required next acceptance work

1. Turn this static list into a pinned, machine-checked route inventory so changes to the approved SillyTavern source fail the audit until reviewed.
2. Map each route to the exact per-user/global files it can create, rewrite, copy, move or delete.
3. Add real-file before/after tests for each operation class, including recursive cascades, imports/exports, restore/migration and user reset.
4. Prove persistence and identity after process restart, then compare the full-root manifest against the durable lifecycle journal. Any unexplained delta must remain NON_READY.
5. Keep READY disabled until every mutation route is either covered by a verified event contract or explicitly excluded with a fail-closed rule.
