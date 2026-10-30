import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNpcInternalConflict } from "../src/npc/internal-conflict-evaluator.js";

const base = () => ({
  motives: [
    { id: "protect-friend", kind: "obligation" },
    { id: "meet-deadline", kind: "goal" },
  ],
  options: [
    {
      id: "help-friend",
      supports: ["protect-friend"],
      frustrates: [],
      motive_assessment_complete: true,
      feasibility: "feasible",
      hard_constraints_complete: true,
      hard_constraints: [{ id: "lawful", status: "clear" }],
    },
    {
      id: "meet-deadline",
      supports: ["meet-deadline"],
      frustrates: [],
      motive_assessment_complete: true,
      feasibility: "feasible",
      hard_constraints_complete: true,
      hard_constraints: [{ id: "lawful", status: "clear" }],
    },
  ],
  resolutions: [],
});

test("classifies independent options without selecting a winner", () => {
  const result = evaluateNpcInternalConflict(base());
  assert.equal(result.status, "evaluated");
  assert.equal(result.decision, "ready_for_selection");
  assert.deepEqual(result.eligible_option_ids, ["help-friend", "meet-deadline"]);
  assert.equal("selected_option_id" in result, false);
});

test("preserves an unresolved obligation-versus-goal conflict for review", () => {
  const input = base();
  input.options[1].frustrates = ["protect-friend"];
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[1].status, "needs_review");
  assert.equal(result.options[1].reason, "unresolved_motive_conflict");
  assert.deepEqual(result.review_option_ids, ["meet-deadline"]);
});

test("an explicit rule can resolve a conflict in favor of the candidate", () => {
  const input = base();
  input.options[1].frustrates = ["protect-friend"];
  input.resolutions = [{
    motive_a_id: "meet-deadline",
    motive_b_id: "protect-friend",
    preferred_motive_id: "meet-deadline",
    rule_ref: "world-pack:emergency-deadline-rule",
  }];
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[1].status, "eligible");
  assert.equal(result.options[1].conflict_pairs[0].status, "resolved_for_option");
  assert.equal(result.options[1].reason, "conflicts_resolved");
});

test("a rule resolving the conflict against the candidate makes it ineligible", () => {
  const input = base();
  input.options[1].frustrates = ["protect-friend"];
  input.resolutions = [{
    motive_a_id: "meet-deadline",
    motive_b_id: "protect-friend",
    preferred_motive_id: "protect-friend",
    rule_ref: "author:protect-friend-first",
  }];
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[1].status, "ineligible");
  assert.equal(result.options[1].reason, "explicit_resolution_opposes_option");
});

test("hard constraint violation is not a low priority and excludes the option", () => {
  const input = base();
  input.options[0].hard_constraints[0].status = "violated";
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[0].status, "ineligible");
  assert.equal(result.options[0].reason, "hard_constraint_violated");
});

test("unknown hard constraint or feasibility remains unresolved", () => {
  const input = base();
  input.options[0].hard_constraints[0].status = "unknown";
  input.options[1].feasibility = "unknown";
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[0].status, "needs_review");
  assert.equal(result.options[1].status, "needs_review");
  assert.deepEqual(result.review_option_ids, ["help-friend", "meet-deadline"]);
});

test("incomplete motive or hard-constraint coverage requires review", () => {
  const input = base();
  input.options[0].motive_assessment_complete = false;
  input.options[1].hard_constraints_complete = false;
  input.options[1].hard_constraints = [];
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[0].status, "needs_review");
  assert.equal(result.options[0].reason, "motive_assessment_incomplete");
  assert.equal(result.options[1].status, "needs_review");
  assert.equal(result.options[1].reason, "hard_constraint_coverage_incomplete");
});

test("rejects unknown motive references, duplicate resolution pairs, and missing rule references", () => {
  const unknown = base();
  unknown.options[0].supports = ["not-a-motive"];
  assert.equal(evaluateNpcInternalConflict(unknown).status, "non_ready");

  const duplicate = base();
  const resolution = {
    motive_a_id: "meet-deadline",
    motive_b_id: "protect-friend",
    preferred_motive_id: "meet-deadline",
    rule_ref: "rule:a",
  };
  duplicate.resolutions = [resolution, {
    ...resolution,
    motive_a_id: "protect-friend",
    motive_b_id: "meet-deadline",
  }];
  assert.equal(evaluateNpcInternalConflict(duplicate).status, "non_ready");

  const missingRule = base();
  missingRule.resolutions = [{
    motive_a_id: "meet-deadline",
    motive_b_id: "protect-friend",
    preferred_motive_id: "meet-deadline",
    rule_ref: " ",
  }];
  assert.equal(evaluateNpcInternalConflict(missingRule).status, "non_ready");
});

test("rejects sparse arrays and does not invoke getters", () => {
  const sparse = base();
  sparse.options.length = 3;
  assert.equal(evaluateNpcInternalConflict(sparse).status, "non_ready");

  let invoked = false;
  const hostile = base();
  Object.defineProperty(hostile.options[0], "supports", {
    enumerable: true,
    get() {
      invoked = true;
      return [];
    },
  });
  assert.equal(evaluateNpcInternalConflict(hostile).status, "non_ready");
  assert.equal(invoked, false);
});

test("does not mutate caller-owned input", () => {
  const input = base();
  const before = structuredClone(input);
  evaluateNpcInternalConflict(input);
  assert.deepEqual(input, before);
});

test("rejects a conflict pair that has no active motive reference", () => {
  const input = base();
  input.resolutions = [{
    motive_a_id: "meet-deadline",
    motive_b_id: "missing-motive",
    preferred_motive_id: "meet-deadline",
    rule_ref: "rule:a",
  }];
  assert.equal(evaluateNpcInternalConflict(input).status, "non_ready");
});

test("rejects options that do not advance any supplied active motive", () => {
  const input = base();
  input.options[0].supports = [];
  assert.equal(evaluateNpcInternalConflict(input).status, "non_ready");
});

test("an explicit disqualifying conflict cannot be hidden by a second unresolved conflict", () => {
  const input = {
    motives: [
      { id: "deadline", kind: "goal" },
      { id: "protect", kind: "obligation" },
      { id: "avoid-harm", kind: "value" },
    ],
    options: [{
      id: "deadline-action",
      supports: ["deadline"],
      frustrates: ["protect", "avoid-harm"],
      motive_assessment_complete: true,
      feasibility: "feasible",
      hard_constraints_complete: true,
      hard_constraints: [],
    }],
    resolutions: [{
      motive_a_id: "deadline",
      motive_b_id: "protect",
      preferred_motive_id: "protect",
      rule_ref: "author:protect-first",
    }],
  };
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[0].status, "ineligible");
  assert.equal(result.options[0].reason, "explicit_resolution_opposes_option");
});

test("explicit disqualification takes precedence over incomplete coverage", () => {
  const input = base();
  input.options[1].frustrates = ["protect-friend"];
  input.options[1].motive_assessment_complete = false;
  input.resolutions = [{
    motive_a_id: "meet-deadline",
    motive_b_id: "protect-friend",
    preferred_motive_id: "protect-friend",
    rule_ref: "author:protect-friend-first",
  }];
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[1].status, "ineligible");
  assert.equal(result.options[1].reason, "explicit_resolution_opposes_option");
});

test("known hard-constraint violation excludes an option even when coverage is incomplete", () => {
  const input = base();
  input.options[0].hard_constraints_complete = false;
  input.options[0].hard_constraints[0].status = "violated";
  const result = evaluateNpcInternalConflict(input);
  assert.equal(result.options[0].status, "ineligible");
  assert.equal(result.options[0].reason, "hard_constraint_violated");
});


test("rejects missing own fields and inherited-only assessment values", () => {
  const missingOwnId = base();
  delete missingOwnId.options[0].id;
  assert.equal(evaluateNpcInternalConflict(missingOwnId).status, "non_ready");

  const inheritedOption = Object.assign(Object.create({ id: "inherited-option-id" }), {
    supports: ["protect-friend"],
    frustrates: [],
    motive_assessment_complete: true,
    feasibility: "feasible",
    hard_constraints_complete: true,
    hard_constraints: [],
  });
  const inheritedInput = base();
  inheritedInput.options[0] = inheritedOption;
  assert.equal(evaluateNpcInternalConflict(inheritedInput).status, "non_ready");

  const missingRule = base();
  missingRule.options[1].frustrates = ["protect-friend"];
  missingRule.resolutions = [{
    motive_a_id: "meet-deadline",
    motive_b_id: "protect-friend",
    preferred_motive_id: "meet-deadline",
  }];
  assert.equal(evaluateNpcInternalConflict(missingRule).status, "non_ready");
});
