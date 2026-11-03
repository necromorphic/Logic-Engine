import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaUrl = new URL('../schemas/sqlite-role-manifest.schema.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

const posixIdentity = {
  kind: 'posix',
  device: '2049',
  inode: '918273645',
  mountId: '42',
};
const windowsIdentity = {
  kind: 'windows',
  volumeSerial: '0123456789ABCDEF',
  fileId: '0123456789ABCDEFFEDCBA9876543210',
};
const manifest = (platform, identity) => ({
  schemaVersion: 1,
  generation: 1,
  platform,
  metadataRootIdentity: identity,
  filesystemPolicy: {
    filesystem: platform === 'linux' ? 'ext4' : 'NTFS',
    identitySource: 'opened-handle',
    directoryMutationBoundary: platform === 'linux' ? 'broker-exclusive-owner' : 'dedicated-service-identity',
    ...(platform === 'linux' ? { applicationUid: 1001 } : {}),
  },
  roles: [{
    role: 'core',
    parentComponents: ['var', 'lib', 'logic-engine'],
    parentIdentities: [identity, identity, identity],
    databaseBasename: 'logic-engine.sqlite',
    databaseIdentity: identity,
    state: 'active',
    sidecars: [{
      kind: 'wal',
      identity,
      state: 'active',
      generation: 1,
    }],
  }],
});

test('SQLite role manifest schema accepts handle-derived POSIX and Windows identities', () => {
  assert.equal(validate(manifest('linux', posixIdentity)), true, JSON.stringify(validate.errors));
  assert.equal(validate(manifest('windows', windowsIdentity)), true, JSON.stringify(validate.errors));
});

test('SQLite role manifest rejects path traversal components and unusable identities', () => {
  for (const component of ['.', '..', '../escape', 'nested/name', 'nested\\name', '']) {
    const value = manifest('linux', posixIdentity);
    value.roles[0].databaseBasename = component;
    assert.equal(validate(value), false, `accepted unsafe basename: ${JSON.stringify(component)}`);
  }

  const zeroInode = manifest('linux', { ...posixIdentity, inode: '0' });
  assert.equal(validate(zeroInode), false, 'zero inode must fail closed');

  for (const location of ['metadataRootIdentity', 'parentIdentity', 'databaseIdentity', 'sidecarIdentity']) {
    const mixedPlatform = manifest('linux', posixIdentity);
    if (location === 'metadataRootIdentity') mixedPlatform.metadataRootIdentity = windowsIdentity;
    if (location === 'parentIdentity') mixedPlatform.roles[0].parentIdentities[0] = windowsIdentity;
    if (location === 'databaseIdentity') mixedPlatform.roles[0].databaseIdentity = windowsIdentity;
    if (location === 'sidecarIdentity') mixedPlatform.roles[0].sidecars[0].identity = windowsIdentity;
    assert.equal(validate(mixedPlatform), false,
      `a Linux manifest must reject Windows identity in ${location}`);
  }
});

test('Linux role manifest requires an explicit application UID', () => {
  const missingUid = manifest('linux', posixIdentity);
  delete missingUid.filesystemPolicy.applicationUid;
  assert.equal(validate(missingUid), false, 'Linux manifest without applicationUid must fail closed');

  const negativeUid = manifest('linux', posixIdentity);
  negativeUid.filesystemPolicy.applicationUid = -1;
  assert.equal(validate(negativeUid), false, 'negative applicationUid must fail closed');

  const rootUid = manifest('linux', posixIdentity);
  rootUid.filesystemPolicy.applicationUid = 0;
  assert.equal(validate(rootUid), false, 'root must not be the isolated application identity');

  assert.equal(validate(manifest('windows', windowsIdentity)), true,
    'Windows manifest must not require a POSIX application UID');
});


test('SQLite role manifest schema models offline main-file lifecycle states', () => {
  const renaming = manifest('linux', posixIdentity);
  renaming.roles[0].state = 'renaming';
  renaming.roles[0].sidecars[0].state = 'retired';
  renaming.roles[0].pendingDatabaseBasename = 'logic-engine-renamed.sqlite';
  assert.equal(validate(renaming), true, JSON.stringify(validate.errors));

  for (const state of ['disabled', 'deleting', 'deleted']) {
    const value = manifest('linux', posixIdentity);
    value.roles[0].state = state;
    value.roles[0].sidecars[0].state = 'retired';
    assert.equal(validate(value), true, state + ': ' + JSON.stringify(validate.errors));
  }

  const missingRenameTarget = manifest('linux', posixIdentity);
  missingRenameTarget.roles[0].state = 'renaming';
  missingRenameTarget.roles[0].sidecars[0].state = 'retired';
  assert.equal(validate(missingRenameTarget), false,
    'renaming state must persist a destination basename');

  const unexpectedRenameTarget = manifest('linux', posixIdentity);
  unexpectedRenameTarget.roles[0].pendingDatabaseBasename = 'unexpected.sqlite';
  assert.equal(validate(unexpectedRenameTarget), false,
    'pending destination must not appear outside renaming state');
});


test('SQLite role manifest schema accepts a broker-initialized empty role inventory', () => {
  const initial = manifest('linux', posixIdentity);
  initial.roles = [];
  assert.equal(validate(initial), true, JSON.stringify(validate.errors));
});


test('SQLite role manifest schema validates durable pending enrollment intents', () => {
  const value = manifest('linux', posixIdentity);
  const role = value.roles[0];
  value.roles = [];
  value.pendingEnrollments = [{
    role: 'core',
    parentComponents: role.parentComponents,
    parentIdentities: role.parentIdentities,
    databaseBasename: 'core.sqlite',
  }];
  assert.equal(validate(value), true, JSON.stringify(validate.errors));

  value.pendingEnrollments[0].databaseIdentity = posixIdentity;
  assert.equal(validate(value), true, JSON.stringify(validate.errors));

  value.pendingEnrollments[0].databaseIdentity = { kind: 'posix', inode: '0' };
  assert.equal(validate(value), false,
    'pending enrollment identity must use the full canonical POSIX identity');
});

test('Windows role manifest permits the metadata root to be the database parent, while POSIX requires a recorded parent chain', () => {
  const windowsRootAtParent = manifest('windows', windowsIdentity);
  windowsRootAtParent.roles[0].parentComponents = [];
  windowsRootAtParent.roles[0].parentIdentities = [];
  assert.equal(validate(windowsRootAtParent), true, JSON.stringify(validate.errors));

  const posixMissingParentChain = manifest('linux', posixIdentity);
  posixMissingParentChain.roles[0].parentComponents = [];
  posixMissingParentChain.roles[0].parentIdentities = [];
  assert.equal(validate(posixMissingParentChain), false,
    'POSIX enrollment must retain its explicit directory identity chain');
});


test('Windows role manifest schema permits only the tested NTFS service-identity policy', () => {
  const unsupportedFilesystem = manifest('windows', windowsIdentity);
  unsupportedFilesystem.filesystemPolicy.filesystem = 'ReFS';
  assert.equal(validate(unsupportedFilesystem), false,
    'Windows manifest schema must reject filesystems without VFS evidence');

  const unsupportedBoundary = manifest('windows', windowsIdentity);
  unsupportedBoundary.filesystemPolicy.directoryMutationBoundary = 'broker-exclusive-owner';
  assert.equal(validate(unsupportedBoundary), false,
    'Windows manifest schema must require the dedicated service identity boundary');

  const supported = manifest('windows', windowsIdentity);
  supported.filesystemPolicy.filesystem = 'NTFS';
  supported.filesystemPolicy.directoryMutationBoundary = 'dedicated-service-identity';
  assert.equal(validate(supported), true, JSON.stringify(validate.errors));
});


test('Windows role manifest schema rejects lifecycle transitions not supported by the read-only adapter', () => {
  const creatingSidecar = manifest('windows', windowsIdentity);
  creatingSidecar.roles[0].sidecars[0].state = 'creating';
  assert.equal(validate(creatingSidecar), false,
    'Windows enrollment cannot accept a sidecar creation transition without a durable coordinator');

  const deletingSidecar = manifest('windows', windowsIdentity);
  deletingSidecar.roles[0].sidecars[0].state = 'deleting';
  assert.equal(validate(deletingSidecar), false,
    'Windows enrollment cannot accept an interrupted delete transition');

  const disabledRole = manifest('windows', windowsIdentity);
  disabledRole.roles[0].state = 'disabled';
  disabledRole.roles[0].sidecars[0].state = 'retired';
  assert.equal(validate(disabledRole), false,
    'the Windows adapter only enrolls active roles');
});
