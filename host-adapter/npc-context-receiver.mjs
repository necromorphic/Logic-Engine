const ID = value => typeof value === 'string'
  && value === value.trim()
  && value.length > 0
  && value.length <= 200
  && ![...value].some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const UUID = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function exactDataRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value');
  });
}

function denseArray(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > max) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function copyContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)
    || Object.getPrototypeOf(content) !== Object.prototype) return null;
  const keys = Reflect.ownKeys(content);
  if (keys.length === 0 || keys.length > 32) return null;
  const output = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(content, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    const value = descriptor.value;
    if (typeof value === 'string') {
      if (value.length > 32768) return null;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
    } else if (typeof value !== 'boolean' && value !== null) {
      return null;
    }
    output[key] = value;
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
  requestId,
  model,
  purpose = 'npc_decision',
} = {}) {
  if (!UUID(requestId) || !ID(model) || !ID(purpose)
    || !exactDataRecord(hostContext, ['adapter_id', 'conversation_id', 'world_id', 'actor_id', 'actor_type'])
    || !ID(hostContext.adapter_id) || !ID(hostContext.conversation_id)
    || !ID(hostContext.world_id) || !ID(hostContext.actor_id) || !ID(hostContext.actor_type)) {
    throw new Error('NPC_CONTEXT_SCOPE_INVALID');
  }
  if (!exactDataRecord(retrieval, ['status', 'admitted', 'candidates', 'reason', 'snapshot'])
    || retrieval.status !== 'ready' || retrieval.reason !== null
    || !denseArray(retrieval.admitted, 50) || !denseArray(retrieval.candidates, 50)
    || retrieval.admitted.length !== retrieval.candidates.length
    || !exactDataRecord(retrieval.snapshot, ['world_revision', 'commit_sequence'])
    || !Number.isSafeInteger(retrieval.snapshot.world_revision) || retrieval.snapshot.world_revision < 0
    || !Number.isSafeInteger(retrieval.snapshot.commit_sequence) || retrieval.snapshot.commit_sequence < 0) {
    throw new Error('NPC_CONTEXT_NON_READY');
  }

  const sourcesByIdentity = new Map();
  const candidates = [];
  const contentBlocks = [];
  const seenRecords = new Set();
  let totalContentBytes = 0;

  for (let index = 0; index < retrieval.candidates.length; index += 1) {
    const admitted = retrieval.admitted[index];
    const candidate = retrieval.candidates[index];
    if (!exactDataRecord(admitted, ['record_ref', 'record_version', 'epistemic_kind', 'evidence_assessment'])
      || !exactDataRecord(candidate, [
        'record_ref', 'record_version', 'authorization_generation', 'source_entity_id',
        'source_version', 'epistemic_kind', 'evidence_assessment', 'content',
      ])) throw new Error('NPC_CONTEXT_CANDIDATE_INVALID');

    if (!ID(candidate.record_ref) || !ID(candidate.record_version)
      || !Number.isSafeInteger(candidate.authorization_generation) || candidate.authorization_generation < 1
      || !ID(candidate.source_entity_id) || !ID(candidate.source_version)
      || !ID(candidate.epistemic_kind) || !ID(candidate.evidence_assessment)
      || admitted.record_ref !== candidate.record_ref
      || admitted.record_version !== candidate.record_version
      || admitted.epistemic_kind !== candidate.epistemic_kind
      || admitted.evidence_assessment !== candidate.evidence_assessment) {
      throw new Error('NPC_CONTEXT_CANDIDATE_SCOPE_MISMATCH');
    }
    const recordIdentity = JSON.stringify([candidate.record_ref, candidate.record_version]);
    if (seenRecords.has(recordIdentity)) throw new Error('NPC_CONTEXT_DUPLICATE_RECORD');
    seenRecords.add(recordIdentity);

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

  const sources = [...sourcesByIdentity.values()];
  if (sources.length === 0 && candidates.length !== 0) throw new Error('NPC_CONTEXT_SOURCE_SET_INVALID');
  return Object.freeze({
    requestId,
    model,
    worldId: hostContext.world_id,
    actorId: hostContext.actor_id,
    purpose,
    sources: Object.freeze(sources),
    candidates: Object.freeze(candidates),
    contentBlocks: Object.freeze(contentBlocks),
    snapshot: Object.freeze({
      world_revision: retrieval.snapshot.world_revision,
      commit_sequence: retrieval.snapshot.commit_sequence,
    }),
  });
}
