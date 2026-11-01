import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PROTECTED_FINAL_SEND_CAPABILITIES } from './policy.js';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const manifestSchemaUrl = new URL('../../schemas/deployment-manifest.schema.json', import.meta.url);
const reportSchemaUrl = new URL('../../schemas/deployment-report.schema.json', import.meta.url);

function createValidator(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

const [manifestSchema, reportSchema] = await Promise.all([
  readFile(manifestSchemaUrl, 'utf8').then(JSON.parse),
  readFile(reportSchemaUrl, 'utf8').then(JSON.parse),
]);
const validateManifestSchema = createValidator(manifestSchema);
const validateReportSchema = createValidator(reportSchema);

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error('DEPLOYMENT_MANIFEST_DUPLICATE_' + label.toUpperCase() + ':' + value);
    seen.add(value);
  }
}

export function validateDeploymentManifest(manifest) {
  if (!validateManifestSchema(manifest)) {
    const detail = validateManifestSchema.errors
      .map((error) => error.instancePath + ' ' + error.message)
      .join('; ');
    throw new Error('DEPLOYMENT_MANIFEST_SCHEMA_INVALID:' + detail);
  }
  assertUnique(manifest.components.map((component) => component.id), 'component_id');
  assertUnique(manifest.resources.map((resource) => resource.id), 'resource_id');

  const componentIds = new Set(manifest.components.map((component) => component.id));
  const domains = new Set(manifest.components.map((component) => component.security_domain));
  for (const component of manifest.components) {
    if (typeof component.security_domain !== 'string' || !component.security_domain.trim()) {
      throw new Error('DEPLOYMENT_MANIFEST_SECURITY_DOMAIN_REQUIRED:' + component.id);
    }
  }
  for (const resource of manifest.resources) {
    if (resource.link_policy !== 'reject-links') {
      throw new Error('DEPLOYMENT_LINK_POLICY_NOT_IMPLEMENTED:' + resource.id + ':' + resource.link_policy);
    }
    if (!domains.has(resource.owner_domain)) {
      throw new Error('DEPLOYMENT_MANIFEST_UNKNOWN_RESOURCE_OWNER:' + resource.id);
    }
    for (const intent of ['read', 'create', 'append', 'replace', 'delete', 'rename']) {
      for (const principal of resource.access[intent]) {
        if (!componentIds.has(principal) && !domains.has(principal)) {
          throw new Error('DEPLOYMENT_MANIFEST_UNKNOWN_ACCESS_PRINCIPAL:' + resource.id + ':' + principal);
        }
      }
    }
  }
  if (manifest.profile === 'hardened-service'
    && manifest.backup?.allow_restore_without_anchor === true) {
    throw new Error('HARDENED_PROFILE_CANNOT_ALLOW_RESTORE_WITHOUT_FRESHNESS_ANCHOR');
  }
  if (manifest.profile === 'hardened-service'
    && manifest.backup?.require_independent_freshness_anchor !== true) {
    throw new Error('HARDENED_PROFILE_REQUIRES_INDEPENDENT_FRESHNESS_ANCHOR');
  }
  if (manifest.backup?.vault_resource_id) {
    const vault = manifest.resources.find((resource) => resource.id === manifest.backup.vault_resource_id);
    if (!vault || vault.kind !== 'backup-vault' || vault.backup_policy !== 'separate-vault') {
      throw new Error('DEPLOYMENT_BACKUP_VAULT_REFERENCE_INVALID');
    }
    const otherDomains = new Set(manifest.resources.filter((resource) => resource.id !== vault.id).map((resource) => resource.owner_domain));
    if (otherDomains.has(vault.owner_domain)) {
      throw new Error('DEPLOYMENT_BACKUP_VAULT_DOMAIN_NOT_SEPARATE');
    }
    if (vault.path.source === 'deployment-root-relative'
      && vault.path.value.split(/[\\/]/).filter(Boolean)[0]?.toLowerCase() === 'data') {
      throw new Error('DEPLOYMENT_BACKUP_VAULT_INSIDE_RUNTIME_DATA_TREE');
    }
  }
  if (manifest.secrets?.allow_environment_fallback === true
    && !manifest.secrets?.provider_preference?.includes('environment-compat')) {
    throw new Error('ENVIRONMENT_SECRET_FALLBACK_MUST_BE_EXPLICITLY_LISTED');
  }
  return Object.freeze({
    valid: true,
    deploymentId: manifest.deployment_id,
    profile: manifest.profile,
    platformPolicy: Object.freeze([...manifest.platform_policy.supported_platforms]),
    componentCount: manifest.components.length,
    resourceCount: manifest.resources.length,
  });
}

export function validateDeploymentReport(report) {
  if (!validateReportSchema(report)) {
    const detail = validateReportSchema.errors
      .map((error) => error.instancePath + ' ' + error.message)
      .join('; ');
    throw new Error('DEPLOYMENT_REPORT_SCHEMA_INVALID:' + detail);
  }
  assertUnique(report.capabilities.map((item) => item.id), 'report_capability_id');
  assertUnique(report.gates.map((gate) => gate.id), 'report_gate_id');
  const requiredFailures = report.capabilities.filter((item) => item.required && item.status !== 'PASS');
  if (report.overall_status === 'PASS' && requiredFailures.length > 0) {
    throw new Error('DEPLOYMENT_REPORT_FALSE_PASS_REQUIRED_CAPABILITY');
  }
  if (report.gates.some((gate) => gate.status === 'BLOCKED')
    && ['PASS', 'DEGRADED'].includes(report.overall_status)) {
    throw new Error('DEPLOYMENT_REPORT_FALSE_PASS_BLOCKED_GATE');
  }
  if (report.overall_status === 'PASS' && report.capabilities.some((item) => item.status !== 'PASS')) {
    throw new Error('DEPLOYMENT_REPORT_FALSE_PASS_NONPASS_CAPABILITY');
  }
  if (report.profile === 'portable-desktop' && report.overall_status === 'PASS') {
    throw new Error('DEPLOYMENT_REPORT_FALSE_PASS_PORTABLE_ISOLATION');
  }
  for (const component of report.components) {
    if (component.status === 'PASS' && report.gates.some((gate) => gate.status === 'BLOCKED' && gate.affected_features.includes(component.id))) {
      throw new Error('DEPLOYMENT_REPORT_FALSE_PASS_COMPONENT:' + component.id);
    }
  }
  const protectedFinalSendGate = report.gates.find((gate) => gate.id === 'memory:protected-final-send-production');
  if (!protectedFinalSendGate) {
    throw new Error('DEPLOYMENT_REPORT_MISSING_PROTECTED_FINAL_SEND_GATE');
  }
  const capabilityEvidence = new Map(report.capabilities.map((item) => [item.id, item]));
  const missingFinalSendEvidence = PROTECTED_FINAL_SEND_CAPABILITIES.filter((id) => capabilityEvidence.get(id)?.status !== 'PASS');
  if (protectedFinalSendGate.status === 'PASS' && missingFinalSendEvidence.length > 0) {
    throw new Error('DEPLOYMENT_REPORT_FALSE_PASS_PROTECTED_FINAL_SEND:' + missingFinalSendEvidence.join(','));
  }
  if (protectedFinalSendGate.status !== 'PASS' && missingFinalSendEvidence.length === 0) {
    throw new Error('DEPLOYMENT_REPORT_STALE_PROTECTED_FINAL_SEND_GATE');
  }
  if (protectedFinalSendGate.status !== 'PASS' && protectedFinalSendGate.status !== 'BLOCKED') {
    throw new Error('DEPLOYMENT_REPORT_INVALID_PROTECTED_FINAL_SEND_GATE_STATUS');
  }
  if (protectedFinalSendGate.status !== 'PASS' && report.overall_status === 'PASS') {
    throw new Error('DEPLOYMENT_REPORT_PROTECTED_FINAL_SEND_GATE_BYPASSED');
  }
  if (report.profile === 'hardened-service' && report.overall_status === 'PASS') {
    const requiredBoundaryCapabilities = [
      'process.identity.separate',
      'filesystem.access.effective',
      'ipc.peer-authentication',
      'backup.freshness-anchor.available',
    ];
    const evidence = new Map(report.capabilities.map((item) => [item.id, item]));
    for (const id of requiredBoundaryCapabilities) {
      if (evidence.get(id)?.status !== 'PASS') {
        throw new Error('HARDENED_PROFILE_FALSE_PASS_BOUNDARY:' + id);
      }
    }
  }
  return true;
}

export async function loadDeploymentManifest(path) {
  const absolutePath = resolve(path);
  const manifest = JSON.parse(await readFile(absolutePath, 'utf8'));
  validateDeploymentManifest(manifest);
  return Object.freeze({ path: absolutePath, manifest });
}

export function deploymentSchemaPaths() {
  return Object.freeze({
    manifest: fileURLToPath(manifestSchemaUrl),
    report: fileURLToPath(reportSchemaUrl),
  });
}
