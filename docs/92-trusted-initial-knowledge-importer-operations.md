# Trusted initial-knowledge file importer — operations

**Status:** implemented in `main` by PR #683. This document covers deployment configuration for the `imported` source kind only.

## Security behavior

- The registry is deployment-owned configuration in `ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES`. Its default is `[]`, which approves no sources.
- A caller supplies only the configured `source_ref` and expected world revision/commit sequence. The caller cannot supply a file path, raw bytes, or a trusted digest.
- The configured absolute local path is read server-side. Files must be regular, non-empty, and at most 1,000,000 bytes. Symlinks and path changes during open are rejected.
- Core computes SHA-256 from the exact bytes it reads and requires a matching registry entry and source envelope. Editing the file requires recomputing and reviewing the digest before updating the deployment registry.
- Invalid configuration fails at startup. Invalid files or source identity mismatches fail closed before acquisition state is mutated.
- This mechanism does not add a public HTTP import endpoint and does not enable Memory → NPC. That path remains DISABLED / FAIL-CLOSED.

## Source envelope

The file is UTF-8 JSON with exactly these top-level fields:

```json
{
  "schema_version": 1,
  "world_pack_id": "example-world",
  "world_pack_version": "1.0.0",
  "source_kind": "imported",
  "source_ref": "import:example-world:initial-knowledge-v1",
  "authorization_ref": "approval:example-world:initial-knowledge-v1",
  "assignments": [
    {
      "subject_id": "character:example",
      "fact_id": "fact:example"
    }
  ]
}
```

The identifiers above are placeholders. Each assignment must resolve to an allowed canonical subject and fact in the target world. Assignments must be non-empty, unique, and no more than 10,000 entries.

## Registry configuration

Each imported registry entry has exactly these fields:

- `world_pack_id`
- `world_pack_version`
- `source_kind` — `imported`
- `source_ref`
- `authorization_ref`
- `sha256` — lowercase SHA-256 hex digest of the **exact file bytes**
- `source_path` — absolute path owned by the deployment

Example shape (replace every placeholder; do not use this sample digest):

```json
[
  {
    "world_pack_id": "example-world",
    "world_pack_version": "1.0.0",
    "source_kind": "imported",
    "source_ref": "import:example-world:initial-knowledge-v1",
    "authorization_ref": "approval:example-world:initial-knowledge-v1",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "source_path": "C:\\LogicEngine\\trusted\\bundle.json"
  }
]
```

Set the registry as JSON in `ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES`. Keep it in deployment-controlled environment/configuration, not in user requests, prompts, Memory, or vector metadata. On Windows, use an absolute Windows path; on POSIX, use an absolute POSIX path.

## Validation and tests

Run the full test suite with `npm test`. The trusted acquisition suite is `node --test tests/core-trusted-initial-knowledge-ingestion.test.js`. The merged change passed exact-merge-commit CI jobs `test`, `core-trusted-acquisition`, `npc-boundary`, and `benchmark`.

The implementation covers successful imports, tampered bytes, caller-selected path rejection, path traversal, symlink rejection, source-kind/identity mismatch without mutation, stale cursors, idempotency conflicts, rollback, independent supports, restart/rebuild, and retry after rollback with the same idempotency key.
