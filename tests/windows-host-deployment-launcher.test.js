import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const launcherPath = new URL('../scripts/Start-LogicEngine-PR870-Test.ps1', import.meta.url);

test('Windows PR 870 launcher resolves and records the candidate instead of pinning stale code', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /CandidateRef\s*=\s*"integration\/host-core-v1"/);
  assert.match(source, /git -C \$LogicRepo rev-parse HEAD/);
  assert.doesNotMatch(source, /928eb5625ea17c1febb403824bfc622a0065d7b6/);
});

test('Windows PR 870 launcher uses the canonical full Host installer', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /scripts\/install-sillytavern-host-plugin\.ps1/);
  assert.match(source, /& \$installer -SillyTavernRoot \$TestSt/);
  assert.doesNotMatch(source, /sillytavern-patch-manager\.mjs/);
  assert.doesNotMatch(source, /gatewayCopyArgs/);
});

test('Windows PR 870 launcher verifies a clean locked SillyTavern source before copying', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /SILLYTAVERN_VERSION_UNSUPPORTED/);
  assert.match(source, /SILLYTAVERN_PACKAGE_LOCK_MISSING/);
  assert.match(source, /npm\.cmd/);
  assert.match(source, /"ci", "--no-audit", "--no-fund"/);
  assert.match(source, /USE_CLEAN_RELEASE/);
});

test('Windows PR 870 launcher uses the SillyTavern source pin and never enables Memory NPC', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /PinnedStCommit = "06bde939fb1e9c4c8d8641d810f0a916b5bce127"/);
  assert.match(source, /LOGIC_ENGINE_HOST_BUILD_SHA = \$PinnedStCommit/);
  assert.match(source, /LOGIC_ENGINE_MEMORY_NPC_ENABLED = "false"/);
  assert.match(source, /LOGIC_ENGINE_HOST_ACCEPTANCE_MODE = "LOCAL_LOOPBACK_ONLY"/);
});

test('Windows PR 870 smoke launcher does not claim Core authority or require ST-VectorService', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /Core API: not started by this smoke test/);
  assert.match(source, /ST-VectorService: not required and not used/);
  assert.match(source, /Root Inventory authority remains NON_READY/);
});
