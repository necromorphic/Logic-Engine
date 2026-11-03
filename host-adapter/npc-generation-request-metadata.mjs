import { randomUUID } from 'node:crypto';

/**
 * Create Host-owned, per-generation correlation metadata.
 *
 * These values are not authorization selectors. Core independently resolves
 * World, Actor, conversation and Memory purpose from the authenticated Host
 * session. Browser JSON must never choose or reuse the handoff identifiers.
 */
export function createNpcGenerationRequestMetadata() {
  return Object.freeze({
    request_id: randomUUID(),
    generation_id: randomUUID(),
    generation_type: 'normal',
  });
}
