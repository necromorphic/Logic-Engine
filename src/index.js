import { createHmac, timingSafeEqual } from 'node:crypto';
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
        const stat = statSync(absolute);
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
// This deny-only verifier is deliberately not source authority. Until the trusted
// Host/Core complete-inventory adapter is wired, reconciliation can never set READY.
const hostVersionLedger = new HostVersionDigestLedger({
  path: hostVersionLedgerPath,
  coordinatorPath,
  verifyInventorySnapshot: async () => false,
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
const canonicalHostReceiptProof = value => value && typeof value === 'object'
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalHostReceiptProof(value[key])).join(',') + '}'
  : JSON.stringify(value);
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

function bindHostLifecycleAuthority(resolved) {
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
  if (snapshot?.status !== 'INTEGRITY_OK' || !/^[a-f0-9]{64}$/.test(snapshot.snapshot_fingerprint ?? '')) {
    return { authorized: false };
  }
  return {
    ...resolved,
    authority_id: hostLifecycleAuthorityId.trim(),
    generation: hostLifecycleAuthorityGeneration,
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
    ['ENGINE_HOST_LIFECYCLE_DB_PATH', hostLifecyclePath],
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
  });
  if (typeof hostLifecycleAuthorityId === 'string' && hostLifecycleAuthorityId.trim()
    && Number.isSafeInteger(hostLifecycleAuthorityGeneration) && hostLifecycleAuthorityGeneration > 0) {
    hostRootInventoryJournal.setAuthorityGeneration(hostLifecycleAuthorityId.trim(), hostLifecycleAuthorityGeneration);
  }
  resolveHostRootIdentity = input => resolveAdapterHostRootIdentity(hostRootIdentityRegistry, input);
}

const server = createApiServer({
  engine: new LogicEngine(store, {
    trustedInitialKnowledgeSources, worldPackCatalog,
    npcKnowledgeReadAuthorizer: npcKnowledgeAuthorizers.readAuthorizer,
    npcKnowledgeVisibilityAuthorizer: npcKnowledgeAuthorizers.visibilityAuthorizer,
  }), token, internalToken, approvalToken, adminToken, adapterTokens,
  hostVersionLedger,
  hostRootInventoryJournal,
  resolveHostRootIdentity,
  resolveHostLifecycleIdentity: input => bindHostLifecycleAuthority(resolveAdapterHostLifecycleIdentity(hostRootIdentityRegistry, input)),
  hostLifecycleJournal: hostRootInventoryJournal,
  mechanicPolicyAuthority,
});
server.listen(port, host, () => process.stdout.write(
  'Logic-Engine API listening on http://' + host + ':' + port + '\nDatabase: ' + dbPath +
  '\nDirect commit: ' + (internalToken ? 'enabled for internal credential' : 'disabled') +
  '\nProposal approval: ' + (approvalToken ? 'enabled' : 'disabled') + '\nAdmin registry: ' + (adminToken ? 'enabled' : 'disabled') + '\nConfigured adapters: ' + Object.keys(adapterTokens).length + '\n',
));
function stop() {
  server.close(() => {
    try { hostRootInventoryJournal?.close(); }
    finally {
      try { hostVersionLedger.close(); }
      finally { store.close(); process.exit(0); }
    }
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
