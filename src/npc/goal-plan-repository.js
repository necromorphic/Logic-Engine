import { createHash, randomUUID } from "node:crypto";
import { types as utilTypes } from "node:util";
import { transitionNpcGoal } from "./goal-lifecycle.js";
import { advanceNpcPlan, getNpcPlanActiveStep } from "./plan-progress.js";

const SCHEMA_VERSION = 1;
const MAX_PAGE_SIZE = 100;
const MAX_RECORD_BYTES = 1024 * 1024;

export class NpcGoalPlanRepositoryError extends Error {
  constructor(message, code = "non_ready") {
    super(message);
    this.name = "NpcGoalPlanRepositoryError";
    this.code = code;
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function plainData(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}

function dataCopy(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || utilTypes.isProxy(value) || seen.has(value)) {
    throw new NpcGoalPlanRepositoryError("unsupported, cyclic or proxied data", "invalid_input");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = [];
      for (let i = 0; i < value.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          throw new NpcGoalPlanRepositoryError("sparse arrays are not accepted", "invalid_input");
        }
        output.push(dataCopy(descriptor.value, seen));
      }
      return output;
    }
    if (!plainData(value)) throw new NpcGoalPlanRepositoryError("plain data objects are required", "invalid_input");
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      output[key] = dataCopy(Object.getOwnPropertyDescriptor(value, key).value, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function json(value) {
  const text = JSON.stringify(dataCopy(value));
  if (Buffer.byteLength(text, "utf8") > MAX_RECORD_BYTES) {
    throw new NpcGoalPlanRepositoryError("record exceeds the 1 MiB limit", "invalid_input");
  }
  return text;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new NpcGoalPlanRepositoryError("stored JSON is corrupt", "non_ready");
  }
}

function hash(value) {
  return createHash("sha256").update(json(value)).digest("hex");
}

function scopeOf(value) {
  if (!plainData(value) || !nonEmpty(value.world_id) || !nonEmpty(value.npc_entity_id)) {
    throw new NpcGoalPlanRepositoryError("exact world_id and npc_entity_id are required", "invalid_scope");
  }
  if (value.world_id !== value.world_id.trim() || value.npc_entity_id !== value.npc_entity_id.trim()) {
    throw new NpcGoalPlanRepositoryError("scope identifiers must be exact and must not be whitespace-normalized", "invalid_scope");
  }
  return { world_id: value.world_id, npc_entity_id: value.npc_entity_id };
}

function revision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NpcGoalPlanRepositoryError(label + " must be a non-negative safe integer", "invalid_input");
  }
  return value;
}

function pageSize(value, fallback = 25) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new NpcGoalPlanRepositoryError("limit must be between 1 and 100", "invalid_input");
  }
  return value;
}

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new NpcGoalPlanRepositoryError("invalid repository clock", "non_ready");
  return date.toISOString();
}

function idFrom(idFactory) {
  const value = idFactory();
  if (!nonEmpty(value)) throw new NpcGoalPlanRepositoryError("invalid trusted ID factory result", "non_ready");
  return value;
}

function outcome(status, fields = {}) {
  return Object.freeze({ status, ...fields });
}

function tx(database, operation) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* keep original failure */ }
    throw error;
  }
}

function safe(operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof NpcGoalPlanRepositoryError) {
      return outcome("non_ready", { reason: error.code, message: error.message });
    }
    return outcome("non_ready", { reason: "store_error" });
  }
}

function getGoal(database, scope, goalId) {
  return database.prepare(
    "SELECT goal_json, goal_revision, status FROM npc_goals WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ?",
  ).get(scope.world_id, scope.npc_entity_id, goalId);
}

function getSelection(database, scope, goalId) {
  return database.prepare(
    "SELECT current_plan_id, current_plan_revision, plan_selection_revision FROM npc_goal_selection WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ?",
  ).get(scope.world_id, scope.npc_entity_id, goalId);
}

function normalizeExpected(value) {
  if (!plainData(value)
    || !Object.hasOwn(value, "goal_revision")
    || !Object.hasOwn(value, "plan_selection_revision")
    || !Object.hasOwn(value, "current_plan_id")
    || !Object.hasOwn(value, "current_plan_revision")) {
    throw new NpcGoalPlanRepositoryError("complete expected goal and selection versions are required", "invalid_input");
  }
  const expected = {
    goal_revision: revision(value.goal_revision, "goal_revision"),
    plan_selection_revision: revision(value.plan_selection_revision, "plan_selection_revision"),
    current_plan_id: value.current_plan_id,
    current_plan_revision: value.current_plan_revision,
  };
  if (expected.current_plan_id !== null && !nonEmpty(expected.current_plan_id)) {
    throw new NpcGoalPlanRepositoryError("current_plan_id must be a string or null", "invalid_input");
  }
  if (expected.current_plan_revision !== null
    && (!Number.isSafeInteger(expected.current_plan_revision) || expected.current_plan_revision < 1)) {
    throw new NpcGoalPlanRepositoryError("current_plan_revision must be positive or null", "invalid_input");
  }
  if ((expected.current_plan_id === null) !== (expected.current_plan_revision === null)) {
    throw new NpcGoalPlanRepositoryError("current plan ID and revision must both be null or both be present", "invalid_input");
  }
  return expected;
}

function selectionMatches(selection, expected) {
  return selection
    && selection.plan_selection_revision === expected.plan_selection_revision
    && selection.current_plan_id === expected.current_plan_id
    && selection.current_plan_revision === expected.current_plan_revision;
}

function saveIdempotency(database, scope, operation, key, requestHash, saved, at) {
  database.prepare(
    "INSERT INTO npc_idempotency (world_id,npc_entity_id,operation,idempotency_key,request_hash,result_json,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(scope.world_id, scope.npc_entity_id, operation, key, requestHash, json(saved), at);
}

function lookupIdempotency(database, scope, operation, key, requestHash) {
  const row = database.prepare(
    "SELECT request_hash,result_json FROM npc_idempotency WHERE world_id = ? AND npc_entity_id = ? AND operation = ? AND idempotency_key = ?",
  ).get(scope.world_id, scope.npc_entity_id, operation, key);
  if (!row) return null;
  if (row.request_hash !== requestHash) {
    return outcome("conflict", { reason: "idempotency_key_reused_with_different_content" });
  }
  return outcome("replayed", parseJson(row.result_json));
}

function audit(database, scope, entry, at) {
  database.prepare(
    "INSERT INTO npc_audit (world_id,npc_entity_id,entity_type,entity_id,action,revision,details_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    scope.world_id, scope.npc_entity_id, entry.entity_type, entry.entity_id,
    entry.action, entry.revision ?? null, json(entry.details ?? {}), at,
  );
}

function trusted(callback, args) {
  if (typeof callback !== "function") return false;
  try { return callback(...args) === true; } catch { return false; }
}

function normalizeCandidatePlan(input, planId, idFactory) {
  const plan = dataCopy(input);
  if (!plainData(plan) || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new NpcGoalPlanRepositoryError("candidate plan requires at least one step", "invalid_input");
  }
  const steps = plan.steps.map((step, index) => {
    if (!plainData(step) || !nonEmpty(step.action_id)) {
      throw new NpcGoalPlanRepositoryError("each plan step requires action_id", "invalid_input");
    }
    return { ...step, id: idFrom(idFactory), status: index === 0 ? "active" : "pending" };
  });
  const normalized = { ...plan, id: planId, status: "active", steps };
  if (getNpcPlanActiveStep(normalized).status !== "ready") {
    throw new NpcGoalPlanRepositoryError("candidate plan violates the active-plan contract", "invalid_input");
  }
  return normalized;
}

const SCHEMA_SQL = [
  "CREATE TABLE npc_goals (world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, goal_id TEXT NOT NULL, goal_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','blocked','completed','abandoned')), goal_revision INTEGER NOT NULL CHECK(goal_revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(world_id,npc_entity_id,goal_id));",
  "CREATE TABLE npc_goal_selection (world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, goal_id TEXT NOT NULL, current_plan_id TEXT, current_plan_revision INTEGER, plan_selection_revision INTEGER NOT NULL CHECK(plan_selection_revision >= 0), PRIMARY KEY(world_id,npc_entity_id,goal_id), FOREIGN KEY(world_id,npc_entity_id,goal_id) REFERENCES npc_goals(world_id,npc_entity_id,goal_id) ON DELETE RESTRICT, CHECK((current_plan_id IS NULL AND current_plan_revision IS NULL) OR (current_plan_id IS NOT NULL AND current_plan_revision IS NOT NULL AND current_plan_revision >= 1)));",
  "CREATE TABLE npc_plan_revisions (world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, goal_id TEXT NOT NULL, plan_id TEXT NOT NULL, plan_revision INTEGER NOT NULL CHECK(plan_revision >= 1), plan_json TEXT NOT NULL, execution_status TEXT NOT NULL CHECK(execution_status IN ('active','blocked','completed','abandoned')), selection_state TEXT NOT NULL CHECK(selection_state IN ('current','superseded')), created_at TEXT NOT NULL, PRIMARY KEY(world_id,npc_entity_id,plan_id,plan_revision), UNIQUE(world_id,npc_entity_id,goal_id,plan_id,plan_revision), FOREIGN KEY(world_id,npc_entity_id,goal_id) REFERENCES npc_goals(world_id,npc_entity_id,goal_id) ON DELETE RESTRICT);",
  "CREATE UNIQUE INDEX npc_one_current_plan_per_goal ON npc_plan_revisions(world_id,npc_entity_id,goal_id) WHERE selection_state = 'current';",
  "CREATE TABLE npc_plan_candidates (world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, candidate_id TEXT NOT NULL, goal_id TEXT NOT NULL, plan_id TEXT NOT NULL, plan_revision INTEGER NOT NULL, candidate_json TEXT NOT NULL, snapshot_world_revision INTEGER NOT NULL CHECK(snapshot_world_revision >= 0), snapshot_commit_sequence INTEGER NOT NULL CHECK(snapshot_commit_sequence >= 0), expected_goal_revision INTEGER NOT NULL, expected_plan_selection_revision INTEGER NOT NULL, expected_current_plan_id TEXT, expected_current_plan_revision INTEGER, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('candidate','accepted','rejected')), created_at TEXT NOT NULL, PRIMARY KEY(world_id,npc_entity_id,candidate_id), UNIQUE(world_id,npc_entity_id,idempotency_key), FOREIGN KEY(world_id,npc_entity_id,goal_id) REFERENCES npc_goals(world_id,npc_entity_id,goal_id) ON DELETE RESTRICT);",
  "CREATE TABLE npc_action_attempts (world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, attempt_id TEXT NOT NULL, goal_id TEXT NOT NULL, plan_id TEXT NOT NULL, plan_revision INTEGER NOT NULL, step_id TEXT NOT NULL, action_id TEXT NOT NULL, goal_revision INTEGER NOT NULL, plan_selection_revision INTEGER NOT NULL, world_revision INTEGER NOT NULL, commit_sequence INTEGER NOT NULL, proposal_idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, attempt_json TEXT NOT NULL, local_state TEXT NOT NULL CHECK(local_state IN ('prepared','awaiting_core_result','review_required','reconciled')), created_at TEXT NOT NULL, PRIMARY KEY(world_id,npc_entity_id,attempt_id), UNIQUE(world_id,npc_entity_id,proposal_idempotency_key), FOREIGN KEY(world_id,npc_entity_id,goal_id) REFERENCES npc_goals(world_id,npc_entity_id,goal_id) ON DELETE RESTRICT);",
  "CREATE INDEX npc_pending_attempts ON npc_action_attempts(world_id,npc_entity_id,local_state,attempt_id);",
  "CREATE TABLE npc_core_reconciliations (world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, attempt_id TEXT NOT NULL, proposal_id TEXT NOT NULL, event_id TEXT NOT NULL, goal_id TEXT NOT NULL, plan_id TEXT NOT NULL, step_id TEXT NOT NULL, result_hash TEXT NOT NULL, result_json TEXT NOT NULL, reconciled_at TEXT NOT NULL, PRIMARY KEY(world_id,npc_entity_id,attempt_id), UNIQUE(world_id,npc_entity_id,event_id,step_id), FOREIGN KEY(world_id,npc_entity_id,attempt_id) REFERENCES npc_action_attempts(world_id,npc_entity_id,attempt_id) ON DELETE RESTRICT);",
  "CREATE TABLE npc_idempotency (world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(world_id,npc_entity_id,operation,idempotency_key));",
  "CREATE TABLE npc_audit (audit_sequence INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, npc_entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER, details_json TEXT NOT NULL, created_at TEXT NOT NULL);",
  "CREATE INDEX npc_audit_scope_cursor ON npc_audit(world_id,npc_entity_id,audit_sequence);",
  "PRAGMA user_version = 1;",
].join("\n");

function ensureSchema(database) {
  const version = database.prepare("PRAGMA user_version").get().user_version;
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (version > SCHEMA_VERSION) throw new NpcGoalPlanRepositoryError("NPC store schema is newer than this adapter");
  if (version === SCHEMA_VERSION) {
    const names = new Set(tables.map((row) => row.name));
    const required = [
      "npc_goals", "npc_goal_selection", "npc_plan_revisions", "npc_plan_candidates",
      "npc_action_attempts", "npc_core_reconciliations", "npc_idempotency", "npc_audit",
    ];
    if (!required.every((name) => names.has(name))) {
      throw new NpcGoalPlanRepositoryError("versioned NPC store is missing required tables");
    }
    return;
  }
  if (version !== 0 || tables.length !== 0) {
    throw new NpcGoalPlanRepositoryError("unversioned or partial NPC store will not be reset");
  }
  tx(database, () => database.exec(SCHEMA_SQL));
}

/**
 * Adapter over an injected NPC-local SQLite connection.
 * It never opens a file and has no Core database dependency. Production
 * composition must inject a separately secured NPC connection after #770.
 */
export function createNpcGoalPlanRepository({
  database,
  idFactory = randomUUID,
  now = () => new Date(),
  goalAdmissionVerifier = null,
  goalEvidenceVerifier = null,
  coreResultVerifier = null,
} = {}) {
  if (!database || typeof database.exec !== "function" || typeof database.prepare !== "function") {
    throw new NpcGoalPlanRepositoryError("an injected synchronous SQLite database is required", "invalid_input");
  }
  if (typeof idFactory !== "function" || typeof now !== "function") {
    throw new NpcGoalPlanRepositoryError("trusted ID factory and clock are required", "invalid_input");
  }
  database.exec("PRAGMA foreign_keys = ON");
  ensureSchema(database);

  function createAcceptedGoal(scopeInput, goalInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const goal = dataCopy(goalInput);
      const options = dataCopy(optionsInput);
      if (!plainData(goal) || !nonEmpty(goal.description)) {
        throw new NpcGoalPlanRepositoryError("accepted goal requires a description", "invalid_input");
      }
      if (!trusted(goalAdmissionVerifier, [scope, goal])) {
        return outcome("review_required", { reason: "trusted_goal_admission_not_available" });
      }
      const key = options.idempotency_key;
      if (!nonEmpty(key)) throw new NpcGoalPlanRepositoryError("idempotency_key is required", "invalid_input");
      const requestHash = hash({ scope, goal });
      return tx(database, () => {
        const prior = lookupIdempotency(database, scope, "createAcceptedGoal", key, requestHash);
        if (prior) return prior;
        const goalId = idFrom(idFactory);
        const at = timestamp(now);
        const stored = { ...goal, id: goalId, status: "active" };
        database.prepare(
          "INSERT INTO npc_goals (world_id,npc_entity_id,goal_id,goal_json,status,goal_revision,created_at,updated_at) VALUES (?,?,?,?, 'active',1,?,?)",
        ).run(scope.world_id, scope.npc_entity_id, goalId, json(stored), at, at);
        database.prepare(
          "INSERT INTO npc_goal_selection (world_id,npc_entity_id,goal_id,current_plan_id,current_plan_revision,plan_selection_revision) VALUES (?,?,?,NULL,NULL,0)",
        ).run(scope.world_id, scope.npc_entity_id, goalId);
        const saved = { goal_id: goalId, goal_revision: 1, plan_selection_revision: 0 };
        audit(database, scope, {
          entity_type: "goal", entity_id: goalId, action: "goal_accepted",
          revision: 1, details: { source: "trusted_goal_admission" },
        }, at);
        saveIdempotency(database, scope, "createAcceptedGoal", key, requestHash, saved, at);
        return outcome("applied", saved);
      });
    });
  }

  function loadDecisionState(scopeInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const options = dataCopy(optionsInput);
      const limit = pageSize(options.limit, 50);
      const goalId = options.goal_id;
      if (goalId !== undefined && !nonEmpty(goalId)) {
        throw new NpcGoalPlanRepositoryError("goal_id must be a non-empty string", "invalid_input");
      }
      const filter = goalId === undefined ? "" : " AND goal_id = ?";
      const params = goalId === undefined
        ? [scope.world_id, scope.npc_entity_id, limit]
        : [scope.world_id, scope.npc_entity_id, goalId, limit];
      const goals = database.prepare(
        "SELECT goal_id,goal_json,goal_revision,status FROM npc_goals WHERE world_id = ? AND npc_entity_id = ?" +
        filter + " ORDER BY goal_id LIMIT ?",
      ).all(...params);
      const snapshots = goals.map((row) => {
        const selection = getSelection(database, scope, row.goal_id);
        if (!selection) throw new NpcGoalPlanRepositoryError("goal selection row is missing");
        let currentPlan = null;
        if (selection.current_plan_id !== null) {
          const planRow = database.prepare(
            "SELECT plan_json FROM npc_plan_revisions WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND plan_id = ? AND plan_revision = ? AND selection_state = 'current'",
          ).get(scope.world_id, scope.npc_entity_id, row.goal_id,
            selection.current_plan_id, selection.current_plan_revision);
          if (!planRow) throw new NpcGoalPlanRepositoryError("current plan pointer is inconsistent");
          currentPlan = parseJson(planRow.plan_json);
        }
        return {
          goal: parseJson(row.goal_json),
          goal_revision: row.goal_revision,
          current_plan_id: selection.current_plan_id,
          current_plan_revision: selection.current_plan_revision,
          plan_selection_revision: selection.plan_selection_revision,
          current_plan: currentPlan,
        };
      });
      const response = {
        scope,
        schema_version: SCHEMA_VERSION,
        goals: snapshots,
        read_cursor: database.prepare(
          "SELECT COALESCE(MAX(audit_sequence),0) AS cursor FROM npc_audit WHERE world_id = ? AND npc_entity_id = ?",
        ).get(scope.world_id, scope.npc_entity_id).cursor,
      };
      if (options.include_candidates === true) {
        response.candidates = database.prepare(
          "SELECT candidate_id,goal_id,plan_id,plan_revision,status,candidate_json,created_at FROM npc_plan_candidates WHERE world_id = ? AND npc_entity_id = ?" +
          filter + " ORDER BY candidate_id LIMIT ?",
        ).all(...params).map((row) => {
          const { candidate_json, ...metadata } = row;
          return { ...metadata, candidate: parseJson(candidate_json) };
        });
      }
      if (options.include_pending_attempts === true) {
        response.pending_attempts = database.prepare(
          "SELECT attempt_id,goal_id,plan_id,plan_revision,step_id,action_id,world_revision,commit_sequence,local_state,attempt_json,created_at FROM npc_action_attempts WHERE world_id = ? AND npc_entity_id = ? AND local_state != 'reconciled'" +
          filter + " ORDER BY attempt_id LIMIT ?",
        ).all(...params).map((row) => {
          const { attempt_json, ...metadata } = row;
          return { ...metadata, attempt: parseJson(attempt_json) };
        });
      }
      return outcome("ready", response);
    });
  }

  function createPlanCandidate(scopeInput, candidateInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const candidate = dataCopy(candidateInput);
      const options = dataCopy(optionsInput);
      if (!plainData(candidate) || !nonEmpty(candidate.goal_id)
        || !plainData(candidate.plan) || !plainData(candidate.snapshot_basis)) {
        throw new NpcGoalPlanRepositoryError("candidate requires goal_id, plan and snapshot_basis", "invalid_input");
      }
      const expected = normalizeExpected(options.expected);
      const worldRevision = revision(candidate.snapshot_basis.world_revision, "world_revision");
      const commitSequence = revision(candidate.snapshot_basis.commit_sequence, "commit_sequence");
      if (candidate.reason !== undefined
        && (typeof candidate.reason !== "string" || candidate.reason.length > 1000)) {
        throw new NpcGoalPlanRepositoryError("candidate reason must be a string up to 1000 characters", "invalid_input");
      }
      const key = options.idempotency_key;
      if (!nonEmpty(key)) throw new NpcGoalPlanRepositoryError("idempotency_key is required", "invalid_input");
      const requestHash = hash({ scope, candidate, expected });
      return tx(database, () => {
        const prior = lookupIdempotency(database, scope, "createPlanCandidate", key, requestHash);
        if (prior) return prior;
        const goal = getGoal(database, scope, candidate.goal_id);
        const selection = getSelection(database, scope, candidate.goal_id);
        if (!goal || !selection) return outcome("conflict", { reason: "goal_not_found_in_scope" });
        if (goal.status !== "active") return outcome("conflict", { reason: "goal_not_active" });
        if (goal.goal_revision !== expected.goal_revision || !selectionMatches(selection, expected)) {
          return outcome("stale", { reason: "goal_or_selection_revision_changed" });
        }
        let planId;
        let planRevision = 1;
        if (candidate.revise_plan_id !== undefined) {
          if (!nonEmpty(candidate.revise_plan_id)) {
            throw new NpcGoalPlanRepositoryError("revise_plan_id must be a non-empty string", "invalid_input");
          }
          const previous = database.prepare(
            "SELECT MAX(plan_revision) AS revision FROM npc_plan_revisions WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND plan_id = ?",
          ).get(scope.world_id, scope.npc_entity_id, candidate.goal_id, candidate.revise_plan_id);
          if (!previous || previous.revision === null) {
            return outcome("conflict", { reason: "base_plan_not_found_in_scope" });
          }
          planId = candidate.revise_plan_id;
          planRevision = previous.revision + 1;
        } else {
          planId = idFrom(idFactory);
        }
        const candidateId = idFrom(idFactory);
        const plan = normalizeCandidatePlan(candidate.plan, planId, idFactory);
        const at = timestamp(now);
        const stored = {
          candidate_id: candidateId, goal_id: candidate.goal_id, plan_id: planId,
          plan_revision: planRevision, plan,
          snapshot_basis: { world_revision: worldRevision, commit_sequence: commitSequence },
          reason: candidate.reason ?? null, expected,
        };
        database.prepare(
          "INSERT INTO npc_plan_candidates (world_id,npc_entity_id,candidate_id,goal_id,plan_id,plan_revision,candidate_json,snapshot_world_revision,snapshot_commit_sequence,expected_goal_revision,expected_plan_selection_revision,expected_current_plan_id,expected_current_plan_revision,idempotency_key,request_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'candidate',?)",
        ).run(
          scope.world_id, scope.npc_entity_id, candidateId, candidate.goal_id, planId, planRevision,
          json(stored), worldRevision, commitSequence, expected.goal_revision,
          expected.plan_selection_revision, expected.current_plan_id,
          expected.current_plan_revision, key, requestHash, at,
        );
        const saved = {
          candidate_id: candidateId, goal_id: candidate.goal_id, plan_id: planId,
          plan_revision: planRevision, status: "candidate",
        };
        audit(database, scope, {
          entity_type: "candidate", entity_id: candidateId, action: "candidate_created",
          revision: planRevision, details: { goal_id: candidate.goal_id, plan_id: planId },
        }, at);
        saveIdempotency(database, scope, "createPlanCandidate", key, requestHash, saved, at);
        return outcome("applied", saved);
      });
    });
  }

  function acceptPlanCandidate(scopeInput, candidateId, expectedInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const options = dataCopy(optionsInput);
      if (!nonEmpty(candidateId)) throw new NpcGoalPlanRepositoryError("candidateId is required", "invalid_input");
      const expected = normalizeExpected(expectedInput);
      const key = options.idempotency_key;
      if (!nonEmpty(key)) throw new NpcGoalPlanRepositoryError("idempotency_key is required", "invalid_input");
      const requestHash = hash({ scope, candidateId, expected });
      return tx(database, () => {
        const prior = lookupIdempotency(database, scope, "acceptPlanCandidate", key, requestHash);
        if (prior) return prior;
        const row = database.prepare(
          "SELECT * FROM npc_plan_candidates WHERE world_id = ? AND npc_entity_id = ? AND candidate_id = ?",
        ).get(scope.world_id, scope.npc_entity_id, candidateId);
        if (!row || row.status !== "candidate") {
          return outcome("conflict", { reason: "candidate_not_available_in_scope" });
        }
        const goal = getGoal(database, scope, row.goal_id);
        const selection = getSelection(database, scope, row.goal_id);
        const candidate = parseJson(row.candidate_json);
        if (!goal || !selection) return outcome("non_ready", { reason: "candidate_goal_state_missing" });
        if (goal.status !== "active") return outcome("conflict", { reason: "goal_not_active" });
        const candidateExpected = normalizeExpected(candidate.expected);
        if (goal.goal_revision !== expected.goal_revision
          || !selectionMatches(selection, expected)
          || candidateExpected.goal_revision !== expected.goal_revision
          || candidateExpected.plan_selection_revision !== expected.plan_selection_revision
          || candidateExpected.current_plan_id !== expected.current_plan_id
          || candidateExpected.current_plan_revision !== expected.current_plan_revision
          || row.expected_goal_revision !== expected.goal_revision
          || row.expected_plan_selection_revision !== expected.plan_selection_revision
          || row.expected_current_plan_id !== expected.current_plan_id
          || row.expected_current_plan_revision !== expected.current_plan_revision) {
          return outcome("stale", { reason: "candidate_expected_state_no_longer_matches" });
        }
        const at = timestamp(now);
        if (selection.current_plan_id !== null) {
          database.prepare(
            "UPDATE npc_plan_revisions SET selection_state = 'superseded' WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND plan_id = ? AND plan_revision = ? AND selection_state = 'current'",
          ).run(scope.world_id, scope.npc_entity_id, row.goal_id,
            selection.current_plan_id, selection.current_plan_revision);
        }
        database.prepare(
          "INSERT INTO npc_plan_revisions (world_id,npc_entity_id,goal_id,plan_id,plan_revision,plan_json,execution_status,selection_state,created_at) VALUES (?,?,?,?,?,?,?,'current',?)",
        ).run(scope.world_id, scope.npc_entity_id, row.goal_id, row.plan_id,
          row.plan_revision, json(candidate.plan), candidate.plan.status, at);
        const nextSelectionRevision = selection.plan_selection_revision + 1;
        database.prepare(
          "UPDATE npc_goal_selection SET current_plan_id = ?, current_plan_revision = ?, plan_selection_revision = ? WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ?",
        ).run(row.plan_id, row.plan_revision, nextSelectionRevision,
          scope.world_id, scope.npc_entity_id, row.goal_id);
        database.prepare(
          "UPDATE npc_plan_candidates SET status = 'accepted' WHERE world_id = ? AND npc_entity_id = ? AND candidate_id = ?",
        ).run(scope.world_id, scope.npc_entity_id, candidateId);
        const saved = {
          candidate_id: candidateId, goal_id: row.goal_id, plan_id: row.plan_id,
          plan_revision: row.plan_revision, plan_selection_revision: nextSelectionRevision,
          status: "accepted",
        };
        audit(database, scope, {
          entity_type: "plan", entity_id: row.plan_id, action: "candidate_accepted",
          revision: row.plan_revision,
          details: {
            candidate_id: candidateId, previous_plan_id: selection.current_plan_id,
            previous_plan_revision: selection.current_plan_revision,
            plan_selection_revision: nextSelectionRevision,
          },
        }, at);
        saveIdempotency(database, scope, "acceptPlanCandidate", key, requestHash, saved, at);
        return outcome("applied", saved);
      });
    });
  }

  function applyGoalTransition(scopeInput, goalId, expectedGoalRevision, transitionName, evidenceInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const options = dataCopy(optionsInput);
      const evidence = dataCopy(evidenceInput);
      if (!nonEmpty(goalId) || !nonEmpty(transitionName)) {
        throw new NpcGoalPlanRepositoryError("goalId and transition are required", "invalid_input");
      }
      revision(expectedGoalRevision, "expectedGoalRevision");
      if (!trusted(goalEvidenceVerifier, [scope, goalId, transitionName, evidence])) {
        return outcome("review_required", { reason: "trusted_goal_transition_evidence_not_available" });
      }
      const key = options.idempotency_key;
      if (!nonEmpty(key)) throw new NpcGoalPlanRepositoryError("idempotency_key is required", "invalid_input");
      const requestHash = hash({ scope, goalId, expectedGoalRevision, transitionName, evidence });
      return tx(database, () => {
        const prior = lookupIdempotency(database, scope, "applyGoalTransition", key, requestHash);
        if (prior) return prior;
        const row = getGoal(database, scope, goalId);
        if (!row) return outcome("conflict", { reason: "goal_not_found_in_scope" });
        if (row.goal_revision !== expectedGoalRevision) return outcome("stale", { reason: "goal_revision_changed" });
        const changed = transitionNpcGoal(parseJson(row.goal_json), transitionName);
        if (changed.status !== "transitioned") {
          return outcome("conflict", { reason: "invalid_goal_lifecycle_transition" });
        }
        const nextRevision = row.goal_revision + 1;
        const at = timestamp(now);
        database.prepare(
          "UPDATE npc_goals SET goal_json = ?, status = ?, goal_revision = ?, updated_at = ? WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND goal_revision = ?",
        ).run(json(changed.goal), changed.goal.status, nextRevision, at,
          scope.world_id, scope.npc_entity_id, goalId, expectedGoalRevision);
        const saved = { goal_id: goalId, goal_revision: nextRevision, status: changed.goal.status };
        audit(database, scope, {
          entity_type: "goal", entity_id: goalId, action: transitionName,
          revision: nextRevision, details: { evidence },
        }, at);
        saveIdempotency(database, scope, "applyGoalTransition", key, requestHash, saved, at);
        return outcome("applied", saved);
      });
    });
  }

  function recordActionAttempt(scopeInput, attemptInput) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const attempt = dataCopy(attemptInput);
      if (!plainData(attempt) || !nonEmpty(attempt.goal_id) || !nonEmpty(attempt.plan_id)
        || !nonEmpty(attempt.step_id) || !nonEmpty(attempt.action_id)
        || !nonEmpty(attempt.proposal_idempotency_key) || !plainData(attempt.proposal_request)) {
        throw new NpcGoalPlanRepositoryError("attempt must bind goal, plan, step, action and proposal request", "invalid_input");
      }
      const goalRevision = revision(attempt.goal_revision, "goal_revision");
      const selectionRevision = revision(attempt.plan_selection_revision, "plan_selection_revision");
      const planRevision = revision(attempt.plan_revision, "plan_revision");
      if (planRevision < 1) throw new NpcGoalPlanRepositoryError("plan_revision must be positive", "invalid_input");
      const worldRevision = revision(attempt.world_revision, "world_revision");
      const commitSequence = revision(attempt.commit_sequence, "commit_sequence");
      const requestHash = hash(attempt.proposal_request);
      if (attempt.request_hash !== undefined && attempt.request_hash !== requestHash) {
        return outcome("conflict", { reason: "proposal_request_hash_mismatch" });
      }
      return tx(database, () => {
        const prior = lookupIdempotency(
          database, scope, "recordActionAttempt", attempt.proposal_idempotency_key, requestHash,
        );
        if (prior) return prior;
        const goal = getGoal(database, scope, attempt.goal_id);
        const selection = getSelection(database, scope, attempt.goal_id);
        if (!goal || !selection) return outcome("conflict", { reason: "goal_not_found_in_scope" });
        if (goal.status !== "active") return outcome("conflict", { reason: "goal_not_active" });
        if (goal.goal_revision !== goalRevision
          || selection.plan_selection_revision !== selectionRevision
          || selection.current_plan_id !== attempt.plan_id
          || selection.current_plan_revision !== planRevision) {
          return outcome("stale", { reason: "goal_or_plan_selection_changed" });
        }
        const planRow = database.prepare(
          "SELECT plan_json FROM npc_plan_revisions WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND plan_id = ? AND plan_revision = ? AND selection_state = 'current'",
        ).get(scope.world_id, scope.npc_entity_id, attempt.goal_id, attempt.plan_id, attempt.plan_revision);
        if (!planRow) return outcome("non_ready", { reason: "current_plan_record_missing" });
        const active = getNpcPlanActiveStep(parseJson(planRow.plan_json));
        if (active.status !== "ready" || active.step.id !== attempt.step_id || active.step.action_id !== attempt.action_id) {
          return outcome("conflict", { reason: "attempt_does_not_match_current_active_step" });
        }
        const at = timestamp(now);
        const attemptId = idFrom(idFactory);
        const stored = {
          ...attempt, plan_revision: planRevision, attempt_id: attemptId, request_hash: requestHash,
          local_state: "awaiting_core_result",
        };
        database.prepare(
          "INSERT INTO npc_action_attempts (world_id,npc_entity_id,attempt_id,goal_id,plan_id,plan_revision,step_id,action_id,goal_revision,plan_selection_revision,world_revision,commit_sequence,proposal_idempotency_key,request_hash,attempt_json,local_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'awaiting_core_result',?)",
        ).run(
          scope.world_id, scope.npc_entity_id, attemptId, attempt.goal_id, attempt.plan_id,
          planRevision, attempt.step_id, attempt.action_id, goalRevision,
          selectionRevision, worldRevision, commitSequence, attempt.proposal_idempotency_key,
          requestHash, json(stored), at,
        );
        const saved = {
          attempt_id: attemptId, goal_id: attempt.goal_id, plan_id: attempt.plan_id,
          plan_revision: planRevision, step_id: attempt.step_id,
          action_id: attempt.action_id, local_state: "awaiting_core_result",
        };
        audit(database, scope, {
          entity_type: "attempt", entity_id: attemptId, action: "action_attempt_prepared",
          revision: planRevision, details: { goal_id: attempt.goal_id, step_id: attempt.step_id },
        }, at);
        saveIdempotency(database, scope, "recordActionAttempt",
          attempt.proposal_idempotency_key, requestHash, saved, at);
        return outcome("applied", saved);
      });
    });
  }

  function reconcileCoreResult(scopeInput, attemptId, resultInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const options = dataCopy(optionsInput);
      const verified = dataCopy(resultInput);
      if (!nonEmpty(attemptId) || !plainData(verified) || verified.status !== "committed"
        || !nonEmpty(verified.proposal_id) || !nonEmpty(verified.event_id)
        || !nonEmpty(verified.world_id) || !nonEmpty(verified.idempotency_key)
        || !nonEmpty(verified.request_hash) || !nonEmpty(verified.goal_id)
        || !nonEmpty(verified.plan_id) || !nonEmpty(verified.step_id) || !nonEmpty(verified.action_id)
        || verified.outcome !== "step_succeeded") {
        return outcome("review_required", { reason: "verified_committed_core_result_required" });
      }
      revision(verified.plan_revision, "plan_revision");
      revision(verified.world_revision, "world_revision");
      revision(verified.commit_sequence, "commit_sequence");
      if (!trusted(coreResultVerifier, [scope, attemptId, verified])) {
        return outcome("review_required", { reason: "trusted_core_result_verifier_not_available" });
      }
      const resultHash = hash(verified);
      const key = options.idempotency_key ?? attemptId;
      if (!nonEmpty(key)) throw new NpcGoalPlanRepositoryError("invalid idempotency key", "invalid_input");
      const requestHash = hash({ scope, attemptId, resultHash });
      return tx(database, () => {
        const prior = lookupIdempotency(database, scope, "reconcileCoreResult", key, requestHash);
        if (prior) return prior;
        const existing = database.prepare(
          "SELECT result_hash,event_id,plan_id,step_id FROM npc_core_reconciliations WHERE world_id = ? AND npc_entity_id = ? AND attempt_id = ?",
        ).get(scope.world_id, scope.npc_entity_id, attemptId);
        if (existing) {
          if (existing.result_hash === resultHash) {
            return outcome("replayed", {
              attempt_id: attemptId, event_id: existing.event_id,
              plan_id: existing.plan_id, step_id: existing.step_id,
            });
          }
          return outcome("conflict", { reason: "attempt_already_reconciled_with_different_result" });
        }
        const row = database.prepare(
          "SELECT * FROM npc_action_attempts WHERE world_id = ? AND npc_entity_id = ? AND attempt_id = ?",
        ).get(scope.world_id, scope.npc_entity_id, attemptId);
        if (!row) return outcome("conflict", { reason: "attempt_not_found_in_scope" });
        const attempt = parseJson(row.attempt_json);
        if (row.local_state === "reconciled") return outcome("non_ready", { reason: "reconciled_attempt_missing_result_record" });
        if (verified.world_id !== scope.world_id
          || verified.idempotency_key !== attempt.proposal_idempotency_key
          || verified.request_hash !== attempt.request_hash
          || verified.goal_id !== attempt.goal_id || verified.plan_id !== attempt.plan_id
          || verified.plan_revision !== attempt.plan_revision
          || verified.step_id !== attempt.step_id || verified.action_id !== attempt.action_id) {
          return outcome("review_required", { reason: "core_result_linkage_mismatch" });
        }
        const duplicate = database.prepare(
          "SELECT attempt_id FROM npc_core_reconciliations WHERE world_id = ? AND event_id = ? AND step_id = ?",
        ).get(scope.world_id, verified.event_id, attempt.step_id);
        if (duplicate) return outcome("conflict", { reason: "core_event_already_reconciled_for_step" });
        const goalRow = getGoal(database, scope, attempt.goal_id);
        if (!goalRow || goalRow.status !== "active") {
          return outcome("review_required", { reason: "goal_not_active_during_reconciliation" });
        }
        const selection = getSelection(database, scope, attempt.goal_id);
        if (!selection || selection.current_plan_id !== attempt.plan_id
          || selection.current_plan_revision !== attempt.plan_revision
          || selection.plan_selection_revision !== attempt.plan_selection_revision) {
          return outcome("review_required", { reason: "plan_changed_before_core_reconciliation" });
        }
        const planRow = database.prepare(
          "SELECT plan_json FROM npc_plan_revisions WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND plan_id = ? AND plan_revision = ? AND selection_state = 'current'",
        ).get(scope.world_id, scope.npc_entity_id, attempt.goal_id, attempt.plan_id, attempt.plan_revision);
        if (!planRow) return outcome("non_ready", { reason: "current_plan_record_missing" });
        const advanced = advanceNpcPlan(parseJson(planRow.plan_json), {
          type: "step_succeeded", step_id: attempt.step_id,
        });
        if (advanced.status !== "advanced") {
          return outcome("review_required", { reason: "verified_result_cannot_advance_current_plan" });
        }
        const nextPlanRevision = attempt.plan_revision + 1;
        const nextSelectionRevision = selection.plan_selection_revision + 1;
        const nextPlan = { ...advanced.plan, id: attempt.plan_id };
        const at = timestamp(now);
        database.prepare(
          "UPDATE npc_plan_revisions SET selection_state = 'superseded' WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ? AND plan_id = ? AND plan_revision = ? AND selection_state = 'current'",
        ).run(scope.world_id, scope.npc_entity_id, attempt.goal_id, attempt.plan_id, attempt.plan_revision);
        database.prepare(
          "INSERT INTO npc_plan_revisions (world_id,npc_entity_id,goal_id,plan_id,plan_revision,plan_json,execution_status,selection_state,created_at) VALUES (?,?,?,?,?,?,?,'current',?)",
        ).run(scope.world_id, scope.npc_entity_id, attempt.goal_id, attempt.plan_id,
          nextPlanRevision, json(nextPlan), nextPlan.status, at);
        database.prepare(
          "UPDATE npc_goal_selection SET current_plan_revision = ?, plan_selection_revision = ? WHERE world_id = ? AND npc_entity_id = ? AND goal_id = ?",
        ).run(nextPlanRevision, nextSelectionRevision,
          scope.world_id, scope.npc_entity_id, attempt.goal_id);
        database.prepare(
          "UPDATE npc_action_attempts SET local_state = 'reconciled' WHERE world_id = ? AND npc_entity_id = ? AND attempt_id = ?",
        ).run(scope.world_id, scope.npc_entity_id, attemptId);
        database.prepare(
          "INSERT INTO npc_core_reconciliations (world_id,npc_entity_id,attempt_id,proposal_id,event_id,goal_id,plan_id,step_id,result_hash,result_json,reconciled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ).run(scope.world_id, scope.npc_entity_id, attemptId, verified.proposal_id,
          verified.event_id, attempt.goal_id, attempt.plan_id, attempt.step_id,
          resultHash, json(verified), at);
        const saved = {
          attempt_id: attemptId, event_id: verified.event_id, plan_id: attempt.plan_id,
          plan_revision: nextPlanRevision, plan_selection_revision: nextSelectionRevision,
          step_id: attempt.step_id, status: "reconciled",
        };
        audit(database, scope, {
          entity_type: "plan", entity_id: attempt.plan_id, action: "core_result_reconciled",
          revision: nextPlanRevision, details: { attempt_id: attemptId, event_id: verified.event_id, step_id: attempt.step_id },
        }, at);
        saveIdempotency(database, scope, "reconcileCoreResult", key, requestHash, saved, at);
        return outcome("applied", saved);
      });
    });
  }

  function listPendingReconciliations(scopeInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const options = dataCopy(optionsInput);
      const limit = pageSize(options.limit);
      const cursor = options.cursor ?? null;
      if (cursor !== null && !nonEmpty(cursor)) throw new NpcGoalPlanRepositoryError("invalid attempt cursor", "invalid_input");
      const rows = database.prepare(
        "SELECT attempt_id,goal_id,plan_id,plan_revision,step_id,action_id,world_revision,commit_sequence,local_state,attempt_json,created_at FROM npc_action_attempts WHERE world_id = ? AND npc_entity_id = ? AND local_state != 'reconciled' AND (? IS NULL OR attempt_id > ?) ORDER BY attempt_id LIMIT ?",
      ).all(scope.world_id, scope.npc_entity_id, cursor, cursor, limit + 1);
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => {
        const { attempt_json, ...metadata } = row;
        return { ...metadata, attempt: parseJson(attempt_json) };
      });
      return outcome("ready", { items, next_cursor: hasMore ? items[items.length - 1].attempt_id : null });
    });
  }

  function readAudit(scopeInput, optionsInput = {}) {
    return safe(() => {
      const scope = scopeOf(scopeInput);
      const options = dataCopy(optionsInput);
      const limit = pageSize(options.limit);
      const cursor = options.cursor ?? 0;
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new NpcGoalPlanRepositoryError("invalid audit cursor", "invalid_input");
      const rows = database.prepare(
        "SELECT audit_sequence,entity_type,entity_id,action,revision,details_json,created_at FROM npc_audit WHERE world_id = ? AND npc_entity_id = ? AND audit_sequence > ? ORDER BY audit_sequence LIMIT ?",
      ).all(scope.world_id, scope.npc_entity_id, cursor, limit + 1);
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        audit_sequence: row.audit_sequence, entity_type: row.entity_type, entity_id: row.entity_id,
        action: row.action, revision: row.revision, details: parseJson(row.details_json), created_at: row.created_at,
      }));
      return outcome("ready", {
        items,
        next_cursor: hasMore ? items[items.length - 1].audit_sequence : null,
      });
    });
  }

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    createAcceptedGoal,
    loadDecisionState,
    createPlanCandidate,
    acceptPlanCandidate,
    applyGoalTransition,
    recordActionAttempt,
    reconcileCoreResult,
    listPendingReconciliations,
    readAudit,
  });
}
