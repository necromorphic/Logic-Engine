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
## Explicit WP-3 acceptance gap

This candidate is **not yet full WP-3 completion**. It currently emits a list of approved active facts and safely omits everything else, but it does not yet preserve the Core contract's internal distinctions between known, unset, withheld, incomplete, conflicted/insufficient-support, and unsupported outcomes. It also has not established an approved classification source for restrictions. Do not solve this by exposing per-item withheld markers, counts, or different response shapes to a recipient who is not authorized to know that a hidden item exists.

The governing `docs/51-core-authorized-read-boundary-contract.md` requires Core to preserve those semantic distinctions internally while normalizing withheld and nonexistent records to the same externally safe result whenever existence is not authorized. The next design step is to define the internal trusted result semantics and tests against that contract, without creating a second public serialization point or broadening the request into arbitrary fact selection. Until then, Stage C is a fail-closed read-boundary candidate, not an accepted end-to-end knowledge read contract.

The journal scan also uses the existing event API to reconstruct acquisition records; it does not add a new index/table. Its boundedness/performance under large journals has not been proven and remains a review item before production use.
