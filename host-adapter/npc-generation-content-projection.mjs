import { types as utilTypes } from 'node:util';

const isProxy = utilTypes.isProxy;
const hasOwn = Object.hasOwn;

/**
 * Copy Provider-owned JSON data before it enters the Host final-send pipeline.
 * Reject executable object behavior (Proxy/accessors/toJSON), sparse arrays,
 * non-JSON values, cycles, and excessive nesting/size. This is a projection,
 * not an authorization decision.
 */
export function snapshotNpcGenerationContent(value, {
  maxDepth = 32,
  maxNodes = 10000,
  maxArrayLength = 1000,
  maxObjectKeys = 1000,
} = {}) {
  let nodes = 0;
  const ancestors = [];

  function copy(input, depth) {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) throw new Error('NPC_GENERATION_CONTENT_INVALID');
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || isProxy(input)) throw new Error('NPC_GENERATION_CONTENT_INVALID');
    for (let index = 0; index < ancestors.length; index += 1) {
      if (ancestors[index] === input) throw new Error('NPC_GENERATION_CONTENT_INVALID');
    }
    ancestors[ancestors.length] = input;
    try {
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype || input.length > maxArrayLength) {
          throw new Error('NPC_GENERATION_CONTENT_INVALID');
        }
        const ownKeys = Reflect.ownKeys(input);
        if (ownKeys.length !== input.length + 1) throw new Error('NPC_GENERATION_CONTENT_INVALID');
        const result = new Array(input.length);
        for (let index = 0; index < input.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
            throw new Error('NPC_GENERATION_CONTENT_INVALID');
          }
          result[index] = copy(descriptor.value, depth + 1);
        }
        return Object.freeze(result);
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('NPC_GENERATION_CONTENT_INVALID');
      const keys = Reflect.ownKeys(input);
      if (keys.length > maxObjectKeys) throw new Error('NPC_GENERATION_CONTENT_INVALID');
      const result = Object.create(null);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== 'string') throw new Error('NPC_GENERATION_CONTENT_INVALID');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
          throw new Error('NPC_GENERATION_CONTENT_INVALID');
        }
        Object.defineProperty(result, key, {
          value: copy(descriptor.value, depth + 1),
          enumerable: true, writable: false, configurable: false,
        });
      }
      return Object.freeze(result);
    } finally {
      ancestors.length -= 1;
    }
  }
  return copy(value, 0);
}

/** Project only the three Provider evidence fields consumed by Final-Send. */
export function projectNpcGenerationContentBlocks(candidates) {
  if (!Array.isArray(candidates) || isProxy(candidates)
    || Object.getPrototypeOf(candidates) !== Array.prototype || candidates.length > 50) {
    throw new Error('NPC_GENERATION_CONTENT_INVALID');
  }
  const result = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const item = Object.getOwnPropertyDescriptor(candidates, String(index));
    if (!item || !item.enumerable || !hasOwn(item, 'value')) throw new Error('NPC_GENERATION_CONTENT_INVALID');
    const candidate = item.value;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || isProxy(candidate)) {
      throw new Error('NPC_GENERATION_CONTENT_INVALID');
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('NPC_GENERATION_CONTENT_INVALID');
    const fields = ['epistemic_kind', 'evidence_assessment', 'content'];
    const ownKeys = Reflect.ownKeys(candidate);
    if (ownKeys.length !== fields.length) throw new Error('NPC_GENERATION_CONTENT_INVALID');
    for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
      if (typeof ownKeys[keyIndex] !== 'string'
        || (ownKeys[keyIndex] !== fields[0] && ownKeys[keyIndex] !== fields[1] && ownKeys[keyIndex] !== fields[2])) {
        throw new Error('NPC_GENERATION_CONTENT_INVALID');
      }
    }
    const projected = {};
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex];
      const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
        throw new Error('NPC_GENERATION_CONTENT_INVALID');
      }
      if (field !== 'content' && (typeof descriptor.value !== 'string' || !descriptor.value
        || descriptor.value.length > 128)) throw new Error('NPC_GENERATION_CONTENT_INVALID');
      if (field === 'evidence_assessment' && descriptor.value !== 'supported') {
        throw new Error('NPC_GENERATION_CONTENT_INVALID');
      }
      const value = field === 'content'
        ? snapshotNpcGenerationContent(descriptor.value)
        : descriptor.value;
      Object.defineProperty(projected, field, {
        value, enumerable: true, writable: false, configurable: false,
      });
    }
    result[result.length] = Object.freeze(projected);
  }
  return Object.freeze(result);
}
