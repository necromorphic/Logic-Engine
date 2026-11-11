import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signHostMutationReceipt,
  verifyHostMutationReceiptSignature,
} from '../host-adapter/extension-gateway/server-plugin/st-host-mutation-receipt-signature.mjs';

const event = Object.freeze({
  protocol_version: 1,
  host_installation_id: '11111111-1111-4111-8111-111111111111',
  authenticated_account_id: '22222222-2222-4222-8222-222222222222',
  host_session_id: '33333333-3333-4333-8333-333333333333',
  conversation_uuid: '44444444-4444-4444-8444-444444444444',
  event_id: '55555555-5555-4555-8555-555555555555',
  event_type: 'MUTATION_COMMITTED',
  mutation_id: '66666666-6666-4666-8666-666666666666',
  operation: 'message-send',
  mutation_digest: 'a'.repeat(64),
  receipt_digest: 'b'.repeat(64),
  occurred_at: '2026-11-11T14:00:00.000Z',
});
const adapterId = 'logic-engine-host';
const adapterToken = 'test-adapter-token-with-sufficient-entropy';

test('Host terminal mutation receipt signature verifies the exact signed envelope', () => {
  const signed = {
    ...event,
    receipt_signature: signHostMutationReceipt({ adapterId, adapterToken, event }),
  };
  assert.equal(verifyHostMutationReceiptSignature({ adapterId, adapterToken, event: signed }), true);
});

test('Host terminal mutation receipt signature rejects changed identity, scope, operation and receipt', () => {
  const signed = {
    ...event,
    receipt_signature: signHostMutationReceipt({ adapterId, adapterToken, event }),
  };
  for (const [key, value] of [
    ['host_installation_id', '77777777-7777-4777-8777-777777777777'],
    ['authenticated_account_id', '88888888-8888-4888-8888-888888888888'],
    ['host_session_id', '99999999-9999-4999-8999-999999999999'],
    ['conversation_uuid', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['event_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
    ['event_type', 'MUTATION_ABORTED'],
    ['mutation_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    ['operation', 'message-receive'],
    ['mutation_digest', 'c'.repeat(64)],
    ['receipt_digest', 'd'.repeat(64)],
    ['occurred_at', '2026-11-11T14:00:01.000Z'],
  ]) {
    assert.equal(
      verifyHostMutationReceiptSignature({ adapterId, adapterToken, event: { ...signed, [key]: value } }),
      false,
      key,
    );
  }
});

test('Host terminal mutation receipt signature rejects wrong key and malformed terminal events', () => {
  const signed = {
    ...event,
    receipt_signature: signHostMutationReceipt({ adapterId, adapterToken, event }),
  };
  assert.equal(verifyHostMutationReceiptSignature({
    adapterId, adapterToken: 'another-adapter-token-with-sufficient-entropy', event: signed,
  }), false);
  assert.equal(verifyHostMutationReceiptSignature({
    adapterId, adapterToken, event: { ...signed, event_type: 'MUTATION_PREPARED' },
  }), false);
  assert.equal(verifyHostMutationReceiptSignature({
    adapterId, adapterToken, event: { ...signed, receipt_signature: 'not-a-digest' },
  }), false);
  assert.throws(() => signHostMutationReceipt({
    adapterId, adapterToken, event: { ...event, receipt_digest: undefined },
  }), /HOST_MUTATION_RECEIPT_SIGNING_INPUT_INVALID/);
});
