import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSoundAudibility } from '../experiments/spatial-scene-lab/spatial-sound.js';

const makeScene = (overrides = {}) => ({
  worldId: 'sound-world',
  boundary: 'sound-boundary-1',
  entities: [
    { id: 'source', position: { x: 2, y: 2, z: 1 }, soundLevelDb: 55 },
    { id: 'listener', position: { x: 12, y: 2, z: 1 }, hearingThresholdDb: 30 },
  ],
  rooms: [
    { id: 'room-a', name: 'Room A', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
    { id: 'room-b', name: 'Room B', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
    { id: 'room-c', name: 'Room C', bounds: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 3 } } },
  ],
  zones: [
    { id: 'zone-a', name: 'Zone A', roomId: 'room-a', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
    { id: 'zone-b', name: 'Zone B', roomId: 'room-b', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
    { id: 'zone-c', name: 'Zone C', roomId: 'room-c', bounds: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 3 } } },
  ],
  doors: [
    { id: 'door-ab', name: 'Door A-B', roomA: 'room-a', roomB: 'room-b', state: 'open', soundAttenuationDb: { open: 5, closed: 25 } },
    { id: 'door-bc', name: 'Door B-C', roomA: 'room-b', roomB: 'room-c', state: 'closed', soundAttenuationDb: { open: 5, closed: 25 } },
  ],
  ...overrides,
});

test('estimates sound through an open door using explicit attenuation', () => {
  const result = estimateSoundAudibility(makeScene(), 'source', 'listener');
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.audible, true);
  assert.equal(result.estimatedReceivedLevelDb, 50);
  assert.deepEqual(result.doorPath, ['door-ab']);
});

test('closed door can attenuate a sound below the listener threshold', () => {
  const scene = makeScene({
    doors: [{ id: 'door-ab', name: 'Door A-B', roomA: 'room-a', roomB: 'room-b', state: 'closed', soundAttenuationDb: { open: 5, closed: 35 } }],
  });
  const result = estimateSoundAudibility(scene, 'source', 'listener');
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.audible, false);
});

test('unknown door state returns UNKNOWN when it could change audibility', () => {
  const scene = makeScene({
    doors: [{ id: 'door-ab', name: 'Door A-B', roomA: 'room-a', roomB: 'room-b', state: 'unknown', soundAttenuationDb: { open: 5, closed: 35 } }],
  });
  assert.deepEqual(estimateSoundAudibility(scene, 'source', 'listener'), {
    status: 'UNKNOWN',
    reason: 'UNKNOWN_DOOR_STATE_MAY_CHANGE_AUDIBILITY',
    model: 'synthetic-room-sound-v1',
  });
});

test('same-room sound does not need a door path', () => {
  const scene = makeScene({
    entities: [
      { id: 'source', position: { x: 2, y: 2, z: 1 }, soundLevelDb: 40 },
      { id: 'listener', position: { x: 4, y: 2, z: 1 }, hearingThresholdDb: 30 },
    ],
  });
  const result = estimateSoundAudibility(scene, 'source', 'listener');
  assert.equal(result.audible, true);
  assert.equal(result.attenuationDb, 0);
});

test('missing acoustic parameters fail closed', () => {
  const scene = makeScene({
    doors: [{ id: 'door-ab', name: 'Door A-B', roomA: 'room-a', roomB: 'room-b', state: 'open' }],
  });
  assert.equal(estimateSoundAudibility(scene, 'source', 'listener').reason, 'DOOR_SOUND_ATTENUATION_UNSPECIFIED');
});

test('does not imply actual hearing, noticing, or memory', () => {
  const result = estimateSoundAudibility(makeScene(), 'source', 'listener');
  assert.equal(Object.hasOwn(result, 'heardByNpc'), false);
  assert.equal(Object.hasOwn(result, 'memoryCreated'), false);
});
