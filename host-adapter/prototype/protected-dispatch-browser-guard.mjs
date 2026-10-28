import { hostLocatorHasEnrollment } from './conversation-identity.mjs';

/**
 * Fail closed for enrolled Host conversations until the PC-side dispatch
 * authority owns final authorization and the only upstream transport.
 * Ordinary non-enrolled conversations retain native SillyTavern behavior.
 */
export function assertProtectedDispatchAllowed({ locator, storage = globalThis.localStorage } = {}) {
  let enrolled = true;
  try {
    enrolled = hostLocatorHasEnrollment(locator, storage);
  } catch {
    enrolled = true;
  }
  if (enrolled) {
    throw new Error('PROTECTED_EGRESS_GATEWAY_REQUIRED');
  }
  return Object.freeze({ status: 'NOT_ENROLLED' });
}
