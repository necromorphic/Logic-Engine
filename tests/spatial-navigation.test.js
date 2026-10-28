import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRoomRoutes } from '../experiments/spatial-scene-lab/spatial-navigation.js';

const scene = (doors, overrides = {}) => ({
  worldId: 'synthetic-nav-world',
  rooms: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  doors,
  ...overrides,
});
const door = (id, roomA, roomB, traversalCost, state = 'open') =>
  ({ id, roomA, roomB, traversalCost, state });

test('ranks routes by explicit total traversal cost, not number of doors', () => {
  const result = rankRoomRoutes(scene([
    door('a-b', 'a', 'b', 2), door('b-d', 'b', 'd', 2),
    door('a-c', 'a', 'c', 1), door('c-d', 'c', 'd', 8),
  ]), 'a', 'd');
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.optimality, 'CONFIRMED');
  assert.equal(result.routes[0].cost, 4);
  assert.deepEqual(result.routes[0].doorPath, ['a-b', 'b-d']);
});

test('closed and forbidden doors are not traversed', () => {
  const result = rankRoomRoutes(scene([
    door('cheap', 'a', 'd', 1), door('open-alt', 'a', 'b', 2),
    door('closed', 'b', 'd', 1, 'closed'),
  ]), 'a', 'd', { forbiddenDoorIds: ['cheap'] });
  assert.equal(result.reachable, false);
  assert.equal(result.reason, 'NO_ROUTE_WITH_DECLARED_CONSTRAINTS');
});

test('max cost filters routes without inventing a fallback', () => {
  const result = rankRoomRoutes(scene([
    door('a-b', 'a', 'b', 2), door('b-d', 'b', 'd', 3),
  ]), 'a', 'd', { maxCost: 4 });
  assert.equal(result.reachable, false);
  assert.equal(result.status, 'CONFIRMED');
});

test('unknown door state preserves uncertainty about reachability and optimality', () => {
  const result = rankRoomRoutes(scene([
    door('known', 'a', 'd', 5),
    door('uncertain', 'a', 'c', 1, 'unknown'),
    door('c-d', 'c', 'd', 1),
  ]), 'a', 'd');
  assert.equal(result.reachable, true);
  assert.equal(result.optimality, 'UNKNOWN');
});

test('missing traversal costs and malformed constraints fail closed', () => {
  assert.equal(rankRoomRoutes(scene([{ id: 'x', roomA: 'a', roomB: 'd', state: 'open' }]), 'a', 'd').status, 'UNKNOWN');
  assert.equal(rankRoomRoutes(scene([door('a-d', 'a', 'd', 1)]), 'a', 'd', { maxCost: -1 }).reason, 'INVALID_MAX_COST');
});

test('unknown room and unknown forbidden door are not silently accepted', () => {
  assert.equal(rankRoomRoutes(scene([]), 'missing', 'd').reason, 'ROOM_NOT_FOUND');
  assert.equal(rankRoomRoutes(scene([door('a-d', 'a', 'd', 1)]), 'a', 'd', { forbiddenDoorIds: ['missing-door'] }).reason, 'UNKNOWN_FORBIDDEN_DOOR_ID');
  assert.equal(rankRoomRoutes(scene([door('a-d', 'a', 'd', 1)]), 'a', 'd', { maxRoutes: 0 }).reason, 'INVALID_MAX_ROUTES');
});

test('same-room route has zero cost and no doors', () => {
  const result = rankRoomRoutes(scene([]), 'a', 'a');
  assert.deepEqual(result.routes, [{ roomPath: ['a'], doorPath: [], cost: 0 }]);
});

test('unknown door in an irrelevant dead end does not poison a confirmed route', () => {
  const result = rankRoomRoutes(scene([
    door('known-route', 'a', 'd', 5),
    door('unknown-dead-end', 'a', 'b', 1, 'unknown'),
  ]), 'a', 'd');

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.reachable, true);
  assert.equal(result.optimality, 'CONFIRMED');
  assert.deepEqual(result.routes.map((route) => route.doorPath), [['known-route']]);
});

test('unknown door that cannot fit the max-cost constraint does not make route status uncertain', () => {
  const result = rankRoomRoutes(scene([
    door('known-route', 'a', 'd', 3),
    door('too-expensive-unknown', 'a', 'b', 2, 'unknown'),
    door('b-d', 'b', 'd', 2),
  ]), 'a', 'd', { maxCost: 3 });

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.reachable, true);
  assert.equal(result.optimality, 'CONFIRMED');
  assert.deepEqual(result.routes.map((route) => route.doorPath), [['known-route']]);
});

test('unknown-only connection to a dead end does not imply destination reachability uncertainty', () => {
  const result = rankRoomRoutes(scene([
    door('unknown-dead-end', 'a', 'b', 1, 'unknown'),
  ]), 'a', 'd');

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.reachable, false);
  assert.equal(result.optimality, 'CONFIRMED');
  assert.equal(result.reason, 'NO_ROUTE_WITH_DECLARED_CONSTRAINTS');
});
\n