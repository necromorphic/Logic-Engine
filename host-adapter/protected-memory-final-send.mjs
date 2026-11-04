import { types as utilTypes } from 'node:util';
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

function arrayContains(values, expected) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

const isProxy = utilTypes.isProxy;
const isAsyncFunction = utilTypes.isAsyncFunction;
const isGeneratorFunction = utilTypes.isGeneratorFunction;
const intrinsicFunctionToString = Function.prototype.toString;
const intrinsicReflectApply = Reflect.apply;
const intrinsicStringEndsWith = String.prototype.endsWith;
const intrinsicStringTrimStart = String.prototype.trimStart;
const intrinsicRegExpTest = RegExp.prototype.test;
const asyncGeneratorFunctionSource = /^(?:async\s+function\s*\*|async\s*\*)/;

function isSynchronousCallable(callback) {
  if (typeof callback !== 'function' || isProxy(callback)
    || isAsyncFunction(callback) || isGeneratorFunction(callback)) return false;
  try {
    const source = intrinsicReflectApply(intrinsicFunctionToString, callback, []);
    const normalized = intrinsicReflectApply(intrinsicStringTrimStart, source, []);
    if (intrinsicReflectApply(intrinsicRegExpTest, asyncGeneratorFunctionSource, [normalized])) return false;
    return !intrinsicReflectApply(intrinsicStringEndsWith, source, ['{ [native code] }']);
  } catch {
    return false;
  }
}

const validRoute = route => arrayContains(PROTECTED_MEMORY_SENDER_ROUTES, route);

function snapshotDataRecord(value, errorCode, maxKeys = 64) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) {
    throw new Error(errorCode);
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(errorCode);
    const keys = Reflect.ownKeys(value);
    if (keys.length > maxKeys) throw new Error(errorCode);
    const snapshot = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string') throw new Error(errorCode);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(errorCode);
      }
      Object.defineProperty(snapshot, key, {
        value: descriptor.value, enumerable: true, writable: false, configurable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch {
    throw new Error(errorCode);
  }
}

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

const CHAT_COMPLETION_ROUTES = [];
for (let index = 0; index < PROTECTED_MEMORY_SENDER_ROUTES.length; index += 1) {
  const route = PROTECTED_MEMORY_SENDER_ROUTES[index];
  if (route !== 'text-completions' && route !== 'kobold'
    && route !== 'novelai-text' && route !== 'horde-text') {
    CHAT_COMPLETION_ROUTES[CHAT_COMPLETION_ROUTES.length] = route;
  }
}

const HOST_ONLY_FIELDS = [
  'logic_engine_conversation_uuid',
  'logic_engine_request_id',
  'logic_engine_generation_id',
  'logic_engine_context_size',
  'logic_engine_generation_type',
  'logic_engine_memory',
  'logic_engine_protected_context',
  'memory_dispatch',
];

function removeHostOnlyFields(value) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) removeHostOnlyFields(value[index]);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (arrayContains(HOST_ONLY_FIELDS, key)) delete value[key];
    else removeHostOnlyFields(value[key]);
  }
}

function projectLaneAItems(items) {
  if (!Array.isArray(items) || isProxy(items) || items.length > 200
    || Object.getPrototypeOf(items) !== Array.prototype) {
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
    const itemDescriptor = Object.getOwnPropertyDescriptor(items, String(index));
    if (!itemDescriptor || !itemDescriptor.enumerable || !Object.hasOwn(itemDescriptor, 'value')) {
      throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    }
    const item = itemDescriptor.value;
    if (!item || typeof item !== 'object' || Array.isArray(item) || isProxy(item)
      || Object.getPrototypeOf(item) !== Object.prototype) {
      throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    }
    const ownKeys = Reflect.ownKeys(item);
    if (ownKeys.length !== keys.length) throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
      if (typeof ownKeys[keyIndex] !== 'string' || !arrayContains(keys, ownKeys[keyIndex])) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
      }
    }
    const values = Object.create(null);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      const property = Object.getOwnPropertyDescriptor(item, key);
      if (!property || !property.enumerable || !Object.hasOwn(property, 'value')) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
      }
      values[key] = property.value;
    }
    const textKeys = [
      'acquisition_id', 'fact_id', 'subject_ref', 'predicate', 'acquisition_kind',
      'provenance_ref', 'acquisition_authorization_ref', 'visibility_authorization_ref',
    ];
    for (let keyIndex = 0; keyIndex < textKeys.length; keyIndex += 1) {
      const value = values[textKeys[keyIndex]];
      if (typeof value !== 'string' || !value || value.length > 200) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
      }
    }
    const events = values.source_event_ids;
    if (typeof values.provenance_digest !== 'string' || !/^[a-f0-9]{64}$/.test(values.provenance_digest)
      || !Array.isArray(events) || isProxy(events)
      || Object.getPrototypeOf(events) !== Array.prototype || events.length > 200) {
      throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    }
    const sourceEventIds = [];
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = Object.getOwnPropertyDescriptor(events, String(eventIndex));
      if (!event || !event.enumerable || !Object.hasOwn(event, 'value')
        || typeof event.value !== 'string' || !event.value || event.value.length > 200) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
      }
      sourceEventIds[sourceEventIds.length] = event.value;
    }
    const record = {
      acquisition_id: values.acquisition_id,
      fact_id: values.fact_id,
      subject_ref: values.subject_ref,
      predicate: values.predicate,
      value: values.value,
      acquisition_kind: values.acquisition_kind,
      provenance_ref: values.provenance_ref,
      provenance_digest: values.provenance_digest,
      source_event_ids: sourceEventIds,
    };
    const serialized = JSON.stringify(record);
    if (typeof serialized !== 'string') throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_INVALID');
    totalBytes += Buffer.byteLength(serialized, 'utf8');
    if (totalBytes > 512 * 1024) throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_A_TOO_LARGE');
    projected[projected.length] = record;
  }
  return projected;
}

function renderNpcContext(laneAItems, contentBlocks) {
  if (!Array.isArray(contentBlocks) || isProxy(contentBlocks)
    || Object.getPrototypeOf(contentBlocks) !== Array.prototype || contentBlocks.length > 50) {
    throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_B_INVALID');
  }
  const sections = [];
  if (Array.isArray(laneAItems) && laneAItems.length > 0) {
    const laneA = projectLaneAItems(laneAItems);
    sections[sections.length] = '[Logic Engine Core Knowledge — Lane A]\n'
      + JSON.stringify({ purpose: 'npc_turn_context', completeness: 'complete', items: laneA })
      + '\n[/Logic Engine Core Knowledge — Lane A]';
  }
  if (contentBlocks.length > 0) {
    const bounded = [];
    for (let index = 0; index < contentBlocks.length; index += 1) {
      const blockDescriptor = Object.getOwnPropertyDescriptor(contentBlocks, String(index));
      if (!blockDescriptor || !blockDescriptor.enumerable || !Object.hasOwn(blockDescriptor, 'value')) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_B_INVALID');
      }
      const block = blockDescriptor.value;
      if (!block || typeof block !== 'object' || Array.isArray(block) || isProxy(block)
        || Object.getPrototypeOf(block) !== Object.prototype) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_B_INVALID');
      }
      const epistemic = Object.getOwnPropertyDescriptor(block, 'epistemic_kind');
      const assessment = Object.getOwnPropertyDescriptor(block, 'evidence_assessment');
      const content = Object.getOwnPropertyDescriptor(block, 'content');
      if (!epistemic || !Object.hasOwn(epistemic, 'value')
        || !assessment || !Object.hasOwn(assessment, 'value')
        || assessment.value !== 'supported'
        || !content || !Object.hasOwn(content, 'value')) {
        throw new Error('PROTECTED_MEMORY_FINAL_SEND_LANE_B_INVALID');
      }
      bounded[bounded.length] = {
        epistemic_kind: epistemic.value,
        evidence_assessment: assessment.value,
        content: content.value,
      };
    }
    sections[sections.length] = '[Logic Engine NPC Memory Context — Lane B]\n'
      + JSON.stringify({ purpose: 'npc_decision', items: bounded })
      + '\n[/Logic Engine NPC Memory Context — Lane B]';
  }
  let rendered = '';
  for (let index = 0; index < sections.length; index += 1) {
    if (index > 0) rendered += '\n';
    rendered += sections[index];
  }
  return rendered;
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
    if (arrayContains(CHAT_COMPLETION_ROUTES, senderRoute)) {
      if (!Array.isArray(body.messages)) throw new Error('PROTECTED_MEMORY_FINAL_SEND_MESSAGES_MISSING');
      let insertionIndex = 0;
      while (insertionIndex < body.messages.length
        && body.messages[insertionIndex]?.role === 'system') insertionIndex += 1;
      const messages = body.messages;
      const inserted = new Array(messages.length + 1);
      for (let index = 0; index < insertionIndex; index += 1) inserted[index] = messages[index];
      inserted[insertionIndex] = { role: 'system', content: context };
      for (let index = insertionIndex; index < messages.length; index += 1) {
        inserted[index + 1] = messages[index];
      }
      body.messages = inserted;
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
    || !isSynchronousCallable(resolveProtectedMemory)
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
    let protectedMemory = protectedMemoryOverride !== undefined
      ? protectedMemoryOverride
      : resolveProtectedMemory(hostRequestContext);

    if (protectedMemory === undefined) throw new Error('MEMORY_DISPATCH_NOT_READY');

    // Only an explicit trusted null means this request carries no protected
    // Memory. Snapshot trusted Host output before reading any field so an
    // accidental accessor/Proxy cannot execute during classification.
    if (protectedMemory === null) {
      return (typeof transportImpl === 'function' ? transportImpl : fetchImpl)(endpointUrl, requestInit);
    }
    protectedMemory = snapshotDataRecord(protectedMemory, 'MEMORY_DISPATCH_NOT_READY');
    if (typeof protectedMemory.then === 'function') throw new Error('MEMORY_DISPATCH_NOT_READY');
    if (protectedMemory.laneA !== undefined && protectedMemory.laneA !== null) {
      const laneA = snapshotDataRecord(protectedMemory.laneA, 'MEMORY_DISPATCH_NOT_READY');
      const safeContext = Object.create(null);
      const contextKeys = Reflect.ownKeys(protectedMemory);
      for (let index = 0; index < contextKeys.length; index += 1) {
        const key = contextKeys[index];
        if (typeof key !== 'string') throw new Error('MEMORY_DISPATCH_NOT_READY');
        const descriptor = Object.getOwnPropertyDescriptor(protectedMemory, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new Error('MEMORY_DISPATCH_NOT_READY');
        }
        Object.defineProperty(safeContext, key, {
          value: key === 'laneA' ? laneA : descriptor.value,
          enumerable: true, writable: false, configurable: false,
        });
      }
      protectedMemory = Object.freeze(safeContext);
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
