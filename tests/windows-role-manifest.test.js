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

function fakeDatabase(options = {}) {
  const calls = [];
  let directoryValidations = 0;
  return {
    prepare(sql) {
      return {
        get(...args) {
          calls.push({ sql, args });
          if (sql.includes('validate_manifest_directory_identity')) {
            directoryValidations += 1;
            if (directoryValidations === options.failDirectoryValidationAt) {
              return { registered: 1, validated: 0 };
            }
          }
          if (sql.includes('activate_manifest_role')) return { activated: 1 };
          return { registered: 1, validated: 1 };
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
  assert.match(db.calls[0].sql, /validate_manifest_directory_identity/);
  assert.deepEqual(db.calls[0].args, [
    'C:\\',
    '00000000000000A1',
    '11111111111111111111111111111111',
  ]);
  assert.match(db.calls[1].sql, /validate_manifest_directory_identity/);
  assert.deepEqual(db.calls[1].args, [
    'C:\\LogicEngine',
    '00000000000000A1',
    '22222222222222222222222222222222',
  ]);
  assert.match(db.calls[2].sql, /validate_manifest_directory_identity/);
  assert.deepEqual(db.calls[2].args, [
    'C:\\LogicEngine\\data',
    '00000000000000A1',
    '33333333333333333333333333333333',
  ]);
  assert.match(db.calls[3].sql, /register_database_role_manifest/);
  assert.deepEqual(db.calls[3].args, [
    'C:\\LogicEngine\\data\\core.sqlite',
    'core',
    '00000000000000A1',
    '44444444444444444444444444444444',
    '00000000000000A1',
    '33333333333333333333333333333333',
    'core.sqlite',
  ]);
  assert.match(db.calls[4].sql, /register_manifest_sidecar/);
  assert.deepEqual(db.calls[4].args, [
    'core', 'wal', '00000000000000A1',
    '55555555555555555555555555555555', 'active',
  ]);
  assert.match(db.calls[5].sql, /activate_manifest_role/);
  assert.deepEqual(db.calls[5].args, ['core'],
    'the role must become available only after all sidecar identities are enrolled');
});

test('Windows manifest enrollment treats an empty parent chain as a metadata root at the DB parent', () => {
  const rootAtParent = manifest();
  rootAtParent.metadataRootIdentity = structuredClone(
    rootAtParent.roles[0].parentIdentities[1]
  );
  rootAtParent.roles[0].parentComponents = [];
  rootAtParent.roles[0].parentIdentities = [];
  const db = fakeDatabase();
  assert.equal(registerWindowsManifestRole(
    db, rootAtParent, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), 1);
  assert.deepEqual(db.calls[0].args, [
    'C:\\LogicEngine\\data',
    rootAtParent.metadataRootIdentity.volumeSerial,
    rootAtParent.metadataRootIdentity.fileId,
  ]);
  assert.match(db.calls[1].sql, /register_database_role_manifest/);
  assert.deepEqual(db.calls[1].args.slice(4, 6), [
    rootAtParent.metadataRootIdentity.volumeSerial,
    rootAtParent.metadataRootIdentity.fileId,
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
  ), /Duplicate physical Windows identity/);
  const malformed = manifest();
  malformed.roles[0].databaseIdentity.fileId = 'bad';
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), malformed, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Invalid Windows database core identity/);
});

test('Windows manifest enrollment rejects parent/database/active-sidecar identity aliases and future generations', () => {
  const parentAlias = manifest();
  parentAlias.roles[0].databaseIdentity = structuredClone(
    parentAlias.roles[0].parentIdentities[1]
  );
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), parentAlias, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Duplicate physical Windows identity/);

  const sidecarAlias = manifest();
  sidecarAlias.roles[0].sidecars[0].identity = structuredClone(
    sidecarAlias.roles[0].databaseIdentity
  );
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), sidecarAlias, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Duplicate physical Windows identity/);

  const futureGeneration = manifest();
  futureGeneration.roles[0].sidecars[0].generation =
    futureGeneration.generation + 1;
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), futureGeneration, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /transitional or invalid sidecar/);
});

test('Windows manifest enrollment retains retired sidecar generations beside one active generation', () => {
  const generations = manifest();
  generations.generation = 9;
  generations.roles[0].sidecars = [
    {
      kind: 'wal',
      identity: identity('00000000000000A1', '55555555555555555555555555555555'),
      state: 'retired',
      generation: 6,
    },
    {
      kind: 'wal',
      identity: identity('00000000000000A1', '77777777777777777777777777777777'),
      state: 'retired',
      generation: 8,
    },
    {
      kind: 'wal',
      identity: identity('00000000000000A1', '88888888888888888888888888888888'),
      state: 'active',
      generation: 9,
    },
  ];
  const db = fakeDatabase();
  assert.equal(registerWindowsManifestRole(
    db, generations, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), 1);
  const registrations = db.calls.filter((call) =>
    call.sql.includes('register_manifest_sidecar')
  );
  assert.equal(registrations.length, 3);
  assert.deepEqual(registrations.map((call) => call.args.slice(1)), [
    ['wal', '00000000000000A1', '88888888888888888888888888888888', 'active'],
    ['wal', '00000000000000A1', '55555555555555555555555555555555', 'retired'],
    ['wal', '00000000000000A1', '77777777777777777777777777777777', 'retired'],
  ], 'native enrollment must see the live pathname owner before replaying absent retired identities');
});

test('Windows manifest enrollment rejects an active sidecar generation older than retained retired history', () => {
  const rollback = manifest();
  rollback.generation = 9;
  rollback.roles[0].sidecars = [
    {
      kind: 'wal',
      identity: identity('00000000000000A1', '55555555555555555555555555555555'),
      state: 'retired',
      generation: 8,
    },
    {
      kind: 'wal',
      identity: identity('00000000000000A1', '88888888888888888888888888888888'),
      state: 'active',
      generation: 7,
    },
  ];
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), rollback, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /non-monotonic active wal generation/);
});

test('Windows manifest enrollment rejects two active sidecar identities for one role and kind', () => {
  const ambiguous = manifest();
  ambiguous.generation = 8;
  ambiguous.roles[0].sidecars.push({
    kind: 'wal',
    identity: identity('00000000000000A1', '77777777777777777777777777777777'),
    state: 'active',
    generation: 8,
  });
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), ambiguous, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /transitional or invalid sidecar/);
});

test('Windows manifest enrollment permits distinct roles to share a trusted parent directory', () => {
  const sharedParent = manifest();
  sharedParent.roles.push({
    ...structuredClone(sharedParent.roles[0]),
    role: 'vectors',
    databaseBasename: 'vectors.sqlite',
    databaseIdentity: identity('00000000000000A1', '66666666666666666666666666666666'),
    sidecars: [],
  });
  assert.equal(registerWindowsManifestRole(
    fakeDatabase(), sharedParent, 'vectors', 'C:\\LogicEngine\\data\\vectors.sqlite'
  ), 1);
});

test('Windows manifest enrollment rejects path-chain mismatch, relative paths, and dot components', () => {
  const db = fakeDatabase();
  assert.throws(() => registerWindowsManifestRole(
    db, manifest(), 'core', 'C:\\LogicEngine\\other\\core.sqlite'
  ), /parent path does not match/);
  assert.throws(() => registerWindowsManifestRole(
    db, manifest(), 'core', 'LogicEngine\\data\\core.sqlite'
  ), /absolute drive-letter/);
  assert.throws(() => registerWindowsManifestRole(
    db, manifest(), 'core', 'C:\\LogicEngine\\data\\..\\core.sqlite'
  ), /normalized/);
});

test('Windows manifest enrollment rejects unknown fields and incomplete trust policy', () => {
  const unknown = manifest();
  unknown.roles[0].unexpected = true;
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), unknown, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Unexpected or missing fields/);

  const weakPolicy = manifest();
  weakPolicy.filesystemPolicy.directoryMutationBoundary = 'application-process';
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), weakPolicy, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /filesystem trust policy/);
});

test('Windows manifest enrollment rejects metadata-root aliases and duplicate sidecar kinds', () => {
  const rootAlias = manifest();
  rootAlias.roles[0].databaseIdentity = structuredClone(rootAlias.metadataRootIdentity);
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), rootAlias, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Duplicate physical Windows identity/);

  const duplicateKind = manifest();
  duplicateKind.roles[0].sidecars.push({
    kind: 'wal',
    identity: identity('00000000000000A1', '77777777777777777777777777777777'),
    state: 'active',
    generation: 7,
  });
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), duplicateKind, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /transitional or invalid sidecar/);
});


test('Windows manifest enrollment rejects retired sidecar identities that alias databases or another role', () => {
  const databaseAlias = manifest();
  databaseAlias.roles[0].sidecars[0].state = 'retired';
  databaseAlias.roles[0].sidecars[0].identity = structuredClone(
    databaseAlias.roles[0].databaseIdentity
  );
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), databaseAlias, 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /Duplicate physical Windows identity/);

  const crossRoleAlias = manifest();
  crossRoleAlias.roles[0].sidecars[0].state = 'retired';
  crossRoleAlias.roles.push({
    ...structuredClone(crossRoleAlias.roles[0]),
    role: 'vectors',
    databaseBasename: 'vectors.sqlite',
    databaseIdentity: identity('00000000000000A1', '66666666666666666666666666666666'),
    sidecars: [{
      kind: 'wal',
      identity: structuredClone(crossRoleAlias.roles[0].sidecars[0].identity),
      state: 'retired',
      generation: 7,
    }],
  });
  assert.throws(() => registerWindowsManifestRole(
    fakeDatabase(), crossRoleAlias, 'vectors', 'C:\\LogicEngine\\data\\vectors.sqlite'
  ), /Duplicate physical Windows identity/);
});

test('Windows manifest enrollment fails before DB registration when any ancestor identity mismatches', () => {
  const db = fakeDatabase({ failDirectoryValidationAt: 2 });
  assert.throws(() => registerWindowsManifestRole(
    db, manifest(), 'core', 'C:\\LogicEngine\\data\\core.sqlite'
  ), /manifest directory identity: parent 1 for core/);
  assert.equal(db.calls.length, 2);
  assert.ok(db.calls.every((call) =>
    call.sql.includes('validate_manifest_directory_identity')
  ));
});
