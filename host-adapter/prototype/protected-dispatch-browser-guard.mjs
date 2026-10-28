import { hasAnyHostEnrollment, hostLocatorHasEnrollment } from './conversation-identity.mjs';

function hasConversationLifecycleIdentity(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    const identity = message?._logicEngineLifecycle;
    return identity && typeof identity === 'object'
      && typeof identity.messageId === 'string' && identity.messageId.length > 0
      && Array.isArray(identity.versions);
  });
}

/**
 * Fail closed for enrolled Host conversations until the PC-side dispatch
 * authority owns final authorization and the only upstream transport.
 *
 * Enrollment evidence is checked in both localStorage and the current native
 * chat projection. Losing localStorage registration markers must not turn a
 * chat with durable Host lifecycle identity metadata into an unprotected chat.
 * If any other Host enrollment remains, unknown locators also fail closed.
 */
export function assertProtectedDispatchAllowed({ locator, messages, storage = globalThis.localStorage } = {}) {
  let enrolled = true;
  try {
    const locatorEnrolled = hostLocatorHasEnrollment(locator, storage);
    const installationHasEnrollments = hasAnyHostEnrollment(storage);
    const chatHasLifecycleIdentity = hasConversationLifecycleIdentity(messages);
    enrolled = locatorEnrolled || installationHasEnrollments || chatHasLifecycleIdentity;
  } catch {
    enrolled = true;
  }
  if (enrolled) {
    throw new Error('PROTECTED_EGRESS_GATEWAY_REQUIRED');
  }
  return Object.freeze({ status: 'NOT_ENROLLED' });
}
