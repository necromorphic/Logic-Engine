import { fingerprintSource } from './lifecycle-journal.mjs';

const rawVersions = message => Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes ?? ''];
const roleOf = message => message.is_user ? 'user' : message.is_system ? 'system' : 'assistant';
const activeIndex = message => Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
const newId = () => {
  if (!globalThis.crypto?.randomUUID) throw Error('crypto.randomUUID unavailable; Host capture NON_READY');
  return globalThis.crypto.randomUUID();
};

/**
 * Small adapter boundary intended for explicit native ST hooks.
 * It does not install hooks or auto-enroll chats by itself.
 */
export function createStLifecycleBridge({ journal, getConversationId, getChat, saveChat }) {
  if (!journal || !getConversationId || !getChat || !saveChat) throw TypeError('Missing Host lifecycle bridge dependency');

  async function currentFingerprint(chat = getChat()) {
    return fingerprintSource(chat);
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
    for (let i = 0; i < chat.length; i++) {
      const identity = result.mapping[i];
      chat[i]._logicEngineLifecycle = {
        messageId: identity.messageId,
        versions: identity.versions.map(version => ({ ...version, parentVersionId: null })),
        activeVersionIndex: identity.activeVersionIndex,
      };
    }
    await saveChat();
    return { conversationId, baselineSequence: result.baselineSequence, preEnrollmentHistory: result.preEnrollmentHistory, messageCount: chat.length };
  }

  async function beforeMutation(operation, messageIndexes, details = {}) {
    const conversationId = getConversationId();
    if (!conversationId || !(await journal.isEnrolled(conversationId))) return { status: 'NOT_ENROLLED' };
    const chat = getChat(), fingerprint = await currentFingerprint(chat);
    const latestFingerprint = await journal.latestSourceFingerprint(conversationId);
    if (latestFingerprint !== fingerprint) throw Error('NON_READY: source fingerprint differs from journal; abort mutation');
    const affectedVersions = [];
    for (const index of messageIndexes) {
      const message = chat[index], identity = message?._logicEngineLifecycle;
      if (!message || !identity || !Array.isArray(identity.versions)) throw Error('NON_READY: missing durable identity mapping; abort mutation');
      const versions = rawVersions(message);
      if (versions.length !== identity.versions.length) throw Error('NON_READY: version inventory mismatch; abort mutation');
      for (const version of identity.versions) affectedVersions.push({
        messageId: identity.messageId,
        versionId: version.versionId,
        parentVersionId: version.parentVersionId ?? null,
        payloadDigest: version.payloadDigest,
      });
    }
    return journal.beforeMutation({ conversationId, operation, affectedVersions, sourceFingerprint: fingerprint, details });
  }

  async function afterMutation(operation, { removedSwipeIndex = null, selectedMessageIndex = null } = {}) {
    const conversationId = getConversationId();
    if (!conversationId || !(await journal.isEnrolled(conversationId))) return { status: 'NOT_ENROLLED' };
    const chat = getChat(), changes = [];
    for (let i = 0; i < chat.length; i++) {
      const message = chat[i], versions = rawVersions(message), role = roleOf(message);
      let identity = message._logicEngineLifecycle;
      if (!identity) {
        identity = { messageId: newId(), versions: [], activeVersionIndex: activeIndex(message) };
        message._logicEngineLifecycle = identity;
      }
      if (operation === 'delete-swipe' && selectedMessageIndex === i && Number.isInteger(removedSwipeIndex)) {
        identity.versions.splice(removedSwipeIndex, 1);
      }
      const nextVersions = [];
      for (let j = 0; j < versions.length; j++) {
        const textDigest = await fingerprintSource([{ is_user: role === 'user', is_system: role === 'system', mes: versions[j] }]);
        const prior = identity.versions[j];
        if (prior && prior.payloadDigest === textDigest) {
          nextVersions.push(prior);
        } else {
          nextVersions.push({ versionId: newId(), versionIndex: j, payloadDigest: textDigest, parentVersionId: prior?.versionId ?? null });
        }
      }
      identity.versions = nextVersions;
      identity.activeVersionIndex = activeIndex(message);
      changes.push({ messageId: identity.messageId, messageIndex: i, activeVersionIndex: identity.activeVersionIndex, versions: nextVersions });
    }
    const fingerprint = await currentFingerprint(chat);
    const event = await journal.append({
      conversationId,
      eventId: newId(),
      operation: 'after:' + operation,
      sourceFingerprint: fingerprint,
      payload: { changes, removedSwipeIndex, selectedMessageIndex },
    });
    await saveChat();
    return { sequence: event.sequence, messageCount: chat.length };
  }

  return Object.freeze({ enrollCurrentConversation, beforeMutation, afterMutation, currentFingerprint });
}
