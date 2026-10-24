# T4 — pure due-work planning

**Status:** implementation slice in PR; not merged.  
**Scope:** deterministic planning only. No storage, trigger persistence, execution, calendar mutation, NPC knowledge, or delivery.

## API

`planDueWork({ world_id, from_coordinate, to_coordinate, triggers, completed_trigger_ids })` plans pending triggers over the open-start/closed-end interval `(from_coordinate, to_coordinate]`.

Each trigger declares:
- stable `trigger_id` and `world_id`;
- integer `due_coordinate`;
- status (`pending`, `completed`, `cancelled`);
- trigger-ID dependencies;
- declared `read_set` and `write_set` projection references;
- processing metadata (`exact` or `batch`);
- optional `interrupt_after_coordinate`.

The planner validates world isolation, safe integer coordinates, duplicate IDs/references, dependency existence/state, causal time order, and cycles. It does not consult the system clock or a calendar.

## Output semantics

- `planned`: the proposed segments cover the requested interval, including an empty interval with no due triggers.
- `blocked`: one or more due triggers depend on missing, cancelled, or not-yet-due work. No partial segment plan is returned.
- `interrupted`: the plan stops after all planned work at an interrupt coordinate; later due trigger IDs are returned as remaining work.
- `needs_review` is represented by a typed error for same-coordinate conflicts without a declared dependency order.

A segment groups only same-coordinate triggers whose declared read/write sets are independent. Explicit dependency edges create segment boundaries because T3's bounded segment commit does not accept intra-segment dependencies. If conflicting triggers lack a direct dependency edge ordering the pair, the planner does not choose a winner. This conservative rule prevents an unrelated dependency chain from accidentally imposing an order on two conflicting triggers.

Trigger IDs are the deterministic final tie-break after due coordinate. Ordering never creates causality. A dependency scheduled after its dependent is rejected as a causal-time-order conflict.

## Separation of responsibilities

- The planner returns proposals, not confirmed effects. A caller must commit each segment through Core. The current Core request contract still accepts `time_advance_seconds` as whole seconds, while coordinates are milliseconds; therefore an execution adapter must not promise exact sub-second due boundaries until a reviewed millisecond-duration API or explicit alignment rule exists.
- `processing_mode` is preserved as trigger metadata. This planner does not execute or aggregate batch-process effects.
- `interrupt_after_coordinate` is a planning boundary. It does not itself grant knowledge to NPCs or deliver a message to the player.
- The planner does not persist an operation cursor or resume after restart. Durable multi-segment operation state remains a separate integration requirement.

## Acceptance tests

- `(from, to]` boundaries, zero-length interval, and no-trigger advancement plan.
- Stable same-coordinate order and dependency-respecting segment boundaries.
- Missing/not-yet-due/cancelled dependencies block the whole plan.
- Cycles and impossible causal time order fail explicitly.
- Same-coordinate read/write conflicts without causal order require review.
- Interrupt stops the plan after work at its coordinate and leaves later triggers unplanned.
- Cross-world triggers and reversed intervals fail closed.

This module is deliberately pure so its scheduling semantics can be tested without database or NPC side effects.
