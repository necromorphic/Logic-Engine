import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStatus } from '../diagnostic-extension/index.js';

test('diagnostic UI reports an absent server route distinctly', () => {
  assert.deepEqual(describeStatus({ status: 404, ok: false }, null), {
    text: 'Серверный диагностический маршрут не установлен.',
    state: 'warning',
  });
});

test('diagnostic UI reports server-side configuration and transport failures', () => {
  assert.equal(describeStatus({ status: 503, ok: false }, { error: { code: 'LOGIC_ENGINE_PROXY_UNCONFIGURED' } }).state, 'warning');
  assert.equal(describeStatus({ status: 503, ok: false }, { error: { code: 'LOGIC_ENGINE_UNREACHABLE' } }).state, 'error');
  assert.equal(describeStatus({ status: 502, ok: false }, { error: { code: 'LOGIC_ENGINE_UNHEALTHY' } }).state, 'error');
});

test('diagnostic UI reports success only for the expected service and response contract', () => {
  const result = describeStatus({ status: 200, ok: true }, {
    status: 'reachable',
    service: 'logic-engine',
    protocol_version: 'v1',
  });
  assert.deepEqual(result, { text: 'Logic-Engine доступен (protocol v1).', state: 'success' });
  assert.equal(describeStatus({ status: 200, ok: true }, { status: 'reachable', service: 'other' }).state, 'error');
  assert.equal(describeStatus({ status: 200, ok: true }, null).state, 'error');
});
