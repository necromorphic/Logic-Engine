import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const validDigest = (value) => value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;

function readJournal(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return [];
  if (!text.endsWith('\n')) throw new Error('MONOTONIC_ANCHOR_TRUNCATED');
  const rows = [];
  let previousHash = null;
  for (const line of text.trimEnd().split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error('MONOTONIC_ANCHOR_CORRUPT'); }
    const { world_id, conversation_id, generation, snapshot_sha256, previous_hash, record_hash } = row;
    if (!validId(world_id) || !validId(conversation_id) || !Number.isSafeInteger(generation) || generation < 1
      || !validDigest(snapshot_sha256) || !validDigest(previous_hash) || !validDigest(record_hash)
      || previous_hash !== previousHash) throw new Error('MONOTONIC_ANCHOR_CORRUPT');
    const canonical = JSON.stringify({ world_id, conversation_id, generation, snapshot_sha256, previous_hash });
    if (digest(canonical) !== record_hash) throw new Error('MONOTONIC_ANCHOR_CORRUPT');
    const prior = [...rows].reverse().find((entry) => entry.world_id === world_id && entry.conversation_id === conversation_id);
    if (generation !== (prior?.generation ?? 0) + 1) throw new Error('MONOTONIC_ANCHOR_GENERATION_INVALID');
    rows.push(row);
    previousHash = record_hash;
  }
  return rows;
}

/**
 * Append-only monotonic witness for inventory snapshots. Keep this journal outside
 * the Core/Provider database snapshot set and exclude it from their coordinated
 * restore procedure. It detects rollback of those DBs while this witness survives;
 * it cannot protect against rollback/deletion of the witness itself.
 */
export class MonotonicSourceAnchor {
  constructor(path) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new TypeError('Monotonic anchor path must be absolute');
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    // Validate any existing journal on open; corruption must not be reset implicitly.
    readJournal(this.path);
  }

  current(world_id, conversation_id) {
    const rows = readJournal(this.path);
    const row = [...rows].reverse().find((entry) => entry.world_id === world_id && entry.conversation_id === conversation_id);
    return row ? Object.freeze({ generation: row.generation, snapshot_sha256: row.snapshot_sha256 }) : null;
  }

  advance({ world_id, conversation_id, expected_snapshot_sha256, next_snapshot_sha256 }) {
    if (!validId(world_id) || !validId(conversation_id) || !validDigest(expected_snapshot_sha256)
      || !validDigest(next_snapshot_sha256)) return false;
    const rows = readJournal(this.path);
    const prior = [...rows].reverse().find((entry) => entry.world_id === world_id && entry.conversation_id === conversation_id);
    const currentDigest = prior?.snapshot_sha256 ?? null;
    if (currentDigest === next_snapshot_sha256) return true; // idempotent replay
    if (currentDigest !== expected_snapshot_sha256) return false;
    const row = {
      world_id, conversation_id, generation: (prior?.generation ?? 0) + 1,
      snapshot_sha256: next_snapshot_sha256,
      previous_hash: rows.at(-1)?.record_hash ?? null,
    };
    row.record_hash = digest(JSON.stringify(row));
    const fd = openSync(this.path, 'a', 0o600);
    try {
      writeSync(fd, JSON.stringify(row) + '\n', null, 'utf8');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    return true;
  }
}
