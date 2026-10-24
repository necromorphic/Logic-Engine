# Core context-manifest trust contract

Status: **schema-neutral design proposal; current runtime limitations remain in force**.

Scope: define what a context manifest can prove, which host component may register it, and how its world/generation/snapshot binding must be established. This document does not add an endpoint, credential, schema field, database column, or runtime behavior.

Related:
- `docs/21-stage1-causality-contract.md`
- `docs/27-proposal-to-commit-boundary.md`
- `docs/28-proposal-api-stage1.md`
- `docs/53-core-http-service-boundary-audit.md`
- `docs/39-npc-core-knowledge-contract-proposal.md` (NPC-side acquisition and delivery boundaries)

## 1. What the current runtime proves

The current engine validates manifest shape, canonical item identities, world-local existence, base commit sequence, base world revision, and a server-computed request hash. The manifest is immutable and unique per `(world_id, generation_id)`; identical registration is idempotent, while conflicting registration for the same generation is rejected. When a proposal refers to a manifest, the commit path checks its generation and snapshot binding and checks that declared reads are included.

These checks establish structural consistency and declared-read inclusion. They do **not** establish that the registering caller is a trusted host, that the manifest came from the actual assembled prompt, that every relevant prompt fragment was captured, or that the model attended to or used the listed material.

The current HTTP route `POST /v1/worlds/:world_id/context-manifests` is behind the general API bearer but does not require a separate internal capability or adapter identity. A caller-supplied `generation_id` is a label unless it is bound to a trusted host-side generation record. Hashing the request makes the submitted representation stable; it does not authenticate its origin.

## 2. Semantic limits: do not overclaim

A context manifest means only: **a trusted producer claims these canonical records were made available to this generation**, once the producer boundary described below is enforced.

It does not mean:
- the model read or understood every listed item;
- the model used a listed item as a reason;
- the model did not use information omitted from the manifest;
- a listed claim is true merely because it appeared in context;
- the manifest grants the model or an NPC permission to know the underlying record;
- the model's proposed causal metadata is complete;
- a generated event is semantically justified by the listed context.

Keep three independent questions separate:

1. **Availability/provenance:** what canonical material did the trusted host assemble for a generation?
2. **Authorization:** what material may this recipient be given?
3. **Causal assertion:** what inputs does the proposed event claim materially influenced it?

The manifest addresses the first question only, and only to the degree the trusted host can substantiate. Authorized read filtering must happen before material is assembled. Causal completeness remains unproven.

## 3. Required trust chain

The design must establish the following chain without trusting model output or caller-provided origin labels:

1. **Generation creation:** a trusted host/adapter creates a unique generation record for a world and recipient/actor context. The record is server-authenticated and has a lifecycle state.
2. **Authorized context assembly:** the host obtains canonical records through the authorized-read boundary, with an explicit recipient, purpose, and snapshot cursor. It records which canonical references and content versions were actually supplied.
3. **Manifest derivation:** the same trusted host component derives the manifest from the assembled context, rather than accepting an arbitrary model-generated list. The generation ID, world ID, recipient/actor binding, base revision, and commit sequence are taken from or checked against the trusted generation record.
4. **Registration:** the core accepts the manifest only from a principal authorized to register context for that generation. It verifies that the generation exists, belongs to the same world, is still eligible for registration, and that the snapshot cursor matches the authorized assembly record.
5. **Proposal binding:** a proposal's `generation_id` and `context_manifest_id` must refer to the same trusted generation and manifest. Caller-supplied matching strings alone are not sufficient.
6. **Commit-time validation:** the core preserves current stale-snapshot and declared-read checks. It must not silently treat a later snapshot as the one originally supplied to the model.

The exact host generation registry, authentication mechanism, and storage representation are open design choices. Do not invent their runtime APIs or schema in this contract.

## 4. Fail-closed interim boundary

Until the trusted generation registry and host derivation path exist, the HTTP registration route must not be treated as proof-grade provenance.

Recommended interim behavior for review:
- restrict registration to a separately authenticated trusted internal host capability, or disable external registration entirely;
- do not let a normal adapter/API bearer register manifests that are later interpreted as trusted host provenance;
- keep existing manifest-aware commit checks, but describe their assurance accurately as structural validation of caller-supplied metadata;
- if a proposal claims a manifest/generation binding that cannot be verified against trusted host state, reject it rather than falling back to caller assertion;
- do not silently remove backward compatibility for legacy events without manifests; any tightening of required-manifest policy needs a staged migration and explicit compatibility review.

This is a policy recommendation, not an authorization to change the current runtime.

## 5. Lifecycle, idempotency, and concurrency

The implementation contract must cover these cases:

- **Wrong world:** a generation or manifest created for world A cannot be attached to a proposal in world B.
- **Foreign generation:** a principal cannot register or use a manifest for a generation it does not own/control.
- **Duplicate identical registration:** retry returns the original stable manifest identity.
- **Conflicting duplicate:** a different manifest for the same generation is rejected without overwriting the original.
- **Stale snapshot:** revision/commit-sequence mismatch is rejected; no implicit rebase.
- **Cancelled/superseded generation:** a late manifest or proposal is rejected once the trusted host has marked the generation ineligible.
- **Concurrent registration/commit:** generation ownership, manifest immutability, proposal binding, and canonical commit remain transactionally consistent.
- **Partial host failure:** an incomplete assembly must not be marked as a complete, trusted manifest.
- **Rollback:** invalidating a world event does not rewrite what was historically supplied to an earlier generation. Historical manifest/audit evidence remains, while later use must observe current authorized state and current validity semantics.
- **Unavailable registry:** fail closed for operations that require trusted binding; do not accept an unverified caller label as a fallback.

## 6. Minimum acceptance matrix

| Scenario | Expected result |
|---|---|
| Trusted host registers manifest for its live generation and matching snapshot | Allowed |
| General API bearer without trusted producer authority registers a proof-grade manifest | Denied |
| Caller supplies a fabricated generation ID | Denied |
| Manifest world differs from generation/proposal world | Denied |
| Manifest cursor differs from trusted assembly cursor | Denied |
| Adapter attempts to attach another generation's manifest | Denied |
| Same generation retries identical manifest | Idempotent response |
| Same generation submits different manifest | Conflict; original remains unchanged |
| Generation was cancelled/superseded before registration/commit | Denied |
| Manifest contains unauthorized/private record references | Denied at authorized assembly or trusted verification boundary |
| Proposal's generation and manifest IDs disagree | Denied |
| Manifest is structurally valid but omits a material input | No claim of causal completeness; test documents current limitation |
| Model says it used a record not present in trusted manifest | Claim is not promoted to verified provenance |
| Registry is unavailable or cannot establish ownership | Fail closed; no canonical mutation |

Tests must exercise the production host-to-core boundary and proposal commit path. Unit tests that only compare caller-supplied IDs are insufficient.

## 7. Ownership boundaries

- **Core:** canonical IDs, snapshot cursor validation, immutable manifest storage, trusted generation binding enforcement, proposal/manifest consistency, fail-closed behavior, audit and commit invariants.
- **Host adapter/orchestrator:** actual generation lifecycle, recipient/actor identity, authorized context assembly, manifest derivation from the assembled input, and reliable cancellation/supersession signals.
- **NPC subsystem:** decides what the NPC acquires or believes from authorized evidence. The manifest alone does not grant knowledge and must not write NPC belief state.
- **Memory subsystem:** may retain source-linked records and retrieve candidate evidence, but retrieval results must pass through the same authorized context assembly boundary. Memory does not attest that a generation saw a record unless the trusted host manifest substantiates that claim.
- **Relations/Personality:** may consume authorized evidence or canonical snapshots according to their own contracts; neither may mint trusted manifests or bypass access checks.

## 8. Open implementation gates

Before runtime implementation is approved, the Core owner must review:
1. the trusted generation record's authority, identity, and lifecycle;
2. which host process is allowed to register a manifest and how that identity is authenticated;
3. how the host records actual assembled canonical references and content versions;
4. how swipe/regenerate/cancel/delete signals map to generation invalidation;
5. whether registration is internal-only until all of the above exist;
6. compatibility behavior for legacy events without manifests.

Until these gates are resolved, treat context manifests as useful structural metadata, not as proof of model exposure or causal completeness.
