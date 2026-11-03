import { isProxy } from 'node:util/types';
import { PROTECTED_MEMORY_SENDER_ROUTES } from '../src/security/memory-dispatch-gateway.js';

/**
 * Server-side final-send adapter for SillyTavern provider senders.
 *
 * Every generation sender must call this helper exactly once after provider
 * transformations and final body serialization. Non-generation fetches must
 * not call it. Protected Memory context is supplied by trusted Host code, never
 * copied from request JSON. The sender registry is owned by the sole Gateway.
 */
export { PROTECTED_MEMORY_SENDER_ROUTES };

const validRoute = (route) => PROTECTED_MEMORY_SENDER_ROUTES.includes(route);

function assertProtectedContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)
    || typeof context.requestId !== 'string' || !context.requestId
    || typeof context.model !== 'string' || !context.model
    || typeof context.worldId !== 'string' || !context.worldId
    || typeof context.actorId !== 'string' || !context.actorId
    || typeof context.purpose !== 'string' || !context.purpose
    || !Array.isArray(context.sources) || !Array.isArray(context.candidates)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
}

const CHAT_COMPLETION_ROUTES = new Set(PROTECTED_MEMORY_SENDER_ROUTES.filter(route =>
  !['text-completions', 'kobold', 'novelai-text', 'horde-text'].includes(route)));

const HOST_ONLY_FIELDS = new Set([
  'logic_engine_conversation_uuid',
  'logic_engine_request_id',
  'logic_engine_generation_id',
  'logic_engine_context_size',
  'logic_engine_generation_type',
  'logic_engine_memory',
  'logic_engine_protected_context',
  'memory_dispatch',
]);

function removeHostOnlyFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) removeHostOnlyFields(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (HOST_ONLY_FIELDS.has(key)) delete value[key];
    else removeHostOnlyFields(value[key]);
  }
}

function projectLaneAItems(items) {
  if (!Array.isArray(items) || items.length > 200) {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
  }
  const keys = [
    'acquisition_id', 'fact_id', 'subject_ref', 'predicate', 'value',
    'acquisition_kind', 'provenance_ref', 'provenance_digest',
    'acquisition_authorization_ref', 'source_event_ids', 'visibility_authorization_ref',
  ];
  const projected = [];
  let totalBytes = 0;
  for (let index = 0; index < items.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    }
    const item = descriptor.value;
    if (!item || typeof item !== 'object' || Array.isArray(item) || isProxy(item)
      || Object.getPrototypeOf(item) !== Object.prototype
      || Reflect.ownKeys(item).length !== keys.length
      || Reflect.ownKeys(item).some(key => typeof key !== 'string' || !keys.includes(key))) {
      throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    }
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (!property || !property.enumerable || !Object.hasOwn(property, 'value')) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
      }
    }
    for (const key of ['acquisition_id', 'fact_id', 'subject_ref', 'predicate', 'acquisition_kind',
      'provenance_ref', 'acquisition_authorization_ref', 'visibility_authorization_ref']) {
      if (typeof item[key] !== 'string' || !item[key] || item[key].length > 200) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
      }
    }
    if (typeof item.provenance_digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.provenance_digest)
      || !Array.isArray(item.source_event_ids) || item.source_event_ids.length === 0
      || item.source_event_ids.length > 200
      || item.source_event_ids.some(id => typeof id !== 'string' || !id || id.length > 200)) {
      throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    }
    const record = {
      acquisition_id: item.acquisition_id,
      fact_id: item.fact_id,
      subject_ref: item.subject_ref,
      predicate: item.predicate,
      value: item.value,
      acquisition_kind: item.acquisition_kind,
      provenance_ref: item.provenance_ref,
      provenance_digest: item.provenance_digest,
      source_event_ids: [...item.source_event_ids],
    };
    const serialized = JSON.stringify(record);
    if (typeof serialized !== 'string') throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    totalBytes += Buffer.byteLength(serialized, 'utf8');
    if (totalBytes > 512 * 1024) throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_TOO_LARGE');
    projected.push(record);
  }
  return projected;
}

function renderNpcContext(laneAItems, contentBlocks) {
  if (!Array.isArray(contentBlocks)) {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_B_INVALID');
  }
  const sections = [];
  if (Array.isArray(laneAItems) && laneAItems.length > 0) {
    const laneA = projectLaneAItems(laneAItems);
    sections.push('[Logic Engine Core Knowledge — Lane A]\n'
      + JSON.stringify({ purpose: 'npc_turn_context', completeness: 'complete', items: laneA })
      + '\n[/Logic Engine Core Knowledge — Lane A]');
  }
  if (contentBlocks.length > 0) {
    const bounded = contentBlocks.map(block => ({
      epistemic_kind: block.epistemic_kind,
      evidence_assessment: block.evidence_assessment,
      content: block.content,
    }));
    sections.push('[Logic Engine NPC Memory Context — Lane B]\n'
      + JSON.stringify({ purpose: 'npc_decision', items: bounded })
      + '\n[/Logic Engine NPC Memory Context — Lane B]');
  }
  return sections.join('\n');
}

function serializeProtectedRequestBody(requestInit, senderRoute, laneAItems, contentBlocks) {
  let body;
  try { body = JSON.parse(requestInit.body); } catch {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_BODY_INVALID');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_BODY_INVALID');
  }
  removeHostOnlyFields(body);
  const context = renderNpcContext(laneAItems, contentBlocks);
  if (context) {
    if (CHAT_COMPLETION_ROUTES.has(senderRoute)) {
      if (!Array.isArray(body.messages)) throw new Error('PROTECTED_MEMORY_FINAL_SEND_MESSAGES_MISSING');
      let insertionIndex = 0;
      while (insertionIndex < body.messages.length
        && body.messages[insertionIndex]?.role === 'system') insertionIndex += 1;
      body.messages.splice(insertionIndex, 0, { role: 'system', content: context });
    } else {
      const promptKey = senderRoute === 'novelai-text' ? 'input' : 'prompt';
      if (typeof body[promptKey] !== 'string') {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_PROMPT_MISSING');
      }
      body[promptKey] = context + '\n\n' + body[promptKey];
    }
  }
  const serialized = JSON.stringify(body);
  if (serialized.length === 0 || serialized.length > 4_000_000) {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_BODY_INVALID');
  }
  return serialized;
}
function assertRequest(endpointUrl, requestInit) {
  if (typeof endpointUrl !== 'string' || !/^https?:\/\//i.test(endpointUrl)
    || !requestInit || typeof requestInit !== 'object'
    || typeof requestInit.body !== 'string' || requestInit.body.length === 0
    || requestInit.body.length > 4_000_000
    || typeof requestInit.method !== 'string' || requestInit.method.toUpperCase() !== 'POST') {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_INVALID');
  }
}

/**
 * Create the one final-send function shared by all provider handlers.
 * fetchImpl is trusted server-side fetch; endpoint and headers must already
 * have been resolved by the provider handler. The transport closure is dormant
 * until the Gateway invokes it after durable DISPATCH_STARTED.
 */
export function createProtectedMemoryFinalSend({ gateway, resolveProtectedMemory, fetchImpl = globalThis.fetch }) {
  if (!gateway || typeof gateway.dispatchProtectedRequest !== 'function'
    || typeof resolveProtectedMemory !== 'function'
    || resolveProtectedMemory.constructor?.name === 'AsyncFunction'
    || typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid protected Memory final-send configuration.');
  }

  return function finalSend({
    senderRoute,
    endpointUrl,
    requestInit,
    hostRequestContext,
    stream = false,
    forwardResponse,
    transport: transportImpl,
    protectedMemoryOverride,
    hostTransformsStream = false,
  }) {
    assertRequest(endpointUrl, requestInit);

    // Classification is performed synchronously from trusted server-side
    // request context. It must never be inferred from browser JSON or an
    // optional caller-supplied "protected" flag.
    const protectedMemory = protectedMemoryOverride !== undefined
      ? protectedMemoryOverride
      : resolveProtectedMemory(hostRequestContext);
    if (protectedMemory && typeof protectedMemory.then === 'function') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    if (protectedMemory === undefined) throw new Error('MEMORY_DISPATCH_NOT_READY');

    // Only an explicit trusted null means this request carries no protected
    // Memory. Missing/indeterminate classification must never fall through.
    if (protectedMemory === null) {
      return (typeof transportImpl === 'function' ? transportImpl : fetchImpl)(endpointUrl, requestInit);
    }

    if (!validRoute(senderRoute)) throw new Error('MEMORY_DISPATCH_NOT_READY');
    assertProtectedContext(protectedMemory);
    if (typeof stream !== 'boolean' || typeof hostTransformsStream !== 'boolean'
      || stream && !hostTransformsStream && typeof forwardResponse !== 'function') {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }

    const laneAItems = protectedMemory.laneA?.items;
    const laneARevalidator = protectedMemory.revalidateLaneAUnderCoordinatorLease
      ?? protectedMemory.revalidateLaneA;
    if (laneAItems !== undefined && (!Array.isArray(laneAItems) || laneAItems.length > 200)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    if (Array.isArray(laneAItems) && laneAItems.length > 0
      && typeof laneARevalidator !== 'function') {
      throw new Error('MEMORY_DISPATCH_LANE_A_REVALIDATION_REQUIRED');
    }

    const exactBody = serializeProtectedRequestBody(requestInit, senderRoute,
      protectedMemory.laneA?.items ?? [], protectedMemory.contentBlocks ?? []);
    const model = protectedMemory.model;
    const controllerSignal = requestInit.signal;
    const transport = () => {
      // Calling fetchImpl is the actual transport handoff. This function is
      // deliberately non-async so the handoff happens synchronously under the
      // Gateway's coordinator lease, immediately after DISPATCH_STARTED.
      // Return the upstream response without releasing it to the Host.
      // Gateway performs FINAL RESPONSE REVALIDATION first, then starts the
      // streaming write synchronously while holding the shared Coordinator.
      return (typeof transportImpl === 'function' ? transportImpl : fetchImpl)(endpointUrl, { ...requestInit, body: exactBody });
    };

    return gateway.dispatchProtectedRequest({
      ...protectedMemory,
      revalidateLaneA: laneARevalidator,
      route: 'host-selected-chat-generation',
      senderRoute,
      model,
      stream,
      body: exactBody,
      transport,
      forwardResponse,
      hostTransformsStream,
      signal: controllerSignal,
    });
  };
}
