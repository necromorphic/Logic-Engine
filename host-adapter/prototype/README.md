# Host lifecycle-journal prototype (review-only)

Target host revision: SillyTavern 1.19.0-1-g06bde939f, commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127.

## Implemented

- Opt-in IndexedDB append-only journal. Enrollment is explicit through the development-only `window.logicEngineHostLifecycle.enrollCurrentConversation()` hook; no chat is automatically enrolled.
- Per-conversation sequence, random event IDs, canonical SHA-256 payload/record digests, and previous-record digest.
- Atomic head checkpoint in a separate object store in the same IndexedDB database. It detects a missing/truncated record tail while the checkpoint remains; it is not a separate physical failure domain and does not protect against an attacker who can rewrite both stores.
- Baseline mapping with random logical message/version IDs and content digests; raw message text is not written to the journal.
- Idempotent same-event replay; reuse of an event ID with a different payload fails closed.
- Strict-durability IndexedDB write transaction. A failed pre-mutation append throws so the caller must abort the mutation.
- Startup/status verification detects sequence gaps, chain/digest mismatch, schema mismatch, and head-checkpoint mismatch.
- The prototype never asserts capture readiness from caller-supplied coverage. Without trusted pinned-source hook attestation it remains NON_READY.

## Pinned-source hook patch

The reproducible patch artifact is `host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch`. It has been apply-checked and applied in a disposable checkout of the exact pinned SHA by [Host lifecycle patch check #18](https://github.com/necromorphic/Logic-Engine/actions/runs/40198106441). The patched `public/script.js` passes ESLint; both prototype modules pass syntax checks in [Host lifecycle patch validation #24](https://github.com/necromorphic/Logic-Engine/actions/runs/40198106509). The full Logic-Engine test workflow passed in [run #1951](https://github.com/necromorphic/Logic-Engine/actions/runs/40198106490).

The patch hooks the current source paths for:
- create-message and create-swipe / append-style version changes through `saveReply()`;
- edit through `messageEditDone()`;
- swipe selection through `endSwipe()`;
- pre-mutation swipe deletion through `deleteSwipe()`;
- pre-mutation message deletion through `deleteMessage()` and `deleteLastMessage()`.

The patch and bridge are still review-only; passing apply/lint/syntax checks is not runtime correctness evidence.

## Remaining uninstrumented or unproven paths

- explicit generation cancellation / partial-output finalization semantics;
- bulk chat clear vs chat switching, and all import/export, copy/branch/restore paths;
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