# Core Initial-Knowledge Read Boundary — Stage C Candidate

Status: draft implementation candidate on `feat/core-initial-knowledge-stage-c-read`. Not merged. No HTTP route, Memory Provider integration, NPC consumer, prompt serialization, or production dispatch is enabled.

## Implemented boundary

`InitialKnowledgeReadService` is an internal read-only application service that:

- derives the requested subject from the canonical actor binding; the request cannot nominate a different subject or fact list;
- accepts only the existing bounded recipient/purpose vocabulary;
- reads `knowledge.acquire` records from the existing Core event journal and resolves referenced facts through `LogicEngine.getSnapshot`;
- checks the composite `world_revision + commit_sequence` cursor and re-reads the acquisition projection/snapshot to reject mixed or stale reads, including rollback races;
- returns only active canonical facts whose complete disclosure is explicitly approved by a trusted application-owned policy callback;
- omits acquisition provenance, source references, source digests, event IDs, withheld-item counts, and diagnostics from the returned envelope;
- treats missing, throwing, or non-`true` policy decisions as withheld; no default visibility is inferred from `author_initial` or `imported`;
- does not mutate canonical state, event history, or audit records.

## Important limits

The callback is a trust boundary, not a visibility schema. It must be supplied by trusted Core/host configuration and must evaluate the actor, recipient, purpose, acquisition and canonical fact. It must never be generated from model output or request data. If no approved policy exists, no facts should be disclosed.

This candidate does not independently prove that an external package named by `source_ref` is authentic. Stage B's administrative credential remains the trust root for source attribution. It also does not implement belief, delivery, comprehension, observation, or Memory retrieval.

The service is intentionally not wired into an HTTP endpoint or any consumer. The existing integration gates remain in force; passing these tests would establish only this internal read boundary, not authorize Memory → NPC.

## Tests

`tests/initial-knowledge-read-service.test.js` covers explicit policy approval, withheld metadata, constructor/request validation, actor isolation, stale cursors, rollback invalidation, and a mutation during policy evaluation. The full repository CI must pass on the final candidate head before this can be considered ready for review.
