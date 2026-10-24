# API capability matrix (Issue #194)

**Status:** decision proposal plus current-main evidence. This document does not change route behavior. Credential policy must be approved before changing the current route gates.

## Trust model proposal

1. `ENGINE_API_TOKEN` is a gateway/service-ingress credential, not an adapter credential. It is mandatory for every non-`/health` route and must never be disclosed to an LLM, plugin, or less-trusted adapter.
2. Configured adapter identity (`x-adapter-id` + matching `x-adapter-token`) grants only adapter-scoped operations and ownership of that adapter's proposals/actor bindings. It is not a general world/admin capability.
3. `ENGINE_ADMIN_TOKEN` grants administrative registry writes, mechanic instance lifecycle, actor-binding management, canonical rollback and Relationship transitions. It does not imply internal-host or approval authority.
4. `ENGINE_INTERNAL_TOKEN` grants internal host/time orchestration, raw canonical reads, context-manifest registration and the internal approved-proposal commit route. It does not imply admin or approval authority.
5. `ENGINE_APPROVAL_TOKEN` grants proposal approval only. It is not a general write/admin credential.
6. **Recommended least-privilege target (not current behavior):** make world creation admin-only and protect global registry metadata/audit with admin or an explicit read-only registry capability. If the deployment intentionally wants general-bearer holders to create worlds and read registry metadata, record that as an explicit accepted risk and only issue that bearer to an equally trusted gateway.
7. Remote binding must remain disabled unless explicitly enabled; when enabled, deployment must enforce TLS, trusted reverse-proxy boundaries, rate limits, secret rotation and log redaction. The application currently gates remote bind via `ENGINE_ALLOW_REMOTE=true` and binds localhost by default.

## Current-main route matrix

All rows below except `GET /health` also require the general `Authorization: Bearer ...` token. A capability header alone never bypasses that outer gate.

| Route / operation | Current required capability after bearer gate | Current-main observation |
|---|---|---|
| `GET /health` | none | Public liveness response |
| `POST /v1/worlds` | general bearer only | **Policy gap under least privilege:** no admin check |
| `GET /v1/mechanics/audit` | general bearer only | Global mechanic registry audit readable |
| `GET /v1/mechanic-templates`, `GET /v1/mechanic-templates/:id/:version` | general bearer only | Registry metadata read |
| `GET /v1/rule-modules`, `GET /v1/rule-modules/:id/:version` | general bearer only | Registry metadata read |
| `POST /v1/mechanic-templates`, `POST /v1/rule-modules` | admin | Registry writes |
| `GET /v1/worlds/:id/state`, `events`, `audit` | admin or internal | Raw canonical reads |
| `POST /v1/worlds/:id/events` | internal + approved proposal ID | Direct commit restricted to internal host |
| `POST /v1/worlds/:id/proposals`; adapter GET/cancel/commit | configured adapter identity; owner scope | Adapter proposal lifecycle; admin can read proposal |
| `POST /v1/worlds/:id/proposals/:id/approve` | approval | Separate approval credential |
| `POST /v1/worlds/:id/context-manifests` | internal | Host assertion about prepared generation context |
| `POST /v1/worlds/:id/time-triggers` and GET/list/get/cancel | internal | Trigger lifecycle |
| `POST /v1/worlds/:id/time-advances`, `time-actions`; GET/status/resume | internal | Time orchestration lifecycle |
| `POST /v1/worlds/:id/time-configurations` | admin | Time configuration authoring |
| `GET /v1/worlds/:id/time-configurations/current`, `GET /v1/worlds/:id/time` | admin or internal | Trusted time/calendar reads |
| `POST /v1/worlds/:id/authorized-read` | configured adapter identity | Actor-authorized read; default field policy is self identity fields only |
| `POST /v1/worlds/:id/actor-bindings`, `DELETE /v1/worlds/:id/actor-bindings/:adapter/:entity` | admin | Bind/revoke actor mapping |
| `POST /v1/worlds/:id/actor-bindings/resolve` | configured adapter identity | Resolve only adapter's binding |
| `GET/POST /v1/worlds/:id/mechanic-instances`; enable/disable | admin | Mechanic instance and lifecycle management |
| `POST /v1/worlds/:id/relationship-transitions` | admin | Canonical typed Relationship transition |
| `POST /v1/worlds/:id/rollback` | admin | Canonical rollback/correction |

## Credential matrix

| Credential | Grants | Does not grant |
|---|---|---|
| General API bearer | Outer HTTP authentication; currently world creation and global registry metadata/audit reads | Does not substitute for admin/internal/approval/adapter-specific gates |
| Configured adapter identity | Adapter-authorized read, actor resolution, own proposal create/read/cancel/commit | Does not create worlds, write registry, operate mechanics/time, approve proposals or bypass bearer |
| Admin credential | Registry writes, mechanic lifecycle, actor-binding management, canonical rollback, Relationship transitions; trusted raw/time reads | Does not replace bearer or grant internal/approval/adapter identity |
| Internal host credential | Time triggers/advance/actions, context manifests, raw canonical reads, internal commit of approved proposals; trusted time reads | Does not replace bearer or grant admin/approval |
| Approval credential | Approve proposals | Does not replace bearer or grant proposal creation, commit, registry, admin or internal operations |

## Risk statement

If the general bearer is shared with less-trusted adapters, every such holder inherits all routes that require only that bearer: world creation and global mechanic registry metadata/audit reads. The adapter-specific gate does not constrain those endpoints because they do not consult adapter identity. An adapter cannot use its adapter token alone to reach the API, but if it also receives the shared bearer the adapter boundary is ineffective for these operations. This is a trust-model risk, not proof of an exploitable remote vulnerability in a deployment where the bearer is held only by a trusted local gateway.

## Test evidence and limitations

`tests/api.test.js` already exercises internal-only time routes, adapter-scoped proposal ownership, approval credential separation, raw read denial, and admin-only time/mechanic writes. `tests/api-capability-matrix.test.js` adds explicit current-behavior tests for:
- public health vs mandatory general bearer;
- current general-bearer world creation and registry metadata/audit access (explicitly tagged as policy gap, not endorsement);
- admin registry-write separation;
- adapter identity fail-closed behavior;
- internal, approval and admin credential non-substitution.

These tests document the current contract and fail-closed boundaries; they do **not** authorize production or implement the proposed least-privilege changes. Test against exact branch head and CI before treating the test evidence as verified.

## Decision required

Core/runtime owner should explicitly choose one:
- **A — least privilege (recommended):** admin-only world creation; admin or explicit registry-read capability for global metadata/audit; general bearer restricted to trusted gateway; adapter secrets only delivered to adapters.
- **B — trusted gateway model:** preserve current world-creation and registry-read gates, but document and enforce that the general bearer is exclusively held by a trusted gateway and never by adapters or model-facing components.

Do not change route behavior until this decision is recorded.