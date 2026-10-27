import test from "node:test";
import assert from "node:assert/strict";
import { selectNpcIntention } from "../src/npc/autonomous-intention-selector.js";

const goal = (id, priority, status = "active") => ({ id, priority, status });
const action = (id, goal_id, overrides = {}) => ({
  id,
  goal_id,
  allowed: true,
  preconditions_met: true,
  cost: 10,
  ...overrides,
});

test("selects an action for the highest-priority active goal", () => {
  assert.deepEqual(selectNpcIntention({
    goals: [goal("keep-promise", 70), goal("get-money", 30)],
    actions: [action("earn-cash", "get-money"), action("call-contact", "keep-promise")],
  }), {
    status: "selected",
    intention: { goal_id: "keep-promise", action_id: "call-contact" },
  });
});

test("does not select blocked, completed, disallowed, or impossible actions", () => {
  assert.deepEqual(selectNpcIntention({
    goals: [goal("blocked-goal", 100, "blocked"), goal("done-goal", 99, "completed"), goal("active-goal", 10)],
    actions: [
      action("blocked-action", "blocked-goal"),
      action("done-action", "done-goal"),
      action("denied-action", "active-goal", { allowed: false }),
      action("impossible-action", "active-goal", { preconditions_met: false }),
    ],
  }), { status: "no_eligible_action", intention: null });
});

test("chooses lower-cost action, then stable lexical IDs on ties", () => {
  const result = selectNpcIntention({
    goals: [goal("goal-b", 50), goal("goal-a", 50)],
    actions: [
      action("z-action", "goal-a", { cost: 5 }),
      action("b-action", "goal-b", { cost: 5 }),
      action("cheap-action", "goal-a", { cost: 4 }),
    ],
  });
  assert.deepEqual(result, { status: "selected", intention: { goal_id: "goal-a", action_id: "cheap-action" } });

  const tie = selectNpcIntention({
    goals: [goal("goal-b", 50), goal("goal-a", 50)],
    actions: [action("z-action", "goal-a", { cost: 5 }), action("b-action", "goal-b", { cost: 5 })],
  });
  assert.deepEqual(tie, { status: "selected", intention: { goal_id: "goal-a", action_id: "z-action" } });
});

test("returns no action when no candidates exist", () => {
  assert.deepEqual(selectNpcIntention({ goals: [goal("g", 1)], actions: [] }), {
    status: "no_eligible_action",
    intention: null,
  });
});

test("fails closed for malformed inputs and ambiguous duplicate IDs", () => {
  const cases = [
    null,
    {},
    { goals: [], actions: [action("a", "missing")] },
    { goals: [goal("g", 1), goal("g", 2)], actions: [action("a", "g")] },
    { goals: [goal("g", 1)], actions: [action("a", "g"), action("a", "g")] },
    { goals: [goal("g", 101)], actions: [action("a", "g")] },
    { goals: [goal("g", 1)], actions: [action("a", "g", { cost: -1 })] },
    { goals: [goal("g", 1)], actions: new Array(1) },
  ];
  for (const input of cases) {
    assert.deepEqual(selectNpcIntention(input), { status: "non_ready", intention: null });
  }
});

test("does not mutate caller-owned goals or action candidates", () => {
  const input = {
    goals: [goal("g", 5)],
    actions: [action("a", "g")],
  };
  const before = structuredClone(input);
  selectNpcIntention(input);
  assert.deepEqual(input, before);
});
