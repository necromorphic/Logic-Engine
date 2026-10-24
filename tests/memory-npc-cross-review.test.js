import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const handoffPath = new URL('../docs/78-memory-npc-1.4-cross-review.md', import.meta.url);

test('Memory/NPC cross-review names the clean NPC-owned evidence and its limits', async () => {
  const doc = await readFile(handoffPath, 'utf8');
  for (const item of [
    'PRs #150/#151',
    'merged Memory handoff PR #161',
    'merged NPC matrix PR #159',
    'consolidated NPC acceptance matrix was subsequently carried to current main by merged PR #159',
    'tests/npc-memory-candidate-eligibility.test.js',
    'docs/56-npc-memory-boundary-acceptance-matrix.md',
    'not a real Memory source adapter or production consumer',
    'not independently authenticated by the oracle',
    'Production Memory → NPC remains disabled',
    'merged by PR #161',
  ]) {
    assert.ok(doc.includes(item), `cross-review must preserve: ${item}`);
  }
});

test('Memory/NPC cross-review assigns real-path closure tests to named owners', async () => {
  const doc = await readFile(handoffPath, 'utf8');
  for (const item of [
    'Core + Memory + host adapter owner',
    'Core + Memory',
    'Memory + host/index owner',
    'Memory + Core + host/index owner',
    'NPC + Core + host adapter',
    'world_revision',
    'commit_sequence',
    'cross-store atomicity',
    'receipt remains unconfirmed',
  ]) {
    assert.ok(doc.includes(item), `cross-review must specify owner/test boundary: ${item}`);
  }
});
