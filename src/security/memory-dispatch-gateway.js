import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../storage/coordinator-lock.js';
import { getAcceptedHeadStatusSync } from './accepted-head-client-sync.js';

function snapshotSignatureInput(request) {
  const keys = [
    'requestId', 'route', 'senderRoute', 'model', 'stream', 'body',
    'worldId', 'actorId', 'purpose', 'sources', 'candidates', 'hostContext',
  ];
  if (!request || typeof request !== 'object' || Array.isArray(request) || utilTypes.isProxy(request)) {
    throw new TypeError('Invalid signed dispatch request.');
  }
  try {
    const prototype = Object.getPrototypeOf(request);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Invalid signed dispatch request.');
    const snapshot = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const descriptor = Object.getOwnPropertyDescriptor(request, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Invalid signed dispatch request.');
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    throw new TypeError('Invalid signed dispatch request.');
  }
}

export function createDispatchRequestSignature(secret, request) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new TypeError('Invalid signed dispatch request.');
  }
  const input = snapshotSignatureInput(request);
  if (!arrayContains(PROTECTED_MEMORY_SENDER_ROUTES, input.senderRoute)
    || typeof input.body !== 'string' || typeof input.stream !== 'boolean') {
    throw new TypeError('Invalid signed dispatch request.');
  }
  const sources = normalizeSources(input.sources);
  const candidates = normalizeCandidates(input.candidates);
  const hostContext = normalizeHostContext(input.hostContext);
  assertSourcesMatchCandidates(sources, candidates);
  const bodyDigest = createHash('sha256').update(input.body, 'utf8').digest('hex');
  const canonical = JSON.stringify({
    request_id: input.requestId,
    route: input.route,
    sender_route: input.senderRoute,
    model: input.model,
    stream: input.stream,
    body_digest: bodyDigest,
    world_id: input.worldId,
    actor_id: input.actorId,
    purpose: input.purpose,
    sources,
    candidates,
    host_context: hostContext,
  });
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function verifyDispatchRequestSignature(secret, request, signature) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  let expected;
  try { expected = createDispatchRequestSignature(secret, request); } catch { return false; }
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(signature, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export const SUPPORTED_PROTECTED_MEMORY_ROUTES = Object.freeze([
  'host-selected-chat-generation',
]);

// One authoritative registry for every protected SillyTavern chat-completion
// sender family audited against the pinned 1.19.0 release.
export const PROTECTED_MEMORY_SENDER_ROUTES = Object.freeze([
  'claude', 'google-ai-studio', 'vertex-ai', 'ai21', 'mistral', 'cohere',
  'deepseek', 'xai', 'aimlapi', 'electronhub', 'chutes', 'minimax',
  'azure-openai', 'openai', 'openrouter', 'custom', 'perplexity', 'groq',
  'fireworks', 'nanogpt', 'pollinations', 'moonshot', 'zai', 'siliconflow',
  'workers-ai', 'text-completions', 'kobold', 'novelai-text', 'horde-text',
]);

const ASYNC_FUNCTION_PROTOTYPE = Object.getPrototypeOf(async function () {});
const GENERATOR_FUNCTION_PROTOTYPE = Object.getPrototypeOf(function* () {});
const ASYNC_GENERATOR_FUNCTION_PROTOTYPE = Object.getPrototypeOf(async function* () {});
const intrinsicGetPrototypeOf = Object.getPrototypeOf;
const intrinsicFunctionToString = Function.prototype.toString;
const intrinsicReflectApply = Reflect.apply;
const intrinsicStringEndsWith = String.prototype.endsWith;
const isProxy = utilTypes.isProxy;

function isSynchronousCallable(callback) {
  if (typeof callback !== 'function' || isProxy(callback)) return false;
  try {
    const prototype = intrinsicGetPrototypeOf(callback);
    if (prototype === ASYNC_FUNCTION_PROTOTYPE
      || prototype === GENERATOR_FUNCTION_PROTOTYPE
      || prototype === ASYNC_GENERATOR_FUNCTION_PROTOTYPE) return false;
    // Bound functions stringify as native code. Their target kind (sync/async)
    // is intentionally opaque, so reject them rather than invoke an untrusted
    // callback to discover whether it returns a Promise. Use captured intrinsics
    // so a caller cannot poison the check after this module is initialized.
    const source = intrinsicReflectApply(intrinsicFunctionToString, callback, []);
    return !intrinsicReflectApply(intrinsicStringEndsWith, source, ['{ [native code] }']);
  } catch {
    return false;
  }
}

function arrayContains(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function ownKeyContains(keys, expected) {
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === expected) return true;
  }
  return false;
}

const validText = (value, max = 200) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || value !== value.trim()) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
};

function canonicalPath(path) {
  const absolute = resolve(path);
  let candidate = absolute;
  let suffix = '';
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new TypeError('Cannot resolve dispatch storage path.');
    suffix = candidate.slice(parent.length) + suffix;
    candidate = parent;
  }
  return resolve(realpathSync(candidate) + suffix);
}

export function openReadOnlySqliteDatabase(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path === ':memory:' || !existsSync(path)) {
    throw new TypeError('Read-only SQLite access requires an existing absolute file path.');
  }
  const db = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON;');
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}

function sameFile(left, right) {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  if (a === b) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const statA = statSync(a, { bigint: true });
  const statB = statSync(b, { bigint: true });
  return statA.dev === statB.dev && statA.ino === statB.ino;
}

function normalizeHostContext(value) {
  const keys = [
    'adapter_id', 'core_conversation_id', 'world_id', 'actor_id', 'actor_type',
    'host_installation_id', 'authenticated_account_id', 'host_session_id',
    'host_conversation_id', 'conversation_uuid', 'root_id',
    'root_inventory_sequence', 'root_manifest_sha256',
  ];
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  let ownKeys;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('MEMORY_DISPATCH_NOT_READY');
    ownKeys = Reflect.ownKeys(value);
  } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (ownKeys.length !== keys.length) throw new Error('MEMORY_DISPATCH_NOT_READY');
  for (let index = 0; index < ownKeys.length; index += 1) {
    if (typeof ownKeys[index] !== 'string' || !arrayContains(keys, ownKeys[index])) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
  }
  const snapshot = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('MEMORY_DISPATCH_NOT_READY');
    snapshot[key] = descriptor.value;
  }
  const uuid = item => typeof item === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item);
  if (!validText(snapshot.adapter_id) || !validText(snapshot.world_id) || !validText(snapshot.actor_id)
    || !validText(snapshot.actor_type) || !uuid(snapshot.host_installation_id)
    || !uuid(snapshot.authenticated_account_id) || !uuid(snapshot.host_session_id)
    || !uuid(snapshot.conversation_uuid) || !validText(snapshot.core_conversation_id)
    || !validText(snapshot.host_conversation_id)
    || snapshot.core_conversation_id !== snapshot.host_session_id + ':' + snapshot.host_installation_id + ':' + snapshot.conversation_uuid
    || snapshot.host_conversation_id !== snapshot.host_installation_id + ':' + snapshot.authenticated_account_id + ':' + snapshot.conversation_uuid
    || !/^[a-f0-9]{64}$/.test(snapshot.root_id ?? '')
    || !Number.isSafeInteger(snapshot.root_inventory_sequence) || snapshot.root_inventory_sequence < 1
    || !/^[a-f0-9]{64}$/.test(snapshot.root_manifest_sha256 ?? '')) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  return Object.freeze(snapshot);
}

function cloneLaneAData(value, seen = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (depth > 32 || ++budget.nodes > 20_000) throw new Error('MEMORY_DISPATCH_NOT_READY');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('MEMORY_DISPATCH_NOT_READY');
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || !ownKeyContains(keys, 'length')) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      const copy = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new Error('MEMORY_DISPATCH_NOT_READY');
        }
        copy[index] = cloneLaneAData(descriptor.value, seen, depth + 1, budget);
      }
      return copy;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('MEMORY_DISPATCH_NOT_READY');
    const keys = Reflect.ownKeys(value);
    const copy = {};
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') throw new Error('MEMORY_DISPATCH_NOT_READY');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      Object.defineProperty(copy, key, {
        value: cloneLaneAData(descriptor.value, seen, depth + 1, budget),
        enumerable: true, writable: true, configurable: true,
      });
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

function freezeLaneAData(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    freezeLaneAData(value[key]);
  }
  return Object.freeze(value);
}

function normalizeLaneA(value) {
  // Lane A is part of the complete Core-issued NPC context. Missing Lane A is
  // not equivalent to a verified empty lane and must never be defaulted away.
  const keys = ['lane', 'purpose', 'authorization_ref', 'visibility_authorization_ref', 'items'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  let ownKeys;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('MEMORY_DISPATCH_NOT_READY');
    ownKeys = Reflect.ownKeys(value);
  } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (ownKeys.length !== keys.length) throw new Error('MEMORY_DISPATCH_NOT_READY');
  for (let index = 0; index < ownKeys.length; index += 1) {
    if (typeof ownKeys[index] !== 'string' || !arrayContains(keys, ownKeys[index])) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
  }
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, keys[index]);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  if (value.lane !== 'A' || value.purpose !== 'npc_turn_context'
    || !validText(value.authorization_ref, 200)
    || !validText(value.visibility_authorization_ref, 200)
    || !Array.isArray(value.items) || value.items.length > 200) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  // Clone every nested item using property descriptors. JSON.stringify on an
  // untrusted nested object can execute getters or Proxy traps before signing.
  let copied;
  try { copied = cloneLaneAData(value); } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  let serialized;
  try { serialized = JSON.stringify(copied); } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (typeof serialized !== 'string' || serialized.length > 2_000_000
    || copied.items.length > 200) throw new Error('MEMORY_DISPATCH_NOT_READY');
  return freezeLaneAData(copied);
}

function normalizeProviderEvidenceCursor(value) {
  let cursor;
  try { cursor = readStrictRecord(value, ['data_version', 'candidate_digest']); }
  catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (!Number.isSafeInteger(cursor.data_version) || cursor.data_version < 0
    || typeof cursor.candidate_digest !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.candidate_digest)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  return Object.freeze({ data_version: cursor.data_version, candidate_digest: cursor.candidate_digest });
}

function assertSameProviderEvidenceCursor(current, expected) {
  const normalized = normalizeProviderEvidenceCursor(current);
  if (normalized.data_version !== expected.data_version
    || normalized.candidate_digest !== expected.candidate_digest) {
    throw new Error('MEMORY_DISPATCH_PROVIDER_EVIDENCE_CHANGED');
  }
}

function readDispatchInput(value) {
  const required = [
    'requestId', 'route', 'senderRoute', 'model', 'stream', 'body', 'worldId',
    'actorId', 'purpose', 'sources', 'candidates', 'providerEvidenceCursor',
    'laneA', 'hostContext', 'transport',
  ];
  const optional = ['revalidateLaneA', 'forwardResponse', 'hostTransformsStream', 'signal'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('MEMORY_DISPATCH_NOT_READY');
    const keys = Reflect.ownKeys(value);
    for (let index = 0; index < required.length; index += 1) {
      if (!ownKeyContains(keys, required[index])) throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const snapshot = Object.create(null);
    for (let index = 0; index < required.length + optional.length; index += 1) {
      const key = index < required.length ? required[index] : optional[index - required.length];
      if (!ownKeyContains(keys, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
}

function readStrictArray(value, maxLength) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maxLength) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  let keys;
  try { keys = Reflect.ownKeys(value); } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (keys.length !== value.length + 1 || !ownKeyContains(keys, 'length')) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  const items = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); }
    catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    items[index] = descriptor.value;
  }
  return items;
}

function readStrictRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('MEMORY_DISPATCH_NOT_READY');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length) throw new Error('MEMORY_DISPATCH_NOT_READY');
    for (let index = 0; index < ownKeys.length; index += 1) {
      if (typeof ownKeys[index] !== 'string' || !arrayContains(keys, ownKeys[index])) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
    }
    const record = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
}

function insertionSort(items, compare) {
  for (let index = 1; index < items.length; index += 1) {
    const current = items[index];
    let position = index;
    while (position > 0 && compare(items[position - 1], current) > 0) {
      items[position] = items[position - 1];
      position -= 1;
    }
    items[position] = current;
  }
  return items;
}

function normalizeSources(sources) {
  const input = readStrictArray(sources, 256);
  const normalized = new Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const source = readStrictRecord(input[index], ['source_kind', 'source_entity_id', 'source_version']);
    if (source.source_kind !== 'canonical_entity'
      || !validText(source.source_entity_id, 200)
      || !validText(source.source_version, 200)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    normalized[index] = Object.freeze({
      source_kind: source.source_kind,
      source_entity_id: source.source_entity_id,
      source_version: source.source_version,
    });
  }
  insertionSort(normalized, (a, b) => (a.source_entity_id < b.source_entity_id ? -1
    : a.source_entity_id > b.source_entity_id ? 1 : 0)
    || (a.source_version < b.source_version ? -1 : a.source_version > b.source_version ? 1 : 0));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].source_entity_id === normalized[index].source_entity_id
      && normalized[index - 1].source_version === normalized[index].source_version) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
  }
  return Object.freeze(normalized);
}


function normalizeCandidates(candidates) {
  const input = readStrictArray(candidates, 50);
  const normalized = new Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const candidate = readStrictRecord(input[index], [
      'record_ref', 'record_version', 'authorization_generation',
      'source_kind', 'source_entity_id', 'source_version',
    ]);
    if (!validText(candidate.record_ref, 200) || !validText(candidate.record_version, 200)
      || !Number.isSafeInteger(candidate.authorization_generation) || candidate.authorization_generation < 1
      || candidate.source_kind !== 'canonical_entity'
      || !validText(candidate.source_entity_id, 200) || !validText(candidate.source_version, 200)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    normalized[index] = Object.freeze({
      record_ref: candidate.record_ref,
      record_version: candidate.record_version,
      authorization_generation: candidate.authorization_generation,
      source_kind: candidate.source_kind,
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    });
  }
  insertionSort(normalized, (a, b) => (a.record_ref < b.record_ref ? -1 : a.record_ref > b.record_ref ? 1 : 0)
    || (a.record_version < b.record_version ? -1 : a.record_version > b.record_version ? 1 : 0)
    || (a.source_entity_id < b.source_entity_id ? -1 : a.source_entity_id > b.source_entity_id ? 1 : 0)
    || (a.source_version < b.source_version ? -1 : a.source_version > b.source_version ? 1 : 0));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].record_ref === normalized[index].record_ref
      && normalized[index - 1].record_version === normalized[index].record_version) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
  }
  return Object.freeze(normalized);
}

function assertSameCandidates(actual, expected) {
  let normalized;
  try { normalized = normalizeCandidates(actual); } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) throw new Error('MEMORY_DISPATCH_NOT_READY');
}

function assertSourcesMatchCandidates(sources, candidates) {
  const derived = [];
  const seen = new Set();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const key = JSON.stringify([candidate.source_entity_id, candidate.source_version]);
    if (seen.has(key)) continue;
    seen.add(key);
    derived[derived.length] = {
      source_kind: candidate.source_kind,
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    };
  }
  if (JSON.stringify(normalizeSources(derived)) !== JSON.stringify(sources)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
}

function assertSameSources(actual, expected) {
  let normalized;
  try { normalized = normalizeSources(actual); } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
}

function assertSyncResult(value) {
  if (!value || typeof value !== 'object' || typeof value.then === 'function') {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  return value;
}

function normalizePolicyAuthority(value) {
  let authority;
  try { authority = readStrictRecord(value, ['authority_id', 'generation', 'fingerprint']); }
  catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (!validText(authority.authority_id, 200)
    || !Number.isSafeInteger(authority.generation) || authority.generation < 1
    || typeof authority.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(authority.fingerprint)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  return Object.freeze({
    authority_id: authority.authority_id,
    generation: authority.generation,
    fingerprint: authority.fingerprint,
  });
}

function assertSamePolicyAuthority(actual, expected) {
  let normalized;
  try { normalized = normalizePolicyAuthority(actual); } catch {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  return normalized;
}

/**
 * Sole-dispatch primitive for requests carrying protected Memory.
 *
 * The caller must provide trusted synchronous Core/Provider readers that open
 * their databases read-only and validate the exact current source/grant state,
 * including the complete policy authority tuple. One logical chat-generation
 * route is shared by the explicit 25-family sender registry. There is no
 * fallback reader or transport.
 */
export class MemoryDispatchGateway {
  constructor({
    ledgerPath,
    coordinatorPath,
    authorityPort,
    readToken,
    readCoreEvidence,
    readProviderEvidence,
    readHostEvidence,
  }) {
    if (typeof ledgerPath !== 'string' || !isAbsolute(ledgerPath)
      || typeof coordinatorPath !== 'string' || !isAbsolute(coordinatorPath)
      || !Number.isInteger(authorityPort) || authorityPort < 1 || authorityPort > 65535
      || typeof readToken !== 'string' || readToken.length < 32
      || typeof readCoreEvidence !== 'function'
      || typeof readProviderEvidence !== 'function'
      || typeof readHostEvidence !== 'function') {
      throw new TypeError('MemoryDispatchGateway requires file-backed stores, a read-only authority token, trusted synchronous readers.');
    }
    if (sameFile(ledgerPath, coordinatorPath)) {
      throw new Error('DISPATCH_LEDGER_COORDINATOR_PATH_ALIAS');
    }

    this.ledgerPath = resolve(ledgerPath);
    this.coordinatorPath = resolve(coordinatorPath);
    this.authorityPort = authorityPort;
    this.readToken = readToken;
    this.readCoreEvidence = readCoreEvidence;
    this.readProviderEvidence = readProviderEvidence;
    this.readHostEvidence = readHostEvidence;

    this.coordinatorDb = openCoordinatorDatabase(this.coordinatorPath);
    this.db = null;
    this.pendingReleases = new Map();
    let release = () => {};
    let startupError = null;
    try {
      release = beginCoordinatorLock(this.coordinatorDb);
      const existed = existsSync(this.ledgerPath);
      this.db = new DatabaseSync(this.ledgerPath);
      // Make the dispatch-start commit explicitly durable; do not rely on
      // SQLite build defaults for the no-upstream-retry security boundary.
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
      if (!existed) {
        this.db.exec(`
          CREATE TABLE dispatch_ledger (
            request_id TEXT PRIMARY KEY,
            request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
            route TEXT NOT NULL CHECK(route='host-selected-chat-generation'),
            sender_route TEXT NOT NULL CHECK(sender_route IN ('claude','google-ai-studio','vertex-ai','ai21','mistral','cohere','deepseek','xai','aimlapi','electronhub','chutes','minimax','azure-openai','openai','openrouter','custom','perplexity','groq','fireworks','nanogpt','pollinations','moonshot','zai','siliconflow','workers-ai','text-completions','kobold','novelai-text','horde-text')),
            model TEXT NOT NULL,
            stream INTEGER NOT NULL CHECK(stream IN (0,1)),
            world_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            purpose TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            candidates_json TEXT NOT NULL,
            core_head INTEGER NOT NULL CHECK(core_head > 0),
            provider_head INTEGER NOT NULL CHECK(provider_head > 0),
            policy_authority_id TEXT NOT NULL,
            policy_generation INTEGER NOT NULL CHECK(policy_generation > 0),
            policy_fingerprint TEXT NOT NULL CHECK(length(policy_fingerprint)=64),
            status TEXT NOT NULL CHECK(status IN ('DISPATCH_STARTED','COMPLETED','UNKNOWN')),
            outcome_code INTEGER,
            started_at TEXT NOT NULL,
            finished_at TEXT
          );
          CREATE INDEX dispatch_ledger_status_started
            ON dispatch_ledger(status, started_at);
          CREATE UNIQUE INDEX dispatch_ledger_unresolved_digest
            ON dispatch_ledger(request_digest)
            WHERE status IN ('DISPATCH_STARTED','UNKNOWN');
        `);
      } else {
        const objectRows = this.db.prepare(
          "SELECT type || ':' || name AS object_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        ).all();
        const objects = new Set();
        for (let index = 0; index < objectRows.length; index += 1) objects.add(objectRows[index].object_name);
        if (!objects.has('table:dispatch_ledger') || !objects.has('index:dispatch_ledger_status_started')
          || !objects.has('index:dispatch_ledger_unresolved_digest')) {
          throw new Error('DISPATCH_LEDGER_SCHEMA_INCOMPLETE');
        }
        const columnRows = this.db.prepare('PRAGMA table_info(dispatch_ledger)').all();
        const columns = new Set();
        for (let index = 0; index < columnRows.length; index += 1) columns.add(columnRows[index].name);
        const required = [
          'request_id', 'request_digest', 'route', 'sender_route', 'model', 'stream', 'world_id', 'actor_id', 'purpose',
          'sources_json', 'candidates_json', 'core_head', 'provider_head', 'policy_authority_id', 'policy_generation',
          'policy_fingerprint', 'status', 'outcome_code',
          'started_at', 'finished_at',
        ];
        for (let index = 0; index < required.length; index += 1) {
          if (!columns.has(required[index])) throw new Error('DISPATCH_LEDGER_SCHEMA_INCOMPLETE');
        }
        const tableSql = this.db.prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='dispatch_ledger'",
        ).get()?.sql ?? '';
        if (tableSql.indexOf("'horde-text'") === -1) {
          // Expand the exact sender CHECK constraint without discarding durable
          // dispatch history. Migration is serialized by the shared Coordinator.
          this.db.exec(`
            BEGIN IMMEDIATE;
            DROP INDEX IF EXISTS dispatch_ledger_status_started;
            DROP INDEX IF EXISTS dispatch_ledger_unresolved_digest;
            ALTER TABLE dispatch_ledger RENAME TO dispatch_ledger_legacy;
            CREATE TABLE dispatch_ledger (
              request_id TEXT PRIMARY KEY,
              request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
              route TEXT NOT NULL CHECK(route='host-selected-chat-generation'),
              sender_route TEXT NOT NULL CHECK(sender_route IN ('claude','google-ai-studio','vertex-ai','ai21','mistral','cohere','deepseek','xai','aimlapi','electronhub','chutes','minimax','azure-openai','openai','openrouter','custom','perplexity','groq','fireworks','nanogpt','pollinations','moonshot','zai','siliconflow','workers-ai','text-completions','kobold','novelai-text','horde-text')),
              model TEXT NOT NULL,
              stream INTEGER NOT NULL CHECK(stream IN (0,1)),
              world_id TEXT NOT NULL,
              actor_id TEXT NOT NULL,
              purpose TEXT NOT NULL,
              sources_json TEXT NOT NULL,
              candidates_json TEXT NOT NULL,
              core_head INTEGER NOT NULL CHECK(core_head > 0),
              provider_head INTEGER NOT NULL CHECK(provider_head > 0),
              policy_authority_id TEXT NOT NULL,
              policy_generation INTEGER NOT NULL CHECK(policy_generation > 0),
              policy_fingerprint TEXT NOT NULL CHECK(length(policy_fingerprint)=64),
              status TEXT NOT NULL CHECK(status IN ('DISPATCH_STARTED','COMPLETED','UNKNOWN')),
              outcome_code INTEGER,
              started_at TEXT NOT NULL,
              finished_at TEXT
            );
            INSERT INTO dispatch_ledger SELECT
              request_id,request_digest,route,sender_route,model,stream,world_id,actor_id,purpose,
              sources_json,candidates_json,core_head,provider_head,policy_authority_id,policy_generation,
              policy_fingerprint,status,outcome_code,started_at,finished_at
            FROM dispatch_ledger_legacy;
            DROP TABLE dispatch_ledger_legacy;
            CREATE INDEX dispatch_ledger_status_started ON dispatch_ledger(status, started_at);
            CREATE UNIQUE INDEX dispatch_ledger_unresolved_digest
              ON dispatch_ledger(request_digest) WHERE status IN ('DISPATCH_STARTED','UNKNOWN');
            COMMIT;
          `);
        }
      }
      // A durable STARTED row left by a process crash has an ambiguous outcome.
      // Never retry it automatically; persist UNKNOWN before accepting new work.
      this.db.prepare(`
        UPDATE dispatch_ledger SET status='UNKNOWN', finished_at=?
        WHERE status='DISPATCH_STARTED'
      `).run(new Date().toISOString());
    } catch (error) {
      startupError = error;
    } finally {
      try { release(); } catch (error) { startupError ??= error; }
    }
    if (startupError) {
      try { this.db?.close(); } catch {}
      try { this.coordinatorDb.close(); } catch {}
      throw startupError;
    }
  }

  async dispatchProtectedRequest(input) {
    const {
      requestId, route, senderRoute, model, stream, body, worldId, actorId, purpose,
      sources, candidates, providerEvidenceCursor, laneA, revalidateLaneA, hostContext,
      transport, forwardResponse, hostTransformsStream = false, signal,
    } = readDispatchInput(input);
    if (!validText(requestId, 200) || !arrayContains(SUPPORTED_PROTECTED_MEMORY_ROUTES, route)
      || !arrayContains(PROTECTED_MEMORY_SENDER_ROUTES, senderRoute)
      || typeof model !== 'string' || model.length > 128 || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,3}$/.test(model)
      || typeof stream !== 'boolean'
      || typeof body !== 'string' || body.length === 0 || body.length > 4_000_000
      || !validText(worldId, 200) || !validText(actorId, 200) || !validText(purpose, 200)
      || typeof hostTransformsStream !== 'boolean'
      || stream && !hostTransformsStream && typeof forwardResponse !== 'function') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const sourceSet = normalizeSources(sources);
    const candidateSet = normalizeCandidates(candidates);
    const providerCursorSnapshot = normalizeProviderEvidenceCursor(providerEvidenceCursor);
    const laneASnapshot = normalizeLaneA(laneA);
    if (sourceSet.length === 0 && candidateSet.length === 0 && laneASnapshot.items.length === 0) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (laneASnapshot.items.length > 0
      && (!isSynchronousCallable(revalidateLaneA))) {
      throw new Error('MEMORY_DISPATCH_LANE_A_REVALIDATION_REQUIRED');
    }
    const hostContextSnapshot = normalizeHostContext(hostContext);
    assertSourcesMatchCandidates(sourceSet, candidateSet);
    // Sender family is intentionally excluded from the replay digest:
    // changing providers must not turn an ambiguous request into a new attempt.
    // The signed envelope and ledger still bind the exact sender route.
    const requestDigest = createHash('sha256').update(JSON.stringify({
      route,
      model,
      stream,
      body_digest: createHash('sha256').update(body, 'utf8').digest('hex'),
      world_id: worldId,
      actor_id: actorId,
      purpose,
      sources: sourceSet,
      candidates: candidateSet,
      provider_evidence_cursor: providerCursorSnapshot,
      lane_a: laneASnapshot,
      host_context: hostContextSnapshot,
    }), 'utf8').digest('hex');
    let coreHead;
    let providerHead;
    let policyAuthority;
    let release = null;
    let upstreamPromise = null;
    let upstreamStartError = null;

    try {
      release = beginCoordinatorLock(this.coordinatorDb);
      const authority = getAcceptedHeadStatusSync({
        port: this.authorityPort,
        token: this.readToken,
      });
      if (authority.pending.core || authority.pending.provider
        || !authority.enrolled.core || !authority.enrolled.provider) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }

      const core = assertSyncResult(this.readCoreEvidence({
        worldId, actorId, purpose, sources: sourceSet, laneA: laneASnapshot,
        hostContext: hostContextSnapshot,
        coordinatorLease: release,
      }));
      const provider = assertSyncResult(this.readProviderEvidence({
        worldId, actorId, purpose, sources: sourceSet, candidates: candidateSet,
        providerEvidenceCursor: providerCursorSnapshot, coordinatorLease: release,
      }));
      const host = assertSyncResult(this.readHostEvidence({
        hostContext: hostContextSnapshot, worldId, actorId, purpose,
        coordinatorLease: release,
      }));
      if (core.world_id !== worldId || core.actor_id !== actorId
        || core.readiness !== 'READY' || core.inventory_status !== 'READY'
        || !Number.isSafeInteger(core.head) || core.head !== authority.heads.core) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      if (provider.world_id !== worldId || provider.actor_id !== actorId
        || provider.purpose !== purpose || provider.granted !== true
        || provider.readiness !== 'READY'
        || !Number.isSafeInteger(provider.head) || provider.head !== authority.heads.provider) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      if (host.status !== 'READY' || host.adapter_id !== hostContextSnapshot.adapter_id
        || host.core_conversation_id !== hostContextSnapshot.core_conversation_id
        || host.world_id !== worldId || host.actor_id !== actorId
        || host.root_id !== hostContextSnapshot.root_id
        || host.root_inventory_sequence !== hostContextSnapshot.root_inventory_sequence
        || host.root_manifest_sha256 !== hostContextSnapshot.root_manifest_sha256) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      assertSameSources(core.sources, sourceSet);
      assertSameSources(provider.sources, sourceSet);
      assertSameCandidates(provider.candidates, candidateSet);
      assertSameProviderEvidenceCursor(provider.provider_evidence_cursor, providerCursorSnapshot);
      policyAuthority = normalizePolicyAuthority(core.policy_authority);
      if (laneASnapshot.items.length > 0) {
        const laneAResult = revalidateLaneA(release);
        if (!laneAResult || laneAResult.status !== 'ready' || typeof laneAResult.then === 'function') {
          throw new Error('MEMORY_DISPATCH_LANE_A_REVALIDATION_DENIED');
        }
      }
      coreHead = core.head;
      providerHead = provider.head;

      // The Host must pass a dormant request-scoped transport capability
      // directly in-process. It is never accepted through the JSON Gateway
      // endpoint and is never serialized. The Host creates it from its trusted
      // provider endpoint, credentials, headers and final serialized body.
      if (!isSynchronousCallable(transport)) {
        throw new Error('MEMORY_DISPATCH_TRANSPORT_CAPABILITY_INVALID');
      }

      this.db.exec('BEGIN IMMEDIATE');
      try {
        const duplicateRequestId = this.db.prepare(
          'SELECT request_id FROM dispatch_ledger WHERE request_id=? LIMIT 1',
        ).get(requestId);
        if (duplicateRequestId) throw new Error('MEMORY_DISPATCH_DUPLICATE_ID');
        const unresolvedReplay = this.db.prepare(`
          SELECT request_id FROM dispatch_ledger
          WHERE request_digest=? AND status IN ('DISPATCH_STARTED','UNKNOWN')
          LIMIT 1
        `).get(requestDigest);
        if (unresolvedReplay) throw new Error('MEMORY_DISPATCH_REPLAY_BLOCKED');
        this.db.prepare(`
          INSERT INTO dispatch_ledger(
            request_id,request_digest,route,sender_route,model,stream,world_id,actor_id,purpose,sources_json,candidates_json,
            core_head,provider_head,policy_authority_id,policy_generation,policy_fingerprint,status,outcome_code,started_at,finished_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DISPATCH_STARTED',NULL,?,NULL)
        `).run(
          requestId,
          requestDigest,
          route,
          senderRoute,
          model,
          stream ? 1 : 0,
          worldId,
          actorId,
          purpose,
          JSON.stringify(sourceSet),
          JSON.stringify(candidateSet),
          coreHead,
          providerHead,
          policyAuthority.authority_id,
          policyAuthority.generation,
          policyAuthority.fingerprint,
          new Date().toISOString(),
        );
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        if (String(error?.message || '').indexOf('UNIQUE constraint failed') !== -1) {
          throw new Error('MEMORY_DISPATCH_DUPLICATE_ID');
        }
        throw error;
      }
      // The dormant capability is invoked exactly once, synchronously after
      // durable DISPATCH_STARTED and before releasing the shared coordinator.
      // It must initiate the final outbound request immediately and return the
      // response Promise; network I/O itself is awaited only after lock release.
      try {
        upstreamPromise = transport();
        if (!upstreamPromise || typeof upstreamPromise.then !== 'function') {
          throw new Error('MEMORY_DISPATCH_TRANSPORT_START_INVALID');
        }
      } catch (error) {
        upstreamStartError = error;
      }
    } catch (error) {
      if (error?.message === 'MEMORY_DISPATCH_DUPLICATE_ID'
        || error?.message === 'MEMORY_DISPATCH_REPLAY_BLOCKED') throw error;
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    } finally {
      try { release?.(); } catch {}
    }

    // The transport has already been synchronously handed off while the shared
    // coordinator was held. Never await network I/O under the coordinator.
    // Once DISPATCH_STARTED is durable, an ambiguous outcome is never retried.
    if (upstreamStartError) {
      try { this.#recordOutcome(requestId, 'UNKNOWN', null); } catch {}
      throw new Error('MEMORY_DISPATCH_OUTCOME_UNKNOWN');
    }
    let response;
    try {
      response = await upstreamPromise;
    } catch {
      this.#recordOutcome(requestId, 'UNKNOWN', null);
      throw new Error('MEMORY_DISPATCH_OUTCOME_UNKNOWN');
    }

    // FINAL RESPONSE REVALIDATION: after upstream completion, establish a
    // request-scoped release capability. The actual Host writes are separately
    // revalidated under the same Coordinator before every chunk/end operation.
    let finalRelease = null;
    let finalResponseAllowed = false;
    const releaseContext = {
      requestId, route, senderRoute, model, stream, worldId, actorId, purpose,
      sources: sourceSet, candidates: candidateSet, providerEvidenceCursor: providerCursorSnapshot,
      laneA: laneASnapshot, revalidateLaneA, hostContext: hostContextSnapshot,
      coreHead, providerHead, policyAuthority,
    };
    try {
      finalRelease = beginCoordinatorLock(this.coordinatorDb);
      this.#revalidateReleaseContext(releaseContext, finalRelease);
      this.pendingReleases.set(requestId, releaseContext);
      finalResponseAllowed = true;
    } catch {
      try { this.#recordOutcome(requestId, 'UNKNOWN', null); } catch {}
    } finally {
      try { finalRelease?.(); } catch { finalResponseAllowed = false; }
    }
    if (!finalResponseAllowed) {
      throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED');
    }

    if (stream && !hostTransformsStream) {
      // Native ST forwarding writes each chunk through the patched response
      // writer. Each write/end obtains a short Coordinator lease and rechecks
      // current Core/Provider authorization. No lease spans network I/O.
      try {
        const streamForwardPromise = forwardResponse(response);
        if (!streamForwardPromise || typeof streamForwardPromise.then !== 'function') {
          throw new Error('MEMORY_DISPATCH_STREAM_FORWARD_START_INVALID');
        }
        await streamForwardPromise;
        if (this.pendingReleases.has(requestId)) {
          throw new Error('MEMORY_DISPATCH_STREAM_ENDED_WITHOUT_HOST_RELEASE');
        }
      } catch {
        if (this.pendingReleases.has(requestId)) {
          const outcomeRelease = beginCoordinatorLock(this.coordinatorDb);
          try {
            this.#recordOutcome(requestId, 'UNKNOWN', null);
            this.pendingReleases.delete(requestId);
          } finally {
            outcomeRelease();
          }
        }
        throw new Error('MEMORY_DISPATCH_OUTCOME_UNKNOWN');
      }
    }
    return response;
  }

  #revalidateReleaseContext(context, coordinatorLease) {
    const currentAuthority = getAcceptedHeadStatusSync({
      port: this.authorityPort,
      token: this.readToken,
    });
    if (currentAuthority.pending.core || currentAuthority.pending.provider
      || !currentAuthority.enrolled.core || !currentAuthority.enrolled.provider
      || currentAuthority.heads.core !== context.coreHead
      || currentAuthority.heads.provider !== context.providerHead) {
      throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED');
    }
    const currentCore = assertSyncResult(this.readCoreEvidence({
      worldId: context.worldId, actorId: context.actorId, purpose: context.purpose,
      sources: context.sources, laneA: context.laneA, hostContext: context.hostContext, coordinatorLease,
    }));
    const currentProvider = assertSyncResult(this.readProviderEvidence({
      worldId: context.worldId, actorId: context.actorId, purpose: context.purpose,
      sources: context.sources, candidates: context.candidates,
      providerEvidenceCursor: context.providerEvidenceCursor, coordinatorLease,
    }));
    if (currentCore.world_id !== context.worldId || currentCore.actor_id !== context.actorId
      || currentCore.readiness !== 'READY' || currentCore.inventory_status !== 'READY'
      || currentCore.head !== context.coreHead
      || currentProvider.world_id !== context.worldId || currentProvider.actor_id !== context.actorId
      || currentProvider.purpose !== context.purpose || currentProvider.granted !== true
      || currentProvider.readiness !== 'READY' || currentProvider.head !== context.providerHead) {
      throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED');
    }
    assertSameSources(currentCore.sources, context.sources);
    assertSameSources(currentProvider.sources, context.sources);
    assertSameCandidates(currentProvider.candidates, context.candidates);
    assertSameProviderEvidenceCursor(currentProvider.provider_evidence_cursor, context.providerEvidenceCursor);
    assertSamePolicyAuthority(currentCore.policy_authority, context.policyAuthority);
    if (context.laneA.items.length > 0) {
      const laneAResult = context.revalidateLaneA(coordinatorLease);
      if (!laneAResult || laneAResult.status !== 'ready'
        || typeof laneAResult.then === 'function') {
        throw new Error('MEMORY_DISPATCH_LANE_A_REVALIDATION_DENIED');
      }
    }
    const currentHost = assertSyncResult(this.readHostEvidence({
      hostContext: context.hostContext,
      worldId: context.worldId,
      actorId: context.actorId,
      purpose: context.purpose, coordinatorLease,
    }));
    if (currentHost.status !== 'READY'
      || currentHost.adapter_id !== context.hostContext.adapter_id
      || currentHost.core_conversation_id !== context.hostContext.core_conversation_id
      || currentHost.world_id !== context.worldId || currentHost.actor_id !== context.actorId
      || currentHost.root_id !== context.hostContext.root_id
      || currentHost.root_inventory_sequence !== context.hostContext.root_inventory_sequence
      || currentHost.root_manifest_sha256 !== context.hostContext.root_manifest_sha256) {
      throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED');
    }
  }

  /** Revalidate and perform one synchronous Host write under the shared lease. */
  authorizeResponseWrite(requestId, write, { final = false } = {}) {
    if (!validText(requestId, 200) || !isSynchronousCallable(write)) {
      throw new TypeError('Invalid protected response release capability.');
    }
    const context = this.pendingReleases.get(requestId);
    if (!context) throw new Error('MEMORY_DISPATCH_RELEASE_NOT_PENDING');
    let release;
    try {
      release = beginCoordinatorLock(this.coordinatorDb);
      this.#revalidateReleaseContext(context, release);
      const result = write();
      if (result !== null && (typeof result === 'object' || typeof result === 'function')
        && typeof result.then === 'function') {
        throw new Error('MEMORY_DISPATCH_RELEASE_MUST_BE_SYNCHRONOUS');
      }
      if (final) {
        this.#recordOutcome(requestId, 'COMPLETED', null);
        this.pendingReleases.delete(requestId);
      }
      return result;
    } catch (error) {
      try {
        if (this.pendingReleases.has(requestId)) this.#recordOutcome(requestId, 'UNKNOWN', null);
      } catch {}
      this.pendingReleases.delete(requestId);
      throw new Error('MEMORY_DISPATCH_FINAL_RESPONSE_REVALIDATION_DENIED', { cause: error });
    } finally {
      try { release?.(); } catch {}
    }
  }

  #recordOutcome(requestId, status, outcomeCode) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(
        'UPDATE dispatch_ledger SET status=?,outcome_code=?,finished_at=? WHERE request_id=? AND status=?',
      ).run(status, outcomeCode, new Date().toISOString(), requestId, 'DISPATCH_STARTED');
      if (result.changes !== 1) throw new Error('DISPATCH_LEDGER_OUTCOME_CONFLICT');
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  close() {
    try { this.db?.close(); } finally { this.coordinatorDb.close(); }
  }
}
