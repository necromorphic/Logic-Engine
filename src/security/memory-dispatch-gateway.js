import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { beginCoordinatorLock, openCoordinatorDatabase } from '../storage/coordinator-lock.js';
import { getAcceptedHeadStatusSync } from './accepted-head-client-sync.js';

export function createDispatchRequestSignature(secret, request) {
  if (typeof secret !== 'string' || secret.length < 32
    || !request || typeof request !== 'object'
    || typeof request.stream !== 'boolean') {
    throw new TypeError('Invalid signed dispatch request.');
  }
  const bodyDigest = typeof request.bodyDigest === 'string' && /^[a-f0-9]{64}$/.test(request.bodyDigest)
    ? request.bodyDigest
    : typeof request.body === 'string'
      ? createHash('sha256').update(request.body, 'utf8').digest('hex')
      : null;
  if (!bodyDigest) throw new TypeError('Invalid signed dispatch body digest.');
  const sources = normalizeSources(request.sources);
  const candidates = normalizeCandidates(request.candidates);
  assertSourcesMatchCandidates(sources, candidates);
  const canonical = JSON.stringify({
    request_id: request.requestId,
    route: request.route,
    model: request.model,
    stream: request.stream,
    body_digest: bodyDigest,
    world_id: request.worldId,
    actor_id: request.actorId,
    purpose: request.purpose,
    sources,
    candidates,
  });
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function createDispatchPermitSignature(secret, permit) {
  if (typeof secret !== 'string' || secret.length < 32
    || !permit || typeof permit !== 'object'
    || permit.status !== 'DISPATCH_STARTED'
    || !validText(permit.requestId, 200)
    || !/^[a-f0-9]{64}$/.test(permit.requestDigest)
    || !Number.isSafeInteger(permit.coreHead) || permit.coreHead < 1
    || !Number.isSafeInteger(permit.providerHead) || permit.providerHead < 1) {
    throw new TypeError('Invalid dispatch permit.');
  }
  const canonical = JSON.stringify({
    request_id: permit.requestId,
    request_digest: permit.requestDigest,
    status: permit.status,
    core_head: permit.coreHead,
    provider_head: permit.providerHead,
  });
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function verifyDispatchPermitSignature(secret, permit, signature) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  let expected;
  try { expected = createDispatchPermitSignature(secret, permit); } catch { return false; }
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(signature, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createDispatchOutcomeSignature(secret, outcome) {
  if (typeof secret !== 'string' || secret.length < 32
    || !outcome || typeof outcome !== 'object'
    || !validText(outcome.requestId, 200)
    || !/^[a-f0-9]{64}$/.test(outcome.requestDigest)
    || !['COMPLETED', 'UNKNOWN'].includes(outcome.outcome)
    || (outcome.outcomeCode !== null && outcome.outcomeCode !== undefined
      && (!Number.isInteger(outcome.outcomeCode) || outcome.outcomeCode < 100 || outcome.outcomeCode > 599))) {
    throw new TypeError('Invalid dispatch outcome.');
  }
  const canonical = JSON.stringify({
    request_id: outcome.requestId,
    request_digest: outcome.requestDigest,
    outcome: outcome.outcome,
    outcome_code: outcome.outcomeCode ?? null,
  });
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

export function verifyDispatchOutcomeSignature(secret, outcome, signature) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  let expected;
  try { expected = createDispatchOutcomeSignature(secret, outcome); } catch { return false; }
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(signature, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyDispatchRequestSignature(secret, request, signature) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  let expected;
  try { expected = createDispatchRequestSignature(secret, request); } catch { return false; }
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(signature, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export const SUPPORTED_PROTECTED_MEMORY_ROUTES = Object.freeze([
  'sillytavern-chat-completions',
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

export function openReadOnlySqliteDatabase(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path === ':memory:' || !existsSync(path)) {
    throw new TypeError('Read-only SQLite access requires an existing absolute file path.');
  }
  const db = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA query_only=ON;');
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
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
  const compareCodeUnits = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  normalized.sort((a, b) => compareCodeUnits(a.source_entity_id, b.source_entity_id)
    || compareCodeUnits(a.source_version, b.source_version));
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i - 1].source_entity_id === normalized[i].source_entity_id
      && normalized[i - 1].source_version === normalized[i].source_version) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
  }
  return Object.freeze(normalized);
}


function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 50) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
  const normalized = candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || Object.keys(candidate).some((key) => !['record_ref', 'record_version', 'source_kind', 'source_entity_id', 'source_version'].includes(key))
      || !validText(candidate.record_ref, 200) || !validText(candidate.record_version, 200)
      || candidate.source_kind !== 'canonical_entity'
      || !validText(candidate.source_entity_id, 200) || !validText(candidate.source_version, 200)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    return Object.freeze({
      record_ref: candidate.record_ref,
      record_version: candidate.record_version,
      source_kind: candidate.source_kind,
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    });
  });
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  normalized.sort((a, b) => compare(a.record_ref, b.record_ref)
    || compare(a.record_version, b.record_version)
    || compare(a.source_entity_id, b.source_entity_id)
    || compare(a.source_version, b.source_version));
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i - 1].record_ref === normalized[i].record_ref
      && normalized[i - 1].record_version === normalized[i].record_version) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
  }
  return Object.freeze(normalized);
}

function assertSameCandidates(actual, expected) {
  let normalized;
  try { normalized = normalizeCandidates(actual); } catch { throw new Error('MEMORY_DISPATCH_NOT_READY'); }
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) throw new Error('MEMORY_DISPATCH_NOT_READY');
}

function assertSourcesMatchCandidates(sources, candidates) {
  const derived = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.source_entity_id, candidate.source_version]);
    if (seen.has(key)) continue;
    seen.add(key);
    derived.push({
      source_kind: candidate.source_kind,
      source_entity_id: candidate.source_entity_id,
      source_version: candidate.source_version,
    });
  }
  if (JSON.stringify(normalizeSources(derived)) !== JSON.stringify(sources)) {
    throw new Error('MEMORY_DISPATCH_NOT_READY');
  }
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
 * explicitly allowlisted SillyTavern server-side chat-completion route is supported.
 */
export class MemoryDispatchGateway {
  constructor({
    ledgerPath,
    coordinatorPath,
    authorityPort,
    readToken,
    readCoreEvidence,
    readProviderEvidence,
  }) {
    if (typeof ledgerPath !== 'string' || !isAbsolute(ledgerPath)
      || typeof coordinatorPath !== 'string' || !isAbsolute(coordinatorPath)
      || !Number.isInteger(authorityPort) || authorityPort < 1 || authorityPort > 65535
      || typeof readToken !== 'string' || readToken.length < 32
      || typeof readCoreEvidence !== 'function'
      || typeof readProviderEvidence !== 'function'
      ) {
      throw new TypeError('MemoryDispatchGateway requires file-backed stores, a read-only authority token, and trusted synchronous readers.');
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
    // The gateway records dispatch-start and issues a permit; it never sends to a model provider.

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
            route TEXT NOT NULL CHECK(route='sillytavern-chat-completions'),
            model TEXT NOT NULL,
            stream INTEGER NOT NULL CHECK(stream IN (0,1)),
            world_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            purpose TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            candidates_json TEXT NOT NULL,
            core_head INTEGER NOT NULL CHECK(core_head > 0),
            provider_head INTEGER NOT NULL CHECK(provider_head > 0),
            status TEXT NOT NULL CHECK(status IN ('DISPATCH_STARTED','COMPLETED','UNKNOWN')),
            outcome_code INTEGER,
            started_at TEXT NOT NULL,
            finished_at TEXT
          );
          CREATE INDEX dispatch_ledger_status_started
            ON dispatch_ledger(status, started_at);
          CREATE UNIQUE INDEX dispatch_ledger_unresolved_digest
            ON dispatch_ledger(request_digest)
            WHERE status IN ('DISPATCH_STARTED','UNKNOWN');
        `);
      } else {
        const objects = new Set(this.db.prepare(
          "SELECT type || ':' || name AS object_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        ).all().map((row) => row.object_name));
        if (!objects.has('table:dispatch_ledger') || !objects.has('index:dispatch_ledger_status_started')
          || !objects.has('index:dispatch_ledger_unresolved_digest')) {
          throw new Error('DISPATCH_LEDGER_SCHEMA_INCOMPLETE');
        }
        const columns = new Set(this.db.prepare('PRAGMA table_info(dispatch_ledger)').all().map((row) => row.name));
        const required = [
          'request_id', 'request_digest', 'route', 'model', 'stream', 'world_id', 'actor_id', 'purpose',
          'sources_json', 'candidates_json', 'core_head', 'provider_head', 'status', 'outcome_code',
          'started_at', 'finished_at',
        ];
        if (required.some((column) => !columns.has(column))) throw new Error('DISPATCH_LEDGER_SCHEMA_INCOMPLETE');
      }
      // A durable STARTED row left by a process crash has an ambiguous outcome.
      // Never retry it automatically; persist UNKNOWN before accepting new work.
      this.db.prepare(`
        UPDATE dispatch_ledger SET status='UNKNOWN', finished_at=?
        WHERE status='DISPATCH_STARTED'
      `).run(new Date().toISOString());
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

  async dispatchProtectedRequest({ requestId, route, model, stream, bodyDigest, body, worldId, actorId, purpose, sources, candidates }) {
    if (!validText(requestId, 200) || !SUPPORTED_PROTECTED_MEMORY_ROUTES.includes(route)
      || typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(model)
      || typeof stream !== 'boolean'
      || !(typeof bodyDigest === 'string' && /^[a-f0-9]{64}$/.test(bodyDigest))
      || (body !== undefined)
      || !validText(worldId, 200) || !validText(actorId, 200) || !validText(purpose, 200)) {
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    }
    const sourceSet = normalizeSources(sources);
    const candidateSet = normalizeCandidates(candidates);
    assertSourcesMatchCandidates(sourceSet, candidateSet);
    const requestDigest = createHash('sha256').update(JSON.stringify({
      route,
      model,
      stream,
      body_digest: bodyDigest,
      world_id: worldId,
      actor_id: actorId,
      purpose,
      sources: sourceSet,
      candidates: candidateSet,
    }), 'utf8').digest('hex');
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
        worldId, actorId, purpose, sources: sourceSet, candidates: candidateSet,
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
      assertSameCandidates(provider.candidates, candidateSet);
      coreHead = core.head;
      providerHead = provider.head;

      this.db.exec('BEGIN IMMEDIATE');
      try {
        const duplicateRequestId = this.db.prepare(
          'SELECT request_id FROM dispatch_ledger WHERE request_id=? LIMIT 1',
        ).get(requestId);
        if (duplicateRequestId) throw new Error('MEMORY_DISPATCH_DUPLICATE_ID');
        const unresolvedReplay = this.db.prepare(`
          SELECT request_id FROM dispatch_ledger
          WHERE request_digest=? AND status IN ('DISPATCH_STARTED','UNKNOWN')
          LIMIT 1
        `).get(requestDigest);
        if (unresolvedReplay) throw new Error('MEMORY_DISPATCH_REPLAY_BLOCKED');
        this.db.prepare(`
          INSERT INTO dispatch_ledger(
            request_id,request_digest,route,model,stream,world_id,actor_id,purpose,sources_json,candidates_json,
            core_head,provider_head,status,outcome_code,started_at,finished_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'DISPATCH_STARTED',NULL,?,NULL)
        `).run(
          requestId,
          requestDigest,
          route,
          model,
          stream ? 1 : 0,
          worldId,
          actorId,
          purpose,
          JSON.stringify(sourceSet),
          JSON.stringify(candidateSet),
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
    } catch (error) {
      if (error?.message === 'MEMORY_DISPATCH_DUPLICATE_ID'
        || error?.message === 'MEMORY_DISPATCH_REPLAY_BLOCKED') throw error;
      throw new Error('MEMORY_DISPATCH_NOT_READY');
    } finally {
      try { release?.(); } catch {}
    }

    // The Host server must verify this one-use permit before invoking its already
    // configured SillyTavern backend. This service never calls a model API.
    return Object.freeze({
      status: 'DISPATCH_STARTED',
      requestId,
      requestDigest,
      coreHead,
      providerHead,
    });
  }

  recordDispatchOutcome({ requestId, requestDigest, outcome, outcomeCode = null }) {
    if (!validText(requestId, 200) || !/^[a-f0-9]{64}$/.test(requestDigest)
      || !['COMPLETED', 'UNKNOWN'].includes(outcome)
      || (outcomeCode !== null && (!Number.isInteger(outcomeCode) || outcomeCode < 100 || outcomeCode > 599))) {
      throw new Error('MEMORY_DISPATCH_OUTCOME_INVALID');
    }
    let release = null;
    try {
      release = beginCoordinatorLock(this.coordinatorDb);
      this.#recordOutcome(requestId, requestDigest, outcome, outcomeCode);
      return Object.freeze({ status: outcome, requestId, requestDigest });
    } finally {
      try { release?.(); } catch {}
    }
  }

  #recordOutcome(requestId, requestDigest, status, outcomeCode) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare(
        'UPDATE dispatch_ledger SET status=?,outcome_code=?,finished_at=? WHERE request_id=? AND request_digest=? AND status=?',
      ).run(status, outcomeCode, new Date().toISOString(), requestId, requestDigest, 'DISPATCH_STARTED');
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
