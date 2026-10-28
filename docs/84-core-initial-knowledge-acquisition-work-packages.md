# Initial NPC Knowledge Acquisition — Coordinator Work Packages

**Status:** ordered work plan; documentation only. Runtime implementation and readiness promotion remain gated by acceptance evidence.

**Tracking issue:** https://github.com/necromorphic/Logic-Engine/issues/557  
**Existing Core gate:** https://github.com/necromorphic/Logic-Engine/issues/140  
**Cross-block register:** https://github.com/necromorphic/Logic-Engine/issues/251  
**Portfolio coordinator:** https://github.com/necromorphic/Logic-Engine/issues/252  
**Existing dispatch/readiness gates:** [#264](https://github.com/necromorphic/Logic-Engine/issues/264), [#356](https://github.com/necromorphic/Logic-Engine/issues/356)  
**Contract proposal:** `docs/83-core-owned-initial-knowledge-acquisition-contract-proposal.md`  
**Governing contract:** `docs/50-npc-initial-knowledge-acquisition-contract.md`

## Coordinator decision

Proceed in dependency order. Component ownership is assigned; individual human assignees are not inferred.

- **Core:** authoritative subject assignment, provenance, lifecycle, snapshot-consistent reads and restrictions.
- **Host/Adapter + Core + Provider:** production disclosure/dispatch only through the existing cross-block gate (#140/#264/#356).
- **Coordinator:** maintain dependencies, review evidence, update #251/#252, and enforce readiness gates.

**Boundary rule:** this workstream covers initial knowledge assignment semantics only. It must not duplicate the existing global disclosure/dispatch plan or invent a second serialization point, API, store, outbox, journal, or cross-store transaction.

## Work packages

### WP-1 — Authoritative source and assignment representation
**Owner:** Core.

1. Trace the actual supported world-start/authoring and import entry points.
2. Determine whether current seed/import contracts can explicitly assign `author_initial` and `imported` items to a canonical subject in a world.
3. If not, propose the smallest Core-owned extension and review it before implementation.
4. Define trusted source provenance, subject authorization and unsupported cases.

**Exit criteria:** named source paths; reviewed representation; explicit authorization and provenance rules; proof that world-level fact/import presence alone does not grant knowledge.

### WP-2 — Assignment identity and lifecycle
**Owner:** Core; depends on WP-1.

Define and test create, duplicate replay, conflicting identity reuse, replacement, source invalidation, independent support, and restart/replay reconstruction. Establish whether the selected representation participates in actual Core validity/replay/rollback semantics. Generic event fields alone do not prove causal completeness.

**Exit criteria:** lifecycle transition table and production-path tests against the real representation. If existing lifecycle primitives are insufficient, document the smallest required Core-owned extension and stop for review before coding it.

### WP-3 — Snapshot-consistent safe read
**Owner:** Core; depends on WP-1 and WP-2.

Reuse `Engine.getSnapshot()` / `SQLiteStore.readSnapshot()` and its existing `(world_revision, commit_sequence)` cursor. Resolve subject, source/item, validity and restrictions at one snapshot. Validate actor and bounded purpose. Preserve `known`, `known_absent`, `unknown`, `withheld`, `incomplete`, `unsupported`, and `invalid` distinctions without treating missing data as false.

**Exit criteria:** real-path tests for subject isolation, no implicit world-to-knowledge copy, stale/mixed snapshots, status fidelity and read purity. No parallel revision cursor or NPC-local acquisition store.

### WP-4 — Integrate with existing disclosure gate
**Owner:** Core + Host/Adapter + Provider owners; governed by #140/#264/#356.

Use the existing cross-block dispatch/readiness work. Do not create a competing egress mechanism here. Connect the approved Core-filtered acquisition result only when the actual production boundary is approved and implemented.

**Exit criteria:** exact model-boundary tests required by the governing issues pass on the real production path; denied values are absent from model input and model-accessible diagnostics.

### WP-5 — Acceptance review and readiness decision
**Owner:** Coordinator, with evidence from Core and Host/Adapter/Provider.

Review WP-1–WP-4 evidence and update #140, #251 and #252. Record exact commits, test commands, results and remaining blockers.

**Exit criteria:** gate-by-gate evidence review. Memory → NPC remains `DISABLED / FAIL-CLOSED`; Host remains `NON_READY` until all mandatory governing gates pass. This plan does not authorize merge or production activation.

## Representation decision proposal

The coordinator has drafted [doc 85 — Core-owned event-sourced acquisition representation](docs/85-core-initial-knowledge-acquisition-representation-decision.md). Recommended target: a Core-owned acquisition effect in the existing event/validity lifecycle plus a derived projection, explicitly not `fact.set`, context manifests, or an NPC-owned source-of-truth table. This is a proposal, not approved runtime behavior.

The representation decision remains conditional on WP-1 source-path discovery and WP-2 proof that source invalidation, independent support, replay and rollback can be represented correctly. If they cannot, stop and review the smallest missing Core lifecycle extension before implementing the read path.

## Dependency order

`WP-1 → WP-2 → WP-3 → WP-4 → WP-5`

Dispatch path discovery under #264 may proceed in parallel, but no unapproved or unfiltered payload may be exposed.

## Non-goals for this slice

- Observation, communication, in-world document reading, inference, rumor, belief, delivery, or comprehension.
- NPC-local acquisition storage, source graph, revision counter, or rollback mechanism.
- Raw-message storage or implied authorization.
- Duplicating the global dispatch gate.
- Activating Memory → NPC or promoting Host readiness without evidence.

## Current blockers from the bounded audit

1. No verified authoritative author/import path that assigns initial information to a specific canonical subject.
2. No acquisition-specific lifecycle proof for replay, replacement, invalidation, independent support and reconstruction.
3. Safe disclosure is governed separately by #140/#264/#356; this workstream does not claim that gate is implemented or passed.

### WP-1 source-audit result (main at 338a4501b972117538f4d6e92bb25f09d1b53111)

The first source-path check now has concrete evidence:

- `docs/04-world-pack-format.md` explicitly says the complete World Pack format is not finalized and the current schemas do not constitute a production loader or full conformance validation. Its sample `knowledge_channels` and `propose_knowledge` shape is illustrative, not executable evidence.
- `src/application/engine.js` exposes `LogicEngine.createWorld()` and canonical event/effect paths; the audited code does not establish an author/import loader that takes a world pack and explicitly assigns initial knowledge to a canonical subject.
- `src/core/mechanic-effect-translator.js` recognizes `propose_knowledge` as a known intent but only supports `create_entity`, `update_attribute`, and `assert_fact`. It rejects `propose_knowledge` as unsupported; the `assert_fact` path writes canonical `fact.set`, not subject acquisition.
- Existing tests such as `tests/core.test.js` and `tests/snapshot-read.test.js` construct worlds and entities through test helpers/canonical events. They do not establish a production initial-knowledge assignment contract.

**WP-1 disposition: BLOCKED pending Core design decision.** Do not retrofit subject acquisition into `fact.set`, the illustrative World Pack shape, or a context manifest. Core must choose whether to add an explicit assignment to a reviewed author/import contract or introduce the smallest separately reviewed Core-owned representation. The current source audit supports the absence of a demonstrated path in inspected main; it does not prove that no deployment-specific loader exists.

These findings are bounded to the inspected repository state; revisit them if production paths change. A reusable identity or snapshot primitive is not proof that acquisition is implemented.
