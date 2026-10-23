# 12. Roadmap and implementation gates

Status: proposed delivery plan. A phase may start only when its exit criteria are met.

## Stage 1 — architecture and contracts (current)

Deliver:
- core domain model and authority boundaries;
- Turn/WorldEvent/Delivery lifecycle;
- world-pack manifest and bounded rule DSL;
- causal rollback semantics and test cases;
- knowledge and off-screen process contracts;
- storage, isolation, backup and recovery decisions;
- external project reuse register;
- target SillyTavern lifecycle verification plan.

Exit gate: P0 questions in docs/10-open-decisions.md are resolved or explicitly accepted as prototype blockers; architecture review has no unresolved contradiction that would make data unsafe.

## Stage 2 — minimal executable core

Do not start before Stage 1 review. Implement only:
- schema validation for pack manifests, rules, action proposals and rollback plans;
- canonical storage adapter and atomic revision/idempotency behavior;
- one world, one minimal pack, entity/fact/event records;
- deterministic rule evaluation for the bounded operator set;
- append-only audit and current-state projection;
- basic event/turn commit pipeline;
- tests for invalid proposals, stale read-set, idempotency and recovery.

No autonomous LLM orchestration or full SillyTavern integration is required in the first slice.

## Stage 3 — causal rollback

Implement:
- generation/message identity mapping through a test adapter;
- causal metadata and read-set recording;
- rollback plan preview and validation;
- invalidation/recomputation for facts and knowledge with multiple sources;
- process-stage and StoryBeat recomputation;
- rollback idempotency and conflict records.

Exit gate: RB-001–RB-014 pass, including independent-branch preservation and stale projection checks.

## Stage 4 — Process Manager and NPC autonomy

Implement:
- durable goals, plans, tasks and process stages;
- scheduler and explicit time advancement;
- filtered actor decision context;
- model-proposed action pipeline with deterministic validation;
- off-screen event storage and controlled revelation.

Exit gate: process restart, time progression, knowledge boundaries and rollback tests pass.

## Stage 5 — SillyTavern adapter

Only after host lifecycle research:
- map user messages, generations, swipes, deletes, regeneration and cancellation;
- send explicit action/time-advance requests;
- deliver approved narrative output and track receipts;
- handle stale asynchronous responses;
- integrate with existing vectorization only through a separate read-only adapter.

Exit gate: integration tests against the user's actual Android/Termux ST version. Unsupported hooks must be documented and have a safe fallback.

## Stage 6 — administration UI and World Pack tooling

Add:
- world/pack selection;
- state, knowledge, process, event and causal graph inspection;
- rollback plan preview and conflict resolution;
- author-approved fact editing and migration preview;
- backups and restore workflow.

## Stage 7 — optimization and additional packs

Only after correctness:
- benchmark one vs separate database per world;
- evaluate process batching and projection rebuilds;
- add conformance packs for materially different world types;
- evaluate optional vector retrieval adapters without making them authoritative.

## Explicit non-goals for the first prototype

- arbitrary executable code inside World Packs;
- replacing the user's vectorization patch;
- autonomous world simulation driven only by free-form prompt instructions;
- public unauthenticated API;
- promise of perfect rollback when the host cannot identify the changed generation or provenance was never recorded.
