import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNpcAutonomyCycle } from "../src/npc/autonomy-cycle.js";

const base = () => ({
  prior_decision: {
    id: "decision-1",
    option_id: "protect-contact",
    context_ref: "snapshot-1",
    reason_refs: ["reason:promise"],
    conflict_refs: [],
  },
  current_context: {
    snapshot_ref: "snapshot-2",
    assessment_complete: true,
    changes: [],
  },
  plan: {
    id: "plan-1",
    status: "active",
    assumptions: [{ id: "route-open" }],
    blockers: [{ id: "contact-available" }],
  },
  assessment: {
    assumptions: [{ id: "route-open", outcome: "holds" }],
    blockers: [{ id: "contact-available", outcome: "clear" }],
    deadline: "not_due",
  },
  goals: [{ id: "protect-contact", status: "active", priority: 80 }],
  actions: [{
    id: "call-contact",
    goal_id: "protect-contact",
    allowed: true,
    preconditions_met: true,
    cost: 10,
  }],
});

test("selects an intention only after reconsideration and plan viability pass", () => {
  assert.deepEqual(evaluateNpcAutonomyCycle(base()), {
    status: "intention_selected",
    stage: "complete",
    intention: { goal_id: "protect-contact", action_id: "call-contact" },
    reconsideration: {
      status: "no_material_change",
      reason: "no_relevant_change_detected",
      review_required: false,
      preserved_prior_basis: {
        decision_id: "decision-1",
        option_id: "protect-contact",
        context_ref: "snapshot-1",
        reason_refs: ["reason:promise"],
        conflict_refs: [],
      },
      current_context_ref: "snapshot-2",
      change_refs: { relevant: [], unknown: [], irrelevant: [] },
    },
    viability: { status: "evaluated", disposition: "continue", reasons: [] },
  });
});

test("known material changes stop selection and request reconsideration", () => {
  const input = base();
  input.current_context.changes.push({
    id: "change-1",
    kind: "assumption_changed",
    relevance: "relevant",
    source_ref: "evidence:route-closed",
  });
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "reconsideration_required");
  assert.equal(result.stage, "reconsideration");
  assert.equal(result.intention, null);
});

test("unknown change relevance or incomplete context stops selection for review", () => {
  const input = base();
  input.current_context.assessment_complete = false;
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "review_required");
  assert.equal(result.stage, "reconsideration");
  assert.equal(result.intention, null);
});

test("a contradicted plan assumption stops selection for plan reconsideration", () => {
  const input = base();
  input.assessment.assumptions[0].outcome = "contradicted";
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "plan_not_ready");
  assert.equal(result.viability.disposition, "reconsider");
  assert.equal(result.intention, null);
});

test("an active blocker prevents selection", () => {
  const input = base();
  input.assessment.blockers[0].outcome = "active";
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "plan_not_ready");
  assert.equal(result.viability.disposition, "blocked");
});

test("unknown or incomplete plan assessment cannot be treated as viable", () => {
  const input = base();
  input.assessment.assumptions = [];
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "plan_not_ready");
  assert.equal(result.viability.disposition, "needs_review");
});

test("a blocked plan that becomes a resume candidate is not silently unblocked", () => {
  const input = base();
  input.plan.status = "blocked";
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "plan_not_ready");
  assert.equal(result.viability.disposition, "resume_candidate");
});

test("terminal plans do not produce new intentions", () => {
  const input = base();
  input.plan.status = "completed";
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "no_active_plan");
  assert.equal(result.intention, null);
});

test("no eligible action is a valid bounded outcome", () => {
  const input = base();
  input.actions[0].preconditions_met = false;
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "no_eligible_action");
  assert.equal(result.intention, null);
});

test("malformed input and malformed nested contracts fail closed", () => {
  assert.deepEqual(evaluateNpcAutonomyCycle(null), {
    status: "non_ready", stage: "input", intention: null, detail: null,
  });
  const input = base();
  input.goals[0].priority = 101;
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "non_ready");
  assert.equal(result.stage, "intention_selection");
  assert.equal(result.intention, null);
});

test("does not mutate caller-owned input", () => {
  const input = base();
  const before = structuredClone(input);
  evaluateNpcAutonomyCycle(input);
  assert.deepEqual(input, before);
});

test("reflection traps fail closed", () => {
  const hostile = new Proxy({}, {
    getPrototypeOf() { throw new Error("prototype trap"); },
  });
  assert.equal(evaluateNpcAutonomyCycle(hostile).status, "non_ready");
});
