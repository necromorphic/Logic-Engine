import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowsManifestLifecycleCoordinator } from '../native/secure-vfs-probe/windows-manifest-lifecycle.js';

const identity = (fileId) => ({
  kind: 'windows',
  volumeSerial: '00000000000000A1',
  fileId: fileId.padStart(32, '0'),
});

function makeManifest(sidecars = [], generation = 1) {
  return {
    schemaVersion: 1,
    generation,
    platform: 'windows',
    metadataRootIdentity: identity('1'),
    filesystemPolicy: {
      filesystem: 'NTFS',
      identitySource: 'opened-handle',
      directoryMutationBoundary: 'dedicated-service-identity',
    },
    roles: [{
      role: 'core',
      parentComponents: ['LogicEngine', 'data'],
      parentIdentities: [identity('2'), identity('3')],
      databaseBasename: 'core.sqlite',
      databaseIdentity: identity('4'),
      state: 'active',
      sidecars: structuredClone(sidecars),
    }],
  };
}

function makeHarness({ manifest = makeManifest(), files = new Map(), crash = null } = {}) {
  const state = {
    manifest: structuredClone(manifest),
    intent: null,
    files,
    events: [],
  };
  const store = {
    async withExclusiveLock(callback) {
      state.events.push('lock');
      return callback();
    },
    async readManifest() { return structuredClone(state.manifest); },
    async readIntent() { return state.intent && structuredClone(state.intent); },
    async writeIntent(intent) {
      assert.equal(state.intent, null, 'only one pending transaction may exist');
      state.intent = structuredClone(intent);
      state.events.push('intent:durable');
    },
    async writeManifest(next) {
      state.manifest = structuredClone(next);
      state.events.push('manifest:durable');
    },
    async clearIntent(operationId) {
      assert.equal(state.intent?.operationId, operationId);
      state.intent = null;
      state.events.push('intent:cleared');
    },
  };
  const namespace = {
    async createSidecar(role, kind, basename) {
      state.events.push('create');
      const key = `${role}:${kind}:${basename}`;
      if (state.files.has(key)) throw new Error('CREATE_NEW collision');
      if (crash === 'before-create') throw new Error('simulated process crash before create');
      const file = { identity: identity('5') };
      state.files.set(key, file);
      if (crash === 'after-create') throw new Error('simulated process crash after create');
      return { key, file };
    },
    async openSidecar(role, kind, basename) {
      state.events.push('open');
      const key = `${role}:${kind}:${basename}`;
      const file = state.files.get(key);
      return file ? { key, file } : null;
    },
    async identity(handle) { return structuredClone(handle.file.identity); },
    async flush() { state.events.push('file:flush'); },
    async deleteSidecar(handle, expectedIdentity) {
      assert.deepEqual(handle.file.identity, expectedIdentity);
      state.events.push('delete');
      state.files.delete(handle.key);
      if (crash === 'after-delete') throw new Error('simulated process crash after delete');
    },
    async flushParent() { state.events.push('parent:flush'); },
    async close() { state.events.push('close'); },
  };
  return {
    state,
    coordinator: new WindowsManifestLifecycleCoordinator({ store, namespace }),
  };
}

const sidecarKey = 'core:wal:core.sqlite-wal';

test('create sidecar commits durable intent before CREATE_NEW and activates only after flush', async () => {
  const h = makeHarness();
  const created = await h.coordinator.createSidecar('core', 'wal');
  assert.deepEqual(created, identity('5'));
  assert.equal(h.state.manifest.generation, 2);
  assert.deepEqual(h.state.manifest.roles[0].sidecars, [{
    kind: 'wal', identity: identity('5'), state: 'active', generation: 2,
  }]);
  assert.equal(h.state.intent, null);
  assert.ok(h.state.events.indexOf('intent:durable') < h.state.events.indexOf('create'));
  assert.ok(h.state.events.indexOf('file:flush') < h.state.events.indexOf('manifest:durable'));
  assert.ok(h.state.events.indexOf('parent:flush') < h.state.events.indexOf('manifest:durable'));
});

test('create refuses to adopt an unmanifested sidecar already occupying the role namespace', async () => {
  const files = new Map([[sidecarKey, { identity: identity('5') }]]);
  const h = makeHarness({ files });
  await assert.rejects(h.coordinator.createSidecar('core', 'wal'), /Unmanifested wal sidecar/);
  assert.equal(h.state.intent, null);
  assert.equal(h.state.manifest.generation, 1);
});

test('create recovery enrolls a sidecar created before a simulated crash', async () => {
  const h = makeHarness({ crash: 'after-create' });
  await assert.rejects(h.coordinator.createSidecar('core', 'wal'), /simulated process crash/);
  assert.ok(h.state.intent);
  const result = await h.coordinator.reconcile();
  assert.deepEqual(result, { recovered: true, operation: 'create-sidecar', generation: 2 });
  assert.equal(h.state.manifest.roles[0].sidecars[0].state, 'active');
  assert.deepEqual(h.state.manifest.roles[0].sidecars[0].identity, identity('5'));
  assert.equal(h.state.intent, null);
});

test('create recovery clears an intent when CREATE_NEW never created the file', async () => {
  const h = makeHarness({ crash: 'before-create' });
  await assert.rejects(h.coordinator.createSidecar('core', 'wal'), /simulated process crash before create/);
  assert.ok(h.state.intent);
  assert.equal(h.state.files.has(sidecarKey), false);
  const result = await h.coordinator.reconcile();
  assert.deepEqual(result, {
    recovered: true, operation: 'create-rolled-back', generation: 1,
  });
  assert.equal(h.state.intent, null);
  assert.equal(h.state.manifest.roles[0].sidecars.length, 0);
});

test('delete commits intent before identity-checked unlink and retains a retired generation', async () => {
  const current = {
    kind: 'wal', identity: identity('5'), state: 'active', generation: 2,
  };
  const h = makeHarness({
    manifest: makeManifest([current], 2),
    files: new Map([[sidecarKey, { identity: identity('5') }]]),
  });
  assert.equal(await h.coordinator.deleteSidecar('core', 'wal'), true);
  assert.equal(h.state.files.has(sidecarKey), false);
  assert.equal(h.state.manifest.generation, 3);
  assert.deepEqual(h.state.manifest.roles[0].sidecars[0], {
    ...current, state: 'retired',
  });
  assert.equal(h.state.intent, null);
  assert.ok(h.state.events.indexOf('intent:durable') < h.state.events.indexOf('delete'));
  assert.ok(h.state.events.indexOf('parent:flush') < h.state.events.indexOf('manifest:durable'));
});

test('delete recovery retires the manifest record after a crash following namespace deletion', async () => {
  const current = {
    kind: 'wal', identity: identity('5'), state: 'active', generation: 2,
  };
  const h = makeHarness({
    manifest: makeManifest([current], 2),
    files: new Map([[sidecarKey, { identity: identity('5') }]]),
    crash: 'after-delete',
  });
  await assert.rejects(h.coordinator.deleteSidecar('core', 'wal'), /simulated process crash/);
  assert.ok(h.state.intent);
  const result = await h.coordinator.reconcile();
  assert.deepEqual(result, { recovered: true, operation: 'delete-sidecar', generation: 3 });
  assert.equal(h.state.manifest.roles[0].sidecars[0].state, 'retired');
  assert.equal(h.state.intent, null);
});

test('delete and recovery refuse a replacement file identity', async () => {
  const current = {
    kind: 'wal', identity: identity('5'), state: 'active', generation: 2,
  };
  const h = makeHarness({
    manifest: makeManifest([current], 2),
    files: new Map([[sidecarKey, { identity: identity('6') }]]),
  });
  await assert.rejects(h.coordinator.deleteSidecar('core', 'wal'), /differs from the active manifest/);
  assert.ok(h.state.intent);
  await assert.rejects(h.coordinator.reconcile(), /Pending delete target was replaced/);
  assert.equal(h.state.files.has(sidecarKey), true);
  assert.equal(h.state.manifest.roles[0].sidecars[0].state, 'active');
});

test('reconcile clears an intent when its matching manifest generation was already committed', async () => {
  const current = {
    kind: 'wal', identity: identity('5'), state: 'retired', generation: 2,
  };
  const h = makeHarness({
    manifest: makeManifest([current], 2),
    files: new Map(),
  });
  h.state.intent = {
    schemaVersion: 1,
    operationId: 'a'.repeat(32),
    operation: 'delete-sidecar',
    role: 'core',
    kind: 'wal',
    basename: 'core.sqlite-wal',
    baseGeneration: 1,
    targetGeneration: 2,
    expectedIdentity: identity('5'),
  };
  const result = await h.coordinator.reconcile();
  assert.deepEqual(result, { recovered: true, operation: 'delete-sidecar', generation: 2 });
  assert.equal(h.state.intent, null);
});

test('reconcile fails closed on generation gaps and malformed intents', async () => {
  const h = makeHarness();
  h.state.intent = {
    schemaVersion: 1,
    operationId: 'b'.repeat(32),
    operation: 'delete-sidecar',
    role: 'core',
    kind: 'wal',
    basename: 'core.sqlite-wal',
    baseGeneration: 1,
    targetGeneration: 2,
    expectedIdentity: identity('5'),
  };
  h.state.manifest.generation = 3;
  await assert.rejects(h.coordinator.reconcile(), /generation does not match/);
  h.state.intent.operationId = '../invalid';
  await assert.rejects(h.coordinator.reconcile(), /Malformed Windows manifest lifecycle intent/);
});
