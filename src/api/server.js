import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { ProposalService } from '../application/proposals.js';
import { ActorBindingService } from '../application/actor-bindings.js';
import { AuthorizedReadService } from '../application/authorized-read-service.js';
import { isMechanicPolicyAuthority, defaultMechanicPolicyFieldPolicy } from '../application/mechanic-policy-authority.js';
import { HostConversationWorldBindingService } from '../application/host-conversation-world-bindings.js';

const MAX = 1048576;
const MAX_HOST_VERSION_SNAPSHOT_BYTES = 8 * 1048576;
const MAX_HOST_VERSION_SNAPSHOT_ENTRIES = 25000;
const MAX_HOST_ROOT_INVENTORY_BYTES = 8 * 1048576;
const MAX_HOST_ROOT_INVENTORY_ENTRIES = 25000;

/** Resolve the active deployment-owned policy on every boundary check. */
export function createActiveMechanicPolicyValidator(getActiveMechanicContextProvider, policyAuthority = null) {
  if (typeof getActiveMechanicContextProvider !== 'function') throw new TypeError('getActiveMechanicContextProvider must be a trusted application callback.');
  return (identity) => {
    if (!isMechanicPolicyAuthority(policyAuthority)) return false;
    let provider;
    try { provider = getActiveMechanicContextProvider(); } catch { return false; }
    try {
      if (provider?.getPolicyAuthority?.() !== policyAuthority) return false;
      return provider?.validateMechanicPolicy?.(identity) === true;
    } catch { return false; }
  };
}

// Hash both inputs to a fixed-length digest before timingSafeEqual so a
// mismatched secret length does not create a length-dependent comparison path.
function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
async function readBody(req, maxBytes = MAX) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new EngineError('BODY_TOO_LARGE', `Body exceeds ${Math.ceil(maxBytes / 1048576)} MiB.`, 413);
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new EngineError('INVALID_JSON', 'Invalid JSON body.'); }
}
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

export function createApiServer({ engine, token, internalToken = null, approvalToken = null, adminToken = null, adapterTokens = {}, authorizedReadFieldPolicy = null, mechanicPolicyAuthority = null, getActiveMechanicContextProvider = () => null, hostVersionLedger = null, hostRootInventoryJournal = null, resolveHostRootIdentity = null, hostLifecycleJournal = null, resolveHostLifecycleIdentity = null }) {
  if (!engine) throw new TypeError('engine required');
  if (typeof token !== 'string' || token.length < 16) throw new TypeError('API token must be at least 16 characters');
  if (internalToken !== null && (typeof internalToken !== 'string' || internalToken.length < 16 || internalToken === token)) {
    throw new TypeError('Internal token must be at least 16 characters and differ from API token');
  }
  if (approvalToken !== null && (typeof approvalToken !== 'string' || approvalToken.length < 16 || approvalToken === token || approvalToken === internalToken)) {
    throw new TypeError('Approval token must be at least 16 characters and differ from other tokens');
  }
  if (adminToken !== null && (typeof adminToken !== 'string' || adminToken.length < 16 || [token, internalToken, approvalToken].includes(adminToken))) {
    throw new TypeError('Admin token must be at least 16 characters and differ from other tokens');
  }
  if (authorizedReadFieldPolicy !== null && typeof authorizedReadFieldPolicy !== 'function') {
    throw new TypeError('Authorized-read field policy must be trusted application configuration.');
  }
  if (mechanicPolicyAuthority !== null && !isMechanicPolicyAuthority(mechanicPolicyAuthority)) {
    throw new TypeError('Mechanic policy authority must expose a trusted versioned authority contract.');
  }
  if (mechanicPolicyAuthority !== null && authorizedReadFieldPolicy !== null) {
    throw new TypeError('Provide mechanicPolicyAuthority or authorizedReadFieldPolicy, not both; the authority owns the field policy.');
  }
  if (typeof getActiveMechanicContextProvider !== 'function') throw new TypeError('getActiveMechanicContextProvider must be a trusted application callback.');
  if (hostRootInventoryJournal !== null && (!hostRootInventoryJournal
    || typeof hostRootInventoryJournal.enrollRootInventory !== 'function'
    || typeof hostRootInventoryJournal.observeRootInventory !== 'function')) {
    throw new TypeError('Host root inventory journal must expose baseline and observation operations.');
  }
  if (resolveHostRootIdentity !== null && typeof resolveHostRootIdentity !== 'function') {
    throw new TypeError('Host root identity resolver must be trusted application configuration.');
  }
  if (hostLifecycleJournal !== null && (!hostLifecycleJournal || typeof hostLifecycleJournal.append !== 'function'
    || typeof hostLifecycleJournal.getConversationStatus !== 'function')) {
    throw new TypeError('Host lifecycle journal must expose append and conversation status operations.');
  }
  if (resolveHostLifecycleIdentity !== null && typeof resolveHostLifecycleIdentity !== 'function') {
    throw new TypeError('Host lifecycle identity resolver must be trusted application configuration.');
  }
  if (hostLifecycleJournal !== null && resolveHostLifecycleIdentity === null) {
    throw new TypeError('Host lifecycle journal requires a trusted adapter identity resolver.');
  }
  if (hostRootInventoryJournal !== null && resolveHostRootIdentity === null) {
    throw new TypeError('Host root inventory requires a trusted adapter identity resolver.');
  }
  const configuredAdapterSecrets = Object.values(adapterTokens || {});
  if (!adapterTokens || typeof adapterTokens !== 'object' || Array.isArray(adapterTokens) || Object.entries(adapterTokens).some(([id, secret]) => !id.trim() || typeof secret !== 'string' || secret.length < 16 || [token, internalToken, approvalToken, adminToken].includes(secret)) || new Set(configuredAdapterSecrets).size !== configuredAdapterSecrets.length) {
    throw new TypeError('Adapter tokens must map non-empty adapter IDs to unique, distinct secrets of at least 16 characters');
  }
  const adapterIdFor = (req) => {
    const id = req.headers['x-adapter-id'];
    const secret = req.headers['x-adapter-token'];
    return typeof id === 'string' && Object.hasOwn(adapterTokens, id) && secretMatches(secret, adapterTokens[id]) ? id : null;
  };
  const proposals = new ProposalService(engine, {
    validateMechanicPolicy: createActiveMechanicPolicyValidator(getActiveMechanicContextProvider, mechanicPolicyAuthority),
  });
  const actorBindings = new ActorBindingService(engine);
  const hostConversationBindings = new HostConversationWorldBindingService(engine);
  // Until a canonical visibility schema exists, disclose only the bound actor's
  // own non-attribute identity fields. This intentionally denies all attributes.
  const defaultAuthorizedReadFieldPolicy = defaultMechanicPolicyFieldPolicy;
  // A host may opt into a broader, explicit policy. The policy is trusted
  // application configuration and is never accepted from an HTTP request.
  // Without one, preserve the narrow self-identity-only default.
  const authorizedReads = new AuthorizedReadService(engine, actorBindings,
    mechanicPolicyAuthority || authorizedReadFieldPolicy || defaultAuthorizedReadFieldPolicy);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'logic-engine', protocol_version: 'v1' });
      const authorization = req.headers.authorization;
      const bearerToken = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
      if (!secretMatches(bearerToken, token)) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'A valid bearer token is required.' } });

      // Least-privilege policy: global registry inventory/audit is administrative.
      // The general bearer remains a mandatory outer gateway credential, not a
      // substitute for admin capability. Do not introduce a new read-only token
      // class without an explicit capability contract.
      const globalRegistryRead = req.method === 'GET' && (
        url.pathname === '/v1/mechanics/audit' ||
        url.pathname === '/v1/mechanic-templates' ||
        /^\/v1\/mechanic-templates\/[^/]+\/[^/]+$/.test(url.pathname) ||
        url.pathname === '/v1/rule-modules' ||
        /^\/v1\/rule-modules\/[^/]+\/[^/]+$/.test(url.pathname)
      );
      if (globalRegistryRead && !secretMatches(req.headers['x-admin-token'], adminToken)) {
        return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'Global registry reads require a separate administrative credential.' } });
      }

      if (req.method === 'GET' && url.pathname === '/v1/mechanics/audit') return send(res, 200, { audit: engine.getMechanicRegistryAudit() });
      if (url.pathname === '/v1/mechanic-templates') {
        if (req.method === 'POST') {
          if (!secretMatches(req.headers['x-admin-token'], adminToken)) return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required.' } });
          return send(res, 201, { ...engine.registerMechanicTemplate(await readBody(req)) });
        }
        if (req.method === 'GET') return send(res, 200, { templates: engine.listMechanicTemplates() });
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported method for route.' } });
      }
      if (url.pathname === '/v1/rule-modules') {
        if (req.method === 'POST') {
          if (!secretMatches(req.headers['x-admin-token'], adminToken)) return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required.' } });
          return send(res, 201, { ...engine.registerRuleModuleManifest(await readBody(req)) });
        }
        if (req.method === 'GET') return send(res, 200, { modules: engine.listRuleModuleManifests() });
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported method for route.' } });
      }

      const registryParts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && registryParts[0] === 'v1' && registryParts[1] === 'mechanic-templates' && registryParts.length === 4) {
        return send(res, 200, engine.getMechanicTemplate(decodeURIComponent(registryParts[2]), decodeURIComponent(registryParts[3])));
      }
      if (req.method === 'GET' && registryParts[0] === 'v1' && registryParts[1] === 'rule-modules' && registryParts.length === 4) {
        return send(res, 200, engine.getRuleModuleManifest(decodeURIComponent(registryParts[2]), decodeURIComponent(registryParts[3])));
      }
      if (url.pathname === '/v1/host-lifecycle/events') {
        if (req.method !== 'POST') return send(res, 405, {
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported Host lifecycle journal operation.' },
        });
        if (!hostLifecycleJournal || !resolveHostLifecycleIdentity) {
          return send(res, 503, {
            error: { code: 'HOST_LIFECYCLE_JOURNAL_UNAVAILABLE', message: 'Host lifecycle journal is not configured.' },
          });
        }
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, {
          error: { code: 'ADAPTER_REQUIRED', message: 'An authenticated adapter identity is required.' },
        });
        const body = await readBody(req);
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const allowed = ['host_installation_id', 'authenticated_account_id', 'host_session_id', 'conversation_uuid',
          'event_id', 'event_type', 'mutation_id', 'operation', 'mutation_digest', 'receipt_digest', 'receipt_signature', 'occurred_at'];
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => !allowed.includes(key))
          || !UUID.test(body.host_installation_id ?? '')
          || !UUID.test(body.authenticated_account_id ?? '')
          || !UUID.test(body.host_session_id ?? '')
          || !UUID.test(body.conversation_uuid ?? '')
          || !UUID.test(body.event_id ?? '')
          || !['MUTATION_PREPARED', 'MUTATION_COMMITTED', 'MUTATION_ABORTED'].includes(body.event_type)
          || !UUID.test(body.mutation_id ?? '')
          || typeof body.operation !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(body.operation)
          || typeof body.mutation_digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.mutation_digest)
          || (body.event_type !== 'MUTATION_PREPARED' && !/^[a-f0-9]{64}$/.test(body.receipt_digest ?? ''))
          || (body.event_type === 'MUTATION_PREPARED' && body.receipt_digest !== undefined)
          || typeof body.occurred_at !== 'string' || !Number.isFinite(Date.parse(body.occurred_at))) {
          throw new EngineError('INVALID_HOST_LIFECYCLE_EVENT', 'A bounded, digest-only Host mutation lifecycle event is required.', 400);
        }
        let trustedIdentity;
        try {
          trustedIdentity = await resolveHostLifecycleIdentity({
            adapterId,
            host_installation_id: body.host_installation_id,
            authenticated_account_id: body.authenticated_account_id,
            host_session_id: body.host_session_id,
            conversation_uuid: body.conversation_uuid,
          });
        } catch {
          return send(res, 403, { error: { code: 'HOST_LIFECYCLE_NOT_AUTHORIZED', message: 'Host lifecycle identity is not authorized.' } });
        }
        if (!trustedIdentity || trustedIdentity.authorized !== true
          || trustedIdentity.host_installation_id !== body.host_installation_id
          || trustedIdentity.authenticated_account_id !== body.authenticated_account_id
          || trustedIdentity.host_session_id !== body.host_session_id
          || trustedIdentity.conversation_uuid !== body.conversation_uuid
          || typeof trustedIdentity.authority_id !== 'string'
          || !Number.isSafeInteger(trustedIdentity.generation) || trustedIdentity.generation < 1
          || !/^[a-f0-9]{64}$/.test(trustedIdentity.snapshot_fingerprint ?? '')) {
          return send(res, 403, { error: { code: 'HOST_LIFECYCLE_NOT_AUTHORIZED', message: 'Host lifecycle identity is not authorized.' } });
        }
        try {
          const result = hostLifecycleJournal.append({
            ...body,
            authority_id: trustedIdentity.authority_id,
            generation: trustedIdentity.generation,
            snapshot_fingerprint: trustedIdentity.snapshot_fingerprint,
          });
          return send(res, result.status === 'duplicate' ? 200 : 201, { lifecycle: result });
        } catch (error) {
          if (['HOST_LIFECYCLE_EVENT_ID_CONFLICT', 'HOST_LIFECYCLE_MUTATION_ALREADY_PENDING',
            'HOST_LIFECYCLE_MUTATION_PREPARE_MISSING', 'HOST_LIFECYCLE_MUTATION_TERMINAL_CONFLICT',
            'HOST_LIFECYCLE_INTENT_DIGEST_MISMATCH', 'HOST_LIFECYCLE_AUTHORITY_STALE',
            'HOST_LIFECYCLE_RECEIPT_MISMATCH', 'HOST_LIFECYCLE_STATE_MACHINE_CORRUPT'].includes(error?.message)) {
            throw new EngineError(error.message, 'Host lifecycle event conflicts with the durable journal state.', 409);
          }
          if (error instanceof TypeError) {
            throw new EngineError('INVALID_HOST_LIFECYCLE_EVENT', 'Host lifecycle event is malformed or unsafe.', 400);
          }
          throw error;
        }
      }
      if (url.pathname === '/v1/host-lifecycle/status') {
        if (req.method !== 'GET') return send(res, 405, {
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported Host lifecycle status operation.' },
        });
        if (!hostLifecycleJournal || !resolveHostLifecycleIdentity) {
          return send(res, 503, {
            error: { code: 'HOST_LIFECYCLE_JOURNAL_UNAVAILABLE', message: 'Host lifecycle journal is not configured.' },
          });
        }
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, {
          error: { code: 'ADAPTER_REQUIRED', message: 'An authenticated adapter identity is required.' },
        });
        const identity = {
          host_installation_id: url.searchParams.get('host_installation_id'),
          authenticated_account_id: url.searchParams.get('authenticated_account_id'),
          host_session_id: url.searchParams.get('host_session_id'),
          conversation_uuid: url.searchParams.get('conversation_uuid'),
        };
        let trustedIdentity;
        try { trustedIdentity = await resolveHostLifecycleIdentity({ adapterId, ...identity }); } catch {}
        if (!trustedIdentity || trustedIdentity.authorized !== true
          || trustedIdentity.host_installation_id !== identity.host_installation_id
          || trustedIdentity.authenticated_account_id !== identity.authenticated_account_id
          || trustedIdentity.host_session_id !== identity.host_session_id
          || trustedIdentity.conversation_uuid !== identity.conversation_uuid
          || typeof trustedIdentity.authority_id !== 'string'
          || !Number.isSafeInteger(trustedIdentity.generation) || trustedIdentity.generation < 1
          || !/^[a-f0-9]{64}$/.test(trustedIdentity.snapshot_fingerprint ?? '')) {
          return send(res, 403, { error: { code: 'HOST_LIFECYCLE_NOT_AUTHORIZED', message: 'Host lifecycle identity is not authorized.' } });
        }
        try {
          return send(res, 200, { lifecycle: hostLifecycleJournal.getConversationStatus(
            identity.host_installation_id, identity.authenticated_account_id, identity.host_session_id,
            identity.conversation_uuid, trustedIdentity,
          ) });
        } catch (error) {
          if (error instanceof TypeError) throw new EngineError('INVALID_HOST_LIFECYCLE_IDENTITY', 'Host lifecycle identity is malformed.', 400);
          throw error;
        }
      }
      if (url.pathname === '/v1/host-root-inventory/baseline'
        || url.pathname === '/v1/host-root-inventory/observe') {
        if (req.method !== 'POST') return send(res, 405, {
          error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported Host root-inventory operation.' },
        });
        if (!hostRootInventoryJournal || !resolveHostRootIdentity) {
          return send(res, 503, {
            error: { code: 'HOST_ROOT_INVENTORY_UNAVAILABLE', message: 'Host root inventory journal is not configured.' },
          });
        }
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, {
          error: { code: 'ADAPTER_REQUIRED', message: 'An authenticated adapter identity is required.' },
        });
        const body = await readBody(req, MAX_HOST_ROOT_INVENTORY_BYTES);
        const validIdentity = value => typeof value === 'string' && value === value.trim()
          && value.length > 0 && value.length <= 200
          && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => ![
            'host_installation_id', 'authenticated_account_id', 'root_id', 'event_id', 'entries',
          ].includes(key))
          || !validIdentity(body.host_installation_id)
          || !validIdentity(body.authenticated_account_id)
          || !/^[a-f0-9]{64}$/.test(body.root_id ?? '')
          || !validIdentity(body.event_id)
          || !Array.isArray(body.entries)) {
          throw new EngineError('INVALID_HOST_ROOT_INVENTORY', 'Root inventory requires authenticated installation/account identity, root digest, event ID and a digest-only file manifest.', 400);
        }
        if (body.entries.length > MAX_HOST_ROOT_INVENTORY_ENTRIES) {
          throw new EngineError('HOST_ROOT_INVENTORY_TOO_LARGE', 'Root inventory exceeds the 25,000-file limit.', 413);
        }

        // Adapter authentication is necessary but not sufficient: this trusted
        // resolver binds the submitted Host installation/account/root tuple to
        // the authenticated adapter. The journal independently revalidates it.
        let trustedIdentity;
        try {
          trustedIdentity = await resolveHostRootIdentity({
            adapterId,
            host_installation_id: body.host_installation_id,
            authenticated_account_id: body.authenticated_account_id,
            root_id: body.root_id,
          });
        } catch {
          return send(res, 403, { error: { code: 'HOST_ROOT_INVENTORY_NOT_AUTHORIZED', message: 'Host root inventory identity is not authorized.' } });
        }
        if (!trustedIdentity || trustedIdentity.authorized !== true
          || trustedIdentity.host_installation_id !== body.host_installation_id
          || trustedIdentity.authenticated_account_id !== body.authenticated_account_id
          || trustedIdentity.root_id !== body.root_id) {
          return send(res, 403, { error: { code: 'HOST_ROOT_INVENTORY_NOT_AUTHORIZED', message: 'Host root inventory identity is not authorized.' } });
        }

        const input = {
          host_installation_id: trustedIdentity.host_installation_id,
          authenticated_account_id: trustedIdentity.authenticated_account_id,
          root_id: trustedIdentity.root_id,
          event_id: body.event_id,
          entries: body.entries,
        };
        let result;
        try {
          result = url.pathname.endsWith('/baseline')
            ? hostRootInventoryJournal.enrollRootInventory(input)
            : hostRootInventoryJournal.observeRootInventory(input);
        } catch (error) {
          if (error?.message === 'HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT') {
            throw new EngineError('HOST_ROOT_INVENTORY_EVENT_ID_CONFLICT', 'Root inventory event ID was reused with different content.', 409);
          }
          if (error?.message === 'HOST_ROOT_INVENTORY_ALREADY_ENROLLED'
            || error?.message === 'HOST_ROOT_INVENTORY_BASELINE_MISSING') {
            throw new EngineError(error.message, 'Root inventory baseline state does not permit this operation.', 409);
          }
          if (error?.message === 'HOST_ROOT_INVENTORY_BYTE_LIMIT'
            || error?.message === 'HOST_ROOT_INVENTORY_ENTRY_LIMIT') {
            throw new EngineError(error.message, 'Root inventory exceeds its bounded storage limits.', 413);
          }
          if (error instanceof TypeError) {
            throw new EngineError('INVALID_HOST_ROOT_INVENTORY_MANIFEST', 'Root inventory manifest is malformed or unsafe.', 400);
          }
          throw error;
        }
        const integrity = hostRootInventoryJournal.verifyRootInventory(input);
        if (integrity?.status !== 'INTEGRITY_OK') {
          return send(res, 409, {
            inventory_status: 'NON_READY',
            reconciliation: {
              status: 'NON_READY',
              integrity_status: integrity?.status ?? 'NON_READY',
              reason: integrity?.reason ?? 'HOST_ROOT_INVENTORY_INTEGRITY_UNVERIFIED',
            },
          });
        }
        const counts = result.delta
          ? Object.fromEntries(Object.entries(result.delta).map(([key, rows]) => [key, rows.length]))
          : undefined;
        const reviewOnly = result.status === 'BASELINED_REVIEW_ONLY'
          || result.status === 'UNCHANGED_REVIEW_ONLY' || result.status === 'duplicate';
        const response = {
          inventory_status: reviewOnly ? 'REVIEW_ONLY' : 'NON_READY',
          reconciliation: {
            status: result.status,
            integrity_status: integrity.status,
            ...(result.sequence !== undefined ? { sequence: result.sequence } : {}),
            ...(result.manifest_sha256 ? { manifest_sha256: result.manifest_sha256 } : {}),
            ...(result.delta_sha256 ? { delta_sha256: result.delta_sha256 } : {}),
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.duplicate ? { duplicate: true } : {}),
            ...(counts ? { counts } : {}),
          },
        };
        return send(res, reviewOnly ? 200 : 409, response);
      }
      if (url.pathname === '/v1/host-version-ledger/capture') {
        if (req.method !== 'POST') return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported Host version-ledger operation.' } });
        if (!hostVersionLedger || typeof hostVersionLedger.captureVersion !== 'function') {
          return send(res, 503, { error: { code: 'HOST_VERSION_LEDGER_UNAVAILABLE', message: 'Host version ledger is not configured.' } });
        }
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'An authenticated adapter identity is required.' } });
        const body = await readBody(req);
        const allowed = ['conversation_id', 'message_id', 'version_id', 'parent_version_id', 'content_sha256', 'active', 'deleted'];
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => !allowed.includes(key))
          || !['conversation_id', 'message_id', 'version_id'].every((key) => typeof body[key] === 'string'
            && body[key] === body[key].trim() && body[key].length > 0 && body[key].length <= 200
            && ![...body[key]].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
          || !Object.hasOwn(body, 'parent_version_id') || !(body.parent_version_id === null || (typeof body.parent_version_id === 'string' && body.parent_version_id === body.parent_version_id.trim() && body.parent_version_id.length > 0 && body.parent_version_id.length <= 200))
          || typeof body.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.content_sha256)
          || typeof body.active !== 'boolean' || typeof body.deleted !== 'boolean'
          || (body.deleted && body.active)) {
          throw new EngineError('INVALID_HOST_VERSION_CAPTURE',
            'Capture requires explicit parent_version_id (null only for a declared root); raw content and world_id are forbidden.', 400);
        }
        const result = hostVersionLedger.captureBoundVersion({
          adapterId,
          conversationId: body.conversation_id,
          message_id: body.message_id,
          version_id: body.version_id,
          parent_version_id: body.parent_version_id,
          content_sha256: body.content_sha256,
          active: body.active,
          deleted: body.deleted,
          resolveBinding: ({ adapterId: authenticatedAdapterId, conversationId }) =>
            hostConversationBindings.resolve({ adapterId: authenticatedAdapterId, conversationId }),
        });
        if (result.status === 'conflict' || result.status === 'non_ready') {
          return send(res, 409, { capture: result, inventory_status: 'NON_READY' });
        }
        return send(res, result.status === 'captured' ? 201 : 200, { capture: result });
      }
      if (url.pathname === '/v1/host-version-ledger/reconcile') {
        if (req.method !== 'POST') return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported Host inventory reconciliation operation.' } });
        if (!hostVersionLedger || typeof hostVersionLedger.reconcileConversation !== 'function') {
          return send(res, 503, { error: { code: 'HOST_VERSION_LEDGER_UNAVAILABLE', message: 'Host version ledger is not configured.' } });
        }
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'An authenticated adapter identity is required.' } });
        const body = await readBody(req, MAX_HOST_VERSION_SNAPSHOT_BYTES);
        if (body && typeof body === 'object' && Array.isArray(body.versions)
          && body.versions.length > MAX_HOST_VERSION_SNAPSHOT_ENTRIES) {
          throw new EngineError('HOST_INVENTORY_TOO_LARGE', 'Host inventory exceeds the 25,000-version limit.', 413);
        }
        const validHostId = (value) => typeof value === 'string' && value === value.trim()
          && value.length > 0 && value.length <= 200
          && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
        const versionKeys = new Set([
          'message_id', 'version_id', 'parent_version_id', 'content_sha256', 'active', 'deleted',
        ]);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => !['conversation_id', 'complete', 'versions'].includes(key))
          || !validHostId(body.conversation_id)
          || typeof body.complete !== 'boolean'
          || !Array.isArray(body.versions)
          || body.versions.some((version) => !version || typeof version !== 'object' || Array.isArray(version)
            || Object.keys(version).some((key) => !versionKeys.has(key))
            || !validHostId(version.message_id)
            || !validHostId(version.version_id)
            || !Object.hasOwn(version, 'parent_version_id')
            || !(version.parent_version_id === null || validHostId(version.parent_version_id))
            || typeof version.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(version.content_sha256)
            || typeof version.active !== 'boolean' || typeof version.deleted !== 'boolean'
            || (version.deleted && version.active))) {
          throw new EngineError('INVALID_HOST_INVENTORY_RECONCILIATION',
            'Reconciliation accepts only conversation_id, complete and digest-only versions with explicit parent_version_id; world_id and raw content are forbidden.', 400);
        }

        // Core derives world scope from the authenticated adapter binding.
        // The same binding is re-resolved synchronously inside the ledger's
        // final Coordinator lease before READY can be published.
        const binding = hostConversationBindings.resolve({
          adapterId,
          conversationId: body.conversation_id,
        });
        const snapshot = {
          world_id: binding.world_id,
          conversation_id: binding.conversation_id,
          complete: body.complete,
          versions: body.versions.map((version) => ({
            world_id: binding.world_id,
            conversation_id: binding.conversation_id,
            message_id: version.message_id,
            version_id: version.version_id,
            parent_version_id: version.parent_version_id,
            content_sha256: version.content_sha256,
            active: version.active,
            deleted: version.deleted,
          })),
        };
        const reconciliation = await hostVersionLedger.reconcileConversation(snapshot, {
          revalidateBinding: () => hostConversationBindings.resolve({
            adapterId,
            conversationId: body.conversation_id,
          }),
        });
        if (reconciliation.status !== 'ready') {
          return send(res, 409, { reconciliation, inventory_status: 'NON_READY' });
        }
        return send(res, 200, { reconciliation, inventory_status: 'READY' });
      }
      if (url.pathname === '/v1/host-conversation-bindings') {
        if (req.method !== 'POST') return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported Host conversation binding operation.' } });
        if (!secretMatches(req.headers['x-admin-token'], adminToken)) {
          return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'Host conversation binding requires a separate administrative credential.' } });
        }
        const body = await readBody(req);
        const allowed = ['adapter_id', 'conversation_id', 'world_id', 'rebind', 'reason'];
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => !allowed.includes(key))
          || !['adapter_id', 'conversation_id', 'world_id'].every((key) => typeof body[key] === 'string')) {
          throw new EngineError('INVALID_HOST_CONVERSATION_BINDING',
            'Binding accepts adapter_id, conversation_id, world_id, and optional explicit rebind/reason.', 400);
        }
        // A binding must not become effective for an adapter principal that
        // Core does not currently authenticate. Otherwise adding that adapter
        // configuration later could silently activate a dormant binding.
        if (!Object.hasOwn(adapterTokens, body.adapter_id)) {
          throw new EngineError('HOST_BINDING_ADAPTER_NOT_CONFIGURED',
            'A Host conversation can be bound only to a configured adapter identity.', 400);
        }
        const binding = hostConversationBindings.bind({
          adapterId: body.adapter_id, conversationId: body.conversation_id, worldId: body.world_id,
          rebind: body.rebind ?? false, reason: body.reason ?? null,
        });
        return send(res, binding.already_bound ? 200 : 201, { binding });
      }
      if (url.pathname === '/v1/host-conversation-bindings/resolve') {
        if (req.method !== 'POST') return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported Host conversation resolution operation.' } });
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'An authenticated adapter identity is required.' } });
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => key !== 'conversation_id')
          || typeof body.conversation_id !== 'string') {
          throw new EngineError('INVALID_HOST_CONVERSATION_RESOLUTION',
            'Resolution accepts only conversation_id; world_id and adapter_id are derived by Core.', 400);
        }
        return send(res, 200, { binding: hostConversationBindings.resolve({
          adapterId, conversationId: body.conversation_id,
        }) });
      }
      const hostBindingParts = url.pathname.split('/').filter(Boolean);
      if (hostBindingParts[0] === 'v1' && hostBindingParts[1] === 'host-conversation-bindings'
        && hostBindingParts.length === 4 && req.method === 'DELETE') {
        if (!secretMatches(req.headers['x-admin-token'], adminToken)) {
          return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'Host conversation revocation requires a separate administrative credential.' } });
        }
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => key !== 'reason') || typeof body.reason !== 'string') {
          throw new EngineError('INVALID_HOST_CONVERSATION_BINDING',
            'Revocation accepts an audit reason.', 400);
        }
        const revokedBinding = hostConversationBindings.revoke({
          adapterId: decodeURIComponent(hostBindingParts[2]),
          conversationId: decodeURIComponent(hostBindingParts[3]), reason: body.reason,
        });
        // The binding is the authority; invalidate any previously READY digest
        // inventory before acknowledging revocation. Consumers must still
        // re-resolve the binding at their own disclosure/dispatch boundary.
        if (hostVersionLedger && typeof hostVersionLedger.invalidateConversation === 'function') {
          hostVersionLedger.invalidateConversation(revokedBinding.world_id, revokedBinding.conversation_id);
        }
        return send(res, 200, { binding: revokedBinding });
      }

      if (req.method === 'POST' && url.pathname === '/v1/worlds') {
        if (!secretMatches(req.headers['x-admin-token'], adminToken)) {
          return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'World creation requires a separate administrative credential.' } });
        }
        return send(res, 201, { world: engine.createWorld(await readBody(req)) });
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 3 || parts[0] !== 'v1' || parts[1] !== 'worlds') return send(res, 404, { error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' } });
      const worldId = decodeURIComponent(parts[2]);
      const action = parts[3] || 'state';

      if (action === 'processes') {
        if (!secretMatches(req.headers['x-engine-internal-token'], internalToken)) {
          return send(res, 403, { error: { code: 'INTERNAL_REQUIRED', message: 'Process lifecycle management requires the separately configured internal credential.' } });
        }
        if (parts.length === 4 && req.method === 'GET') {
          return send(res, 200, { processes: engine.listProcesses(worldId) });
        }
        if (parts.length === 4 && req.method === 'POST') {
          const result = engine.createProcess(worldId, await readBody(req));
          return send(res, result.idempotent_replay ? 200 : 201, result);
        }
        if (parts.length === 5 && req.method === 'GET') {
          return send(res, 200, { process: engine.getProcess(worldId, decodeURIComponent(parts[4])) });
        }
        if (parts.length === 6 && ['pause', 'resume', 'cancel'].includes(parts[5]) && req.method === 'POST') {
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).some((key) => !['expected_version', 'idempotency_key', 'reason'].includes(key))) {
            throw new EngineError('INVALID_PROCESS_TRANSITION', 'Process transition accepts expected_version, idempotency_key and optional reason.', 400);
          }
          const result = engine.transitionProcess(worldId, decodeURIComponent(parts[4]), { ...body, action: parts[5] });
          return send(res, result.process.status === 'needs_review' ? 409 : 200, result);
        }
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported process operation.' } });
      }

      if (action === 'time-triggers') {
        if (!secretMatches(req.headers['x-engine-internal-token'], internalToken)) {
          return send(res, 403, { error: { code: 'INTERNAL_REQUIRED', message: 'Time-trigger management requires the separately configured internal credential.' } });
        }
        if (parts.length === 4 && req.method === 'GET') {
          return send(res, 200, { triggers: engine.listTimeTriggers(worldId) });
        }
        if (parts.length === 4 && req.method === 'POST') {
          const trigger = engine.registerTimeTrigger(worldId, await readBody(req));
          return send(res, trigger.idempotent_replay ? 200 : 201, { trigger });
        }
        if (parts.length === 5 && req.method === 'GET') {
          return send(res, 200, { trigger: engine.getTimeTrigger(worldId, decodeURIComponent(parts[4])) });
        }
        if (parts.length === 6 && parts[5] === 'cancel' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).some((key) => key !== 'reason')) {
            throw new EngineError('INVALID_TIME_TRIGGER_CANCELLATION', 'Cancellation accepts only an optional reason.', 400);
          }
          const trigger = engine.cancelTimeTrigger(worldId, decodeURIComponent(parts[4]), body.reason ?? 'author_cancelled');
          return send(res, 200, { trigger });
        }
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported time-trigger operation.' } });
      }

      if (action === 'time-actions') {
        if (!secretMatches(req.headers['x-engine-internal-token'], internalToken)) {
          return send(res, 403, { error: { code: 'INTERNAL_REQUIRED', message: 'Timed actions require the separately configured internal credential.' } });
        }
        if (parts.length === 4 && req.method === 'POST') {
          const operation = engine.startTimedAction(worldId, await readBody(req));
          return send(res, ['needs_review', 'blocked'].includes(operation.status) ? 409 : 200, { operation });
        }
        if (parts.length === 5 && req.method === 'GET') {
          return send(res, 200, { operation: engine.getTimeAdvanceOperation(worldId, decodeURIComponent(parts[4])) });
        }
        if (parts.length === 6 && parts[5] === 'resume' && req.method === 'POST') {
          const operation = engine.resumeTimeAdvance(worldId, decodeURIComponent(parts[4]));
          return send(res, ['needs_review', 'blocked'].includes(operation.status) ? 409 : 200, { operation });
        }
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported timed-action operation.' } });
      }

      if (action === 'time-advances') {
        if (!secretMatches(req.headers['x-engine-internal-token'], internalToken)) {
          return send(res, 403, { error: { code: 'INTERNAL_REQUIRED', message: 'Time advancement requires the separately configured internal credential.' } });
        }
        if (parts.length === 4 && req.method === 'POST') {
          const operation = engine.startTimeAdvance(worldId, await readBody(req));
          return send(res, ['needs_review', 'blocked'].includes(operation.status) ? 409 : 200, { operation });
        }
        if (parts.length === 5 && req.method === 'GET') {
          return send(res, 200, { operation: engine.getTimeAdvanceOperation(worldId, decodeURIComponent(parts[4])) });
        }
        if (parts.length === 6 && parts[5] === 'resume' && req.method === 'POST') {
          const operation = engine.resumeTimeAdvance(worldId, decodeURIComponent(parts[4]));
          return send(res, ['needs_review', 'blocked'].includes(operation.status) ? 409 : 200, { operation });
        }
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported time-advance operation.' } });
      }

      if (action === 'time-configurations') {
        if (parts.length === 4 && req.method === 'POST') {
          if (!secretMatches(req.headers['x-admin-token'], adminToken)) return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required to author time configuration.' } });
          return send(res, 200, { configuration: engine.registerTimeConfiguration(worldId, await readBody(req)) });
        }
        if (parts.length === 5 && parts[4] === 'current' && req.method === 'GET') {
          const trusted = secretMatches(req.headers['x-admin-token'], adminToken)
            || secretMatches(req.headers['x-engine-internal-token'], internalToken);
          if (!trusted) return send(res, 403, { error: { code: 'AUTHORIZED_READ_REQUIRED', message: 'Time configuration reads require a trusted credential.' } });
          return send(res, 200, { configuration: engine.getTimeConfiguration(worldId, url.searchParams.get('version')) });
        }
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported time-configuration operation.' } });
      }

      if (parts.length === 4 && action === 'time' && req.method === 'GET') {
        const trusted = secretMatches(req.headers['x-admin-token'], adminToken)
          || secretMatches(req.headers['x-engine-internal-token'], internalToken);
        if (!trusted) return send(res, 403, { error: { code: 'AUTHORIZED_READ_REQUIRED', message: 'Calendar projections require a trusted credential.' } });
        const rawCoordinate = url.searchParams.get('coordinate');
        const coordinate = rawCoordinate === null ? null : Number(rawCoordinate);
        if (rawCoordinate !== null && !Number.isSafeInteger(coordinate)) throw new EngineError('INVALID_TIME_COORDINATE', 'coordinate query must be a safe integer.');
        return send(res, 200, { time: engine.projectTime(worldId, coordinate) });
      }

      if (parts.length === 4 && action === 'authorized-read' && req.method === 'POST') {
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'A configured adapter identity is required for authorized reads.' } });
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((key) => !['actor_entity_id', 'purpose', 'fields', 'entity_ids'].includes(key))) {
          throw new EngineError('INVALID_AUTHORIZED_READ', 'Authorized read accepts only actor_entity_id, purpose, fields and optional entity_ids.');
        }
        const result = authorizedReads.readEntityFields({
          worldId,
          adapterId,
          actorEntityId: body.actor_entity_id,
          recipient: 'model',
          purpose: body.purpose,
          entityIds: body.entity_ids === undefined ? [body.actor_entity_id] : body.entity_ids,
          fields: body.fields,
        });
        return send(res, 200, { read: result });
      }

      if (req.method === 'GET' && ['state', 'events', 'audit'].includes(action)) {
        const trustedRead = secretMatches(req.headers['x-admin-token'], adminToken)
          || secretMatches(req.headers['x-engine-internal-token'], internalToken);
        if (!trustedRead) return send(res, 403, { error: { code: 'AUTHORIZED_READ_REQUIRED', message: 'Raw canonical reads require a separate trusted internal or administrative credential.' } });
      }

      if (action === 'actor-bindings') {
        if (parts.length === 4 && req.method === 'POST') {
          if (!secretMatches(req.headers['x-admin-token'], adminToken)) return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required.' } });
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['adapter_id', 'entity_id'].includes(key))) {
            throw new EngineError('INVALID_ACTOR_BINDING', 'Binding accepts only adapter_id and entity_id.');
          }
          return send(res, 201, { binding: actorBindings.bind(worldId, body.adapter_id, body.entity_id) });
        }
        if (parts.length === 6 && req.method === 'DELETE') {
          if (!secretMatches(req.headers['x-admin-token'], adminToken)) return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required.' } });
          return send(res, 200, { binding: actorBindings.revoke(worldId, decodeURIComponent(parts[4]), decodeURIComponent(parts[5])) });
        }
        if (parts.length === 5 && parts[4] === 'resolve' && req.method === 'POST') {
          const adapterId = adapterIdFor(req);
          if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'A configured adapter identity is required to resolve an actor.' } });
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'entity_id')) {
            throw new EngineError('INVALID_ACTOR_RESOLUTION', 'Actor resolution accepts only entity_id.');
          }
          return send(res, 200, { resolution: actorBindings.resolve(worldId, adapterId, body.entity_id) });
        }
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported actor-binding operation.' } });
      }


      if (parts.length === 4 && action === 'mechanic-instances') {
        if (!secretMatches(req.headers['x-admin-token'], adminToken)) return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required.' } });
        if (req.method === 'GET') return send(res, 200, { instances: engine.listMechanicInstances(worldId) });
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('INVALID_MECHANIC_INSTANCE_REQUEST', 'Request body must be a JSON object.');
          const allowed = ['instance_id', 'template_id', 'template_version', 'parameters', 'state', 'expected_revision', 'idempotency_key'];
          if (Object.keys(body).some((key) => !allowed.includes(key))) throw new EngineError('UNSUPPORTED_MECHANIC_INSTANCE_FIELD', 'Create accepts only instance/template identity, parameters, state, expected_revision and idempotency_key.');
          for (const key of ['instance_id', 'template_id', 'template_version', 'idempotency_key']) if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 200) throw new EngineError('INVALID_MECHANIC_INSTANCE_REQUEST', key + ' must be a non-empty string of at most 200 characters.');
          if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw new EngineError('INVALID_REVISION', 'expected_revision must be a non-negative integer.');
          for (const key of ['parameters', 'state']) if (body[key] !== undefined && (!body[key] || typeof body[key] !== 'object' || Array.isArray(body[key]))) throw new EngineError('INVALID_MECHANIC_INSTANCE_REQUEST', key + ' must be a JSON object.');
          const operationKey = body.idempotency_key.trim();
          const storageKey = 'mechanic-instance:' + hashRequest({ idempotency_key: operationKey });
          const turnId = 'mechanic-instance:' + hashRequest({ idempotency_key: operationKey }).slice(0, 32);
          const stableRequest = { operation: 'mechanic.instance.create', world_id: worldId, instance_id: body.instance_id, template_id: body.template_id, template_version: body.template_version, parameters: body.parameters || {}, state: body.state || {}, expected_revision: body.expected_revision, idempotency_key: operationKey };
          const prepared = engine.prepareEvent({ idempotency_key: storageKey, turn_id: turnId, event_type: 'mechanic.instance.create', expected_revision: body.expected_revision, effects: [{ kind: 'mechanic.instance.create', instance_id: body.instance_id, template_id: body.template_id, template_version: body.template_version, parameters: body.parameters || {}, state: body.state || {} }] });
          prepared.request_hash = hashRequest(stableRequest);
          const commit_result = engine.store.commit(worldId, prepared);
          let currentInstance;
          try {
            currentInstance = engine.getMechanicInstance(worldId, body.instance_id);
          } catch (error) {
            if (!commit_result.idempotent_replay || error.code !== 'MECHANIC_INSTANCE_NOT_FOUND') throw error;
            currentInstance = null;
          }
          return send(res, commit_result.idempotent_replay ? 200 : 201, {
            commit_result, instance: currentInstance,
            ...(currentInstance ? {} : { instance_current: false }),
          });
        }
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported method for route.' } });
      }
      if (parts.length === 6 && action === 'mechanic-instances' && (parts[5] === 'enable' || parts[5] === 'disable') && req.method === 'POST') {
        if (!secretMatches(req.headers['x-admin-token'], adminToken)) return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required.' } });
        const instanceId = decodeURIComponent(parts[4]);
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EngineError('INVALID_MECHANIC_INSTANCE_REQUEST', 'Request body must be a JSON object.');
        if (Object.keys(body).some((key) => !['expected_revision', 'idempotency_key'].includes(key))) throw new EngineError('UNSUPPORTED_MECHANIC_INSTANCE_FIELD', 'Lifecycle transition accepts only expected_revision and idempotency_key.');
        if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw new EngineError('INVALID_REVISION', 'expected_revision must be a non-negative integer.');
        if (typeof body.idempotency_key !== 'string' || !body.idempotency_key.trim() || body.idempotency_key.length > 200) throw new EngineError('IDEMPOTENCY_KEY_REQUIRED', 'idempotency_key must be a non-empty string of at most 200 characters.');
        const operation = parts[5];
        const operationKey = body.idempotency_key.trim();
        const storageKey = 'mechanic-instance:' + hashRequest({ idempotency_key: operationKey });
        const turnId = 'mechanic-instance:' + hashRequest({ idempotency_key: operationKey }).slice(0, 32);
        const stableRequest = { operation: 'mechanic.instance.' + operation, world_id: worldId, instance_id: instanceId, expected_revision: body.expected_revision, idempotency_key: operationKey };
        let instanceBefore;
        try {
          instanceBefore = engine.getMechanicInstance(worldId, instanceId);
        } catch (error) {
          if (error.code !== 'MECHANIC_INSTANCE_NOT_FOUND') throw error;
          // A previously committed lifecycle request must remain replayable even
          // if a later rollback removed its instance from the current projection.
          instanceBefore = null;
        }
        const effectKind = 'mechanic.instance.' + operation;
        const prepared = engine.prepareEvent({ idempotency_key: storageKey, turn_id: turnId, event_type: effectKind, expected_revision: body.expected_revision, caused_by: instanceBefore ? [instanceBefore.last_event_id] : [], effects: [{ kind: effectKind, instance_id: instanceId }] });
        prepared.request_hash = hashRequest(stableRequest);
        const commit_result = engine.store.commit(worldId, prepared);
        let currentInstance;
        try {
          currentInstance = engine.getMechanicInstance(worldId, instanceId);
        } catch (error) {
          if (!commit_result.idempotent_replay || error.code !== 'MECHANIC_INSTANCE_NOT_FOUND') throw error;
          currentInstance = null;
        }
        return send(res, 200, {
          commit_result, instance: currentInstance,
          ...(currentInstance ? {} : { instance_current: false }),
        });
      }
      if (parts.length === 4 && action === 'proposals' && req.method === 'POST') {
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'A configured adapter identity is required to create proposals.' } });
        return send(res, 201, { proposal: proposals.create(worldId, await readBody(req), adapterId) });
      }
      if (parts.length === 5 && action === 'proposals' && req.method === 'GET') {
        const proposalId = decodeURIComponent(parts[4]);
        if (secretMatches(req.headers['x-admin-token'], adminToken)) {
          return send(res, 200, { proposal: proposals.get(worldId, proposalId) });
        }
        const adapterId = adapterIdFor(req);
        if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'A configured adapter identity is required to read a proposal.' } });
        return send(res, 200, { proposal: proposals.get(worldId, proposalId, adapterId) });
      }
      if (parts.length === 6 && action === 'proposals' && req.method === 'POST') {
        const proposalId = decodeURIComponent(parts[4]);
        const operation = parts[5];
        if (operation === 'approve') {
          if (!secretMatches(req.headers['x-approval-token'], approvalToken)) {
            return send(res, 403, { error: { code: 'APPROVAL_REQUIRED', message: 'A separate approval credential is required.' } });
          }
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new EngineError('INVALID_APPROVAL_REQUEST', 'Approval body must be an empty JSON object.', 400);
          }
          if (Object.keys(body).length) throw new EngineError('UNSUPPORTED_APPROVAL_FIELD', 'Approval body must be empty; approver identity is derived from the approval credential.');
          return send(res, 200, { proposal: proposals.approve(worldId, proposalId) });
        }
        if (operation === 'commit') {
          // Possession of a proposal ID and the general API bearer are not
          // execution authority. Adapter-facing commits must be made by the
          // adapter that created the proposal; trusted orchestration uses
          // the separately authenticated internal /events route below.
          const adapterId = adapterIdFor(req);
          if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'A configured adapter identity is required to commit a proposal.' } });
          proposals.get(worldId, proposalId, adapterId); // non-enumerating ownership check
          const result = proposals.commit(worldId, proposalId);
          const { commit_result: commitResult, ...proposal } = result;
          return send(res, 200, { proposal, commit_result: commitResult });
        }
        if (operation === 'cancel') {
          const adapterId = adapterIdFor(req);
          if (!adapterId) return send(res, 403, { error: { code: 'ADAPTER_REQUIRED', message: 'A configured adapter identity is required to cancel proposals.' } });
          const body = await readBody(req);
          const allowed = ['reason'];
          if (Object.keys(body).some((key) => !allowed.includes(key))) throw new EngineError('UNSUPPORTED_CANCELLATION_FIELD', 'Cancellation accepts only an optional reason.');
          const reason = body.reason ?? 'adapter_cancelled';
          if (typeof reason !== 'string' || !reason.trim() || reason.length > 200) throw new EngineError('INVALID_CANCELLATION_REASON', 'reason must be a non-empty string of at most 200 characters.');
          return send(res, 200, { proposal: proposals.cancel(worldId, proposalId, reason.trim(), adapterId) });
        }
      }

      if (parts.length === 4 && action === 'relationship-transitions' && req.method === 'POST') {
        if (!secretMatches(req.headers['x-admin-token'], adminToken)) {
          return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required for canonical Relationship transitions.' } });
        }
        const body = await readBody(req);
        const commit_result = engine.commitRelationshipTransition(worldId, body);
        // The engine commits the canonical trimmed participant IDs. Use the same
        // normalized IDs for the projection read so the response describes that commit.
        const subject_id = body.subject_id.trim();
        const target_id = body.target_id.trim();
        const relationship = engine.store.getRelationshipPair(worldId, subject_id, target_id);
        return send(res, commit_result.idempotent_replay ? 200 : 201, { commit_result, relationship });
      }
      if (req.method === 'POST' && action === 'context-manifests') {
        // A context manifest is a host assertion about the exact context
        // prepared for a generation. A general API/adapter bearer is not
        // sufficient authority to register that assertion.
        if (!secretMatches(req.headers['x-engine-internal-token'], internalToken)) {
          return send(res, 403, { error: { code: 'INTERNAL_REQUIRED', message: 'A separately authenticated internal host is required to register context manifests.' } });
        }
        return send(res, 201, { context_manifest: engine.registerContextManifest(worldId, await readBody(req)) });
      }
      if (req.method === 'GET' && action === 'state') return send(res, 200, { state: engine.getState(worldId) });
      if (req.method === 'GET' && action === 'events') return send(res, 200, { events: engine.getEvents(worldId, url.searchParams.get('include_invalid') === 'true') });
      if (req.method === 'GET' && action === 'audit') return send(res, 200, { audit: engine.getAudit(worldId) });
      if (req.method === 'POST' && action === 'events') {
        if (!secretMatches(req.headers['x-engine-internal-token'], internalToken)) {
          return send(res, 403, { error: { code: 'DIRECT_COMMIT_DISABLED', message: 'Direct event commit is restricted to the separately configured internal credential.' } });
        }
        const body = await readBody(req);
        if (typeof body.proposal_id !== 'string' || !body.proposal_id.trim()) {
          throw new EngineError('PROPOSAL_REQUIRED', 'Direct event route accepts only an approved proposal_id.', 400);
        }
        if (Object.keys(body).some((key) => key !== 'proposal_id')) {
          throw new EngineError('UNSUPPORTED_INTERNAL_COMMIT_FIELD', 'Internal event route accepts only proposal_id.');
        }
        const proposal = proposals.get(worldId, body.proposal_id.trim());
        if (proposal.status !== 'approved' && proposal.status !== 'committed') {
          throw new EngineError('PROPOSAL_NOT_APPROVED', 'Internal event route requires an approved proposal.', 409, { status: proposal.status });
        }
        const result = proposals.commit(worldId, body.proposal_id.trim());
        const { commit_result: commitResult, ...publicProposal } = result;
        return send(res, 200, { proposal: publicProposal, commit_result: commitResult });
      }
      if (req.method === 'POST' && action === 'rollback') {
        // Rollback invalidates canonical history and is a privileged correction,
        // regardless of the event type. Do not let an API/adapter bearer bypass
        // the authoring boundary merely because the target is not a mechanic event.
        if (!secretMatches(req.headers['x-admin-token'], adminToken)) {
          return send(res, 403, { error: { code: 'ADMIN_REQUIRED', message: 'A separate administrative credential is required to roll back canonical events.' } });
        }
        const body = await readBody(req);
        return send(res, 200, engine.rollbackEvent(worldId, body));
      }
      return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported method for route.' } });
    } catch (error) {
      if (res.headersSent) return res.destroy(error);
      const known = error instanceof EngineError;
      send(res, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : 'Internal error.',
          ...(known && error.details ? { details: error.details } : {}),
        },
      });
    }
  });
}
