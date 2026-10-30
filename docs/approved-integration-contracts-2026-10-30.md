# Approved integration contracts — Core / Host / Provider / Security

**Decision date:** 2026-10-30  
**Decision authority:** Project owner delegated approval authority for this workstream to the implementation agent in the current project conversation.  
**Baseline:** Logic-Engine `main` at `a32925c210edab534530385bdb0934f7470bd4ea`.  
**Status:** The contracts below are APPROVED for implementation. Approval is not acceptance of incomplete implementations and does not enable production Memory → NPC.

This document resolves the design decisions that were blocking owner handoffs. It does not claim that the required runtime evidence already exists.

## 1. First supported acquisition slice

The first Memory → NPC acquisition source is exactly one direct `canonical_entity` lineage. No Host message record, arbitrary chat text, summary, derived copy, or mixed-source bundle is included in this first slice.

The Provider record identity remains:

```text
(world_id, record_ref, record_version)
```

The canonical source identity remains:

```text
(canonical_entity, source_entity_id, source_version)
```

Provider-local record versions, source versions, Core revisions, Host versions, and world snapshot markers are distinct version domains. They MUST NOT be substituted for one another.

## 2. Host identity contract

Host message/swipe identity is a separate identity domain. The approved logical key is the tuple:

```text
(host_installation_id,
 authenticated_account_id,
 conversation_uuid,
 message_id,
 version_id)
```

Each version also carries:
- `payload_sha256` over the exact persisted version payload;
- `parent_version_id` (null only for the first version);
- immutable creation identity/metadata;
- active-version selection as a separate mutable pointer, never part of the version key.

Rules:

1. `host_installation_id` is a durable server-generated installation identity, distinct from a login-session UUID. It is created once for an installation and protected by deployment ACLs. Reinstall/restore/migration must explicitly preserve or rotate it under a recorded recovery procedure; it is never accepted from a browser request.
2. `authenticated_account_id` is derived from the authenticated server-side account principal. Display handles, caller-provided account IDs, conversation labels, and request fields are not authentication.
3. `conversation_uuid`, `message_id`, and `version_id` are persisted Host identities. The active swipe index is not an identity.
4. A Host identity tuple is not a Provider `record_ref` and MUST NOT be mapped directly to Provider `(world_id, record_ref, record_version)`. Core's Host version ledger is the only approved bridge between Host identity and an authorized Core source reference. Provider ingestion remains restricted to the canonical_entity slice until a separately approved Provider source contract exists.
5. A changed payload under an existing logical version identity is a conflict/corruption signal, not an overwrite. A new swipe/edit creates a new immutable version identity and explicit parent link.

The server-generated Host login-session UUID remains a session-binding control only. It is not a durable installation identity and is not a substitute for the tuple above.

## 3. Host lifecycle and completeness contract

A Host inventory may be marked `COMPLETE` only when all of the following are true:

- the pinned runtime build and installation identity are authenticated by the server, not supplied as an operator claim in an untrusted request;
- all current active and inactive versions are enumerated;
- all supported create, edit, regenerate, swipe, select, delete, restore, import, export, copy, branch, group, migration, and account/session lifecycle mutations are covered by durable lifecycle capture;
- deletions and superseded versions remain represented by durable tombstones; a missing file is never interpreted as proof that no historical version existed;
- an append-only, monotonic per-installation lifecycle journal records every mutation with sequence, event kind, exact Host identity, previous-head digest, and payload digest where applicable;
- inventory reconciliation binds the filesystem scan to the journal head and fails closed on gaps, replay, rollback, duplicate identity, unknown mutation surface, unreadable data, or disagreement;
- file reads are bound to the same opened file object whose identity and content are hashed; pathname-only stat/realpath checks are not sufficient for a security claim;
- the snapshot is published atomically as one bounded unit. The current 8 MiB / 25,000-version Core transfer limit remains in force. Larger inventories are `NON_READY`; no partial chunks may be labelled complete without a separately approved transfer protocol.

The current #800 double-scan is approved only as a `NON_AUTHORITATIVE` current-file-set candidate. It cannot publish `COMPLETE` or authorize Memory/NPC. The current #803/#802 bridge's hard-coded `complete: false` remains correct until every condition above is proven. External edits that bypass lifecycle hooks must cause reconciliation mismatch and `NON_READY`; filesystem watchers alone are not completeness evidence.

## 4. Core authorization and disclosure contract

Core is the authority for world, actor, conversation binding, source authorization, and canonical-source retraction.

- World scope is derived from the authenticated adapter/conversation binding. Caller-supplied world IDs, actor IDs, source references, and session labels are not trusted authority.
- Adapter identity is derived from a validated adapter credential; Host conversation identity is derived from the authenticated Host session and server-side binding.
- Read authorization and per-acquisition visibility authorization are separate checks. A general read grant does not authorize disclosure of every acquisition.
- Visibility binds to the exact acquisition kind, source kind, authorization reference, World Pack ID/version, provenance reference, and source digest.
- Revocation/retraction invalidates prior READY state before acknowledgement. Final authorization and disclosure preparation must be serialized against revocation using the shared Coordinator lease; no asynchronous wait is permitted while holding that lease.
- A stale, incomplete, unavailable, mismatched, untrusted, or unrecognized source snapshot is `NON_READY` and fails closed.

## 5. Provider contract

Provider owns its local record store, lineage validation, indexing, query/record grants, exact-version revocation, reconciliation state, and dependent-copy invalidation for records it already knows.

- Provider accepts only the approved `canonical_entity` source in the first consumer slice.
- Identical same-key/same-payload replay is idempotent. Changed payload, scope, or lineage under the same identity is a conflict.
- Exact-version revocation blocks that version and preserves independently authorized sibling versions.
- Provider snapshot markers are freshness markers, not a source-specific change journal.
- Provider test seams such as injected `getSnapshot` and `validateInventory` are not production Host authority.
- Provider-local tombstone/purge of legacy raw rows does not establish Host deletion/retraction integration. Core owns canonical source deletion/retraction.

## 6. Final dispatch and outbound-egress contract

The protected Memory → NPC path has exactly one final egress Gateway. All provider transports reachable by that protected path must converge on it before any network I/O begins.

- Prompt-preparation hooks, browser-side request hooks, route-entry middleware that misses provider-specific sender branches, and post-send auditing are not final authorization boundaries.
- The Gateway receives a server-authenticated request/adapter identity, exact world/conversation/actor binding, accepted-head proof, and exact candidate/acquisition set.
- It revalidates authorization, source freshness, candidate visibility, and revocation immediately before dispatch-start.
- It durably commits `DISPATCH_STARTED` while holding the shared Coordinator lease, then synchronously invokes the actual transport-start callback before releasing the lease. The callback must initiate outbound I/O synchronously and return its Promise; it may not defer initiation to a later microtask, timer, or internal await.
- The Gateway awaits network completion only after releasing the Coordinator lease. It cannot promise cancellation or retroactive revocation after dispatch-start.
- Every denial, stale snapshot, failed proof, revocation, or incomplete inventory before dispatch-start must produce zero outbound requests. No direct-provider fallback is allowed.
- The pinned SillyTavern audit identified multiple provider-specific sender branches plus a separate OpenAI-compatible fetch path. All protected branches must be routed through the same final Gateway; a partial route patch is not accepted.

PR #777's coordinator/dispatch-start primitive is accepted as a reusable ordering primitive only. It is not production Gateway wiring or evidence that the real SillyTavern provider dispatcher is covered.

## 7. Anti-rollback and SQLite-open contracts

These are independent Security gates; neither can be inferred from the other.

**Accepted-head authority**
- The authority maintains an independently durable, monotonic sequence and hash-linked history bound to installation, authority epoch/key, Core head, Provider readiness, contract version, and recovery reason.
- Local Core/Provider databases and local sequence floors are not independent trust anchors.
- Restoring an older local database while the authority remains newer must fail startup and dispatch closed.
- The authority's own history and signing keys must be protected from rollback by an independently administered service/storage and backup/restore domain. A signed client verifier alone is insufficient.
- Recovery/epoch rotation is explicit, authenticated, audited, and cannot silently lower the accepted head.

**SQLite open**
- Pathname stat, realpath, BigInt dev/ino comparisons, and a second path check do not prove that SQLite opened the same OS file object that was checked.
- A native binding/VFS implementation must bind validation to the actual opened database handle and cover journal/WAL/SHM sidecars, aliases, replacement races, and lifetime.
- The implementation must preserve the SQLite engine and Session/changeset behavior used by Core and Provider.
- Windows and Linux race/alias/sidecar tests are required. Until then, SQLite TOCTOU remains open.

## 8. Release gates

Production Memory → NPC remains `DISABLED / FAIL-CLOSED` until all are demonstrated on the exact target build and deployment:

1. authenticated installation/account/session identity and complete Host lifecycle inventory;
2. Core deployment-owned authorization and exact source/visibility binding;
3. Provider canonical-source reconciliation and exact-version revocation on the real approved source path;
4. one final egress Gateway covering every protected provider sender path, with zero-egress pre-start denial/revocation tests;
5. independently rollback-resistant accepted-head authority and restore-domain proof;
6. secure SQLite open on Windows and Linux;
7. exact-head CI plus target-PC acceptance, including real SillyTavern persisted-state and outbound-network evidence.

A passing unit/integration suite is necessary but not sufficient for target-PC deployment acceptance. No step may downgrade `NON_READY` to READY by operator assertion or by a test-only verifier.

## 9. Decision log

The following decisions are approved for implementation as of 2026-10-30:

- canonical_entity is the only first Provider consumer source;
- Host logical version identity is the tuple in section 2;
- Host session UUID and installation identity are distinct;
- Core HostVersionDigestLedger is the sole bridge from Host identity to Core-authorized source references;
- complete Host inventory requires lifecycle journal + tombstones + scan/journal reconciliation; current double-scan remains non-authoritative;
- Core owns canonical source retraction;
- the protected Memory → NPC path has one final egress Gateway with synchronous transport-start under the shared Coordinator lease;
- anti-rollback authority and secure SQLite open are separate required gates;
- production remains disabled until every release gate is evidenced.

These approvals resolve the design/ownership decisions. They do not waive missing implementation, external deployment, CI, or target-PC evidence.
