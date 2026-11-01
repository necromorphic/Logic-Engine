import { createPlatformSecurityAdapter } from './platform-adapter.js';
import { resolveDeploymentPathRegistry } from './path-registry.js';
import { buildDeploymentReport, createCapabilityEvidence, evaluateDeploymentGates, PROTECTED_FINAL_SEND_CAPABILITIES } from './policy.js';
import { validateDeploymentManifest, validateDeploymentReport } from './contracts.js';
import { inspectPinnedSillyTavernInstallation } from './patch-inspector.js';

export async function assessDeployment({ manifest, deploymentRoot, sillyTavernRoot = process.env.LOGIC_ENGINE_SILLYTAVERN_ROOT, platformAdapter = createPlatformSecurityAdapter() }) {
  const validation = validateDeploymentManifest(manifest);
  const identity = await platformAdapter.identifyPlatform();
  const capabilities = await platformAdapter.collectEvidence();
  const limitations = [];

  if (identity.platform === 'unknown' || !manifest.platform_policy.supported_platforms.includes(identity.platform)) {
    const platformEvidenceIndex = capabilities.findIndex((item) => item.id === 'platform.identity.inspect');
    const unsupportedPlatformEvidence = createCapabilityEvidence({
      id: 'platform.identity.inspect',
      status: 'FAIL',
      required: true,
      evidenceSource: 'deployment-policy',
      observedSummary: 'Runtime platform is not permitted by the deployment manifest.',
      adapterVersion: platformAdapter.version,
      limitations: ['Only Windows and Linux are supported by deployment manifest v1.'],
    });
    if (platformEvidenceIndex >= 0) capabilities.splice(platformEvidenceIndex, 1, unsupportedPlatformEvidence);
    else capabilities.push(unsupportedPlatformEvidence);
  }

  const patchInspection = await inspectPinnedSillyTavernInstallation(sillyTavernRoot);
  capabilities.push(createCapabilityEvidence({
    id: 'host.patch.files.integrity.inspect',
    status: patchInspection.files.status,
    required: false,
    evidenceSource: 'deployment-pinned-st-inspector',
    observedSummary: patchInspection.files.summary,
    adapterVersion: '1.0.0',
    limitations: ['Filesystem inspection does not prove which modules are already loaded in the running SillyTavern process.'],
  }));
  capabilities.push(createCapabilityEvidence({
    id: 'host.patch.backups.integrity.inspect',
    status: patchInspection.backups.status,
    required: false,
    evidenceSource: 'deployment-pinned-st-inspector',
    observedSummary: patchInspection.backups.summary,
    adapterVersion: '1.0.0',
    limitations: ['Backup digest verification does not establish an independent freshness anchor or anti-rollback guarantee.'],
  }));

  // These are runtime integration attestations, not manifest claims. Until a trusted
  // Host/Gateway verifier supplies evidence, production Memory final-send stays blocked.
  for (const id of PROTECTED_FINAL_SEND_CAPABILITIES) {
    capabilities.push(createCapabilityEvidence({
      id,
      status: 'NOT_TESTED',
      required: true,
      evidenceSource: 'deployment-runtime-attestation',
      observedSummary: 'No trusted runtime verifier has supplied evidence for this final-send invariant.',
      adapterVersion: 'unverified',
      limitations: ['A manifest declaration or user-provided assertion cannot satisfy this gate.'],
    }));
  }

  const pathRegistry = await resolveDeploymentPathRegistry({ manifest, deploymentRoot });
  capabilities.push(createCapabilityEvidence({
    id: 'filesystem.path.canonicalize',
    status: pathRegistry.status,
    required: true,
    evidenceSource: 'deployment-path-registry',
    observedSummary: pathRegistry.status === 'PASS'
      ? 'All declared resource paths resolved without detected aliases or link traversal.'
      : pathRegistry.conflicts.map((item) => item.kind).join(', '),
    adapterVersion: platformAdapter.version,
    limitations: pathRegistry.status === 'PASS' ? [] : ['One or more resource paths could not be proven safe.'],
  }));
  const linkConflict = pathRegistry.conflicts.some((item) => item.kind === 'SYMLINK_OR_REPARSE_ANCESTOR');
  const rootMissing = pathRegistry.conflicts.some((item) => item.kind === 'DEPLOYMENT_ROOT_MISSING' || item.kind === 'DEPLOYMENT_ROOT_UNSAFE');
  capabilities.push(createCapabilityEvidence({
    id: 'filesystem.links.inspect',
    status: linkConflict ? 'FAIL' : rootMissing ? 'NOT_TESTED' : 'PASS',
    required: true,
    evidenceSource: 'deployment-path-registry',
    observedSummary: 'All existing path components were checked with lstat.',
    adapterVersion: platformAdapter.version,
    limitations: ['Node path-based inspection does not pin directory handles against concurrent replacement.'],
  }));
  const accessEvidence = createCapabilityEvidence({
    id: 'filesystem.access.effective',
    status: 'NOT_TESTED',
    required: false,
    evidenceSource: 'deployment-path-registry',
    adapterVersion: platformAdapter.version,
    limitations: ['Per-resource effective ACL and requested access-intent verification is not yet implemented for both platforms.'],
  });
  const accessEvidenceIndex = capabilities.findIndex((item) => item.id === 'filesystem.access.effective');
  if (accessEvidenceIndex >= 0) capabilities.splice(accessEvidenceIndex, 1, accessEvidence);
  else capabilities.push(accessEvidence);

  if (manifest.profile === 'portable-desktop') {
    limitations.push('Portable/Desktop is a single-process security boundary; no per-component OS isolation is claimed.');
    limitations.push('Open-handle inspection, OS secret-store discovery and independent backup anti-rollback are not implemented.');
    limitations.push('Node path-based filesystem operations cannot guarantee protection from concurrent directory replacement.');
  } else {
    limitations.push('Hardened/Service remains blocked until distinct process identities, effective filesystem access, authenticated IPC and an independent backup freshness anchor are proven.');
  }

  const gates = evaluateDeploymentGates({
    profile: manifest.profile,
    components: manifest.components,
    capabilities,
  });
  const report = buildDeploymentReport({
    deploymentId: manifest.deployment_id,
    profile: manifest.profile,
    platform: {
      family: identity.platform,
      release: identity.release,
      architecture: identity.architecture,
    },
    runtime: { name: 'node', version: process.version },
    components: manifest.components,
    capabilities,
    gates,
    limitations,
  });
  validateDeploymentReport(report);
  return Object.freeze({ validation, pathRegistry, patchInspection, report });
}
