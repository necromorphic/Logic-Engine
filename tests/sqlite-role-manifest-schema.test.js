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
    directoryMutationBoundary: 'broker-exclusive-owner',
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

  const mixedPlatform = manifest('linux', windowsIdentity);
  assert.equal(validate(mixedPlatform), false,
    'a Linux manifest must not contain Windows file identities');
});

test('Linux role manifest requires an explicit application UID', () => {
  const missingUid = manifest('linux', posixIdentity);
  delete missingUid.filesystemPolicy.applicationUid;
  assert.equal(validate(missingUid), false, 'Linux manifest without applicationUid must fail closed');

  const negativeUid = manifest('linux', posixIdentity);
  negativeUid.filesystemPolicy.applicationUid = -1;
  assert.equal(validate(negativeUid), false, 'negative applicationUid must fail closed');

  assert.equal(validate(manifest('windows', windowsIdentity)), true,
    'Windows manifest must not require a POSIX application UID');
});
