import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
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
  PROTECTED_FINAL_SEND_CAPABILITIES,
} from '../src/deployment/policy.js';
import { createPlatformSecurityAdapter } from '../src/deployment/platform-adapter.js';
import { assessDeployment } from '../src/deployment/index.js';
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

test('portable example manifest validates and declares a distinct backup vault', async () => {
  const path = new URL('../config/deployment-manifest.portable.example.json', import.meta.url);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(validateDeploymentManifest(manifest).valid, true);
  const vault = manifest.resources.find((resource) => resource.id === manifest.backup.vault_resource_id);
  assert.equal(vault.backup_policy, 'separate-vault');
  assert.equal(vault.owner_domain, 'backup');
});

test('deployment schemas are present and manifest contract rejects malformed declarations', () => {
  const paths = deploymentSchemaPaths();
  assert.match(paths.manifest, /deployment-manifest\.schema\.json$/);
  assert.match(paths.report, /deployment-report\.schema\.json$/);
  assert.equal(validateDeploymentManifest(portableManifest()).valid, true);
  const invalid = portableManifest();
  invalid.platform_policy.allow_unknown_platform = true;
  assert.throws(() => validateDeploymentManifest(invalid), /DEPLOYMENT_MANIFEST_SCHEMA_INVALID/);
  const unimplementedLinkPolicy = portableManifest();
  unimplementedLinkPolicy.resources[0].link_policy = 'allow-contained-links';
  assert.throws(() => validateDeploymentManifest(unimplementedLinkPolicy), /LINK_POLICY_NOT_IMPLEMENTED/);
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
  hardened.backup.allow_restore_without_anchor = false;
  assert.throws(() => validateDeploymentManifest(hardened), /REQUIRES_INDEPENDENT_FRESHNESS_ANCHOR/);
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
  assert.equal(gates.filter((gate) => gate.status === 'PASS').length, 4);
  assert.equal(gates.find((gate) => gate.id === 'memory:protected-final-send-production').status, 'BLOCKED');
  assert.equal(aggregateDeploymentStatus({ profile: 'hardened-service', capabilities, gates }), 'NOT_TESTED');
  const missing = capabilities.slice(0, 3);
  const blocked = evaluateDeploymentGates({ profile: 'hardened-service', components, capabilities: missing });
  assert.equal(blocked.filter((gate) => gate.status === 'BLOCKED').some((gate) => gate.id === 'backup:independent-freshness-anchor'), true);
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
    gates: [{ id: 'memory:protected-final-send-production', status: 'BLOCKED', affected_features: ['memory.protected-final-send'] }],
    limitations: [],
  };
  assert.throws(() => validateDeploymentReport(report), /FALSE_PASS_REQUIRED_CAPABILITY/);
  const blockedGateReport = {
    ...report,
    capabilities: [{
      id: 'platform.identity.inspect',
      status: 'PASS',
      required: true,
      evidence_source: 'test',
      adapter_version: '1.0.0',
      limitations: [],
    }],
    gates: [{ id: 'memory:protected-final-send-production', status: 'BLOCKED', affected_features: ['memory.protected-final-send'] }, { id: 'core:filesystem.access.effective', status: 'BLOCKED', affected_features: ['core'] }],
  };
  assert.throws(() => validateDeploymentReport(blockedGateReport), /FALSE_PASS_BLOCKED_GATE/);
  const portablePass = { ...blockedGateReport, gates: [], overall_status: 'PASS' };
  assert.throws(() => validateDeploymentReport(portablePass), /FALSE_PASS_PORTABLE_ISOLATION/);
});

test('report validation rejects duplicate evidence, duplicate gates and stale protected gates', () => {
  const base = buildDeploymentReport({
    deploymentId: 'report-integrity-test',
    profile: 'portable-desktop',
    platform: { family: 'linux', release: 'test', architecture: 'x64' },
    runtime: { name: 'node', version: process.version },
    components: [],
    capabilities: [
      createCapabilityEvidence({ id: 'platform.identity.inspect', status: 'PASS', required: true }),
      ...PROTECTED_FINAL_SEND_CAPABILITIES.map((id) => createCapabilityEvidence({
        id, status: 'PASS', required: true, evidenceSource: 'test-runtime-attestation',
      })),
    ],
    gates: [{ id: 'memory:protected-final-send-production', status: 'PASS', affected_features: ['memory.protected-final-send'] }],
  });
  assert.equal(validateDeploymentReport(base), true);

  const duplicateCapability = { ...base, capabilities: [...base.capabilities, base.capabilities[0]] };
  assert.throws(() => validateDeploymentReport(duplicateCapability), /DUPLICATE_REPORT_CAPABILITY_ID/);

  const duplicateGate = { ...base, gates: [...base.gates, base.gates[0]] };
  assert.throws(() => validateDeploymentReport(duplicateGate), /DUPLICATE_REPORT_GATE_ID/);

  const staleGate = {
    ...base,
    gates: [{ ...base.gates[0], status: 'BLOCKED' }],
    overall_status: 'NOT_TESTED',
  };
  assert.throws(() => validateDeploymentReport(staleGate), /STALE_PROTECTED_FINAL_SEND_GATE/);
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
    gates: [{ id: 'memory:protected-final-send-production', status: 'BLOCKED', affected_features: ['memory.protected-final-send'] }],
    limitations: ['All components share one process identity.'],
  });
  assert.equal(report.overall_status, 'NOT_TESTED');
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
  assert.equal(evidence.status, 'DEGRADED');
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
  let symlinkCreated = true;
  try {
    await symlink(outside, join(root, 'linked'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') symlinkCreated = false;
    else throw error;
  }
  const resources = [
    { id: 'safe', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: 'data/core.sqlite' } },
    { id: 'escape', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: '../outside.sqlite' } },
  ];
  if (symlinkCreated) {
    resources.push({ id: 'linked', owner_domain: 'runtime', kind: 'database', path: { source: 'deployment-root-relative', value: 'linked/data/redirect.sqlite' } });
  }
  const registry = await resolveDeploymentPathRegistry({ manifest: { resources }, deploymentRoot: root });
  assert.equal(registry.status, 'FAIL');
  assert.equal(registry.conflicts.some((item) => item.kind === 'PATH_ESCAPES_DEPLOYMENT_ROOT'), true);
  if (symlinkCreated) {
    assert.equal(registry.conflicts.some((item) => item.kind === 'SYMLINK_OR_REPARSE_ANCESTOR'), true);
  }
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

test('Windows adapter refuses to claim unimplemented ACL and private-file guarantees', async () => {
  const adapter = createPlatformSecurityAdapter({ platform: 'win32' });
  assert.equal(adapter.platform, 'windows');
  const directory = await adapter.ensurePrivateDirectory('C:\\deployment\\private');
  const file = await adapter.ensurePrivateFile('C:\\deployment\\secrets');
  assert.equal(directory.status, 'UNSUPPORTED');
  assert.equal(file.status, 'UNSUPPORTED');
});

test('portable assessment emits a schema-valid degraded report without enabling hardened claims', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'logic-engine-assessment-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'data'));
  const result = await assessDeployment({ manifest: portableManifest(), deploymentRoot: root });
  assert.equal(result.report.profile, 'portable-desktop');
  assert.equal(result.report.overall_status, 'NOT_TESTED');
  assert.equal(validateDeploymentReport(result.report), true);
  assert.equal(result.report.limitations.some((item) => item.includes('single-process')), true);
  assert.equal(result.patchInspection.files.status, 'NOT_TESTED');
  assert.equal(result.patchInspection.backups.status, 'NOT_TESTED');
  assert.equal(result.report.capabilities.find((item) => item.id === 'host.patch.files.integrity.inspect').status, 'NOT_TESTED');
  assert.equal(result.report.capabilities.find((item) => item.id === 'host.patch.backups.integrity.inspect').status, 'NOT_TESTED');
});

test('pinned SillyTavern inspection rejects an unsafe or missing installation root', async () => {
  const { inspectPinnedSillyTavernInstallation } = await import('../src/deployment/patch-inspector.js');
  const missing = await inspectPinnedSillyTavernInstallation('');
  assert.equal(missing.files.status, 'NOT_TESTED');
  const unsafe = await inspectPinnedSillyTavernInstallation(join(tmpdir(), 'logic-engine-st-root-does-not-exist-' + process.pid));
  assert.equal(unsafe.files.status, 'FAIL');
  assert.equal(unsafe.backups.status, 'FAIL');
});

test('protected Memory final-send deployment gate requires every independent runtime invariant', () => {
  const components = [{ id: 'core', enabled: true, requires_capabilities: [] }];
  const absent = evaluateDeploymentGates({ profile: 'portable-desktop', components, capabilities: [] });
  const gate = absent.find((item) => item.id === 'memory:protected-final-send-production');
  assert.equal(gate.status, 'BLOCKED');
  for (const id of PROTECTED_FINAL_SEND_CAPABILITIES) {
    const partial = PROTECTED_FINAL_SEND_CAPABILITIES
      .filter((candidate) => candidate !== id)
      .map((candidate) => createCapabilityEvidence({ id: candidate, status: 'PASS', required: true }));
    const result = evaluateDeploymentGates({ profile: 'portable-desktop', components, capabilities: partial });
    assert.equal(result.find((item) => item.id === 'memory:protected-final-send-production').status, 'BLOCKED', id);
  }
  const complete = PROTECTED_FINAL_SEND_CAPABILITIES
    .map((id) => createCapabilityEvidence({ id, status: 'PASS', required: true }));
  const result = evaluateDeploymentGates({ profile: 'portable-desktop', components, capabilities: complete });
  assert.equal(result.find((item) => item.id === 'memory:protected-final-send-production').status, 'PASS');
});

test('filesystem-only patch and backup inspection cannot satisfy the protected runtime attestation', () => {
  const capabilities = [
    createCapabilityEvidence({ id: 'host.patch.files.integrity.inspect', status: 'PASS', required: false }),
    createCapabilityEvidence({ id: 'host.patch.backups.integrity.inspect', status: 'PASS', required: false }),
    ...PROTECTED_FINAL_SEND_CAPABILITIES
      .filter((id) => id !== 'host.patch.integrity')
      .map((id) => createCapabilityEvidence({ id, status: 'PASS', required: true })),
  ];
  const gates = evaluateDeploymentGates({ profile: 'portable-desktop', components: [], capabilities });
  assert.equal(gates.find((gate) => gate.id === 'memory:protected-final-send-production').status, 'BLOCKED');
});

test('protected final-send gate is emitted exactly once independently of enabled components', () => {
  const capabilities = PROTECTED_FINAL_SEND_CAPABILITIES
    .map((id) => createCapabilityEvidence({ id, status: 'PASS', required: true }));
  for (const components of [
    [],
    [{ id: 'disabled', enabled: false, requires_capabilities: [] }],
    [
      { id: 'core', enabled: true, requires_capabilities: [] },
      { id: 'coordinator', enabled: true, requires_capabilities: [] },
    ],
  ]) {
    const gates = evaluateDeploymentGates({ profile: 'portable-desktop', components, capabilities });
    const protectedGates = gates.filter((gate) => gate.id === 'memory:protected-final-send-production');
    assert.equal(protectedGates.length, 1);
    assert.equal(protectedGates[0].status, 'PASS');
    assert.deepEqual(protectedGates[0].affected_features, ['memory.protected-final-send']);
  }
});

test('deployment assessment never accepts manifest-only final-send assertions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'logic-engine-final-send-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'data'));
  const result = await assessDeployment({ manifest: portableManifest(), deploymentRoot: root });
  const gate = result.report.gates.find((item) => item.id === 'memory:protected-final-send-production');
  assert.equal(gate.status, 'BLOCKED');
  for (const id of PROTECTED_FINAL_SEND_CAPABILITIES) {
    const evidence = result.report.capabilities.find((item) => item.id === id);
    assert.equal(evidence.status, 'NOT_TESTED');
    assert.equal(evidence.required, true);
  }
});
