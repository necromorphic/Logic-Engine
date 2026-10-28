import { hasAnyHostEnrollment, hostLocatorHasEnrollment } from './conversation-identity.mjs';

/**
 * Fail closed for enrolled Host conversations until the PC-side dispatch
 * authority owns final authorization and the only upstream transport.
 *
 * If any Host enrollment exists but this locator has lost its own markers,
 * treat the missing binding as ambiguous/corrupt state, not proof that the
 * conversation is unprotected. This intentionally blocks unknown chats once
 * the installation has enrolled Host conversations.
 */
export function assertProtectedDispatchAllowed({ locator, storage = globalThis.localStorage } = {}) {
  let enrolled = true;
  try {
    const locatorEnrolled = hostLocatorHasEnrollment(locator, storage);
    const installationHasEnrollments = hasAnyHostEnrollment(storage);
    enrolled = locatorEnrolled || installationHasEnrollments;
  } catch {
    enrolled = true;
  }
  if (enrolled) {
    throw new Error('PROTECTED_EGRESS_GATEWAY_REQUIRED');
  }
  return Object.freeze({ status: 'NOT_ENROLLED' });
}
