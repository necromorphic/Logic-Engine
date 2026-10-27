import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../storage/coordinator-lock.js';
import { getAcceptedHeadStatusSync } from './accepted-head-client-sync.js';

export const SUPPORTED_PROTECTED_MEMORY_ROUTES = Object.freeze([
  'google-ai-studio-chat-completions',
]);

const validText = (value, max = 200) => typeof value === 'string'
  && value === value.trim()
  && value.length > 0
  && value.length <= max
  && ![...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

function canonicalPath(path) {
  const absolute = resolve(path);
  let candidate = absolute;
  const suffix = [];
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new TypeError('Cannot resolve dispatch storage path.');
    suffix.unshift(candidate.slice(parent.length).replace(/^[/\\\\]+/, ''));
    candidate = parent;
  }
  return resolve(realpathSync(candidate), ...suffix);
}

function sameFile(left, right) {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  if (a === b) return true;
  if (!existsSync(a) || !existsSync(b)) return false;
  const statA = statSync(a, { bigint: true });
  const statB = statSync(b, { bigint: true });
  return statA.dev === statB.dev && statA.ino === statB.ino;
}

function normalizeSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 256) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  const normalized = sources.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).some((key) => !['source_kind', 'source_entity_id', 'source_version'].includes(key))
      || source.source_kind !== 'canonical_entity'
      || !validText(source.source_entity_id, 200)
      || !validText(source.source_version, 200)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    return Object.freeze({
      source_kind: source.source_kind,
      source_entity_id: source.source_entity_id,
      source_version: source.source_version,
    });
  });
  normalized.sort((a, b) => a.source_entity_id.localeCompare(b.source_entity_id)
    || a.source_version.localeCompare(b.source_version));
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i - 1].source_entity_id === normalized[i].source_entity_id
      && normalized[i - 1].source_version === normalized[i].source_version) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
  }
  return Object.freeze(normalized);
}

function assertSameSources(actual, expected) {
  let normalized;
  try { normalized = normalizeSources(actual); } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
}

function assertSyncResult(value) {
  if (!value || typeof value !== 'object' || typeof value.then === 'function') {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  return value;
}

/**
 * Sole-dispatch primitive for requests carrying protected Memory.
 *
 * The caller must provide trusted synchronous Core/Provider readers that open
 * their databases read-only and validate the exact current source/grant state.
 * The module intentionally has no fallback reader or transport. Only the
 * explicitly allowlisted Google AI Studio chat route is supported.
 */
export class MemoryDispatchGateway {
  constructor({
    ledgerPath,
    coordinatorPath,
    authorityPort,
    readToken,
    readCoreEvidence,
    readProviderEvidence,
    sendUpstream,
  }) {
    if (typeof ledgerPath !== 'string' || !isAbsolute(ledgerPath)
      || typeof coordinatorPath !== 'string' || !isAbsolute(coordinatorPath)
      || !Number.isInteger(authorityPort) || authorityPort < 1 || authorityPort > 65535
      || typeof readToken !== 'string' || readToken.length < 32
      || typeof readCoreEvidence !== 'function'
      || typeof readProviderEvidence !== 'function'
      || typeof sendUpstream !== 'function') {
      throw new TypeError('MemoryDispatchGateway requires file-backed stores, a read-only authority token, trusted synchronous readers, and a transport.');
    }
    if (sameFile(ledgerPath, coordinatorPath)) {
      throw new Error('DISPATCH_LEDGER_COORDINATOR_PATH_ALIAS');
    }

    this.ledgerPath = resolve(ledgerPath);
    this.coordinatorPath = resolve(coordinatorPath);
    this.authorityPort = authorityPort;
    this.readToken = readToken;
    this.readCoreEvidence = readCoreEvidence;
    this.readProviderEvidence = readProviderEvidence;
    this.sendUpstream = sendUpstream;

    this.coordinatorDb = openCoordinatorDatabase(this.coordinatorPath);
    this.db = null;
    let release = () => {};
    let startupError = null;
    try {
      release = beginCoordinatorLock(this.coordinatorDb);
      const existed = existsSync(this.ledgerPath);
      this.db = new DatabaseSync(this.ledgerPath);
      if (!existed) {
        this.db.exec(`
          CREATE TABLE dispatch_ledger (
            request_id TEXT PRIMARY KEY,
            request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
            route TEXT NOT NULL CHECK(route='google-ai-studio-chat-completions'),
            world_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            purpose TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            core_head INTEGER NOT NULL CHECK(core_head > 0),
            provider_head INTEGER NOT NULL CHECK(provider_head > 0),
            status TEXT NOT NULL CHECK(status IN ('DISPATCH_STARTED','COMPLETED','UNKNOWN')),
            outcome_code INTEGER,
            started_at TEXT NOT NULL,
            finished_at TEXT
          );
          CREATE INDEX dispatch_ledger_status_started
            ON dispatch_ledger(status, started_at);
        `);
      } else {
        const objects = new Set(this.db.prepare(
          "SELECT type || ':' || name AS object_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        ).all().map((row) => row.object_name));
        if (!objects.has('table:dispatch_ledger') || !objects.has('index:dispatch_ledger_status_started')) {
          throw new Error('DISPATCH_LEDGER_SCHEMA_INCOMPLETE');
        }
        const columns = new Set(this.db.prepare('PRAGMA table_info(dispatch_ledger)').all().map((row) => row.name));
        const required = [
          'request_id', 'request_digest', 'route', 'world_id', 'actor_id', 'purpose',
          'sources_json', 'core_head', 'provider_head', 'status', 'outcome_code',
          'started_at', 'finished_at',
        ];
        if (required.some((column) => !columns.has(column))) throw new Error('DISPATCH_LEDGER_SCHEMA_INCOMPLETE');
      }
    } catch (error) {
      startupError = error;
    } finally {
      try { release(); } catch (error) { startupError ??= error; }
    }
    if (startupError) {
      try { this.db?.close(); } catch {}
      try { this.coordinatorDb.close(); } catch {}
      throw startupError;
    }
  }

  async dispatchProtectedRequest({ requestId, route, body, worldId, actorId, purpose, sources }) {
    if (!validText(requestId, 200) || !SUPPORTED_PROTECTED_MEMORY_ROUTES.includes(route)
      || typeof body !== 'string' || body.length === 0 || body.length > 4_000_000
      || !validText(worldId, 200) || !validText(actorId, 200) || !validText(purpose, 200)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const sourceSet = normalizeSources(sources);
    const requestDigest = createHash('sha256').update(body, 'utf8').digest('hex');
    let coreHead;
    let providerHead;
    let release = null;

    try {
      release = beginCoordinatorLock(this.coordinatorDb);
      const authority = getAcceptedHeadStatusSync({
        port: this.authorityPort,
        token: this.readToken,
      });
      if (authority.pending.core || authority.pending.provider
        || !authority.enrolled.core || !authority.enrolled.provider) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }

      const core = assertSyncResult(this.readCoreEvidence({
        worldId, actorId, purpose, sources: sourceSet,
      }));
      const provider = assertSyncResult(this.readProviderEvidence({
        worldId, actorId, purpose, sources: sourceSet,
      }));
      if (core.world_id !== worldId || core.actor_id !== actorId
        || core.readiness !== 'READY' || core.inventory_status !== 'READY'
        || !Number.isSafeInteger(core.head) || core.head !== authority.heads.core) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      if (provider.world_id !== worldId || provider.actor_id !== actorId
        || provider.purpose !== purpose || provider.granted !== true
        || provider.readiness !== 'READY'
        || !Number.isSafeInteger(provider.head) || provider.head !== authority.heads.provider) {
        throw new Error('MEMORY_DISPATCH_NOT_READY');
      }
      assertSameSources(core.sources, sourceSet);
      assertSameSources(provider.sources, sourceSet);
      coreHead = core.head;
      providerHead = provider.head;

      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare(`
          INSERT INTO dispatch_ledger(
            request_id,request_digest,route,world_id,actor_id,purpose,sources_json,
            core_head,provider_head,status,outcome_code,started_at,finished_at
          ) VALUES(?,?,?,?,?,?,?,?,?,'DISPATCH_STARTED',NULL,?,NULL)
        `).run(
          requestId,
          requestDigest,
          route,
          worldId,
          actorId,
          purpose,
          JSON.stringify(sourceSet),
          coreHead,
          providerHead,
          new Date().toISOString(),
        );
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        if (String(error?.message || '').includes('UNIQUE constraint failed')) {
          throw new Error('MEMORY_DISPATCH_DUPLICATE_ID');
        }
        throw error;
      }
    } catch {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    } finally {
      try { release?.(); } catch {}
    }

    // Never hold the shared coordinator while performing upstream network I/O.
    // Once DISPATCH_STARTED is durable, an ambiguous outcome is never retried.
    let response;
    try {
      response = await this.sendUpstream({ route, body, requestId, requestDigest });
    } catch {
      this.#recordOutcome(requestId, 'UNKNOWN', null);
      throw new Error('MEMORY_DISPATCH_OUTCOME_UNKNOWN');
    }

    const outcomeCode = Number.isInteger(response?.status) ? response.status : null;
    try {
      this.#recordOutcome(requestId, 'COMPLETED', outcomeCode);
    } catch {
      throw new Error('MEMORY_DISPATCH_OUTCOME_UNKNOWN');
    }
    return response;
  }

  #recordOutcome(requestId, status, outcomeCode) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(
        'UPDATE dispatch_ledger SET status=?,outcome_code=?,finished_at=? WHERE request_id=? AND status=?',
      ).run(status, outcomeCode, new Date().toISOString(), requestId, 'DISPATCH_STARTED');
      if (result.changes !== 1) throw new Error('DISPATCH_LEDGER_OUTCOME_CONFLICT');
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  close() {
    try { this.db?.close(); } finally { this.coordinatorDb.close(); }
  }
}
