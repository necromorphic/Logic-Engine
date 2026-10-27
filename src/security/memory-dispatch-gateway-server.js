import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  createDispatchPermitSignature,
  verifyDispatchOutcomeSignature,
  verifyDispatchRequestSignature,
} from './memory-dispatch-gateway.js';

const loopbackHosts = new Set(['127.0.0.1', '::1']);

function tokenMatches(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && left.length >= 32 && timingSafeEqual(left, right);
}

async function readJsonBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

export async function createMemoryDispatchGatewayServer({
  gateway,
  hostToken,
  hostSigningKey,
  host = '127.0.0.1',
  port = 0,
  maxBodyBytes = 65536,
}) {
  if (!gateway || typeof gateway.dispatchProtectedRequest !== 'function'
    || typeof gateway.recordDispatchOutcome !== 'function'
    || typeof hostToken !== 'string' || hostToken.length < 32
    || typeof hostSigningKey !== 'string' || hostSigningKey.length < 32
    || hostToken === hostSigningKey
    || !loopbackHosts.has(host)
    || !Number.isInteger(port) || port < 0 || port > 65535
    || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024 || maxBodyBytes > 1048576) {
    throw new TypeError('Invalid Memory dispatch Gateway server configuration.');
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !['/v1/dispatch', '/v1/dispatch/outcome'].includes(request.url)) {
      sendJson(response, 404, { error: 'NOT_FOUND' });
      return;
    }

    const authorization = request.headers.authorization;
    const receivedToken = typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice(7) : '';
    if (!tokenMatches(hostToken, receivedToken)) {
      sendJson(response, 403, { error: 'DENIED' });
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(request, maxBodyBytes);
    } catch {
      sendJson(response, 400, { error: 'INVALID_REQUEST' });
      return;
    }

    if (request.url === '/v1/dispatch/outcome') {
      const outcome = {
        requestId: payload?.request_id,
        requestDigest: payload?.request_digest,
        outcome: payload?.outcome,
        outcomeCode: payload?.outcome_code ?? null,
      };
      if (!verifyDispatchOutcomeSignature(hostSigningKey, outcome, payload?.signature)) {
        sendJson(response, 403, { error: 'DENIED' });
        return;
      }
      try {
        const result = gateway.recordDispatchOutcome(outcome);
        sendJson(response, 200, { status: result.status, request_id: result.requestId });
      } catch {
        sendJson(response, 409, { error: 'OUTCOME_CONFLICT' });
      }
      return;
    }

    const dispatchRequest = {
      requestId: payload?.request_id,
      route: payload?.route,
      model: payload?.model,
      stream: payload?.stream,
      bodyDigest: payload?.body_digest,
      worldId: payload?.world_id,
      actorId: payload?.actor_id,
      purpose: payload?.purpose,
      sources: payload?.sources,
      candidates: payload?.candidates,
    };
    if (Object.hasOwn(payload ?? {}, 'body')
      || !verifyDispatchRequestSignature(hostSigningKey, dispatchRequest, payload?.signature)) {
      sendJson(response, 403, { error: 'DENIED' });
      return;
    }

    try {
      const permit = await gateway.dispatchProtectedRequest(dispatchRequest);
      sendJson(response, 200, {
        permit: {
          request_id: permit.requestId,
          request_digest: permit.requestDigest,
          status: permit.status,
          core_head: permit.coreHead,
          provider_head: permit.providerHead,
          signature: createDispatchPermitSignature(hostSigningKey, permit),
        },
      });
    } catch (error) {
      const code = error?.message === 'MEMORY_DISPATCH_DUPLICATE_ID'
        || error?.message === 'MEMORY_DISPATCH_REPLAY_BLOCKED' ? 409 : 503;
      sendJson(response, code, {
        error: code === 409 ? 'DUPLICATE_OR_UNRESOLVED_REQUEST' : 'NOT_READY',
      });
    }
  });

  // Own the bind operation: callers cannot expose this listener on a public interface.
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string' || !loopbackHosts.has(address.address)) {
        server.close(() => reject(new Error('MEMORY_GATEWAY_NON_LOOPBACK_BIND_DENIED')));
        return;
      }
      resolve();
    });
  });
  server.listen = () => { throw new Error('MEMORY_GATEWAY_REBIND_DENIED'); };
  return server;
}
