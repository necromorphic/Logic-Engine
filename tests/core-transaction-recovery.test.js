import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ProposalService } from '../src/application/proposals.js';

test('proposal commit, rollback, rebuild, and close/reopen preserve one canonical history', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-core-recovery-'));
  const path = join(directory, 'world.sqlite');
  let store = new SQLiteStore(path);
  let engine = new LogicEngine(store);
  const worldId = 'core-recovery-world';

  t.after(() => {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  engine.createWorld({
    world_id: worldId,
    world_pack_id: 'test.world',
    world_pack_version: '1.0.0',
    game_time: '2005-12-29T10:00:00.000Z',
  });

  const proposals = new ProposalService(engine);
  const proposal = proposals.create(worldId, {
    idempotency_key: 'recovery-proposal',
    source_text: 'Create a test object, then roll its event back.',
    event: {
      turn_id: 'recovery-turn',
      event_type: 'action.completed',
      effects: [{
        kind: 'entity.upsert',
        entity_id: 'recovery-object',
        entity_type: 'object',
        attributes: { marker: 'should-be-rolled-back' },
      }],
    },
  }, 'recovery-test-adapter');

  proposals.approve(worldId, proposal.proposal_id);
  const committed = proposals.commit(worldId, proposal.proposal_id);
  const eventId = committed.commit_result.event_id;

  assert.equal(committed.status, 'committed');
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'recovery-object'), true);
  assert.equal(engine.getState(worldId).world_revision, 1);
  assert.equal(engine.getState(worldId).commit_sequence, 1);

  const rollback = engine.rollbackEvent(worldId, {
    root_event_id: eventId,
    idempotency_key: 'recovery-rollback',
  });
  assert.equal(rollback.accepted, true);
  assert.equal(engine.getState(worldId).world_revision, 2);
  assert.equal(engine.getState(worldId).commit_sequence, 1);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'recovery-object'), false);
  // Core exposes a root rollback as an explicit retraction, not generic invalidation.
  assert.equal(engine.getEvents(worldId, true).find((event) => event.event_id === eventId).validity, 'retracted');

  // Rebuild from canonical history before closing, then reopen the same DB and
  // rebuild again. The visible projection must not resurrect the invalidated event.
  store.rebuild(worldId, engine.getState(worldId).world_revision);
  assert.equal(engine.getState(worldId).entities.some((entity) => entity.entity_id === 'recovery-object'), false);
  const beforeCloseState = engine.getState(worldId);
  const beforeCloseEvents = engine.getEvents(worldId, true);
  const beforeCloseAudit = engine.getAudit(worldId);

  store.close();
  store = new SQLiteStore(path);
  engine = new LogicEngine(store);
  store.rebuild(worldId, engine.getState(worldId).world_revision);

  const reopenedState = engine.getState(worldId);
  assert.equal(reopenedState.world_revision, 2);
  assert.equal(reopenedState.commit_sequence, 1);
  assert.equal(reopenedState.entities.some((entity) => entity.entity_id === 'recovery-object'), false);
  assert.deepEqual(
    engine.getEvents(worldId, true).map((event) => ({
      event_id: event.event_id,
      validity: event.validity,
      commit_sequence: event.commit_sequence,
    })),
    beforeCloseEvents.map((event) => ({
      event_id: event.event_id,
      validity: event.validity,
      commit_sequence: event.commit_sequence,
    })),
  );
  assert.deepEqual(engine.getAudit(worldId), beforeCloseAudit);
  assert.deepEqual(
    { world_revision: reopenedState.world_revision, commit_sequence: reopenedState.commit_sequence, game_time_coordinate: reopenedState.game_time_coordinate },
    { world_revision: beforeCloseState.world_revision, commit_sequence: beforeCloseState.commit_sequence, game_time_coordinate: beforeCloseState.game_time_coordinate },
  );
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM rollbacks WHERE world_id=?').get(worldId).count, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM event_proposals WHERE world_id=? AND status='committed'").get(worldId).count, 1);
});
