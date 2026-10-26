import { contentDigest, fingerprintSource } from './lifecycle-journal.mjs';

const rawVersions = message => Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes ?? ''];
const roleOf = message => message.is_user ? 'user' : message.is_system ? 'system' : 'assistant';
const activeIndex = message => Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
const CURRENTLY_HOOKED_PATHS = Object.freeze(['create-message', 'message-send', 'message-receive', 'create-swipe', 'select-swipe', 'delete-swipe', 'delete-message', 'edit-message', 'rename-chat']);
const newId = () => {
  if (!globalThis.crypto?.randomUUID) throw Error('crypto.randomUUID unavailable; Host capture NON_READY');
  return globalThis.crypto.randomUUID();
};

/**
 * Opt-in adapter boundary for explicit native ST hooks.
 * This is not a complete inventory until every mutation path is wired and tested.
 */
export function createStLifecycleBridge({ journal, getConversationId, getSourceLocator = () => null, getChat, saveChat }) {
  if (!journal || !getConversationId || !getChat || !saveChat) throw TypeError('Missing Host lifecycle bridge dependency');

  async function currentFingerprint(chat = getChat()) {
    if (!Array.isArray(chat)) throw Error('NON_READY: current chat is not an array');
    return fingerprintSource(chat, getSourceLocator());
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

  async function assertIdentitySnapshotMatches(conversationId, chat) {
    const recorded = await journal.latestIdentitySnapshot(conversationId);
    if (!Array.isArray(recorded) || recorded.length !== chat.length) {
      throw Error('NON_READY: identity snapshot is missing or has a different message count; abort mutation');
    }
    const messageIds = new Set();
    const versionIds = new Set();
    for (let index = 0; index < chat.length; index++) {
      const message = chat[index];
      const identity = message?._logicEngineLifecycle;
      const prior = recorded[index];
      const versions = rawVersions(message);
      if (!identity || !prior || identity.messageId !== prior.messageId
        || (prior.messageIndex ?? index) !== index
        || identity.activeVersionIndex !== activeIndex(message)
        || identity.activeVersionIndex !== prior.activeVersionIndex
        || !Array.isArray(identity.versions) || !Array.isArray(prior.versions)
        || identity.versions.length !== versions.length
        || identity.versions.length !== prior.versions.length
        || messageIds.has(identity.messageId)) {
        throw Error('NON_READY: identity metadata differs from journal; abort mutation');
      }
      messageIds.add(identity.messageId);
      for (let versionIndex = 0; versionIndex < versions.length; versionIndex++) {
        const current = identity.versions[versionIndex];
        const expected = prior.versions[versionIndex];
        if (!current || !expected || !current.versionId || versionIds.has(current.versionId)
          || current.versionId !== expected.versionId
          || current.versionIndex !== versionIndex || expected.versionIndex !== versionIndex
          || current.payloadDigest !== expected.payloadDigest
          || current.payloadDigest !== await contentDigest(versions[versionIndex])
          || (current.parentVersionId ?? null) !== (expected.parentVersionId ?? null)) {
          throw Error('NON_READY: version identity or digest differs from journal; abort mutation');
        }
        versionIds.add(current.versionId);
      }
    }
  }

  async function beforeMutation(operation, messageIndexes, details = {}) {
    const conversationId = getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    if (!CURRENTLY_HOOKED_PATHS.includes(operation)) {
      throw Error('NON_READY: unsupported/uninstrumented Host lifecycle operation ' + String(operation) + '; abort mutation before source change');
    }
    const chat = getChat(), fingerprint = await currentFingerprint(chat);
    const latestFingerprint = await journal.latestSourceFingerprint(conversationId);
    if (latestFingerprint !== fingerprint) {
      throw Error('NON_READY: source fingerprint differs from journal; abort mutation');
    }
    await assertIdentitySnapshotMatches(conversationId, chat);
    if (!Array.isArray(messageIndexes)) throw TypeError('messageIndexes must be an array');
    if (messageIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= chat.length)) {
      throw Error('NON_READY: mutation contains an invalid source message index; abort mutation');
    }
    if (new Set(messageIndexes).size !== messageIndexes.length) {
      throw Error('NON_READY: mutation contains duplicate source message indexes; abort mutation');
    }

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
      for (let versionIndex = 0; versionIndex < identity.versions.length; versionIndex++) {
        const version = identity.versions[versionIndex];
        affectedVersions.push({
          messageId: identity.messageId,
          versionId: version.versionId,
          versionIndex,
          role: roleOf(message),
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

  async function afterMutation(operation, { removedSwipeIndex = null, selectedMessageIndex = null, createdMessageIndex = null } = {}) {
    const conversationId = getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    const chat = getChat();
    if (!Array.isArray(chat)) throw Error('NON_READY: current chat is not an array');

    // Preserve explicit deletion evidence before identities disappear from the
    // current chat projection. The journal is still review-only; this does not
    // authorize Provider reconciliation or claim complete native inventory.
    const tombstones = [];
    const priorIdentitySnapshot = await journal.latestIdentitySnapshot(conversationId);
    const liveMessageIds = new Set(chat.map(message => message?._logicEngineLifecycle?.messageId).filter(Boolean));
    if (operation === 'delete-message' && Array.isArray(priorIdentitySnapshot)) {
      for (const priorMessage of priorIdentitySnapshot) {
        if (liveMessageIds.has(priorMessage.messageId)) continue;
        for (const version of priorMessage.versions ?? []) {
          tombstones.push({
            messageId: priorMessage.messageId,
            versionId: version.versionId,
            versionIndex: version.versionIndex,
            payloadDigest: version.payloadDigest,
            parentVersionId: version.parentVersionId ?? null,
            deleted: true,
            active: false,
            reason: 'message-deleted',
          });
        }
      }
    }

    if (['create-message', 'message-send', 'message-receive'].includes(operation)) {
      const validCreatedIndex = Number.isInteger(createdMessageIndex)
        && createdMessageIndex >= 0
        && createdMessageIndex < chat.length;
      const appendOnly = operation !== 'message-send';
      if (!validCreatedIndex || (appendOnly && createdMessageIndex !== chat.length - 1)) {
        throw Error('NON_READY: creation hook lacks an exact source insertion boundary; abort inventory checkpoint');
      }
      const expectedPriorFingerprint = await journal.latestSourceFingerprint(conversationId);
      const priorChat = chat.slice();
      priorChat.splice(createdMessageIndex, 1);
      const actualPriorFingerprint = await currentFingerprint(priorChat);
      if (actualPriorFingerprint !== expectedPriorFingerprint) {
        throw Error('NON_READY: pre-existing source changed before create-message checkpoint; abort inventory checkpoint');
      }
    }

    const versionPayloads = [];
    for (let i = 0; i < chat.length; i++) {
      const message = chat[i], versions = rawVersions(message);
      let identity = message._logicEngineLifecycle;
      if (!identity) {
        if (!['create-message', 'message-send', 'message-receive'].includes(operation) || i !== createdMessageIndex) {
          throw Error('NON_READY: missing durable identity on pre-existing message; abort inventory checkpoint');
        }
        identity = { messageId: newId(), versions: [], activeVersionIndex: activeIndex(message) };
        message._logicEngineLifecycle = identity;
      }
      if (operation === 'delete-swipe' && selectedMessageIndex === i && Number.isInteger(removedSwipeIndex)) {
        if (removedSwipeIndex < 0 || removedSwipeIndex >= identity.versions.length) {
          throw Error('NON_READY: deleted swipe has no matching version identity');
        }
        const removed = identity.versions[removedSwipeIndex];
        tombstones.push({
          messageId: identity.messageId,
          versionId: removed.versionId,
          versionIndex: removed.versionIndex ?? removedSwipeIndex,
          payloadDigest: removed.payloadDigest,
          parentVersionId: removed.parentVersionId ?? null,
          deleted: true,
          active: false,
          reason: 'swipe-deleted',
        });
        identity.versions.splice(removedSwipeIndex, 1);
      }
      const nextVersions = [];
      for (let j = 0; j < versions.length; j++) {
        const textDigest = await contentDigest(versions[j]);
        const prior = identity.versions[j];
        if (prior && prior.payloadDigest === textDigest) {
          // Slot indexes can shift when a swipe is deleted; version identity must not.
          nextVersions.push({ ...prior, versionIndex: j });
        } else {
          const versionId = newId();
          const parentVersionId = prior?.versionId
            ?? identity.versions[identity.activeVersionIndex]?.versionId
            ?? null;
          nextVersions.push({
            versionId,
            versionIndex: j,
            payloadDigest: textDigest,
            parentVersionId,
          });
          // Store only identity, lineage and digest; raw content is excluded by the approved retention contract.
          versionPayloads.push({
            messageId: identity.messageId,
            versionId,
            versionIndex: j,
            role: roleOf(message),
            parentVersionId,
            payloadDigest: textDigest,
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
      payload: { changes, removedSwipeIndex, selectedMessageIndex, versionPayloads, tombstones },
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
    const messageIds = new Set();
    const versionIds = new Set();
    for (const message of chat) {
      const identity = message?._logicEngineLifecycle;
      const versions = rawVersions(message);
      if (!identity || typeof identity.messageId !== 'string' || !identity.messageId
        || !Array.isArray(identity.versions) || identity.versions.length !== versions.length) {
        return { status: 'NON_READY', reason: 'native identity metadata is missing or does not match current versions' };
      }
      if (messageIds.has(identity.messageId)) {
        return { status: 'NON_READY', reason: 'duplicate logical message identity' };
      }
      messageIds.add(identity.messageId);
      if (!Number.isInteger(identity.activeVersionIndex)
        || identity.activeVersionIndex < 0
        || identity.activeVersionIndex >= versions.length
        || identity.activeVersionIndex !== activeIndex(message)) {
        return { status: 'NON_READY', reason: 'active version selection does not match native source' };
      }
      for (let index = 0; index < versions.length; index++) {
        const version = identity.versions[index];
        if (!version || typeof version.versionId !== 'string' || !version.versionId
          || versionIds.has(version.versionId)) {
          return { status: 'NON_READY', reason: 'missing or duplicate logical version identity' };
        }
        versionIds.add(version.versionId);
        if (version.payloadDigest !== await contentDigest(versions[index])) {
          return { status: 'NON_READY', reason: 'version digest does not match native source content' };
        }
      }
    }
    const recordedSnapshot = await journal.latestIdentitySnapshot(conversationId);
    if (!Array.isArray(recordedSnapshot) || recordedSnapshot.length !== chat.length) {
      return { status: 'NON_READY', reason: 'journal identity snapshot is missing or has a different message count' };
    }
    // The source fingerprint intentionally covers native chat content, not our
    // sidecar identity metadata. Compare the latter against the last journaled
    // snapshot too, so a restore/copy that reuses content but swaps IDs cannot pass.
    for (let index = 0; index < chat.length; index++) {
      const currentIdentity = chat[index]?._logicEngineLifecycle;
      const recordedIdentity = recordedSnapshot[index];
      if (!currentIdentity
        || currentIdentity.messageId !== recordedIdentity.messageId
        || (recordedIdentity.messageIndex ?? index) !== index
        || currentIdentity.activeVersionIndex !== recordedIdentity.activeVersionIndex
        || !Array.isArray(currentIdentity.versions)
        || !Array.isArray(recordedIdentity.versions)
        || currentIdentity.versions.length !== recordedIdentity.versions.length) {
        return { status: 'NON_READY', reason: 'native identity metadata differs from the last journaled identity snapshot' };
      }
      for (let versionIndex = 0; versionIndex < currentIdentity.versions.length; versionIndex++) {
        const currentVersion = currentIdentity.versions[versionIndex];
        const recordedVersion = recordedIdentity.versions[versionIndex];
        if (!currentVersion || !recordedVersion
          || currentVersion.versionId !== recordedVersion.versionId
          || currentVersion.versionIndex !== versionIndex
          || recordedVersion.versionIndex !== versionIndex
          || currentVersion.payloadDigest !== recordedVersion.payloadDigest
          || (currentVersion.parentVersionId ?? null) !== (recordedVersion.parentVersionId ?? null)) {
          return { status: 'NON_READY', reason: 'native version identity differs from the last journaled version snapshot' };
        }
      }
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

/**
 * Fallback when IndexedDB cannot be opened. It must re-check the current chat's
 * enrollment marker on every mutation; the bridge promise may have been created
 * before a chat was enrolled or before the user switched conversations.
 */
export function createUnavailableStLifecycleBridge({ getConversationId, storage = globalThis.localStorage, error }) {
  if (typeof getConversationId !== 'function') throw TypeError('getConversationId is required');
  if (!error) throw TypeError('original journal-open error is required');

  const assertUnavailableSafe = () => {
    const conversationId = getConversationId();
    const marker = conversationId
      ? storage?.getItem('logic-engine-host-lifecycle:' + conversationId)
      : null;
    if (marker) {
      throw Error('NON_READY: enrolled Host journal unavailable: ' + (error?.message || error));
    }
    return { status: 'NOT_ENROLLED' };
  };

  return Object.freeze({
    enrollCurrentConversation: async () => { throw error; },
    beforeMutation: async () => assertUnavailableSafe(),
    afterMutation: async () => assertUnavailableSafe(),
  });
}
