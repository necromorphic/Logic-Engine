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
- `createStLifecycleBridge().verifyCurrentSource()` reads the current chat through the Host-owned `getChat()` dependency and compares its fingerprint with the latest journal checkpoint. Drift returns `NON_READY`; a match is labelled `LOCAL_MATCH_NON_AUTHORITATIVE` and still returns `trustDecision: NON_READY`. The journal-only `status()` method does not accept caller-supplied messages or booleans as evidence; it remains `NON_READY` and never upgrades readiness. The bridge also checks the live message/version identity mapping against the journaled snapshot. The source fingerprint includes the live ST locator, observed `chat_metadata.main_chat` / `integrity` / session name / group ID, and per-message `extra.branches` references. Tests prove changes to those observed branch metadata/references invalidate the enrolled fingerprint. This proves only correspondence to the same local checkpoint: it does not prove that a child branch's `main_chat` name points to the correct parent artifact, nor that local lineage metadata is authentic. Tests explicitly demonstrate that a coordinated rewrite of local records plus the local head can still defeat local hashes, which is why the result never proves authenticity or rollback resistance. Its `trustEvidence` report separates local journal integrity, live fingerprint, identity/version mapping, source authenticity, rollback resistance, lifecycle completeness, pre-enrollment history, and install/conversation/world/branch/restore binding instead of collapsing them into one trust bit.
- Reconciliation compares native chat fingerprint **and** the current message/version IDs, active swipe, digests, and lineage against the last journaled identity snapshot. This catches copied/restored sidecar IDs even when message text is unchanged.
- The prototype never asserts capture readiness from caller-supplied coverage. Without trusted pinned-source hook attestation it remains NON_READY.

## Digest-only Core transport (review-only)

The current patch can forward digest-only Host version entries to the PC Logic-Engine API through a same-origin SillyTavern server endpoint. Browser code does **not** receive the Core API token or adapter token; the server-side proxy reads these environment variables:

- `LOGIC_ENGINE_CORE_URL`: root URL of the PC Core API, for example `http://192.168.1.10:8787`.
- `LOGIC_ENGINE_API_TOKEN`: the Core API bearer token.
- `LOGIC_ENGINE_ADAPTER_ID`: the adapter ID configured on Core.
- `LOGIC_ENGINE_ADAPTER_TOKEN`: the matching adapter secret configured in Core's `ENGINE_ADAPTER_TOKENS`.

The proxy accepts only conversation/message/version IDs, a SHA-256 digest, and active/deleted flags. It rejects caller-supplied world IDs, arbitrary URLs, raw text fields, and malformed digests. It forwards only to the server-configured Core URL and does not log request bodies. On the PC, set `ENGINE_HOST=0.0.0.0` and `ENGINE_ALLOW_REMOTE=true` only when phone-to-PC LAN access is needed; restrict the port with the PC firewall to the phone/private subnet and do not expose the Core API to the public internet.

Before capture can succeed, an administrator must bind the authenticated adapter ID and stable Host conversation ID to a canonical Core world using `/v1/host-conversation-bindings`. The stable ID is returned by `window.logicEngineHostLifecycle.enrollCurrentConversation()`; because the first publication can precede binding, inspect its `coreCaptureStatus`, create the binding, then call `window.logicEngineHostLifecycle.syncCurrentDigestInventory()` and check `getCoreCaptureStatus()`. The bridge publishes current digest entries serially after native save and emits tombstones for versions it observes being removed. This is transport coverage, not a complete source inventory: missed server-side imports/deletions, copy/restore, branch operations, external edits, and crash/restart ordering can still invalidate the ledger.

**Trust boundary for the local inventory check:** matching the live fingerprint to the journal proves consistency with the local checkpoint only. The records and head checkpoint share the Host-controlled IndexedDB trust domain; an actor able to rewrite or roll back both can defeat this check. The verifier therefore explicitly reports missing independent trust anchor, rollback resistance, complete lifecycle coverage, pre-enrollment history, and trusted pinned-source attestation. This is a freshness diagnostic, not proof of source authenticity and not an authorization signal.

**Production remains fail-closed.** Core currently composes the digest ledger with a deny-only inventory verifier, so capture can persist digests but reconciliation cannot publish `READY`. This path does not persist raw message text, create semantic Memory records, admit Memory→NPC context, or authorize outbound model dispatch. Do not infer readiness from a successful HTTP response.

## Pinned-source hook patch

The candidate patch also replaces the pinned MakerSuite/Vertex sender's raw `console.debug(`${apiName} request:`, body)` with metadata-only logging (`model`, `stream`, and message count). The pinned-source CI fails if the raw-body log returns and syntax-checks/lints the changed endpoint. This is a patch-artifact mitigation only; it is not installed into a live ST instance and does not create a final-send authorization gateway.

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

These results prove repository CI only. The storage assertions use a fake IndexedDB implementation and do not prove browser persistence, Android/Termux durability, full lifecycle coverage, or production readiness. PR #323 remains Draft/review-only; unsupported import/restore/branch/group deletion/migration paths and the absent approved Host↔Core pre-release contract keep readiness `NON_READY` and Memory→NPC `DISABLED / FAIL-CLOSED`.


## Exact-head follow-up — unsupported-operation fail-closed checks (26 Oct 2026)

Latest reviewed Host-only code HEAD: `f97a4f4b2a76d0d76b82c37d61ee187b89ee7ceb` ([commit](https://github.com/necromorphic/Logic-Engine/commit/f97a4f4b2a76d0d76b82c37d61ee187b89ee7ceb)). The test suite checks that each unsupported lifecycle operation rejects before mutation; it does not require unsupported-operation labels to match readiness `missingPaths` strings verbatim.

Exact-head CI for this code HEAD:
- [Host lifecycle patch check #40276126045](https://github.com/necromorphic/Logic-Engine/actions/runs/40276126045) — SUCCESS.
- [Runtime tests #40276125997](https://github.com/necromorphic/Logic-Engine/actions/runs/40276125997) — SUCCESS.
- [Host lifecycle patch validation #40276125986](https://github.com/necromorphic/Logic-Engine/actions/runs/40276125986) — SUCCESS.

This refresh records repository CI only. It does not establish live browser/Android/Termux behavior, real IndexedDB durability, persisted chat-file before/after evidence, or full lifecycle coverage. PR #323 remains Draft/review-only. Core approval of the Host↔Core/Provider handoff and real persisted-state acceptance evidence are still required; production Memory→NPC remains DISABLED / FAIL-CLOSED.

## Pinned source inventory evidence (27 Oct 2026)

See [`PINNED-SOURCE-INVENTORY-EVIDENCE.md`](./PINNED-SOURCE-INVENTORY-EVIDENCE.md) for the pinned archive identity, native locator/version semantics, branch/import lifecycle evidence, and the explicit conclusion that `getChat()` cannot prove a complete authoritative all-time inventory. The document includes an upstream verified-commit check and matching Git blob IDs for three audited source files; it does not claim full-archive equivalence or a live-device experiment. Host remains `NON_READY`; Memory→NPC remains `DISABLED / FAIL-CLOSED`.


## Current mainline integration status

The active Host lifecycle integration is tracked by [Draft PR #456](https://github.com/necromorphic/Logic-Engine/pull/456), branch `host/lifecycle-mainline-integration-2026-10-27`. PR #445 was closed as superseded without merging. Because every push changes the exact validated commit, use the [current PR checks](https://github.com/necromorphic/Logic-Engine/pull/456/checks) for validation status and the [branch comparison](https://github.com/necromorphic/Logic-Engine/compare/main...host/lifecycle-mainline-integration-2026-10-27) for freshness.

Host capture/reconciliation remains `NON_READY`; production Memory→NPC remains `DISABLED / FAIL-CLOSED`. Complete lifecycle route coverage, all-time inventory, source authenticity, rollback resistance, authenticated lineage, live Android/Termux durability, and final-send enforcement remain unproven.

## Server-side persisted artifact inventory (new, review-only)

The candidate pinned-source patch adds an authenticated SillyTavern server route at `POST /api/logic-engine/host-artifact-inventory/scan`. It scans the per-user character-chat, group-metadata, group-chat JSONL, and backup storage roots supplied by the server, returns relative artifact locators, byte lengths and SHA-256 digests, and never returns file contents. A scan with an unreadable root, partial enumeration, symlink, unsupported file type, read failure, or detected concurrent file change returns `INVENTORY_INCOMPLETE` with no partial artifact list.

A successful scan is labelled `CURRENT_SNAPSHOT_NON_AUTHORITATIVE`; historical completeness is always `UNKNOWN`. This is a first server-side inventory primitive, not a complete all-time history registry. It does not reconstruct pre-existing deleted versions, create deletion tombstones for files that merely disappear, authenticate branch/import/restore lineage, persist an append-only history across future scans, or provide rollback resistance. The browser-local journal remains enrollment-forward-only. Direct mutation routes still need route-by-route interception and pre/post persisted-state tests.

The scanner module has unit tests for digest-only output, nested files, unavailable roots, symlink refusal, and invalid root definitions. The pinned-source patch-check workflow syntax-checks the copied server scanner; source audit asserts the route's non-authoritative/digest-only contract. These checks are repository CI evidence only, not proof of a live installed ST server or Android/Termux behavior. Host capture/reconciliation remains `NON_READY`; Memory→NPC remains `DISABLED / FAIL-CLOSED`.
