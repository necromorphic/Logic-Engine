import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { ProposalService } from '../src/application/proposals.js';
import { evaluateCondition } from '../src/core/rules.js';

function setup() {
  const store = new SQLiteStore(':memory:');
  const engine = new LogicEngine(store);
  engine.createWorld({ world_id: 'w', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2005-12-29T10:00:00Z' });
  return { store, engine };
}

const cmd = (x) => ({
  idempotency_key: 'key-1', turn_id: 'turn-1', event_type: 'action.completed',
  expected_revision: 0, effects: [], caused_by: [], depends_on: [], read_set: [], ...x,
});

test('idempotency replays only an identical request', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  const x = cmd({
    time_advance_seconds: 300,
    effects: [{ kind: 'entity.upsert', entity_id: 'n1', entity_type: 'character', attributes: { name: 'Mira' } }],
  });
  const a = h.engine.commitEvent('w', x);
  const b = h.engine.commitEvent('w', x);
  assert.equal(a.world_revision, 1);
  assert.equal(a.game_time, '2005-12-29T10:05:00.000Z');
  assert.equal(b.idempotent_replay, true);
  assert.equal(h.engine.getState('w').entities.length, 1);

  assert.throws(
    () => h.engine.commitEvent('w', { ...x, effects: [{ kind: 'entity.upsert', entity_id: 'different', entity_type: 'object' }] }),
    (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT' && error.status === 409,
  );
  assert.equal(h.engine.getState('w').entities.some((entity) => entity.entity_id === 'different'), false);
});

test('stale proposal is rejected without partial effects', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.commitEvent('w', cmd({ effects: [{ kind: 'entity.upsert', entity_id: 'a', entity_type: 'object' }] }));
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'key-2', turn_id: 'turn-2', effects: [{ kind: 'entity.upsert', entity_id: 'b', entity_type: 'object' }] })),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  assert.equal(h.engine.getState('w').entities.length, 1);
});

test('causal references must resolve to valid prior events in the same world', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ caused_by: ['missing-event'] })),
    (error) => error.code === 'INVALID_CAUSAL_REFERENCE',
  );
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'bad-dependency', depends_on: ['missing-event'] })),
    (error) => error.code === 'INVALID_CAUSAL_REFERENCE',
  );
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'bad-read-set', read_set: ['untyped-reference'] })),
    (error) => error.code === 'INVALID_READ_SET_REFERENCE',
  );

  h.engine.createWorld({ world_id: 'other-world', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2005-12-29T10:00:00Z' });
  const foreign = h.engine.commitEvent('other-world', cmd({ event_id: 'foreign-event', idempotency_key: 'foreign-key' }));
  assert.equal(foreign.accepted, true);
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'cross-world', caused_by: ['foreign-event'] })),
    (error) => error.code === 'CROSS_WORLD_REFERENCE',
  );
});

test('depends_on entity and fact references must exist in the current world', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ depends_on: ['entity:ghost'] })),
    (error) => error.code === 'INVALID_DEPENDENCY_REFERENCE',
  );
  h.engine.commitEvent('w', cmd({ effects: [{ kind: 'entity.upsert', entity_id: 'n1', entity_type: 'character' }] }));
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ idempotency_key: 'bad-fact-dependency', expected_revision: 1, depends_on: ['fact:missing'] })),
    (error) => error.code === 'INVALID_DEPENDENCY_REFERENCE',
  );
});

test('rollback restores projections, preserves independent branch, and never rewinds game time', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.commitEvent('w', cmd({
    event_id: 'seed', idempotency_key: 'seed',
    effects: [{ kind: 'entity.upsert', entity_id: 'victim', entity_type: 'character', attributes: { alive: true } }],
  }));
  h.engine.commitEvent('w', cmd({
    event_id: 'death', idempotency_key: 'death', turn_id: 'death', expected_revision: 1,
    time_advance_seconds: 3600,
    effects: [{ kind: 'entity.upsert', entity_id: 'victim', entity_type: 'character', status: 'destroyed', attributes: { alive: false } }],
  }));
  h.engine.commitEvent('w', cmd({
    event_id: 'evidence', idempotency_key: 'evidence', turn_id: 'evidence', expected_revision: 2,
    caused_by: ['death'], read_set: ['entity:victim'],
    effects: [{ kind: 'fact.set', fact_id: 'dead', predicate: 'dead', value: true }],
  }));
  h.engine.commitEvent('w', cmd({
    event_id: 'independent', idempotency_key: 'independent', turn_id: 'independent', expected_revision: 3,
    effects: [{ kind: 'entity.upsert', entity_id: 'witness', entity_type: 'character' }],
  }));
  const result = h.engine.rollbackEvent('w', { root_event_id: 'death', idempotency_key: 'rollback' });
  const state = h.engine.getState('w');
  assert.deepEqual(new Set(result.invalidated_event_ids), new Set(['death', 'evidence']));
  assert.equal(state.entities.find((entity) => entity.entity_id === 'victim').status, 'active');
  assert.equal(state.entities.some((entity) => entity.entity_id === 'witness'), true);
  assert.equal(state.facts.length, 0);
  assert.equal(state.game_time, '2005-12-29T11:00:00.000Z');
  assert.equal(state.world_revision, 5);
});

test('conflicting independent fact claims are not silently resolved', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.commitEvent('w', cmd({ event_id: 'a', idempotency_key: 'a', effects: [{ kind: 'fact.set', fact_id: 'door', predicate: 'open', value: true }] }));
  h.engine.commitEvent('w', cmd({ event_id: 'b', idempotency_key: 'b', turn_id: 'b', expected_revision: 1, effects: [{ kind: 'fact.set', fact_id: 'door', predicate: 'open', value: false }] }));
  assert.equal(h.engine.getState('w').facts[0].status, 'conflicted');
  h.engine.rollbackEvent('w', { root_event_id: 'b', idempotency_key: 'rb' });
  assert.equal(h.engine.getState('w').facts[0].value, true);
});

test('time bounds and declarative rules reject invalid AST and unsafe paths', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  assert.throws(() => h.engine.commitEvent('w', cmd({ time_advance_seconds: 43201 })), (error) => error.code === 'TIME_ADVANCE_TOO_LARGE');
  assert.equal(evaluateCondition({
    op: 'all',
    conditions: [{ op: 'eq', path: 'npc.status', value: 'active' }, { op: 'gte', path: 'npc.age', value: 18 }],
  }, { npc: { status: 'active', age: 24 } }), true);
  assert.throws(() => evaluateCondition({ op: 'exec' }, {}), (error) => error.code === 'UNSUPPORTED_RULE_OPERATOR');
  assert.throws(() => evaluateCondition({ op: 'eq', path: '__proto__.polluted', value: true }, {}), (error) => error.code === 'INVALID_RULE_PATH');
  assert.throws(() => evaluateCondition({ op: 'gt', path: 'npc.age', value: '18' }, { npc: { age: 24 } }), (error) => error.code === 'RULE_TYPE_MISMATCH');
});


test('declarative rule evaluator accepts schema-shaped nested rules and compares JSON values deterministically', () => {
  const context = {
    npc: { status: 'active', age: 24, metadata: { first: 1, second: 2 } },
  };

  assert.equal(evaluateCondition({
    op: 'all',
    rules: [
      { op: 'eq', path: 'npc.status', value: 'active' },
      { op: 'not', rules: [{ op: 'lt', path: 'npc.age', value: 18 }] },
      { op: 'eq', path: 'npc.metadata', value: { second: 2, first: 1 } },
    ],
  }, context), true);

  assert.equal(evaluateCondition({
    op: 'any',
    rules: [
      { op: 'eq', path: 'npc.status', value: 'inactive' },
      { op: 'in', path: 'npc.metadata', values: [{ second: 2, first: 1 }] },
    ],
  }, context), true);

  assert.throws(
    () => evaluateCondition({ op: 'not', rules: [] }, context),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.throws(
    () => evaluateCondition({ op: 'all', rules: [], conditions: [] }, context),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.throws(
    () => evaluateCondition({ op: 'in', path: 'npc.status', values: Array(129).fill('active') }, context),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.throws(
    () => evaluateCondition({ op: 'in', path: 'npc.missing', values: 'not-an-array' }, context),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.throws(
    () => evaluateCondition({ op: 'gt', path: 'npc.missing', value: '24' }, context),
    (error) => error.code === 'RULE_TYPE_MISMATCH',
  );
  assert.throws(
    () => evaluateCondition({ op: 'exists', path: 'npc.status', value: 'yes' }, context),
    (error) => error.code === 'INVALID_RULE',
  );
});


test('rule evaluator rejects unknown fields and read_set references must exist locally', (t) => {
  const h = setup();
  t.after(() => h.store.close());

  assert.throws(
    () => evaluateCondition({ op: 'eq', path: 'npc.status', value: 'active', typo: true }, { npc: { status: 'active' } }),
    (error) => error.code === 'INVALID_RULE',
  );
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ read_set: ['entity:missing'] })),
    (error) => error.code === 'INVALID_READ_SET_REFERENCE',
  );

  h.engine.createWorld({ world_id: 'other-world', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2005-12-29T10:00:00Z' });
  h.engine.commitEvent('other-world', cmd({
    event_id: 'foreign-entity-event',
    idempotency_key: 'foreign-entity',
    effects: [{ kind: 'entity.upsert', entity_id: 'foreign-only', entity_type: 'object' }],
  }));
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ read_set: ['entity:foreign-only'] })),
    (error) => error.code === 'INVALID_READ_SET_REFERENCE',
  );
  assert.throws(
    () => h.engine.commitEvent('w', cmd({ event_id: 'entity:reserved-prefix' })),
    (error) => error.code === 'INVALID_EVENT_ID',
  );
});


test('effect fields that are not part of the executable contract are rejected', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  assert.throws(
    () => h.engine.commitEvent('w', cmd({
      effects: [{ kind: 'entity.upsert', entity_id: 'guard', entity_type: 'character', observed_version: 4 }],
    })),
    (error) => error.code === 'UNSUPPORTED_EFFECT_FIELD' && error.status === 400,
  );
  assert.equal(h.engine.getState('w').world_revision, 0);
  assert.equal(h.engine.getEvents('w', true).length, 0);
});

test('a failed audit write rolls back the entire event transaction', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.store.db.exec(`
    CREATE TRIGGER fail_event_audit BEFORE INSERT ON audit_entries
    WHEN NEW.action='event.committed'
    BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;
  `);
  assert.throws(() => h.engine.commitEvent('w', cmd({
    effects: [{ kind: 'entity.upsert', entity_id: 'never-committed', entity_type: 'object' }],
  })));
  assert.equal(h.engine.getState('w').world_revision, 0);
  assert.equal(h.engine.getState('w').entities.length, 0);
  assert.equal(h.engine.getEvents('w', true).length, 0);
  assert.equal(h.engine.getAudit('w').length, 1);
});

test('legacy SQLite migration preserves existing world and idempotency rows', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-engine-migration-'));
  const path = join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE worlds(
      world_id TEXT PRIMARY KEY, world_pack_id TEXT NOT NULL, world_pack_version TEXT NOT NULL,
      initial_game_time TEXT NOT NULL, game_time TEXT NOT NULL, world_revision INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
    );
    CREATE TABLE idempotency_keys(
      world_id TEXT NOT NULL REFERENCES worlds(world_id), idempotency_key TEXT NOT NULL,
      response_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(world_id,idempotency_key)
    );
    INSERT INTO worlds(world_id,world_pack_id,world_pack_version,initial_game_time,game_time,world_revision,status,created_at)
      VALUES('legacy-world','test.world','1.0.0','2005-12-29T10:00:00.000Z','2005-12-29T10:05:00.000Z',1,'active','2005-12-29T10:00:00.000Z');
    INSERT INTO idempotency_keys(world_id,idempotency_key,response_json,created_at)
      VALUES('legacy-world','legacy-key','{"accepted":true}','2005-12-29T10:05:00.000Z');
  `);
  legacy.close();

  const store = new SQLiteStore(path);
  const engine = new LogicEngine(store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const columns = store.db.prepare('PRAGMA table_info(idempotency_keys)').all();
  assert.equal(columns.some((column) => column.name === 'request_hash'), true);
  assert.equal(store.db.prepare('SELECT version FROM schema_migrations WHERE version=1').get().version, 1);
  assert.equal(engine.getState('legacy-world').world_revision, 1);
  assert.equal(engine.getState('legacy-world').game_time, '2005-12-29T10:05:00.000Z');
  assert.equal(store.db.prepare('SELECT response_json FROM idempotency_keys WHERE world_id=? AND idempotency_key=?').get('legacy-world','legacy-key').response_json, '{"accepted":true}');
  assert.throws(
    () => engine.commitEvent('legacy-world', cmd({ idempotency_key: 'legacy-key', expected_revision: 1 })),
    (error) => error.code === 'IDEMPOTENCY_KEY_UNVERIFIABLE',
  );
});

test('a failed rollback audit write leaves the world and rollback metadata unchanged', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.commitEvent('w', cmd({
    event_id: 'rollback-root',
    idempotency_key: 'rollback-root-key',
    effects: [{ kind: 'entity.upsert', entity_id: 'target', entity_type: 'object' }],
  }));
  h.store.db.exec(`
    CREATE TRIGGER fail_rollback_audit BEFORE INSERT ON audit_entries
    WHEN NEW.action='rollback.applied'
    BEGIN SELECT RAISE(ABORT, 'forced rollback audit failure'); END;
  `);

  assert.throws(
    () => h.engine.rollbackEvent('w', { root_event_id: 'rollback-root', idempotency_key: 'rollback-key' }),
  );
  assert.equal(h.engine.getState('w').world_revision, 1);
  assert.equal(h.engine.getState('w').entities.some((entity) => entity.entity_id === 'target'), true);
  assert.equal(h.engine.getEvents('w', true).find((event) => event.event_id === 'rollback-root').validity, 'valid');
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM rollbacks').get().count, 0);
  assert.equal(h.engine.getAudit('w').length, 2);

  h.store.db.exec('DROP TRIGGER fail_rollback_audit');
  const result = h.engine.rollbackEvent('w', { root_event_id: 'rollback-root', idempotency_key: 'rollback-key' });
  assert.equal(result.accepted, true);
  assert.equal(h.engine.getState('w').world_revision, 2);
  assert.equal(h.engine.getState('w').entities.length, 0);
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM rollbacks').get().count, 1);
});


test('proposal commit rolls back canonical event if proposal finalization fails', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  const proposals = new ProposalService(h.engine);
  const proposal = proposals.create('w', {
    idempotency_key: 'proposal-atomicity',
    source_text: 'A harmless action.',
    event: { turn_id: 'turn-atomicity', event_type: 'action.completed', effects: [] },
  }, 'unit-test-adapter');
  proposals.approve('w', proposal.proposal_id);
  h.store.db.exec(`CREATE TRIGGER fail_proposal_finalization BEFORE INSERT ON audit_entries
    WHEN NEW.action='proposal.committed'
    BEGIN SELECT RAISE(ABORT, 'injected proposal finalization failure'); END;`);
  assert.throws(() => proposals.commit('w', proposal.proposal_id), /injected proposal finalization failure/);
  assert.equal(h.engine.getState('w').world_revision, 0);
  assert.equal(h.engine.getEvents('w', true).length, 0);
  assert.equal(proposals.get('w', proposal.proposal_id).status, 'approved');
});


test('mechanic instances are world-scoped, event-backed, and rebuild/rollback consistently', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  const template = { template_id: 'test.lifecycle', version: '1.0.0', schema_version: 'core-1', display_name: 'Lifecycle test', required_capabilities: [], applicability: [], actions: [], conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' }, unknown_policy: 'mark_unknown' };
  h.engine.registerMechanicTemplate(template);
  assert.throws(() => h.engine.commitEvent('w', cmd({ idempotency_key: 'unknown-template-version', effects: [{ kind: 'mechanic.instance.create', instance_id: 'unknown', template_id: 'test.lifecycle', template_version: '9.9.9' }] })), (error) => error.code === 'MECHANIC_TEMPLATE_NOT_FOUND');
  assert.equal(h.engine.getState('w').world_revision, 0);
  h.engine.createWorld({ world_id: 'w2', world_pack_id: 'test.world', world_pack_version: '1.0.0', game_time: '2005-12-29T10:00:00Z' });
  const create = (world, key, revision = 0) => h.engine.commitEvent(world, cmd({ idempotency_key: key, turn_id: key, expected_revision: revision, event_type: 'mechanic.instance.create', effects: [{ kind: 'mechanic.instance.create', instance_id: 'shared-id', template_id: 'test.lifecycle', template_version: '1.0.0', parameters: { rate: 2 }, state: { count: 0 } }] }));
  const first = create('w', 'm-create');
  assert.equal(h.engine.getMechanicInstance('w', 'shared-id').status, 'disabled');
  assert.equal(h.engine.getMechanicInstance('w', 'shared-id').template_version, '1.0.0');
  assert.equal(typeof h.engine.getMechanicInstance('w', 'shared-id').last_event_id, 'string');
  assert.throws(() => h.engine.commitEvent('w', cmd({ idempotency_key: 'reserved-instance-id', effects: [{ kind: 'mechanic.instance.create', instance_id: 'entity:reserved', template_id: 'test.lifecycle', template_version: '1.0.0' }] })), (error) => error.code === 'INVALID_MECHANIC_INSTANCE_EFFECT');
  create('w2', 'm-create-w2');
  assert.equal(h.engine.listMechanicInstances('w2').length, 1);
  assert.throws(() => create('w', 'm-create-duplicate', 1), (error) => error.code === 'MECHANIC_INSTANCE_ALREADY_EXISTS');
  const enabled = h.engine.commitEvent('w', cmd({ idempotency_key: 'm-enable', turn_id: 'm-enable', expected_revision: 1, event_type: 'mechanic.instance.enable', caused_by: [first.event_id], effects: [{ kind: 'mechanic.instance.enable', instance_id: 'shared-id' }] }));
  assert.equal(h.engine.getMechanicInstance('w', 'shared-id').status, 'enabled');
  assert.throws(() => h.engine.commitEvent('w', cmd({ idempotency_key: 'm-enable-again', turn_id: 'm-enable-again', expected_revision: 2, effects: [{ kind: 'mechanic.instance.enable', instance_id: 'shared-id' }], caused_by: [enabled.event_id] })), (error) => error.code === 'INVALID_MECHANIC_INSTANCE_TRANSITION');
  const disabled = h.engine.commitEvent('w', cmd({ idempotency_key: 'm-disable', turn_id: 'm-disable', expected_revision: 2, event_type: 'mechanic.instance.disable', caused_by: [enabled.event_id], effects: [{ kind: 'mechanic.instance.disable', instance_id: 'shared-id' }] }));
  assert.equal(h.engine.getMechanicInstance('w', 'shared-id').status, 'disabled');
  h.store.rebuild('w', 3);
  assert.equal(h.engine.getMechanicInstance('w', 'shared-id').status, 'disabled');
  const rollback = h.engine.rollbackEvent('w', { root_event_id: first.event_id, idempotency_key: 'm-rollback-create' });
  assert.deepEqual(new Set(rollback.invalidated_event_ids), new Set([first.event_id, enabled.event_id, disabled.event_id]));
  assert.equal(h.engine.listMechanicInstances('w').length, 0);
  create('w', 'm-reuse-after-rollback', 4);
  assert.equal(h.engine.getMechanicInstance('w', 'shared-id').status, 'disabled');
  assert.equal(h.engine.listMechanicInstances('w2').length, 1);
});


test('rolling back mechanic enable restores disabled state without touching an independent instance', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.registerMechanicTemplate({ template_id: 'test.lifecycle', version: '1.0.0', schema_version: 'core-1', display_name: 'Lifecycle test', required_capabilities: [], applicability: [], actions: [], conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' }, unknown_policy: 'mark_unknown' });
  const create = (id, key, revision) => h.engine.commitEvent('w', cmd({ idempotency_key: key, turn_id: key, expected_revision: revision, effects: [{ kind: 'mechanic.instance.create', instance_id: id, template_id: 'test.lifecycle', template_version: '1.0.0' }] }));
  const a = create('instance-a', 'create-a', 0);
  create('instance-b', 'create-b', 1);
  const enabled = h.engine.commitEvent('w', cmd({ idempotency_key: 'enable-a', turn_id: 'enable-a', expected_revision: 2, caused_by: [a.event_id], effects: [{ kind: 'mechanic.instance.enable', instance_id: 'instance-a' }] }));
  assert.equal(h.engine.getMechanicInstance('w', 'instance-a').status, 'enabled');
  const result = h.engine.rollbackEvent('w', { root_event_id: enabled.event_id, idempotency_key: 'rollback-enable-a' });
  assert.deepEqual(result.invalidated_event_ids, [enabled.event_id]);
  assert.equal(h.engine.getMechanicInstance('w', 'instance-a').status, 'disabled');
  assert.equal(h.engine.getMechanicInstance('w', 'instance-b').status, 'disabled');
});


test('mechanic instance creation fails closed on missing or incompatible pinned rule modules', (t) => {
  const h = setup();
  t.after(() => h.store.close());
  h.engine.registerMechanicTemplate({
    template_id: 'test.module-boundary', version: '1.0.0', schema_version: 'core-1',
    display_name: 'Module boundary', required_capabilities: [], applicability: [], actions: [],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' },
    unknown_policy: 'mark_unknown',
    rule_modules: [{ module_id: 'test.module', version: '1.0.0', required_capabilities: ['mechanic.test'] }],
  });
  const create = () => h.engine.commitEvent('w', cmd({
    idempotency_key: 'module-boundary-create', turn_id: 'module-boundary-create',
    expected_revision: 0, event_type: 'mechanic.instance.create',
    effects: [{ kind: 'mechanic.instance.create', instance_id: 'module-instance', template_id: 'test.module-boundary', template_version: '1.0.0' }],
  }));
  assert.throws(() => create(), (error) => error.code === 'MECHANIC_INSTANCE_UNSUPPORTED_MODULE');
  assert.equal(h.engine.getState('w').world_revision, 0);
  h.engine.registerRuleModuleManifest({
    module_id: 'test.module', version: '1.0.0', contract_version: 'core-1',
    capabilities: [], operations: ['evaluate_predicate'], input_schema: { type: 'object' },
    output_schema: { type: 'object' }, failure_policy: 'fail_closed',
    compatibility: { core_contract_versions: ['core-1'] },
  });
  assert.throws(() => create(), (error) => error.code === 'MECHANIC_INSTANCE_MODULE_CAPABILITY_MISMATCH');
  assert.equal(h.engine.getState('w').world_revision, 0);
  h.engine.registerRuleModuleManifest({
    module_id: 'test.module', version: '1.0.1', contract_version: 'core-1',
    capabilities: ['mechanic.test'], operations: ['evaluate_predicate'], input_schema: { type: 'object' },
    output_schema: { type: 'object' }, failure_policy: 'fail_closed',
    compatibility: { core_contract_versions: ['core-1'] },
  });
  assert.throws(() => create(), (error) => error.code === 'MECHANIC_INSTANCE_MODULE_CAPABILITY_MISMATCH');
  assert.equal(h.engine.getState('w').world_revision, 0);
  h.engine.registerRuleModuleManifest({
    module_id: 'test.module', version: '1.0.2', contract_version: 'core-1',
    capabilities: ['mechanic.test'], operations: ['evaluate_predicate'], input_schema: { type: 'object' },
    output_schema: { type: 'object' }, failure_policy: 'fail_closed',
    compatibility: { core_contract_versions: ['core-2'] },
  });
  h.engine.registerMechanicTemplate({
    template_id: 'test.module-boundary-incompatible', version: '1.0.0', schema_version: 'core-1',
    display_name: 'Incompatible module boundary', required_capabilities: [], applicability: [], actions: [],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' },
    unknown_policy: 'mark_unknown',
    rule_modules: [{ module_id: 'test.module', version: '1.0.2', required_capabilities: ['mechanic.test'] }],
  });
  assert.throws(() => h.engine.commitEvent('w', cmd({
    idempotency_key: 'module-boundary-incompatible-create', turn_id: 'module-boundary-incompatible-create',
    expected_revision: 0, event_type: 'mechanic.instance.create',
    effects: [{ kind: 'mechanic.instance.create', instance_id: 'module-instance-incompatible', template_id: 'test.module-boundary-incompatible', template_version: '1.0.0' }],
  })), (error) => error.code === 'MECHANIC_INSTANCE_MODULE_COMPATIBILITY_MISMATCH');
  assert.equal(h.engine.getState('w').world_revision, 0);
  h.engine.registerMechanicTemplate({
    template_id: 'test.module-boundary-good', version: '1.0.0', schema_version: 'core-1',
    display_name: 'Compatible module boundary', required_capabilities: [], applicability: [], actions: [],
    conflict_policy: { mode: 'manual' }, lifecycle_policy: { on_disable: 'pause_blocked' },
    unknown_policy: 'mark_unknown',
    rule_modules: [{ module_id: 'test.module', version: '1.0.1', required_capabilities: ['mechanic.test'] }],
  });
  const good = h.engine.commitEvent('w', cmd({
    idempotency_key: 'module-boundary-good-create', turn_id: 'module-boundary-good-create',
    expected_revision: 0, event_type: 'mechanic.instance.create',
    effects: [{ kind: 'mechanic.instance.create', instance_id: 'module-instance-good', template_id: 'test.module-boundary-good', template_version: '1.0.0' }],
  }));
  assert.equal(good.accepted, true);
  assert.equal(h.engine.getMechanicInstance('w', 'module-instance-good').status, 'disabled');
});
