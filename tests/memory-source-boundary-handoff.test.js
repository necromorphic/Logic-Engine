import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const handoffPath = new URL('../docs/74-memory-source-identity-index-reconciliation-handoff.md', import.meta.url);

test('Memory source-boundary handoff records each required identity and lifecycle boundary', async () => {
  const doc = await readFile(handoffPath, 'utf8');

  for (const required of [
    'Canonical events',
    'Canonical entities',
    'Canonical facts and claims',
    'Relationships',
    'Context manifests',
    'External messages, generations, artifacts, and host/vector index',
    'Index stale/lagging',
    'Index missing/unavailable',
    'Index rebuilding',
    'Source retraction/invalidation',
    'Access revocation',
    'Cross-world lineage',
    'Rollback with unchanged `commit_sequence`',
    'Restart during reconciliation/rebuild',
    'Persistence, audit, and transaction boundary',
  ]) {
    assert.ok(doc.includes(required), `handoff must cover: ${required}`);
  }
});

test('Memory source-boundary handoff anchors claims to exact current-main paths and named tests', async () => {
  const doc = await readFile(handoffPath, 'utf8');

  for (const evidence of [
    'src/storage/sqlite-store.js',
    'src/api/server.js',
    'src/application/authorized-read-service.js',
    'tests/snapshot-read.test.js',
    'tests/authorized-read-service.test.js',
    'tests/authorized-read-api.test.js',
    'internal snapshot preserves the composite marker across rollback-only revision changes',
    'snapshot reports requested context manifests that do not exist in the requested world',
    'snapshot does not expand a manifest after rollback changes revision without advancing the event cursor',
  ]) {
    assert.ok(doc.includes(evidence), `handoff must identify evidence: ${evidence}`);
  }
});

test('Memory source-boundary handoff preserves fail-closed and owner-decision limits', async () => {
  const doc = await readFile(handoffPath, 'utf8');

  for (const boundary of [
    'currentness unproven',
    'Core + Memory',
    'Core owns',
    'No new API, schema, store/table, outbox, cursor',
    'does not authorize broad production reads or production Memory→NPC wiring',
    'reopen completed Issue #129',
    'These are **future Memory integration acceptance tests**',
  ]) {
    assert.ok(doc.includes(boundary), `handoff must preserve boundary: ${boundary}`);
  }
});
