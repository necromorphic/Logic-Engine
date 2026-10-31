import { randomUUID } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { constants as fsConstants, openSync, fstatSync, readFileSync, closeSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { assert, EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { isMechanicPolicyAuthoritySnapshot } from './mechanic-policy-authority.js';
import { validateEffects } from '../core/rules.js';
import { validateTrustedInitialKnowledgeSource } from './trusted-initial-knowledge-source.js';
import { validateNpcKnowledgeRead, validateNpcKnowledgeReadInput } from './npc-knowledge-read.js';
import { buildNpcBeliefContext, npcPropositionRefFor, reduceNpcBeliefTransition } from './npc-belief-state.js';
import { validateMechanicTemplate, validateRuleModuleManifest } from '../core/mechanics.js';
import { normalizeTimeTrigger, planDueWork } from '../time/scheduler.js';
import { normalizeProcessDefinition, validateProcessTransition } from '../process/contract.js';
import { ProcessStore } from '../storage/process-store.js';
import { beginCoordinatorLock } from '../storage/coordinator-lock.js';
import { addTimeDuration, createCalendarDefinition, projectCalendarDate } from '../time/model.js';
import { createTimePolicy, resolveDurationDecision } from '../time/policy.js';

const ASYNC_FUNCTION_PROTOTYPE = Object.getPrototypeOf(async function () {}).constructor;
const INTERNAL_CORE_EFFECTS = Symbol('INTERNAL_CORE_EFFECTS');
const TRUSTED_IMPORT_CAPABILITY = Symbol('trusted-import-loader');
const MAX_TRUSTED_IMPORT_BYTES = 1_000_000;
function sameTrustedImportPath(left, right) {
  const normalize = value => {
    let path = resolve(value);
    if (process.platform === 'win32') {
      if (path.startsWith('\\\\?\\UNC\\')) path = '\\\\' + path.slice(8);
      else if (path.startsWith('\\\\?\\')) path = path.slice(4);
      path = path.toLowerCase();
    }
    return path;
  };
  return normalize(left) === normalize(right);
}

const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const exactDataRecord = (value, keys) => {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))
      || !ownKeys.every((key) => typeof key === 'string' && keys.includes(key))) return false;
    return ownKeys.every((key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'); });
  } catch { return false; }
};
const isSafeNpcInputRecord = (value, ancestors = new Set()) => {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) return false;
  const visit = (node) => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return true;
    if (typeof node === 'number') return Number.isFinite(node);
    if (typeof node !== 'object' || utilTypes.isProxy(node) || ancestors.has(node)) return false;
    try {
      const array = Array.isArray(node);
      const prototype = Object.getPrototypeOf(node);
      if (array ? prototype !== Array.prototype : (prototype !== Object.prototype && prototype !== null)) return false;
      const keys = Reflect.ownKeys(node);
      if (array && (keys.length !== node.length + 1 || !keys.includes('length'))) return false;
      if (!array && keys.some((key) => typeof key !== 'string')) return false;
      ancestors.add(node);
      for (const key of keys) {
        if (array && key === 'length') continue;
        if (array && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)
          || !Number.isSafeInteger(Number(key)) || Number(key) >= node.length)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
          || !visit(descriptor.value)) return false;
      }
      ancestors.delete(node);
      return true;
    } catch {
      ancestors.delete(node);
      return false;
    }
  };
  return visit(value);
};
function withNpcAuthorizationLease(store, callback) {
  if (typeof callback !== 'function') throw new TypeError('NPC authorization lease callback must be synchronous.');
  if (!store?.coordinatorDb) return callback();
  // Reuse an existing SQLiteStore transaction lease for nested operations.
  if (store.coordinatorLeaseDepth > 0) return callback();
  const release = beginCoordinatorLock(store.coordinatorDb);
  store.coordinatorLeaseDepth = 1;
  try {
    const result = callback();
    if (result !== null && (typeof result === 'object' || typeof result === 'function')
      && typeof result.then === 'function') {
      throw new TypeError('NPC authorization lease callback must be synchronous; do not await while held.');
    }
    return result;
  } finally {
    store.coordinatorLeaseDepth = 0;
    release();
  }
}

const strings = (x, name) => {
  x = x ?? [];
  assert(Array.isArray(x) && x.length <= 500 && x.every((v) => typeof v === 'string' && v.trim()), 'INVALID_FIELD', name + ' must be an array of non-empty strings.');
  return [...new Set(x.map((v) => v.trim()))];
};

const contextItems = (value) => {
  value = value ?? [];
  assert(Array.isArray(value) && value.length <= 2000, 'INVALID_CONTEXT_MANIFEST', 'items must be an array of at most 2000 entries.');
  const seen = new Set();
  const items = value.map((item) => {
    assert(obj(item), 'INVALID_CONTEXT_MANIFEST_ITEM', 'Each manifest item must be an object.');
    assert(['entity', 'fact', 'event', 'entity_absence', 'fact_absence'].includes(item.kind), 'INVALID_CONTEXT_MANIFEST_ITEM', 'Manifest item kind must be entity, fact, event, entity_absence, or fact_absence.');
    assert(typeof item.target_id === 'string' && item.target_id.trim() && item.target_id.trim().length <= 200, 'INVALID_CONTEXT_MANIFEST_ITEM', 'Manifest target_id must be a non-empty string of at most 200 characters.');
    const normalized = { kind: item.kind, target_id: item.target_id.trim() };
    if (item.content_hash !== undefined) {
      assert(typeof item.content_hash === 'string' && /^[a-f0-9]{64}$/i.test(item.content_hash), 'INVALID_CONTEXT_MANIFEST_ITEM', 'content_hash must be a 64-character hexadecimal SHA-256 digest.');
      normalized.content_hash = item.content_hash.toLowerCase();
    }
    const key = itemKey(normalized);
    assert(!seen.has(key), 'DUPLICATE_CONTEXT_MANIFEST_ITEM', 'Duplicate manifest item: ' + key);
    seen.add(key);
    return normalized;
  });
  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.target_id.localeCompare(b.target_id));
};
const itemKey = (item) => item.kind + ':' + item.target_id;

const causalLinks = (value) => {
  value = value ?? [];
  assert(Array.isArray(value) && value.length <= 500, 'INVALID_CAUSAL_LINKS', 'causal_links must be an array of at most 500 links.');
  const supported = new Set(['READS_SOURCE', 'READS_ENTITY', 'READS_CLAIM', 'REQUIRES']);
  const seen = new Set();
  const links = value.map((link) => {
    assert(obj(link), 'INVALID_CAUSAL_LINK', 'Each causal link must be an object.');
    assert(typeof link.relation === 'string' && supported.has(link.relation), 'UNSUPPORTED_CAUSAL_RELATION', 'Unsupported causal relationship: ' + String(link.relation));
    const allowedLinkFields = link.relation === 'REQUIRES' ? ['relation', 'predicate'] : ['relation', 'target_id'];
    assert(Object.keys(link).every((key) => allowedLinkFields.includes(key)), 'INVALID_CAUSAL_LINK', 'Causal link contains an unsupported field for relation ' + link.relation + '.');
    let normalized;
    if (link.relation === 'REQUIRES') {
      assert(obj(link.predicate), 'INVALID_CAUSAL_PREDICATE', 'REQUIRES must contain a predicate object.');
      const predicate = link.predicate;
      assert(['entity_exists', 'entity_absent', 'entity_attribute', 'fact_value', 'fact_absent'].includes(predicate.kind), 'UNSUPPORTED_CAUSAL_PREDICATE', 'Unsupported REQUIRES predicate kind: ' + String(predicate.kind));
      const predicateFields = {
        entity_exists: ['kind', 'entity_id'], entity_absent: ['kind', 'entity_id'],
        entity_attribute: ['kind', 'entity_id', 'attribute', 'value'],
        fact_value: ['kind', 'fact_id', 'value'], fact_absent: ['kind', 'fact_id'],
      }[predicate.kind];
      assert(Object.keys(predicate).every((key) => predicateFields.includes(key)), 'INVALID_CAUSAL_PREDICATE', 'REQUIRES predicate contains an unsupported field.');
      if (predicate.kind === 'fact_value' || predicate.kind === 'fact_absent') {
        assert(typeof predicate.fact_id === 'string' && predicate.fact_id.trim() && predicate.fact_id.trim().length <= 200, 'INVALID_CAUSAL_PREDICATE', 'Predicate fact_id must be a non-empty string of at most 200 characters.');
        if (predicate.kind === 'fact_absent') {
          normalized = { relation: link.relation, predicate: { kind: predicate.kind, fact_id: predicate.fact_id.trim() } };
        } else {
          assert(Object.hasOwn(predicate, 'value'), 'INVALID_CAUSAL_PREDICATE', 'fact_value predicates must include value.');
          let encoded;
          try { encoded = JSON.stringify(predicate.value); } catch {}
          assert(encoded !== undefined, 'INVALID_CAUSAL_PREDICATE', 'Predicate value must be JSON-serializable.');
          normalized = { relation: link.relation, predicate: { kind: predicate.kind, fact_id: predicate.fact_id.trim(), value: predicate.value } };
        }
      } else {
        assert(typeof predicate.entity_id === 'string' && predicate.entity_id.trim() && predicate.entity_id.trim().length <= 200, 'INVALID_CAUSAL_PREDICATE', 'Predicate entity_id must be a non-empty string of at most 200 characters.');
        if (predicate.kind === 'entity_exists' || predicate.kind === 'entity_absent') {
          normalized = { relation: link.relation, predicate: { kind: predicate.kind, entity_id: predicate.entity_id.trim() } };
        } else {
        assert(typeof predicate.attribute === 'string' && predicate.attribute.trim() && predicate.attribute.trim().length <= 200, 'INVALID_CAUSAL_PREDICATE', 'Predicate attribute must be a non-empty string of at most 200 characters.');
        assert(Object.hasOwn(predicate, 'value'), 'INVALID_CAUSAL_PREDICATE', 'entity_attribute predicates must include value.');
        let encoded;
        try { encoded = JSON.stringify(predicate.value); } catch {}
        assert(encoded !== undefined, 'INVALID_CAUSAL_PREDICATE', 'Predicate value must be JSON-serializable.');
        normalized = { relation: link.relation, predicate: { kind: predicate.kind, entity_id: predicate.entity_id.trim(), attribute: predicate.attribute.trim(), value: predicate.value } };
        }
      }
    } else {
      assert(typeof link.target_id === 'string' && link.target_id.trim() && link.target_id.trim().length <= 200, 'INVALID_CAUSAL_LINK', 'causal link target_id must be a non-empty string of at most 200 characters.');
      normalized = { relation: link.relation, target_id: link.target_id.trim() };
    }
    const key = JSON.stringify(normalized);
    assert(!seen.has(key), 'DUPLICATE_CAUSAL_LINK', 'Duplicate causal link: ' + key);
    seen.add(key);
    return normalized;
  });
  return links.sort((a, b) => a.relation.localeCompare(b.relation) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
};

const segmentRelationshipRef = (subjectId, targetId) => 'relationship:' + encodeURIComponent(subjectId) + '/' + encodeURIComponent(targetId);
const isTypedProjectionRef = (ref) => typeof ref === 'string'
  && (ref.startsWith('entity:') || ref.startsWith('fact:') || ref.startsWith('relationship:'));

function segmentAccess(event) {
  const reads = new Set(event.read_set || []);
  const writes = new Set();
  for (const ref of event.depends_on || []) if (isTypedProjectionRef(ref)) reads.add(ref);
  for (const link of event.causal_links || []) {
    if (link.relation === 'READS_ENTITY') reads.add('entity:' + link.target_id);
    else if (link.relation === 'READS_CLAIM') reads.add('fact:' + link.target_id);
    else if (link.relation === 'REQUIRES') {
      const predicate = link.predicate || {};
      if (predicate.kind === 'fact_value' || predicate.kind === 'fact_absent') reads.add('fact:' + predicate.fact_id);
      else if (predicate.entity_id) reads.add('entity:' + predicate.entity_id);
    }
  }
  for (const effect of event.effects || []) {
    if (typeof effect.subject_ref === 'string' && isTypedProjectionRef(effect.subject_ref)) reads.add(effect.subject_ref);
    if (effect.kind === 'relationship.transition') {
      writes.add(segmentRelationshipRef(effect.subject_id, effect.target_id));
      reads.add('entity:' + effect.subject_id);
      reads.add('entity:' + effect.target_id);
    } else if (effect.kind.startsWith('entity.')) {
      writes.add('entity:' + effect.entity_id);
    } else if (effect.kind.startsWith('mechanic.instance.')) {
      writes.add('mechanic:' + effect.instance_id);
    } else if (effect.kind === 'knowledge.acquire') {
      writes.add('knowledge-acquisition:' + effect.acquisition_id);
    } else {
      writes.add('fact:' + effect.fact_id);
    }
  }
  return { reads, writes };
}

function validateIndependentSegment(events) {
  const eventIds = new Set(events.map((event) => event.event_id));
  for (const event of events) {
    if ((event.caused_by || []).some((eventId) => eventIds.has(eventId))) {
      throw new EngineError('SEGMENT_INTRA_DEPENDENCY_UNSUPPORTED', 'Events in one segment cannot depend on another event in the same segment; split at the dependency boundary.', 400);
    }
    if ((event.depends_on || []).some((ref) => eventIds.has(ref))) {
      throw new EngineError('SEGMENT_INTRA_DEPENDENCY_UNSUPPORTED', 'Events in one segment cannot depend on another event in the same segment; split at the dependency boundary.', 400);
    }
    if ((event.causal_links || []).some((link) => link.relation === 'READS_SOURCE' && eventIds.has(link.target_id))) {
      throw new EngineError('SEGMENT_INTRA_DEPENDENCY_UNSUPPORTED', 'READS_SOURCE cannot target another event in the same segment.', 400);
    }
  }
  const access = events.map(segmentAccess);
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      for (const ref of access[i].writes) {
        if (access[j].writes.has(ref)) {
          throw new EngineError('SEGMENT_WRITE_CONFLICT', 'Two events in one segment write the same canonical projection; split the segment at this conflict.', 409, { reference: ref });
        }
        if (access[j].reads.has(ref)) {
          throw new EngineError('SEGMENT_READ_WRITE_CONFLICT', 'An event in this segment reads a projection written by another event; split at the dependency boundary.', 409, { reference: ref });
        }
      }
      for (const ref of access[j].writes) {
        if (access[i].reads.has(ref)) {
          throw new EngineError('SEGMENT_READ_WRITE_CONFLICT', 'An event in this segment reads a projection written by another event; split at the dependency boundary.', 409, { reference: ref });
        }
      }
    }
  }
}

export class LogicEngine {
  constructor(store, { trustedInitialKnowledgeSources = [], worldPackCatalog = null, npcKnowledgeReadAuthorizer = null, npcKnowledgeVisibilityAuthorizer = null } = {}) {
    if (!Array.isArray(trustedInitialKnowledgeSources)) throw new TypeError('trustedInitialKnowledgeSources must be a deployment-owned array');
    this.trustedInitialKnowledgeSources = trustedInitialKnowledgeSources.map((entry) => Object.freeze({ ...entry }));
    if (worldPackCatalog !== null && typeof worldPackCatalog.resolve !== 'function') throw new TypeError('worldPackCatalog must provide resolve(worldPackId, version)');
    this.worldPackCatalog = worldPackCatalog;
    if (npcKnowledgeReadAuthorizer !== null && (typeof npcKnowledgeReadAuthorizer !== 'function' || npcKnowledgeReadAuthorizer instanceof ASYNC_FUNCTION_PROTOTYPE)) throw new TypeError('npcKnowledgeReadAuthorizer must be a synchronous deployment-owned function');
    if (npcKnowledgeVisibilityAuthorizer !== null && (typeof npcKnowledgeVisibilityAuthorizer !== 'function' || npcKnowledgeVisibilityAuthorizer instanceof ASYNC_FUNCTION_PROTOTYPE)) throw new TypeError('npcKnowledgeVisibilityAuthorizer must be a synchronous deployment-owned function');
    this.npcKnowledgeReadAuthorizer = npcKnowledgeReadAuthorizer;
    this.npcKnowledgeVisibilityAuthorizer = npcKnowledgeVisibilityAuthorizer;
    this.store = store;
    this.processStore = new ProcessStore(store);
    this.store.processStore = this.processStore;
  }

  createProcess(id, input) {
    assert(obj(input), 'INVALID_PROCESS_REQUEST', 'Process creation request must be an object.');
    const allowed = ['process_id', 'definition_version', 'title', 'metadata', 'milestones', 'expected_revision', 'idempotency_key'];
    assert(Object.keys(input).every((key) => allowed.includes(key)), 'UNSUPPORTED_PROCESS_FIELD', 'Process creation contains an unsupported field.');
    assert(typeof input.idempotency_key === 'string' && input.idempotency_key.trim() && input.idempotency_key.length <= 200,
      'IDEMPOTENCY_KEY_REQUIRED', 'Process idempotency_key is required.');
    assert(Number.isSafeInteger(input.expected_revision) && input.expected_revision >= 0,
      'INVALID_REVISION', 'Process expected_revision must be a non-negative safe integer.');
    let definition;
    try {
      definition = normalizeProcessDefinition({
        process_id: input.process_id,
        world_id: id,
        definition_version: input.definition_version,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        milestones: input.milestones,
      });
    } catch (error) {
      throw new EngineError(error.code || 'INVALID_PROCESS_DEFINITION', error.message || 'Process definition validation failed.', 400, error.details);
    }
    const eventAllowed = ['turn_id', 'event_type', 'generation_id', 'context_manifest_id', 'source_message_id',
      'duration_proposal', 'caused_by', 'depends_on', 'read_set', 'causal_links', 'effects'];
    for (const milestone of definition.milestones) {
      const event = milestone.event;
      assert(Object.keys(event).every((key) => eventAllowed.includes(key)),
        'INVALID_PROCESS_MILESTONE_EVENT', 'Milestone event contains an unsupported field or caller-controlled time/identity.');
      assert(typeof event.event_type === 'string' && event.event_type.trim() && event.event_type !== 'time.advance',
        'INVALID_PROCESS_MILESTONE_EVENT', 'Milestone event requires a non-Core-owned event_type.');
      validateEffects(event.effects);
      const eventReads = event.read_set ?? [];
      assert(Array.isArray(eventReads) && eventReads.every((ref) => typeof ref === 'string' && ref.trim()),
        'INVALID_PROCESS_MILESTONE_READ_SET', 'Event read_set must be an array of non-empty references.');
      const undeclaredReads = [...new Set(eventReads)].filter((ref) => !milestone.read_set.includes(ref));
      if (undeclaredReads.length) {
        throw new EngineError('PROCESS_READ_SET_UNDERDECLARED', 'Milestone trigger read_set must include every event read reference.', 400, {
          milestone_id: milestone.milestone_id, undeclared_read_refs: undeclaredReads,
        });
      }
      const actualWrites = [];
      for (const effect of event.effects) {
        if (typeof effect.entity_id === 'string' && ['entity.create', 'entity.update', 'entity.upsert', 'entity.delete'].includes(effect.kind)) {
          actualWrites.push('entity:' + effect.entity_id);
        } else if (effect.kind === 'fact.set') {
          actualWrites.push('fact:' + effect.fact_id);
        } else if (effect.kind?.startsWith('mechanic.instance.')) {
          actualWrites.push('mechanic:' + effect.instance_id);
        }
      }
      const undeclaredWrites = [...new Set(actualWrites)].filter((ref) => !milestone.write_set.includes(ref));
      if (undeclaredWrites.length) {
        throw new EngineError('PROCESS_WRITE_SET_UNDERDECLARED', 'Milestone trigger write_set must include every canonical projection written by its event effects.', 400, {
          milestone_id: milestone.milestone_id, undeclared_write_refs: undeclaredWrites,
        });
      }
    }
    const idempotencyKey = input.idempotency_key.trim();
    const requestHash = hashRequest({
      operation: 'process.create', world_id: id, expected_revision: input.expected_revision,
      idempotency_key: idempotencyKey, definition,
    });
    return this.store.tx(() => {
      const created = this.processStore.createRecord({
        worldId: id, process: definition, idempotencyKey, requestHash, expectedRevision: input.expected_revision,
      });
      if (created.idempotent_replay) return created;
      const triggerIds = new Map(definition.milestones.map((milestone) => [milestone.milestone_id, milestone.trigger_id]));
      for (const milestone of definition.milestones) {
        this.registerTimeTrigger(id, {
          trigger_id: milestone.trigger_id,
          due_coordinate: milestone.due_coordinate,
          dependencies: milestone.prerequisites.map((prerequisiteId) => triggerIds.get(prerequisiteId)),
          read_set: milestone.read_set,
          write_set: milestone.write_set,
          processing_mode: 'exact',
          interrupt_after_coordinate: milestone.interrupt_after_coordinate,
          payload: { process_id: definition.process_id, milestone_id: milestone.milestone_id, event: milestone.event },
        });
      }
      this.processStore.addMilestones(id, definition);
      this.processStore.finalizeCreate(id, definition.process_id);
      return { process: this.processStore.get(id, definition.process_id), idempotent_replay: false };
    });
  }

  getProcess(id, processId) {
    return this.processStore.get(id, processId);
  }

  listProcesses(id) {
    return this.processStore.list(id);
  }

  transitionProcess(id, processId, input) {
    assert(obj(input), 'INVALID_PROCESS_TRANSITION', 'Process transition request must be an object.');
    const allowed = ['action', 'expected_version', 'idempotency_key', 'reason'];
    assert(Object.keys(input).every((key) => allowed.includes(key)), 'UNSUPPORTED_PROCESS_TRANSITION_FIELD', 'Process transition contains an unsupported field.');
    assert(['pause', 'resume', 'cancel'].includes(input.action), 'INVALID_PROCESS_ACTION', 'Process action must be pause, resume, or cancel.');
    assert(Number.isSafeInteger(input.expected_version) && input.expected_version >= 1, 'INVALID_PROCESS_VERSION', 'expected_version must be a positive safe integer.');
    assert(typeof input.idempotency_key === 'string' && input.idempotency_key.trim() && input.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'Process transition idempotency_key is required.');
    const reason = input.reason ?? ('author_' + input.action);
    assert(typeof reason === 'string' && reason.trim() && reason.length <= 200, 'INVALID_PROCESS_REASON', 'reason must be a non-empty string of at most 200 characters.');
    const key = input.idempotency_key.trim();
    const targetState = input.action === 'pause' ? 'paused' : input.action === 'cancel' ? 'cancelled' : null;
    const requestHash = hashRequest({ operation: 'process.' + input.action, world_id: id, process_id: processId, expected_version: input.expected_version, idempotency_key: key, reason: reason.trim() });
    return this.store.tx(() => {
      const replay = this.processStore.replayOperation(id, key, requestHash);
      if (replay) return replay;
      const current = this.processStore.get(id, processId);
      if (input.action === 'resume') {
        if (current.stored_status !== 'paused' && current.stored_status !== 'needs_review') {
          throw new EngineError('INVALID_PROCESS_TRANSITION', 'Only a paused or needs-review process can be resumed.', 409, { current_status: current.stored_status });
        }
        if (current.progress.blocked > 0 || current.milestones.some((milestone) => milestone.status === 'needs_review' || milestone.status === 'blocked')) {
          throw new EngineError('PROCESS_REQUIRES_RECONCILIATION', 'A process with milestone progress in needs-review/blocked state cannot resume until its causal state is reconciled.', 409, {
            blocked_milestone_ids: current.milestones.filter((milestone) => ['needs_review','blocked'].includes(milestone.status)).map((milestone) => milestone.milestone_id),
          });
        }
        const world = this.getState(id);
        const pending = current.milestones.filter((milestone) => milestone.status === 'pending');
        const overdue = pending.filter((milestone) => milestone.due_coordinate <= world.game_time_coordinate);
        if (overdue.length) {
          throw new EngineError('PROCESS_RESUME_REQUIRES_REPLAN', 'Paused process milestones became due while paused; explicit re-planning is required.', 409, {
            milestone_ids: overdue.map((milestone) => milestone.milestone_id), current_coordinate: world.game_time_coordinate,
          });
        }
        for (const milestone of pending) {
          const oldTrigger = this.getTimeTrigger(id, milestone.trigger_id);
          if (oldTrigger.status === 'pending') this.cancelTimeTrigger(id, milestone.trigger_id, reason.trim(), { processLifecycle: true });
        }
        const nextVersion = current.version + 1;
        const newIds = new Map(pending.map((milestone) => [milestone.milestone_id,
          'process-trigger:' + hashRequest({ world_id: id, process_id: processId, milestone_id: milestone.milestone_id, resume_version: nextVersion }).slice(0, 40)]));
        const updates = pending.map((milestone) => ({ milestone_id: milestone.milestone_id, trigger_id: newIds.get(milestone.milestone_id) }));
        const triggerIdByMilestone = new Map(current.milestones.map((milestone) => [milestone.milestone_id, newIds.get(milestone.milestone_id) || milestone.trigger_id]));
        for (const milestone of pending) {
          this.registerTimeTrigger(id, {
            trigger_id: newIds.get(milestone.milestone_id),
            due_coordinate: milestone.due_coordinate,
            dependencies: milestone.prerequisites.map((prerequisiteId) => triggerIdByMilestone.get(prerequisiteId)),
            read_set: milestone.read_set,
            write_set: milestone.write_set,
            processing_mode: 'exact',
            interrupt_after_coordinate: milestone.interrupt_after_coordinate,
            payload: { process_id: processId, milestone_id: milestone.milestone_id, event: milestone.event },
          });
        }
        this.processStore.replacePendingTriggers(id, processId, updates);
        const state = current.progress.completed > 0 ? 'running' : 'scheduled';
        const transition = validateProcessTransition(current.stored_status, state);
        if (!transition) throw new EngineError('INVALID_PROCESS_TRANSITION', 'Resume transition was rejected.', 409);
        return this.processStore.transition(id, processId, state, {
          expectedVersion: input.expected_version, idempotencyKey: key, requestHash,
        });
      }
      if (current.version !== input.expected_version) {
        throw new EngineError('PROCESS_VERSION_CONFLICT', 'Process checkpoint changed before transition.', 409, { expected_version: input.expected_version, current_version: current.version });
      }
      validateProcessTransition(current.stored_status, targetState);
      for (const milestone of current.milestones.filter((item) => item.status === 'pending')) {
        const trigger = this.getTimeTrigger(id, milestone.trigger_id);
        if (trigger.status === 'pending') this.cancelTimeTrigger(id, milestone.trigger_id, reason.trim(), { processLifecycle: true });
      }
      return this.processStore.transition(id, processId, targetState, {
        expectedVersion: input.expected_version, idempotencyKey: key, requestHash,
      });
    });
  }

  registerTimeConfiguration(id, input) {
    assert(obj(input), 'INVALID_TIME_CONFIGURATION', 'Time configuration must be an object.');
    const allowed = ['version', 'world_pack_id', 'world_pack_version', 'calendar_definition', 'time_policy'];
    assert(Object.keys(input).every((key) => allowed.includes(key)), 'UNSUPPORTED_TIME_CONFIGURATION_FIELD', 'Time configuration contains an unsupported field.');
    for (const key of ['version', 'world_pack_id', 'world_pack_version']) {
      assert(typeof input[key] === 'string' && input[key].trim() && input[key].length <= 200, 'INVALID_TIME_CONFIGURATION', key + ' must be a non-empty string.');
    }
    const world = this.getState(id);
    if (input.world_pack_id !== world.world_pack_id || input.world_pack_version !== world.world_pack_version) {
      throw new EngineError('TIME_CONFIG_WORLD_PACK_MISMATCH', 'Time configuration must match the world\'s pinned World Pack.', 409);
    }
    let calendar;
    let policy;
    try {
      calendar = createCalendarDefinition(input.calendar_definition);
      policy = createTimePolicy(input.time_policy);
    } catch (error) {
      throw new EngineError(error.code || 'INVALID_TIME_CONFIGURATION', error.message || 'Time configuration validation failed.', 400);
    }
    const config = {
      version: input.version.trim(),
      world_pack_id: world.world_pack_id,
      world_pack_version: world.world_pack_version,
      calendar_definition: calendar,
      time_policy: policy,
      content_hash: hashRequest({
        world_pack_id: world.world_pack_id,
        world_pack_version: world.world_pack_version,
        calendar_definition: calendar,
        time_policy: policy,
      }),
      created_by: 'trusted_admin',
    };
    return this.store.registerTimeConfiguration(id, config);
  }

  getTimeConfiguration(id, version = null) {
    return this.store.getTimeConfiguration(id, version);
  }

  projectTime(id, coordinate = null) {
    const world = this.getState(id);
    const config = this.store.getTimeConfiguration(id);
    if (!config) throw new EngineError('TIME_CONFIG_REQUIRED', 'This world has no active versioned calendar/time policy.', 409);
    const at = coordinate ?? world.game_time_coordinate;
    if (!Number.isSafeInteger(at)) throw new EngineError('INVALID_TIME_COORDINATE', 'Time projection coordinate must be a safe integer.', 400);
    try {
      return {
        world_id: id,
        coordinate: at,
        calendar: projectCalendarDate(config.calendar_definition, at),
        calendar_id: config.calendar_definition.calendar_id,
        calendar_version: config.calendar_definition.version,
        policy_id: config.time_policy.policy_id,
        policy_version: config.time_policy.version,
        time_config_version: config.version,
      };
    } catch (error) {
      throw new EngineError(error.code || 'INVALID_TIME_COORDINATE', error.message || 'Calendar projection failed.', 400);
    }
  }

  prepareEventForWorld(id, x, options = {}) {
    const { authorApprovedDuration = false, ...prepareOptions } = options;
    const config = this.store.getTimeConfiguration(id);
    if (!config) {
      assert(x.duration_proposal === undefined || x.duration_proposal === null,
        'TIME_POLICY_REQUIRED', 'Duration proposals require an active versioned TimePolicy.');
      return this.prepareEvent(x, prepareOptions);
    }
    const policy = config.time_policy;
    if (x.time_mode === 'explicit_skip') {
      assert(x.event_type === 'time.advance', 'INVALID_TIME_SKIP_EVENT_TYPE',
        'Explicit skip must be represented by a time.advance event.');
      assert(x.duration_proposal === undefined || x.duration_proposal === null,
        'UNEXPECTED_DURATION_PROPOSAL', 'Explicit skip duration is governed by TimePolicy and cannot include an action duration proposal.');
      const seconds = x.time_advance_seconds ?? 0;
      assert(Number.isSafeInteger(seconds) && seconds >= 0, 'INVALID_TIME_ADVANCE', 'time_advance_seconds must be a non-negative integer.');
      assert(seconds * 1000 <= policy.max_skip_duration_ms, 'TIME_ADVANCE_TOO_LARGE', 'Explicit skip exceeds the active World Pack TimePolicy.');
      const decision = {
        status: 'resolved', certainty: 'fixed', duration_ms: seconds * 1000,
        source: 'explicit_skip_policy', policy_id: policy.policy_id, policy_version: policy.version,
      };
      return this.prepareEvent(x, { ...prepareOptions, maxActionDurationSeconds: Math.floor(policy.max_action_duration_ms / 1000), maxSkipDurationSeconds: Math.floor(policy.max_skip_duration_ms / 1000), durationDecision: { ...decision, time_config_version: config.version } });
    }
    const requestedMs = (x.time_advance_seconds ?? 0) * 1000;
    const decision = resolveDurationDecision(policy, x.event_type, x.duration_proposal ?? null, requestedMs, { authorApproved: authorApprovedDuration });
    if (decision.status === 'needs_author') {
      throw new EngineError('DURATION_NEEDS_AUTHOR', 'The active TimePolicy requires an author decision before this event can be timed.', 409, decision);
    }
    if (decision.status !== 'resolved') {
      throw new EngineError('DURATION_PROPOSAL_REJECTED', 'The proposed duration is not permitted by the active TimePolicy.', 400, decision);
    }
    if (decision.duration_ms % 1000 !== 0) {
      throw new EngineError('DURATION_SUBSECOND_UNSUPPORTED', 'The active TimePolicy resolved a sub-second duration, but event commits currently require whole seconds.', 400, decision);
    }
    const seconds = decision.duration_ms / 1000;
    if (x.time_advance_seconds !== undefined && x.time_advance_seconds !== seconds) {
      throw new EngineError('DURATION_MISMATCH', 'Caller-supplied duration differs from the Core-resolved TimePolicy duration.', 400, {
        supplied_seconds: x.time_advance_seconds, resolved_seconds: seconds,
      });
    }
    return this.prepareEvent({ ...x, time_advance_seconds: seconds }, {
      ...prepareOptions,
      maxActionDurationSeconds: Math.floor(policy.max_action_duration_ms / 1000),
      maxSkipDurationSeconds: Math.floor(policy.max_skip_duration_ms / 1000),
      durationDecision: { ...decision, time_config_version: config.version },
    });
  }

  createWorld(x) {
    assert(obj(x), 'INVALID_BODY', 'Body must be an object.');
    for (const k of ['world_pack_id', 'world_pack_version']) {
      assert(typeof x[k] === 'string' && x[k].trim(), 'INVALID_WORLD', 'Missing ' + k);
    }
    assert(typeof x.game_time === 'string' && Number.isFinite(Date.parse(x.game_time)), 'INVALID_GAME_TIME', 'game_time must be a valid date/time.');
    const id = x.world_id || randomUUID();
    assert(typeof id === 'string' && id.trim() && id.length <= 200, 'INVALID_WORLD_ID', 'Invalid world_id.');
    const trustedPack = this.worldPackCatalog
      ? this.worldPackCatalog.resolve(x.world_pack_id.trim(), x.world_pack_version.trim())
      : null;
    return this.store.createWorld({
      world_id: id,
      world_pack_id: x.world_pack_id.trim(),
      world_pack_version: x.world_pack_version.trim(),
      world_pack_digest: trustedPack?.sha256 ?? null,
      game_time: new Date(Date.parse(x.game_time)).toISOString(),
    });
  }

  registerContextManifest(id, x) {
    assert(obj(x), 'INVALID_BODY', 'Body must be an object.');
    assert(typeof x.generation_id === 'string' && x.generation_id.trim() && x.generation_id.length <= 200, 'GENERATION_ID_REQUIRED', 'generation_id must be a non-empty string of at most 200 characters.');
    assert(Number.isSafeInteger(x.base_commit_sequence) && x.base_commit_sequence >= 0, 'INVALID_CONTEXT_CURSOR', 'base_commit_sequence must be a non-negative integer.');
    assert(Number.isSafeInteger(x.base_world_revision) && x.base_world_revision >= 0, 'INVALID_CONTEXT_REVISION', 'base_world_revision must be a non-negative integer.');
    const items = contextItems(x.items);
    const request = {
      world_id: id,
      generation_id: x.generation_id.trim(),
      base_commit_sequence: x.base_commit_sequence,
      base_world_revision: x.base_world_revision,
      items,
    };
    return this.store.registerContextManifest(id, {
      ...request,
      manifest_hash: hashRequest(request),
    });
  }

  getState(id) { return this.store.state(id); }
  getSnapshot(id, request = {}) { return this.store.readSnapshot(id, request); }
  /** @internal Provider reconciliation only; not an HTTP/client authorization API. */
  getCanonicalEntityInventory(id, request = {}) { return this.store.readCanonicalEntityInventory(id, request); }
  getEvents(id, includeInvalid = false) { return this.store.events(id, includeInvalid); }
  reevaluateRelationshipEvent(id, eventId, effectIndex = null) {
    return this.store.reevaluateRelationshipEvent(id, eventId, effectIndex);
  }
  getAudit(id) { return this.store.audit(id); }

  registerMechanicTemplate(value) {
    const template = validateMechanicTemplate(value);
    return this.store.registerMechanicTemplate(template, hashRequest(template));
  }

  getMechanicTemplate(templateId, version) {
    return this.store.getMechanicTemplate(templateId, version);
  }

  listMechanicTemplates(templateId = null) {
    return this.store.listMechanicTemplates(templateId);
  }

  registerRuleModuleManifest(value) {
    const manifest = validateRuleModuleManifest(value);
    return this.store.registerRuleModuleManifest(manifest, hashRequest(manifest));
  }

  getRuleModuleManifest(moduleId, version) {
    return this.store.getRuleModuleManifest(moduleId, version);
  }

  listRuleModuleManifests(moduleId = null) {
    return this.store.listRuleModuleManifests(moduleId);
  }

  getMechanicRegistryAudit() {
    return this.store.mechanicRegistryAudit();
  }
  getMechanicInstance(worldId, instanceId) { return this.store.getMechanicInstance(worldId, instanceId); }
  listMechanicInstances(worldId) { return this.store.listMechanicInstances(worldId); }

  prepareEvent(x, options = {}) {
    assert(obj(x), 'INVALID_BODY', 'Body must be an object.');
    const allowedFields = ['idempotency_key', 'turn_id', 'event_type', 'event_id', 'expected_revision', 'expected_commit_sequence', 'context_manifest_id', 'generation_id', 'source_message_id', 'time_advance_seconds', 'time_mode', 'duration_proposal', 'caused_by', 'depends_on', 'read_set', 'causal_links', 'effects'];
    assert(Object.keys(x).every((key) => allowedFields.includes(key)), 'UNSUPPORTED_EVENT_FIELD', 'Event proposal contains an unsupported top-level field.');
    assert(typeof x.idempotency_key === 'string' && x.idempotency_key.trim() && x.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key required.');
    assert(typeof x.turn_id === 'string' && x.turn_id.trim() && x.turn_id.length <= 200, 'TURN_ID_REQUIRED', 'turn_id required.');
    assert(typeof x.event_type === 'string' && x.event_type.trim() && x.event_type.length <= 200, 'EVENT_TYPE_REQUIRED', 'event_type required.');
    if (x.event_id !== undefined && x.event_id !== null) {
      assert(typeof x.event_id === 'string' && x.event_id.trim() && x.event_id.length <= 200, 'INVALID_EVENT_ID', 'event_id must be a non-empty string of at most 200 characters.');
      assert(!x.event_id.trim().startsWith('entity:') && !x.event_id.trim().startsWith('fact:'), 'INVALID_EVENT_ID', 'event_id cannot use the reserved entity: or fact: reference prefixes.');
    }
    if (x.expected_revision !== undefined) assert(Number.isSafeInteger(x.expected_revision) && x.expected_revision >= 0, 'INVALID_REVISION', 'expected_revision must be non-negative.');
    if (x.expected_commit_sequence !== undefined) assert(Number.isSafeInteger(x.expected_commit_sequence) && x.expected_commit_sequence >= 0, 'INVALID_COMMIT_SEQUENCE', 'expected_commit_sequence must be non-negative.');
    if (x.context_manifest_id !== undefined) assert(typeof x.context_manifest_id === 'string' && x.context_manifest_id.trim() && x.context_manifest_id.length <= 200, 'INVALID_CONTEXT_MANIFEST_ID', 'context_manifest_id must be a non-empty string of at most 200 characters.');
    if (x.generation_id !== undefined && x.generation_id !== null) assert(typeof x.generation_id === 'string' && x.generation_id.trim() && x.generation_id.length <= 200, 'INVALID_GENERATION_ID', 'generation_id must be a non-empty string of at most 200 characters.');

    const seconds = x.time_advance_seconds ?? 0;
    const skip = x.time_mode === 'explicit_skip';
    assert(Number.isSafeInteger(seconds) && seconds >= 0, 'INVALID_TIME_ADVANCE', 'time_advance_seconds must be non-negative.');
    assert(x.time_mode === undefined || x.time_mode === 'action' || skip, 'INVALID_TIME_MODE', 'time_mode must be action or explicit_skip.');
    const maxSeconds = skip ? (options.maxSkipDurationSeconds ?? 604800) : (options.maxActionDurationSeconds ?? 43200);
    assert(seconds <= maxSeconds, 'TIME_ADVANCE_TOO_LARGE', 'Time advance exceeds the active duration limit.');
    if (seconds > 0) assert(options.durationDecision?.status === 'resolved' || ['time.advance', 'action.completed'].includes(x.event_type), 'INVALID_TIME_ADVANCE', 'Positive duration requires a supported time event or an active TimePolicy decision.');

    const effects = x.effects ?? [];
    validateEffects(effects, {
      allowRelationshipTransition: options.allowRelationshipTransition === true,
      allowKnowledgeAcquisition: options[INTERNAL_CORE_EFFECTS] === true && options.allowKnowledgeAcquisition === true,
      allowNpcBeliefTransition: options[INTERNAL_CORE_EFFECTS] === true && options.allowNpcBeliefTransition === true,
    });
    const request = {
      operation: 'event.commit',
      event_id: x.event_id ?? null,
      turn_id: x.turn_id.trim(),
      generation_id: x.generation_id == null ? null : x.generation_id.trim(),
      context_manifest_id: x.context_manifest_id == null ? null : x.context_manifest_id.trim(),
      source_message_id: x.source_message_id ?? null,
      event_type: x.event_type.trim(),
      expected_revision: x.expected_revision ?? null,
      expected_commit_sequence: x.expected_commit_sequence ?? null,
      time_advance_seconds: seconds,
      time_mode: x.time_mode ?? 'action',
      ...(x.duration_proposal !== undefined ? { duration_proposal: x.duration_proposal } : {}),
      ...(options.durationDecision ? { duration_decision: options.durationDecision } : {}),
      caused_by: strings(x.caused_by, 'caused_by'),
      depends_on: strings(x.depends_on, 'depends_on'),
      read_set: strings(x.read_set, 'read_set'),
      causal_links: causalLinks(x.causal_links),
      effects,
    };
    return {
      ...request,
      request_hash: hashRequest(request),
      idempotency_key: x.idempotency_key.trim(),
    };
  }

  assertNoScheduledTriggerCrossing(id, events, expectedRevision) {
    const durationMs = events.reduce((sum, event) => sum + (event.time_advance_seconds ?? 0) * 1000, 0);
    if (durationMs === 0) return;
    const world = this.getState(id);
    // Do not reject stale revisions here: SQLiteStore checks idempotency replay
    // before revision freshness, so an identical completed request can replay.
    // A new stale request is still rejected by the canonical commit boundary.
    let targetCoordinate;
    try {
      targetCoordinate = addTimeDuration(world.game_time_coordinate, durationMs);
    } catch (error) {
      const code = error.code === 'COORDINATE_OVERFLOW' ? 'TIME_COORDINATE_OVERFLOW' : (error.code || 'INVALID_TIME_COORDINATE');
      throw new EngineError(code, error.message || 'Timed event target is outside the coordinate range.', 400);
    }
    assert(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0,
      'TIMED_EVENT_REVISION_REQUIRED', 'A direct timed commit requires expected_revision so trigger registration cannot race the time boundary.');
    const due = this.store.listTimeTriggers(id)
      .filter((trigger) => trigger.status === 'pending'
        && trigger.due_coordinate > world.game_time_coordinate
        && trigger.due_coordinate <= targetCoordinate)
      .map((trigger) => trigger.trigger_id);
    if (due.length) {
      throw new EngineError('TIME_ADVANCE_OPERATION_REQUIRED',
        'A direct timed commit cannot cross registered scheduled work; use the Core timed-action or time-advance operation.',
        409, { trigger_ids: due, from_coordinate: world.game_time_coordinate, to_coordinate: targetCoordinate });
    }
  }

  readNpcKnowledge(input) {
    return withNpcAuthorizationLease(this.store, () => {
      const inputCheck = validateNpcKnowledgeReadInput(input);
      assert(inputCheck.status === 'ready', 'NPC_KNOWLEDGE_READ_NOT_READY',
        'NPC knowledge read request is malformed or unsupported.', 400,
        { reason: inputCheck.reason });
      const request = inputCheck.request;
      assert(typeof this.npcKnowledgeReadAuthorizer === 'function',
        'NPC_KNOWLEDGE_READ_NOT_CONFIGURED', 'A trusted deployment-owned NPC knowledge read authorizer is required.', 403);
      // Read the authorization cursor from one Core snapshot transaction. Separate
      // world/current-sequence reads can straddle a rollback because rollback advances
      // world_revision without advancing the event commit_sequence.
      const snapshot = this.getSnapshot(request.world_id);
      const world = snapshot;
      assert(world, 'WORLD_NOT_FOUND', 'World not found.', 404);
      const commitSequence = snapshot.commit_sequence;
      const actor = this.store.db.prepare(
        "SELECT entity_id,status FROM entities WHERE world_id=? AND entity_id=?"
      ).get(request.world_id, request.actor_id);
      assert(actor && actor.status !== 'destroyed',
        'NPC_KNOWLEDGE_READER_NOT_ELIGIBLE', 'The requesting NPC must be a non-destroyed entity in this world.', 403);
  
      let authorization;
      try {
        authorization = this.npcKnowledgeReadAuthorizer(Object.freeze({
          world_id: request.world_id,
          conversation_id: request.conversation_id,
          adapter_id: request.adapter_id,
          actor_id: request.actor_id,
          recipient: request.recipient,
          purpose: request.purpose,
          world_revision: world.world_revision,
          commit_sequence: commitSequence,
        }));
      } catch {
        throw new EngineError('NPC_KNOWLEDGE_READ_NOT_AUTHORIZED',
          'The trusted read authorizer did not approve this request.', 403);
      }
      const checked = validateNpcKnowledgeRead(request, world, commitSequence, authorization);
      if (checked.status !== 'ready') {
        const status = checked.reason === 'stale_snapshot' ? 409
          : checked.reason === 'world_not_found' ? 404 : 403;
        throw new EngineError('NPC_KNOWLEDGE_READ_NOT_READY',
          'NPC knowledge read was denied or its snapshot is no longer current.', status,
          { reason: checked.reason });
      }
  
      const rows = this.store.db.prepare(`
        SELECT a.acquisition_id, a.fact_id, a.acquisition_kind, a.provenance_ref,
          a.provenance_digest, a.authorization_ref, a.acquired_value_json, a.acquired_source_event_ids_json,
          f.subject_ref, f.predicate, f.value_json, f.source_event_ids_json
        FROM knowledge_acquisitions AS a
        JOIN facts AS f ON f.world_id=a.world_id AND f.fact_id=a.fact_id
        WHERE a.world_id=? AND a.subject_id=? AND f.status='active'
        ORDER BY a.acquisition_id
        LIMIT ?
      `).all(request.world_id, request.actor_id, checked.request.limit + 1);
      const truncated = rows.length > checked.request.limit;
      const items = rows.slice(0, checked.request.limit).map((row) => {
        let value;
        let sourceEventIds;
        try {
          value = JSON.parse(row.acquired_value_json);
          sourceEventIds = JSON.parse(row.acquired_source_event_ids_json);
          const currentValue = JSON.parse(row.value_json);
          const currentSourceEventIds = JSON.parse(row.source_event_ids_json);
          if (hashRequest(value) !== hashRequest(currentValue)
            || hashRequest([...sourceEventIds].sort()) !== hashRequest([...currentSourceEventIds].sort())) {
            throw new EngineError('NPC_KNOWLEDGE_ACQUISITION_VERSION_MISMATCH',
              'The active fact no longer matches the version conveyed by this acquisition; reacquisition is required.', 409);
          }
        } catch (error) {
          // Preserve the deliberate version-mismatch failure. Converting it to a
          // generic projection error hides the actionable requirement to reacquire.
          if (error instanceof EngineError && error.code === 'NPC_KNOWLEDGE_ACQUISITION_VERSION_MISMATCH') {
            throw error;
          }
          throw new EngineError('NPC_KNOWLEDGE_PROJECTION_INVALID',
            'The knowledge projection contains invalid canonical JSON.', 409);
        }
        assert(Array.isArray(sourceEventIds) && sourceEventIds.length > 0
          && sourceEventIds.every((eventId) => typeof eventId === 'string' && eventId.trim()),
        'NPC_KNOWLEDGE_PROJECTION_INVALID', 'Knowledge item is missing canonical source-event provenance.', 409);
        const freezeTree = (node) => {
          if (node && typeof node === 'object' && !Object.isFrozen(node)) {
            for (const child of Object.values(node)) freezeTree(child);
            Object.freeze(node);
          }
          return node;
        };
        return Object.freeze({
          acquisition_id: row.acquisition_id,
          fact_id: row.fact_id,
          subject_ref: row.subject_ref,
          predicate: row.predicate,
          value: freezeTree(value),
          acquisition_kind: row.acquisition_kind,
          provenance_ref: row.provenance_ref,
          provenance_digest: row.provenance_digest,
          acquisition_authorization_ref: row.authorization_ref,
          source_event_ids: Object.freeze(sourceEventIds),
        });
      });
  
      // The authorizer and SQL read happen after the initial cursor capture. Re-read
      // the canonical cursor before returning so a concurrent commit cannot make
      // this ready response combine newer acquisition rows with an older snapshot.
      // Re-read the cursor atomically. A rollback changes world_revision but not
      // commit_sequence, so two separate reads could observe the pre-rollback world
      // row and post-rollback sequence and incorrectly accept a stale result.
      let snapshotNow;
      try { snapshotNow = this.getSnapshot(request.world_id); } catch { snapshotNow = null; }
      assert(snapshotNow && snapshotNow.status === 'active'
        && snapshotNow.world_revision === checked.request.world_revision
        && snapshotNow.commit_sequence === checked.request.commit_sequence,
      'NPC_KNOWLEDGE_READ_NOT_READY',
      'World snapshot changed while reading NPC knowledge; retry from a fresh snapshot.', 409);
  
      return Object.freeze({
        status: 'ready',
        world_id: request.world_id,
        conversation_id: request.conversation_id,
        adapter_id: request.adapter_id,
        actor_id: request.actor_id,
        recipient: request.recipient,
        purpose: request.purpose,
        snapshot: Object.freeze({
          world_revision: checked.request.world_revision,
          commit_sequence: checked.request.commit_sequence,
        }),
        authorization_ref: checked.request.authorization_ref,
        truncated,
        items: Object.freeze(items),
      });
    });
  }  /**
   * Build an actor-specific belief context from Core-authorized acquisitions.
   * This is an internal, non-HTTP method. Visibility is checked per acquisition;
   * model proposals cannot create evidence or commit world effects.
   */
  prepareNpcBeliefContext(input, proposal, currentBelief = null) {
    return withNpcAuthorizationLease(this.store, () => {
      assert(typeof this.npcKnowledgeVisibilityAuthorizer === 'function',
        'NPC_KNOWLEDGE_VISIBILITY_NOT_CONFIGURED',
        'A trusted deployment-owned per-acquisition visibility authorizer is required.', 403);
      const read = this.readNpcKnowledge(input);
      assert(read.truncated !== true, 'NPC_KNOWLEDGE_READ_INCOMPLETE',
        'The actor knowledge read exceeded its bounded limit; belief context requires a complete acquisition window.', 409);
      const visibleItems = [];
      const withheldPropositionRefs = new Set();
      for (const item of read.items) {
        let decision;
        try {
          decision = this.npcKnowledgeVisibilityAuthorizer(Object.freeze({
            world_id: read.world_id,
            conversation_id: read.conversation_id,
            adapter_id: read.adapter_id,
            actor_id: read.actor_id,
            recipient: read.recipient,
            purpose: read.purpose,
            world_revision: read.snapshot.world_revision,
            commit_sequence: read.snapshot.commit_sequence,
            acquisition_id: item.acquisition_id,
            fact_id: item.fact_id,
            subject_ref: item.subject_ref,
            predicate: item.predicate,
            acquisition_kind: item.acquisition_kind,
            acquisition_authorization_ref: item.acquisition_authorization_ref,
            provenance_ref: item.provenance_ref,
            provenance_digest: item.provenance_digest,
          }));
        } catch {
          throw new EngineError('NPC_KNOWLEDGE_VISIBILITY_NOT_AUTHORIZED',
            'The trusted visibility authorizer failed; no belief context was prepared.', 403);
        }
        const allowedKeys = [
          'status', 'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient', 'purpose', 'world_revision',
          'commit_sequence', 'acquisition_id', 'authorization_ref',
        ];
        const exactDecision = exactDataRecord(decision, allowedKeys);
        if (!exactDecision) {
          throw new EngineError('NPC_KNOWLEDGE_VISIBILITY_NOT_AUTHORIZED',
            'The visibility authorizer returned a malformed decision.', 403);
        }
        if (decision.status === 'denied') {
          if (decision.world_id !== read.world_id || decision.conversation_id !== read.conversation_id
            || decision.adapter_id !== read.adapter_id
            || decision.actor_id !== read.actor_id || decision.recipient !== read.recipient
            || decision.purpose !== read.purpose
            || decision.world_revision !== read.snapshot.world_revision
            || decision.commit_sequence !== read.snapshot.commit_sequence
            || decision.acquisition_id !== item.acquisition_id
            || typeof decision.authorization_ref !== 'string' || !decision.authorization_ref.trim()) {
            throw new EngineError('NPC_KNOWLEDGE_VISIBILITY_NOT_AUTHORIZED',
              'The visibility denial was not bound to this actor and snapshot.', 403);
          }
          const withheldRef = npcPropositionRefFor(item);
          if (withheldRef) withheldPropositionRefs.add(withheldRef);
          continue;
        }
        if (decision.status !== 'allowed'
          || decision.world_id !== read.world_id || decision.conversation_id !== read.conversation_id
          || decision.adapter_id !== read.adapter_id
          || decision.actor_id !== read.actor_id || decision.recipient !== read.recipient
          || decision.purpose !== read.purpose
          || decision.world_revision !== read.snapshot.world_revision
          || decision.commit_sequence !== read.snapshot.commit_sequence
          || decision.acquisition_id !== item.acquisition_id
          || typeof decision.authorization_ref !== 'string' || !decision.authorization_ref.trim()) {
          throw new EngineError('NPC_KNOWLEDGE_VISIBILITY_NOT_AUTHORIZED',
            'The visibility decision did not authorize this exact acquisition, actor, purpose, and snapshot.', 403);
        }
        visibleItems.push(item);
      }
  
      const visibleRead = Object.freeze({
        ...read,
        items: Object.freeze(visibleItems),
        withheld_proposition_refs: Object.freeze([...withheldPropositionRefs]),
      });
      const reduced = reduceNpcBeliefTransition({
        knowledgeRead: visibleRead,
        currentBelief,
        proposal,
      });
      assert(reduced.status === 'ready', 'NPC_BELIEF_TRANSITION_NOT_READY',
        'NPC belief proposal failed Core evidence/snapshot validation.', 409,
        { reason: reduced.reason });
  
      // Use one atomic snapshot read: rollback advances world_revision without
      // advancing commit_sequence, so separate reads can straddle a rollback and
      // accidentally accept a stale context.
      const snapshotNow = this.getSnapshot(read.world_id);
      assert(snapshotNow && snapshotNow.status === 'active'
        && snapshotNow.world_revision === read.snapshot.world_revision
        && snapshotNow.commit_sequence === read.snapshot.commit_sequence,
      'NPC_BELIEF_CONTEXT_STALE',
      'World snapshot changed while preparing the NPC belief context; retry from a fresh snapshot.', 409);
  
      const built = buildNpcBeliefContext(visibleRead, reduced.transition);
      assert(built.status === 'ready', 'NPC_BELIEF_CONTEXT_NOT_READY',
        'NPC belief context failed final validation.', 409, { reason: built.reason });
      return Object.freeze({
        status: 'ready',
        snapshot: visibleRead.snapshot,
        transition: reduced.transition,
        context: built.context,
      });
    });
  }  /**
   * Persist an explicit NPC belief transition as a Core-owned projection linked
   * to the canonical event log. The proposal cannot create acquisition evidence.
   */
  recordNpcBeliefTransition(input) {
    return withNpcAuthorizationLease(this.store, () => {
      const required = [
        'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient', 'purpose', 'expected_revision',
        'expected_commit_sequence', 'proposition_ref', 'proposition_value', 'stance',
        'supporting_acquisition_ids', 'contradicting_acquisition_ids', 'reason_rule_ref', 'idempotency_key',
      ];
      assert(isSafeNpcInputRecord(input) && required.every((key) => Object.hasOwn(input, key)),
        'INVALID_NPC_BELIEF_TRANSITION', 'Belief transition request must be a plain data record with all required own fields.');
      const limit = Object.hasOwn(input, 'limit') ? (input.limit ?? 200) : 200;
      const allowed = [
        'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient', 'purpose', 'expected_revision', 'expected_commit_sequence',
        'limit', 'proposition_ref', 'proposition_value', 'stance', 'supporting_acquisition_ids',
        'contradicting_acquisition_ids', 'reason_rule_ref', 'idempotency_key',
      ];
      assert(Object.keys(input).every((key) => allowed.includes(key)),
        'UNSUPPORTED_NPC_BELIEF_TRANSITION_FIELD', 'Belief transition request contains an unsupported field.');
      for (const key of ['world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient', 'proposition_ref', 'reason_rule_ref', 'idempotency_key']) {
        assert(typeof input[key] === 'string' && input[key].trim() && input[key].length <= 200,
          'INVALID_NPC_BELIEF_TRANSITION', key + ' must be a non-empty string of at most 200 characters.');
      }
      assert(['npc_turn_context', 'npc_action_evaluation'].includes(input.purpose),
        'INVALID_NPC_BELIEF_TRANSITION', 'Unsupported NPC belief transition purpose.');
      assert(Number.isSafeInteger(input.expected_revision) && input.expected_revision >= 0
        && Number.isSafeInteger(input.expected_commit_sequence) && input.expected_commit_sequence >= 0,
      'INVALID_NPC_BELIEF_TRANSITION', 'A current world revision and commit sequence are required.');
      const requestHash = hashRequest({
        operation: 'npc.belief.transition',
        world_id: input.world_id,
        conversation_id: input.conversation_id,
        adapter_id: input.adapter_id,
        actor_id: input.actor_id,
        recipient: input.recipient,
        purpose: input.purpose,
        expected_revision: input.expected_revision,
        expected_commit_sequence: input.expected_commit_sequence,
        limit: limit,
        proposition_ref: input.proposition_ref,
        proposition_value: input.proposition_value,
        stance: input.stance,
        supporting_acquisition_ids: input.supporting_acquisition_ids,
        contradicting_acquisition_ids: input.contradicting_acquisition_ids,
        reason_rule_ref: input.reason_rule_ref,
      });
  
      // Canonical snapshot reads and deployment authorizers must run outside the
      // store's write transaction. Authenticate replays against the current cursor
      // before returning even the minimal acknowledgement.
      const existingReplay = this.store.db.prepare(`
        SELECT transition_id, request_hash, event_id, committed_revision
        FROM npc_belief_transitions
        WHERE world_id=? AND idempotency_key=?
      `).get(input.world_id, input.idempotency_key);
      if (existingReplay) {
        const currentWorld = this.store.world(input.world_id);
        assert(currentWorld && currentWorld.status === 'active',
          'WORLD_NOT_FOUND', 'World not found or inactive.', 404);
        this.readNpcKnowledge({
          world_id: input.world_id,
          conversation_id: input.conversation_id,
          adapter_id: input.adapter_id,
          actor_id: input.actor_id,
          recipient: input.recipient,
          purpose: input.purpose,
          expected_revision: currentWorld.world_revision,
          expected_commit_sequence: this.store.currentCommitSequence(input.world_id),
          limit: limit,
        });
        assert(existingReplay.request_hash === requestHash, 'IDEMPOTENCY_KEY_REUSED',
          'Belief transition idempotency key was already used for a different request.', 409);
        return {
          status: 'ready',
          idempotent_replay: true,
          transition: {
            transition_id: existingReplay.transition_id,
            event_id: existingReplay.event_id,
            committed_revision: existingReplay.committed_revision,
          },
        };
      }
  
      const readRequest = {
        world_id: input.world_id,
        conversation_id: input.conversation_id,
        adapter_id: input.adapter_id,
        actor_id: input.actor_id,
        recipient: input.recipient,
        purpose: input.purpose,
        expected_revision: input.expected_revision,
        expected_commit_sequence: input.expected_commit_sequence,
        limit: limit,
      };
      const read = this.readNpcKnowledge(readRequest);
      const currentRow = this.store.db.prepare(`
        SELECT b.stance, b.evidence_acquisition_ids_json
        FROM npc_belief_transitions AS b
        JOIN world_events AS e ON e.world_id=b.world_id AND e.event_id=b.event_id
        WHERE b.world_id=? AND b.actor_id=? AND b.proposition_ref=? AND e.validity='valid'
        ORDER BY e.commit_sequence DESC LIMIT 1
      `).get(input.world_id, input.actor_id, input.proposition_ref);
      const currentBelief = currentRow ? {
        world_id: input.world_id,
        actor_id: input.actor_id,
        proposition_ref: input.proposition_ref,
        stance: currentRow.stance,
        evidence_acquisition_ids: JSON.parse(currentRow.evidence_acquisition_ids_json),
      } : null;
      const proposal = {
        world_id: read.world_id,
        actor_id: read.actor_id,
        snapshot: read.snapshot,
        proposition_ref: input.proposition_ref,
        proposition_value: input.proposition_value,
        stance: input.stance,
        supporting_acquisition_ids: input.supporting_acquisition_ids,
        contradicting_acquisition_ids: input.contradicting_acquisition_ids,
        reason_rule_ref: input.reason_rule_ref,
      };
      const prepared = this.prepareNpcBeliefContext(readRequest, proposal, currentBelief);
      const transitionId = 'npc-belief:' + hashRequest({
        world_id: input.world_id,
        idempotency_key: input.idempotency_key,
      }).slice(0, 40);
  
      // Revalidate every acquisition's visibility at the Core commit boundary.
      // The first preparation builds the proposal; this second pass is the final
      // fail-closed authorization check immediately before the canonical write.
      // Snapshot CAS below still rejects any Core mutation racing this check.
      const commitPrepared = this.prepareNpcBeliefContext(readRequest, proposal, currentBelief);
      assert(hashRequest(commitPrepared.transition) === hashRequest(prepared.transition),
        'NPC_BELIEF_CONTEXT_STALE',
        'NPC belief evidence or stance changed during final commit authorization; retry from a fresh snapshot.', 409);
      const transition = commitPrepared.transition;
  
      return this.store.tx(() => {
        // A concurrent write between the authorized read and this transaction
        // must not let a stale proposal be committed. commitEvent performs the
        // canonical revision/sequence compare-and-swap.
        const replay = this.store.db.prepare(`
          SELECT transition_id, request_hash, event_id, committed_revision
          FROM npc_belief_transitions
          WHERE world_id=? AND idempotency_key=?
        `).get(input.world_id, input.idempotency_key);
        if (replay) {
          assert(replay.request_hash === requestHash, 'IDEMPOTENCY_KEY_REUSED',
            'Belief transition idempotency key was already used for a different request.', 409);
          assert(this.store.world(input.world_id)?.world_revision === input.expected_revision
            && this.store.currentCommitSequence(input.world_id) === input.expected_commit_sequence,
          'STALE_WORLD_SNAPSHOT', 'World changed during belief transition authorization; retry against the current snapshot.', 409);
          return {
            status: 'ready',
            idempotent_replay: true,
            transition: {
              transition_id: replay.transition_id,
              event_id: replay.event_id,
              committed_revision: replay.committed_revision,
            },
          };
        }
        const event = this.commitEvent(input.world_id, {
          event_id: transitionId,
          idempotency_key: input.idempotency_key,
          turn_id: 'npc-belief-transition',
          event_type: 'npc.belief.transitioned',
          expected_revision: input.expected_revision,
          expected_commit_sequence: input.expected_commit_sequence,
          effects: [{
            kind: 'npc.belief.transition',
            transition_id: transitionId,
            actor_id: transition.actor_id,
            purpose: transition.purpose,
            proposition_ref: transition.proposition_ref,
            proposition_value: transition.proposition_value,
            stance: transition.stance,
            supporting_acquisition_ids: [...transition.supporting_acquisition_ids],
            contradicting_acquisition_ids: [...transition.contradicting_acquisition_ids],
            evidence_acquisition_ids: [...transition.evidence_acquisition_ids],
            reason_rule_ref: transition.reason_rule_ref,
            idempotency_key: input.idempotency_key,
            request_hash: requestHash,
            snapshot_revision: transition.snapshot.world_revision,
            snapshot_commit_sequence: transition.snapshot.commit_sequence,
            previous_stance: transition.previous_stance,
            surviving_prior_evidence: [...transition.surviving_prior_evidence],
            invalidated_prior_evidence: [...transition.invalidated_prior_evidence],
            prior_stance_preserved_despite_invalidation: transition.prior_stance_preserved_despite_invalidation,
          }],
        }, { [INTERNAL_CORE_EFFECTS]: true, allowNpcBeliefTransition: true });
        assert(event.idempotent_replay !== true, 'NPC_BELIEF_PROJECTION_MISSING',
          'A committed belief event exists without its Core belief projection; manual reconciliation is required.', 409);
        return {
          status: 'ready',
          idempotent_replay: false,
          transition: {
            ...transition,
            transition_id: transitionId,
            event_id: event.event_id,
            committed_revision: event.world_revision,
          },
        };
      });
    });
  }  /**
   * Read the latest non-rolled-back Core belief and report whether its evidence
   * remains in the current actor-scoped acquisition projection.
   */
  getNpcBeliefState(input) {
    return withNpcAuthorizationLease(this.store, () => {
      const required = [
        'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient', 'purpose',
        'expected_revision', 'expected_commit_sequence', 'proposition_ref',
      ];
      assert(isSafeNpcInputRecord(input) && required.every((key) => Object.hasOwn(input, key)),
        'INVALID_NPC_BELIEF_STATE_REQUEST', 'Belief state request must be a plain data record with all required own fields.');
      const limit = Object.hasOwn(input, 'limit') ? (input.limit ?? 200) : 200;
      const allowed = [
        'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient', 'purpose', 'expected_revision',
        'expected_commit_sequence', 'limit', 'proposition_ref',
      ];
      assert(Object.keys(input).every((key) => allowed.includes(key)),
        'UNSUPPORTED_NPC_BELIEF_STATE_FIELD', 'Belief state request contains an unsupported field.');
      assert(typeof input.proposition_ref === 'string' && input.proposition_ref.trim()
        && input.proposition_ref.length <= 200,
      'INVALID_NPC_BELIEF_STATE_REQUEST', 'proposition_ref must be a non-empty reference of at most 200 characters.');
      const read = this.readNpcKnowledge({
        world_id: input.world_id,
        conversation_id: input.conversation_id,
        adapter_id: input.adapter_id,
        actor_id: input.actor_id,
        recipient: input.recipient,
        purpose: input.purpose,
        expected_revision: input.expected_revision,
        expected_commit_sequence: input.expected_commit_sequence,
        limit: limit,
      });
      assert(read.truncated !== true, 'NPC_KNOWLEDGE_READ_INCOMPLETE',
        'The actor knowledge read exceeded its bounded limit; belief support cannot be reconciled from a partial window.', 409);
      assert(typeof this.npcKnowledgeVisibilityAuthorizer === 'function',
        'NPC_KNOWLEDGE_VISIBILITY_NOT_CONFIGURED',
        'A trusted deployment-owned visibility authorizer is required for belief-state reads.', 403);
      const visibleAcquisitionIds = new Set();
      let propositionWithheld = false;
      for (const item of read.items) {
        if (npcPropositionRefFor(item) !== input.proposition_ref) continue;
        let decision;
        try {
          decision = this.npcKnowledgeVisibilityAuthorizer(Object.freeze({
            world_id: read.world_id,
            conversation_id: read.conversation_id,
            adapter_id: read.adapter_id,
            actor_id: read.actor_id,
            recipient: read.recipient,
            purpose: read.purpose,
            world_revision: read.snapshot.world_revision,
            commit_sequence: read.snapshot.commit_sequence,
            acquisition_id: item.acquisition_id,
            fact_id: item.fact_id,
            subject_ref: item.subject_ref,
            predicate: item.predicate,
            acquisition_kind: item.acquisition_kind,
            acquisition_authorization_ref: item.acquisition_authorization_ref,
            provenance_ref: item.provenance_ref,
            provenance_digest: item.provenance_digest,
          }));
        } catch {
          throw new EngineError('NPC_KNOWLEDGE_VISIBILITY_NOT_AUTHORIZED',
            'The trusted visibility authorizer failed; no belief state was returned.', 403);
        }
        const allowedKeys = [
          'status', 'world_id', 'conversation_id', 'adapter_id', 'actor_id', 'recipient', 'purpose', 'world_revision',
          'commit_sequence', 'acquisition_id', 'authorization_ref',
        ];
        const exactDecision = exactDataRecord(decision, allowedKeys);
        if (!exactDecision || !['allowed', 'denied'].includes(decision.status)
          || decision.world_id !== read.world_id || decision.conversation_id !== read.conversation_id
          || decision.adapter_id !== read.adapter_id
          || decision.actor_id !== read.actor_id || decision.recipient !== read.recipient
          || decision.purpose !== read.purpose
          || decision.world_revision !== read.snapshot.world_revision
          || decision.commit_sequence !== read.snapshot.commit_sequence
          || decision.acquisition_id !== item.acquisition_id
          || typeof decision.authorization_ref !== 'string' || !decision.authorization_ref.trim()) {
          throw new EngineError('NPC_KNOWLEDGE_VISIBILITY_NOT_AUTHORIZED',
            'The visibility decision did not bind to this actor, acquisition, purpose, and snapshot.', 403);
        }
        if (decision.status === 'denied') propositionWithheld = true;
        else visibleAcquisitionIds.add(item.acquisition_id);
      }
  
      // Visibility callbacks can race a canonical commit/revocation after the raw
      // read's own cursor check. Revalidate before returning either unavailable
      // or ready so the belief response is bound to the same current snapshot.
      // Keep revision and event sequence from one read transaction. Rollback
      // advances world_revision without advancing commit_sequence, so separate
      // reads can accidentally combine values from opposite sides of a rollback.
      let snapshotNow;
      try { snapshotNow = this.getSnapshot(input.world_id); } catch { snapshotNow = null; }
      assert(snapshotNow && snapshotNow.status === 'active'
        && snapshotNow.world_revision === read.snapshot.world_revision
        && snapshotNow.commit_sequence === read.snapshot.commit_sequence,
      'NPC_KNOWLEDGE_READ_NOT_READY',
      'World snapshot changed while reconciling NPC belief state; retry from a fresh snapshot.', 409);
  
      // Check visibility before querying belief history. Otherwise, unknown vs.
      // unavailable could reveal whether a hidden proposition has a stored belief.
      if (propositionWithheld) {
        return Object.freeze({ status: 'unavailable', actor_id: input.actor_id, proposition_ref: input.proposition_ref });
      }
      const row = this.store.db.prepare(`
        SELECT b.transition_id, b.proposition_ref, b.proposition_value_json, b.stance,
          b.supporting_acquisition_ids_json, b.contradicting_acquisition_ids_json,
          b.evidence_acquisition_ids_json, b.reason_rule_ref, b.snapshot_revision,
          b.snapshot_commit_sequence, b.event_id, b.committed_revision
        FROM npc_belief_transitions AS b
        JOIN world_events AS e ON e.world_id=b.world_id AND e.event_id=b.event_id
        WHERE b.world_id=? AND b.actor_id=? AND b.proposition_ref=? AND e.validity='valid'
        ORDER BY e.commit_sequence DESC LIMIT 1
      `).get(input.world_id, input.actor_id, input.proposition_ref);
      if (!row) return Object.freeze({ status: 'unknown', actor_id: input.actor_id, proposition_ref: input.proposition_ref });
      const evidence = JSON.parse(row.evidence_acquisition_ids_json);
      const surviving = evidence.filter((ref) => visibleAcquisitionIds.has(ref));
      return Object.freeze({
        status: 'ready',
        actor_id: input.actor_id,
        proposition_ref: row.proposition_ref,
        ...(surviving.length > 0 ? { proposition_value: JSON.parse(row.proposition_value_json) } : {}),
        stance: row.stance,
        evidence_status: surviving.length === evidence.length ? 'supported'
          : surviving.length > 0 ? 'partially_supported' : 'unsupported',
        evidence_acquisition_ids: Object.freeze(surviving),
        surviving_evidence_acquisition_ids: Object.freeze(surviving),
        reason_rule_ref: row.reason_rule_ref,
        snapshot: Object.freeze({
          world_revision: read.snapshot.world_revision,
          commit_sequence: read.snapshot.commit_sequence,
        }),
        transition_id: row.transition_id,
        event_id: row.event_id,
        committed_revision: row.committed_revision,
      });
    });
  }  /**
   * Loads an imported source only from a deployment-owned, allowlisted local file.
   * Callers provide a source_ref, never a path or bytes. This method is not exposed
   * through the HTTP API.
   */
  recordTrustedImportedKnowledgeSource(input) {
    assert(obj(input), 'INVALID_TRUSTED_SOURCE_REQUEST', 'Imported source request must be an object.');
    const allowed = ['world_id', 'source_ref', 'idempotency_key', 'expected_revision', 'expected_commit_sequence', 'turn_id'];
    assert(Object.keys(input).every((key) => allowed.includes(key)), 'UNSUPPORTED_TRUSTED_SOURCE_REQUEST_FIELD', 'Imported source request contains an unsupported field.');
    assert(typeof input.world_id === 'string' && input.world_id.trim() === input.world_id && input.world_id.length > 0 && input.world_id.length <= 200,
      'INVALID_TRUSTED_SOURCE_REQUEST', 'world_id must be a canonical non-empty identifier.');
    assert(typeof input.source_ref === 'string' && input.source_ref.trim() === input.source_ref && input.source_ref.length > 0 && input.source_ref.length <= 200,
      'INVALID_TRUSTED_SOURCE_REQUEST', 'source_ref must be a canonical non-empty identifier.');
    const world = this.store.world(input.world_id);
    assert(world, 'WORLD_NOT_FOUND', 'World not found.', 404);
    const candidates = this.trustedInitialKnowledgeSources.filter((entry) =>
      entry && entry.source_kind === 'imported'
      && entry.source_ref === input.source_ref
      && entry.world_pack_id === world.world_pack_id
      && entry.world_pack_version === world.world_pack_version
      && typeof entry.source_path === 'string' && isAbsolute(entry.source_path));
    assert(candidates.length === 1, 'TRUSTED_IMPORT_SOURCE_NOT_CONFIGURED',
      'Exactly one deployment-approved imported source file must match this source_ref and world pack.', 403);
    const configured = candidates[0];
    let sourceBytes;
    let fd;
    let identityFd;
    try {
      // POSIX platforms enforce no-follow atomically at open. Windows does not
      // expose O_NOFOLLOW through Node, so validate the path before and after
      // opening and compare the opened handle identity with both path snapshots.
      const noFollow = fsConstants.O_NOFOLLOW;
      let pathBefore;
      let resolvedBefore;
      if (!Number.isInteger(noFollow) || noFollow === 0) {
        pathBefore = lstatSync(configured.source_path, { bigint: true });
        resolvedBefore = realpathSync(configured.source_path);
        assert(pathBefore.isFile() && !pathBefore.isSymbolicLink()
          && sameTrustedImportPath(resolvedBefore, configured.source_path),
        'TRUSTED_IMPORT_FILE_UNAVAILABLE', 'Trusted import path must resolve directly to a regular, non-link file.', 503);
      }
      fd = openSync(configured.source_path, fsConstants.O_RDONLY | (Number.isInteger(noFollow) && noFollow !== 0 ? noFollow : 0));
      const stat = fstatSync(fd, { bigint: true });
      assert(stat.isFile() && stat.size > 0 && stat.size <= MAX_TRUSTED_IMPORT_BYTES,
        'INVALID_TRUSTED_IMPORT_FILE', 'Trusted import must be a regular file within the 1 MiB limit.');
      if (pathBefore) {
        const pathAfter = lstatSync(configured.source_path, { bigint: true });
        const resolvedAfter = realpathSync(configured.source_path);
        identityFd = openSync(configured.source_path, fsConstants.O_RDONLY);
        const identityStat = fstatSync(identityFd, { bigint: true });
        const pathFinal = lstatSync(configured.source_path, { bigint: true });
        const resolvedFinal = realpathSync(configured.source_path);
        assert(pathAfter.isFile() && !pathAfter.isSymbolicLink()
          && pathFinal.isFile() && !pathFinal.isSymbolicLink()
          && sameTrustedImportPath(resolvedBefore, resolvedAfter)
          && sameTrustedImportPath(resolvedBefore, resolvedFinal)
          && stat.ino === pathBefore.ino && stat.ino === pathAfter.ino
          && stat.ino === pathFinal.ino
          && stat.dev === identityStat.dev && stat.ino === identityStat.ino,
        'TRUSTED_IMPORT_FILE_UNAVAILABLE', 'Trusted import path changed while it was being opened.', 503);
      }
      sourceBytes = readFileSync(fd);
      assert(sourceBytes.length > 0 && sourceBytes.length <= MAX_TRUSTED_IMPORT_BYTES,
        'INVALID_TRUSTED_IMPORT_FILE', 'Trusted import bytes must remain within the 1 MiB limit when read.');
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError('TRUSTED_IMPORT_FILE_UNAVAILABLE', 'Deployment-approved import file could not be read safely.', 503);
    } finally {
      if (identityFd !== undefined) {
        try { closeSync(identityFd); } catch { /* preserve the original read result */ }
      }
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* preserve the original read result */ }
      }
    }
    const validatedSource = validateTrustedInitialKnowledgeSource(sourceBytes, this.trustedInitialKnowledgeSources);
    assert(validatedSource.source_kind === configured.source_kind
      && validatedSource.source_ref === configured.source_ref
      && validatedSource.world_pack_id === configured.world_pack_id
      && validatedSource.world_pack_version === configured.world_pack_version
      && validatedSource.authorization_ref === configured.authorization_ref
      && validatedSource.source_digest === configured.sha256,
    'UNSUPPORTED_TRUSTED_SOURCE_KIND', 'Imported file content must match the selected registry entry exactly.', 403);
    return this.recordTrustedInitialKnowledgeSource({
      world_id: input.world_id,
      source_bytes: sourceBytes,
      idempotency_key: input.idempotency_key,
      expected_revision: input.expected_revision,
      expected_commit_sequence: input.expected_commit_sequence,
      ...(input.turn_id === undefined ? {} : { turn_id: input.turn_id }),
    }, TRUSTED_IMPORT_CAPABILITY);
  }

  /**
   * Ingests an immutable deployment-approved source into the canonical event log.
   * This method is intentionally not exposed by the HTTP API.
   */
  recordTrustedInitialKnowledgeSource(input, importCapability = null) {
    assert(obj(input), 'INVALID_TRUSTED_SOURCE_REQUEST', 'Source ingestion request must be an object.');
    const allowed = ['world_id', 'source_bytes', 'idempotency_key', 'expected_revision', 'expected_commit_sequence', 'turn_id'];
    assert(Object.keys(input).every((key) => allowed.includes(key)), 'UNSUPPORTED_TRUSTED_SOURCE_REQUEST_FIELD', 'Source ingestion request contains an unsupported field.');
    for (const key of ['world_id', 'idempotency_key']) {
      assert(typeof input[key] === 'string' && input[key].trim() === input[key] && input[key].length > 0 && input[key].length <= 200,
        'INVALID_TRUSTED_SOURCE_REQUEST', key + ' must be a canonical non-empty identifier.');
    }
    assert(Number.isSafeInteger(input.expected_revision) && input.expected_revision >= 0,
      'INVALID_REVISION', 'expected_revision is required.');
    assert(Number.isSafeInteger(input.expected_commit_sequence) && input.expected_commit_sequence >= 0,
      'INVALID_COMMIT_SEQUENCE', 'expected_commit_sequence is required.');

    const source = validateTrustedInitialKnowledgeSource(input.source_bytes, this.trustedInitialKnowledgeSources);
    assert(source.source_kind === 'author_initial'
      || (source.source_kind === 'imported' && importCapability === TRUSTED_IMPORT_CAPABILITY),
    'UNSUPPORTED_TRUSTED_SOURCE_KIND',
    'Imported sources must be loaded through the deployment-owned trusted file importer.', 403);
    const world = this.store.world(input.world_id);
    assert(world, 'WORLD_NOT_FOUND', 'World not found.', 404);
    assert(world.world_pack_id === source.world_pack_id && world.world_pack_version === source.world_pack_version,
      'TRUSTED_SOURCE_WORLD_PACK_MISMATCH', 'Approved source identity does not match the target world pack.', 409);
    // Let the canonical commit boundary check idempotent replay before cursor
    // freshness. This preserves safe retries after a successful ingestion.

    const assignments = [];
    const sourceEventIds = new Set();
    const readSet = new Set();
    const dependsOn = new Set();
    const causalLinkKeys = new Set();
    const causalLinks = [];
    for (const assignment of source.assignments) {
      const subject = this.store.db.prepare('SELECT entity_id,status FROM entities WHERE world_id=? AND entity_id=?')
        .get(input.world_id, assignment.subject_id);
      assert(subject && subject.status !== 'destroyed', 'ACQUISITION_SUBJECT_NOT_ELIGIBLE',
        'Every assigned subject must be an existing non-destroyed entity in the target world.', 409);
      const fact = this.store.db.prepare('SELECT status,subject_ref,predicate,value_json,source_event_ids_json FROM facts WHERE world_id=? AND fact_id=?')
        .get(input.world_id, assignment.fact_id);
      assert(fact && fact.status === 'active', 'ACQUISITION_SOURCE_NOT_ELIGIBLE',
        'Every assigned item must be an active canonical fact in the target world.', 409);
      const factSources = JSON.parse(fact.source_event_ids_json);
      assert(Array.isArray(factSources) && factSources.length > 0
        && factSources.every((eventId) => typeof eventId === 'string' && eventId.trim()),
      'ACQUISITION_SOURCE_NOT_ELIGIBLE', 'Every assigned fact must have explicit valid canonical source-event identities.', 409);
      for (const eventId of factSources) sourceEventIds.add(eventId);
      const entityRef = 'entity:' + assignment.subject_id;
      const factRef = 'fact:' + assignment.fact_id;
      readSet.add(entityRef); readSet.add(factRef); dependsOn.add(entityRef); dependsOn.add(factRef);
      for (const link of [
        { relation: 'READS_ENTITY', target_id: assignment.subject_id },
        { relation: 'READS_CLAIM', target_id: assignment.fact_id },
      ]) {
        const key = JSON.stringify(link);
        if (!causalLinkKeys.has(key)) { causalLinkKeys.add(key); causalLinks.push(link); }
      }
      const acquiredValue = JSON.parse(fact.value_json);
      const acquiredSourceEventIds = [...factSources].sort();
      assignments.push({
        kind: 'knowledge.acquire',
        // The acquisition identity pins the actual canonical value and its
        // exact supporting event set, not only the authoring source document.
        // The same approved document may be applied after a fact ID is replaced
        // by a different canonical claim.
        acquisition_id: 'acq:' + hashRequest([
          input.world_id, assignment.subject_id, assignment.fact_id, source.source_kind,
          source.source_ref, source.source_digest, source.authorization_ref,
          acquiredValue, acquiredSourceEventIds,
        ]),
        subject_id: assignment.subject_id,
        fact_id: assignment.fact_id,
        acquisition_kind: source.source_kind,
        provenance_ref: source.source_ref,
        provenance_digest: source.source_digest,
        authorization_ref: source.authorization_ref,
        acquired_value: acquiredValue,
        acquired_source_event_ids: acquiredSourceEventIds,
      });
    }
    assert(sourceEventIds.size <= 500, 'TRUSTED_SOURCE_TOO_MANY_SUPPORT_EVENTS',
      'The source assignments resolve to too many supporting events for one bounded Core event.', 400);
    assert(assignments.length <= 200 && causalLinks.length <= 500, 'TRUSTED_SOURCE_TOO_LARGE',
      'Source assignments exceed the bounded Core event capacity.', 400);

    return this.commitEvent(input.world_id, {
      idempotency_key: input.idempotency_key,
      turn_id: input.turn_id || 'core-trusted-initial-source',
      event_type: 'knowledge.acquisition.initial',
      expected_revision: input.expected_revision,
      expected_commit_sequence: input.expected_commit_sequence,
      time_advance_seconds: 0,
      caused_by: [...sourceEventIds].sort(),
      depends_on: [...dependsOn].sort(),
      read_set: [...readSet].sort(),
      causal_links: causalLinks,
      effects: assignments,
    }, { [INTERNAL_CORE_EFFECTS]: true, allowKnowledgeAcquisition: true });
  }

  commitEvent(id, x, options = {}) {
    const prepared = this.prepareEventForWorld(id, x, options);
    if (options.mechanicExecution !== undefined && options.mechanicExecution !== null) {
      const metadata = options.mechanicExecution;
      assert(obj(metadata) && obj(metadata.snapshot_identity)
        && metadata.snapshot_identity.world_id === id
        && metadata.snapshot_identity.world_revision === prepared.expected_revision
        && metadata.snapshot_identity.commit_sequence === this.store.currentCommitSequence(id),
      'STALE_MECHANIC_EVALUATION', 'Mechanic execution metadata must match the current world snapshot.');
      assert(typeof metadata.action_id === 'string' && metadata.action_id.trim()
        && obj(metadata.condition_result) && metadata.condition_result.status === 'true'
        && typeof metadata.context_fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(metadata.context_fingerprint)
        && typeof metadata.context_policy_version === 'string' && metadata.context_policy_version.trim()
        && typeof metadata.authorization_scope === 'string' && metadata.authorization_scope.trim()
        && isMechanicPolicyAuthoritySnapshot(metadata.policy_authority)
        && typeof metadata.evaluation_fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(metadata.evaluation_fingerprint),
      'INVALID_MECHANIC_EXECUTION_METADATA', 'Mechanic execution identity and fingerprints are required.');
      assert(obj(metadata.dependency_manifest)
        && metadata.dependency_manifest.scope === 'bounded_deterministic_action_v1'
        && metadata.dependency_manifest.mechanic_dependencies_complete === true
        && metadata.dependency_manifest.global_mechanic_dependencies_complete === false
        && Array.isArray(metadata.dependency_manifest.assumptions)
        && Array.isArray(metadata.dependency_manifest.unresolved_sources)
        && metadata.dependency_manifest.unresolved_sources.length === 0
        && metadata.semantic_review_required === true,
      'INVALID_MECHANIC_EXECUTION_METADATA', 'Mechanic dependency scope and semantic-review requirement are invalid.');
      assert(Array.isArray(metadata.effect_provenance)
        && metadata.effect_provenance.length === (x.effects ?? []).length
        && Array.isArray(metadata.read_set) && Array.isArray(metadata.causal_links)
        && hashRequest(metadata.read_set) === hashRequest(x.read_set ?? [])
        && hashRequest(metadata.causal_links) === hashRequest(x.causal_links ?? []),
      'INVALID_MECHANIC_EXECUTION_METADATA', 'Mechanic provenance, read_set, and causal_links must match the event.');
      const translatedKinds = { create_entity: 'entity.create', update_attribute: 'entity.update', assert_fact: 'fact.set' };
      const seenEffectIds = new Set();
      for (let index = 0; index < metadata.effect_provenance.length; index += 1) {
        const item = metadata.effect_provenance[index];
        assert(obj(item) && item.effect_index === index && item.action_id === metadata.action_id
          && typeof item.effect_id === 'string' && item.effect_id.trim() && !seenEffectIds.has(item.effect_id)
          && translatedKinds[item.intent_kind] === x.effects[index]?.kind,
        'INVALID_MECHANIC_EXECUTION_METADATA', 'Mechanic effect provenance must map one-to-one to event effects.');
        seenEffectIds.add(item.effect_id);
      }
      const expectedEvaluationFingerprint = hashRequest({
        snapshot_identity: metadata.snapshot_identity,
        action_id: metadata.action_id,
        context_fingerprint: metadata.context_fingerprint,
        context_policy_version: metadata.context_policy_version,
        authorization_scope: metadata.authorization_scope,
        policy_authority: metadata.policy_authority,
        condition_result: metadata.condition_result,
        dependency_manifest: metadata.dependency_manifest,
        effects: x.effects,
        effect_provenance: metadata.effect_provenance,
        read_set: x.read_set,
        causal_links: x.causal_links,
      });
      assert(expectedEvaluationFingerprint === metadata.evaluation_fingerprint,
        'INVALID_MECHANIC_EXECUTION_METADATA', 'Committed mechanic metadata does not match the evaluated content.');
      prepared.mechanic_execution = metadata;
      prepared.request_hash = hashRequest({
        event_request_hash: prepared.request_hash,
        mechanic_execution: metadata,
      });
    }
    this.assertNoScheduledTriggerCrossing(id, [prepared], prepared.expected_revision);
    return this.store.commit(id, prepared);
  }

  commitSegment(id, x, options = {}) {
    assert(obj(x), 'INVALID_SEGMENT_BODY', 'Segment request must be an object.');
    const allowed = ['idempotency_key', 'expected_revision', 'expected_commit_sequence', 'events'];
    assert(Object.keys(x).every((key) => allowed.includes(key)), 'UNSUPPORTED_SEGMENT_FIELD', 'Segment request contains an unsupported field.');
    assert(typeof x.idempotency_key === 'string' && x.idempotency_key.trim() && x.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'Segment idempotency_key is required.');
    assert(Number.isSafeInteger(x.expected_revision) && x.expected_revision >= 0, 'INVALID_REVISION', 'Segment expected_revision must be a non-negative safe integer.');
    if (x.expected_commit_sequence !== undefined) {
      assert(Number.isSafeInteger(x.expected_commit_sequence) && x.expected_commit_sequence >= 0, 'INVALID_COMMIT_SEQUENCE', 'Segment expected_commit_sequence must be a non-negative safe integer.');
    }
    assert(Array.isArray(x.events) && x.events.length >= 1 && x.events.length <= 32, 'INVALID_SEGMENT_SIZE', 'A segment must contain between 1 and 32 events.');

    const preparedEvents = x.events.map((event) => {
      assert(obj(event), 'INVALID_SEGMENT_EVENT', 'Every segment event must be an object.');
      assert(event.expected_revision === undefined && event.expected_commit_sequence === undefined,
        'INVALID_SEGMENT_EVENT_CURSOR', 'Per-event revision/cursor fields are not allowed; the segment owns its base cursor.');
      const prepared = this.prepareEventForWorld(id, event, options);
      assert(typeof prepared.event_id === 'string' && prepared.event_id.trim(), 'SEGMENT_EVENT_ID_REQUIRED', 'Every segment event must have an explicit event_id.');
      assert(!['entity:', 'fact:', 'relationship:', 'mechanic:'].some((prefix) => prepared.event_id.startsWith(prefix)), 'INVALID_EVENT_ID', 'Segment event IDs cannot use reserved projection reference prefixes.');
      return prepared;
    });
    const ids = preparedEvents.map((event) => event.event_id);
    const keys = preparedEvents.map((event) => event.idempotency_key);
    assert(new Set(ids).size === ids.length, 'DUPLICATE_SEGMENT_EVENT_ID', 'Segment event IDs must be unique.');
    assert(new Set(keys).size === keys.length, 'DUPLICATE_SEGMENT_EVENT_KEY', 'Segment event idempotency keys must be unique.');
    validateIndependentSegment(preparedEvents);
    this.assertNoScheduledTriggerCrossing(id, preparedEvents, x.expected_revision);

    const requestHash = hashRequest({
      operation: 'event.segment.commit',
      world_id: id,
      expected_revision: x.expected_revision,
      expected_commit_sequence: x.expected_commit_sequence ?? null,
      events: preparedEvents.map(({ request_hash, idempotency_key, ...event }) => ({ ...event, request_hash, idempotency_key })),
    });
    return this.store.commitSegment(
      id,
      preparedEvents,
      x.idempotency_key.trim(),
      requestHash,
      x.expected_revision,
      x.expected_commit_sequence ?? null,
    );
  }

  registerTimeTrigger(id, input) {
    assert(obj(input), 'INVALID_TIME_TRIGGER', 'Time-trigger registration must be an object.');
    const allowed = ['trigger_id', 'due_coordinate', 'dependencies', 'read_set', 'write_set', 'processing_mode', 'interrupt_after_coordinate', 'payload'];
    assert(Object.keys(input).every((key) => allowed.includes(key)),
      'UNSUPPORTED_TIME_TRIGGER_FIELD', 'Time-trigger registration contains an unsupported field.');
    this.getState(id);
    let trigger;
    try {
      trigger = normalizeTimeTrigger({ ...input, world_id: id, status: 'pending' }, id);
    } catch (error) {
      throw new EngineError(error.code || 'INVALID_TIME_TRIGGER', error.message || 'Time-trigger validation failed.', 400, error.details);
    }
    assert(trigger.due_coordinate % 1000 === 0,
      'TIME_TRIGGER_SUBSECOND_UNSUPPORTED', 'Time-trigger execution currently requires whole-second coordinates.', 400);
    const proposal = trigger.payload?.event;
    assert(obj(proposal), 'TRIGGER_EVENT_PROPOSAL_REQUIRED', 'A persisted time trigger payload must contain an event proposal.');
    assert(proposal.event_type !== 'time.advance',
      'INVALID_TRIGGER_EVENT_TYPE', 'A scheduled trigger cannot itself be a canonical time-advance event.');
    const payloadBytes = Buffer.byteLength(JSON.stringify(trigger.payload), 'utf8');
    assert(payloadBytes <= 262144, 'TIME_TRIGGER_PAYLOAD_TOO_LARGE', 'A persisted time trigger payload cannot exceed 256 KiB.', 400);
    assert(proposal.expected_revision === undefined && proposal.expected_commit_sequence === undefined,
      'INVALID_TRIGGER_EVENT_CURSOR', 'A persisted trigger cannot choose its own revision or commit cursor.');
    assert(proposal.duration_proposal === undefined || proposal.duration_proposal === null,
      'INVALID_TRIGGER_DURATION_PROPOSAL', 'A scheduled trigger effect cannot include an action-duration proposal.');
    assert(proposal.time_mode === undefined || proposal.time_mode === 'action',
      'INVALID_TRIGGER_TIME_MODE', 'A scheduled trigger effect cannot request an explicit time skip.');
    assert(proposal.time_advance_seconds === undefined || proposal.time_advance_seconds === 0,
      'INVALID_TRIGGER_EVENT_DURATION', 'Scheduled trigger effects must execute at their due coordinate with zero additional duration.');
    const identity = hashRequest({ world_id: id, trigger_id: trigger.trigger_id }).slice(0, 32);
    const event = {
      ...proposal,
      event_id: 'time-trigger-' + identity,
      idempotency_key: 'time-trigger:' + identity,
      turn_id: proposal.turn_id ?? ('time-trigger-turn:' + identity),
      time_advance_seconds: 0,
      time_mode: 'action',
    };
    let preparedEvent;
    try {
      preparedEvent = this.prepareEventForWorld(id, event);
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError(error.code || 'INVALID_TRIGGER_EVENT_PROPOSAL', error.message || 'Trigger event proposal validation failed.', 400);
    }
    const effectWrites = preparedEvent.effects.map((effect) => effect.kind === 'relationship.transition'
      ? 'relationship:' + encodeURIComponent(effect.subject_id) + '/' + encodeURIComponent(effect.target_id)
      : effect.kind.startsWith('entity.') ? 'entity:' + effect.entity_id
        : effect.kind.startsWith('mechanic.instance.') ? 'mechanic:' + effect.instance_id
          : 'fact:' + effect.fact_id);
    trigger.read_set = [...new Set([...trigger.read_set, ...preparedEvent.read_set])].sort();
    trigger.write_set = [...new Set([...trigger.write_set, ...effectWrites])].sort();
    try {
      trigger = normalizeTimeTrigger(trigger, id);
    } catch (error) {
      throw new EngineError(error.code || 'INVALID_TIME_TRIGGER', error.message || 'Time-trigger conflict declarations are invalid.', 400, error.details);
    }
    trigger.payload = { ...trigger.payload, event };
    const content_hash = hashRequest({
      world_id: id,
      trigger_id: trigger.trigger_id,
      due_coordinate: trigger.due_coordinate,
      dependencies: trigger.dependencies,
      read_set: trigger.read_set,
      write_set: trigger.write_set,
      processing_mode: trigger.processing_mode,
      interrupt_after_coordinate: trigger.interrupt_after_coordinate,
      payload: trigger.payload,
    });
    return this.store.registerTimeTrigger(id, { ...trigger, content_hash });
  }

  listTimeTriggers(id) {
    return this.store.listTimeTriggers(id);
  }

  getTimeTrigger(id, triggerId) {
    return this.store.getTimeTrigger(id, triggerId);
  }

  cancelTimeTrigger(id, triggerId, reason = 'author_cancelled', options = {}) {
    assert(typeof reason === 'string' && reason.trim() && reason.length <= 200,
      'INVALID_TIME_TRIGGER_CANCELLATION', 'reason must be a non-empty string of at most 200 characters.');
    const owner = this.processStore.findMilestoneByTrigger(id, triggerId);
    if (owner && options.processLifecycle !== true) {
      throw new EngineError('PROCESS_TRIGGER_LIFECYCLE_OWNED', 'A process milestone trigger can only be cancelled through its owning process lifecycle.', 409, {
        process_id: owner.process_id, milestone_id: owner.milestone_id,
      });
    }
    return this.store.cancelTimeTrigger(id, triggerId, reason.trim());
  }

  startTimeAdvance(id, x) {
    return this._startTimeAdvance(id, x, null, null);
  }

  startTimedAction(id, x) {
    assert(obj(x), 'INVALID_TIME_ACTION', 'Timed action request must be an object.');
    assert(Object.keys(x).every((key) => ['idempotency_key', 'expected_revision', 'event'].includes(key)),
      'UNSUPPORTED_TIME_ACTION_FIELD', 'Timed action request accepts only idempotency_key, expected_revision, and event.');
    assert(typeof x.idempotency_key === 'string' && x.idempotency_key.trim() && x.idempotency_key.length <= 200,
      'IDEMPOTENCY_KEY_REQUIRED', 'Timed action idempotency_key is required.');
    assert(Number.isSafeInteger(x.expected_revision) && x.expected_revision >= 0,
      'INVALID_REVISION', 'Timed action expected_revision must be a non-negative safe integer.');
    assert(obj(x.event), 'INVALID_TIME_ACTION_EVENT', 'Timed action event must be an object.');
    assert(x.event.event_type !== 'time.advance', 'INVALID_TIME_ACTION_EVENT_TYPE',
      'Timed actions cannot submit the Core-owned time.advance event type.');
    const eventAllowed = ['turn_id', 'event_type', 'generation_id', 'context_manifest_id', 'source_message_id',
      'duration_proposal', 'caused_by', 'depends_on', 'read_set', 'causal_links', 'effects'];
    assert(Object.keys(x.event).every((key) => eventAllowed.includes(key)),
      'INVALID_TIME_ACTION_EVENT', 'Timed action event contains an unsupported field or caller-controlled time/identity.');
    const key = x.idempotency_key.trim();
    const actionRequestHash = hashRequest({
      operation: 'time.action',
      world_id: id,
      idempotency_key: key,
      expected_revision: x.expected_revision,
      event: x.event,
    });
    const existing = this.store.getTimeAdvanceOperationByKey(id, key);
    if (existing) {
      if (existing.plan?.action_request_hash !== actionRequestHash) {
        throw new EngineError('IDEMPOTENCY_CONFLICT', 'The time-action idempotency key was already used with a different request.', 409);
      }
      return existing.status === 'running'
        ? this.store.resumeTimeAdvanceOperation(id, existing.operation_id)
        : existing;
    }

    const world = this.getState(id);
    if (world.world_revision !== x.expected_revision) {
      throw new EngineError('REVISION_CONFLICT', 'World changed before timed-action planning.', 409, {
        expected_revision: x.expected_revision, current_revision: world.world_revision,
      });
    }
    const configuration = this.store.getTimeConfiguration(id);
    if (!configuration) {
      throw new EngineError('TIME_CONFIG_REQUIRED', 'Timed actions require an active versioned world TimePolicy.', 409);
    }
    const identity = hashRequest({ world_id: id, idempotency_key: key }).slice(0, 40);
    const event = {
      ...x.event,
      event_id: 'time-action-' + identity.slice(0, 32),
      idempotency_key: 'time-action-key:' + identity,
      turn_id: x.event.turn_id ?? ('time-action-turn:' + identity),
      time_mode: 'action',
    };
    let prepared;
    try {
      prepared = this.prepareEventForWorld(id, event);
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError(error.code || 'INVALID_TIME_ACTION_EVENT', error.message || 'Timed action validation failed.', 400, error.details);
    }
    const durationMs = prepared.time_advance_seconds * 1000;
    assert(Number.isSafeInteger(durationMs) && durationMs >= 0, 'INVALID_TIME_ACTION_DURATION',
      'Resolved action duration must be a non-negative safe integer number of milliseconds.');
    let targetCoordinate;
    try {
      targetCoordinate = addTimeDuration(world.game_time_coordinate, durationMs);
    } catch (error) {
      const code = error.code === 'COORDINATE_OVERFLOW' ? 'TIME_COORDINATE_OVERFLOW' : (error.code || 'INVALID_TIME_COORDINATE');
      throw new EngineError(code, error.message || 'Timed action target is outside the coordinate range.', 400);
    }
    const finalEvent = {
      event: {
        ...event,
        time_advance_seconds: 0,
      },
      duration_decision: prepared.duration_decision,
    };
    return this._startTimeAdvance(id, {
      idempotency_key: key,
      expected_revision: x.expected_revision,
      to_coordinate: targetCoordinate,
      trigger_source: 'registered',
    }, finalEvent, actionRequestHash);
  }

  _startTimeAdvance(id, x, finalEventEnvelope = null, actionRequestHash = null) {
    assert(obj(x), 'INVALID_TIME_ADVANCE_OPERATION', 'Time-advance request must be an object.');
    const allowed = ['idempotency_key', 'expected_revision', 'to_coordinate', 'trigger_source', 'triggers', 'completed_trigger_ids'];
    assert(Object.keys(x).every((key) => allowed.includes(key)), 'UNSUPPORTED_TIME_ADVANCE_FIELD', 'Time-advance request contains an unsupported field.');
    assert(typeof x.idempotency_key === 'string' && x.idempotency_key.trim() && x.idempotency_key.length <= 200,
      'IDEMPOTENCY_KEY_REQUIRED', 'Time-advance idempotency_key is required.');
    assert(Number.isSafeInteger(x.expected_revision) && x.expected_revision >= 0,
      'INVALID_REVISION', 'Time-advance expected_revision must be a non-negative safe integer.');
    assert(Number.isSafeInteger(x.to_coordinate), 'INVALID_TIME_COORDINATE', 'to_coordinate must be a safe integer.');
    const triggerSource = x.trigger_source ?? (x.triggers === undefined ? 'registered' : 'request');
    assert(['registered', 'request'].includes(triggerSource), 'INVALID_TIME_TRIGGER_SOURCE', 'trigger_source must be registered or request.');
    if (triggerSource === 'registered') {
      assert(x.triggers === undefined && x.completed_trigger_ids === undefined,
        'MIXED_TIME_TRIGGER_SOURCE', 'Registered trigger mode cannot also accept a caller-supplied trigger set.');
    } else {
      assert(x.completed_trigger_ids === undefined || Array.isArray(x.completed_trigger_ids),
        'INVALID_COMPLETED_TRIGGER_IDS', 'completed_trigger_ids must be an array.');
    }
    const requestHash = hashRequest({
      operation: 'time.advance',
      world_id: id,
      idempotency_key: x.idempotency_key.trim(),
      expected_revision: x.expected_revision,
      to_coordinate: x.to_coordinate,
      trigger_source: triggerSource,
      triggers: triggerSource === 'request' ? (x.triggers ?? []) : null,
      completed_trigger_ids: triggerSource === 'request' ? (x.completed_trigger_ids ?? []) : [],
      ...(finalEventEnvelope ? { final_event: finalEventEnvelope, action_request_hash: actionRequestHash } : {}),
    });
    const existing = this.store.getTimeAdvanceOperationByKey(id, x.idempotency_key.trim());
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new EngineError('IDEMPOTENCY_CONFLICT', 'The time-advance idempotency key was already used with a different request.', 409);
      }
      return existing.status === 'running'
        ? this.store.resumeTimeAdvanceOperation(id, existing.operation_id)
        : existing;
    }
    const world = this.getState(id);
    if (world.world_revision !== x.expected_revision) {
      throw new EngineError('REVISION_CONFLICT', 'World changed before time-advance planning.', 409, {
        expected_revision: x.expected_revision, current_revision: world.world_revision,
      });
    }
    const from = world.game_time_coordinate;
    const requestedAdvanceMs = x.to_coordinate - from;
    if (!Number.isSafeInteger(requestedAdvanceMs) || requestedAdvanceMs < 0) {
      throw new EngineError('INVALID_TIME_INTERVAL', 'to_coordinate must not precede the current world coordinate and the interval must be a safe integer.', 400);
    }
    const activeTimeConfig = this.store.getTimeConfiguration(id);
    const maxSkipMs = activeTimeConfig
      ? activeTimeConfig.time_policy.max_skip_duration_ms
      : 604800000;
    // The world policy bounds the whole operation. Individual synthetic events
    // remain capped at seven days for bounded event execution.
    const segmentSkipMs = Math.min(maxSkipMs, 604800000);
    if (requestedAdvanceMs > maxSkipMs) {
      throw new EngineError('TIME_ADVANCE_TOO_LARGE', 'Requested time-advance interval exceeds the active world skip limit.', 400, {
        requested_duration_ms: requestedAdvanceMs,
        maximum_duration_ms: maxSkipMs,
      });
    }
    if (from % 1000 !== 0 || x.to_coordinate % 1000 !== 0) {
      throw new EngineError('TIME_ADVANCE_SUBSECOND_UNSUPPORTED', 'Time-advance execution currently requires whole-second boundaries.', 400);
    }
    let plan;
    let triggerSnapshot = [];
    let completedTriggerSnapshot = [];
    try {
      const isReviewGatedProcessTrigger = (trigger) => {
        const milestone = this.processStore.findMilestoneByTrigger(id, trigger.trigger_id);
        if (!milestone) return false;
        if (milestone.status === 'needs_review') return true;
        const process = this.processStore.get(id, milestone.process_id);
        return process.stored_status === 'needs_review';
      };
      const allRegisteredTriggers = this.store.listTimeTriggers(id, true);
      const reviewGatedDue = allRegisteredTriggers.filter((trigger) =>
        trigger.status === 'pending'
        && trigger.due_coordinate <= x.to_coordinate
        && isReviewGatedProcessTrigger(trigger));
      if (reviewGatedDue.length) {
        throw new EngineError('TIME_TRIGGER_PROCESS_NEEDS_REVIEW',
          'Time advancement cannot cross pending triggers owned by a process that requires reconciliation.',
          409, { trigger_ids: reviewGatedDue.map((trigger) => trigger.trigger_id), target_coordinate: x.to_coordinate });
      }
      if (triggerSource === 'registered') {
        // A pending trigger owned by a process under reconciliation is not eligible
        // for replay; advancement stops before its due coordinate until explicit repair.
        triggerSnapshot = allRegisteredTriggers.filter((trigger) => !isReviewGatedProcessTrigger(trigger));
        const overdue = triggerSnapshot
          .filter((trigger) => trigger.status === 'pending' && trigger.due_coordinate <= from)
          .map((trigger) => trigger.trigger_id);
        if (overdue.length) {
          throw new EngineError('TIME_TRIGGER_OVERDUE_NEEDS_REVIEW', 'One or more pending triggers are at or before the current coordinate and require explicit reconciliation.', 409, {
            trigger_ids: overdue,
            current_coordinate: from,
          });
        }
        completedTriggerSnapshot = triggerSnapshot.filter((trigger) => trigger.status === 'completed')
          .map((trigger) => trigger.trigger_id);
      } else {
        triggerSnapshot = x.triggers ?? [];
        completedTriggerSnapshot = x.completed_trigger_ids ?? [];
        const registeredDue = allRegisteredTriggers
          .filter((trigger) => trigger.status === 'pending' && trigger.due_coordinate <= x.to_coordinate)
          .map((trigger) => trigger.trigger_id);
        if (registeredDue.length) {
          throw new EngineError('TIME_TRIGGER_SOURCE_CONFLICT', 'Request-scoped planning cannot advance across registered pending triggers; use registered trigger mode or explicitly cancel/reconcile them.', 409, {
            trigger_ids: registeredDue,
            target_coordinate: x.to_coordinate,
          });
        }
      }
      plan = planDueWork({
        world_id: id,
        from_coordinate: from,
        to_coordinate: x.to_coordinate,
        triggers: triggerSnapshot,
        completed_trigger_ids: completedTriggerSnapshot,
      });
    } catch (error) {
      if (error instanceof EngineError) throw error;
      throw new EngineError(error.code || 'INVALID_DUE_WORK_REQUEST', error.message || 'Due-work planning failed.', 400, error.details);
    }

    const operationId = randomUUID();
    const effectiveTarget = plan.status === 'blocked' ? from : plan.planned_until_coordinate;
    const segments = [];
    let cursor = from;
    const appendSegment = (coordinate, events, triggerIds = [], registeredTriggerIds = []) => {
      if (segments.length >= 1024) {
        throw new EngineError('TIME_ADVANCE_SEGMENT_LIMIT', 'Time advance requires more than 1024 atomic segments; split it into smaller operations.', 400);
      }
      const index = segments.length;
      const segmentKey = 'time-segment:' + operationId + ':' + index;
      segments.push({
        coordinate,
        trigger_ids: triggerIds,
        registered_trigger_ids: registeredTriggerIds,
        idempotency_key: segmentKey,
        request_hash: hashRequest({ operation_id: operationId, segment_index: index, coordinate, trigger_ids: triggerIds, registered_trigger_ids: registeredTriggerIds, events }),
        events,
      });
    };
    const makeAdvanceEvent = (deltaMs, index) => {
      const seconds = deltaMs / 1000;
      assert(Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 604800,
        'INVALID_TIME_ADVANCE_SEGMENT', 'Synthetic time-advance segments must be whole seconds and no longer than seven days.');
      const suffix = operationId + ':' + index;
      return this.prepareEventForWorld(id, {
        event_id: 'time-advance-' + hashRequest({ operation_id: operationId, index }).slice(0, 32),
        idempotency_key: 'time-advance-event:' + hashRequest({ operation_id: operationId, index }).slice(0, 40),
        turn_id: 'time-advance:' + suffix,
        event_type: 'time.advance',
        time_advance_seconds: seconds,
        time_mode: 'explicit_skip',
        effects: [],
      });
    };

    const preparedFinalEvent = finalEventEnvelope
      ? this.prepareEvent(finalEventEnvelope.event, { durationDecision: finalEventEnvelope.duration_decision })
      : null;

    if (plan.status !== 'blocked') {
      for (const plannedSegment of plan.segments) {
        const coordinate = plannedSegment.due_coordinate;
        while (coordinate - cursor > segmentSkipMs) {
          cursor += segmentSkipMs;
          appendSegment(cursor, [makeAdvanceEvent(segmentSkipMs, segments.length)]);
        }
        const triggerEvents = plannedSegment.triggers.map((trigger) => {
          const payload = trigger.payload;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || !payload.event || typeof payload.event !== 'object' || Array.isArray(payload.event)) {
            throw new EngineError('TRIGGER_EVENT_PROPOSAL_REQUIRED', 'Each executable trigger payload must contain an event proposal.', 400, { trigger_id: trigger.trigger_id });
          }
          const proposal = payload.event;
          if (proposal.expected_revision !== undefined || proposal.expected_commit_sequence !== undefined) {
            throw new EngineError('INVALID_TRIGGER_EVENT_CURSOR', 'Scheduled event proposals cannot choose their own revision or commit cursor.', 400, { trigger_id: trigger.trigger_id });
          }
          if (proposal.time_advance_seconds !== undefined && proposal.time_advance_seconds !== 0) {
            throw new EngineError('INVALID_TRIGGER_EVENT_DURATION', 'Scheduled trigger effects must execute at their due coordinate with zero additional duration.', 400, { trigger_id: trigger.trigger_id });
          }
          const identity = hashRequest({ operation_id: operationId, trigger_id: trigger.trigger_id });
          const event = {
            ...proposal,
            event_id: proposal.event_id ?? ('time-trigger-' + identity.slice(0, 32)),
            idempotency_key: proposal.idempotency_key ?? ('time-trigger:' + identity.slice(0, 48)),
            time_advance_seconds: 0,
          };
          return this.prepareEventForWorld(id, event);
        });
        let offset = 0;
        while (offset < triggerEvents.length) {
          const needsAdvance = cursor < coordinate;
          const capacity = needsAdvance ? 31 : 32;
          const chunk = triggerEvents.slice(offset, offset + capacity);
          const events = [];
          if (needsAdvance) events.push(makeAdvanceEvent(coordinate - cursor, segments.length));
          events.push(...chunk);
          const chunkTriggerIds = plannedSegment.triggers.slice(offset, offset + chunk.length)
            .map((trigger) => trigger.trigger_id);
          appendSegment(coordinate, events, chunkTriggerIds, triggerSource === 'registered' ? chunkTriggerIds : []);
          cursor = coordinate;
          offset += chunk.length;
        }
      }
      while (effectiveTarget - cursor > segmentSkipMs) {
        cursor += segmentSkipMs;
        appendSegment(cursor, [makeAdvanceEvent(segmentSkipMs, segments.length)]);
      }
      if (effectiveTarget > cursor) {
        appendSegment(effectiveTarget, [makeAdvanceEvent(effectiveTarget - cursor, segments.length)]);
        cursor = effectiveTarget;
      }
    }

    if (preparedFinalEvent) {
      plan.action_request_hash = actionRequestHash;
      plan.final_action_event_id = preparedFinalEvent.event_id;
      plan.final_action_duration_ms = finalEventEnvelope.duration_decision?.duration_ms ?? 0;
      plan.final_action_duration_decision = finalEventEnvelope.duration_decision ?? null;
      if (plan.status === 'blocked') {
        plan.final_action_status = 'not_executed_blocked';
      } else if (plan.status === 'interrupted') {
        plan.final_action_status = 'not_executed_interrupted';
      } else {
        const actionAccess = segmentAccess(preparedFinalEvent);
        const targetSegments = segments.filter((segment) => segment.coordinate === effectiveTarget);
        for (const segment of targetSegments) {
          for (const existingEvent of segment.events) {
            const existingAccess = segmentAccess(existingEvent);
            const conflicts = [
              ...[...actionAccess.writes].filter((ref) => existingAccess.writes.has(ref) || existingAccess.reads.has(ref)),
              ...[...actionAccess.reads].filter((ref) => existingAccess.writes.has(ref)),
            ];
            if (conflicts.length) {
              throw new EngineError('TIME_ACTION_TRIGGER_CONFLICT',
                'Timed action effects conflict with scheduled work at the same coordinate; the operation requires an explicit causal policy.',
                409, { action_event_id: preparedFinalEvent.event_id, conflicting_event_id: existingEvent.event_id, reference: conflicts[0] });
            }
          }
        }
        validateIndependentSegment([preparedFinalEvent]);
        appendSegment(effectiveTarget, [preparedFinalEvent], [], []);
        plan.final_action_status = 'pending';
      }
    }

    const completedTriggerIds = plan.segments.flatMap((segment) => segment.trigger_ids);
    plan.completed_trigger_ids = completedTriggerIds;
    const initialStatus = plan.status === 'blocked' ? 'blocked'
      : segments.length === 0 ? (plan.status === 'interrupted' ? 'interrupted' : 'completed')
        : 'running';
    const operation = this.store.createTimeAdvanceOperation({
      world_id: id,
      operation_id: operationId,
      idempotency_key: x.idempotency_key.trim(),
      request_hash: requestHash,
      from_coordinate: from,
      target_coordinate: effectiveTarget,
      starting_world_revision: x.expected_revision,
      status: initialStatus,
      segments,
      claimed_trigger_ids: triggerSource === 'registered'
        ? [...new Set(segments.flatMap((segment) => segment.registered_trigger_ids ?? []))]
        : [],
      plan,
      result: initialStatus === 'blocked' ? {
        status: 'blocked', blocked: plan.blocked, confirmed_coordinate: from,
        ...(plan.final_action_status ? { final_action_status: plan.final_action_status } : {}),
      } : null,
    });
    if (operation.status !== 'running') return operation;
    return this.store.resumeTimeAdvanceOperation(id, operation.operation_id);
  }

  resumeTimeAdvance(id, operationId) {
    return this.store.resumeTimeAdvanceOperation(id, operationId);
  }

  getTimeAdvanceOperation(id, operationId) {
    return this.store.getTimeAdvanceOperation(id, operationId);
  }

  commitRelationshipTransition(id, x) {
    assert(obj(x), 'INVALID_RELATIONSHIP_TRANSITION', 'Relationship transition request must be an object.');
    const allowed = ['subject_id', 'target_id', 'rule_module_id', 'rule_module_version', 'patch', 'evidence_refs', 'expected_revision', 'expected_commit_sequence', 'idempotency_key'];
    assert(Object.keys(x).every((key) => allowed.includes(key)), 'UNSUPPORTED_RELATIONSHIP_TRANSITION_FIELD', 'Relationship transition contains an unsupported field.');
    for (const key of ['subject_id', 'target_id', 'rule_module_id', 'rule_module_version', 'idempotency_key']) {
      assert(typeof x[key] === 'string' && x[key].trim() && x[key].length <= 200, 'INVALID_RELATIONSHIP_TRANSITION', key + ' must be a non-empty string of at most 200 characters.');
    }
    assert(Number.isSafeInteger(x.expected_revision) && x.expected_revision >= 0, 'INVALID_REVISION', 'expected_revision is required and must be non-negative.');
    assert(Number.isSafeInteger(x.expected_commit_sequence) && x.expected_commit_sequence >= 0, 'INVALID_COMMIT_SEQUENCE', 'expected_commit_sequence is required and must be non-negative.');
    assert(Array.isArray(x.evidence_refs) && x.evidence_refs.length > 0 && x.evidence_refs.length <= 128
      && x.evidence_refs.every((ref) => typeof ref === 'string' && ref.startsWith('event:') && ref.length > 'event:'.length && ref.length <= 206)
      && new Set(x.evidence_refs).size === x.evidence_refs.length,
    'INVALID_RELATIONSHIP_EVIDENCE_REFERENCE', 'evidence_refs must contain unique event:<event_id> references.');
    const operationKey = x.idempotency_key.trim();
    const requestIdentity = hashRequest({ operation: 'relationship.transition', world_id: id, idempotency_key: operationKey });
    const prepared = this.prepareEventForWorld(id, {
      idempotency_key: 'relationship-transition:' + requestIdentity,
      turn_id: 'relationship-transition:' + requestIdentity.slice(0, 32),
      event_type: 'relationship.transition',
      expected_revision: x.expected_revision,
      expected_commit_sequence: x.expected_commit_sequence,
      caused_by: x.evidence_refs.map((ref) => ref.slice('event:'.length)),
      effects: [{
        kind: 'relationship.transition',
        subject_id: x.subject_id.trim(),
        target_id: x.target_id.trim(),
        rule_module_id: x.rule_module_id.trim(),
        rule_module_version: x.rule_module_version.trim(),
        patch: x.patch,
        evidence_refs: x.evidence_refs,
        executor_type: 'admin_credential',
      }],
    }, { allowRelationshipTransition: true });
    prepared.request_hash = hashRequest({
      operation: 'relationship.transition',
      world_id: id,
      idempotency_key: operationKey,
      expected_revision: x.expected_revision,
      expected_commit_sequence: x.expected_commit_sequence,
      subject_id: x.subject_id.trim(),
      target_id: x.target_id.trim(),
      rule_module_id: x.rule_module_id.trim(),
      rule_module_version: x.rule_module_version.trim(),
      patch: x.patch,
      evidence_refs: x.evidence_refs,
    });
    return this.store.commit(id, prepared);
  }

  validateEvent(id, x) {
    const prepared = this.prepareEventForWorld(id, { ...x, idempotency_key: 'validation:' + randomUUID() });
    prepared.request_hash = hashRequest({
      operation: 'event.validate',
      request_hash: prepared.request_hash,
      idempotency_key: prepared.idempotency_key,
    });
    return this.store.validateCommit(id, prepared);
  }

  rollbackEvent(id, x) {
    assert(obj(x), 'INVALID_BODY', 'Body must be an object.');
    assert(typeof x.root_event_id === 'string' && x.root_event_id.trim() && x.root_event_id.length <= 200, 'ROOT_EVENT_REQUIRED', 'root_event_id must be a non-empty string of at most 200 characters.');
    assert(typeof x.idempotency_key === 'string' && x.idempotency_key.trim() && x.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key must be a non-empty string of at most 200 characters.');
    const request = { operation: 'event.rollback', root_event_id: x.root_event_id.trim() };
    return this.store.rollback(id, request.root_event_id, x.idempotency_key.trim(), hashRequest(request));
  }
}

export { EngineError };
