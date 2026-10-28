# Stage B Trusted Acquisition Source — Decision Proposal

**Status:** decision proposal only; Stage B remains BLOCKED. This is not runtime implementation and does not authorize a merge or Memory → NPC.

## Verified repository constraint

Issue #634 records that current main has no supported production World Pack loader or seed/import entry point that maps a source item to a canonical subject while preserving source identity through replay and invalidation. The earlier client-facing `POST /v1/worlds/:worldId/initial-knowledge` design was reverted by #651 because admin authentication and a Core-computed digest do not prove the origin of caller-supplied source material.

Therefore the current blocker is not a missing hash or another HTTP authorization check. It is the absence of an approved source-ingestion path that can attest where the material came from and which canonical source/version it represents.

## Recommended minimal boundary

Introduce no generic public assignment endpoint. Stage B should accept acquisition only from a **trusted server-side source adapter** owned by Core (or explicitly authorized by Core) and reachable only from an approved authoring/import path.

The adapter must resolve source identity itself and emit a typed, non-forgeable in-process receipt with:
- source kind limited to `author_initial` or `imported`;
- stable source ID and immutable source version;
- Core-computed digest of the bytes actually read by the trusted adapter;
- canonical world and source-item/proposition identity;
- canonical subject resolved and validated as an eligible entity in that world;
- provenance/visibility/restriction metadata derived from the approved source contract, not arbitrary client fields;
- source validity/revocation lineage and the current Core revision/commit cursor.

The acquisition writer consumes this receipt and records a typed effect through the existing Core event/validity lifecycle. It must not create a parallel canonical store, use `fact.set` as a substitute for subject-relative acquisition, or expose an NPC/Memory/Host caller-controlled way to mint trusted knowledge.

## Source adapter contract

The source adapter must be concrete and named before runtime implementation. Its trusted inputs must come from an approved source path, not a client request containing `source_ref`, `source_content`, `subject_id`, or a claimed digest.

Minimum source flow:
1. Read from an owner-approved authoring/import source using server-side code.
2. Validate the source's own identity/version and schema; reject unknown source types.
3. Compute digest from bytes read; never trust a supplied digest.
4. Resolve each source item to a canonical subject and world; reject unknown, destroyed, cross-world, or ambiguous subjects.
5. Create/verify the typed acquisition effect through Core's normal transaction/event/revision path.
6. On replay, preserve stable identity and idempotency; reject conflicting reuse.
7. On source invalidation/revocation, ensure the acquisition is no longer eligible at the current snapshot. If the existing lifecycle cannot express this, stop for a narrowly scoped Core lifecycle decision.
8. Keep read/consumer APIs and production Memory → NPC disabled in Stage B.

## Decision needed before code

The repository evidence does not identify a production source adapter that can safely be wired today. The owner/Core decision is therefore:

**A. Name an existing approved authoring/import/seed path** and provide its concrete file/API contract; or

**B. Approve a minimal Core-owned source adapter** for a specific, owner-approved source format and storage location, including who may author it, how source versions are immutable, how provenance/visibility is represented, and how revocation/invalidation enters Core's event lifecycle.

Do not implement option B against an invented source format or storage location. Until A or B is resolved, leave the Stage B runtime unchanged.

## Required evidence

- Exact source adapter path and its trust boundary.
- Tests proving caller-supplied source fields cannot mint acquisition.
- Unknown source, digest mismatch, cross-world subject, destroyed subject, spoofed provenance, replay, conflict, revocation, rollback/recovery and stale-cursor tests.
- Evidence that acquisition is an effect in existing Core event/validity machinery, not a second source of truth.
- Traceability updates in `docs/90-core-initial-knowledge-stage-b-implementation.md` after implementation.
- Runtime and Provider acceptance on the exact PR head.
- Explicit confirmation: no Stage C read API, no production dispatch, and Memory → NPC remains `DISABLED / FAIL-CLOSED`.
