import test from "node:test";
import assert from "node:assert/strict";
import { advanceNpcPlan } from "../src/npc/plan-progress.js";

const plan = () => ({
  id: "investigate-rumor",
  status: "active",
  steps: [
    { id: "ask-contact", action_id: "ask-contact", status: "active" },
    { id: "verify-report", action_id: "verify-report", status: "pending" },
  ],
});

test("successful step advances the next pending step without mutating input", () => {
  const original = plan();
  const before = structuredClone(original);
  assert.deepEqual(advanceNpcPlan(original, { type: "step_succeeded", step_id: "ask-contact" }), {
    status: "advanced",
    plan: {
      id: "investigate-rumor",
      status: "active",
      steps: [
        { id: "ask-contact", action_id: "ask-contact", status: "completed" },
        { id: "verify-report", action_id: "verify-report", status: "active" },
      ],
    },
  });
  assert.deepEqual(original, before);
});

test("successful final step completes the plan", () => {
  const current = plan();
  current.steps[0].status = "completed";
  current.steps[1].status = "active";
  assert.deepEqual(advanceNpcPlan(current, { type: "step_succeeded", step_id: "verify-report" }), {
    status: "advanced",
    plan: {
      id: "investigate-rumor",
      status: "completed",
      steps: [
        { id: "ask-contact", action_id: "ask-contact", status: "completed" },
        { id: "verify-report", action_id: "verify-report", status: "completed" },
      ],
    },
  });
});

test("blocked steps pause the plan and explicit unblock resumes the same step", () => {
  const paused = advanceNpcPlan(plan(), { type: "step_blocked", step_id: "ask-contact" });
  assert.equal(paused.plan.status, "blocked");
  assert.equal(paused.plan.steps[0].status, "blocked");
  assert.deepEqual(advanceNpcPlan(paused.plan, { type: "step_unblocked", step_id: "ask-contact" }), {
    status: "advanced",
    plan: {
      id: "investigate-rumor",
      status: "active",
      steps: [
        { id: "ask-contact", action_id: "ask-contact", status: "active" },
        { id: "verify-report", action_id: "verify-report", status: "pending" },
      ],
    },
  });
});

test("rejects mismatched, malformed, or out-of-order events", () => {
  const cases = [
    [plan(), { type: "step_succeeded", step_id: "verify-report" }],
    [plan(), { type: "step_unblocked", step_id: "ask-contact" }],
    [plan(), { type: "invented", step_id: "ask-contact" }],
    [plan(), { type: "step_succeeded", step_id: "missing" }],
    [{ ...plan(), steps: [] }, { type: "abandon" }],
    [{ ...plan(), status: "completed" }, { type: "abandon" }],
    [plan(), null],
  ];
  for (const [candidate, event] of cases) {
    assert.deepEqual(advanceNpcPlan(candidate, event), { status: "non_ready", plan: null });
  }
});

test("abandonment is terminal and malformed plan sequences fail closed", () => {
  const abandoned = advanceNpcPlan(plan(), { type: "abandon" });
  assert.equal(abandoned.plan.status, "abandoned");
  assert.deepEqual(advanceNpcPlan(abandoned.plan, { type: "step_unblocked", step_id: "ask-contact" }), {
    status: "non_ready",
    plan: null,
  });

  const invalid = plan();
  invalid.steps[1].status = "active";
  assert.deepEqual(advanceNpcPlan(invalid, { type: "abandon" }), { status: "non_ready", plan: null });
});

test("rejects blocked plans whose step order cannot be resumed sequentially", () => {
  const pendingBeforeBlocked = {
    id: "bad-plan",
    status: "blocked",
    steps: [
      { id: "first", action_id: "first-action", status: "pending" },
      { id: "second", action_id: "second-action", status: "blocked" },
    ],
  };
  const completedAfterBlocked = {
    id: "bad-plan",
    status: "blocked",
    steps: [
      { id: "first", action_id: "first-action", status: "blocked" },
      { id: "second", action_id: "second-action", status: "completed" },
    ],
  };

  assert.deepEqual(advanceNpcPlan(pendingBeforeBlocked, { type: "step_unblocked", step_id: "second" }), {
    status: "non_ready",
    plan: null,
  });
  assert.deepEqual(advanceNpcPlan(completedAfterBlocked, { type: "step_unblocked", step_id: "first" }), {
    status: "non_ready",
    plan: null,
  });
});

test("rejects abandoned plans with impossible step sequences", () => {
  const malformed = [
    {
      id: "bad-abandoned",
      status: "abandoned",
      steps: [
        { id: "first", action_id: "first-action", status: "pending" },
        { id: "second", action_id: "second-action", status: "active" },
      ],
    },
    {
      id: "bad-abandoned",
      status: "abandoned",
      steps: [
        { id: "first", action_id: "first-action", status: "active" },
        { id: "second", action_id: "second-action", status: "blocked" },
      ],
    },
  ];
  for (const candidate of malformed) {
    assert.deepEqual(advanceNpcPlan(candidate, { type: "abandon" }), { status: "non_ready", plan: null });
  }
});

test("rejects accessor-backed plan steps without invoking them", () => {
  let invoked = false;
  const steps = [];
  Object.defineProperty(steps, "0", {
    enumerable: true,
    configurable: true,
    get() { invoked = true; return { id: "step", action_id: "action", status: "active" }; },
  });
  steps.length = 1;
  const candidate = { id: "accessor-plan", status: "active", steps };
  assert.deepEqual(advanceNpcPlan(candidate, { type: "abandon" }), { status: "non_ready", plan: null });
  assert.equal(invoked, false);
});
