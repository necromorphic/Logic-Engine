import { contentDigest, fingerprintSource } from './lifecycle-journal.mjs';

const rawVersions = message => Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes ?? ''];
const roleOf = message => message.is_user ? 'user' : message.is_system ? 'system' : 'assistant';
const activeIndex = message => Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
const CURRENTLY_HOOKED_PATHS = Object.freeze(['create-message', 'create-swipe', 'select-swipe', 'delete-swipe', 'delete-message', 'edit-message', 'clear-chat']);
const newId = () => {
  if (!globalThis.crypto?.randomUUID) throw Error('crypto.randomUUID unavailable; Host capture NON_READY');
  return globalThis.crypto.randomUUID();
};

/**
 * Opt-in adapter boundary for explicit native ST hooks.
 * This is not a complete inventory until every mutation path is wired and tested.
 */
export function createStLifecycleBridge({ journal, getConversationId, getChat, saveChat }) {
  if (!journal || !getConversationId || !getChat || !saveChat) throw TypeError('Missing Host lifecycle bridge dependency');

  async function currentFingerprint(chat = getChat()) {
    if (!Array.isArray(chat)) throw Error('NON_READY: current chat is not an array');
    return fingerprintSource(chat);
  }

  async function enrolledOrFailClosed(conversationId) {
    const enrolled = await journal.isEnrolled(conversationId);
    const marker = globalThis.localStorage?.getItem('logic-engine-host-lifecycle:' + conversationId);
    if (!enrolled && marker) throw Error('NON_READY: enrollment marker exists without a valid journal baseline');
    return enrolled;
  }

  async function enrollCurrentConversation() {
    const conversationId = getConversationId(), chat = getChat();
    if (!conversationId || !Array.isArray(chat)) throw Error('No active conversation; enrollment refused');
    const fingerprint = await currentFingerprint(chat);
    const descriptors = chat.map(message => ({
      role: roleOf(message),
      versions: rawVersions(message),
      activeVersionIndex: activeIndex(message),
    }));
    const result = await journal.enroll({ conversationId, sourceFingerprint: fingerprint, messages: descriptors });
    try {
      for (let i = 0; i < chat.length; i++) {
        const identity = result.mapping[i];
        chat[i]._logicEngineLifecycle = {
          messageId: identity.messageId,
          versions: identity.versions.map(version => ({ ...version, parentVersionId: null })),
          activeVersionIndex: identity.activeVersionIndex,
        };
      }
      await saveChat();
    } catch (error) {
      // The durable baseline now exists but native metadata may not. Subsequent
      // fingerprint/identity validation must fail closed; enrollment cannot be retried.
      throw Error('NON_READY: baseline persisted but native identity metadata could not be saved; ' + (error?.message || error));
    }
    return {
      conversationId,
      baselineSequence: result.baselineSequence,
      preEnrollmentHistory: result.preEnrollmentHistory,
      messageCount: chat.length,
      status: 'REVIEW_ONLY',
    };
  }

  async function beforeMutation(operation, messageIndexes, details = {}) {
    const conversationId = getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    const chat = getChat(), fingerprint = await currentFingerprint(chat);
    const latestFingerprint = await journal.latestSourceFingerprint(conversationId);
    if (latestFingerprint !== fingerprint) {
      throw Error('NON_READY: source fingerprint differs from journal; abort mutation');
    }
    if (!Array.isArray(messageIndexes)) throw TypeError('messageIndexes must be an array');

    const affectedVersions = [];
    for (const index of messageIndexes) {
      const message = chat[index], identity = message?._logicEngineLifecycle;
      if (!message || !identity || !Array.isArray(identity.versions)) {
        throw Error('NON_READY: missing durable identity mapping; abort mutation');
      }
      const versions = rawVersions(message);
      if (versions.length !== identity.versions.length) {
        throw Error('NON_READY: version inventory mismatch; abort mutation');
      }
      for (const version of identity.versions) {
        affectedVersions.push({
          messageId: identity.messageId,
          versionId: version.versionId,
          parentVersionId: version.parentVersionId ?? null,
          payloadDigest: version.payloadDigest,
        });
      }
    }
    // eventId was previously omitted here, making every enrolled mutation fail
    // with "Invalid event" before reaching the journal.
    return journal.beforeMutation({
      conversationId,
      eventId: newId(),
      operation,
      affectedVersions,
      sourceFingerprint: fingerprint,
      details,
    });
  }

  async function afterMutation(operation, { removedSwipeIndex = null, selectedMessageIndex = null } = {}) {
    const conversationId = getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    const chat = getChat();
    if (!Array.isArray(chat)) throw Error('NON_READY: current chat is not an array');

    for (let i = 0; i < chat.length; i++) {
      const message = chat[i], versions = rawVersions(message);
      let identity = message._logicEngineLifecycle;
      if (!identity) {
        identity = { messageId: newId(), versions: [], activeVersionIndex: activeIndex(message) };
        message._logicEngineLifecycle = identity;
      }
      if (operation === 'delete-swipe' && selectedMessageIndex === i && Number.isInteger(removedSwipeIndex)) {
        if (removedSwipeIndex < 0 || removedSwipeIndex >= identity.versions.length) {
          throw Error('NON_READY: deleted swipe has no matching version identity');
        }
        identity.versions.splice(removedSwipeIndex, 1);
      }
      const nextVersions = [];
      for (let j = 0; j < versions.length; j++) {
        const textDigest = await contentDigest(versions[j]);
        const prior = identity.versions[j];
        if (prior && prior.payloadDigest === textDigest) {
          nextVersions.push(prior);
        } else {
          nextVersions.push({
            versionId: newId(),
            versionIndex: j,
            payloadDigest: textDigest,
            parentVersionId: prior?.versionId
              ?? identity.versions[identity.activeVersionIndex]?.versionId
              ?? null,
          });
        }
      }
      identity.versions = nextVersions;
      identity.activeVersionIndex = activeIndex(message);
    }

    const fingerprint = await currentFingerprint(chat);
    // Save native state before advancing the journal checkpoint. If save or the
    // subsequent append fails, the journal remains behind and the next pre-hook
    // rejects the fingerprint mismatch instead of silently claiming completeness.
    await saveChat();
    const changes = chat.map((message, messageIndex) => ({
      messageId: message._logicEngineLifecycle.messageId,
      messageIndex,
      activeVersionIndex: message._logicEngineLifecycle.activeVersionIndex,
      versions: message._logicEngineLifecycle.versions,
    }));
    const event = await journal.append({
      conversationId,
      eventId: newId(),
      operation: 'after:' + operation,
      sourceFingerprint: fingerprint,
      payload: { changes, removedSwipeIndex, selectedMessageIndex },
    });
    if (event?.status === 'NON_READY') throw Error('NON_READY: post-mutation journal append rejected: ' + event.reason);
    return { sequence: event.sequence, messageCount: chat.length, status: 'REVIEW_ONLY' };
  }

  async function reconcileCurrentConversation() {
    const conversationId = getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    const integrity = await journal.verifyIntegrity(conversationId);
    if (integrity.status !== 'INTEGRITY_OK') return integrity;
    const current = await currentFingerprint();
    const recorded = integrity.sourceFingerprint;
    if (current !== recorded) {
      return {
        status: 'NON_READY',
        reason: 'current source fingerprint differs from the last durable journal checkpoint',
        currentFingerprint: current,
        recordedFingerprint: recorded,
      };
    }
    const chat = getChat();
    const missingIdentity = chat.some(message => !message?._logicEngineLifecycle
      || !Array.isArray(message._logicEngineLifecycle.versions)
      || message._logicEngineLifecycle.versions.length !== rawVersions(message).length);
    if (missingIdentity) {
      return { status: 'NON_READY', reason: 'native identity metadata is missing or does not match current versions' };
    }
    // Integrity is not completeness: this patch does not intercept every mutation
    // path. Keep reconciliation NON_READY until all required paths are wired.
    return journal.status(conversationId, {
      instrumentedPaths: CURRENTLY_HOOKED_PATHS,
      sourceFingerprintMatches: true,
    });
  }

  return Object.freeze({
    enrollCurrentConversation,
    beforeMutation,
    afterMutation,
    currentFingerprint,
    reconcileCurrentConversation,
  });
}
