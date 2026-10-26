import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectHostInventoryForComparison } from '../inventory-projection.mjs';

const hostDigest = text => createHash('sha256').update(JSON.stringify(String(text)), 'utf8').digest('hex');
const message = ({ id, versions, active = 0 }) => ({
  is_user: true,
  mes: versions[active],
  swipes: versions,
  swipe_id: active,
  _logicEngineLifecycle: {
    messageId: id,
    activeVersionIndex: active,
    versions: versions.map((text, index) => ({
      versionId: `${id}-v${index}`,
      versionIndex: index,
      payloadDigest: hostDigest(text),
      parentVersionId: index ? `${id}-v${index - 1}` : null,
    })),
  },
});

test('projection maps Host metadata to Provider canonical row shape but stays review-only', () => {
  const result = projectHostInventoryForComparison([
    message({ id: 'msg-b', versions: ['B0', 'B1'], active: 1 }),
    message({ id: 'msg-a', versions: ['A0'] }),
  ]);
  assert.equal(result.status, 'REVIEW_ONLY');
  assert.equal(result.authority, 'NON_AUTHORITATIVE');
  assert.equal(result.completeness, 'UNPROVEN');
  assert.deepEqual(result.rows.map(row => [row.message_id, row.version_id, row.active]), [
    ['msg-a', 'msg-a-v0', true],
    ['msg-b', 'msg-b-v0', false],
    ['msg-b', 'msg-b-v1', true],
  ]);
  assert.ok(result.blockers.includes('CORE_WORLD_BINDING_MISSING'));
  assert.ok(result.blockers.includes('PAYLOAD_DIGEST_SEMANTICS_UNAPPROVED'));
});

test('canonical inventory digest is stable when native message array order changes', () => {
  const a = message({ id: 'msg-a', versions: ['A0'] });
  const b = message({ id: 'msg-b', versions: ['B0', 'B1'], active: 1 });
  assert.equal(
    projectHostInventoryForComparison([a, b]).inventory_sha256,
    projectHostInventoryForComparison([b, a]).inventory_sha256,
  );
});

test('active swipe changes only the active flag in normalized inventory', () => {
  const before = projectHostInventoryForComparison([message({ id: 'msg-a', versions: ['A0', 'A1'], active: 0 })]);
  const after = projectHostInventoryForComparison([message({ id: 'msg-a', versions: ['A0', 'A1'], active: 1 })]);
  assert.notEqual(before.inventory_sha256, after.inventory_sha256);
  assert.deepEqual(after.rows.map(row => row.active), [false, true]);
});

test('missing identity, duplicate IDs, and source digest mismatch fail closed', () => {
  assert.equal(projectHostInventoryForComparison([{ mes: 'x' }]).status, 'NON_READY');

  const duplicate = message({ id: 'same', versions: ['x'] });
  assert.equal(projectHostInventoryForComparison([duplicate, structuredClone(duplicate)]).reason, 'DUPLICATE_MESSAGE_ID');

  const corrupted = message({ id: 'msg-x', versions: ['x'] });
  corrupted._logicEngineLifecycle.versions[0].payloadDigest = '0'.repeat(64);
  assert.equal(projectHostInventoryForComparison([corrupted]).reason, 'HOST_DIGEST_MISMATCH');
});

test('non-array inventory fails closed', () => {
  assert.deepEqual(projectHostInventoryForComparison(null), { status: 'NON_READY', reason: 'CHAT_NOT_ENUMERABLE' });
});


test('multiple swipes without an explicit active index fail closed', () => {
  const ambiguous = message({ id: 'msg-ambiguous', versions: ['A0', 'A1'], active: 0 });
  delete ambiguous.swipe_id;
  const result = projectHostInventoryForComparison([ambiguous]);
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.reason, 'ACTIVE_SELECTION_MISMATCH');
});

test('swipe array reorder cannot silently reassign immutable version identities by slot', () => {
  const reordered = message({ id: 'msg-reordered', versions: ['A0', 'A1'], active: 0 });
  reordered.swipes = ['A1', 'A0'];
  reordered.mes = 'A1';
  reordered.swipe_id = 0;
  reordered._logicEngineLifecycle.activeVersionIndex = 0;
  const result = projectHostInventoryForComparison([reordered]);
  assert.equal(result.status, 'NON_READY');
  assert.equal(result.reason, 'HOST_DIGEST_MISMATCH');
});
