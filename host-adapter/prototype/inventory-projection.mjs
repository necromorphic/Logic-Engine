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
      'HOST_INSTALLATION_ID_MISSING',
      'BRANCH_RESTORE_LINEAGE_MISSING',
      'COMPLETE_NATIVE_INVENTORY_UNPROVEN',
    ],
  };
}

export const providerInventoryCanonicalization = Object.freeze({ canonical });
