const configuredHealthUrl = env => {
  const configured = env.LOGIC_ENGINE_CORE_URL;
  if (typeof configured !== 'string' || !configured.trim()) return null;
  let url;
  try { url = new URL(configured); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return null;
  url.pathname = '/health';
  return url;
};

export function createLogicEngineHealthHandler({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('timeoutMs must be an integer between 1 and 30000');

  return async function logicEngineHealth(_request, response) {
    const url = configuredHealthUrl(env);
    if (!url) return response.status(503).json({ error: { code: 'LOGIC_ENGINE_PROXY_UNCONFIGURED', message: 'The server-side Logic-Engine health target is not configured.' } });
    try {
      const upstream = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!upstream.ok) return response.status(502).json({ error: { code: 'LOGIC_ENGINE_UNHEALTHY', message: 'Logic-Engine health check failed.' } });
      let payload;
      try { payload = await upstream.json(); } catch {
        return response.status(502).json({ error: { code: 'LOGIC_ENGINE_UNHEALTHY', message: 'Logic-Engine returned an invalid health response.' } });
      }
      if (payload?.ok !== true || payload?.service !== 'logic-engine') return response.status(502).json({ error: { code: 'LOGIC_ENGINE_UNHEALTHY', message: 'Logic-Engine health response was not recognized.' } });
      return response.status(200).json({
        status: 'reachable',
        service: 'logic-engine',
        protocol_version: typeof payload.protocol_version === 'string' ? payload.protocol_version : null,
        adapter_authorized: 'not_checked',
        protected_memory_route: 'not_exposed',
      });
    } catch {
      return response.status(503).json({ error: { code: 'LOGIC_ENGINE_UNREACHABLE', message: 'Logic-Engine could not be reached.' } });
    }
  };
}
