import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostSessionHandler } from '../st-host-session-handler.mjs';

function makeResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

test('Host session identity is generated once inside the authenticated signed session', () => {
  const id = '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401';
  const handler = createHostSessionHandler({ createId: () => id });
  const session = { handle: 'alice' };
  const request = { session, user: { profile: { handle: 'alice' } } };
  const first = makeResponse();
  handler(request, first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.host_session_id, id);
  assert.equal(first.body.host_session_identity, 'SIGNED_AUTHENTICATED_ST_SESSION');
  assert.equal(session.logicEngineSessionId, id);
  assert.equal(session.logicEngineSessionHandle, 'alice');
  const second = makeResponse();
  handler(request, second);
  assert.equal(second.body.host_session_id, id);
});

test('Host session identity rotates when the authenticated account changes', () => {
  const ids = [
    '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
    '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402',
  ];
  const session = { handle: 'alice' };
  const handler = createHostSessionHandler({ createId: () => ids.shift() });
  const first = makeResponse();
  handler({ session, user: { profile: { handle: 'alice' } } }, first);
  assert.equal(first.body.host_session_id, '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401');
  session.handle = 'bob';
  const second = makeResponse();
  handler({ session, user: { profile: { handle: 'bob' } } }, second);
  assert.equal(second.body.host_session_id, '3e6b0a80-4e73-4c66-aaf3-7a6e62c7f402');
  assert.equal(session.logicEngineSessionHandle, 'bob');
});

test('Host session identity rejects unauthenticated, mismatched, or malformed sessions', () => {
  const handler = createHostSessionHandler({
    createId: () => '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
  });
  const missing = makeResponse();
  handler({}, missing);
  assert.equal(missing.statusCode, 403);
  const mismatch = makeResponse();
  handler({ session: { handle: 'bob' }, user: { profile: { handle: 'alice' } } }, mismatch);
  assert.equal(mismatch.statusCode, 403);
  const malformed = makeResponse();
  handler({
    session: { handle: 'alice', logicEngineSessionId: 'not-a-uuid' },
    user: { profile: { handle: 'alice' } },
  }, malformed);
  assert.equal(malformed.statusCode, 503);
  assert.deepEqual(malformed.body, { status: 'NON_READY', code: 'HOST_SESSION_ID_INVALID' });
});

test('Host session identity responses are private and never expose cookie material', () => {
  const handler = createHostSessionHandler({
    createId: () => '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401',
  });
  const response = makeResponse();
  handler({
    session: { handle: 'alice', logicEngineSessionId: '2e6b0a80-4e73-4c66-aaf3-7a6e62c7f401', logicEngineSessionHandle: 'alice' },
    user: { profile: { handle: 'alice' } },
    headers: { cookie: 'session=secret-cookie-value' },
  }, response);
  assert.equal(response.headers['cache-control'], 'no-store, private');
  assert.equal(response.headers.vary, 'Cookie');
  assert.equal(JSON.stringify(response.body).includes('secret-cookie-value'), false);
});
