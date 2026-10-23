import { createHash } from 'node:crypto';

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, normalize(value[key])]),
    );
  }
  return value;
}

export function hashRequest(value) {
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
}
