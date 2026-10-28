import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

const MAX_ID = 200;
const POLARITIES = new Set(["supports_true", "supports_false"]);
const nonReady = (reason) => Object.freeze({ status: "non_ready", events: Object.freeze([]), reason });

function plainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, "value");
    });
  } catch { return false; }
}

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID
    && value === value.trim()
    && ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}

function exactKeys(value, expected) {
  return plainDataObject(value)
    && Reflect.ownKeys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every((key) => typeof key === "string" && expected.includes(key));
}

function validRule(rule) {
  return exactKeys(rule, ["fact_id", "proposition_ref", "polarity"])
    && validId(rule.fact_id)
    && validId(rule.proposition_ref)
    && POLARITIES.has(rule.polarity);
}

/** Validate and freeze deployment-owned fact-to-proposition admission rules. */
export function normalizeNpcEpistemicAdmissionRules(rules) {
  if (!Array.isArray(rules) || rules.length > 2000 || !rules.every(validRule)) {
    throw new TypeError("npcEpistemicAdmissionRules must be an array of exact trusted fact mappings");
  }
  const seen = new Set();
  return Object.freeze(rules.map((rule) => {
    if (seen.has(rule.fact_id)) throw new TypeError("npcEpistemicAdmissionRules contains a duplicate fact_id");
    seen.add(rule.fact_id);
    return Object.freeze({
      fact_id: rule.fact_id,
      proposition_ref: rule.proposition_ref,
      polarity: rule.polarity,
    });
  }));
}

/**
 * Translate a successful Core knowledge read into explicit NPC-local reducer
 * events. This does not decide belief stance and never creates belief_updated.
 * Admission rules must be deployment-owned, exact fact-to-proposition mappings.
 */
export function prepareNpcEpistemicEventsFromCoreRead(readResult, admissionRules) {
  try {
    if (!exactKeys(readResult, [
      "status", "world_id", "actor_id", "purpose", "snapshot",
      "authorization_ref", "items",
    ]) || readResult.status !== "ready"
      || !validId(readResult.world_id) || !validId(readResult.actor_id)
      || !["npc_turn_context", "npc_action_evaluation"].includes(readResult.purpose)
      || !exactKeys(readResult.snapshot, ["world_revision", "commit_sequence"])
      || !Number.isSafeInteger(readResult.snapshot.world_revision) || readResult.snapshot.world_revision < 0
      || !Number.isSafeInteger(readResult.snapshot.commit_sequence) || readResult.snapshot.commit_sequence < 0
      || !validId(readResult.authorization_ref)
      || !Array.isArray(readResult.items) || readResult.items.length > 200
      || !Array.isArray(admissionRules) || admissionRules.length > 2000
      || !admissionRules.every(validRule)) return nonReady("invalid_core_read_or_admission_rules");

    const rules = new Map();
    for (const rule of admissionRules) {
      if (rules.has(rule.fact_id)) return nonReady("duplicate_fact_admission_rule");
      rules.set(rule.fact_id, rule);
    }

    const events = [];
    const seenAcquisitions = new Set();
    for (const item of readResult.items) {
      if (!exactKeys(item, [
        "acquisition_id", "fact_id", "subject_ref", "predicate", "value",
        "acquisition_kind", "provenance_ref", "provenance_digest",
        "acquisition_authorization_ref", "source_event_ids",
      ]) || !validId(item.acquisition_id) || !validId(item.fact_id)
        || !validId(item.provenance_ref)
        || typeof item.provenance_digest !== "string" || !/^[a-f0-9]{64}$/.test(item.provenance_digest)
        || !validId(item.acquisition_authorization_ref)
        || !Array.isArray(item.source_event_ids) || item.source_event_ids.length === 0
        || !item.source_event_ids.every(validId)
        || seenAcquisitions.has(item.acquisition_id)) {
        return nonReady("invalid_acquired_knowledge_item");
      }
      seenAcquisitions.add(item.acquisition_id);

      events.push(Object.freeze({
        type: "information_received",
        world_id: readResult.world_id,
        subject_id: readResult.actor_id,
        event_ref: item.acquisition_id,
        source_ref: item.provenance_ref,
        source_version: item.provenance_digest,
      }));

      const rule = rules.get(item.fact_id);
      if (!rule) continue;

      const evidenceRef = "evidence:" + createHash("sha256")
        .update([readResult.world_id, readResult.actor_id, item.acquisition_id, item.fact_id].join("\\0"))
        .digest("hex");
      events.push(Object.freeze({
        type: "evidence_admitted",
        world_id: readResult.world_id,
        subject_id: readResult.actor_id,
        acquisition_ref: item.acquisition_id,
        proposition_ref: rule.proposition_ref,
        evidence_ref: evidenceRef,
        evidence_version: item.provenance_digest,
        source_ref: item.provenance_ref,
        source_version: item.provenance_digest,
        polarity: rule.polarity,
      }));
    }

    return Object.freeze({
      status: "ready",
      events: Object.freeze(events),
      reason: null,
      world_id: readResult.world_id,
      actor_id: readResult.actor_id,
      purpose: readResult.purpose,
      snapshot: Object.freeze({ ...readResult.snapshot }),
      authorization_ref: readResult.authorization_ref,
      received_count: readResult.items.length,
      admitted_count: events.filter((event) => event.type === "evidence_admitted").length,
    });
  } catch {
    return nonReady("invalid_core_read_or_admission_rules");
  }
}
