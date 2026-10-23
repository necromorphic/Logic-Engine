import { createServer } from 'node:http';
import { EngineError } from '../core/errors.js';
import { ProposalService } from '../application/proposals.js';

const MAX = 1048576;
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

export function createApiServer({ engine, token, internalToken = null, approvalToken = null }) {
  if (!engine) throw new TypeError('engine required');
  if (typeof token !== 'string' || token.length < 16) throw new TypeError('API token must be at least 16 characters');
  if (internalToken !== null && (typeof internalToken !== 'string' || internalToken.length < 16 || internalToken === token)) {
    throw new TypeError('Internal token must be at least 16 characters and differ from API token');
  }
  if (approvalToken !== null && (typeof approvalToken !== 'string' || approvalToken.length < 16 || approvalToken === token || approvalToken === internalToken)) {
    throw new TypeError('Approval token must be at least 16 characters and differ from other tokens');
  }
  const proposals = new ProposalService(engine);

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'logic-engine', protocol_version: 'v1' });
      if (req.headers.authorization !== 'Bearer ' + token) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'A valid bearer token is required.' } });

      if (req.method === 'GET' && url.pathname === '/v1/mechanics/audit') return send(res, 200, { audit: engine.getMechanicRegistryAudit() });
      if (url.pathname === '/v1/mechanic-templates') {
        if (req.method === 'POST') return send(res, 201, { ...engine.registerMechanicTemplate(await readBody(req)) });
        if (req.method === 'GET') return send(res, 200, { templates: engine.listMechanicTemplates() });
        return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported method for route.' } });
      }
      if (url.pathname === '/v1/rule-modules') {
        if (req.method === 'POST') return send(res, 201, { ...engine.registerRuleModuleManifest(await readBody(req)) });
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
      if (req.method === 'POST' && url.pathname === '/v1/worlds') return send(res, 201, { world: engine.createWorld(await readBody(req)) });

      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 3 || parts[0] !== 'v1' || parts[1] !== 'worlds') return send(res, 404, { error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' } });
      const worldId = decodeURIComponent(parts[2]);
      const action = parts[3] || 'state';

      if (parts.length === 4 && action === 'proposals' && req.method === 'POST') {
        return send(res, 201, { proposal: proposals.create(worldId, await readBody(req)) });
      }
      if (parts.length === 5 && action === 'proposals' && req.method === 'GET') {
        return send(res, 200, { proposal: proposals.get(worldId, decodeURIComponent(parts[4])) });
      }
      if (parts.length === 6 && action === 'proposals' && req.method === 'POST') {
        const proposalId = decodeURIComponent(parts[4]);
        const operation = parts[5];
        if (operation === 'approve') {
          if (!approvalToken || req.headers['x-approval-token'] !== approvalToken) {
            return send(res, 403, { error: { code: 'APPROVAL_REQUIRED', message: 'A separate approval credential is required.' } });
          }
          const body = await readBody(req);
          if (Object.keys(body).length) throw new EngineError('UNSUPPORTED_APPROVAL_FIELD', 'Approval body must be empty; approver identity is derived from the approval credential.');
          return send(res, 200, { proposal: proposals.approve(worldId, proposalId) });
        }
        if (operation === 'commit') {
          const result = proposals.commit(worldId, proposalId);
          const { commit_result: commitResult, ...proposal } = result;
          return send(res, 200, { proposal, commit_result: commitResult });
        }
        if (operation === 'cancel') {
          const body = await readBody(req);
          const allowed = ['reason'];
          if (Object.keys(body).some((key) => !allowed.includes(key))) throw new EngineError('UNSUPPORTED_CANCELLATION_FIELD', 'Cancellation accepts only an optional reason.');
          const reason = body.reason ?? 'adapter_cancelled';
          if (typeof reason !== 'string' || !reason.trim() || reason.length > 200) throw new EngineError('INVALID_CANCELLATION_REASON', 'reason must be a non-empty string of at most 200 characters.');
          return send(res, 200, { proposal: proposals.cancel(worldId, proposalId, reason.trim()) });
        }
      }

      if (req.method === 'POST' && action === 'context-manifests') return send(res, 201, { context_manifest: engine.registerContextManifest(worldId, await readBody(req)) });
      if (req.method === 'GET' && action === 'state') return send(res, 200, { state: engine.getState(worldId) });
      if (req.method === 'GET' && action === 'events') return send(res, 200, { events: engine.getEvents(worldId, url.searchParams.get('include_invalid') === 'true') });
      if (req.method === 'GET' && action === 'audit') return send(res, 200, { audit: engine.getAudit(worldId) });
      if (req.method === 'POST' && action === 'events') {
        if (!internalToken || req.headers['x-engine-internal-token'] !== internalToken) {
          return send(res, 403, { error: { code: 'DIRECT_COMMIT_DISABLED', message: 'Direct event commit is restricted to the separately configured internal credential.' } });
        }
        return send(res, 200, engine.commitEvent(worldId, await readBody(req)));
      }
      if (req.method === 'POST' && action === 'rollback') return send(res, 200, engine.rollbackEvent(worldId, await readBody(req)));
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
