import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { scanHostArtifactRoots } from '../server-inventory-scanner.mjs';

test('scanner enumerates persisted artifacts without exposing their contents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-inventory-'));
  try {
    await mkdir(path.join(root, 'group'), { recursive: true });
    await writeFile(path.join(root, 'chat.jsonl'), '{"mes":"private text"}\n');
    await writeFile(path.join(root, 'group', 'chat.jsonl'), '{"mes":"another private text"}\n');
    const result = await scanHostArtifactRoots([{ domain: 'chats', path: root }]);
    assert.equal(result.status, 'CURRENT_SNAPSHOT_NON_AUTHORITATIVE');
    assert.equal(result.complete, true);
    assert.equal(result.historicalCompleteness, 'UNKNOWN');
    assert.equal(result.artifactCount, 2);
    assert.deepEqual(result.artifacts.map((item) => item.locator), ['chat.jsonl', 'group/chat.jsonl']);
    assert.ok(result.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
    assert.doesNotMatch(JSON.stringify(result), /private text/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner returns no partial inventory when a root is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-inventory-'));
  try {
    const result = await scanHostArtifactRoots([
      { domain: 'chats', path: root },
      { domain: 'missing', path: path.join(root, 'not-present') },
    ]);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.equal(result.complete, false);
    assert.deepEqual(result.artifacts, []);
    assert.equal(result.artifactCount, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('scanner fails closed on symbolic links rather than following external artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-inventory-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'host-inventory-outside-'));
  try {
    await writeFile(path.join(outside, 'secret.jsonl'), 'must not be read');
    await symlink(path.join(outside, 'secret.jsonl'), path.join(root, 'linked.jsonl'));
    const result = await scanHostArtifactRoots([{ domain: 'chats', path: root }]);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.equal(result.complete, false);
    assert.deepEqual(result.artifacts, []);
    assert.ok(result.errors.some((error) => error.includes('Symbolic link')));
    assert.doesNotMatch(JSON.stringify(result), /must not be read/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('scanner rejects invalid and duplicate root definitions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-inventory-'));
  try {
    const result = await scanHostArtifactRoots([
      { domain: 'chats', path: root },
      { domain: 'chats', path: root },
      { domain: 'relative', path: '.' },
    ]);
    assert.equal(result.status, 'INVENTORY_INCOMPLETE');
    assert.equal(result.complete, false);
    assert.deepEqual(result.artifacts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
