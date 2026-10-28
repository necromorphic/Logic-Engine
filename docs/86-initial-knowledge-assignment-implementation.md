# Initial subject knowledge assignment — implementation slice

Status: **draft implementation; not approved for production activation.** Tracks Core issue #557 and remains subordinate to the governing disclosure/dispatch gate in #140/#264/#356.

## Scope

This slice supports only explicit initial assignments with source kinds `author_initial` and `imported`. It does not implement observation, communication, inference, rumor, belief, delivery, comprehension, or model-context disclosure.

The canonical event effect is:

```json
{
  "kind": "knowledge.assignment",
  "assignment_id": "stable-assignment-id",
  "subject_id": "canonical-npc-entity-id",
  "item_id": "stable-knowledge-item-id",
  "source_kind": "author_initial",
  "source_ref": "world_pack:test.world@1.0.0",
  "source_version": "1.0.0",
  "authorization_ref": "external-authoring-decision-reference"
}
```

Assignments are written only through `POST /v1/worlds/:world_id/knowledge-assignments`, which requires both the normal API bearer and the separate `x-admin-token`. Generic event commits reject `knowledge.assignment`. The Core command also requires the expected world revision.

## Source rules

- A `world_pack:<id>@<version>` source must exactly match the world's pinned World Pack ID/version; `source_version` must equal that pinned version.
- An `event:<event_id>` source must be a prior valid event in the same world, `source_version` must equal its canonical `commit_sequence` string, and the assignment event must declare the source in both `caused_by` and `READS_SOURCE`.
- The subject must already exist as a non-destroyed canonical entity in that world.
- `assignment_id` is stable within a world. Exact idempotent replay returns the original result; reuse with different content conflicts. Historical identity reuse remains blocked even after rollback.
- The projection is rebuilt from valid Core events. Rollback's existing source-event dependency logic invalidates assignments that read an invalidated event. Separate assignment IDs are separate supports.

`authorization_ref` is an audit reference, not self-authenticating proof. The administrative credential is the trusted gate for this first author/import slice; a richer policy-decision contract remains a review item before broader authoring integrations.

## Projection and snapshot behavior

`SQLiteStore` maintains a derived `knowledge_assignments` projection and rebuilds it from valid event effects. The existing `(world_revision, commit_sequence)` cursor is reused; no parallel revision is introduced.

Internal `readSnapshot` can select `knowledgeSubjectIds` and returns assignments only for those requested canonical subject IDs, within the same SQLite read transaction and cursor as the other snapshot fields. This snapshot is still raw internal data. It is **not** actor-authorized or model-safe, and must not be passed to a model or Host/Adapter directly.

The admin-only `GET /v1/worlds/:world_id/knowledge-assignments` route is diagnostic inspection only. It is not the NPC read path.

`AuthorizedReadService.readKnowledgeAssignments()` is an internal actor-bound filter for the first acquisition slice. It requires an active adapter-to-actor binding, the `model` recipient, the `npc_decision` purpose, an exact expected snapshot cursor, and an explicitly configured trusted `knowledgePolicy`. With no policy, no assignment is disclosed. The output deliberately says `status: incomplete` and `coverage: initial_assignments_only`; an empty result must not be interpreted as known absence. The service is not yet connected to the serialized model-send path.

## Current evidence and remaining work

The focused test files `tests/knowledge-acquisition.test.js` and `tests/authorized-knowledge-read.test.js` cover:
- initial assignment creation, exact replay, and projection;
- conflicting assignment identity reuse;
- source-event rollback while preserving an independent World Pack support;
- subject-scoped snapshot reads at a shared cursor;
- rejection of generic untrusted event commits;
- actor-bound disclosure, default-deny policy, wrong-actor rejection, and stale-cursor rejection.

Required next steps:
1. Obtain exact-head CI results and fix failures.
2. Core/security review the identity, source and invalidation contract.
3. Implement a separate actor-authorized, purpose-bounded, same-snapshot read filter with explicit known/known-absent/unknown/withheld/incomplete/unsupported/invalid distinctions.
4. Add real-path tests for source invalidation, restart/rebuild, read purity, actor isolation, stale/mixed snapshots and no implicit world-to-knowledge copy.
5. Integrate only through the existing approved disclosure/dispatch boundary. No alternate egress path.

Until all governing gates pass, Memory → NPC remains `DISABLED / FAIL-CLOSED` and Host remains `NON_READY`.
