#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SQLiteMemoryProvider } from '../../src/application/sqlite-memory-provider.js';

const [providerPathArg, coordinatorPathArg] = process.argv.slice(2);
if (!providerPathArg || !coordinatorPathArg) {
  process.stderr.write('Usage: node provision-provider-schema.mjs <provider-db> <coordinator-db>\n');
  process.exit(2);
}
const providerPath = resolve(providerPathArg);
const coordinatorPath = resolve(coordinatorPathArg);
if (providerPath === coordinatorPath) throw new Error('PROVIDER_COORDINATOR_PATH_ALIAS');

const requiredTables = [
  'memory_records',
  'memory_index_entries',
  'memory_query_grants',
  'memory_record_grants',
  'memory_index_state',
  'accepted_head_state',
  'accepted_head_enrollment_audit',
  'memory_raw_captures',
  'memory_raw_active_versions',
  'memory_raw_derived_copies',
];

if (existsSync(providerPath)) {
  const db = new DatabaseSync(providerPath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const missing = requiredTables.filter(name => !tables.has(name));
    const head = tables.has('accepted_head_state')
      ? db.prepare('SELECT head,enrolled FROM accepted_head_state WHERE singleton=1').get()
      : null;
    if (integrity !== 'ok' || missing.length || !head
      || !Number.isSafeInteger(head.head) || ![0, 1].includes(head.enrolled)) {
      throw new Error('EXISTING_PROVIDER_DATABASE_INVALID');
    }
    process.stdout.write(JSON.stringify({
      status: 'EXISTING_PROVIDER_DATABASE_VERIFIED_READ_ONLY',
      integrity: 'ok',
      missing_tables: [],
      accepted_head_enrolled: head.enrolled === 1,
      accepted_head: head.head,
      writes_performed: false,
    }) + '\n');
  } finally {
    db.close();
  }
} else {
  const provider = new SQLiteMemoryProvider({
    path: providerPath,
    coordinatorPath,
    // These fail-closed callbacks are never invoked during schema construction.
    // No records, grants, indexes, or Memory content are created by this bootstrap.
    getSnapshot: () => { throw new Error('PROVIDER_SCHEMA_BOOTSTRAP_ONLY'); },
    validateSourceVersion: () => { throw new Error('PROVIDER_SCHEMA_BOOTSTRAP_ONLY'); },
    validateInventory: () => { throw new Error('PROVIDER_SCHEMA_BOOTSTRAP_ONLY'); },
  });
  provider.close();
  process.stdout.write(JSON.stringify({
    status: 'PROVIDER_SCHEMA_CREATED',
    accepted_head_enrolled: false,
    accepted_head: 0,
    records_created: 0,
    grants_created: 0,
    memory_content_created: false,
  }) + '\n');
}
