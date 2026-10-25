# Host lifecycle-journal prototype (review-only)

Target host revision: SillyTavern 1.19.0-1-g06bde939f, commit 06bde939fb1e9c4c8d8641d810f0a916b5bce127.

## What this slice implements

- Opt-in IndexedDB append-only journal primitive.
- Per-conversation monotonically increasing sequence, event IDs, canonical SHA-256 payload/record digests, previous-record digest.
- Baseline mapping with random logical-message/version IDs and content digests; no raw message text is written by this module.
- Idempotent replay of the same event; same event ID with different payload is a conflict.
- Strict-durability IndexedDB write transaction. An append error is a mutation-blocking error.
- Startup/status verification detects sequence gaps, broken chains, and digest mismatch.
- Readiness is fail-closed if any required mutation path is uninstrumented or the source fingerprint is not verified.

## Important limitation

This commit is the journal primitive and its tests only. It does not yet patch SillyTavern mutation sites, persist returned identity mappings back into the native chat object, or provide an enrollment UI. Therefore it is not wired to live ST, has no real-runtime capture claim, and cannot return a complete/current verdict for a real conversation. Memory→NPC remains disabled. Do not install this file as a standalone extension and do not treat it as production code.

## Source-inspected mutation sites to wire next

All references below are in the exact pinned revision above:

- public/script.js line 1586 — clearChat({ clearData }); only the clearData branch clears the in-memory chat array.
- public/script.js line 1601 — deleteLastMessage() truncates chat.
- public/script.js line 1639 — deleteMessage(); message deletion loop and swipe-deletion dispatch.
- public/script.js line 6642 — saveReply(); create message, append/continue, appendFinal, and swipe-generation paths mutate the active message/version.
- public/script.js line 6837 — ensureSwipes(); only assistant-like messages get swipes/swipe_info; user messages require a separate identity slot.
- public/script.js line 8397 — messageEditDone(); current content is updated before the post-mutation MESSAGE_EDITED event.
- public/script.js line 9339 — deleteSwipe(); message.swipes.splice() and swipe_info.splice() are destructive operations.

These locations were inspected in source through GitHub at the pinned SHA. A proposed unified-diff hook artifact is at host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch. It has not yet been apply-checked against a disposable checkout, so do not apply it to a working ST install. It expects the two prototype modules to be copied into public/scripts/logic-engine-lifecycle/ with their relative import preserved. The following are explicitly uninstrumented: message creation, all generation variants, edit, swipe selection, cancellation/partial generation, bulk deletion/clear, chat switching, import/export, copy/branch/restore, external chat-file edits, and restart/replay against real ST persistence.

## Local focused tests

Run from the Logic-Engine repository root:

    node --test host-adapter/prototype/tests/lifecycle-journal.test.mjs

These are unit tests against an in-memory IndexedDB-shaped test double. They are not Android/Termux persistence tests and do not prove browser IndexedDB crash durability. The journal uses the browser's strict-durability transaction mode and fails closed if the transaction fails; the actual browser/device durability contract still needs runtime verification.

## Review gate

This slice is review-only. No Core/Provider API or schema was added; no Provider handoff, production wiring, or Ollama/vectorization change was made. Before claiming capture completeness, the follow-up must add and test the native ST hooks, save the identity mapping in the chat object, implement startup reconciliation against the latest source fingerprint, and cover every path listed above.