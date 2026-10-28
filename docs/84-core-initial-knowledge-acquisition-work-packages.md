# Initial NPC Knowledge Acquisition — Coordinator Work Packages

**Status:** ordered work plan; documentation only. Runtime implementation and readiness promotion remain gated by the acceptance evidence below.

**Tracking issue:** https://github.com/necromorphic/Logic-Engine/issues/557  
**Contract proposal:** `docs/83-core-owned-initial-knowledge-acquisition-contract-proposal.md`  
**Governing contract:** `docs/50-npc-initial-knowledge-acquisition-contract.md`  
**Core implementation plan:** `docs/43-core-npc-knowledge-runtime-implementation-plan.md`

## Coordinator decision

Proceed in dependency order. Component ownership is assigned now; individual human assignees are not inferred.

- **Core:** authoritative subject assignment, provenance, lifecycle, snapshot-consistent reads, restrictions and pre-serialization filtering.
- **Host/Adapter + Core:** trace and secure the actual production model egress path.
- **Coordinator:** maintain dependencies, review evidence, run the readiness gate and prevent premature activation.

## Work packages

### WP-1 — Authoritative source and assignment representation
**Owner:** Core  
**Depends on:** bounded source audit in doc 83.

1. Trace the actual supported world-start/authoring and import entry points.
2. Determine whether current seed/import contracts can explicitly assign `author_initial` and `imported` items to a canonical subject in a world.
3. If not, propose the smallest Core-owned extension and review it before implementation.
4. Define trusted source provenance, subject authorization and unsupported cases.

**Exit criteria:** named source paths; reviewed representation; explicit authorization and provenance rules; proof that world-level fact/import presence alone does not grant knowledge.

### WP-2 — Assignment identity and lifecycle
**Owner:** Core  
**Depends on:** WP-1 approved representation.

Define and test create, duplicate replay, conflicting identity reuse, replacement, source invalidation, independent support, and restart/replay reconstruction. Establish whether the chosen representation participates in actual Core validity/replay/rollback semantics. Do not infer causal completeness from generic event fields.

**Exit criteria:** lifecycle transition table and production-path tests against the real representation. If existing lifecycle primitives are insufficient, document the smallest required Core-owned extension and stop for review before coding it.

### WP-3 — Snapshot-consistent safe read
**Owner:** Core  
**Depends on:** WP-1 and WP-2.

Reuse `Engine.getSnapshot()` / `SQLiteStore.readSnapshot()` and its existing `(world_revision, commit_sequence)` cursor. Resolve subject, source/item, validity and restrictions at one snapshot. Validate actor and bounded purpose. Preserve `known`, `known_absent`, `unknown`, `withheld`, `incomplete`, `unsupported`, and `invalid` distinctions without treating missing data as false.

**Exit criteria:** production tests for subject isolation, no implicit world-to-knowledge copy, stale/mixed snapshots, status fidelity, and read purity. No parallel revision cursor or NPC-local acquisition store.

### WP-4 — Actual model egress enforcement
**Owner:** Host/Adapter + Core  
**Depends on:** safe Core read from WP-3; path discovery may begin earlier.

Trace the real production dispatch path from Core result to serialized model input. Ensure only the filtered envelope crosses the boundary. Check prompt assembly, diagnostics and fallback paths for reintroduction of denied values.

**Exit criteria:** a production-boundary test inspects the exact serialized model input and all model-accessible diagnostics. Restricted values must be absent, not merely marked denied after serialization. Mock-only tests do not close this gate.

### WP-5 — Acceptance review and readiness decision
**Owner:** Coordinator, with evidence from Core and Host/Adapter  
**Depends on:** WP-1 through WP-4.

Run the relevant tests and review the NKA/KAC acceptance cases against real Core paths. Record results, files changed, limitations and any explicitly justified deferrals.

**Exit criteria:** gate-by-gate evidence review. Memory → NPC remains `DISABLED / FAIL-CLOSED`; Host remains `NON_READY` until mandatory gates pass. This plan does not authorize merge or production activation.

## Dependency order

`WP-1 → WP-2 → WP-3 → WP-4 → WP-5`

WP-4 may investigate the dispatch path in parallel, but must not expose an unapproved or unfiltered payload.

## Non-goals for this slice

- Observation, communication, in-world document reading, inference, rumor, belief, delivery, or comprehension.
- NPC-local acquisition storage, source graph, revision counter, or rollback mechanism.
- Raw-message storage or implied authorization.
- Activation of Memory → NPC or promotion of Host readiness without evidence.

## Current blockers from the bounded audit

1. No verified authoritative author/import path that assigns initial information to a specific canonical subject.
2. No acquisition-specific lifecycle proof for replay, replacement, invalidation, independent support and reconstruction.
3. No verified production final-send gate that proves restricted values are absent from exact model input and model-visible diagnostics.

These findings are bounded to the inspected repository state; revisit them if the production paths change. A reusable identity or snapshot primitive is not proof that acquisition is implemented.
