#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAcceptedHeadStatusSync } from '../../src/security/accepted-head-client-sync.js';

const checks = [];
const add = (id, status, detail) => checks.push({ id, status, detail });
const present = (name) => typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
const envPath = (name) => present(name) ? resolve(process.env[name]) : null;

function sameFile(left, right) {
  if (!left || !right) return false;
  const a = resolve(left), b = resolve(right);
  if (a === b) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const x = statSync(realpathSync(a), { bigint: true });
  const y = statSync(realpathSync(b), { bigint: true });
  return x.dev === y.dev && x.ino === y.ino;
}

function inspectDatabase(id, path, requiredTables = []) {
  if (!path) {
    add(id, 'BLOCKED', 'database path is not configured');
    return null;
  }
  if (!existsSync(path)) {
    add(id, 'BLOCKED', 'database file does not exist');
    return null;
  }
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') {
      add(id, 'FAIL', 'SQLite integrity_check did not return ok');
      return null;
    }
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const missing = requiredTables.filter(name => !tables.has(name));
    if (missing.length) {
      add(id, 'BLOCKED', 'missing required tables: ' + missing.join(', '));
      return { db, tables };
    }
    add(id, 'PASS', 'file-backed SQLite database is readable and integrity_check=ok');
    return { db, tables };
  } catch (error) {
    add(id, 'FAIL', 'database could not be inspected: ' + (error?.code || error?.message || 'unknown error'));
    try { db?.close(); } catch {}
    return null;
  }
}

const corePath = envPath('ENGINE_DB_PATH');
const providerPath = envPath('ENGINE_MEMORY_PROVIDER_DB_PATH');
const coordinatorPath = envPath('LOGIC_ENGINE_COORDINATOR_DB_PATH');
const authorityPath = envPath('LOGIC_ENGINE_ACCEPTED_HEAD_AUTHORITY_DB_PATH')
  || envPath('LOGIC_ENGINE_ACCEPTED_HEAD_DB_PATH');
const noncePath = envPath('ENGINE_HOST_ASSERTION_NONCE_DB_PATH');
const lifecyclePath = envPath('ENGINE_HOST_LIFECYCLE_DB_PATH');
const versionPath = envPath('ENGINE_HOST_VERSION_LEDGER_DB_PATH');

const core = inspectDatabase('core_db', corePath, ['accepted_head_state']);
const provider = inspectDatabase('provider_db', providerPath, ['accepted_head_state']);
const coordinator = inspectDatabase('coordinator_db', coordinatorPath);
const authority = inspectDatabase('accepted_head_authority_db', authorityPath, [
  'authority_installation', 'authority_domain_heads', 'authority_operations',
]);
const nonce = inspectDatabase('host_assertion_nonce_db', noncePath);
const lifecycle = inspectDatabase('host_lifecycle_db', lifecyclePath);
const version = inspectDatabase('host_version_ledger_db', versionPath);

for (const [name, path] of [
  ['Core', corePath], ['Provider', providerPath], ['Coordinator', coordinatorPath],
  ['Accepted Head Authority', authorityPath], ['Host nonce', noncePath],
  ['Host lifecycle', lifecyclePath], ['Host version ledger', versionPath],
]) {
  if (!path) continue;
  if (!existsSync(path)) continue;
  for (const [otherName, otherPath] of [
    ['Core', corePath], ['Provider', providerPath], ['Coordinator', coordinatorPath],
    ['Accepted Head Authority', authorityPath], ['Host nonce', noncePath],
    ['Host lifecycle', lifecyclePath], ['Host version ledger', versionPath],
  ]) {
    if (name >= otherName || !otherPath || !existsSync(otherPath)) continue;
    if (sameFile(path, otherPath)) add('database_separation', 'FAIL', name + ' aliases ' + otherName);
  }
}
if (!checks.some(x => x.id === 'database_separation' && x.status === 'FAIL')) {
  add('database_separation', 'PASS', 'no configured database paths alias one another');
}

function readAcceptedHead(db, id) {
  if (!db) return;
  try {
    const row = db.prepare('SELECT head, enrolled FROM accepted_head_state WHERE singleton=1').get();
    if (!row || !Number.isSafeInteger(row.head) || ![0, 1].includes(row.enrolled)) {
      add(id, 'FAIL', 'local accepted-head state is missing or malformed');
      return;
    }
    add(id, row.enrolled === 1 && row.head >= 1 ? 'PASS' : 'BLOCKED',
      'local accepted-head enrollment=' + (row.enrolled === 1 ? 'yes' : 'no') + ', head=' + row.head);
  } catch {
    add(id, 'FAIL', 'local accepted-head state could not be read');
  }
}
readAcceptedHead(core?.db, 'core_accepted_head');
readAcceptedHead(provider?.db, 'provider_accepted_head');

for (const [name, db] of [
  ['core_db', core?.db], ['provider_db', provider?.db], ['coordinator_db', coordinator?.db],
  ['accepted_head_authority_db', authority?.db], ['host_assertion_nonce_db', nonce?.db],
  ['host_lifecycle_db', lifecycle?.db], ['host_version_ledger_db', version?.db],
]) {
  try { db?.close(); } catch {}
}

if (present('ENGINE_MEMORY_NPC_ENABLED') && process.env.ENGINE_MEMORY_NPC_ENABLED === 'true') {
  add('memory_npc_flag', 'WARN', 'Memory NPC flag is enabled; this preflight does not authorize production activation');
} else {
  add('memory_npc_flag', 'PASS', 'Memory NPC is not enabled by this preflight');
}
if (!present('ENGINE_MEMORY_NPC_CONTENT_FIELDS')) {
  add('content_field_allowlist', 'BLOCKED', 'ENGINE_MEMORY_NPC_CONTENT_FIELDS is not configured');
} else {
  try {
    const fields = JSON.parse(process.env.ENGINE_MEMORY_NPC_CONTENT_FIELDS);
    add('content_field_allowlist', Array.isArray(fields) && fields.length > 0 ? 'PASS' : 'BLOCKED',
      Array.isArray(fields) && fields.length > 0 ? 'explicit field allowlist is present' : 'allowlist must be a non-empty JSON array');
  } catch {
    add('content_field_allowlist', 'FAIL', 'allowlist is not valid JSON');
  }
}

if (present('LOGIC_ENGINE_ACCEPTED_HEAD_PORT') && present('LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN')) {
  try {
    const status = getAcceptedHeadStatusSync({
      port: Number(process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PORT),
      token: process.env.LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN,
    });
    const ready = status.enrolled.core && status.enrolled.provider
      && !status.pending.core && !status.pending.provider;
    add('accepted_head_authority', ready ? 'PASS' : 'BLOCKED',
      'Core enrolled=' + status.enrolled.core + ', Provider enrolled=' + status.enrolled.provider
      + ', pending Core=' + status.pending.core + ', pending Provider=' + status.pending.provider);
  } catch {
    add('accepted_head_authority', 'FAIL', 'authority status could not be read with the configured read-only credential');
  }
} else {
  add('accepted_head_authority', 'BLOCKED', 'authority port or read-only credential is not configured');
}

const blockers = checks.filter(x => ['BLOCKED', 'FAIL'].includes(x.status));
const failures = checks.filter(x => x.status === 'FAIL');
const report = {
  result: failures.length ? 'FAIL' : blockers.length ? 'NOT_READY' : 'PREFLIGHT_ONLY',
  note: 'Read-only diagnostic. It does not enroll accepted heads, grant Provider access, alter Host authority, or enable Memory → NPC.',
  checks,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (failures.length) process.exitCode = 2;
else if (blockers.length) process.exitCode = 1;
