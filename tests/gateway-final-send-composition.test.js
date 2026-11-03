import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Memory-enabled generation never downgrades a complete-empty Lane B result to native send', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /return received;/);
  assert.doesNotMatch(source, /received\.candidates\.length\s*===\s*0\s*\?\s*null\s*:\s*received/);
  assert.match(source, /Lane A projection/);
  assert.match(source, /unprotected null\/native fallback/);
});

test('unavailable production Gateway is terminal for protected dispatch and final response writes', async () => {
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  const gatewayStart = source.indexOf('const unavailableGateway = Object.freeze({');
  const gatewayEnd = source.indexOf('\n});', gatewayStart);
  assert.ok(gatewayStart >= 0 && gatewayEnd > gatewayStart);
  const gateway = source.slice(gatewayStart, gatewayEnd);
  assert.match(gateway, /dispatchProtectedRequest\(\)[\s\S]*throw new Error\('MEMORY_DISPATCH_NOT_READY'\)/);
  assert.match(gateway, /authorizeResponseWrite\(\)[\s\S]*throw new Error\('MEMORY_DISPATCH_NOT_READY'\)/);
});
