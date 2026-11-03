import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcGenerationRequestMetadata } from '../npc-generation-request-metadata.mjs';

test('NPC generation metadata is minted by Host and is immutable', () => {
  const first = createNpcGenerationRequestMetadata();
  const second = createNpcGenerationRequestMetadata();

  for (const metadata of [first, second]) {
    assert.equal(Object.isFrozen(metadata), true);
    assert.match(metadata.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.match(metadata.generation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(metadata.generation_type, 'normal');
  }
  assert.notEqual(first.request_id, second.request_id);
  assert.notEqual(first.generation_id, second.generation_id);
});

test('Host generation metadata contains no browser-provided identity or authorization selectors', () => {
  const metadata = createNpcGenerationRequestMetadata();
  assert.deepEqual(Object.keys(metadata).sort(), ['generation_id', 'generation_type', 'request_id']);
  assert.equal(Object.hasOwn(metadata, 'world_id'), false);
  assert.equal(Object.hasOwn(metadata, 'actor_id'), false);
  assert.equal(Object.hasOwn(metadata, 'conversation_id'), false);
  assert.equal(Object.hasOwn(metadata, 'purpose'), false);
});
