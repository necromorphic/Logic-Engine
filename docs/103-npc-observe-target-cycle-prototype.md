# NPC Observe Target — Read-Only Cycle Prototype

**Status:** isolated prototype; not production integration.  
**Date:** 2026-10-31.  
**Branch:** `npc/observe-target-cycle-prototype-2026-10-31`.

## 1. Purpose

Prove the smallest useful NPC observation cycle using the existing Core `AuthorizedReadService`: one authenticated NPC actor requests one attribute from one target, Core applies its current field policy and actor binding, and the caller receives a bounded result envelope tied to the exact world snapshot and policy generation.

This is deliberately narrower than a general observation API. It is a read-only experiment, not an NPC goal family and not a complete autonomous loop.

## 2. Call path

```text
Host-owned trusted context provider
  ├─ authenticated adapter identity
  ├─ canonical actor identity
  ├─ expected (world_revision, commit_sequence)
  └─ current versioned policy-authority snapshot
             |
             v
NPC ObserveTargetCycle.observeTarget({ targetEntityId, attribute })
             |
             v
Core AuthorizedReadService.readEntityAttributeForMechanic(...)
  ├─ verifies actor binding
  ├─ requires versioned policy authority
  ├─ checks one target and one attribute
  ├─ checks expected world snapshot
  ├─ applies field-level policy
  ├─ rechecks actor binding and world snapshot
  └─ rechecks policy generation
             |
             v
Immutable in-process observation receipt
```

The cycle fixes `recipient=model` and `purpose=npc_decision`. The caller cannot override world, adapter, actor, purpose, recipient, snapshot cursor, or policy authority through the observation input.

## 3. Receipt semantics

A successful result has:

- receipt type `npc.observe-target.receipt.v1`;
- exact world, adapter, actor, target, attribute, recipient, and purpose;
- the Core `world_revision` and `commit_sequence`;
- the versioned policy-authority identity and generation;
- `present` and, only when present, the authorized value.

An authorized but absent attribute is represented as `present: false` with no `value`. A denied, missing, stale, revoked, or otherwise unavailable read throws/fails closed; it does not create a receipt.

The receipt is an immutable **in-process result envelope**, not a cryptographic signature, durable record, authorization token, Core event, or portable proof. Its trust derives from the private Host context provider and the successful Core AuthorizedReadService call in the same process. Consumers must not accept caller-constructed receipt-shaped objects as evidence.

## 4. Safety properties exercised

The prototype tests that:

1. exactly one target and one attribute are accepted;
2. the target field is disclosed only when Core policy allows it;
3. the result is bound to the authenticated actor and adapter context;
4. the purpose and recipient are fixed by the cycle;
5. an authorized absent field is distinct from a denied field;
6. revoked actor binding prevents disclosure;
7. stale world snapshot prevents disclosure;
8. observation does not change world revision, commit sequence, canonical events, or Core audit history.

## 5. Explicit non-goals

This prototype does not:

- generate, admit, accept, or persist NPC goals;
- choose targets or fields autonomously;
- create NPC beliefs, knowledge records, memories, or provenance graphs;
- write to the GoalPlanRepository or any NPC database;
- emit Core events or mutate canonical world state;
- schedule or repeat observations;
- call an LLM or expose a model tool / HTTP endpoint;
- establish a durable receipt or rollback invalidation feed;
- establish production Host wiring, deployment configuration, or multi-process guarantees.

The existing Core authorized-read service remains the security authority. The NPC module is only a constrained composition layer and must not replace or bypass that service.

## 6. Production gates still open

Before production use, the project must provide and review:

1. a real Host-owned trusted context provider backed by authenticated adapter/session state (not a test closure or model output);
2. explicit policy for which NPC actors may observe which target classes and attributes;
3. a decision on whether a durable observation record is needed and, if so, its owner, retention, idempotency, and rollback semantics;
4. Core/Host integration tests covering revocation, policy-generation changes, stale snapshots, and process boundaries;
5. independent security review of the complete call path.

No production runtime wiring is authorized by this prototype. The separate NPC GoalPlanRepository, Issue #770 SQLite-open gate, and PR #838 authorization work remain independent; this branch does not merge or supersede them.
