import { randomUUID } from 'node:crypto';
import { createHostMemoryDispatchProxyHandler } from './st-server-digest-proxy.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
  } catch {
    return false;
  }
}

function validateRetrieval(retrieval) {
  if (!isPlainRecord(retrieval)) throw new Error('MEMORY_NPC_RESULT_INVALID');
  const keys = Object.keys(retrieval).sort().join(',');
  if (retrieval.status === 'non_ready') {
    if (keys !== 'admitted,candidates,reason,status'
      || !Array.isArray(retrieval.admitted) || !Array.isArray(retrieval.candidates)
      || retrieval.admitted.length !== 0 || retrieval.candidates.length !== 0
      || typeof retrieval.reason !== 'string' || !retrieval.reason) {
      throw new Error('MEMORY_NPC_RESULT_INVALID');
    }
    throw new Error('MEMORY_NPC_CONTEXT_NON_READY');
  }
  if (retrieval.status !== 'ready'
    || keys !== 'admitted,candidates,reason,snapshot'
    || !Array.isArray(retrieval.admitted) || !Array.isArray(retrieval.candidates)
    || retrieval.reason !== null || !isPlainRecord(retrieval.snapshot)
    || Object.keys(retrieval.snapshot).sort().join(',') !== 'commit_sequence,world_revision'
    || !Number.isSafeInteger(retrieval.snapshot.world_revision)
    || !Number.isSafeInteger(retrieval.snapshot.commit_sequence)
    || retrieval.admitted.length !== retrieval.candidates.length
    || retrieval.candidates.length > 50) {
    throw new Error('MEMORY_NPC_RESULT_INVALID');
  }
  if (retrieval.candidates.length === 0) return retrieval;
  for (let index = 0; index < retrieval.candidates.length; index += 1) {
    const candidate = retrieval.candidates[index];
    const admitted = retrieval.admitted[index];
    if (!isPlainRecord(candidate) || !isPlainRecord(admitted)
      || typeof candidate.record_ref !== 'string' || !candidate.record_ref
      || typeof candidate.record_version !== 'string' || !candidate.record_version
      || !Number.isSafeInteger(candidate.authorization_generation) || candidate.authorization_generation < 1
      || typeof candidate.source_entity_id !== 'string' || !candidate.source_entity_id
      || typeof candidate.epistemic_kind !== 'string' || !candidate.epistemic_kind
      || typeof candidate.evidence_assessment !== 'string' || !candidate.evidence_assessment
      || !isPlainRecord(candidate.content)
      || admitted.record_ref !== candidate.record_ref
      || admitted.record_version !== candidate.record_version) {
      throw new Error('MEMORY_NPC_RESULT_INVALID');
    }
  }
  return retrieval;
}

/**
 * Internal receiver for native SillyTavern generation preparation.
 * It reuses the existing Host→Core assertion and MemoryNpcConsumer route but
 * does not mount a second HTTP ingress and never sends a model request.
 */
export function createHostMemoryNpcContextReceiver({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError('Host Memory NPC receiver configuration is invalid.');
  }

  return async function receive({ hostContext, conversationUuid, contextSize = 8192, generationType = 'chat' } = {}) {
    if (!hostContext || !UUID.test(hostContext.host_installation_id ?? '')
      || !UUID.test(hostContext.authenticated_account_id ?? '')
      || !UUID.test(hostContext.host_session_id ?? '')
      || typeof hostContext.conversation_id !== 'string'
      || !UUID.test(conversationUuid ?? '')
      || !Number.isSafeInteger(contextSize) || contextSize < 1 || contextSize > 200000
      || typeof generationType !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(generationType)) {
      throw new Error('HOST_MEMORY_NPC_CONTEXT_NOT_READY');
    }

    const requestId = randomUUID();
    const handler = createHostMemoryDispatchProxyHandler({
      env,
      fetchImpl,
      timeoutMs,
      resolveHostContext: () => hostContext,
    });
    let statusCode = 200;
    let payload = null;
    const response = {
      set() { return this; },
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; },
      sendStatus(code) { statusCode = code; return this; },
    };
    await handler({
      body: { request_id: requestId, conversation_uuid: conversationUuid, context_size: contextSize, generation_type: generationType },
    }, response);
    if (statusCode !== 200 || !isPlainRecord(payload) || !Object.hasOwn(payload, 'retrieval')) {
      throw new Error('HOST_MEMORY_NPC_CONTEXT_NOT_READY');
    }
    return Object.freeze({
      requestId,
      hostContext,
      retrieval: validateRetrieval(payload.retrieval),
    });
  };
}
