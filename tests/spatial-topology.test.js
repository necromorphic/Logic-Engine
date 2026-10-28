import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLanguageModelSceneContext, evaluateSpatialTopology, findRoomRoute } from '../experiments/spatial-scene-lab/spatial-topology.js';

const rooms = [
  { id: 'office', name: 'Office', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
  { id: 'hall', name: 'Hallway', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
  { id: 'storage', name: 'Storage', bounds: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 3 } } },
];
const zones = [
  { id: 'window', name: 'by the window', roomId: 'office', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 10, z: 3 } } },
  { id: 'desk', name: 'desk area', roomId: 'office', bounds: { min: { x: 4.1, y: 0, z: 0 }, max: { x: 10, y: 10, z: 3 } } },
  { id: 'hall-center', name: 'middle of hallway', roomId: 'hall', bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 10, z: 3 } } },
  { id: 'shelves', name: 'shelves', roomId: 'storage', bounds: { min: { x: 20, y: 0, z: 0 }, max: { x: 30, y: 10, z: 3 } } },
];
const baseScene = (overrides = {}) => ({
  worldId: 'test-world',
  boundary: 'turn-7',
  entities: [
    { id: 'nimue', position: { x: 2, y: 5, z: 1 } },
    { id: 'majima', position: { x: 7, y: 5, z: 1 } },
  ],
  rooms,
  zones,
  doors: [
    { id: 'office-door', name: 'office door', roomA: 'office', roomB: 'hall', state: 'open' },
    { id: 'storage-door', name: 'storage door', roomA: 'hall', roomB: 'storage', state: 'closed' },
  ],
  ...overrides,
});

test('assigns entities to a declared room and zone deterministically', () => {
  const result = evaluateSpatialTopology(baseScene());
  assert.equal(result.status, 'CONFIRMED');
  assert.deepEqual(result.locations, [
    { entityId: 'majima', status: 'CONFIRMED', roomId: 'office', roomName: 'Office', zoneId: 'desk', zoneName: 'desk area', reason: 'POSITION_INSIDE_ONE_DECLARED_ZONE' },
    { entityId: 'nimue', status: 'CONFIRMED', roomId: 'office', roomName: 'Office', zoneId: 'window', zoneName: 'by the window', reason: 'POSITION_INSIDE_ONE_DECLARED_ZONE' },
  ]);
});

test('keeps an entity in an unmapped room region UNKNOWN rather than guessing a zone', () => {
  const scene = baseScene({
    entities: [{ id: 'npc', position: { x: 4.05, y: 5, z: 1 } }],
  });
  const result = evaluateSpatialTopology(scene);
  assert.equal(result.locations[0].status, 'UNKNOWN');
  assert.equal(result.locations[0].reason, 'POSITION_INSIDE_ROOM_BUT_ZONE_UNMAPPED');
});

test('reports conflicting overlapping zone membership instead of choosing one', () => {
  const scene = baseScene({
    zones: [...zones, { id: 'overlap', name: 'overlap', roomId: 'office', bounds: { min: { x: 1, y: 1, z: 0 }, max: { x: 3, y: 8, z: 2 } } }],
  });
  const result = evaluateSpatialTopology(scene);
  assert.equal(result.locations.find((item) => item.entityId === 'nimue').status, 'CONFLICT');
});

test('rejects zones that exceed their parent room bounds', () => {
  const scene = baseScene({
    zones: [...zones, { id: 'bad', name: 'bad', roomId: 'office', bounds: { min: { x: 1, y: 1, z: 0 }, max: { x: 11, y: 8, z: 2 } } }],
  });
  assert.deepEqual(evaluateSpatialTopology(scene), { status: 'UNKNOWN', reason: 'INVALID_ZONE_DEFINITION', model: 'synthetic-topology-v1' });
});

test('finds deterministic routes through open doors only', () => {
  const result = findRoomRoute(baseScene(), 'office', 'hall');
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.reachable, true);
  assert.deepEqual(result.roomPath, ['office', 'hall']);
  assert.deepEqual(result.doorPath, ['office-door']);
});

test('closed doors block routes when no unknown door could change the answer', () => {
  const scene = baseScene({
    doors: [
      { id: 'office-door', name: 'office door', roomA: 'office', roomB: 'hall', state: 'closed' },
      { id: 'storage-door', name: 'storage door', roomA: 'hall', roomB: 'storage', state: 'closed' },
    ],
  });
  assert.deepEqual(findRoomRoute(scene, 'office', 'hall'), {
    status: 'CONFIRMED', reachable: false, reason: 'NO_ROUTE_THROUGH_OPEN_DOORS', model: 'synthetic-topology-v1',
  });
});

test('unknown door state makes a negative reachability answer UNKNOWN', () => {
  const scene = baseScene({
    doors: [
      { id: 'office-door', name: 'office door', roomA: 'office', roomB: 'hall', state: 'unknown' },
      { id: 'storage-door', name: 'storage door', roomA: 'hall', roomB: 'storage', state: 'closed' },
    ],
  });
  assert.equal(findRoomRoute(scene, 'office', 'hall').status, 'UNKNOWN');
});

test('a known open route remains confirmed even if an unrelated door is unknown', () => {
  const scene = baseScene({
    doors: [
      { id: 'office-door', name: 'office door', roomA: 'office', roomB: 'hall', state: 'open' },
      { id: 'storage-door', name: 'storage door', roomA: 'hall', roomB: 'storage', state: 'unknown' },
    ],
  });
  assert.equal(findRoomRoute(scene, 'office', 'hall').reachable, true);
});

test('builds compact LLM context without claiming visibility or knowledge', () => {
  const result = buildLanguageModelSceneContext(baseScene(), 'majima');
  assert.equal(result.status, 'CONFIRMED');
  assert.match(result.text, /Observer location: Office \/ desk area/);
  assert.match(result.text, /Entity nimue: Office \/ by the window/);
  assert.match(result.text, /Do not infer visibility, hearing, noticing/);
  assert.equal(result.sourceStatus, 'SYNTHETIC_ONLY');
});

test('unknown observer and invalid door state fail closed', () => {
  assert.equal(buildLanguageModelSceneContext(baseScene(), 'missing').reason, 'OBSERVER_NOT_FOUND');
  const invalid = baseScene({ doors: [{ id: 'd', name: 'door', roomA: 'office', roomB: 'hall', state: 'maybe' }] });
  assert.equal(evaluateSpatialTopology(invalid).status, 'UNKNOWN');
});

test('entity outside all declared rooms has unknown location', () => {
  const scene = baseScene({ entities: [{ id: 'outside', position: { x: 50, y: 50, z: 1 } }] });
  assert.equal(evaluateSpatialTopology(scene).locations[0].reason, 'POSITION_OUTSIDE_DECLARED_ROOMS');
});
