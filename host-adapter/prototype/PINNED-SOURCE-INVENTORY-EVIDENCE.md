# Pinned SillyTavern source inventory and identity evidence

Status: Host source audit against the supplied pinned-source archive. This is source inspection, not a live-instance experiment, upstream-signature verification, or production readiness claim.

## Artifact identity

- Claimed target revision from the archive's first line: `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Claimed target version from the Host prototype: `1.19.0-1-g06bde939f`.
- SHA-256 of the supplied `SillyTavern-release.zip`: `43c60a0fe9bf52ab42a063796c74a9243b1a7a1cfcedd0b3a0b094cbf9fa50c2`.
- Upstream comparison performed on 27 Oct 2026: GitHub's commit API reports the pinned commit signature as verified (`verification.verified=true`, reason `valid`), with tree SHA `9218207b1e3bfe78224afe10e71ece3b8e79f572`. Git blob SHA-1 values computed from the supplied archive match the pinned upstream tree for the three central files inspected: `public/script.js` = `777a2d5983a6283ef9b26726e75192da1e3f3cea`; `public/scripts/bookmarks.js` = `713b106de27018c999422578d192c3fcc9e9ff91`; `public/scripts/group-chats.js` = `7b82ca84132f2e04ab41ee8ee26a1bf7c1796a1f`. This establishes matching bytes for those files against the verified pinned tree. It is not a full-tree comparison of every archive entry, and the ZIP SHA-256 identifies the supplied archive bytes.

## Source-confirmed identity semantics

### Current chat locator is not a durable authenticated identity

In `public/script.js`:
- `chat` is an exported mutable array initialized as `[]` (line 411 in the supplied archive).
- `getCurrentChatId()` returns the selected group's `chat_id`, or the selected character's `chat` locator (lines 541–546).
- `chat_metadata` is exported mutable state (declaration at line 454).

Therefore the currently loaded `chat` array is a live in-memory view, and `getCurrentChatId()` is a selected file/chat locator. Neither is itself an immutable conversation ID, an authenticated lineage proof, or a monotonic revision.

### Native message/version identity is insufficient

The source represents alternate assistant outputs through mutable `swipes`, `swipe_id`, and `swipe_info` fields. The Host prototype's random message/version IDs and digests are introduced by the adapter during explicit enrollment. They are not native stable IDs and cannot recover or identify history predating enrollment. A digest can detect changes relative to a trusted checkpoint, but cannot establish the checkpoint's authenticity.

### Branch metadata is mutable and not a parent-artifact proof

In `public/scripts/bookmarks.js`, `createBranch()`:
- creates branch metadata with `main_chat` set to the current session name and a newly generated `integrity` UUID;
- saves a branch snapshot under a new chat name;
- then appends that branch name to the parent's `extra.branches` list.

These are useful observed references but are mutable local metadata. The source path does not provide a signed or otherwise independently authenticated binding from the branch artifact to the exact parent bytes/version. Matching these values to a local checkpoint proves local correspondence only.

## Inventory completeness: what is and is not proven

### Positive evidence

- The adapter reads the current in-memory conversation through its injected Host `getChat()` dependency and rejects non-array results.
- The bridge validates the message/version identity map and compares the current fingerprint to the enrolled journal checkpoint.
- The pinned-source implementation exposes separate paths for chat mutation, branch creation, import, deletion, and persistence. These paths are not one universal transaction or one event stream.
- `clearChat({ clearData: true })` empties the in-memory `chat` array and is called by `reloadCurrentChatUnsafe()` during navigation/reload (lines 1586–1607 and 1710 onward). This is not proof that a chat file was deleted.
- `createBranch()` saves a separate snapshot and mutates parent branch metadata (approximately lines 187–245 in `public/scripts/bookmarks.js`).
- `importGroupChat()` sends a server-side import request to `/api/chats/group/import` (approximately lines 2319 onward in `public/scripts/group-chats.js`). The current loaded-chat getter cannot enumerate every server-side chat file or every historical version.
- Native save APIs include awaited and debounced paths. A current in-memory snapshot does not prove every prior mutation was durably captured.

### Negative finding

**The pinned Host getter does not establish a complete authoritative all-time inventory.** It exposes the currently loaded conversation state; it does not independently enumerate all server-side conversations, prove all mutation paths were observed, reconstruct pre-enrollment/deleted versions, or authenticate import/copy/restore lineage. A matching fingerprint cannot close those gaps.

The current Host candidate correctly reports lifecycle completeness, source authenticity, rollback resistance, pre-enrollment history, and installation/conversation/world/branch/restore binding as unproven. This is not a defect that can be repaired by adding more fields to the local fingerprint. To claim complete inventory, Host would need an owner-approved source contract and evidence that every supported mutation and file lifecycle route is covered, including non-current chats and direct server-side operations. No such contract or proof is present in this pinned source.

## Host disposition

1. **Identity:** enrollment-forward logical message/version IDs are adapter-generated and locally scoped; current native locator and branch metadata are not authenticated identities.
2. **Completeness:** not proven; the current getter is not an authoritative global inventory API.
3. **Safe runtime status:** fail closed whenever a required source path or identity/lineage fact is missing or unverifiable. Do not convert a local fingerprint match into a trust or readiness decision.
4. **Production:** keep Memory→NPC `DISABLED / FAIL-CLOSED`; Host capture/reconciliation remains `NON_READY`.
5. **Next evidence needed:** complete the archive-wide comparison if the ZIP is to be treated as an exact source snapshot; document the exact supported mutation/file-lifecycle coverage; obtain owner approval for how unsupported import/copy/restore/external-edit paths are rejected or remain unavailable. A device experiment is separate and is not claimed here.


## Upstream pin comparison (27 Oct 2026)

The upstream GitHub commit API returned `verification.verified=true` and `verification.reason=valid` for the pinned commit. The tree identifies the same Git blob IDs as the supplied archive for the three source files that directly support this audit's locator, branch, and group-import conclusions. This reduces provenance uncertainty for the audited files, but does not certify every archive entry or prove any runtime lifecycle guarantee. Repository CI is tracked separately against the Logic-Engine PR's exact HEAD.
