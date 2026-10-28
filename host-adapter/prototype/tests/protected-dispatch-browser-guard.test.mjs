import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProtectedDispatchAllowed } from '../protected-dispatch-browser-guard.mjs';

function storageWith(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    key(index) { return [...map.keys()][index] ?? null; },
    get length() { return map.size; },
  };
}

test('non-enrolled chat can continue using native SillyTavern generation', () => {
  assert.deepEqual(
    assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage: storageWith() }),
    { status: 'NOT_ENROLLED' },
  );
});

test('enrolled chat is blocked before Generate can reach a model backend', () => {
  const storage = storageWith({
    'logic-engine-host-lifecycle-locator:chat-a.jsonl': 'install-id:conversation-id',
  });
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage }),
    /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
  );
});

test('legacy enrollment markers and marker values also fail closed', () => {
  const legacy = storageWith({
    'logic-engine-host-lifecycle:chat-a.jsonl': 'enrolled:chat-a.jsonl',
  });
  const markerValue = storageWith({
    'logic-engine-host-lifecycle:install-id:conversation-id': 'enrolled:chat-a.jsonl',
  });
  for (const storage of [legacy, markerValue]) {
    assert.throws(
      () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage }),
      /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
    );
  }
});

test('missing locator or unavailable storage fails closed', () => {
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: null, storage: storageWith() }),
    /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
  );
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage: null }),
    /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
  );
});
