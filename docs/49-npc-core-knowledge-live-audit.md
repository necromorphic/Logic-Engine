# NPC/Core Knowledge Readiness — Live Source Audit

Status: documentation-only audit on 2026-10-24. Target Core ref: `main` at `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`. Target NPC ref at audit start: `feat/npc-subsystem` at `af291f272229b1594865e403c54a3166fd12e9df`. This records inspected source evidence; it is not a runtime readiness approval and does not authorize changes to Core.

## 1. Decision summary

**The first NPC knowledge slice is still blocked.** Core now has trusted adapter-to-actor binding, bounded snapshots, tri-state condition evaluation, and proposal lifecycle. It still does not provide the Core-owned acquisition/provenance records and actor/purpose/snapshot-bound safe context projection needed to give an NPC model a reliable account of what that NPC knows.

Do not implement a parallel NPC-local knowledge store, belief store, authorization layer, event/causality system, revision cursor, or rollback path. Keep NPC work to contract alignment and test-boundary definition until the real Core production boundary exists.

## 2. Observed Core capabilities

| Capability | Source evidence on target `main` | Test evidence | What this actually proves |
|---|---|---|---|
| Trusted actor binding | `src/application/actor-bindings.js`; routes in `src/api/server.js` | `tests/actor-binding.test.js` | Admin-managed allowlist binds authenticated adapter IDs to canonical actor IDs within a world; resolution rejects unbound actors and checks eligibility. Identity resolution only. |
| Bounded consistent snapshot | `LogicEngine.getSnapshot(...)` in `src/application/engine.js`; implementation in `src/storage/sqlite-store.js` | `tests/snapshot-read.test.js` | World-scoped bounded read with composite `(world_revision, commit_sequence)` cursor and non-mutation for that read. It is not an actor-authorized projection. |
| Tri-state condition result | `evaluateConditionResult(...)` in `src/core/rules.js` | `tests/tri-state-rules.test.js` | A condition can return true/false/unknown and preserve explicitly known-absent paths. It does not authorize access or establish that an entire knowledge query is complete. |
| Proposal lifecycle | `src/application/proposals.js` and API integration | Existing proposal/API tests | Proposals can be staged for later approval/commit. Adapter identity is not actor authorization, and proposal validation does not prove knowledge safety or semantic/player-agency compliance. |
| Minimal character-card projection | `src/application/character-card-projection.js` | `tests/character-card-projection.test.js` (confirm exact current path before relying on it) | Projects a restricted stable identity/type/status view from an already obtained snapshot. Does not expose arbitrary facts or establish what the target actor knows. |
| Canonical events and partial causal rollback | `src/storage/sqlite-store.js`, `src/application/engine.js` | `tests/causality-contract.test.js` | Existing canonical event and rollback machinery covers current supported effects and tested causal cases. It does not automatically reconcile future acquisition records that do not yet exist. |

## 3. Required capabilities not observed in the current Core source

| Required capability | Status | Why adjacent features are insufficient |
|---|---|---|
| Core-owned initial acquisition records (`author_initial` / imported) | **Missing** | Canonical facts, entity attributes, seed/import data, event references, manifests, and prompt inclusion do not independently prove that a particular actor acquired a particular proposition. |
| Source/provenance and validity for actor acquisition | **Missing as an acquisition contract** | Existing event causality can be referenced by a future contract, but there is no inspected acquisition record lifecycle that records subject, source, validity, and reconciliation. |
| Actor + purpose + snapshot-bound knowledge read/filter | **Missing** | Actor binding authenticates identity; `getSnapshot` reads canonical state; a manifest records references; none combines these into a safe actor-relative model envelope. |
| Reserved-secret exclusion before model serialization | **Not verified / blocking** | The inspected minimal card projector avoids arbitrary attributes, but no end-to-end filter was found that removes restricted values from the exact model input and safe diagnostics. |
| Knowledge status distinctions (`known`, `unknown`, `known_absent`, `withheld`, `incomplete`, `unsupported`) | **Missing at the knowledge-query boundary** | Tri-state condition evaluation handles a condition over supplied context, not knowledge acquisition, permission, or completeness of a whole read. |
| Acquisition invalidation/reconciliation | **Missing for acquisition records** | Existing event rollback does not prove alternative-support recomputation for a knowledge record not represented in the current canonical lifecycle. |
| Thin NPC adapter that consumes only the safe envelope | **Missing** | No production adapter boundary was found that enforces safe-envelope-only input and cannot request raw-snapshot fallback. |
| Delivery/rendering/acknowledgement/comprehension evidence | **Unsupported for the first slice** | No host-rendering signal has been verified; do not mark information as shown, received, understood, acquired, or believed from injection/prompt inclusion alone. |
| Persistent belief state | **Explicitly deferred** | It is a separate later Core-owned simulation state and is not needed for the initial author-initial/imported acquisition slice. |

## 4. Minimum acceptance tests before the NPC slice can be called ready

1. **Actor isolation:** actor A cannot receive actor B's acquisition; model-supplied identity cannot override trusted binding; unknown/destroyed/cross-world/unmapped actors fail closed.
2. **Initial acquisition:** authorized initial/imported acquisition records retain subject, provenance, validity and source references; a canonical fact, retrieval, manifest, or prompt inclusion alone creates no acquisition.
3. **Safe model boundary:** inspect the exact serialized adapter input and diagnostics; reserved-secret values and withheld content are absent, not merely labelled as forbidden.
4. **Status fidelity:** unknown, known absent, withheld, incomplete and unsupported remain distinct; no status is converted into a negative world fact.
5. **Freshness and completeness:** canonical state and acquisition data use one consistent cursor; stale or mixed reads fail closed, with no raw snapshot fallback.
6. **Reconciliation:** invalidating one source removes only unsupported acquisition paths while preserving independent valid support.
7. **Proposal non-mutation:** creating a proposal does not change canonical state/events, acquisition/belief/delivery state, world revision or commit sequence.
8. **Production boundary:** tests call real Core services and the actual serialization boundary. Mocks alone do not establish missing filtering or acquisition behavior.

## 5. Scope and next dependency sequence

The dependency sequence is now:

1. **Identity binding — source-level implementation observed on current Core `main`.** This has not been incorporated into the NPC branch; do not duplicate it locally.
2. **Acquisition/provenance — Core implementation still required.** Use the existing canonical IDs and lifecycle; choose no new schema/storage shape from the NPC branch.
3. **Safe actor-relative context — Core implementation still required after acquisition exists.** It must bind trusted actor, bounded purpose, consistent snapshot cursor and authorized acquisitions before serialization.
4. **Thin NPC adapter — later, after stages 1–3 are available and production tests pass.** It may create a proposal only, not commit canonical effects.

The current Core implementation plan is `docs/43-core-npc-knowledge-runtime-implementation-plan.md` on `main`. It describes the same sequence and explicitly prohibits raw-snapshot fallback. This NPC document records the observed/missing boundary only; it does not authorize a Core implementation or a public endpoint.

## 6. Branch and verification boundaries

- Core target inspected: `37b05c38b15eda1743fb6fce08a8ccc2f1d2e672`.
- NPC branch is separate and was not rebased or merged into Core during this audit.
- No runtime, API, schema, SQLite, prompt, vectorization, or `main` changes were made by this NPC audit.
- The available commit-workflow query is limited to PR-triggered runs and returned no runs for the inspected Core/NPC audit heads. This is **not** evidence of green CI and does not prove that no other workflow types ran.
