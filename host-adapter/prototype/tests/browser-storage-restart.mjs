import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const userDataDir = join(tmpdir(), 'logic-engine-host-browser-storage-' + process.pid);
const pageErrors = [];
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const files = {
      '/harness.html': ['tests/browser-storage-harness.html', 'text/html; charset=utf-8'],
      '/lifecycle-journal.mjs': ['lifecycle-journal.mjs', 'text/javascript; charset=utf-8'],
    };
    const entry = files[pathname];
    if (!entry) { response.writeHead(404).end('not found'); return; }
    const body = await readFile(join(root, entry[0]));
    response.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store' });
    response.end(body);
  } catch (error) { response.writeHead(500).end(String(error?.stack || error)); }
});

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const readResult = async (context, url, expectedMode) => {
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(document.body.dataset.result), { timeout: 15000 });
  const result = JSON.parse(await page.locator('body').getAttribute('data-result'));
  assert.equal(result.mode, expectedMode);
  assert.equal(result.integrity, 'INTEGRITY_OK', JSON.stringify(result));
  assert.equal(result.sequence, 5, JSON.stringify(result));
  assert.equal(result.recordCount, 5, JSON.stringify(result));
  assert.equal(result.filesystemBaselinePresent, true, JSON.stringify(result));
  assert.equal(result.filesystemDeltaPresent, true, JSON.stringify(result));
  assert.equal(result.filesystemDeltaPath, 'chats/a.jsonl', JSON.stringify(result));
  assert.equal(result.rawTextPresent, false, JSON.stringify(result));
  await page.close();
  return result;
};

let context;
try {
  const port = await listen(server);
  const url = 'http://127.0.0.1:' + port + '/harness.html';
  context = await chromium.launchPersistentContext(userDataDir, { headless: true, args: ['--no-sandbox'] });
  const written = await readResult(context, url + '?mode=write', 'write');
  assert.equal(written.sourceFingerprint, 'fingerprint-after');
  await context.close();
  context = null;
  context = await chromium.launchPersistentContext(userDataDir, { headless: true, args: ['--no-sandbox'] });
  const reopened = await readResult(context, url + '?mode=read', 'read');
  assert.equal(reopened.sourceFingerprint, 'fingerprint-after');
  assert.deepEqual(pageErrors, []);
  process.stdout.write(JSON.stringify({ status: 'PASS', browser: 'Chromium', persistence: 'IndexedDB survives browser process close/reopen with the same profile', integrity: reopened.integrity, sequence: reopened.sequence, rawTextPresent: reopened.rawTextPresent }) + '\n');
} finally {
  if (context) await context.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
