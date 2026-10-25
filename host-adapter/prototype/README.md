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

## Pinned-source hook patch

Source audit: [`SOURCE-LIFECYCLE-AUDIT.md`](./SOURCE-LIFECYCLE-AUDIT.md) records pinned-source evidence and explicitly distinguishes source-confirmed behavior from unrun runtime experiments.

The reproducible patch artifact is `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch`. On exact HEAD `be86e167a4387feeb01107e38f3016d28762be11`, all three CI workflows passed: [Host lifecycle patch check](https://github.com/necromorphic/Logic-Engine/actions/runs/40204515448) — pinned-source apply-check/application, syntax checks, and all 28 Host prototype tests; [Host lifecycle patch validation](https://github.com/necromorphic/Logic-Engine/actions/runs/40204515446) — patched ST entry point ESLint and prototype syntax checks; [Runtime tests](https://github.com/necromorphic/Logic-Engine/actions/runs/40204515445) — repository test suite plus the separate 8-test recalculation harness.

The patch hooks the following current source paths (this is not full lifecycle coverage):
- create-message and create-swipe / append-style version changes through `saveReply()`;
- edit through `messageEditDone()`;
- swipe selection through `endSwipe()`;
- pre-mutation swipe deletion through `deleteSwipe()`;
- pre-mutation message deletion through `deleteMessage()` and `deleteLastMessage()`;
- pre-mutation full chat-data clear through `clearChat({ clearData: true })`.

The patch and bridge are still review-only; passing apply/lint/syntax checks is not runtime correctness evidence.

The bridge regression tests also cover write-ahead event IDs, edit-version ancestry, post-mutation save failure, restart fingerprint mismatch, and corrupted journal detection. Reconciliation explicitly returns NON_READY while any required mutation path is not instrumented; the currently hooked subset does not satisfy complete inventory acceptance.


## Remaining uninstrumented or unproven paths

The readiness contract explicitly enumerates 25 lifecycle coverage paths: message create/send/receive, swipe create/select/delete, message delete/edit, regeneration, generation start/end/stop/cancel/partial-finalization, persistence ordering, clear, import/export, copy/branch, restore, chat switch, external edits, rollback, restart, and replay. This is a fail-closed coverage checklist, not a claim that those paths are currently hooked.


- explicit generation cancellation / partial-output finalization semantics;
- chat switching, and all import/export, copy/branch/restore paths;
- arbitrary external chat-file edits and rollback/backup restoration;
- identity metadata durability through SillyTavern's real save/restart/reload path;
- Android/Termux browser storage durability, restart/replay and failure injection;
- end-to-end handoff to Provider/Core and any production disclosure path.

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

The candidate patch now adds a **pre-mutation checkpoint for selecting an existing swipe** inside the native swipe path, before `loadFromSwipeId()` changes the active pointer. The bridge regression test verifies that the before event precedes the after event and that selecting a retained version preserves its immutable version ID.

This is a reproducible patch artifact against SillyTavern commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`, not an installation on the user's Android/Termux instance. The journal is opt-in and records `UNKNOWN_UNRECOVERABLE` for history predating enrollment. It cannot retroactively prove versions already deleted before enrollment.

**Readiness remains NON_READY** until exact-head CI passes, full hook coverage and actual browser/Android persistence are demonstrated, and a trusted source inventory/world binding plus final disclosure contract exists. No production Host→Provider listener is enabled. No Core, Provider, NPC, Process Manager, or vectorization source is changed by this follow-up.


### Digest-only lifecycle evidence

The candidate journal records pre-mutation affected-version identity, lineage and content digests, and post-mutation immutable version IDs/digests; it does **not** retain raw message text. This follows the existing approved retention boundary. `exportCaptureLedger()` returns records only after journal-integrity verification and explicitly labels its boundary as enrollment-forward-only. This is a local evidence export primitive, not a Provider API and not a production handoff.

Because the journal stores digests rather than source bytes, it cannot itself recover deleted message text or supply content for Provider capture. That limitation is intentional under the current retention contract; any future content transfer requires a separately approved contract and must not be inferred from this prototype. Uninstrumented paths, pre-enrollment deletions, copied/restored lineage, world/session authority and real device durability remain blockers.


### Chat unload is not deletion

Source review found that pinned ST `clearChat({ clearData: true })` is used for chat switching/reload and other UI transitions. Treating that array clear as source deletion would incorrectly record the old chat as empty and could poison identity/reconciliation. The candidate patch therefore does **not** hook `clearChat` as deletion. The actual complete chat-file deletion path is still uncovered, especially when the target chat is not the currently loaded chat. `clear-chat` remains a required-but-missing coverage path, so readiness stays NON_READY.
