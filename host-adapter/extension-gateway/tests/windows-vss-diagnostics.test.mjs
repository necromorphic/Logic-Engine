import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Windows VSS child diagnostics do not truncate at execFile command metadata', async () => {
  const source = await readFile(new URL('../server-plugin/windows-vss-snapshot.mjs', import.meta.url), 'utf8');
  const catchStart = source.indexOf('async function runPowerShell');
  const catchEnd = source.indexOf('\n}\n\n/**', catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart, 'runPowerShell must remain present');
  const implementation = source.slice(catchStart, catchEnd);

  assert.match(implementation, /error\?\.stdout/);
  assert.match(implementation, /error\?\.stderr/);
  assert.match(implementation, /error\?\.code/);
  assert.match(implementation, /error\?\.signal/);
  assert.match(implementation, /error\?\.syscall/);
  assert.match(implementation, /error\?\.path/);
  assert.doesNotMatch(implementation, /error\?\.message/,
    'execFile error.message includes the encoded command and can hide the actual failure');
  assert.match(implementation, /No child output or spawn metadata/);
});
