import { types as utilTypes } from 'node:util';
import { createHash } from 'node:crypto';

const ID = value => typeof value === 'string'
  && value === value.trim()
  && value.length > 0
  && value.length <= 200
  && ![...value].some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const KNOWN_EVIDENCE_ASSESSMENTS = new Set([
  'unassessed', 'supported', 'disputed', 'insufficient',
]);

const UUID = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function exactDataRecord(value, keys) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value');
  });
}

function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) {
    throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || !denseArray(value, 64)) {
      throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');
    }
    const output = value.map((item, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');
      }
      return canonicalJson(descriptor.value, seen);
    });
    seen.delete(value);
    return output;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');
  const output = Object.create(null);
  for (const key of keys.sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');
    }
    output[key] = canonicalJson(descriptor.value, seen);
  }
  seen.delete(value);
  return output;
}

function validProviderEvidenceCursor(value) {
  return exactDataRecord(value, ['data_version', 'candidate_digest'])
    && Number.isSafeInteger(value.data_version) && value.data_version >= 0
    && typeof value.candidate_digest === 'string'
    && /^[a-f0-9]{64}$/.test(value.candidate_digest);
}

function denseArray(value, max) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > max) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function copyJsonValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') return value.length <= 32768
    ? { ok: true, value } : { ok: false };
  if (typeof value === 'number') return Number.isFinite(value)
    ? { ok: true, value } : { ok: false };
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || depth >= 4
    || seen.has(value)) return { ok: false };
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 64
      || !denseArray(value, 64)) return { ok: false };
    const output = [];
    for (const item of value) {
      const copied = copyJsonValue(item, depth + 1, seen);
      if (!copied.ok) return { ok: false };
      output.push(copied.value);
    }
    return { ok: true, value: Object.freeze(output) };
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return { ok: false };
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) return { ok: false };
  const output = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)) return { ok: false };
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return { ok: false };
    const copied = copyJsonValue(descriptor.value, depth + 1, seen);
    if (!copied.ok) return { ok: false };
    output[key] = copied.value;
  }
  return { ok: true, value: Object.freeze(output) };
}

function copyContent(content) {
  if (!content || typeof content !== 'object' || utilTypes.isProxy(content) || Array.isArray(content)
    || Object.getPrototypeOf(content) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(content);
  if (keys.length === 0 || keys.length > 32) return null;
  const output = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(content, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    const copied = copyJsonValue(descriptor.value);
    if (!copied.ok) return null;
    output[key] = copied.value;
  }
  return Object.freeze(output);
}

/**
 * Converts only a Core-produced, ready MemoryNpcConsumer result into the
 * server-owned Final-Send context. Browser-supplied Memory fields are never
 * accepted here. Candidate content is kept separate from the metadata sent to
 * the durable Gateway ledger and is serialized only by protected final-send.
 */
export function receiveNpcContext({
  retrieval,
  hostContext,
  hostBinding,
  requestId,
  generationId,
  runId,
  model,
  purpose = 'npc_decision',
} = {}) {
  if (!UUID(requestId) || !UUID(generationId) || !UUID(runId) || !ID(model) || !ID(purpose)
    || !exactDataRecord(hostContext, ['adapter_id', 'conversation_id', 'world_id', 'actor_id', 'actor_type'])
    || !ID(hostContext.adapter_id) || !ID(hostContext.conversation_id)
    || !ID(hostContext.world_id) || !ID(hostContext.actor_id) || !ID(hostContext.actor_type)
    || !exactDataRecord(hostBinding, [
      'host_installation_id', 'authenticated_account_id', 'host_session_id', 'conversation_id',
      'conversation_uuid', 'root_id', 'root_inventory_sequence', 'root_manifest_sha256',
      'adapter_id', 'world_id', 'actor_id', 'actor_type',
    ])
    || !UUID(hostBinding.host_installation_id) || !UUID(hostBinding.authenticated_account_id)
    || !UUID(hostBinding.host_session_id) || !UUID(hostBinding.conversation_uuid)
    || !ID(hostBinding.conversation_id) || !ID(hostBinding.adapter_id)
    || !ID(hostBinding.world_id) || !ID(hostBinding.actor_id) || !ID(hostBinding.actor_type)
    || hostBinding.adapter_id !== hostContext.adapter_id
    || hostBinding.world_id !== hostContext.world_id
    || hostBinding.actor_id !== hostContext.actor_id
    || hostBinding.actor_type !== hostContext.actor_type
    || hostBinding.conversation_id !== [
      hostBinding.host_installation_id, hostBinding.authenticated_account_id, hostBinding.conversation_uuid,
    ].join(':')
    || hostContext.conversation_id !== [
      hostBinding.host_session_id, hostBinding.host_installation_id, hostBinding.conversation_uuid,
    ].join(':')
    || !/^[a-f0-9]{64}$/.test(hostBinding.root_id ?? '')
    || !Number.isSafeInteger(hostBinding.root_inventory_sequence) || hostBinding.root_inventory_sequence < 1
    || !/^[a-f0-9]{64}$/.test(hostBinding.root_manifest_sha256 ?? '')) {
    throw new Error('NPC_CONTEXT_SCOPE_INVALID');
  }
  if (!exactDataRecord(retrieval, [
    'status', 'admitted', 'candidates', 'reason', 'snapshot', 'provider_evidence_cursor',
  ])
    || retrieval.status !== 'ready' || retrieval.reason !== null
    || !denseArray(retrieval.admitted, 50) || !denseArray(retrieval.candidates, 50)
    || retrieval.admitted.length > retrieval.candidates.length
    || !validProviderEvidenceCursor(retrieval.provider_evidence_cursor)
    || !exactDataRecord(retrieval.snapshot, ['world_revision', 'commit_sequence'])
    || !Number.isSafeInteger(retrieval.snapshot.world_revision) || retrieval.snapshot.world_revision < 0
    || !Number.isSafeInteger(retrieval.snapshot.commit_sequence) || retrieval.snapshot.commit_sequence < 0) {
    throw new Error('NPC_CONTEXT_NON_READY');
  }

  const coreEnvelopeDigest = createHash('sha256')
    .update(JSON.stringify(canonicalJson(retrieval)), 'utf8')
    .digest('hex');

  const admittedByIdentity = new Map();
  for (const admitted of retrieval.admitted) {
    if (!exactDataRecord(admitted, ['record_ref', 'record_version', 'epistemic_kind', 'evidence_assessment'])
      || !ID(admitted.record_ref) || !ID(admitted.record_version)
      || !ID(admitted.epistemic_kind) || admitted.evidence_assessment !== 'supported') {
      throw new Error('NPC_CONTEXT_CANDIDATE_SCOPE_MISMATCH');
    }
    const identity = JSON.stringify([admitted.record_ref, admitted.record_version]);
    if (admittedByIdentity.has(identity)) throw new Error('NPC_CONTEXT_DUPLICATE_RECORD');
    admittedByIdentity.set(identity, admitted);
  }

  const sourcesByIdentity = new Map();
  const candidates = [];
  const contentBlocks = [];
  const seenRecords = new Set();
  let totalContentBytes = 0;

  for (let index = 0; index < retrieval.candidates.length; index += 1) {
    const candidate = retrieval.candidates[index];
    if (!exactDataRecord(candidate, [
      'record_ref', 'record_version', 'authorization_generation', 'source_entity_id',
      'source_version', 'epistemic_kind', 'evidence_assessment', 'content',
    ])) throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');

    if (!ID(candidate.record_ref) || !ID(candidate.record_version)
      || !Number.isSafeInteger(candidate.authorization_generation) || candidate.authorization_generation < 1
      || !ID(candidate.source_entity_id) || !ID(candidate.source_version)
      || !ID(candidate.epistemic_kind) || !KNOWN_EVIDENCE_ASSESSMENTS.has(candidate.evidence_assessment)) {
      throw new Error('NPC_CONTEXT_CANDIDATE_SCOPE_MISMATCH');
    }
    const recordIdentity = JSON.stringify([candidate.record_ref, candidate.record_version]);
    if (seenRecords.has(recordIdentity)) throw new Error('NPC_CONTEXT_DUPLICATE_RECORD');
    seenRecords.add(recordIdentity);

    const admitted = admittedByIdentity.get(recordIdentity);
    if (!admitted) {
      // Non-supported evidence remains available to Core for classification,
      // but it must never be projected into model context. A supported record
      // without an admission proof is an incomplete result, not an empty one.
      if (candidate.evidence_assessment === 'supported') {
        throw new Error('NPC_CONTEXT_NON_READY');
      }
      continue;
    }
    if (candidate.evidence_assessment !== 'supported'
      || admitted.record_ref !== candidate.record_ref
      || admitted.record_version !== candidate.record_version
      || admitted.epistemic_kind !== candidate.epistemic_kind
      || admitted.evidence_assessment !== candidate.evidence_assessment) {
      throw new Error('NPC_CONTEXT_CANDIDATE_SCOPE_MISMATCH');
    }
    admittedByIdentity.delete(recordIdentity);

    const content = copyContent(candidate.content);
    if (!content) throw new Error('NPC_CONTEXT_CONTENT_INVALID');
    const contentJson = JSON.stringify(content);
    totalContentBytes += Buffer.byteLength(contentJson, 'utf8');
    if (totalContentBytes > 512 * 1024) throw new Error('NPC_CONTEXT_CONTENT_LIMIT_EXCEEDED');

    const sourceIdentity = JSON.stringify([candidate.source_entity_id, candidate.source_version]);
    sourcesByIdentity.set(sourceIdentity, Object.freeze({
      source_kind: 'canonical_entity',
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    }));
    candidates.push(Object.freeze({
      record_ref: candidate.record_ref,
      record_version: candidate.record_version,
      authorization_generation: candidate.authorization_generation,
      source_kind: 'canonical_entity',
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    }));
    contentBlocks.push(Object.freeze({
      epistemic_kind: candidate.epistemic_kind,
      evidence_assessment: candidate.evidence_assessment,
      content,
    }));
  }
  if (admittedByIdentity.size !== 0) throw new Error('NPC_CONTEXT_CANDIDATE_SCOPE_MISMATCH');

  const sources = [...sourcesByIdentity.values()];
  if (sources.length === 0 && candidates.length !== 0) throw new Error('NPC_CONTEXT_SOURCE_SET_INVALID');
  const immutableEvidence = {
    runId,
    requestId,
    generationId,
    coreEnvelopeDigest,
    model,
    purpose,
    worldId: hostContext.world_id,
    actorId: hostContext.actor_id,
    sources,
    candidates,
    contentBlocks,
    snapshot: {
      world_revision: retrieval.snapshot.world_revision,
      commit_sequence: retrieval.snapshot.commit_sequence,
    },
    providerEvidenceCursor: {
      data_version: retrieval.provider_evidence_cursor.data_version,
      candidate_digest: retrieval.provider_evidence_cursor.candidate_digest,
    },
    hostContext: {
      adapter_id: hostContext.adapter_id,
      core_conversation_id: hostContext.conversation_id,
      world_id: hostContext.world_id,
      actor_id: hostContext.actor_id,
      actor_type: hostContext.actor_type,
      host_installation_id: hostBinding.host_installation_id,
      authenticated_account_id: hostBinding.authenticated_account_id,
      host_session_id: hostBinding.host_session_id,
      host_conversation_id: hostBinding.conversation_id,
      conversation_uuid: hostBinding.conversation_uuid,
      root_id: hostBinding.root_id,
      root_inventory_sequence: hostBinding.root_inventory_sequence,
      root_manifest_sha256: hostBinding.root_manifest_sha256,
    },
  };
  const contextDigest = createHash('sha256')
    .update(JSON.stringify(canonicalJson(immutableEvidence)), 'utf8')
    .digest('hex');
  return Object.freeze({
    runId,
    requestId,
    generationId,
    contextDigest,
    coreEnvelopeDigest,
    model,
    worldId: hostContext.world_id,
    actorId: hostContext.actor_id,
    purpose,
    sources: Object.freeze(sources),
    candidates: Object.freeze(candidates),
    contentBlocks: Object.freeze(contentBlocks),
    hostContext: Object.freeze({
      adapter_id: hostContext.adapter_id,
      core_conversation_id: hostContext.conversation_id,
      world_id: hostContext.world_id,
      actor_id: hostContext.actor_id,
      actor_type: hostContext.actor_type,
      host_installation_id: hostBinding.host_installation_id,
      authenticated_account_id: hostBinding.authenticated_account_id,
      host_session_id: hostBinding.host_session_id,
      host_conversation_id: hostBinding.conversation_id,
      conversation_uuid: hostBinding.conversation_uuid,
      root_id: hostBinding.root_id,
      root_inventory_sequence: hostBinding.root_inventory_sequence,
      root_manifest_sha256: hostBinding.root_manifest_sha256,
    }),
    snapshot: Object.freeze({
      world_revision: retrieval.snapshot.world_revision,
      commit_sequence: retrieval.snapshot.commit_sequence,
    }),
  });
}
