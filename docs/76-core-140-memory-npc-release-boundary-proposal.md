# Core 1.9 — Memory→NPC release-boundary proposal

**Status:** proposal for explicit cross-owner approval; not an approved runtime contract.
**Date:** 2026-10-25
**Issue:** https://github.com/necromorphic/Logic-Engine/issues/140
**Scope:** Core-owned decision and release gate only. No runtime wiring or API/schema change is authorized by this document.

## Decision requested

Approve or reject the ownership split and minimum release contract below before implementation. Until approval and executable real-path evidence exist, production Memory→NPC remains **DISABLED / FAIL-CLOSED**.


## 0. Core decisions already taken (not pending owner vote)

These are operational Core dispositions under the current approved contracts; they do not require guessing missing Provider or Host authority:

| Topic | Core decision now | Operational consequence |
|---|---|---|
| Durable raw Host text | **NOT APPROVED** under current contract | Do not persist or transfer raw Host message text through the lifecycle journal/Provider/Core path. A separate explicit retention/purpose/access/deletion contract is required to change this. |
| Host-originated source operations | **UNSUPPORTED / NON_READY for production Memory→NPC** | Create/edit/swipe/delete hooks in the reviewed prototype may be useful local evidence, but none establishes authoritative source version/lineage or complete active+historical+deleted inventory. Chat switch/reload is not deletion. No candidate from these operations may be admitted as authoritative today. |
| Trusted world/session/recipient/actor | **Resolve from authenticated server-side context and existing Core actor-binding seam only** | Caller/body labels, prompt text, manifest membership and Host-generated IDs cannot choose the actor or recipient. A world/session binding must be proven by the real Host adapter; until then the request is non-ready. |
| Read purpose | **No general-purpose Memory disclosure** | The proposed first slice is restricted to `npc_decision` only if owners approve that purpose and the exact field policy. No current production read is enabled merely by this proposal. |
| Canonical Core fields | **Existing AuthorizedReadService only, under explicit field policy** | Authorization of canonical fields does not confer authority on a Host Memory record that references those fields. No arbitrary field expansion or raw Memory summary. |
| Failure behavior | **FAIL-CLOSED** | Deny, stale, revoked, deleted, incomplete, unsupported, timeout or unavailable source/access validation means no protected bytes are released; no content/snippet/source ID/count/diagnostic side-channel. |
| Release path | **No production seam verified in Core main** | Do not add a fake sender or wire a new API/schema. Host must name the real pinned final model-request hook; cross-owner release contract must be approved before runtime wiring. |

These Core dispositions are decisions, not claims that Host/Provider capabilities have been implemented or verified end-to-end. The remaining cross-owner questions are listed in §7.


## 1. Source-inspected path and exact release boundary

1. `MemoryNpcConsumer.retrieveForNpc()` in `src/application/memory-npc-consumer.js` retrieves candidates from injected Memory functions, checks Provider authorization twice, binds the actor through Core, reads selected canonical fields through `AuthorizedReadService`, compares the Core snapshot cursor, and invokes the NPC admission helper.
2. The consumer is an internal seam and is not wired into the public API or a production response pipeline.
3. `AuthorizedReadService.readEntityFields()` is an internal read boundary. It rechecks actor binding and canonical snapshot after field-policy callbacks. This is a bounded in-process freshness check, not atomic revocation across Core, Provider, Host, and a model request.
4. `src/api/server.js` exposes the authorized-read HTTP endpoint and other Core API routes. Its `send(res, status, data)` serializes HTTP API responses; it is not the NPC/model outbound generation sender. No route invokes `MemoryNpcConsumer`.
5. No verified production serializer/send path from admitted Memory context to the model adapter was found in Core main. The final model-request serialization and delivery boundary is outside the current Core runtime / not yet identified in the repository. For the existing SillyTavern integration, Host/Adapter must identify the exact hook and owner in its pinned implementation; Core must not claim ownership of that external send operation.

This is a source-inspection result, not an end-to-end runtime observation.

## 2. Proposed ownership split (approval required)

- **Host/Adapter owner:** identify and own the real final model-request assembly/serialization/send hook in the pinned SillyTavern implementation. It must not append Memory candidates directly from local journal/index state. It must call the approved Core release gate immediately before disclosure and suppress the addition on any non-ready/error/timeout result.
- **Core owner:** own recipient/actor binding, purpose enforcement, field allowlist enforcement, canonical source re-read, and the final decision whether a prepared context may be disclosed under the approved source contract. Core may use existing `ActorBindingService` and `AuthorizedReadService`; no new route/schema is implied here.
- **Memory Provider owner:** own record access authorization and authoritative source-specific identity/version/lineage, complete active+historical+deleted inventory or an approved equivalent, retraction/rollback semantics, and currentness checks. Provider index counts and a successful query are not authority.
- **NPC owner:** consume only the safe, authorized envelope. It does not authorize sources, infer missing provenance, widen fields, or send content.
- **Decision needed from Core + Memory + Host:** whether any source class can be admitted before Provider proves source-specific currentness. Proposed default: no Host-originated Memory source is currently supported for production admission. Canonical entity fields can be read only through existing Core authorized-read policy; that does not independently validate a Host Memory record that references them.

## 3. Retention and source-operation disposition

### Host raw-text retention

Raw Host message text is **not approved** for durable storage by the lifecycle journal or for transfer to Provider/Core under the current contract. The existing journal remains digest/identity/lineage-only. Silence, a local digest, or a passing patch test must not be interpreted as retention consent. Any future content retention/transfer requires a separate owner-approved purpose, access, retention period, deletion/retraction, and lifecycle contract.

### Pinned Host patch operation matrix

The reviewed patch is the opt-in prototype on pinned SillyTavern target `1.19.0-1-g06bde939f`, commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. These are covered hooks, not a declaration that resulting records are authoritative:

| Source operation | Patch evidence / limit | Core disposition for production Memory→NPC |
|---|---|---|
| Message creation/save via `saveReply` | Prototype hook covered; durable browser/device persistence and complete inventory not proven by fixture tests | **Unsupported / NON_READY** as authoritative source version |
| Message edit | Prototype hook covered; external edits and complete version lineage not proven | **Unsupported / NON_READY** |
| Swipe selection | Selection hook covered; selection is not content-version/provenance authority | **Unsupported / NON_READY** |
| Swipe deletion | Prototype observes pre-mutation path; does not prove all deleted historical versions are inventoried | **Unsupported / NON_READY** |
| Message deletion | Prototype observes pre-mutation path; not proof of complete deletion/retraction across all storage paths | **Unsupported / NON_READY** |
| Chat switch/reload | `clearChat({clearData:true})` is also used for switch/reload; cannot be treated as deletion | **Not a deletion signal** |
| Character/group chat file deletion, recursive deletion, import/restore, branch, group metadata migration, external edits | Not covered/proven by reviewed patch evidence | **Unsupported / NON_READY** |
| Provider index/query results | Provider-owned data; counts and successful query do not prove complete source inventory/currentness | **Not source authority** |
| Canonical Core entity fields | Existing authorized-read seam can authorize exact configured fields against a Core snapshot and actor binding | **Supported only for that read**; does not make an associated Host record authoritative |

## 4. Smallest proposed release contract

This is a proposal, not a new runtime API definition. Owners must approve its semantics before a concrete signature or schema is introduced.

At the actual Host final model-request boundary:

1. Host identifies authenticated adapter and exact world/session/recipient/actor binding using trusted server-side state. Request-body labels, prompt text, manifest membership, and Host-generated IDs cannot establish authority.
2. Core obtains a bounded prepared context through existing consumer/read seams. The only permissible purpose for this first slice is `npc_decision`; exact canonical fields must be named in trusted configuration. No raw Host text or Memory summary is included by default.
3. Immediately before serialization/send, the release gate revalidates approved source-specific currentness and access. For every candidate, Provider record access and Core field access must still be allowed; source identity/version/lineage must match approved authority. If either authority cannot prove currentness, release is suppressed.
4. On deny, stale, revoked, deleted, incomplete, unsupported, timeout, or unavailable revalidation, Host sends no protected Memory-derived bytes. It must not expose snippets, record counts, source IDs, denial reasons, or diagnostics through the model request or recipient-visible side channel.
5. The gate returns only allow/withhold and the approved safe envelope; internal reasons stay in access-controlled diagnostics and must not contain protected content. Whether this should be a synchronous Core call or an alternative must be decided before implementation.
6. The contract must state that a check immediately before send does not itself create a distributed atomic transaction. If the approved source/access authority cannot provide a guarantee adequate for the threat model, the candidate remains unsupported and must not be released.

No endpoint, wire fields, journal, cursor, outbox, lease, cross-store transaction, or generic source schema is proposed for immediate implementation.

## 5. Required executable acceptance on the real path

The harness must exercise the real Host hook, actual Core consumer/read service, actual Provider authorization/currentness mechanism, and actual final serializer/send boundary. A fake sender or fixture-only callback is not end-to-end acceptance.

| Case | Mutation between admission and release | Required result |
|---|---|---|
| Control | No change | Approved content sent once, no duplicate delivery |
| Revocation | Revoke Provider access after admission | Zero protected bytes and zero side-channel disclosure |
| Canonical field policy | Revoke/deny field access after admission | Zero protected bytes and zero side-channel disclosure |
| Edit/version change | Edit source or advance authoritative source version | Stale candidate suppressed; no old content sent |
| Deletion/retraction | Delete/retract source after admission | Candidate suppressed |
| Rollback | Roll source V1 to V0 while `commit_sequence` does not increase | Source-specific authority rejects candidate; composite Core cursor alone must not pass it |
| Revalidation unavailable | Provider/Core currentness check times out/errors | Fail closed; zero protected bytes |
| Restart/recovery | Restart between persistence and replay/release | No stale or duplicate release; replay semantics explicit |
| Incomplete inventory | Hide historical/deleted version or interrupt reconciliation | Non-ready; no content release |

Assert that content, snippets, counts, source identifiers, and diagnostics do not leak in the request payload, error response, recipient-visible logs, or other recipient-visible output. Record exact Host version, Core commit, Provider commit, test command, and observed result.

## 6. Blocker → disposition → owner → change → acceptance

| Blocker | Disposition now | Owner | Concrete next change after approval | Executable acceptance |
|---|---|---|---|---|
| Raw Host text retention | Explicitly not approved | Host + Memory + Core | Separate retention/purpose/access/deletion contract, only if desired | Verify no raw text persisted/transferred absent approval |
| Host source identity/version and complete inventory | Unsupported / NON_READY | Host + Memory | Choose authoritative identity/version and inventory/retraction semantics | Edit/delete/restore/replay and incomplete-inventory tests |
| World/session/recipient/actor binding | Decision required; use existing Core actor binding where it actually applies | Core + Host | Bind real Host request to server-resolved scope and Core actor; no body-label trust | Spoofed/cross-world/cross-recipient tests |
| Actual release boundary | No verified production seam in Core main; Host must name exact hook | Host/Adapter (send owner), Core (gate owner) | Wire approved gate at real final serialization/send point | Pause-before-send revoke/edit/delete race |
| Provider currentness/retraction | Unsupported until authoritative source contract exists | Memory Provider | Implement only approved source-specific currentness rule | V1→V0 rollback with unchanged Core commit sequence |
| Core field authorization | Existing read seam available; policy must be explicitly configured | Core | Reuse existing service and approved field/purpose policy; no broader default | Unauthorized-field and policy-revocation race |
| Exactly-once/restart behavior | Not established for Memory→NPC release path | Host + Core + Memory | Define semantics supported by actual sender/recovery path | Real restart/replay and duplicate-send assertion |

## 7. Approval questions that block implementation

Please answer these explicitly in #140 or linked owner tasks:

1. **Host/Adapter:** Which exact pinned SillyTavern function is the final model-request serialization/send boundary? Supply source path + function + line/commit evidence and name its owner.
2. **Memory Provider:** What source kind, if any, has authoritative source identity/version/lineage and complete inventory/retraction semantics today? If none, confirm Host-originated Memory remains unsupported.
3. **Core + Memory:** What source-specific authority proves rollback/retraction when the Core composite snapshot cursor does not advance? If none, confirm fail-closed is the only allowed behavior.
4. **All owners:** Is synchronous final release revalidation acceptable, given that it is not cross-store atomicity? If not, name the required stronger guarantee before code is designed.
5. **Retention owners:** Confirm raw Host message text remains prohibited from durable journal/Provider transfer under the current contract, unless a separate retention contract is proposed.

## 8. Implementation boundary

No runtime implementation is included because the necessary release owner, authoritative source-currentness contract, and cross-owner approval are absent from current evidence. Implementing a gate before those decisions would invent authority or create a false end-to-end guarantee. After approval, the first code PR should add the smallest Core-owned gate against existing services, wire it only through the named real Host release hook, and land the race test against that real path. Production remains **DISABLED / FAIL-CLOSED** until exact-head tests pass and owners accept the evidence.
