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
  if (constraints.maxRoutes !== undefined && (!Number.isSafeInteger(constraints.maxRoutes) || constraints.maxRoutes < 1 || constraints.maxRoutes > 20)) {
    return { status: 'UNKNOWN', reason: 'INVALID_MAX_ROUTES' };
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

  // An unknown door matters only if it participates in a possible route to
  // the requested destination under the same explicit constraints. Merely
  // touching the source's open component (for example, a dead-end closet) is
  // not enough to make reachability or route optimality unknown.
  let unknownCouldMatter = false;
  const possibleRouteStack = [{
    roomId: fromRoomId,
    roomPath: [fromRoomId],
    cost: 0,
    usedUnknownDoor: false,
  }];
  while (possibleRouteStack.length && !unknownCouldMatter) {
    const current = possibleRouteStack.pop();
    const doors = scene.doors.filter((door) =>
      ['open', 'unknown'].includes(door.state) &&
      !forbidden.has(door.id) &&
      (door.roomA === current.roomId || door.roomB === current.roomId)
    );
    for (const door of doors) {
      const next = door.roomA === current.roomId ? door.roomB : door.roomA;
      if (current.roomPath.includes(next)) continue;
      const cost = current.cost + door.traversalCost;
      if (constraints.maxCost !== undefined && cost > constraints.maxCost) continue;
      const usedUnknownDoor = current.usedUnknownDoor || door.state === 'unknown';
      if (next === toRoomId) {
        if (usedUnknownDoor) {
          unknownCouldMatter = true;
          break;
        }
      } else {
        possibleRouteStack.push({
          roomId: next,
          roomPath: [...current.roomPath, next],
          cost,
          usedUnknownDoor,
        });
      }
    }
  }
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
