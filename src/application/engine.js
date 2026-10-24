import { randomUUID } from 'node:crypto';
import { assert, EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { validateEffects } from '../core/rules.js';
import { validateMechanicTemplate, validateRuleModuleManifest } from '../core/mechanics.js';

const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
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
  && (ref.startsWith('entity:') || ref.startsWith('fact:') || ref.startsWith('relationship:') || ref.startsWith('mechanic:'));

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
    if (effect.kind === 'relationship.transition') {
      writes.add(segmentRelationshipRef(effect.subject_id, effect.target_id));
      reads.add('entity:' + effect.subject_id);
      reads.add('entity:' + effect.target_id);
    } else if (effect.kind.startsWith('entity.')) {
      writes.add('entity:' + effect.entity_id);
    } else if (effect.kind.startsWith('mechanic.instance.')) {
      writes.add('mechanic:' + effect.instance_id);
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
    if ((event.depends_on || []).some((ref) => !isTypedProjectionRef(ref) && eventIds.has(ref))) {
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
  constructor(store) {
    this.store = store;
  }

  createWorld(x) {
    assert(obj(x), 'INVALID_BODY', 'Body must be an object.');
    for (const k of ['world_pack_id', 'world_pack_version']) {
      assert(typeof x[k] === 'string' && x[k].trim(), 'INVALID_WORLD', 'Missing ' + k);
    }
    assert(typeof x.game_time === 'string' && Number.isFinite(Date.parse(x.game_time)), 'INVALID_GAME_TIME', 'game_time must be a valid date/time.');
    const id = x.world_id || randomUUID();
    assert(typeof id === 'string' && id.trim() && id.length <= 200, 'INVALID_WORLD_ID', 'Invalid world_id.');
    return this.store.createWorld({
      world_id: id,
      world_pack_id: x.world_pack_id.trim(),
      world_pack_version: x.world_pack_version.trim(),
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
  getEvents(id, includeInvalid = false) { return this.store.events(id, includeInvalid); }
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
    const allowedFields = ['idempotency_key', 'turn_id', 'event_type', 'event_id', 'expected_revision', 'expected_commit_sequence', 'context_manifest_id', 'generation_id', 'source_message_id', 'time_advance_seconds', 'time_mode', 'caused_by', 'depends_on', 'read_set', 'causal_links', 'effects'];
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
    assert(seconds <= (skip ? 604800 : 43200), 'TIME_ADVANCE_TOO_LARGE', 'Time advance exceeds limit.');
    if (seconds > 0) assert(['time.advance', 'action.completed'].includes(x.event_type), 'INVALID_TIME_ADVANCE', 'Invalid event type for time advance.');

    const effects = x.effects ?? [];
    validateEffects(effects, { allowRelationshipTransition: options.allowRelationshipTransition === true });
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

  commitEvent(id, x) {
    return this.store.commit(id, this.prepareEvent(x));
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
      const prepared = this.prepareEvent(event, options);
      assert(typeof prepared.event_id === 'string' && prepared.event_id.trim(), 'SEGMENT_EVENT_ID_REQUIRED', 'Every segment event must have an explicit event_id.');
      return prepared;
    });
    const ids = preparedEvents.map((event) => event.event_id);
    const keys = preparedEvents.map((event) => event.idempotency_key);
    assert(new Set(ids).size === ids.length, 'DUPLICATE_SEGMENT_EVENT_ID', 'Segment event IDs must be unique.');
    assert(new Set(keys).size === keys.length, 'DUPLICATE_SEGMENT_EVENT_KEY', 'Segment event idempotency keys must be unique.');
    validateIndependentSegment(preparedEvents);

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
    const prepared = this.prepareEvent({
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
    const prepared = this.prepareEvent({ ...x, idempotency_key: 'validation:' + randomUUID() });
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
