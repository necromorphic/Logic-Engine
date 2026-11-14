import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { SQLiteStore } from './storage/sqlite-store.js';
import { LogicEngine } from './application/engine.js';
import { createApiServer } from './api/server.js';
import { HostVersionDigestLedger } from './application/host-version-digest-ledger.js';
import { HostLifecycleJournal } from './application/host-lifecycle-journal.js';
import {
  parseHostRootIdentityRegistry,
  resolveAdapterHostRootIdentity,
  resolveRegisteredHostRootIdentity,
  resolveAdapterHostLifecycleIdentity,
  resolveRegisteredHostLifecycleIdentity,
} from './application/host-root-inventory-identity.js';
import { loadTrustedWorldPackCatalog } from './application/world-pack-catalog.js';
import { createHostBoundNpcKnowledgeAuthorizers } from './application/npc-knowledge-authorization.js';
import { createProcessScopedMechanicPolicyAuthority, defaultMechanicPolicyFieldPolicy } from './application/mechanic-policy-authority.js';
import { createMemoryNpcProviderAdapter } from './application/memory-npc-provider-adapter.js';
import { HostAssertionNonceStore } from './application/host-assertion-nonce-store.js';

const token = process.env.ENGINE_API_TOKEN;
const internalToken = process.env.ENGINE_INTERNAL_TOKEN || null;
const approvalToken = process.env.ENGINE_APPROVAL_TOKEN || null;
const adminToken = process.env.ENGINE_ADMIN_TOKEN || null;
let adapterTokens = {};
try { adapterTokens = JSON.parse(process.env.ENGINE_ADAPTER_TOKENS || '{}'); } catch { throw new Error('ENGINE_ADAPTER_TOKENS must be a JSON object mapping adapter IDs to secrets.'); }
if (!adapterTokens || typeof adapterTokens !== 'object' || Array.isArray(adapterTokens)) throw new Error('ENGINE_ADAPTER_TOKENS must be a JSON object mapping adapter IDs to secrets.');
let trustedInitialKnowledgeSources;
try {
  trustedInitialKnowledgeSources = JSON.parse(process.env.ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES || '[]');
} catch {
  throw new Error('ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES must be a JSON array of deployment-approved source records.');
}
if (!Array.isArray(trustedInitialKnowledgeSources)) {
  throw new Error('ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES must be a JSON array of deployment-approved source records.');
}
const trustedSourceIdentities = new Set();
for (const [index, source] of trustedInitialKnowledgeSources.entries()) {
  const allowedFields = ['world_pack_id', 'world_pack_version', 'source_kind', 'source_ref', 'authorization_ref', 'sha256', 'source_path'];
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some((key) => !allowedFields.includes(key))
    || ['world_pack_id', 'world_pack_version', 'source_kind', 'source_ref', 'authorization_ref', 'sha256']
      .some((key) => typeof source[key] !== 'string' || !source[key].trim())) {
    throw new Error('Trusted source registry entry ' + index + ' has invalid or unsupported fields.');
  }
  if (!['author_initial', 'imported'].includes(source.source_kind) || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new Error('Trusted source registry entry ' + index + ' has an unsupported source_kind or invalid SHA-256 digest.');
  }
  if (source.source_kind === 'imported' && (typeof source.source_path !== 'string' || !isAbsolute(source.source_path))) {
    throw new Error('Imported trusted source registry entry ' + index + ' requires an absolute deployment-owned source_path.');
  }
  if (source.source_kind === 'author_initial' && source.source_path !== undefined) {
    throw new Error('Author-initial source registry entries must not declare source_path.');
  }
  const identity = JSON.stringify([source.world_pack_id, source.world_pack_version, source.source_kind, source.source_ref, source.authorization_ref]);
  if (trustedSourceIdentities.has(identity)) throw new Error('Trusted source registry contains duplicate source identity: ' + identity);
  trustedSourceIdentities.add(identity);
}
if (!token || token.length < 16) {
  process.stderr.write('ENGINE_API_TOKEN must be set and at least 16 characters long.\n');
  process.exit(1);
}
for (const [name, value] of [['ENGINE_INTERNAL_TOKEN', internalToken], ['ENGINE_APPROVAL_TOKEN', approvalToken], ['ENGINE_ADMIN_TOKEN', adminToken]]) {
  if (value !== null && value.length < 16) {
    process.stderr.write(name + ' must be at least 16 characters long when set.\n');
    process.exit(1);
  }
}
if (internalToken && internalToken === token) throw new Error('ENGINE_INTERNAL_TOKEN must differ from ENGINE_API_TOKEN.');
if (approvalToken && (approvalToken === token || approvalToken === internalToken || approvalToken === adminToken)) throw new Error('ENGINE_APPROVAL_TOKEN must differ from other configured tokens.');
if (adminToken && [token, internalToken, approvalToken].includes(adminToken)) throw new Error('ENGINE_ADMIN_TOKEN must differ from other configured tokens.');
const configuredAdapterSecrets = Object.values(adapterTokens);
if (new Set(configuredAdapterSecrets).size !== configuredAdapterSecrets.length) throw new Error('ENGINE_ADAPTER_TOKENS secrets must be unique per adapter.');
for (const [id, secret] of Object.entries(adapterTokens)) {
  if (!id.trim() || typeof secret !== 'string' || secret.length < 16 || [token, internalToken, approvalToken, adminToken].includes(secret)) throw new Error('Each ENGINE_ADAPTER_TOKENS entry must have a non-empty ID and a distinct secret of at least 16 characters.');
}

function aliasesSameFile(left, right) {
  const identity = (value) => {
    const absolute = resolve(value);
    if (existsSync(absolute)) {
      try {
        const stat = statSync(absolute, { bigint: true });
        return 'inode:' + stat.dev + ':' + stat.ino;
      } catch {}
    }
    try { return 'path:' + realpathSync(absolute); } catch {}
    try { return 'path:' + join(realpathSync(dirname(absolute)), basename(absolute)); } catch {}
    return 'path:' + absolute;
  };
  return identity(left) === identity(right);
}

const dbPath = process.env.ENGINE_DB_PATH || './data/logic-engine.sqlite';
const coordinatorPath = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
if (typeof coordinatorPath !== 'string' || !coordinatorPath.trim() || !isAbsolute(coordinatorPath)) {
  process.stderr.write('LOGIC_ENGINE_COORDINATOR_DB_PATH must be set to an absolute path for runtime.\n');
  process.exit(1);
}
if (dbPath !== ':memory:' && aliasesSameFile(dbPath, coordinatorPath)) {
  throw new Error('LOGIC_ENGINE_COORDINATOR_DB_PATH must be separate from ENGINE_DB_PATH, including filesystem aliases.');
}
if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const port = Number(process.env.ENGINE_PORT || 8787), host = process.env.ENGINE_HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ENGINE_PORT must be between 1 and 65535.');
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && process.env.ENGINE_ALLOW_REMOTE !== 'true') throw new Error('Remote binding is disabled unless ENGINE_ALLOW_REMOTE=true.');
const worldPackCatalogPath = process.env.LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH;
if (typeof worldPackCatalogPath !== 'string' || !worldPackCatalogPath.trim()) {
  process.stderr.write('LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH must point to a deployment-controlled World Pack catalog.' + String.fromCharCode(10));
  process.exit(1);
}
const worldPackCatalog = loadTrustedWorldPackCatalog(resolve(worldPackCatalogPath));
const mechanicPolicyAuthority = createProcessScopedMechanicPolicyAuthority({
  authorityId: process.env.ENGINE_MECHANIC_POLICY_AUTHORITY_ID || 'logic-engine.default-visibility-policy',
  generation: Number(process.env.ENGINE_MECHANIC_POLICY_GENERATION || '1'),
  fieldPolicy: defaultMechanicPolicyFieldPolicy,
});

const store = new SQLiteStore(dbPath);
const npcKnowledgeAuthorizers = createHostBoundNpcKnowledgeAuthorizers({
  store,
  adapterIds: Object.keys(adapterTokens),
  trustedInitialKnowledgeSources,
  hostCommunicationEvidenceVerifier: verifyHostCommunicationEvidence,
});
const hostVersionLedgerPath = process.env.ENGINE_HOST_VERSION_LEDGER_DB_PATH
  ? resolve(process.env.ENGINE_HOST_VERSION_LEDGER_DB_PATH)
  : resolve('./data/logic-engine-host-versions.sqlite');
if (dbPath !== ':memory:' && aliasesSameFile(hostVersionLedgerPath, dbPath)) {
  throw new Error('ENGINE_HOST_VERSION_LEDGER_DB_PATH must be separate from ENGINE_DB_PATH, including filesystem aliases.');
}
if (aliasesSameFile(hostVersionLedgerPath, coordinatorPath)) {
  throw new Error('ENGINE_HOST_VERSION_LEDGER_DB_PATH must be separate from LOGIC_ENGINE_COORDINATOR_DB_PATH, including filesystem aliases.');
}
const memoryProviderPath = process.env.ENGINE_MEMORY_PROVIDER_DB_PATH;
const assertionNoncePath = process.env.ENGINE_HOST_ASSERTION_NONCE_DB_PATH
  ? resolve(process.env.ENGINE_HOST_ASSERTION_NONCE_DB_PATH)
  : resolve('./data/logic-engine-host-assertion-nonces.sqlite');
const coreDatabasePath = store.db.prepare('PRAGMA database_list').all()
  .find(entry => entry.name === 'main')?.file;
if (typeof coreDatabasePath !== 'string' || !coreDatabasePath) {
  throw new Error('Host assertion nonce storage requires a file-backed Core database.');
}
if (aliasesSameFile(assertionNoncePath, hostVersionLedgerPath)) {
  throw new Error('ENGINE_HOST_ASSERTION_NONCE_DB_PATH must be separate from ENGINE_HOST_VERSION_LEDGER_DB_PATH.');
}
const hostAssertionNonceStore = new HostAssertionNonceStore({
  path: assertionNoncePath,
  coreDatabasePath,
  coordinatorPath,
  providerDatabasePath: memoryProviderPath === undefined ? null : resolve(memoryProviderPath),
});
// Only a signed, server-produced Host delivery receipt may establish a complete
// conversation inventory. The browser-facing reconciliation route has no such
// attestation and therefore remains deny-only.
const hostVersionLedger = new HostVersionDigestLedger({
  path: hostVersionLedgerPath,
  coordinatorPath,
  verifyInventorySnapshot: async snapshot => verifyHostVersionInventorySnapshot(snapshot),
});
let hostRootIdentityRegistry;
try {
  hostRootIdentityRegistry = parseHostRootIdentityRegistry(process.env.ENGINE_HOST_ROOT_IDENTITIES || '[]');
} catch (error) {
  process.stderr.write((error?.message || 'ENGINE_HOST_ROOT_IDENTITIES is invalid.') + '\\n');
  process.exit(1);
}
let hostRootInventoryJournal = null;
let resolveHostRootIdentity = null;
const hostLifecycleAuthorityId = process.env.ENGINE_HOST_AUTHORITY_ID;
const hostLifecycleAuthorityGeneration = Number(process.env.ENGINE_HOST_AUTHORITY_GENERATION || '0');
const canonicalHostReceiptProof = value => Array.isArray(value)
  ? '[' + value.map(canonicalHostReceiptProof).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalHostReceiptProof(value[key])).join(',') + '}'
    : JSON.stringify(value);
function verifyHostRootInventoryAttestation({ attestation, identity }) {
  const secret = adapterTokens?.[identity?.adapter_id];
  if (typeof secret !== 'string' || secret.length < 16
    || !/^[a-f0-9]{64}$/.test(attestation?.signature ?? '')) return false;
  const { signature, ...proof } = attestation;
  const expected = createHmac('sha256', secret)
    .update(canonicalHostReceiptProof(proof), 'utf8').digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function verifyHostLifecycleReceipt({ event, identity }) {
  const secret = adapterTokens?.[identity?.adapter_id];
  if (typeof secret !== 'string' || secret.length < 16
    || !/^[a-f0-9]{64}$/.test(event?.receipt_signature ?? '')) return false;
  const proof = {
    protocol_version: 1,
    adapter_id: identity.adapter_id,
    host_installation_id: event.host_installation_id,
    authenticated_account_id: event.authenticated_account_id,
    host_session_id: event.host_session_id,
    conversation_uuid: event.conversation_uuid,
    event_id: event.event_id,
    event_type: event.event_type,
    mutation_id: event.mutation_id,
    operation: event.operation,
    mutation_digest: event.mutation_digest,
    receipt_digest: event.receipt_digest,
    occurred_at: event.occurred_at,
  };
  const expected = createHmac('sha256', secret).update(canonicalHostReceiptProof(proof), 'utf8').digest();
  const supplied = Buffer.from(event.receipt_signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function verifyHostCommunicationEvidence({
  adapter_id, world_id, conversation_id, actor_id, receipt_digest, receipt_proof, source_evidence,
}) {
  if (!source_evidence || source_evidence.adapter_id !== adapter_id
    || source_evidence.receipt_digest !== receipt_digest
    || source_evidence.receipt_proof?.receipt_digest !== receipt_digest
    || source_evidence.receipt_proof?.receipt_signature !== source_evidence.receipt_signature
    || source_evidence.recipient?.world_id !== world_id
    || source_evidence.recipient?.actor_id !== actor_id
    || [source_evidence.host_session_id, source_evidence.host_installation_id,
      source_evidence.conversation_uuid].join(':') !== conversation_id
    || receipt_proof?.event_id !== source_evidence.host_event_id
    || receipt_proof?.event_type !== 'MUTATION_COMMITTED'
    || receipt_proof?.mutation_id !== source_evidence.mutation_id
    || receipt_proof?.operation !== 'message-send'
    || !/^[a-f0-9]{64}$/.test(receipt_proof?.mutation_digest ?? '')
    || receipt_proof?.occurred_at !== source_evidence.delivered_at
    || receipt_proof?.receipt_digest !== receipt_digest
    || receipt_proof?.receipt_signature !== source_evidence.receipt_signature
    || receipt_proof?.host_installation_id !== source_evidence.host_installation_id
    || receipt_proof?.authenticated_account_id !== source_evidence.authenticated_account_id
    || receipt_proof?.host_session_id !== source_evidence.host_session_id
    || receipt_proof?.conversation_uuid !== source_evidence.conversation_uuid) return false;
  return verifyHostLifecycleReceipt({ event: receipt_proof, identity: { adapter_id } });
}

function verifyHostVersionInventorySnapshot(snapshot) {
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DIGEST = /^[a-f0-9]{64}$/;
  const attestation = snapshot?.attestation;
  if (!exactKeys(attestation, ['adapter_id', 'protocol_version', 'evidence_type', 'delivery',
    'conversation_inventory', 'receipt_digest', 'proof'])
    || !Object.hasOwn(adapterTokens, attestation.adapter_id)
    || attestation.protocol_version !== 1
    || attestation.evidence_type !== 'communication_delivered'
    || !exactKeys(attestation.conversation_inventory, ['protocol_version', 'complete'])
    || attestation.conversation_inventory.protocol_version !== 1
    || attestation.conversation_inventory.complete !== true
    || !exactKeys(attestation.delivery, [
      'protocol_version', 'evidence_type', 'producer', 'host_commit', 'host_installation_id',
      'authenticated_account_id', 'host_session_id', 'conversation_uuid', 'sender', 'recipient',
      'source_attestation', 'channel', 'source', 'status', 'delivered_at', 'host_event_id', 'mutation_id',
    ])
    || !exactKeys(attestation.delivery.sender, ['principal_type', 'principal_id'])
    || !exactKeys(attestation.delivery.recipient, ['world_id', 'actor_id', 'actor_type', 'host_character_avatar_id'])
    || !exactKeys(attestation.delivery.source, ['message_id', 'version_id', 'content_sha256'])
    || !exactKeys(attestation.delivery.source_attestation, [
      'protocol_version', 'host_commit', 'snapshot_alignment', 'before_snapshot_id', 'after_snapshot_id',
      'before_snapshot_sha256', 'after_snapshot_sha256', 'before_source_inventory_sha256',
      'after_source_inventory_sha256', 'source_manifest_sha256',
      'mutation_coverage_manifest_sha256', 'mutation_coverage_source_files_sha256',
    ])
    || !exactKeys(attestation.proof, [
      'host_installation_id', 'authenticated_account_id', 'host_session_id', 'conversation_uuid',
      'event_id', 'event_type', 'mutation_id', 'operation', 'mutation_digest', 'receipt_digest',
      'occurred_at', 'receipt_signature',
    ])) return false;

  const delivery = attestation.delivery;
  const proof = attestation.proof;
  if (snapshot.complete !== true || !Array.isArray(snapshot.versions)
    || snapshot.versions.length === 0 || snapshot.versions.length > 25000
    || delivery.protocol_version !== 1
    || delivery.evidence_type !== 'communication_delivered'
    || delivery.producer !== 'logic-engine-host-delivery-receipt-v1'
    || delivery.host_commit !== '06bde939fb1e9c4c8d8641d810f0a916b5bce127'
    || delivery.channel !== 'sillytavern.character_chat'
    || delivery.status !== 'delivered'
    || delivery.source_attestation.protocol_version !== 1
    || delivery.source_attestation.host_commit !== '06bde939fb1e9c4c8d8641d810f0a916b5bce127'
    || delivery.source_attestation.snapshot_alignment !== 'SHARED_VSS_SNAPSHOT'
    || typeof delivery.source_attestation.before_snapshot_id !== 'string'
    || !delivery.source_attestation.before_snapshot_id.trim()
    || typeof delivery.source_attestation.after_snapshot_id !== 'string'
    || !delivery.source_attestation.after_snapshot_id.trim()
    || delivery.source_attestation.before_snapshot_id === delivery.source_attestation.after_snapshot_id
    || !DIGEST.test(delivery.source_attestation.before_snapshot_sha256 ?? '')
    || !DIGEST.test(delivery.source_attestation.after_snapshot_sha256 ?? '')
    || !DIGEST.test(delivery.source_attestation.before_source_inventory_sha256 ?? '')
    || !DIGEST.test(delivery.source_attestation.after_source_inventory_sha256 ?? '')
    || !DIGEST.test(delivery.source_attestation.source_manifest_sha256 ?? '')
    || !DIGEST.test(delivery.source_attestation.mutation_coverage_manifest_sha256 ?? '')
    || !DIGEST.test(delivery.source_attestation.mutation_coverage_source_files_sha256 ?? '')
    || delivery.sender.principal_type !== 'host_authenticated_account'
    || delivery.sender.principal_id !== delivery.authenticated_account_id
    || delivery.recipient.world_id !== snapshot.world_id
    || !UUID.test(delivery.host_installation_id ?? '')
    || !UUID.test(delivery.authenticated_account_id ?? '')
    || !UUID.test(delivery.host_session_id ?? '')
    || !UUID.test(delivery.conversation_uuid ?? '')
    || !UUID.test(delivery.host_event_id ?? '')
    || !UUID.test(delivery.mutation_id ?? '')
    || !UUID.test(delivery.source.message_id ?? '')
    || !UUID.test(delivery.source.version_id ?? '')
    || !DIGEST.test(delivery.source.content_sha256 ?? '')
    || !DIGEST.test(proof.mutation_digest ?? '')
    || !DIGEST.test(attestation.receipt_digest ?? '')
    || proof.event_type !== 'MUTATION_COMMITTED'
    || proof.operation !== 'message-send'
    || proof.event_id !== delivery.host_event_id
    || proof.mutation_id !== delivery.mutation_id
    || proof.host_installation_id !== delivery.host_installation_id
    || proof.authenticated_account_id !== delivery.authenticated_account_id
    || proof.host_session_id !== delivery.host_session_id
    || proof.conversation_uuid !== delivery.conversation_uuid
    || proof.occurred_at !== delivery.delivered_at
    || proof.receipt_digest !== attestation.receipt_digest
    || snapshot.conversation_id !== [
      delivery.host_session_id, delivery.host_installation_id, delivery.conversation_uuid,
    ].join(':')) return false;

  const versions = [];
  const activeByMessage = new Map();
  for (const version of snapshot.versions) {
    if (!version || typeof version !== 'object' || Array.isArray(version)
      || !UUID.test(version.message_id ?? '') || !UUID.test(version.version_id ?? '')
      || (version.parent_version_id !== null && !UUID.test(version.parent_version_id ?? ''))
      || !DIGEST.test(version.content_sha256 ?? '')
      || typeof version.active !== 'boolean' || version.deleted !== false
      || version.world_id !== snapshot.world_id || version.conversation_id !== snapshot.conversation_id) return false;
    const activeCount = activeByMessage.get(version.message_id) ?? 0;
    activeByMessage.set(version.message_id, activeCount + (version.active ? 1 : 0));
    versions.push({
      message_id: version.message_id,
      version_id: version.version_id,
      parent_version_id: version.parent_version_id,
      content_sha256: version.content_sha256,
      active: version.active,
      deleted: version.deleted,
    });
  }
  if ([...activeByMessage.values()].some(count => count !== 1)) return false;
  if (!versions.some(version => version.message_id === delivery.source.message_id
    && version.version_id === delivery.source.version_id
    && version.content_sha256 === delivery.source.content_sha256
    && version.active === true && version.deleted === false)) return false;

  const fullDelivery = {
    ...delivery,
    conversation_inventory: {
      protocol_version: attestation.conversation_inventory.protocol_version,
      complete: attestation.conversation_inventory.complete,
      versions,
    },
  };
  const receiptDigest = createHash('sha256')
    .update(canonicalHostReceiptProof(fullDelivery), 'utf8').digest('hex');
  if (receiptDigest !== attestation.receipt_digest
    || !verifyHostLifecycleReceipt({ event: proof, identity: { adapter_id: attestation.adapter_id } })) return false;
  return true;
}

function bindHostLifecycleAuthority(resolved, { requireComplete = false } = {}) {
  if (!resolved || resolved.authorized !== true || !hostRootInventoryJournal
    || typeof hostLifecycleAuthorityId !== 'string' || !hostLifecycleAuthorityId.trim()
    || !Number.isSafeInteger(hostLifecycleAuthorityGeneration) || hostLifecycleAuthorityGeneration < 1
    || !resolved.root_id || !resolved.adapter_id) return { authorized: false };
  let snapshot;
  try {
    snapshot = hostRootInventoryJournal.getAuthoritySnapshot({
      ...resolved,
      authority_id: hostLifecycleAuthorityId.trim(),
      generation: hostLifecycleAuthorityGeneration,
    });
  } catch { return { authorized: false }; }
  const authorityStatus = snapshot?.authority_status ?? 'REVIEW_ONLY';
  if (snapshot?.status !== 'INTEGRITY_OK'
    || (requireComplete && authorityStatus !== 'AUTHORITATIVE_COMPLETE')
    || !/^[a-f0-9]{64}$/.test(snapshot.snapshot_fingerprint ?? '')) {
    return { authorized: false };
  }
  return {
    ...resolved,
    authority_id: hostLifecycleAuthorityId.trim(),
    generation: hostLifecycleAuthorityGeneration,
    authority_status: authorityStatus,
    snapshot_fingerprint: snapshot.snapshot_fingerprint,
  };
}
if (hostRootIdentityRegistry.length > 0) {
  for (const record of hostRootIdentityRegistry) {
    if (!Object.hasOwn(adapterTokens, record.adapter_id)) {
      throw new Error('ENGINE_HOST_ROOT_IDENTITIES references an adapter that is not configured in ENGINE_ADAPTER_TOKENS.');
    }
  }
  const hostLifecyclePath = process.env.ENGINE_HOST_LIFECYCLE_DB_PATH
    ? resolve(process.env.ENGINE_HOST_LIFECYCLE_DB_PATH)
    : resolve('./data/logic-engine-host-lifecycle.sqlite');
  for (const [name, candidate] of [
    ['ENGINE_HOST_ASSERTION_NONCE_DB_PATH', assertionNoncePath],
    ['ENGINE_HOST_VERSION_LEDGER_DB_PATH', hostVersionLedgerPath],
    ['ENGINE_DB_PATH', dbPath],
    ['LOGIC_ENGINE_COORDINATOR_DB_PATH', coordinatorPath],
  ]) {
    if (candidate !== ':memory:' && aliasesSameFile(hostLifecyclePath, candidate)) {
      throw new Error('ENGINE_HOST_LIFECYCLE_DB_PATH must be separate from ' + name + ', including filesystem aliases.');
    }
  }
  mkdirSync(dirname(hostLifecyclePath), { recursive: true });
  hostRootInventoryJournal = new HostLifecycleJournal({
    path: hostLifecyclePath,
    coordinatorPath,
    // The authenticated adapter route checks the exact adapter/installation/account
    // tuple; the journal independently rechecks the deployment-owned installation
    // and account binding before appending any event.
    resolveIdentity: input => {
      const resolved = resolveRegisteredHostLifecycleIdentity(hostRootIdentityRegistry, input);
      return resolved.authorized && typeof hostLifecycleAuthorityId === 'string'
        && hostLifecycleAuthorityId.trim() && Number.isSafeInteger(hostLifecycleAuthorityGeneration)
        && hostLifecycleAuthorityGeneration > 0
        ? { ...resolved, authority_id: hostLifecycleAuthorityId.trim(), generation: hostLifecycleAuthorityGeneration }
        : { authorized: false };
    },
    resolveRootIdentity: input => resolveRegisteredHostRootIdentity(hostRootIdentityRegistry, input),
    verifyMutationReceipt: verifyHostLifecycleReceipt,
    verifyRootInventoryAttestation: verifyHostRootInventoryAttestation,
  });
  if (typeof hostLifecycleAuthorityId === 'string' && hostLifecycleAuthorityId.trim()
    && Number.isSafeInteger(hostLifecycleAuthorityGeneration) && hostLifecycleAuthorityGeneration > 0) {
    hostRootInventoryJournal.setAuthorityGeneration(hostLifecycleAuthorityId.trim(), hostLifecycleAuthorityGeneration);
  }
  resolveHostRootIdentity = input => resolveAdapterHostRootIdentity(hostRootIdentityRegistry, input);
}

const logicEngine = new LogicEngine(store, {
  trustedInitialKnowledgeSources, worldPackCatalog,
  npcKnowledgeReadAuthorizer: npcKnowledgeAuthorizers.readAuthorizer,
  npcKnowledgeVisibilityAuthorizer: npcKnowledgeAuthorizers.visibilityAuthorizer,
  hostVersionDigestLedger: hostVersionLedger,
  hostCommunicationReceiptVerifier: verifyHostCommunicationEvidence,
});
const memoryProviderAdapters = [];
if (memoryProviderPath !== undefined) {
  let contentFields;
  try {
    contentFields = JSON.parse(process.env.ENGINE_MEMORY_NPC_CONTENT_FIELDS || '[]');
  } catch {
    throw new Error('ENGINE_MEMORY_NPC_CONTENT_FIELDS must be a JSON array of Core-authorized fields.');
  }
  if (!Array.isArray(contentFields) || contentFields.length === 0) {
    throw new Error('ENGINE_MEMORY_NPC_CONTENT_FIELDS must be a non-empty JSON array when Memory Provider is configured.');
  }
  for (const adapterId of Object.keys(adapterTokens)) {
    const memoryAdapter = createMemoryNpcProviderAdapter({
      engine: logicEngine,
      providerPath: resolve(memoryProviderPath),
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources,
      fieldPolicy: mechanicPolicyAuthority,
      contentFields,
    });
    memoryProviderAdapters.push(memoryAdapter);
  }
  const worldIds = store.db.prepare('SELECT world_id FROM worlds ORDER BY world_id').all();
  for (const memoryAdapter of memoryProviderAdapters) {
    for (const world of worldIds) await memoryAdapter.prepareWorld(world.world_id);
  }
}
const server = createApiServer({
  engine: logicEngine, token, internalToken, approvalToken, adminToken, adapterTokens,
  defaultHostWorldId: process.env.ENGINE_HOST_DEFAULT_WORLD_ID || null,
  hostVersionLedger,
  hostRootInventoryJournal,
  resolveHostRootIdentity,
  resolveHostLifecycleIdentity: input => bindHostLifecycleAuthority(
    resolveAdapterHostLifecycleIdentity(hostRootIdentityRegistry, input),
  ),
  resolveHostMemoryIdentity: input => bindHostLifecycleAuthority(
    resolveAdapterHostLifecycleIdentity(hostRootIdentityRegistry, input),
    { requireComplete: true },
  ),
  hostLifecycleJournal: hostRootInventoryJournal,
  mechanicPolicyAuthority,
  // The legacy HTTP Host→Consumer retrieval bridge is intentionally not
  // wired in production. NPC retrieval is available only through the
  // embedded in-process Gateway composition, which owns the one-shot handoff.
  hostAssertionNonceStore,
});
server.listen(port, host, () => process.stdout.write(
  'Logic-Engine API listening on http://' + host + ':' + port + '\nDatabase: ' + dbPath +
  '\nDirect commit: ' + (internalToken ? 'enabled for internal credential' : 'disabled') +
  '\nProposal approval: ' + (approvalToken ? 'enabled' : 'disabled') + '\nAdmin registry: ' + (adminToken ? 'enabled' : 'disabled') + '\nConfigured adapters: ' + Object.keys(adapterTokens).length + '\n',
));
function stop() {
  server.close(() => {
    try {
      for (const adapter of memoryProviderAdapters) adapter.close();
      hostAssertionNonceStore.close();
    } finally {
      try { hostRootInventoryJournal?.close(); }
      finally {
        try { hostVersionLedger.close(); }
        finally { store.close(); process.exit(0); }
      }
    }
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
