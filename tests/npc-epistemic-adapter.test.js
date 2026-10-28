import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNpcEpistemicAdmissionRules,
  prepareNpcEpistemicEventsFromCoreRead,
} from "../src/application/npc-epistemic-adapter.js";

function readResult(items = []) {
  return Object.freeze({
    status: "ready",
    world_id: "world-1",
    actor_id: "npc-1",
    purpose: "npc_turn_context",
    snapshot: Object.freeze({ world_revision: 7, commit_sequence: 19 }),
    authorization_ref: "read-rule-v1",
    items: Object.freeze(items.map((item) => Object.freeze({
      acquisition_id: item.acquisition_id ?? "acq-1",
      fact_id: item.fact_id ?? "fact-secret",
      subject_ref: "person-2",
      predicate: "identity",
      value: "private-name",
      acquisition_kind: "author_initial",
      provenance_ref: "authoring:pack-v1",
      provenance_digest: "a".repeat(64),
      acquisition_authorization_ref: "source-rule-v1",
      source_event_ids: Object.freeze(["event-1"]),
    }))),
  });
}

test("only explicit fact mappings produce admitted evidence; receipt and evidence stay separate", () => {
  const rules = normalizeNpcEpistemicAdmissionRules([
    { fact_id: "fact-secret", proposition_ref: "prop-person-identity", polarity: "supports_true" },
  ]);
  const result = prepareNpcEpistemicEventsFromCoreRead(readResult(), rules);
  assert.equal(result.status, "ready");
  assert.equal(result.received_count, 1);
  assert.equal(result.admitted_count, 1);
  assert.deepEqual(result.events.map((event) => event.type), ["information_received", "evidence_admitted"]);
  assert.equal(result.events[0].world_id, "world-1");
  assert.equal(result.events[0].subject_id, "npc-1");
  assert.equal(result.events[1].proposition_ref, "prop-person-identity");
  assert.equal(result.events[1].polarity, "supports_true");
  assert.equal(result.events[1].source_version, "a".repeat(64));
  assert.equal(result.events.some((event) => event.type === "belief_updated"), false);
});

test("facts without explicit admission rules create receipts but no evidence", () => {
  const result = prepareNpcEpistemicEventsFromCoreRead(readResult(), []);
  assert.equal(result.status, "ready");
  assert.equal(result.received_count, 1);
  assert.equal(result.admitted_count, 0);
  assert.deepEqual(result.events.map((event) => event.type), ["information_received"]);
});

test("duplicate, malformed, or non-exact trusted admission rules are rejected", () => {
  assert.throws(() => normalizeNpcEpistemicAdmissionRules([
    { fact_id: "fact-a", proposition_ref: "prop-a", polarity: "supports_true" },
    { fact_id: "fact-a", proposition_ref: "prop-b", polarity: "supports_false" },
  ]), /duplicate fact_id/);
  assert.throws(() => normalizeNpcEpistemicAdmissionRules([
    { fact_id: "fact-a", proposition_ref: "prop-a", polarity: "maybe" },
  ]), /exact trusted fact mappings/);
  assert.throws(() => normalizeNpcEpistemicAdmissionRules([
    { fact_id: "fact-a", proposition_ref: "prop-a", polarity: "supports_true", allow_all: true },
  ]), /exact trusted fact mappings/);
});

test("malformed read output fails closed and cannot inject reducer events", () => {
  const result = prepareNpcEpistemicEventsFromCoreRead({
    ...readResult(),
    purpose: "arbitrary_prompt_injection",
  }, [{ fact_id: "fact-secret", proposition_ref: "prop-a", polarity: "supports_true" }]);
  assert.equal(result.status, "non_ready");
  assert.deepEqual(result.events, []);
});

test("acquisition identity produces deterministic evidence references", () => {
  const rule = [{ fact_id: "fact-secret", proposition_ref: "prop-a", polarity: "supports_false" }];
  const first = prepareNpcEpistemicEventsFromCoreRead(readResult(), rule);
  const second = prepareNpcEpistemicEventsFromCoreRead(readResult(), rule);
  assert.equal(first.events[1].evidence_ref, second.events[1].evidence_ref);
  assert.equal(first.events[1].polarity, "supports_false");
});
