import { contentDigest, fingerprintSource } from './lifecycle-journal.mjs';

const rawVersions = message => Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes ?? ''];
const roleOf = message => message.is_user ? 'user' : message.is_system ? 'system' : 'assistant';
const activeIndex = message => Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
const HOST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PINNED_SILLYTAVERN_COMMIT = '06bde939fb1e9c4c8d8641d810f0a916b5bce127';
async function rawContentDigest(text) {
  const bytes = new TextEncoder().encode(String(text));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
const CURRENTLY_HOOKED_PATHS = Object.freeze(['create-message', 'message-send', 'message-receive', 'create-swipe', 'select-swipe', 'delete-swipe', 'delete-message', 'edit-message']);
const newId = () => {
  if (!globalThis.crypto?.randomUUID) throw Error('crypto.randomUUID unavailable; Host capture NON_READY');
  return globalThis.crypto.randomUUID();
};

/**
 * Opt-in adapter boundary for explicit native ST hooks.
 * This is not a complete inventory until every mutation path is wired and tested.
 */
export function createStLifecycleBridge({ journal, getConversationId, getSourceLocator = () => null, getChat, saveChat, publishDigest = null, publishSnapshot = null, getPersistedInventory = null, publishLifecycleEvent = null, getLifecycleStatus = null }) {
  if (!journal || !getConversationId || !getChat || !saveChat) throw TypeError('Missing Host lifecycle bridge dependency');
  if (publishDigest !== null && typeof publishDigest !== 'function') throw TypeError('publishDigest must be a trusted callback');
  if (publishSnapshot !== null && typeof publishSnapshot !== 'function') throw TypeError('publishSnapshot must be a trusted callback');
  if (getPersistedInventory !== null && typeof getPersistedInventory !== 'function') throw TypeError('getPersistedInventory must be a trusted callback');
  if (publishLifecycleEvent !== null && typeof publishLifecycleEvent !== 'function') throw TypeError('publishLifecycleEvent must be a trusted callback');
  if (getLifecycleStatus !== null && typeof getLifecycleStatus !== 'function') throw TypeError('getLifecycleStatus must be a trusted callback');
  const publishQueues = new Map();
  const coreCaptureStates = new Map();

  function sortParentFirst(entries) {
    const groups = new Map();
    for (const entry of entries) {
      const group = groups.get(entry.message_id) ?? [];
      group.push(entry);
      groups.set(entry.message_id, group);
    }
    const ordered = [];
    for (const [messageId, group] of groups) {
      const pending = [...group];
      const pendingIds = new Set(pending.map(entry => entry.version_id));
      const emitted = new Set();
      while (pending.length) {
        const ready = pending.map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.parent_version_id === null
            || !pendingIds.has(entry.parent_version_id) || emitted.has(entry.parent_version_id));
        if (!ready.length) throw Error('NON_READY: cyclic Host version lineage for message ' + messageId);
        ready.sort((a, b) => Number(a.entry.active) - Number(b.entry.active)
          || a.entry.version_id.localeCompare(b.entry.version_id));
        const { entry, index } = ready[0];
        pending.splice(index, 1);
        ordered.push(entry);
        emitted.add(entry.version_id);
      }
    }
    return ordered;
  }

  async function publishCurrentDigestInventory(conversationId, chat, tombstones = []) {
    if (!publishDigest && !publishSnapshot) {
      const state = { status: 'NOT_CONFIGURED', published: false, versionCount: 0 };
      coreCaptureStates.set(conversationId, state);
      return state;
    }
    const entries = [];
    for (const message of chat) {
      const identity = message?._logicEngineLifecycle;
      if (!identity || !Array.isArray(identity.versions) || !identity.versions.length
        || !Number.isInteger(identity.activeVersionIndex)
        || identity.activeVersionIndex < 0 || identity.activeVersionIndex >= identity.versions.length) {
        throw Error('NON_READY: cannot publish Host version inventory with missing identity metadata');
      }
      for (let index = 0; index < identity.versions.length; index++) {
        const version = identity.versions[index];
        if (!version?.versionId || !/^[a-f0-9]{64}$/.test(version.payloadDigest)) {
          throw Error('NON_READY: cannot publish Host version inventory with invalid digest identity');
        }
        entries.push({
          conversation_id: conversationId,
          message_id: identity.messageId,
          version_id: version.versionId,
          parent_version_id: version.parentVersionId ?? null,
          content_sha256: version.payloadDigest,
          active: index === identity.activeVersionIndex,
          deleted: false,
        });
      }
    }
    const tombstoneEntries = [];
    for (const tombstone of tombstones) {
      if (!tombstone || typeof tombstone.messageId !== 'string' || typeof tombstone.versionId !== 'string'
        || !/^[a-f0-9]{64}$/.test(tombstone.payloadDigest)) {
        throw Error('NON_READY: cannot publish malformed Host tombstone');
      }
      tombstoneEntries.push({
        conversation_id: conversationId,
        message_id: tombstone.messageId,
        version_id: tombstone.versionId,
        parent_version_id: tombstone.parentVersionId ?? null,
        content_sha256: tombstone.payloadDigest,
        active: false,
        deleted: true,
      });
    }
    // Core requires a declared parent to exist before a newly observed child.
    // Current versions are parent-first; tombstones follow because their live rows
    // must already exist in Core and deletion must not precede the last child capture.
    const orderedEntries = [...sortParentFirst(entries), ...tombstoneEntries];
    const previous = publishQueues.get(conversationId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      if (publishSnapshot) {
        // Current lifecycle coverage is incomplete and has no trusted pinned-source
        // attestation. Never claim complete=true; Core must reject this review-only
        // projection even if a deployment later changes its verifier accidentally.
        try {
          const result = await publishSnapshot({
            conversation_id: conversationId,
            complete: false,
            versions: orderedEntries.map(entry => ({
              message_id: entry.message_id,
              version_id: entry.version_id,
              parent_version_id: entry.parent_version_id,
              content_sha256: entry.content_sha256,
              active: entry.active,
              deleted: entry.deleted,
            })),
          });
          const reconciliation = result?.reconciliation;
          const state = {
            status: 'NON_READY',
            published: false,
            versionCount: orderedEntries.length,
            code: typeof reconciliation?.code === 'string' ? reconciliation.code : 'HOST_INVENTORY_NOT_READY',
          };
          coreCaptureStates.set(conversationId, state);
          return state;
        } catch {
          const state = { status: 'NON_READY', published: false, versionCount: orderedEntries.length, code: 'HOST_INVENTORY_TRANSPORT_FAILED' };
          coreCaptureStates.set(conversationId, state);
          return state;
        }
      }
      for (const entry of orderedEntries) {
        try { await publishDigest(entry); } catch {
          const state = { status: 'NON_READY', published: false, versionCount: orderedEntries.length };
          coreCaptureStates.set(conversationId, state);
          return state;
        }
      }
      const state = { status: 'CAPTURED_REVIEW_ONLY', published: true, versionCount: orderedEntries.length };
      coreCaptureStates.set(conversationId, state);
      return state;
    });
    publishQueues.set(conversationId, current);
    try { return await current; }
    finally { if (publishQueues.get(conversationId) === current) publishQueues.delete(conversationId); }
  }

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
    const conversationId = await getConversationId(), chat = getChat();
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
    const coreCapture = await publishCurrentDigestInventory(conversationId, chat);
    return {
      conversationId,
      baselineSequence: result.baselineSequence,
      preEnrollmentHistory: result.preEnrollmentHistory,
      messageCount: chat.length,
      status: 'REVIEW_ONLY',
      coreCaptureStatus: coreCapture.status,
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
    const conversationId = await getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    if (getLifecycleStatus) {
      let remote;
      try { remote = await getLifecycleStatus(conversationId); }
      catch { throw Error('NON_READY: Core lifecycle journal status is unavailable; abort mutation'); }
      if (!remote || remote.status === 'NON_READY') {
        throw Error('NON_READY: Core lifecycle journal integrity is unavailable; abort mutation');
      }
      if (remote.status === 'PENDING_MUTATION') {
        // A crash may have occurred after the local after-receipt was committed
        // but before Core received it. Replay that exact digest-only receipt.
        let ledger;
        try { ledger = await journal.exportCaptureLedger(conversationId); } catch {}
        const replay = ledger?.records?.find(row =>
          row.operation === 'after:' + remote.operation
          && row.payload?.mutationId === remote.mutation_id);
        if (replay && publishLifecycleEvent) {
          const mutationId = replay.payload?.mutationId;
          const mutationDigest = replay.payload?.mutationDigest;
          const receiptDigest = replay.payload?.receiptDigest;
          const occurredAt = replay.payload?.lifecycleOccurredAt;
          if (!HOST_UUID.test(mutationId ?? '') || !/^[a-f0-9]{64}$/.test(mutationDigest ?? '')
            || !/^[a-f0-9]{64}$/.test(receiptDigest ?? '')
            || typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))
            || mutationId !== remote.mutation_id) {
            throw Error('NON_READY: local persisted receipt is incomplete or does not match Core pending mutation');
          }
          let replayResult;
          try {
            replayResult = await publishLifecycleEvent({
              conversation_id: conversationId,
              event_id: replay.eventId,
              event_type: 'MUTATION_COMMITTED',
              mutation_id: mutationId,
              operation: remote.operation,
              mutation_digest: mutationDigest,
              occurred_at: occurredAt,
            });
          } catch {
            throw Error('NON_READY: Core lifecycle receipt replay failed; abort mutation');
          }
          if (!replayResult || !['appended', 'duplicate'].includes(replayResult?.lifecycle?.status)) {
            throw Error('NON_READY: Core lifecycle receipt replay was rejected; abort mutation');
          }
          remote = await getLifecycleStatus(conversationId);
        }
        if (remote?.status !== 'NO_PENDING_MUTATION') {
          throw Error('NON_READY: Core has an unresolved Host mutation (' + remote.operation + '); abort mutation');
        }
      }
      if (remote.status !== 'NO_PENDING_MUTATION') {
        throw Error('NON_READY: Core lifecycle journal is not in an accepted state; abort mutation');
      }
    }
    const pending = await journal.pendingMutation(conversationId);
    if (pending.status === 'NON_READY') throw Error('NON_READY: lifecycle journal integrity failed: ' + pending.reason);
    if (pending.status === 'PENDING_MUTATION') {
      throw Error('NON_READY: previous lifecycle operation is incomplete (' + pending.operation + '); abort mutation');
    }
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
    const mutationId = newId();
    const occurredAt = new Date().toISOString();
    const detailsDigest = await contentDigest(JSON.stringify(details ?? {}));
    const mutationDigest = await contentDigest(JSON.stringify({
      protocolVersion: 1, mutationId, operation, sourceFingerprint: fingerprint,
      affectedVersions, detailsDigest,
    }));
    const prepared = await journal.beforeMutation({
      conversationId,
      eventId: newId(),
      operation,
      affectedVersions,
      sourceFingerprint: fingerprint,
      details: { hostLifecycle: { mutationId, mutationDigest, occurredAt, detailsDigest } },
    });
    if (publishLifecycleEvent) {
      let result;
      try {
        result = await publishLifecycleEvent({
          conversation_id: conversationId,
          event_id: prepared.eventId,
          event_type: 'MUTATION_PREPARED',
          mutation_id: mutationId,
          operation,
          mutation_digest: mutationDigest,
          occurred_at: occurredAt,
        });
      } catch {
        throw Error('NON_READY: Core did not durably accept the prepared Host mutation');
      }
      if (!result || !['appended', 'duplicate'].includes(result?.lifecycle?.status)) {
        throw Error('NON_READY: Core did not durably accept the prepared Host mutation');
      }
    }
    return prepared;
  }

  async function afterMutation(operation, { removedSwipeIndex = null, selectedMessageIndex = null, createdMessageIndex = null } = {}) {
    const conversationId = await getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    const pending = await journal.pendingMutation(conversationId);
    if (pending.status === 'NON_READY') throw Error('NON_READY: lifecycle journal integrity failed: ' + pending.reason);
    if (pending.status !== 'PENDING_MUTATION' || pending.operation !== operation) {
      throw Error('NON_READY: afterMutation has no matching durable beforeMutation for ' + operation);
    }
    let localLedger;
    try { localLedger = await journal.exportCaptureLedger(conversationId); } catch {
      throw Error('NON_READY: local lifecycle journal cannot provide the exact prepared intent');
    }
    const preparedRecord = localLedger?.records?.find(row =>
      row.eventId === pending.eventId && row.operation === 'before:' + operation);
    const preparedMetadata = preparedRecord?.payload?.details?.hostLifecycle;
    if (!preparedMetadata || !HOST_UUID.test(preparedMetadata.mutationId ?? '')
      || !/^[a-f0-9]{64}$/.test(preparedMetadata.mutationDigest ?? '')
      || typeof preparedMetadata.occurredAt !== 'string'
      || !Number.isFinite(Date.parse(preparedMetadata.occurredAt))) {
      throw Error('NON_READY: local prepared intent metadata is missing or malformed');
    }
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
      const priorVersionInventory = identity.versions.slice();
      const nextVersions = [];
      for (let j = 0; j < versions.length; j++) {
        const textDigest = await contentDigest(versions[j]);
        const prior = identity.versions[j];
        if (prior && prior.payloadDigest === textDigest) {
          // Slot indexes can shift when a swipe is deleted; version identity must not.
          nextVersions.push({ ...prior, versionIndex: j });
        } else {
          if (prior) {
            tombstones.push({
              messageId: identity.messageId,
              versionId: prior.versionId,
              versionIndex: prior.versionIndex ?? j,
              payloadDigest: prior.payloadDigest,
              parentVersionId: prior.parentVersionId ?? null,
              deleted: true,
              active: false,
              reason: 'version-replaced',
            });
          }
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
      const retainedVersionIds = new Set(nextVersions.map(version => version.versionId));
      for (const priorVersion of priorVersionInventory) {
        if (retainedVersionIds.has(priorVersion.versionId)
          || tombstones.some(tombstone => tombstone.messageId === identity.messageId
            && tombstone.versionId === priorVersion.versionId)) continue;
        tombstones.push({
          messageId: identity.messageId,
          versionId: priorVersion.versionId,
          versionIndex: priorVersion.versionIndex,
          payloadDigest: priorVersion.payloadDigest,
          parentVersionId: priorVersion.parentVersionId ?? null,
          deleted: true,
          active: false,
          reason: 'version-removed',
        });
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
    const occurredAt = new Date().toISOString();
    const afterPayload = {
      changes, removedSwipeIndex, selectedMessageIndex, versionPayloads, tombstones,
      mutationId: preparedMetadata.mutationId,
      mutationDigest: preparedMetadata.mutationDigest,
    };
    const receiptDigest = await contentDigest(JSON.stringify({
      protocolVersion: 1,
      mutationId: preparedMetadata.mutationId,
      mutationDigest: preparedMetadata.mutationDigest,
      operation,
      sourceFingerprint: fingerprint,
      payload: afterPayload,
    }));
    afterPayload.lifecycleOccurredAt = occurredAt;
    afterPayload.receiptDigest = receiptDigest;
    const event = await journal.append({
      conversationId,
      eventId: newId(),
      operation: 'after:' + operation,
      sourceFingerprint: fingerprint,
      payload: afterPayload,
    });
    if (event?.status === 'NON_READY') throw Error('NON_READY: post-mutation journal append rejected: ' + event.reason);
    if (publishLifecycleEvent) {
      // This receipt currently proves a local journal checkpoint, not a fresh
      // disk read-back for every artifact. Core production verification stays deny-only.
      let result;
      try {
        result = await publishLifecycleEvent({
          conversation_id: conversationId,
          event_id: event.eventId,
          event_type: 'MUTATION_COMMITTED',
          mutation_id: preparedMetadata.mutationId,
          operation,
          mutation_digest: preparedMetadata.mutationDigest,
          occurred_at: occurredAt,
        });
      } catch {
        throw Error('NON_READY: Core did not durably accept the completed Host mutation');
      }
      if (!result || !['appended', 'duplicate'].includes(result?.lifecycle?.status)) {
        throw Error('NON_READY: Core did not durably accept the completed Host mutation');
      }
    }
    const coreCapture = await publishCurrentDigestInventory(conversationId, chat, tombstones);
    return { sequence: event.sequence, messageCount: chat.length, status: 'REVIEW_ONLY', coreCaptureStatus: coreCapture.status };
  }

  async function verifyPersistedInventory(conversationId = null) {
    const id = conversationId ?? await getConversationId();
    if (typeof id !== 'string') return { status: 'NON_READY', reason: 'Host conversation identity unavailable' };
    const parts = id.split(':');
    if (parts.length !== 3 || !parts.every(part => HOST_UUID.test(part))) {
      return { status: 'NON_READY', reason: 'Host conversation identity is not session/install/conversation bound' };
    }
    if (typeof getPersistedInventory !== 'function') {
      return { status: 'NON_READY', reason: 'persisted Host inventory route unavailable' };
    }

    let inventory;
    try {
      inventory = await getPersistedInventory();
    } catch {
      return { status: 'NON_READY', reason: 'persisted Host inventory request failed' };
    }
    if (!inventory || inventory.status !== 'DOUBLE_SCAN_CANDIDATE'
      || inventory.authority !== 'NON_AUTHORITATIVE'
      || inventory.completeness !== 'DOUBLE_SCANNED_PATH_VIEW_ONLY'
      || inventory.host_commit !== PINNED_SILLYTAVERN_COMMIT
      || inventory.host_build_claim !== PINNED_SILLYTAVERN_COMMIT
      || inventory.host_build_claim_type !== 'DEPLOYMENT_ASSERTION_NOT_RUNTIME_ATTESTATION'
      || inventory.host_session_id !== parts[0]
      || inventory.host_session_identity !== 'SIGNED_AUTHENTICATED_ST_SESSION'
      || typeof inventory.host_user_handle !== 'string'
      || inventory.host_user_handle !== inventory.authenticated_user_handle
      || inventory.requested_conversation_uuid !== parts[2]
      || !/^[a-f0-9]{64}$/.test(inventory.inventory_sha256)
      || !Array.isArray(inventory.files)) {
      return { status: 'NON_READY', reason: 'persisted Host inventory is not bound to the current authenticated conversation' };
    }

    const matches = inventory.files.filter(file =>
      file?.logical_identity?.conversation_uuid === parts[2]);
    if (matches.length !== 1) {
      return { status: 'NON_READY', reason: 'persisted Host inventory does not contain exactly one current conversation' };
    }
    const logical = matches[0].logical_identity;
    const chat = getChat();
    if (!logical || logical.identity_status !== 'CURRENT_IDENTITIES_VERIFIED'
      || logical.missing_message_identity_count !== 0
      || !Array.isArray(logical.messages) || !Array.isArray(chat)
      || logical.messages.length !== chat.length
      || logical.message_count !== chat.length
      || logical.identified_message_count !== chat.length) {
      return { status: 'NON_READY', reason: 'persisted Host conversation identity inventory is incomplete' };
    }

    let versionCount = 0;
    for (let messageIndex = 0; messageIndex < chat.length; messageIndex++) {
      const message = chat[messageIndex];
      const identity = message?._logicEngineLifecycle;
      const persisted = logical.messages[messageIndex];
      const versions = rawVersions(message);
      if (!identity || !persisted || persisted.message_id !== identity.messageId
        || persisted.active_version_index !== identity.activeVersionIndex
        || identity.activeVersionIndex !== activeIndex(message)
        || !Array.isArray(persisted.versions) || !Array.isArray(identity.versions)
        || persisted.versions.length !== versions.length
        || identity.versions.length !== versions.length) {
        return { status: 'NON_READY', reason: 'persisted Host message identity differs from the active conversation' };
      }
      for (let versionIndex = 0; versionIndex < versions.length; versionIndex++) {
        const currentVersion = identity.versions[versionIndex];
        const persistedVersion = persisted.versions[versionIndex];
        const journalDigest = await contentDigest(versions[versionIndex]);
        const persistedBytesDigest = await rawContentDigest(versions[versionIndex]);
        if (!currentVersion || !persistedVersion
          || persistedVersion.version_index !== versionIndex
          || persistedVersion.version_id !== currentVersion.versionId
          || persistedVersion.parent_version_id !== (currentVersion.parentVersionId ?? null)
          || currentVersion.payloadDigest !== journalDigest
          || persistedVersion.content_sha256 !== persistedBytesDigest
          || persistedVersion.active !== (versionIndex === identity.activeVersionIndex)) {
          return { status: 'NON_READY', reason: 'persisted Host version identity or digest differs from the active conversation' };
        }
        versionCount++;
      }
    }

    return Object.freeze({
      status: 'MATCHED_NON_AUTHORITATIVE',
      authority: 'NON_AUTHORITATIVE',
      completeness: inventory.completeness,
      host_session_bound: true,
      installation_attestation: false,
      conversation_uuid: parts[2],
      message_count: chat.length,
      version_count: versionCount,
      inventory_sha256: inventory.inventory_sha256,
    });
  }

  async function syncCurrentDigestInventory() {
    const conversationId = await getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    if (getPersistedInventory) {
      const persisted = await verifyPersistedInventory(conversationId);
      if (persisted.status !== 'MATCHED_NON_AUTHORITATIVE') return persisted;
    }
    const integrity = await journal.verifyIntegrity(conversationId);
    if (integrity.status !== 'INTEGRITY_OK') return { status: 'NON_READY', reason: integrity.reason };
    const chat = getChat();
    const fingerprint = await currentFingerprint(chat);
    if (integrity.sourceFingerprint !== fingerprint) {
      return { status: 'NON_READY', reason: 'current Host source differs from the durable journal checkpoint' };
    }
    await assertIdentitySnapshotMatches(conversationId, chat);
    const exported = await journal.exportCaptureLedger(conversationId);
    if (exported.status !== 'REVIEW_ONLY' || !Array.isArray(exported.records)) {
      return { status: 'NON_READY', reason: 'durable Host journal cannot provide a replayable digest ledger' };
    }
    const tombstoneMap = new Map();
    for (const record of exported.records) {
      for (const tombstone of record.payload?.tombstones ?? []) {
        tombstoneMap.set(JSON.stringify([tombstone.messageId, tombstone.versionId]), tombstone);
      }
    }
    return publishCurrentDigestInventory(conversationId, chat, [...tombstoneMap.values()]);
  }

  function getCoreCaptureStatus() {
    const conversationId = getConversationId();
    return Promise.resolve(conversationId).then(id => id ? (coreCaptureStates.get(id) ?? { status: 'NOT_SYNCED' }) : { status: 'NO_CONVERSATION' });
  }

  async function reconcileCurrentConversation() {
    const conversationId = await getConversationId();
    if (!conversationId || !(await enrolledOrFailClosed(conversationId))) return { status: 'NOT_ENROLLED' };
    const persisted = getPersistedInventory
      ? await verifyPersistedInventory(conversationId) : null;
    if (persisted && persisted.status !== 'MATCHED_NON_AUTHORITATIVE') return persisted;
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
    const readiness = await journal.status(conversationId, {
      instrumentedPaths: CURRENTLY_HOOKED_PATHS,
      sourceFingerprintMatches: true,
    });
    return persisted ? Object.freeze({
      ...readiness,
      persistedInventoryStatus: persisted.status,
      persistedInventorySha256: persisted.inventory_sha256,
    }) : readiness;
  }

  return Object.freeze({
    enrollCurrentConversation,
    beforeMutation,
    afterMutation,
    syncCurrentDigestInventory,
    verifyPersistedInventory,
    getCoreCaptureStatus,
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

  const assertUnavailableSafe = async () => {
    const conversationId = await getConversationId();
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
