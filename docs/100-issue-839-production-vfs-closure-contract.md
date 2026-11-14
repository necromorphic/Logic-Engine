# Secure Storage / SQLite VFS — implementation and acceptance contract

**Status:** active implementation work; prototype evidence is not production approval.  
**Authority:** Notion ADR “Vector Memory как штатный модуль Logic-Engine” — Secure Storage/VFS must be completed and independently reviewed before Vector Memory implementation.  
**Security parent:** GitHub issue #770.  
**Current implementation branch:** `security/secure-storage-vfs-mainline-2026-11-14`.

## Scope

Provide a generic, host-independent secure SQLite storage foundation for Logic-Engine's protected Core, Coordinator and Host version-ledger database roles on supported Windows and Linux deployments.

The invariant is that SQLite must operate on the exact OS file object whose identity was validated during the same secure open operation. Protected database and sidecar operations must not silently fall back to path-based opens/deletes. Missing, stale, ambiguous, unsupported or corrupt identity state means fail closed before schema writes or listeners start.

## Explicit exclusions

- ST-VectorService and its independent `better-sqlite3` SQLite engine are a later Host-adapter integration. They are not a deliverable or dependency of this Secure VFS work.
- No embeddings, chunking, vector indexing, semantic retrieval or Vector Memory API.
- No SillyTavern lifecycle hooks, Host capture changes, NPC behavior or Memory→NPC activation.
- No new Core event journal, source cursor, outbox or parallel authority store unless separately approved.
- The probe must not be deployed against production databases.

## Existing prototype baseline being carried forward

- POSIX namespace broker prototype: authenticated peer credentials, role-based main/sidecar descriptor operations, broker-owned manifest and namespace mutations, quarantine deletion and restart reconciliation tests. The broker/application systemd units now describe distinct static service identities and startup ordering.
- SQLite VFS probe: VFS registration, POSIX broker descriptor path, Windows handle-relative open helper and role-manifest validation.
- Windows manifest lifecycle coordinator: a pure orchestration state machine defines durable intent ordering and recovery for sidecar create/delete. Its tests use fake store/namespace adapters; no privileged Windows service adapter or durable OS-backed implementation is present.
- Existing tests exercise a feasibility prototype. They do not establish complete SQLite file-method coverage, durable Windows broker authority, production deployment isolation or independent Security approval.

All inherited CI results belong to their original commit SHAs. This branch must produce new exact-head CI evidence.

## Required implementation stages

1. **Re-establish prototype baseline on current main.** Keep only generic Secure VFS, manifest, broker, deployment and test files. Run exact-head CI on self-hosted Linux and Windows runners.
2. **POSIX production closure.** Complete broker-owned role enrollment and all namespace mutations; ensure every SQLite file class (main, WAL, SHM, rollback journal, temp/super-journal/subjournal or explicitly rejected modes) is broker-mediated. Implement the SQLite file methods/locking/SHM behavior without unsafe path re-entry. Prove cross-process and crash/recovery behavior.
3. **Windows production broker.** Implement a real service-owned namespace and manifest authority. Named-pipe authentication alone is not sufficient. Add handle-relative open/create/delete/rename, durable manifest intent/commit, service restart reconciliation and explicit service/application identity separation. A process-local parent HANDLE probe is not production closure.
4. **SQLite VFS completeness.** For each supported platform, audit and test the full applicable `sqlite3_io_methods`, VFS callbacks, internal SQLite syscall paths, temp files and sidecars. Unsupported modes must fail closed before data mutation.
5. **Deployment and recovery.** Enforce protected parent ancestry, service ACLs, backup/restore rules, monotonic manifest generation and explicit recovery. No automatic adoption of unknown files or rollback to an older manifest.
6. **Independent Security review.** Review the exact final commit after all Linux/Windows workflows pass. Keep production database roles disabled until the review accepts the threat model and evidence.

## Acceptance matrix

| Area | Required evidence |
| --- | --- |
| Identity binding | Deterministic replacement race; same opened handle is used by SQLite |
| Role separation | Core, Coordinator and Host ledger cannot alias by hardlink, symlink/reparse point or identity collision |
| Sidecars | Main/WAL/SHM/journal/temp lifecycle is identity-bound and durable |
| POSIX | Separate broker identity, authenticated IPC, descriptor passing, namespace mutation serialization, cross-process locking |
| Windows | Separate service identity, authenticated IPC, retained directory handles, handle-relative NT opens and deletes |
| WAL and recovery | Multi-process readers/writers, SHM locks, checkpoint, hot-journal rollback, abrupt crash and restart |
| Manifest | Strict schema, unique physical identities, monotonic generation, atomic durable writes, interrupted-transition recovery |
| Fail-closed | Unknown flags, unsupported filesystems, unusable identities, missing/corrupt manifest and broker outage fail before writes |
| Review | Exact-head Windows/Linux CI plus independent Security review |

## Current disposition

- POSIX broker and Windows handle-relative code are prototypes only.
- Durable Windows broker/service adapters and full production-owned SQLite file methods remain blockers. The lifecycle coordinator is not a substitute for those adapters.
- ST-VectorService integration is deliberately deferred to its separate adapter workstream.
- Memory→NPC remains DISABLED / FAIL-CLOSED.
