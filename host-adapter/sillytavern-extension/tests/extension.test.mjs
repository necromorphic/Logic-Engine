import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalizeEngineUrl, fetchHealth } from '../bridge-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repo = resolve(root, '../..');

test('engine URL accepts only a bare HTTP(S) origin', () => {
  assert.equal(normalizeEngineUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(normalizeEngineUrl('https://engine.example'), 'https://engine.example');
  for (const value of ['', 'not a url', 'file:///tmp', 'http://user:pass@host', 'http://host/path', 'http://host/?x=1', 'http://host/#x']) {
    assert.throws(() => normalizeEngineUrl(value));
  }
});

test('health check uses a read-only request and validates the protocol envelope', async () => {
  let called;
  const result = await fetchHealth('http://127.0.0.1:8787', async (url, options) => {
    called = { url, options };
    return { ok: true, status: 200, json: async () => ({ ok: true, service: 'logic-engine', protocol_version: 'v1' }) };
  });
  assert.deepEqual(result, { ok: true, service: 'logic-engine', protocol_version: 'v1' });
  assert.equal(called.url, 'http://127.0.0.1:8787/health');
  assert.equal(called.options.method, 'GET');
  assert.equal(called.options.credentials, 'omit');
  assert.equal(called.options.cache, 'no-store');
  assert.equal(called.options.redirect, 'error');
});

test('health check rejects non-Logic-Engine response and HTTP errors', async () => {
  await assert.rejects(fetchHealth('http://127.0.0.1:8787', async () => ({ ok: true, json: async () => ({ ok: true, service: 'other', protocol_version: 'v1' }) })), /does not match|не соответствует/i);
  await assert.rejects(fetchHealth('http://127.0.0.1:8787', async () => ({ ok: false, status: 503, json: async () => ({}) })), /HTTP 503/);
});

test('extension manifest and UI use the pinned ST extension contract', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const js = await readFile(resolve(root, 'index.js'), 'utf8');
  const html = await readFile(resolve(root, 'settings.html'), 'utf8');
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.hooks.activate, 'init');
  assert.equal(manifest.hooks.disable, 'cleanup');
  assert.match(js, /renderExtensionTemplateAsync/);
  assert.match(js, /logicEngineHostLifecycle/);
  assert.match(js, /export function cleanup\(\)/);
  assert.match(js, /new AbortController\(\)/);
  assert.match(js, /addEventListener\('click',[\s\S]*?\{ signal \}\)/);
  assert.match(html, /logic_engine_check/);
  assert.match(html, /logic_engine_enroll/);
});



test('health check fails closed on transport failure and malformed JSON', async () => {
  await assert.rejects(
    fetchHealth('http://127.0.0.1:8787', async () => { throw new Error('offline'); }),
    /offline/,
  );
  await assert.rejects(
    fetchHealth('http://127.0.0.1:8787', async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } })),
    /invalid JSON/,
  );
});

test('health request can be cancelled when the extension disables', async () => {
  const controller = new AbortController();
  let receivedSignal;
  const request = fetchHealth('http://127.0.0.1:8787', async (_url, options) => {
    receivedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }, controller.signal);
  controller.abort();
  assert.ok(receivedSignal?.aborted);
  await assert.rejects(request, /aborted/);
});

test('generated Host patch excludes provider routes and includes a digest-only proxy', async () => {
  const output = resolve(root, 'patches/sillytavern-1.19.0-logic-engine-bridge.patch');
  try {
    execFileSync(process.execPath, [resolve(root, 'prepare-pinned-st-patch.mjs')], { stdio: 'pipe' });
    const patch = await readFile(output, 'utf8');
    assert.match(patch, /src\/endpoints\/logic-engine-lifecycle\.js/);
    assert.match(patch, /src\/endpoints\/logic-engine-lifecycle-proxy\.mjs/);
    assert.match(patch, /api\/logic-engine\/host-version-ledger\/capture/);
    assert.doesNotMatch(patch, /chat-completions|MakerSuite|Gemini|Google AI/);
    assert.doesNotMatch(patch, /content_text|raw_message|message_text/);
  } finally {
    await unlink(output).catch(() => {});
  }
});
