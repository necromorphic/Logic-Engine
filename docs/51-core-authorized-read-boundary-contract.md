# Core authorized read-boundary contract

Status: **Core design proposal; not a runtime authorization implementation**.

Scope: define the smallest safe internal read boundary that can be used by NPC decisions, narrator/context assembly, and character-card projections without treating a consistent snapshot or actor binding as permission to disclose its contents. This document does not add a public endpoint, access-control database, or policy language.

Related contracts:
- `docs/30-character-card-read-projection-stage1.md` — bounded snapshot and pure projection contract.
- `docs/21-stage1-causality-contract.md` — snapshot and tri-state primitives versus missing authorization.
- `docs/28-proposal-api-stage1.md` — current authentication and proposal lifecycle.
- `src/application/actor-bindings.js` — actor identity resolution only.
- `src/application/character-card-projection.js` — minimal projection from an already supplied snapshot.
- `tests/snapshot-read.test.js` — current bounded snapshot consistency tests.
- `tests/actor-binding.test.js` — current authenticated adapter-to-actor binding tests.

## 1. Problem and existing primitives

The runtime already has two useful but narrower primitives:

- `LogicEngine.getSnapshot(worldId, request)` provides bounded, world-scoped rows and a composite `world_revision` / `commit_sequence` marker from one consistent read view. Its tests cover read-only behavior, cross-world isolation, concurrent commits, and rollback-only revision changes.
- `ActorBindingService.resolve(worldId, adapterId, entityId)` proves that an authenticated configured adapter is bound to an eligible canonical actor in a particular world. Its code explicitly does not authorize knowledge reads, action semantics, approval, or commit.
- `projectCharacterCard(snapshot, entityId, options)` is a pure minimal projection. It omits arbitrary attributes/facts and explicitly does not establish player access.

None of these primitives by itself decides which facts, events, attributes, beliefs, secrets, or profile fields a given actor or recipient may receive for a particular purpose. A snapshot is consistency, actor binding is identity resolution, and projection is formatting; none is disclosure authorization.

## 2. Required internal boundary

Before canonical records are serialized into a prompt, character card, NPC decision context, player response, or adapter payload, Core must apply a single internal authorization/filter boundary.

Conceptual contract (names illustrative, not an approved public API):

```text
readAuthorized(
  trustedRequesterContext,
  worldId,
  targetSelector,
  purpose,
  requestedFieldSet
) -> AuthorizedReadResult
```

The function/service must:
1. accept a server-created requester context, not a caller-supplied actor or role string;
2. validate world scope and resolve any in-world actor using the trusted binding service where an actor identity is required;
3. obtain one bounded consistent snapshot for the exact requested target/source records;
4. evaluate the read policy for the authenticated requester, optional in-world actor, purpose, target, field/record sensitivity, and current world state;
5. filter records and fields **before** returning the result to any model, player, or adapter;
6. return explicit internal result states for supported, unset, withheld, incomplete, conflicted, and unsupported outcomes where those distinctions are meaningful;
7. preserve the snapshot marker with the authorized result so downstream code cannot unknowingly combine different revisions;
8. fail closed on unknown policy, unsupported record type, missing policy metadata, or snapshot failure.

The public API and exact type/schema are deliberately not prescribed here. The first implementation should be an internal application service, not a new route.

## 3. Separate the identities and the purpose

The read request must not collapse these dimensions:

- **Authenticated requester:** the adapter/service or future named principal proven by server-side authentication.
- **In-world actor:** the canonical entity on whose behalf a decision is made, if applicable. It is resolved from a trusted adapter binding; it is not the same as the authenticated requester.
- **Recipient:** who will actually receive the serialized result (for example an NPC decision model, narrator, player-facing response, or trusted internal diagnostic). A read that is safe for an internal service is not automatically safe for a model or player.
- **Purpose:** the declared operation for which data is being read (for example NPC decision context, narrative presentation, character-card projection, or internal validation). Purpose selects a policy; it does not grant permission by itself.
- **Target and fields:** the exact world/entity/record and field set requested. Broad “give me the whole world” reads are not an authorized substitute for bounded queries.

Purpose values should be a small Core-controlled enum or capability set. World Packs may provide domain semantics and visibility labels, but must not override Core's universal fail-closed and non-disclosure guarantees. An unrecognized purpose must be rejected, not treated as a generic trusted read.

## 4. Policy ownership and fail-closed behavior

Core owns the enforcement point, trusted requester context, world isolation, snapshot consistency, filtering order, safe result encoding, and audit/diagnostic boundaries.

The domain/World Pack may define:
- record and field categories;
- domain-specific visibility labels and intended audience;
- which data is appropriate for a particular supported domain purpose;
- typed mappings from canonical data to a requested projection.

The World Pack may not:
- grant access based only on model-produced text or a caller-provided actor ID;
- bypass world scope or snapshot consistency;
- treat a vector/search hit, narrative claim, or card text as canonical truth;
- force disclosure of a field marked secret/inaccessible by Core policy;
- convert missing policy metadata into public visibility.

Where a record has no trustworthy visibility classification or no policy exists for the requested purpose, omit/withhold it. Do not assume “not marked secret” means “public” unless a separately approved default explicitly establishes that behavior for that record class.

## 5. Result semantics: do not collapse distinct states

The internal read contract must preserve the distinctions below where applicable:

- **known:** a permitted, supported value is present in the selected snapshot;
- **unset:** the requested canonical value is not established in the selected snapshot;
- **withheld:** the value or even its existence is not disclosable to this requester/recipient;
- **incomplete:** the query could not safely determine the complete requested result;
- **conflicted / insufficient support:** the supported canonical reducer or domain contract reports unresolved incompatible or insufficient support;
- **unsupported:** the runtime does not implement the requested record/query/purpose or cannot provide the required guarantee.

These are semantic states, not necessarily the exact public enum strings. “Unset” and “withheld” must not be interchangeable inside Core because downstream policy may need to distinguish them. However, **an untrusted recipient must not be able to distinguish a real withheld record from a nonexistent record merely by observing response shape, error text, counts, timing-dependent branches, or metadata**. At a disclosure boundary, normalize both to the same externally safe response where revealing existence is unauthorized.

A known neutral/false/empty value is still a known value when the canonical contract says so. It must not be confused with unset. A conflict result is not unset and must not be resolved by selecting the last claim unless the approved domain rule explicitly defines that reducer.

## 6. Pipeline ordering and prohibited shortcuts

Required order:

1. Authenticate the service/requester.
2. Establish trusted requester context and, when needed, resolve the in-world actor.
3. Validate world, purpose, target selector, and requested field set.
4. Obtain one consistent bounded snapshot.
5. Apply visibility/sensitivity and purpose policy to the snapshot records.
6. Construct the minimal typed result from only authorized records/fields.
7. Serialize for the specified recipient.
8. Attach the snapshot marker and permitted source references; avoid sensitive audit details in recipient-facing output.

Prohibited:
- pass raw `getState()` or unrestricted `getSnapshot()` output directly to a model/player/adapter;
- assume the pure character-card projector authorizes data because it returns a small object;
- assume a resolved actor may read all world facts;
- use arbitrary entity attributes as public profile fields;
- filter secrets after prompt construction or after a model has already seen them;
- let vector retrieval bypass the canonical access filter; retrieval hits must be revalidated against current structured policy before serialization;
- merge data from multiple snapshots without explicitly handling revision mismatch;
- turn authorization errors into an empty result that silently means “the fact does not exist.”

## 7. Initial implementation boundary

The first implementation should be deliberately narrow:
- internal-only service; no new HTTP endpoint;
- one world and a bounded explicit target set;
- only record/field types with an explicit mapping and an explicit default visibility/purpose policy;
- actor-relative reads only when a trusted actor binding exists;
- character-card projection remains a pure downstream formatter over the already authorized result;
- no new knowledge/belief store, secret-label schema, generic RBAC framework, or vector-index mutation is introduced as a side effect.

If the current canonical record types do not carry sufficient sensitivity/visibility metadata, the service must not invent it from prose or names. It may safely expose only the already-approved minimal allowlisted fields and must report the rest as unsupported/withheld at the trusted internal boundary. Expanding disclosure requires a separate typed field-policy decision.

## 8. Acceptance tests required before integration

### Authentication and identity
- A request with a caller-supplied `actor_id` but no trusted binding cannot read actor-relative data.
- Adapter A bound to actor A cannot impersonate actor B by changing a body field.
- Revoked bindings stop authorizing subsequent reads.
- A valid actor binding does not grant access to all world records.
- An internal/admin credential is not automatically a general model-readable context.

### Scope and consistency
- Same identifier in another world never satisfies the requested target.
- The returned records and composite snapshot marker belong to the same read view under a concurrent commit.
- A rollback that advances world revision without a new event is reflected in the marker.
- Snapshot failure returns no partial authorized result.
- A read is read-only and does not change revision, commit sequence, event count, audit, or idempotency state.

### Disclosure and result states
- A secret/inaccessible field is filtered before serialization to the model/player/adapter.
- A caller cannot infer the existence of a withheld record through returned IDs, counts, error distinctions, or a different field shape.
- Missing visibility policy fails closed for the affected field/record class.
- Known, unset, withheld, incomplete, conflict/insufficient-support, and unsupported states are not collapsed internally.
- Unknown purpose and unsupported record types fail closed.
- A known explicit neutral/false/empty value is not reported as unset.
- A conflicted value is not silently selected or represented as a known value.

### Composition and regression
- Character-card projection receives only an authorized bounded result and remains pure/read-only.
- Vector/search results are revalidated against current policy before they can enter a prompt.
- No raw snapshot or unrestricted entity attribute bag reaches a model-facing serializer.
- Existing proposal, actor-binding, and snapshot tests remain green on the exact combined commit.

## 9. Open implementation decisions

1. What internal trusted requester-context type should be passed between API/service layers without exposing credential material?
2. Which current record/field types have sufficient typed metadata for the first allowlisted read slice?
3. Which default visibility policy applies to each supported field class? Missing policy must remain fail-closed until this is decided.
4. Should a recipient-facing withheld result be normalized to not-found, omitted, or a common inaccessible marker for each purpose? The answer must not leak existence.
5. How will the service audit denied access without writing sensitive values or leaking the existence of withheld records to the requester?
6. How should actor-relative reads be represented for non-character recipients such as a narrator or player, where there is no single in-world actor?

These decisions are explicit blockers for a runtime read service. This contract closes the architecture boundary and acceptance criteria; it does not claim that actor-authorized reads are implemented.
