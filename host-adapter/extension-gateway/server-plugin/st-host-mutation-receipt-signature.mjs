import { createHmac, timingSafeEqual } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonical(value) {
  return Array.isArray(value)
    ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object'
      ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
      : JSON.stringify(value);
}

function proofFor(adapterId, event) {
  return {
    protocol_version: 1,
    adapter_id: adapterId,
    host_installation_id: event.host_installation_id,
    authenticated_account_id: event.authenticated_account_id,
    host_session_id: event.host_session_id,
    conversation_uuid: event.conversation_uuid,
    event_id: event.event_id,
    event_type: event.event_type,
    mutation_id: event.mutation_id,
    operation: event.operation,
    mutation_digest: event.mutation_digest,
    receipt_digest: event.receipt_digest,
    occurred_at: event.occurred_at,
  };
}

function validProofInput(adapterId, adapterToken, event) {
  return typeof adapterId === 'string' && adapterId.trim().length > 0
    && typeof adapterToken === 'string' && adapterToken.length >= 16
    && event && typeof event === 'object' && !Array.isArray(event)
    && UUID.test(event.host_installation_id ?? '')
    && UUID.test(event.authenticated_account_id ?? '')
    && UUID.test(event.host_session_id ?? '')
    && UUID.test(event.conversation_uuid ?? '')
    && UUID.test(event.event_id ?? '')
    && UUID.test(event.mutation_id ?? '')
    && ['MUTATION_COMMITTED', 'MUTATION_ABORTED'].includes(event.event_type)
    && typeof event.operation === 'string' && event.operation.length > 0
    && DIGEST.test(event.mutation_digest ?? '')
    && DIGEST.test(event.receipt_digest ?? '')
    && typeof event.occurred_at === 'string'
    && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(event.occurred_at)
    && Number.isFinite(Date.parse(event.occurred_at));
}

/**
 * Sign a terminal Host mutation receipt after the server-owned receipt store
 * has verified the persisted before/after transition.
 */
export function signHostMutationReceipt({ adapterId, adapterToken, event } = {}) {
  if (!validProofInput(adapterId, adapterToken, event)) {
    throw new TypeError('HOST_MUTATION_RECEIPT_SIGNING_INPUT_INVALID');
  }
  return createHmac('sha256', adapterToken)
    .update(canonical(proofFor(adapterId, event)), 'utf8')
    .digest('hex');
}

/**
 * Verify the exact terminal event envelope received by Core. The signature
 * binds identity, conversation, event, operation, intent digest, durable receipt
 * digest and timestamp; changing any field invalidates the proof.
 */
export function verifyHostMutationReceiptSignature({ adapterId, adapterToken, event } = {}) {
  if (!validProofInput(adapterId, adapterToken, event)
    || !DIGEST.test(event.receipt_signature ?? '')) return false;
  const expected = Buffer.from(signHostMutationReceipt({ adapterId, adapterToken, event }), 'hex');
  const actual = Buffer.from(event.receipt_signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
