# Host lifecycle-journal prototype (review-only)

Target host revision: SillyTavern 1.19.0-1-g06bde939f, commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127.

## Implemented

- Opt-in IndexedDB append-only journal. Enrollment is explicit through the development-only `window.logicEngineHostLifecycle.enrollCurrentConversation()` hook; no chat is automatically enrolled.
- Per-conversation sequence, random event IDs, canonical SHA-256 payload/record digests, and previous-record digest.
- Atomic head checkpoint in a separate object store in the same IndexedDB database. It detects a missing/truncated record tail while the checkpoint remains; it is not a separate physical failure domain and does not protect against an attacker who can rewrite both stores.
- Baseline mapping with random logical message/version IDs and content digests; raw message text is not written to the journal. Mutation records retain identity, lineage and digests only.
- Idempotent same-event replay; reuse of an event ID with a different payload fails closed.
- Strict-durability IndexedDB write transaction. A failed pre-mutation append throws so the caller must abort the mutation.
- Startup/status verification detects sequence gaps, chain/digest mismatch, schema mismatch, and head-checkpoint mismatch.
- Reconciliation compares native chat fingerprint **and** the current message/version IDs, active swipe, digests, and lineage against the last journaled identity snapshot. This catches copied/restored sidecar IDs even when message text is unchanged.
- The prototype never asserts capture readiness from caller-supplied coverage. Without trusted pinned-source hook attestation it remains NON_READY.

## Digest-only Core transport (review-only)

The current patch can forward digest-only Host version entries to the PC Logic-Engine API through a same-origin SillyTavern server endpoint. Browser code does **not** receive the Core API token or adapter token; the server-side proxy reads these environment variables:

- `LOGIC_ENGINE_CORE_URL`: root URL of the PC Core API, for example `http://192.168.1.10:8787`.
- `LOGIC_ENGINE_API_TOKEN`: the Core API bearer token.
- `LOGIC_ENGINE_ADAPTER_ID`: the adapter ID configured on Core.
- `LOGIC_ENGINE_ADAPTER_TOKEN`: the matching adapter secret configured in Core's `ENGINE_ADAPTER_TOKENS`.

The proxy accepts only conversation/message/version IDs, explicit parent lineage (`parent_version_id`, null only for a root), a SHA-256 digest, and active/deleted flags. It rejects caller-supplied world IDs, arbitrary URLs, raw text fields, and malformed digests. It forwards only to the server-configured Core URL and does not log request bodies. Core requires parent-before-child capture; the bridge preserves ancestry order. On the PC, set `ENGINE_HOST=0.0.0.0` and `ENGINE_ALLOW_REMOTE=true` only when phone-to-PC LAN access is needed; restrict the port with the PC firewall to the phone/private subnet and do not expose the Core API to the public internet.

Before capture can succeed, an administrator must bind the authenticated adapter ID and stable Host conversation ID to a canonical Core world using `/v1/host-conversation-bindings`. The stable ID is returned by `window.logicEngineHostLifecycle.enrollCurrentConversation()`; because the first publication can precede binding, inspect its `coreCaptureStatus`, create the binding, then call `window.logicEngineHostLifecycle.syncCurrentDigestInventory()` and check `getCoreCaptureStatus()`. The bridge publishes current digest entries serially after native save and emits tombstones for versions it observes being removed. This is transport coverage, not a complete source inventory: missed server-side imports/deletions, copy/restore, branch operations, external edits, and crash/restart ordering can still invalidate the ledger.

**Production remains fail-closed.** Core currently composes the digest ledger with a deny-only inventory verifier, so capture can persist digests but reconciliation cannot publish `READY`. This path does not persist raw message text, create semantic Memory records, admit Memory→NPC context, or authorize outbound model dispatch. Do not infer readiness from a successful HTTP response.

## Host Lifecycle Journal v1 contract

[HOST-LIFECYCLE-JOURNAL-V1.md](./HOST-LIFECYCLE-JOURNAL-V1.md) is the consolidated v1 implementation specification for the eleven independent-review findings: installation/account/session/conversation scope, authority snapshot, mutation IDs and event idempotency, state machine, digest/receipt semantics, SQLite atomicity, concurrency, status response, crash recovery and pinned SillyTavern operation mapping.

The terminal receipt path now has a server-side persisted-state verifier candidate. Before forwarding PREPARED, the authenticated ST server proxy snapshots the selected conversation's logical message/version identities and the full-root file inventory into immutable, fsynced receipt records. Before forwarding COMMITTED, it rescans the pinned ST data roots, requires the target chat file to have changed according to the operation-specific transition (create/edit/swipe-select/swipe-delete/message-delete), and requires every non-target root entry and other chat file to remain unchanged. It then computes a receipt digest and signs the terminal envelope with the server-held adapter token. Core verifies that HMAC using its configured adapter secret; the browser cannot supply receipt digests or signatures. ABORTED is accepted only when the server proves the exact pre-state remains unchanged. The local receipt directory must be outside the scanned ST data root; configure `LOGIC_ENGINE_HOST_RECEIPT_DIR` to an absolute protected directory when the identity-store directory is inside that root.

This is still a review-only candidate, not production readiness. Linux uses independent stable scans rather than one shared point-in-time snapshot; Windows VSS alignment is available but still requires exact runtime evidence. Crash recovery is evidence-driven: the first authenticated status check can replay a durable terminal receipt or issue COMMITTED/ABORTED only when a fresh server scan proves the exact post-state or unchanged pre-state. Missing, partial or mixed evidence remains RECOVERY_REQUIRED / NON_READY. Chat import and group-chat import are blocked by both browser hooks and server middleware whenever an enrolled conversation exists; backup restore routes through those guarded imports. Export is read-only. Bulk deletion, branch/copy, rename, group metadata migration, and other uninstrumented paths remain explicitly unsupported and fail closed. No browser journal checkpoint or successful save callback alone is accepted as evidence for COMMITTED.

The deployment authority context requires deployment-owned ENGINE_HOST_AUTHORITY_ID and positive ENGINE_HOST_AUTHORITY_GENERATION, plus a verified durable Host root-inventory head. These values are not browser inputs. Core persists the authority generation high-water mark and rejects rollback for the same authority ID; rotating the authority ID starts a new, explicitly invalidating lineage. Missing authority configuration or root-inventory evidence denies lifecycle API access.

## Pinned-source hook patch

The candidate patch also replaces a provider sender's raw request-body debug log with metadata-only logging (`model`, `stream`, and message count). The pinned-source CI fails if the raw-body log returns and syntax-checks/lints the changed endpoint. This is a patch-artifact mitigation only; it is not installed into a live ST instance and does not create a final-send authorization gateway.

Source audit: [`SOURCE-LIFECYCLE-AUDIT.md`](./SOURCE-LIFECYCLE-AUDIT.md) records pinned-source evidence and explicitly distinguishes source-confirmed behavior from unrun runtime experiments.

The reproducible patch artifact is `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch`. Latest reviewed candidate HEAD before this documentation correction was `1302b3cde2c69b0cd622489a667414b9bf1700c4`; all three exact-head workflows passed:
- [Host lifecycle patch check](https://github.com/necromorphic/Logic-Engine/actions/runs/40220887652) — SUCCESS.
- [Host lifecycle patch validation](https://github.com/necromorphic/Logic-Engine/actions/runs/40220887545) — SUCCESS.
- [Runtime tests](https://github.com/necromorphic/Logic-Engine/actions/runs/40220887657) — SUCCESS.

A later README-only evidence refresh is committed as `eeab0a3de1993b1433cba544ac421065a4500a72`. All three exact-head workflows have now also passed on that latest HEAD:
- [Host lifecycle patch check #40221247981](https://github.com/necromorphic/Logic-Engine/actions/runs/40221247981) — SUCCESS.
- [Runtime tests #40221247933](https://github.com/necromorphic/Logic-Engine/actions/runs/40221247933) — SUCCESS.
- [Host lifecycle patch validation #40221247934](https://github.com/necromorphic/Logic-Engine/actions/runs/40221247934) — SUCCESS.

These are repository CI results only. They establish patch applicability, lint/syntax and automated test results; they do not establish real browser/device persistence or lifecycle completeness.

The patch hooks the following current source paths (this is not full lifecycle coverage):
- create-message and create-swipe / append-style version changes through `saveReply()`;
- edit through `messageEditDone()`;
- swipe selection through `endSwipe()`;
- pre-mutation swipe deletion through `deleteSwipe()`;
- pre-mutation message deletion through `deleteMessage()` and `deleteLastMessage()`;
- **No `clearChat({ clearData: true })` deletion hook:** pinned-source review confirms this path is also used for chat switching/reload. Treating it as deletion would create false deletion records. Actual chat-file deletion remains uncovered.

The patch and bridge are still review-only; passing apply/lint/syntax checks is not runtime correctness evidence.

The bridge regression tests also cover write-ahead event IDs, edit-version ancestry, post-mutation save failure, restart fingerprint mismatch, and corrupted journal detection. Reconciliation explicitly returns NON_READY while any required mutation path is not instrumented; the currently hooked subset does not satisfy complete inventory acceptance.

## Newly requested P0 paths — patch boundary

The current pinned-source patch does **not** instrument these operations and must not be represented as covering them:

- `delChat()` / `deleteCharacterChatByName()`, group chat deletion, and recursive character-chat deletion: server-side file deletion may target a non-current conversation and supplies no durable per-message/version inventory to the current-chat bridge.
- `importCharacterChat()`, `importGroupChat()`, and backup restore: these create files through server import routes; the current bridge has no approved lineage contract for imported bytes or restored identities.
- `createBranch()`: writes a cloned prefix into a different chat and mutates the parent message's branch metadata; the current bridge cannot atomically checkpoint both persisted source and branch artifacts.
- `migrateGroupChatsMetadataFormat()`: server-side migration rewrites group JSON and chat JSONL outside the browser message-array hooks.

These are source-confirmed bypasses, not solved hooks. Adding client events alone would only record that an operation happened, not prove its persisted before/after state. Correctly covering them requires an approved design for the affected artifact set, durable identity/lineage, paired persisted-state digests, restart reconciliation, and failure behavior. This PR is submitted for Core review first; no new hook is installed on the user's ST instance. Until those decisions and real persisted-state tests exist, these paths remain **UNSUPPORTED / NON_READY** and Memory→NPC remains fail-closed.

## Remaining uninstrumented or unproven paths

The readiness contract explicitly enumerates lifecycle coverage paths including message create/send/receive, swipe create/select/delete, message delete/edit, regeneration, generation start/end/stop/cancel/partial-finalization, persistence ordering, clear, import/export, copy/branch, restore, chat switch, external edits, rollback, restart, and replay. This is a fail-closed coverage checklist, not a claim that those paths are currently hooked.

- Explicit generation cancellation / partial-output finalization semantics.
- Chat switching, and all import/export, copy/branch/restore paths.
- Arbitrary external chat-file edits and rollback/backup restoration.
- Identity metadata durability through SillyTavern's real save/restart/reload path.
- Android/Termux browser storage durability, restart/replay and failure injection.
- End-to-end handoff to Provider/Core and any production disclosure path.

The active swipe selection is distinct from version deletion. Baseline completeness begins only at enrollment; pre-enrollment deleted history remains UNKNOWN_UNRECOVERABLE. Native save callbacks may swallow errors; if the identity metadata does not survive, the next hook must fail closed on fingerprint/identity mismatch.

## Focused tests

Run from the Logic-Engine repository root:

```sh
node --test host-adapter/prototype/tests/*.test.mjs
```

The journal tests use an in-memory IndexedDB-shaped test double. They do not prove browser/device crash durability. CI currently verifies patch application, host entrypoint lint, module syntax, and the repository test suite; no Android/Termux runtime test has been performed.

## Review boundary

This PR does not add Core/Provider API or schema, does not wire Provider handoff, does not enable production Memory→NPC, and does not touch Ollama/vectorization. Do not merge or call it production-ready until the remaining paths and real Host persistence/replay behavior have been reviewed and tested.

## Host lifecycle follow-up — 25 Oct 2026

The candidate patch adds a **pre-mutation checkpoint for selecting an existing swipe** inside the native swipe path, before `loadFromSwipeId()` changes the active pointer. The bridge regression test verifies that the before event precedes the after event and that selecting a retained version preserves its immutable version ID.

This is a reproducible patch artifact against SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, not an installation on the user's Android/Termux instance. The journal is opt-in and records `UNKNOWN_UNRECOVERABLE` for history predating enrollment. It cannot retroactively prove versions already deleted before enrollment.

**Readiness remains NON_READY** until exact-head CI passes, full hook coverage and actual browser/Android persistence are demonstrated, and a trusted source inventory/world binding plus final disclosure contract exists. No production Host→Provider listener is enabled. No Core, Provider, NPC, Process Manager, or vectorization source is changed by this follow-up.

### Digest-only lifecycle evidence

The candidate journal records pre-mutation affected-version identity, lineage and content digests, and post-mutation immutable version IDs/digests; it does **not** retain raw message text. This follows the existing approved retention boundary. `exportCaptureLedger()` returns records only after journal-integrity verification and explicitly labels its boundary as enrollment-forward-only. This is a local evidence export primitive, not a Provider API and not a production handoff.

Because the journal stores digests rather than source bytes, it cannot itself recover deleted message text or supply content for Provider capture. That limitation is intentional under the current retention contract; any future content transfer requires a separately approved contract and must not be inferred from this prototype. Uninstrumented paths, pre-enrollment deletions, copied/restored lineage, world/session authority and real device durability remain blockers.

### Chat unload is not deletion

Source review found that pinned ST `clearChat({ clearData: true })` is used for chat switching/reload and other UI transitions. Treating that array clear as source deletion would incorrectly record the old chat as empty and could poison identity/reconciliation. The candidate patch therefore does **not** hook `clearChat` as deletion. The actual complete chat-file deletion path is still uncovered, especially when the target chat is not the currently loaded chat. `clear-chat` remains a required-but-missing coverage path, so readiness stays NON_READY.

## Exact-head follow-up — raw-content sentinel regression (26 Oct 2026)

Latest review-only candidate HEAD: `d7686b89a051cd28566a0f19bead42b0a9bd5bd5`. The regression test injects unique user/assistant/edited text sentinels and verifies that neither fake-IndexedDB journal rows/head records nor `exportCaptureLedger()` contain those raw strings after edit and deletion.

Exact-head CI for this commit:
- [Host lifecycle patch check #40275379272](https://github.com/necromorphic/Logic-Engine/actions/runs/40275379272) — SUCCESS.
- [Runtime tests #40275379287](https://github.com/necromorphic/Logic-Engine/actions/runs/40275379287) — SUCCESS.
- [Host lifecycle patch validation #40275379405](https://github.com/necromorphic/Logic-Engine/actions/runs/40275379405) — SUCCESS.

These results prove repository CI only. The storage assertions use a fake IndexedDB implementation and do not prove browser persistence, Android/Termux durability, full lifecycle coverage, or production readiness. PR #323 was merged into `main` on 26 Oct 2026, but the merged code remains a review-only prototype, not production approval. Unsupported import/restore/branch/group deletion/migration paths and the absent approved Host↔Core pre-release contract keep readiness `NON_READY` and Memory→NPC `DISABLED / FAIL-CLOSED`.


## Exact-head follow-up — unsupported-operation fail-closed checks (26 Oct 2026)

Latest reviewed Host-only code HEAD: `f97a4f4b2a76d0d76b82c37d61ee187b89ee7ceb` ([commit](https://github.com/necromorphic/Logic-Engine/commit/f97a4f4b2a76d0d76b82c37d61ee187b89ee7ceb)). The test suite checks that each unsupported lifecycle operation rejects before mutation; it does not require unsupported-operation labels to match readiness `missingPaths` strings verbatim.

Exact-head CI for this code HEAD:
- [Host lifecycle patch check #40276126045](https://github.com/necromorphic/Logic-Engine/actions/runs/40276126045) — SUCCESS.
- [Runtime tests #40276125997](https://github.com/necromorphic/Logic-Engine/actions/runs/40276125997) — SUCCESS.
- [Host lifecycle patch validation #40276125986](https://github.com/necromorphic/Logic-Engine/actions/runs/40276125986) — SUCCESS.

This refresh records repository CI only. It does not establish live browser/Android/Termux behavior, real IndexedDB durability, persisted chat-file before/after evidence, or full lifecycle coverage. PR #323 was merged into `main` on 26 Oct 2026; its code remains review-only. Core approval of the Host↔Core/Provider handoff and real persisted-state acceptance evidence are still required; production Memory→NPC remains DISABLED / FAIL-CLOSED.

## Priority-1 source inventory algorithm candidate — 30 Oct 2026

New module: `st-source-inventory.mjs`; regression suite: `tests/host-source-inventory.test.js`. This PR adds the enumeration algorithm and a pinned-ST patch candidate for an authenticated read-only route. The route is **not installed in the user's live SillyTavern**, and the Logic-Engine production Host does not call it.

This is a **non-authoritative current-file-set scan candidate** for the pinned SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. It enumerates root-level chats, every immediate character-chat directory under `user.directories.chats`, group metadata under `user.directories.groups`, and the group-chat files referenced by that metadata under `user.directories.groupChats`. Unlike `/recent`, it does not derive character chat folders from avatar PNGs and does not use `Promise.allSettled` to silently skip failed traversals.

The candidate fails closed on unavailable/unknown roots, unknown directory entries, unreadable/invalid group metadata, orphan or missing group chat files, symlinks/reparse entries, path escape, duplicate physical file identities (including hard links), zero/unavailable inode identity, size limits, and file/directory metadata or content changes detected during the scan. It reads each file through a file handle with a hard `maxBytes + 1` bound, compares path and opened-handle identity, hashes exact bytes, then re-lists/re-stats/re-hashes the path view before producing a deterministic fingerprint. It parses each bounded JSONL chat file and extracts the persisted conversation UUID plus current message IDs, swipe/version IDs, parent-version links and active swipe index. It re-hashes each current swipe payload and rejects a mismatch against the persisted digest. Missing IDs remain INCOMPLETE; IDs are never synthesized. This is a current persisted identity view only: deleted messages and pre-enrollment revisions are not reconstructed. The second scan is pathname-based, not an atomic filesystem snapshot; coordinated directory replacement races remain possible. The output is `DOUBLE_SCAN_CANDIDATE` / `DOUBLE_SCANNED_PATH_VIEW_ONLY`, not an authoritative snapshot.

**This does not establish production Host readiness.** It does not recover pre-enrollment history, deleted-message tombstones, import/export/copy/branch/restore lineage, all unsupported mutation paths, a durable installation identity, Core world/actor authorization, accepted-head authority, or target-platform race resistance. The new /session route issues a server-generated UUID inside the authenticated signed cookie session; it is scoped to the login session and rotates when the account changes, but is not an installation attestation. The module is not wired to the deny-only production verifier or any Provider/Core route. The returned state is explicitly `DOUBLE_SCAN_CANDIDATE` / `NON_AUTHORITATIVE`, never `READY`.

The test suite covers the supported root layout, pinned-build refusal, missing/orphan group chats, hard-link aliases, unknown entries, symlink refusal (when the test platform permits symlink creation), root aliasing, and an append-during-read regression proving the bounded reader stops at `maxBytes + 1`. It does not test conversation UUIDs or malformed chat headers because this candidate does not parse chat contents into identities. Concurrent directory-replacement races and Windows/Termux target-host validation remain mandatory follow-up gates.

Run:
```sh
node --test tests/host-source-inventory.test.js
```


### Pinned-ST route candidate

The patch `patches/sillytavern-1.19.0-source-inventory-route.patch` mounts a read-only `GET /api/logic-engine/host/inventory?conversation_uuid=<uuid>` route after SillyTavern's user-data router. The handler requires an authenticated `request.user`, a matching signed Host-session/account handle, and a valid conversation UUID filter. It scans the authenticated user's data roots server-side, then returns only the selected conversation's logical message/version identities and raw-byte digests; other chat locators and file identities are not returned to the browser. The result remains `NON_AUTHORITATIVE` and is not an atomic filesystem snapshot. Scan failures return a generic `NON_READY` response without paths or chat identifiers.

The route also requires `LOGIC_ENGINE_HOST_BUILD_SHA` to equal the pinned ST commit. This is explicitly a deployment assertion, **not runtime source attestation**. The inventory response returns file-level locators, physical file identities, sizes, timestamps and content hashes, plus current persisted conversation/message/swipe/version identities where available. A separate `/session` route returns the signed-session Host UUID and account handle; the inventory route requires the cookie session handle to match the authenticated account. Neither route establishes durable installation identity, Core world/actor authorization, accepted-head authority, or final Gateway dispatch. It must not be treated as production integration or used to enable disclosure.


## Authenticated SillyTavern session identity (review-only)
The pinned Host route exposes `GET /api/logic-engine/host/session`. It requires the authenticated SillyTavern account session (`request.session.handle` must equal `request.user.profile.handle`) and creates a server-generated UUID in the signed `cookie-session` object. The ID is stable while that authenticated cookie session remains valid and rotates when the authenticated account changes or the session is reset. The browser lifecycle bridge uses the composite conversation identity:

`hostSessionId:installationId:conversationUuid`

This prevents two different authenticated ST sessions from silently reusing the same Core conversation binding. The session ID is not a credential and does not authenticate a request to Core; Core still trusts only the configured server-side adapter credential and its own conversation/world binding. The browser's localStorage installation ID remains a client-side conversation namespace, not an installation identity.

The session ID survives a SillyTavern process restart only while the signed session cookie and the ST cookie-signing secret remain valid and unchanged. Logout/login, cookie loss, secret rotation, or account change rotates the identity. Existing enrollments created with the old `installationId:conversationUuid` format are not migrated automatically; the old marker/mapping mismatch fails closed and requires explicit re-binding. This is still not a durable server installation identity, a complete inventory proof, or Core world/actor authorization.


## Server-persisted installation/account identity — approved contract implementation slice

The current branch adds a second authenticated route, `GET /api/logic-engine/host/identity`, backed by `HostIdentityStore`. Configure `LOGIC_ENGINE_HOST_IDENTITY_DIR` to an absolute, server-controlled directory that is not writable by the browser or ordinary chat data operations. If the variable is absent, the route is not mounted and the browser lifecycle journal cannot open; enrolled operations fail closed.

The store creates:
- one server-generated installation UUID in `installation.json`;
- one opaque server-generated account UUID per authenticated SillyTavern account handle. The handle itself is not stored; its SHA-256 digest names the account record.

The identity endpoint is available only after the signed session's account handle matches the authenticated server account. It returns installation ID, account ID, and the current session UUID. The browser verifies the session UUID matches the preceding `/session` response, then opens an IndexedDB journal namespaced by installation/account and includes both IDs in each journal record and head checkpoint. Existing v2 browser journal databases are not silently adopted; the v3 identity-bound journal uses a new database namespace.

Operational constraints:
- Account rename produces a new opaque account ID and requires explicit re-enrollment; no implicit identity migration is attempted.
- Loss or replacement of the identity directory creates a new installation identity and requires explicit recovery/re-enrollment.
- The directory must be backed up/restored only together with the independently administered accepted-head recovery procedure. This local file store and browser IndexedDB chain are not independently rollback-resistant.
- This does not provide runtime source attestation. `LOGIC_ENGINE_HOST_BUILD_SHA` remains an operator deployment assertion only.
- The Core-side append-only journal prototype currently has a trusted identity-resolver seam but is not yet connected to this ST endpoint. The identity route and browser journal changes therefore remain an integration candidate, not production authority.

Run the expanded pinned-host checks with:
```sh
node --test host-adapter/prototype/tests/*.test.mjs tests/host-source-inventory.test.js tests/host-lifecycle-journal.test.js
```


## Coordinator approval and release boundary — 30 Oct 2026

The delegated project-level contract now explicitly approves this metadata-only identity/lifecycle direction. The journal is evidence of operations observed by the instrumented Host; it is not, by itself, proof that every SillyTavern mutation path is instrumented or that the filesystem inventory is complete.

For the first slice:
- Persist only installation/account/conversation/message/version identifiers, parent/active relationships, operation type, monotonic sequence, and content digests. Never persist message text, prompts, summaries, or provider credentials.
- A missing journal event, unsupported operation, out-of-band filesystem change, invalid hash chain, or uncertain restore makes the affected conversation NON_READY.
- The baseline starts at explicit enrollment. Deleted history from before enrollment is unknown and must not be represented as captured.
- Browser IndexedDB and the local server identity directory are not anti-rollback authorities. The external accepted-head/restore domain remains a separate release gate.
- This branch does not authorize Provider raw capture, Core READY publication, protected model disclosure, or production Memory→NPC activation.


## Full-root VSS inventory and per-file reconciliation candidate

This candidate ports the pinned-ST 1.19.0 full-root scanner, Windows VSS snapshot lease, authenticated manifest object check, and file-level delta journal. The server inventory response remains explicitly review-only: it reports the current source blockers and does not publish READY.

The standalone reconciliation module now supports an enrollment-forward baseline, path/physical-identity/SHA-256 comparison, and durable observation of added, removed, modified, replaced and moved files without storing file contents. A recorded delta is **not** accepted as legitimate until a matching operation-specific persisted receipt proves the same before/after file transition. Restoring bytes to the old baseline does not erase an unresolved delta observation. The module is not yet connected to the authenticated ST inventory route or a server-owned accepted-head authority; the route therefore continues to report `NO_DURABLE_FULL_ROOT_BASELINE` and `NO_FULL_ROOT_PER_FILE_DIFF`.

The current source still does not prove operation-specific file receipts for every mutation endpoint. In particular, imports, exports, restore, copy/branch, external edits, recursive deletes and group metadata changes must remain NON_READY until the pinned Host server routes are instrumented and tested against real persisted files. The Host identity route returns a session UUID to the browser, but the current Core SQLite event envelope does not persist that session UUID and has no filesystem-baseline/delta event types; those are explicit schema/API additions for the next reviewed diff. The VSS snapshot is crash-consistent, not an application-level ST transaction. The local identity directory and browser IndexedDB are not independent anti-rollback authorities.

The full-root scanner, source inventory and VSS provider are separate evidence layers:
- generic file manifest: complete file-set/content view of the authenticated per-user data root;
- semantic source inventory: current chat/group logical identities and retained versions;
- lifecycle journal: post-enrollment operations and immutable event history;
- per-file reconciliation: exact file delta, fail-closed absent a matching operation receipt.

No raw chat content is copied into the journal. No Provider, vectorization, Ollama or Memory→NPC production wiring is enabled by this candidate.


### Real SillyTavern file-operation harness

`experiments/host-adapter-runtime-harness/lifecycle-file-operations.test.mjs` mounts the actual pinned SillyTavern 1.19.0 `src/endpoints/chats.js` and `src/endpoints/backups.js` routers against disposable real directories. It exercises:
- chat create, edit, swipe update and message removal through `POST /api/chats/save`;
- chat rename and whole-chat deletion;
- JSONL export and import;
- backup download followed by import, matching the native restore workflow;
- group chat import, save and delete.

Before and after each operation, the harness takes a Windows VSS snapshot of the temporary user data root and runs the real file inventory and per-file reconciliation code. It asserts the expected added/removed/modified/replaced file delta and that the journal observation contains no raw chat text. It also calls the mounted Host `/session`, `/identity` and `/inventory` routes, checks stable installation/account/session IDs, and verifies shared-VSS full-root inventory while asserting the known baseline/reconciliation blockers. The harness checks the exact SillyTavern commit SHA.

This is real Host route/file-operation evidence, but it is not yet an end-to-end trusted receipt: the test journal is an isolated adapter, and the production ST route does not yet forward operation-specific file receipts to the Core SQLite journal. The current route must therefore remain NON_READY.


## Exact-head CI and reconciliation boundary — 31 Oct 2026

Validated candidate HEAD: `d9e099dd11553369f664d8633bed083d095e6484`.

Exact-head CI:
- Runtime tests: SUCCESS; full `npm test` reports 1,383 passed, 0 failed. The Windows Host prototype suite and recalculation oracle also passed.
- Host Adapter pinned SillyTavern source audit: SUCCESS, including the real pinned 1.19.0 file-operation harness.
- Chromium IndexedDB restart: SUCCESS. A persistent profile was closed and reopened; the metadata-only filesystem baseline and file-level delta records remained present, journal integrity verified, and no raw-text sentinel was present.
- Pinned Host source audit, patch apply/lint validation and patch check: SUCCESS.
- Linux/Windows security, Core trusted acquisition, Host inventory reconciliation, NPC boundary, Process contract and mechanics-policy authority jobs: SUCCESS.

The Chromium restart test proves that these records survive a browser process restart with the same profile. It does **not** prove rollback resistance, server ownership, Android/Termux persistence, or a trusted accepted-head authority.

### Explicit limitations found in the reconciliation path

The current `reconcileFilesystemInventory()` implementation is observation-only for changed file sets:
- It persists the initial baseline and later `filesystem-inventory-delta-observed` records in the supplied journal.
- It currently has **no operation-receipt verification implementation**. It does not accept any changed delta, even if a caller appends a record labelled as an operation receipt; every changed delta remains `NON_READY`.
- It does not append a `filesystem-inventory-reconciled` checkpoint. The checkpoint name is reserved in the lookup but there is no successful receipt-authorized transition yet.
- The browser restart test validates persistence of the baseline/delta metadata at the IndexedDB layer, not integration with the pinned SillyTavern route or Core SQLite journal.

There is also a scope mismatch to resolve before integration: the generic inventory is for the authenticated account's entire SillyTavern data root, but the current reconciliation API keys its journal by `conversationId`. A per-conversation journal does not establish one shared baseline for the whole installation/account root. The next Core-reviewed contract must decide and enforce the root-baseline scope (installation + authenticated account + canonical root identity), separately from conversation-level message lifecycle evidence.

These are not implementation details to silently infer. They require a separate exact Core approval before adding Core event types, tables, API fields, receipt schemas, or production Host wiring. Until then, all file deltas remain review-only and fail closed; the route must continue returning `NO_DURABLE_FULL_ROOT_BASELINE` and `NO_FULL_ROOT_PER_FILE_DIFF`.
