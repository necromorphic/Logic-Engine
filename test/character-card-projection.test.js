import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCharacterCard } from '../src/application/character-card-projection.js';

const snapshot = () => ({
  world_id: 'world-a',
  world_revision: 7,
  entities: [{
    entity_id: 'entity-1',
    entity_type: 'character',
    status: 'active',
    attributes: {
      name: 'Visible only after an explicit schema is approved',
      secret: 'must not leak',
      private_intention: 'must not leak',
    },
    created_by_event_id: 'event-1',
    updated_revision: 6,
  }],
  facts: [{
    fact_id: 'fact-secret',
    predicate: 'secret',
    value: 'must not leak',
  }],
});

test('projects only approved identity/status metadata and source revision', () => {
  const result = projectCharacterCard(snapshot(), 'entity-1', {
    supportedEntityTypes: ['character'],
  });

  assert.deepEqual(result, {
    projection_version: 'character-card-read-v1',
    world_id: 'world-a',
    entity_id: 'entity-1',
    entity_type: 'character',
    status: 'active',
    source_revision: 7,
  });
});

test('does not mutate its input and produces deterministic output', () => {
  const source = snapshot();
  const before = structuredClone(source);
  const options = { supportedEntityTypes: ['character'] };

  const first = projectCharacterCard(source, 'entity-1', options);
  const second = projectCharacterCard(source, 'entity-1', options);

  assert.deepEqual(first, second);
  assert.deepEqual(source, before);
});

test('fails closed if the caller does not supply an explicit type allowlist', () => {
  assert.throws(
    () => projectCharacterCard(snapshot(), 'entity-1'),
    (error) => error.code === 'CHARACTER_TYPE_ALLOWLIST_REQUIRED',
  );
  assert.throws(
    () => projectCharacterCard(snapshot(), 'entity-1', { supportedEntityTypes: [] }),
    (error) => error.code === 'CHARACTER_TYPE_ALLOWLIST_REQUIRED',
  );
});

test('rejects entity types outside the explicit allowlist', () => {
  assert.throws(
    () => projectCharacterCard(snapshot(), 'entity-1', { supportedEntityTypes: ['npc'] }),
    (error) => error.code === 'UNSUPPORTED_CHARACTER_ENTITY_TYPE' && error.status === 422,
  );
});

test('returns a typed not-found error for an entity absent from this snapshot', () => {
  assert.throws(
    () => projectCharacterCard(snapshot(), 'entity-from-another-world', {
      supportedEntityTypes: ['character'],
    }),
    (error) => error.code === 'ENTITY_NOT_FOUND' && error.status === 404,
  );
});

test('rejects malformed projected entity metadata instead of emitting undefined fields', () => {
  const source = snapshot();
  source.entities[0].status = undefined;

  assert.throws(
    () => projectCharacterCard(source, 'entity-1', {
      supportedEntityTypes: ['character'],
    }),
    (error) => error.code === 'INVALID_PROJECTION_ENTITY',
  );
});

test('does not copy arbitrary attributes, raw facts, or source event payloads', () => {
  const result = projectCharacterCard(snapshot(), 'entity-1', {
    supportedEntityTypes: ['character'],
  });

  assert.equal('attributes' in result, false);
  assert.equal('facts' in result, false);
  assert.equal('profile' in result, false);
  assert.equal('known_state' in result, false);
  assert.equal('created_by_event_id' in result, false);
});
