// Research-only topology layer for the synthetic spatial-scene lab.
// It produces structured room/zone/door facts and a compact text context for an LLM.
// It is not imported by production Core, Host, Memory, or NPC code.

export const SPATIAL_TOPOLOGY_MODEL = 'synthetic-topology-v1';
const AXES = ['x', 'y', 'z'];

const finitePoint = (p) => p && AXES.every((axis) => Number.isFinite(p[axis]));
const validBounds = (b) => b && finitePoint(b.min) && finitePoint(b.max) &&
  AXES.every((axis) => b.min[axis] <= b.max[axis]);
const containsPoint = (bounds, point) => AXES.every((axis) =>
  point[axis] >= bounds.min[axis] && point[axis] <= bounds.max[axis]);
const boundsInside = (inner, outer) => AXES.every((axis) =>
  inner.min[axis] >= outer.min[axis] && inner.max[axis] <= outer.max[axis]);

function validateTopology(scene) {
  if (!scene || typeof scene.worldId !== 'string' || !scene.worldId ||
      typeof scene.boundary !== 'string' || !scene.boundary ||
      !Array.isArray(scene.entities) || !Array.isArray(scene.rooms) ||
      !Array.isArray(scene.zones) || !Array.isArray(scene.doors)) {
    return { status: 'UNKNOWN', reason: 'TOPOLOGY_INCOMPLETE' };
  }

  const roomIds = new Set();
  for (const room of scene.rooms) {
    if (!room || typeof room.id !== 'string' || !room.id || roomIds.has(room.id) ||
        typeof room.name !== 'string' || !room.name || !validBounds(room.bounds)) {
      return { status: 'UNKNOWN', reason: 'INVALID_ROOM_DEFINITION' };
    }
    roomIds.add(room.id);
  }

  const zoneIds = new Set();
  for (const zone of scene.zones) {
    const room = zone && scene.rooms.find((candidate) => candidate.id === zone.roomId);
    if (!zone || typeof zone.id !== 'string' || !zone.id || zoneIds.has(zone.id) ||
        typeof zone.name !== 'string' || !zone.name || !room ||
        !validBounds(zone.bounds) || !boundsInside(zone.bounds, room.bounds)) {
      return { status: 'UNKNOWN', reason: 'INVALID_ZONE_DEFINITION' };
    }
    zoneIds.add(zone.id);
  }

  const doorIds = new Set();
  for (const door of scene.doors) {
    if (!door || typeof door.id !== 'string' || !door.id || doorIds.has(door.id) ||
        typeof door.name !== 'string' || !door.name ||
        !roomIds.has(door.roomA) || !roomIds.has(door.roomB) ||
        door.roomA === door.roomB || !['open', 'closed', 'unknown'].includes(door.state)) {
      return { status: 'UNKNOWN', reason: 'INVALID_DOOR_DEFINITION' };
    }
    doorIds.add(door.id);
  }

  const entityIds = new Set();
  for (const entity of scene.entities) {
    if (!entity || typeof entity.id !== 'string' || !entity.id || entityIds.has(entity.id) ||
        !finitePoint(entity.position)) {
      return { status: 'UNKNOWN', reason: 'INVALID_ENTITY_POSITION' };
    }
    entityIds.add(entity.id);
  }

  return { status: 'CONFIRMED' };
}

function locateEntity(scene, entity) {
  const zones = scene.zones.filter((zone) => containsPoint(zone.bounds, entity.position));
  if (zones.length > 1) {
    return { status: 'CONFLICT', reason: 'POSITION_MATCHES_MULTIPLE_ZONES' };
  }
  if (zones.length === 1) {
    const zone = zones[0];
    const room = scene.rooms.find((item) => item.id === zone.roomId);
    return {
      status: 'CONFIRMED',
      roomId: room.id,
      roomName: room.name,
      zoneId: zone.id,
      zoneName: zone.name,
      reason: 'POSITION_INSIDE_ONE_DECLARED_ZONE',
    };
  }
  const rooms = scene.rooms.filter((room) => containsPoint(room.bounds, entity.position));
  if (rooms.length > 1) return { status: 'CONFLICT', reason: 'POSITION_MATCHES_MULTIPLE_ROOMS' };
  if (rooms.length === 1) {
    return {
      status: 'UNKNOWN',
      roomId: rooms[0].id,
      roomName: rooms[0].name,
      reason: 'POSITION_INSIDE_ROOM_BUT_ZONE_UNMAPPED',
    };
  }
  return { status: 'UNKNOWN', reason: 'POSITION_OUTSIDE_DECLARED_ROOMS' };
}

/**
 * Assign synthetic entity positions to declared rooms/zones. This reports only
 * geometric containment. It does not imply that any observer sees or knows it.
 */
export function evaluateSpatialTopology(scene) {
  const validation = validateTopology(scene);
  if (validation.status !== 'CONFIRMED') {
    return { ...validation, model: SPATIAL_TOPOLOGY_MODEL };
  }
  const locations = scene.entities.map((entity) => ({
    entityId: entity.id,
    ...locateEntity(scene, entity),
  })).sort((a, b) => a.entityId.localeCompare(b.entityId));

  return {
    status: 'CONFIRMED',
    model: SPATIAL_TOPOLOGY_MODEL,
    worldId: scene.worldId,
    boundary: scene.boundary,
    locations,
  };
}

/**
 * Find a route through explicitly open doors. Closed doors are barriers.
 * If no open route exists but an unknown door could change the answer, return
 * UNKNOWN rather than claiming the rooms are disconnected.
 */
export function findRoomRoute(scene, fromRoomId, toRoomId) {
  const validation = validateTopology(scene);
  if (validation.status !== 'CONFIRMED') {
    return { ...validation, model: SPATIAL_TOPOLOGY_MODEL };
  }
  if (!scene.rooms.some((room) => room.id === fromRoomId) ||
      !scene.rooms.some((room) => room.id === toRoomId)) {
    return { status: 'UNKNOWN', reason: 'ROOM_NOT_FOUND', model: SPATIAL_TOPOLOGY_MODEL };
  }
  if (fromRoomId === toRoomId) {
    return { status: 'CONFIRMED', reachable: true, roomPath: [fromRoomId], doorPath: [], model: SPATIAL_TOPOLOGY_MODEL };
  }

  const queue = [{ roomId: fromRoomId, roomPath: [fromRoomId], doorPath: [] }];
  const visited = new Set([fromRoomId]);
  while (queue.length) {
    const current = queue.shift();
    const edges = scene.doors
      .filter((door) => door.state === 'open' && (door.roomA === current.roomId || door.roomB === current.roomId))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const door of edges) {
      const nextRoom = door.roomA === current.roomId ? door.roomB : door.roomA;
      if (visited.has(nextRoom)) continue;
      const roomPath = [...current.roomPath, nextRoom];
      const doorPath = [...current.doorPath, door.id];
      if (nextRoom === toRoomId) {
        return { status: 'CONFIRMED', reachable: true, roomPath, doorPath, model: SPATIAL_TOPOLOGY_MODEL };
      }
      visited.add(nextRoom);
      queue.push({ roomId: nextRoom, roomPath, doorPath });
    }
  }

  const unknownDoorCouldConnect = scene.doors.some((door) => door.state === 'unknown');
  if (unknownDoorCouldConnect) {
    return { status: 'UNKNOWN', reason: 'UNKNOWN_DOOR_STATE_MAY_CHANGE_REACHABILITY', model: SPATIAL_TOPOLOGY_MODEL };
  }
  return { status: 'CONFIRMED', reachable: false, reason: 'NO_ROUTE_THROUGH_OPEN_DOORS', model: SPATIAL_TOPOLOGY_MODEL };
}

/**
 * Render a compact, explicitly bounded context snippet for a language model.
 * No visibility, hearing, attention, knowledge, or memory is inferred here.
 */
export function buildLanguageModelSceneContext(scene, observerId) {
  const topology = evaluateSpatialTopology(scene);
  if (topology.status !== 'CONFIRMED') return topology;
  const observer = scene.entities.find((entity) => entity.id === observerId);
  if (!observer) return { status: 'UNKNOWN', reason: 'OBSERVER_NOT_FOUND', model: SPATIAL_TOPOLOGY_MODEL };

  const observerLocation = topology.locations.find((item) => item.entityId === observerId);
  const lines = [
    'SYNTHETIC SCENE CONTEXT — research fixture, not canonical world state.',
    `Boundary: ${scene.boundary}`,
  ];

  if (observerLocation.status === 'CONFIRMED') {
    lines.push(`Observer location: ${observerLocation.roomName} / ${observerLocation.zoneName}.`);
  } else {
    lines.push(`Observer location: UNKNOWN (${observerLocation.reason}).`);
  }

  for (const location of topology.locations) {
    if (location.entityId === observerId) continue;
    if (location.status === 'CONFIRMED') {
      lines.push(`Entity ${location.entityId}: ${location.roomName} / ${location.zoneName} (geometric location only).`);
    } else {
      lines.push(`Entity ${location.entityId}: location UNKNOWN (${location.reason}).`);
    }
  }

  for (const door of [...scene.doors].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`Door ${door.id} (${door.name}): ${door.state}; connects ${door.roomA} and ${door.roomB}.`);
  }
  lines.push('Do not infer visibility, hearing, noticing, identity recognition, knowledge, or memory from location alone.');
  lines.push('Unknown or conflicting facts must remain unknown; do not fill gaps with narrative guesses.');

  return {
    status: 'CONFIRMED',
    model: SPATIAL_TOPOLOGY_MODEL,
    worldId: scene.worldId,
    boundary: scene.boundary,
    observerId,
    text: lines.join('\n'),
    sourceStatus: 'SYNTHETIC_ONLY',
  };
}
