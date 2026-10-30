/**
 * NPC-local autonomy cycle coordinator.
 *
 * Composes existing pure cognition helpers into one bounded decision pass:
 * reconsider the prior decision, assess the current plan, classify internal
 * motive conflicts, then select from the remaining eligible action candidates.
 *
 * This module does not assemble or authenticate context, discover goals or
 * actions, invoke a model, persist NPC state, schedule work, execute actions,
 * or commit world effects. Its output is an NPC-local intention proposal only.
 */

import { types as utilTypes } from "node:util";
import { evaluateNpcDecisionReconsideration } from "./decision-reconsideration-evaluator.js";
import { evaluateNpcInternalConflict } from "./internal-conflict-evaluator.js";
import { assessNpcPlanViability } from "./plan-viability.js";
import { getNpcPlanActiveStep } from "./plan-progress.js";
import { selectNpcIntention } from "./autonomous-intention-selector.js";

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && descriptor !== undefined && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}

function isDenseDataArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonReady(stage, detail = null) {
  return Object.freeze({
    status: "non_ready",
    stage,
    intention: null,
    detail,
  });
}

function hasExactActionOptionCoverage(actions, options) {
  if (!isDenseDataArray(actions) || !isDenseDataArray(options) || actions.length !== options.length) {
    return false;
  }

  const actionIds = new Set();
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (!isPlainDataObject(action) || !nonEmptyString(action.id) || actionIds.has(action.id)) {
      return false;
    }
    actionIds.add(action.id);
  }

  const optionIds = new Set();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (!isPlainDataObject(option) || !nonEmptyString(option.id) || optionIds.has(option.id)) {
      return false;
    }
    optionIds.add(option.id);
  }

  for (const id of actionIds) {
    if (!optionIds.has(id)) return false;
  }
  return true;
}

/**
 * Evaluate one NPC-local decision cycle.
 *
 * Required input:
 * {
 *   prior_decision, current_context, plan, assessment, goals, actions,
 *   conflict_assessment: { motives, options, resolutions },
 *   current_intention?
 * }
 *
 * The first two fields use the decision-reconsideration evaluator contract;
 * plan/assessment use the plan-viability contract; conflict_assessment uses
 * the existing internal-conflict evaluator contract; goals/actions/current
 * intention use the autonomous-intention-selector contract.
 *
 * The plan's active step identifies the only action eligible for this pass.
 * Every supplied action still requires exactly one conflict option with the
 * same ID; only the active-step action is conflict-classified and selectable.
 */
function evaluateNpcAutonomyCycleUnsafe(input) {
  if (!isPlainDataObject(input)) return nonReady("input");

  for (const key of [
    "prior_decision", "current_context", "plan", "assessment", "goals", "actions", "conflict_assessment",
  ]) {
    if (!Object.hasOwn(input, key)) return nonReady("input");
  }
  if (
    !isPlainDataObject(input.prior_decision)
    || !isPlainDataObject(input.current_context)
    || !isPlainDataObject(input.plan)
    || !isPlainDataObject(input.assessment)
    || !Array.isArray(input.goals)
    || !Array.isArray(input.actions)
    || !isPlainDataObject(input.conflict_assessment)
    || !Array.isArray(input.conflict_assessment.motives)
    || !Array.isArray(input.conflict_assessment.options)
    || !Array.isArray(input.conflict_assessment.resolutions)
    || (input.current_intention !== undefined
      && input.current_intention !== null
      && !isPlainDataObject(input.current_intention))
  ) return nonReady("input");

  const reconsideration = evaluateNpcDecisionReconsideration({
    prior_decision: input.prior_decision,
    current_context: input.current_context,
  });

  if (reconsideration.status === "non_ready") {
    return nonReady("reconsideration", reconsideration);
  }
  if (reconsideration.status === "reconsideration_required") {
    return Object.freeze({
      status: "reconsideration_required",
      stage: "reconsideration",
      intention: null,
      reconsideration,
    });
  }
  if (reconsideration.status !== "no_material_change") {
    return Object.freeze({
      status: "review_required",
      stage: "reconsideration",
      intention: null,
      reconsideration,
    });
  }

  const viability = assessNpcPlanViability({
    plan: input.plan,
    assessment: input.assessment,
  });

  if (viability.status === "non_ready") {
    return nonReady("plan_viability", viability);
  }
  if (viability.status === "not_applicable") {
    return Object.freeze({
      status: "no_active_plan",
      stage: "plan_viability",
      intention: null,
      viability,
    });
  }
  if (viability.disposition === "reconsider") {
    return Object.freeze({
      status: "plan_revision_required",
      stage: "plan_viability",
      intention: null,
      plan_revision_request: Object.freeze({
        plan_id: input.plan.id,
        reasons: Object.freeze([...viability.reasons]),
      }),
      viability,
    });
  }
  if (viability.disposition !== "continue") {
    return Object.freeze({
      status: "plan_not_ready",
      stage: "plan_viability",
      intention: null,
      viability,
    });
  }

  const activePlanStep = getNpcPlanActiveStep(input.plan);
  if (activePlanStep.status !== "ready") {
    return nonReady("plan_progress", activePlanStep);
  }

  if (!isDenseDataArray(input.actions) || !isDenseDataArray(input.conflict_assessment.options)
    || !isDenseDataArray(input.conflict_assessment.motives)
    || !isDenseDataArray(input.conflict_assessment.resolutions)) {
    return nonReady("internal_conflict");
  }

  if (input.actions.length === 0) {
    if (input.conflict_assessment.options.length !== 0) return nonReady("internal_conflict");
    return Object.freeze({
      status: "no_eligible_action",
      stage: "internal_conflict",
      intention: null,
      conflict_decision: "no_candidates",
      reconsideration,
      viability,
    });
  }

  if (!hasExactActionOptionCoverage(input.actions, input.conflict_assessment.options)) {
    return nonReady("internal_conflict");
  }

  const plannedAction = input.actions.find((action) =>
    isPlainDataObject(action) && action.id === activePlanStep.step.action_id
  );
  if (!plannedAction) {
    return Object.freeze({
      status: "no_eligible_action",
      stage: "plan_progress",
      intention: null,
      reconsideration,
      viability,
    });
  }

  const plannedOption = input.conflict_assessment.options.find((option) =>
    isPlainDataObject(option) && option.id === activePlanStep.step.action_id
  );
  if (!plannedOption) return nonReady("internal_conflict");

  const conflict = evaluateNpcInternalConflict({
    ...input.conflict_assessment,
    options: [plannedOption],
  });
  if (conflict.status !== "evaluated") {
    return nonReady("internal_conflict");
  }

  const eligibleOptionIds = new Set(conflict.eligible_option_ids);
  if (eligibleOptionIds.size === 0) {
    if (conflict.review_option_ids.length > 0) {
      return Object.freeze({
        status: "review_required",
        stage: "internal_conflict",
        intention: null,
        conflict_decision: "needs_review",
        reconsideration,
        viability,
      });
    }
    return Object.freeze({
      status: "no_eligible_action",
      stage: "internal_conflict",
      intention: null,
      conflict_decision: "no_eligible_option",
      reconsideration,
      viability,
    });
  }

  const eligibleActions = eligibleOptionIds.has(plannedAction.id) ? [plannedAction] : [];

  const selection = selectNpcIntention({
    goals: input.goals,
    actions: eligibleActions,
    ...(Object.hasOwn(input, "current_intention")
      ? { current_intention: input.current_intention }
      : {}),
  });

  if (selection.status === "non_ready") {
    return nonReady("intention_selection", selection);
  }
  if (selection.status === "no_eligible_action") {
    return Object.freeze({
      status: "no_eligible_action",
      stage: "intention_selection",
      intention: null,
      conflict_decision: conflict.decision,
      reconsideration,
      viability,
    });
  }

  return Object.freeze({
    status: "intention_selected",
    stage: "complete",
    intention: selection.intention,
    conflict_decision: conflict.decision,
    reconsideration,
    viability,
  });
}

/**
 * A decision pass is deliberately fail-closed. Exceptions from malformed
 * values or hostile reflection traps are converted to a non-ready result.
 */
export function evaluateNpcAutonomyCycle(input) {
  try {
    return evaluateNpcAutonomyCycleUnsafe(input);
  } catch {
    return nonReady("input");
  }
}
