# Deployment mechanic policy runtime configuration

Status: implementation contract for the bounded Mechanics runtime. This document does not enable Mechanics by itself.

## 1. Source and composition

Set `ENGINE_MECHANIC_POLICY_CONFIG_PATH` to an absolute path to a deployment-controlled JSON file. The file is the single active policy configuration read by the deployment runtime.

At startup, `src/index.js` validates the file and constructs:
- one Core `ActorBindingService`;
- one `AuthorizedReadService` using the field policy derived from that same config source;
- one `DeploymentMechanicPolicyAuthority` using `CanonicalEntityAttributeContextProvider` and that exact AuthorizedReadService instance.

The same AuthorizedReadService and authority instances are passed into `createApiServer`. The mechanic evaluation resolver and ProposalService lifecycle validator both use the same authority reference. No Mechanics-owned policy database, policy writer, or alternate canonical commit path is introduced.

When the environment variable is absent, no authority is constructed. The mechanic proposal API returns `503 MECHANICS_DISABLED`; the proposal validator remains fail-closed.

## 2. Configuration shape

The file must contain exactly these fields:

```json
{
  "authority_id": "deployment-mechanics",
  "generation": 17,
  "policy_version": "npc-visibility-2026-10",
  "authorization_scope": "npc-decision",
  "adapter_id": "sillytavern",
  "actor_entity_id": "npc:kiryu",
  "recipient": "model",
  "purpose": "npc_decision",
  "bindings": [
    {
      "path": "actor.hp",
      "entity_id": "npc:kiryu",
      "attribute": "hp"
    },
    {
      "path": "world.weather",
      "entity_id": "world:kamurocho",
      "attribute": "weather"
    }
  ],
  "allowed_fields": [
    {
      "entity_id": "npc:kiryu",
      "attribute": "hp"
    },
    {
      "entity_id": "world:kamurocho",
      "attribute": "weather"
    }
  ]
}
```

The bounded mechanic runtime currently accepts only `recipient: "model"` and `purpose: "npc_decision"`. Other recipients/purposes are rejected until a separately reviewed contract defines their authorization and delivery semantics.

This config binds one adapter/actor principal. Multi-adapter or multi-actor policy selection is not implemented; do not multiplex principals through caller-supplied values.

Every context binding must be covered by an exact `allowed_fields` entry. Unknown fields, malformed values, duplicate paths/fields, or an uncovered binding reject the configuration. The configured adapter must also have an active Core actor binding to the configured actor in the target world.

The `policy_version` is a deployment-readable label. The effective provider fingerprint is computed from the complete validated config, including the authority identity/generation, principal, bindings, allowed fields, and the application-owned `MECHANIC_POLICY_RUNTIME_CONTRACT_VERSION`. Increment that code constant when the policy evaluation/visibility semantics change. The fingerprint is not accepted from a request or evaluation payload.

## 3. Rotation and rollback rules

For every effective policy change, deployment must increase `generation`. Do not reuse a generation for different policy content and do not roll back to an older generation. The runtime rejects a generation regression or a changed policy fingerprint under the same generation while the process is running.

The config file is reloaded at context-resolution and proposal-lifecycle validation boundaries. The same file-backed policy callback is used by AuthorizedReadService for each field read. A rotation during context resolution is rejected by the authority's post-resolution check; a rotation before proposal creation, approval, or commit rejects the stale evaluation/proposal. A new evaluation and a new idempotency key are required: an existing key remains bound to the original proposal content and cannot refresh it. Pending/approved idempotency retries revalidate policy and actor binding before returning the existing proposal.

Core actor bindings also carry a monotonic `binding_generation`, and bind/revoke audit entries record the resulting generation. Evaluation evidence pins that generation alongside adapter and actor identity. Revocation increments it; rebinding the same adapter to the same actor increments it again. Consequently, a proposal created before revoke/rebind remains stale even if the same binding is later restored.

**Anti-rollback limitation:** the runtime's observed-generation guard is process-local. This slice does not persist a monotonic generation ledger across process restarts. The deployment release/configuration system must therefore be the trusted monotonic generation owner and must prevent rollback across restarts and across instances. If the deployment cannot guarantee that, do not configure the authority; keep Mechanics disabled until a durable monotonic source is approved.

## 4. Proposal-only API

A configured adapter may call:

`POST /v1/worlds/{world_id}/mechanic-proposals`

Body:

```json
{
  "instance_id": "instance-id",
  "action_id": "action-id",
  "idempotency_key": "stable-key",
  "turn_id": "turn-id",
  "source_text": "Why this action is proposed"
}
```

The authenticated adapter identity comes from the configured adapter credential, not the body. Actor identity, recipient, purpose, bindings, and allowed fields come from the deployment policy config. The endpoint performs bounded read-only evaluation and, only for a ready result, creates a pending proposal through the existing ProposalService.

The route does not approve or commit. Approval continues to require the separate approval credential; commit continues through the existing proposal commit route and Core transaction. Unsupported or unknown evaluations return a conflict response and create no proposal.

## 5. Guarantees and non-guarantees

The runtime binds `authority_id`, `generation`, policy fingerprint, authorization scope, authenticated adapter, actor, recipient, purpose, world snapshot, and pinned mechanic snapshot into the evaluation/proposal evidence. The same authority instance validates proposal creation, approval, and commit.

This provides fail-closed revalidation at lifecycle boundaries. It does **not** provide linearizable revocation against a concurrent Core commit: the active policy config is external to the Core SQLite transaction. Do not claim that race is eliminated.

The executor remains limited to its existing deterministic supported slice. Modules, participant selection, interactions, non-empty action inputs, automatic conflict resolution, and other unsupported semantics remain rejected/unknown. Global mechanic dependency completeness remains unproven.
