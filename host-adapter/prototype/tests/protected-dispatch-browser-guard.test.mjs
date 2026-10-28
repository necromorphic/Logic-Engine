import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProtectedDispatchAllowed, installProtectedEgressBrowserFence } from '../protected-dispatch-browser-guard.mjs';

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

test('non-enrolled chat can continue using native SillyTavern generation before any Host enrollment exists', () => {
  assert.deepEqual(
    assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage: storageWith(), messages: [] }),
    { status: 'NOT_ENROLLED' },
  );
});

test('enrolled chat is blocked before Generate can reach a model backend', () => {
  const storage = storageWith({
    'logic-engine-host-lifecycle-locator:chat-a.jsonl': 'install-id:conversation-id',
  });
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage, messages: [] }),
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
      () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage, messages: [] }),
      /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
    );
  }
});

test('missing locator or unavailable storage fails closed', () => {
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: null, storage: storageWith(), messages: [] }),
    /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
  );
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage: null, messages: [] }),
    /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
  );
});

test('lost enrollment markers fail closed when another Host enrollment remains', () => {
  const storage = storageWith({
    'logic-engine-host-lifecycle:install-id:conversation-a': 'enrolled:chat-a.jsonl',
    'logic-engine-host-lifecycle-locator:chat-b.jsonl': 'install-id:conversation-b',
  });
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage, messages: [] }),
    /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
  );
});

test('lost localStorage markers fail closed when native chat retains Host lifecycle identity metadata', () => {
  const storage = storageWith();
  const messages = [{
    mes: 'content',
    _logicEngineLifecycle: {
      messageId: 'message-1',
      versions: [{ versionId: 'version-1' }],
      activeVersionIndex: 0,
    },
  }];
  assert.throws(
    () => assertProtectedDispatchAllowed({ locator: 'chat-a.jsonl', storage, messages }),
    /PROTECTED_EGRESS_GATEWAY_REQUIRED/,
  );
});


function fakeBrowser({ enrolled = false } = {}) {
  const storage = storageWith(enrolled ? {
    'logic-engine-host-lifecycle-locator:chat-a.jsonl': 'install-id:conversation-id',
  } : {});
  const calls = [];
  class FakeXHR {
    open(method, url) { calls.push({ kind: 'xhr', method, url }); }
  }
  const browser = {
    location: { href: 'http://localhost:8000/' },
    localStorage: storage,
    XMLHttpRequest: FakeXHR,
    async fetch(url, init) { calls.push({ kind: 'fetch', url: String(url), init }); return { ok: true }; },
  };
  return { browser, calls, storage };
}

test('browser egress fence blocks cross-origin fetch before transport for enrolled installation', async () => {
  const { browser, calls } = fakeBrowser({ enrolled: true });
  const uninstall = installProtectedEgressBrowserFence({
    globalObject: browser,
    getLocator: () => 'chat-a.jsonl',
    getMessages: () => [],
  });
  try {
    await assert.rejects(() => browser.fetch('http://127.0.0.1:7851/tts', { method: 'POST' }), /PROTECTED_EGRESS_GATEWAY_REQUIRED/);
    assert.equal(calls.length, 0, 'no direct external request may reach fetch');
  } finally {
    uninstall();
  }
});

test('browser egress fence preserves same-origin requests for server-side policy enforcement', async () => {
  const { browser, calls } = fakeBrowser({ enrolled: true });
  const uninstall = installProtectedEgressBrowserFence({
    globalObject: browser,
    getLocator: () => 'chat-a.jsonl',
    getMessages: () => [],
  });
  try {
    await browser.fetch('/api/backends/chat-completions/generate', { method: 'POST' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
  } finally {
    uninstall();
  }
});

test('browser egress fence blocks direct cross-origin XHR before open for enrolled installation', () => {
  const { browser, calls } = fakeBrowser({ enrolled: true });
  const uninstall = installProtectedEgressBrowserFence({
    globalObject: browser,
    getLocator: () => 'chat-a.jsonl',
    getMessages: () => [],
  });
  try {
    const xhr = new browser.XMLHttpRequest();
    assert.throws(() => xhr.open('POST', 'http://localhost:7851/tts'), /PROTECTED_EGRESS_GATEWAY_REQUIRED/);
    assert.equal(calls.length, 0);
  } finally {
    uninstall();
  }
});

test('browser egress fence preserves direct external requests before any Host enrollment exists', async () => {
  const { browser, calls } = fakeBrowser();
  const uninstall = installProtectedEgressBrowserFence({
    globalObject: browser,
    getLocator: () => 'chat-a.jsonl',
    getMessages: () => [],
  });
  try {
    await browser.fetch('https://provider.example/v1/chat/completions', { method: 'POST' });
    assert.equal(calls.length, 1);
  } finally {
    uninstall();
  }
});
