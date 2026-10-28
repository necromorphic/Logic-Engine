import { createHash } from 'node:crypto';
import { EngineError } from '../core/errors.js';

const MAX_SOURCE_BYTES = 1_000_000;
const MAX_ASSIGNMENTS = 10_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const hasExactKeys = (value, expected) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === expected.length
  && expected.every((key) => Object.hasOwn(value, key));

function fail(code, message, status = 400) {
  throw new EngineError(code, message, status);
}

function identifier(value, field) {
  if (typeof value !== 'string' || value !== value.trim() || !ID.test(value)) {
    fail('INVALID_TRUSTED_SOURCE', field + ' must be a canonical non-empty identifier.');
  }
  return value;
}

/**
 * Validates immutable source bytes against a deployment-owned digest allowlist.
 * The allowlist is trusted configuration, not request data. This function does
 * not write events or prove that a referenced subject/fact exists in a world.
 */
export function validateTrustedInitialKnowledgeSource(sourceBytes, trustedSources) {
  const bytes = Buffer.isBuffer(sourceBytes)
    ? sourceBytes
    : typeof sourceBytes === 'string' ? Buffer.from(sourceBytes, 'utf8') : null;
  if (!bytes || bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES) {
    fail('INVALID_TRUSTED_SOURCE', 'Source must be non-empty UTF-8 bytes within the configured size limit.');
  }
  if (!Array.isArray(trustedSources)) {
    fail('TRUSTED_SOURCE_REGISTRY_REQUIRED', 'A deployment-owned trusted source registry is required.', 503);
  }

  const sourceDigest = createHash('sha256').update(bytes).digest('hex');
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('INVALID_TRUSTED_SOURCE_JSON', 'Trusted source bytes must contain valid JSON.');
  }

  const topKeys = ['schema_version', 'world_pack_id', 'world_pack_version', 'source_kind', 'source_ref', 'authorization_ref', 'assignments'];
  if (!hasExactKeys(document, topKeys)) {
    fail('INVALID_TRUSTED_SOURCE_SCHEMA', 'Trusted source envelope has missing or unsupported fields.');
  }
  if (document.schema_version !== 1) fail('UNSUPPORTED_TRUSTED_SOURCE_VERSION', 'Only source schema version 1 is supported.');
  identifier(document.world_pack_id, 'world_pack_id');
  identifier(document.world_pack_version, 'world_pack_version');
  if (!['author_initial', 'imported'].includes(document.source_kind)) {
    fail('UNSUPPORTED_ACQUISITION_KIND', 'Only author_initial and imported source kinds are supported.');
  }
  identifier(document.source_ref, 'source_ref');
  identifier(document.authorization_ref, 'authorization_ref');
  if (!Array.isArray(document.assignments) || document.assignments.length === 0 || document.assignments.length > MAX_ASSIGNMENTS) {
    fail('INVALID_TRUSTED_SOURCE_ASSIGNMENTS', 'assignments must be a non-empty bounded array.');
  }

  const seen = new Set();
  const assignments = document.assignments.map((assignment, index) => {
    if (!hasExactKeys(assignment, ['subject_id', 'fact_id'])) {
      fail('INVALID_TRUSTED_SOURCE_ASSIGNMENT', 'Assignment ' + index + ' must contain only subject_id and fact_id.');
    }
    const subjectId = identifier(assignment.subject_id, 'assignments[' + index + '].subject_id');
    const factId = identifier(assignment.fact_id, 'assignments[' + index + '].fact_id');
    const key = subjectId + '\u0000' + factId;
    if (seen.has(key)) fail('DUPLICATE_TRUSTED_SOURCE_ASSIGNMENT', 'Source contains a duplicate subject/item assignment.');
    seen.add(key);
    return Object.freeze({ subject_id: subjectId, fact_id: factId });
  });

  const match = trustedSources.find((entry) => entry
    && entry.world_pack_id === document.world_pack_id
    && entry.world_pack_version === document.world_pack_version
    && entry.source_kind === document.source_kind
    && entry.source_ref === document.source_ref
    && entry.authorization_ref === document.authorization_ref
    && entry.sha256 === sourceDigest);
  if (!match) {
    fail('TRUSTED_SOURCE_NOT_APPROVED', 'Source bytes do not match a deployment-approved source identity and digest.', 403);
  }

  return Object.freeze({
    schema_version: 1,
    world_pack_id: document.world_pack_id,
    world_pack_version: document.world_pack_version,
    source_kind: document.source_kind,
    source_ref: document.source_ref,
    authorization_ref: document.authorization_ref,
    source_digest: sourceDigest,
    assignments: Object.freeze(assignments),
  });
}
