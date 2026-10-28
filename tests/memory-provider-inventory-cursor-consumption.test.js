import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanonicalEntityInventoryValidator } from '../src/application/canonical-entity-source-version.js';

const token = 'core-entity-v1:1';
const entity = (entity_id) => ({
  entity_id,
  status: 'active',
  source_version: token,
});

const record = (entity_id) => ({
  world_id: 'world-a',
  source_kind: 'canonical_entity',
  source_entity_id: entity_id,
  source_version: token,
});

test('Provider inventory validator starts at page one and follows only Core-returned continuation', async () => {
  const calls = [];
  const continuation = {
    after_entity_id: 'entity-a',
    world_revision: 7,
    commit_sequence: 3,
    // This field is not treated by Provider as an authenticity proof.
    cursor_digest: 'consistency-only-fixture',
  };
  const engine = {
    getCanonicalEntityInventory(worldId, options) {
      calls.push({ worldId, cursor: options.cursor ?? null });
      if (calls.length === 1) {
        return {
          world_id: worldId,
          world_revision: 7,
          commit_sequence: 3,
          entities: [entity('entity-a')],
          complete: false,
          next_cursor: continuation,
        };
      }
      return {
        world_id: worldId,
        world_revision: 7,
        commit_sequence: 3,
        entities: [entity('entity-b')],
        complete: true,
        next_cursor: null,
      };
    },
  };

  const validateInventory = createCanonicalEntityInventoryValidator(engine);
  assert.equal(await validateInventory('world-a', [record('entity-a')]), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { worldId: 'world-a', cursor: null });
  assert.deepEqual(calls[1], { worldId: 'world-a', cursor: continuation });
});

test('Provider inventory validator rejects a continuation that skips beyond the last consumed entity', async () => {
  let calls = 0;
  const engine = {
    getCanonicalEntityInventory(worldId) {
      calls += 1;
      return {
        world_id: worldId,
        world_revision: 7,
        commit_sequence: 3,
        entities: [entity('entity-a')],
        complete: false,
        next_cursor: {
          after_entity_id: 'entity-z',
          world_revision: 7,
          commit_sequence: 3,
          cursor_digest: 'recomputed-or-otherwise-untrusted',
        },
      };
    },
  };

  const validateInventory = createCanonicalEntityInventoryValidator(engine);
  assert.equal(await validateInventory('world-a', [record('entity-a')]), false);
  assert.equal(calls, 1, 'must fail before requesting a page that could skip unseen entities');
});
