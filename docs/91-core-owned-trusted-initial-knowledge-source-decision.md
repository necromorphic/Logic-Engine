# Core-Owned Trusted Initial Knowledge Source — Implementation Decision

**Status:** implemented and merged, 2026-10-29.  
**Implementation:** PR #683, merge commit `baf6a3041a1d663f2b78c691d2cef526bcaf9395`; repository documentation synchronized afterward.  
**Validation:** exact merge-commit checks `test`, `core-trusted-acquisition`, `npc-boundary`, and `benchmark` all passed. The importer review fixes cover same-descriptor reads, Windows path/handle identity checks, source identity mismatch rejection without mutation, symlink rejection, and retry after rollback with the same idempotency key.  
**Scope:** Stage B source authority for `author_initial` and `imported` only. This does not enable Memory → NPC or add a reader/API endpoint.

## Decision

Use a **Core-validated, content-addressed authoring/import bundle supplied through trusted deployment configuration** as the first source boundary. Do not treat `world_pack_id`, `world_pack_version`, an admin request, a Memory record, a context manifest, or a model response as proof of source authority.

The first implementation must have a real Core-owned validation path. A callback that merely returns `authorized: true` without binding the assignment to the actual immutable source bytes is not sufficient.

## Trusted source envelope

A trusted bundle must be loaded by a server-side authoring/import operation, not by a public assignment endpoint. The validated envelope must bind:

- canonical `world_pack_id` and `world_pack_version`;
- SHA-256 digest of the exact source bytes;
- source kind (`author_initial` or `imported`);
- an explicit list of subject-to-item assignments;
- canonical subject and canonical item references resolved in the same world;
- the versioned authorization rule that permits each assignment;
- a stable source reference that can be reproduced during audit/replay.

The source digest must be computed by Core from the exact bytes it validates. Do not accept a caller-supplied digest as evidence of content integrity.

## Trust boundary

- The source bundle is supplied only through a deployment-owned trusted loader/configuration path.
- No public HTTP route accepts arbitrary subject/fact/provenance fields to mint assignments.
- Generic event preparation continues to reject acquisition effects. Only the Core-owned source ingestion operation may translate a validated assignment into a canonical event.
- The source ingestion operation validates the bundle schema, digest, canonical subject/item existence, same-world scope, explicit assignment rule, and current expected `world_revision + commit_sequence`.
- The loader must not infer assignments from ordinary fact presence, channel metadata, vectors, prompts, or display names.
- `imported` is loaded only by `recordTrustedImportedKnowledgeSource`, which resolves `source_ref` against deployment-owned registry entries containing `source_path`, reads the local file server-side, enforces the 1 MiB regular-file limit, then validates the exact bytes against the same SHA-256 allowlist and explicit subject/fact assignments. The caller cannot supply a path or bytes to this operation. Direct byte ingestion remains rejected for `imported`.

## Lifecycle requirements

Assignments remain typed effects in the canonical Core event stream; the SQLite acquisition table remains a rebuildable projection. The source ingestion operation must preserve:

1. idempotent replay for the same source digest and assignment identity;
2. conflict on reuse of an idempotency key for different source bytes or assignment content;
3. independent support identity for two distinct valid sources assigning the same item to the same subject;
4. source-event rollback and rebuild removing only assignments supported by the invalidated source;
5. deterministic projection reconstruction after restart/rebuild;
6. stale snapshot rejection using existing Core revision and commit-sequence markers;
7. no public read path and no Memory → NPC dispatch as a side effect.

If an existing Core rollback primitive cannot express source support identity, add the smallest Core-owned lifecycle extension and tests before declaring this contract implemented. Do not hide this limitation in a projection filter.

## Implementation order

1. Define a strict versioned schema for the trusted source envelope and validate exact keys/types/size limits.
2. Implement a Core-owned validator that computes the digest from source bytes and resolves assignments against one world snapshot.
3. Implement the trusted ingestion operation that emits canonical acquisition events; do not expose it through the generic HTTP API. The imported-file entry point must resolve only a deployment-owned `source_ref` to a local `source_path` in the trusted registry.
4. Add adversarial tests for caller-forged digests, source/world mismatch, unknown subjects/items, duplicate assignments, changed-content replay, independent supports, rollback, rebuild, and stale cursors.
5. Run full native tests, recalculation oracle, NPC boundary, and security/API checks on the exact head.
6. Keep Stage B blocked until steps 1–5 pass. Keep Memory → NPC DISABLED / FAIL-CLOSED until the separate safe-read/visibility contract is implemented and accepted.

## Explicit non-goals

This contract does not implement observation, communication, inference, belief, delivery, comprehension, memory strength, restricted-value disclosure, a knowledge reader, prompt injection, or production dispatch. It does not add an admin assignment endpoint or make the World Pack format a production loader by declaration alone.
