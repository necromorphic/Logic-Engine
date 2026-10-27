import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const validId = value => typeof value === 'string' && value.length > 0 && value === value.trim()
  && value.length <= 200 && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const validUuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameStat = (a, b) => a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const digestHostValue = value => sha256(JSON.stringify(String(value)));

async function readStableFile(absolutePath, fs) {
  const before = await fs.lstat(absolutePath);
  if (before.isSymbolicLink() || !before.isFile()) throw Error('ARTIFACT_TYPE_UNSUPPORTED');
  const handle = await fs.open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameStat(before, opened)) throw Error('ARTIFACT_CHANGED_BEFORE_READ');
    const bytes = await handle.readFile();
    const afterHandle = await handle.stat();
    const afterPath = await fs.lstat(absolutePath);
    if (!sameStat(opened, afterHandle) || !sameStat(opened, afterPath) || bytes.length !== afterHandle.size) {
      throw Error('ARTIFACT_CHANGED_DURING_READ');
    }
    return bytes.toString('utf8');
  } finally {
    await handle.close().catch(() => {});
  }
}

/**
 * Reads persisted SillyTavern JSONL files for explicitly enrolled conversations.
 * It returns IDs, active pointers and digests only, never message text.
 * A successful result describes current persisted files only; it does not
 * prove historical completeness, source authenticity, or rollback resistance.
 */
export async function scanPersistedConversationInventories(roots, enrollments, { fs = { lstat, open, readdir, realpath } } = {}) {
  const fail = (...errors) => ({
    status: 'INVENTORY_INCOMPLETE', complete: false, authority: 'NON_AUTHORITATIVE',
    historicalCompleteness: 'UNKNOWN', inventories: [], errors,
  });
  if (!Array.isArray(roots) || !roots.length || !Array.isArray(enrollments) || !enrollments.length) {
    return fail('ROOTS_OR_ENROLLMENTS_UNAVAILABLE');
  }
  const enrollmentByUuid = new Map();
  for (const enrollment of enrollments) {
    if (!enrollment || !validId(enrollment.conversationId) || !validId(enrollment.sourceLocator)
      || !['chats', 'group_chats'].includes(enrollment.domain)) return fail('ENROLLMENT_INVALID');
    const identityParts = enrollment.conversationId.split(':');
    if (identityParts.length !== 2 || !validUuid(identityParts[0]) || !validUuid(identityParts[1])) return fail('ENROLLMENT_IDENTITY_INVALID');
    const uuid = identityParts[1];
    if (enrollmentByUuid.has(uuid)) return fail('ENROLLMENT_IDENTITY_AMBIGUOUS');
    enrollmentByUuid.set(uuid, enrollment);
  }

  const allowedRoots = new Map();
  for (const root of roots) {
    if (!root || !['chats', 'group_chats'].includes(root.domain) || typeof root.path !== 'string'
      || !path.isAbsolute(root.path) || allowedRoots.has(root.domain)) return fail('ROOT_CONFIGURATION_INVALID');
    try {
      const before = await fs.lstat(root.path);
      if (before.isSymbolicLink() || !before.isDirectory()) return fail('ROOT_UNSAFE:' + root.domain);
      const canonicalRoot = await fs.realpath(root.path);
      const after = await fs.lstat(canonicalRoot);
      if (after.isSymbolicLink() || !after.isDirectory()) return fail('ROOT_UNSAFE:' + root.domain);
      allowedRoots.set(root.domain, canonicalRoot);
    } catch {
      return fail('ROOT_UNAVAILABLE:' + root.domain);
    }
  }
  if (allowedRoots.size !== 2) return fail('BOTH_CHAT_DOMAINS_REQUIRED');

  const matchedFiles = new Map();
  const parseErrors = [];
  for (const [domain, rootPath] of allowedRoots) {
    const walk = async directory => {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch { parseErrors.push('DIRECTORY_ENUMERATION_FAILED:' + domain); return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
        if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
          parseErrors.push('PATH_ESCAPE:' + domain); continue;
        }
        let stat;
        try { stat = await fs.lstat(absolutePath); }
        catch { parseErrors.push('ARTIFACT_DISAPPEARED:' + domain); continue; }
        if (stat.isSymbolicLink()) { parseErrors.push('SYMLINK_UNSUPPORTED:' + domain); continue; }
        if (stat.isDirectory()) { await walk(absolutePath); continue; }
        if (!stat.isFile()) { parseErrors.push('ARTIFACT_TYPE_UNSUPPORTED:' + domain); continue; }
        if (path.extname(entry.name).toLowerCase() !== '.jsonl') continue;
        let parsed;
        try {
          const text = await readStableFile(absolutePath, fs);
          const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
          if (!lines.length) continue;
          parsed = lines.map(line => JSON.parse(line));
          if (!parsed.every(value => value && typeof value === 'object' && !Array.isArray(value))) throw Error('JSONL_RECORD_INVALID');
        } catch {
          parseErrors.push('CHAT_JSONL_UNREADABLE:' + domain);
          continue;
        }
        const header = parsed[0];
        const headerId = header.chat_metadata?.logic_engine_conversation_id;
        if (typeof headerId !== 'string') continue;
        const enrollment = enrollmentByUuid.get(headerId);
        if (!enrollment) continue;
        if (enrollment.domain !== domain || path.parse(relativePath).name !== enrollment.sourceLocator) {
          parseErrors.push('ENROLLED_CONVERSATION_LOCATOR_OR_DOMAIN_MISMATCH');
          continue;
        }
        const candidates = matchedFiles.get(enrollment.conversationId) ?? [];
        candidates.push({ domain, relativePath, records: parsed.slice(1) });
        matchedFiles.set(enrollment.conversationId, candidates);
      }
    };
    await walk(rootPath);
  }
  if (parseErrors.length) return fail(...[...new Set(parseErrors)].sort());

  const inventories = [];
  for (const enrollment of enrollments) {
    const candidates = matchedFiles.get(enrollment.conversationId) ?? [];
    if (candidates.length !== 1) return fail(candidates.length ? 'DUPLICATE_CONVERSATION_ARTIFACT' : 'ENROLLED_CONVERSATION_FILE_MISSING');
    const candidate = candidates[0];
    const messageIds = new Set();
    const versionIds = new Set();
    const versions = [];
    for (const message of candidate.records) {
      const identity = message._logicEngineLifecycle;
      const nativeVersions = Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes ?? ''];
      const activeIndex = message.swipe_id === undefined ? 0 : message.swipe_id;
      if (!identity || !validUuid(identity.messageId) || messageIds.has(identity.messageId)
        || !Array.isArray(identity.versions) || identity.versions.length !== nativeVersions.length
        || !Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= nativeVersions.length
        || identity.activeVersionIndex !== activeIndex) return fail('MESSAGE_IDENTITY_OR_ACTIVE_POINTER_INVALID');
      if (typeof message.mes !== 'string' || nativeVersions.some(value => typeof value !== 'string')
        || message.mes !== nativeVersions[activeIndex]) return fail('NATIVE_ACTIVE_CONTENT_MISMATCH');
      messageIds.add(identity.messageId);
      for (let index = 0; index < nativeVersions.length; index++) {
        const version = identity.versions[index];
        if (!version || !validUuid(version.versionId) || versionIds.has(version.versionId)
          || !validDigest(version.payloadDigest) || version.payloadDigest !== digestHostValue(nativeVersions[index])
          || (version.parentVersionId != null && !validUuid(version.parentVersionId))) {
          return fail('VERSION_IDENTITY_OR_DIGEST_INVALID');
        }
        versionIds.add(version.versionId);
        versions.push({
          message_id: identity.messageId,
          version_id: version.versionId,
          payload_sha256: version.payloadDigest,
          parent_version_id: version.parentVersionId ?? null,
          active: index === activeIndex,
        });
      }
    }
    versions.sort((a, b) => a.message_id.localeCompare(b.message_id) || a.version_id.localeCompare(b.version_id));
    const inventory = {
      conversation_id: enrollment.conversationId,
      domain: candidate.domain,
      locator: candidate.relativePath,
      message_count: messageIds.size,
      version_count: versions.length,
      versions,
    };
    inventory.inventory_sha256 = sha256(canonical(inventory));
    inventories.push(inventory);
  }
  inventories.sort((a, b) => a.conversation_id.localeCompare(b.conversation_id));
  return {
    status: 'CURRENT_PERSISTED_SNAPSHOT_NON_AUTHORITATIVE',
    complete: true,
    authority: 'NON_AUTHORITATIVE',
    historicalCompleteness: 'UNKNOWN',
    captureBoundary: 'CURRENT_PERSISTED_ENROLLED_FILES_ONLY',
    conversationCount: inventories.length,
    messageCount: inventories.reduce((sum, item) => sum + item.message_count, 0),
    versionCount: inventories.reduce((sum, item) => sum + item.version_count, 0),
    inventory_sha256: sha256(canonical(inventories)),
    inventories,
    errors: [],
  };
}
