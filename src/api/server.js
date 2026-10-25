import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { EngineError } from '../core/errors.js';
import { hashRequest } from '../core/request-hash.js';
import { ProposalService } from '../application/proposals.js';
import { ActorBindingService } from '../application/actor-bindings.js';
import { AuthorizedReadService } from '../application/authorized-read-service.js';

const MAX = 1048576;

// Hash both inputs to a fixed-length digest before timingSafeEqual so a
// mismatched secret length does not create a length-dependent comparison path.
function secretMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX) throw new EngineError('BODY_TOO_LARGE', 'Body exceeds 1 MiB.', 413);
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

export function createApiServer({ engine, token, internalToken = null, approvalToken = null, adminToken = null, adapterTokens = {}, authorizedReadFieldPolicy = null }) {
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
  const configuredAdapterSecrets = Object.values(adapterTokens || {});
  if (!adapterTokens || typeof adapterTokens !== 'object' || Array.isArray(adapterTokens) || Object.entries(adapterTokens).some(([id, secret]) => !id.trim() || typeof secret !== 'string' || secret.length < 16 || [token, internalToken, approvalToken, adminToken].includes(secret)) || new Set(configuredAdapterSecrets).size !== configuredAdapterSecrets.length) {
    throw new TypeError('Adapter tokens must map non-empty adapter IDs to unique, distinct secrets of at least 16 characters');
  }
  const adapterIdFor = (req) => {
    const id = req.headers['x-adapter-id'];
    const secret = req.headers['x-adapter-token'];
    return typeof id === 'string' && Object.hasOwn(adapterTokens, id) && secretMatches(secret, adapterTokens[id]) ? id : null;
  };
  const proposals = new ProposalService(engine);
  const actorBindings = new ActorBindingService(engine);
  // Until a canonical visibility schema exists, disclose only the bound actor's
  // own non-attribute identity fields. This intentionally denies all attributes.
  const defaultAuthorizedReadFieldPolicy = (context, entity, field) => entity.entity_id === context.actor.entity_id
    && ['entity_id', 'entity_type', 'status'].includes(field);
  // A host may opt into a broader, explicit policy. The policy is trusted
  // application configuration and is never accepted from an HTTP request.
  // Without one, preserve the narrow self-identity-only default.
  const authorizedReads = new AuthorizedReadService(engine, actorBindings,
    authorizedReadFieldPolicy || defaultAuthorizedReadFieldPolicy);

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
