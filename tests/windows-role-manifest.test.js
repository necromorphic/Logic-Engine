import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWindowsManifestRole } from '../native/secure-vfs-probe/windows-role-manifest.js';

const identity = (volumeSerial, fileId) => ({
  kind: 'windows', volumeSerial, fileId,
});

function manifest() {
  return {
    schemaVersion: 1,
    generation: 7,
    platform: 'windows',
    metadataRootIdentity: identity('00000000000000A1', '11111111111111111111111111111111'),
    filesystemPolicy: {
      filesystem: 'NTFS',
      identitySource: 'opened-handle',
      directoryMutationBoundary: 'dedicated-service-identity',
    },
    roles: [{
      role: 'core',
      parentComponents: ['LogicEngine', 'data'],
      parentIdentities: [
        identity('00000000000000A1', '22222222222222222222222222222222'),
        identity('00000000000000A1', '33333333333333333333333333333333'),
      ],
      databaseBasename: 'core.sqlite',
      databaseIdentity: identity('00000000000000A1', '44444444444444444444444444444444'),
      state: 'active',
      sidecars: [{
        kind: 'wal',
        identity: identity('00000000000000A1', '55555555555555555555555555555555'),
        state: 'active',
        generation: 6,
      }],
    }],
  };
}

function fakeDatabase() {
  const calls = [];
  return {
    prepare(sql) {
      return {
        get(...args) {
          calls.push({ sql, args });
          return { registered: 1 };
        },
      };
    },
    get calls() { return calls; },
  };
}

test('Windows manifest enrollment passes exact DB and final-parent identities to the native handle check', () => {
  const db = fakeDatabase();
  assert.equal(registerWindowsManifestRole(
    db, manifest(), 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), 1);
  assert.match(db.calls[0].sql, /register_database_role_manifest/);
  assert.deepEqual(db.calls[0].args, [
    'C:\\LogicEngine\\data\\core.sqlite',
    'core',
    '00000000000000A1',
    '44444444444444444444444444444444',
    '00000000000000A1',
    '33333333333333333333333333333333',
    'core.sqlite',
  ]);
  assert.match(db.calls[1].sql, /register_manifest_sidecar/);
  assert.deepEqual(db.calls[1].args, [
    'core', 'wal', '00000000000000A1',
    '55555555555555555555555555555555', 'active',
  ]);
});

test('Windows manifest enrollment rejects transitional sidecars and path basename mismatch', () => {
  const transitional = manifest();
  transitional.roles[0].sidecars[0].state = 'deleting';
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), transitional, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /transitional or invalid sidecar/);
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), manifest(), 'core', 'C:\\LogicEngine\\data\\other.sqlite'
  ), /basename does not match/);
});

test('Windows manifest enrollment rejects duplicate role identities and malformed identity encoding', () => {
  const duplicate = manifest();
  duplicate.roles.push({ ...duplicate.roles[0], role: 'core-copy' });
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), duplicate, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Duplicate physical database identity/);
  const malformed = manifest();
  malformed.roles[0].databaseIdentity.fileId = 'bad';
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), malformed, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Invalid Windows database core identity/);
});
