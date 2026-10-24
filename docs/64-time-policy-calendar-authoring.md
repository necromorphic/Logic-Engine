# T6 — versioned calendar and TimePolicy authoring

## Configuration contract

A world can activate an immutable time configuration tied to its pinned `world_pack_id` and `world_pack_version`. Each configuration version contains:
- a declarative calendar definition accepted by the pure T1 calendar validator;
- a declarative TimePolicy with action/skip ceilings and duration rules;
- an immutable content hash and an activation audit record.

Registering a new configuration version increments `world_revision` and updates the active version pointer. It does not change the canonical time coordinate or rewrite past timestamps. Older versions remain readable and immutable. Reusing a version with different content is rejected.

The host/authoring adapter is responsible for loading the intended World Pack content and submitting it through the trusted Core boundary; this slice does not create a World Pack registry or execute calendar code.

## Duration decisions

A TimePolicy can define per-event-type:
- `fixed`: a single duration in milliseconds;
- `range`: deterministic midpoint selection or an explicit `needs_author` result;
- `category_map`: a proposal can select only a predeclared category and duration.

When a configuration is active, Core resolves action duration from the policy. A caller-supplied duration that differs from the resolved duration is rejected. Missing rules permit zero-duration events only; nonzero arbitrary durations are rejected. Ambiguous ranges do not silently select a value.

Explicit skip remains a separate intent and is bounded by the active policy's `max_skip_duration_ms`. Current event commit APIs still require whole-second durations; a policy that resolves a sub-second action duration fails closed until a millisecond-duration commit contract is added.

The active configuration version is included in duration-decision metadata and audit. If the configuration changes between resolution and commit, Core rejects the stale decision.

## API

- `POST /v1/worlds/:id/time-configurations` — admin-only registration/activation.
- `GET /v1/worlds/:id/time-configurations/current` — trusted read of the active or requested version.
- `GET /v1/worlds/:id/time` — trusted calendar projection of the current coordinate or an explicitly supplied coordinate.

The API requires the general bearer token in addition to the separate admin/internal credential.

## Current limits

- TimePolicy limits cannot exceed the existing seven-day per-event safety ceiling.
- The active TimePolicy is per-world and pinned to the world's World Pack ID/version, but this slice does not fetch or parse World Pack files itself.
- Calendar configuration changes alter future projections only; they never mutate the canonical coordinate.
- Author-required duration decisions use the existing proposal approval boundary: a proposal may suggest `duration_proposal: { duration_ms }`, Core reports `time_policy.status = needs_author` at proposal creation, and the separate approval credential can approve only a candidate within the configured range. Approval revalidates against the current world revision and active configuration, records the resolved decision in audit, and commit rechecks the same version. Direct event commits cannot assert author approval.
- NPC knowledge, player delivery, and persistent trigger registration remain separate systems.
