# Core Memory retrieval contract

Status: proposed retrieval boundary; not a public endpoint. No runtime API or authorization policy is implied by this document.

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

Do not collapse requester, recipient, in-world actor, and purpose into one string. The request body cannot grant its own authority. A requested recipient identifies the intended consumer; it does not itself authorize disclosure to that consumer.

## 2. Authorization order

1. Authenticate the caller and resolve trusted requester/recipient binding.
2. Verify world scope and query bounds.
3. Obtain an approved access decision for the requester, recipient, purpose, world, and applicable source/snapshot context. Identity binding and world membership alone are insufficient.
4. Apply access policy to eligible authoritative records before content, snippets, embeddings, counts, or metadata are exposed.
5. Execute retrieval only over permitted candidates where practical.
6. Revalidate each hit against current record lifecycle, source validity/freshness policy, and authorization before returning content.
7. Apply stable ordering, result cap, and safe serialization.

If filtering is performed after a backend search, inaccessible results must not leak through counts, ranking explanations, snippets, continuation cursors, timing-sensitive differences, or error messages. The target architecture should push access constraints into the query where possible and still perform a final authorization check.

If the approved access policy is missing, unavailable, throws, or returns an ambiguous outcome, deny the protected read. Do not silently downgrade to world-scoped, actor-filtered, or unauthenticated retrieval. An explicit `withheld` result is not equivalent to an empty search result.

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

A response must distinguish at least:
- complete search with no eligible matches;
- successful search with results;
- partial results with a known limitation;
- unavailable retrieval mode/index;
- denied or withheld access;
- invalid/stale continuation cursor;
- source or reconciliation state that prevents a candidate from being represented as current.

Do not encode all of these outcomes as an empty array. Errors and diagnostics must themselves be access-safe.

## 6. Candidate result contract (illustrative, not a frozen API)

A returned candidate should expose only the fields required by its consumer and authorized for that request. The following is a review shape, not a schema commitment:

```json
{
  "record_ref": {"namespace": "memory", "id": "…", "version": "…"},
  "world_id": "…",
  "kind": "claim | observation | episode | canonical_reference | derived_summary",
  "epistemic_kind": "asserted | observed | canonical_reference | inferred | derived",
  "record_production": {"producer_ref": "…", "method": "…", "verification": "…"},
  "content_lineage": [
    {"source_ref": "…", "source_version": "…", "role": "…"}
  ],
  "record_time": "…",
  "source_status": "current | stale | pending_reconciliation | source_unavailable",
  "content_disposition": "active | superseded | retracted | deleted",
  "evidence_assessment": "unassessed | supported | disputed | insufficient",
  "access": "allowed",
  "retrieval": {"mode": "…", "snapshot_ref": "…", "index_status": "…"}
}
```

This shape deliberately separates:
- **record production** — which trusted service/operation produced or transformed the record;
- **content lineage** — the source references and versions that support or contributed to the claims;
- **epistemic kind** — what kind of information the record represents, not a guarantee of truth;
- **content disposition** — whether this record is active, superseded, retracted, or deleted;
- **source reconciliation** — whether its source inputs have been reconciled;
- **evidence assessment** — a typed assessment only where a domain policy defines one;
- **per-request access** — an outcome for this specific request, not a permanent record property;
- **index health** — retrieval infrastructure state, not canonical truth or source validity.

These are logical dimensions, not a demand for one enum or for every field on every record. Omit inapplicable fields explicitly according to the approved schema; do not substitute a misleading default. Internal-only identifiers and diagnostics must not be returned to model-facing callers.

A record producer is not automatically the author, observer, or verifier of every claim in its payload. Caller-supplied source labels remain untrusted claims unless a trusted adapter verifies/binds them.

## 7. Derived records and access propagation

A summary or other derived record must retain a versioned lineage manifest for all sources that materially contribute to its content. The permissions that allowed the original derivation are not permanent authorization for every future reader.

Proposed conservative default pending an approved Core visibility/declassification policy:
- Re-evaluate source access for the current reader before exposing derived content.
- If a protected source materially contributes to the summary and the reader is not authorized for that source, withhold the summary from that reader unless it has been safely re-derived using only permitted sources or a trusted, explicitly approved declassification policy permits release.
- If source lineage, versions, or current permissions cannot be checked, fail closed for protected derived content.
- Apply the rule to snippets, previews, counts, ranking explanations, and diagnostics, not only the full summary body.
- Create a new derived version and manifest after safe re-derivation; preserve historical version/audit according to retention policy rather than silently rewriting history.

This is a proposed safety default, not implemented runtime behavior. Core and Memory owners must approve the exact policy and its interaction with retention and erasure.

## 8. Source changes, rollback, and freshness

A source reference does not guarantee that its target remains valid. A source change, canonical rollback, retraction, deletion, or permission change may make a candidate or its derived records stale or unavailable.

Current-main repository inspection found no approved Memory change-feed/outbox contract. In particular, a rollback can change event validity and world revision without appending a new event or increasing the maximum `commit_sequence`. Therefore:
- a consumer must not infer “unchanged” from a `commit_sequence`-only cursor;
- any eventual reconciliation mechanism must observe source validity/revision/rollback changes and be recoverable after interruption;
- until reconciliation is complete, return a truthful stale/pending/unavailable status or withhold the candidate when caller policy requires current data;
- do not invent a durable outbox, callback guarantee, or cursor API in this contract.

The exact source-change signal, cursor semantics, and consistency guarantee remain Core-owned decisions.

## 9. Consumer boundary

Memory returns authorized candidate evidence and records. NPC decides whether and how evidence enters actor-specific knowledge/beliefs; Relations and Personality consume only under their own contracts. A retrieval call, prompt inclusion, generated summary, or context manifest must never automatically create an NPC knowledge entry, delivery receipt, or canonical event.

Acquisition, delivery attempt/status, and subject-relative belief are Core-owned semantic records under the current cross-block proposal, not Memory archive records. The NPC proposal is not merged runtime behavior; the owner-approved write path and transaction boundary must be established before implementation.

## 10. Error and side-effect guarantees

- A read does not create acquisition, delivery, belief, canonical event, or source-validity changes.
- An empty result means no eligible match was returned; it does not mean no event occurred.
- Denied/withheld, partial, stale, and unavailable outcomes remain distinguishable from empty.
- Failed retrieval does not silently fall back to a broader access scope or less trustworthy index.
- Repeated reads do not mutate authoritative record versions or create duplicate semantic knowledge.
- A failed index or reconciliation dependency is surfaced according to the caller's declared consistency requirement; it is never represented as verified currentness.
- No result field or diagnostic may disclose inaccessible record existence or protected source content.

## 11. Approval gates

Before runtime implementation, owners must agree on:
1. the approved actor/purpose/world/snapshot-scoped authorization decision and its failure semantics;
2. source-change/reconciliation signaling that detects rollback and validity changes;
3. the exact result/error schema and any per-field visibility rules;
4. derived-summary lineage/access propagation and any declassification policy;
5. NPC delivery/acquisition identifiers and the authorized Core-owned persistence path.

Until those gates are met, this remains a proposed contract, not a public endpoint or evidence of runtime support.
