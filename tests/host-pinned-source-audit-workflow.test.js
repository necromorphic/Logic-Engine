import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/host-adapter-pinned-source-audit.yml', import.meta.url),
  'utf8',
);

test('Windows pinned-source audit propagates every Node test failure', () => {
  const lines = workflow.split('\n');
  const commands = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimStart().startsWith('node --test '));

  assert.equal(commands.length, 3, 'all three pinned-source test suites must remain explicit');
  for (const { index } of commands) {
    const nextNonEmpty = lines.slice(index + 1).find(candidate => candidate.trim());
    assert.ok(
      nextNonEmpty?.trim().startsWith('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'),
      'each Node test suite must stop the PowerShell step on a non-zero exit code',
    );
  }
});

test('Windows pinned-source syntax checks propagate Node failures', () => {
  assert.ok(workflow.includes('function Assert-NodeSyntax([string]$file)'));
  assert.ok(workflow.includes('if ($LASTEXITCODE -ne 0) { throw "Node syntax check failed: $file" }'));
});
