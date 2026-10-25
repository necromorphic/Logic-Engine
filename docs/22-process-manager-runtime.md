# Process Manager runtime slice — operator contract

Status: **implemented in the draft vertical slice; not production-approved**.

Implementation: [PR #248](https://github.com/necromorphic/Logic-Engine/pull/248). The process lifecycle is a durable domain layer over the existing Core time-trigger and segment pipeline. It is not a second scheduler or canonical writer.

## Internal API

All routes below require a valid bearer API token and the separately configured x-engine-internal-token. Process lifecycle routes are not public model-facing endpoints.

### Create a process

POST /v1/worlds/{world_id}/processes

Required fields:
- process_id: stable identity unique within the world;
- definition_version: author-defined version string;
- expected_revision: current canonical world revision;
- idempotency_key: stable retry key;
- milestones: 1–500 milestone definitions.

Optional: title, JSON-serializable metadata.

Example request:

    {
      "process_id": "courier-route-1",
      "definition_version": "1",
      "expected_revision": 12,
      "idempotency_key": "create-courier-route-1",
      "milestones": [
        {
          "milestone_id": "depart",
          "trigger_id": "courier-route-depart",
          "due_coordinate": 1000,
          "prerequisites": [],
          "read_set": [],
          "write_set": [],
          "event": {
            "turn_id": "courier-route-depart-event",
            "event_type": "process.courier.depart",
            "effects": []
          }
        },
        {
          "milestone_id": "arrive",
          "trigger_id": "courier-route-arrive",
          "due_coordinate": 2000,
          "prerequisites": ["depart"],
          "read_set": [],
          "write_set": [],
          "event": {
            "turn_id": "courier-route-arrive-event",
            "event_type": "process.courier.arrive",
            "effects": []
          }
        }
      ]
    }

Each milestone becomes a registered time trigger. prerequisites refer to milestone IDs; Core maps them to trigger IDs. The existing scheduler decides due order and same-coordinate conflict boundaries. Coordinates must be safe integers, whole-second trigger execution is currently required, and new triggers must be strictly in the future. Event proposals are validated by Core when due; this API does not bypass event validation.

### Read and list

- GET /v1/worlds/{world_id}/processes
- GET /v1/worlds/{world_id}/processes/{process_id}

Responses expose process identity/version/state, progress counts, milestone states, supporting event IDs, and any review error. They do not include NPC knowledge, reports, or player-delivery records.

### Pause, resume, cancel

- POST /v1/worlds/{world_id}/processes/{process_id}/pause
- POST /v1/worlds/{world_id}/processes/{process_id}/resume
- POST /v1/worlds/{world_id}/processes/{process_id}/cancel

Body:

    {
      "expected_version": 3,
      "idempotency_key": "pause-courier-route-1",
      "reason": "author_pause"
    }

reason is optional. Lifecycle commands require an expected process checkpoint version and an idempotency key. Reusing a key with different request content conflicts.

- **Pause** cancels pending trigger records while retaining pending milestone definitions.
- **Resume** creates fresh trigger IDs for pending milestones. It is rejected if a pending milestone's due coordinate is already at or behind current game time (PROCESS_RESUME_REQUIRES_REPLAN). The caller must not silently move a milestone's due time.
- **Cancel** cancels pending triggers and marks pending milestones cancelled. Completed milestones remain in audit/provenance history.
- A process-owned trigger cannot be cancelled through the generic trigger-cancel route.

## Atomicity and recovery

When a registered process milestone trigger is committed, its canonical event(s), trigger completion, process milestone status, supporting event ID, process status/version, time-advance segment checkpoint, and operation result are written inside the existing Core segment transaction. An injected failure at the process-checkpoint step rolls the segment back.

Time advancement still uses the existing internal route:

POST /v1/worlds/{world_id}/time-advances

with idempotency_key, expected_revision, and to_coordinate. No wall-clock scheduler or downtime catch-up is introduced. After SQLite close/reopen, process and milestone records are read from durable storage.

## Rollback boundary

If rollback invalidates a canonical event that directly supports a completed process milestone, the affected milestone and process are moved to needs_review in the rollback transaction. Resume is blocked until reconciliation.

This is intentionally conservative. Full causal closure, recomputation, and proof that unrelated process progress remains independent are **not implemented**. Do not describe rollback integration as complete or infer that a later milestone survives solely because its timestamp is later.

## Non-implications

- Process completion does not grant NPC knowledge, alter beliefs, create a report, deliver information, or notify the player.
- The process definition is data, not executable code; arbitrary scripts and a generic process DSL are out of scope.
- A passing Runtime suite is not production authorization. PR #248 remains Draft until Time's scheduler/milestone review and the remaining rollback acceptance are resolved.
