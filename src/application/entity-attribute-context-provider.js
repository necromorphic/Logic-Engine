import { hashRequest } from '../core/request-hash.js';
import { collectConditionDependencies } from '../core/rules.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const forbiddenSegments = new Set(['__proto__', 'constructor', 'prototype']);

function validPath(path) {
  return typeof path === 'string' && path.trim()
    && path.split('.').every((segment) => segment.length > 0 && !forbiddenSegments.has(segment));
}

function setPath(root, path, value) {
  const segments = path.split('.');
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!Object.hasOwn(cursor, segment)) cursor[segment] = {};
    if (!object(cursor[segment])) throw new TypeError('Condition path bindings collide.');
    cursor = cursor[segment];
  }
  const leaf = segments.at(-1);
  if (Object.hasOwn(cursor, leaf)) throw new TypeError('Condition path bindings are not one-to-one.');
  cursor[leaf] = value;
}

function freeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

/**
 * Versioned context projection for the bounded mechanic executor.
 *
 * The caller must supply an explicit path-to-entity-attribute binding and a
 * deployment-owned authorization callback. There is intentionally no default
 * allow policy. The provider reads canonical state internally but returns only
 * the projected values, evidence records, and snapshot markers.
 */
export class CanonicalEntityAttributeContextProvider {
  constructor(engine, { policyVersion, bindings, canRead } = {}) {
    if (!engine || typeof engine.getState !== 'function') throw new TypeError('A LogicEngine is required.');
    if (typeof policyVersion !== 'string' || !policyVersion.trim()) throw new TypeError('policyVersion must be a non-empty version identifier.');
    if (!Array.isArray(bindings)) throw new TypeError('bindings must be an explicit array.');
    if (typeof canRead !== 'function') throw new TypeError('A deployment-owned canRead authorization callback is required.');
    const byPath = new Map();
    for (const binding of bindings) {
      if (!object(binding) || Object.keys(binding).some((key) => !['path', 'entity_id', 'attribute'].includes(key))
        || !validPath(binding.path)
        || typeof binding.entity_id !== 'string' || !binding.entity_id.trim()
        || typeof binding.attribute !== 'string' || !binding.attribute.trim()
        || byPath.has(binding.path)) {
        throw new TypeError('Every binding must uniquely map a safe condition path to an entity ID and attribute.');
      }
      byPath.set(binding.path, Object.freeze({
        path: binding.path,
        entity_id: binding.entity_id,
        attribute: binding.attribute,
      }));
    }
    this.engine = engine;
    this.policyVersion = policyVersion.trim();
    this.bindings = byPath;
    this.canRead = canRead;
    this.policyFingerprint = hashRequest({
      policy_version: this.policyVersion,
      bindings: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    });
    Object.freeze(this);
  }

  resolve({ worldId, snapshot, template, action } = {}) {
    if (typeof worldId !== 'string' || !worldId.trim()
      || !object(snapshot) || !object(template) || !object(action)) {
      throw new TypeError('Provider resolution requires world, snapshot, template, and action.');
    }
    const conditionPaths = [...new Set([
      ...(template.applicability ?? []),
      ...(action.preconditions ?? []),
      ...(action.constraints ?? []),
    ].flatMap((rule) => collectConditionDependencies(rule)))].sort();
    const state = this.engine.getState(worldId);
    if (state.world_revision !== snapshot.world_revision || state.commit_sequence !== snapshot.commit_sequence) {
      throw new Error('Snapshot changed during trusted context resolution.');
    }

    const context = {};
    const knownAbsentPaths = [];
    const dependencyEvidence = [];
    for (const path of conditionPaths) {
      const binding = this.bindings.get(path);
      if (!binding) throw new Error('A condition path has no registered canonical binding.');
      const entity = state.entities.find((candidate) => candidate.entity_id === binding.entity_id && candidate.status !== 'destroyed');
      if (!entity || !object(entity.attributes)) throw new Error('A condition binding target is unavailable in this world.');
      const permitted = this.canRead({
        world_id: worldId,
        entity_id: entity.entity_id,
        entity_type: entity.entity_type,
        entity_status: entity.status,
        attribute: binding.attribute,
        condition_path: path,
        world_revision: snapshot.world_revision,
        commit_sequence: snapshot.commit_sequence,
        policy_version: this.policyVersion,
      });
      if (permitted !== true) throw new Error('A condition binding is not authorized by the configured visibility policy.');

      if (Object.hasOwn(entity.attributes, binding.attribute)) {
        setPath(context, path, entity.attributes[binding.attribute]);
      } else {
        knownAbsentPaths.push(path);
      }
      dependencyEvidence.push({
        path,
        kind: 'entity_attribute',
        entity_id: binding.entity_id,
        attribute: binding.attribute,
      });
    }

    return freeze({
      context,
      knownAbsentPaths: knownAbsentPaths.sort(),
      dependencyEvidence,
      world_revision: snapshot.world_revision,
      commit_sequence: snapshot.commit_sequence,
      policy_version: this.policyFingerprint,
    });
  }
}
