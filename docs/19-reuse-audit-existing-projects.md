# 19. Reuse audit: patterns from existing projects

Status: research-derived architecture note, 2026-10-23. This document does not mean that any external implementation has been imported or that its advertised behavior has been independently reproduced in our runtime.

## Purpose

Reuse mature solutions where they match our requirements, instead of rebuilding every subsystem from scratch. Reuse must not override the engine's non-negotiable constraints:

- generic world core; world-specific mechanics live in a World Pack;
- canonical state is owned by the engine, not by generated prose or a vector index;
- LLM output is a proposal and must be validated before commit;
- knowledge has provenance and access boundaries;
- deleting/swiping a SillyTavern message invalidates the causal branch rooted in that generation, while independent causes survive;
- preserve the existing vectorization patch and verify the real SillyTavern Android/Termux lifecycle before choosing hooks.

The notes below are based on the linked public documentation and repository files. They are a shortlist for design reuse, not a complete code/security audit.

## 1. SillyTavern InnerLore — primary reference for the ST adapter and branch-aware history

Repository: https://github.com/ChrisDitfort/SillyTavern-InnerLore  
Sources: [README](https://github.com/ChrisDitfort/SillyTavern-InnerLore/blob/main/README.md), [history rollback tests](https://github.com/ChrisDitfort/SillyTavern-InnerLore/blob/main/tests/history-rollback.test.mjs), [event delivery tests](https://github.com/ChrisDitfort/SillyTavern-InnerLore/tree/main/tests).  
License reported in repository: MIT.

### Patterns to adapt

1. **Treat history edits as state-changing input.** InnerLore documents rebuilding state when messages are edited, swiped, or deleted; its tests include SillyTavern history-change events. Our adapter must map the affected ST message/generation to engine turn IDs and request a causal rollback/rebuild. Do not copy its message fingerprint as the authoritative identity: our contract uses stable turn/generation identifiers where the host exposes them, and must surface uncertainty if it does not.
2. **Separate foreground narration from background state maintenance.** InnerLore runs a separate background analysis pass and validates a structured maintenance patch before merging it. We can adapt the separation and patch-validation boundary, but the engine's deterministic validators—not an LLM patch merger—must decide what becomes canonical.
3. **Keep authoritative persistence outside the chat transcript.** InnerLore uses SQLite for durable state and leaves only a small world pointer in chat metadata. This matches the desired adapter/core split. We must keep our structured world database separate from the existing vector archive and avoid replacing or migrating the user's vectorization patch.
4. **Preserve provenance and visibility as first-class context fields.** InnerLore describes branch-aware context fragments with visibility, certainty, importance, provenance, and delivery receipts. These are directly relevant to NPC knowledge filtering, private/off-screen events, confidence, and reliable delivery. Our own schema must additionally model source validity and multiple independent sources so rollback can remove only invalidated knowledge.
5. **Do not equate simulated event with delivered narration.** InnerLore records foreground delivery and retries boundedly; it also keeps simulated off-screen events private until revealed. Reuse the separation between world-event status and delivery status. A retry must never apply a world effect twice.
6. **Use bounded time estimates when the transcript cannot establish exact elapsed time.** InnerLore documents minimum/estimated/maximum fictional-time ranges and deterministic deadline scheduling. This is useful for adapter inference only; the canonical engine clock still advances under explicit, validated time rules.
7. **Keep manual author edits protected.** Its generated lorebook mirrors public records while respecting manual overrides. We should preserve author-approved canon and manual edits as protected inputs rather than silently overwriting them.

### Do not copy blindly

InnerLore is a complete ST extension with its own storage, prompts, state model, lorebook behavior, and progression policies. Its branch rebuild is a useful reference but is not proof that it satisfies our stronger causal rollback contract for arbitrary downstream processes, multiple causes, and independent off-screen events. Audit the exact code paths and tests before reusing implementation.

## 2. Immersive Worlds — practical reference for SillyTavern extension boundaries

Repository: https://github.com/SenjuWoo/ImmersiveWorlds  
Sources: [README](https://github.com/SenjuWoo/ImmersiveWorlds/blob/main/README.md), [STATE / verification log](https://github.com/SenjuWoo/ImmersiveWorlds/blob/main/STATE.md), [engine rules](https://github.com/SenjuWoo/ImmersiveWorlds/blob/main/rules.js), [self-tests](https://github.com/SenjuWoo/ImmersiveWorlds/blob/main/tests/selftest.js).  
License reported in repository: MIT.

### Patterns to adapt

- Keep the ST-facing host/injection layer separate from pure state-transition rules.
- Validate proposed patches against an explicit schema and deterministic rules; reject illegal movement/state changes with a reason.
- Treat user agency as an explicit invariant: the director must not write the player's words or decide player actions.
- Use per-chat state and host lifecycle hooks, but verify the exact event contract against our target ST version before depending on it.
- Test swipe/delete behavior, stale asynchronous results, branch safety, and prompt injection in an isolated ST instance.

### Limit

Immersive Worlds primarily tracks location, time, weather, nearby people/items, relations and scene context. It is an adapter/state-tracking reference, not a substitute for the universal simulation core, full NPC goal system, epistemic model, or causal dependency graph. Its STATE.md explicitly distinguishes tested behavior from unverified host/provider behavior; we should retain that evidence discipline.

## 3. Narrative Engine — reference for long-running campaign services and off-screen continuity

Repository: https://github.com/Sagesheep/NarrativeEngine-P  
Sources: [README](https://github.com/Sagesheep/NarrativeEngine-P/blob/main/README.md), [architecture map](https://github.com/Sagesheep/NarrativeEngine-P/blob/main/ARCHITECTURE.md), [codebase map](https://github.com/Sagesheep/NarrativeEngine-P/blob/main/AI_CODEBASE_MAP.md).  
License reported in repository: MIT.

### Patterns to investigate and adapt

- Separate durable campaign facts from volatile scene working state (for example, active timers, positions, environmental conditions and combat state).
- Model off-screen NPC continuity explicitly rather than relying on the next prompt to remember it.
- Use a per-world/campaign write serializer to avoid concurrent state overwrites.
- Keep timeline, structured facts/entities, semantic archive, relationship memory and scoped knowledge as distinct read/write surfaces.
- Treat restore/backup operations as explicit operations with a safety backup, not as arbitrary edits to files.

### Status

The public architecture map confirms these as components in that codebase, but this pass did not audit their complete implementation or establish that its rollback matches our semantics. Do not port its whole application or its world assumptions. Inspect the specific archive rollback, knowledge-scope, off-screen dossier, and concurrency code plus tests before deciding what code can be reused.

## 4. Mnehmos Engine — reference for deterministic mutation authority

Repository: https://github.com/mnehmos/mnehmos-engine  
Sources: [architecture](https://github.com/mnehmos/mnehmos-engine/blob/main/docs/ARCHITECTURE.md), [ontology contract](https://github.com/mnehmos/mnehmos-engine/blob/main/docs/standalone_engine_m1_ontology_contract_pack.md), [constraint engine contract](https://github.com/mnehmos/mnehmos-engine/blob/main/docs/standalone_engine_m2_constraint_engine_contract_pack.md), [mediated action contract](https://github.com/mnehmos/mnehmos-engine/blob/main/docs/standalone_engine_m3_mediated_action_contract_pack.md), [tick loop contract](https://github.com/mnehmos/mnehmos-engine/blob/main/docs/standalone_engine_m4_tick_loop_contract_pack.md), [save/load/fork contract](https://github.com/mnehmos/mnehmos-engine/blob/main/docs/standalone_engine_m7_save_load_fork_contract_pack.md).  
License reported in repository: MIT.

### Patterns to adapt

1. **Proposal is not mutation.** The LLM/adjudicator returns structured effect intents; the engine performs pre-check, classification, execution/adjudication, post-validation, then commit-or-reject.
2. **One mutation authority.** No alternate feature, agent, learned rule, or adapter path can bypass validation and commit.
3. **Canonical truth vs derived artifacts.** Snapshots and canonical records are restart authority; projections, caches, logs and semantic views are rebuildable/non-authoritative.
4. **Ordered world advancement.** Freeze an explicit phase order and define which phase may propose, validate, commit, update memory/social state, observe and persist.
5. **Independent branches.** Save/fork semantics should copy canonical truth into an independent branch; branches must not alias mutable state.
6. **Typed identifiers and explicit invariants.** Cross-record references should use stable typed IDs rather than embedding duplicate canonical records.

### Adaptation warning

Mnehmos's launch ontology is explicitly tailored to a game engine with Cell, Entity, Agent, Quest and Faction records. Do not adopt those five buckets as our universal ontology. Reuse the authority/validation/persistence contracts, then define our own generic entity, state, relation, process, resource and event abstractions. The documents are contract-first and staged; that supports our current documentation-only Stage 1 rather than implying we should start implementation immediately.

## 5. WorldLines — conceptual reference for independent agents and control-plane separation

Repository: https://github.com/LudicDynamics/WorldLines  
Sources: [README](https://github.com/LudicDynamics/WorldLines/blob/main/README.md), [example world agent](https://github.com/LudicDynamics/WorldLines/blob/main/examples/multi-agent/kagura-island/agents/world-agent/system.md), [example soul rules](https://github.com/LudicDynamics/WorldLines/tree/main/examples/multi-agent/kagura-island/souls).

### Pattern to adapt

Separate responsibilities between a world-level authority that owns/coordinates world truth and individual NPC agents with their own private memory, goals, decisions and actions. Keep runtime orchestration (parallel calls, timeouts, failure isolation, commit timing) out of narrative prompts. NPC outputs should be proposals returned to a world-level validation/commit boundary, not direct writes to canonical state.

### Licensing boundary

The repository README states that example worlds/tools are AGPL-3.0, while the neonrp engine core is not open for free forking/redistribution. Therefore this project is a conceptual reference only for now. Do not copy code or assume the core can be forked. If considering any example artifact later, inspect its exact license and obligations first.

## 6. SillyTavern State Engine — narrow reference for typed variable presets

Repository: https://github.com/StygianTechnica/SillyTavern-StateEngine  
Source: [README](https://github.com/StygianTechnica/SillyTavern-StateEngine/blob/main/README.md).

### Pattern to adapt

Reusable per-chat preset toolkits, typed variables (number/string/boolean/enum/array), defaults, categorized update modes, and batched prompted updates are useful for a future admin/editor layer or a lightweight ST-facing display. Existing presets are documented as protected from seeded example overwrites.

### Limit

This is a typed variable tracker inside SillyTavern's variable store, not an authoritative autonomous-world engine. Do not make ST variables or macros the source of truth for canonical world state, causal rollback, NPC knowledge, or long-running processes.

## 7. Recommended reuse map

| Our subsystem | Primary reference | Action |
| --- | --- | --- |
| ST message lifecycle, swipe/delete, branch-safe adapter | InnerLore; Immersive Worlds | Adapt patterns; verify actual target ST hooks and stable IDs |
| Canonical mutation pipeline and deterministic validation | Mnehmos | Adapt contract shape, not its world ontology |
| NPC private minds and independent agent roles | WorldLines; InnerLore | Adapt concepts; WorldLines core code is not reusable under current terms |
| Off-screen continuity and durable scene/process state | InnerLore; Narrative Engine | Audit specific code and tests before selecting implementation |
| Knowledge provenance, visibility and delivery receipts | InnerLore | Adapt fields; extend for multiple valid sources and causal invalidation |
| Save/load/fork and branch isolation | Mnehmos; Narrative Engine | Adapt canonical-vs-derived boundary; test branch divergence |
| Typed variable presets / admin tracker | State Engine | Optional UI/editor aid only |
| Location/time/weather/scene context | Immersive Worlds | Optional ST adapter feature, not universal core |

## 8. Reuse gate before importing code

Before copying or porting any code, record:

1. Exact source file and commit SHA.
2. License and required notices for that file.
3. Runtime dependencies and host-version assumptions.
4. Existing tests and which of our acceptance tests they cover.
5. Required modifications to meet our contracts.
6. Whether the code touches the vectorization patch, canonical DB, chat metadata or ST lifecycle.
7. A decision: reuse as-is, adapt, use as a reference only, or reject.

No code has been imported by this audit. The immediate output is a prioritized design map for the next architecture pass.
