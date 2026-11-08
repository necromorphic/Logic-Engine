import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { HostAccountMutationReceiptStore } from '../extension-gateway/server-plugin/st-host-account-mutation-receipt-store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = () => randomUUID();
const scope = () => ({
  host_installation_id: uuid(),
  authenticated_account_id: uuid(),
  host_session_id: uuid(),
  mutation_id: uuid(),
  event_id: uuid(),
  mutation_digest: hash('request'),
  method: 'POST',
  route: '/api/characters/edit',
  operation: 'characters-edit',
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-account-mutation-'));
  const storeDir = path.join(root, '..', 'host-account-store-' + uuid());
  await mkdir(path.join(root, 'characters'));
  const state = new Map([['characters/a.png', hash('before')]]);
  const enumerate = async () => ({
    status: 'complete',
    entries: [...state].map(([filePath, sha256]) => ({ path: filePath, sha256 })),
  });
  const store = new HostAccountMutationReceiptStore({ directory: storeDir, enumerate });
  return { root, storeDir, store, state, directories: { root } };
}
test('commits one allowlisted account-root mutation and clears the account lock', async () => {
  const f = await fixture();
  const s = scope();
  try {
    const prepared = await f.store.prepare(s, { directories: f.directories, allowedPaths: ['characters/a.png'] });
    assert.equal(await f.store.hasPending(s), true);
    f.state.set('characters/a.png', hash('after'));
    const result = await f.store.commit(s, { directories: f.directories, lock_token: prepared.lock_token });
    assert.equal(result.status, 'COMMITTED');
    assert.equal(await f.store.hasPending(s), false);
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.storeDir, { recursive: true, force: true }); }
});
test('rejects an unexpected file change and leaves the account locked', async () => {
  const f = await fixture();
  const s = scope();
  try {
    const prepared = await f.store.prepare(s, { directories: f.directories, allowedPaths: ['characters/a.png'] });
    f.state.set('characters/a.png', hash('after'));
    f.state.set('settings.json', hash('unexpected'));
    await assert.rejects(f.store.commit(s, { directories: f.directories, lock_token: prepared.lock_token }), /PERSISTED_STATE_MISMATCH/);
    assert.equal(await f.store.hasPending(s), true);
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.storeDir, { recursive: true, force: true }); }
});
test('aborts only when the persisted root inventory is unchanged', async () => {
  const f = await fixture();
  const s = scope();
  try {
    const prepared = await f.store.prepare(s, { directories: f.directories, allowedPaths: ['characters/a.png'] });
    const result = await f.store.abort(s, { directories: f.directories, lock_token: prepared.lock_token });
    assert.equal(result.status, 'ABORTED');
    assert.equal(await f.store.hasPending(s), false);
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.storeDir, { recursive: true, force: true }); }
});
test('serializes concurrent account mutations across store instances', async () => {
  const f = await fixture();
  const s = scope();
  const second = new HostAccountMutationReceiptStore({ directory: f.storeDir, enumerate: async () => ({
    status: 'complete', entries: [...f.state].map(([filePath, sha256]) => ({ path: filePath, sha256 })),
  }) });
  try {
    await f.store.prepare(s, { directories: f.directories, allowedPaths: ['characters/a.png'] });
    await assert.rejects(second.prepare({ ...scope(), host_installation_id: s.host_installation_id,
      authenticated_account_id: s.authenticated_account_id }, {
      directories: f.directories, allowedPaths: ['characters/a.png'],
    }), /BUSY_OR_RECOVERY_REQUIRED/);
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.storeDir, { recursive: true, force: true }); }
});
test('rejects replay of a terminal mutation id', async () => {
  const f = await fixture();
  const s = scope();
  try {
    const prepared = await f.store.prepare(s, { directories: f.directories, allowedPaths: ['characters/a.png'] });
    f.state.set('characters/a.png', hash('after'));
    await f.store.commit(s, { directories: f.directories, lock_token: prepared.lock_token });
    await assert.rejects(f.store.prepare(s, { directories: f.directories, allowedPaths: ['characters/a.png'] }), /BUSY_OR_RECOVERY_REQUIRED|REPLAY/);
  } finally { await rm(f.root, { recursive: true, force: true }); await rm(f.storeDir, { recursive: true, force: true }); }
});
