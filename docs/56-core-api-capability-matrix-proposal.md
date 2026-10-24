# Core API capability matrix — decision proposal

Status: proposal for Core/deployment-owner approval. This document records the current route gates and proposes a capability split; it does **not** authorize changing route policy by itself.

## Terms

- **API bearer** — shared API admission credential only. It does not establish actor identity, source authorship, semantic authority, or approval.
- **Adapter credential** — server-configured adapter identity, established from the ID/token pair.
- **Internal host credential** — trusted orchestration capability; must not be passed to model-facing code.
- **Admin credential** — privileged canonical authoring/inspection/rollback capability.
- **Approval credential** — gates approval workflow but is not a named human identity.

Never accept a body field such as `actor`, `origin`, `producer`, `admin`, or `executor_type` as proof of any of these capabilities.

## Current route inventory

| Route / operation | Current gate on main | Current guarantee | Decision / proposed disposition |
|---|---|---|---|
| `GET /health` | No API bearer | Liveness only | Keep public; do not add world/config data |
| `POST /v1/worlds` | API bearer | Creates canonical world | **Decision needed.** Recommend admin or deployment-bootstrap capability; general API bearer alone is not a distinct world-creation authority |
| `GET /v1/worlds/:id/state` | API bearer + admin/internal gate | Raw trusted operational state; PR #114 makes world/entity/fact reads transaction-bound and returns `world_revision` + `commit_sequence`; PR #120 tests a concurrent WAL writer | Keep privileged-only; never treat as model-safe read |
| `GET /v1/worlds/:id/events`, `/audit` | API bearer + admin/internal gate | Raw canonical history/audit | Keep privileged-only |
| `POST /v1/worlds/:id/rollback` | API bearer + admin gate | Canonical rollback | Keep admin-only; do not condition on effect kind |
| `POST /v1/worlds/:id/relationship-transitions` | API bearer + admin gate | First-slice typed canonical Relationship write | Keep admin-only until a separate mutation-authority contract exists |
| `POST /v1/mechanic-templates`, `POST /v1/rule-modules` | API bearer + admin gate | Immutable versioned registry writes | Keep admin-only |
| `GET /v1/mechanic-templates[/:id/:version]`, `GET /v1/rule-modules[/:id/:version]` | API bearer | Registry metadata | **Decision needed.** Decide whether all authenticated adapters may inspect internal domain/mechanic configuration; recommend internal/admin until metadata classification is approved |
| `GET /v1/mechanics/audit` | API bearer | Registry audit metadata | **Decision needed.** Recommend admin/internal because audit is operational history |
| `POST /v1/worlds/:id/context-manifests` | API bearer + internal-host gate | Restricted manifest registration; does not prove a trusted generation used the manifest | Keep internal-only; still needs server-side generation binding |
| Proposal reads / commit | API bearer plus adapter ownership checks where applicable | Non-enumerating adapter scope; commit bound to creator | Keep creator-scoped; internal execution uses its separate gate |
| Authorized entity reads | API bearer + actor binding + trusted host field policy (default self-identity-only) | Bounded, atomic target set; each requested field must be allowed | Keep deny-by-default; no general relationship/fact/event read implied |
| Relationship field reads | No runtime route/service method | PR #123 is a design-only proposal for bounded directed-pair reads and a trusted per-field policy; no visibility policy is approved | Do not expose Relationship projection until the Relationship/World Pack visibility decisions and host policy are approved |

This table is a source audit and a proposed disposition, not a claim that every suggested gate is already implemented. The current route implementation and tests are authoritative for shipped behavior.

## Approval questions

The deployment/Core owner should explicitly decide:

1. Is world creation an admin/bootstrap-only operation, or is there a deployment model where an ordinary API client is allowed to create worlds?
2. Are mechanic/rule-module metadata and registry audit visible to every authenticated adapter, or restricted to internal/admin consumers?
3. Which exact credentials are available to each deployment component? A policy that assumes adapters cannot reach a route is not a substitute for route enforcement.
4. Who owns the approved capability matrix and its regression tests when routes are added?
5. Is the decision deployment-wide or per route/world? If per-world, the source of that policy must be trusted host configuration, not model/request data.

## Implementation gate

Do not change the unresolved routes until these decisions are recorded. After approval, implement one route family per PR with:
- ordinary API bearer allowed/denied cases;
- missing/wrong privileged credential cases;
- a trusted success case;
- no-mutation/no-disclosure assertions for denied requests;
- an exact-head Runtime CI link.

Keep this matrix synchronized with `docs/52-core-authorized-read-runtime-slice.md`, `docs/53-core-http-service-boundary-audit.md`, `docs/57-core-authorized-relationship-read-proposal.md`, and `docs/73-core-1.5-cross-block-integration-matrix.md`.
