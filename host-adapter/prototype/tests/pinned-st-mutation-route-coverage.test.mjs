import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPinnedSillyTavernMutationCoverage, PINNED_ST_MUTATION_ROUTE_COUNT } from '../../extension-gateway/server-plugin/st-mutation-route-contract.mjs';

const root = process.env.SILLYTAVERN_SOURCE_ROOT ?? null;

test('every reviewed pinned mutation route, including unsupported routes and the separately guarded logout, is present in the applied ST source', {
  skip: !root,
}, async () => {
  const coverage = await verifyPinnedSillyTavernMutationCoverage({ sourceRoot: root });
  assert.equal(coverage.status, 'VERIFIED');
  assert.equal(coverage.route_count, PINNED_ST_MUTATION_ROUTE_COUNT);
  assert.equal(coverage.route_count, 90);
  assert.match(coverage.source_files_sha256, /^[a-f0-9]{64}$/);
  assert.match(coverage.coverage_manifest_sha256, /^[a-f0-9]{64}$/);
});
