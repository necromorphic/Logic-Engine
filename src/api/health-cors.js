/**
 * Exact-origin CORS policy for the unauthenticated, read-only /health route.
 * This module does not authorize API routes and never exposes engine credentials.
 */
export function parseHealthAllowedOrigins(raw = '') {
  if (Array.isArray(raw)) return validateOrigins(raw);
  if (typeof raw !== 'string') throw new TypeError('Health CORS origins must be a comma-separated string.');
  if (!raw.trim()) return [];
  return validateOrigins(raw.split(',').map((origin) => origin.trim()).filter(Boolean));
}

function validateOrigins(origins) {
  const result = [];
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin === '*') {
      throw new TypeError('Health CORS requires explicit origins; wildcard is forbidden.');
    }
    let parsed;
    try { parsed = new URL(origin); } catch { throw new TypeError(`Invalid health CORS origin: ${origin}`); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new TypeError(`Health CORS value must be an exact HTTP(S) origin: ${origin}`);
    }
    if (!result.includes(origin)) result.push(origin);
  }
  return result;
}

export function applyHealthCors(req, res, allowedOrigins) {
  const origin = req.headers?.origin;
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) return false;
  res.setHeader('access-control-allow-origin', origin);
  const currentVary = res.getHeader?.('vary');
  const varyParts = String(currentVary || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!varyParts.some((item) => item.toLowerCase() === 'origin')) varyParts.push('Origin');
  res.setHeader('vary', varyParts.join(', '));
  return true;
}
