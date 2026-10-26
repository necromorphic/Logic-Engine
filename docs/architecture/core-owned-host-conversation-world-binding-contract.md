# Core decision: authoritative Host conversation-to-world binding

**Status:** Core architectural decision for implementation review; not production implementation or cross-block approval.  
**Owner:** Core.  
**Related:** #140, #181, #264; Host lifecycle evidence PR #323; Provider ledger PR #389; Core Memory→NPC consumer PR #168.

## Decision

Core will own the authoritative assignment of a Host conversation identity to a Logic-Engine world. Host/Adapter and Memory Provider must not treat a caller-supplied `world_id`, chat title, filename, local timestamp, or digest as proof of this assignment.

The existing `ActorBindingService` is not this mechanism. It binds `(world_id, adapter_id, entity_id)`; it does not establish which world owns a SillyTavern conversation. The existing `world_revision + commit_sequence` cursor is not a source identity or anti-rollback checkpoint.

This decision authorizes a separately reviewed Core implementation of the binding contract below. It does **not** authorize guessing Host fields, installing a route, or enabling Memory→NPC before the Host identity and persistence evidence are accepted.

## Identity and authority

1. **Authenticated adapter:** the adapter identity comes from Core's authenticated adapter channel, not an untrusted request-body field.
2. **Host conversation identity:** the mapping key must use a stable, adapter-scoped Host conversation identity. A mutable title, visible chat name, array index, current filename, message index, or swipe index is not sufficient by itself.
3. **Canonical world:** Core stores the mapping to an existing canonical `world_id`. Protected consumers obtain the world from Core's resolved binding, not from a Host-provided world value.
4. **Explicit administration:** creation, revocation, and any reassignment require an authenticated administrative action and an audit record. A conflict or ambiguous identity is rejected; no implicit auto-binding or “first world wins”.
5. **No silent reassignment:** an existing identity cannot be moved to another world by upsert, rename, import, copy, or replay. Reassignment is an explicit revoke-and-bind operation with an auditable reason and defined migration/re-enrollment procedure.
6. **Unknown means non-ready:** missing, revoked, conflicting, malformed, or unresolvable mapping means no protected Memory admission and no protected dispatch.
7. **Scope:** this mapping establishes conversation-to-world assignment only. It does not prove that Host inventory is complete, that message/version lineage is authentic, that a source is current, that Provider access is authorized, or that an external request has not already been sent.

## Host acceptance requirements

Host must provide evidence for the exact pinned SillyTavern revision that its proposed conversation identifier:

- is stable across ordinary save/load, chat switch, rename, and process restart;
- is not derived solely from mutable UI indexes or titles;
- has explicit semantics for import, export, copy, branch, restore, group/recursive deletion, and migration;
- cannot be silently substituted while preserving a prior Core binding;
- can be reconciled against persisted Host state, with unknown or unsupported lifecycle operations yielding NON_READY.

If the pinned Host revision has no suitable durable identifier, Host must not synthesize one from mutable properties and call it authoritative. The integration remains unsupported until a separately reviewed identity/lineage mechanism is available.

## Core implementation acceptance tests

The implementation PR must add tests before runtime changes and demonstrate:

1. Admin can bind a stable conversation identity to an existing world; non-admin cannot.
2. The adapter identity is taken from authenticated transport, not a caller-supplied body value.
3. Resolution returns the bound world; a caller-supplied conflicting `world_id` is rejected or ignored without changing the resolved world.
4. An unknown, revoked, malformed, or conflicting binding fails closed.
5. One identity cannot be bound to two worlds by duplicate insert, concurrent requests, retry, or upsert.
6. Reassignment requires explicit revoke/rebind and leaves an audit trail.
7. Renaming a chat does not change the mapping if the Host's accepted immutable identity remains the same.
8. Import/copy/branch/restore does not inherit the prior binding unless an explicit approved operation establishes the new identity.
9. Deletion/revocation prevents subsequent protected admission/dispatch after the defined serialization point.
10. Restart/replay does not silently recreate a revoked or reassigned mapping.
11. Mapping mutations participate in Core's established mutation ordering; independent direct SQLite writers remain a separate deployment-isolation blocker.
12. A coordinated restore of Core and Provider stores cannot be declared safe based on this mapping alone; until restore-resistant authority is implemented, anti-rollback remains NON_READY.

## Persistence and restore boundary

The binding will be Core-owned and durable in the Core persistence domain, with audit history. A local Core table alone cannot resist restoration of the whole Core database. The mapping therefore does not close the coordinated-restore finding reproduced by #388. Restore-resistant accepted-head authority must live outside the joint Core+Provider restore domain, with an explicit recovery owner and procedure.

Similarly, a shared coordinator lock orders only participating writers; it does not prevent a process with filesystem access from opening SQLite directly. Deployment isolation remains blocked until OS-enforced single-writer access is implemented and tested for the database, WAL/SHM sidecars, backups, and restore paths. Node's Permission Model alone is not sufficient to establish this boundary.

## Ownership split

- **Core:** authoritative mapping, admin lifecycle, durable audit, resolution, fail-closed behavior, and mutation ordering.
- **Host/Adapter:** stable source identity, truthful lifecycle events, persisted-state reconciliation, and explicit unsupported-operation reporting. Host cannot self-certify its own inventory completeness.
- **Memory Provider:** validate the Core-resolved world binding together with its own source-version, lineage, inventory, readiness, and revocation evidence; local digests do not create binding authority.
- **NPC:** consume only already-authorized Core/Provider results; no source authority or dispatch responsibility.
- **Deployment/Security:** OS-level DB isolation and the restore-resistant checkpoint/restore mechanism.

## Non-goals and current status

This document adds no runtime code, API route, wire field, or database schema. Those belong in a test-first implementation PR after the Host's durable identity semantics are demonstrated against the pinned revision. No existing vectorization or remote-store path is changed.

Until the binding, complete Host inventory, anti-rollback authority, and final dispatch/revocation boundary are implemented and tested, production Memory→NPC remains **DISABLED / FAIL-CLOSED**.
