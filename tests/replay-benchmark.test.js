import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('replay/rollback benchmark emits reproducible size, timing, database, SQL, and replay metrics', { timeout: 15000 }, () => {
  const result = spawnSync(process.execPath, [resolve('benchmarks/replay-rollback-growth.mjs')], {
    cwd: resolve('.'),
    env: { ...process.env, BENCH_SIZES: '10,25', BENCH_REPEATS: '2' },
    encoding: 'utf8',
    timeout: 12000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.benchmark, 'logic-engine-replay-rollback-growth');
  assert.deepEqual(report.workload.effects_per_seed_event, ['entity.upsert', 'fact.set', 'relationship.transition']);
  assert.deepEqual(report.sizes, [10, 25]);
  assert.equal(report.repeats, 2);
  assert.equal(report.results.length, 8);
  for (const row of report.results) {
    assert.ok(['commit', 'rollback', 'rollback-cascade', 'rebuild'].includes(row.operation));
    assert.ok(row.duration_ms >= 0);
    assert.equal(row.repeat_count, 2);
    assert.equal(row.duration_samples_ms.length, 2);
    assert.ok(row.duration_samples_ms.every((sample) => sample >= 0));
    assert.ok(row.database_size_before_bytes > 0);
    assert.ok(row.database_size_after_bytes > 0);
    assert.ok(row.sql_prepare_calls > 0);
    assert.ok(row.sql_statement_executions > 0);
    assert.ok(row.sql_exec_calls > 0);
    assert.ok(row.replayed_event_rows >= 0);
    assert.ok(row.projection_counts_after.entities >= 0);
    assert.ok(row.projection_counts_after.facts >= 0);
    assert.ok(row.projection_counts_after.fact_claims >= 0);
    assert.ok(row.projection_counts_after.relationships >= 0);
  }
  const rollback10 = report.results.find((row) => row.operation === 'rollback' && row.event_count_before === 10);
  assert.equal(rollback10.replayed_event_rows, 9);
  assert.deepEqual(rollback10.projection_counts_after, { entities: 9, facts: 9, fact_claims: 9, relationships: 9 });
  const cascade10 = report.results.find((row) => row.operation === 'rollback-cascade' && row.event_count_before === 10);
  assert.equal(cascade10.replayed_event_rows, 0);
  assert.deepEqual(cascade10.projection_counts_after, { entities: 0, facts: 0, fact_claims: 0, relationships: 0 });
  const rebuild10 = report.results.find((row) => row.operation === 'rebuild' && row.event_count_before === 10);
  assert.equal(rebuild10.replayed_event_rows, 10);
  assert.deepEqual(rebuild10.projection_counts_after, { entities: 10, facts: 10, fact_claims: 10, relationships: 10 });
  const rebuild25 = report.results.find((row) => row.operation === 'rebuild' && row.event_count_before === 25);
  assert.equal(rebuild25.replayed_event_rows, 25);
  assert.deepEqual(rebuild25.projection_counts_after, { entities: 25, facts: 25, fact_claims: 25, relationships: 25 });
});
