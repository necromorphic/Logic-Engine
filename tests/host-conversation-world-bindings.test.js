import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { HostConversationWorldBindingService } from '../src/application/host-conversation-world-bindings.js';

function setup(t) {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  const service = new HostConversationWorldBindingService(engine);
  for (const worldId of ['binding-world-a', 'binding-world-b']) {
    engine.createWorld({
      world_id: worldId, world_pack_id: 'test.binding', world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
  }
  t.after(() => store.close());
  return { store, engine, service };
}

test('Host conversation resolves only through adapter-scoped Core binding, never caller world_id', (t) => {
  const { service } = setup(t);
  assert.throws(() => service.resolve({ adapterId: 'adapter-a', conversationId: 'chat-1' }),
    (error) => error.code === 'HOST_CONVERSATION_NOT_AUTHORIZED');
  const bound = service.bind({ adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-a' });
  assert.equal(bound.world_id, 'binding-world-a');
  assert.equal(bound.already_bound, false);
  assert.equal(service.resolve({ adapterId: 'adapter-a', conversationId: 'chat-1' }).world_id, 'binding-world-a');
  assert.throws(() => service.resolve({ adapterId: 'adapter-b', conversationId: 'chat-1' }),
    (error) => error.code === 'HOST_CONVERSATION_NOT_AUTHORIZED');
  assert.throws(() => service.resolve({ adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-b' }),
    (error) => error.code === 'INVALID_HOST_CONVERSATION_RESOLUTION');
});

test('duplicate binding is idempotent; silent reassignment and revoked resolution fail closed', (t) => {
  const { store, service } = setup(t);
  service.bind({ adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-a' });
  assert.equal(service.bind({ adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-a' }).already_bound, true);
  assert.throws(() => service.bind({
    adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-b',
  }), (error) => error.code === 'HOST_CONVERSATION_WORLD_CONFLICT');

  const revoked = service.revoke({
    adapterId: 'adapter-a', conversationId: 'chat-1', reason: 'Host conversation was deleted',
  });
  assert.equal(revoked.changed, true);
  assert.throws(() => service.resolve({ adapterId: 'adapter-a', conversationId: 'chat-1' }),
    (error) => error.code === 'HOST_CONVERSATION_NOT_AUTHORIZED');
  assert.throws(() => service.bind({
    adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-b',
  }), (error) => error.code === 'HOST_CONVERSATION_REBIND_REQUIRED');

  service.bind({
    adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-b',
    rebind: true, reason: 'Explicit administrator-approved world reassignment',
  });
  assert.equal(service.resolve({ adapterId: 'adapter-a', conversationId: 'chat-1' }).world_id, 'binding-world-b');
  const audit = store.db.prepare("SELECT action,payload_json FROM audit_entries WHERE action LIKE 'host.conversation_world.%' ORDER BY audit_id").all();
  assert.deepEqual(audit.map(row => row.action), [
    'host.conversation_world.bound', 'host.conversation_world.revoked', 'host.conversation_world.rebound',
  ]);
  assert.equal(JSON.parse(audit[2].payload_json).previous_world_id, 'binding-world-a');
});

test('binding mutations survive Core store restart and revoked state is not resurrected', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'host-conversation-binding-'));
  const path = join(directory, 'core.sqlite');
  let store = new SQLiteStore(path);
  t.after(() => {
    try { store.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  let engine = new LogicEngine(store);
  for (const worldId of ['binding-world-a', 'binding-world-b']) {
    engine.createWorld({
      world_id: worldId, world_pack_id: 'test.binding', world_pack_version: '1',
      game_time: '2026-01-01T00:00:00Z',
    });
  }
  let service = new HostConversationWorldBindingService(engine);
  service.bind({ adapterId: 'adapter-a', conversationId: 'chat-1', worldId: 'binding-world-a' });
  store.close();

  store = new SQLiteStore(path);
  engine = new LogicEngine(store);
  service = new HostConversationWorldBindingService(engine);
  assert.equal(service.resolve({ adapterId: 'adapter-a', conversationId: 'chat-1' }).world_id, 'binding-world-a');
  service.revoke({ adapterId: 'adapter-a', conversationId: 'chat-1', reason: 'Host conversation was deleted' });
  store.close();

  store = new SQLiteStore(path);
  engine = new LogicEngine(store);
  service = new HostConversationWorldBindingService(engine);
  assert.throws(() => service.resolve({ adapterId: 'adapter-a', conversationId: 'chat-1' }),
    (error) => error.code === 'HOST_CONVERSATION_NOT_AUTHORIZED');
});
