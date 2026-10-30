/**
 * NPC-local autonomy cycle coordinator.
 *
 * Composes existing pure cognition helpers into one bounded decision pass:
 * reconsider the prior decision, assess the current plan, then select from
 * caller-supplied eligible action candidates.
 *
 * This module does not assemble or authenticate context, discover goals or
 * actions, invoke a model, persist NPC state, schedule work, execute actions,
 * or commit world effects. Its output is an NPC-local intention proposal only.
 */

import { types as utilTypes } from "node:util";
import { evaluateNpcDecisionReconsideration } from "./decision-reconsideration-evaluator.js";
import { assessNpcPlanViability } from "./plan-viability.js";
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

function nonReady(stage, detail = null) {
  return Object.freeze({
    status: "non_ready",
    stage,
    intention: null,
    detail,
  });
}

/**
 * Evaluate one NPC-local decision cycle.
 *
 * Required input:
 * {
 *   prior_decision, current_context, plan, assessment, goals, actions,
 *   current_intention? 
 * }
 *
 * The first two fields use the decision-reconsideration evaluator contract;
 * plan/assessment use the plan-viability contract; goals/actions/current
 * intention use the autonomous-intention-selector contract.
 *
 * A selected intention is returned only when the prior decision assessment
 * reports no material change and the active plan is explicitly viable.
 */
function evaluateNpcAutonomyCycleUnsafe(input) {
  if (!isPlainDataObject(input)) return nonReady("input");

  for (const key of [
    "prior_decision", "current_context", "plan", "assessment", "goals", "actions",
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
  if (viability.disposition !== "continue") {
    return Object.freeze({
      status: "plan_not_ready",
      stage: "plan_viability",
      intention: null,
      viability,
    });
  }

  const selection = selectNpcIntention({
    goals: input.goals,
    actions: input.actions,
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
      reconsideration,
      viability,
    });
  }

  return Object.freeze({
    status: "intention_selected",
    stage: "complete",
    intention: selection.intention,
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
