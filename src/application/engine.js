import { randomUUID } from 'node:crypto';
import { assert, EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { validateEffects } from '../core/rules.js';

const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const strings = (x, name) => {
  x = x ?? [];
  assert(Array.isArray(x) && x.length <= 500 && x.every((v) => typeof v === 'string' && v.trim()), 'INVALID_FIELD', name + ' must be an array of non-empty strings.');
  return [...new Set(x.map((v) => v.trim()))];
};

const causalLinks = (value) => {
  value = value ?? [];
  assert(Array.isArray(value) && value.length <= 500, 'INVALID_CAUSAL_LINKS', 'causal_links must be an array of at most 500 links.');
  const supported = new Set(['READS_SOURCE', 'READS_ENTITY', 'READS_CLAIM']);
  const seen = new Set();
  const links = value.map((link) => {
    assert(obj(link), 'INVALID_CAUSAL_LINK', 'Each causal link must be an object.');
    assert(typeof link.relation === 'string' && supported.has(link.relation), 'UNSUPPORTED_CAUSAL_RELATION', 'Unsupported causal relationship: ' + String(link.relation));
    assert(typeof link.target_id === 'string' && link.target_id.trim() && link.target_id.trim().length <= 200, 'INVALID_CAUSAL_LINK', 'causal link target_id must be a non-empty string of at most 200 characters.');
    const normalized = { relation: link.relation, target_id: link.target_id.trim() };
    const key = JSON.stringify([normalized.relation, normalized.target_id]);
    assert(!seen.has(key), 'DUPLICATE_CAUSAL_LINK', 'Duplicate causal link: ' + normalized.relation + ' ' + normalized.target_id);
    seen.add(key);
    return normalized;
  });
  return links.sort((a, b) => a.relation.localeCompare(b.relation) || a.target_id.localeCompare(b.target_id));
};

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

  getState(id) { return this.store.state(id); }
  getEvents(id, includeInvalid = false) { return this.store.events(id, includeInvalid); }
  getAudit(id) { return this.store.audit(id); }

  commitEvent(id, x) {
    assert(obj(x), 'INVALID_BODY', 'Body must be an object.');
    assert(typeof x.idempotency_key === 'string' && x.idempotency_key.trim() && x.idempotency_key.length <= 200, 'IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key required.');
    assert(typeof x.turn_id === 'string' && x.turn_id.trim() && x.turn_id.length <= 200, 'TURN_ID_REQUIRED', 'turn_id required.');
    assert(typeof x.event_type === 'string' && x.event_type.trim() && x.event_type.length <= 200, 'EVENT_TYPE_REQUIRED', 'event_type required.');
    if (x.event_id !== undefined && x.event_id !== null) {
      assert(typeof x.event_id === 'string' && x.event_id.trim() && x.event_id.length <= 200, 'INVALID_EVENT_ID', 'event_id must be a non-empty string of at most 200 characters.');
      assert(!x.event_id.trim().startsWith('entity:') && !x.event_id.trim().startsWith('fact:'), 'INVALID_EVENT_ID', 'event_id cannot use the reserved entity: or fact: reference prefixes.');
    }
    if (x.expected_revision !== undefined) assert(Number.isSafeInteger(x.expected_revision) && x.expected_revision >= 0, 'INVALID_REVISION', 'expected_revision must be non-negative.');

    const seconds = x.time_advance_seconds ?? 0;
    const skip = x.time_mode === 'explicit_skip';
    assert(Number.isSafeInteger(seconds) && seconds >= 0, 'INVALID_TIME_ADVANCE', 'time_advance_seconds must be non-negative.');
    assert(x.time_mode === undefined || x.time_mode === 'action' || skip, 'INVALID_TIME_MODE', 'time_mode must be action or explicit_skip.');
    assert(seconds <= (skip ? 604800 : 43200), 'TIME_ADVANCE_TOO_LARGE', 'Time advance exceeds limit.');
    if (seconds > 0) assert(['time.advance', 'action.completed'].includes(x.event_type), 'INVALID_TIME_ADVANCE', 'Invalid event type for time advance.');

    const effects = x.effects ?? [];
    validateEffects(effects);
    const request = {
      operation: 'event.commit',
      event_id: x.event_id ?? null,
      turn_id: x.turn_id.trim(),
      generation_id: x.generation_id ?? null,
      source_message_id: x.source_message_id ?? null,
      event_type: x.event_type.trim(),
      expected_revision: x.expected_revision ?? null,
      time_advance_seconds: seconds,
      time_mode: x.time_mode ?? 'action',
      caused_by: strings(x.caused_by, 'caused_by'),
      depends_on: strings(x.depends_on, 'depends_on'),
      read_set: strings(x.read_set, 'read_set'),
      causal_links: causalLinks(x.causal_links),
      effects,
    };
    return this.store.commit(id, {
      ...request,
      request_hash: hashRequest(request),
      idempotency_key: x.idempotency_key.trim(),
    });
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
