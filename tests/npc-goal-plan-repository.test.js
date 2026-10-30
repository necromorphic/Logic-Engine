import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createNpcGoalPlanRepository } from "../src/npc/goal-plan-repository.js";

const scope = Object.freeze({ world_id: "world-alpha", npc_entity_id: "npc-alpha" });
const otherScope = Object.freeze({ world_id: "world-beta", npc_entity_id: "npc-beta" });

function harness({ trusted = true } = {}) {
  const database = new DatabaseSync(":memory:");
  let sequence = 0;
  const repository = createNpcGoalPlanRepository({
    database,
    idFactory: () => "repo-id-" + (++sequence),
    now: () => new Date(Date.UTC(2026, 9, 30, 12, 0, sequence)),
    goalAdmissionVerifier: trusted ? () => true : null,
    goalEvidenceVerifier: trusted ? () => true : null,
    coreResultVerifier: trusted ? () => true : null,
  });
  return { database, repository, close: () => database.close() };
}

function createGoal(repository, targetScope = scope, key = "goal-create") {
  return repository.createAcceptedGoal(
    targetScope,
    { description: "Reach the agreed observation point", family: "observe" },
    { idempotency_key: key },
  );
}

function expectedEmpty() {
  return {
    goal_revision: 1,
    plan_selection_revision: 0,
    current_plan_id: null,
    current_plan_revision: null,
  };
}

function createCandidate(repository, goalId, key = "candidate-create", targetScope = scope) {
  return repository.createPlanCandidate(
    targetScope,
    {
      goal_id: goalId,
      plan: {
        title: "Observe and report",
        steps: [
          { action_id: "observe", description: "Inspect the target area" },
          { action_id: "report", description: "Record the observation" },
        ],
      },
      snapshot_basis: { world_revision: 10, commit_sequence: 4 },
      reason: "The current trusted context supports observation",
    },
    { expected: expectedEmpty(), idempotency_key: key },
  );
}

function acceptedPlan(repository, goalId, candidateKey = "candidate-create", acceptKey = "candidate-accept") {
  const candidate = createCandidate(repository, goalId, candidateKey);
  assert.equal(candidate.status, "applied");
  const accepted = repository.acceptPlanCandidate(
    scope,
    candidate.candidate_id,
    expectedEmpty(),
    { idempotency_key: acceptKey },
  );
  assert.equal(accepted.status, "applied");
  return repository.loadDecisionState(scope, { goal_id: goalId }).goals[0];
}

function createAttempt(repository, goalState, key = "proposal-key") {
  const activeStep = goalState.current_plan.steps[0];
  return repository.recordActionAttempt(scope, {
    goal_id: goalState.goal.id,
    plan_id: goalState.current_plan_id,
    plan_revision: goalState.current_plan_revision,
    step_id: activeStep.id,
    action_id: activeStep.action_id,
    goal_revision: goalState.goal_revision,
    plan_selection_revision: goalState.plan_selection_revision,
    world_revision: 10,
    commit_sequence: 4,
    proposal_idempotency_key: key,
    proposal_request: { action_id: activeStep.action_id, target: "target-alpha" },
  });
}

test("repository requires an injected database and creates a versioned NPC-local schema", () => {
  assert.throws(() => createNpcGoalPlanRepository(), /injected synchronous SQLite database/);
  const h = harness();
  try {
    assert.equal(h.repository.schemaVersion, 1);
    assert.equal(h.database.prepare("PRAGMA user_version").get().user_version, 1);
    const tables = h.database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'npc_%' ORDER BY name",
    ).all().map((row) => row.name);
    assert.deepEqual(tables, [
      "npc_action_attempts",
      "npc_audit",
      "npc_core_reconciliations",
      "npc_goal_selection",
      "npc_goals",
      "npc_idempotency",
      "npc_plan_candidates",
      "npc_plan_revisions",
    ]);
  } finally {
    h.close();
  }
});

test("goal admission is delegated, scoped, and idempotent", () => {
  const h = harness();
  try {
    const first = createGoal(h.repository);
    assert.equal(first.status, "applied");
    assert.equal(first.goal_revision, 1);
    const replay = createGoal(h.repository);
    assert.equal(replay.status, "replayed");
    assert.equal(replay.goal_id, first.goal_id);

    const conflict = h.repository.createAcceptedGoal(
      scope,
      { description: "Different goal", family: "observe" },
      { idempotency_key: "goal-create" },
    );
    assert.equal(conflict.status, "conflict");

    const isolated = h.repository.loadDecisionState(otherScope);
    assert.equal(isolated.status, "ready");
    assert.deepEqual(isolated.goals, []);
    const wrongScope = h.repository.createPlanCandidate(
      otherScope,
      {
        goal_id: first.goal_id,
        plan: { steps: [{ action_id: "observe" }] },
        snapshot_basis: { world_revision: 1, commit_sequence: 1 },
      },
      { expected: expectedEmpty(), idempotency_key: "wrong-scope" },
    );
    assert.equal(wrongScope.status, "conflict");
  } finally {
    h.close();
  }
});

test("goal creation fails closed when trusted admission is not supplied", () => {
  const h = harness({ trusted: false });
  try {
    const created = createGoal(h.repository);
    assert.equal(created.status, "review_required");
    assert.deepEqual(h.repository.loadDecisionState(scope).goals, []);
  } finally {
    h.close();
  }
});

test("candidate creation is idempotent and does not select or advance a plan", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const candidate = createCandidate(h.repository, goal.goal_id);
    assert.equal(candidate.status, "applied");

    const replay = createCandidate(h.repository, goal.goal_id);
    assert.equal(replay.status, "replayed");
    assert.equal(replay.candidate_id, candidate.candidate_id);

    const conflict = h.repository.createPlanCandidate(
      scope,
      {
        goal_id: goal.goal_id,
        plan: { steps: [{ action_id: "different" }] },
        snapshot_basis: { world_revision: 10, commit_sequence: 4 },
      },
      { expected: expectedEmpty(), idempotency_key: "candidate-create" },
    );
    assert.equal(conflict.status, "conflict");

    const state = h.repository.loadDecisionState(scope, {
      goal_id: goal.goal_id,
      include_candidates: true,
    });
    assert.equal(state.goals[0].current_plan, null);
    assert.equal(state.goals[0].plan_selection_revision, 0);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].status, "candidate");
    assert.equal(state.candidates[0].candidate.plan.steps[0].status, "active");
    assert.equal(state.candidates[0].candidate.plan.steps[1].status, "pending");
  } finally {
    h.close();
  }
});

test("candidate acceptance uses CAS and keeps one current plan per goal", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const first = createCandidate(h.repository, goal.goal_id, "candidate-one");
    const second = createCandidate(h.repository, goal.goal_id, "candidate-two");
    const accepted = h.repository.acceptPlanCandidate(
      scope, first.candidate_id, expectedEmpty(), { idempotency_key: "accept-one" },
    );
    assert.equal(accepted.status, "applied");
    assert.equal(accepted.plan_selection_revision, 1);

    const stale = h.repository.acceptPlanCandidate(
      scope, second.candidate_id, expectedEmpty(), { idempotency_key: "accept-two" },
    );
    assert.equal(stale.status, "stale");

    const state = h.repository.loadDecisionState(scope, { goal_id: goal.goal_id });
    assert.equal(state.goals[0].current_plan_id, accepted.plan_id);
    assert.equal(state.goals[0].current_plan_revision, 1);
    assert.equal(state.goals[0].plan_selection_revision, 1);
    const currentCount = h.database.prepare(
      "SELECT COUNT(*) AS count FROM npc_plan_revisions WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND selection_state = 'current'",
    ).get(scope.world_id, scope.npc_entity_id, goal.goal_id).count;
    assert.equal(currentCount, 1);
  } finally {
    h.close();
  }
});

test("action attempt records a checkpoint but never advances the active step", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const state = acceptedPlan(h.repository, goal.goal_id);
    const attempt = createAttempt(h.repository, state);
    assert.equal(attempt.status, "applied");
    assert.equal(attempt.local_state, "awaiting_core_result");

    const replay = createAttempt(h.repository, state);
    assert.equal(replay.status, "replayed");
    assert.equal(replay.attempt_id, attempt.attempt_id);

    const after = h.repository.loadDecisionState(scope, {
      goal_id: goal.goal_id,
      include_pending_attempts: true,
    }).goals[0];
    assert.equal(after.current_plan_revision, 1);
    assert.equal(after.current_plan.steps[0].status, "active");
    assert.equal(after.current_plan.steps[1].status, "pending");

    const pending = h.repository.listPendingReconciliations(scope);
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].attempt_id, attempt.attempt_id);
    const duplicateStepAttempt = h.repository.recordActionAttempt(scope, {
      ...pending.items[0].attempt,
      proposal_idempotency_key: "different-proposal-key",
    });
    assert.equal(duplicateStepAttempt.status, "conflict");
    assert.equal(duplicateStepAttempt.reason, "pending_attempt_already_exists_for_step");
  } finally {
    h.close();
  }
});

test("Core reconciliation requires a trusted verifier and advances exactly once", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const state = acceptedPlan(h.repository, goal.goal_id);
    const attemptResult = createAttempt(h.repository, state);
    const pending = h.repository.listPendingReconciliations(scope).items[0].attempt;
    const verified = {
      status: "committed",
      outcome: "step_succeeded",
      world_id: scope.world_id,
      proposal_id: "core-proposal-1",
      event_id: "core-event-1",
      idempotency_key: pending.proposal_idempotency_key,
      request_hash: pending.request_hash,
      goal_id: pending.goal_id,
      plan_id: pending.plan_id,
      plan_revision: pending.plan_revision,
      step_id: pending.step_id,
      action_id: pending.action_id,
      world_revision: 11,
      commit_sequence: 5,
    };
    const reconciled = h.repository.reconcileCoreResult(scope, attemptResult.attempt_id, verified);
    assert.equal(reconciled.status, "applied");
    assert.equal(reconciled.plan_revision, 2);
    assert.equal(reconciled.plan_selection_revision, 2);

    const replay = h.repository.reconcileCoreResult(scope, attemptResult.attempt_id, verified);
    assert.equal(replay.status, "replayed");

    const after = h.repository.loadDecisionState(scope, {
      goal_id: goal.goal_id,
      include_pending_attempts: true,
    });
    assert.equal(after.goals[0].current_plan_revision, 2);
    assert.equal(after.goals[0].current_plan.steps[0].status, "completed");
    assert.equal(after.goals[0].current_plan.steps[1].status, "active");
    assert.deepEqual(after.pending_attempts, []);
    assert.equal(h.repository.listPendingReconciliations(scope).items.length, 0);
  } finally {
    h.close();
  }
});

test("Core result linkage mismatch fails closed without changing plan progress", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const state = acceptedPlan(h.repository, goal.goal_id);
    const attemptResult = createAttempt(h.repository, state);
    const pending = h.repository.listPendingReconciliations(scope).items[0].attempt;
    const verified = {
      status: "committed",
      outcome: "step_succeeded",
      world_id: scope.world_id,
      proposal_id: "core-proposal-1",
      event_id: "core-event-1",
      idempotency_key: pending.proposal_idempotency_key,
      request_hash: pending.request_hash,
      goal_id: pending.goal_id,
      plan_id: pending.plan_id,
      plan_revision: pending.plan_revision + 1,
      step_id: pending.step_id,
      action_id: pending.action_id,
      world_revision: 11,
      commit_sequence: 5,
    };
    const rejected = h.repository.reconcileCoreResult(scope, attemptResult.attempt_id, verified);
    assert.equal(rejected.status, "review_required");
    const after = h.repository.loadDecisionState(scope, { goal_id: goal.goal_id }).goals[0];
    assert.equal(after.current_plan_revision, 1);
    assert.equal(after.current_plan.steps[0].status, "active");
  } finally {
    h.close();
  }
});

test("goal transitions require trusted evidence and use goal revision CAS", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const blocked = h.repository.applyGoalTransition(
      scope, goal.goal_id, 1, "block", { source: "trusted-test-evidence" },
      { idempotency_key: "block-goal" },
    );
    assert.equal(blocked.status, "applied");
    assert.equal(blocked.goal_revision, 2);
    const stale = h.repository.applyGoalTransition(
      scope, goal.goal_id, 1, "unblock", { source: "trusted-test-evidence" },
      { idempotency_key: "stale-unblock" },
    );
    assert.equal(stale.status, "stale");
    const unblocked = h.repository.applyGoalTransition(
      scope, goal.goal_id, 2, "unblock", { source: "trusted-test-evidence" },
      { idempotency_key: "unblock-goal" },
    );
    assert.equal(unblocked.status, "applied");
    const completed = h.repository.applyGoalTransition(
      scope, goal.goal_id, 3, "complete", { source: "trusted-test-evidence" },
      { idempotency_key: "complete-goal" },
    );
    assert.equal(completed.status, "applied");
    assert.equal(completed.status, "applied");
    const state = h.repository.loadDecisionState(scope, { goal_id: goal.goal_id });
    assert.equal(state.goals[0].goal.status, "completed");
    assert.equal(state.goals[0].goal_revision, 4);
  } finally {
    h.close();
  }
});

test("goal transitions fail closed without a trusted evidence owner", () => {
  const h = harness({ trusted: false });
  try {
    const goal = createGoal(h.repository);
    assert.equal(goal.status, "review_required");
    const result = h.repository.applyGoalTransition(
      scope, "not-created", 1, "complete", { source: "caller-claim" },
      { idempotency_key: "untrusted-transition" },
    );
    assert.equal(result.status, "review_required");
  } finally {
    h.close();
  }
});

test("audit pagination is stable and scoped", () => {
  const h = harness();
  try {
    const first = createGoal(h.repository, scope, "goal-a");
    createGoal(h.repository, scope, "goal-b");
    const page1 = h.repository.readAudit(scope, { limit: 1 });
    assert.equal(page1.status, "ready");
    assert.equal(page1.items.length, 1);
    assert.ok(page1.next_cursor > 0);
    const page2 = h.repository.readAudit(scope, { limit: 1, cursor: page1.next_cursor });
    assert.equal(page2.items.length, 1);
    assert.ok(page2.items[0].audit_sequence > page1.items[0].audit_sequence);
    const isolated = h.repository.readAudit(otherScope);
    assert.deepEqual(isolated.items, []);
    assert.ok(first.goal_id);
  } finally {
    h.close();
  }
});

test("unversioned partial stores are not reset", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE unrelated(value TEXT)");
    assert.throws(
      () => createNpcGoalPlanRepository({ database }),
      /unversioned or partial NPC store/,
    );
  } finally {
    database.close();
  }
});

test("scope accessors and proxies are rejected without invoking getters", () => {
  const h = harness();
  try {
    let getterCalled = false;
    const hostileScope = {};
    Object.defineProperty(hostileScope, "world_id", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("getter must not run");
      },
    });
    hostileScope.npc_entity_id = "npc-alpha";
    const rejected = h.repository.loadDecisionState(hostileScope);
    assert.equal(rejected.status, "non_ready");
    assert.equal(getterCalled, false);

    const proxyScope = new Proxy(
      { world_id: "world-alpha", npc_entity_id: "npc-alpha" },
      { ownKeys() { throw new Error("proxy trap must not run"); } },
    );
    assert.equal(h.repository.loadDecisionState(proxyScope).status, "non_ready");
  } finally {
    h.close();
  }
});


test("action-attempt idempotency binds the entire local checkpoint, not only the Core request", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const state = acceptedPlan(h.repository, goal.goal_id);
    const first = createAttempt(h.repository, state, "same-proposal-key");
    assert.equal(first.status, "applied");
    const pending = h.repository.listPendingReconciliations(scope).items[0].attempt;
    const changedCheckpoint = {
      ...pending,
      world_revision: pending.world_revision + 1,
    };
    const conflict = h.repository.recordActionAttempt(scope, changedCheckpoint);
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.reason, "idempotency_key_reused_with_different_content");
    assert.equal(h.repository.listPendingReconciliations(scope).items.length, 1);
  } finally {
    h.close();
  }
});

test("reconciliation fails closed when the goal changed after the action attempt", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const state = acceptedPlan(h.repository, goal.goal_id);
    const createdAttempt = createAttempt(h.repository, state);
    const pending = h.repository.listPendingReconciliations(scope).items[0].attempt;
    const verified = {
      status: "committed",
      outcome: "step_succeeded",
      world_id: scope.world_id,
      proposal_id: "core-proposal-stale-goal",
      event_id: "core-event-stale-goal",
      idempotency_key: pending.proposal_idempotency_key,
      request_hash: pending.request_hash,
      goal_id: pending.goal_id,
      plan_id: pending.plan_id,
      plan_revision: pending.plan_revision,
      step_id: pending.step_id,
      action_id: pending.action_id,
      world_revision: 11,
      commit_sequence: 5,
    };
    const blocked = h.repository.applyGoalTransition(
      scope, goal.goal_id, 1, "block", { source: "trusted-test-evidence" },
      { idempotency_key: "block-with-pending-attempt" },
    );
    assert.equal(blocked.status, "applied");
    const result = h.repository.reconcileCoreResult(scope, createdAttempt.attempt_id, verified);
    assert.equal(result.status, "review_required");
    assert.equal(result.reason, "goal_changed_before_core_reconciliation");
    const after = h.repository.loadDecisionState(scope, { goal_id: goal.goal_id }).goals[0];
    assert.equal(after.current_plan_revision, 1);
    assert.equal(after.current_plan.steps[0].status, "active");
  } finally {
    h.close();
  }
});

test("reconciliation requires a strictly newer Core commit sequence", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const state = acceptedPlan(h.repository, goal.goal_id);
    const createdAttempt = createAttempt(h.repository, state);
    const pending = h.repository.listPendingReconciliations(scope).items[0].attempt;
    const verified = {
      status: "committed",
      outcome: "step_succeeded",
      world_id: scope.world_id,
      proposal_id: "core-proposal-same-sequence",
      event_id: "core-event-same-sequence",
      idempotency_key: pending.proposal_idempotency_key,
      request_hash: pending.request_hash,
      goal_id: pending.goal_id,
      plan_id: pending.plan_id,
      plan_revision: pending.plan_revision,
      step_id: pending.step_id,
      action_id: pending.action_id,
      world_revision: pending.world_revision,
      commit_sequence: pending.commit_sequence,
    };
    const rejected = h.repository.reconcileCoreResult(scope, createdAttempt.attempt_id, verified);
    assert.equal(rejected.status, "review_required");
    assert.equal(rejected.reason, "core_result_linkage_mismatch");
    const after = h.repository.loadDecisionState(scope, { goal_id: goal.goal_id }).goals[0];
    assert.equal(after.current_plan_revision, 1);
    assert.equal(after.current_plan.steps[0].status, "active");
  } finally {
    h.close();
  }
});

test("Core reconciliation fails closed when no trusted result verifier is wired", () => {
  const h = harness();
  try {
    const goal = createGoal(h.repository);
    const state = acceptedPlan(h.repository, goal.goal_id);
    const createdAttempt = createAttempt(h.repository, state);
    const pending = h.repository.listPendingReconciliations(scope).items[0].attempt;
    const unverifiedRepository = createNpcGoalPlanRepository({
      database: h.database,
      idFactory: () => "unused-id",
      now: () => new Date("2026-10-30T12:00:00.000Z"),
      goalAdmissionVerifier: () => true,
    });
    const claimed = {
      status: "committed",
      outcome: "step_succeeded",
      world_id: scope.world_id,
      proposal_id: "caller-claimed-proposal",
      event_id: "caller-claimed-event",
      idempotency_key: pending.proposal_idempotency_key,
      request_hash: pending.request_hash,
      goal_id: pending.goal_id,
      plan_id: pending.plan_id,
      plan_revision: pending.plan_revision,
      step_id: pending.step_id,
      action_id: pending.action_id,
      world_revision: 11,
      commit_sequence: 5,
    };
    const result = unverifiedRepository.reconcileCoreResult(scope, createdAttempt.attempt_id, claimed);
    assert.equal(result.status, "review_required");
    assert.equal(result.reason, "trusted_core_result_verifier_not_available");
    const after = h.repository.loadDecisionState(scope, { goal_id: goal.goal_id }).goals[0];
    assert.equal(after.current_plan_revision, 1);
    assert.equal(after.current_plan.steps[0].status, "active");
  } finally {
    h.close();
  }
});


test("pending reconciliation pagination uses a monotonic per-store cursor", () => {
  const h = harness();
  try {
    const goalA = createGoal(h.repository, scope, "goal-a");
    const goalB = createGoal(h.repository, scope, "goal-b");
    const stateA = acceptedPlan(h.repository, goalA.goal_id, "candidate-a", "accept-a");
    const stateB = acceptedPlan(h.repository, goalB.goal_id, "candidate-b", "accept-b");
    createAttempt(h.repository, stateA, "proposal-a");
    createAttempt(h.repository, stateB, "proposal-b");

    const first = h.repository.listPendingReconciliations(scope, { limit: 1 });
    assert.equal(first.items.length, 1);
    assert.ok(Number.isSafeInteger(first.next_cursor));
    const second = h.repository.listPendingReconciliations(scope, {
      limit: 1,
      cursor: first.next_cursor,
    });
    assert.equal(second.items.length, 1);
    assert.ok(second.items[0].cursor_sequence > first.items[0].cursor_sequence);
    assert.notEqual(second.items[0].attempt_id, first.items[0].attempt_id);
    assert.equal(second.next_cursor, null);
  } finally {
    h.close();
  }
});
