# Host ↔ Core contract reconciliation — 29 Oct 2026

Status: **contract-level patch candidate; not installed or runtime-verified**. This document distinguishes API shape compatibility from source-inventory readiness.

## Confirmed mismatch

Core's `POST /v1/host-version-ledger/capture` requires an explicit `parent_version_id` property. Its value must be `null` only for a declared root, or a valid version ID. The Host prototype's server proxy and lifecycle bridge omitted this field. Consequently, the documented digest-capture flow could send requests that Core rejects as `INVALID_HOST_VERSION_CAPTURE`.

Core also verifies parent-before-child lineage when inserting a previously unseen version. The Host bridge previously sorted versions by active flag and lexical ID, which could submit a child before its parent and receive `HOST_VERSION_PARENT_UNKNOWN`.

## Contract aligned by this patch

- Host bridge sends `parent_version_id` for each current version and tombstone.
- Same-origin proxy validates the field and forwards it unchanged; missing/invalid parent values fail closed before network I/O.
- Host inventory sends parent versions before descendants. The active flag does not override ancestry ordering.
- Root versions explicitly send `parent_version_id: null`.
- Request payload remains digest/identity/lineage only. Raw message text and caller-supplied `world_id` remain forbidden.

## Current Core API envelope

### Capture

`POST /v1/host-version-ledger/capture`

Authentication: bearer `ENGINE_API_TOKEN`, `x-adapter-id`, and `x-adapter-token`.

Required body fields:

```json
{
  "conversation_id": "stable-host-conversation-id",
  "message_id": "logical-message-id",
  "version_id": "immutable-version-id",
  "parent_version_id": null,
  "content_sha256": "64 lowercase hexadecimal characters",
  "active": true,
  "deleted": false
}
```

The caller does not send `world_id`; Core resolves the adapter/conversation binding. A digest-capture response is not inventory completeness or authorization to use content.

### Bind and resolve

- `POST /v1/host-conversation-bindings`: separate admin credential; body includes `adapter_id`, `conversation_id`, `world_id`.
- `POST /v1/host-conversation-bindings/resolve`: adapter credentials; body contains only `conversation_id`.
- `DELETE /v1/host-conversation-bindings/:adapter_id/:conversation_id`: separate admin credential and audit reason.

## What this patch does not solve

- The Host journal is enrollment-forward-only and cannot reconstruct pre-enrollment or already-deleted content.
- Import, restore, copy/branch, group/recursive deletion, external edits, and some native persistence paths remain unsupported or unproven.
- Core's inventory verifier is deny-only in the default runtime. Capture may persist digest rows, but readiness must remain `NON_READY`; it must not publish `READY`.
- There is no approved final model-dispatch authorization gate. No route added here enables production `Memory → NPC`.
- Passing CI does not prove browser/Android/Termux persistence, PC firewall configuration, or real Host↔Core transport.

## Required validation

1. Proxy contract tests: missing/invalid parent rejected before upstream call; valid root and child parent IDs forwarded unchanged.
2. Bridge tests: root versions emit explicit null; child versions are sent after parents; tombstones include their known parent.
3. Core API integration test with a recording Core endpoint or disposable Core database: root capture succeeds, child capture succeeds, child-before-parent fails closed.
4. PC smoke test only after the candidate patch's CI passes. Keep production `Memory → NPC` disabled and use a disposable Host profile/world.
