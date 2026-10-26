# Provider digest-only source ledger ↔ pinned SillyTavern Host snapshot

**Status:** draft integration evidence, 2026-10-26. This note compares the Provider ledger in PR #390 with the existing Host lifecycle prototype. It does not approve a production wire contract.

## Sources inspected

- Pinned SillyTavern target: `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`.
- Host prototype branch: `host/lifecycle-completeness-followup-2026-10-25`.
- `host-adapter/prototype/st-lifecycle-bridge.mjs`: persisted `_logicEngineLifecycle` metadata, per-message version digests, active swipe index comparison, identity snapshot comparison, and fail-closed behavior for mismatched fingerprint/metadata.
- `host-adapter/prototype/lifecycle-journal.mjs`: IndexedDB hash-chain journal with a stored head checkpoint; required coverage list includes deletion, import/export, copy/restore, external edit, rollback, restart and replay, but a required-path list is not evidence that those paths are hooked.
- Provider implementation: `src/application/source-version-ledger.js` (PR #390).

## What matches

| Concern | Host prototype | Provider draft | Result |
|---|---|---|---|
| Message/version identity | Random durable IDs persisted in chat metadata; each swipe has a digest | Tuple `world_id, conversation_id, message_id, version_id` | Partial match; Host does not yet provide approved world/install/branch binding |
| Digest-only handling | Journal records digests, not message text | Ledger stores SHA-256, not source text | Compatible in principle |
| Active swipe | Host compares selected swipe index with stored activeVersionIndex | Provider has an active pointer and snapshot active flag | Semantics align; real transport/adapter absent |
| Missed event | Host can compare current chat fingerprint and identity metadata against journal checkpoint | Provider accepts complete trusted snapshot and reconciles known versions | Not yet connected; Host completeness is explicitly not established |
| Restart | IndexedDB journal/head checkpoint can detect internal mismatch | SQLite ledger persists accepted snapshot head and versions | Separate stores, no restart/reconciliation bridge |
| Restore/branch | Host prototype does not support trustworthy forward/re-baseline branch enrollment and leaves uninstrumented paths NON_READY | Provider rejects stale sequence and changed branch; requires injected validator | Compatible fail-closed direction, but no shared branch/restore contract |
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
- A trusted complete snapshot can recover missed events; stale sequence, different branch, installation collision, tombstone resurrection, invalid inventory or unavailable trust validator fails closed.
- Ledger does not retain raw message text and does not expose an HTTP route.
- Snapshot absence is used to tombstone a version only after the injected verifier accepts the complete same-branch snapshot. That verifier is not implemented by this PR.

## Acceptance boundary

PR #390 is a Provider-local draft and unit tests are not real Host-to-Provider integration evidence. Do not merge or wire it into Memory→NPC until Core and Host approve the exact envelope and the actual Host snapshot producer/validator is implemented and tested against the pinned ST build. Memory→NPC remains **DISABLED / FAIL-CLOSED**. Ollama/VectorService remains out of scope.
