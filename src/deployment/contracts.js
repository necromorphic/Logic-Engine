import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
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
  const requiredFailures = report.capabilities.filter((item) => item.required && item.status !== 'PASS');
  if (report.overall_status === 'PASS' && requiredFailures.length > 0) {
    throw new Error('DEPLOYMENT_REPORT_FALSE_PASS_REQUIRED_CAPABILITY');
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
