import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Memory Provider database path is initialized before Host nonce-store construction', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const declaration = source.indexOf('const memoryProviderPath = process.env.ENGINE_MEMORY_PROVIDER_DB_PATH;');
  const nonceStore = source.indexOf('const hostAssertionNonceStore = new HostAssertionNonceStore({');
  assert.notEqual(declaration, -1, 'Memory Provider path declaration must exist');
  assert.notEqual(nonceStore, -1, 'Host nonce store construction must exist');
  assert.ok(declaration < nonceStore,
    'Memory Provider path must be initialized before it is passed to HostAssertionNonceStore');
});
