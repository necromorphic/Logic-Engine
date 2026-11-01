import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateDeploymentManifest,
  validateDeploymentReport,
  deploymentSchemaPaths,
} from '../src/deployment/contracts.js';
import {
  createCapabilityEvidence,
  evaluateDeploymentGates,
  aggregateDeploymentStatus,
  buildDeploymentReport,
} from '../src/deployment/policy.js';
import { createPlatformSecurityAdapter } from '../src/deployment/platform-adapter.js';
import { resolveDeploymentPathRegistry } from '../src/deployment/path-registry.js';

function portableManifest() {
  return {
    schema_version: 1,
    deployment_id: 'test-deployment',
    profile: 'portable-desktop',
    platform_policy: { supported_platforms: ['windows', 'linux'], allow_unknown_platform: false },
    components: [
      { id: 'core', enabled: true, security_domain: 'runtime', execution_mode: 'in-process', requires_capabilities: ['platform.identity.inspect'] },
      { id: 'coordinator', enabled: true, security_domain: 'runtime', execution_mode: 'in-process' },
    ],
    resources: [
      {
        id: 'core-db',
        kind: 'database',
        classification: 'canonical',
        owner_domain: 'runtime',
        path: { source: 'deployment-root-relative', value: 'data/core.sqlite' },
        access: { read: ['core'], create: ['core'], append: ['core'], replace: ['core'], delete: ['core'], rename: ['core'] },
        link_policy: 'reject-links',
        backup_policy: 'required',
      },
    ],
    secrets: { provider_preference: ['private-file'], allow_environment_fallback: false },
    backup: { require_independent_freshness_anchor: false, allow_restore_without_anchor: true },
  };
}

test('deployment schemas are present and manifest contract rejects malformed declarations', () => {
  const paths = deploymentSchemaPaths();
  assert.match(paths.manifest, /deployment-manifest\.schema\.json$/);
  assert.match(paths.report, /deployment-report\.schema\.json$/);
  assert.equal(validateDeploymentManifest(portableManifest()).valid, true);
  const invalid = portableManifest();
  invalid.platform_policy.allow_unknown_platform = true;
  assert.throws(() => validateDeploymentManifest(invalid), /DEPLOYMENT_MANIFEST_SCHEMA_INVALID/);
});

test('manifest semantics reject duplicate resources, unknown principals and unsafe hardened restore defaults', () => {
  const duplicate = portableManifest();
  duplicate.resources.push({ ...duplicate.resources[0] });
  assert.throws(() => validateDeploymentManifest(duplicate), /DUPLICATE_RESOURCE_ID/);

  const unknownPrincipal = portableManifest();
  unknownPrincipal.resources[0].access.read = ['missing-component'];
  assert.throws(() => validateDeploymentManifest(unknownPrincipal), /UNKNOWN_ACCESS_PRINCIPAL/);

  const hardened = portableManifest();
  hardened.profile = 'hardened-service';
  assert.throws(() => validateDeploymentManifest(hardened), /CANNOT_ALLOW_RESTORE_WITHOUT_FRESHNESS_ANCHOR/);
});

test('required gates fail closed for absent, unsupported and untested capabilities', () => {
  const components = [{ id: 'core', enabled: true, requires_capabilities: ['platform.identity.inspect', 'filesystem.access.effective'] }];
  const capabilities = [
    createCapabilityEvidence({ id: 'platform.identity.inspect', status: 'PASS', required: true }),
    createCapabilityEvidence({ id: 'filesystem.access.effective', status: 'NOT_TESTED', required: true }),
  ];
  const gates = evaluateDeploymentGates({ profile: 'portable-desktop', components, capabilities });
  assert.equal(gates.find((gate) => gate.id.endsWith('filesystem.access.effective')).status, 'BLOCKED');
  assert.equal(aggregateDeploymentStatus({ profile: 'portable-desktop', capabilities, gates }), 'NOT_TESTED');
});

test('hardened profile requires real process, filesystem, IPC and independent backup evidence', () => {
  const components = [{ id: 'core', enabled: true, requires_capabilities: [] }];
  const capabilities = [
    'process.identity.separate',
    'filesystem.access.effective',
    'ipc.peer-authentication',
    'backup.freshness-anchor.available',
  ].map((id) => createCapabilityEvidence({ id, status: 'PASS', required: true }));
  const gates = evaluateDeploymentGates({ profile: 'hardened-service', components, capabilities });
  assert.equal(gates.every((gate) => gate.status === 'PASS'), true);
  assert.equal(aggregateDeploymentStatus({ profile: 'hardened-service', capabilities, gates }), 'PASS');
  const missing = capabilities.slice(0, 3);
  const blocked = evaluateDeploymentGates({ profile: 'hardened-service', components, capabilities: missing });
  assert.equal(blocked.every((gate) => gate.status === 'BLOCKED'), true);
});

test('report validation prevents a false PASS when required evidence is missing', () => {
  const report = {
    schema_version: 1,
    deployment_id: 'test-deployment',
    generated_at: new Date().toISOString(),
    platform: { family: 'linux', release: 'test', architecture: 'x64' },
    runtime: { name: 'node', version: process.version },
    profile: 'portable-desktop',
    overall_status: 'PASS',
    components: [],
    capabilities: [{
      id: 'platform.identity.inspect',
      status: 'NOT_TESTED',
      required: true,
      evidence_source: 'test',
      adapter_version: '1.0.0',
      limitations: [],
    }],
    gates: [],
    limitations: [],
  };
  assert.throws(() => validateDeploymentReport(report), /FALSE_PASS_REQUIRED_CAPABILITY/);
});

test('portable report explicitly reports degraded single-process isolation', () => {
  const capabilities = [
    createCapabilityEvidence({ id: 'platform.identity.inspect', status: 'PASS', required: true }),
    createCapabilityEvidence({ id: 'process.identity.separate', status: 'UNSUPPORTED', required: false }),
  ];
  const report = buildDeploymentReport({
    deploymentId: 'portable-test',
    profile: 'portable-desktop',
    platform: { family: 'linux', release: 'test', architecture: 'x64' },
    runtime: { name: 'node', version: process.version },
    components: [{ id: 'core', execution_mode: 'in-process' }],
    capabilities,
    gates: [],
    limitations: ['All components share one process identity.'],
  });
  assert.equal(report.overall_status, 'DEGRADED');
  assert.equal(validateDeploymentReport(report), true);
});

test('platform adapter reports unsupported platform rather than treating it as Linux or Windows', async () => {
  const adapter = createPlatformSecurityAdapter({ platform: 'darwin' });
  const evidence = await adapter.collectEvidence();
  assert.equal(adapter.platform, 'unknown');
  assert.equal(evidence.find((item) => item.id === 'platform.identity.inspect').status, 'UNSUPPORTED');
});

test('Linux platform adapter reports current process identity and rejects symlinked final path', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-specific adapter test.');
  const adapter = createPlatformSecurityAdapter({ platform: 'linux' });
  const identity = await adapter.identifyPlatform();
  assert.equal(identity.platform, 'linux');
  assert.equal(identity.effectiveUser, String(process.getuid()));

  const root = await mkdtemp(join(tmpdir(), 'logic-engine-deployment-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const real = join(root, 'real');
  const link = join(root, 'link');
  await mkdir(real);
  await symlink(real, link);
  const inspection = await adapter.inspectPath(link, ['read']);
  assert.equal(inspection.linkType, 'symlink');
  assert.equal(inspection.evidence.find((item) => item.id === 'filesystem.links.inspect').status, 'FAIL');
});

test('private directory provisioning is explicit and owner-only on Linux', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-specific permission test.');
  const adapter = createPlatformSecurityAdapter({ platform: 'linux' });
  const root = await mkdtemp(join(tmpdir(), 'logic-engine-deployment-private-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'private');
  const evidence = await adapter.ensurePrivateDirectory(target);
  assert.equal(evidence.status, 'PASS');
  const mode = (await (await import('node:fs/promises')).stat(target)).mode & 0o777;
  assert.equal(mode & 0o077, 0);
});

test('deployment path registry rejects traversal and symlinked parent paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'logic-engine-path-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = await mkdtemp(join(tmpdir(), 'logic-engine-path-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(join(root, 'data'));
  await mkdir(join(outside, 'data'));
  await symlink(outside, join(root, 'linked'));
  const manifest = {
    resources: [
      { id: 'safe', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: 'data/core.sqlite' } },
      { id: 'escape', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: '../outside.sqlite' } },
      { id: 'linked', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: 'linked/data/redirect.sqlite' } },
    ],
  };
  const registry = await resolveDeploymentPathRegistry({ manifest, deploymentRoot: root });
  assert.equal(registry.status, 'FAIL');
  assert.equal(registry.conflicts.some((item) => item.kind === 'PATH_ESCAPES_DEPLOYMENT_ROOT'), true);
  assert.equal(registry.conflicts.some((item) => item.kind === 'SYMLINK_OR_REPARSE_ANCESTOR'), true);
});

test('deployment path registry detects hard-link aliases by opened filesystem identity', async (t) => {
  if (process.platform !== 'linux') return t.skip('Hard-link identity fixture currently runs on Linux.');
  const root = await mkdtemp(join(tmpdir(), 'logic-engine-hardlink-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, 'first.sqlite');
  const second = join(root, 'second.sqlite');
  await (await import('node:fs/promises')).writeFile(first, 'fixture');
  await link(first, second);
  const manifest = {
    resources: [
      { id: 'first', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: 'first.sqlite' } },
      { id: 'second', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: 'second.sqlite' } },
    ],
  };
  const registry = await resolveDeploymentPathRegistry({ manifest, deploymentRoot: root });
  assert.equal(registry.status, 'FAIL');
  assert.equal(registry.conflicts.some((item) => item.kind === 'SAME_FILE_IDENTITY_ALIAS'), true);
});

test('deployment path registry refuses a missing deployment root', async () => {
  const root = join(tmpdir(), 'logic-engine-no-such-deployment-root-' + process.pid);
  const registry = await resolveDeploymentPathRegistry({ manifest: { resources: [] }, deploymentRoot: root });
  assert.equal(registry.status, 'FAIL');
  assert.equal(registry.conflicts[0].kind, 'DEPLOYMENT_ROOT_MISSING');
});
