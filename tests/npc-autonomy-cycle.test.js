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
    steps: [{ id: "step-1", action_id: "call-contact", status: "active" }],
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
  conflict_assessment: {
    motives: [{ id: "protect-contact", kind: "obligation" }],
    options: [{
      id: "call-contact",
      supports: ["protect-contact"],
      frustrates: [],
      motive_assessment_complete: true,
      feasibility: "feasible",
      hard_constraints_complete: true,
      hard_constraints: [],
    }],
    resolutions: [],
  },
});

test("selects an intention only after reconsideration, plan viability, and conflict gates pass", () => {
  assert.deepEqual(evaluateNpcAutonomyCycle(base()), {
    status: "intention_selected",
    stage: "complete",
    intention: { goal_id: "protect-contact", action_id: "call-contact" },
    conflict_decision: "ready_for_selection",
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
  assert.equal(result.stage, "intention_selection");
  assert.equal(result.intention, null);
});

test("unresolved motive conflict prevents intention selection", () => {
  const input = base();
  input.conflict_assessment.motives.push({ id: "meet-deadline", kind: "goal" });
  input.conflict_assessment.options[0].frustrates = ["meet-deadline"];
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "review_required");
  assert.equal(result.stage, "internal_conflict");
  assert.equal(result.conflict_decision, "needs_review");
  assert.equal(result.intention, null);
});

test("a violated hard constraint excludes an otherwise high-priority action", () => {
  const input = base();
  input.conflict_assessment.options[0].hard_constraints = [
    { id: "safety", status: "violated" },
  ];
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "no_eligible_action");
  assert.equal(result.stage, "internal_conflict");
  assert.equal(result.conflict_decision, "no_eligible_option");
  assert.equal(result.intention, null);
});

test("an explicit conflict rule can disqualify an action before priority selection", () => {
  const input = base();
  input.conflict_assessment.motives.push({ id: "meet-deadline", kind: "goal" });
  input.conflict_assessment.options[0].supports = ["meet-deadline"];
  input.conflict_assessment.options[0].frustrates = ["protect-contact"];
  input.conflict_assessment.resolutions = [{
    motive_a_id: "meet-deadline",
    motive_b_id: "protect-contact",
    preferred_motive_id: "protect-contact",
    rule_ref: "author:protect-contact-first",
  }];
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "no_eligible_action");
  assert.equal(result.stage, "internal_conflict");
  assert.equal(result.intention, null);
});

test("only the active plan step reaches conflict evaluation and intention selection", () => {
  const input = base();
  input.goals.push({ id: "meet-deadline", status: "active", priority: 100 });
  input.actions.push({
    id: "meet-deadline-action",
    goal_id: "meet-deadline",
    allowed: true,
    preconditions_met: true,
    cost: 1,
  });
  input.conflict_assessment.motives.push({ id: "meet-deadline", kind: "goal" });
  input.conflict_assessment.options.push({
    id: "meet-deadline-action",
    supports: ["meet-deadline"],
    frustrates: ["protect-contact"],
    motive_assessment_complete: true,
    feasibility: "feasible",
    hard_constraints_complete: true,
    hard_constraints: [],
  });

  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "intention_selected");
  assert.equal(result.conflict_decision, "ready_for_selection");
  assert.deepEqual(result.intention, {
    goal_id: "protect-contact",
    action_id: "call-contact",
  });
});

test("the cycle never substitutes a higher-priority action for the active plan step", () => {
  const input = base();
  input.goals.push({ id: "urgent-goal", status: "active", priority: 100 });
  input.actions.push({
    id: "urgent-action",
    goal_id: "urgent-goal",
    allowed: true,
    preconditions_met: true,
    cost: 1,
  });
  input.conflict_assessment.motives.push({ id: "urgent-goal", kind: "goal" });
  input.conflict_assessment.options.push({
    id: "urgent-action",
    supports: ["urgent-goal"],
    frustrates: [],
    motive_assessment_complete: true,
    feasibility: "feasible",
    hard_constraints_complete: true,
    hard_constraints: [],
  });

  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "intention_selected");
  assert.deepEqual(result.intention, {
    goal_id: "protect-contact",
    action_id: "call-contact",
  });
});

test("a missing active-step action returns no action instead of selecting a substitute", () => {
  const input = base();
  input.actions[0].id = "different-action";
  input.conflict_assessment.options[0].id = "different-action";
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "no_eligible_action");
  assert.equal(result.stage, "plan_progress");
  assert.equal(result.intention, null);
});

test("malformed active-step structure fails closed before selection", () => {
  const input = base();
  input.plan.steps[0].status = "pending";
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "non_ready");
  assert.equal(result.stage, "plan_progress");
  assert.equal(result.intention, null);
});

test("action candidates and conflict options require exact one-to-one identity coverage", () => {
  const input = base();
  input.conflict_assessment.options[0].id = "different-action";
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "non_ready");
  assert.equal(result.stage, "internal_conflict");
  assert.equal(result.intention, null);
});

test("an empty action set returns no action without inventing a conflict result", () => {
  const input = base();
  input.actions = [];
  input.conflict_assessment.options = [];
  const result = evaluateNpcAutonomyCycle(input);
  assert.equal(result.status, "no_eligible_action");
  assert.equal(result.stage, "internal_conflict");
  assert.equal(result.conflict_decision, "no_candidates");
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

  const malformedConflict = base();
  malformedConflict.conflict_assessment.options[0].feasibility = "maybe";
  assert.equal(evaluateNpcAutonomyCycle(malformedConflict).status, "non_ready");
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
