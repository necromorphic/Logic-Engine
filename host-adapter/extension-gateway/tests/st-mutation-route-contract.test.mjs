import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPinnedSillyTavernMutationCoverage, PINNED_ST_MUTATION_ROUTE_COUNT, PINNED_ST_MUTATION_GUARD_ASSERTION_COUNT, PINNED_ST_SPECIAL_MUTATION_ROUTES, hasPinnedPostRouteGuards } from '../server-plugin/st-mutation-route-contract.mjs';

const root = process.env.SILLYTAVERN_SOURCE_ROOT ?? null;

test('every reviewed per-user mutation route and global Host guard is present in the applied pinned ST source', {
  skip: !root,
}, async () => {
  const coverage = await verifyPinnedSillyTavernMutationCoverage({ sourceRoot: root });
  assert.equal(coverage.status, 'VERIFIED');
  assert.equal(coverage.route_count, PINNED_ST_MUTATION_ROUTE_COUNT);
  assert.equal(coverage.route_count, 90);
  assert.equal(coverage.guard_assertion_count, PINNED_ST_MUTATION_GUARD_ASSERTION_COUNT);
  assert.equal(coverage.guard_assertion_count, 89);
  assert.deepEqual(PINNED_ST_SPECIAL_MUTATION_ROUTES['src/endpoints/users-private.js'], {
    '/logout': 'revokeHostSessionBeforeLogout(request)',
  });
  assert.match(coverage.source_files_sha256, /^[a-f0-9]{64}$/);
  assert.match(coverage.coverage_manifest_sha256, /^[a-f0-9]{64}$/);
});

test('mutation route coverage checks every declaration, not only the first matching route', () => {
  assert.equal(hasPinnedPostRouteGuards("router.post('/delete', hostUnsupportedMutationGuard, handler);", '/delete', ['hostUnsupportedMutationGuard']), true);
  const bypass = "router.post('/delete', hostUnsupportedMutationGuard, handler);" + String.fromCharCode(10) + "router.post('/delete', handler);";
  assert.equal(hasPinnedPostRouteGuards(bypass, '/delete', ['hostUnsupportedMutationGuard']), false, 'a later unguarded duplicate must invalidate route coverage');
  const guardedDuplicates = "router.post('/delete', hostUnsupportedMutationGuard, first);" + String.fromCharCode(10) + 'router.post("/delete", hostUnsupportedMutationGuard, second);';
  assert.equal(hasPinnedPostRouteGuards(guardedDuplicates, '/delete', ['hostUnsupportedMutationGuard']), true);
});

test('mutation route coverage rejects missing routes and incomplete guard sets', () => {
  assert.equal(hasPinnedPostRouteGuards("router.get('/delete', handler);", '/delete', ['guard']), false);
  assert.equal(hasPinnedPostRouteGuards("router.post('/delete', guardA, handler);", '/delete', ['guardA', 'guardB']), false);
});
