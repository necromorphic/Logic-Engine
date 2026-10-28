// Research-only route cost model for the synthetic spatial-scene lab.
// Costs and constraints must be explicit; this module does not choose actions or mutate world state.

export const SPATIAL_NAVIGATION_MODEL = 'synthetic-route-cost-v1';

function validate(scene, constraints) {
  if (!scene || typeof scene.worldId !== 'string' || !scene.worldId ||
      !Array.isArray(scene.rooms) || !Array.isArray(scene.doors) ||
      !Array.isArray(constraints?.forbiddenDoorIds ?? [])) {
    return { status: 'UNKNOWN', reason: 'NAVIGATION_INPUT_INCOMPLETE' };
  }
  const roomIds = new Set();
  for (const room of scene.rooms) {
    if (!room || typeof room.id !== 'string' || !room.id || roomIds.has(room.id)) {
      return { status: 'UNKNOWN', reason: 'INVALID_ROOM_DEFINITION' };
    }
    roomIds.add(room.id);
  }
  const doorIds = new Set();
  for (const door of scene.doors) {
    if (!door || typeof door.id !== 'string' || !door.id || doorIds.has(door.id) ||
        !roomIds.has(door.roomA) || !roomIds.has(door.roomB) || door.roomA === door.roomB ||
        !['open', 'closed', 'unknown'].includes(door.state) ||
        !Number.isFinite(door.traversalCost) || door.traversalCost <= 0) {
      return { status: 'UNKNOWN', reason: 'INVALID_DOOR_OR_TRAVERSAL_COST' };
    }
    doorIds.add(door.id);
  }
  if (constraints.maxCost !== undefined &&
      (!Number.isFinite(constraints.maxCost) || constraints.maxCost < 0)) {
    return { status: 'UNKNOWN', reason: 'INVALID_MAX_COST' };
  }
  if ((constraints.forbiddenDoorIds ?? []).some((id) => typeof id !== 'string' || !doorIds.has(id))) {
    return { status: 'UNKNOWN', reason: 'UNKNOWN_FORBIDDEN_DOOR_ID' };
  }
  return { status: 'CONFIRMED' };
}

/**
 * Rank simple room routes by the sum of explicit door traversal costs.
 * This is a research estimator, not a claim about real travel time or safety.
 * Unknown-state doors are never traversed; if one could connect a reachable
 * component to another room, the result flags route optimality as UNKNOWN.
 */
export function rankRoomRoutes(scene, fromRoomId, toRoomId, constraints = {}) {
  const validation = validate(scene, constraints);
  if (validation.status !== 'CONFIRMED') return { ...validation, model: SPATIAL_NAVIGATION_MODEL };
  if (!scene.rooms.some((room) => room.id === fromRoomId) ||
      !scene.rooms.some((room) => room.id === toRoomId)) {
    return { status: 'UNKNOWN', reason: 'ROOM_NOT_FOUND', model: SPATIAL_NAVIGATION_MODEL };
  }
  const forbidden = new Set(constraints.forbiddenDoorIds ?? []);
  if (fromRoomId === toRoomId) {
    return { status: 'CONFIRMED', optimality: 'CONFIRMED', routes: [{ roomPath: [fromRoomId], doorPath: [], cost: 0 }], model: SPATIAL_NAVIGATION_MODEL };
  }

  const routes = [];
  const stack = [{ roomId: fromRoomId, roomPath: [fromRoomId], doorPath: [], cost: 0 }];
  while (stack.length) {
    const current = stack.pop();
    const doors = scene.doors.filter((door) => door.state === 'open' && !forbidden.has(door.id) &&
      (door.roomA === current.roomId || door.roomB === current.roomId))
      .sort((a, b) => b.id.localeCompare(a.id));
    for (const door of doors) {
      const next = door.roomA === current.roomId ? door.roomB : door.roomA;
      if (current.roomPath.includes(next)) continue;
      const cost = current.cost + door.traversalCost;
      if (constraints.maxCost !== undefined && cost > constraints.maxCost) continue;
      const candidate = { roomId: next, roomPath: [...current.roomPath, next],
        doorPath: [...current.doorPath, door.id], cost };
      if (next === toRoomId) {
        routes.push({ roomPath: candidate.roomPath, doorPath: candidate.doorPath, cost });
      } else {
        stack.push(candidate);
      }
    }
  }

  routes.sort((a, b) => a.cost - b.cost ||
    a.doorPath.join('\u0000').localeCompare(b.doorPath.join('\u0000')));

  const openReachable = new Set([fromRoomId]);
  const queue = [fromRoomId];
  while (queue.length) {
    const roomId = queue.shift();
    for (const door of scene.doors.filter((item) => item.state === 'open' && !forbidden.has(item.id) &&
      (item.roomA === roomId || item.roomB === roomId))) {
      const next = door.roomA === roomId ? door.roomB : door.roomA;
      if (!openReachable.has(next)) { openReachable.add(next); queue.push(next); }
    }
  }
  const unknownCouldMatter = scene.doors.some((door) => door.state === 'unknown' && !forbidden.has(door.id) &&
    (openReachable.has(door.roomA) || openReachable.has(door.roomB)));
  if (!routes.length) {
    return {
      status: unknownCouldMatter ? 'UNKNOWN' : 'CONFIRMED',
      reachable: false,
      reason: unknownCouldMatter ? 'UNKNOWN_DOOR_MAY_ENABLE_ROUTE' : 'NO_ROUTE_WITH_DECLARED_CONSTRAINTS',
      optimality: unknownCouldMatter ? 'UNKNOWN' : 'CONFIRMED',
      routes: [],
      model: SPATIAL_NAVIGATION_MODEL,
    };
  }
  return {
    status: 'CONFIRMED',
    reachable: true,
    optimality: unknownCouldMatter ? 'UNKNOWN' : 'CONFIRMED',
    reason: unknownCouldMatter ? 'KNOWN_ROUTES_FOUND_BUT_UNKNOWN_DOOR_MAY_CHANGE_OPTIMUM' : 'ALL_RELEVANT_DOOR_STATES_KNOWN',
    routes: routes.slice(0, constraints.maxRoutes ?? 5),
    model: SPATIAL_NAVIGATION_MODEL,
  };
}
