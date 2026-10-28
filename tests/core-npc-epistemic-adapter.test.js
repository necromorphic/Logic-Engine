import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SQLiteStore } from "../src/storage/sqlite-store.js";
import { LogicEngine } from "../src/application/engine.js";

const sourceBytes = JSON.stringify({
  schema_version: 1,
  world_pack_id: "test.world",
  world_pack_version: "1.0.0",
  source_kind: "author_initial",
  source_ref: "authoring:test.world@1.0.0",
  authorization_ref: "rule:initial-knowledge-v1",
  assignments: [{ subject_id: "npc-a", fact_id: "fact-a" }],
});
const sourceRegistry = [{
  world_pack_id: "test.world",
  world_pack_version: "1.0.0",
  source_kind: "author_initial",
  source_ref: "authoring:test.world@1.0.0",
  authorization_ref: "rule:initial-knowledge-v1",
  sha256: createHash("sha256").update(sourceBytes).digest("hex"),
}];

function setup(t, options = {}) {
  const store = new SQLiteStore(":memory:");
  t.after(() => store.close());
  const engine = new LogicEngine(store, {
    trustedInitialKnowledgeSources: sourceRegistry,
    npcKnowledgeReadAuthorizer: (scope) => ({
      status: "authorized",
      ...scope,
      authorization_ref: "rule:npc-read-v1",
    }),
    npcEpistemicAdmissionRules: [
      { fact_id: "fact-a", proposition_ref: "prop-a", polarity: "supports_true" },
    ],
    ...options,
  });
  engine.createWorld({
    world_id: "world-a",
    world_pack_id: "test.world",
    world_pack_version: "1.0.0",
    game_time: "2026-01-01T00:00:00Z",
  });
  engine.commitEvent("world-a", {
    event_id: "seed",
    idempotency_key: "seed-key",
    turn_id: "seed",
    event_type: "action.completed",
    expected_revision: 0,
    effects: [
      { kind: "entity.create", entity_id: "npc-a", entity_type: "character" },
      { kind: "fact.set", fact_id: "fact-a", predicate: "secret", value: "private-value" },
    ],
  });
  engine.recordTrustedInitialKnowledgeSource({
    world_id: "world-a",
    source_bytes: sourceBytes,
    idempotency_key: "source-key",
    expected_revision: 1,
    expected_commit_sequence: 1,
  });
  return { store, engine };
}

function readRequest(store) {
  const world = store.world("world-a");
  return {
    world_id: "world-a",
    actor_id: "npc-a",
    purpose: "npc_turn_context",
    expected_revision: world.world_revision,
    expected_commit_sequence: store.currentCommitSequence("world-a"),
    limit: 20,
  };
}

test("Core prepares NPC epistemic events only after its own authorized read", (t) => {
  const { store, engine } = setup(t);
  const result = engine.prepareNpcEpistemicEvents(readRequest(store));
  assert.equal(result.status, "ready");
  assert.equal(result.received_count, 1);
  assert.equal(result.admitted_count, 1);
  assert.deepEqual(result.events.map((event) => event.type), [
    "information_received", "evidence_admitted",
  ]);
  assert.equal(result.events[1].proposition_ref, "prop-a");
});

test("Core read authorization is still required to prepare epistemic events", (t) => {
  const { store, engine } = setup(t, { npcKnowledgeReadAuthorizer: null });
  assert.throws(() => engine.prepareNpcEpistemicEvents(readRequest(store)), {
    code: "NPC_KNOWLEDGE_READ_NOT_CONFIGURED",
  });
});

test("Core can receive acquired information without admitting it as evidence", (t) => {
  const { store, engine } = setup(t, { npcEpistemicAdmissionRules: [] });
  const result = engine.prepareNpcEpistemicEvents(readRequest(store));
  assert.equal(result.status, "ready");
  assert.equal(result.received_count, 1);
  assert.equal(result.admitted_count, 0);
  assert.deepEqual(result.events.map((event) => event.type), ["information_received"]);
});

test("deployment-owned admission rules reject duplicates at engine setup", (t) => {
  const store = new SQLiteStore(":memory:");
  t.after(() => store.close());
  assert.throws(() => new LogicEngine(store, {
    npcEpistemicAdmissionRules: [
      { fact_id: "fact-a", proposition_ref: "prop-a", polarity: "supports_true" },
      { fact_id: "fact-a", proposition_ref: "prop-b", polarity: "supports_false" },
    ],
  }), /duplicate fact_id/);
});
