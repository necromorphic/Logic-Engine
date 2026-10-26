import { createHash } from 'node:crypto';

/**
 * Review-only projection for comparing Host's inventory shape and Provider's
 * canonical inventory digest algorithm. This is NOT a trusted snapshot,
 * transport envelope, completeness claim, or authorization result.
 *
 * The existing Host contentDigest hashes canonical(JSON string), not the exact
 * UTF-8 source bytes. We validate that current Host convention so the gap is
 * visible; the resulting payload_sha256 values must NOT be treated as approved
 * raw-source digests until Core/Provider approve their semantics.
 */
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);

const validId = value => typeof value === 'string' && value.length > 0
  && value === value.trim() && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hostCurrentDigest = value => createHash('sha256').update(JSON.stringify(String(value)), 'utf8').digest('hex');
const versionsOf = message => Array.isArray(message?.swipes) && message.swipes.length
  ? message.swipes
  : [message?.mes ?? ''];
const activeIndexOf = (message, versionCount) => Number.isInteger(message?.swipe_id) ? message.swipe_id : versionCount === 1 ? 0 : null;

/**
 * Produces a comparison-only normalized inventory and digest. The digest uses
 * Provider's current canonical row ordering/serialization, but its payload
 * digests retain the Host's existing JSON-string hashing semantics.
 */
export function projectHostInventoryForComparison(chat) {
  if (!Array.isArray(chat)) return { status: 'NON_READY', reason: 'CHAT_NOT_ENUMERABLE' };
  const rows = [];
  const messageIds = new Set();
  const versionIds = new Set();

  for (let messageIndex = 0; messageIndex < chat.length; messageIndex++) {
    const message = chat[messageIndex];
    const identity = message?._logicEngineLifecycle;
    const sourceVersions = versionsOf(message);
    if (!validId(identity?.messageId) || !Array.isArray(identity?.versions)
      || identity.versions.length !== sourceVersions.length) {
      return { status: 'NON_READY', reason: 'MESSAGE_OR_VERSION_IDENTITY_INCOMPLETE', messageIndex };
    }
    if (messageIds.has(identity.messageId)) {
      return { status: 'NON_READY', reason: 'DUPLICATE_MESSAGE_ID', messageIndex };
    }
    messageIds.add(identity.messageId);
    const active = activeIndexOf(message, sourceVersions.length);
    if (!Number.isInteger(active) || active < 0 || active >= sourceVersions.length
      || identity.activeVersionIndex !== active) {
      return { status: 'NON_READY', reason: 'ACTIVE_SELECTION_MISMATCH', messageIndex };
    }

    for (let versionIndex = 0; versionIndex < sourceVersions.length; versionIndex++) {
      const version = identity.versions[versionIndex];
      if (!validId(version?.versionId) || versionIds.has(version.versionId)
        || !validDigest(version.payloadDigest)
        || (version.parentVersionId != null && !validId(version.parentVersionId))) {
        return { status: 'NON_READY', reason: 'VERSION_IDENTITY_INVALID_OR_COLLIDING', messageIndex, versionIndex };
      }
      if (version.payloadDigest !== hostCurrentDigest(sourceVersions[versionIndex])) {
        return { status: 'NON_READY', reason: 'HOST_DIGEST_MISMATCH', messageIndex, versionIndex };
      }
      versionIds.add(version.versionId);
      rows.push({
        message_id: identity.messageId,
        version_id: version.versionId,
        payload_sha256: version.payloadDigest,
        parent_version_id: version.parentVersionId ?? null,
        active: versionIndex === active,
      });
    }
  }

  rows.sort((a, b) => a.message_id.localeCompare(b.message_id) || a.version_id.localeCompare(b.version_id));
  const inventorySha256 = createHash('sha256').update(canonical(rows), 'utf8').digest('hex');
  return {
    status: 'REVIEW_ONLY',
    authority: 'NON_AUTHORITATIVE',
    rows,
    inventory_sha256: inventorySha256,
    payloadDigestSemantics: 'HOST_HASHES_CANONICAL_JSON_STRING_NOT_RAW_UTF8_SOURCE_BYTES',
    completeness: 'UNPROVEN',
    blockers: [
      'PAYLOAD_DIGEST_SEMANTICS_UNAPPROVED',
      'CORE_WORLD_BINDING_MISSING',
      'HOST_INSTALLATION_ID_TRUST_UNPROVEN',
      'SOURCE_LOCATOR_BINDING_NOT_CORE_AUTHORIZED',
      'BRANCH_RESTORE_LINEAGE_MISSING',
      'COMPLETE_NATIVE_INVENTORY_UNPROVEN',
    ],
  };
}



/**
 * Reconstructs the versions observed in an integrity-checked Host capture
 * ledger for cross-block comparison. This is intentionally not a Provider
 * snapshot: it has no Core-authorized world binding, and enrollment-forward
 * capture cannot prove that older Provider records are fully accounted for.
 */
export function projectHostCaptureLedgerForComparison(ledger) {
  const nonReady = reason => ({ status: 'NON_READY', reason });
  if (!ledger || ledger.status !== 'REVIEW_ONLY' || !validId(ledger.conversationId)
    || ledger.captureBoundary !== 'enrollment-forward-only' || !Array.isArray(ledger.records)
    || ledger.records.length === 0) {
    return nonReady('CAPTURE_LEDGER_UNAVAILABLE_OR_INVALID');
  }
  const records = ledger.records;
  if (records[0]?.operation !== 'baseline' || records[0]?.conversationId !== ledger.conversationId) {
    return nonReady('CAPTURE_LEDGER_BASELINE_MISSING');
  }

  const versions = new Map();
  const currentMessages = new Map();
  const keyFor = (messageId, versionId) => JSON.stringify([messageId, versionId]);
  const addVersion = (messageId, version, current = false) => {
    if (!validId(messageId) || !validId(version?.versionId) || !validDigest(version?.payloadDigest)
      || (version.parentVersionId != null && !validId(version.parentVersionId))) {
      throw Error('VERSION_IDENTITY_INVALID');
    }
    const key = keyFor(messageId, version.versionId);
    const prior = versions.get(key);
    if (prior && (prior.payload_sha256 !== version.payloadDigest
      || prior.parent_version_id !== (version.parentVersionId ?? null))) {
      throw Error('VERSION_IDENTITY_CONFLICT');
    }
    if (prior?.deleted) throw Error('TOMBSTONE_REAPPEARED');
    const row = prior ?? {
      message_id: messageId,
      version_id: version.versionId,
      payload_sha256: version.payloadDigest,
      parent_version_id: version.parentVersionId ?? null,
      version_index: version.versionIndex,
      active: false,
      deleted: false,
      current: false,
    };
    if (Number.isInteger(version.versionIndex)) row.version_index = version.versionIndex;
    if (current) row.current = true;
    versions.set(key, row);
    return row;
  };

  try {
    const baselineMessages = records[0].payload?.messages;
    if (!Array.isArray(baselineMessages)) return nonReady('CAPTURE_LEDGER_BASELINE_INVALID');
    for (const message of baselineMessages) {
      if (!validId(message?.messageId) || !Array.isArray(message.versions)
        || !Number.isInteger(message.activeVersionIndex)) {
        return nonReady('BASELINE_MESSAGE_INVALID');
      }
      if (currentMessages.has(message.messageId)) return nonReady('DUPLICATE_MESSAGE_ID');
      const ids = new Set();
      for (const version of message.versions) {
        if (ids.has(version?.versionId)) return nonReady('DUPLICATE_VERSION_ID');
        ids.add(version.versionId);
        addVersion(message.messageId, version, true);
      }
      const active = message.versions.find(v => v.versionIndex === message.activeVersionIndex);
      if (!active) return nonReady('ACTIVE_VERSION_MISSING');
      currentMessages.set(message.messageId, new Set(message.versions.map(v => v.versionId)));
      versions.get(keyFor(message.messageId, active.versionId)).active = true;
    }

    for (let index = 1; index < records.length; index++) {
      const record = records[index];
      if (record?.conversationId !== ledger.conversationId || record.sequence !== index + 1
        || !record.payload || typeof record.payload !== 'object') {
        return nonReady('CAPTURE_LEDGER_SEQUENCE_OR_SCOPE_INVALID');
      }
      if (record.operation.startsWith('before:')) {
        const affected = record.payload.affectedVersions;
        if (!Array.isArray(affected)) return nonReady('PRE_MUTATION_CAPTURE_INVALID');
        for (const item of affected) {
          const row = versions.get(keyFor(item?.messageId, item?.versionId));
          if (!row || row.payload_sha256 !== item.payloadDigest) {
            return nonReady('PRE_MUTATION_IDENTITY_UNRECOGNIZED');
          }
        }
        continue;
      }
      if (!record.operation.startsWith('after:')) return nonReady('UNKNOWN_CAPTURE_OPERATION');

      const payload = record.payload;
      if (!Array.isArray(payload.versionPayloads) || !Array.isArray(payload.tombstones)
        || !Array.isArray(payload.changes)) {
        return nonReady('POST_MUTATION_CAPTURE_INCOMPLETE');
      }
      for (const item of payload.versionPayloads) addVersion(item.messageId, item);
      const deletedMessages = new Set();
      for (const tombstone of payload.tombstones) {
        const row = versions.get(keyFor(tombstone?.messageId, tombstone?.versionId));
        if (!row || row.payload_sha256 !== tombstone.payloadDigest || tombstone.deleted !== true
          || tombstone.active !== false) {
          return nonReady('TOMBSTONE_UNKNOWN_OR_CONTRADICTORY');
        }
        row.deleted = true;
        row.active = false;
        row.current = false;
        if (tombstone.reason === 'message-deleted') deletedMessages.add(tombstone.messageId);
      }
      for (const messageId of deletedMessages) {
        for (const row of versions.values()) {
          if (row.message_id === messageId) {
            row.deleted = true;
            row.active = false;
            row.current = false;
          }
        }
      }

      const nextCurrentMessages = new Map();
      const activeByMessage = new Set();
      for (const row of versions.values()) {
        row.current = false;
        row.active = false;
      }
      for (const message of payload.changes) {
        if (!validId(message?.messageId) || !Array.isArray(message.versions)
          || !Number.isInteger(message.activeVersionIndex) || nextCurrentMessages.has(message.messageId)) {
          return nonReady('POST_MUTATION_MESSAGE_INVALID');
        }
        const seen = new Set();
        for (const version of message.versions) {
          const row = addVersion(message.messageId, version, true);
          if (row.deleted || seen.has(row.version_id)) return nonReady('TOMBSTONE_REAPPEARED_OR_DUPLICATE_VERSION');
          seen.add(row.version_id);
          row.current = true;
          row.version_index = version.versionIndex;
        }
        const active = message.versions.find(v => v.versionIndex === message.activeVersionIndex);
        if (!active) return nonReady('ACTIVE_VERSION_MISSING');
        const activeKey = keyFor(message.messageId, active.versionId);
        if (activeByMessage.has(message.messageId)) return nonReady('MULTIPLE_ACTIVE_VERSIONS');
        activeByMessage.add(message.messageId);
        versions.get(activeKey).active = true;
        nextCurrentMessages.set(message.messageId, seen);
      }

      for (const [messageId, priorVersions] of currentMessages) {
        if (!nextCurrentMessages.has(messageId) && !deletedMessages.has(messageId)) {
          return nonReady('MESSAGE_DISAPPEARED_WITHOUT_TOMBSTONE');
        }
        const nextVersions = nextCurrentMessages.get(messageId) ?? new Set();
        for (const versionId of priorVersions) {
          if (nextVersions.has(versionId)) continue;
          const row = versions.get(keyFor(messageId, versionId));
          if (row?.deleted) continue;
          const hasChild = [...versions.values()].some(candidate =>
            candidate.message_id === messageId && candidate.parent_version_id === versionId);
          if (!hasChild) return nonReady('VERSION_DISAPPEARED_WITHOUT_TOMBSTONE_OR_LINEAGE');
        }
      }
      currentMessages.clear();
      for (const [messageId, ids] of nextCurrentMessages) currentMessages.set(messageId, ids);
    }

    for (const row of versions.values()) {
      if (row.parent_version_id != null && !versions.has(keyFor(row.message_id, row.parent_version_id))) {
        return nonReady('VERSION_PARENT_MISSING');
      }
      if (row.deleted && row.active) return nonReady('DELETED_VERSION_ACTIVE');
    }
  } catch (error) {
    return nonReady(error?.message === 'TOMBSTONE_REAPPEARED'
      ? 'TOMBSTONE_REAPPEARED'
      : error?.message === 'VERSION_IDENTITY_CONFLICT'
        ? 'VERSION_IDENTITY_CONFLICT'
        : 'CAPTURE_LEDGER_REPLAY_INVALID');
  }

  const rows = [...versions.values()]
    .map(({ message_id, version_id, payload_sha256, parent_version_id, version_index, active, deleted, current }) => ({
      message_id, version_id, payload_sha256, parent_version_id, version_index, active, deleted, current,
    }))
    .sort((a, b) => a.message_id.localeCompare(b.message_id) || a.version_id.localeCompare(b.version_id));
  const inventorySha256 = createHash('sha256').update(canonical(rows), 'utf8').digest('hex');
  return {
    status: 'REVIEW_ONLY',
    authority: 'NON_AUTHORITATIVE',
    conversation_id: ledger.conversationId,
    rows,
    inventory_sha256: inventorySha256,
    completeness: 'UNPROVEN',
    pre_enrollment_history: 'UNKNOWN_UNRECOVERABLE',
    blockers: [
      'CORE_WORLD_BINDING_MISSING',
      'TRUSTED_HOST_INVENTORY_VERIFIER_MISSING',
      'PRE_ENROLLMENT_HISTORY_UNKNOWN',
      'PAYLOAD_DIGEST_SEMANTICS_UNAPPROVED',
      'BRANCH_RESTORE_LINEAGE_UNPROVEN',
      'FINAL_DISPATCH_GATE_MISSING',
    ],
  };
}

export const providerInventoryCanonicalization = Object.freeze({ canonical });
