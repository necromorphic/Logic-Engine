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

### WP-1 source audit — concrete implementation boundaries

Inspected current `main` source paths (28 October 2026); these are source observations, not runtime test results:

| Path | Observed behavior | WP-1 consequence |
|---|---|---|
| `src/application/engine.js::LogicEngine.createWorld` (around lines 451–469) | Accepts only world ID, pack ID/version, and game time, then delegates to `store.createWorld`. It does not accept subject-specific initial knowledge assignments. | The current world-start entry point cannot express `author_initial` assignments. |
| `src/storage/sqlite-store.js::SQLiteStore.createWorld` (around lines 687–704) | Creates the world row and a `world.created` audit entry containing pack ID/version. It does not expand a pack or create subject-acquisition events. | Pack metadata is not an acquisition source. |
| `docs/04-world-pack-format.md` (opening status and §4) | Explicitly describes the World Pack as proposed/incomplete and its sample as illustrative; no complete production loader/conformance contract is established. | Do not treat `knowledge_channels` or illustrative `propose_knowledge` as an executable importer. |
| `src/core/mechanic-effect-translator.js` (lines 1–5 and supported-intent translation) | `propose_knowledge` is listed as a known intent, but only `create_entity`, `update_attribute`, and `assert_fact` are supported. | A recognized intent name is not a supported acquisition operation. `assert_fact` remains canonical world fact creation. |
| `src/application/engine.js::LogicEngine.commitEvent` (around line 635) | The mechanic-evaluation provenance mapping explicitly maps `assert_fact` to `fact.set`; no subject-acquisition effect is represented in this mapping. | Reusing `fact.set` would conflate world truth with subject knowledge and is not an acceptable shortcut. |
| `src/storage/sqlite-store.js::SQLiteStore.readSnapshot` (around lines 805–818) | The method documents returned facts, attributes, and manifests as raw internal source data, not actor-authorized/model-safe context. | The existing snapshot is a read primitive, not a knowledge assignment or disclosure filter. |
| `tests/core.test.js` (e.g. world setup at line 15 and canonical event fixtures throughout) | Tests construct worlds and seed facts/entities through `createWorld` and `commitEvent`; this is not evidence of a production author/import assignment contract. | Test fixtures must not be mistaken for a supported authoring/import path. |

**WP-1 result: source-path gap confirmed within the inspected repository paths.** No supported production authoring/import entry point was found that assigns an initial item to a canonical subject. This is not a claim about uninspected deployment-specific code.

**Next implementation decision:** Core review must explicitly approve the minimal event-sourced acquisition effect and its source-validity lifecycle before runtime code is changed. Until then, no acquisition API, schema, storage projection, or partial read path is added. WP-2 remains blocked; Memory → NPC remains `DISABLED / FAIL-CLOSED`.

### WP-2 lifecycle audit — current Core primitives are insufficient for acquisition semantics

Inspected `src/storage/sqlite-store.js` on `main`:

- `world_events` persists event validity (`valid`, `retracted`, `invalidated`), causal metadata, effects and commit sequence (table definition around lines 215–223).
- `commitEvent` writes canonical effects and rebuilds the world projection; mechanic effect provenance currently maps only `create_entity`, `update_attribute`, and `assert_fact` to existing world effects.
- `rollback` (around lines 2055–2190) invalidates a root event and dependent events using `caused_by`, `depends_on`, `read_set`, supported causal links and changes to entity/fact/relationship projections. Its dependency analysis does not define a knowledge-assignment identity, acquisition support set, source-version validity, or subject-specific acquisition projection.
- `rebuild` reprojects existing canonical effects; the existence of replay/rebuild machinery does not establish that an unimplemented acquisition effect can be reconstructed or invalidated correctly.
- Existing `fact.set` represents world fact projection. It does not preserve independent subject/item acquisition supports as a separate semantic relation.

#### Required transition table for the proposed first slice

| Operation | Required result | Current Core evidence | Disposition |
|---|---|---|---|
| Create `author_initial` / `imported` assignment | Stable assignment identity bound to canonical world, subject, item/source, source version and authorization rule | No supported assignment effect or trusted entry point identified in WP-1 | **BLOCKED** |
| Exact duplicate replay | Return the same assignment result; do not create a second support | Generic event idempotency exists, but acquisition-specific identity and payload semantics do not | **UNPROVEN** |
| Reuse assignment identity with different subject/item/source | Reject as a conflict; never silently retarget | Generic idempotency-key conflict is not equivalent to acquisition identity validation | **UNPROVEN** |
| Replace/invalidate source | Invalidate only assignments whose source basis is no longer valid | Rollback invalidates events through supported event/projection dependencies; acquisition source-version transitions are not defined | **BLOCKED** |
| Two independent assignments support the same subject/item | Invalidating one support leaves the other active | No acquisition support projection exists; a single world fact projection cannot prove this behavior | **BLOCKED** |
| Restart/replay/rebuild | Reconstruct exactly the active assignment set from authoritative valid events | Existing replay/rebuild applies current effect vocabulary; no acquisition effect or derived acquisition projection exists | **BLOCKED** |
| Read at a snapshot | Return only assignments valid at the same `(world_revision, commit_sequence)` snapshot | Snapshot cursor exists, but no acquisition relation is resolved by it | **BLOCKED** |

**WP-2 result: STOP before runtime implementation.** The repository has reusable event identity, validity, rollback and snapshot primitives, but the inspected implementation does not prove the acquisition-specific lifecycle required by #557. The minimum reviewed design must define (1) canonical assignment identity and conflict behavior, (2) source-version validity/invalidation semantics, and (3) a derived projection that preserves independent supports and can be rebuilt from valid Core events. Only after that contract is approved should code and production-path tests be added. Do not add a partial read path or repurpose `fact.set`.

This is a bounded source audit, not a claim that tests were executed. It does not change the readiness decision: Memory → NPC remains `DISABLED / FAIL-CLOSED`; Host remains `NON_READY`.
