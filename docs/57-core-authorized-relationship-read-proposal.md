# Core authorized Relationship read — interface proposal

Status: **design-only proposal; no Relationship read endpoint or service method is implemented by this document.** The canonical Relationship writer is admin-only. Do not infer read permission from successful writes, actor binding, a context manifest, a Memory hit, or a known pair ID.

Related runtime:
- `src/application/authorized-read-service.js` — current entity-field read boundary.
- `src/api/server.js` — trusted `authorizedReadFieldPolicy` injection point (PR #101).
- `src/storage/sqlite-store.js` — directed Relationship projection and composite cursor.
- `docs/52-core-authorized-read-runtime-slice.md` — current narrow read guarantees.
- `docs/55-core-relationship-transition-runtime-slice.md` — admin-only canonical write/replay.

## 1. Current gap

The current `AuthorizedReadService.readEntityFields()` reads a bounded list of canonical entity fields. Its policy is trusted host configuration and defaults to self-identity metadata only. It does not read Relationship dimensions, and the public authorized-read route does not expose the Relationship projection.

The first Relationship write slice deliberately does not imply read authority. A read policy must answer who may see which directed relation, which dimension, for which recipient and purpose, at which current snapshot. Core cannot infer these answers from the existence of a stored row.

## 2. Proposed request envelope

This is a review shape, **not a runtime API contract**:

```json
{
  "worldId": "world-1",
  "adapterId": "adapter-1",
  "actorEntityId": "character-1",
  "recipient": "model",
  "purpose": "npc_decision",
  "pairs": [
    {
      "subjectId": "character-1",
      "targetId": "character-2",
      "dimensions": ["trust"]
    }
  ],
  "expectedWorldRevision": 42,
  "expectedCommitSequence": 105
}
```

Use the existing supported recipient/purpose vocabulary where appropriate. Bounds should be explicit (initially at most 50 directed pairs and 50 dimension names per pair); IDs must be canonical, unique, world-scoped entity IDs. The freshness fields are an optional optimistic precondition for callers that need a particular evaluation snapshot; successful reads always return the actual current composite cursor. They are not an authorization credential.

## 3. Trusted field-policy decision

A proposed `authorizedRelationshipReadFieldPolicy(context, pair, field)` is a trusted host callback, never request/model input. The context should contain the already authenticated adapter identity, bound actor identity, world, recipient and purpose. The immutable pair view should contain only canonical identifiers and the exact requested dimension's current projected state.

Call the policy separately for each requested field. A domain owner may define a policy outside Core, but Core enforces its decision fail-closed: only literal `true` allows disclosure; false, missing, non-boolean, thrown error, malformed response, or stale required cursor denies.

Candidate field names for review:
- `subject_id`, `target_id` — the existence and direction of the pair itself;
- `dimensions.<name>.status` — `unset`, `value`, or `cleared` for canonical projection only;
- `dimensions.<name>.value` — the explicit domain value;
- `dimensions.<name>.rule_module_id`, `dimensions.<name>.rule_module_version` — provenance, only if separately allowed.

Do not return event IDs, source/evidence references, audit payloads, or arbitrary dimension metadata by default. A source event's existence does not make its content visible.

## 4. Fail-closed output rules

- Missing world, missing participant, foreign-world participant, nonexistent pair, and a pair for which no requested field is authorized should use the same external unavailable response where distinctions would reveal existence.
- The entire requested pair set should be atomic: if a target is missing or fully withheld, do not return the remaining pairs or counts that distinguish it from an empty result.
- For partially allowed dimensions, return only individually allowed fields. Do not include denied-field names, denial reasons, filtered counts, or per-dimension status bits.
- A dimension with no projection row is `unset` only when the policy allows disclosure of that status. An explicit neutral domain value is an ordinary value. `cleared` is distinct from `unset`.
- `withheld`, `conflict`, `insufficient`, and `unsupported` are not canonical projection states in the current first slice. Do not manufacture them from absence or from evaluator failure; reject unsupported policy semantics or expose only a separately approved typed query-result status.
- Reads are non-mutating: no event, audit row, receipt, acquisition, belief, or revision change is created by returning a Relationship field.

## 5. Required owner decisions before implementation

1. **Relationship/World Pack owner:** which dimensions/values exist, whether a neutral value is explicit, and whether each status/value/provenance field is a separate disclosure unit.
2. **Core owner:** whether the host hook is a separate callback or an extension of the current entity-field policy; atomic target-set semantics; freshness behavior; error normalization; audit requirements.
3. **NPC/Memory owners:** recipient and purpose vocabulary, how retrieval results are consumed, and confirmation that a read/context inclusion does not imply acquisition, delivery, receipt, or belief.
4. **Deployment owner:** which trusted host supplies the policy and how it is configured. No default broad policy may be installed merely to make integration pass.
5. **Cross-block:** whether relationship visibility can depend on both directed participants, private identity/cover rules, world-pack policy version, and source-lineage access. If so, the trusted context must expose only canonical attributes needed to make that decision.

## 6. Required tests if approved

- Default configuration cannot read any non-self Relationship pair.
- Missing or invalid actor binding is denied before projection disclosure.
- A trusted allow policy exposes exactly the fields it permits; no extra value, status, provenance, or event reference leaks.
- Policy false, missing, non-boolean, or throwing fails closed.
- Reverse direction is independent; permission for A→B does not authorize B→A.
- Missing, foreign-world, and fully withheld pairs have the same external error shape; partial target sets are never returned.
- Stale `(world_revision, commit_sequence)` preconditions reject without returning data.
- Explicit neutral, cleared and unset remain distinct when authorized; withheld/conflict/insufficient/unsupported are not inferred from absence.
- Read operation leaves event history, audit, revision, commit sequence, and Relationship projection unchanged.
- Concurrent writer test proves the returned pair projection and composite cursor come from one SQLite read snapshot.
- Test both the internal service and the actual HTTP route with the production trusted host configuration.

## 7. Explicit non-goals

This proposal does not add a route, method, schema, table, cache, outbox, visibility default, or NPC/Memory access grant. It does not enable model-facing reads. The existing admin-only Relationship writer remains independent from this read boundary until the owners approve the policy and exact implementation contract.
