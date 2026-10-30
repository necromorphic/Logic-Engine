# Provider digest-only source ledger ↔ pinned SillyTavern Host snapshot

**Status:** draft integration evidence, 2026-10-26. This note compares the Provider ledger in PR #390 with the existing Host lifecycle prototype. It does not approve a production wire contract.

## Sources inspected

- Pinned SillyTavern target: `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Host prototype branch: `host/lifecycle-completeness-followup-2026-10-25`.
- `host-adapter/prototype/st-lifecycle-bridge.mjs`: persisted `_logicEngineLifecycle` metadata, per-message version digests, active swipe index comparison, identity snapshot comparison, and fail-closed behavior for mismatched fingerprint/metadata.
- `host-adapter/prototype/lifecycle-journal.mjs`: IndexedDB hash-chain journal with a stored head checkpoint; required coverage list includes deletion, import/export, copy/restore, external edit, rollback, restart and replay, but a required-path list is not evidence that those paths are hooked.
- Provider implementation: `src/application/host-version-digest-ledger.js` (PR #402/current main).

## What matches

| Concern | Host prototype | Provider draft | Result |
|---|---|---|---|
| Message/version identity | Random durable IDs persisted in chat metadata; each swipe has a digest | Tuple `world_id, conversation_id, message_id, version_id` | Partial match; Host does not yet provide approved world/install/branch binding |
| Digest-only handling | Journal records digests, not message text | Ledger stores SHA-256, not source text | Compatible in principle |
| Active swipe | Host compares selected swipe index with stored activeVersionIndex | Provider has an active pointer and snapshot active flag | Semantics align; real transport/adapter absent |
| Missed event | Host can compare current chat fingerprint and identity metadata against journal checkpoint | Provider accepts complete trusted snapshot and reconciles known versions | Not yet connected; Host completeness is explicitly not established |
| Restart | IndexedDB journal/head checkpoint can detect internal mismatch | SQLite ledger persists accepted snapshot head and versions | Separate stores, no restart/reconciliation bridge |
| Restore/branch/rollback | Host prototype does not support trustworthy forward/re-baseline branch enrollment and leaves uninstrumented paths NON_READY | Current `reconcileConversation` input has no installation identity, branch/restore lineage, or monotonic snapshot sequence. The injected verifier receives only `world_id`, `conversation_id`, `complete`, and `versions`; this request shape cannot prove anti-rollback or branch-change rejection. | BLOCKED: no approved shared envelope/authority contract; do not claim Provider-enforced anti-rollback |
| Deletion | Some explicit mutation hooks exist; whole-chat/group/character deletion and all imports/restores are not proven complete | Provider can tombstone exact version and tombstones missing versions only after a trusted complete snapshot | Cannot safely infer deletion from current Host prototype |

## Required snapshot envelope for a future adapter

The Provider draft expects a trusted verifier to establish, before reconciliation:

- Core-authorized `world_id`, not a caller-supplied label;
- stable Host installation and conversation identity;
- branch/restore lineage and monotonically increasing snapshot sequence;
- complete active **and historical/alternate** version inventory, with exact message/version IDs, payload digest, parent lineage, and at most one active version per message;
- a canonical inventory digest computed over the same normalized version list;
- explicit evidence that a missing version means deletion rather than partial enumeration, copy, or restore.

The current Host prototype does not yet emit this approved envelope. In particular, its IndexedDB head is a Host-local integrity checkpoint, not a PC-side Provider authority; a list of instrumented paths does not prove runtime coverage; and the current `CURRENTLY_HOOKED_PATHS` excludes delete-chat, delete-group-chat, delete-character-chat-recursive, import/restore/branch, restart/replay and other required paths.

## Provider draft behavior and limits

- `validateVersion` and `validateSnapshot` are required constructor dependencies; no default trust policy exists.
- Identical identity + digest + parent is idempotent. Same identity with a different digest/parent returns `NON_READY`.
- Swipe selection only changes active pointer. Exact-version tombstone retains the record as tombstoned.
- A trusted complete snapshot can recover missed events and the Provider fails closed on invalid inventory, known-version disappearance, digest conflict, tombstone resurrection, and unavailable/false verifier. However, the current Provider request/verifier shape does **not** carry installation identity, branch/restore lineage, or monotonic snapshot sequence, so stale-sequence rejection, branch-change detection, and restore/rollback resistance are not established by this implementation. Those guarantees remain blocked pending an approved Core/Host contract; do not infer them from an injected verifier alone.
- Ledger does not retain raw message text and does not expose an HTTP route.
- Snapshot absence is used to tombstone a version only after the injected verifier accepts the complete same-branch snapshot. That verifier is not implemented by this PR.

## Acceptance boundary

PR #390 is a Provider-local draft and unit tests are not real Host-to-Provider integration evidence. Do not merge or wire it into Memory→NPC until Core and Host approve the exact envelope and the actual Host snapshot producer/validator is implemented and tested against the pinned ST build. Memory→NPC remains **DISABLED / FAIL-CLOSED**. Ollama/VectorService remains out of scope.


## Current-main refresh — 30 Oct 2026

The original comparison above is historical (2026-10-26). Current main has since evolved the Host ledger and ST lifecycle candidate, but the core compatibility gap remains:

- `HostVersionDigestLedger.reconcileConversation()` still expects a complete message-version snapshot (`world_id`, `conversation_id`, `complete`, `versions[]`) with exact version IDs, parent lineage, digests, active and deleted flags.
- The current ST lifecycle bridge can emit digest-only per-version captures for a bounded hooked subset, but its `CURRENTLY_HOOKED_PATHS` is not complete. It does not establish pre-enrollment history, whole-chat/group/character deletion, imports, branch/copy, restore, or external file mutation.
- The consolidated Host inventory candidate in PR #783 inventories current chat/group metadata files and returns file locators, identities, sizes, timestamps, hashes, and validated persisted conversation UUIDs. It rejects malformed/duplicate UUIDs and denies the route unless the authenticated SillyTavern account session handle matches the request user. Missing UUIDs keep current-file identity incomplete. It still does **not** produce the required message-version envelope, swipe/revision lineage, a durable installation/session identity, or an atomic filesystem snapshot.
- `HostVersionDigestLedger.reconcileConversation()` accepts `world_id`, `conversation_id`, `complete`, and `versions[]`; it has no explicit installation ID, branch/restore lineage or monotonic snapshot sequence fields. A composite conversation ID can carry an installation prefix only if a trusted verifier proves that binding; the current file route does not provide that proof. The account-session check is an authentication gate, not a unique or durable session identifier. Core startup continues to pass `verifyInventorySnapshot: async () => false`. No production snapshot attestor or Host→ledger reconciliation adapter exists.

The combined pinned-ST patch candidate #787 successfully applies lifecycle hooks → file-inventory route → Direction A delete-safety overlay in CI (Host prototype tests 75/75, syntax checks and patch application pass). This does not change the snapshot contract or make `verifyInventorySnapshot` positive.

**Disposition:** patch composition is validated; Host snapshot compatibility, complete inventory, restore/branch lineage and production reconciliation remain BLOCKED / NON_READY. Do not infer Provider readiness or Memory→NPC authorization from the current-file inventory endpoint or individual digest-capture responses. No new cursor, outbox, schema or raw-text retention is approved by this refresh.


## Draft complete-snapshot API and revocation revalidation — 30 Oct 2026

Draft PR #795 adds `POST /v1/host-version-ledger/reconcile` without changing the existing snapshot schema. The authenticated adapter and Core conversation binding determine the world scope; the request cannot supply `world_id` or raw text. The route accepts the existing complete `versions[]` envelope and calls `HostVersionDigestLedger.reconcileConversation()`.

A correctness gap was closed at the ledger boundary: after the potentially asynchronous inventory verifier returns, the final READY transaction now re-resolves the adapter/conversation binding synchronously while holding the shared Coordinator lease. Core binding mutations use that same lease. If revocation commits while snapshot verification is pending, the final revalidation returns `HOST_CONVERSATION_NOT_AUTHORIZED` and READY is not published. Tests cover the lock being held during revalidation and a real API-level revoke-during-verification race using a file-backed Core store and shared Coordinator DB.

The production Core bootstrap still injects `verifyInventorySnapshot: async () => false`. Consequently the new endpoint is a transport/reconciliation seam only: in production it remains fail-closed and cannot publish READY. The test-only positive verifier proves the endpoint-to-ledger path, not Host source trust. Complete Host mutation coverage, a trusted snapshot attestor, installation/session/world binding and target-host proof remain open. No new schema, cursor, outbox or raw-text storage is introduced.
