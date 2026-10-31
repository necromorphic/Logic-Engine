import test from "node:test";
import assert from "node:assert/strict";
import { SQLiteStore } from "../src/storage/sqlite-store.js";
import { LogicEngine } from "../src/application/engine.js";
import { ActorBindingService } from "../src/application/actor-bindings.js";
import { AuthorizedReadService } from "../src/application/authorized-read-service.js";
import { MechanicPolicyAuthority } from "../src/application/mechanic-policy-authority.js";
import { createObserveTargetCycle } from "../src/npc/observe-target.js";

function setup(t, fieldPolicy = (_context, _entity, field) => field === "attributes.name") {
  const store = new SQLiteStore(":memory:");
  const engine = new LogicEngine(store);
  const bindings = new ActorBindingService(engine);
  engine.createWorld({
    world_id: "observe-world",
    world_pack_id: "test.world",
    world_pack_version: "1",
    game_time: "2026-01-01T00:00:00Z",
  });
  engine.commitEvent("observe-world", {
    idempotency_key: "seed-observe-world",
    turn_id: "seed-observe-world",
    event_type: "action.completed",
    expected_revision: 0,
    effects: [
      { kind: "entity.create", entity_id: "actor-a", entity_type: "character", attributes: { name: "Actor" } },
      { kind: "entity.create", entity_id: "target-a", entity_type: "character", attributes: { name: "Target", secret: "classified" } },
    ],
  });
  bindings.bind("observe-world", "adapter-a", "actor-a");
  const authority = new MechanicPolicyAuthority({
    authorityId: "observe-test-policy",
    generation: 1,
    fieldPolicy,
  });
  const authorizedReadService = new AuthorizedReadService(engine, bindings, authority);
  const getTrustedReadContext = () => ({
    worldId: "observe-world",
    adapterId: "adapter-a",
    actorEntityId: "actor-a",
    expectedWorldRevision: engine.getState("observe-world").world_revision,
    expectedCommitSequence: store.currentCommitSequence("observe-world"),
    expectedPolicyAuthority: authority.getSnapshot(),
  });
  const cycle = createObserveTargetCycle({ authorizedReadService, getTrustedReadContext });
  t.after(() => store.close());
  return { store, engine, bindings, authority, cycle };
}

test("observes one policy-authorized target attribute and returns a scoped receipt without world mutation", (t) => {
  const { store, engine, cycle } = setup(t, (context, entity, field) =>
    context.worldId === "observe-world"
      && context.actor.entity_id === "actor-a"
      && context.recipient === "model"
      && context.purpose === "npc_decision"
      && entity.entity_id === "target-a"
      && field === "attributes.name");

  const before = {
    revision: engine.getState("observe-world").world_revision,
    sequence: store.currentCommitSequence("observe-world"),
    events: store.events("observe-world", true).length,
    audit: store.audit("observe-world").length,
  };
  const receipt = cycle.observeTarget({ targetEntityId: "target-a", attribute: "name" });

  assert.deepEqual(receipt, {
    receipt_type: "npc.observe-target.receipt.v1",
    status: "observed",
    world_id: "observe-world",
    actor_entity_id: "actor-a",
    target_entity_id: "target-a",
    attribute: "name",
    world_revision: before.revision,
    commit_sequence: before.sequence,
    policy_authority: { authority_id: "observe-test-policy", generation: 1 },
    present: true,
    value: "Target",
  });
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(engine.getState("observe-world").world_revision, before.revision);
  assert.equal(store.currentCommitSequence("observe-world"), before.sequence);
  assert.equal(store.events("observe-world", true).length, before.events);
  assert.equal(store.audit("observe-world").length, before.audit);
});

test("denied attributes fail closed and do not produce an observation receipt", (t) => {
  const { cycle } = setup(t, (_context, _entity, field) => field === "attributes.name");
  assert.throws(
    () => cycle.observeTarget({ targetEntityId: "target-a", attribute: "secret" }),
    (error) => error.code === "READ_NOT_AVAILABLE" && error.status === 404,
  );
});

test("authorized absence is represented explicitly without inventing a value", (t) => {
  const { cycle } = setup(t, (_context, _entity, field) => field === "attributes.name" || field === "attributes.nickname");
  const receipt = cycle.observeTarget({ targetEntityId: "target-a", attribute: "nickname" });
  assert.equal(receipt.present, false);
  assert.equal(Object.hasOwn(receipt, "value"), false);
});

test("revoked actor binding prevents observation", (t) => {
  const { cycle, bindings } = setup(t, () => true);
  bindings.revoke("observe-world", "adapter-a", "actor-a");
  assert.throws(
    () => cycle.observeTarget({ targetEntityId: "target-a", attribute: "name" }),
    (error) => error.code === "ACTOR_NOT_AUTHORIZED",
  );
});

test("malformed or multi-target input is rejected before trusted context is requested", () => {
  let contextCalls = 0;
  const cycle = createObserveTargetCycle({
    authorizedReadService: { readEntityAttributeForMechanic: () => { throw new Error("must not read"); } },
    getTrustedReadContext: () => { contextCalls += 1; return {}; },
  });
  assert.throws(() => cycle.observeTarget({ targetEntityId: "target-a", attribute: "name", actorEntityId: "forged" }), TypeError);
  assert.throws(() => cycle.observeTarget({ targetEntityId: ["target-a"], attribute: "name" }), TypeError);
  assert.throws(() => cycle.observeTarget({ targetEntityId: "target-a", attribute: "__proto__" }), TypeError);
  assert.equal(contextCalls, 0);
});

test("stale trusted world cursor prevents an observation from a changed snapshot", (t) => {
  const { cycle, engine } = setup(t);
  const revision = engine.getState("observe-world").world_revision;
  const changed = engine.commitEvent("observe-world", {
    idempotency_key: "mutate-before-observation",
    turn_id: "mutate-before-observation",
    event_type: "action.completed",
    expected_revision: revision,
    effects: [{ kind: "entity.create", entity_id: "new-entity", entity_type: "object" }],
  });
  assert.equal(changed.accepted, true);
  // The provider supplies the latest cursor. A stale cursor is tested by pinning
  // the original snapshot in a deliberately stale trusted provider.
  const staleCycle = createObserveTargetCycle({
    authorizedReadService: cycle ? {
      readEntityAttributeForMechanic: (request) => {
        const { authorizedReadService } = setupDependencies;
        return authorizedReadService.readEntityAttributeForMechanic(request);
      },
    } : null,
    getTrustedReadContext: () => ({
      worldId: "observe-world",
      adapterId: "adapter-a",
      actorEntityId: "actor-a",
      expectedWorldRevision: revision,
      expectedCommitSequence: 1,
      expectedPolicyAuthority: setupDependencies.authority.getSnapshot(),
    }),
  });
  assert.throws(
    () => staleCycle.observeTarget({ targetEntityId: "target-a", attribute: "name" }),
    (error) => error.code === "STALE_AUTHORIZED_READ_SNAPSHOT",
  );
});
