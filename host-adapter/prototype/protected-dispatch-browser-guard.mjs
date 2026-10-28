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


/**
 * Deny direct browser egress while any Host conversation is enrolled.
 * Same-origin requests remain subject to the server-side deny middleware;
 * external fetch/XHR requests fail before the browser transport is invoked.
 * This is a defensive fence, not proof against arbitrary script primitives,
 * image/navigation beacons, or a compromised extension.
 */
export function installProtectedEgressBrowserFence({
  globalObject = globalThis,
  getLocator = () => null,
  getMessages = () => [],
  getStorage = () => globalObject.localStorage,
  getBaseUrl = () => globalObject.location?.href,
} = {}) {
  const nativeFetch = globalObject.fetch;
  const xhrPrototype = globalObject.XMLHttpRequest?.prototype;
  const nativeXhrOpen = xhrPrototype?.open;
  if (typeof nativeFetch !== 'function') throw new TypeError('Browser fetch is unavailable');

  const assertExternalEgressAllowed = (rawUrl) => {
    let target;
    let base;
    try {
      const baseUrl = getBaseUrl();
      if (typeof baseUrl !== 'string' || !baseUrl) throw new Error('Browser base URL unavailable');
      base = new URL(baseUrl);
      target = new URL(typeof rawUrl === 'string' ? rawUrl : String(rawUrl), base);
    } catch {
      throw new Error('PROTECTED_EGRESS_GATEWAY_REQUIRED');
    }
    if (target.origin === base.origin) return;
    assertProtectedDispatchAllowed({
      locator: getLocator(),
      messages: getMessages(),
      storage: getStorage(),
    });
  };

  globalObject.fetch = function protectedEgressFetch(input, ...args) {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    assertExternalEgressAllowed(rawUrl);
    return nativeFetch.call(this, input, ...args);
  };

  if (xhrPrototype && typeof nativeXhrOpen === 'function') {
    xhrPrototype.open = function protectedEgressXhrOpen(method, url, ...args) {
      assertExternalEgressAllowed(url);
      return nativeXhrOpen.call(this, method, url, ...args);
    };
  }

  return function uninstallProtectedEgressBrowserFence() {
    globalObject.fetch = nativeFetch;
    if (xhrPrototype && typeof nativeXhrOpen === 'function') xhrPrototype.open = nativeXhrOpen;
  };
}
