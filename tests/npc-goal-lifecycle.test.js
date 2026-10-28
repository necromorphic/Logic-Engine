import test from "node:test";
import assert from "node:assert/strict";
import { transitionNpcGoal } from "../src/npc/goal-lifecycle.js";

test("supports active to blocked to active transitions without mutating input", () => {
  const goal = { id: "protect-contact", status: "active", priority: 70 };
  const blocked = transitionNpcGoal(goal, "block");
  assert.deepEqual(blocked, {
    status: "transitioned",
    goal: { id: "protect-contact", status: "blocked", priority: 70 },
  });
  assert.deepEqual(transitionNpcGoal(blocked.goal, "unblock"), {
    status: "transitioned",
    goal: { id: "protect-contact", status: "active", priority: 70 },
  });
  assert.deepEqual(goal, { id: "protect-contact", status: "active", priority: 70 });
});

test("allows active or blocked goals to become terminal", () => {
  for (const status of ["active", "blocked"]) {
    assert.equal(transitionNpcGoal({ id: "g", status }, "complete").goal.status, "completed");
    assert.equal(transitionNpcGoal({ id: "g", status }, "abandon").goal.status, "abandoned");
  }
});

test("terminal goals cannot be reopened or changed", () => {
  for (const status of ["completed", "abandoned"]) {
    for (const event of ["block", "unblock", "complete", "abandon"]) {
      assert.deepEqual(transitionNpcGoal({ id: "g", status }, event), {
        status: "non_ready",
        goal: null,
      });
    }
  }
});

test("rejects invalid transitions and malformed inputs", () => {
  const cases = [
    [null, "block"],
    [{ id: "g", status: "blocked" }, "block"],
    [{ id: "g", status: "active" }, "unblock"],
    [{ id: "g", status: "unknown" }, "complete"],
    [{ id: " " , status: "active" }, "complete"],
    [{ id: "g", status: "active" }, "invented-event"],
    [{ id: "g", status: "active" }, null],
  ];
  for (const [goal, event] of cases) {
    assert.deepEqual(transitionNpcGoal(goal, event), { status: "non_ready", goal: null });
  }
});

test("rejects accessor-backed goal objects without reading accessor values", () => {
  let invoked = false;
  const goal = { id: "g", status: "active" };
  Object.defineProperty(goal, "priority", { enumerable: true, get() { invoked = true; return 1; } });
  assert.deepEqual(transitionNpcGoal(goal, "complete"), { status: "non_ready", goal: null });
  assert.equal(invoked, false);
});

test("rejects non-string lifecycle events without coercing them", () => {
  let coerced = false;
  const event = { [Symbol.toPrimitive]() { coerced = true; return "complete"; } };
  assert.deepEqual(transitionNpcGoal({ id: "g", status: "active" }, event), {
    status: "non_ready",
    goal: null,
  });
  assert.equal(coerced, false);
});
