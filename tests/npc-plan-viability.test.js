import test from "node:test";
import assert from "node:assert/strict";
import { assessNpcPlanViability } from "../src/npc/plan-viability.js";

const plan = (overrides = {}) => ({
  id: "plan-1",
  status: "active",
  assumptions: [{ id: "assumption-1" }],
  blockers: [{ id: "blocker-1" }],
  ...overrides,
});

const assessment = (overrides = {}) => ({
  assumptions: [{ id: "assumption-1", outcome: "holds" }],
  blockers: [{ id: "blocker-1", outcome: "clear" }],
  deadline: "not_due",
  ...overrides,
});

test("continues only when every assumption, blocker, and deadline is explicitly clear", () => {
  assert.deepEqual(assessNpcPlanViability({ plan: plan(), assessment: assessment() }), {
    status: "evaluated",
    disposition: "continue",
    reasons: [],
  });
});

test("a contradicted assumption requests reconsideration without inventing a replacement plan", () => {
  const result = assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ assumptions: [{ id: "assumption-1", outcome: "contradicted" }] }),
  });
  assert.equal(result.disposition, "reconsider");
  assert.deepEqual(result.reasons, ["assumption_contradicted"]);
});

test("a passed deadline requests reconsideration", () => {
  const result = assessNpcPlanViability({ plan: plan(), assessment: assessment({ deadline: "due" }) });
  assert.equal(result.disposition, "reconsider");
  assert.deepEqual(result.reasons, ["deadline_passed"]);
});

test("an active blocker pauses an otherwise viable plan", () => {
  const result = assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ blockers: [{ id: "blocker-1", outcome: "active" }] }),
  });
  assert.equal(result.disposition, "blocked");
  assert.deepEqual(result.reasons, ["blocker_active"]);
});

test("unknown or missing assessments require review instead of being treated as success", () => {
  const unknown = assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ assumptions: [{ id: "assumption-1", outcome: "unknown" }] }),
  });
  assert.equal(unknown.disposition, "needs_review");
  assert.deepEqual(unknown.reasons, ["assumption_unknown"]);

  const missing = assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ assumptions: [], blockers: [] }),
  });
  assert.equal(missing.disposition, "needs_review");
  assert.deepEqual(missing.reasons, ["assumption_assessment_missing", "blocker_assessment_missing"]);
});

test("a blocked plan becomes only a resume candidate when every blocker is explicitly clear", () => {
  const result = assessNpcPlanViability({ plan: plan({ status: "blocked" }), assessment: assessment() });
  assert.equal(result.disposition, "resume_candidate");
});

test("terminal plans are not reconsidered by this evaluator", () => {
  const result = assessNpcPlanViability({ plan: plan({ status: "completed" }), assessment: assessment() });
  assert.deepEqual(result, { status: "not_applicable", disposition: null, reasons: [] });
});

test("malformed, duplicate, sparse, or out-of-scope assessment input fails closed", () => {
  assert.equal(assessNpcPlanViability({
    plan: plan({ assumptions: [{ id: "a" }, { id: "a" }] }),
    assessment: assessment(),
  }).status, "non_ready");
  assert.equal(assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ assumptions: [{ id: "assumption-1", outcome: "maybe" }] }),
  }).status, "non_ready");
  assert.equal(assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ assumptions: [{ id: "other", outcome: "holds" }] }),
  }).status, "non_ready");
  const sparse = [];
  sparse.length = 1;
  assert.equal(assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ assumptions: sparse }),
  }).status, "non_ready");
});

test("accessor array entries fail closed without invoking the getter", () => {
  let invoked = false;
  const assumptions = [];
  Object.defineProperty(assumptions, "0", {
    configurable: true,
    enumerable: true,
    get() {
      invoked = true;
      return { id: "assumption-1", outcome: "holds" };
    },
  });
  assumptions.length = 1;

  assert.equal(assessNpcPlanViability({
    plan: plan(),
    assessment: assessment({ assumptions }),
  }).status, "non_ready");
  assert.equal(invoked, false);
});

test("input values are not mutated", () => {
  const input = { plan: plan(), assessment: assessment() };
  const before = structuredClone(input);
  assessNpcPlanViability(input);
  assert.deepEqual(input, before);
});


test("fails closed on Object.prototype pollution without invoking inherited getters", () => {
  let invoked = false;
  Object.defineProperty(Object.prototype, "npcInjectedDeadline", {
    configurable: true,
    get() { invoked = true; return "not_due"; },
  });
  let result;
  try {
    result = assessNpcPlanViability({
      plan: { id: "p", status: "active", assumptions: [], blockers: [] },
      assessment: { assumptions: [], blockers: [] },
    });
  } finally {
    delete Object.prototype.npcInjectedDeadline;
  }
  assert.deepEqual(result, { status: "non_ready", disposition: null, reasons: [] });
  assert.equal(invoked, false);
});

test("fails closed when Array.prototype iterator is replaced", () => {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  let result;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: function* pollutedIterator() { throw new Error("iterator invoked"); },
    });
    result = assessNpcPlanViability({
      plan: { id: "p", status: "active", assumptions: [], blockers: [] },
      assessment: { assumptions: [], blockers: [], deadline: "not_due" },
    });
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, original);
  }
  assert.deepEqual(result, { status: "non_ready", disposition: null, reasons: [] });
});
