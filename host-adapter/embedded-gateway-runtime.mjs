import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { SQLiteStore } from '../src/storage/sqlite-store.js';
import { LogicEngine } from '../src/application/engine.js';
import { HostLifecycleJournal } from '../src/application/host-lifecycle-journal.js';
import { HostSessionRevocationReader } from '../src/application/host-assertion-nonce-store.js';
import {
  parseHostRootIdentityRegistry,
  resolveRegisteredHostRootIdentity,
} from '../src/application/host-root-inventory-identity.js';
import { verifySignedRootInventoryAttestation } from './extension-gateway/server-plugin/st-source-attestation.mjs';
import { verifyHostMutationReceiptSignature } from './extension-gateway/server-plugin/st-host-mutation-receipt-signature.mjs';
import { loadTrustedWorldPackCatalog } from '../src/application/world-pack-catalog.js';
import { createHostBoundNpcKnowledgeAuthorizers } from '../src/application/npc-knowledge-authorization.js';
import {
  createProcessScopedMechanicPolicyAuthority,
  defaultMechanicPolicyFieldPolicy,
} from '../src/application/mechanic-policy-authority.js';
import { createMemoryNpcProviderAdapter } from '../src/application/memory-npc-provider-adapter.js';
import { MemoryDispatchGateway } from '../src/security/memory-dispatch-gateway.js';
import { isCoordinatorLease } from '../src/storage/coordinator-lock.js';

function aliasesSameFile(left, right) {
  const identity = value => {
    const absolute = resolve(value);
    if (existsSync(absolute)) {
      try {
        const stat = statSync(absolute, { bigint: true });
        return 'inode:' + stat.dev + ':' + stat.ino;
      } catch {}
    }
    try { return 'path:' + realpathSync(absolute); } catch {}
    try { return 'path:' + resolve(dirname(absolute), basename(absolute)); } catch {}
    return 'path:' + absolute;
  };
  return identity(left) === identity(right);
}

function parseJsonEnv(name, fallback) {
  try { return JSON.parse(process.env[name] ?? fallback); }
  catch { throw new Error(name + '_INVALID_JSON'); }
}

/**
 * Compose the Host-native sender with a non-mutating Core/Provider observer.
 * This factory is intended to run inside the SillyTavern server process; it
 * never starts a second Core API and never constructs a writable Provider.
 */
export function createEmbeddedGatewayRuntime({ hostAdapter, adapterId = process.env.LOGIC_ENGINE_ADAPTER_ID } = {}) {
  if (!hostAdapter || typeof hostAdapter.authenticateGenerationRequest !== 'function'
    || typeof hostAdapter.isAuthenticatedHostRequest !== 'function'
    || typeof hostAdapter.resolveCoreConversationId !== 'function'
    || typeof hostAdapter.resolveHostIdentity !== 'function'
    || typeof adapterId !== 'string' || !adapterId.trim()) {
    throw new TypeError('Embedded Gateway requires the authenticated SillyTavern Host gate and pinned adapter ID.');
  }

  const adapterTokens = parseJsonEnv('ENGINE_ADAPTER_TOKENS', '{}');
  if (!adapterTokens || typeof adapterTokens !== 'object' || Array.isArray(adapterTokens)
    || typeof adapterTokens[adapterId] !== 'string' || adapterTokens[adapterId].length < 16) {
    throw new Error('EMBEDDED_GATEWAY_ADAPTER_NOT_CONFIGURED');
  }

  if (process.env.LOGIC_ENGINE_ADAPTER_TOKEN !== adapterTokens[adapterId]) {
    throw new Error('EMBEDDED_GATEWAY_HOST_ATTESTATION_KEY_MISMATCH');
  }

  const corePath = resolve(process.env.ENGINE_DB_PATH || './data/logic-engine.sqlite');
  const providerRaw = process.env.ENGINE_MEMORY_PROVIDER_DB_PATH;
  const providerPath = typeof providerRaw === 'string' && providerRaw.trim() ? resolve(providerRaw) : null;
  const coordinatorRaw = process.env.LOGIC_ENGINE_COORDINATOR_DB_PATH;
  if (!providerPath || typeof coordinatorRaw !== 'string' || !isAbsolute(coordinatorRaw)) {
    throw new Error('EMBEDDED_GATEWAY_DATABASE_PATHS_NOT_CONFIGURED');
  }
  const coordinatorPath = resolve(coordinatorRaw);
  const ledgerPath = resolve(process.env.ENGINE_MEMORY_DISPATCH_LEDGER_DB_PATH
    || './data/logic-engine-memory-dispatch.sqlite');
  const hostLifecyclePath = resolve(process.env.ENGINE_HOST_LIFECYCLE_DB_PATH
    || './data/logic-engine-host-lifecycle.sqlite');
  const assertionNonceRaw = process.env.ENGINE_HOST_ASSERTION_NONCE_DB_PATH;
  if (typeof assertionNonceRaw !== 'string' || !isAbsolute(assertionNonceRaw)) {
    throw new Error('EMBEDDED_GATEWAY_HOST_SESSION_REVOCATION_DB_REQUIRED');
  }
  const assertionNoncePath = resolve(assertionNonceRaw);

  for (const [leftName, left] of [
    ['Core', corePath], ['Provider', providerPath], ['Coordinator', coordinatorPath],
    ['Dispatch ledger', ledgerPath], ['Host lifecycle', hostLifecyclePath],
    ['Host assertion/revocation ledger', assertionNoncePath],
  ]) {
    for (const [rightName, right] of [
      ['Core', corePath], ['Provider', providerPath], ['Coordinator', coordinatorPath],
      ['Dispatch ledger', ledgerPath], ['Host lifecycle', hostLifecyclePath],
      ['Host assertion/revocation ledger', assertionNoncePath],
    ]) {
      if (leftName < rightName && aliasesSameFile(left, right)) {
        throw new Error('EMBEDDED_GATEWAY_DATABASE_ALIAS: ' + leftName + '/' + rightName);
      }
    }
  }

  const authorityPort = Number(process.env.LOGIC_ENGINE_ACCEPTED_HEAD_PORT);
  const readToken = process.env.LOGIC_ENGINE_ACCEPTED_HEAD_READ_TOKEN;
  if (!Number.isInteger(authorityPort) || authorityPort < 1 || authorityPort > 65535
    || typeof readToken !== 'string' || readToken.length < 32) {
    throw new Error('EMBEDDED_GATEWAY_ACCEPTED_HEAD_READ_AUTHORITY_REQUIRED');
  }

  const worldPackCatalogPath = process.env.LOGIC_ENGINE_WORLD_PACK_CATALOG_PATH;
  if (typeof worldPackCatalogPath !== 'string' || !worldPackCatalogPath.trim()) {
    throw new Error('EMBEDDED_GATEWAY_WORLD_PACK_CATALOG_REQUIRED');
  }
  const worldPackCatalog = loadTrustedWorldPackCatalog(resolve(worldPackCatalogPath));
  const trustedInitialKnowledgeSources = parseJsonEnv('ENGINE_TRUSTED_INITIAL_KNOWLEDGE_SOURCES', '[]');
  if (!Array.isArray(trustedInitialKnowledgeSources)) {
    throw new Error('EMBEDDED_GATEWAY_TRUSTED_SOURCE_REGISTRY_INVALID');
  }
  const contentFields = parseJsonEnv('ENGINE_MEMORY_NPC_CONTENT_FIELDS', '[]');
  if (!Array.isArray(contentFields) || contentFields.length === 0) {
    throw new Error('EMBEDDED_GATEWAY_CONTENT_FIELD_ALLOWLIST_REQUIRED');
  }

  const hostRootIdentityRegistry = parseHostRootIdentityRegistry(
    process.env.ENGINE_HOST_ROOT_IDENTITIES || '[]',
  );
  const hostAuthorityId = process.env.ENGINE_HOST_AUTHORITY_ID;
  const hostAuthorityGeneration = Number(process.env.ENGINE_HOST_AUTHORITY_GENERATION || '0');

  let store;
  let providerAdapter;
  let hostJournal;
  let hostSessionRevocationReader;
  let gateway;
  try {
    // This Core connection is read-only. It refuses an unaccepted head or an
    // incomplete migration and never runs schema DDL or startup reconciliation.
    store = new SQLiteStore(corePath, { readOnly: true });
    const npcKnowledgeAuthorizers = createHostBoundNpcKnowledgeAuthorizers({
      store,
      adapterIds: [adapterId],
      trustedInitialKnowledgeSources,
    });
    const engine = new LogicEngine(store, {
      trustedInitialKnowledgeSources,
      worldPackCatalog,
      npcKnowledgeReadAuthorizer: npcKnowledgeAuthorizers.readAuthorizer,
      npcKnowledgeVisibilityAuthorizer: npcKnowledgeAuthorizers.visibilityAuthorizer,
    });
    const mechanicPolicyAuthority = createProcessScopedMechanicPolicyAuthority({
      authorityId: process.env.ENGINE_MECHANIC_POLICY_AUTHORITY_ID || 'logic-engine.default-visibility-policy',
      generation: Number(process.env.ENGINE_MECHANIC_POLICY_GENERATION || '1'),
      fieldPolicy: defaultMechanicPolicyFieldPolicy,
    });

    providerAdapter = createMemoryNpcProviderAdapter({
      engine,
      providerPath,
      coordinatorPath,
      adapterId,
      trustedInitialKnowledgeSources,
      fieldPolicy: mechanicPolicyAuthority,
      contentFields,
      observerOnly: true,
      isAuthenticatedHostRequest: hostAdapter.isAuthenticatedHostRequest,
      resolveHostConversationId: hostAdapter.resolveCoreConversationId,
      resolveHostIdentity: hostAdapter.resolveHostIdentity,
    });
    if (!providerAdapter.npcGenerationContext) {
      throw new Error('EMBEDDED_GATEWAY_NPC_CONTEXT_RUNTIME_UNAVAILABLE');
    }

    // Host root inventory is read-only here. Its signed attestation must match
    // the deployment-owned root registry; session revocation is read from the
    // separate Core nonce ledger under the same Coordinator ordering boundary.
    hostSessionRevocationReader = new HostSessionRevocationReader({ path: assertionNoncePath });

    hostJournal = new HostLifecycleJournal({
      path: hostLifecyclePath,
      coordinatorPath,
      readOnly: true,
      resolveIdentity: () => ({ authorized: false }),
      resolveRootIdentity: input => resolveRegisteredHostRootIdentity(hostRootIdentityRegistry, input),
      verifyMutationReceipt: ({ event }) => verifyHostMutationReceiptSignature({
        adapterId,
        adapterToken: adapterTokens[adapterId],
        event,
      }),
      verifyRootInventoryAttestation: ({ attestation, identity }) => {
        const trusted = resolveRegisteredHostRootIdentity(hostRootIdentityRegistry, {
          host_installation_id: identity?.host_installation_id,
          authenticated_account_id: identity?.authenticated_account_id,
          root_id: identity?.root_id,
        });
        return trusted.authorized === true
          && trusted.adapter_id === adapterId
          && trusted.source_manifest_sha256 === attestation?.source_manifest_sha256
          && verifySignedRootInventoryAttestation({
            attestation,
            identity: { ...identity, adapter_id: adapterId },
            adapterToken: adapterTokens[adapterId],
          });
      },
    });

    gateway = new MemoryDispatchGateway({
      ledgerPath,
      coordinatorPath,
      authorityPort,
      readToken,
      readCoreEvidence: input => providerAdapter.consumer.readDispatchEvidenceSync(input),
      readProviderEvidence: input => providerAdapter.readDispatchEvidenceSync(input),
      readHostEvidence: ({ hostContext, coordinatorLease }) => {
        // Revocation and lifecycle evidence must be observed under the same
        // cross-process Coordinator lease as dispatch/release. Otherwise a
        // concurrent logout could commit between the revocation read and the
        // protected response write.
        if (!isCoordinatorLease(coordinatorLease, engine.store.coordinatorDb)) {
          return { status: 'NON_READY', reason: 'HOST_SESSION_REVOCATION_COORDINATOR_LEASE_REQUIRED' };
        }
        try {
          if (hostSessionRevocationReader.isSessionRevoked(adapterId, {
            host_installation_id: hostContext.host_installation_id,
            authenticated_account_id: hostContext.authenticated_account_id,
            host_session_id: hostContext.host_session_id,
          })) {
            return { status: 'NON_READY', reason: 'HOST_SESSION_REVOKED' };
          }
        } catch {
          return { status: 'NON_READY', reason: 'HOST_SESSION_REVOCATION_STATUS_UNAVAILABLE' };
        }
        if (typeof hostAuthorityId !== 'string' || !hostAuthorityId.trim()
          || !Number.isSafeInteger(hostAuthorityGeneration) || hostAuthorityGeneration < 1) {
          return { status: 'NON_READY', reason: 'HOST_LIFECYCLE_AUTHORITY_UNCONFIGURED' };
        }
        const hostEvidence = hostJournal.readAuthoritySnapshotUnderLease({
          authority_id: hostAuthorityId.trim(),
          generation: hostAuthorityGeneration,
          adapter_id: adapterId,
          host_installation_id: hostContext.host_installation_id,
          authenticated_account_id: hostContext.authenticated_account_id,
          root_id: hostContext.root_id,
        }, coordinatorLease);
        if (hostEvidence.status !== 'READY') return hostEvidence;
        return {
          ...hostEvidence,
          core_conversation_id: hostContext.core_conversation_id,
          world_id: hostContext.world_id,
          actor_id: hostContext.actor_id,
        };
      },
    });

    return Object.freeze({
      gateway,
      providerAdapter,
      engine,
      store,
      hostJournal,
      hostSessionRevocationReader,
      close() {
        try { gateway?.close?.(); } finally {
          try { hostJournal?.close?.(); } finally {
            try { hostSessionRevocationReader?.close?.(); } finally {
              try { providerAdapter?.close?.(); } finally { store?.close?.(); }
            }
          }
        }
      },
    });
  } catch (error) {
    try { gateway?.close?.(); } catch {}
    try { hostJournal?.close?.(); } catch {}
    try { hostSessionRevocationReader?.close?.(); } catch {}
    try { providerAdapter?.close?.(); } catch {}
    try { store?.close?.(); } catch {}
    throw error;
  }
}
