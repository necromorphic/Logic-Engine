import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PINNED_PATCH_BUNDLE_SHA256,
  PINNED_HOST_HANDLER_GIT_BLOB_SHA,
} from '../host-adapter/extension-gateway/server-plugin/st-source-attestation.mjs';

const read = relative => readFileSync(resolve(process.cwd(), relative));
const gitBlobSha = bytes => createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
  .update(bytes)
  .digest('hex');
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('Host and Core pin the same exact lifecycle patch bundle and inventory handler', () => {
  const core = read('src/application/host-lifecycle-journal.js').toString('utf8');
  const corePatchPin = core.match(/const HOST_INVENTORY_PATCH_BLOB_SHA = '([a-f0-9]{64})';/)?.[1];
  const coreHandlerPin = core.match(/const HOST_INVENTORY_HANDLER_BLOB_SHA = '([a-f0-9]{40})';/)?.[1];

  const lifecyclePatch = gitBlobSha(read('host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-hooks.patch'));
  const unenrolledFixPatch = gitBlobSha(read('host-adapter/prototype/patches/sillytavern-1.19.0-lifecycle-unenrolled-chat-fix.patch'));
  const rootMutationPatch = gitBlobSha(read('host-adapter/prototype/patches/sillytavern-1.19.0-root-mutation-guards.patch'));
  const actualPatchBundle = sha256([lifecyclePatch, unenrolledFixPatch, rootMutationPatch].join('\n'));
  const actualHandler = gitBlobSha(read('host-adapter/extension-gateway/server-plugin/st-host-inventory-handler.mjs'));

  assert.equal(PINNED_PATCH_BUNDLE_SHA256, actualPatchBundle,
    'Gateway patch bundle pin must match the exact three reviewed patch layers');
  assert.equal(corePatchPin, PINNED_PATCH_BUNDLE_SHA256,
    'Core must accept only the Gateway-pinned patch bundle');
  assert.equal(PINNED_HOST_HANDLER_GIT_BLOB_SHA, actualHandler,
    'Gateway handler pin must match its exact Git blob identity');
  assert.equal(coreHandlerPin, PINNED_HOST_HANDLER_GIT_BLOB_SHA,
    'Core must accept only the exact Gateway handler blob');
});

test('Legacy Host overlay verification compares canonical LF hashes on every platform', () => {
  const installer = read('scripts/install-sillytavern-host-patch-bundle.mjs').toString('utf8');
  assert.ok(installer.includes('previousHostFileHash === sha256(normalizeText(targetBytes))'),
    'installer must compare the canonical hash returned by verifyLegacyHostBundle');
  assert.equal(installer.includes('previousHostFileHash === sha256(targetBytes)'), false,
    'raw CRLF bytes must not be compared with the canonical LF hash');
});
