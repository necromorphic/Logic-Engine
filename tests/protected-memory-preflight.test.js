import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const script = fileURLToPath(new URL('../scripts/acceptance/protected-memory-preflight.mjs', import.meta.url));

function makeDatabase(path, sql = '') {
  const db = new DatabaseSync(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function runPreflight(paths) {
  const env = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    WINDIR: process.env.WINDIR || '',
    ENGINE_DB_PATH: paths.core,
    ENGINE_MEMORY_PROVIDER_DB_PATH: paths.provider,
    LOGIC_ENGINE_COORDINATOR_DB_PATH: paths.coordinator,
    LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH: paths.authority,
    ENGINE_HOST_ASSERTION_NONCE_DB_PATH: paths.nonce,
    ENGINE_HOST_LIFECYCLE_DB_PATH: paths.lifecycle,
    ENGINE_HOST_VERSION_LEDGER_DB_PATH: paths.version,
    ENGINE_MEMORY_NPC_CONTENT_FIELDS: '[]',
    LOGIC_ENGINE_MEMORY_NPC_ENABLED: 'false',
  };
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env,
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

test('protected Memory preflight reports missing prerequisites without creating files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-memory-preflight-'));
  const paths = Object.fromEntries([
    ['core', 'core.sqlite'], ['provider', 'provider.sqlite'], ['coordinator', 'coordinator.sqlite'],
    ['authority', 'authority.sqlite'], ['nonce', 'nonce.sqlite'], ['lifecycle', 'lifecycle.sqlite'],
    ['version', 'version.sqlite'],
  ].map(([key, name]) => [key, join(dir, name)]));
  try {
    const result = runPreflight(paths);
    assert.equal(result.status, 1);
    assert.equal(result.report.result, 'NOT_READY');
    assert.ok(result.report.checks.some(item => item.id === 'provider_db' && item.status === 'BLOCKED'));
    assert.ok(result.report.checks.some(item => item.id === 'accepted_head_authority' && item.status === 'BLOCKED'));
    for (const path of Object.values(paths)) assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('protected Memory preflight identifies unhealthy or un-enrolled accepted-head prerequisites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logic-memory-preflight-'));
  const paths = Object.fromEntries([
    ['core', 'core.sqlite'], ['provider', 'provider.sqlite'], ['coordinator', 'coordinator.sqlite'],
    ['authority', 'authority.sqlite'], ['nonce', 'nonce.sqlite'], ['lifecycle', 'lifecycle.sqlite'],
    ['version', 'version.sqlite'],
  ].map(([key, name]) => [key, join(dir, name)]));
  try {
    const acceptedHeadSql = `
      CREATE TABLE accepted_head_state(
        singleton INTEGER PRIMARY KEY, head INTEGER NOT NULL, enrolled INTEGER NOT NULL
      );
      INSERT INTO accepted_head_state VALUES(1,0,0);
    `;
    makeDatabase(paths.core, acceptedHeadSql);
    makeDatabase(paths.provider, acceptedHeadSql);
    makeDatabase(paths.coordinator, 'CREATE TABLE coordinator_lock(singleton INTEGER PRIMARY KEY);');
    makeDatabase(paths.authority, `
      CREATE TABLE authority_installation(singleton INTEGER PRIMARY KEY, installation_id TEXT);
      CREATE TABLE authority_domain_heads(domain TEXT PRIMARY KEY, head INTEGER, enrolled INTEGER);
      CREATE TABLE authority_operations(operation_id TEXT PRIMARY KEY, domain TEXT, resulting_head INTEGER, operation_digest TEXT, operation_kind TEXT, status TEXT, created_at TEXT);
    `);
    for (const key of ['nonce', 'lifecycle', 'version']) makeDatabase(paths[key]);
    const result = runPreflight(paths);
    assert.equal(result.status, 1);
    assert.equal(result.report.result, 'NOT_READY');
    assert.ok(result.report.checks.some(item => item.id === 'core_accepted_head' && item.status === 'BLOCKED'));
    assert.ok(result.report.checks.some(item => item.id === 'provider_accepted_head' && item.status === 'BLOCKED'));
    assert.ok(result.report.checks.some(item => item.id === 'accepted_head_authority' && item.status === 'BLOCKED'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
