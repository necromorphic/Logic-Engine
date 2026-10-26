import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNpcDecisionPrototype } from "../src/npc/decision-kernel.js";

test("selects the unique highest preference among feasible candidates", () => {
  assert.deepEqual(
    evaluateNpcDecisionPrototype([
      { id: "ask", feasibility: "feasible", preference: 2 },
      { id: "leave", feasibility: "feasible", preference: 1 },
      { id: "detain", feasibility: "blocked", preference: 100 },
    ]),
    {
      status: "proposal_selected",
      reason: "unique_highest_feasible_preference",
      candidateIds: ["ask"],
    },
  );
});

test("unknown feasibility blocks selection even when another candidate scores higher", () => {
  assert.equal(
    evaluateNpcDecisionPrototype([
      { id: "safe", feasibility: "feasible", preference: 100 },
      { id: "uncertain", feasibility: "unknown", preference: -100 },
    ]).reason,
    "unknown_feasibility",
  );
});

test("does not use input order to break a tie", () => {
  const first = evaluateNpcDecisionPrototype([
    { id: "b", feasibility: "feasible", preference: 4 },
    { id: "a", feasibility: "feasible", preference: 4 },
  ]);
  const second = evaluateNpcDecisionPrototype([
    { id: "a", feasibility: "feasible", preference: 4 },
    { id: "b", feasibility: "feasible", preference: 4 },
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.status, "unresolved");
  assert.deepEqual(first.candidateIds, ["a", "b"]);
});

test("returns no-feasible result when every candidate is blocked", () => {
  assert.equal(
    evaluateNpcDecisionPrototype([
      { id: "one", feasibility: "blocked", preference: 9 },
    ]).status,
    "no_feasible_candidate",
  );
});

test("empty candidate set is not treated as a decision", () => {
  assert.deepEqual(evaluateNpcDecisionPrototype([]), {
    status: "no_feasible_candidate",
    reason: "no_candidates",
    candidateIds: [],
  });
});

test("rejects malformed or duplicate candidate identities", () => {
  assert.throws(() => evaluateNpcDecisionPrototype([null]), TypeError);
  assert.throws(() => evaluateNpcDecisionPrototype([
    { id: "same", feasibility: "feasible", preference: 1 },
    { id: "same", feasibility: "feasible", preference: 2 },
  ]), /unique/);
});

test("is deterministic under candidate reordering", () => {
  const candidates = [
    { id: "c", feasibility: "blocked", preference: 50 },
    { id: "a", feasibility: "feasible", preference: 3 },
    { id: "b", feasibility: "feasible", preference: 1 },
  ];
  assert.deepEqual(
    evaluateNpcDecisionPrototype(candidates),
    evaluateNpcDecisionPrototype([...candidates].reverse()),
  );
});


test("rejects unsupported feasibility states rather than treating them as allowed", () => {
  assert.throws(() => evaluateNpcDecisionPrototype([
    { id: "maybe", feasibility: "probably", preference: 100 },
  ]), /feasibility/);
});

test("rejects non-finite preference values", () => {
  for (const preference of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => evaluateNpcDecisionPrototype([
      { id: "candidate", feasibility: "feasible", preference },
    ]), /finite number/);
  }
});

test("candidate ID ordering uses locale-independent code-unit order", () => {
  assert.deepEqual(
    evaluateNpcDecisionPrototype([
      { id: "a", feasibility: "unknown", preference: 0 },
      { id: "Z", feasibility: "unknown", preference: 0 },
    ]).candidateIds,
    ["Z", "a"],
  );
});
