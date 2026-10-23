import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { createApiServer } from '../src/api/server.js';

test('HTTP API rejects request bodies larger than 1 MiB', async (t) => {
  const store = new SQLiteStore(':memory:');
  const server = createApiServer({
    engine: new LogicEngine(store),
    token: 'test-token-long-enough-123456',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.close();
    store.close();
  });

  const body = '{"padding":"' + 'x'.repeat(1024 * 1024) + '"}';
  const response = await fetch(base + '/v1/worlds', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token-long-enough-123456',
      'content-type': 'application/json',
    },
    body,
  });

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
});
