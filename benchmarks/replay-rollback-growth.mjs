import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';

const sizes = (process.env.BENCH_SIZES || '1000,5000,10000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isSafeInteger(value) && value > 0);
if (!sizes.length) throw new Error('BENCH_SIZES must contain positive integer event counts.');

function instrument(store) {
  const counts = { prepares: 0, executions: 0, execCalls: 0, replayedEventRows: 0 };
  const originalPrepare = store.db.prepare.bind(store.db);
  store.db.prepare = (sql) => {
    counts.prepares += 1;
    const statement = originalPrepare(sql);
    return new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!['run', 'get', 'all', 'iterate'].includes(String(property))) return value.bind(target);
        return (...args) => {
          counts.executions += 1;
          const result = value.apply(target, args);
          if (property === 'all'
            && /SELECT \* FROM world_events WHERE world_id=\? AND validity='valid' ORDER BY commit_sequence/i.test(sql)) {
            counts.replayedEventRows += result.length;
          }
          return result;
        };
      },
    });
  };
  const originalExec = store.db.exec.bind(store.db);
  store.db.exec = (sql) => {
    counts.execCalls += 1;
    return originalExec(sql);
  };
  return counts;
}

function seed(store, eventCount, operation) {
  const timestamp = '2005-12-29T10:00:00.000Z';
  const insert = store.db.prepare(`INSERT INTO world_events(
    event_id,world_id,turn_id,event_type,game_time,committed_revision,commit_sequence,validity,
    caused_by_json,depends_on_json,read_set_json,causal_links_json,effects_json,time_advance_seconds,
    created_at,rollback_id
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`);
  store.tx(() => {
    for (let index = 0; index < eventCount; index += 1) {
      const effects = [
        {
          kind: 'entity.upsert',
          entity_id: 'entity-' + index,
          entity_type: 'object',
          attributes: { ordinal: index },
        },
        {
          kind: 'fact.set',
          fact_id: 'fact-' + index,
          subject_ref: 'entity:' + index,
          predicate: 'benchmark.ordinal',
          value: index,
        },
        {
          kind: 'relationship.transition',
          subject_id: 'subject-' + index,
          target_id: 'target-' + index,
          rule_module_id: 'benchmark.relationship',
          rule_module_version: '1.0.0',
          patch: { trust: index },
        },
      ];
      const causedBy = operation === 'rollback-cascade' && index > 0 ? ['seed-event-' + (index - 1)] : [];
      insert.run(
        'seed-event-' + index, 'bench-world', 'seed-turn-' + index, 'action.completed', timestamp,
        index + 1, index + 1, 'valid', JSON.stringify(causedBy), '[]', '[]', '[]',
        JSON.stringify(effects), 0, timestamp,
      );
    }
    store.db.prepare('UPDATE worlds SET world_revision=? WHERE world_id=?').run(eventCount, 'bench-world');
  });
  store.tx(() => store.rebuild('bench-world', eventCount));
}

function projectionCounts(store) {
  const count = (table) => store.db.prepare('SELECT COUNT(*) AS count FROM ' + table + ' WHERE world_id=?').get('bench-world').count;
  return {
    entities: count('entities'),
    facts: count('facts'),
    fact_claims: count('fact_claims'),
    relationships: count('relationships'),
  };
}

function performOperation(store, engine, eventCount, operation) {
  if (operation === 'commit') {
    engine.commitEvent('bench-world', {
      idempotency_key: 'bench-commit-' + eventCount,
      turn_id: 'bench-commit-' + eventCount,
      event_type: 'action.completed',
      expected_revision: eventCount,
      effects: [
        {
          kind: 'entity.upsert',
          entity_id: 'commit-added-entity',
          entity_type: 'object',
          attributes: { benchmark: true },
        },
        {
          kind: 'fact.set',
          fact_id: 'commit-added-fact',
          predicate: 'benchmark.commit',
          value: true,
        },
      ],
    });
  } else if (operation === 'rollback' || operation === 'rollback-cascade') {
    engine.rollbackEvent('bench-world', {
      root_event_id: 'seed-event-0',
      idempotency_key: 'bench-rollback-' + operation + '-' + eventCount,
    });
  } else {
    store.tx(() => store.rebuild('bench-world', eventCount));
  }
}

function runScenario(eventCount, operation, collectSqlMetrics) {
  const directory = mkdtempSync(join(tmpdir(), 'logic-engine-replay-bench-'));
  const dbPath = join(directory, 'benchmark.sqlite');
  let store;
  try {
    store = new SQLiteStore(dbPath);
    const engine = new LogicEngine(store);
    engine.createWorld({
      world_id: 'bench-world',
      world_pack_id: 'benchmark.world',
      world_pack_version: '1.0.0',
      game_time: '2005-12-29T10:00:00.000Z',
    });
    seed(store, eventCount, operation);
    const databaseSizeBeforeBytes = statSync(dbPath).size;
    const counts = collectSqlMetrics ? instrument(store) : null;
    const before = counts ? { ...counts } : null;
    const started = performance.now();
    performOperation(store, engine, eventCount, operation);
    const durationMs = Number((performance.now() - started).toFixed(3));
    const databaseSizeAfterBytes = statSync(dbPath).size;
    const operationCounts = counts ? {
      sql_prepare_calls: counts.prepares - before.prepares,
      sql_statement_executions: counts.executions - before.executions,
      sql_exec_calls: counts.execCalls - before.execCalls,
      replayed_event_rows: counts.replayedEventRows - before.replayedEventRows,
    } : null;
    const projectionsAfter = projectionCounts(store);
    return {
      durationMs,
      databaseSizeBeforeBytes,
      databaseSizeAfterBytes,
      operationCounts,
      projectionsAfter,
    };
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function measureOperation(eventCount, operation) {
  // Keep SQL instrumentation out of the wall-time measurement. Query and replay
  // counts are collected from an equivalent second fixture to avoid proxy cost.
  const timing = runScenario(eventCount, operation, false);
  const metrics = runScenario(eventCount, operation, true);
  return {
    event_count_before: eventCount,
    operation,
    duration_ms: timing.durationMs,
    database_size_before_bytes: timing.databaseSizeBeforeBytes,
    database_size_after_bytes: timing.databaseSizeAfterBytes,
    ...metrics.operationCounts,
    replayed_event_rows: metrics.operationCounts.replayed_event_rows,
    projection_counts_after: timing.projectionsAfter,
    timing_note: 'wall time measured without SQL instrumentation; SQL counts measured on an equivalent fixture',
  };
}
const results = [];
for (const size of sizes) {
  for (const operation of ['commit', 'rollback', 'rollback-cascade', 'rebuild']) {
    results.push(measureOperation(size, operation));
  }
}
process.stdout.write(JSON.stringify({
  benchmark: 'logic-engine-replay-rollback-growth',
  workload: {
    effects_per_seed_event: ['entity.upsert', 'fact.set', 'relationship.transition'],
    note: 'Synthetic independent events; relationship/fact/entity projection rebuild is exercised, but workload mix is not a claim about production traffic.',
  },
  node: process.version,
  platform: process.platform + '/' + process.arch,
  sizes,
  results,
}, null, 2) + '\n');
