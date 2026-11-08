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

test('Windows PR 870 launcher starts an isolated Core with a deployment-owned Host identity registry', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /bootstrap-windows-host-acceptance\.mjs/);
  assert.match(source, /ENGINE_HOST_ROOT_IDENTITIES = \$registryJson/);
  assert.match(source, /LOGIC_ENGINE_CORE_URL = "http:\/\/127\.0\.0\.1:"/);
  assert.match(source, /\/health/);
  assert.match(source, /Core: started with a disposable SQLite database set/);
});

test('Windows PR 870 smoke runner keeps Memory NPC disabled and does not require ST-VectorService', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /LOGIC_ENGINE_MEMORY_NPC_ENABLED = "false"/);
  assert.match(source, /LOGIC_ENGINE_HOST_ACCEPTANCE_MODE = "LOCAL_LOOPBACK_ONLY"/);
  assert.match(source, /ST-VectorService: not required and not used/);
  assert.match(source, /Local mutation acceptance is non-authoritative/);
});

test('Windows Host acceptance bootstrap binds identity to the exact installed source and data root', async () => {
  const source = await readFile(new URL('../scripts/bootstrap-windows-host-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(source, /verifyPinnedSourceIdentity/);
  assert.match(source, /userExtensionsPath: extensionsRoot/);
  assert.match(source, /host_installation_id: identity\.host_installation_id/);
  assert.match(source, /authenticated_account_id: identity\.authenticated_account_id/);
  assert.match(source, /source_manifest_sha256: sourceIdentity\.manifest_sha256/);
  assert.match(source, /createHash\('sha256'\)\.update\(userRoot/);
});

test('Windows production installer checks network tools before creating plugin directories', async () => {
  const source = await readFile(new URL('../scripts/install-sillytavern-host-plugin.ps1', import.meta.url), 'utf8');
  const preflightEnd = source.indexOf("$stPackagePath =");
  const pluginDirectoryCreation = source.indexOf("New-Item -ItemType Directory -Path $pluginRoot");
  assert.ok(preflightEnd > 0 && pluginDirectoryCreation > preflightEnd,
    'Node/Git/npm/network checks must complete before the installer creates plugin directories');
  assert.match(source, /NPM_REGISTRY_UNAVAILABLE/);
  assert.match(source, /SILLYTAVERN_GITHUB_UNAVAILABLE/);
});

test('Windows production installer removes only a proven-unpatched partial first install', async () => {
  const source = await readFile(new URL('../scripts/install-sillytavern-host-plugin.ps1', import.meta.url), 'utf8');
  assert.match(source, /PLUGIN_DEPENDENCY_INSTALL_FAILED/);
  assert.match(source, /PATCH_PREFLIGHT_FAILED/);
  assert.match(source, /PATCH_INSTALL_FAILED/);
  assert.match(source, /statusOutput[\s\S]*ConvertFrom-Json[\s\S]*NOT_INSTALLED/);
  assert.match(source, /Install state could not be proven clean. Plugin files were preserved for recovery/);
});
