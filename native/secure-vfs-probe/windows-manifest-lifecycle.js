import { randomUUID } from 'node:crypto';
import { validateWindowsManifest } from './windows-role-manifest.js';

/*
 * Windows SQLite manifest lifecycle coordinator.
 *
 * This module is the broker-side transaction state machine. It deliberately
 * accepts no filesystem paths and performs no filesystem operations itself:
 * every namespace action is delegated to a privileged Windows service adapter
 * that resolves role/kind names relative to retained, identity-checked handles.
 *
 * The store adapter must durably flush its intent, manifest replacement and
 * intent removal (including the containing directory) before each method
 * returns. The namespace adapter must use handle-relative NT operations and
 * verify the exact opened file identity before deleting.
 */

const SIDECAR_SUFFIX = Object.freeze({
  wal: '-wal',
  shm: '-shm',
  journal: '-journal',
});

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function assertIdentity(identity, label) {
  assertRecord(identity, label);
  const keys = Object.keys(identity).sort();
  if (keys.length !== 3
      || keys[0] !== 'fileId' || keys[1] !== 'kind' || keys[2] !== 'volumeSerial'
      || identity.kind !== 'windows'
      || typeof identity.volumeSerial !== 'string'
      || !/^[0-9A-Fa-f]{16}$/.test(identity.volumeSerial)
      || typeof identity.fileId !== 'string'
      || !/^[0-9A-Fa-f]{32}$/.test(identity.fileId)) {
    throw new TypeError(`Invalid ${label} identity`);
  }
}

function identityKey(identity) {
  assertIdentity(identity, 'sidecar');
  return `${identity.volumeSerial.toLowerCase()}:${identity.fileId.toLowerCase()}`;
}

function clone(value) {
  return structuredClone(value);
}

function validateManifest(manifest) {
  validateWindowsManifest(manifest);
  return true;
}

function roleFor(manifest, roleName) {
  const role = manifest.roles.find((entry) => entry.role === roleName);
  if (!role) throw new TypeError(`Unknown Windows manifest role: ${roleName}`);
  return role;
}

function activeSidecar(role, kind) {
  return role.sidecars.find((entry) => entry.kind === kind && entry.state === 'active');
}

function nextManifest(manifest, mutate) {
  if (manifest.generation >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Windows manifest generation is exhausted');
  }
  const result = clone(manifest);
  result.generation += 1;
  mutate(result);
  return result;
}

function intentFor(manifest, operation, role, kind, expectedIdentity = null) {
  if (manifest.generation >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Windows manifest generation is exhausted');
  }
  return Object.freeze({
    schemaVersion: 1,
    operationId: cryptoRandomId(),
    operation,
    precondition: operation === 'create-sidecar' ? 'absent' : 'identity-match',
    role,
    kind,
    basename: roleFor(manifest, role).databaseBasename + SIDECAR_SUFFIX[kind],
    baseGeneration: manifest.generation,
    targetGeneration: manifest.generation + 1,
    expectedIdentity: expectedIdentity ? clone(expectedIdentity) : null,
  });
}

function cryptoRandomId() {
  // An idempotency token, not an authentication credential.
  return randomUUID().replaceAll('-', '');
}

function assertIntent(intent) {
  assertRecord(intent, 'pending lifecycle intent');
  const keys = Object.keys(intent).sort();
  const expected = [
    'baseGeneration', 'basename', 'expectedIdentity', 'kind', 'operation',
    'operationId', 'precondition', 'role', 'schemaVersion', 'targetGeneration',
  ].sort();
  if (keys.length !== expected.length
      || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError('Pending Windows manifest lifecycle intent has unknown or missing fields');
  }
  if (intent.schemaVersion !== 1
      || !/^[0-9a-f]{32}$/.test(intent.operationId)
      || !['create-sidecar', 'delete-sidecar'].includes(intent.operation)
      || typeof intent.role !== 'string'
      || !Object.hasOwn(SIDECAR_SUFFIX, intent.kind)
      || typeof intent.basename !== 'string'
      || !Number.isSafeInteger(intent.baseGeneration) || intent.baseGeneration < 1
      || !Number.isSafeInteger(intent.targetGeneration)
      || intent.targetGeneration !== intent.baseGeneration + 1) {
    throw new TypeError('Malformed Windows manifest lifecycle intent');
  }
  if (intent.operation === 'delete-sidecar') {
    if (intent.precondition !== 'identity-match') throw new TypeError('Delete intent requires identity-match precondition');
    assertIdentity(intent.expectedIdentity, 'delete intent');
  } else if (intent.precondition !== 'absent' || intent.expectedIdentity !== null) {
    throw new TypeError('Create intent requires absent precondition and no pre-existing identity');
  }
  return intent;
}

export function validateWindowsManifestIntent(intent) {
  return assertIntent(intent);
}

/**
 * store contract:
 *   withExclusiveLock(callback)
 *   readManifest() -> manifest
 *   readIntent() -> intent|null
 *   writeIntent(intent) -> durable
 *   writeManifest(manifest) -> durable atomic replacement
 *   clearIntent(operationId) -> durable
 *
 * namespace contract (all calls run under the service identity):
 *   createSidecar(role, kind, basename) -> opened handle (CREATE_NEW only)
 *   openSidecar(role, kind, basename) -> opened handle|null (OPEN_EXISTING only)
 *   identity(handle) -> identity from that exact handle
 *   flush(handle)
 *   deleteSidecar(handle, expectedIdentity) -> delete by verified handle
 *   flushParent(role)
 *   close(handle)
 *
 * The namespace adapter must reject path input, reparse points, non-NTFS
 * volumes, unexpected identities and any operation outside its enrolled role.
 */
export class WindowsManifestLifecycleCoordinator {
  #store;
  #namespace;

  constructor({ store, namespace }) {
    if (!store || !namespace) throw new TypeError('A durable store and privileged namespace adapter are required');
    for (const method of ['withExclusiveLock', 'readManifest', 'readIntent', 'writeIntent', 'writeManifest', 'clearIntent']) {
      if (typeof store[method] !== 'function') throw new TypeError(`Store adapter is missing ${method}`);
    }
    for (const method of ['createSidecar', 'openSidecar', 'identity', 'flush', 'deleteSidecar', 'flushParent', 'close']) {
      if (typeof namespace[method] !== 'function') throw new TypeError(`Namespace adapter is missing ${method}`);
    }
    this.#store = store;
    this.#namespace = namespace;
  }

  async createSidecar(roleName, kind) {
    if (!Object.hasOwn(SIDECAR_SUFFIX, kind)) throw new TypeError('Unsupported SQLite sidecar kind');
    return this.#store.withExclusiveLock(async () => {
      const manifest = await this.#store.readManifest();
      validateManifest(manifest);
      const role = roleFor(manifest, roleName);
      if (activeSidecar(role, kind)) throw new Error(`An active ${kind} sidecar already exists for ${roleName}`);
      // An unregistered object at the SQLite sidecar name is not adopted.
      // The service must prove absence before journaling and CREATE_NEW.
      const preexisting = await this.#namespace.openSidecar(roleName, kind,
        role.databaseBasename + SIDECAR_SUFFIX[kind]);
      if (preexisting) {
        await this.#namespace.close(preexisting);
        throw new Error(`Unmanifested ${kind} sidecar already occupies the role namespace`);
      }
      const intent = intentFor(manifest, 'create-sidecar', roleName, kind);
      await this.#store.writeIntent(intent);
      let handle;
      try {
        handle = await this.#namespace.createSidecar(roleName, kind, intent.basename);
        const identity = await this.#namespace.identity(handle);
        assertIdentity(identity, 'created sidecar');
        await this.#namespace.flush(handle);
        await this.#namespace.flushParent(roleName);
        const updated = nextManifest(manifest, (next) => {
          roleFor(next, roleName).sidecars.push({
            kind, identity: clone(identity), state: 'active',
            generation: intent.targetGeneration,
          });
        });
        validateManifest(updated);
        await this.#store.writeManifest(updated);
        await this.#store.clearIntent(intent.operationId);
        return clone(identity);
      } finally {
        if (handle) await this.#namespace.close(handle);
      }
    });
  }

  async deleteSidecar(roleName, kind) {
    if (!Object.hasOwn(SIDECAR_SUFFIX, kind)) throw new TypeError('Unsupported SQLite sidecar kind');
    return this.#store.withExclusiveLock(async () => {
      const manifest = await this.#store.readManifest();
      validateManifest(manifest);
      const role = roleFor(manifest, roleName);
      const current = activeSidecar(role, kind);
      if (!current) return false;
      const intent = intentFor(manifest, 'delete-sidecar', roleName, kind, current.identity);
      let handle;
      try {
        // Verify the existing object before writing intent. A missing or
        // replaced active sidecar is corruption, not a new deletion request.
        handle = await this.#namespace.openSidecar(roleName, kind, intent.basename);
        if (!handle) throw new Error('Active manifest sidecar is absent; refusing deletion');
        const observed = await this.#namespace.identity(handle);
        if (identityKey(observed) !== identityKey(intent.expectedIdentity)) {
          throw new Error('Opened sidecar identity differs from the active manifest; refusing deletion');
        }
        await this.#store.writeIntent(intent);
        await this.#namespace.deleteSidecar(handle, intent.expectedIdentity);
        await this.#namespace.flushParent(roleName);
        const updated = nextManifest(manifest, (next) => {
          const entry = activeSidecar(roleFor(next, roleName), kind);
          if (!entry || identityKey(entry.identity) !== identityKey(intent.expectedIdentity)) {
            throw new Error('Manifest changed while deleting sidecar');
          }
          entry.state = 'retired';
        });
        validateManifest(updated);
        await this.#store.writeManifest(updated);
        await this.#store.clearIntent(intent.operationId);
        return true;
      } finally {
        if (handle) await this.#namespace.close(handle);
      }
    });
  }

  async reconcile() {
    return this.#store.withExclusiveLock(async () => {
      const intentValue = await this.#store.readIntent();
      if (!intentValue) {
        const manifest = await this.#store.readManifest();
        validateManifest(manifest);
        return Object.freeze({ recovered: false, generation: manifest.generation });
      }
      const intent = assertIntent(intentValue);
      let manifest = await this.#store.readManifest();
      validateManifest(manifest);
      const role = roleFor(manifest, intent.role);
      if (intent.basename !== role.databaseBasename + SIDECAR_SUFFIX[intent.kind]) {
        throw new Error('Lifecycle intent basename does not match the enrolled role');
      }

      if (manifest.generation === intent.targetGeneration) {
        const committed = intent.operation === 'create-sidecar'
          ? activeSidecar(role, intent.kind)
          : role.sidecars.find((entry) => entry.kind === intent.kind
            && entry.state === 'retired'
            && identityKey(entry.identity) === identityKey(intent.expectedIdentity));
        if (!committed) throw new Error('Manifest generation advanced without the matching lifecycle result');
        const handle = await this.#namespace.openSidecar(intent.role, intent.kind, intent.basename);
        if (intent.operation === 'create-sidecar') {
          if (!handle) throw new Error('Committed active sidecar is missing');
          try {
            if (identityKey(await this.#namespace.identity(handle)) !== identityKey(committed.identity)) {
              throw new Error('Committed sidecar identity no longer matches its opened handle');
            }
          } finally {
            await this.#namespace.close(handle);
          }
        } else if (handle) {
          try {
            throw new Error('Retired sidecar name was recreated before lifecycle recovery completed');
          } finally {
            await this.#namespace.close(handle);
          }
        }
        await this.#store.clearIntent(intent.operationId);
        return Object.freeze({ recovered: true, operation: intent.operation, generation: manifest.generation });
      }

      if (manifest.generation !== intent.baseGeneration) {
        throw new Error('Manifest generation does not match pending lifecycle intent; refusing automatic recovery');
      }

      const handle = await this.#namespace.openSidecar(intent.role, intent.kind, intent.basename);
      try {
        if (intent.operation === 'create-sidecar') {
          if (!handle) {
            await this.#store.clearIntent(intent.operationId);
            return Object.freeze({ recovered: true, operation: 'create-rolled-back', generation: manifest.generation });
          }
          const identity = await this.#namespace.identity(handle);
          assertIdentity(identity, 'recovered created sidecar');
          await this.#namespace.flush(handle);
          await this.#namespace.flushParent(intent.role);
          manifest = nextManifest(manifest, (next) => {
            roleFor(next, intent.role).sidecars.push({
              kind: intent.kind, identity: clone(identity), state: 'active',
              generation: intent.targetGeneration,
            });
          });
        } else {
          if (handle) {
            const observed = await this.#namespace.identity(handle);
            if (identityKey(observed) !== identityKey(intent.expectedIdentity)) {
              throw new Error('Pending delete target was replaced; refusing recovery deletion');
            }
            await this.#namespace.deleteSidecar(handle, intent.expectedIdentity);
            await this.#namespace.flushParent(intent.role);
          }
          const current = activeSidecar(roleFor(manifest, intent.role), intent.kind);
          if (!current || identityKey(current.identity) !== identityKey(intent.expectedIdentity)) {
            throw new Error('Pending delete no longer matches the active manifest identity');
          }
          manifest = nextManifest(manifest, (next) => {
            activeSidecar(roleFor(next, intent.role), intent.kind).state = 'retired';
          });
        }
      } finally {
        if (handle) await this.#namespace.close(handle);
      }
      validateManifest(manifest);
      await this.#store.writeManifest(manifest);
      await this.#store.clearIntent(intent.operationId);
      return Object.freeze({ recovered: true, operation: intent.operation, generation: manifest.generation });
    });
  }
}
