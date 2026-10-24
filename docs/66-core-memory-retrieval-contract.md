# Core Memory retrieval contract

Status: proposed retrieval boundary; not a public endpoint.

## 1. Request context

A retrieval request must include:
- `world_id`;
- authenticated requester identity established by the host;
- explicit recipient/actor when results are intended for a character or player;
- purpose/use case;
- bounded query and requested record types;
- optional subject/source/time filters;
- result limit and stable continuation cursor if pagination is supported;
- declared retrieval mode: exact identifier, structured filter, full-text, or semantic.

Do not collapse requester, recipient, in-world actor, and purpose into one string. The request body cannot grant its own authority.

## 2. Authorization order

1. Authenticate the caller and resolve trusted requester/recipient binding.
2. Verify world scope and query bounds.
3. Apply access policy to eligible authoritative records before content, snippets, embeddings, or metadata are exposed.
4. Execute retrieval only over permitted candidates where practical.
5. Revalidate each hit against current record lifecycle, source validity/freshness policy, and authorization before returning content.
6. Apply stable ordering, result cap, and safe serialization.

If filtering is performed after a backend search, inaccessible results must not leak through counts, ranking explanations, snippets, continuation cursors, timing-sensitive differences, or error messages. The target architecture should push access constraints into the query where possible and still perform a final authorization check.

## 3. Search semantics

- **Exact lookup:** stable ID or explicit key; must still authorize.
- **Structured filter:** deterministic field/time/type predicates.
- **Full-text:** lexical relevance only; not proof of truth.
- **Semantic:** embedding similarity only; not proof of truth, freshness, source quality, or permission.
- **Hybrid:** may combine rankings, but must define deterministic tie-breaking and disclose the retrieval mode in diagnostics.

Search ranking must not mutate record state, establish beliefs, or silently resolve conflicts. A missing result means only “no eligible matching record was returned under this query/policy/index state”; it does not prove that an event did not happen or that no inaccessible record exists.

## 4. Determinism and pagination

Within the declared consistency snapshot and same normalized request, the same authoritative dataset/policy version must produce the same ordered result. Use a stable final tie-breaker such as `memory_id`. Pagination must bind the cursor to world, query hash, policy version, and snapshot/index generation; reject incompatible cursor reuse.

If the semantic backend cannot provide stable ranking, document that only the candidate set—not exact order—is reproducible, and use deterministic local tie-breaking after candidate generation. Do not claim strict determinism beyond actual backend guarantees.

## 5. Stale or unavailable indexes

The authoritative record store is the fallback for exact/structured lookup. If full-text or semantic search is unavailable, return a typed partial/unavailable status; do not claim an empty result. If an index is behind the authoritative revision, either constrain the response to a declared index generation with a staleness marker or fail the mode closed according to caller requirements. Never use a stale index to bypass lifecycle or authorization checks.

## 6. Result shape

Return records with explicit type, version, epistemic kind, lifecycle/freshness status, provenance summary, source references, and retrieval diagnostics appropriate to the recipient. Do not return internal-only fields or raw storage rows. Any omitted/withheld records must not be converted into a negative fact.

## 7. Consumer boundary

Memory returns candidate evidence and records. NPC decides whether and how evidence enters actor-specific knowledge/beliefs; Relations and Personality consume only under their own contracts. A retrieval call must never automatically create an NPC knowledge entry or canonical event.