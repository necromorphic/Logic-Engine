import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeWindowsIntentBytes,
  encodeWindowsManifestBytes,
  parseWindowsIntentBytes,
  parseWindowsManifestBytes,
} from '../native/secure-vfs-probe/windows-manifest-json.js';

const identity = (id) => ({
  kind: 'windows',
  volumeSerial: '00000000000000A1',
  fileId: id.padStart(32, '0'),
});

function manifest() {
  return {
    schemaVersion: 1,
    generation: 1,
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
      sidecars: [],
    }],
  };
}

function intent() {
  return {
    schemaVersion: 1,
    operationId: '0123456789abcdef0123456789abcdef',
    operation: 'create-sidecar',
    role: 'core',
    kind: 'wal',
    basename: 'core.sqlite-wal',
    baseGeneration: 1,
    targetGeneration: 2,
    expectedIdentity: null,
  };
}

const bytes = (value) => Buffer.from(value, 'utf8');

test('strict manifest parser round-trips validated Windows manifest bytes', () => {
  const original = manifest();
  const encoded = encodeWindowsManifestBytes(original);
  assert.deepEqual(parseWindowsManifestBytes(encoded), original);
});

test('strict intent parser round-trips validated lifecycle intent bytes', () => {
  const original = intent();
  const encoded = encodeWindowsIntentBytes(original);
  assert.deepEqual(parseWindowsIntentBytes(encoded), original);
});

test('strict parser rejects duplicate keys at every object depth', () => {
  assert.throws(
    () => parseWindowsManifestBytes(bytes('{"schemaVersion":1,"schemaVersion":1}')),
    /duplicate object key/,
  );
  assert.throws(
    () => parseWindowsManifestBytes(bytes('{"outer":{"generation":1,"generation":2}}')),
    /duplicate object key/,
  );
});

test('strict parser detects duplicate keys after JSON escape decoding', () => {
  assert.throws(
    () => parseWindowsManifestBytes(bytes('{"schemaVersion":1,"\\u0073chemaVersion":1}')),
    /duplicate object key "schemaVersion"/,
  );
});

test('strict parser rejects invalid UTF-8, BOM and trailing JSON content', () => {
  assert.throws(() => parseWindowsManifestBytes(Uint8Array.from([0xff, 0xfe])), /valid UTF-8/);
  assert.throws(() => parseWindowsManifestBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), /BOM/);
  assert.throws(() => parseWindowsManifestBytes(bytes('{} {}')), /trailing content/);
});

test('strict parser rejects malformed escapes, unpaired surrogates and trailing commas', () => {
  assert.throws(() => parseWindowsManifestBytes(bytes('{"x":"\\x"}')), /invalid escape/);
  assert.throws(() => parseWindowsManifestBytes(bytes('{"x":"\\ud800"}')), /Unpaired high surrogate/);
  assert.throws(() => parseWindowsManifestBytes(bytes('{"x":1,}')), /expected string/);
  assert.throws(() => parseWindowsManifestBytes(bytes('[1,]')), /expected value/);
});

test('strict parser enforces nesting, token and byte limits', () => {
  const nested = '['.repeat(34) + '0' + ']'.repeat(34);
  assert.throws(() => parseWindowsManifestBytes(bytes(nested)), /maximum nesting depth/);
  assert.throws(() => parseWindowsManifestBytes(new Uint8Array(1024 * 1024 + 1)), /size limit/);
  assert.throws(() => parseWindowsManifestBytes(new Uint8Array(0)), /empty/);
});

test('manifest and intent validators reject schema-invalid but syntactically valid JSON', () => {
  const invalidManifest = manifest();
  invalidManifest.filesystemPolicy.filesystem = 'ReFS';
  assert.throws(() => parseWindowsManifestBytes(bytes(JSON.stringify(invalidManifest))), /filesystem trust policy/);

  const invalidIntent = intent();
  invalidIntent.extra = true;
  assert.throws(() => parseWindowsIntentBytes(bytes(JSON.stringify(invalidIntent))), /unknown or missing fields/);
});
