# Core authorized-read runtime slice

Status: merged into `main` through PR #65. This document records the deliberately narrow runtime boundary and the remaining integration blockers; it is not a general Memory/NPC visibility policy.

## 1. What this slice enforces

- The internal AuthorizedReadService resolves the requested actor through the canonical ActorBindingService before reading.
- Reads use LogicEngine.getSnapshot with a bounded explicit entity-ID set and preserve the snapshot's world_revision and commit_sequence.
- A trusted application-owned field policy must explicitly allow each disclosed field. Missing, throwing, or non-boolean-true decisions deny that field.
- Missing targets and targets from which no field can be disclosed share the same READ_NOT_AVAILABLE result.
- By default, the API route POST /v1/worlds/:world_id/authorized-read authenticates a configured adapter, then permits only the bound actor's own entity_id, entity_type, and status. Arbitrary attributes and non-self targets remain withheld unless a trusted host explicitly supplies a field policy; see the PR #101 addendum below.
- Raw canonical GET .../state, GET .../events, and GET .../audit routes require the distinct internal or administrative credential. The general API bearer token alone is not sufficient.
- Adapter proposal reads are scoped to the adapter that created the proposal. A separately configured admin credential may read any proposal.
- Reads are read-only and do not advance canonical revision, event cursor, event history, or audit.

## 2. Deliberate limits

This is a safe first slice, not the completed knowledge/visibility subsystem.

- The default API read route exposes the bound actor's own identity metadata only. PR #101 adds an opt-in trusted host field-policy hook and bounded `entity_ids`; without an explicitly supplied trusted policy, other-entity fields remain withheld. This is an integration seam, not an approved visibility schema or a default public policy.
- No default public visibility is inferred from missing metadata.
- The service's injected field-policy callback is trusted application configuration. It must never be created from model output or request-body fields.
- The existing character-card projector remains a pure projector over a supplied snapshot; it does not become an authorization mechanism by being called.
- Direct in-process calls to LogicEngine.getSnapshot, getState, getEvents, and getAudit remain trusted internal APIs. Any caller that serializes those results to a model, player, or adapter must pass through an authorized boundary first.
- The raw read routes are protected at the HTTP boundary, but this does not prove every host integration or downstream serializer uses the new service.

## 3. Why the boundary is narrow

The current canonical entity model has a generic attributes bag and no approved field-level visibility schema. Treating arbitrary attributes as public would risk disclosing secrets; inventing visibility defaults would turn missing policy into access. The safe default is therefore to withhold all attributes until a typed, trusted visibility contract is implemented.

## 4. Required follow-up before declaring authorized reads complete

1. Define a trusted field-visibility/sensitivity schema and its owner (Core enforcement; domain/World Pack supplies allowed semantic fields and values).
2. Define safe query-result states for known, unset, withheld, incomplete/unsupported, and conflict where applicable; do not collapse these into one unknown.
3. Add authorized multi-entity reads only after the visibility schema and recipient/purpose policy are explicit.
4. Inventory every route and in-process integration that can serialize state, events, facts, proposals, mechanic state, or card projections; test that no path bypasses the policy.
5. Add end-to-end tests for NPC, narrator/model, player, and host-adapter consumers, including rollback/concurrent-write freshness.
6. Run and verify the full repository test suite on the final PR head.

## 5. Acceptance tests in this slice

- An unbound adapter cannot resolve the actor for a read.
- A caller cannot substitute another actor's identity.
- Attribute values do not appear even if the caller requests their field names.
- Missing and withheld targets use the same external error shape.
- Raw state/events/audit routes reject the general API bearer token without a separate internal/admin credential.
- One adapter cannot retrieve another adapter's proposal payload.
- Authorized reads preserve the composite snapshot cursor and do not write canonical state or audit.


## Current-main policy hook (PR #101)

`createApiServer` accepts optional `authorizedReadFieldPolicy`, a trusted application callback that must be supplied by host configuration, never by request/model input. If omitted, the default remains self-identity-only. The authorized-read request may specify a bounded `entity_ids` list; every field for every target must pass the configured policy, and a missing or fully withheld target fails atomically with the same unavailable shape. Exact-head Runtime CI passed on PR #101 head `4eda3de05b18cf48c6bd642b75546a91ad9d16bc` ([run #737](https://github.com/necromorphic/Logic-Engine/actions/runs/40065061229)). No default visibility schema, Memory retrieval adapter, or source-change feed is introduced.