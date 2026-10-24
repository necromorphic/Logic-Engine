# Personality Block → Core Architecture Review Request

Status: review request only; no runtime/API/schema/storage implementation is authorized. This document is on `feat/personality-subsystem` and belongs to the Personality block, not the NPC subsystem.

## Request

Please approve or revise the semantic-to-core boundary below so the Personality block can finish its contract without inventing core capabilities.

### 1. Proposed ownership split

- **Personality block:** defines personality and relationship semantics, state-origin distinctions, decision-use constraints, and semantic acceptance criteria.
- **Core engine:** owns canonical entity identity, typed writes, event/revision/audit lifecycle, authorization, persistence/projection, and rollback/reconciliation.
- **NPC subsystem:** consumes authorized personality/relationship projections during decision-making; owns autonomy and decision orchestration, not a parallel canonical store.
- **Character card:** read-only derived view over authorized canonical records.

Please confirm this split or identify any ownership conflict.

### 2. Minimum relationship write contract

The semantic contract requires a typed canonical operation that:

- names two already-existing canonical `entity_id` participants and preserves direction;
- validates domain-supported dimensions and values;
- supports partial updates without resetting omitted dimensions;
- distinguishes author-initial/imported state, in-world transition, and author correction;
- commits atomically through the existing event, revision, and audit lifecycle;
- is replayable/rebuildable deterministically;
- rejects unresolved participants and unsupported self-relations;
- does not infer knowledge, consent, trustworthiness, or reciprocal state from the relationship alone.

This is a behavioral requirement, not a proposed final JSON payload or API signature. The core should choose the exact effect name and representation consistent with its typed-effect conventions.

### 3. Read contract

A snapshot or raw projection is not authorization. Before personality/relationship information is supplied to an actor or used for decision-making, the core must expose a bounded read result filtered by actor, purpose, world scope, visibility, sensitivity, and current validity.

The result must preserve the distinction between:
- known value;
- unset/unknown;
- inaccessible/withheld;
- disputed/conflicted, where supported.

The Personality block does not propose to own or implement the access filter.

### 4. Rollback: required decision

The current limited rollback contract must not be mistaken for proof-complete causality. In particular, a list of causal parents cannot be assumed to mean “any one of these independently supports the outcome.” If the current engine invalidates a child when one declared parent is invalidated, that representation encodes required dependency, not alternative support.

The core should choose and test one of these models:

**Option A — Independent replayable typed effects.** Each valid event contributes its own typed transition; after rollback, replay remaining valid events in canonical order. Best when the relationship state can be deterministically derived from the sequence of surviving transitions. Risk: does not by itself express a conclusion that requires combining or reconciling several sources.

**Option B — Explicit alternative-support records.** Store typed support/evidence separately from required causal dependencies; reconcile the relationship dimension against surviving supports. Best when several independent causes can sustain one conclusion. Risk: requires explicit domain rules for sufficiency, conflict, precedence, and removal.

**Option C — Bounded hybrid.** Use ordinary causal metadata only for prerequisites that are genuinely required, and a typed domain-specific support model only for dimensions whose meaning requires independent evidence. Best when both event ordering and multi-source support matter. Risk: more contract complexity; must not turn into an unbounded generic causal graph invented by a subsystem.

**Recommendation:** prefer Option A only if replay of independent typed transitions is sufficient for the relationship domain. Otherwise use Option C with a narrow typed support contract. Do not use `caused_by` as an OR-support list without an explicit core guarantee. The core must decide the model and own the algorithm.

Required rollback outcomes:
- if the only valid support for a transition is rolled back, remove or recompute the dependent state;
- if one source is rolled back but another independent valid support remains sufficient, preserve the supported result;
- if remaining evidence is contradictory or insufficient, apply an explicit domain rule or expose a conflict/unknown state rather than guessing;
- retain audit history while rebuilding the current projection.

### 5. Decisions requested from the main architecture chat

1. Approve/revise the ownership split in section 1.
2. Confirm that relationship state requires a typed canonical operation rather than generic entity attributes or append-only fact claims.
3. Select the rollback/support model in section 4, or specify the existing core mechanism that already meets the requirements.
4. Name the authoritative actor/purpose-filtered read seam, or identify the core work required before it exists.
5. Define how initialization/import and author correction enter the canonical event/audit lifecycle.
6. Identify the production tests that will prove atomic write, authorized read, deterministic rebuild, and multi-cause rollback.

### 6. Explicit non-claims

This request does not claim that the proposed typed operation, authorized read, alternative-support model, or complete rollback algorithm already exists. It does not authorize changes to runtime code, public API, schema, SQLite storage, prompts, or character-card output. Until the decisions and tests exist, the Personality block remains in semantic-contract and acceptance-design work.


---

## 7. Architecture response and disposition (2026-10-24)

The main architecture decision has answered the six questions above. This file is retained as the original review request; the authoritative consolidated decision and implementation gates are recorded in [`03-core-decision-and-integration-gates.md`](./03-core-decision-and-integration-gates.md).

Disposition:

1. **Ownership split — approved.** World Pack defines world-specific relationship dimensions and semantics; core owns universal canonical guarantees; NPC consumes authorized projections; character cards are derived read-only views.
2. **Typed relationship operation — required.** Generic entity attributes and `fact.set` are not substitutes. Exact effect payload/name, API, and storage remain unapproved.
3. **Causality — conditional Option A target; first-slice representation remains open.** Core approves deterministic replay of surviving valid typed transitions only where replay is semantically sufficient. The first-slice contract must still specify whether it is restricted to replayable independent transitions or needs any genuinely alternative-support case. `caused_by` and `depends_on` are required-dependency metadata, not OR-support lists. Multi-evidence sufficiency/conflict remains unsupported until a narrow typed support/reconciliation rule is defined and tested; no universal alternative-support store is approved.
4. **Authorized read — blocking.** A consistent snapshot is not authorization. No ready actor/purpose-filtered relationship read interface has been confirmed.
5. **Initial/import and author correction — separate authorized operations; trusted boundary still open.** Generic event/audit infrastructure exists, but a trusted author/actor authorization boundary that distinguishes author-initial/import, in-world transition, and author correction is not established. Provenance must be auditable and cannot be trusted merely because a caller supplied an `origin` field.
6. **Production tests — required before implementation readiness.** Atomic typed writes, partial updates, identity/direction, provenance, authorized reads, deterministic rebuild, dependent rollback, independent support, conflict handling, and read-only card projection must be tested against real production boundaries.

No runtime, API, schema, storage, prompt, or UI change is authorized by this response. Remaining Core gates are: (a) close the first-slice causal representation, (b) define the trusted authoring/import/correction command and audit boundary, (c) define the actor/purpose/snapshot-scoped read/filter contract and safe result states, and (d) verify the typed relationship operation against existing effect conventions with real atomicity/provenance/replay tests. Personality semantic design may continue; implementation remains blocked until the contracts and tests described in document 03 are agreed.
