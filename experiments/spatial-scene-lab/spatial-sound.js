// Research-only room-to-room sound propagation for the synthetic scene lab.
// This estimates physical audibility under explicit toy-model values. It does
// not establish that an NPC actually heard, noticed, recognized, or remembers a sound.

import { evaluateSpatialTopology } from './spatial-topology.js';

export const SPATIAL_SOUND_MODEL = 'synthetic-room-sound-v1';

function shortestAttenuation(scene, fromRoomId, toRoomId, optimisticUnknownDoors = false) {
  const distances = new Map(scene.rooms.map((room) => [room.id, Infinity]));
  const previous = new Map();
  const pending = new Set(scene.rooms.map((room) => room.id));
  distances.set(fromRoomId, 0);

  while (pending.size) {
    let current = null;
    let currentDistance = Infinity;
    for (const roomId of pending) {
      const distance = distances.get(roomId);
      if (distance < currentDistance || (distance === currentDistance && current !== null && roomId < current)) {
        current = roomId;
        currentDistance = distance;
      }
    }
    if (current === null || currentDistance === Infinity) break;
    pending.delete(current);
    if (current === toRoomId) break;

    const edges = scene.doors.filter((door) =>
      door.roomA === current || door.roomB === current
    ).sort((a, b) => a.id.localeCompare(b.id));

    for (const door of edges) {
      let attenuation;
      if (door.state === 'unknown') {
        if (!optimisticUnknownDoors) continue;
        attenuation = Math.min(door.soundAttenuationDb.open, door.soundAttenuationDb.closed);
      } else {
        attenuation = door.soundAttenuationDb[door.state];
      }
      const next = door.roomA === current ? door.roomB : door.roomA;
      const candidate = currentDistance + attenuation;
      if (candidate < distances.get(next)) {
        distances.set(next, candidate);
        previous.set(next, { roomId: current, doorId: door.id });
      }
    }
  }

  const attenuationDb = distances.get(toRoomId);
  if (!Number.isFinite(attenuationDb)) return { reachable: false };
  const roomPath = [toRoomId];
  const doorPath = [];
  let cursor = toRoomId;
  while (cursor !== fromRoomId) {
    const step = previous.get(cursor);
    if (!step) return { reachable: false };
    doorPath.unshift(step.doorId);
    roomPath.unshift(step.roomId);
    cursor = step.roomId;
  }
  return { reachable: true, attenuationDb, roomPath, doorPath };
}

function validSoundData(scene, source, listener) {
  if (!Number.isFinite(source.soundLevelDb) || !Number.isFinite(listener.hearingThresholdDb)) {
    return { status: 'UNKNOWN', reason: 'SOUND_LEVEL_OR_HEARING_THRESHOLD_MISSING' };
  }
  if (scene.doors.some((door) => !door.soundAttenuationDb ||
      !Number.isFinite(door.soundAttenuationDb.open) || door.soundAttenuationDb.open < 0 ||
      !Number.isFinite(door.soundAttenuationDb.closed) || door.soundAttenuationDb.closed < 0)) {
    return { status: 'UNKNOWN', reason: 'DOOR_SOUND_ATTENUATION_UNSPECIFIED' };
  }
  return { status: 'CONFIRMED' };
}

/**
 * Estimate whether a sound could be audible from one entity to another.
 * All sound levels and door attenuation values are explicit fixture inputs.
 * The result is not evidence of actual NPC hearing or awareness.
 */
export function estimateSoundAudibility(scene, sourceEntityId, listenerEntityId) {
  const topology = evaluateSpatialTopology(scene);
  if (topology.status !== 'CONFIRMED') {
    return { ...topology, model: SPATIAL_SOUND_MODEL };
  }
  const source = scene.entities.find((entity) => entity.id === sourceEntityId);
  const listener = scene.entities.find((entity) => entity.id === listenerEntityId);
  if (!source || !listener) {
    return { status: 'UNKNOWN', reason: 'SOURCE_OR_LISTENER_NOT_FOUND', model: SPATIAL_SOUND_MODEL };
  }
  if (sourceEntityId === listenerEntityId) {
    return { status: 'UNSUPPORTED', reason: 'SOURCE_AND_LISTENER_MUST_DIFFER', model: SPATIAL_SOUND_MODEL };
  }
  const sourceLocation = topology.locations.find((item) => item.entityId === sourceEntityId);
  const listenerLocation = topology.locations.find((item) => item.entityId === listenerEntityId);
  if (sourceLocation.status !== 'CONFIRMED' || listenerLocation.status !== 'CONFIRMED') {
    return { status: 'UNKNOWN', reason: 'SOURCE_OR_LISTENER_ROOM_UNKNOWN', model: SPATIAL_SOUND_MODEL };
  }
  const dataStatus = validSoundData(scene, source, listener);
  if (dataStatus.status !== 'CONFIRMED') return { ...dataStatus, model: SPATIAL_SOUND_MODEL };

  const requiredAttenuationDb = source.soundLevelDb - listener.hearingThresholdDb;
  if (sourceLocation.roomId === listenerLocation.roomId) {
    return {
      status: 'CONFIRMED',
      audible: requiredAttenuationDb >= 0,
      estimatedReceivedLevelDb: source.soundLevelDb,
      hearingThresholdDb: listener.hearingThresholdDb,
      attenuationDb: 0,
      roomPath: [sourceLocation.roomId],
      doorPath: [],
      reason: requiredAttenuationDb >= 0 ? 'ABOVE_THRESHOLD_SAME_ROOM' : 'BELOW_THRESHOLD_SAME_ROOM',
      model: SPATIAL_SOUND_MODEL,
    };
  }

  const knownPath = shortestAttenuation(scene, sourceLocation.roomId, listenerLocation.roomId, false);
  const optimisticPath = shortestAttenuation(scene, sourceLocation.roomId, listenerLocation.roomId, true);
  const knownAudible = knownPath.reachable && knownPath.attenuationDb <= requiredAttenuationDb;
  if (knownAudible) {
    return {
      status: 'CONFIRMED',
      audible: true,
      estimatedReceivedLevelDb: source.soundLevelDb - knownPath.attenuationDb,
      hearingThresholdDb: listener.hearingThresholdDb,
      attenuationDb: knownPath.attenuationDb,
      roomPath: knownPath.roomPath,
      doorPath: knownPath.doorPath,
      reason: 'KNOWN_ROUTE_ABOVE_THRESHOLD',
      model: SPATIAL_SOUND_MODEL,
    };
  }

  const optimisticAudible = optimisticPath.reachable &&
    optimisticPath.attenuationDb <= requiredAttenuationDb;
  if (optimisticAudible) {
    return {
      status: 'UNKNOWN',
      reason: 'UNKNOWN_DOOR_STATE_MAY_CHANGE_AUDIBILITY',
      model: SPATIAL_SOUND_MODEL,
    };
  }

  return {
    status: 'CONFIRMED',
    audible: false,
    reason: 'ALL_POSSIBLE_ROUTES_BELOW_THRESHOLD_OR_BLOCKED',
    knownRouteAttenuationDb: knownPath.reachable ? knownPath.attenuationDb : null,
    optimisticRouteAttenuationDb: optimisticPath.reachable ? optimisticPath.attenuationDb : null,
    hearingThresholdDb: listener.hearingThresholdDb,
    model: SPATIAL_SOUND_MODEL,
  };
}
