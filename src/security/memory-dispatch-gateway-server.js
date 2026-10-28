import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { verifyDispatchRequestSignature } from './memory-dispatch-gateway.js';

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

export async function createMemoryDispatchGatewayServer({
  gateway,
  hostToken,
  hostSigningKey,
  host = '127.0.0.1',
  port = 0,
  maxBodyBytes = 5_000_000,
}) {
  if (!gateway || typeof gateway.dispatchProtectedRequest !== 'function'
    || typeof hostToken !== 'string' || hostToken.length < 32
    || typeof hostSigningKey !== 'string' || hostSigningKey.length < 32
    || hostToken === hostSigningKey
    || !loopbackHosts.has(host)
    || !Number.isInteger(port) || port < 0 || port > 65535
    || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) {
    throw new TypeError('Invalid Memory dispatch Gateway server configuration.');
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/dispatch') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }

    const authorization = request.headers.authorization;
    const receivedToken = typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice(7) : '';
    if (!tokenMatches(hostToken, receivedToken)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'DENIED' }));
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(request, maxBodyBytes);
    } catch {
      if (!response.headersSent) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'INVALID_REQUEST' }));
      }
      return;
    }

    const dispatchRequest = {
      requestId: payload?.request_id,
      route: payload?.route,
      model: payload?.model,
      stream: payload?.stream,
      body: payload?.body,
      worldId: payload?.world_id,
      actorId: payload?.actor_id,
      purpose: payload?.purpose,
      sources: payload?.sources,
      candidates: payload?.candidates,
    };
    if (!verifyDispatchRequestSignature(hostSigningKey, dispatchRequest, payload?.signature)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'DENIED' }));
      return;
    }

    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    const forwardResponse = async (upstream) => {
      response.statusCode = upstream.status;
      const contentType = upstream.headers?.get?.('content-type');
      if (contentType) response.setHeader('content-type', contentType);
      const retryAfter = upstream.headers?.get?.('retry-after');
      if (retryAfter) response.setHeader('retry-after', retryAfter);
      if (upstream.body) {
        await pipeline(Readable.fromWeb(upstream.body), response);
      } else {
        response.end();
      }
    };

    try {
      await gateway.dispatchProtectedRequest({
        ...dispatchRequest,
        forwardResponse,
        signal: controller.signal,
      });
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      const code = error?.message === 'MEMORY_DISPATCH_DUPLICATE_ID' ? 409
        : error?.message === 'MEMORY_DISPATCH_OUTCOME_UNKNOWN' ? 502 : 503;
      response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({
        error: code === 409 ? 'DUPLICATE_REQUEST' : code === 502 ? 'OUTCOME_UNKNOWN' : 'NOT_READY',
      }));
    }
  });

  // Own the bind operation: callers cannot accidentally expose this endpoint
  // by listening on 0.0.0.0 or another non-loopback interface.
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
  // The returned handle is for observing/closing the listener only. Prevent
  // a caller from closing it and rebinding the same server to a public interface.
  server.listen = () => { throw new Error('MEMORY_GATEWAY_REBIND_DENIED'); };
  return server;
}
