# 08. Stage 1 acceptance plan

Status: proposed gate before implementation. Stage 1 is architecture/contracts and test design, not a claim of a working runtime.

## 1. Exit criteria

Stage 1 is complete when:
- core domain record contracts are reviewed;
- Turn, WorldEvent, Delivery and rollback lifecycles are reconciled;
- world-pack manifest and declarative rule constraints are defined;
- storage/isolation decision is supported by explicit trade-offs;
- causal rollback algorithm handles alternative sources and partial process stages;
- ST adapter contract is based on verified target-version hooks or records the unsupported signals clearly;
- conformance and failure-injection tests are specified;
- backup/restore and migration behavior are defined;
- all P0 decisions are either resolved or explicitly accepted as blockers for a prototype.

## 2. Test profiles

### Profile A: realistic/biological world
A pack may define bodies, health, death, organizations, money and physical travel. These are pack-defined concepts, not universal fields.

### Profile B: magic/fictional rules world
A pack defines magic types, costs, targeting, secrecy and counter-rules. Unknown magic behavior must not be invented as a canonical rule.

### Profile C: distributed/digital world
Entities may be services, nodes, agents, copies, permissions or messages. The core must not require bodies, biological life, physical locations or human relationships.

Passing all three profiles is evidence of generality across tested cases, not proof of universality for all possible worlds.

## 3. Acceptance matrix

- CORE-001: create a world with no money/faction/body schema; core works without synthesizing those fields.
- CORE-002: create two worlds with different packs; no cross-world retrieval or record access.
- CORE-003: unknown action mechanics enter needs_review or are blocked according to pack policy.
- CORE-004: invalid effect schema is rejected before commit.
- CORE-005: generated narration alone cannot create a canonical state mutation.
- CORE-006: stale proposal with changed read-set is revalidated/rejected.
- TIME-001: wall-clock delay does not advance game_time.
- TIME-002: explicit time advance progresses all due processes in deterministic order.
- TIME-003: deterministic tie-break is stable; order alone does not create causal dependency.
- KNOW-001: NPC cannot use a secret without a valid knowledge source.
- KNOW-002: retrieved vector fragment is filtered when its source is invalid/private to another subject.
- KNOW-003: a false belief can remain distinct from canonical truth.
- PROC-001: a durable process continues after restart without relying on prompt memory.
- PROC-002: interrupted process resumes according to declared policy.
- STORY-001: StoryBeat completion requires a validated structured postcondition.
- STORY-002: rollback invalidating a postcondition removes current completion but preserves audit.
- ROLLBACK tests RB-001 through RB-014 are defined in docs/05-causal-rollback-algorithm.md.
- DELIVERY-001: retry does not recommit world effects.
- DELIVERY-002: injected_unconfirmed is never silently upgraded to shown.
- MIGRATION-001: World Pack migration reports incompatible active processes and does not silently rewrite history.
- RECOVERY-001: restore from backup reproduces canonical state and revision metadata.
- ADAPTER-001: message delete/swipe maps to exact generation identity where supported.
- ADAPTER-002: unavailable host identity creates explicit review rather than text-hash guessing.

## 4. Required failure injection

Test process termination:
- before validation;
- after validation but before commit;
- during atomic commit;
- after commit before narration;
- after injection without shown confirmation;
- during rollback planning;
- after rollback plan but before commit;
- after rollback commit before projection rebuild.

Expected behavior must be specified for each point: no partial canonical mutation, no duplicate effect, no silent stale projection, and idempotent recovery.

## 5. External runtime verification

Before adapter implementation:
1. record installed SillyTavern version/commit and Android/Termux environment;
2. inspect relevant lifecycle events read-only;
3. verify message, swipe, regenerate, delete and cancellation identifiers;
4. test stale asynchronous generation behavior;
5. verify PC server reachability from phone over a private network without exposing public ports;
6. inspect the existing vectorization patch read-only and document its API/storage boundaries.
